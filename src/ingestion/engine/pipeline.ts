/**
 * Pipeline: job kind -> stage handler. Each stage updates ingestion_run (stage/status/stats/
 * checkpoint) and enqueues the next stage with dedupe key `${runId}:${stage}`, so a stage is
 * never queued twice for the same run.
 *
 *   run-system -> discover -> fetch -> parse -> publish
 */
import { eq } from "drizzle-orm";
import { getDb, type DB } from "@/db/client";
import { designSystems } from "@/db/schema";
import { engineConfig, type StageName } from "./config";
import { enqueue, type Job } from "./queue";
import { getRun, setStage } from "./runs";
import { loadStageContext, NonRetryableError } from "./stages/context";
import { discoverStage } from "./stages/discover";
import { fetchStage } from "./stages/fetch";
import { parseStage } from "./stages/parse";
import { publishStage } from "./stages/publish";

export const STAGES: StageName[] = ["discover", "fetch", "parse", "publish"];
export const JOB_KINDS = ["run-system", ...STAGES] as const;
export type JobKind = (typeof JOB_KINDS)[number];

export function nextStage(stage: StageName | "run-system"): StageName | null {
  if (stage === "run-system") return "discover";
  const i = STAGES.indexOf(stage);
  return i >= 0 && i < STAGES.length - 1 ? STAGES[i + 1]! : null;
}

export async function enqueueStage(runId: string, designSystemId: string | null, stage: StageName, priority = 100, db: DB = getDb()) {
  return enqueue(
    {
      kind: stage,
      runId,
      designSystemId,
      payload: { runId },
      dedupeKey: `${runId}:${stage}`,
      priority,
      maxAttempts: engineConfig().stageMaxAttempts,
    },
    db,
  );
}

export interface DispatchOptions {
  signal?: AbortSignal;
  db?: DB;
}

/** Execute one claimed job. Throws on failure (the worker decides retry vs dead). */
export async function dispatch(job: Job, opts: DispatchOptions = {}): Promise<Record<string, unknown>> {
  const db = opts.db ?? getDb();
  const signal = opts.signal ?? new AbortController().signal;
  const kind = job.kind as JobKind;
  if (!(JOB_KINDS as readonly string[]).includes(kind)) throw new NonRetryableError(`unknown job kind "${job.kind}"`);

  if (kind === "run-system") {
    const runId = job.runId ?? (job.payload.runId as string);
    const run = runId ? await getRun(runId, db) : null;
    if (!run) throw new NonRetryableError(`run ${runId} not found`);
    if (run.status === "cancelled") return { skipped: "run cancelled" };
    await setStage(run.id, "discover", db);
    if (run.designSystemId) await db.update(designSystems).set({ ingestionStatus: "running" }).where(eq(designSystems.id, run.designSystemId));
    const next = await enqueueStage(run.id, run.designSystemId, "discover", job.priority, db);
    await engineConfig().hooks.afterStage?.({ stage: "run-system", runId: run.id });
    return { next: next.id };
  }

  const sc = await loadStageContext(job, signal, db);
  if (!sc) return { skipped: "run cancelled" };
  if (sc.run.status === "succeeded" || sc.run.status === "partial" || sc.run.status === "failed") {
    return { skipped: `run already ${sc.run.status}` };
  }
  await setStage(sc.run.id, kind, db);
  let result: Record<string, unknown>;
  switch (kind) {
    case "discover":
      result = await discoverStage(sc);
      break;
    case "fetch":
      result = await fetchStage(sc);
      break;
    case "parse":
      result = await parseStage(sc);
      break;
    case "publish": {
      const s = await publishStage(sc);
      result = { runStatus: s.runStatus, ingestionStatus: s.ingestionStatus, ...s.stats };
      break;
    }
  }
  const next = nextStage(kind);
  if (next) {
    await setStage(sc.run.id, next, db);
    const j = await enqueueStage(sc.run.id, sc.run.designSystemId, next, job.priority, db);
    result.next = j.id;
  }
  await engineConfig().hooks.afterStage?.({ stage: kind, runId: sc.run.id });
  return result;
}
