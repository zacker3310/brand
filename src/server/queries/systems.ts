/**
 * Read models for the design-system directory (/systems) and detail page (/systems/[slug]).
 * Every count is aggregated in SQL from canonical records; nothing is hard-coded.
 */
import { sql } from "drizzle-orm";
import type {
  CoverageMap,
  CoverageState,
  DocAccess,
  IngestionStatus,
  MaintenanceStatus,
  RegistryCheck,
  RegistryStatus,
  SystemCategory,
  VerificationState,
} from "@/lib/contracts";
import type { DirectoryRow } from "@/components/discovery/lib/directory";
import { readDb } from "./db";
import { publishedIngestionStatus } from "./status";

type Json = unknown;
const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const iso = (v: unknown): string | null => (v ? new Date(v as string).toISOString() : null);

/* -------------------------------------------------------------------------- */
/* Directory                                                                   */
/* -------------------------------------------------------------------------- */

function hostOf(u: string | null): string | null {
  if (!u) return null;
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * All published, verified systems with aggregated counts and facet arrays (one query).
 * When `q` is given, `match` is a server-side relevance score from ILIKE on name, aliases and
 * organization plus pg_trgm word similarity on the name (typo tolerance); 0 means no match.
 */
export async function listDirectoryRows(q = ""): Promise<DirectoryRow[]> {
  const db = await readDb();
  const query = q.trim().toLowerCase().slice(0, 120);
  const like = `%${escapeLike(query)}%`;
  const prefix = `${escapeLike(query)}%`;
  const r = await db.execute<{
    id: string;
    slug: string;
    name: string;
    aliases: string[];
    org_slug: string | null;
    org_name: string | null;
    category: SystemCategory;
    summary: string | null;
    maintenance_status: MaintenanceStatus;
    doc_access: DocAccess;
    license: DirectoryRow["license"];
    frameworks: DirectoryRow["frameworks"] | null;
    platforms: DirectoryRow["platforms"] | null;
    tags: DirectoryRow["tags"] | null;
    ingestion_status: IngestionStatus;
    confidence: number;
    last_verified_at: string | null;
    last_ingested_at: string | null;
    registry_rank: number | null;
    latest_version: string | null;
    homepage_url: string | null;
    docs_url: string | null;
    repository_url: string | null;
    components: string;
    tokens: string;
    patterns: string;
    match: number | null;
  }>(sql`
    with fw as (
      select dsf.design_system_id,
        json_agg(json_build_object('slug', f.slug, 'name', f.name, 'state', dsf.verification_state, 'support', dsf.support, 'packageName', dsf.package_name)
          order by f.name) as items
      from design_system_framework dsf join framework f on f.id = dsf.framework_id
      group by 1
    ), pl as (
      select dsp.design_system_id, json_agg(json_build_object('slug', p.slug, 'name', p.name) order by p.name) as items
      from design_system_platform dsp join platform p on p.id = dsp.platform_id
      group by 1
    ), tg as (
      select dst.design_system_id, json_agg(json_build_object('slug', t.slug, 'name', t.name) order by t.name) as items
      from design_system_tag dst join tag t on t.id = dst.tag_id
      group by 1
    ), comp as (
      select design_system_id, count(*) as n from component where publish_state = 'published' group by 1
    ), tok as (
      select t.design_system_id, count(*) as n
      from token t join token_set s on s.id = t.token_set_id
      where s.publish_state = 'published' group by 1
    ), pat as (
      select design_system_id, count(*) as n from design_pattern where publish_state = 'published' group by 1
    )
    select ds.id, ds.slug, ds.name, ds.aliases, o.slug as org_slug, o.name as org_name, ds.category, ds.summary,
      ds.maintenance_status, ds.doc_access,
      case when l.id is null then null else json_build_object(
        'slug', l.slug, 'name', l.name, 'spdxId', l.spdx_id, 'isOpenSource', l.is_open_source, 'redistribution', l.redistribution) end as license,
      fw.items as frameworks, pl.items as platforms, tg.items as tags,
      ${publishedIngestionStatus("ds")} as ingestion_status, ds.confidence, ds.last_verified_at::text, ds.last_ingested_at::text, ds.registry_rank, ds.latest_version,
      ds.homepage_url, ds.docs_url, ds.repository_url,
      coalesce(comp.n, 0) as components, coalesce(tok.n, 0) as tokens, coalesce(pat.n, 0) as patterns,
      case when ${query} = '' then null else greatest(
        case when lower(ds.name) = ${query} then 1.0 else 0 end,
        case when lower(unaccent(ds.name)) like unaccent(${prefix}) then 0.9 else 0 end,
        case when lower(unaccent(ds.name)) like unaccent(${like}) or ds.slug like ${like} then 0.8 else 0 end,
        case when lower(unaccent(array_to_string(ds.aliases, ' '))) like unaccent(${like}) then 0.7 else 0 end,
        case when lower(unaccent(coalesce(o.name, ''))) like unaccent(${like}) then 0.6 else 0 end,
        case when length(${query}) >= 3 and word_similarity(${query}, lower(ds.name)) >= 0.45
          then 0.55 * word_similarity(${query}, lower(ds.name)) else 0 end,
        case when length(${query}) >= 3 and word_similarity(${query}, lower(array_to_string(ds.aliases, ' '))) >= 0.5
          then 0.45 * word_similarity(${query}, lower(array_to_string(ds.aliases, ' '))) else 0 end
      ) end as match
    from design_system ds
    left join organization o on o.id = ds.organization_id
    left join license l on l.id = ds.license_id
    left join fw on fw.design_system_id = ds.id
    left join pl on pl.design_system_id = ds.id
    left join tg on tg.design_system_id = ds.id
    left join comp on comp.design_system_id = ds.id
    left join tok on tok.design_system_id = ds.id
    left join pat on pat.design_system_id = ds.id
    where ds.registry_status = 'verified' and ds.publish_state = 'published'
  `);
  return r.rows.map((x) => ({
    id: x.id,
    slug: x.slug,
    name: x.name,
    aliases: x.aliases ?? [],
    organization: x.org_slug && x.org_name ? { slug: x.org_slug, name: x.org_name } : null,
    category: x.category,
    summary: x.summary,
    maintenance: x.maintenance_status,
    docAccess: x.doc_access,
    license: x.license,
    frameworks: x.frameworks ?? [],
    platforms: x.platforms ?? [],
    tags: x.tags ?? [],
    ingestionStatus: x.ingestion_status,
    confidence: Number(x.confidence),
    lastVerifiedAt: iso(x.last_verified_at),
    lastIngestedAt: iso(x.last_ingested_at),
    registryRank: x.registry_rank,
    latestVersion: x.latest_version,
    homepageUrl: x.homepage_url,
    docsUrl: x.docs_url,
    repositoryUrl: x.repository_url,
    counts: { components: num(x.components), tokens: num(x.tokens), patterns: num(x.patterns) },
    match: x.match === null ? null : Number(x.match),
  }));
}

/* -------------------------------------------------------------------------- */
/* Registry decisions                                                          */
/* -------------------------------------------------------------------------- */

export interface RegistryDecision {
  slug: string;
  name: string;
  organization: string | null;
  status: RegistryStatus;
  rank: number | null;
  notes: string | null;
  homepageUrl: string | null;
  duplicateOf: { slug: string; name: string | null; published: boolean } | null;
  replacedBy: { slug: string; name: string | null; published: boolean } | null;
  verifiedAt: string | null;
  checks: { total: number; failed: number };
}

export interface RegistrySummary {
  verified: number;
  verifiedFromQueue: number;
  replacements: number;
  rejected: number;
  duplicate: number;
  replaced: number;
  candidates: number;
}

export async function getRegistryDecisions(): Promise<{ decisions: RegistryDecision[]; summary: RegistrySummary }> {
  const db = await readDb();
  const [rows, summary] = await Promise.all([
    db.execute<{
      slug: string;
      name: string;
      org: string | null;
      registry_status: RegistryStatus;
      registry_rank: number | null;
      registry_notes: string | null;
      homepage_url: string | null;
      duplicate_of_slug: string | null;
      dup_name: string | null;
      dup_published: boolean | null;
      replaced_by_slug: string | null;
      rep_name: string | null;
      rep_published: boolean | null;
      last_verified_at: string | null;
      checks_total: number | null;
      checks_failed: number | null;
    }>(sql`
      select ds.slug, ds.name, o.name as org, ds.registry_status, ds.registry_rank, ds.registry_notes, ds.homepage_url,
        ds.duplicate_of_slug, dup.name as dup_name, (dup.publish_state = 'published' and dup.registry_status = 'verified') as dup_published,
        ds.replaced_by_slug, rep.name as rep_name, (rep.publish_state = 'published' and rep.registry_status = 'verified') as rep_published,
        ds.last_verified_at::text,
        jsonb_array_length(coalesce(ds.registry_evidence->'checks', '[]'::jsonb)) as checks_total,
        (select count(*) from jsonb_array_elements(coalesce(ds.registry_evidence->'checks', '[]'::jsonb)) c where (c->>'ok')::boolean is not true) as checks_failed
      from design_system ds
      left join organization o on o.id = ds.organization_id
      left join design_system dup on dup.slug = ds.duplicate_of_slug
      left join design_system rep on rep.slug = ds.replaced_by_slug
      where ds.registry_status in ('rejected', 'duplicate', 'replaced')
      order by ds.registry_status, ds.registry_rank nulls last, ds.name
    `),
    db.execute<{ verified: string; verified_from_queue: string; replacements: string; rejected: string; duplicate: string; replaced: string; candidates: string }>(sql`
      select
        count(*) filter (where registry_status = 'verified' and publish_state = 'published') as verified,
        count(*) filter (where registry_status = 'verified' and publish_state = 'published' and replaces_slug is null) as verified_from_queue,
        count(*) filter (where registry_status = 'verified' and publish_state = 'published' and replaces_slug is not null) as replacements,
        count(*) filter (where registry_status = 'rejected') as rejected,
        count(*) filter (where registry_status = 'duplicate') as duplicate,
        count(*) filter (where registry_status = 'replaced') as replaced,
        count(*) filter (where registry_rank is not null) as candidates
      from design_system
    `),
  ]);
  const s = summary.rows[0]!;
  return {
    decisions: rows.rows.map((x) => ({
      slug: x.slug,
      name: x.name,
      organization: x.org,
      status: x.registry_status,
      rank: x.registry_rank,
      notes: x.registry_notes,
      homepageUrl: x.homepage_url,
      duplicateOf: x.duplicate_of_slug ? { slug: x.duplicate_of_slug, name: x.dup_name, published: !!x.dup_published } : null,
      replacedBy: x.replaced_by_slug ? { slug: x.replaced_by_slug, name: x.rep_name, published: !!x.rep_published } : null,
      verifiedAt: iso(x.last_verified_at),
      checks: { total: num(x.checks_total), failed: num(x.checks_failed) },
    })),
    summary: {
      verified: num(s.verified),
      verifiedFromQueue: num(s.verified_from_queue),
      replacements: num(s.replacements),
      rejected: num(s.rejected),
      duplicate: num(s.duplicate),
      replaced: num(s.replaced),
      candidates: num(s.candidates),
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Detail                                                                      */
/* -------------------------------------------------------------------------- */

export interface SystemCore {
  id: string;
  slug: string;
  name: string;
  aliases: string[];
  organization: { slug: string; name: string; websiteUrl: string | null } | null;
  category: SystemCategory;
  summary: string | null;
  philosophy: string | null;
  principles: { name: string; sourceUrl: string }[] | null;
  homepageUrl: string | null;
  docsUrl: string | null;
  repositoryUrl: string | null;
  figmaUrl: string | null;
  storybookUrl: string | null;
  packages: { name: string; registry: string; url: string }[];
  license: (DirectoryRow["license"] & { url: string | null; notes: string | null }) | null;
  docAccess: DocAccess;
  maintenance: MaintenanceStatus;
  latestVersion: string | null;
  latestReleaseAt: string | null;
  registryStatus: RegistryStatus;
  registryRank: number | null;
  registryNotes: string | null;
  duplicateOfSlug: string | null;
  replacesSlug: string | null;
  replacedBySlug: string | null;
  relatedSlugs: string[];
  registryChecks: RegistryCheck[];
  ingestionStatus: IngestionStatus;
  adapterId: string | null;
  confidence: number;
  lastVerifiedAt: string | null;
  lastIngestedAt: string | null;
  publishState: string;
}

export interface FactEvidence {
  id: string;
  field: string;
  sourceUrl: string;
  sourceTitle: string | null;
  retrievedAt: string;
  contentHash: string | null;
  extractionMethod: string;
  location: string | null;
  excerpt: string | null;
  state: VerificationState;
  confidence: number;
}

export interface DetailComponent {
  id: string;
  slug: string;
  name: string;
  lifecycle: string;
  docsUrl: string | null;
  typeSlug: string | null;
  typeName: string | null;
  group: string | null;
  typeSortOrder: number;
  classificationState: VerificationState;
  classificationMethod: string | null;
  confidence: number;
  coverage: CoverageMap;
  variants: number;
  properties: number;
  hasA11yRecord: boolean;
}

export interface DetailTokenSet {
  slug: string;
  name: string;
  theme: string | null;
  format: string;
  sourceUrl: string;
  packageName: string | null;
  packageVersion: string | null;
  redistribution: string;
  tokens: number;
}

export interface Swatch {
  name: string;
  setSlug: string;
  theme: string | null;
  resolved: Json;
  valueText: string | null;
}

export interface DetailPattern {
  slug: string;
  name: string;
  description: string | null;
  docsUrl: string | null;
  typeSlug: string | null;
  typeName: string | null;
  classificationState: VerificationState;
  components: number;
}

export interface DetailSource {
  id: string;
  kind: string;
  url: string;
  label: string | null;
  isOfficial: boolean;
  robotsAllowed: boolean | null;
  lastCheckedAt: string | null;
  lastStatus: number | null;
  lastError: string | null;
  discoveredBy: string;
  documents: number;
  documentsLastFetchedAt: string | null;
  documentStatuses: { status: number | null; count: number }[];
}

export interface DetailChange {
  /** Stable key for the batch. */
  id: string;
  runId: string | null;
  entityType: string;
  changeKind: string;
  count: number;
  occurredAt: string;
  /** Entity labels in the batch (alphabetical, capped). */
  labels: string[];
  /** Distinct field-change summaries with how many events carried each. */
  summaries: { summary: string; count: number }[];
}

export interface RelatedSystem {
  slug: string;
  name: string;
  relation: "related" | "related-from" | "replaces" | "replaced-by" | "duplicate-of" | "duplicated-by";
  registryStatus: RegistryStatus;
  published: boolean;
}

export interface SystemDetail {
  core: SystemCore;
  frameworks: { slug: string; name: string; kind: string; support: string; packageName: string | null; state: VerificationState; sourceUrl: string | null }[];
  platforms: { slug: string; name: string; state: VerificationState; sourceUrl: string | null }[];
  tags: { slug: string; name: string; state: VerificationState }[];
  counts: { components: number; tokens: number; tokenSets: number; patterns: number; evidence: number; sources: number; documents: number };
  factEvidence: FactEvidence[];
  components: DetailComponent[];
  tokenSets: DetailTokenSet[];
  tokenCategories: { category: string; count: number }[];
  aliasStates: { state: string; count: number }[];
  tokenTiers: { tier: string | null; state: string; count: number }[];
  swatchCandidates: Swatch[];
  patterns: DetailPattern[];
  accessibility: {
    components: number;
    a11yCoverage: Partial<Record<CoverageState, number>>;
    keyboardCoverage: Partial<Record<CoverageState, number>>;
    withKeyboardInteractions: number;
    ariaPatterns: { pattern: string; count: number }[];
    wcag: { criterion: string; count: number }[];
  };
  sources: DetailSource[];
  evidenceBySubject: { subjectType: string; state: VerificationState; count: number }[];
  evidenceHosts: { host: string; count: number }[];
  lastRetrievedAt: string | null;
  related: RelatedSystem[];
}

/** Systems resolvable at /systems/[slug]: published verified systems. Rejected/duplicate entries are not detail pages. */
export async function getSystemDetail(slug: string): Promise<SystemDetail | null> {
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(slug)) return null;
  const db = await readDb();
  const core = await db.execute<Record<string, Json>>(sql`
    select ds.*, ${publishedIngestionStatus("ds")} as published_status, o.slug as org_slug, o.name as org_name, o.website_url as org_url,
      case when l.id is null then null else json_build_object(
        'slug', l.slug, 'name', l.name, 'spdxId', l.spdx_id, 'isOpenSource', l.is_open_source,
        'redistribution', l.redistribution, 'url', l.url, 'notes', l.notes) end as license_json
    from design_system ds
    left join organization o on o.id = ds.organization_id
    left join license l on l.id = ds.license_id
    where ds.slug = ${slug} and ds.registry_status = 'verified' and ds.publish_state = 'published'
  `);
  const c = core.rows[0];
  if (!c) return null;
  const id = c.id as string;

  const [fw, pl, tg, counts, ev, comps, sets, cats, aliases, tiers, swatches, pats, a11y, aria, wcag, sources, evBySubject, evHosts, related] = await Promise.all([
    db.execute<{ slug: string; name: string; kind: string; support: string; package_name: string | null; verification_state: VerificationState; source_url: string | null }>(sql`
      select f.slug, f.name, f.kind, dsf.support, dsf.package_name, dsf.verification_state, dsf.source_url
      from design_system_framework dsf join framework f on f.id = dsf.framework_id
      where dsf.design_system_id = ${id} order by (dsf.verification_state = 'verified') desc, f.name`),
    db.execute<{ slug: string; name: string; verification_state: VerificationState; source_url: string | null }>(sql`
      select p.slug, p.name, dsp.verification_state, dsp.source_url
      from design_system_platform dsp join platform p on p.id = dsp.platform_id
      where dsp.design_system_id = ${id} order by p.name`),
    db.execute<{ slug: string; name: string; verification_state: VerificationState }>(sql`
      select t.slug, t.name, dst.verification_state from design_system_tag dst join tag t on t.id = dst.tag_id
      where dst.design_system_id = ${id} order by t.name`),
    db.execute<{ components: string; tokens: string; token_sets: string; patterns: string; evidence: string; sources: string; documents: string }>(sql`
      select
        (select count(*) from component where design_system_id = ${id} and publish_state = 'published') as components,
        (select count(*) from token t join token_set s on s.id = t.token_set_id where t.design_system_id = ${id} and s.publish_state = 'published') as tokens,
        (select count(*) from token_set where design_system_id = ${id} and publish_state = 'published') as token_sets,
        (select count(*) from design_pattern where design_system_id = ${id} and publish_state = 'published') as patterns,
        (select count(*) from verification_evidence where design_system_id = ${id}) as evidence,
        (select count(*) from source where design_system_id = ${id}) as sources,
        (select count(*) from source_document where design_system_id = ${id}) as documents`),
    db.execute<{
      id: string;
      field: string;
      source_url: string;
      source_title: string | null;
      retrieved_at: string;
      content_hash: string | null;
      extraction_method: string;
      location: string | null;
      excerpt: string | null;
      state: VerificationState;
      confidence: number;
    }>(sql`
      select id, field, source_url, source_title, retrieved_at::text, content_hash, extraction_method, location, excerpt, state, confidence
      from verification_evidence
      where subject_type = 'design_system' and subject_id = ${id}
      order by field, (state = 'verified') desc, confidence desc, retrieved_at desc`),
    db.execute<{
      id: string;
      slug: string;
      name: string;
      lifecycle: string;
      docs_url: string | null;
      type_slug: string | null;
      type_name: string | null;
      group_slug: string | null;
      type_sort: number | null;
      classification_state: VerificationState;
      classification_method: string | null;
      confidence: number;
      coverage: CoverageMap;
      variants: string | null;
      properties: string | null;
      has_a11y: boolean;
    }>(sql`
      with v as (
        select cv.component_id, count(*) as n from component_variant cv join component c on c.id = cv.component_id
        where c.design_system_id = ${id} group by 1
      ), p as (
        select cp.component_id, count(*) as n from component_property cp join component c on c.id = cp.component_id
        where c.design_system_id = ${id} group by 1
      )
      select c.id, c.slug, c.name, c.lifecycle, c.docs_url, ct.slug as type_slug, ct.name as type_name, cat.slug as group_slug,
        ct.sort_order as type_sort, c.classification_state, c.classification_method, c.confidence, c.coverage,
        v.n as variants, p.n as properties, (ca.component_id is not null) as has_a11y
      from component c
      left join component_type ct on ct.id = c.component_type_id
      left join category cat on cat.id = ct.category_id
      left join v on v.component_id = c.id
      left join p on p.component_id = c.id
      left join component_accessibility ca on ca.component_id = c.id
      where c.design_system_id = ${id} and c.publish_state = 'published'
      order by c.name`),
    db.execute<{
      slug: string;
      name: string;
      theme: string | null;
      format: string;
      source_url: string;
      package_name: string | null;
      package_version: string | null;
      redistribution: string;
      tokens: string;
    }>(sql`
      select s.slug, s.name, s.theme, s.format, s.source_url, s.package_name, s.package_version, s.redistribution,
        (select count(*) from token t where t.token_set_id = s.id) as tokens
      from token_set s where s.design_system_id = ${id} and s.publish_state = 'published'
      order by s.theme nulls first, s.name`),
    db.execute<{ category: string; count: string }>(sql`
      select t.category, count(*) as count from token t join token_set s on s.id = t.token_set_id
      where t.design_system_id = ${id} and s.publish_state = 'published' group by 1 order by 2 desc`),
    db.execute<{ state: string; count: string }>(sql`
      select coalesce(t.alias_state, 'literal') as state, count(*) as count from token t join token_set s on s.id = t.token_set_id
      where t.design_system_id = ${id} and s.publish_state = 'published' group by 1 order by 2 desc`),
    db.execute<{ tier: string | null; state: string; count: string }>(sql`
      select t.tier, t.tier_state as state, count(*) as count from token t join token_set s on s.id = t.token_set_id
      where t.design_system_id = ${id} and s.publish_state = 'published' group by 1, 2 order by 3 desc`),
    db.execute<{ name: string; set_slug: string; theme: string | null; resolved_value: Json; value_text: string | null }>(sql`
      select t.name, s.slug as set_slug, s.theme, t.resolved_value, t.value_text
      from token t join token_set s on s.id = t.token_set_id
      where t.design_system_id = ${id} and s.publish_state = 'published' and t.category = 'color' and t.deprecated = false
        and coalesce(t.alias_state, 'literal') in ('literal', 'resolved') and t.resolved_value is not null
      order by (s.theme is null or s.theme ilike 'light%') desc, (t.tier = 'semantic') desc, coalesce(array_length(t.path, 1), 9), length(t.name), t.name
      limit 240`),
    db.execute<{
      slug: string;
      name: string;
      description: string | null;
      docs_url: string | null;
      type_slug: string | null;
      type_name: string | null;
      classification_state: VerificationState;
      components: string;
    }>(sql`
      select p.slug, p.name, p.description, p.docs_url, pt.slug as type_slug, pt.name as type_name, p.classification_state,
        (select count(*) from pattern_component pc where pc.pattern_id = p.id) as components
      from design_pattern p left join pattern_type pt on pt.id = p.pattern_type_id
      where p.design_system_id = ${id} and p.publish_state = 'published' order by p.name`),
    db.execute<{ components: string; a11y: Record<string, number> | null; keyboard: Record<string, number> | null; with_kbd: string }>(sql`
      with c as (select c.id, c.coverage from component c where c.design_system_id = ${id} and c.publish_state = 'published')
      select
        (select count(*) from c) as components,
        (select json_object_agg(s, n) from (select coalesce(coverage->>'accessibility', 'not-extracted') as s, count(*) as n from c group by 1) x) as a11y,
        (select json_object_agg(s, n) from (select coalesce(coverage->>'keyboard', 'not-extracted') as s, count(*) as n from c group by 1) x) as keyboard,
        (select count(*) from component_accessibility ca join c on c.id = ca.component_id
          where ca.keyboard is not null and jsonb_typeof(ca.keyboard) = 'array' and jsonb_array_length(ca.keyboard) > 0) as with_kbd`),
    db.execute<{ pattern: string; count: string }>(sql`
      select ca.aria_pattern as pattern, count(*) as count from component_accessibility ca join component c on c.id = ca.component_id
      where c.design_system_id = ${id} and c.publish_state = 'published' and ca.aria_pattern is not null
      group by 1 order by 2 desc, 1`),
    db.execute<{ criterion: string; count: string }>(sql`
      select w as criterion, count(*) as count from component_accessibility ca join component c on c.id = ca.component_id
      cross join lateral unnest(ca.wcag_criteria) w
      where c.design_system_id = ${id} and c.publish_state = 'published'
      group by 1 order by 2 desc, 1 limit 24`),
    db.execute<{
      id: string;
      kind: string;
      url: string;
      label: string | null;
      is_official: boolean;
      robots_allowed: boolean | null;
      last_checked_at: string | null;
      last_status: number | null;
      last_error: string | null;
      discovered_by: string;
      documents: string;
      docs_last_fetched: string | null;
      doc_statuses: { status: number | null; count: number }[] | null;
    }>(sql`
      with d as (
        select source_id, count(*) as n, max(last_fetched_at) as last_fetched from source_document where design_system_id = ${id} group by 1
      ), ds as (
        select source_id, json_agg(json_build_object('status', st, 'count', n) order by n desc) as statuses
        from (select source_id, last_status as st, count(*) as n from source_document where design_system_id = ${id} group by 1, 2) x group by 1
      )
      select s.id, s.kind, s.url, s.label, s.is_official, s.robots_allowed, s.last_checked_at::text, s.last_status, s.last_error, s.discovered_by,
        coalesce(d.n, 0) as documents, d.last_fetched::text as docs_last_fetched, ds.statuses as doc_statuses
      from source s left join d on d.source_id = s.id left join ds on ds.source_id = s.id
      where s.design_system_id = ${id}
      order by case s.kind when 'homepage' then 0 when 'docs' then 1 when 'docs-site' then 2 when 'repository' then 3 when 'storybook' then 4 when 'figma' then 5 when 'package' then 6 else 7 end, s.url`),
    db.execute<{ subject_type: string; state: VerificationState; count: string }>(sql`
      select subject_type, state, count(*) as count from verification_evidence where design_system_id = ${id} group by 1, 2 order by 1, 3 desc`),
    db.execute<{ host: string; count: string; last: string | null }>(sql`
      select regexp_replace(substring(source_url from '^[a-z]+://([^/:?#]+)'), '^www\\.', '') as host, count(*) as count, max(retrieved_at)::text as last
      from verification_evidence where design_system_id = ${id} group by 1 order by 2 desc limit 6`),
    db.execute<{ slug: string; name: string; relation: RelatedSystem["relation"]; registry_status: RegistryStatus; published: boolean }>(sql`
      with me as (select slug, related_slugs, replaces_slug, replaced_by_slug, duplicate_of_slug from design_system where id = ${id}),
      rel as (
        select unnest(me.related_slugs) as slug, 'related'::text as relation from me
        union all select me.replaces_slug, 'replaces' from me where me.replaces_slug is not null
        union all select me.replaced_by_slug, 'replaced-by' from me where me.replaced_by_slug is not null
        union all select me.duplicate_of_slug, 'duplicate-of' from me where me.duplicate_of_slug is not null
        union all select o.slug, 'related-from' from design_system o, me where me.slug = any(o.related_slugs) and o.id <> ${id}
        union all select o.slug, 'duplicated-by' from design_system o, me where o.duplicate_of_slug = me.slug
      )
      select distinct on (rel.slug, rel.relation) rel.slug, coalesce(o.name, rel.slug) as name, rel.relation,
        coalesce(o.registry_status, 'candidate') as registry_status,
        coalesce(o.publish_state = 'published' and o.registry_status = 'verified', false) as published
      from rel left join design_system o on o.slug = rel.slug
      order by rel.slug, rel.relation`),
  ]);

  // official documentation hosts first, then by evidence volume
  const officialHosts = new Set([c.docs_url, c.homepage_url].map((u) => hostOf(u as string | null)).filter(Boolean));
  const host = [...evHosts.rows].sort((a, b) => Number(officialHosts.has(b.host)) - Number(officialHosts.has(a.host)) || num(b.count) - num(a.count));
  const toNumMap = (m: Record<string, number> | null) => Object.fromEntries(Object.entries(m ?? {}).map(([k, v]) => [k, Number(v)])) as Partial<Record<CoverageState, number>>;
  const a = a11y.rows[0];
  const cnt = counts.rows[0]!;
  const regChecks = ((c.registry_evidence as { checks?: RegistryCheck[] } | null)?.checks ?? []) as RegistryCheck[];

  return {
    core: {
      id,
      slug: c.slug as string,
      name: c.name as string,
      aliases: (c.aliases as string[]) ?? [],
      organization: c.org_slug ? { slug: c.org_slug as string, name: c.org_name as string, websiteUrl: (c.org_url as string | null) ?? null } : null,
      category: c.category as SystemCategory,
      summary: (c.summary as string | null) ?? null,
      philosophy: (c.philosophy as string | null) ?? null,
      principles: (c.principles as SystemCore["principles"]) ?? null,
      homepageUrl: (c.homepage_url as string | null) ?? null,
      docsUrl: (c.docs_url as string | null) ?? null,
      repositoryUrl: (c.repository_url as string | null) ?? null,
      figmaUrl: (c.figma_url as string | null) ?? null,
      storybookUrl: (c.storybook_url as string | null) ?? null,
      packages: ((c.packages as SystemCore["packages"] | null) ?? []).filter(Boolean),
      license: (c.license_json as SystemCore["license"]) ?? null,
      docAccess: c.doc_access as DocAccess,
      maintenance: c.maintenance_status as MaintenanceStatus,
      latestVersion: (c.latest_version as string | null) ?? null,
      latestReleaseAt: iso(c.latest_release_at),
      registryStatus: c.registry_status as RegistryStatus,
      registryRank: (c.registry_rank as number | null) ?? null,
      registryNotes: (c.registry_notes as string | null) ?? null,
      duplicateOfSlug: (c.duplicate_of_slug as string | null) ?? null,
      replacesSlug: (c.replaces_slug as string | null) ?? null,
      replacedBySlug: (c.replaced_by_slug as string | null) ?? null,
      relatedSlugs: (c.related_slugs as string[]) ?? [],
      registryChecks: regChecks,
      ingestionStatus: c.published_status as IngestionStatus,
      adapterId: (c.adapter_id as string | null) ?? null,
      confidence: Number(c.confidence),
      lastVerifiedAt: iso(c.last_verified_at),
      lastIngestedAt: iso(c.last_ingested_at),
      publishState: c.publish_state as string,
    },
    frameworks: fw.rows.map((x) => ({ slug: x.slug, name: x.name, kind: x.kind, support: x.support, packageName: x.package_name, state: x.verification_state, sourceUrl: x.source_url })),
    platforms: pl.rows.map((x) => ({ slug: x.slug, name: x.name, state: x.verification_state, sourceUrl: x.source_url })),
    tags: tg.rows.map((x) => ({ slug: x.slug, name: x.name, state: x.verification_state })),
    counts: {
      components: num(cnt.components),
      tokens: num(cnt.tokens),
      tokenSets: num(cnt.token_sets),
      patterns: num(cnt.patterns),
      evidence: num(cnt.evidence),
      sources: num(cnt.sources),
      documents: num(cnt.documents),
    },
    factEvidence: ev.rows.map((x) => ({
      id: x.id,
      field: x.field,
      sourceUrl: x.source_url,
      sourceTitle: x.source_title,
      retrievedAt: iso(x.retrieved_at)!,
      contentHash: x.content_hash,
      extractionMethod: x.extraction_method,
      location: x.location,
      excerpt: x.excerpt,
      state: x.state,
      confidence: Number(x.confidence),
    })),
    components: comps.rows.map((x) => ({
      id: x.id,
      slug: x.slug,
      name: x.name,
      lifecycle: x.lifecycle,
      docsUrl: x.docs_url,
      typeSlug: x.type_slug,
      typeName: x.type_name,
      group: x.group_slug,
      typeSortOrder: x.type_sort ?? 9999,
      classificationState: x.classification_state,
      classificationMethod: x.classification_method,
      confidence: Number(x.confidence),
      coverage: x.coverage ?? {},
      variants: num(x.variants),
      properties: num(x.properties),
      hasA11yRecord: !!x.has_a11y,
    })),
    tokenSets: sets.rows.map((x) => ({
      slug: x.slug,
      name: x.name,
      theme: x.theme,
      format: x.format,
      sourceUrl: x.source_url,
      packageName: x.package_name,
      packageVersion: x.package_version,
      redistribution: x.redistribution,
      tokens: num(x.tokens),
    })),
    tokenCategories: cats.rows.map((x) => ({ category: x.category, count: num(x.count) })),
    aliasStates: aliases.rows.map((x) => ({ state: x.state, count: num(x.count) })),
    tokenTiers: tiers.rows.map((x) => ({ tier: x.tier, state: x.state, count: num(x.count) })),
    swatchCandidates: swatches.rows.map((x) => ({ name: x.name, setSlug: x.set_slug, theme: x.theme, resolved: x.resolved_value, valueText: x.value_text })),
    patterns: pats.rows.map((x) => ({
      slug: x.slug,
      name: x.name,
      description: x.description,
      docsUrl: x.docs_url,
      typeSlug: x.type_slug,
      typeName: x.type_name,
      classificationState: x.classification_state,
      components: num(x.components),
    })),
    accessibility: {
      components: num(a?.components),
      a11yCoverage: toNumMap(a?.a11y ?? null),
      keyboardCoverage: toNumMap(a?.keyboard ?? null),
      withKeyboardInteractions: num(a?.with_kbd),
      ariaPatterns: aria.rows.map((x) => ({ pattern: x.pattern, count: num(x.count) })),
      wcag: wcag.rows.map((x) => ({ criterion: x.criterion, count: num(x.count) })),
    },
    sources: sources.rows.map((x) => ({
      id: x.id,
      kind: x.kind,
      url: x.url,
      label: x.label,
      isOfficial: x.is_official,
      robotsAllowed: x.robots_allowed,
      lastCheckedAt: iso(x.last_checked_at),
      lastStatus: x.last_status,
      lastError: x.last_error,
      discoveredBy: x.discovered_by,
      documents: num(x.documents),
      documentsLastFetchedAt: iso(x.docs_last_fetched),
      documentStatuses: (x.doc_statuses ?? []).map((d) => ({ status: d.status === null ? null : Number(d.status), count: Number(d.count) })),
    })),
    evidenceBySubject: evBySubject.rows.map((x) => ({ subjectType: x.subject_type, state: x.state, count: num(x.count) })),
    evidenceHosts: host.map((x) => ({ host: x.host, count: num(x.count) })),
    lastRetrievedAt: host.reduce<string | null>((m, x) => (x.last && (!m || x.last > m) ? x.last : m), null),
    related: related.rows.map((x) => ({ slug: x.slug, name: x.name, relation: x.relation, registryStatus: x.registry_status, published: x.published })),
  };
}

export const CHANGES_PAGE_SIZE = 12;
const CHANGE_LABEL_CAP = 60;

/**
 * Change history as batches: events of one run (or registry update), entity type and change kind
 * within the same minute are one timeline entry, newest first. Paginated by batch.
 */
export async function getSystemChanges(
  systemId: string,
  page: number,
): Promise<{ rows: DetailChange[]; total: number; batches: number; page: number; pages: number }> {
  const db = await readDb();
  const p = Math.max(page, 1);
  const r = await db.execute<{
    run_id: string | null;
    entity_type: string;
    change_kind: string;
    n: string;
    last_at: string;
    labels: string[] | null;
    summaries: { summary: string; count: number }[] | null;
    total_events: string;
    total_batches: string;
  }>(sql`
    with ev as (
      select ce.*, date_trunc('minute', ce.occurred_at) as bucket from change_event ce where ce.design_system_id = ${systemId}
    ), b as (
      select run_id, entity_type, change_kind, bucket, count(*) as n, max(occurred_at) as last_at,
        (array_agg(entity_label order by entity_label) filter (where entity_label is not null))[1:${CHANGE_LABEL_CAP}] as labels
      from ev group by 1, 2, 3, 4
    ), s as (
      select ev.run_id, ev.entity_type, ev.change_kind, ev.bucket, fc->>'summary' as summary, count(*) as c
      from ev cross join lateral jsonb_array_elements(case when jsonb_typeof(ev.field_changes) = 'array' then ev.field_changes else '[]'::jsonb end) fc
      where fc->>'summary' is not null
      group by 1, 2, 3, 4, 5
    )
    select b.run_id, b.entity_type, b.change_kind, b.n, b.last_at::text, b.labels,
      (select json_agg(json_build_object('summary', s.summary, 'count', s.c) order by s.c desc, s.summary) from s
        where s.run_id is not distinct from b.run_id and s.entity_type = b.entity_type and s.change_kind = b.change_kind and s.bucket = b.bucket) as summaries,
      (select count(*) from ev) as total_events,
      (select count(*) from b) as total_batches
    from b
    order by b.last_at desc, b.entity_type, b.change_kind
    limit ${CHANGES_PAGE_SIZE} offset ${(p - 1) * CHANGES_PAGE_SIZE}
  `);
  let total = num(r.rows[0]?.total_events);
  let batches = num(r.rows[0]?.total_batches);
  if (!r.rows.length && p > 1) {
    // out-of-range page: still report totals
    const t = await db.execute<{ e: string; b: string }>(sql`
      select count(*) as e, count(distinct (run_id, entity_type, change_kind, date_trunc('minute', occurred_at))) as b
      from change_event where design_system_id = ${systemId}`);
    total = num(t.rows[0]?.e);
    batches = num(t.rows[0]?.b);
  }
  return {
    total,
    batches,
    page: p,
    pages: Math.max(1, Math.ceil(batches / CHANGES_PAGE_SIZE)),
    rows: r.rows.map((x) => ({
      id: `${x.run_id ?? "registry"}:${x.entity_type}:${x.change_kind}:${x.last_at}`,
      runId: x.run_id,
      entityType: x.entity_type,
      changeKind: x.change_kind,
      count: num(x.n),
      occurredAt: iso(x.last_at)!,
      labels: x.labels ?? [],
      summaries: (x.summaries ?? []).map((y) => ({ summary: y.summary, count: num(y.count) })),
    })),
  };
}

/** Minimal lookup for metadata (cheap; no aggregation). */
export async function getSystemMeta(slug: string): Promise<{ name: string; summary: string | null; organization: string | null } | null> {
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(slug)) return null;
  const db = await readDb();
  const r = await db.execute<{ name: string; summary: string | null; org: string | null }>(sql`
    select ds.name, ds.summary, o.name as org from design_system ds left join organization o on o.id = ds.organization_id
    where ds.slug = ${slug} and ds.registry_status = 'verified' and ds.publish_state = 'published'`);
  const x = r.rows[0];
  return x ? { name: x.name, summary: x.summary, organization: x.org } : null;
}

/** Resolve system slugs to display names (search facets). */
export async function getSystemNames(slugs: string[]): Promise<Record<string, string>> {
  const clean = slugs.filter((s) => /^[a-z0-9][a-z0-9-]{0,79}$/.test(s)).slice(0, 100);
  if (!clean.length) return {};
  const db = await readDb();
  const r = await db.execute<{ slug: string; name: string }>(sql`select slug, name from design_system where slug = any(${sql.param(clean)}::text[])`);
  return Object.fromEntries(r.rows.map((x) => [x.slug, x.name]));
}
