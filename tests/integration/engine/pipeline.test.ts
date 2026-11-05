import { and, eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applySpec, baseSpec, createFakeAdapter, createFakeSite, FAKE_ORIGIN, fakeFetch, setFile, siteFiles, type FakeSite } from "../../fixtures/engine/fake-adapter";
import { prepareTestDb, silentLog, tempCacheDir, truncateAll } from "./helpers";

await prepareTestDb();
const { closeDb, getDb } = await import("@/db/client");
const s = await import("@/db/schema");
const engine = await import("@/ingestion/engine");
const { seedReferenceData } = await import("@/ingestion/registry/reference");

const SLUG = "fake-system";
const db = () => getDb();

let site: FakeSite;
let adapter: ReturnType<typeof createFakeAdapter>;
let cache: ReturnType<typeof tempCacheDir>;
let systemId: string;

function configure(extra: Partial<Parameters<typeof engine.configureEngine>[0]> = {}) {
  engine.configureEngine({
    resolveAdapter: (slug) => (slug === SLUG ? adapter : undefined),
    fetcherOptions: { fetchImpl: fakeFetch(site), cacheDir: cache.dir, hostDelayMs: 0, hostConcurrency: 4, log: () => {} },
    fetchConcurrency: 4,
    parseConcurrency: 2,
    stageMaxAttempts: 3,
    hooks: {},
    log: silentLog,
    reindex: async () => ({ documents: 0 }),
    ...extra,
  });
}

async function runOnce(opts: Parameters<typeof engine.enqueueSystemRun>[1] = {}) {
  const e = await engine.enqueueSystemRun(SLUG, opts);
  return engine.processRunInline(e.runId, { heartbeatMs: 60_000 });
}

const COUNTED = [
  "component",
  "component_variant",
  "component_state",
  "component_property",
  "component_example",
  "component_accessibility",
  "component_framework",
  "component_relationship",
  "token_set",
  "token",
  "token_alias",
  "token_usage",
  "design_pattern",
  "pattern_component",
  "verification_evidence",
  "change_event",
  "source",
  "source_document",
  "source_snapshot",
  "parsed_fragment",
] as const;

async function counts(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of COUNTED) {
    const r = await db().execute(sql.raw(`select count(*)::int as n from ${t}`));
    out[t] = (r.rows[0] as { n: number }).n;
  }
  return out;
}

const ids = async (table: string) => (await db().execute(sql.raw(`select id::text from ${table} order by id`))).rows.map((r) => (r as { id: string }).id);

const component = async (slug: string) => (await db().select().from(s.components).where(and(eq(s.components.designSystemId, systemId), eq(s.components.slug, slug))))[0];
const changeEventsFor = async (entityType: string) => db().select().from(s.changeEvents).where(eq(s.changeEvents.entityType, entityType));

beforeAll(async () => {
  await truncateAll();
});

beforeEach(async () => {
  await truncateAll();
  await seedReferenceData();
  const [row] = await db()
    .insert(s.designSystems)
    .values({ slug: SLUG, name: "Fake System", category: "design-system", homepageUrl: "https://fake.example.com/", publishState: "published", registryStatus: "verified" })
    .returning({ id: s.designSystems.id });
  systemId = row!.id;
  site = createFakeSite(siteFiles(baseSpec()));
  adapter = createFakeAdapter({ systems: [SLUG] });
  cache = tempCacheDir();
  configure();
});

afterEach(() => {
  cache.cleanup();
  engine.resetEngineConfig();
});

afterAll(async () => {
  await closeDb();
});

describe("pipeline: first run", () => {
  it("publishes components, tokens, patterns and facts with provenance", async () => {
    const run = await runOnce();
    expect(run.status).toBe("succeeded");
    expect(run.stage).toBe("done");
    const st = run.stats!;
    expect(st).toMatchObject({ discovered: 8, fetched: 8, fetchErrors: 0, parsed: 8, parseErrors: 0, quarantined: 0, created: 7, removed: 0, components: 4, tokenSets: 2, tokens: 7, patterns: 1 });

    const comps = await db().select().from(s.components).where(eq(s.components.designSystemId, systemId));
    expect(comps.map((c) => c.slug).sort()).toEqual(["button", "fancy-widget", "icon-button", "text-field"]);
    const types = new Map((await db().select().from(s.componentTypes)).map((t) => [t.id, t.slug]));
    const button = comps.find((c) => c.slug === "button")!;
    expect(types.get(button.componentTypeId!)).toBe("button");
    expect(button.classificationState).toBe("inferred");
    expect(button.classificationMethod).toMatch(/^heuristic:alias-exact/);
    const fancy = comps.find((c) => c.slug === "fancy-widget")!;
    expect(types.get(fancy.componentTypeId!)).toBe("combobox");
    expect(fancy.classificationState).toBe("verified");
    expect(fancy.classificationMethod).toBe("adapter:fake:declared");
    expect(button.lastSeenRunId).toBe(run.id);

    const variants = await db().select().from(s.componentVariants).where(eq(s.componentVariants.componentId, button.id));
    expect(variants.map((v) => v.name).sort()).toEqual(["primary", "secondary"]);
    const states = await db().select().from(s.componentStates).where(eq(s.componentStates.componentId, button.id));
    expect(states.map((x) => [x.name, x.canonicalState])).toEqual(expect.arrayContaining([["hover", "hover"], ["disabled", "disabled"]]));
    const [example] = await db().select().from(s.componentExamples).where(eq(s.componentExamples.componentId, button.id));
    expect(example!.code).toBeNull(); // license unknown -> code not redistributed
    const [ext] = await db().select().from(s.extractions).where(and(eq(s.extractions.runId, run.id), eq(s.extractions.entityKey, "button")));
    expect(ext!.validation).toBe("warning");
    expect(ext!.issues!.map((i) => i.code)).toContain("LICENSE_CODE_STRIPPED");
    expect(ext!.published).toBe(true);

    const rels = await db().select().from(s.componentRelationships);
    expect(rels.length).toBe(2); // button <-> icon-button, resolved by slug
    const fws = await db().select().from(s.componentFrameworks);
    expect(fws.length).toBe(3);

    const toks = await db().select().from(s.tokens).where(eq(s.tokens.designSystemId, systemId));
    const link = toks.find((t) => t.name === "color.text.link")!;
    expect(link.isAlias).toBe(true);
    expect(link.aliasState).toBe("resolved");
    expect(link.resolvedValue).toBe("#0050d8");
    expect(link.valueText).toBe("#0050d8");
    const blue = toks.find((t) => t.name === "color.blue.500")!;
    expect(blue.isAlias).toBe(false);
    expect(blue.aliasState).toBeNull();
    expect(blue.resolvedValue).toBe("#0050d8");
    const aliases = await db().select().from(s.tokenAliases);
    expect(aliases.length).toBe(3);
    expect(aliases.every((a) => a.state === "resolved" && a.targetTokenId)).toBe(true);
    const usages = await db().select().from(s.tokenUsages);
    expect(usages.length).toBe(1);

    const pc = await db().select().from(s.patternComponents);
    expect(pc.length).toBe(2);

    const ev = await db().select().from(s.verificationEvidence);
    expect(ev.length).toBe(4 + 2 + 1 + 1);
    expect(ev.every((e) => e.snapshotId !== null)).toBe(true);
    expect(ev.every((e) => e.extractionMethod === "adapter:fake:json")).toBe(true);

    const [ds] = await db().select().from(s.designSystems).where(eq(s.designSystems.id, systemId));
    expect(ds!.ingestionStatus).toBe("indexed");
    expect(ds!.latestVersion).toBe("1.2.3");
    expect(ds!.lastIngestedAt).toBeInstanceOf(Date);
    expect(ds!.coverage).toMatchObject({ components: 4, componentsClassified: 4, componentsWithVariants: 2, componentsWithProps: 2, componentsWithA11y: 1, tokens: 7, tokenSets: 2, patterns: 1, evidence: 8 });

    const events = await db().select().from(s.changeEvents);
    expect(events.filter((e) => e.changeKind === "created").length).toBe(7);
    expect(events.filter((e) => e.entityType === "design_system" && e.changeKind === "updated").length).toBe(1);
    expect((await counts()).source_snapshot).toBe(8);
  });
});

describe("pipeline: idempotency", () => {
  it("re-running with unchanged sources creates no new canonical rows or evidence", async () => {
    const first = await runOnce();
    expect(first.status).toBe("succeeded");
    const before = await counts();
    const compIds = await ids("component");
    const tokIds = await ids("token");
    const evIds = await ids("verification_evidence");
    const parseCallsBefore = adapter.parseCalls.length;
    site.requests.length = 0;

    const second = await runOnce();
    expect(second.id).not.toBe(first.id);
    expect(second.status).toBe("succeeded");
    expect(await counts()).toEqual(before);
    expect(await ids("component")).toEqual(compIds);
    expect(await ids("token")).toEqual(tokIds);
    expect(await ids("verification_evidence")).toEqual(evIds);
    expect(second.stats).toMatchObject({ created: 0, updated: 0, removed: 0, unchanged: 8, fetched: 0, notModified: 8, parsed: 0, parseReused: 8, tokensAdded: 0, tokensUpdated: 0, tokensRemoved: 0 });
    expect(adapter.parseCalls.length).toBe(parseCallsBefore); // nothing re-parsed
    // discover re-reads the manifest (adapter's own request); every document is a conditional 304
    const docRequests = site.requests.filter((r) => r.path !== "/robots.txt" && r.path !== "/manifest.json");
    expect(docRequests.length).toBeGreaterThan(0);
    expect(docRequests.every((r) => r.conditional && r.status === 304)).toBe(true);
    const comps = await db().select().from(s.components).where(eq(s.components.designSystemId, systemId));
    expect(comps.every((c) => c.lastSeenRunId === second.id)).toBe(true);
  });

  it("a full (unconditional) re-run is also a no-op for canonical data", async () => {
    await runOnce();
    const before = await counts();
    const second = await runOnce({ kind: "full" });
    expect(second.status).toBe("succeeded");
    expect(await counts()).toEqual(before);
    expect(second.stats).toMatchObject({ created: 0, updated: 0, removed: 0, fetched: 0, notModified: 8 });
  });

  it("re-parses a document whose discovered role changed even when its bytes did not", async () => {
    await runOnce();
    const manifest = JSON.parse(site.files.get("/manifest.json")!) as { docs: { path: string; kind: string }[] };
    const moved = manifest.docs.find((d) => d.kind === "component")!;
    moved.kind = "unused-kind"; // same URL and bytes, different docKind (e.g. a page that became the nav index)
    setFile(site, "/manifest.json", manifest);
    const callsBefore = adapter.parseCalls.length;
    const run = await runOnce();
    expect(run.status).toBe("succeeded");
    expect(adapter.parseCalls.slice(callsBefore)).toEqual([`${FAKE_ORIGIN}${moved.path}`]);
    expect(run.stats).toMatchObject({ parsed: 1, parseReused: 7, removed: 1 });
  });

  it("fails (never publishes) a run enqueued for a different adapter version than the executing process", async () => {
    const e = await engine.enqueueSystemRun(SLUG); // enqueued for fake@1.0.0
    adapter = createFakeAdapter({ systems: [SLUG], version: "2.0.0" }); // the process now runs other adapter code
    configure();
    const run = await engine.processRunInline(e.runId, { heartbeatMs: 60_000 });
    expect(run.status).toBe("failed");
    expect(adapter.parseCalls.length).toBe(0);
    const published = await db().select().from(s.components).where(eq(s.components.designSystemId, systemId));
    expect(published.length).toBe(0);
    const [err] = await db().select().from(s.ingestionErrors).where(eq(s.ingestionErrors.runId, e.runId));
    expect(err?.message ?? "").toMatch(/adapter mismatch/);
  });

  it("enqueueSystemRun is idempotent while a run is active", async () => {
    const a = await engine.enqueueSystemRun(SLUG);
    const b = await engine.enqueueSystemRun(SLUG);
    expect(b.deduped).toBe(true);
    expect(b.runId).toBe(a.runId);
    expect((await db().select().from(s.ingestionRuns)).length).toBe(1);
  });
});

describe("pipeline: changes and removals", () => {
  it("records field-level diffs, retires removed components and revives them", async () => {
    await runOnce();
    const spec = baseSpec();
    spec.components![0]!.variants = ["primary", "secondary", "danger"];
    spec.components![0]!.description = "Triggers an action or event.";
    spec.components = spec.components!.filter((c) => c.name !== "Text Field");
    applySpec(site, spec);
    const run = await runOnce();
    expect(run.status).toBe("succeeded");
    expect(run.stats).toMatchObject({ updated: 1, removed: 1, created: 0 });

    const updated = (await changeEventsFor("component")).filter((e) => e.changeKind === "updated" && e.runId === run.id);
    expect(updated.length).toBe(1);
    const fc = updated[0]!.fieldChanges!;
    expect(fc.find((c) => c.field === "variants")!.summary).toContain("+1 (variant:danger)");
    expect(fc.find((c) => c.field === "description")).toMatchObject({ before: "Triggers an action.", after: "Triggers an action or event." });
    expect((await db().select().from(s.componentVariants).where(eq(s.componentVariants.componentId, (await component("button"))!.id))).length).toBe(3);

    const tf = await component("text-field");
    expect(tf).toBeDefined(); // never hard-deleted
    expect(tf!.publishState).toBe("retired");
    const removed = (await changeEventsFor("component")).filter((e) => e.changeKind === "removed");
    expect(removed.map((e) => e.entityLabel)).toEqual(["Text Field"]);
    // pattern link to the retired component is dropped
    expect((await db().select().from(s.patternComponents)).length).toBe(1);

    applySpec(site, baseSpec());
    const revived = await runOnce();
    expect((await component("text-field"))!.publishState).toBe("published");
    const ev = (await changeEventsFor("component")).filter((e) => e.runId === revived.id && e.entityLabel === "Text Field");
    expect(ev[0]!.changeKind).toBe("updated");
    expect(ev[0]!.fieldChanges![0]).toMatchObject({ field: "publishState", before: "retired", after: "published" });
  });

  it("deletes tokens removed from a set and re-resolves aliases across sets", async () => {
    await runOnce();
    const spec = baseSpec();
    delete (spec.tokenSets![0]!.tokens.color as Record<string, unknown>).gray;
    applySpec(site, spec);
    const run = await runOnce();
    expect(run.stats).toMatchObject({ tokensRemoved: 1 });
    const toks = await db().select().from(s.tokens).where(eq(s.tokens.designSystemId, systemId));
    expect(toks.find((t) => t.name === "color.gray.900")).toBeUndefined();
    const text = toks.find((t) => t.name === "color.text.default")!;
    expect(text.aliasState).toBe("external"); // target no longer exists anywhere in the system
    expect(text.resolvedValue).toBeNull();
    const [alias] = await db().select().from(s.tokenAliases).where(eq(s.tokenAliases.tokenId, text.id));
    expect(alias!.state).toBe("external");
    expect(alias!.targetRef).toBe("{color.gray.900}");
    expect(alias!.targetTokenId).toBeNull();
    const setEvents = (await changeEventsFor("token_set")).filter((e) => e.runId === run.id);
    expect(setEvents.length).toBe(1);
    expect(setEvents[0]!.fieldChanges![0]).toMatchObject({ field: "tokens", before: 4, after: 3 });
    expect(setEvents[0]!.fieldChanges![0]!.summary).toContain("-1");
  });

  it("fetch failures make the run partial and never retire unseen records", async () => {
    await runOnce();
    site.failures.set("/components/icon-button.json", 404);
    const run = await runOnce();
    expect(run.status).toBe("partial");
    expect(run.stats).toMatchObject({ fetchErrors: 1, removed: 0 });
    const errs = await db().select().from(s.ingestionErrors).where(eq(s.ingestionErrors.runId, run.id));
    expect(errs.find((e) => e.stage === "fetch")).toMatchObject({ code: "HTTP_404", url: "https://fake.example.com/components/icon-button.json" });
    expect((await component("icon-button"))!.publishState).toBe("published");
    const [ds] = await db().select().from(s.designSystems).where(eq(s.designSystems.id, systemId));
    expect(ds!.ingestionStatus).toBe("partial");
    const [doc] = await db().select().from(s.sourceDocuments).where(eq(s.sourceDocuments.url, "https://fake.example.com/components/icon-button.json"));
    expect(doc!.status).toBe("error");
  });

  it("parse exceptions are recorded and the rest of the run publishes", async () => {
    adapter = createFakeAdapter({ systems: [SLUG], failParse: /text-field/ });
    configure();
    const run = await runOnce();
    expect(run.status).toBe("partial");
    expect(run.stats).toMatchObject({ parseErrors: 1, components: 3 });
    const errs = await db().select().from(s.ingestionErrors).where(and(eq(s.ingestionErrors.runId, run.id), eq(s.ingestionErrors.stage, "parse")));
    expect(errs[0]).toMatchObject({ code: "PARSE_FAILED" });
  });

  it("documents not rediscovered are marked gone, never deleted", async () => {
    await runOnce();
    const spec = baseSpec();
    spec.patterns = [];
    applySpec(site, spec);
    await runOnce();
    const docs = await db().select().from(s.sourceDocuments).where(eq(s.sourceDocuments.url, "https://fake.example.com/patterns/forms.json"));
    expect(docs[0]!.status).toBe("gone");
    const [p] = await db().select().from(s.designPatterns);
    expect(p!.publishState).toBe("retired");
  });
});

describe("pipeline: quarantine", () => {
  it("invalid extractions are not promoted and published records stay untouched", async () => {
    await runOnce();
    const before = await component("button");
    const spec = baseSpec();
    spec.components![0]!.docsUrl = "javascript:alert(1)";
    spec.components!.push({ name: "Getting Started", description: "Learn the basics." });
    applySpec(site, spec);
    const run = await runOnce();
    expect(run.status).toBe("partial");
    expect(run.stats).toMatchObject({ quarantined: 2 });
    const after = await component("button");
    expect(after!.docsUrl).toBe(before!.docsUrl);
    expect(after!.contentHash).toBe(before!.contentHash);
    expect(await component("getting-started")).toBeUndefined();
    const ext = await db().select().from(s.extractions).where(eq(s.extractions.runId, run.id));
    const b = ext.find((e) => e.entityKey === "button")!;
    expect(b.validation).toBe("invalid");
    expect(b.published).toBe(false);
    expect(b.issues!.some((i) => i.code === "INVALID_URL" || i.code === "CONTRACT")).toBe(true);
    expect(ext.find((e) => e.entityKey === "getting-started")!.issues!.map((i) => i.code)).toContain("SUSPICIOUS");
    expect((await changeEventsFor("component")).filter((e) => e.runId === run.id).length).toBe(0);
    // the quarantined button is still "seen": not retired
    expect(after!.publishState).toBe("published");
  });
});

describe("pipeline: resumability", () => {
  it("resumes an interrupted fetch without refetching checkpointed documents", async () => {
    let crashed = false;
    configure({
      fetchConcurrency: 1,
      hooks: {
        afterDocument: ({ stage, index }) => {
          if (stage === "fetch" && index === 2 && !crashed) {
            crashed = true;
            throw new Error("simulated worker crash during fetch");
          }
        },
      },
    });
    const e = await engine.enqueueSystemRun(SLUG);
    const interrupted = await engine.processRunInline(e.runId, { maxWaitMs: 300, heartbeatMs: 60_000 });
    expect(crashed).toBe(true);
    expect(interrupted.status).toBe("running");
    expect(interrupted.stage).toBe("fetch");
    const cp = interrupted.checkpoint as { fetch: { done: Record<string, unknown> } };
    expect(Object.keys(cp.fetch.done).length).toBe(3);
    const [fetchJob] = await db().select().from(s.ingestionJobs).where(and(eq(s.ingestionJobs.runId, e.runId), eq(s.ingestionJobs.kind, "fetch")));
    expect(fetchJob!.status).toBe("queued"); // in backoff
    expect(fetchJob!.runAt.getTime()).toBeGreaterThan(Date.now());

    const r = await engine.resumeRun(e.runId);
    expect(r.resumedStage).toBe("fetch");
    const done = await engine.processRunInline(e.runId, { heartbeatMs: 60_000 });
    expect(done.status).toBe("succeeded");
    const docFetches = site.requests.filter((x) => x.path !== "/robots.txt" && x.path !== "/manifest.json" && x.status === 200);
    const perPath = new Map<string, number>();
    for (const x of docFetches) perPath.set(x.path, (perPath.get(x.path) ?? 0) + 1);
    expect([...perPath.values()].every((n) => n === 1)).toBe(true); // each document fetched exactly once
    expect(perPath.size).toBe(8);
    const c = await counts();
    expect(c.source_snapshot).toBe(8);
    expect(c.component).toBe(4);
    expect(c.token).toBe(7);
    expect(done.stats).toMatchObject({ fetched: 8, created: 7 });
  });

  it("resumes an interrupted parse without re-parsing completed documents", async () => {
    let crashed = false;
    configure({
      parseConcurrency: 1,
      hooks: {
        afterDocument: ({ stage, index }) => {
          if (stage === "parse" && index === 1 && !crashed) {
            crashed = true;
            throw new Error("simulated crash during parse");
          }
        },
      },
    });
    const e = await engine.enqueueSystemRun(SLUG);
    await engine.processRunInline(e.runId, { maxWaitMs: 300, heartbeatMs: 60_000 });
    expect(crashed).toBe(true);
    await engine.resumeRun(e.runId);
    const done = await engine.processRunInline(e.runId, { heartbeatMs: 60_000 });
    expect(done.status).toBe("succeeded");
    expect(new Set(adapter.parseCalls).size).toBe(adapter.parseCalls.length); // no document parsed twice
    expect(adapter.parseCalls.length).toBe(8);
    expect((await counts()).parsed_fragment).toBe(8);
  });

  it("a job left running by a killed worker is reaped and the run completes", async () => {
    const e = await engine.enqueueSystemRun(SLUG);
    const [claimed] = await engine.claim("dead-worker", { runId: e.runId, limit: 1 });
    expect(claimed!.kind).toBe("run-system");
    await db().update(s.ingestionJobs).set({ lockedAt: sql`now() - interval '20 minutes'` }).where(eq(s.ingestionJobs.id, claimed!.id));
    const done = await engine.processRunInline(e.runId, { lockTimeoutMs: 60_000, heartbeatMs: 60_000 });
    expect(done.status).toBe("succeeded");
    const [j] = await db().select().from(s.ingestionJobs).where(eq(s.ingestionJobs.id, claimed!.id));
    expect(j!.status).toBe("succeeded");
    expect(j!.attempts).toBe(2);
  });

  it("a stage that keeps failing goes dead and fails the run", async () => {
    site.failures.set("/manifest.json", 404);
    configure({ stageMaxAttempts: 1 });
    const run = await runOnce();
    expect(run.status).toBe("failed");
    const errs = await db().select().from(s.ingestionErrors).where(eq(s.ingestionErrors.runId, run.id));
    expect(errs.map((x) => x.code).sort()).toEqual(["DISCOVER_FAILED", "STAGE_FAILED"]);
    const [ds] = await db().select().from(s.designSystems).where(eq(s.designSystems.id, systemId));
    expect(ds!.ingestionStatus).toBe("failed");
    const jobs = await db().select().from(s.ingestionJobs).where(eq(s.ingestionJobs.runId, run.id));
    expect(jobs.find((j) => j.kind === "discover")!.status).toBe("dead");
  });

  it("cancelRun cancels live jobs; a cancelled run is never processed further", async () => {
    const e = await engine.enqueueSystemRun(SLUG);
    const r = await engine.cancelRun(e.runId);
    expect(r.cancelledJobs).toBe(1);
    const run = await engine.processRunInline(e.runId, { heartbeatMs: 60_000 });
    expect(run.status).toBe("cancelled");
    expect((await db().select().from(s.components)).length).toBe(0);
    const [ds] = await db().select().from(s.designSystems).where(eq(s.designSystems.id, systemId));
    expect(ds!.ingestionStatus).toBe("not_started");
    // a new run can be started afterwards
    const next = await engine.enqueueSystemRun(SLUG);
    expect(next.deduped).toBe(false);
    expect((await engine.processRunInline(next.runId, { heartbeatMs: 60_000 })).status).toBe("succeeded");
  });

  it("cancelling a queued run restores the published system's ingestion status", async () => {
    await runOnce();
    const status = async () => (await db().select().from(s.designSystems).where(eq(s.designSystems.id, systemId)))[0]!.ingestionStatus;
    expect(await status()).toBe("indexed");
    const e = await engine.enqueueSystemRun(SLUG);
    expect(await status()).toBe("queued");
    await engine.cancelRun(e.runId);
    expect(await status()).toBe("indexed");
  });

  it("resumeRun on a finished run is a no-op", async () => {
    const run = await runOnce();
    expect(await engine.resumeRun(run.id)).toMatchObject({ jobId: null, status: "succeeded" });
  });

  it("limited runs never retire or mark documents gone", async () => {
    await runOnce();
    const run = await runOnce({ limit: 2 });
    expect(run.status).toBe("succeeded");
    expect(run.stats).toMatchObject({ discovered: 2, removed: 0, gone: 0 });
    const comps = await db().select().from(s.components).where(eq(s.components.publishState, "published"));
    expect(comps.length).toBe(4);
  });
});

describe("worker", () => {
  it("processes queued runs and shuts down gracefully", async () => {
    const e = await engine.enqueueSystemRun(SLUG);
    const w = new engine.Worker({ concurrency: 2, pollMs: 50, heartbeatMs: 60_000, shutdownTimeoutMs: 2_000 });
    const started = w.start();
    for (let i = 0; i < 200; i++) {
      const r = await engine.getRun(e.runId);
      if (r && ["succeeded", "partial", "failed"].includes(r.status)) break;
      await new Promise((res) => setTimeout(res, 50));
    }
    const { released } = await w.stop();
    await started;
    expect(released).toEqual([]);
    expect((await engine.getRun(e.runId))!.status).toBe("succeeded");
    expect(w.processed).toBe(5); // run-system, discover, fetch, parse, publish
  });

  it("never claims the stages of an inline run (private queue); a non-inline resume hands them back", async () => {
    const e = await engine.enqueueSystemRun(SLUG, { queue: engine.INLINE_QUEUE });
    const w = new engine.Worker({ concurrency: 2, pollMs: 20, heartbeatMs: 60_000, shutdownTimeoutMs: 2_000 });
    const started = w.start();
    await new Promise((res) => setTimeout(res, 300));
    expect(w.processed).toBe(0);
    // inline processing claims by run id and keeps every follow-up stage on the private queue
    const done = await engine.processRunInline(e.runId, { heartbeatMs: 60_000 });
    expect(done.status).toBe("succeeded");
    expect(w.processed).toBe(0);
    const queues = await db().selectDistinct({ q: s.ingestionJobs.queue }).from(s.ingestionJobs).where(eq(s.ingestionJobs.runId, e.runId));
    expect(queues.map((r) => r.q)).toEqual([engine.INLINE_QUEUE]);

    // an inline run whose process died: resuming without --inline moves its jobs to the shared queue
    const orphan = await engine.enqueueSystemRun(SLUG, { queue: engine.INLINE_QUEUE });
    await new Promise((res) => setTimeout(res, 150));
    expect(w.processed).toBe(0);
    await engine.resumeRun(orphan.runId);
    for (let i = 0; i < 200; i++) {
      const r = await engine.getRun(orphan.runId);
      if (r && ["succeeded", "partial", "failed"].includes(r.status)) break;
      await new Promise((res) => setTimeout(res, 50));
    }
    await w.stop();
    await started;
    expect((await engine.getRun(orphan.runId))!.status).toBe("succeeded");
    expect(w.processed).toBe(5);
  });

  it("releases a job that does not finish within the shutdown timeout", async () => {
    let unblock!: () => void;
    const gate = new Promise<void>((r) => (unblock = r));
    configure({
      hooks: {
        afterDocument: async ({ stage, index }) => {
          if (stage === "fetch" && index === 0) await gate;
        },
      },
    });
    const e = await engine.enqueueSystemRun(SLUG);
    const w = new engine.Worker({ concurrency: 1, pollMs: 20, heartbeatMs: 60_000, shutdownTimeoutMs: 300 });
    const started = w.start();
    for (let i = 0; i < 200 && !(w.running[0]?.kind === "fetch"); i++) await new Promise((res) => setTimeout(res, 20));
    expect(w.running[0]?.kind).toBe("fetch");
    await new Promise((res) => setTimeout(res, 100));
    const stop = w.stop();
    const { released } = await stop;
    expect(released.length).toBe(1);
    unblock();
    await started;
    const [j] = await db().select().from(s.ingestionJobs).where(and(eq(s.ingestionJobs.runId, e.runId), eq(s.ingestionJobs.kind, "fetch")));
    expect(j!.status).toBe("queued");
    expect(j!.attempts).toBe(0);
    // another worker picks it up and resumes from the checkpoint
    const done = await engine.processRunInline(e.runId, { heartbeatMs: 60_000 });
    expect(done.status).toBe("succeeded");
  });
});
