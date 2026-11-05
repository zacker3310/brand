import { readFileSync } from "node:fs";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { SourceAdapter } from "@/ingestion/types";
import { prepareTestDb, truncateAll } from "./helpers";

await prepareTestDb();
const { closeDb, getDb } = await import("@/db/client");
const s = await import("@/db/schema");
const { importRegistry } = await import("@/ingestion/registry/import");
const { seedReferenceData } = await import("@/ingestion/registry/reference");
const taxonomy = await import("@/lib/taxonomy");

const FIXTURE = path.join(import.meta.dirname, "../../fixtures/engine/registry-sample.json");
const sample = () => JSON.parse(readFileSync(FIXTURE, "utf8")) as Record<string, unknown>[];
const fakeAdapter = { id: "fake" } as SourceAdapter;
const resolveAdapter = (slug: string) => (slug === "atlas-test-gamma" ? fakeAdapter : undefined);
const db = () => getDb();

async function tableCounts() {
  const out: Record<string, number> = {};
  for (const t of ["organization", "license", "design_system", "design_system_framework", "design_system_platform", "design_system_tag", "tag", "source", "verification_evidence", "change_event"]) {
    out[t] = ((await db().execute(sql.raw(`select count(*)::int as n from ${t}`))).rows[0] as { n: number }).n;
  }
  return out;
}

const system = async (slug: string) => (await db().select().from(s.designSystems).where(eq(s.designSystems.slug, slug)))[0]!;

beforeEach(async () => {
  await truncateAll();
});
afterAll(async () => {
  await closeDb();
});

describe("reference seed", () => {
  it("seeds taxonomy reference data idempotently", async () => {
    const first = await seedReferenceData();
    expect(first.componentTypes.inserted).toBe(taxonomy.COMPONENT_TYPES.length);
    expect(first.categories.inserted).toBe(taxonomy.COMPONENT_GROUPS.length);
    expect(first.patternTypes.inserted).toBe(taxonomy.PATTERN_TYPES.length);
    expect(first.frameworks.inserted).toBe(taxonomy.FRAMEWORKS.length);
    expect(first.platforms.inserted).toBe(taxonomy.PLATFORMS.length);
    const second = await seedReferenceData();
    for (const k of ["categories", "componentTypes", "patternTypes", "frameworks", "platforms"] as const) {
      expect(second[k]).toEqual({ inserted: 0, updated: 0, unchanged: first[k].inserted });
    }
    const [ct] = await db().select().from(s.componentTypes).where(eq(s.componentTypes.slug, "combobox"));
    expect(ct!.aliases).toContain("typeahead");
    const [cat] = await db().select().from(s.categories).where(eq(s.categories.id, ct!.categoryId));
    expect(cat).toMatchObject({ kind: "component-group", slug: "inputs" });
  });
});

describe("registry import", () => {
  it("imports entries with links, sources and per-check evidence", async () => {
    await seedReferenceData();
    const r = await importRegistry({ entries: [{ file: "sample.json", data: sample() }], resolveAdapter });
    expect(r.invalid).toEqual([]);
    expect(r.created.sort()).toEqual(["atlas-test-alpha", "atlas-test-beta", "atlas-test-gamma"]);
    expect(r.warnings.some((w) => w.includes("not-a-framework"))).toBe(true);

    const alpha = await system("atlas-test-alpha");
    expect(alpha).toMatchObject({ publishState: "published", ingestionStatus: "metadata_only", adapterId: null, registryStatus: "verified", registryRank: 1, latestVersion: "1.0.0", category: "design-system" });
    expect(alpha.lastVerifiedAt!.toISOString()).toBe("2026-11-01T00:00:05.000Z");
    expect(alpha.registryEvidence!.checks.length).toBe(5);
    const beta = await system("atlas-test-beta");
    expect(beta).toMatchObject({ publishState: "draft", ingestionStatus: "not_started", registryStatus: "candidate" });
    const gamma = await system("atlas-test-gamma");
    expect(gamma).toMatchObject({ publishState: "published", ingestionStatus: "not_started", adapterId: "fake" });

    // shared reference rows are filled, never overwritten (beta's different MIT wording is ignored)
    const lic = await db().select().from(s.licenses);
    expect(lic.length).toBe(1);
    expect(lic[0]).toMatchObject({ slug: "mit", name: "MIT License", url: "https://opensource.org/license/mit", notes: "different wording on purpose" });
    expect(alpha.licenseId).toBe(lic[0]!.id);
    expect((await db().select().from(s.organizations)).length).toBe(2);

    const fw = await db().select().from(s.designSystemFrameworks).where(eq(s.designSystemFrameworks.designSystemId, alpha.id));
    expect(fw.length).toBe(1);
    expect(fw[0]).toMatchObject({ verificationState: "verified", packageName: "@atlas-test/alpha", sourceUrl: "https://example.com/npm/alpha" });
    expect((await db().select().from(s.designSystemPlatforms).where(eq(s.designSystemPlatforms.designSystemId, gamma.id))).length).toBe(2);
    const tagRows = await db().select().from(s.tags);
    expect(tagRows.map((t) => t.slug).sort()).toEqual(["design-tokens", "government", "open-source"]);

    const src = await db().select().from(s.sources).where(eq(s.sources.designSystemId, alpha.id));
    expect(src.map((x) => x.kind).sort()).toEqual(["docs", "homepage", "package", "repository", "storybook"]);
    expect(src.every((x) => x.discoveredBy === "registry")).toBe(true);
    const sb = src.find((x) => x.kind === "storybook")!;
    expect(sb.lastStatus).toBe(404);
    expect(sb.lastError).toBe("synthetic failure");

    const ev = await db().select().from(s.verificationEvidence).where(eq(s.verificationEvidence.subjectId, alpha.id));
    expect(ev.length).toBe(5);
    expect(ev.find((e) => e.field === "storybookUrl")).toMatchObject({ state: "unavailable", extractionMethod: "registry-research:http-check", subjectType: "design_system" });
    expect(ev.find((e) => e.field === "docsUrl")).toMatchObject({ state: "verified", extractionMethod: "registry-research:page-content", excerpt: "synthetic" });
    expect(alpha.coverage).toMatchObject({ evidence: 5, sourcesChecked: 5, sourcesOk: 4, components: 0 });

    const ce = await db().select().from(s.changeEvents);
    expect(ce.length).toBe(3);
    expect(ce.every((e) => e.changeKind === "created")).toBe(true);
  });

  it("re-importing identical files changes nothing", async () => {
    await seedReferenceData();
    await importRegistry({ entries: [{ file: "sample.json", data: sample() }], resolveAdapter });
    const before = await tableCounts();
    const evBefore = await db().select({ id: s.verificationEvidence.id }).from(s.verificationEvidence).orderBy(s.verificationEvidence.id);
    const sysBefore = await db().select().from(s.designSystems).orderBy(s.designSystems.slug);
    const r = await importRegistry({ entries: [{ file: "sample.json", data: sample() }], resolveAdapter });
    expect(r.unchanged.length).toBe(3);
    expect(r.created.length + r.updated.length).toBe(0);
    expect(await tableCounts()).toEqual(before);
    expect(await db().select({ id: s.verificationEvidence.id }).from(s.verificationEvidence).orderBy(s.verificationEvidence.id)).toEqual(evBefore);
    const sysAfter = await db().select().from(s.designSystems).orderBy(s.designSystems.slug);
    expect(sysAfter.map((x) => x.updatedAt.getTime())).toEqual(sysBefore.map((x) => x.updatedAt.getTime()));
  });

  it("changed fields write updated / status-changed change events", async () => {
    await seedReferenceData();
    await importRegistry({ entries: [{ file: "sample.json", data: sample() }], resolveAdapter });
    const data = sample();
    data[0]!.summary = "TEST-ONLY fixture system used by ATLAS engine tests, with an edited summary for change tracking.";
    data[0]!.platforms = ["web", "android"];
    data[1]!.registryStatus = "verified";
    data[1]!.docsUrl = "https://beta.example.com/docs";
    const r = await importRegistry({ entries: [{ file: "sample.json", data }], resolveAdapter });
    expect(r.updated.sort()).toEqual(["atlas-test-alpha", "atlas-test-beta"]);
    const events = await db().select().from(s.changeEvents).where(sql`${s.changeEvents.changeKind} <> 'created'`);
    const alphaEv = events.find((e) => e.entityLabel === "ATLAS Test Alpha")!;
    expect(alphaEv.changeKind).toBe("updated");
    expect(alphaEv.fieldChanges!.map((f) => f.field)).toEqual(expect.arrayContaining(["summary", "platforms"]));
    const betaEv = events.find((e) => e.entityLabel === "ATLAS Test Beta")!;
    expect(betaEv.changeKind).toBe("status-changed");
    expect(betaEv.fieldChanges!.find((f) => f.field === "publishState")).toMatchObject({ before: "draft", after: "published" });
    expect(await system("atlas-test-beta")).toMatchObject({ publishState: "published", ingestionStatus: "metadata_only" });
    const betaSources = await db().select().from(s.sources).where(eq(s.sources.designSystemId, (await system("atlas-test-beta")).id));
    expect(betaSources.map((x) => x.kind).sort()).toEqual(["docs", "homepage"]);
  });

  it("reports and skips invalid entries and duplicate slugs", async () => {
    await seedReferenceData();
    const bad = { ...sample()[0]!, slug: "Not A Slug", checks: [] };
    const dup = sample()[2]!;
    const r = await importRegistry({ entries: [{ file: "a.json", data: [...sample(), bad] }, { file: "b.json", data: [dup] }, { file: "c.json", data: { not: "an array" } }], resolveAdapter });
    expect(r.imported).toBe(3);
    expect(r.invalid.length).toBe(2);
    expect(r.invalid[0]!.problems.join(" ")).toMatch(/slug|checks/);
    expect(r.invalid[1]!.problems).toEqual(["file is not a JSON array"]);
    expect(r.skipped).toEqual([{ file: "b.json", index: 0, slug: "atlas-test-gamma", problems: ["duplicate slug; first defined in a.json"] }]);
    expect((await db().select().from(s.designSystems)).length).toBe(3);
  });

  it("keeps ingestion-discovered version facts over registry values once ingested", async () => {
    await seedReferenceData();
    await importRegistry({ entries: [{ file: "sample.json", data: sample() }], resolveAdapter });
    await db().update(s.designSystems).set({ latestVersion: "2.0.0", lastIngestedAt: new Date(), ingestionStatus: "indexed" }).where(eq(s.designSystems.slug, "atlas-test-gamma"));
    await db().update(s.designSystems).set({ latestVersion: "9.9.9", lastIngestedAt: new Date() }).where(eq(s.designSystems.slug, "atlas-test-alpha"));
    const r = await importRegistry({ entries: [{ file: "sample.json", data: sample() }], resolveAdapter });
    expect(r.unchanged).toContain("atlas-test-gamma");
    expect((await system("atlas-test-alpha")).latestVersion).toBe("9.9.9");
    expect((await system("atlas-test-gamma")).ingestionStatus).toBe("indexed");
  });
});
