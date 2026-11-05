/**
 * PostgreSQL search provider over `search_document`:
 *  - generated weighted tsvector `tsv` (GIN): title/keywords = A, subtitle = B, body = C
 *  - trigram GIN on `title` (pg_trgm) for typo-tolerant fuzzy fallback and suggestions
 *
 * Every word is queried in BOTH the 'english' (stemmed: title/subtitle/body) and 'simple'
 * (un-stemmed: keywords) configurations, so "tables" matches title "Table" and keyword "tables".
 * All tsquery expressions are built from immutable functions over bound parameters, so the
 * planner folds them into constants and can use the GIN indexes (see EXPLAIN in the report).
 */
import type { SearchEntityType, SearchHit } from "@/lib/contracts";
import { normalizeWords } from "../query";
import type { DocKey, ParsedQuery, ProviderSearchResult, SearchDocument, SearchProvider, StaleScope, Suggestion } from "../types";

export interface Queryable {
  query<R = Record<string, unknown>>(text: string, values?: unknown[]): Promise<{ rows: R[]; rowCount: number | null }>;
}

/** Entity-type priors: canonical/system pages above individual records, tokens lowest. */
export const ENTITY_WEIGHTS: Record<SearchEntityType, number> = {
  system: 1.3,
  "component-type": 1.25,
  framework: 1.15,
  "pattern-type": 1.1,
  component: 1.0,
  category: 0.95,
  pattern: 0.95,
  token: 0.75,
};

/** Entity types whose framework/platform facets describe the owning system. */
const SYSTEM_SCOPED: SearchEntityType[] = ["system", "component", "pattern", "token"];

const HL_START = "⟦"; // ⟦
const HL_STOP = "⟧"; // ⟧
const UPSERT_BATCH = 1000;
const FACET_LIMIT = 30;
const HL_WHOLE_MAX = 240;

class Params {
  readonly values: unknown[] = [];
  add(v: unknown): string {
    this.values.push(v);
    return `$${this.values.length}`;
  }
}

/* -------------------------------------------------------------------------- */
/* tsquery builders (words are pre-sanitised to [a-z0-9]+ by parseQuery)      */
/* -------------------------------------------------------------------------- */

const SAFE_WORD = /^[a-z0-9]+$/;

function wordQ(p: Params, w: string, prefix = false): string {
  if (!SAFE_WORD.test(w)) throw new Error(`unsafe search word: ${JSON.stringify(w)}`);
  const v = p.add(prefix ? `${w}:*` : w);
  return `(to_tsquery('english'::regconfig, ${v}) || to_tsquery('simple'::regconfig, ${v}))`;
}

function phraseQ(p: Params, words: string[]): string {
  if (words.length === 1) return wordQ(p, words[0]!);
  words.forEach((w) => {
    if (!SAFE_WORD.test(w)) throw new Error(`unsafe search word: ${JSON.stringify(w)}`);
  });
  const v = p.add(words.join(" "));
  return `(phraseto_tsquery('english'::regconfig, ${v}) || phraseto_tsquery('simple'::regconfig, ${v}))`;
}

const and = (xs: string[]) => (xs.length === 1 ? xs[0]! : `(${xs.join(" && ")})`);
const or = (xs: string[]) => (xs.length === 1 ? xs[0]! : `(${xs.join(" || ")})`);

interface TextQueries {
  strict: string;
  main: string;
  exp: string | null;
  soft: string | null;
  neg: string | null;
  fuzzy: string | null;
  compact: string;
  prefixLike: string;
}

function buildTextQueries(p: Params, q: ParsedQuery): TextQueries | null {
  const neg = q.negated.length ? or(q.negated.filter((w) => SAFE_WORD.test(w)).map((w) => wordQ(p, w))) : null;
  if (!q.terms.length) return neg ? { strict: "", main: "", exp: null, soft: null, neg, fuzzy: null, compact: "", prefixLike: "" } : null;
  const lastIdx = q.terms.length - 1;
  const lastQuoted = q.text.trim().endsWith('"');
  const termQ = (w: string, idx: number) => wordQ(p, w, idx === lastIdx && !lastQuoted);

  const strictV = p.add(q.text);
  const strict = `(websearch_to_tsquery('english'::regconfig, ${strictV}) || websearch_to_tsquery('simple'::regconfig, ${strictV}))`;
  const termQs = q.terms.map(termQ);
  const main = q.matchMode === "any" ? or(termQs) : and(termQs);

  let exp: string | null = null;
  if (q.units.some((u) => u.alternatives.length)) {
    let idx = 0;
    const unitQs = q.units.map((u) => {
      const own = and(u.words.map((w) => termQ(w, idx++)));
      return u.alternatives.length ? or([own, ...u.alternatives.map((a) => phraseQ(p, a))]) : own;
    });
    exp = q.matchMode === "any" ? or(unitQs) : and(unitQs);
  }
  const softWords = q.softTerms.filter((w) => SAFE_WORD.test(w));
  const soft = softWords.length ? or(softWords.map((w) => wordQ(p, w))) : null;
  const fuzzyText = q.terms.join(" ");
  const fuzzy = fuzzyText.length >= 4 && q.terms.length <= 3 ? p.add(fuzzyText) : null;
  return {
    strict,
    main,
    exp,
    soft,
    neg,
    fuzzy,
    compact: p.add(q.terms.join("")),
    prefixLike: p.add(`${q.terms.join(" ")}%`),
  };
}

/* -------------------------------------------------------------------------- */
/* Provider                                                                    */
/* -------------------------------------------------------------------------- */

export class PostgresSearchProvider implements SearchProvider {
  readonly name = "postgres";
  constructor(private readonly db: Queryable) {}

  async upsert(docs: SearchDocument[]): Promise<number> {
    let written = 0;
    for (let i = 0; i < docs.length; i += UPSERT_BATCH) {
      const batch = docs.slice(i, i + UPSERT_BATCH);
      const cols = {
        entityType: [] as string[],
        entityId: [] as string[],
        systemSlug: [] as (string | null)[],
        title: [] as string[],
        subtitle: [] as (string | null)[],
        body: [] as (string | null)[],
        keywords: [] as (string | null)[],
        url: [] as string[],
        facets: [] as string[],
        boost: [] as number[],
      };
      for (const d of batch) {
        cols.entityType.push(d.entityType);
        cols.entityId.push(d.entityId);
        cols.systemSlug.push(d.systemSlug);
        cols.title.push(d.title);
        cols.subtitle.push(d.subtitle);
        cols.body.push(d.body);
        cols.keywords.push(d.keywords);
        cols.url.push(d.url);
        cols.facets.push(JSON.stringify(d.facets ?? {}));
        cols.boost.push(Number.isFinite(d.boost) ? d.boost : 1);
      }
      const r = await this.db.query(
        `insert into search_document as sd (entity_type, entity_id, system_slug, title, subtitle, body, keywords, url, facets, boost, updated_at)
         select t.entity_type, t.entity_id, t.system_slug, t.title, t.subtitle, t.body, t.keywords, t.url, t.facets::jsonb, t.boost, now()
         from unnest($1::text[], $2::uuid[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[], $9::text[], $10::float8[])
           as t(entity_type, entity_id, system_slug, title, subtitle, body, keywords, url, facets, boost)
         on conflict (entity_type, entity_id) do update set
           system_slug = excluded.system_slug, title = excluded.title, subtitle = excluded.subtitle, body = excluded.body,
           keywords = excluded.keywords, url = excluded.url, facets = excluded.facets, boost = excluded.boost, updated_at = now()
         where (sd.system_slug, sd.title, sd.subtitle, sd.body, sd.keywords, sd.url, sd.facets, sd.boost)
           is distinct from (excluded.system_slug, excluded.title, excluded.subtitle, excluded.body, excluded.keywords, excluded.url, excluded.facets, excluded.boost)`,
        [cols.entityType, cols.entityId, cols.systemSlug, cols.title, cols.subtitle, cols.body, cols.keywords, cols.url, cols.facets, cols.boost],
      );
      written += r.rowCount ?? 0;
    }
    return written;
  }

  async removeStale(scope: StaleScope, keep: DocKey[]): Promise<number> {
    if (!scope.entityTypes.length) return 0;
    const r = await this.db.query(
      `delete from search_document d
       where d.entity_type = any($1::text[])
         and ($2::text is null or d.system_slug = $2::text)
         and not exists (
           select 1 from unnest($3::text[], $4::uuid[]) as k(entity_type, entity_id)
           where k.entity_type = d.entity_type and k.entity_id = d.entity_id
         )`,
      [scope.entityTypes, scope.systemSlug ?? null, keep.map((k) => k.entityType), keep.map((k) => k.entityId)],
    );
    return r.rowCount ?? 0;
  }

  async search(q: ParsedQuery): Promise<ProviderSearchResult> {
    const { text, values } = buildSearchSql(q);
    const r = await this.db.query<{
      total: number;
      hits: RawHit[] | null;
      f_entity: Facet[] | null;
      f_system: Facet[] | null;
      f_framework: Facet[] | null;
      f_group: Facet[] | null;
      f_category: Facet[] | null;
      f_token_category: Facet[] | null;
    }>(text, values);
    const row = r.rows[0];
    if (!row) return { total: 0, hits: [], facets: {} };
    const facets: ProviderSearchResult["facets"] = {};
    const put = (k: string, v: Facet[] | null) => {
      if (v && v.length) facets[k] = v.map((f) => ({ value: String(f.value), count: Number(f.count) }));
    };
    put("entityType", row.f_entity);
    put("system", row.f_system);
    put("framework", row.f_framework);
    put("group", row.f_group);
    put("category", row.f_category);
    put("tokenCategory", row.f_token_category);
    return { total: Number(row.total), hits: (row.hits ?? []).map(toHit), facets };
  }

  async suggest(prefix: string, limit: number): Promise<Suggestion[]> {
    const { text, values } = buildSuggestSql(prefix, limit) ?? {};
    if (!text) return [];
    const r = await this.db.query<{ title: string; subtitle: string | null; url: string; entity_type: SearchEntityType }>(text, values);
    return r.rows.map((x) => ({ title: x.title, subtitle: x.subtitle, url: x.url, entityType: x.entity_type }));
  }
}

interface Facet {
  value: string;
  count: number;
}

interface RawHit {
  entity_type: SearchEntityType;
  entity_id: string;
  title: string;
  subtitle: string | null;
  url: string;
  system_slug: string | null;
  score: number;
  highlight: string | null;
  facets: Record<string, unknown>;
}

function toHit(h: RawHit): SearchHit {
  return {
    entityType: h.entity_type,
    entityId: h.entity_id,
    title: h.title,
    subtitle: h.subtitle,
    url: h.url,
    systemSlug: h.system_slug,
    score: Math.round(Number(h.score) * 1e4) / 1e4,
    highlight: h.highlight ? renderHighlight(h.highlight) : null,
    facets: h.facets ?? {},
  };
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** HTML-escape the snippet, then turn sentinel markers into <mark>. Safe to render as HTML. */
export function renderHighlight(s: string): string {
  return escapeHtml(s.replace(/\s+/g, " ").trim()).replaceAll(HL_START, "<mark>").replaceAll(HL_STOP, "</mark>");
}

function entityWeightSql(): string {
  return `(case d.entity_type ${Object.entries(ENTITY_WEIGHTS)
    .map(([k, v]) => `when '${k}' then ${v}`)
    .join(" ")} else 1 end)`;
}

function themeMatchSql(p: Params, themes: string[]): string {
  return or(themes.map((t) => `lower(coalesce(d.facets->>'theme', '')) like ${p.add(`%${t.split("-").join("%")}%`)}`));
}

/** Exported for EXPLAIN / tests. */
export function buildSearchSql(q: ParsedQuery): { text: string; values: unknown[] } {
  const p = new Params();
  const tq = buildTextQueries(p, q);
  const where: string[] = [];
  const hasText = !!tq && !!tq.main;

  if (hasText) {
    const matchQ = or([tq!.strict, tq!.main, ...(tq!.exp ? [tq!.exp] : [])]);
    where.push(tq!.fuzzy ? `(d.tsv @@ ${matchQ} or d.title % ${tq!.fuzzy})` : `d.tsv @@ ${matchQ}`);
  }
  if (tq?.neg) where.push(`not (d.tsv @@ ${tq.neg})`);

  const f = q.filters;
  if (f.systems?.length) where.push(`d.system_slug = any(${p.add(f.systems)}::text[])`);
  if (f.frameworks?.length) {
    const fw = p.add(f.frameworks);
    where.push(
      `(case when d.entity_type = any(${p.add(SYSTEM_SCOPED)}::text[]) then coalesce(d.facets->'frameworks' ?| ${fw}::text[], false)
             when d.entity_type = 'framework' then d.facets->>'slug' = any(${fw}::text[])
             else true end)`,
    );
  }
  if (f.platforms?.length) {
    const pl = p.add(f.platforms);
    where.push(
      `(case when d.entity_type = any(${p.add(SYSTEM_SCOPED)}::text[]) then coalesce(d.facets->'platforms' ?| ${pl}::text[], false) else true end)`,
    );
  }
  if (f.categories?.length) {
    const c = p.add(f.categories);
    where.push(`(d.facets->>'category' = any(${c}::text[]) or d.facets->>'group' = any(${c}::text[]))`);
  }
  if (f.themes?.length) where.push(`(d.entity_type <> 'token' or ${themeMatchSql(p, f.themes)})`);
  const typeFilter = f.types?.length ? `d.entity_type = any(${p.add(f.types)}::text[])` : "true";

  /* ---- score ---- */
  const parts: string[] = [];
  if (hasText) {
    parts.push(`1.0 * ts_rank_cd(d.tsv, ${tq!.strict}, 32)`);
    parts.push(`0.8 * ts_rank_cd(d.tsv, ${tq!.main}, 32)`);
    if (tq!.exp) parts.push(`0.35 * ts_rank_cd(d.tsv, ${tq!.exp}, 32)`);
    if (tq!.soft) parts.push(`0.25 * ts_rank_cd(d.tsv, ${tq!.soft}, 32)`);
    if (tq!.fuzzy) parts.push(`0.6 * similarity(d.title, ${tq!.fuzzy})`);
    parts.push(
      `(case when regexp_replace(lower(d.title), '[^a-z0-9]+', '', 'g') = ${tq!.compact} then 3.0
             when lower(d.title) like ${tq!.prefixLike} then 0.8 else 0 end)`,
    );
  }
  const b = q.boosts;
  if (b.componentTypes.length) {
    const ct = p.add(b.componentTypes);
    parts.push(`(case when d.facets->>'componentType' = any(${ct}::text[]) or (d.entity_type = 'component-type' and d.facets->>'slug' = any(${ct}::text[])) then 1.2 else 0 end)`);
  }
  if (b.relatedComponentTypes.length) {
    const ct = p.add(b.relatedComponentTypes);
    parts.push(`(case when d.facets->>'componentType' = any(${ct}::text[]) or (d.entity_type = 'component-type' and d.facets->>'slug' = any(${ct}::text[])) then 0.35 else 0 end)`);
  }
  if (b.patternTypes.length) {
    const pt = p.add(b.patternTypes);
    parts.push(`(case when d.facets->>'patternType' = any(${pt}::text[]) or (d.entity_type = 'pattern-type' and d.facets->>'slug' = any(${pt}::text[])) then 0.8 else 0 end)`);
  }
  if (b.states.length) parts.push(`(case when coalesce(d.facets->'states' ?| ${p.add(b.states)}::text[], false) then 0.6 else 0 end)`);
  if (b.accessibility) parts.push(`(case when d.facets->>'hasA11y' = 'true' then 0.5 else 0 end)`);
  if (b.tags.length) {
    const tg = p.add(b.tags);
    parts.push(`(case when coalesce(d.facets->'tags' ?| ${tg}::text[], false) or coalesce(d.facets->'systemTags' ?| ${tg}::text[], false) then 0.6 else 0 end)`);
  }
  if (b.themes.length) parts.push(`(case when d.entity_type = 'token' and ${themeMatchSql(p, b.themes)} then 0.8 else 0 end)`);
  if (b.entityTypes.length) parts.push(`(case when d.entity_type = any(${p.add(b.entityTypes)}::text[]) then 0.8 else 0 end)`);
  // Browse mode (no text): rank by priors only, still adding interpreted-filter bonuses.
  const score = `((${parts.length ? parts.join(" + ") : "0"}) + ${hasText ? "0" : "1"}) * ${entityWeightSql()} * d.boost`;

  // Short bodies (most descriptions) are highlighted whole; long ones get one fragment.
  const highlight = hasText
    ? `case when d.body is not null and d.body <> '' then ts_headline('english'::regconfig, d.body, ${or([tq!.strict, tq!.main, ...(tq!.exp ? [tq!.exp] : [])])},
         case when length(d.body) <= ${HL_WHOLE_MAX} then ${p.add(`StartSel=${HL_START}, StopSel=${HL_STOP}, HighlightAll=true`)}
              else ${p.add(`StartSel=${HL_START}, StopSel=${HL_STOP}, MaxWords=26, MinWords=10, ShortWord=2, MaxFragments=1`)} end) end`
    : `null::text`;
  // Disjunctive entity-type facet: with an explicit type filter, count what the other types
  // would return too (UI tabs); an interpreted type filter ("tokens") counts the filtered set.
  const entityFacetSource = q.filters.types?.length && !q.interpretedHard.types ? "matched_all" : "matched";

  const limit = p.add(q.limit);
  const offset = p.add(q.offset);

  const text = `
with matched_all as (
  select d.id, d.entity_type, d.entity_id, d.system_slug, d.title, d.subtitle, d.body, d.url, d.facets, d.boost, d.tsv
  from search_document d
  where ${where.length ? where.join("\n    and ") : "true"}
),
matched as (
  select * from matched_all d where ${typeFilter}
),
scored as (
  select d.*, ${score} as score from matched d
),
page as (
  select d.*, ${highlight} as highlight
  from (select * from scored order by score desc, title asc, entity_id asc limit ${limit} offset ${offset}) d
)
select
  (select count(*) from matched)::int as total,
  (select json_agg(json_build_object(
      'entity_type', d.entity_type, 'entity_id', d.entity_id, 'title', d.title, 'subtitle', d.subtitle, 'url', d.url,
      'system_slug', d.system_slug, 'score', d.score, 'highlight', d.highlight, 'facets', d.facets)
    order by d.score desc, d.title asc, d.entity_id asc) from page d) as hits,
  (select json_agg(json_build_object('value', v, 'count', c) order by c desc, v) from (
     select entity_type as v, count(*) as c from ${entityFacetSource} group by 1) x) as f_entity,
  (select json_agg(json_build_object('value', v, 'count', c) order by c desc, v) from (
     select system_slug as v, count(*) as c from matched where system_slug is not null group by 1 order by 2 desc, 1 limit ${FACET_LIMIT}) x) as f_system,
  (select json_agg(json_build_object('value', v, 'count', c) order by c desc, v) from (
     select fw as v, count(*) as c from matched d
       cross join lateral jsonb_array_elements_text(case when jsonb_typeof(d.facets->'frameworks') = 'array' then d.facets->'frameworks' else '[]'::jsonb end) fw
       where d.entity_type in ('system', 'component')
     group by 1 order by 2 desc, 1 limit ${FACET_LIMIT}) x) as f_framework,
  (select json_agg(json_build_object('value', v, 'count', c) order by c desc, v) from (
     select d.facets->>'group' as v, count(*) as c from matched d
       where d.entity_type in ('component', 'component-type') and d.facets->>'group' is not null group by 1) x) as f_group,
  (select json_agg(json_build_object('value', v, 'count', c) order by c desc, v) from (
     select d.facets->>'category' as v, count(*) as c from matched d
       where d.entity_type = 'system' and d.facets->>'category' is not null group by 1) x) as f_category,
  (select json_agg(json_build_object('value', v, 'count', c) order by c desc, v) from (
     select d.facets->>'category' as v, count(*) as c from matched d
       where d.entity_type = 'token' and d.facets->>'category' is not null group by 1) x) as f_token_category
`;
  return { text, values: p.values };
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export function buildSuggestSql(prefix: string, limit: number): { text: string; values: unknown[] } | null {
  const raw = prefix.trim().toLowerCase().slice(0, 100);
  const words = normalizeWords(raw).split(" ").filter((w) => SAFE_WORD.test(w));
  if (!raw || !words.length) return null;
  const p = new Params();
  const norm = words.join(" ");
  const tsq = and(words.map((w, i) => wordQ(p, w, i === words.length - 1)));
  const starts = p.add(`${escapeLike(raw)}%`);
  const wordStart = p.add(`% ${escapeLike(raw)}%`);
  const trg = p.add(norm);
  const lim = p.add(Math.min(Math.max(limit, 1), 20));
  const fuzzy = norm.length >= 3 ? `or d.title % ${trg}` : "";
  const text = `
select title, subtitle, url, entity_type from (
  select distinct on (lower(d.title)) d.title, d.subtitle, d.url, d.entity_type,
    ((case when lower(d.title) like ${starts} then 3.0 when lower(d.title) like ${wordStart} then 1.5 else 0 end)
      + similarity(d.title, ${trg}) + 0.5 * ts_rank_cd(d.tsv, ${tsq}, 32)) * ${entityWeightSql()} * d.boost as score
  from search_document d
  where d.title ilike ${starts} or d.title ilike ${wordStart} ${fuzzy} or d.tsv @@ ${tsq}
  order by lower(d.title), score desc, d.entity_type
) x
order by score desc, title asc
limit ${lim}`;
  return { text, values: p.values };
}
