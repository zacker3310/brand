/**
 * Read models for the home page. Every number is aggregated from canonical records at request time.
 * (Self-contained: copies the parts of stats.ts it needs rather than coupling to it.)
 */
import { sql } from "drizzle-orm";
import type { ActivityCounts, FeaturedCandidate, TypeImplementation } from "@/components/discovery/lib/home";
import { readDb } from "./db";

const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const iso = (v: unknown): string | null => (v ? new Date(v as string).toISOString() : null);

export interface HomeStats {
  systemsVerified: number;
  systemsIndexed: number;
  systemsPartial: number;
  systemsInventory: number;
  systemsMetadataOnly: number;
  components: number;
  componentsClassified: number;
  componentsClassifiedVerified: number;
  componentTypesCovered: number;
  componentTypes: number;
  tokens: number;
  tokenSets: number;
  patterns: number;
  evidence: number;
  evidenceVerified: number;
  evidenceInferred: number;
  evidenceUnavailable: number;
  sources: number;
  documents: number;
  /** Component fields (from coverage maps) ATLAS has not extracted yet, across published components. */
  fieldsNotExtracted: number;
  fieldsNotDocumented: number;
  fieldsTotal: number;
  registryRejected: number;
  registryDuplicate: number;
  lastIngestedAt: string | null;
  lastVerifiedAt: string | null;
}

/** Scope: published, verified systems (the directory). Records of rejected entries are not counted. */
export async function getHomeStats(): Promise<HomeStats> {
  const db = await readDb();
  const r = await db.execute<Record<string, string | null>>(sql`
    with sys as (select id, ingestion_status from design_system where registry_status = 'verified' and publish_state = 'published'),
    comp as (select c.* from component c join sys on sys.id = c.design_system_id where c.publish_state = 'published')
    select
      (select count(*) from sys) as systems_verified,
      (select count(*) from sys where ingestion_status = 'indexed') as systems_indexed,
      (select count(*) from sys where ingestion_status = 'partial') as systems_partial,
      (select count(*) from sys where ingestion_status = 'inventory') as systems_inventory,
      (select count(*) from sys where ingestion_status not in ('indexed', 'partial', 'inventory')) as systems_metadata,
      (select count(*) from comp) as components,
      (select count(*) from comp where component_type_id is not null) as components_classified,
      (select count(*) from comp where component_type_id is not null and classification_state = 'verified') as components_classified_verified,
      (select count(distinct component_type_id) from comp where component_type_id is not null) as component_types_covered,
      (select count(*) from component_type) as component_types,
      (select count(*) from token t join token_set s on s.id = t.token_set_id join sys on sys.id = s.design_system_id where s.publish_state = 'published') as tokens,
      (select count(*) from token_set s join sys on sys.id = s.design_system_id where s.publish_state = 'published') as token_sets,
      (select count(*) from design_pattern p join sys on sys.id = p.design_system_id where p.publish_state = 'published') as patterns,
      (select count(*) from verification_evidence e join sys on sys.id = e.design_system_id) as evidence,
      (select count(*) from verification_evidence e join sys on sys.id = e.design_system_id where e.state = 'verified') as evidence_verified,
      (select count(*) from verification_evidence e join sys on sys.id = e.design_system_id where e.state = 'inferred') as evidence_inferred,
      (select count(*) from verification_evidence e join sys on sys.id = e.design_system_id where e.state = 'unavailable') as evidence_unavailable,
      (select count(*) from source s join sys on sys.id = s.design_system_id) as sources,
      (select count(*) from source_document d join sys on sys.id = d.design_system_id) as documents,
      (select count(*) from comp, jsonb_each_text(comp.coverage) kv where kv.value = 'not-extracted') as fields_not_extracted,
      (select count(*) from comp, jsonb_each_text(comp.coverage) kv where kv.value = 'not-documented') as fields_not_documented,
      (select count(*) from comp, jsonb_each_text(comp.coverage) kv) as fields_total,
      (select count(*) from design_system where registry_status = 'rejected') as registry_rejected,
      (select count(*) from design_system where registry_status = 'duplicate') as registry_duplicate,
      (select max(last_ingested_at)::text from design_system where registry_status = 'verified' and publish_state = 'published') as last_ingested_at,
      (select max(last_verified_at)::text from design_system where registry_status = 'verified' and publish_state = 'published') as last_verified_at
  `);
  const x = r.rows[0]!;
  return {
    systemsVerified: num(x.systems_verified),
    systemsIndexed: num(x.systems_indexed),
    systemsPartial: num(x.systems_partial),
    systemsInventory: num(x.systems_inventory),
    systemsMetadataOnly: num(x.systems_metadata),
    components: num(x.components),
    componentsClassified: num(x.components_classified),
    componentsClassifiedVerified: num(x.components_classified_verified),
    componentTypesCovered: num(x.component_types_covered),
    componentTypes: num(x.component_types),
    tokens: num(x.tokens),
    tokenSets: num(x.token_sets),
    patterns: num(x.patterns),
    evidence: num(x.evidence),
    evidenceVerified: num(x.evidence_verified),
    evidenceInferred: num(x.evidence_inferred),
    evidenceUnavailable: num(x.evidence_unavailable),
    sources: num(x.sources),
    documents: num(x.documents),
    fieldsNotExtracted: num(x.fields_not_extracted),
    fieldsNotDocumented: num(x.fields_not_documented),
    fieldsTotal: num(x.fields_total),
    registryRejected: num(x.registry_rejected),
    registryDuplicate: num(x.registry_duplicate),
    lastIngestedAt: iso(x.last_ingested_at),
    lastVerifiedAt: iso(x.last_verified_at),
  };
}

export interface FeaturedRow extends FeaturedCandidate {
  organization: string | null;
  category: string;
  summary: string | null;
  lastIngestedAt: string | null;
  tokenSets: number;
  frameworks: string[];
}

/** Candidates for "most deeply indexed": every published verified system with any deep records. */
export async function getFeaturedCandidates(): Promise<FeaturedRow[]> {
  const db = await readDb();
  const r = await db.execute<{
    slug: string;
    name: string;
    org: string | null;
    category: string;
    summary: string | null;
    registry_rank: number | null;
    last_ingested_at: string | null;
    components: string;
    tokens: string;
    token_sets: string;
    patterns: string;
    frameworks: string[] | null;
  }>(sql`
    with comp as (select design_system_id, count(*) as n from component where publish_state = 'published' group by 1),
    tok as (select t.design_system_id, count(*) as n from token t join token_set s on s.id = t.token_set_id where s.publish_state = 'published' group by 1),
    sets as (select design_system_id, count(*) as n from token_set where publish_state = 'published' group by 1),
    pat as (select design_system_id, count(*) as n from design_pattern where publish_state = 'published' group by 1),
    fw as (
      select dsf.design_system_id, array_agg(f.name order by f.name) as names
      from design_system_framework dsf join framework f on f.id = dsf.framework_id
      where dsf.verification_state = 'verified' and f.kind <> 'design' group by 1
    )
    select ds.slug, ds.name, o.name as org, ds.category, ds.summary, ds.registry_rank, ds.last_ingested_at::text,
      coalesce(comp.n, 0) as components, coalesce(tok.n, 0) as tokens, coalesce(sets.n, 0) as token_sets, coalesce(pat.n, 0) as patterns,
      fw.names as frameworks
    from design_system ds
    left join organization o on o.id = ds.organization_id
    left join comp on comp.design_system_id = ds.id
    left join tok on tok.design_system_id = ds.id
    left join sets on sets.design_system_id = ds.id
    left join pat on pat.design_system_id = ds.id
    left join fw on fw.design_system_id = ds.id
    where ds.registry_status = 'verified' and ds.publish_state = 'published'
      and (comp.n is not null or tok.n is not null or pat.n is not null)
  `);
  return r.rows.map((x) => ({
    slug: x.slug,
    name: x.name,
    organization: x.org,
    category: x.category,
    summary: x.summary,
    registryRank: x.registry_rank,
    lastIngestedAt: iso(x.last_ingested_at),
    components: num(x.components),
    tokens: num(x.tokens),
    tokenSets: num(x.token_sets),
    patterns: num(x.patterns),
    frameworks: x.frameworks ?? [],
  }));
}

export interface GroupStat {
  slug: string;
  name: string;
  description: string | null;
  sortOrder: number;
  types: number;
  typesImplemented: number;
  implementations: number;
  systems: number;
  topTypes: { slug: string; name: string; implementations: number }[];
}

/** Component groups: canonical types per group and published implementations in verified systems. */
export async function getComponentGroupStats(): Promise<GroupStat[]> {
  const db = await readDb();
  const r = await db.execute<{
    slug: string;
    name: string;
    description: string | null;
    sort_order: number;
    types: string;
    types_implemented: string;
    implementations: string;
    systems: string;
    top_types: { slug: string; name: string; n: number }[] | null;
  }>(sql`
    with impl as (
      select c.component_type_id, c.design_system_id
      from component c join design_system ds on ds.id = c.design_system_id
      where c.publish_state = 'published' and c.component_type_id is not null
        and ds.registry_status = 'verified' and ds.publish_state = 'published'
    ), per_type as (
      select ct.id, ct.slug, ct.name, ct.category_id, ct.sort_order, count(impl.component_type_id) as n
      from component_type ct left join impl on impl.component_type_id = ct.id
      group by ct.id
    )
    select cat.slug, cat.name, cat.description, cat.sort_order,
      (select count(*) from per_type pt where pt.category_id = cat.id) as types,
      (select count(*) from per_type pt where pt.category_id = cat.id and pt.n > 0) as types_implemented,
      (select coalesce(sum(pt.n), 0) from per_type pt where pt.category_id = cat.id) as implementations,
      (select count(distinct impl.design_system_id) from impl join component_type ct on ct.id = impl.component_type_id where ct.category_id = cat.id) as systems,
      (select json_agg(json_build_object('slug', x.slug, 'name', x.name, 'n', x.n)) from (
        select pt.slug, pt.name, pt.n from per_type pt where pt.category_id = cat.id and pt.n > 0 order by pt.n desc, pt.sort_order limit 4) x) as top_types
    from category cat where cat.kind = 'component-group'
    order by cat.sort_order, cat.name
  `);
  return r.rows.map((x) => ({
    slug: x.slug,
    name: x.name,
    description: x.description,
    sortOrder: x.sort_order,
    types: num(x.types),
    typesImplemented: num(x.types_implemented),
    implementations: num(x.implementations),
    systems: num(x.systems),
    topTypes: (x.top_types ?? []).map((t) => ({ slug: t.slug, name: t.name, implementations: num(t.n) })),
  }));
}

/** Per canonical type: which verified systems implement it, and how those classifications were made. */
export async function getTypeImplementations(): Promise<TypeImplementation[]> {
  const db = await readDb();
  const r = await db.execute<{
    type_slug: string;
    type_name: string;
    group_slug: string;
    sort_order: number;
    systems: { slug: string; name: string; rank: number | null; verified: number; inferred: number }[];
  }>(sql`
    with per as (
      select c.component_type_id, ds.slug, ds.name, ds.registry_rank as rank,
        count(*) filter (where c.classification_state = 'verified') as verified,
        count(*) filter (where c.classification_state <> 'verified') as inferred
      from component c join design_system ds on ds.id = c.design_system_id
      where c.publish_state = 'published' and c.component_type_id is not null
        and ds.registry_status = 'verified' and ds.publish_state = 'published'
      group by 1, 2, 3, 4
    )
    select ct.slug as type_slug, ct.name as type_name, cat.slug as group_slug, ct.sort_order,
      json_agg(json_build_object('slug', per.slug, 'name', per.name, 'rank', per.rank, 'verified', per.verified, 'inferred', per.inferred)) as systems
    from per join component_type ct on ct.id = per.component_type_id join category cat on cat.id = ct.category_id
    group by ct.slug, ct.name, cat.slug, ct.sort_order
    having count(*) >= 2
  `);
  return r.rows.map((x) => ({
    typeSlug: x.type_slug,
    typeName: x.type_name,
    group: x.group_slug,
    typeSortOrder: x.sort_order,
    systems: x.systems.map((s) => ({ slug: s.slug, name: s.name, registryRank: s.rank, verified: num(s.verified), inferred: num(s.inferred) })),
  }));
}

export interface RecentSystem {
  slug: string;
  name: string;
  organization: string | null;
  ingestionStatus: string;
  lastIngestedAt: string | null;
  lastActivityAt: string;
  /** "ingest" when a deep ingestion run drove the latest activity; "registry" for registry re-verification only. */
  kind: "ingest" | "registry";
  counts: ActivityCounts[];
  registrySummaries: string[];
}

/**
 * Recently updated systems. Activity = greatest(last_ingested_at, latest change_event), ignoring the
 * initial registry import events (every system has one; they carry no signal). Counts cover the
 * system's change events in the 7 days before its latest activity.
 */
export async function getRecentlyUpdated(limit = 6): Promise<RecentSystem[]> {
  const db = await readDb();
  const r = await db.execute<{
    slug: string;
    name: string;
    org: string | null;
    ingestion_status: string;
    last_ingested_at: string | null;
    last_activity: string;
    counts: { entityType: string; changeKind: string; count: number }[] | null;
    registry_summaries: string[] | null;
    last_run_at: string | null;
  }>(sql`
    with ev as (
      select ce.* from change_event ce
      where not (ce.entity_type = 'design_system' and ce.change_kind = 'created' and ce.run_id is null)
    ), latest as (
      select ds.id, ds.slug, ds.name, ds.organization_id, ds.ingestion_status, ds.last_ingested_at,
        greatest(ds.last_ingested_at, (select max(ev.occurred_at) from ev where ev.design_system_id = ds.id)) as last_activity,
        (select max(ev.occurred_at) from ev where ev.design_system_id = ds.id and ev.run_id is not null) as last_run_at
      from design_system ds
      where ds.registry_status = 'verified' and ds.publish_state = 'published'
    )
    select l.slug, l.name, o.name as org, l.ingestion_status, l.last_ingested_at::text, l.last_activity::text, l.last_run_at::text,
      (select json_agg(json_build_object('entityType', x.entity_type, 'changeKind', x.change_kind, 'count', x.n)) from (
        select ev.entity_type, ev.change_kind, count(*) as n from ev
        where ev.design_system_id = l.id and ev.occurred_at > l.last_activity - interval '7 days'
        group by 1, 2) x) as counts,
      (select array_agg(distinct fc->>'summary') from ev cross join lateral jsonb_array_elements(coalesce(ev.field_changes, '[]'::jsonb)) fc
        where ev.design_system_id = l.id and ev.entity_type = 'design_system' and ev.run_id is null
          and ev.occurred_at > l.last_activity - interval '7 days' and fc->>'summary' is not null) as registry_summaries
    from latest l left join organization o on o.id = l.organization_id
    where l.last_activity is not null
    order by l.last_activity desc, l.name
    limit ${limit}
  `);
  return r.rows.map((x) => {
    const lastIngested = iso(x.last_ingested_at);
    const lastActivity = iso(x.last_activity)!;
    const lastRun = iso(x.last_run_at);
    const ingestDriven = !!lastIngested && (lastIngested >= lastActivity || (!!lastRun && lastRun >= lastActivity));
    return {
      slug: x.slug,
      name: x.name,
      organization: x.org,
      ingestionStatus: x.ingestion_status,
      lastIngestedAt: lastIngested,
      lastActivityAt: lastActivity,
      kind: ingestDriven ? "ingest" : "registry",
      counts: (x.counts ?? []).map((c) => ({ entityType: c.entityType, changeKind: c.changeKind, count: num(c.count) })),
      registrySummaries: (x.registry_summaries ?? []).filter(Boolean).slice(0, 3),
    };
  });
}

export interface CuratedCollection {
  slug: string;
  ownerId: string;
  name: string;
  description: string | null;
  items: number;
  systems: { slug: string; name: string }[];
  updatedAt: string;
}

/** ATLAS editorial collections (is_curated, public). Empty => the home section is omitted. */
export async function getCuratedCollections(limit = 6): Promise<CuratedCollection[]> {
  const db = await readDb();
  const r = await db.execute<{
    slug: string;
    owner_id: string;
    name: string;
    description: string | null;
    items: string;
    systems: { slug: string; name: string }[] | null;
    updated_at: string;
  }>(sql`
    select c.slug, c.owner_id, c.name, c.description, c.updated_at::text,
      (select count(*) from collection_item ci where ci.collection_id = c.id) as items,
      (select json_agg(json_build_object('slug', ds.slug, 'name', ds.name) order by ci.position) from (
         select * from collection_item ci where ci.collection_id = c.id and ci.entity_type = 'system' order by ci.position limit 5) ci
         join design_system ds on ds.id = ci.entity_id) as systems
    from collection c
    where c.is_curated = true and c.visibility = 'public'
    order by c.updated_at desc, c.name
    limit ${limit}
  `);
  return r.rows.map((x) => ({
    slug: x.slug,
    ownerId: x.owner_id,
    name: x.name,
    description: x.description,
    items: num(x.items),
    systems: x.systems ?? [],
    updatedAt: iso(x.updated_at)!,
  }));
}
