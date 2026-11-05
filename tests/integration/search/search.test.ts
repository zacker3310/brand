/**
 * Search integration tests against a dedicated database (default atlas_search_test, created from
 * atlas_template if missing; override with ATLAS_SEARCH_TEST_DATABASE_URL). No network.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { NextRequest } from "next/server";
import { COMPONENT_GROUPS, COMPONENT_TYPES, FRAMEWORKS, PATTERN_TYPES } from "@/lib/taxonomy";
import type { SearchHit, SearchResult } from "@/lib/contracts";
import { TEST_DB_URL, ensureTestDatabase, insertComponent, seedFixtures, type TaxonomyIds } from "./fixtures";

process.env.DATABASE_URL = TEST_DB_URL;

type SearchMod = typeof import("@/server/search");
let s: SearchMod;
let pool: pg.Pool;
let tax: TaxonomyIds;
let closeDb: () => Promise<void>;
let first: Awaited<ReturnType<SearchMod["reindexAll"]>>;

const q = (query: string, extra: Partial<Parameters<SearchMod["search"]>[0]> = {}) => s.search({ q: query, limit: 20, offset: 0, ...extra });
const componentHits = (r: SearchResult) => r.hits.filter((h) => h.entityType === "component");
const key = (h: SearchHit) => `${h.entityType}:${h.systemSlug ?? "-"}:${h.title}`;

beforeAll(async () => {
  await ensureTestDatabase();
  const client = await import("@/db/client");
  await client.closeDb(); // drop any pool another test file left on globalThis
  process.env.DATABASE_URL = TEST_DB_URL;
  const db = new URL(client.databaseUrl()).pathname;
  if (db === "/atlas") throw new Error("refusing to run against the integrator database");
  closeDb = client.closeDb;
  pool = client.getPool();
  tax = await seedFixtures(pool);
  s = await import("@/server/search");
  first = await s.reindexAll();
});

afterAll(async () => {
  await closeDb?.();
});

describe("indexing", () => {
  it("indexes only published + verified systems and published records", async () => {
    const counts = Object.fromEntries(
      (await pool.query<{ entity_type: string; n: number }>("select entity_type, count(*)::int as n from search_document group by 1")).rows.map((r) => [r.entity_type, r.n]),
    );
    expect(counts).toEqual({
      system: 4,
      component: 17, // Lumen 6 (quarantined Legacy Combobox excluded) + Harbor 5 + Civic 4 + Orbit 2
      token: 9,
      pattern: 3,
      "component-type": COMPONENT_TYPES.length,
      "pattern-type": PATTERN_TYPES.length,
      framework: FRAMEWORKS.length,
      category: COMPONENT_GROUPS.length,
    });
    expect(first.documents).toBe(Object.values(counts).reduce((a, b) => a + b, 0));
    const leaked = await pool.query(
      "select title, system_slug from search_document where system_slug in ('draft-kit', 'candidate-kit') or title = 'Legacy Combobox'",
    );
    expect(leaked.rows).toEqual([]);
  });

  it("reindexAll is idempotent", async () => {
    const again = await s.reindexAll();
    expect(again).toMatchObject({ documents: first.documents, written: 0, removed: 0 });
  });

  it("documents carry honest facets and canonical URLs", async () => {
    const r = await pool.query<{ entity_type: string; url: string; subtitle: string; facets: Record<string, unknown> }>(
      "select entity_type, url, subtitle, facets from search_document where (entity_type = 'component' and system_slug = 'harbor' and title = 'Data table') or (entity_type = 'system' and system_slug = 'civic') or (entity_type = 'token' and system_slug = 'lumen' and title = 'palette.blue.500')",
    );
    const by = Object.fromEntries(r.rows.map((x) => [x.entity_type, x]));
    expect(by.component).toMatchObject({
      url: "/systems/harbor/components/data-table",
      subtitle: "Harbor · Table",
      facets: { system: "harbor", componentType: "table", group: "data-display", frameworks: ["angular", "react"], frameworksSource: "system", hasA11y: false, hasProps: true, states: [], variantCount: 0 },
    });
    expect(by.system).toMatchObject({
      url: "/systems/civic",
      subtitle: "Civic Digital Service · Design system",
      facets: { category: "design-system", frameworks: ["html-css", "nunjucks"], platforms: ["web"], tags: ["government"], license: null, maintenance: "active", docAccess: "public" },
    });
    expect(by.token).toMatchObject({ url: "/tokens?system=lumen&q=palette.blue.500", subtitle: "Lumen · color", facets: { tier: "primitive", theme: null } });
  });
});

describe("example queries", () => {
  it("Accessible date picker: documented-a11y implementation ranks above the undocumented one", async () => {
    const r = await q("Accessible date picker");
    expect(r.hits[0]).toMatchObject({ entityType: "component-type", title: "Date picker", url: "/components/date-picker" });
    const comps = componentHits(r).map(key);
    expect(comps.slice(0, 2)).toEqual(["component:lumen:DatePicker", "component:civic:Date input"]);
    expect(r.interpretedFilters).toMatchObject({ componentTypes: ["date-picker"], accessibility: ["documented"] });
  });

  it("Enterprise data table: the enterprise system's table is the top hit", async () => {
    const r = await q("Enterprise data table");
    expect(key(r.hits[0]!)).toBe("component:harbor:Data table");
    expect(r.hits.map(key)).toContain("component:lumen:Table");
    expect(r.expansions).toEqual(expect.arrayContaining(["table", "data grid"]));
  });

  it("Dark mode tokens: only dark-theme tokens", async () => {
    const r = await q("Dark mode tokens");
    expect(r.total).toBe(3);
    expect(r.hits.every((h) => h.entityType === "token" && h.facets.theme === "dark")).toBe(true);
    expect(r.facets.entityType).toEqual([{ value: "token", count: 3 }]);
    expect(r.interpretedFilters).toMatchObject({ types: ["token"], theme: ["dark"] });
  });

  it("React combobox: React implementations only, Vue one filtered out", async () => {
    const r = await q("React combobox");
    expect(r.hits[0]).toMatchObject({ entityType: "component-type", title: "Combobox" });
    expect(componentHits(r).map(key)).toEqual(["component:lumen:Combobox"]);
    expect(r.interpretedFilters.frameworks).toEqual(["react"]);
  });

  it("Government design systems: the government-tagged system", async () => {
    const r = await q("Government design systems");
    expect(r.hits.map(key)).toEqual(["system:civic:Civic Design System"]);
    expect(r.hits[0]!.highlight).toContain("<mark>government</mark>");
  });

  it("Button with loading state: the button documenting a loading state ranks first", async () => {
    const r = await q("Button with loading state");
    expect(r.hits[0]).toMatchObject({ entityType: "component-type", title: "Button" });
    const comps = componentHits(r);
    expect(key(comps[0]!)).toBe("component:lumen:Button");
    expect(comps.slice(1, 3).map((h) => h.systemSlug).sort()).toEqual(["civic", "harbor"]);
    expect(r.interpretedFilters.states).toEqual(["loading"]);
  });
});

describe("matching behaviour", () => {
  it("fuzzy: 'comobox' finds combobox", async () => {
    const r = await q("comobox");
    expect(r.hits.slice(0, 3).map((h) => h.title)).toEqual(["Combobox", "Combobox", "Combobox"]);
    expect(r.expansions).toEqual(["combobox"]);
  });

  it("fuzzy (trigram only): a misspelled system name", async () => {
    const r = await q("harbr");
    expect(r.hits[0]).toMatchObject({ entityType: "system", title: "Harbor" });
  });

  it("prefix: 'pagin' finds pagination", async () => {
    const r = await q("pagin");
    expect(r.hits[0]).toMatchObject({ entityType: "component-type", title: "Pagination" });
    expect(componentHits(r).map(key)).toEqual(expect.arrayContaining(["component:civic:Pagination", "component:lumen:Pagination", "component:harbor:Pager"]));
  });

  it("synonym: 'snackbar' finds toast components under their own names", async () => {
    const r = await q("snackbar");
    expect(componentHits(r).map(key)).toEqual(["component:lumen:Snackbar", "component:harbor:Toast"]);
    expect(r.expansions).toContain("toast");
  });

  it("explicit framework filter", async () => {
    const r = await q("combobox", { frameworks: ["vue"] });
    expect(componentHits(r).map(key)).toEqual(["component:orbit-kit:Combobox"]);
    expect(r.hits.filter((h) => h.entityType === "system")).toEqual([]);
    const f = await q("", { frameworks: ["vue"], types: ["system"] });
    expect(f.hits.map(key)).toEqual(["system:orbit-kit:Orbit Kit"]);
  });

  it("explicit system and type filters", async () => {
    const r = await q("button", { systems: ["civic"] });
    expect(r.hits.every((h) => h.systemSlug === "civic")).toBe(true);
    const t = await q("button", { types: ["component"] });
    expect(t.total).toBe(3);
    expect(t.hits.every((h) => h.entityType === "component")).toBe(true);
    // explicit type filter -> entity facet still shows the other types (UI tabs)
    expect(t.facets.entityType?.find((f) => f.value === "component-type")?.count).toBeGreaterThan(0);
  });

  it("facets are counted over the result set", async () => {
    const r = await q("button");
    const f = (k: string) => Object.fromEntries((r.facets[k] ?? []).map((x) => [x.value, x.count]));
    expect(f("entityType").component).toBe(3);
    expect(f("system")).toMatchObject({ civic: 1, harbor: 1, lumen: 1 });
    expect(f("framework")).toMatchObject({ react: 2, angular: 1, "html-css": 1, nunjucks: 1 });
    expect(f("group").actions).toBeGreaterThanOrEqual(4);
    expect(r.total).toBe(r.facets.entityType!.reduce((a, b) => a + b.count, 0));
  });

  it("pagination is stable and disjoint", async () => {
    const a = await q("button", { limit: 3, offset: 0 });
    const b = await q("button", { limit: 3, offset: 3 });
    expect(a.total).toBe(b.total);
    const ids = new Set(a.hits.map((h) => h.entityId));
    expect(b.hits.some((h) => ids.has(h.entityId))).toBe(false);
  });

  it("negation and quoted phrases", async () => {
    const r = await q("button -harbor");
    expect(componentHits(r).map((h) => h.systemSlug).sort()).toEqual(["civic", "lumen"]);
    const p = await q('"loading state"');
    expect(p.hits.map(key)).toEqual(["component:lumen:Button"]);
  });

  it("relaxes interpreted filters, then terms, when nothing matches", async () => {
    const r = await q("pagination tokens");
    expect(r.interpretedFilters.relaxed).toEqual(["filters"]);
    expect(r.hits[0]).toMatchObject({ title: "Pagination" });
    const fz = await q("harbr buton");
    expect(fz.interpretedFilters.relaxed).toEqual(["fuzzy"]);
    const t = await q("combobox xylophone quartz zebra");
    expect(t.interpretedFilters.relaxed).toEqual(["terms"]);
    expect(t.hits.some((h) => h.title === "Combobox")).toBe(true);
    // a real word next to an unknown one does not silently match on trigram similarity
    const strict = await q("combobox xylophone");
    expect(strict.interpretedFilters.relaxed).toEqual(["fuzzy"]);
    // explicit filters are never relaxed
    const e = await q("pagination", { types: ["token"] });
    expect(e.total).toBe(0);
    expect(e.interpretedFilters.relaxed).toBeUndefined();
  });

  it("is fast on the fixture catalog", async () => {
    for (const query of ["Accessible date picker", "Enterprise data table", "Dark mode tokens", "React combobox", "Government design systems", "Button with loading state"]) {
      const r = await q(query);
      expect(r.tookMs).toBeLessThan(150);
    }
  });

  it("queries are index-compatible (GIN tsv + trigram) when the planner prefers indexes", async () => {
    const { buildSearchSql, buildSuggestSql } = await import("@/server/search/providers/postgres");
    const sql = buildSearchSql(s.parseQuery({ q: "comobox", limit: 20, offset: 0 }));
    const sug = buildSuggestSql("pagin", 8)!;
    const c = await pool.connect();
    try {
      await c.query("set enable_seqscan = off");
      const plan = (await c.query(`explain ${sql.text}`, sql.values)).rows.map((x) => x["QUERY PLAN"] as string).join("\n");
      expect(plan).toContain("search_document_tsv_idx");
      expect(plan).toContain("search_document_title_trgm");
      const plan2 = (await c.query(`explain ${sug.text}`, sug.values)).rows.map((x) => x["QUERY PLAN"] as string).join("\n");
      expect(plan2).toContain("search_document_title_trgm");
      expect(plan2).toContain("search_document_tsv_idx");
    } finally {
      await c.query("reset enable_seqscan");
      c.release();
    }
  });
});

describe("suggest", () => {
  it("prefix + trigram suggestions across entity types", async () => {
    const r = await s.suggest("pagin");
    expect(r[0]).toMatchObject({ title: "Pagination", url: "/components/pagination", entityType: "component-type" });
    expect(r.length).toBeLessThanOrEqual(8);
    expect(new Set(r.map((x) => x.title.toLowerCase())).size).toBe(r.length); // de-duplicated titles
    const snack = await s.suggest("snack");
    expect(snack[0]).toMatchObject({ title: "Snackbar", entityType: "component" });
    expect((await s.suggest("civic"))[0]).toMatchObject({ entityType: "system", url: "/systems/civic" });
    expect(await s.suggest("   ")).toEqual([]);
  });
});

describe("reindexSystem", () => {
  it("rebuilds one system and the taxonomy counts that depend on it", async () => {
    const harbor = (await pool.query<{ id: string }>("select id from design_system where slug = 'harbor'")).rows[0]!.id;
    await pool.query("delete from component where design_system_id = $1 and slug = 'toast'", [harbor]);
    await insertComponent(pool, tax, harbor, { slug: "date-range-picker", name: "Date range picker", type: "date-picker", description: "Pick a start and end date." });
    const res = await s.reindexSystem("harbor");
    expect(res.removed).toBe(1);
    const snack = await q("snackbar");
    expect(componentHits(snack).map(key)).toEqual(["component:lumen:Snackbar"]);
    const toastType = await pool.query("select subtitle from search_document where entity_type = 'component-type' and title = 'Toast'");
    expect(toastType.rows[0].subtitle).toBe("Component type · Feedback · 1 system");
    const dp = await q("date range picker");
    expect(dp.hits.map(key)).toContain("component:harbor:Date range picker");
  });

  it("removes every document of a system that is no longer published", async () => {
    await pool.query("update design_system set publish_state = 'draft' where slug = 'orbit-kit'");
    await s.reindexSystem("orbit-kit");
    const left = await pool.query("select count(*)::int as n from search_document where system_slug = 'orbit-kit'");
    expect(left.rows[0].n).toBe(0);
    const vue = await pool.query("select subtitle from search_document where entity_type = 'framework' and title = 'Vue'");
    expect(vue.rows[0].subtitle).toBe("Framework");
    await pool.query("update design_system set publish_state = 'published' where slug = 'orbit-kit'");
    await s.reindexSystem("orbit-kit");
    expect((await q("combobox", { frameworks: ["vue"] })).hits.some((h) => h.systemSlug === "orbit-kit")).toBe(true);
  });
});

describe("API routes", () => {
  it("GET /api/search returns SearchResult with short cache headers", async () => {
    const { GET } = await import("@/app/api/search/route");
    const res = await GET(new NextRequest("http://localhost/api/search?q=React%20combobox&types=component,component-type&limit=5"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toMatch(/max-age=\d+/);
    const body = (await res.json()) as SearchResult;
    expect(body.query).toBe("React combobox");
    expect(body.hits.length).toBeLessThanOrEqual(5);
    expect(body.hits.every((h) => h.entityType === "component" || h.entityType === "component-type")).toBe(true);
    expect(body.interpretedFilters.frameworks).toEqual(["react"]);
  });

  it("GET /api/search rejects bad input with 400", async () => {
    const { GET } = await import("@/app/api/search/route");
    for (const qs of ["types=widget", "limit=0", "limit=500", "offset=-3", `q=${"z".repeat(300)}`, "systems=Not%20A%20Slug"]) {
      const res = await GET(new NextRequest(`http://localhost/api/search?${qs}`));
      expect(res.status, qs).toBe(400);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(((await res.json()) as { error: string }).error).toBe("invalid_query");
    }
  });

  it("GET /api/search/suggest", async () => {
    const { GET } = await import("@/app/api/search/suggest/route");
    const ok = await GET(new NextRequest("http://localhost/api/search/suggest?q=pagin"));
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as { suggestions: { title: string }[] };
    expect(body.suggestions[0]!.title).toBe("Pagination");
    expect((await GET(new NextRequest("http://localhost/api/search/suggest?q=pagin&limit=99"))).status).toBe(400);
    const empty = await GET(new NextRequest("http://localhost/api/search/suggest"));
    expect(((await empty.json()) as { suggestions: unknown[] }).suggestions).toEqual([]);
  });
});
