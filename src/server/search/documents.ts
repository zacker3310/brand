/**
 * Search document builders: canonical tables -> SearchDocument[].
 *
 * Only published records are indexed:
 *  - systems: publish_state 'published' AND registry_status 'verified'
 *  - components / patterns / token sets: publish_state 'published' AND owning system indexed (above)
 *  - taxonomy (component types, pattern types, frameworks, component-group categories): always,
 *    with implementation counts derived from the published records.
 *
 * Nothing here invents data: unknown values stay null / empty, and facets that are derived
 * (e.g. a component's frameworks inherited from its system) say so (`frameworksSource`).
 */
import { SYSTEM_CATEGORY_LABELS, type SearchEntityType, type SystemCategory } from "@/lib/contracts";
import { FRAMEWORK_QUERY_WORDS } from "@/lib/taxonomy";
import type { Queryable } from "./providers/postgres";
import type { SearchDocument } from "./types";

const MAX_BODY = 2000;

/** Framework / platform / tag links that are explicitly not supported are never indexed as support. */
const EXCLUDED_LINK_STATES = "('unavailable', 'conflicting')";

export const SYSTEM_SCOPED_TYPES: SearchEntityType[] = ["system", "component", "pattern", "token"];
export const TAXONOMY_TYPES: SearchEntityType[] = ["component-type", "pattern-type", "framework", "category"];

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

const words = (s: string | null | undefined): string[] =>
  (s ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);

/** Space-separated, de-duplicated keyword string; phrases are kept in order so phrase queries match. */
export function keywordString(parts: (string | null | undefined)[]): string | null {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    if (!p) continue;
    const phrase = p.toLowerCase().replace(/\s+/g, " ").trim();
    if (!phrase || seen.has(phrase)) continue;
    seen.add(phrase);
    out.push(phrase);
  }
  return out.length ? out.join(" ") : null;
}

function joinBody(parts: (string | null | undefined)[]): string | null {
  const s = parts
    .map((x) => x?.trim())
    .filter(Boolean)
    .join("\n\n");
  return s ? s.slice(0, MAX_BODY) : null;
}

const slugWords = (slug: string) => slug.replace(/-/g, " ");

export const systemUrl = (slug: string) => `/systems/${encodeURIComponent(slug)}`;
export const componentTypeUrl = (slug: string) => `/components/${encodeURIComponent(slug)}`;
export const componentUrl = (system: string, slug: string) => `/systems/${encodeURIComponent(system)}/components/${encodeURIComponent(slug)}`;
export const patternTypeUrl = (slug: string) => `/patterns/${encodeURIComponent(slug)}`;
export const patternUrl = (system: string, slug: string) => `/systems/${encodeURIComponent(system)}/patterns/${encodeURIComponent(slug)}`;
export const tokenUrl = (system: string, name: string) => `/tokens?system=${encodeURIComponent(system)}&q=${encodeURIComponent(name)}`;
export const frameworkUrl = (slug: string) => `/systems?framework=${encodeURIComponent(slug)}`;
export const categoryUrl = (slug: string) => `/components?group=${encodeURIComponent(slug)}`;

const countBoost = (n: number, zero: number) => (n <= 0 ? zero : 1 + Math.min(n, 20) / 50);

/** Token keywords: every path segment, camelCase split, plus the CSS variable, so "fg color" finds "fgColor.default". */
export function tokenKeywords(name: string, path: string[], cssVar: string | null): string | null {
  const parts = new Set<string>();
  for (const seg of [...path, name]) {
    words(seg).forEach((w) => parts.add(w));
    const flat = seg.toLowerCase().replace(/[^a-z0-9]+/g, "");
    if (flat) parts.add(flat);
  }
  if (cssVar) words(cssVar).forEach((w) => parts.add(w));
  return parts.size ? [...parts].join(" ") : null;
}

/* -------------------------------------------------------------------------- */
/* Row types                                                                   */
/* -------------------------------------------------------------------------- */

interface SystemRow {
  id: string;
  slug: string;
  name: string;
  aliases: string[];
  category: SystemCategory;
  summary: string | null;
  philosophy: string | null;
  maintenance: string;
  doc_access: string;
  is_featured: boolean;
  ingestion_status: string;
  org_name: string | null;
  license_slug: string | null;
  framework_slugs: string[];
  framework_names: string[];
  platform_slugs: string[];
  platform_names: string[];
  tag_slugs: string[];
  tag_names: string[];
}

interface ComponentRow {
  id: string;
  slug: string;
  name: string;
  aliases: string[];
  description: string | null;
  lifecycle: string;
  classification_state: string;
  system_slug: string;
  type_slug: string | null;
  type_name: string | null;
  type_aliases: string[] | null;
  group_slug: string | null;
  framework_slugs: string[];
  variant_names: string[];
  variant_count: number;
  states: string[];
  state_names: string[];
  has_props: boolean;
  has_a11y: boolean;
}

interface PatternRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  classification_state: string;
  system_slug: string;
  type_slug: string | null;
  type_name: string | null;
  type_aliases: string[] | null;
  component_count: number;
}

interface TokenRow {
  id: string;
  name: string;
  path: string[];
  css_var: string | null;
  category: string;
  type: string | null;
  tier: string | null;
  description: string | null;
  deprecated: boolean;
  value_text: string | null;
  set_slug: string;
  theme: string | null;
  system_slug: string;
}

/* -------------------------------------------------------------------------- */
/* System-scoped documents                                                     */
/* -------------------------------------------------------------------------- */

const SYSTEM_WHERE = `s.publish_state = 'published' and s.registry_status = 'verified' and ($1::text is null or s.slug = $1::text)`;

/**
 * Documents for one system (or all indexable systems when systemSlug is omitted): the system
 * itself, its published components, patterns and tokens.
 */
export async function buildSystemDocuments(db: Queryable, opts: { systemSlug?: string | null } = {}): Promise<SearchDocument[]> {
  const slug = opts.systemSlug ?? null;
  const systems = (
    await db.query<SystemRow>(
      `select s.id, s.slug, s.name, s.aliases, s.category::text as category, s.summary, s.philosophy,
              s.maintenance_status::text as maintenance, s.doc_access::text as doc_access, s.is_featured,
              s.ingestion_status::text as ingestion_status, o.name as org_name, l.slug as license_slug,
              array(select f.slug from design_system_framework x join framework f on f.id = x.framework_id
                    where x.design_system_id = s.id and x.verification_state not in ${EXCLUDED_LINK_STATES} order by f.slug) as framework_slugs,
              array(select f.name from design_system_framework x join framework f on f.id = x.framework_id
                    where x.design_system_id = s.id and x.verification_state not in ${EXCLUDED_LINK_STATES} order by f.slug) as framework_names,
              array(select pl.slug from design_system_platform x join platform pl on pl.id = x.platform_id
                    where x.design_system_id = s.id and x.verification_state not in ${EXCLUDED_LINK_STATES} order by pl.slug) as platform_slugs,
              array(select pl.name from design_system_platform x join platform pl on pl.id = x.platform_id
                    where x.design_system_id = s.id and x.verification_state not in ${EXCLUDED_LINK_STATES} order by pl.slug) as platform_names,
              array(select t.slug from design_system_tag x join tag t on t.id = x.tag_id
                    where x.design_system_id = s.id and x.verification_state not in ${EXCLUDED_LINK_STATES} order by t.slug) as tag_slugs,
              array(select t.name from design_system_tag x join tag t on t.id = x.tag_id
                    where x.design_system_id = s.id and x.verification_state not in ${EXCLUDED_LINK_STATES} order by t.slug) as tag_names
       from design_system s
       left join organization o on o.id = s.organization_id
       left join license l on l.id = s.license_id
       where ${SYSTEM_WHERE}
       order by s.slug`,
      [slug],
    )
  ).rows;
  if (!systems.length) return [];
  const bySlug = new Map(systems.map((s) => [s.slug, s]));
  const docs: SearchDocument[] = systems.map(systemDocument);

  const [components, patterns, tokens] = await Promise.all([
    db.query<ComponentRow>(
      `select c.id, c.slug, c.name, c.aliases, c.description, c.lifecycle, c.classification_state::text as classification_state,
              s.slug as system_slug, ct.slug as type_slug, ct.name as type_name, ct.aliases as type_aliases, cat.slug as group_slug,
              array(select f.slug from component_framework cf join framework f on f.id = cf.framework_id
                    where cf.component_id = c.id order by f.slug) as framework_slugs,
              array(select v.name from component_variant v where v.component_id = c.id order by v.axis, v.name) as variant_names,
              (select count(*) from component_variant v where v.component_id = c.id)::int as variant_count,
              array(select distinct coalesce(st.canonical_state, lower(st.name)) from component_state st
                    where st.component_id = c.id order by 1) as states,
              array(select st.name from component_state st where st.component_id = c.id order by st.name) as state_names,
              exists(select 1 from component_property pr where pr.component_id = c.id) as has_props,
              exists(select 1 from component_accessibility a where a.component_id = c.id and (
                  a.guidance is not null or a.screen_reader is not null or a.focus_management is not null
                  or coalesce(cardinality(a.roles), 0) > 0 or coalesce(cardinality(a.wcag_criteria), 0) > 0
                  or (jsonb_typeof(a.keyboard) = 'array' and jsonb_array_length(a.keyboard) > 0)
                  or (case when jsonb_typeof(a.coverage) = 'object'
                           then exists(select 1 from jsonb_each_text(a.coverage) cv where cv.value = 'documented') else false end))) as has_a11y
       from component c
       join design_system s on s.id = c.design_system_id
       left join component_type ct on ct.id = c.component_type_id
       left join category cat on cat.id = ct.category_id
       where c.publish_state = 'published' and ${SYSTEM_WHERE}
       order by s.slug, c.slug`,
      [slug],
    ),
    db.query<PatternRow>(
      `select p.id, p.slug, p.name, p.description, p.classification_state::text as classification_state, s.slug as system_slug,
              pt.slug as type_slug, pt.name as type_name, pt.aliases as type_aliases,
              (select count(*) from pattern_component pc where pc.pattern_id = p.id)::int as component_count
       from design_pattern p
       join design_system s on s.id = p.design_system_id
       left join pattern_type pt on pt.id = p.pattern_type_id
       where p.publish_state = 'published' and ${SYSTEM_WHERE}
       order by s.slug, p.slug`,
      [slug],
    ),
    db.query<TokenRow>(
      `select t.id, t.name, t.path, t.css_var, t.category::text as category, t.type, t.tier::text as tier, t.description,
              t.deprecated, t.value_text, ts.slug as set_slug, ts.theme, s.slug as system_slug
       from token t
       join token_set ts on ts.id = t.token_set_id
       join design_system s on s.id = t.design_system_id
       where ts.publish_state = 'published' and ${SYSTEM_WHERE}
       order by s.slug, ts.slug, t.name`,
      [slug],
    ),
  ]);

  for (const c of components.rows) docs.push(componentDocument(c, bySlug.get(c.system_slug)!));
  for (const p of patterns.rows) docs.push(patternDocument(p, bySlug.get(p.system_slug)!));
  for (const t of tokens.rows) docs.push(tokenDocument(t, bySlug.get(t.system_slug)!));
  return docs;
}

function systemDocument(s: SystemRow): SearchDocument {
  const categoryLabel = SYSTEM_CATEGORY_LABELS[s.category] ?? s.category;
  let boost = 1 + (s.is_featured ? 0.15 : 0) + (s.ingestion_status === "indexed" || s.ingestion_status === "partial" ? 0.1 : 0);
  if (s.maintenance === "deprecated" || s.maintenance === "archived") boost *= 0.8;
  return {
    entityType: "system",
    entityId: s.id,
    systemSlug: s.slug,
    title: s.name,
    subtitle: s.org_name ? `${s.org_name} · ${categoryLabel}` : categoryLabel,
    body: joinBody([s.summary, s.philosophy]),
    keywords: keywordString([
      slugWords(s.slug),
      ...(s.aliases ?? []),
      ...s.tag_slugs.map(slugWords),
      ...s.tag_names,
      ...s.framework_slugs,
      ...s.framework_names,
      ...s.platform_slugs,
      ...s.platform_names,
    ]),
    url: systemUrl(s.slug),
    facets: {
      category: s.category,
      frameworks: s.framework_slugs,
      platforms: s.platform_slugs,
      tags: s.tag_slugs,
      license: s.license_slug,
      maintenance: s.maintenance,
      docAccess: s.doc_access,
    },
    boost: round(boost),
  };
}

function componentDocument(c: ComponentRow, sys: SystemRow): SearchDocument {
  const ownFrameworks = c.framework_slugs;
  const frameworks = ownFrameworks.length ? ownFrameworks : sys.framework_slugs;
  let boost = 1;
  if (c.lifecycle === "deprecated") boost *= 0.6;
  if (!c.type_slug) boost *= 0.9;
  return {
    entityType: "component",
    entityId: c.id,
    systemSlug: c.system_slug,
    title: c.name,
    subtitle: `${sys.name} · ${c.type_name ?? "Unclassified"}`,
    body: joinBody([c.description]),
    keywords: keywordString([
      ...c.aliases,
      slugWords(c.slug),
      ...(c.type_name ? [c.type_name] : []),
      ...(c.type_aliases ?? []),
      ...c.variant_names,
      ...c.state_names,
    ]),
    url: componentUrl(c.system_slug, c.slug),
    facets: {
      system: c.system_slug,
      componentType: c.type_slug,
      classificationState: c.type_slug ? c.classification_state : null,
      group: c.group_slug,
      frameworks,
      // "component": documented on the component; "system": inherited from system-level support.
      frameworksSource: ownFrameworks.length ? "component" : sys.framework_slugs.length ? "system" : null,
      platforms: sys.platform_slugs,
      systemTags: sys.tag_slugs,
      hasA11y: c.has_a11y,
      hasProps: c.has_props,
      states: c.states,
      variantCount: c.variant_count,
      lifecycle: c.lifecycle,
    },
    boost: round(boost),
  };
}

function patternDocument(p: PatternRow, sys: SystemRow): SearchDocument {
  return {
    entityType: "pattern",
    entityId: p.id,
    systemSlug: p.system_slug,
    title: p.name,
    subtitle: `${sys.name} · ${p.type_name ?? "Pattern"}`,
    body: joinBody([p.description]),
    keywords: keywordString([slugWords(p.slug), ...(p.type_name ? [p.type_name] : []), ...(p.type_aliases ?? [])]),
    url: patternUrl(p.system_slug, p.slug),
    facets: {
      system: p.system_slug,
      patternType: p.type_slug,
      classificationState: p.type_slug ? p.classification_state : null,
      componentCount: p.component_count,
      frameworks: sys.framework_slugs,
      platforms: sys.platform_slugs,
      systemTags: sys.tag_slugs,
    },
    boost: 1,
  };
}

const TIER_BOOST: Record<string, number> = { primitive: 0.7, semantic: 1, component: 0.9 };

function tokenDocument(t: TokenRow, sys: SystemRow): SearchDocument {
  let boost = t.tier ? (TIER_BOOST[t.tier] ?? 0.85) : 0.85;
  if (t.deprecated) boost *= 0.6;
  const value = t.value_text && t.value_text.length <= 120 ? t.value_text : null;
  return {
    entityType: "token",
    entityId: t.id,
    systemSlug: t.system_slug,
    title: t.name,
    subtitle: [sys.name, t.category, t.theme].filter(Boolean).join(" · "),
    body: joinBody([t.description, value]),
    keywords: tokenKeywords(t.name, t.path, t.css_var),
    url: tokenUrl(t.system_slug, t.name),
    facets: {
      system: t.system_slug,
      category: t.category,
      theme: t.theme,
      type: t.type,
      tier: t.tier,
      tokenSet: t.set_slug,
      deprecated: t.deprecated,
      frameworks: sys.framework_slugs,
      platforms: sys.platform_slugs,
    },
    boost: round(boost),
  };
}

/* -------------------------------------------------------------------------- */
/* Taxonomy documents                                                          */
/* -------------------------------------------------------------------------- */

const PUBLISHED_SYSTEM = `s.publish_state = 'published' and s.registry_status = 'verified'`;

export async function buildTaxonomyDocuments(db: Queryable): Promise<SearchDocument[]> {
  const [types, patternTypes, frameworks, categories] = await Promise.all([
    db.query<{
      id: string;
      slug: string;
      name: string;
      description: string;
      aliases: string[];
      near_synonyms: string[];
      group_slug: string;
      group_name: string;
      systems_count: number;
      components_count: number;
    }>(
      `select ct.id, ct.slug, ct.name, ct.description, ct.aliases, ct.near_synonyms, cat.slug as group_slug, cat.name as group_name,
              coalesce(x.systems_count, 0)::int as systems_count, coalesce(x.components_count, 0)::int as components_count
       from component_type ct
       join category cat on cat.id = ct.category_id
       left join (
         select c.component_type_id, count(distinct c.design_system_id) as systems_count, count(*) as components_count
         from component c join design_system s on s.id = c.design_system_id
         where c.publish_state = 'published' and ${PUBLISHED_SYSTEM}
         group by 1
       ) x on x.component_type_id = ct.id
       order by ct.sort_order, ct.slug`,
    ),
    db.query<{ id: string; slug: string; name: string; description: string; aliases: string[]; systems_count: number; patterns_count: number }>(
      `select pt.id, pt.slug, pt.name, pt.description, pt.aliases,
              coalesce(x.systems_count, 0)::int as systems_count, coalesce(x.patterns_count, 0)::int as patterns_count
       from pattern_type pt
       left join (
         select p.pattern_type_id, count(distinct p.design_system_id) as systems_count, count(*) as patterns_count
         from design_pattern p join design_system s on s.id = p.design_system_id
         where p.publish_state = 'published' and ${PUBLISHED_SYSTEM}
         group by 1
       ) x on x.pattern_type_id = pt.id
       order by pt.sort_order, pt.slug`,
    ),
    db.query<{ id: string; slug: string; name: string; kind: string; systems_count: number }>(
      `select f.id, f.slug, f.name, f.kind, coalesce(x.systems_count, 0)::int as systems_count
       from framework f
       left join (
         select dsf.framework_id, count(distinct dsf.design_system_id) as systems_count
         from design_system_framework dsf join design_system s on s.id = dsf.design_system_id
         where ${PUBLISHED_SYSTEM} and dsf.verification_state not in ${EXCLUDED_LINK_STATES}
         group by 1
       ) x on x.framework_id = f.id
       order by f.slug`,
    ),
    db.query<{ id: string; slug: string; name: string; description: string | null; type_names: string[]; components_count: number }>(
      `select cat.id, cat.slug, cat.name, cat.description,
              array(select ct.name from component_type ct where ct.category_id = cat.id order by ct.sort_order, ct.name) as type_names,
              (select count(*) from component c join component_type ct on ct.id = c.component_type_id
                 join design_system s on s.id = c.design_system_id
                where ct.category_id = cat.id and c.publish_state = 'published' and ${PUBLISHED_SYSTEM})::int as components_count
       from category cat
       where cat.kind = 'component-group'
       order by cat.sort_order, cat.slug`,
    ),
  ]);

  const fwWords = new Map<string, string[]>();
  for (const [word, slug] of Object.entries(FRAMEWORK_QUERY_WORDS)) {
    const arr = fwWords.get(slug) ?? [];
    arr.push(word);
    fwWords.set(slug, arr);
  }

  const docs: SearchDocument[] = [];
  for (const t of types.rows) {
    docs.push({
      entityType: "component-type",
      entityId: t.id,
      systemSlug: null,
      title: t.name,
      subtitle: `Component type · ${t.group_name}${t.systems_count ? ` · ${t.systems_count} ${t.systems_count === 1 ? "system" : "systems"}` : ""}`,
      body: joinBody([t.description]),
      keywords: keywordString([slugWords(t.slug), ...t.aliases, ...t.near_synonyms]),
      url: componentTypeUrl(t.slug),
      facets: { slug: t.slug, group: t.group_slug, systemsCount: t.systems_count, componentsCount: t.components_count },
      boost: round(countBoost(t.systems_count, 0.8)),
    });
  }
  for (const pt of patternTypes.rows) {
    docs.push({
      entityType: "pattern-type",
      entityId: pt.id,
      systemSlug: null,
      title: pt.name,
      subtitle: `Pattern type${pt.systems_count ? ` · ${pt.systems_count} ${pt.systems_count === 1 ? "system" : "systems"}` : ""}`,
      body: joinBody([pt.description]),
      keywords: keywordString([slugWords(pt.slug), ...pt.aliases]),
      url: patternTypeUrl(pt.slug),
      facets: { slug: pt.slug, systemsCount: pt.systems_count, patternsCount: pt.patterns_count },
      boost: round(countBoost(pt.systems_count, 0.8)),
    });
  }
  for (const f of frameworks.rows) {
    docs.push({
      entityType: "framework",
      entityId: f.id,
      systemSlug: null,
      title: f.name,
      subtitle: `Framework${f.systems_count ? ` · ${f.systems_count} ${f.systems_count === 1 ? "system" : "systems"}` : ""}`,
      body: null,
      keywords: keywordString([slugWords(f.slug), f.slug, ...(fwWords.get(f.slug) ?? [])]),
      url: frameworkUrl(f.slug),
      facets: { slug: f.slug, kind: f.kind, systemsCount: f.systems_count },
      boost: round(countBoost(f.systems_count, 0.6)),
    });
  }
  for (const c of categories.rows) {
    docs.push({
      entityType: "category",
      entityId: c.id,
      systemSlug: null,
      title: c.name,
      subtitle: `Component group · ${c.type_names.length} ${c.type_names.length === 1 ? "type" : "types"}`,
      body: joinBody([c.description, c.type_names.length ? `Includes: ${c.type_names.join(", ")}.` : null]),
      keywords: keywordString([slugWords(c.slug)]),
      url: categoryUrl(c.slug),
      facets: { slug: c.slug, group: c.slug, typesCount: c.type_names.length, componentsCount: c.components_count },
      boost: 1,
    });
  }
  return docs;
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
