/**
 * Read models behind the public REST API (/api/systems, /api/components, /api/tokens, ...).
 *
 * Every function is one or two SQL statements (aggregates and child lists are correlated
 * subqueries over indexed foreign keys, bounded by the page), returns plain JSON-serializable DTOs
 * and never invents values: unknown stays null and coverage maps are passed through verbatim.
 * The same functions back the live examples on /api-docs.
 */
import { sql, type SQL } from "drizzle-orm";
import type { DB } from "@/db/client";
import { SYSTEM_CATEGORY_LABELS, isThemeDependentValue, type CoverageMap, type SystemCategory } from "@/lib/contracts";
import { componentTypeUrl, componentUrl, patternUrl, systemUrl, tokenUrl } from "@/server/search/documents";
import { readDb } from "@/server/queries/db";
import { containsPattern, iso, num, whereAll } from "./sql";

export interface Page {
  page: number;
  pageSize: number;
}
export interface PageResult<T> {
  data: T[];
  total: number;
}

const db_ = async (db?: DB) => db ?? (await readDb());
const offset = (p: Page) => (p.page - 1) * p.pageSize;

/* -------------------------------------------------------------------------- */
/* DTOs                                                                         */
/* -------------------------------------------------------------------------- */

export interface ApiLicense {
  slug: string;
  name: string;
  spdxId: string | null;
  url: string | null;
  isOpenSource: boolean | null;
  redistribution: string;
}

export interface ApiSystem {
  id: string;
  slug: string;
  name: string;
  aliases: string[];
  category: string;
  categoryLabel: string;
  summary: string | null;
  organization: { slug: string; name: string } | null;
  urls: { atlas: string; homepage: string | null; docs: string | null; repository: string | null; figma: string | null; storybook: string | null };
  license: ApiLicense | null;
  maintenanceStatus: string;
  docAccess: string;
  latestVersion: string | null;
  latestReleaseAt: string | null;
  registry: { status: string; rank: number | null; confidence: number; lastVerifiedAt: string | null; duplicateOf: string | null; replacedBy: string | null; replaces: string | null };
  ingestion: { status: string; lastIngestedAt: string | null };
  frameworks: { slug: string; name: string; support: string; packageName: string | null; verificationState: string }[];
  platforms: { slug: string; name: string; verificationState: string }[];
  tags: { slug: string; verificationState: string }[];
  counts: { components: number; tokens: number; tokenSets: number; patterns: number; evidence: number };
}

export interface ApiEvidence {
  field: string;
  sourceUrl: string;
  sourceTitle: string | null;
  retrievedAt: string | null;
  contentHash: string | null;
  extractionMethod: string;
  location: string | null;
  excerpt: string | null;
  state: string;
  confidence: number;
}

export interface ApiSystemDetail extends ApiSystem {
  philosophy: string | null;
  principles: { name: string; sourceUrl: string }[] | null;
  packages: { name: string; registry: string; url: string }[];
  registryNotes: string | null;
  coverage: Record<string, unknown> | null;
  sources: { kind: string; url: string; label: string | null; isOfficial: boolean; lastStatus: number | null; lastCheckedAt: string | null }[];
  evidence: ApiEvidence[];
}

export interface ApiComponent {
  id: string;
  slug: string;
  name: string;
  aliases: string[];
  system: { slug: string; name: string };
  type: { slug: string; name: string; group: string | null } | null;
  classification: { state: string; method: string | null };
  lifecycle: string;
  description: string | null;
  urls: { atlas: string; docs: string | null; sourceCode: string | null };
  frameworks: string[];
  counts: { variants: number; states: number; properties: number; examples: number };
  coverage: CoverageMap;
  confidence: number;
  lastChangedAt: string | null;
}

export interface ApiComponentDetail extends ApiComponent {
  publishState: string;
  sizes: string[] | null;
  responsiveGuidance: string | null;
  license: ApiLicense | null;
  frameworkDetails: { slug: string; name: string; packageName: string | null; importName: string | null; sourceUrl: string | null }[];
  variants: { axis: string; slug: string; name: string; description: string | null; sourceUrl: string | null }[];
  states: { slug: string; name: string; canonicalState: string | null; description: string | null; sourceUrl: string | null }[];
  properties: { implementation: string; name: string; type: string | null; defaultValue: string | null; required: boolean | null; deprecated: boolean; description: string | null; allowedValues: string[] | null; sourceUrl: string | null }[];
  accessibility: {
    ariaPattern: string | null;
    roles: string[] | null;
    keyboard: { keys: string; action: string }[] | null;
    guidance: string | null;
    screenReader: string | null;
    focusManagement: string | null;
    wcagCriteria: string[] | null;
    docsUrl: string | null;
    coverage: CoverageMap;
  } | null;
  examples: { slug: string; title: string; kind: string; language: string | null; code: string | null; url: string | null; attribution: string | null }[];
  relationships: { kind: string; target: { kind: "component"; slug: string; name: string } | { kind: "component-type"; slug: string; name: string } | null; verificationState: string; sourceUrl: string | null }[];
  tokenUsages: { tokenName: string; property: string | null }[];
  tokenUsageTotal: number;
  evidence: ApiEvidence[];
}

export interface ApiComponentType {
  id: string;
  slug: string;
  name: string;
  group: { slug: string; name: string };
  description: string;
  aliases: string[];
  nearSynonyms: string[];
  ariaPattern: string | null;
  urls: { atlas: string };
  counts: { implementations: number; systems: number };
}

export interface ApiTokenSetRef {
  slug: string;
  name: string;
  theme: string | null;
  format: string;
  sourceUrl: string;
  packageName: string | null;
  packageVersion: string | null;
  license: ApiLicense | null;
  redistribution: string;
}

export interface ApiToken {
  id: string;
  name: string;
  path: string[];
  cssVar: string | null;
  category: string;
  type: string | null;
  tier: string | null;
  tierState: string;
  system: { slug: string; name: string };
  set: ApiTokenSetRef;
  /** Values are included only when the set's redistribution is "permitted". */
  valueWithheld: boolean;
  rawValue: unknown;
  resolvedValue: unknown;
  valueText: string | null;
  isAlias: boolean;
  aliasState: string | null;
  themes: string[] | null;
  description: string | null;
  deprecated: boolean;
  urls: { atlas: string };
}

export interface ApiPattern {
  id: string;
  slug: string;
  name: string;
  system: { slug: string; name: string };
  type: { slug: string; name: string } | null;
  classificationState: string;
  description: string | null;
  urls: { atlas: string; docs: string | null };
  componentCount: number;
  coverage: CoverageMap;
}

/* -------------------------------------------------------------------------- */
/* Systems                                                                      */
/* -------------------------------------------------------------------------- */

export interface SystemFilters extends Page {
  category?: SystemCategory;
  framework?: string;
  platform?: string;
  q?: string;
  registry: "verified" | "all";
}

const EXCLUDED = sql.raw(`('unavailable','conflicting')`);

const SYSTEM_SELECT = sql`
  b.id, b.slug, b.name, b.aliases, b.category::text as category, b.summary, b.homepage_url, b.docs_url, b.repository_url, b.figma_url, b.storybook_url,
  b.maintenance_status::text as maintenance_status, b.doc_access::text as doc_access, b.latest_version, b.latest_release_at,
  b.registry_status::text as registry_status, b.registry_rank, b.confidence, b.last_verified_at, b.duplicate_of_slug, b.replaced_by_slug, b.replaces_slug,
  b.ingestion_status::text as ingestion_status, b.last_ingested_at,
  o.slug as org_slug, o.name as org_name,
  l.slug as lic_slug, l.name as lic_name, l.spdx_id as lic_spdx, l.url as lic_url, l.is_open_source as lic_oss, l.redistribution::text as lic_redistribution,
  (select count(*) from component c where c.design_system_id = b.id and c.publish_state = 'published')::int as n_components,
  (select count(*) from token t join token_set s on s.id = t.token_set_id where t.design_system_id = b.id and s.publish_state = 'published')::int as n_tokens,
  (select count(*) from token_set s where s.design_system_id = b.id and s.publish_state = 'published')::int as n_token_sets,
  (select count(*) from design_pattern p where p.design_system_id = b.id and p.publish_state = 'published')::int as n_patterns,
  (select count(*) from verification_evidence e where e.design_system_id = b.id)::int as n_evidence,
  (select coalesce(jsonb_agg(jsonb_build_object('slug', f.slug, 'name', f.name, 'support', x.support, 'packageName', x.package_name, 'verificationState', x.verification_state) order by f.name), '[]'::jsonb)
     from design_system_framework x join framework f on f.id = x.framework_id where x.design_system_id = b.id) as frameworks,
  (select coalesce(jsonb_agg(jsonb_build_object('slug', p.slug, 'name', p.name, 'verificationState', x.verification_state) order by p.name), '[]'::jsonb)
     from design_system_platform x join platform p on p.id = x.platform_id where x.design_system_id = b.id) as platforms,
  (select coalesce(jsonb_agg(jsonb_build_object('slug', t.slug, 'verificationState', x.verification_state) order by t.slug), '[]'::jsonb)
     from design_system_tag x join tag t on t.id = x.tag_id where x.design_system_id = b.id) as tags
`;

type Row = Record<string, unknown>;

function license(r: Row, p = "lic_"): ApiLicense | null {
  if (!r[`${p}slug`]) return null;
  return {
    slug: String(r[`${p}slug`]),
    name: String(r[`${p}name`]),
    spdxId: (r[`${p}spdx`] as string | null) ?? null,
    url: (r[`${p}url`] as string | null) ?? null,
    isOpenSource: (r[`${p}oss`] as boolean | null) ?? null,
    redistribution: String(r[`${p}redistribution`] ?? "unknown"),
  };
}

function toApiSystem(r: Row): ApiSystem {
  const slug = String(r.slug);
  return {
    id: String(r.id),
    slug,
    name: String(r.name),
    aliases: (r.aliases as string[]) ?? [],
    category: String(r.category),
    categoryLabel: SYSTEM_CATEGORY_LABELS[r.category as SystemCategory] ?? String(r.category),
    summary: (r.summary as string | null) ?? null,
    organization: r.org_slug ? { slug: String(r.org_slug), name: String(r.org_name) } : null,
    urls: {
      atlas: systemUrl(slug),
      homepage: (r.homepage_url as string | null) ?? null,
      docs: (r.docs_url as string | null) ?? null,
      repository: (r.repository_url as string | null) ?? null,
      figma: (r.figma_url as string | null) ?? null,
      storybook: (r.storybook_url as string | null) ?? null,
    },
    license: license(r),
    maintenanceStatus: String(r.maintenance_status),
    docAccess: String(r.doc_access),
    latestVersion: (r.latest_version as string | null) ?? null,
    latestReleaseAt: iso(r.latest_release_at as Date | null),
    registry: {
      status: String(r.registry_status),
      rank: (r.registry_rank as number | null) ?? null,
      confidence: num(r.confidence),
      lastVerifiedAt: iso(r.last_verified_at as Date | null),
      duplicateOf: (r.duplicate_of_slug as string | null) ?? null,
      replacedBy: (r.replaced_by_slug as string | null) ?? null,
      replaces: (r.replaces_slug as string | null) ?? null,
    },
    ingestion: { status: String(r.ingestion_status), lastIngestedAt: iso(r.last_ingested_at as Date | null) },
    frameworks: (r.frameworks as ApiSystem["frameworks"]) ?? [],
    platforms: (r.platforms as ApiSystem["platforms"]) ?? [],
    tags: (r.tags as ApiSystem["tags"]) ?? [],
    counts: { components: num(r.n_components), tokens: num(r.n_tokens), tokenSets: num(r.n_token_sets), patterns: num(r.n_patterns), evidence: num(r.n_evidence) },
  };
}

function systemConds(f: Omit<SystemFilters, "page" | "pageSize">): SQL[] {
  const conds: SQL[] = [];
  if (f.registry === "verified") conds.push(sql`ds.registry_status = 'verified' and ds.publish_state = 'published'`);
  if (f.category) conds.push(sql`ds.category = ${f.category}`);
  if (f.framework)
    conds.push(sql`exists (select 1 from design_system_framework x join framework fw on fw.id = x.framework_id where x.design_system_id = ds.id and fw.slug = ${f.framework} and x.verification_state not in ${EXCLUDED})`);
  if (f.platform)
    conds.push(sql`exists (select 1 from design_system_platform x join platform pl on pl.id = x.platform_id where x.design_system_id = ds.id and pl.slug = ${f.platform} and x.verification_state not in ${EXCLUDED})`);
  if (f.q) {
    const p = containsPattern(f.q);
    conds.push(sql`(ds.name ilike ${p} or ds.slug ilike ${p} or array_to_string(ds.aliases, ' ') ilike ${p} or ds.summary ilike ${p})`);
  }
  return conds;
}

export async function listSystems(f: SystemFilters, db?: DB): Promise<PageResult<ApiSystem>> {
  const d = await db_(db);
  const res = await d.execute<Row>(sql`
    with base as (
      select ds.*, count(*) over() as total from design_system ds
      ${whereAll(systemConds(f))}
      order by lower(ds.name), ds.slug
      limit ${f.pageSize} offset ${offset(f)}
    )
    select ${SYSTEM_SELECT}, b.total from base b
    left join organization o on o.id = b.organization_id
    left join license l on l.id = b.license_id
    order by lower(b.name), b.slug
  `);
  const total = res.rows.length ? num(res.rows[0]!.total) : await countSystems(f, d);
  return { data: res.rows.map(toApiSystem), total };
}

async function countSystems(f: Omit<SystemFilters, "page" | "pageSize">, d: DB): Promise<number> {
  const r = await d.execute<{ n: number }>(sql`select count(*)::int as n from design_system ds ${whereAll(systemConds(f))}`);
  return num(r.rows[0]?.n);
}

const EVIDENCE_SELECT = sql`field, source_url, source_title, retrieved_at, content_hash, extraction_method, location, excerpt, state::text as state, confidence`;

function toEvidence(r: Row): ApiEvidence {
  return {
    field: String(r.field),
    sourceUrl: String(r.source_url),
    sourceTitle: (r.source_title as string | null) ?? null,
    retrievedAt: iso(r.retrieved_at as Date | null),
    contentHash: (r.content_hash as string | null) ?? null,
    extractionMethod: String(r.extraction_method),
    location: (r.location as string | null) ?? null,
    excerpt: (r.excerpt as string | null) ?? null,
    state: String(r.state),
    confidence: num(r.confidence),
  };
}

export async function getSystem(slug: string, db?: DB): Promise<ApiSystemDetail | null> {
  const d = await db_(db);
  const res = await d.execute<Row>(sql`
    select ${SYSTEM_SELECT}, b.philosophy, b.principles, b.packages, b.registry_notes, b.coverage
    from design_system b
    left join organization o on o.id = b.organization_id
    left join license l on l.id = b.license_id
    where b.slug = ${slug}
  `);
  const r = res.rows[0];
  if (!r) return null;
  const id = String(r.id);
  const [sources, evidence] = await Promise.all([
    d.execute<Row>(sql`select kind, url, label, is_official, last_status, last_checked_at from source where design_system_id = ${id} order by kind, url`),
    d.execute<Row>(sql`select ${EVIDENCE_SELECT} from verification_evidence where subject_type = 'design_system' and subject_id = ${id} order by field, retrieved_at desc limit 100`),
  ]);
  return {
    ...toApiSystem(r),
    philosophy: (r.philosophy as string | null) ?? null,
    principles: (r.principles as ApiSystemDetail["principles"]) ?? null,
    packages: (r.packages as ApiSystemDetail["packages"]) ?? [],
    registryNotes: (r.registry_notes as string | null) ?? null,
    coverage: (r.coverage as Record<string, unknown> | null) ?? null,
    sources: sources.rows.map((s) => ({
      kind: String(s.kind),
      url: String(s.url),
      label: (s.label as string | null) ?? null,
      isOfficial: !!s.is_official,
      lastStatus: (s.last_status as number | null) ?? null,
      lastCheckedAt: iso(s.last_checked_at as Date | null),
    })),
    evidence: evidence.rows.map(toEvidence),
  };
}

export async function systemExists(slug: string, db?: DB): Promise<boolean> {
  const d = await db_(db);
  const r = await d.execute(sql`select 1 from design_system where slug = ${slug} and publish_state = 'published'`);
  return r.rows.length > 0;
}

/* -------------------------------------------------------------------------- */
/* Components                                                                   */
/* -------------------------------------------------------------------------- */

export interface ComponentFilters extends Page {
  type?: string; // component type slug, or "unclassified"
  system?: string;
  framework?: string;
  q?: string;
}

const COMPONENT_SELECT = sql`
  c.id, c.slug, c.name, c.aliases, c.description, c.docs_url, c.source_code_url, c.lifecycle, c.coverage, c.confidence, c.last_changed_at,
  c.classification_state::text as classification_state, c.classification_method,
  ds.slug as system_slug, ds.name as system_name,
  ct.slug as type_slug, ct.name as type_name, cat.slug as group_slug,
  (select count(*) from component_variant v where v.component_id = c.id)::int as n_variants,
  (select count(*) from component_state s where s.component_id = c.id)::int as n_states,
  (select count(*) from component_property p where p.component_id = c.id)::int as n_properties,
  (select count(*) from component_example e where e.component_id = c.id)::int as n_examples,
  (select coalesce(jsonb_agg(f.slug order by f.slug), '[]'::jsonb) from component_framework cf join framework f on f.id = cf.framework_id where cf.component_id = c.id) as frameworks
`;

function toApiComponent(r: Row): ApiComponent {
  const sys = String(r.system_slug);
  const slug = String(r.slug);
  return {
    id: String(r.id),
    slug,
    name: String(r.name),
    aliases: (r.aliases as string[]) ?? [],
    system: { slug: sys, name: String(r.system_name) },
    type: r.type_slug ? { slug: String(r.type_slug), name: String(r.type_name), group: (r.group_slug as string | null) ?? null } : null,
    classification: { state: String(r.classification_state), method: (r.classification_method as string | null) ?? null },
    lifecycle: String(r.lifecycle),
    description: (r.description as string | null) ?? null,
    urls: { atlas: componentUrl(sys, slug), docs: (r.docs_url as string | null) ?? null, sourceCode: (r.source_code_url as string | null) ?? null },
    frameworks: (r.frameworks as string[]) ?? [],
    counts: { variants: num(r.n_variants), states: num(r.n_states), properties: num(r.n_properties), examples: num(r.n_examples) },
    coverage: (r.coverage as CoverageMap) ?? {},
    confidence: num(r.confidence),
    lastChangedAt: iso(r.last_changed_at as Date | null),
  };
}

function componentConds(f: Omit<ComponentFilters, "page" | "pageSize">): SQL[] {
  const conds: SQL[] = [sql`c.publish_state = 'published'`, sql`ds.publish_state = 'published'`];
  if (f.type === "unclassified") conds.push(sql`c.component_type_id is null`);
  else if (f.type) conds.push(sql`ct.slug = ${f.type}`);
  if (f.system) conds.push(sql`ds.slug = ${f.system}`);
  if (f.framework) conds.push(sql`exists (select 1 from component_framework cf join framework fw on fw.id = cf.framework_id where cf.component_id = c.id and fw.slug = ${f.framework})`);
  if (f.q) {
    const p = containsPattern(f.q);
    conds.push(sql`(c.name ilike ${p} or c.slug ilike ${p} or array_to_string(c.aliases, ' ') ilike ${p})`);
  }
  return conds;
}

export async function listComponents(f: ComponentFilters, db?: DB): Promise<PageResult<ApiComponent>> {
  const d = await db_(db);
  const res = await d.execute<Row>(sql`
    with page as (
      select c.id, count(*) over() as total, lower(c.name) as sort_name, ds.slug as sort_system
      from component c
      join design_system ds on ds.id = c.design_system_id
      left join component_type ct on ct.id = c.component_type_id
      ${whereAll(componentConds(f))}
      order by lower(c.name), ds.slug
      limit ${f.pageSize} offset ${offset(f)}
    )
    select ${COMPONENT_SELECT}, page.total
    from page
    join component c on c.id = page.id
    join design_system ds on ds.id = c.design_system_id
    left join component_type ct on ct.id = c.component_type_id
    left join category cat on cat.id = ct.category_id
    order by page.sort_name, page.sort_system
  `);
  let total = res.rows.length ? num(res.rows[0]!.total) : 0;
  if (!res.rows.length && f.page > 1) {
    const r = await d.execute<{ n: number }>(sql`
      select count(*)::int as n from component c join design_system ds on ds.id = c.design_system_id left join component_type ct on ct.id = c.component_type_id
      ${whereAll(componentConds(f))}`);
    total = num(r.rows[0]?.n);
  }
  return { data: res.rows.map(toApiComponent), total };
}

export async function getComponentDetail(systemSlug: string, componentSlug: string, db?: DB): Promise<ApiComponentDetail | null> {
  const d = await db_(db);
  const res = await d.execute<Row>(sql`
    select ${COMPONENT_SELECT}, c.publish_state::text as publish_state, c.sizes, c.responsive_guidance,
      l.slug as lic_slug, l.name as lic_name, l.spdx_id as lic_spdx, l.url as lic_url, l.is_open_source as lic_oss, l.redistribution::text as lic_redistribution
    from component c
    join design_system ds on ds.id = c.design_system_id
    left join component_type ct on ct.id = c.component_type_id
    left join category cat on cat.id = ct.category_id
    left join license l on l.id = coalesce(c.license_id, ds.license_id)
    where ds.slug = ${systemSlug} and c.slug = ${componentSlug} and c.publish_state in ('published', 'retired') and ds.publish_state = 'published'
  `);
  const r = res.rows[0];
  if (!r) return null;
  const id = String(r.id);
  const [fw, variants, states, props, a11y, examples, rels, usages, evidence] = await Promise.all([
    d.execute<Row>(sql`select f.slug, f.name, cf.package_name, cf.import_name, cf.source_url from component_framework cf join framework f on f.id = cf.framework_id where cf.component_id = ${id} order by f.name`),
    d.execute<Row>(sql`select axis, slug, name, description, source_url from component_variant where component_id = ${id} order by axis, name`),
    d.execute<Row>(sql`select slug, name, canonical_state, description, source_url from component_state where component_id = ${id} order by name`),
    d.execute<Row>(sql`select implementation, name, type, default_value, required, deprecated, description, allowed_values, source_url from component_property where component_id = ${id} order by implementation, name`),
    d.execute<Row>(sql`select * from component_accessibility where component_id = ${id}`),
    d.execute<Row>(sql`select slug, title, kind, language, code, url, attribution from component_example where component_id = ${id} order by slug`),
    d.execute<Row>(sql`
      select r.kind, r.verification_state::text as verification_state, r.source_url, tc.slug as c_slug, tc.name as c_name, tt.slug as t_slug, tt.name as t_name
      from component_relationship r
      left join component tc on tc.id = r.to_component_id
      left join component_type tt on tt.id = r.to_component_type_id
      where r.from_component_id = ${id} order by r.kind, coalesce(tc.name, tt.name)`),
    d.execute<Row>(sql`
      select t.name as token_name, u.property, count(*) over() as total
      from token_usage u join token t on t.id = u.token_id where u.component_id = ${id}
      order by t.name, u.property limit 200`),
    d.execute<Row>(sql`select ${EVIDENCE_SELECT} from verification_evidence where subject_type = 'component' and subject_id = ${id} order by field, retrieved_at desc limit 100`),
  ]);
  const a = a11y.rows[0];
  return {
    ...toApiComponent(r),
    publishState: String(r.publish_state),
    sizes: (r.sizes as string[] | null) ?? null,
    responsiveGuidance: (r.responsive_guidance as string | null) ?? null,
    license: license(r),
    frameworkDetails: fw.rows.map((x) => ({
      slug: String(x.slug),
      name: String(x.name),
      packageName: (x.package_name as string | null) ?? null,
      importName: (x.import_name as string | null) ?? null,
      sourceUrl: (x.source_url as string | null) ?? null,
    })),
    variants: variants.rows.map((x) => ({ axis: String(x.axis), slug: String(x.slug), name: String(x.name), description: (x.description as string | null) ?? null, sourceUrl: (x.source_url as string | null) ?? null })),
    states: states.rows.map((x) => ({
      slug: String(x.slug),
      name: String(x.name),
      canonicalState: (x.canonical_state as string | null) ?? null,
      description: (x.description as string | null) ?? null,
      sourceUrl: (x.source_url as string | null) ?? null,
    })),
    properties: props.rows.map((x) => ({
      implementation: String(x.implementation),
      name: String(x.name),
      type: (x.type as string | null) ?? null,
      defaultValue: (x.default_value as string | null) ?? null,
      required: (x.required as boolean | null) ?? null,
      deprecated: !!x.deprecated,
      description: (x.description as string | null) ?? null,
      allowedValues: (x.allowed_values as string[] | null) ?? null,
      sourceUrl: (x.source_url as string | null) ?? null,
    })),
    accessibility: a
      ? {
          ariaPattern: (a.aria_pattern as string | null) ?? null,
          roles: (a.roles as string[] | null) ?? null,
          keyboard: (a.keyboard as { keys: string; action: string }[] | null) ?? null,
          guidance: (a.guidance as string | null) ?? null,
          screenReader: (a.screen_reader as string | null) ?? null,
          focusManagement: (a.focus_management as string | null) ?? null,
          wcagCriteria: (a.wcag_criteria as string[] | null) ?? null,
          docsUrl: (a.docs_url as string | null) ?? null,
          coverage: (a.coverage as CoverageMap) ?? {},
        }
      : null,
    examples: examples.rows.map((x) => ({
      slug: String(x.slug),
      title: String(x.title),
      kind: String(x.kind),
      language: (x.language as string | null) ?? null,
      code: (x.code as string | null) ?? null,
      url: (x.url as string | null) ?? null,
      attribution: (x.attribution as string | null) ?? null,
    })),
    relationships: rels.rows.map((x) => ({
      kind: String(x.kind),
      target: x.c_slug
        ? { kind: "component" as const, slug: String(x.c_slug), name: String(x.c_name) }
        : x.t_slug
          ? { kind: "component-type" as const, slug: String(x.t_slug), name: String(x.t_name) }
          : null,
      verificationState: String(x.verification_state),
      sourceUrl: (x.source_url as string | null) ?? null,
    })),
    tokenUsages: usages.rows.map((x) => ({ tokenName: String(x.token_name), property: (x.property as string | null) ?? null })),
    tokenUsageTotal: usages.rows.length ? num(usages.rows[0]!.total) : 0,
    evidence: evidence.rows.map(toEvidence),
  };
}

/* -------------------------------------------------------------------------- */
/* Component types                                                              */
/* -------------------------------------------------------------------------- */

export interface ComponentTypeFilters extends Page {
  group?: string;
  q?: string;
}

export async function listComponentTypes(f: ComponentTypeFilters, db?: DB): Promise<PageResult<ApiComponentType>> {
  const d = await db_(db);
  const conds: SQL[] = [];
  if (f.group) conds.push(sql`cat.slug = ${f.group}`);
  if (f.q) {
    const p = containsPattern(f.q);
    conds.push(sql`(ct.name ilike ${p} or ct.slug ilike ${p} or array_to_string(ct.aliases, ' ') ilike ${p})`);
  }
  const res = await d.execute<Row>(sql`
    with impl as (
      select c.component_type_id, count(*)::int as n, count(distinct c.design_system_id)::int as systems
      from component c join design_system ds on ds.id = c.design_system_id
      where c.publish_state = 'published' and ds.publish_state = 'published' and c.component_type_id is not null
      group by 1
    )
    select ct.id, ct.slug, ct.name, ct.description, ct.aliases, ct.near_synonyms, ct.aria_pattern,
      cat.slug as group_slug, cat.name as group_name, coalesce(impl.n, 0) as n, coalesce(impl.systems, 0) as systems, count(*) over() as total
    from component_type ct
    join category cat on cat.id = ct.category_id
    left join impl on impl.component_type_id = ct.id
    ${whereAll(conds)}
    order by cat.sort_order, ct.sort_order, ct.name
    limit ${f.pageSize} offset ${offset(f)}
  `);
  return {
    total: res.rows.length ? num(res.rows[0]!.total) : 0,
    data: res.rows.map((r) => ({
      id: String(r.id),
      slug: String(r.slug),
      name: String(r.name),
      group: { slug: String(r.group_slug), name: String(r.group_name) },
      description: String(r.description),
      aliases: (r.aliases as string[]) ?? [],
      nearSynonyms: (r.near_synonyms as string[]) ?? [],
      ariaPattern: (r.aria_pattern as string | null) ?? null,
      urls: { atlas: componentTypeUrl(String(r.slug)) },
      counts: { implementations: num(r.n), systems: num(r.systems) },
    })),
  };
}

/* -------------------------------------------------------------------------- */
/* Tokens                                                                       */
/* -------------------------------------------------------------------------- */

export interface TokenFilters extends Page {
  system?: string;
  set?: string;
  category?: string;
  theme?: string; // a theme name, or "none" for theme-agnostic sets
  q?: string;
}

export async function listTokens(f: TokenFilters, db?: DB): Promise<PageResult<ApiToken>> {
  const d = await db_(db);
  const conds: SQL[] = [sql`s.publish_state = 'published'`, sql`ds.publish_state = 'published'`];
  if (f.system) conds.push(sql`ds.slug = ${f.system}`);
  if (f.set) conds.push(sql`s.slug = ${f.set}`);
  if (f.category) conds.push(sql`t.category = ${f.category}`);
  if (f.theme === "none") conds.push(sql`s.theme is null`);
  else if (f.theme) conds.push(sql`s.theme = ${f.theme}`);
  if (f.q) {
    const p = containsPattern(f.q);
    conds.push(sql`(t.name ilike ${p} or t.css_var ilike ${p})`);
  }
  const res = await d.execute<Row>(sql`
    select t.id, t.name, t.path, t.css_var, t.category::text as category, t.type, t.tier::text as tier, t.tier_state::text as tier_state,
      t.raw_value, t.resolved_value, t.value_text, t.is_alias, t.alias_state, t.description, t.deprecated,
      ds.slug as system_slug, ds.name as system_name,
      s.slug as set_slug, s.name as set_name, s.theme, s.format, s.source_url as set_source_url, s.package_name, s.package_version, s.redistribution::text as set_redistribution,
      l.slug as lic_slug, l.name as lic_name, l.spdx_id as lic_spdx, l.url as lic_url, l.is_open_source as lic_oss, l.redistribution::text as lic_redistribution,
      count(*) over() as total
    from token t
    join token_set s on s.id = t.token_set_id
    join design_system ds on ds.id = t.design_system_id
    left join license l on l.id = coalesce(s.license_id, ds.license_id)
    ${whereAll(conds)}
    order by ds.slug, s.slug, t.name
    limit ${f.pageSize} offset ${offset(f)}
  `);
  return {
    total: res.rows.length ? num(res.rows[0]!.total) : 0,
    data: res.rows.map((r) => {
      const redistribution = String(r.set_redistribution);
      const withheld = redistribution !== "permitted";
      const resolved = r.resolved_value as unknown;
      return {
        id: String(r.id),
        name: String(r.name),
        path: (r.path as string[]) ?? [],
        cssVar: (r.css_var as string | null) ?? null,
        category: String(r.category),
        type: (r.type as string | null) ?? null,
        tier: (r.tier as string | null) ?? null,
        tierState: String(r.tier_state),
        system: { slug: String(r.system_slug), name: String(r.system_name) },
        set: {
          slug: String(r.set_slug),
          name: String(r.set_name),
          theme: (r.theme as string | null) ?? null,
          format: String(r.format),
          sourceUrl: String(r.set_source_url),
          packageName: (r.package_name as string | null) ?? null,
          packageVersion: (r.package_version as string | null) ?? null,
          license: license(r),
          redistribution,
        },
        valueWithheld: withheld,
        rawValue: withheld ? null : (r.raw_value ?? null),
        resolvedValue: withheld ? null : (resolved ?? null),
        valueText: withheld ? null : ((r.value_text as string | null) ?? null),
        isAlias: !!r.is_alias,
        aliasState: (r.alias_state as string | null) ?? null,
        themes: isThemeDependentValue(resolved) ? Object.keys(resolved.$themes) : null,
        description: (r.description as string | null) ?? null,
        deprecated: !!r.deprecated,
        urls: { atlas: tokenUrl(String(r.system_slug), String(r.name)) },
      };
    }),
  };
}

/* -------------------------------------------------------------------------- */
/* Patterns                                                                     */
/* -------------------------------------------------------------------------- */

export interface PatternFilters extends Page {
  system?: string;
  type?: string;
  q?: string;
}

export async function listPatterns(f: PatternFilters, db?: DB): Promise<PageResult<ApiPattern>> {
  const d = await db_(db);
  const conds: SQL[] = [sql`p.publish_state = 'published'`, sql`ds.publish_state = 'published'`];
  if (f.system) conds.push(sql`ds.slug = ${f.system}`);
  if (f.type === "unclassified") conds.push(sql`p.pattern_type_id is null`);
  else if (f.type) conds.push(sql`pt.slug = ${f.type}`);
  if (f.q) {
    const p = containsPattern(f.q);
    conds.push(sql`(p.name ilike ${p} or p.slug ilike ${p})`);
  }
  const res = await d.execute<Row>(sql`
    select p.id, p.slug, p.name, p.description, p.docs_url, p.coverage, p.classification_state::text as classification_state,
      ds.slug as system_slug, ds.name as system_name, pt.slug as type_slug, pt.name as type_name,
      (select count(*) from pattern_component pc where pc.pattern_id = p.id)::int as n_components,
      count(*) over() as total
    from design_pattern p
    join design_system ds on ds.id = p.design_system_id
    left join pattern_type pt on pt.id = p.pattern_type_id
    ${whereAll(conds)}
    order by lower(p.name), ds.slug
    limit ${f.pageSize} offset ${offset(f)}
  `);
  return {
    total: res.rows.length ? num(res.rows[0]!.total) : 0,
    data: res.rows.map((r) => ({
      id: String(r.id),
      slug: String(r.slug),
      name: String(r.name),
      system: { slug: String(r.system_slug), name: String(r.system_name) },
      type: r.type_slug ? { slug: String(r.type_slug), name: String(r.type_name) } : null,
      classificationState: String(r.classification_state),
      description: (r.description as string | null) ?? null,
      urls: { atlas: patternUrl(String(r.system_slug), String(r.slug)), docs: (r.docs_url as string | null) ?? null },
      componentCount: num(r.n_components),
      coverage: (r.coverage as CoverageMap) ?? {},
    })),
  };
}

/* -------------------------------------------------------------------------- */
/* Ingestion status (public, non-sensitive)                                     */
/* -------------------------------------------------------------------------- */

export interface ApiIngestionStatus {
  generatedAt: string;
  queue: { byStatus: Record<string, number>; byKind: { kind: string; status: string; count: number }[]; due: number; oldestQueuedAt: string | null };
  systems: Record<string, number>;
  runs: {
    id: string;
    system: string | null;
    kind: string;
    status: string;
    stage: string | null;
    triggeredBy: string;
    createdAt: string | null;
    startedAt: string | null;
    finishedAt: string | null;
    durationMs: number | null;
    stats: { discovered: number | null; fetched: number | null; notModified: number | null; published: number | null; quarantined: number | null; fetchErrors: number | null; components: number | null; tokens: number | null; patterns: number | null };
  }[];
}

const STAT_KEYS = ["discovered", "fetched", "notModified", "published", "quarantined", "fetchErrors", "components", "tokens", "patterns"] as const;

export async function ingestionStatus(limit = 20, db?: DB): Promise<ApiIngestionStatus> {
  const d = await db_(db);
  const [jobs, due, systems, runs] = await Promise.all([
    d.execute<{ kind: string; status: string; n: number }>(sql`select kind, status::text as status, count(*)::int as n from ingestion_job group by 1, 2 order by 1, 2`),
    d.execute<{ n: number; oldest: Date | null }>(sql`select count(*)::int as n, min(created_at) as oldest from ingestion_job where status = 'queued' and run_at <= now()`),
    d.execute<{ status: string; n: number }>(sql`select ingestion_status::text as status, count(*)::int as n from design_system where registry_status = 'verified' group by 1 order by 1`),
    d.execute<Row>(sql`
      select r.id, ds.slug as system, r.kind, r.status::text as status, r.stage, r.triggered_by, r.created_at, r.started_at, r.finished_at, r.stats
      from ingestion_run r left join design_system ds on ds.id = r.design_system_id
      order by r.created_at desc limit ${limit}`),
  ]);
  const byStatus: Record<string, number> = {};
  for (const j of jobs.rows) byStatus[j.status] = (byStatus[j.status] ?? 0) + num(j.n);
  return {
    generatedAt: new Date().toISOString(),
    queue: {
      byStatus,
      byKind: jobs.rows.map((j) => ({ kind: j.kind, status: j.status, count: num(j.n) })),
      due: num(due.rows[0]?.n),
      oldestQueuedAt: iso(due.rows[0]?.oldest ?? null),
    },
    systems: Object.fromEntries(systems.rows.map((s) => [s.status, num(s.n)])),
    runs: runs.rows.map((r) => {
      const stats = (r.stats as Record<string, number | undefined> | null) ?? {};
      const started = r.started_at ? new Date(r.started_at as Date).getTime() : null;
      const finished = r.finished_at ? new Date(r.finished_at as Date).getTime() : null;
      return {
        id: String(r.id),
        system: (r.system as string | null) ?? null,
        kind: String(r.kind),
        status: String(r.status),
        stage: (r.stage as string | null) ?? null,
        triggeredBy: String(r.triggered_by),
        createdAt: iso(r.created_at as Date | null),
        startedAt: iso(r.started_at as Date | null),
        finishedAt: iso(r.finished_at as Date | null),
        durationMs: typeof stats.durationMs === "number" ? stats.durationMs : started && finished ? finished - started : null,
        stats: Object.fromEntries(STAT_KEYS.map((k) => [k, typeof stats[k] === "number" ? stats[k]! : null])) as ApiIngestionStatus["runs"][number]["stats"],
      };
    }),
  };
}

/* -------------------------------------------------------------------------- */
/* Exports                                                                      */
/* -------------------------------------------------------------------------- */

export async function exportSystems(registry: "verified" | "all" = "verified", db?: DB): Promise<ApiSystem[]> {
  const out: ApiSystem[] = [];
  for (let page = 1; ; page++) {
    const r = await listSystems({ registry, page, pageSize: 100 }, db);
    out.push(...r.data);
    if (out.length >= r.total || r.data.length === 0) break;
  }
  return out;
}

export interface ExportComponentRow {
  system: string;
  systemName: string;
  name: string;
  slug: string;
  type: string | null;
  typeName: string | null;
  classificationState: string;
  classificationMethod: string | null;
  lifecycle: string;
  frameworks: string[];
  docsUrl: string | null;
  sourceCodeUrl: string | null;
  atlasUrl: string;
  lastChangedAt: string | null;
}

export async function exportComponents(db?: DB): Promise<ExportComponentRow[]> {
  const d = await db_(db);
  const res = await d.execute<Row>(sql`
    select ds.slug as system, ds.name as system_name, c.name, c.slug, ct.slug as type, ct.name as type_name,
      c.classification_state::text as classification_state, c.classification_method, c.lifecycle, c.docs_url, c.source_code_url, c.last_changed_at,
      (select coalesce(array_agg(f.slug order by f.slug), '{}') from component_framework cf join framework f on f.id = cf.framework_id where cf.component_id = c.id) as frameworks
    from component c
    join design_system ds on ds.id = c.design_system_id
    left join component_type ct on ct.id = c.component_type_id
    where c.publish_state = 'published' and ds.publish_state = 'published'
    order by ds.slug, lower(c.name)
  `);
  return res.rows.map((r) => ({
    system: String(r.system),
    systemName: String(r.system_name),
    name: String(r.name),
    slug: String(r.slug),
    type: (r.type as string | null) ?? null,
    typeName: (r.type_name as string | null) ?? null,
    classificationState: String(r.classification_state),
    classificationMethod: (r.classification_method as string | null) ?? null,
    lifecycle: String(r.lifecycle),
    frameworks: (r.frameworks as string[]) ?? [],
    docsUrl: (r.docs_url as string | null) ?? null,
    sourceCodeUrl: (r.source_code_url as string | null) ?? null,
    atlasUrl: componentUrl(String(r.system), String(r.slug)),
    lastChangedAt: iso(r.last_changed_at as Date | null),
  }));
}
