/**
 * Collections, curated collections, catalog API read models and ingestion status against a
 * dedicated database (atlas_platform_test, created from atlas_template). Never the dev DB.
 */
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TEST_DB_URL = process.env.ATLAS_PLATFORM_TEST_DB ?? "postgres://postgres:postgres@localhost:5432/atlas_platform_test";
process.env.DATABASE_URL = TEST_DB_URL;

const OWNER = "anon:11111111-1111-4111-8111-111111111111";
const OTHER = "anon:22222222-2222-4222-8222-222222222222";
const ids = {
  cat: "00000000-0000-4000-8000-0000000000c1",
  type: "00000000-0000-4000-8000-0000000000t1".replace("t", "a"),
  sysA: "00000000-0000-4000-8000-00000000a001",
  sysB: "00000000-0000-4000-8000-00000000b001",
  lic: "00000000-0000-4000-8000-00000000c0de",
  compA: "00000000-0000-4000-8000-00000000a101",
  compA2: "00000000-0000-4000-8000-00000000a102",
  setA: "00000000-0000-4000-8000-00000000a201",
  setB: "00000000-0000-4000-8000-00000000b201",
  tokA: "00000000-0000-4000-8000-00000000a301",
  tokB: "00000000-0000-4000-8000-00000000b301",
  tag: "00000000-0000-4000-8000-00000000f001",
  run: "00000000-0000-4000-8000-00000000e001",
};

async function admin<T>(fn: (c: pg.Client) => Promise<T>, url = TEST_DB_URL.replace(/\/[^/]+$/, "/postgres")): Promise<T> {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

beforeAll(async () => {
  const name = new URL(TEST_DB_URL).pathname.slice(1);
  if (name === "atlas") throw new Error("refusing to run against the dev database");
  await admin(async (c) => {
    const { rows } = await c.query("select 1 from pg_database where datname = $1", [name]);
    if (!rows.length) await c.query(`create database "${name}" template atlas_template`);
  });
  await admin(async (c) => {
    const { rows } = await c.query<{ tablename: string }>("select tablename from pg_tables where schemaname = 'public'");
    await c.query(`truncate ${rows.map((r) => `"${r.tablename}"`).join(", ")} restart identity cascade`);
    await c.query(`
      insert into category (id, slug, kind, name) values ('${ids.cat}', 'actions', 'component-group', 'Actions');
      insert into component_type (id, slug, name, category_id, description) values ('${ids.type}', 'button', 'Button', '${ids.cat}', 'Triggers an action.');
      insert into license (id, slug, name, redistribution) values ('${ids.lic}', 'mit', 'MIT', 'permitted');
      insert into design_system (id, slug, name, category, registry_status, publish_state, ingestion_status, homepage_url, docs_url, license_id, confidence)
        values ('${ids.sysA}', 'alpha-ds', 'Alpha DS', 'design-system', 'verified', 'published', 'indexed', 'https://alpha.example/', 'https://alpha.example/docs', '${ids.lic}', 0.9),
               ('${ids.sysB}', 'beta-hl', 'Beta Headless', 'headless-library', 'verified', 'published', 'metadata_only', 'https://beta.example/', null, null, 0.8);
      insert into design_system (slug, name, category, registry_status, publish_state, duplicate_of_slug, confidence)
        values ('alpha-dup', 'Alpha Duplicate', 'design-system', 'duplicate', 'draft', 'alpha-ds', 0.9);
      insert into tag (id, slug, name) values ('${ids.tag}', 'government', 'Government');
      insert into design_system_tag (design_system_id, tag_id) values ('${ids.sysB}', '${ids.tag}');
      insert into component (id, design_system_id, component_type_id, slug, name, docs_url, coverage, classification_state, classification_method)
        values ('${ids.compA}', '${ids.sysA}', '${ids.type}', 'button', 'Button', 'https://alpha.example/docs/button', '{"variants":"documented","states":"not-extracted"}', 'inferred', 'alias-exact:button'),
               ('${ids.compA2}', '${ids.sysA}', null, 'buttons', 'Buttons', null, '{}', 'inferred', null);
      insert into component_variant (component_id, axis, slug, name) values ('${ids.compA}', 'variant', 'primary', 'Primary');
      insert into token_set (id, design_system_id, slug, name, format, source_url, redistribution, license_id)
        values ('${ids.setA}', '${ids.sysA}', 'base', 'Base', 'dtcg', 'https://cdn.example/alpha/tokens.json', 'permitted', '${ids.lic}'),
               ('${ids.setB}', '${ids.sysB}', 'core', 'Core', 'css-vars', 'https://cdn.example/beta/tokens.css', 'restricted', null);
      insert into token (id, token_set_id, design_system_id, name, path, category, raw_value, resolved_value, value_text)
        values ('${ids.tokA}', '${ids.setA}', '${ids.sysA}', 'color.fg', '{color,fg}', 'color', '"#111111"', '"#111111"', '#111111'),
               ('${ids.tokB}', '${ids.setB}', '${ids.sysB}', '--beta-fg', '{beta,fg}', 'color', '"#222222"', '"#222222"', '#222222');
      insert into ingestion_run (id, design_system_id, kind, status, stage, stats) values ('${ids.run}', '${ids.sysA}', 'incremental', 'succeeded', 'done', '{"discovered": 3, "published": 2}');
      insert into ingestion_job (run_id, design_system_id, kind, status, last_error) values ('${ids.run}', '${ids.sysA}', 'fetch', 'dead', 'secret stack trace');
    `);
  }, TEST_DB_URL);
});

afterAll(async () => {
  const { closeDb } = await import("@/db/client");
  await closeDb();
});

describe("collections (owner-scoped)", () => {
  it("creates, adds, reorders, edits, isolates owners and deletes", async () => {
    const c = await import("@/server/queries/collections");
    const { getDb } = await import("@/db/client");
    const db = getDb();
    const created = await c.createCollection(OWNER, { name: "Buttons to compare", description: null }, db);
    expect(created.slug).toBe("buttons-to-compare");
    const again = await c.createCollection(OWNER, { name: "Buttons to compare", description: null }, db);
    expect(again.slug).toBe("buttons-to-compare-2");
    const reserved = await c.createCollection(OWNER, { name: "Add", description: null }, db);
    expect(reserved.slug).toBe("add-collection");

    const a = await c.addItem(OWNER, created.id, { entityType: "component", entityId: ids.compA }, { note: "primary", tags: ["review"] }, db);
    expect(a.alreadyPresent).toBe(false);
    expect((await c.addItem(OWNER, created.id, { entityType: "component", entityId: ids.compA }, {}, db)).alreadyPresent).toBe(true);
    await c.addItem(OWNER, created.id, { entityType: "system", entityId: ids.sysB }, {}, db);
    await c.addItem(OWNER, created.id, { entityType: "token", entityId: ids.tokA }, {}, db);
    await expect(c.addItem(OWNER, created.id, { entityType: "component", entityId: "00000000-0000-4000-8000-000000000000" }, {}, db)).rejects.toThrow(/not in the ATLAS index/);
    await expect(c.addItem(OTHER, created.id, { entityType: "system", entityId: ids.sysA }, {}, db)).rejects.toThrow(/not yours/);

    let detail = (await c.getCollection(OWNER, created.slug, db))!;
    expect(detail.items.map((i) => i.title)).toEqual(["Button", "Beta Headless", "color.fg"]);
    expect(detail.items[0]).toMatchObject({ exists: true, systemSlug: "alpha-ds", sourceUrl: "https://alpha.example/docs/button", subtitle: "Button", verification: "inferred", url: "/systems/alpha-ds/components/button" });
    expect(detail.items[1]).toMatchObject({ subtitle: "Headless library", sourceUrl: "https://beta.example/" });
    expect(detail.items[2]).toMatchObject({ sourceUrl: "https://cdn.example/alpha/tokens.json" });
    expect(detail.typeCounts).toEqual({ component: 1, system: 1, token: 1 });

    await c.moveItem(OWNER, detail.items[2]!.itemId, "top", db);
    await c.updateItem(OWNER, detail.items[1]!.itemId, { note: "headless", tags: ["a11y"] }, db);
    detail = (await c.getCollection(OWNER, created.slug, db))!;
    expect(detail.items.map((i) => i.title)).toEqual(["color.fg", "Button", "Beta Headless"]);
    expect(detail.items.map((i) => i.position)).toEqual([0, 1, 2]);
    expect(detail.tags.map((t) => t.tag).sort()).toEqual(["a11y", "review"]);

    expect(await c.getCollection(OTHER, created.slug, db)).toBeNull();
    await expect(c.removeItem(OTHER, detail.items[0]!.itemId, db)).rejects.toThrow();
    await c.removeItem(OWNER, detail.items[0]!.itemId, db);

    const summaries = await c.listOwnerCollections(OWNER, db);
    const s = summaries.find((x) => x.slug === created.slug)!;
    expect(s.itemCount).toBe(2);
    expect(s.typeCounts).toEqual({ component: 1, system: 1 });
    expect(await c.listOwnerCollections(OTHER, db)).toEqual([]);

    await expect(c.deleteCollection(OTHER, created.id, db)).rejects.toThrow();
    await c.deleteCollection(OWNER, created.id, db);
    expect(await c.getCollection(OWNER, created.slug, db)).toBeNull();
  });

  it("bookmarks toggle, batch status, and keep removed records honestly", async () => {
    const c = await import("@/server/queries/collections");
    const { getDb } = await import("@/db/client");
    const db = getDb();
    expect(await c.toggleBookmark(OWNER, { entityType: "component", entityId: ids.compA2 }, undefined, db)).toEqual({ bookmarked: true });
    expect(await c.toggleBookmark(OWNER, { entityType: "component", entityId: ids.compA2 }, true, db)).toEqual({ bookmarked: true });
    const states = await c.bookmarkStates(OWNER, [
      { entityType: "component", entityId: ids.compA2 },
      { entityType: "component", entityId: ids.compA },
    ], db);
    expect([...states]).toEqual([`component:${ids.compA2}`]);
    expect((await c.bookmarkStates(OTHER, [{ entityType: "component", entityId: ids.compA2 }], db)).size).toBe(0);

    await db.execute((await import("drizzle-orm")).sql`delete from component where id = ${ids.compA2}`);
    const list = await c.listBookmarks(OWNER, db);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ exists: false, url: null, title: "Record no longer in the index" });
    expect(await c.toggleBookmark(OWNER, { entityType: "component", entityId: ids.compA2 }, false, db)).toEqual({ bookmarked: false });
  });
});

describe("curated collections", () => {
  it("are data-derived and idempotent", async () => {
    const { syncCuratedCollections } = await import("../../../scripts/seed-collections");
    const { getDb } = await import("@/db/client");
    const c = await import("@/server/queries/collections");
    const db = getDb();
    const first = await syncCuratedCollections(db);
    const bySlug = Object.fromEntries(first.map((r) => [r.slug, r]));
    expect(bySlug["government-and-public-sector"]!.members).toBe(1);
    expect(bySlug["headless-and-primitive-libraries"]!.members).toBe(1);
    expect(bySlug["deeply-indexed-systems"]!.members).toBe(1);
    expect(bySlug["systems-with-official-design-tokens"]!.members).toBe(2);
    expect(bySlug["web-components-implementations"]!.members).toBe(0);
    const second = await syncCuratedCollections(db);
    expect(second.every((r) => !r.changed && r.added === 0 && r.removed === 0)).toBe(true);

    const curated = await c.getCollection(null, "deeply-indexed-systems", db);
    expect(curated).toMatchObject({ isCurated: true, isOwner: false, itemCount: 1 });
    expect(curated!.description).toMatch(/^Rule:/);
    expect(curated!.items[0]!.title).toBe("Alpha DS");
    // A visitor's own collection with the same slug wins for that visitor only.
    const mine = await c.createCollection(OWNER, { name: "Deeply indexed systems", description: null }, db);
    expect(mine.slug).toBe("deeply-indexed-systems-2");
  });
});

describe("catalog API read models", () => {
  it("lists verified systems with live counts and filters", async () => {
    const api = await import("@/server/api/catalog");
    const { getDb } = await import("@/db/client");
    const db = getDb();
    const all = await api.listSystems({ registry: "verified", page: 1, pageSize: 10 }, db);
    expect(all.total).toBe(2);
    const alpha = all.data.find((s) => s.slug === "alpha-ds")!;
    expect(alpha.counts).toMatchObject({ components: 1, tokens: 1, tokenSets: 1 });
    expect(alpha.license).toMatchObject({ slug: "mit", redistribution: "permitted" });
    expect((await api.listSystems({ registry: "all", page: 1, pageSize: 10 }, db)).total).toBe(3);
    expect((await api.listSystems({ registry: "verified", category: "headless-library", page: 1, pageSize: 10 }, db)).data.map((s) => s.slug)).toEqual(["beta-hl"]);
    expect((await api.listSystems({ registry: "verified", q: "alp", page: 1, pageSize: 10 }, db)).data.map((s) => s.slug)).toEqual(["alpha-ds"]);
    expect((await api.listSystems({ registry: "verified", q: "%", page: 1, pageSize: 10 }, db)).total).toBe(0);
  });

  it("returns component detail with variants and an unknown component as null", async () => {
    const api = await import("@/server/api/catalog");
    const { getDb } = await import("@/db/client");
    const db = getDb();
    const d = await api.getComponentDetail("alpha-ds", "button", db);
    expect(d).toMatchObject({ name: "Button", type: { slug: "button" }, classification: { state: "inferred", method: "alias-exact:button" }, accessibility: null });
    expect(d!.variants).toEqual([{ axis: "variant", slug: "primary", name: "Primary", description: null, sourceUrl: null }]);
    expect(d!.coverage).toEqual({ variants: "documented", states: "not-extracted" });
    expect(await api.getComponentDetail("alpha-ds", "nope", db)).toBeNull();
    const byType = await api.listComponents({ type: "button", page: 1, pageSize: 10 }, db);
    expect(byType.data.map((c) => c.slug)).toEqual(["button"]);
  });

  it("withholds token values unless redistribution is permitted", async () => {
    const api = await import("@/server/api/catalog");
    const { getDb } = await import("@/db/client");
    const db = getDb();
    const t = await api.listTokens({ page: 1, pageSize: 10 }, db);
    const a = t.data.find((x) => x.system.slug === "alpha-ds")!;
    const b = t.data.find((x) => x.system.slug === "beta-hl")!;
    expect(a).toMatchObject({ valueWithheld: false, valueText: "#111111" });
    expect(b).toMatchObject({ valueWithheld: true, valueText: null, rawValue: null, resolvedValue: null });
    expect(b.set.redistribution).toBe("restricted");
  });

  it("public ingestion status exposes counts and runs but never error text", async () => {
    const api = await import("@/server/api/catalog");
    const { getDb } = await import("@/db/client");
    const s = await api.ingestionStatus(5, getDb());
    expect(s.queue.byStatus).toEqual({ dead: 1 });
    expect(s.runs[0]).toMatchObject({ system: "alpha-ds", status: "succeeded", stats: { discovered: 3, published: 2 } });
    expect(JSON.stringify(s)).not.toContain("secret stack trace");
  });
});

describe("ops read models", () => {
  it("summarise registry, queue and systems", async () => {
    const ops = await import("@/server/queries/ops");
    const { getDb } = await import("@/db/client");
    const db = getDb();
    const o = await ops.opsOverview(db);
    expect(o.registry).toMatchObject({ verified: 2, duplicate: 1 });
    expect(o.jobs).toEqual({ dead: 1 });
    const q = await ops.queueView({}, db);
    expect(q.problems[0]).toMatchObject({ kind: "fetch", status: "dead", lastError: "secret stack trace" });
    const sys = await ops.opsSystems({ sort: "components", registry: "verified" }, db);
    expect(sys[0]).toMatchObject({ slug: "alpha-ds", components: 1, tokens: 1, componentsClassified: 1 });
    const dup = await ops.duplicateCandidates(db);
    expect(dup.registry.map((r) => r.slug)).toEqual(["alpha-dup"]);
    expect(dup.components).toEqual([]); // "Button" vs deleted "Buttons" no longer pair
  });
});
