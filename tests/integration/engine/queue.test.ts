import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prepareTestDb, truncateAll } from "./helpers";

await prepareTestDb();
const { closeDb, getDb } = await import("@/db/client");
const { ingestionJobs } = await import("@/db/schema");
const q = await import("@/ingestion/engine/queue");

const db = () => getDb();
const job = async (id: string) => (await db().select().from(ingestionJobs).where(eq(ingestionJobs.id, id)))[0]!;

beforeAll(async () => {
  await truncateAll();
});
beforeEach(async () => {
  await db().delete(ingestionJobs);
});
afterAll(async () => {
  await closeDb();
});

describe("queue: enqueue", () => {
  it("is idempotent for live jobs sharing a dedupe key", async () => {
    const a = await q.enqueue({ kind: "discover", dedupeKey: "run-1:discover" });
    const b = await q.enqueue({ kind: "discover", dedupeKey: "run-1:discover" });
    expect(a.deduped).toBe(false);
    expect(b.deduped).toBe(true);
    expect(b.id).toBe(a.id);
    expect((await db().select().from(ingestionJobs)).length).toBe(1);
  });

  it("concurrent enqueues with the same key create exactly one job", async () => {
    const results = await Promise.all(Array.from({ length: 12 }, () => q.enqueue({ kind: "fetch", dedupeKey: "run-2:fetch" })));
    expect(new Set(results.map((r) => r.id)).size).toBe(1);
    expect(results.filter((r) => !r.deduped).length).toBe(1);
  });

  it("allows a new job once the previous one with that key is finished", async () => {
    const a = await q.enqueue({ kind: "parse", dedupeKey: "run-3:parse" });
    const [claimed] = await q.claim("w1", { limit: 1 });
    expect(claimed!.id).toBe(a.id);
    expect(await q.complete(a.id, { ok: true })).toBe(true);
    const b = await q.enqueue({ kind: "parse", dedupeKey: "run-3:parse" });
    expect(b.deduped).toBe(false);
    expect(b.id).not.toBe(a.id);
  });

  it("jobs without a dedupe key never dedupe", async () => {
    await q.enqueue({ kind: "x" });
    await q.enqueue({ kind: "x" });
    expect((await db().select().from(ingestionJobs)).length).toBe(2);
  });
});

describe("queue: retry", () => {
  it("returns a dead job of an inline run to the shared queue (an Ops retry hands it to workers)", async () => {
    const j = await q.enqueue({ kind: "fetch", queue: q.INLINE_QUEUE, dedupeKey: "run-r:fetch" });
    await db().update(ingestionJobs).set({ status: "dead" }).where(eq(ingestionJobs.id, j.id));
    const r = await q.retry(j.id);
    expect(r).toMatchObject({ id: j.id, status: "queued", queue: q.DEFAULT_QUEUE });
    const [claimed] = await q.claim("worker", { limit: 1 });
    expect(claimed?.id).toBe(j.id);
  });

  // moveRunJobs moving running jobs is covered end to end in pipeline.test.ts
  // ("a crashed inline run (job left running) resumed without --inline is finished by a worker").
});

describe("queue: claim", () => {
  it("claims by priority then run_at, sets lock fields and increments attempts", async () => {
    const low = await q.enqueue({ kind: "a", priority: 200 });
    const high = await q.enqueue({ kind: "a", priority: 10 });
    await q.enqueue({ kind: "a", priority: 1, runAt: new Date(Date.now() + 60_000) }); // not due
    const [first] = await q.claim("w1", { limit: 1 });
    expect(first!.id).toBe(high.id);
    expect(first!.status).toBe("running");
    expect(first!.lockedBy).toBe("w1");
    expect(first!.lockedAt).toBeInstanceOf(Date);
    expect(first!.attempts).toBe(1);
    const [second] = await q.claim("w1", { limit: 1 });
    expect(second!.id).toBe(low.id);
    expect(await q.claim("w1", { limit: 5 })).toEqual([]);
  });

  it("filters by kind and run", async () => {
    await q.enqueue({ kind: "fetch" });
    const p = await q.enqueue({ kind: "parse" });
    const got = await q.claim("w", { kinds: ["parse"], limit: 10 });
    expect(got.map((j) => j.id)).toEqual([p.id]);
  });

  it("two concurrent claimers never receive the same job", async () => {
    const n = 60;
    await db().insert(ingestionJobs).values(Array.from({ length: n }, (_, i) => ({ kind: "work", payload: { i } })));
    const claimedBy = new Map<string, string>();
    const claimer = async (worker: string) => {
      for (;;) {
        const jobs = await q.claim(worker, { limit: 3 });
        if (!jobs.length) return;
        for (const j of jobs) {
          expect(claimedBy.has(j.id)).toBe(false);
          claimedBy.set(j.id, worker);
        }
      }
    };
    await Promise.all([claimer("w-a"), claimer("w-b"), claimer("w-c"), claimer("w-d")]);
    expect(claimedBy.size).toBe(n);
    const rows = await db().select().from(ingestionJobs);
    expect(rows.every((r) => r.status === "running" && r.attempts === 1)).toBe(true);
    for (const r of rows) expect(r.lockedBy).toBe(claimedBy.get(r.id));
    // both workers actually participated (sanity: SKIP LOCKED let them run in parallel)
    expect(new Set(claimedBy.values()).size).toBeGreaterThan(1);
  });
});

describe("queue: failure handling", () => {
  it("retryable failure requeues with exponential backoff", async () => {
    const j = await q.enqueue({ kind: "a", maxAttempts: 3 });
    await q.claim("w", { limit: 1 });
    const before = Date.now();
    const f = await q.fail(j.id, new Error("boom"), { retryable: true });
    expect(f!.status).toBe("queued");
    expect(f!.lastError).toContain("boom");
    expect(f!.lockedBy).toBeNull();
    const delay = f!.runAt.getTime() - before;
    expect(delay).toBeGreaterThan(q.backoffMs(1) - 2000); // 2^1 * 15s = 30s
    expect(delay).toBeLessThan(q.backoffMs(1) + 2000);
    // not claimable until due
    expect(await q.claim("w", { limit: 1 })).toEqual([]);
  });

  it("goes dead after max_attempts", async () => {
    const j = await q.enqueue({ kind: "a", maxAttempts: 2 });
    for (let attempt = 1; attempt <= 2; attempt++) {
      await db().update(ingestionJobs).set({ runAt: sql`now() - interval '1 second'` }).where(eq(ingestionJobs.id, j.id));
      const [c] = await q.claim("w", { limit: 1 });
      expect(c!.attempts).toBe(attempt);
      const f = await q.fail(j.id, `failure ${attempt}`, { retryable: true });
      expect(f!.status).toBe(attempt < 2 ? "queued" : "dead");
    }
    const dead = await job(j.id);
    expect(dead.status).toBe("dead");
    expect(dead.finishedAt).toBeInstanceOf(Date);
    expect(await q.claim("w", { limit: 1 })).toEqual([]);
  });

  it("backoff is capped at 30 minutes", () => {
    expect(q.backoffMs(1)).toBe(30_000);
    expect(q.backoffMs(3)).toBe(120_000);
    expect(q.backoffMs(20)).toBe(30 * 60_000);
  });

  it("non-retryable failure becomes failed; Ops retry requeues with attempts reset", async () => {
    const j = await q.enqueue({ kind: "a", dedupeKey: "k-retry" });
    await q.claim("w", { limit: 1 });
    expect((await q.fail(j.id, "bad input", { retryable: false }))!.status).toBe("failed");
    const r = await q.retry(j.id);
    expect(r!.status).toBe("queued");
    expect(r!.attempts).toBe(0);
    const [c] = await q.claim("w", { limit: 1 });
    expect(c!.id).toBe(j.id);
  });

  it("retry does not create a second live job for the same dedupe key", async () => {
    const a = await q.enqueue({ kind: "a", dedupeKey: "k-dup" });
    await q.claim("w", { limit: 1 });
    await q.fail(a.id, "x", { retryable: false });
    const b = await q.enqueue({ kind: "a", dedupeKey: "k-dup" });
    expect(b.deduped).toBe(false);
    const r = await q.retry(a.id);
    expect(r!.id).toBe(b.id); // the existing live job is returned
    expect((await job(a.id)).status).toBe("failed");
  });

  it("complete/fail are ignored when another worker holds the lock", async () => {
    const j = await q.enqueue({ kind: "a" });
    await q.claim("w-owner", { limit: 1 });
    expect(await q.complete(j.id, {}, { workerId: "w-other" })).toBe(false);
    expect(await q.fail(j.id, "x", { workerId: "w-other" })).toBeNull();
    expect((await job(j.id)).status).toBe("running");
    expect(await q.complete(j.id, { done: 1 }, { workerId: "w-owner" })).toBe(true);
    expect((await job(j.id)).status).toBe("succeeded");
  });

  it("cancel stops queued and running jobs; heartbeat reports it", async () => {
    const a = await q.enqueue({ kind: "a" });
    await q.claim("w", { limit: 1 });
    expect(await q.heartbeat(a.id, "w")).toBe(true);
    expect(await q.cancel(a.id)).toBe(true);
    expect(await q.heartbeat(a.id, "w")).toBe(false);
    expect(await q.complete(a.id, {})).toBe(false);
    expect((await job(a.id)).status).toBe("cancelled");
  });
});

describe("queue: locks", () => {
  it("heartbeat refreshes locked_at; reapStale requeues expired locks only", async () => {
    const stale = await q.enqueue({ kind: "a" });
    const fresh = await q.enqueue({ kind: "a" });
    await q.claim("w", { limit: 2 });
    await db().update(ingestionJobs).set({ lockedAt: sql`now() - interval '10 minutes'` });
    expect(await q.heartbeat(fresh.id, "w")).toBe(true);
    const reaped = await q.reapStale(5 * 60_000);
    expect(reaped.map((r) => r.id)).toEqual([stale.id]);
    expect(reaped[0]!.status).toBe("queued");
    expect((await job(stale.id)).lockedBy).toBeNull();
    expect((await job(fresh.id)).status).toBe("running");
    const [again] = await q.claim("w2", { limit: 1 });
    expect(again!.id).toBe(stale.id);
    expect(again!.attempts).toBe(2);
  });

  it("reaping a job that used all attempts marks it dead", async () => {
    const j = await q.enqueue({ kind: "a", maxAttempts: 1 });
    await q.claim("w", { limit: 1 });
    await db().update(ingestionJobs).set({ lockedAt: sql`now() - interval '1 hour'` });
    const [r] = await q.reapStale(60_000);
    expect(r!.id).toBe(j.id);
    expect(r!.status).toBe("dead");
  });

  it("release returns a running job without counting the attempt", async () => {
    const j = await q.enqueue({ kind: "a" });
    await q.claim("w", { limit: 1 });
    expect(await q.release(j.id, "w")).toBe(true);
    const r = await job(j.id);
    expect(r.status).toBe("queued");
    expect(r.attempts).toBe(0);
  });
});
