/**
 * ingestion_run bookkeeping: stage/status transitions, stats, and the resumability checkpoint.
 *
 * Checkpoint layout (ingestion_run.checkpoint):
 *   { systemSlug, kind, limit,
 *     discover: { docs: [{ id, doc }], gone, completedAt },
 *     fetch:    { done: { [documentId]: FetchOutcome } },
 *     parse:    { done: { [documentId]: ParseOutcome } } }
 * Per-document progress is written with jsonb_set so concurrent document completions compose and
 * a killed worker resumes exactly where it stopped.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import type { RunStats } from "@/lib/contracts";
import { getDb, type DB } from "@/db/client";
import { designSystems, ingestionErrors, ingestionJobs, ingestionRuns } from "@/db/schema";
import type { DiscoveredDocument } from "../types";

export type Run = typeof ingestionRuns.$inferSelect;
export type RunKind = "full" | "incremental";

export interface CheckpointDoc {
  id: string;
  doc: DiscoveredDocument;
}

export type FetchOutcomeKind = "changed" | "unchanged" | "stale" | "error" | "blocked";

export interface FetchOutcome {
  outcome: FetchOutcomeKind;
  hash: string | null;
  status: number;
  finalUrl: string | null;
  contentType: string | null;
  fetchedAt: string | null;
  error?: string | null;
}

export type ParseOutcomeKind = "parsed" | "reused" | "error" | "skipped";

export interface ParseOutcome {
  outcome: ParseOutcomeKind;
  hash: string | null;
  fragments: number;
}

export interface RunCheckpoint {
  systemSlug: string;
  kind: RunKind;
  limit?: number | null;
  discover?: { docs: CheckpointDoc[]; gone: number; completedAt: string };
  fetch?: { done: Record<string, FetchOutcome> };
  parse?: { done: Record<string, ParseOutcome> };
  publish?: { ingestionStatus: "indexed" | "partial" | "failed"; completedAt: string };
}

export async function getRun(runId: string, db: DB = getDb()): Promise<Run | null> {
  const [r] = await db.select().from(ingestionRuns).where(eq(ingestionRuns.id, runId));
  return r ?? null;
}

export function checkpointOf(run: Run): RunCheckpoint {
  return (run.checkpoint ?? {}) as unknown as RunCheckpoint;
}

export async function setStage(runId: string, stage: string, db: DB = getDb()) {
  await db
    .update(ingestionRuns)
    .set({ stage, status: "running", startedAt: sql`coalesce(${ingestionRuns.startedAt}, now())`, finishedAt: null })
    .where(eq(ingestionRuns.id, runId));
}

/** Replace a top-level checkpoint key. */
export async function setCheckpointKey(runId: string, key: keyof RunCheckpoint, value: unknown, db: DB = getDb()) {
  await db
    .update(ingestionRuns)
    .set({ checkpoint: sql`jsonb_set(coalesce(${ingestionRuns.checkpoint}, '{}'::jsonb), ${`{${key}}`}::text[], ${JSON.stringify(value)}::jsonb, true)` })
    .where(eq(ingestionRuns.id, runId));
}

/** Record one document's completion for a stage (fetch|parse). Safe under concurrency. */
export async function checkpointDoc(runId: string, stage: "fetch" | "parse", docId: string, outcome: FetchOutcome | ParseOutcome, db: DB = getDb()) {
  await db
    .update(ingestionRuns)
    .set({
      checkpoint: sql`jsonb_set(
        jsonb_set(coalesce(${ingestionRuns.checkpoint}, '{}'::jsonb), ${`{${stage}}`}::text[],
          coalesce(${ingestionRuns.checkpoint} -> ${stage}, '{"done":{}}'::jsonb), true),
        ${`{${stage},done,${docId}}`}::text[], ${JSON.stringify(outcome)}::jsonb, true)`,
    })
    .where(eq(ingestionRuns.id, runId));
}

/** Merge numeric stats into ingestion_run.stats (keys overwrite). */
export async function mergeStats(runId: string, stats: RunStats, db: DB = getDb()) {
  const clean = Object.fromEntries(Object.entries(stats).filter(([, v]) => typeof v === "number" && Number.isFinite(v)));
  await db
    .update(ingestionRuns)
    .set({ stats: sql`coalesce(${ingestionRuns.stats}, '{}'::jsonb) || ${JSON.stringify(clean)}::jsonb` })
    .where(eq(ingestionRuns.id, runId));
}

export async function finishRun(runId: string, status: "succeeded" | "partial" | "failed" | "cancelled", db: DB = getDb()) {
  await db
    .update(ingestionRuns)
    .set({
      status,
      stage: status === "failed" || status === "cancelled" ? sql`${ingestionRuns.stage}` : "done",
      finishedAt: sql`now()`,
      stats: sql`coalesce(${ingestionRuns.stats}, '{}'::jsonb) || jsonb_build_object('durationMs', (extract(epoch from (now() - coalesce(${ingestionRuns.startedAt}, ${ingestionRuns.createdAt}))) * 1000)::bigint)`,
    })
    .where(eq(ingestionRuns.id, runId));
}

export interface ErrorInput {
  runId?: string | null;
  jobId?: string | null;
  designSystemId?: string | null;
  stage: string;
  code: string;
  message: string;
  url?: string | null;
  severity?: "error" | "warning";
  details?: Record<string, unknown>;
}

export async function recordError(e: ErrorInput, db: DB = getDb()) {
  await db.insert(ingestionErrors).values({
    runId: e.runId ?? null,
    jobId: e.jobId ?? null,
    designSystemId: e.designSystemId ?? null,
    stage: e.stage,
    code: e.code,
    message: e.message.slice(0, 2000),
    url: e.url ?? null,
    severity: e.severity ?? "error",
    details: e.details ?? null,
  });
}

/** Count errors recorded for a run, by stage. */
export async function errorCounts(runId: string, db: DB = getDb()): Promise<Record<string, number>> {
  const rows = await db
    .select({ stage: ingestionErrors.stage, n: sql<number>`count(*)::int` })
    .from(ingestionErrors)
    .where(and(eq(ingestionErrors.runId, runId), eq(ingestionErrors.severity, "error")))
    .groupBy(ingestionErrors.stage);
  return Object.fromEntries(rows.map((r) => [r.stage, r.n]));
}

/**
 * Mark a run failed after its stage job died (or failed non-retryably). Published records are left
 * untouched; the system's ingestion_status only becomes 'failed' when nothing is published for it.
 */
export async function markRunFailed(runId: string, stage: string, message: string, jobId?: string | null, db: DB = getDb()) {
  const run = await getRun(runId, db);
  if (!run || run.status === "succeeded" || run.status === "partial" || run.status === "cancelled" || run.status === "failed") return;
  await recordError({ runId, jobId, designSystemId: run.designSystemId, stage, code: "STAGE_FAILED", message }, db);
  await finishRun(runId, "failed", db);
  if (run.designSystemId) await restoreSystemStatus(run.designSystemId, db);
}

/**
 * After a run is cancelled or fails, replace the transient 'queued'/'running' ingestion status
 * with what the published data supports: the outcome of the last completed publish when records
 * are published, otherwise 'failed' (a run failed) or 'not_started'.
 */
export async function restoreSystemStatus(systemId: string, db: DB = getDb()) {
  const res = await db.execute(sql`
    select
      exists (select 1 from component c where c.design_system_id = ${systemId} and c.publish_state = 'published')
        or exists (select 1 from token_set s where s.design_system_id = ${systemId} and s.publish_state = 'published') as published,
      (select coalesce(r.checkpoint -> 'publish' ->> 'ingestionStatus', case r.status when 'succeeded' then 'indexed' else 'partial' end)
         from ingestion_run r where r.design_system_id = ${systemId} and r.status in ('succeeded', 'partial')
         order by r.finished_at desc nulls last limit 1) as last_status,
      exists (select 1 from ingestion_run r where r.design_system_id = ${systemId} and r.status = 'failed') as any_failed`);
  const row = res.rows[0] as { published: boolean; last_status: string | null; any_failed: boolean };
  const status = row.published ? (row.last_status === "indexed" || row.last_status === "partial" ? row.last_status : "partial") : row.any_failed ? "failed" : "not_started";
  await db.execute(sql`update design_system set ingestion_status = ${status}::ingestion_status where id = ${systemId} and ingestion_status in ('queued', 'running')`);
}

export async function setSystemIngestionStatus(systemId: string, status: (typeof designSystems.$inferSelect)["ingestionStatus"], db: DB = getDb()) {
  await db.update(designSystems).set({ ingestionStatus: status }).where(eq(designSystems.id, systemId));
}

/** Live (queued/running) jobs of a run. */
export async function liveJobs(runId: string, db: DB = getDb()) {
  return db
    .select()
    .from(ingestionJobs)
    .where(and(eq(ingestionJobs.runId, runId), inArray(ingestionJobs.status, ["queued", "running"])));
}
