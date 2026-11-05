/**
 * Durable PostgreSQL job queue on `ingestion_job` (ADR 0004).
 *
 *  - enqueue: idempotent for live jobs sharing a dedupe key (partial unique index job_live_dedupe_uq).
 *  - claim:   single UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED LIMIT n) RETURNING *.
 *  - fail:    exponential backoff (min(2^attempts * 15s, 30min)) until max_attempts, then 'dead'.
 *  - heartbeat / reapStale: stale running jobs (crashed workers) return to the queue.
 */
import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import { getDb, type DB } from "@/db/client";
import { ingestionJobs } from "@/db/schema";

export type Job = typeof ingestionJobs.$inferSelect;
export type JobStatus = Job["status"];

export const DEFAULT_QUEUE = "ingest";
export const BACKOFF_BASE_MS = 15_000;
export const BACKOFF_MAX_MS = 30 * 60_000;

export interface EnqueueInput {
  kind: string;
  payload?: Record<string, unknown>;
  runId?: string | null;
  designSystemId?: string | null;
  dedupeKey?: string | null;
  priority?: number;
  runAt?: Date;
  maxAttempts?: number;
  queue?: string;
}

/** Backoff delay after the given number of attempts (attempts already incremented by claim). */
export function backoffMs(attempts: number): number {
  return Math.min(2 ** Math.max(0, attempts) * BACKOFF_BASE_MS, BACKOFF_MAX_MS);
}

const LIVE_PREDICATE = sql.raw(`status in ('queued','running') and dedupe_key is not null`);

/** Insert a job; when a live job with the same dedupe key exists, return that job instead. */
export async function enqueue(input: EnqueueInput, db: DB = getDb()): Promise<Job & { deduped: boolean }> {
  const values = {
    queue: input.queue ?? DEFAULT_QUEUE,
    kind: input.kind,
    payload: input.payload ?? {},
    runId: input.runId ?? null,
    designSystemId: input.designSystemId ?? null,
    dedupeKey: input.dedupeKey ?? null,
    priority: input.priority ?? 100,
    runAt: input.runAt ?? new Date(),
    maxAttempts: input.maxAttempts ?? 5,
  };
  for (let attempt = 0; attempt < 5; attempt++) {
    const inserted = await db
      .insert(ingestionJobs)
      .values(values)
      .onConflictDoNothing({ target: ingestionJobs.dedupeKey, where: LIVE_PREDICATE })
      .returning();
    if (inserted[0]) return { ...inserted[0], deduped: false };
    // Conflict: a live job holds this key. Return it (it may finish between statements -> retry insert).
    const [existing] = await db
      .select()
      .from(ingestionJobs)
      .where(and(eq(ingestionJobs.dedupeKey, values.dedupeKey!), inArray(ingestionJobs.status, ["queued", "running"])))
      .limit(1);
    if (existing) return { ...existing, deduped: true };
  }
  throw new Error(`enqueue: could not insert or find live job for dedupe key ${values.dedupeKey}`);
}

export interface ClaimOptions {
  kinds?: string[];
  limit?: number;
  queue?: string;
  /** Only claim jobs belonging to this run (inline processing). */
  runId?: string;
}

/** Atomically claim up to `limit` due jobs. Concurrent claimers never receive the same job. */
export async function claim(workerId: string, opts: ClaimOptions = {}, db: DB = getDb()): Promise<Job[]> {
  const limit = Math.max(1, opts.limit ?? 1);
  const conds = [
    eq(ingestionJobs.queue, opts.queue ?? DEFAULT_QUEUE),
    eq(ingestionJobs.status, "queued"),
    lte(ingestionJobs.runAt, sql`now()`),
  ];
  if (opts.kinds?.length) conds.push(inArray(ingestionJobs.kind, opts.kinds));
  if (opts.runId) conds.push(eq(ingestionJobs.runId, opts.runId));
  const due = db
    .select({ id: ingestionJobs.id })
    .from(ingestionJobs)
    .where(and(...conds))
    .orderBy(asc(ingestionJobs.priority), asc(ingestionJobs.runAt))
    .limit(limit)
    .for("update", { skipLocked: true });
  const rows = await db
    .update(ingestionJobs)
    .set({
      status: "running",
      lockedAt: sql`now()`,
      lockedBy: workerId,
      attempts: sql`${ingestionJobs.attempts} + 1`,
      updatedAt: sql`now()`,
    })
    .where(inArray(ingestionJobs.id, due))
    .returning();
  return rows.sort((a, b) => a.priority - b.priority || a.runAt.getTime() - b.runAt.getTime());
}

/** Mark a running job succeeded. Returns false if the job was no longer running (cancelled/reaped). */
export async function complete(jobId: string, result: Record<string, unknown> = {}, db: DB = getDb()): Promise<boolean> {
  const rows = await db
    .update(ingestionJobs)
    .set({ status: "succeeded", result, finishedAt: sql`now()`, lockedAt: null, lockedBy: null, lastError: null, updatedAt: sql`now()` })
    .where(and(eq(ingestionJobs.id, jobId), eq(ingestionJobs.status, "running")))
    .returning({ id: ingestionJobs.id });
  return rows.length > 0;
}

export interface FailOptions {
  retryable?: boolean;
}

/**
 * Record a failure. Retryable failures go back to 'queued' with exponential backoff until
 * max_attempts is reached, then 'dead'. Non-retryable failures become 'failed' immediately.
 */
export async function fail(jobId: string, error: unknown, opts: FailOptions = {}, db: DB = getDb()): Promise<Job | null> {
  const message = errorMessage(error).slice(0, 4000);
  const retryable = opts.retryable ?? true;
  const rows = await db
    .update(ingestionJobs)
    .set({
      status: retryable
        ? sql`case when ${ingestionJobs.attempts} >= ${ingestionJobs.maxAttempts} then 'dead'::job_status else 'queued'::job_status end`
        : "failed",
      runAt: retryable
        ? sql`now() + make_interval(secs => least(power(2, ${ingestionJobs.attempts}) * ${BACKOFF_BASE_MS / 1000}, ${BACKOFF_MAX_MS / 1000}))`
        : sql`${ingestionJobs.runAt}`,
      finishedAt: retryable ? sql`case when ${ingestionJobs.attempts} >= ${ingestionJobs.maxAttempts} then now() else null end` : sql`now()`,
      lastError: message,
      lockedAt: null,
      lockedBy: null,
      updatedAt: sql`now()`,
    })
    .where(and(eq(ingestionJobs.id, jobId), eq(ingestionJobs.status, "running")))
    .returning();
  return rows[0] ?? null;
}

/** Cancel a queued or running job. A running handler notices via heartbeat() returning false. */
export async function cancel(jobId: string, db: DB = getDb()): Promise<boolean> {
  const rows = await db
    .update(ingestionJobs)
    .set({ status: "cancelled", finishedAt: sql`now()`, lockedAt: null, lockedBy: null, updatedAt: sql`now()` })
    .where(and(eq(ingestionJobs.id, jobId), inArray(ingestionJobs.status, ["queued", "running"])))
    .returning({ id: ingestionJobs.id });
  return rows.length > 0;
}

/**
 * Ops retry: failed/dead/cancelled -> queued with attempts reset. If another live job already
 * holds the same dedupe key, the retry is skipped and that live job is returned.
 */
export async function retry(jobId: string, db: DB = getDb()): Promise<Job | null> {
  try {
    const rows = await db
      .update(ingestionJobs)
      .set({ status: "queued", attempts: 0, runAt: sql`now()`, finishedAt: null, lockedAt: null, lockedBy: null, updatedAt: sql`now()` })
      .where(and(eq(ingestionJobs.id, jobId), inArray(ingestionJobs.status, ["failed", "dead", "cancelled"])))
      .returning();
    return rows[0] ?? null;
  } catch (e) {
    if ((e as { code?: string; cause?: { code?: string } }).code === "23505" || (e as { cause?: { code?: string } }).cause?.code === "23505") {
      const [job] = await db.select().from(ingestionJobs).where(eq(ingestionJobs.id, jobId));
      if (!job?.dedupeKey) return null;
      const [live] = await db
        .select()
        .from(ingestionJobs)
        .where(and(eq(ingestionJobs.dedupeKey, job.dedupeKey), inArray(ingestionJobs.status, ["queued", "running"])));
      return live ?? null;
    }
    throw e;
  }
}

/** Make a queued job due now (e.g. resume a run waiting in backoff). */
export async function expedite(jobId: string, db: DB = getDb()): Promise<boolean> {
  const rows = await db
    .update(ingestionJobs)
    .set({ runAt: sql`now()`, updatedAt: sql`now()` })
    .where(and(eq(ingestionJobs.id, jobId), eq(ingestionJobs.status, "queued")))
    .returning({ id: ingestionJobs.id });
  return rows.length > 0;
}

/** Refresh the lock. Returns false when the job is no longer running (cancelled, reaped, finished). */
export async function heartbeat(jobId: string, workerId?: string, db: DB = getDb()): Promise<boolean> {
  const conds = [eq(ingestionJobs.id, jobId), eq(ingestionJobs.status, "running")];
  if (workerId) conds.push(eq(ingestionJobs.lockedBy, workerId));
  const rows = await db
    .update(ingestionJobs)
    .set({ lockedAt: sql`now()`, updatedAt: sql`now()` })
    .where(and(...conds))
    .returning({ id: ingestionJobs.id });
  return rows.length > 0;
}

/**
 * Release a running job back to the queue without counting the attempt (graceful shutdown).
 */
export async function release(jobId: string, db: DB = getDb()): Promise<boolean> {
  const rows = await db
    .update(ingestionJobs)
    .set({
      status: "queued",
      attempts: sql`greatest(${ingestionJobs.attempts} - 1, 0)`,
      runAt: sql`now()`,
      lockedAt: null,
      lockedBy: null,
      lastError: "released by worker shutdown",
      updatedAt: sql`now()`,
    })
    .where(and(eq(ingestionJobs.id, jobId), eq(ingestionJobs.status, "running")))
    .returning({ id: ingestionJobs.id });
  return rows.length > 0;
}

/**
 * Return running jobs whose lock is older than lockTimeoutMs to the queue (their worker died).
 * Jobs that already used all attempts become 'dead' so a crash-looping job cannot spin forever.
 */
export async function reapStale(lockTimeoutMs: number, db: DB = getDb()): Promise<Job[]> {
  return db
    .update(ingestionJobs)
    .set({
      status: sql`case when ${ingestionJobs.attempts} >= ${ingestionJobs.maxAttempts} then 'dead'::job_status else 'queued'::job_status end`,
      finishedAt: sql`case when ${ingestionJobs.attempts} >= ${ingestionJobs.maxAttempts} then now() else null end`,
      lastError: sql`'lock expired (worker presumed dead; locked by ' || coalesce(${ingestionJobs.lockedBy}, '?') || ')'`,
      lockedAt: null,
      lockedBy: null,
      runAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(ingestionJobs.status, "running"),
        sql`${ingestionJobs.lockedAt} < now() - make_interval(secs => ${Math.max(0, lockTimeoutMs) / 1000})`,
      ),
    )
    .returning();
}

export async function getJob(jobId: string, db: DB = getDb()): Promise<Job | null> {
  const [job] = await db.select().from(ingestionJobs).where(eq(ingestionJobs.id, jobId));
  return job ?? null;
}

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.stack ? `${e.message}\n${e.stack.split("\n").slice(1, 6).join("\n")}` : e.message;
  return typeof e === "string" ? e : JSON.stringify(e);
}
