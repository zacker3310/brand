/**
 * Read models for the Token Explorer, the cross-system scale comparison and token set exports.
 * All counts are aggregated in SQL from published records; nothing is hard-coded.
 */
import { sql, type SQL } from "drizzle-orm";
import { TOKEN_CATEGORIES, type Redistribution, type TokenCategory } from "@/lib/contracts";
import { likePattern } from "@/components/tokens/lib/params";
import { readDb } from "./db";

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

export interface LicenseInfo {
  slug: string;
  name: string;
  spdxId: string | null;
  url: string | null;
  redistribution: Redistribution;
}

export interface TokenSystemOption {
  id: string;
  slug: string;
  name: string;
  tokenCount: number;
  setCount: number;
}

export interface TokenSystemDetail extends TokenSystemOption {
  docsUrl: string | null;
  homepageUrl: string | null;
  lastIngestedAt: string | null;
  license: LicenseInfo | null;
}

export interface TokenSetInfo {
  id: string;
  slug: string;
  name: string;
  theme: string | null;
  format: string;
  sourceUrl: string;
  packageName: string | null;
  packageVersion: string | null;
  redistribution: Redistribution;
  license: LicenseInfo | null;
  tokenCount: number;
  retrievedAt: string | null;
}

export type AliasStateKey = "literal" | "resolved" | "theme-dependent" | "external" | "unresolved" | "cycle";

export interface ScopeStats {
  /** Tokens per category (after q/state filters). */
  categories: Record<TokenCategory, number>;
  /** Alias state counts per category (after the q filter), plus "all". */
  states: Record<TokenCategory | "all", Record<AliasStateKey, number>>;
  total: number;
}

export interface TokenIndexRow {
  id: string;
  name: string;
  path: string[];
  setId: string;
  aliasState: string | null;
  tier: string | null;
  valueText: string | null;
  sortValue?: number | null;
}

export interface ChainEdge {
  fromId: string;
  ref: string;
  state: string;
  depth: number | null;
  targetId: string | null;
  targetName: string | null;
  targetSetSlug: string | null;
  targetTheme: string | null;
  targetValueText: string | null;
  targetResolved: unknown;
  targetAliasState: string | null;
}

export interface ExplorerToken {
  id: string;
  name: string;
  path: string[];
  cssVar: string | null;
  category: TokenCategory;
  type: string | null;
  tier: string | null;
  tierState: string;
  rawValue: unknown;
  resolvedValue: unknown;
  valueText: string | null;
  isAlias: boolean;
  aliasState: string | null;
  description: string | null;
  deprecated: boolean;
  location: string | null;
  setId: string;
  setSlug: string;
  setName: string;
  setTheme: string | null;
  /** First-hop references of this token. */
  refs: ChainEdge[];
}

/** Edges keyed by source token id (recursive upstream walk). */
export type EdgeMap = Map<string, ChainEdge[]>;

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

const uuidArray = (ids: readonly string[]) => sql`${sql.param([...ids])}::uuid[]`;
const num = (v: unknown) => Number(v ?? 0);

function licenseOf(r: { lic_slug: string | null; lic_name: string | null; lic_spdx: string | null; lic_url: string | null; lic_redist: string | null }): LicenseInfo | null {
  if (!r.lic_slug || !r.lic_name) return null;
  return { slug: r.lic_slug, name: r.lic_name, spdxId: r.lic_spdx, url: r.lic_url, redistribution: (r.lic_redist ?? "unknown") as Redistribution };
}

/** Theme-agnostic sets first (by name), then themed sets: light-ish, dark-ish, others; then slug. */
export function setSortKey(s: { theme: string | null; name: string; slug: string }): [number, number, string] {
  if (!s.theme) return [0, 0, s.name.toLowerCase()];
  const t = s.theme.toLowerCase();
  const rank = t.startsWith("light") || t === "white" ? 0 : t.startsWith("dark") ? 1 : 2;
  return [1, rank, `${t}\u0000${s.slug}`];
}

export function sortSets<T extends { theme: string | null; name: string; slug: string }>(sets: T[]): T[] {
  return [...sets].sort((a, b) => {
    const ka = setSortKey(a);
    const kb = setSortKey(b);
    return ka[0] - kb[0] || ka[1] - kb[1] || (ka[2] < kb[2] ? -1 : ka[2] > kb[2] ? 1 : 0);
  });
}

/* -------------------------------------------------------------------------- */
/* Systems & sets                                                              */
/* -------------------------------------------------------------------------- */

/** Systems that have published tokens, most tokens first. */
export async function listTokenSystems(): Promise<TokenSystemOption[]> {
  const db = await readDb();
  const r = await db.execute<{ id: string; slug: string; name: string; tokens: string; sets: string }>(sql`
    select ds.id, ds.slug, ds.name, count(t.id) as tokens, count(distinct ts.id) as sets
    from design_system ds
    join token_set ts on ts.design_system_id = ds.id and ts.publish_state = 'published'
    join token t on t.token_set_id = ts.id
    where ds.publish_state = 'published'
    group by ds.id
    having count(t.id) > 0
    order by count(t.id) desc, ds.name asc
  `);
  return r.rows.map((x) => ({ id: x.id, slug: x.slug, name: x.name, tokenCount: num(x.tokens), setCount: num(x.sets) }));
}

/** A published system (whether or not it has tokens). */
export async function getTokenSystem(slug: string): Promise<TokenSystemDetail | null> {
  const db = await readDb();
  const r = await db.execute<{
    id: string;
    slug: string;
    name: string;
    docs_url: string | null;
    homepage_url: string | null;
    last_ingested_at: string | null;
    tokens: string;
    sets: string;
    lic_slug: string | null;
    lic_name: string | null;
    lic_spdx: string | null;
    lic_url: string | null;
    lic_redist: string | null;
  }>(sql`
    select ds.id, ds.slug, ds.name, ds.docs_url, ds.homepage_url, ds.last_ingested_at::text as last_ingested_at,
      (select count(*) from token t join token_set ts on ts.id = t.token_set_id where ts.design_system_id = ds.id and ts.publish_state = 'published') as tokens,
      (select count(*) from token_set ts where ts.design_system_id = ds.id and ts.publish_state = 'published') as sets,
      l.slug as lic_slug, l.name as lic_name, l.spdx_id as lic_spdx, l.url as lic_url, l.redistribution::text as lic_redist
    from design_system ds left join license l on l.id = ds.license_id
    where ds.slug = ${slug} and ds.publish_state = 'published'
    limit 1
  `);
  const x = r.rows[0];
  if (!x) return null;
  return {
    id: x.id,
    slug: x.slug,
    name: x.name,
    docsUrl: x.docs_url,
    homepageUrl: x.homepage_url,
    lastIngestedAt: x.last_ingested_at,
    tokenCount: num(x.tokens),
    setCount: num(x.sets),
    license: licenseOf(x),
  };
}

/** Published token sets of a system with actual token counts and last retrieval time. */
export async function listTokenSets(systemId: string): Promise<TokenSetInfo[]> {
  const db = await readDb();
  const r = await db.execute<{
    id: string;
    slug: string;
    name: string;
    theme: string | null;
    format: string;
    source_url: string;
    package_name: string | null;
    package_version: string | null;
    redistribution: string;
    tokens: string;
    retrieved_at: string | null;
    lic_slug: string | null;
    lic_name: string | null;
    lic_spdx: string | null;
    lic_url: string | null;
    lic_redist: string | null;
  }>(sql`
    select ts.id, ts.slug, ts.name, ts.theme, ts.format, ts.source_url, ts.package_name, ts.package_version, ts.redistribution::text as redistribution,
      (select count(*) from token t where t.token_set_id = ts.id) as tokens,
      (select max(e.retrieved_at)::text from verification_evidence e where e.subject_type = 'token_set' and e.subject_id = ts.id) as retrieved_at,
      l.slug as lic_slug, l.name as lic_name, l.spdx_id as lic_spdx, l.url as lic_url, l.redistribution::text as lic_redist
    from token_set ts left join license l on l.id = ts.license_id
    where ts.design_system_id = ${systemId} and ts.publish_state = 'published'
  `);
  return sortSets(
    r.rows.map((x) => ({
      id: x.id,
      slug: x.slug,
      name: x.name,
      theme: x.theme,
      format: x.format,
      sourceUrl: x.source_url,
      packageName: x.package_name,
      packageVersion: x.package_version,
      redistribution: x.redistribution as Redistribution,
      license: licenseOf(x),
      tokenCount: num(x.tokens),
      retrievedAt: x.retrieved_at,
    })),
  );
}

/* -------------------------------------------------------------------------- */
/* Scope filters                                                               */
/* -------------------------------------------------------------------------- */

export interface Scope {
  systemId: string;
  setIds: string[];
}

function scopeWhere(scope: Scope, opts: { q?: string; state?: string; category?: TokenCategory }): SQL {
  const parts: SQL[] = [sql`t.design_system_id = ${scope.systemId}`, sql`t.token_set_id = any(${uuidArray(scope.setIds)})`];
  if (opts.category) parts.push(sql`t.category = ${opts.category}`);
  if (opts.q) {
    const p = likePattern(opts.q);
    parts.push(sql`(t.name ilike ${p} or t.css_var ilike ${p} or t.value_text ilike ${p})`);
  }
  if (opts.state) {
    parts.push(opts.state === "literal" ? sql`(t.alias_state is null or t.alias_state = 'literal')` : sql`t.alias_state = ${opts.state}`);
  }
  return sql.join(parts, sql` and `);
}

const emptyStates = (): Record<AliasStateKey, number> => ({ literal: 0, resolved: 0, "theme-dependent": 0, external: 0, unresolved: 0, cycle: 0 });

/** Category counts and alias-state counts for the scope, in one aggregate. */
export async function getScopeStats(scope: Scope, opts: { q?: string; state?: string }): Promise<ScopeStats> {
  const db = await readDb();
  const categories = Object.fromEntries(TOKEN_CATEGORIES.map((c) => [c, 0])) as Record<TokenCategory, number>;
  const states = Object.fromEntries([...TOKEN_CATEGORIES, "all"].map((c) => [c, emptyStates()])) as ScopeStats["states"];
  if (!scope.setIds.length) return { categories, states, total: 0 };
  const r = await db.execute<{ category: TokenCategory; state: string; n: string }>(sql`
    select t.category::text as category, coalesce(nullif(t.alias_state, ''), 'literal') as state, count(*) as n
    from token t where ${scopeWhere(scope, { q: opts.q })}
    group by 1, 2
  `);
  let total = 0;
  for (const row of r.rows) {
    const n = num(row.n);
    const st = (row.state in states.all ? row.state : "unresolved") as AliasStateKey;
    states[row.category][st] += n;
    states.all[st] += n;
    if (!opts.state || opts.state === st) {
      categories[row.category] += n;
      total += n;
    }
  }
  return { categories, states, total };
}

/** Lightweight rows for grouping/sorting a category in scope (bounded by set size; never sent to the client). */
export async function getTokenIndex(scope: Scope, category: TokenCategory | null, opts: { q?: string; state?: string }): Promise<TokenIndexRow[]> {
  if (!scope.setIds.length) return [];
  const db = await readDb();
  const r = await db.execute<{ id: string; name: string; path: string[]; token_set_id: string; alias_state: string | null; tier: string | null; value_text: string | null }>(sql`
    select t.id, t.name, t.path, t.token_set_id, t.alias_state, t.tier::text as tier, left(t.value_text, 64) as value_text
    from token t where ${scopeWhere(scope, { ...opts, category: category ?? undefined })}
  `);
  return r.rows.map((x) => ({ id: x.id, name: x.name, path: x.path ?? [], setId: x.token_set_id, aliasState: x.alias_state, tier: x.tier, valueText: x.value_text }));
}

/* -------------------------------------------------------------------------- */
/* Full token rows + alias chains                                              */
/* -------------------------------------------------------------------------- */

type TokenRowRaw = {
  id: string;
  name: string;
  path: string[];
  css_var: string | null;
  category: TokenCategory;
  type: string | null;
  tier: string | null;
  tier_state: string;
  raw_value: unknown;
  resolved_value: unknown;
  value_text: string | null;
  is_alias: boolean;
  alias_state: string | null;
  description: string | null;
  deprecated: boolean;
  location: string | null;
  token_set_id: string;
  set_slug: string;
  set_name: string;
  set_theme: string | null;
};

const TOKEN_COLUMNS = sql`t.id, t.name, t.path, t.css_var, t.category::text as category, t.type, t.tier::text as tier, t.tier_state::text as tier_state,
  t.raw_value, t.resolved_value, t.value_text, t.is_alias, t.alias_state, t.description, t.deprecated, t.location, t.token_set_id,
  s.slug as set_slug, s.name as set_name, s.theme as set_theme`;

function toToken(x: TokenRowRaw, edges: EdgeMap): ExplorerToken {
  return {
    id: x.id,
    name: x.name,
    path: x.path ?? [],
    cssVar: x.css_var,
    category: x.category,
    type: x.type,
    tier: x.tier,
    tierState: x.tier_state,
    rawValue: x.raw_value,
    resolvedValue: x.resolved_value,
    valueText: x.value_text,
    isAlias: x.is_alias,
    aliasState: x.alias_state,
    description: x.description,
    deprecated: x.deprecated,
    location: x.location,
    setId: x.token_set_id,
    setSlug: x.set_slug,
    setName: x.set_name,
    setTheme: x.set_theme,
    refs: edges.get(x.id) ?? [],
  };
}

/** Upstream alias edges reachable from the given tokens (depth-limited, cycle-safe), in one recursive query. */
export async function getAliasEdges(ids: readonly string[], maxHops = 8): Promise<EdgeMap> {
  const map: EdgeMap = new Map();
  if (!ids.length) return map;
  const db = await readDb();
  const r = await db.execute<{
    from_id: string;
    target_ref: string;
    state: string;
    depth: number | null;
    target_id: string | null;
    target_name: string | null;
    target_set: string | null;
    target_theme: string | null;
    target_value_text: string | null;
    target_resolved: unknown;
    target_alias_state: string | null;
  }>(sql`
    with recursive edges(from_id, target_ref, state, depth, target_id, lvl, trail) as (
      select a.token_id, a.target_ref, a.state, a.depth, a.target_token_id, 1, array[a.token_id]
      from token_alias a where a.token_id = any(${uuidArray(ids)})
      union all
      select a.token_id, a.target_ref, a.state, a.depth, a.target_token_id, e.lvl + 1, e.trail || a.token_id
      from edges e join token_alias a on a.token_id = e.target_id
      where e.lvl < ${maxHops} and not (a.token_id = any(e.trail))
    )
    select distinct on (e.from_id, e.target_ref) e.from_id, e.target_ref, e.state, e.depth, e.target_id,
      t.name as target_name, s.slug as target_set, s.theme as target_theme, t.value_text as target_value_text,
      t.resolved_value as target_resolved, t.alias_state as target_alias_state
    from edges e left join token t on t.id = e.target_id left join token_set s on s.id = t.token_set_id
    order by e.from_id, e.target_ref
  `);
  for (const x of r.rows) {
    const arr = map.get(x.from_id) ?? [];
    arr.push({
      fromId: x.from_id,
      ref: x.target_ref,
      state: x.state,
      depth: x.depth,
      targetId: x.target_id,
      targetName: x.target_name,
      targetSetSlug: x.target_set,
      targetTheme: x.target_theme,
      targetValueText: x.target_value_text,
      targetResolved: x.target_resolved,
      targetAliasState: x.target_alias_state,
    });
    map.set(x.from_id, arr);
  }
  return map;
}

/** Full rows for a page of tokens (order preserved) plus the upstream edge map. */
export async function getTokensByIds(ids: readonly string[]): Promise<{ tokens: ExplorerToken[]; edges: EdgeMap }> {
  if (!ids.length) return { tokens: [], edges: new Map() };
  const db = await readDb();
  const [rows, edges] = await Promise.all([
    db.execute<TokenRowRaw>(sql`select ${TOKEN_COLUMNS} from token t join token_set s on s.id = t.token_set_id where t.id = any(${uuidArray(ids)})`),
    getAliasEdges(ids),
  ]);
  const byId = new Map(rows.rows.map((x) => [x.id, toToken(x, edges)]));
  return { tokens: ids.map((id) => byId.get(id)).filter((t): t is ExplorerToken => !!t), edges };
}

/** Follow the first reference repeatedly: [first hop, second hop, ...] (stops at cycles, branches or literals). */
export function linearChain(tokenId: string, edges: EdgeMap, maxHops = 8): ChainEdge[] {
  const out: ChainEdge[] = [];
  const seen = new Set<string>([tokenId]);
  let cur = tokenId;
  for (let i = 0; i < maxHops; i++) {
    const es = edges.get(cur);
    if (!es || es.length !== 1) break;
    const e = es[0]!;
    out.push(e);
    if (!e.targetId || seen.has(e.targetId) || e.state === "theme-dependent") break;
    seen.add(e.targetId);
    cur = e.targetId;
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Inspector                                                                   */
/* -------------------------------------------------------------------------- */

export interface InspectorDependent {
  id: string;
  name: string;
  setSlug: string;
  state: string;
}

export interface InspectorUsage {
  componentSlug: string;
  componentName: string;
  systemSlug: string;
  property: string | null;
}

export interface InspectorData {
  token: ExplorerToken;
  system: { slug: string; name: string };
  set: Pick<TokenSetInfo, "slug" | "name" | "theme" | "format" | "sourceUrl" | "packageName" | "packageVersion" | "redistribution">;
  /** Upstream edges (all hops) for rendering the reference tree. */
  edges: ChainEdge[];
  /** Theme names of sets in this system, keyed by set slug (for theme-dependent values). */
  setThemes: Record<string, { name: string; theme: string | null }>;
  dependents: { total: number; direct: number; viaTheme: number; items: InspectorDependent[] };
  usages: { total: number; items: InspectorUsage[] };
  /** Best source URL for the token's location (matching evidence file), else the set source. */
  sourceUrl: string;
}

export async function getTokenInspector(id: string): Promise<InspectorData | null> {
  const db = await readDb();
  const base = await db.execute<TokenRowRaw & { system_slug: string; system_name: string; design_system_id: string; set_format: string; set_source: string; set_pkg: string | null; set_ver: string | null; set_redist: string }>(sql`
    select ${TOKEN_COLUMNS}, ds.slug as system_slug, ds.name as system_name, t.design_system_id,
      s.format as set_format, s.source_url as set_source, s.package_name as set_pkg, s.package_version as set_ver, s.redistribution::text as set_redist
    from token t join token_set s on s.id = t.token_set_id join design_system ds on ds.id = t.design_system_id
    where t.id = ${id} and s.publish_state = 'published' and ds.publish_state = 'published'
    limit 1
  `);
  const x = base.rows[0];
  if (!x) return null;
  const location = x.location?.split("#")[0] ?? null;
  const [edges, deps, usages, sets, src] = await Promise.all([
    getAliasEdges([id]),
    db.execute<{ id: string; name: string; set_slug: string; state: string; total: string; direct: string; via_theme: string }>(sql`
      with siblings as (
        select t2.id from token t2 where t2.design_system_id = ${x.design_system_id} and t2.name = ${x.name}
      ), d as (
        select a.token_id, a.state from token_alias a
        where a.target_token_id = ${id}
           or (a.state = 'theme-dependent' and a.target_token_id in (select id from siblings))
      )
      select t.id, t.name, s.slug as set_slug, d.state,
        count(*) over () as total,
        count(*) filter (where d.state <> 'theme-dependent') over () as direct,
        count(*) filter (where d.state = 'theme-dependent') over () as via_theme
      from d join token t on t.id = d.token_id join token_set s on s.id = t.token_set_id
      order by t.name, s.slug
      limit 40
    `),
    db.execute<{ slug: string; name: string; system_slug: string; property: string | null; total: string }>(sql`
      select c.slug, c.name, ds.slug as system_slug, u.property, count(*) over () as total
      from token_usage u join component c on c.id = u.component_id join design_system ds on ds.id = c.design_system_id
      where u.token_id = ${id} and c.publish_state = 'published'
      order by c.name, u.property nulls last
      limit 30
    `),
    db.execute<{ slug: string; name: string; theme: string | null }>(sql`
      select slug, name, theme from token_set where design_system_id = ${x.design_system_id} and publish_state = 'published'
    `),
    location
      ? db.execute<{ source_url: string }>(sql`
          select e.source_url from verification_evidence e
          where e.subject_type = 'token_set' and e.subject_id = ${x.token_set_id} and e.location = ${location}
          order by e.retrieved_at desc limit 1
        `)
      : Promise.resolve({ rows: [] as { source_url: string }[] }),
  ]);
  const d0 = deps.rows[0];
  const u0 = usages.rows[0];
  const all: ChainEdge[] = [];
  for (const es of edges.values()) all.push(...es);
  return {
    token: toToken(x, edges),
    system: { slug: x.system_slug, name: x.system_name },
    set: {
      slug: x.set_slug,
      name: x.set_name,
      theme: x.set_theme,
      format: x.set_format,
      sourceUrl: x.set_source,
      packageName: x.set_pkg,
      packageVersion: x.set_ver,
      redistribution: x.set_redist as Redistribution,
    },
    edges: all,
    setThemes: Object.fromEntries(sets.rows.map((s) => [s.slug, { name: s.name, theme: s.theme }])),
    dependents: {
      total: d0 ? num(d0.total) : 0,
      direct: d0 ? num(d0.direct) : 0,
      viaTheme: d0 ? num(d0.via_theme) : 0,
      items: deps.rows.map((d) => ({ id: d.id, name: d.name, setSlug: d.set_slug, state: d.state })),
    },
    usages: {
      total: u0 ? num(u0.total) : 0,
      items: usages.rows.map((u) => ({ componentSlug: u.slug, componentName: u.name, systemSlug: u.system_slug, property: u.property })),
    },
    sourceUrl: src.rows[0]?.source_url ?? x.set_source,
  };
}

/** Token id by exact name inside the scope (deep links like /tokens?system=x&q=<name>). */
export async function findTokenIdByName(scope: Scope, name: string): Promise<string | null> {
  if (!scope.setIds.length || !name) return null;
  const db = await readDb();
  const r = await db.execute<{ id: string }>(sql`
    select t.id from token t where t.design_system_id = ${scope.systemId} and t.token_set_id = any(${uuidArray(scope.setIds)}) and t.name = ${name}
    order by t.token_set_id limit 1
  `);
  return r.rows[0]?.id ?? null;
}

/* -------------------------------------------------------------------------- */
/* Theme comparison                                                            */
/* -------------------------------------------------------------------------- */

export interface ThemeCompareRow {
  name: string;
  /** "paired": same name in both themed sets; "theme-dependent": one token resolving per themed set. */
  kind: "paired" | "theme-dependent";
  aId: string;
  bId: string;
  setSlug: string;
  aValue: unknown;
  bValue: unknown;
  aText: string | null;
  bText: string | null;
  differs: boolean;
}

export async function getThemeComparison(
  systemId: string,
  a: { id: string; slug: string },
  b: { id: string; slug: string },
  opts: { q?: string; page: number; pageSize: number },
): Promise<{ rows: ThemeCompareRow[]; total: number; differing: number }> {
  const db = await readDb();
  const qa = opts.q ? sql`and ta.name ilike ${likePattern(opts.q)}` : sql``;
  const qt = opts.q ? sql`and t.name ilike ${likePattern(opts.q)}` : sql``;
  const r = await db.execute<{
    name: string;
    kind: "paired" | "theme-dependent";
    a_id: string;
    b_id: string;
    set_slug: string;
    a_value: unknown;
    b_value: unknown;
    a_text: string | null;
    b_text: string | null;
    differs: boolean;
    total: string;
    differing: string;
  }>(sql`
    with rows as (
      select ta.name, 'paired' as kind, ta.id as a_id, tb.id as b_id, ${a.slug}::text as set_slug,
        coalesce(ta.resolved_value, ta.raw_value) as a_value, coalesce(tb.resolved_value, tb.raw_value) as b_value,
        ta.value_text as a_text, tb.value_text as b_text
      from token ta join token tb on tb.token_set_id = ${b.id} and tb.name = ta.name and tb.category = 'color'
      where ta.token_set_id = ${a.id} and ta.category = 'color' ${qa}
      union all
      select t.name, 'theme-dependent', t.id, t.id, s.slug,
        t.resolved_value -> '$themes' -> ${a.slug}, t.resolved_value -> '$themes' -> ${b.slug}, null, null
      from token t join token_set s on s.id = t.token_set_id
      where t.design_system_id = ${systemId} and s.publish_state = 'published' and t.category = 'color' and t.alias_state = 'theme-dependent'
        and (t.resolved_value -> '$themes') ? ${a.slug} and (t.resolved_value -> '$themes') ? ${b.slug} ${qt}
    )
    select *, (a_value is distinct from b_value) as differs, count(*) over () as total,
      count(*) filter (where a_value is distinct from b_value) over () as differing
    from rows
    order by kind, name
    limit ${opts.pageSize} offset ${(opts.page - 1) * opts.pageSize}
  `);
  const f = r.rows[0];
  let total = f ? num(f.total) : 0;
  let differing = f ? num(f.differing) : 0;
  if (!f && opts.page > 1) {
    const c = await getThemeComparison(systemId, a, b, { ...opts, page: 1, pageSize: 1 });
    total = c.total;
    differing = c.differing;
  }
  return {
    rows: r.rows.map((x) => ({
      name: x.name,
      kind: x.kind,
      aId: x.a_id,
      bId: x.b_id,
      setSlug: x.set_slug,
      aValue: x.a_value,
      bValue: x.b_value,
      aText: x.a_text,
      bText: x.b_text,
      differs: x.differs,
    })),
    total,
    differing,
  };
}

/* -------------------------------------------------------------------------- */
/* Contrast                                                                    */
/* -------------------------------------------------------------------------- */

export interface ColorCandidate {
  id: string;
  name: string;
  setSlug: string;
  setTheme: string | null;
  rawValue: unknown;
  resolvedValue: unknown;
  aliasState: string | null;
}

/** Color tokens in scope with their stored values (for contrast pairing). */
export async function getColorCandidates(scope: Scope, opts: { names?: string[] } = {}): Promise<ColorCandidate[]> {
  if (!scope.setIds.length) return [];
  const db = await readDb();
  const byName = opts.names?.length ? sql`and t.name = any(${sql.param(opts.names)}::text[])` : sql``;
  const r = await db.execute<{ id: string; name: string; set_slug: string; set_theme: string | null; raw_value: unknown; resolved_value: unknown; alias_state: string | null }>(sql`
    select t.id, t.name, s.slug as set_slug, s.theme as set_theme, t.raw_value, t.resolved_value, t.alias_state
    from token t join token_set s on s.id = t.token_set_id
    where t.design_system_id = ${scope.systemId} and t.token_set_id = any(${uuidArray(scope.setIds)}) and t.category = 'color' ${byName}
  `);
  return r.rows.map((x) => ({ id: x.id, name: x.name, setSlug: x.set_slug, setTheme: x.set_theme, rawValue: x.raw_value, resolvedValue: x.resolved_value, aliasState: x.alias_state }));
}

/* -------------------------------------------------------------------------- */
/* Cross-system scale comparison                                               */
/* -------------------------------------------------------------------------- */

export interface ScaleSourceToken {
  name: string;
  type: string | null;
  category: TokenCategory;
  tier: string | null;
  rawValue: unknown;
  resolvedValue: unknown;
  aliasState: string | null;
}

export async function getScaleTokens(
  systemIds: readonly string[],
  categories: readonly TokenCategory[],
  opts: { includeComponentTier: boolean },
): Promise<Map<string, ScaleSourceToken[]>> {
  const out = new Map<string, ScaleSourceToken[]>(systemIds.map((s) => [s, []]));
  if (!systemIds.length) return out;
  const db = await readDb();
  const tier = opts.includeComponentTier ? sql`` : sql`and (t.tier is null or t.tier <> 'component')`;
  const r = await db.execute<{ design_system_id: string; name: string; type: string | null; category: TokenCategory; tier: string | null; raw_value: unknown; resolved_value: unknown; alias_state: string | null }>(sql`
    select t.design_system_id, t.name, t.type, t.category::text as category, t.tier::text as tier, t.raw_value, t.resolved_value, t.alias_state
    from token t join token_set s on s.id = t.token_set_id
    where t.design_system_id = any(${uuidArray(systemIds)}) and s.publish_state = 'published'
      and t.category = any(${sql.param([...categories])}::token_category[]) ${tier}
  `);
  for (const x of r.rows) {
    out.get(x.design_system_id)?.push({ name: x.name, type: x.type, category: x.category, tier: x.tier, rawValue: x.raw_value, resolvedValue: x.resolved_value, aliasState: x.alias_state });
  }
  return out;
}

/** Published systems by slug, preserving the requested order. */
export async function getSystemsBySlugs(slugs: readonly string[]): Promise<{ id: string; slug: string; name: string; docsUrl: string | null }[]> {
  if (!slugs.length) return [];
  const db = await readDb();
  const r = await db.execute<{ id: string; slug: string; name: string; docs_url: string | null }>(sql`
    select id, slug, name, docs_url from design_system where slug = any(${sql.param([...slugs])}::text[]) and publish_state = 'published'
  `);
  const by = new Map(r.rows.map((x) => [x.slug, { id: x.id, slug: x.slug, name: x.name, docsUrl: x.docs_url }]));
  return slugs.map((s) => by.get(s)).filter((x): x is NonNullable<typeof x> => !!x);
}

/* -------------------------------------------------------------------------- */
/* Export                                                                      */
/* -------------------------------------------------------------------------- */

export interface ExportPayload {
  system: { slug: string; name: string };
  set: TokenSetInfo;
  tokens: {
    name: string;
    path: string[];
    cssVar: string | null;
    type: string | null;
    category: string;
    tier: string | null;
    tierState: string;
    rawValue: unknown;
    resolvedValue: unknown;
    valueText: string | null;
    aliasState: string | null;
    description: string | null;
    deprecated: boolean;
    location: string | null;
  }[];
}

/** Set metadata for an export decision (no token rows). */
export async function getExportSet(systemSlug: string, setSlug: string): Promise<{ system: { id: string; slug: string; name: string }; set: TokenSetInfo } | null> {
  const db = await readDb();
  const r = await db.execute<{ id: string; slug: string; name: string }>(sql`
    select id, slug, name from design_system where slug = ${systemSlug} and publish_state = 'published' limit 1
  `);
  const sys = r.rows[0];
  if (!sys) return null;
  const sets = await listTokenSets(sys.id);
  const set = sets.find((s) => s.slug === setSlug);
  return set ? { system: sys, set } : null;
}

export async function getExportTokens(setId: string): Promise<ExportPayload["tokens"]> {
  const db = await readDb();
  const r = await db.execute<TokenRowRaw>(sql`select ${TOKEN_COLUMNS} from token t join token_set s on s.id = t.token_set_id where t.token_set_id = ${setId} order by t.name`);
  return r.rows.map((x) => ({
    name: x.name,
    path: x.path ?? [],
    cssVar: x.css_var,
    type: x.type,
    category: x.category,
    tier: x.tier,
    tierState: x.tier_state,
    rawValue: x.raw_value,
    resolvedValue: x.resolved_value,
    valueText: x.value_text,
    aliasState: x.alias_state,
    description: x.description,
    deprecated: x.deprecated,
    location: x.location,
  }));
}
