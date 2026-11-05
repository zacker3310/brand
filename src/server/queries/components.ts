/**
 * Read models for the Universal Component Catalog (/components), component-type pages
 * (/components/[type]) and component detail (/systems/[slug]/components/[component]).
 *
 * All counts are aggregated in SQL from published records. User input only reaches SQL as bound
 * parameters (drizzle `sql` template); LIKE wildcards in queries are escaped.
 */
import { sql, type SQL } from "drizzle-orm";
import { COMPONENT_FIELDS, type CoverageMap, type KeyboardInteraction, type VerificationState } from "@/lib/contracts";
import { documentedShare } from "@/components/catalog/lib/coverage";
import { shortSystemName } from "@/components/catalog/lib/format";
import { escapeLike, PAGE_SIZE, type CatalogParams } from "@/components/catalog/lib/params";
import { expandCatalogQuery } from "@/components/catalog/lib/search";
import { readDb } from "./db";

/* -------------------------------------------------------------------------- */
/* Catalog base relation                                                       */
/* -------------------------------------------------------------------------- */

/**
 * One row per published component of a published system, with the attributes every facet
 * filters on. Materialized once per statement; facet counts and result pages read from it.
 */
const BASE_CTE = sql`
  base as materialized (
    select
      c.id,
      c.slug,
      c.name,
      c.aliases,
      array_to_string(c.aliases, ' ') as aliases_text,
      c.description,
      c.lifecycle,
      c.coverage,
      c.docs_url,
      c.source_code_url,
      c.classification_state::text as classification_state,
      c.classification_method,
      ds.slug as system_slug,
      ds.name as system_name,
      ct.slug as type_slug,
      ct.name as type_name,
      array_to_string(ct.aliases, ' ') as type_aliases_text,
      ct.aria_pattern,
      cat.slug as group_slug,
      case when c.component_type_id is null then 'unclassified' else c.classification_state::text end as cls,
      coalesce(fw.slugs, '{}'::text[]) as fws,
      coalesce(pl.slugs, '{}'::text[]) as pls,
      (c.coverage->>'accessibility' = 'documented' or c.coverage->>'keyboard' = 'documented') as has_a11y,
      (c.source_code_url is not null) as has_source,
      exists (select 1 from component_property p where p.component_id = c.id) as has_props,
      (select count(*) from jsonb_each_text(c.coverage) e
        where e.key = any(${sql.param([...COMPONENT_FIELDS])}::text[]) and e.value in ('documented', 'documented-none'))::int as doc_fields
    from component c
    join design_system ds on ds.id = c.design_system_id
    left join component_type ct on ct.id = c.component_type_id
    left join category cat on cat.id = ct.category_id
    left join lateral (
      select array_agg(distinct f.slug) as slugs
      from component_framework cf join framework f on f.id = cf.framework_id
      where cf.component_id = c.id
    ) fw on true
    left join lateral (
      select array_agg(distinct p.slug) as slugs
      from design_system_platform dp join platform p on p.id = dp.platform_id
      where dp.design_system_id = ds.id
    ) pl on true
    where c.publish_state = 'published' and ds.publish_state = 'published'
  )
`;

type ExcludeKey = "system" | "group" | "framework" | "platform" | "pattern" | "a11y" | "has:source" | "has:props" | "class";

function textCondition(q: string): SQL {
  const pat = `%${escapeLike(q)}%`;
  const { typeSlugs } = expandCatalogQuery(q);
  const expansion = typeSlugs.length ? sql` or b.type_slug = any(${sql.param(typeSlugs)}::text[])` : sql``;
  return sql`(b.name ilike ${pat} or b.slug ilike ${pat} or b.aliases_text ilike ${pat} or b.type_name ilike ${pat}
    or b.type_aliases_text ilike ${pat} or b.description ilike ${pat}${expansion})`;
}

function conditions(f: CatalogParams, exclude?: ExcludeKey): SQL {
  const parts: SQL[] = [];
  if (exclude !== "system" && f.systems.length) parts.push(sql`b.system_slug = any(${sql.param(f.systems)}::text[])`);
  if (exclude !== "group" && f.group) parts.push(sql`b.group_slug = ${f.group}`);
  if (exclude !== "framework" && f.frameworks.length) parts.push(sql`b.fws && ${sql.param(f.frameworks)}::text[]`);
  if (exclude !== "platform" && f.platforms.length) parts.push(sql`b.pls && ${sql.param(f.platforms)}::text[]`);
  if (exclude !== "pattern" && f.patterns.length) parts.push(sql`b.aria_pattern = any(${sql.param(f.patterns)}::text[])`);
  if (exclude !== "a11y" && f.a11y) parts.push(sql`b.has_a11y`);
  if (exclude !== "has:source" && f.has.includes("source")) parts.push(sql`b.has_source`);
  if (exclude !== "has:props" && f.has.includes("props")) parts.push(sql`b.has_props`);
  if (exclude !== "class" && f.classification.length) parts.push(sql`b.cls = any(${sql.param(f.classification)}::text[])`);
  if (f.q) parts.push(textCondition(f.q));
  return parts.length ? sql.join(parts, sql` and `) : sql`true`;
}

/* -------------------------------------------------------------------------- */
/* Facets                                                                      */
/* -------------------------------------------------------------------------- */

export interface FacetCount {
  value: string;
  label: string | null;
  count: number;
}

export interface CatalogFacets {
  system: FacetCount[];
  group: FacetCount[];
  framework: FacetCount[];
  platform: FacetCount[];
  pattern: FacetCount[];
  a11y: FacetCount[];
  has: FacetCount[];
  class: FacetCount[];
  /** Components matching every active filter. */
  matching: number;
  /** Components matching every filter except group (the "All groups" option). */
  groupAll: number;
  /** Canonical types with at least one implementation matching every active filter. */
  typesMatching: number;
  /** All published components. */
  universe: number;
  /** Published systems with at least one published component. */
  systemsWithComponents: number;
  /** Published (verified) systems in the registry. */
  systemsPublished: number;
  /** Canonical types in the taxonomy. */
  typesTotal: number;
  /** Canonical types with at least one published implementation. */
  typesImplemented: number;
}

/** Facet counts. Each facet is counted under all other active filters (standard disjunctive faceting). */
export async function getCatalogFacets(f: CatalogParams): Promise<CatalogFacets> {
  const db = await readDb();
  const r = await db.execute<{ facet: string; value: string; label: string | null; n: number }>(sql`
    with ${BASE_CTE}
    select 'system' as facet, b.system_slug as value, max(b.system_name) as label, (count(*) filter (where ${conditions(f, "system")}))::int as n
      from base b group by b.system_slug
    union all
    select 'group', b.group_slug, null, (count(*) filter (where ${conditions(f, "group")}))::int
      from base b where b.group_slug is not null group by b.group_slug
    union all
    select 'framework', x, null, (count(*) filter (where ${conditions(f, "framework")}))::int
      from base b cross join lateral unnest(b.fws) x group by x
    union all
    select 'platform', x, null, (count(*) filter (where ${conditions(f, "platform")}))::int
      from base b cross join lateral unnest(b.pls) x group by x
    union all
    select 'pattern', b.aria_pattern, null, (count(*) filter (where ${conditions(f, "pattern")}))::int
      from base b where b.aria_pattern is not null group by b.aria_pattern
    union all
    select 'a11y', 'documented', null, (count(*) filter (where b.has_a11y and ${conditions(f, "a11y")}))::int from base b
    union all
    select 'has', 'source', null, (count(*) filter (where b.has_source and ${conditions(f, "has:source")}))::int from base b
    union all
    select 'has', 'props', null, (count(*) filter (where b.has_props and ${conditions(f, "has:props")}))::int from base b
    union all
    select 'class', b.cls, null, (count(*) filter (where ${conditions(f, "class")}))::int from base b group by b.cls
    union all
    select 'total', 'matching', null, (count(*) filter (where ${conditions(f)}))::int from base b
    union all
    select 'total', 'typesMatching', null, (count(distinct b.type_slug) filter (where ${conditions(f)}))::int from base b
    union all
    select 'total', 'groupAll', null, (count(*) filter (where ${conditions(f, "group")}))::int from base b
    union all
    select 'total', 'universe', null, count(*)::int from base b
    union all
    select 'total', 'systemsWithComponents', null, count(distinct b.system_slug)::int from base b
    union all
    select 'total', 'typesImplemented', null, count(distinct b.type_slug)::int from base b
    union all
    select 'total', 'typesTotal', null, (select count(*) from component_type)::int
    union all
    select 'total', 'systemsPublished', null,
      (select count(*) from design_system where publish_state = 'published' and registry_status = 'verified')::int
  `);
  const out: CatalogFacets = {
    system: [],
    group: [],
    framework: [],
    platform: [],
    pattern: [],
    a11y: [],
    has: [],
    class: [],
    matching: 0,
    groupAll: 0,
    typesMatching: 0,
    universe: 0,
    systemsWithComponents: 0,
    systemsPublished: 0,
    typesTotal: 0,
    typesImplemented: 0,
  };
  for (const row of r.rows) {
    if (row.facet === "total") {
      (out as unknown as Record<string, number>)[row.value] = Number(row.n);
      continue;
    }
    const list = (out as unknown as Record<string, FacetCount[]>)[row.facet];
    list?.push({ value: row.value, label: row.label, count: Number(row.n) });
  }
  return out;
}

export interface SystemLabel {
  slug: string;
  name: string;
  shortName: string;
  componentCount: number;
  ingestionStatus: string;
}

/** Names for every published system that has published components (display labels for facets, matrix columns). */
export async function getSystemLabels(): Promise<Map<string, SystemLabel>> {
  const db = await readDb();
  const r = await db.execute<{ slug: string; name: string; org_name: string | null; n: number; ingestion_status: string }>(sql`
    select ds.slug, ds.name, o.name as org_name, count(c.id)::int as n, ds.ingestion_status::text as ingestion_status
    from design_system ds
    join component c on c.design_system_id = ds.id and c.publish_state = 'published'
    left join organization o on o.id = ds.organization_id
    where ds.publish_state = 'published'
    group by ds.id, ds.slug, ds.name, o.name
    order by count(c.id) desc, ds.name
  `);
  return new Map(
    r.rows.map((x) => [
      x.slug,
      { slug: x.slug, name: x.name, shortName: shortSystemName(x.name, x.org_name), componentCount: Number(x.n), ingestionStatus: x.ingestion_status },
    ]),
  );
}

/* -------------------------------------------------------------------------- */
/* Components view                                                             */
/* -------------------------------------------------------------------------- */

export interface CatalogComponentRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  lifecycle: string;
  coverage: CoverageMap;
  systemSlug: string;
  systemName: string;
  typeSlug: string | null;
  typeName: string | null;
  classificationState: VerificationState;
  classificationMethod: string | null;
  frameworks: string[];
  propsCount: number;
  docsUrl: string | null;
  hasSource: boolean;
}

function orderBy(f: CatalogParams): SQL {
  switch (f.sort) {
    case "name":
      return sql`lower(b.name), b.system_name`;
    case "system":
      return sql`b.system_name, lower(b.name)`;
    case "type":
      return sql`b.type_name nulls last, b.system_name, lower(b.name)`;
    case "coverage":
      return sql`b.doc_fields desc, lower(b.name), b.system_name`;
    case "relevance":
    default: {
      if (!f.q) return sql`lower(b.name), b.system_name`;
      const q = f.q.toLowerCase();
      const prefix = `${escapeLike(f.q)}%`;
      const contains = `%${escapeLike(f.q)}%`;
      return sql`case
          when lower(b.name) = ${q} or b.slug = ${q} then 0
          when b.name ilike ${prefix} then 1
          when b.name ilike ${contains} or b.aliases_text ilike ${contains} then 2
          when b.type_name ilike ${contains} or b.type_aliases_text ilike ${contains} then 3
          else 4 end, b.doc_fields desc, lower(b.name), b.system_name`;
    }
  }
}

export async function getCatalogComponents(f: CatalogParams): Promise<CatalogComponentRow[]> {
  const db = await readDb();
  const offset = (f.page - 1) * PAGE_SIZE;
  const r = await db.execute<{
    id: string;
    slug: string;
    name: string;
    description: string | null;
    lifecycle: string;
    coverage: CoverageMap;
    system_slug: string;
    system_name: string;
    type_slug: string | null;
    type_name: string | null;
    classification_state: VerificationState;
    classification_method: string | null;
    fws: string[];
    props_count: number;
    docs_url: string | null;
    has_source: boolean;
  }>(sql`
    with ${BASE_CTE}
    select b.id, b.slug, b.name, b.description, b.lifecycle, b.coverage, b.system_slug, b.system_name,
      b.type_slug, b.type_name, b.classification_state, b.classification_method, b.fws, b.docs_url, b.has_source,
      (select count(*) from component_property p where p.component_id = b.id)::int as props_count
    from base b
    where ${conditions(f)}
    order by ${orderBy(f)}
    limit ${PAGE_SIZE} offset ${offset}
  `);
  return r.rows.map((x) => ({
    id: x.id,
    slug: x.slug,
    name: x.name,
    description: x.description,
    lifecycle: x.lifecycle,
    coverage: x.coverage ?? {},
    systemSlug: x.system_slug,
    systemName: x.system_name,
    typeSlug: x.type_slug,
    typeName: x.type_name,
    classificationState: x.classification_state,
    classificationMethod: x.classification_method,
    frameworks: [...(x.fws ?? [])].sort(),
    propsCount: Number(x.props_count),
    docsUrl: x.docs_url,
    hasSource: x.has_source,
  }));
}

/* -------------------------------------------------------------------------- */
/* Types view + coverage matrix                                                */
/* -------------------------------------------------------------------------- */

export interface ImplementationRef {
  slug: string;
  name: string;
  lifecycle: string;
  cls: string;
  docFields: number;
}

export interface TypeSystemImplementations {
  systemSlug: string;
  systemName: string;
  implementations: ImplementationRef[];
}

export interface CatalogType {
  slug: string;
  name: string;
  description: string;
  ariaPattern: string | null;
  groupSlug: string;
  /** Implementations under the active filters, by system (alphabetical). */
  systems: TypeSystemImplementations[];
}

export interface CatalogGroup {
  slug: string;
  name: string;
  description: string | null;
  types: CatalogType[];
  /** Types in this group (after type-level filters) with no implementation under the active filters. */
  empty: { slug: string; name: string }[];
}

export interface UnclassifiedRef {
  systemSlug: string;
  systemName: string;
  slug: string;
  name: string;
}

export interface CatalogTypesResult {
  groups: CatalogGroup[];
  unclassified: UnclassifiedRef[];
  typesShown: number;
  emptyShown: number;
}

export async function getCatalogTypes(f: CatalogParams): Promise<CatalogTypesResult> {
  const db = await readDb();
  const typeText = f.q
    ? (() => {
        const pat = `%${escapeLike(f.q)}%`;
        const { typeSlugs } = expandCatalogQuery(f.q);
        return sql`(ct.name ilike ${pat} or ct.slug ilike ${pat} or array_to_string(ct.aliases, ' ') ilike ${pat}${
          typeSlugs.length ? sql` or ct.slug = any(${sql.param(typeSlugs)}::text[])` : sql``
        })`;
      })()
    : sql`true`;
  const typeLevel: SQL[] = [sql`cat.kind = 'component-group'`];
  if (f.group) typeLevel.push(sql`cat.slug = ${f.group}`);
  if (f.patterns.length) typeLevel.push(sql`ct.aria_pattern = any(${sql.param(f.patterns)}::text[])`);

  const [types, impls, unclassified] = await Promise.all([
    db.execute<{
      slug: string;
      name: string;
      description: string;
      aria_pattern: string | null;
      group_slug: string;
      group_name: string;
      group_description: string | null;
      text_match: boolean;
    }>(sql`
      select ct.slug, ct.name, ct.description, ct.aria_pattern, cat.slug as group_slug, cat.name as group_name,
        cat.description as group_description, ${typeText} as text_match
      from component_type ct join category cat on cat.id = ct.category_id
      where ${sql.join(typeLevel, sql` and `)}
      order by cat.sort_order, cat.name, ct.sort_order, ct.name
    `),
    db.execute<{ type_slug: string; system_slug: string; system_name: string; impls: ImplementationRef[] }>(sql`
      with ${BASE_CTE}
      select b.type_slug, b.system_slug, max(b.system_name) as system_name,
        json_agg(json_build_object('slug', b.slug, 'name', b.name, 'lifecycle', b.lifecycle, 'cls', b.cls, 'docFields', b.doc_fields)
          order by (b.lifecycle = 'deprecated'), lower(b.name)) as impls
      from base b
      where b.type_slug is not null and ${conditions(f)}
      group by b.type_slug, b.system_slug
      order by max(b.system_name)
    `),
    db.execute<{ system_slug: string; system_name: string; slug: string; name: string }>(sql`
      with ${BASE_CTE}
      select b.system_slug, b.system_name, b.slug, b.name from base b
      where b.type_slug is null and ${conditions(f)}
      order by b.system_name, lower(b.name)
    `),
  ]);

  const bySlug = new Map<string, TypeSystemImplementations[]>();
  for (const row of impls.rows) {
    const list = bySlug.get(row.type_slug) ?? [];
    list.push({ systemSlug: row.system_slug, systemName: row.system_name, implementations: row.impls });
    bySlug.set(row.type_slug, list);
  }

  const groups = new Map<string, CatalogGroup>();
  let typesShown = 0;
  let emptyShown = 0;
  for (const t of types.rows) {
    const systems = bySlug.get(t.slug) ?? [];
    // A type is listed when it matches the text query itself or has matching implementations.
    if (!t.text_match && systems.length === 0) continue;
    const g = groups.get(t.group_slug) ?? { slug: t.group_slug, name: t.group_name, description: t.group_description, types: [], empty: [] };
    if (systems.length) {
      g.types.push({ slug: t.slug, name: t.name, description: t.description, ariaPattern: t.aria_pattern, groupSlug: t.group_slug, systems });
      typesShown++;
    } else {
      g.empty.push({ slug: t.slug, name: t.name });
      emptyShown++;
    }
    groups.set(t.group_slug, g);
  }

  return {
    groups: [...groups.values()],
    unclassified: unclassified.rows.map((u) => ({ systemSlug: u.system_slug, systemName: u.system_name, slug: u.slug, name: u.name })),
    typesShown,
    emptyShown,
  };
}

/* -------------------------------------------------------------------------- */
/* Component type page                                                         */
/* -------------------------------------------------------------------------- */

export interface TypeImplementation {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  lifecycle: string;
  docsUrl: string | null;
  coverage: CoverageMap;
  classificationState: VerificationState;
  classificationMethod: string | null;
  systemSlug: string;
  systemName: string;
  variantCount: number;
  states: { name: string; canonical: string | null }[];
  propsCount: number;
  implementationCount: number;
  frameworks: string[];
  docShare: number;
}

export interface ComponentTypeDetail {
  id: string;
  slug: string;
  name: string;
  description: string;
  aliases: string[];
  nearSynonyms: string[];
  ariaPattern: string | null;
  group: { slug: string; name: string; description: string | null };
  implementations: TypeImplementation[];
  /** Systems with indexed components where ATLAS found no implementation of this type. */
  notFoundIn: { slug: string; name: string; componentCount: number }[];
  systemsWithComponents: number;
  systemsPublished: number;
  /** Other canonical types, resolved for linking near-synonyms and aliases by exact name. */
  typeNameIndex: { slug: string; name: string; implemented: boolean }[];
}

export async function getComponentType(slug: string): Promise<ComponentTypeDetail | null> {
  const db = await readDb();
  const t = await db.execute<{
    id: string;
    slug: string;
    name: string;
    description: string;
    aliases: string[];
    near_synonyms: string[];
    aria_pattern: string | null;
    group_slug: string;
    group_name: string;
    group_description: string | null;
  }>(sql`
    select ct.id, ct.slug, ct.name, ct.description, ct.aliases, ct.near_synonyms, ct.aria_pattern,
      cat.slug as group_slug, cat.name as group_name, cat.description as group_description
    from component_type ct join category cat on cat.id = ct.category_id
    where ct.slug = ${slug}
  `);
  const type = t.rows[0];
  if (!type) return null;

  const [impls, missing, totals, index] = await Promise.all([
    db.execute<{
      id: string;
      slug: string;
      name: string;
      description: string | null;
      lifecycle: string;
      docs_url: string | null;
      coverage: CoverageMap;
      classification_state: VerificationState;
      classification_method: string | null;
      system_slug: string;
      system_name: string;
      variant_count: number;
      states: { name: string; canonical: string | null }[];
      props_count: number;
      impl_count: number;
      frameworks: string[];
    }>(sql`
      select c.id, c.slug, c.name, c.description, c.lifecycle, c.docs_url, c.coverage,
        c.classification_state::text as classification_state, c.classification_method,
        ds.slug as system_slug, ds.name as system_name,
        (select count(*) from component_variant v where v.component_id = c.id)::int as variant_count,
        coalesce((select json_agg(json_build_object('name', s.name, 'canonical', s.canonical_state) order by s.canonical_state nulls last, s.name)
          from component_state s where s.component_id = c.id), '[]'::json) as states,
        (select count(*) from component_property p where p.component_id = c.id)::int as props_count,
        (select count(distinct p.implementation) from component_property p where p.component_id = c.id)::int as impl_count,
        coalesce((select array_agg(f.name order by f.name) from component_framework cf join framework f on f.id = cf.framework_id
          where cf.component_id = c.id), '{}'::text[]) as frameworks
      from component c join design_system ds on ds.id = c.design_system_id
      where c.component_type_id = ${type.id} and c.publish_state = 'published' and ds.publish_state = 'published'
      order by ds.name, (c.lifecycle = 'deprecated'), lower(c.name)
    `),
    db.execute<{ slug: string; name: string; n: number }>(sql`
      select ds.slug, ds.name, count(c.id)::int as n
      from design_system ds join component c on c.design_system_id = ds.id and c.publish_state = 'published'
      where ds.publish_state = 'published'
      group by ds.id, ds.slug, ds.name
      having bool_and(c.component_type_id is distinct from ${type.id})
      order by ds.name
    `),
    db.execute<{ with_components: number; published: number }>(sql`
      select
        (select count(distinct c.design_system_id) from component c join design_system ds on ds.id = c.design_system_id
          where c.publish_state = 'published' and ds.publish_state = 'published')::int as with_components,
        (select count(*) from design_system where publish_state = 'published' and registry_status = 'verified')::int as published
    `),
    db.execute<{ slug: string; name: string; implemented: boolean }>(sql`
      select ct.slug, ct.name,
        exists (select 1 from component c where c.component_type_id = ct.id and c.publish_state = 'published') as implemented
      from component_type ct
    `),
  ]);

  return {
    id: type.id,
    slug: type.slug,
    name: type.name,
    description: type.description,
    aliases: type.aliases ?? [],
    nearSynonyms: type.near_synonyms ?? [],
    ariaPattern: type.aria_pattern,
    group: { slug: type.group_slug, name: type.group_name, description: type.group_description },
    implementations: impls.rows.map((x) => ({
      id: x.id,
      slug: x.slug,
      name: x.name,
      description: x.description,
      lifecycle: x.lifecycle,
      docsUrl: x.docs_url,
      coverage: x.coverage ?? {},
      classificationState: x.classification_state,
      classificationMethod: x.classification_method,
      systemSlug: x.system_slug,
      systemName: x.system_name,
      variantCount: Number(x.variant_count),
      states: x.states ?? [],
      propsCount: Number(x.props_count),
      implementationCount: Number(x.impl_count),
      frameworks: x.frameworks ?? [],
      docShare: documentedShare(x.coverage),
    })),
    notFoundIn: missing.rows.map((m) => ({ slug: m.slug, name: m.name, componentCount: Number(m.n) })),
    systemsWithComponents: Number(totals.rows[0]?.with_components ?? 0),
    systemsPublished: Number(totals.rows[0]?.published ?? 0),
    typeNameIndex: index.rows,
  };
}

/** Up to `max` systems whose implementation of a type is best covered (one per system). */
export function bestCoveredSystems(impls: TypeImplementation[], max = 4): string[] {
  const best = new Map<string, number>();
  for (const i of impls) {
    if (i.lifecycle === "deprecated") continue;
    const score = i.docShare * 100 + Math.min(i.propsCount, 50) / 10 + i.variantCount / 10;
    if ((best.get(i.systemSlug) ?? -1) < score) best.set(i.systemSlug, score);
  }
  return [...best.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, max)
    .map(([s]) => s);
}

/* -------------------------------------------------------------------------- */
/* Component detail                                                            */
/* -------------------------------------------------------------------------- */

export interface ComponentDetail {
  id: string;
  slug: string;
  name: string;
  aliases: string[];
  description: string | null;
  docsUrl: string | null;
  sourceCodeUrl: string | null;
  lifecycle: string;
  publishState: string;
  sizes: string[] | null;
  responsiveGuidance: string | null;
  coverage: CoverageMap;
  classificationState: VerificationState;
  classificationMethod: string | null;
  confidence: number;
  firstSeenAt: Date;
  lastChangedAt: Date;
  license: { slug: string; name: string; url: string | null } | null;
  system: {
    id: string;
    slug: string;
    name: string;
    docsUrl: string | null;
    homepageUrl: string | null;
    storybookUrl: string | null;
    lastIngestedAt: Date | null;
    license: { slug: string; name: string; url: string | null } | null;
  };
  type: { slug: string; name: string; description: string; ariaPattern: string | null; groupSlug: string; groupName: string } | null;
}

export interface ComponentFramework {
  slug: string;
  name: string;
  kind: string;
  packageName: string | null;
  importName: string | null;
  sourceUrl: string | null;
}

export interface ComponentVariantRow {
  axis: string;
  name: string;
  description: string | null;
  sourceUrl: string | null;
}

export interface ComponentStateRow {
  name: string;
  canonical: string | null;
  description: string | null;
  sourceUrl: string | null;
}

export interface ComponentPropRow {
  implementation: string;
  name: string;
  type: string | null;
  defaultValue: string | null;
  required: boolean | null;
  deprecated: boolean;
  description: string | null;
  allowedValues: string[] | null;
  sourceUrl: string | null;
}

export interface ComponentExampleRow {
  slug: string;
  title: string;
  kind: string;
  language: string | null;
  code: string | null;
  url: string | null;
  attribution: string | null;
  license: { slug: string; name: string; url: string | null } | null;
}

export interface ComponentAccessibilityRow {
  ariaPattern: string | null;
  roles: string[] | null;
  keyboard: KeyboardInteraction[] | null;
  guidance: string | null;
  screenReader: string | null;
  focusManagement: string | null;
  wcagCriteria: string[] | null;
  docsUrl: string | null;
  coverage: CoverageMap;
}

export interface ComponentRelationshipRow {
  direction: "outbound" | "inbound";
  kind: string;
  verificationState: VerificationState;
  sourceUrl: string | null;
  target: { slug: string; name: string; systemSlug: string; systemName: string; lifecycle: string } | null;
  targetType: { slug: string; name: string } | null;
}

export interface TokenUsageValue {
  set: string;
  setName: string;
  theme: string | null;
  valueText: string | null;
  aliasState: string | null;
  resolvedValue: unknown;
  type: string | null;
}

export interface TokenUsageRow {
  name: string;
  category: string;
  properties: string[];
  values: TokenUsageValue[];
}

export interface ComparableComponent {
  slug: string;
  name: string;
  lifecycle: string;
  systemSlug: string;
  systemName: string;
  classificationState: VerificationState;
  docShare: number;
  propsCount: number;
}

export interface ChangeEventRow {
  id: string;
  changeKind: string;
  occurredAt: Date;
  fieldChanges: { field: string; summary?: string }[] | null;
}

export interface PatternMembership {
  slug: string;
  name: string;
  role: string | null;
}

export interface ComponentDetailBundle {
  component: ComponentDetail;
  frameworks: ComponentFramework[];
  variants: ComponentVariantRow[];
  states: ComponentStateRow[];
  props: ComponentPropRow[];
  examples: ComponentExampleRow[];
  accessibility: ComponentAccessibilityRow | null;
  relationships: ComponentRelationshipRow[];
  tokens: TokenUsageRow[];
  tokenUsageCount: number;
  comparable: ComparableComponent[];
  evidence: {
    id: string;
    field: string;
    sourceUrl: string;
    sourceTitle: string | null;
    retrievedAt: Date;
    contentHash: string | null;
    extractionMethod: string;
    location: string | null;
    excerpt: string | null;
    state: VerificationState;
    confidence: number;
  }[];
  changes: ChangeEventRow[];
  patterns: PatternMembership[];
}

type LicenseJson = { slug: string; name: string; url: string | null } | null;

export async function getComponentDetail(systemSlug: string, componentSlug: string): Promise<ComponentDetailBundle | null> {
  const db = await readDb();
  const base = await db.execute<{
    id: string;
    slug: string;
    name: string;
    aliases: string[];
    description: string | null;
    docs_url: string | null;
    source_code_url: string | null;
    lifecycle: string;
    publish_state: string;
    sizes: string[] | null;
    responsive_guidance: string | null;
    coverage: CoverageMap;
    classification_state: VerificationState;
    classification_method: string | null;
    confidence: number;
    first_seen_at: string;
    last_changed_at: string;
    component_type_id: string | null;
    license: LicenseJson;
    system_id: string;
    system_slug: string;
    system_name: string;
    system_docs_url: string | null;
    system_homepage_url: string | null;
    system_storybook_url: string | null;
    system_last_ingested_at: string | null;
    system_license: LicenseJson;
    type_slug: string | null;
    type_name: string | null;
    type_description: string | null;
    type_aria_pattern: string | null;
    group_slug: string | null;
    group_name: string | null;
  }>(sql`
    select c.id, c.slug, c.name, c.aliases, c.description, c.docs_url, c.source_code_url, c.lifecycle, c.publish_state::text as publish_state, c.sizes,
      c.responsive_guidance, c.coverage, c.classification_state::text as classification_state, c.classification_method,
      c.confidence, c.first_seen_at, c.last_changed_at, c.component_type_id,
      case when cl.id is null then null else json_build_object('slug', cl.slug, 'name', cl.name, 'url', cl.url) end as license,
      ds.id as system_id, ds.slug as system_slug, ds.name as system_name, ds.docs_url as system_docs_url,
      ds.homepage_url as system_homepage_url, ds.storybook_url as system_storybook_url, ds.last_ingested_at as system_last_ingested_at,
      case when sl.id is null then null else json_build_object('slug', sl.slug, 'name', sl.name, 'url', sl.url) end as system_license,
      ct.slug as type_slug, ct.name as type_name, ct.description as type_description, ct.aria_pattern as type_aria_pattern,
      cat.slug as group_slug, cat.name as group_name
    from component c
    join design_system ds on ds.id = c.design_system_id
    left join license cl on cl.id = c.license_id
    left join license sl on sl.id = ds.license_id
    left join component_type ct on ct.id = c.component_type_id
    left join category cat on cat.id = ct.category_id
    where ds.slug = ${systemSlug} and c.slug = ${componentSlug}
      and ds.publish_state = 'published' and c.publish_state in ('published', 'retired')
    limit 1
  `);
  const c = base.rows[0];
  if (!c) return null;
  const id = c.id;

  const [frameworks, variants, states, props, examples, a11y, rels, tokens, comparable, evidence, changes, patterns] = await Promise.all([
    db.execute<{ slug: string; name: string; kind: string; package_name: string | null; import_name: string | null; source_url: string | null }>(sql`
      select f.slug, f.name, f.kind, cf.package_name, cf.import_name, cf.source_url
      from component_framework cf join framework f on f.id = cf.framework_id
      where cf.component_id = ${id}
      order by (f.kind = 'design'), f.name
    `),
    db.execute<{ axis: string; name: string; description: string | null; source_url: string | null }>(sql`
      select axis, name, description, source_url from component_variant where component_id = ${id} order by axis, name
    `),
    db.execute<{ name: string; canonical_state: string | null; description: string | null; source_url: string | null }>(sql`
      select name, canonical_state, description, source_url from component_state where component_id = ${id}
      order by canonical_state nulls last, name
    `),
    db.execute<{
      implementation: string;
      name: string;
      type: string | null;
      default_value: string | null;
      required: boolean | null;
      deprecated: boolean;
      description: string | null;
      allowed_values: string[] | null;
      source_url: string | null;
    }>(sql`
      select implementation, name, type, default_value, required, deprecated, description, allowed_values, source_url
      from component_property where component_id = ${id}
      order by implementation, deprecated, (required is true) desc, name
    `),
    db.execute<{
      slug: string;
      title: string;
      kind: string;
      language: string | null;
      code: string | null;
      url: string | null;
      attribution: string | null;
      license: LicenseJson;
    }>(sql`
      select e.slug, e.title, e.kind, e.language, e.code, e.url, e.attribution,
        case when l.id is null then null else json_build_object('slug', l.slug, 'name', l.name, 'url', l.url) end as license
      from component_example e left join license l on l.id = e.license_id
      where e.component_id = ${id}
      order by case e.kind when 'docs-link' then 0 when 'code-snippet' then 1 when 'storybook-link' then 2 else 3 end, e.title
    `),
    db.execute<{
      aria_pattern: string | null;
      roles: string[] | null;
      keyboard: KeyboardInteraction[] | null;
      guidance: string | null;
      screen_reader: string | null;
      focus_management: string | null;
      wcag_criteria: string[] | null;
      docs_url: string | null;
      coverage: CoverageMap;
    }>(sql`
      select aria_pattern, roles, keyboard, guidance, screen_reader, focus_management, wcag_criteria, docs_url, coverage
      from component_accessibility where component_id = ${id}
    `),
    db.execute<{
      direction: "outbound" | "inbound";
      kind: string;
      verification_state: VerificationState;
      source_url: string | null;
      target_slug: string | null;
      target_name: string | null;
      target_lifecycle: string | null;
      target_system_slug: string | null;
      target_system_name: string | null;
      target_type_slug: string | null;
      target_type_name: string | null;
    }>(sql`
      select 'outbound' as direction, r.kind, r.verification_state::text as verification_state, r.source_url,
        t.slug as target_slug, t.name as target_name, t.lifecycle as target_lifecycle,
        tds.slug as target_system_slug, tds.name as target_system_name, tt.slug as target_type_slug, tt.name as target_type_name
      from component_relationship r
      left join component t on t.id = r.to_component_id and t.publish_state = 'published'
      left join design_system tds on tds.id = t.design_system_id
      left join component_type tt on tt.id = r.to_component_type_id
      where r.from_component_id = ${id}
      union all
      select 'inbound', r.kind, r.verification_state::text, r.source_url,
        f.slug, f.name, f.lifecycle, fds.slug, fds.name, null, null
      from component_relationship r
      join component f on f.id = r.from_component_id and f.publish_state = 'published'
      join design_system fds on fds.id = f.design_system_id
      where r.to_component_id = ${id}
      order by 1 desc, 2, 6
    `),
    db.execute<{ name: string; category: string; properties: string[] | null; vals: TokenUsageValue[] }>(sql`
      with u as (select distinct tu.token_id from token_usage tu where tu.component_id = ${id})
      select t.name, t.category::text as category,
        array(select distinct tu2.property from token_usage tu2 join token t2 on t2.id = tu2.token_id
          where tu2.component_id = ${id} and t2.name = t.name and tu2.property is not null order by 1) as properties,
        json_agg(json_build_object('set', ts.slug, 'setName', ts.name, 'theme', ts.theme, 'valueText', t.value_text,
          'aliasState', t.alias_state, 'resolvedValue', t.resolved_value, 'type', t.type) order by ts.theme nulls first, ts.slug) as vals
      from u join token t on t.id = u.token_id join token_set ts on ts.id = t.token_set_id
      where ts.publish_state = 'published'
      group by t.name, t.category
      order by t.category, t.name
    `),
    c.component_type_id
      ? db.execute<{
          slug: string;
          name: string;
          lifecycle: string;
          system_slug: string;
          system_name: string;
          classification_state: VerificationState;
          coverage: CoverageMap;
          props_count: number;
        }>(sql`
          select c.slug, c.name, c.lifecycle, ds.slug as system_slug, ds.name as system_name,
            c.classification_state::text as classification_state, c.coverage,
            (select count(*) from component_property p where p.component_id = c.id)::int as props_count
          from component c join design_system ds on ds.id = c.design_system_id
          where c.component_type_id = ${c.component_type_id} and c.id <> ${id}
            and c.publish_state = 'published' and ds.publish_state = 'published'
          order by (ds.id = ${c.system_id}), ds.name, (c.lifecycle = 'deprecated'), lower(c.name)
        `)
      : Promise.resolve({ rows: [] as never[] }),
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
      select id, field, source_url, source_title, retrieved_at, content_hash, extraction_method, location, excerpt,
        state::text as state, confidence
      from verification_evidence
      where subject_type = 'component' and subject_id = ${id}
      order by (field = '*') desc, field, retrieved_at desc
    `),
    db.execute<{ id: string; change_kind: string; occurred_at: string; field_changes: { field: string; summary?: string }[] | null }>(sql`
      select id, change_kind, occurred_at, field_changes from change_event
      where entity_type = 'component' and entity_id = ${id}
      order by occurred_at desc limit 50
    `),
    db.execute<{ slug: string; name: string; role: string | null }>(sql`
      select p.slug, p.name, pc.role from pattern_component pc join design_pattern p on p.id = pc.pattern_id
      where pc.component_id = ${id} and p.publish_state = 'published'
      order by p.name
    `),
  ]);

  const toDate = (v: string | Date | null) => (v ? new Date(v) : null);

  return {
    component: {
      id,
      slug: c.slug,
      name: c.name,
      aliases: c.aliases ?? [],
      description: c.description,
      docsUrl: c.docs_url,
      sourceCodeUrl: c.source_code_url,
      lifecycle: c.lifecycle,
      publishState: c.publish_state,
      sizes: c.sizes,
      responsiveGuidance: c.responsive_guidance,
      coverage: c.coverage ?? {},
      classificationState: c.classification_state,
      classificationMethod: c.classification_method,
      confidence: Number(c.confidence),
      firstSeenAt: new Date(c.first_seen_at),
      lastChangedAt: new Date(c.last_changed_at),
      license: c.license,
      system: {
        id: c.system_id,
        slug: c.system_slug,
        name: c.system_name,
        docsUrl: c.system_docs_url,
        homepageUrl: c.system_homepage_url,
        storybookUrl: c.system_storybook_url,
        lastIngestedAt: toDate(c.system_last_ingested_at),
        license: c.system_license,
      },
      type:
        c.type_slug && c.type_name
          ? {
              slug: c.type_slug,
              name: c.type_name,
              description: c.type_description ?? "",
              ariaPattern: c.type_aria_pattern,
              groupSlug: c.group_slug ?? "",
              groupName: c.group_name ?? "",
            }
          : null,
    },
    frameworks: frameworks.rows.map((f) => ({
      slug: f.slug,
      name: f.name,
      kind: f.kind,
      packageName: f.package_name,
      importName: f.import_name,
      sourceUrl: f.source_url,
    })),
    variants: variants.rows.map((v) => ({ axis: v.axis, name: v.name, description: v.description, sourceUrl: v.source_url })),
    states: states.rows.map((s) => ({ name: s.name, canonical: s.canonical_state, description: s.description, sourceUrl: s.source_url })),
    props: props.rows.map((p) => ({
      implementation: p.implementation,
      name: p.name,
      type: p.type,
      defaultValue: p.default_value,
      required: p.required,
      deprecated: p.deprecated,
      description: p.description,
      allowedValues: p.allowed_values,
      sourceUrl: p.source_url,
    })),
    examples: examples.rows,
    accessibility: a11y.rows[0]
      ? {
          ariaPattern: a11y.rows[0].aria_pattern,
          roles: a11y.rows[0].roles,
          keyboard: a11y.rows[0].keyboard,
          guidance: a11y.rows[0].guidance,
          screenReader: a11y.rows[0].screen_reader,
          focusManagement: a11y.rows[0].focus_management,
          wcagCriteria: a11y.rows[0].wcag_criteria,
          docsUrl: a11y.rows[0].docs_url,
          coverage: a11y.rows[0].coverage ?? {},
        }
      : null,
    relationships: rels.rows.map((r) => ({
      direction: r.direction,
      kind: r.kind,
      verificationState: r.verification_state,
      sourceUrl: r.source_url,
      target:
        r.target_slug && r.target_name && r.target_system_slug && r.target_system_name
          ? {
              slug: r.target_slug,
              name: r.target_name,
              systemSlug: r.target_system_slug,
              systemName: r.target_system_name,
              lifecycle: r.target_lifecycle ?? "unknown",
            }
          : null,
      targetType: r.target_type_slug && r.target_type_name ? { slug: r.target_type_slug, name: r.target_type_name } : null,
    })),
    tokens: tokens.rows.map((t) => ({ name: t.name, category: t.category, properties: t.properties ?? [], values: t.vals })),
    tokenUsageCount: tokens.rows.length,
    comparable: comparable.rows.map((x) => ({
      slug: x.slug,
      name: x.name,
      lifecycle: x.lifecycle,
      systemSlug: x.system_slug,
      systemName: x.system_name,
      classificationState: x.classification_state,
      docShare: documentedShare(x.coverage),
      propsCount: Number(x.props_count),
    })),
    evidence: evidence.rows.map((e) => ({
      id: e.id,
      field: e.field,
      sourceUrl: e.source_url,
      sourceTitle: e.source_title,
      retrievedAt: new Date(e.retrieved_at),
      contentHash: e.content_hash,
      extractionMethod: e.extraction_method,
      location: e.location,
      excerpt: e.excerpt,
      state: e.state,
      confidence: Number(e.confidence),
    })),
    changes: changes.rows.map((ch) => ({
      id: ch.id,
      changeKind: ch.change_kind,
      occurredAt: new Date(ch.occurred_at),
      fieldChanges: ch.field_changes,
    })),
    patterns: patterns.rows,
  };
}

/** Lightweight lookup for generateMetadata (avoids loading the full bundle twice). */
export async function getComponentMeta(systemSlug: string, componentSlug: string) {
  const db = await readDb();
  const r = await db.execute<{ name: string; system_name: string; description: string | null; type_name: string | null }>(sql`
    select c.name, ds.name as system_name, c.description, ct.name as type_name
    from component c join design_system ds on ds.id = c.design_system_id
    left join component_type ct on ct.id = c.component_type_id
    where ds.slug = ${systemSlug} and c.slug = ${componentSlug} and ds.publish_state = 'published'
    limit 1
  `);
  return r.rows[0] ?? null;
}

export async function getComponentTypeMeta(slug: string) {
  const db = await readDb();
  const r = await db.execute<{ name: string; description: string; n: number }>(sql`
    select ct.name, ct.description,
      (select count(distinct c.design_system_id) from component c where c.component_type_id = ct.id and c.publish_state = 'published')::int as n
    from component_type ct where ct.slug = ${slug}
  `);
  return r.rows[0] ?? null;
}


