/**
 * Search integration fixtures. FICTIONAL systems (names and *.example.test URLs are made up for
 * tests only and never reach the product DB). Taxonomy rows come from @/lib/taxonomy.
 */
import pg from "pg";
import { COMPONENT_GROUPS, COMPONENT_TYPES, FRAMEWORKS, PATTERN_TYPES, PLATFORMS } from "@/lib/taxonomy";

export const TEST_DB_URL = process.env.ATLAS_SEARCH_TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/atlas_search_test";

/** Create the test database from atlas_template if it does not exist. Refuses to touch "atlas". */
export async function ensureTestDatabase(url = TEST_DB_URL): Promise<void> {
  const u = new URL(url);
  const dbName = u.pathname.replace(/^\//, "");
  if (!dbName || dbName === "atlas" || dbName === "atlas_template" || dbName === "postgres") {
    throw new Error(`refusing to run search integration tests against database "${dbName}"`);
  }
  if (!/^[a-z0-9_]+$/.test(dbName)) throw new Error(`unexpected test database name ${dbName}`);
  const admin = new URL(url);
  admin.pathname = "/postgres";
  const c = new pg.Client({ connectionString: admin.toString() });
  await c.connect();
  try {
    const exists = await c.query("select 1 from pg_database where datname = $1", [dbName]);
    if (!exists.rowCount) await c.query(`create database ${dbName} template atlas_template`);
  } finally {
    await c.end();
  }
}

type Q = pg.Pool;

async function one<T = { id: string }>(db: Q, text: string, values: unknown[]): Promise<T> {
  const r = await db.query(text, values);
  return r.rows[0] as T;
}

export async function resetCanonical(db: Q): Promise<void> {
  await db.query(`truncate search_document, design_system, organization, license, framework, platform, category, tag,
    component_type, pattern_type restart identity cascade`);
}

export interface TaxonomyIds {
  componentType: Map<string, string>;
  patternType: Map<string, string>;
  framework: Map<string, string>;
  platform: Map<string, string>;
  tag: Map<string, string>;
}

export async function seedTaxonomy(db: Q): Promise<TaxonomyIds> {
  const groupIds = new Map<string, string>();
  for (const [i, g] of COMPONENT_GROUPS.entries()) {
    const r = await one(db, `insert into category (slug, kind, name, description, sort_order) values ($1, 'component-group', $2, $3, $4) returning id`, [g.slug, g.name, g.description, i]);
    groupIds.set(g.slug, r.id);
  }
  const componentType = new Map<string, string>();
  for (const [i, t] of COMPONENT_TYPES.entries()) {
    const r = await one(
      db,
      `insert into component_type (slug, name, category_id, description, aliases, near_synonyms, aria_pattern, sort_order) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
      [t.slug, t.name, groupIds.get(t.group), t.description, t.aliases, t.nearSynonyms, t.ariaPattern ?? null, i],
    );
    componentType.set(t.slug, r.id);
  }
  const patternType = new Map<string, string>();
  for (const [i, p] of PATTERN_TYPES.entries()) {
    const r = await one(db, `insert into pattern_type (slug, name, description, aliases, sort_order) values ($1,$2,$3,$4,$5) returning id`, [p.slug, p.name, p.description, p.aliases, i]);
    patternType.set(p.slug, r.id);
  }
  const framework = new Map<string, string>();
  for (const f of FRAMEWORKS) {
    const r = await one(db, `insert into framework (slug, name, kind, website_url) values ($1,$2,$3,$4) returning id`, [f.slug, f.name, f.kind, f.websiteUrl]);
    framework.set(f.slug, r.id);
  }
  const platform = new Map<string, string>();
  for (const p of PLATFORMS) {
    const r = await one(db, `insert into platform (slug, name) values ($1,$2) returning id`, [p.slug, p.name]);
    platform.set(p.slug, r.id);
  }
  const tag = new Map<string, string>();
  for (const [slug, name] of [["accessibility", "Accessibility"], ["enterprise", "Enterprise"], ["government", "Government"]] as const) {
    const r = await one(db, `insert into tag (slug, name) values ($1,$2) returning id`, [slug, name]);
    tag.set(slug, r.id);
  }
  return { componentType, patternType, framework, platform, tag };
}

export interface SystemSpec {
  slug: string;
  name: string;
  org: string;
  category?: string;
  summary: string;
  frameworks?: string[];
  platforms?: string[];
  tags?: string[];
  publishState?: "draft" | "published" | "quarantined" | "retired";
  registryStatus?: "candidate" | "verified" | "rejected";
  featured?: boolean;
  components?: ComponentSpec[];
  patterns?: { slug: string; name: string; type?: string; description?: string }[];
  tokenSets?: { slug: string; name: string; theme: string | null; tokens: TokenSpec[] }[];
}

export interface ComponentSpec {
  slug: string;
  name: string;
  type?: string | null;
  description?: string | null;
  aliases?: string[];
  variants?: string[];
  states?: { name: string; canonical: string | null }[];
  props?: string[];
  a11y?: { guidance: string } | null;
  frameworks?: string[];
  publishState?: "draft" | "published" | "quarantined" | "retired";
  lifecycle?: string;
}

export interface TokenSpec {
  name: string;
  category: string;
  tier?: "primitive" | "semantic" | "component" | null;
  value?: string;
  description?: string;
}

export async function insertSystem(db: Q, tax: TaxonomyIds, s: SystemSpec): Promise<string> {
  const org = await one(db, `insert into organization (slug, name) values ($1, $2) on conflict (slug) do update set name = excluded.name returning id`, [`${s.slug}-org`, s.org]);
  const sys = await one(
    db,
    `insert into design_system (slug, name, organization_id, category, summary, homepage_url, publish_state, registry_status, is_featured, maintenance_status, doc_access)
     values ($1,$2,$3,$4::system_category,$5,$6,$7::publish_state,$8::registry_status,$9,'active','public') returning id`,
    [s.slug, s.name, org.id, s.category ?? "design-system", s.summary, `https://${s.slug}.example.test`, s.publishState ?? "published", s.registryStatus ?? "verified", s.featured ?? false],
  );
  for (const f of s.frameworks ?? [])
    await db.query(`insert into design_system_framework (design_system_id, framework_id, verification_state) values ($1,$2,'verified')`, [sys.id, tax.framework.get(f)]);
  for (const p of s.platforms ?? ["web"])
    await db.query(`insert into design_system_platform (design_system_id, platform_id, verification_state) values ($1,$2,'verified')`, [sys.id, tax.platform.get(p)]);
  for (const t of s.tags ?? []) await db.query(`insert into design_system_tag (design_system_id, tag_id) values ($1,$2)`, [sys.id, tax.tag.get(t)]);

  for (const c of s.components ?? []) await insertComponent(db, tax, sys.id, c);
  for (const p of s.patterns ?? []) {
    await db.query(
      `insert into design_pattern (design_system_id, pattern_type_id, slug, name, description, docs_url) values ($1,$2,$3,$4,$5,$6)`,
      [sys.id, p.type ? tax.patternType.get(p.type) : null, p.slug, p.name, p.description ?? null, `https://${s.slug}.example.test/patterns/${p.slug}`],
    );
  }
  for (const ts of s.tokenSets ?? []) {
    const set = await one(
      db,
      `insert into token_set (design_system_id, slug, name, theme, format, source_url, token_count) values ($1,$2,$3,$4,'dtcg',$5,$6) returning id`,
      [sys.id, ts.slug, ts.name, ts.theme, `https://${s.slug}.example.test/tokens/${ts.slug}.json`, ts.tokens.length],
    );
    await insertTokens(db, sys.id, set.id, ts.tokens);
  }
  return sys.id;
}

export async function insertTokens(db: Q, systemId: string, setId: string, tokens: TokenSpec[]): Promise<void> {
  if (!tokens.length) return;
  await db.query(
    `insert into token (token_set_id, design_system_id, name, path, category, tier, raw_value, value_text, description)
     select $1, $2, t.name, string_to_array(t.name, '.'), t.category::token_category, t.tier::token_tier, to_jsonb(t.value), t.value, t.description
     from unnest($3::text[], $4::text[], $5::text[], $6::text[], $7::text[]) as t(name, category, tier, value, description)`,
    [
      setId,
      systemId,
      tokens.map((t) => t.name),
      tokens.map((t) => t.category),
      tokens.map((t) => t.tier ?? null),
      tokens.map((t) => t.value ?? null),
      tokens.map((t) => t.description ?? null),
    ],
  );
}

export async function insertComponent(db: Q, tax: TaxonomyIds, systemId: string, c: ComponentSpec): Promise<string> {
  const comp = await one(
    db,
    `insert into component (design_system_id, component_type_id, classification_state, classification_method, slug, name, aliases, description, lifecycle, publish_state)
     values ($1,$2,'inferred',$3,$4,$5,$6,$7,$8,$9::publish_state) returning id`,
    [
      systemId,
      c.type ? tax.componentType.get(c.type) : null,
      c.type ? `fixture:${c.type}` : null,
      c.slug,
      c.name,
      c.aliases ?? [],
      c.description ?? null,
      c.lifecycle ?? "stable",
      c.publishState ?? "published",
    ],
  );
  for (const v of c.variants ?? []) await db.query(`insert into component_variant (component_id, axis, slug, name) values ($1,'variant',$2,$3)`, [comp.id, v.toLowerCase(), v]);
  for (const st of c.states ?? [])
    await db.query(`insert into component_state (component_id, slug, name, canonical_state) values ($1,$2,$3,$4)`, [comp.id, st.name.toLowerCase(), st.name, st.canonical]);
  for (const p of c.props ?? []) await db.query(`insert into component_property (component_id, name, type) values ($1,$2,'string')`, [comp.id, p]);
  if (c.a11y) await db.query(`insert into component_accessibility (component_id, guidance, coverage) values ($1,$2,'{"guidance":"documented"}')`, [comp.id, c.a11y.guidance]);
  for (const f of c.frameworks ?? []) await db.query(`insert into component_framework (component_id, framework_id) values ($1,$2)`, [comp.id, tax.framework.get(f)]);
  return comp.id;
}

/* -------------------------------------------------------------------------- */
/* The fixture catalog                                                         */
/* -------------------------------------------------------------------------- */

export const FIXTURE_SYSTEMS: SystemSpec[] = [
  {
    slug: "lumen",
    name: "Lumen",
    org: "Lumen Labs",
    summary: "Fictional test system: a React component library with documented keyboard and screen reader guidance.",
    frameworks: ["react"],
    tags: ["accessibility"],
    featured: true,
    components: [
      {
        slug: "button",
        name: "Button",
        type: "button",
        description: "Triggers an action. Supports a loading state that announces progress.",
        variants: ["Primary", "Secondary", "Danger"],
        states: [
          { name: "Hover", canonical: "hover" },
          { name: "Disabled", canonical: "disabled" },
          { name: "Loading", canonical: "loading" },
        ],
        props: ["variant", "loading"],
        a11y: { guidance: "Use a visible label; loading buttons set aria-busy." },
      },
      { slug: "combobox", name: "Combobox", type: "combobox", description: "Text input with a filterable popup list.", a11y: { guidance: "Follows the combobox pattern." }, frameworks: ["react"] },
      { slug: "date-picker", name: "DatePicker", type: "date-picker", description: "Choose a date from a calendar popover.", a11y: { guidance: "Calendar grid is keyboard navigable." } },
      { slug: "snackbar", name: "Snackbar", type: "toast", description: "Brief message shown at the bottom of the screen." },
      { slug: "pagination", name: "Pagination", type: "pagination", description: "Move between pages of results." },
      { slug: "table", name: "Table", type: "table", description: "Rows and columns of data." },
      { slug: "old-combobox", name: "Legacy Combobox", type: "combobox", publishState: "quarantined" },
    ],
    patterns: [{ slug: "empty-states", name: "Empty states", type: "empty-states", description: "What to show when a list has no items." }],
    tokenSets: [
      { slug: "base", name: "Base", theme: null, tokens: [
        { name: "palette.blue.500", category: "color", tier: "primitive", value: "#2f6fe4" },
        { name: "space.100", category: "spacing", tier: "primitive", value: "4px" },
      ] },
      { slug: "light", name: "Light", theme: "light", tokens: [
        { name: "color.bg.default", category: "color", tier: "semantic", value: "#ffffff", description: "Default page background." },
        { name: "color.fg.default", category: "color", tier: "semantic", value: "#1f2328" },
      ] },
      { slug: "dark", name: "Dark", theme: "dark", tokens: [
        { name: "color.bg.default", category: "color", tier: "semantic", value: "#0d1117", description: "Default page background." },
        { name: "color.fg.default", category: "color", tier: "semantic", value: "#e6edf3" },
      ] },
    ],
  },
  {
    slug: "harbor",
    name: "Harbor",
    org: "Harbor Systems",
    summary: "Fictional test system: an enterprise design system for data-dense admin applications.",
    frameworks: ["react", "angular"],
    tags: ["enterprise"],
    components: [
      { slug: "data-table", name: "Data table", type: "table", description: "Sortable, selectable table for large data sets.", props: ["rows", "columns"] },
      { slug: "toast", name: "Toast", type: "toast", description: "Temporary notification about a background task." },
      { slug: "button", name: "Button", type: "button", description: "Primary and secondary actions.", states: [{ name: "Disabled", canonical: "disabled" }] },
      { slug: "tabs", name: "Tabs", type: "tabs", description: "Switch between views." },
      { slug: "pager", name: "Pager", type: "pagination", description: "Compact page navigation." },
    ],
    tokenSets: [
      { slug: "dark", name: "Dark", theme: "dark", tokens: [{ name: "color.background.primary", category: "color", tier: "semantic", value: "#111111" }] },
      { slug: "light", name: "Light", theme: "light", tokens: [{ name: "color.background.primary", category: "color", tier: "semantic", value: "#fafafa" }] },
    ],
  },
  {
    slug: "civic",
    name: "Civic Design System",
    org: "Civic Digital Service",
    summary: "Fictional test system: a design system for public services and government websites.",
    frameworks: ["html-css", "nunjucks"],
    tags: ["government"],
    components: [
      { slug: "button", name: "Button", type: "button", description: "Use a button to help users carry out an action.", states: [{ name: "Disabled", canonical: "disabled" }] },
      { slug: "date-input", name: "Date input", type: "date-picker", description: "Ask users for a date they already know." },
      { slug: "notification-banner", name: "Notification banner", type: "alert", description: "Tell users about something important." },
      { slug: "pagination", name: "Pagination", type: "pagination", description: "Help users navigate long lists." },
    ],
    patterns: [
      { slug: "question-pages", name: "Question pages", type: "forms", description: "Ask one question per page." },
      { slug: "validation", name: "Validation", type: "error-recovery", description: "Check answers and show errors." },
    ],
    tokenSets: [{ slug: "spacing", name: "Spacing", theme: null, tokens: [{ name: "civic.spacing.3", category: "spacing", tier: "primitive", value: "15px" }] }],
  },
  {
    slug: "orbit-kit",
    name: "Orbit Kit",
    org: "Orbit Collective",
    category: "component-library",
    summary: "Fictional test system: Vue and web components for dashboards.",
    frameworks: ["vue", "web-components"],
    components: [
      { slug: "combobox", name: "Combobox", type: "combobox", description: "Searchable select for Vue apps." },
      { slug: "spinner", name: "Spinner", type: "spinner", description: "Indeterminate loading indicator." },
    ],
  },
  // Must never be indexed:
  {
    slug: "draft-kit",
    name: "Draft Kit",
    org: "Draft Org",
    summary: "Fictional unpublished system that must not appear in search results.",
    frameworks: ["react"],
    publishState: "draft",
    components: [{ slug: "combobox", name: "Combobox", type: "combobox" }],
  },
  {
    slug: "candidate-kit",
    name: "Candidate Kit",
    org: "Candidate Org",
    summary: "Fictional published-but-unverified system that must not appear in search results.",
    registryStatus: "candidate",
    components: [{ slug: "pagination", name: "Pagination", type: "pagination" }],
  },
];

export async function seedFixtures(db: Q): Promise<TaxonomyIds> {
  await resetCanonical(db);
  const tax = await seedTaxonomy(db);
  for (const s of FIXTURE_SYSTEMS) await insertSystem(db, tax, s);
  return tax;
}
