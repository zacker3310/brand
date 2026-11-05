/**
 * Read models (and the one write: saved comparisons) for /compare, /compare/systems and
 * /api/comparisons. All reads go through readDb() (request-time). Every query is parameterized and
 * batched over the selected systems/components: a comparison costs a fixed number of round trips.
 */
import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { COMPONENT_FIELDS, type CoverageMap, type CoverageState, type MaintenanceStatus, type VerificationState } from "@/lib/contracts";
import { rankCandidates } from "@/lib/scoring/align";
import { shortSlugFromBytes } from "@/lib/scoring/params";
import type {
  CompareSystemInfo,
  CompareTypeInfo,
  ComparisonColumn,
  ComponentCandidate,
  ComponentDetail,
  ComponentTokenView,
  CriterionId,
  SystemMetrics,
} from "@/lib/scoring/types";
import { readDb } from "./db";
import { publishedIngestionStatus } from "./status";

const p = <T>(v: T) => sql.param(v);
const iso = (v: unknown): string | null => (v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());

/* -------------------------------------------------------------------------- */
/* Picker options                                                              */
/* -------------------------------------------------------------------------- */

export interface TypeOption {
  slug: string;
  name: string;
  group: string;
  groupName: string;
  /** Systems with at least one published component of this type: slug -> component count. */
  systems: Record<string, number>;
  systemCount: number;
  componentCount: number;
}

export interface SystemOption {
  slug: string;
  name: string;
  category: string;
  ingestionStatus: string;
  components: number;
}

export async function getCompareOptions(): Promise<{ types: TypeOption[]; systems: SystemOption[] }> {
  const db = await readDb();
  const [types, impl, systems] = await Promise.all([
    db.execute<{ slug: string; name: string; group_slug: string; group_name: string }>(sql`
      select ct.slug, ct.name, cat.slug as group_slug, cat.name as group_name
      from component_type ct join category cat on cat.id = ct.category_id
      order by cat.sort_order, ct.sort_order, ct.name`),
    db.execute<{ type_slug: string; system_slug: string; n: number }>(sql`
      select ct.slug as type_slug, ds.slug as system_slug, count(*)::int as n
      from component c
      join component_type ct on ct.id = c.component_type_id
      join design_system ds on ds.id = c.design_system_id
      where c.publish_state = 'published' and ds.publish_state = 'published' and ds.registry_status = 'verified'
      group by 1, 2`),
    db.execute<{ slug: string; name: string; category: string; ingestion_status: string; components: number }>(sql`
      select ds.slug, ds.name, ds.category::text as category, ${publishedIngestionStatus("ds")} as ingestion_status,
        (select count(*)::int from component c where c.design_system_id = ds.id and c.publish_state = 'published') as components
      from design_system ds
      where ds.publish_state = 'published' and ds.registry_status = 'verified'
      order by lower(ds.name)`),
  ]);
  const byType = new Map<string, Record<string, number>>();
  for (const r of impl.rows) {
    const m = byType.get(r.type_slug) ?? {};
    m[r.system_slug] = Number(r.n);
    byType.set(r.type_slug, m);
  }
  return {
    types: types.rows.map((t) => {
      const sys = byType.get(t.slug) ?? {};
      return {
        slug: t.slug,
        name: t.name,
        group: t.group_slug,
        groupName: t.group_name,
        systems: sys,
        systemCount: Object.keys(sys).length,
        componentCount: Object.values(sys).reduce((a, b) => a + b, 0),
      };
    }),
    systems: systems.rows.map((s) => ({ slug: s.slug, name: s.name, category: s.category, ingestionStatus: s.ingestion_status, components: Number(s.components) })),
  };
}

export interface SuggestedComparison {
  type: string;
  typeName: string;
  systems: string[];
  systemCount: number;
  componentCount: number;
}

/** Types implemented by >= minSystems systems, most widely implemented first (derived from data). */
export function suggestComparisons(types: TypeOption[], minSystems = 3, limit = 8): SuggestedComparison[] {
  return types
    .filter((t) => t.systemCount >= minSystems)
    .sort((a, b) => b.systemCount - a.systemCount || b.componentCount - a.componentCount || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map((t) => ({
      type: t.slug,
      typeName: t.name,
      systems: Object.keys(t.systems).sort().slice(0, 5),
      systemCount: t.systemCount,
      componentCount: t.componentCount,
    }));
}

/* -------------------------------------------------------------------------- */
/* Saved comparisons                                                           */
/* -------------------------------------------------------------------------- */

export interface SavedComparison {
  slug: string;
  title: string;
  ownerId: string | null;
  typeSlug: string | null;
  typeName: string | null;
  systemSlugs: string[];
  criteria: string[];
  isFeatured: boolean;
  createdAt: string;
}

type SavedRow = {
  slug: string;
  title: string;
  owner_id: string | null;
  type_slug: string | null;
  type_name: string | null;
  system_slugs: string[];
  criteria: string[] | null;
  is_featured: boolean;
  created_at: Date | string;
};

const toSaved = (r: SavedRow): SavedComparison => ({
  slug: r.slug,
  title: r.title,
  ownerId: r.owner_id,
  typeSlug: r.type_slug,
  typeName: r.type_name,
  systemSlugs: r.system_slugs,
  criteria: r.criteria ?? [],
  isFeatured: r.is_featured,
  createdAt: iso(r.created_at)!,
});

const savedSelect = sql`
  select cmp.slug, cmp.title, cmp.owner_id, ct.slug as type_slug, ct.name as type_name, cmp.system_slugs, cmp.criteria, cmp.is_featured, cmp.created_at
  from comparison cmp left join component_type ct on ct.id = cmp.component_type_id`;

export async function getFeaturedComparisons(limit = 6): Promise<SavedComparison[]> {
  const db = await readDb();
  const r = await db.execute<SavedRow>(sql`${savedSelect} where cmp.is_featured order by cmp.created_at desc limit ${limit}`);
  return r.rows.map(toSaved);
}

export async function getOwnerComparisons(ownerId: string, limit = 6): Promise<SavedComparison[]> {
  const db = await readDb();
  const r = await db.execute<SavedRow>(sql`${savedSelect} where cmp.owner_id = ${ownerId} order by cmp.created_at desc limit ${limit}`);
  return r.rows.map(toSaved);
}

export async function getComparisonBySlug(slug: string): Promise<SavedComparison | null> {
  const db = await readDb();
  const r = await db.execute<SavedRow>(sql`${savedSelect} where cmp.slug = ${slug} limit 1`);
  return r.rows[0] ? toSaved(r.rows[0]) : null;
}

export interface ResolvedSystems {
  found: { slug: string; name: string }[];
  unknown: string[];
}

/** Verified, published systems among `slugs` (input order preserved). */
export async function resolveSystems(slugs: string[]): Promise<ResolvedSystems> {
  if (!slugs.length) return { found: [], unknown: [] };
  const db = await readDb();
  const r = await db.execute<{ slug: string; name: string }>(sql`
    select slug, name from design_system
    where slug = any(${p(slugs)}::text[]) and publish_state = 'published' and registry_status = 'verified'`);
  const by = new Map(r.rows.map((x) => [x.slug, x]));
  return { found: slugs.flatMap((s) => (by.has(s) ? [by.get(s)!] : [])), unknown: slugs.filter((s) => !by.has(s)) };
}

export async function getTypeRef(slug: string): Promise<{ id: string; slug: string; name: string } | null> {
  const db = await readDb();
  const r = await db.execute<{ id: string; slug: string; name: string }>(sql`select id, slug, name from component_type where slug = ${slug} limit 1`);
  return r.rows[0] ?? null;
}

export async function createComparison(input: {
  title: string;
  ownerId: string | null;
  componentTypeId: string | null;
  systemSlugs: string[];
  criteria: string[] | null;
}): Promise<{ slug: string }> {
  const db = await readDb();
  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = shortSlugFromBytes(randomBytes(8), 8);
    const r = await db.execute<{ slug: string }>(sql`
      insert into comparison (slug, owner_id, title, component_type_id, system_slugs, criteria)
      values (${slug}, ${input.ownerId}, ${input.title}, ${input.componentTypeId}, ${p(input.systemSlugs)}::text[], ${input.criteria ? JSON.stringify(input.criteria) : null}::jsonb)
      on conflict (slug) do nothing
      returning slug`);
    if (r.rows[0]) return { slug: r.rows[0].slug };
  }
  throw new Error("could not allocate a comparison slug");
}

/* -------------------------------------------------------------------------- */
/* Component comparison                                                        */
/* -------------------------------------------------------------------------- */

type SystemRow = {
  id: string;
  slug: string;
  name: string;
  org: string | null;
  category: string;
  ingestion_status: string;
  docs_url: string | null;
  homepage_url: string | null;
  last_ingested_at: Date | string | null;
};

async function loadSystems(slugs: string[]): Promise<(CompareSystemInfo & { id: string })[]> {
  const db = await readDb();
  const r = await db.execute<SystemRow>(sql`
    select ds.id, ds.slug, ds.name, o.name as org, ds.category::text as category, ${publishedIngestionStatus("ds")} as ingestion_status,
      ds.docs_url, ds.homepage_url, ds.last_ingested_at
    from design_system ds left join organization o on o.id = ds.organization_id
    where ds.slug = any(${p(slugs)}::text[]) and ds.publish_state = 'published' and ds.registry_status = 'verified'`);
  const by = new Map(r.rows.map((x) => [x.slug, x]));
  return slugs.flatMap((s) => {
    const x = by.get(s);
    if (!x) return [];
    return [
      {
        id: x.id,
        slug: x.slug,
        name: x.name,
        organization: x.org,
        category: x.category,
        ingestionStatus: x.ingestion_status,
        docsUrl: x.docs_url,
        homepageUrl: x.homepage_url,
        lastIngestedAt: iso(x.last_ingested_at),
      },
    ];
  });
}

export interface ComponentComparisonData {
  type: CompareTypeInfo;
  columns: ComparisonColumn[];
  unknownSystems: string[];
}

export async function getComponentComparison(input: { type: string; systems: string[]; picks: Record<string, string> }): Promise<ComponentComparisonData | null> {
  const db = await readDb();
  const typeRes = await db.execute<{ id: string; slug: string; name: string; description: string; aria_pattern: string | null; group_name: string | null; aliases: string[]; near_synonyms: string[] }>(sql`
    select ct.id, ct.slug, ct.name, ct.description, ct.aria_pattern, cat.name as group_name, ct.aliases, ct.near_synonyms
    from component_type ct left join category cat on cat.id = ct.category_id where ct.slug = ${input.type} limit 1`);
  const t = typeRes.rows[0];
  if (!t) return null;
  const type: CompareTypeInfo = { id: t.id, slug: t.slug, name: t.name, description: t.description, ariaPattern: t.aria_pattern, group: t.group_name, aliases: t.aliases, nearSynonyms: t.near_synonyms };

  const systems = await loadSystems(input.systems);
  const unknownSystems = input.systems.filter((s) => !systems.some((x) => x.slug === s));
  if (!systems.length) return { type, columns: [], unknownSystems };

  const candRes = await db.execute<{ id: string; slug: string; name: string; lifecycle: string; classification_state: VerificationState; classification_method: string | null; confidence: number; system_id: string }>(sql`
    select c.id, c.slug, c.name, c.lifecycle, c.classification_state::text as classification_state, c.classification_method, c.confidence, c.design_system_id as system_id
    from component c
    where c.component_type_id = ${type.id} and c.publish_state = 'published' and c.design_system_id = any(${p(systems.map((s) => s.id))}::uuid[])`);

  const candidatesBySystem = new Map<string, ComponentCandidate[]>();
  for (const r of candRes.rows) {
    const list = candidatesBySystem.get(r.system_id) ?? [];
    list.push({ id: r.id, slug: r.slug, name: r.name, lifecycle: r.lifecycle, classificationState: r.classification_state, classificationMethod: r.classification_method, confidence: Number(r.confidence) });
    candidatesBySystem.set(r.system_id, list);
  }

  const picked: { systemId: string; candidate: ComponentCandidate | null; candidates: ComponentCandidate[] }[] = systems.map((s) => {
    const ranked = rankCandidates(candidatesBySystem.get(s.id) ?? [], type);
    const want = input.picks[s.slug];
    return { systemId: s.id, candidates: ranked, candidate: ranked.find((c) => c.slug === want) ?? ranked[0] ?? null };
  });
  const ids = picked.flatMap((x) => (x.candidate ? [x.candidate.id] : []));
  const details = await loadComponentDetails(ids);

  const columns: ComparisonColumn[] = systems.map((s, i) => {
    const pk = picked[i]!;
    const component = pk.candidate ? (details.get(pk.candidate.id) ?? null) : null;
    const { id: _id, ...system } = s;
    return {
      system,
      candidates: pk.candidates,
      component,
      missing: component ? null : s.ingestionStatus === "indexed" || s.ingestionStatus === "partial" || s.ingestionStatus === "inventory" ? "no-component" : "not-indexed",
    };
  });
  return { type, columns, unknownSystems };
}

async function loadComponentDetails(ids: string[]): Promise<Map<string, ComponentDetail>> {
  const out = new Map<string, ComponentDetail>();
  if (!ids.length) return out;
  const db = await readDb();
  const idp = p(ids);
  const [comps, variants, states, props, a11y, fws, examples, toks, ev] = await Promise.all([
    db.execute<{
      id: string;
      slug: string;
      name: string;
      aliases: string[];
      description: string | null;
      docs_url: string | null;
      source_code_url: string | null;
      lifecycle: string;
      classification_state: VerificationState;
      classification_method: string | null;
      confidence: number;
      sizes: string[] | null;
      responsive_guidance: string | null;
      coverage: CoverageMap;
    }>(sql`
      select id, slug, name, aliases, description, docs_url, source_code_url, lifecycle, classification_state::text as classification_state,
        classification_method, confidence, sizes, responsive_guidance, coverage
      from component where id = any(${idp}::uuid[])`),
    db.execute<{ component_id: string; axis: string; name: string; description: string | null }>(sql`
      select component_id, axis, name, description from component_variant where component_id = any(${idp}::uuid[]) order by axis, lower(name)`),
    db.execute<{ component_id: string; name: string; canonical_state: string | null; description: string | null }>(sql`
      select component_id, name, canonical_state, description from component_state where component_id = any(${idp}::uuid[]) order by lower(name)`),
    db.execute<{ component_id: string; implementation: string; name: string; type: string | null; default_value: string | null; required: boolean | null; deprecated: boolean }>(sql`
      select component_id, implementation, name, type, default_value, required, deprecated
      from component_property where component_id = any(${idp}::uuid[]) order by implementation, name`),
    db.execute<{
      component_id: string;
      aria_pattern: string | null;
      roles: string[] | null;
      keyboard: { keys: string; action: string }[] | null;
      guidance: string | null;
      screen_reader: string | null;
      focus_management: string | null;
      wcag_criteria: string[] | null;
      docs_url: string | null;
      coverage: CoverageMap;
    }>(sql`
      select component_id, aria_pattern, roles, keyboard, guidance, screen_reader, focus_management, wcag_criteria, docs_url, coverage
      from component_accessibility where component_id = any(${idp}::uuid[])`),
    db.execute<{ component_id: string; slug: string; name: string; package_name: string | null; import_name: string | null }>(sql`
      select cf.component_id, f.slug, f.name, cf.package_name, cf.import_name
      from component_framework cf join framework f on f.id = cf.framework_id
      where cf.component_id = any(${idp}::uuid[]) order by f.name`),
    db.execute<{ component_id: string; kind: string; title: string; url: string | null; kind_total: number }>(sql`
      select component_id, kind, title, url, kind_total from (
        select component_id, kind, title, url,
          count(*) over (partition by component_id, kind)::int as kind_total,
          row_number() over (partition by component_id, kind order by title) as rn
        from component_example where component_id = any(${idp}::uuid[])
      ) x where rn <= 3 order by component_id, kind, title`),
    db.execute<{ component_id: string; name: string; category: string; type: string | null; properties: string[]; values: ComponentTokenView["values"] }>(sql`
      select tu.component_id, t.name, t.category::text as category, t.type,
        coalesce(array_agg(distinct tu.property) filter (where tu.property is not null), '{}') as properties,
        json_agg(distinct jsonb_build_object('set', ts.slug, 'theme', ts.theme, 'valueText', t.value_text, 'resolved', t.resolved_value, 'aliasState', t.alias_state)) as values
      from token_usage tu
      join token t on t.id = tu.token_id
      join token_set ts on ts.id = t.token_set_id
      where tu.component_id = any(${idp}::uuid[]) and ts.publish_state = 'published'
      group by tu.component_id, t.name, t.category, t.type`),
    db.execute<{ subject_id: string; n: number; sources: number; last: Date | string | null; methods: string[]; hosts: string[] }>(sql`
      select subject_id, count(*)::int as n, count(distinct source_url)::int as sources, max(retrieved_at) as last,
        array_agg(distinct extraction_method) as methods,
        array_agg(distinct regexp_replace(source_url, '^[a-z]+://(www\\.)?([^/:?#]+).*$', '\\2')) as hosts
      from verification_evidence
      where subject_type = 'component' and subject_id = any(${idp}::uuid[])
      group by subject_id`),
  ]);

  const groupBy = <R extends { component_id: string }>(rows: R[]) => {
    const m = new Map<string, R[]>();
    for (const r of rows) {
      const l = m.get(r.component_id);
      if (l) l.push(r);
      else m.set(r.component_id, [r]);
    }
    return m;
  };
  const V = groupBy(variants.rows);
  const S = groupBy(states.rows);
  const P = groupBy(props.rows);
  const A = new Map(a11y.rows.map((r) => [r.component_id, r]));
  const F = groupBy(fws.rows);
  const X = groupBy(examples.rows);
  const T = groupBy(toks.rows);
  const E = new Map(ev.rows.map((r) => [r.subject_id, r]));

  for (const c of comps.rows) {
    const a = A.get(c.id);
    const e = E.get(c.id);
    const exampleCounts: Record<string, number> = {};
    for (const x of X.get(c.id) ?? []) exampleCounts[x.kind] = Number(x.kind_total);
    out.set(c.id, {
      id: c.id,
      slug: c.slug,
      name: c.name,
      aliases: c.aliases ?? [],
      description: c.description,
      docsUrl: c.docs_url,
      sourceCodeUrl: c.source_code_url,
      lifecycle: c.lifecycle,
      classification: { state: c.classification_state, method: c.classification_method, confidence: Number(c.confidence) },
      sizes: c.sizes,
      responsiveGuidance: c.responsive_guidance,
      coverage: c.coverage ?? {},
      variants: (V.get(c.id) ?? []).map((v) => ({ axis: v.axis, name: v.name, description: v.description })),
      states: (S.get(c.id) ?? []).map((s) => ({ name: s.name, canonical: s.canonical_state, description: s.description })),
      properties: (P.get(c.id) ?? []).map((x) => ({ implementation: x.implementation, name: x.name, type: x.type, defaultValue: x.default_value, required: x.required, deprecated: x.deprecated })),
      accessibility: a
        ? {
            ariaPattern: a.aria_pattern,
            roles: a.roles,
            keyboard: a.keyboard,
            guidance: a.guidance,
            screenReader: a.screen_reader,
            focusManagement: a.focus_management,
            wcagCriteria: a.wcag_criteria,
            docsUrl: a.docs_url,
            coverage: a.coverage ?? {},
          }
        : null,
      frameworks: (F.get(c.id) ?? []).map((f) => ({ slug: f.slug, name: f.name, packageName: f.package_name, importName: f.import_name })),
      examples: (X.get(c.id) ?? []).map((x) => ({ kind: x.kind, title: x.title, url: x.url })),
      exampleCounts,
      tokens: (T.get(c.id) ?? []).map((t) => ({ name: t.name, category: t.category, type: t.type, properties: t.properties ?? [], values: t.values ?? [] })),
      evidence: {
        count: e ? Number(e.n) : 0,
        sources: e ? Number(e.sources) : 0,
        lastRetrievedAt: e ? iso(e.last) : null,
        methods: (e?.methods ?? []).slice(0, 6),
        hosts: (e?.hosts ?? []).slice(0, 4),
      },
    });
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* System comparison                                                           */
/* -------------------------------------------------------------------------- */

export interface SystemCompareEntry {
  info: CompareSystemInfo & {
    summary: string | null;
    license: string | null;
    maintenanceStatus: MaintenanceStatus;
    latestVersion: string | null;
  };
  metrics: SystemMetrics;
}

export async function getSystemComparison(slugs: string[]): Promise<{ entries: SystemCompareEntry[]; unknown: string[]; taxonomySize: number }> {
  const db = await readDb();
  const taxRes = await db.execute<{ n: number }>(sql`select count(*)::int as n from component_type`);
  const taxonomySize = Number(taxRes.rows[0]?.n ?? 0);
  if (!slugs.length) return { entries: [], unknown: [], taxonomySize };

  const metaRes = await db.execute<{
    id: string;
    slug: string;
    name: string;
    org: string | null;
    summary: string | null;
    category: string;
    ingestion_status: string;
    docs_url: string | null;
    homepage_url: string | null;
    repository_url: string | null;
    package_count: number;
    maintenance_status: MaintenanceStatus;
    latest_version: string | null;
    latest_release_at: Date | string | null;
    last_ingested_at: Date | string | null;
    license_slug: string | null;
    license_name: string | null;
    spdx_id: string | null;
    is_open_source: boolean | null;
    frameworks: { slug: string; name: string; kind: string; state: VerificationState }[];
  }>(sql`
    select d.id, d.slug, d.name, o.name as org, d.summary, d.category::text as category, ${publishedIngestionStatus("d")} as ingestion_status,
      d.docs_url, d.homepage_url, d.repository_url,
      coalesce(jsonb_array_length(d.packages), 0)::int as package_count,
      d.maintenance_status::text as maintenance_status, d.latest_version, d.latest_release_at, d.last_ingested_at,
      l.slug as license_slug, l.name as license_name, l.spdx_id, l.is_open_source,
      coalesce((
        select json_agg(json_build_object('slug', f.slug, 'name', f.name, 'kind', f.kind, 'state', df.verification_state) order by f.name)
        from design_system_framework df join framework f on f.id = df.framework_id where df.design_system_id = d.id
      ), '[]'::json) as frameworks
    from design_system d
    left join license l on l.id = d.license_id
    left join organization o on o.id = d.organization_id
    where d.slug = any(${p(slugs)}::text[]) and d.publish_state = 'published' and d.registry_status = 'verified'`);

  const rows = metaRes.rows;
  const unknown = slugs.filter((s) => !rows.some((r) => r.slug === s));
  if (!rows.length) return { entries: [], unknown, taxonomySize };
  const ids = p(rows.map((r) => r.id));
  const fields = p([...COMPONENT_FIELDS]);

  const [compAgg, covAgg, depthAgg, tokAgg, setAgg, evAgg] = await Promise.all([
    db.execute<{ sid: string; total: number; classified: number; classified_verified: number; types: string[] }>(sql`
      select c.design_system_id as sid, count(*)::int as total,
        count(*) filter (where c.component_type_id is not null)::int as classified,
        count(*) filter (where c.component_type_id is not null and c.classification_state = 'verified')::int as classified_verified,
        coalesce(array_agg(distinct ct.slug) filter (where ct.slug is not null), '{}') as types
      from component c left join component_type ct on ct.id = c.component_type_id
      where c.design_system_id = any(${ids}::uuid[]) and c.publish_state = 'published'
      group by 1`),
    db.execute<{ sid: string; field: string; state: CoverageState; n: number }>(sql`
      select c.design_system_id as sid, kv.key as field, kv.value as state, count(*)::int as n
      from component c cross join lateral jsonb_each_text(c.coverage) kv
      where c.design_system_id = any(${ids}::uuid[]) and c.publish_state = 'published'
      group by 1, 2, 3`),
    db.execute<{ sid: string; avg_doc: number | null; avg_known: number | null; avg_ratio: number | null }>(sql`
      select c.design_system_id as sid, avg(x.doc)::float8 as avg_doc, avg(x.known)::float8 as avg_known,
        avg(case when x.known > 0 then x.doc / x.known end)::float8 as avg_ratio
      from component c cross join lateral (
        select
          coalesce(sum(case when kv.value in ('documented', 'documented-none') then 1 when kv.value = 'inferred' then 0.5 else 0 end), 0)::float8 as doc,
          (count(*) filter (where kv.value <> 'not-extracted'))::float8 as known
        from jsonb_each_text(c.coverage) kv where kv.key = any(${fields}::text[])
      ) x
      where c.design_system_id = any(${ids}::uuid[]) and c.publish_state = 'published'
      group by 1`),
    db.execute<{
      sid: string;
      total: number;
      primitive: number;
      semantic: number;
      component: number;
      untiered: number;
      tier_verified: number;
      aliases: number;
      alias_resolved: number;
      alias_external: number;
      alias_broken: number;
      layout: number;
      breakpoint_named: number;
    }>(sql`
      select t.design_system_id as sid, count(*)::int as total,
        count(*) filter (where t.tier = 'primitive')::int as primitive,
        count(*) filter (where t.tier = 'semantic')::int as semantic,
        count(*) filter (where t.tier = 'component')::int as component,
        count(*) filter (where t.tier is null)::int as untiered,
        count(*) filter (where t.tier is not null and t.tier_state = 'verified')::int as tier_verified,
        count(*) filter (where t.is_alias)::int as aliases,
        count(*) filter (where t.is_alias and t.alias_state in ('resolved', 'theme-dependent'))::int as alias_resolved,
        count(*) filter (where t.is_alias and t.alias_state = 'external')::int as alias_external,
        count(*) filter (where t.is_alias and t.alias_state in ('unresolved', 'cycle'))::int as alias_broken,
        count(*) filter (where t.category = 'layout')::int as layout,
        count(*) filter (where t.name ~* '(breakpoint|viewport|media-query|screen-(xs|sm|md|lg|xl))')::int as breakpoint_named
      from token t join token_set s on s.id = t.token_set_id
      where t.design_system_id = any(${ids}::uuid[]) and s.publish_state = 'published'
      group by 1`),
    db.execute<{ sid: string; sets: number; themed_sets: number; themes: string[] }>(sql`
      select design_system_id as sid, count(*)::int as sets, count(*) filter (where theme is not null)::int as themed_sets,
        coalesce(array_agg(distinct theme) filter (where theme is not null), '{}') as themes
      from token_set where design_system_id = any(${ids}::uuid[]) and publish_state = 'published'
      group by 1`),
    db.execute<{ sid: string; n: number }>(sql`
      select design_system_id as sid, count(*)::int as n from verification_evidence where design_system_id = any(${ids}::uuid[]) group by 1`),
  ]);

  const by = <R extends { sid: string }>(rs: R[]) => new Map(rs.map((r) => [r.sid, r]));
  const C = by(compAgg.rows);
  const D = by(depthAgg.rows);
  const T = by(tokAgg.rows);
  const S = by(setAgg.rows);
  const E = by(evAgg.rows);
  const COV = new Map<string, Record<string, Partial<Record<CoverageState, number>>>>();
  for (const r of covAgg.rows) {
    const m = COV.get(r.sid) ?? {};
    (m[r.field] ??= {})[r.state] = Number(r.n);
    COV.set(r.sid, m);
  }
  const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
  const numOrNull = (v: unknown) => (v === null || v === undefined ? null : Number(v));

  const entries = slugs.flatMap((slug): SystemCompareEntry[] => {
    const r = rows.find((x) => x.slug === slug);
    if (!r) return [];
    const c = C.get(r.id);
    const d = D.get(r.id);
    const t = T.get(r.id);
    const s = S.get(r.id);
    const metrics: SystemMetrics = {
      slug: r.slug,
      name: r.name,
      ingestionStatus: r.ingestion_status,
      frameworks: r.frameworks ?? [],
      repositoryUrl: r.repository_url,
      license: r.license_slug ? { slug: r.license_slug, name: r.license_name ?? r.license_slug, spdxId: r.spdx_id, isOpenSource: r.is_open_source } : null,
      packageCount: num(r.package_count),
      maintenanceStatus: r.maintenance_status,
      latestReleaseAt: iso(r.latest_release_at),
      latestVersion: r.latest_version,
      components: {
        total: num(c?.total),
        classified: num(c?.classified),
        classifiedVerified: num(c?.classified_verified),
        types: c?.types ?? [],
        coverage: COV.get(r.id) ?? {},
        avgDocumentedFields: numOrNull(d?.avg_doc),
        avgKnownFields: numOrNull(d?.avg_known),
        avgDepthRatio: numOrNull(d?.avg_ratio),
        fieldCount: COMPONENT_FIELDS.length,
      },
      tokens: {
        total: num(t?.total),
        primitive: num(t?.primitive),
        semantic: num(t?.semantic),
        component: num(t?.component),
        untiered: num(t?.untiered),
        tierVerified: num(t?.tier_verified),
        aliases: num(t?.aliases),
        aliasResolved: num(t?.alias_resolved),
        aliasExternal: num(t?.alias_external),
        aliasBroken: num(t?.alias_broken),
        layout: num(t?.layout),
        breakpointNamed: num(t?.breakpoint_named),
        sets: num(s?.sets),
        themedSets: num(s?.themed_sets),
        themes: s?.themes ?? [],
      },
      evidence: num(E.get(r.id)?.n),
    };
    return [
      {
        info: {
          slug: r.slug,
          name: r.name,
          organization: r.org,
          category: r.category,
          ingestionStatus: r.ingestion_status,
          docsUrl: r.docs_url,
          homepageUrl: r.homepage_url,
          lastIngestedAt: iso(r.last_ingested_at),
          summary: r.summary,
          license: r.spdx_id ?? r.license_name,
          maintenanceStatus: r.maintenance_status,
          latestVersion: r.latest_version,
        },
        metrics,
      },
    ];
  });
  return { entries, unknown, taxonomySize };
}

/** Systems with indexed component data, for "compare the indexed systems" shortcuts. */
export function indexedSystemSlugs(systems: SystemOption[], limit = 5): string[] {
  return systems
    .filter((s) => (s.ingestionStatus === "indexed" || s.ingestionStatus === "partial" || s.ingestionStatus === "inventory") && s.components > 0)
    .sort((a, b) => b.components - a.components)
    .slice(0, limit)
    .map((s) => s.slug);
}

export type { CriterionId };
