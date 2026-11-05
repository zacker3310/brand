/**
 * Ingestion engine facade. The web layer and CLI only call these functions; stage work happens
 * in workers (scripts/worker.ts) or inline CLI runs, never in request handlers.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb, type DB } from "@/db/client";
import { designSystems, ingestionJobs, ingestionRuns } from "@/db/schema";
import { engineConfig } from "./config";
import { enqueueStage, JOB_KINDS, STAGES } from "./pipeline";
import { cancel, enqueue, expedite, type Job } from "./queue";
import { getRun, liveJobs, recordError, type RunCheckpoint } from "./runs";

export interface RunOptions {
  kind?: "full" | "incremental";
  triggeredBy?: string;
  limit?: number;
  dryRun?: boolean;
  priority?: number;
}

export interface EnqueuedRun {
  runId: string;
  jobId: string;
  /** True when an active run for the system already existed and was returned instead. */
  deduped: boolean;
}

/**
 * Create an ingestion run for a system and enqueue its `run-system` job. Idempotent while the
 * system has an active run with live jobs: that run is returned instead of starting another.
 */
export async function enqueueSystemRun(systemSlug: string, opts: RunOptions = {}, db: DB = getDb()): Promise<EnqueuedRun> {
  const [system] = await db.select({ id: designSystems.id, slug: designSystems.slug }).from(designSystems).where(eq(designSystems.slug, systemSlug));
  if (!system) throw new Error(`unknown design system "${systemSlug}"`);
  const adapter = engineConfig().resolveAdapter(systemSlug);
  if (!adapter) throw new Error(`no adapter handles design system "${systemSlug}"`);
  if (opts.dryRun) throw new Error("dryRun is not supported by the engine; use scripts/adapter-dry-run.ts");
  const kind = opts.kind ?? "incremental";
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`atlas:enqueue:${system.id}`}))`);
    const active = await tx
      .select()
      .from(ingestionRuns)
      .where(and(eq(ingestionRuns.designSystemId, system.id), inArray(ingestionRuns.status, ["pending", "running"])))
      .orderBy(desc(ingestionRuns.createdAt));
    for (const r of active) {
      const live = await tx.select().from(ingestionJobs).where(and(eq(ingestionJobs.runId, r.id), inArray(ingestionJobs.status, ["queued", "running"]))).limit(1);
      if (live[0]) return { runId: r.id, jobId: live[0].id, deduped: true };
    }
    const checkpoint: RunCheckpoint = { systemSlug, kind, limit: opts.limit ?? null };
    const [run] = await tx
      .insert(ingestionRuns)
      .values({
        designSystemId: system.id,
        adapterId: adapter.id,
        adapterVersion: adapter.version,
        kind,
        status: "pending",
        stage: "queued",
        triggeredBy: opts.triggeredBy ?? "cli",
        checkpoint: checkpoint as unknown as Record<string, unknown>,
        stats: {},
      })
      .returning({ id: ingestionRuns.id });
    // Interrupted runs with nothing left queued are superseded (still resumable by id).
    for (const r of active) {
      await tx.update(ingestionRuns).set({ status: "cancelled", finishedAt: sql`now()` }).where(eq(ingestionRuns.id, r.id));
      await recordError({ runId: r.id, designSystemId: system.id, stage: r.stage ?? "run", code: "SUPERSEDED", severity: "warning", message: `interrupted run superseded by ${run!.id}` }, tx as unknown as DB);
    }
    const job = await enqueue(
      { kind: "run-system", runId: run!.id, designSystemId: system.id, payload: { runId: run!.id, systemSlug }, dedupeKey: `${run!.id}:run-system`, priority: opts.priority ?? 100, maxAttempts: engineConfig().stageMaxAttempts },
      tx as unknown as DB,
    );
    await tx.update(designSystems).set({ ingestionStatus: "queued" }).where(eq(designSystems.id, system.id));
    return { runId: run!.id, jobId: job.id, deduped: false };
  });
}

/**
 * Resume an interrupted or failed run from its current stage. Completed stage work is not
 * repeated: fetch/parse skip checkpointed documents, publish is idempotent.
 */
export async function resumeRun(runId: string, db: DB = getDb()): Promise<{ runId: string; jobId: string | null; status: string; resumedStage: string | null }> {
  const run = await getRun(runId, db);
  if (!run) throw new Error(`run ${runId} not found`);
  if (run.status === "succeeded" || run.status === "partial") return { runId, jobId: null, status: run.status, resumedStage: null };
  const live = await liveJobs(runId, db);
  if (live.length) {
    for (const j of live) if (j.status === "queued") await expedite(j.id, db);
    if (run.status !== "running" && run.status !== "pending") await db.update(ingestionRuns).set({ status: "running", finishedAt: null }).where(eq(ingestionRuns.id, runId));
    return { runId, jobId: live[0]!.id, status: "running", resumedStage: live[0]!.kind };
  }
  const stage = (STAGES as string[]).includes(run.stage ?? "") ? (run.stage as (typeof STAGES)[number]) : null;
  await db.update(ingestionRuns).set({ status: "running", finishedAt: null }).where(eq(ingestionRuns.id, runId));
  if (run.designSystemId) await db.update(designSystems).set({ ingestionStatus: "queued" }).where(eq(designSystems.id, run.designSystemId));
  const job: Job = stage
    ? await enqueueStage(runId, run.designSystemId, stage, 50, db)
    : await enqueue({ kind: "run-system", runId, designSystemId: run.designSystemId, payload: { runId }, dedupeKey: `${runId}:run-system`, priority: 50, maxAttempts: engineConfig().stageMaxAttempts }, db);
  return { runId, jobId: job.id, status: "running", resumedStage: job.kind };
}

/** Cancel a run and its live jobs. Published records are untouched. */
export async function cancelRun(runId: string, db: DB = getDb()): Promise<{ cancelledJobs: number }> {
  const live = await liveJobs(runId, db);
  let n = 0;
  for (const j of live) if (await cancel(j.id, db)) n++;
  await db.update(ingestionRuns).set({ status: "cancelled", finishedAt: sql`now()` }).where(and(eq(ingestionRuns.id, runId), inArray(ingestionRuns.status, ["pending", "running"])));
  const run = await getRun(runId, db);
  if (run?.designSystemId) {
    await db.execute(sql`update design_system set ingestion_status = case when last_ingested_at is null then 'not_started'::ingestion_status else 'partial'::ingestion_status end
      where id = ${run.designSystemId} and ingestion_status in ('queued','running')`);
  }
  return { cancelledJobs: n };
}

export interface QueueStatus {
  jobs: { kind: string; status: string; n: number }[];
  due: number;
  oldestQueuedAt: string | null;
}

export async function queueStatus(db: DB = getDb()): Promise<QueueStatus> {
  const jobs = await db
    .select({ kind: ingestionJobs.kind, status: ingestionJobs.status, n: sql<number>`count(*)::int` })
    .from(ingestionJobs)
    .groupBy(ingestionJobs.kind, ingestionJobs.status)
    .orderBy(ingestionJobs.kind, ingestionJobs.status);
  const [due] = await db
    .select({ n: sql<number>`count(*)::int`, oldest: sql<Date | null>`min(${ingestionJobs.createdAt})` })
    .from(ingestionJobs)
    .where(and(eq(ingestionJobs.status, "queued"), sql`${ingestionJobs.runAt} <= now()`));
  return { jobs, due: due?.n ?? 0, oldestQueuedAt: due?.oldest ? new Date(due.oldest).toISOString() : null };
}

export async function recentRuns(limit = 20, db: DB = getDb()) {
  return db
    .select({
      id: ingestionRuns.id,
      system: designSystems.slug,
      adapterId: ingestionRuns.adapterId,
      kind: ingestionRuns.kind,
      status: ingestionRuns.status,
      stage: ingestionRuns.stage,
      stats: ingestionRuns.stats,
      startedAt: ingestionRuns.startedAt,
      finishedAt: ingestionRuns.finishedAt,
      createdAt: ingestionRuns.createdAt,
    })
    .from(ingestionRuns)
    .leftJoin(designSystems, eq(designSystems.id, ingestionRuns.designSystemId))
    .orderBy(desc(ingestionRuns.createdAt))
    .limit(limit);
}

export { configureEngine, engineConfig, resetEngineConfig, getFetcher, type EngineConfig, type EngineHooks } from "./config";
export { claim, complete, fail, cancel, retry, heartbeat, reapStale, release, enqueue, expedite, getJob, backoffMs, type Job, type EnqueueInput } from "./queue";
export { dispatch, JOB_KINDS, STAGES, nextStage } from "./pipeline";
export { Worker, executeJob, processRunInline, defaultWorkerId, DEFAULT_LOCK_TIMEOUT_MS, type WorkerOptions, type InlineOptions } from "./worker";
export { getRun, type Run, type RunCheckpoint } from "./runs";
export { validateBundle, suspiciousName, type BundleValidation, type ValidatedEntity } from "./validate";
export { computeSystemCoverage } from "./coverage";
