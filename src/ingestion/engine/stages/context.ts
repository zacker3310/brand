import { eq } from "drizzle-orm";
import { getDb, type DB } from "@/db/client";
import { designSystems } from "@/db/schema";
import { engineConfig, getFetcher } from "../config";
import type { Job } from "../queue";
import { checkpointOf, getRun, type Run, type RunCheckpoint } from "../runs";
import type { AdapterContext, AdapterLogger, SourceAdapter } from "../../types";

export type System = typeof designSystems.$inferSelect;

export interface StageContext {
  db: DB;
  job: Job;
  run: Run;
  system: System;
  adapter: SourceAdapter;
  checkpoint: RunCheckpoint;
  actx: AdapterContext;
  signal: AbortSignal;
  log: AdapterLogger;
}

/** Errors that retrying cannot fix (missing run/system/adapter, adapter contract bugs). */
export class NonRetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NonRetryableError";
  }
}

/** The job was cancelled or the worker is shutting down. */
export class AbortedError extends Error {
  constructor(message = "aborted") {
    super(message);
    this.name = "AbortedError";
  }
}

export function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) throw new AbortedError(typeof signal.reason === "string" ? signal.reason : "aborted");
}

export async function loadStageContext(job: Job, signal: AbortSignal, db: DB = getDb()): Promise<StageContext | null> {
  const runId = job.runId ?? (job.payload.runId as string | undefined);
  if (!runId) throw new NonRetryableError(`job ${job.id} (${job.kind}) has no runId`);
  const run = await getRun(runId, db);
  if (!run) throw new NonRetryableError(`run ${runId} not found`);
  if (run.status === "cancelled") return null;
  if (!run.designSystemId) throw new NonRetryableError(`run ${runId} has no design system`);
  const [system] = await db.select().from(designSystems).where(eq(designSystems.id, run.designSystemId));
  if (!system) throw new NonRetryableError(`design system for run ${runId} not found`);
  const cfg = engineConfig();
  const adapter = cfg.resolveAdapter(system.slug);
  if (!adapter) throw new NonRetryableError(`no adapter handles system "${system.slug}"`);
  const checkpoint = checkpointOf(run);
  const base = cfg.log;
  const prefix = `[${system.slug}:${run.id.slice(0, 8)}:${job.kind}]`;
  const log: AdapterLogger = {
    info: (m, e) => base.info(`${prefix} ${m}`, e),
    warn: (m, e) => base.warn(`${prefix} ${m}`, e),
    error: (m, e) => base.error(`${prefix} ${m}`, e),
  };
  const actx: AdapterContext = {
    systemSlug: system.slug,
    http: getFetcher(),
    log,
    runStartedAt: (run.startedAt ?? run.createdAt).toISOString(),
    limit: checkpoint.limit ?? undefined,
    signal,
  };
  return { db, job, run, system, adapter, checkpoint, actx, signal, log };
}

/** Run `fn` over items with bounded concurrency. Stops starting new items after the first error. */
export async function pool<T>(items: T[], concurrency: number, fn: (item: T, index: number) => Promise<void>, signal?: AbortSignal): Promise<void> {
  let next = 0;
  let firstError: unknown = null;
  const worker = async () => {
    while (firstError === null && next < items.length && !signal?.aborted) {
      const i = next++;
      try {
        await fn(items[i]!, i);
      } catch (e) {
        if (firstError === null) firstError = e;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, worker));
  if (firstError !== null) throw firstError;
  if (signal) throwIfAborted(signal);
}

/** Interleave items by host so a concurrency pool does not queue behind one slow host. */
export function interleaveByHost<T>(items: T[], urlOf: (t: T) => string): T[] {
  const groups = new Map<string, T[]>();
  for (const it of items) {
    let host = "";
    try {
      host = new URL(urlOf(it)).host;
    } catch {
      host = "";
    }
    const g = groups.get(host) ?? [];
    g.push(it);
    groups.set(host, g);
  }
  const lists = [...groups.values()];
  const out: T[] = [];
  for (let i = 0; out.length < items.length; i++) for (const l of lists) if (i < l.length) out.push(l[i]!);
  return out;
}
