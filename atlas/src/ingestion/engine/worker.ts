/**
 * Job execution: claim -> dispatch with heartbeats -> complete / fail (backoff, dead letter) /
 * release on shutdown. Used by the long-running worker (scripts/worker.ts) and by inline CLI runs.
 * Ingestion never runs inside Next.js request handlers; the web layer only enqueues.
 */
import { hostname } from "node:os";
import type { DB } from "@/db/client";
import { getDb } from "@/db/client";
import { engineConfig } from "./config";
import { dispatch } from "./pipeline";
import { claim, complete, errorMessage, fail, heartbeat, reapStale, release, type Job } from "./queue";
import { getRun, liveJobs, markRunFailed, type Run } from "./runs";
import { AbortedError, NonRetryableError } from "./stages/context";

export const DEFAULT_LOCK_TIMEOUT_MS = 5 * 60_000;

export const defaultWorkerId = (suffix?: string) => `${hostname()}:${process.pid}${suffix ? `:${suffix}` : ""}`;

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      resolve();
    }, { once: true });
  });

export interface ExecuteOptions {
  workerId: string;
  heartbeatMs?: number;
  /** Aborted by the worker on shutdown timeout; the job is released back to the queue. */
  shutdownSignal?: AbortSignal;
  db?: DB;
}

export type ExecuteOutcome = "succeeded" | "retry" | "failed" | "dead" | "released" | "cancelled" | "lost";

/** Run one claimed job to completion. Never throws. */
export async function executeJob(job: Job, opts: ExecuteOptions): Promise<{ outcome: ExecuteOutcome; error?: string; result?: Record<string, unknown> }> {
  const db = opts.db ?? getDb();
  const log = engineConfig().log;
  const ac = new AbortController();
  let lostLock = false;
  const onShutdown = () => ac.abort("shutdown");
  opts.shutdownSignal?.addEventListener("abort", onShutdown, { once: true });
  if (opts.shutdownSignal?.aborted) ac.abort("shutdown");
  const hb = setInterval(() => {
    heartbeat(job.id, opts.workerId, db)
      .then((alive) => {
        if (!alive && !ac.signal.aborted) {
          lostLock = true;
          ac.abort("job no longer running (cancelled or reaped)");
        }
      })
      .catch((e) => log.warn(`heartbeat failed for job ${job.id}: ${(e as Error).message}`));
  }, opts.heartbeatMs ?? 30_000);
  try {
    const result = await dispatch(job, { signal: ac.signal, db });
    const ok = await complete(job.id, result, { workerId: opts.workerId }, db);
    return { outcome: ok ? "succeeded" : "lost", result };
  } catch (e) {
    if (ac.signal.aborted || e instanceof AbortedError) {
      if (ac.signal.reason === "shutdown") {
        await release(job.id, opts.workerId, db).catch(() => {});
        return { outcome: "released", error: "shutdown" };
      }
      return { outcome: lostLock ? "cancelled" : "released", error: String(ac.signal.reason ?? "aborted") };
    }
    const retryable = !(e instanceof NonRetryableError);
    const msg = errorMessage(e);
    log.error(`job ${job.kind} ${job.id} failed (attempt ${job.attempts}/${job.maxAttempts}${retryable ? "" : ", not retryable"}): ${(e as Error).message ?? e}`);
    const updated = await fail(job.id, e, { retryable, workerId: opts.workerId }, db).catch(() => null);
    if (!updated) return { outcome: "lost", error: msg };
    if ((updated.status === "dead" || updated.status === "failed") && job.runId) {
      await markRunFailed(job.runId, job.kind, `${job.kind} job ${updated.status} after ${updated.attempts} attempt(s): ${(e as Error).message ?? e}`, job.id, db).catch((err) =>
        log.error(`could not mark run failed: ${(err as Error).message}`),
      );
    }
    return { outcome: updated.status === "queued" ? "retry" : (updated.status as ExecuteOutcome), error: msg };
  } finally {
    clearInterval(hb);
    opts.shutdownSignal?.removeEventListener("abort", onShutdown);
  }
}

export interface WorkerOptions {
  workerId?: string;
  concurrency?: number;
  kinds?: string[];
  lockTimeoutMs?: number;
  heartbeatMs?: number;
  pollMs?: number;
  reapEveryMs?: number;
  shutdownTimeoutMs?: number;
  db?: DB;
  onJob?: (job: Job, outcome: Awaited<ReturnType<typeof executeJob>>) => void;
}

/** Long-running queue worker with graceful shutdown. */
export class Worker {
  readonly workerId: string;
  private opts: Required<Omit<WorkerOptions, "kinds" | "db" | "onJob" | "workerId">> & Pick<WorkerOptions, "kinds" | "db" | "onJob">;
  private stopping = false;
  private stopAc = new AbortController();
  private shutdownAc = new AbortController();
  private inFlight = new Map<string, Job>();
  private loops: Promise<void>[] = [];
  private lastReap = 0;
  processed = 0;

  constructor(opts: WorkerOptions = {}) {
    this.workerId = opts.workerId ?? defaultWorkerId();
    this.opts = {
      concurrency: Math.max(1, opts.concurrency ?? 1),
      lockTimeoutMs: opts.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS,
      heartbeatMs: opts.heartbeatMs ?? 30_000,
      pollMs: opts.pollMs ?? 1_000,
      reapEveryMs: opts.reapEveryMs ?? 30_000,
      shutdownTimeoutMs: opts.shutdownTimeoutMs ?? 30_000,
      kinds: opts.kinds,
      db: opts.db,
      onJob: opts.onJob,
    };
  }

  get running(): Job[] {
    return [...this.inFlight.values()];
  }

  start(): Promise<void> {
    for (let i = 0; i < this.opts.concurrency; i++) this.loops.push(this.loop(i));
    return Promise.all(this.loops).then(() => {});
  }

  private async maybeReap(db: DB) {
    if (Date.now() - this.lastReap < this.opts.reapEveryMs) return;
    this.lastReap = Date.now();
    const reaped = await reapStale(this.opts.lockTimeoutMs, db);
    for (const j of reaped) engineConfig().log.warn(`reaped stale job ${j.kind} ${j.id} -> ${j.status}`);
    for (const j of reaped) if (j.status === "dead" && j.runId) await markRunFailed(j.runId, j.kind, `${j.kind} job dead after lock expiry`, j.id, db);
  }

  private async loop(slot: number) {
    const db = this.opts.db ?? getDb();
    const log = engineConfig().log;
    while (!this.stopping) {
      try {
        await this.maybeReap(db);
        const [job] = await claim(`${this.workerId}`, { limit: 1, kinds: this.opts.kinds }, db);
        if (!job) {
          await sleep(this.opts.pollMs, this.stopAc.signal);
          continue;
        }
        if (this.stopping) {
          await release(job.id, this.workerId, db);
          break;
        }
        this.inFlight.set(job.id, job);
        log.info(`[slot ${slot}] ${job.kind} ${job.id} (attempt ${job.attempts}/${job.maxAttempts})`);
        const res = await executeJob(job, { workerId: this.workerId, heartbeatMs: this.opts.heartbeatMs, shutdownSignal: this.shutdownAc.signal, db });
        this.inFlight.delete(job.id);
        this.processed++;
        this.opts.onJob?.(job, res);
      } catch (e) {
        log.error(`worker loop error: ${(e as Error).message}`);
        await sleep(Math.min(10_000, this.opts.pollMs * 5), this.stopAc.signal);
      }
    }
  }

  /**
   * Stop claiming, let in-flight jobs finish up to shutdownTimeoutMs, then abort them and
   * release them back to the queue (attempt not counted).
   */
  async stop(): Promise<{ released: string[] }> {
    if (this.stopping) return { released: [] };
    this.stopping = true;
    this.stopAc.abort();
    const all = Promise.all(this.loops);
    const timedOut = await Promise.race([all.then(() => false), sleep(this.opts.shutdownTimeoutMs).then(() => true)]);
    const released: string[] = [];
    if (timedOut) {
      const ids = [...this.inFlight.keys()];
      this.shutdownAc.abort("shutdown");
      const db = this.opts.db ?? getDb();
      for (const id of ids) if (await release(id, this.workerId, db).catch(() => false)) released.push(id);
      await Promise.race([all, sleep(5_000)]);
    }
    return { released };
  }
}

export interface InlineOptions {
  workerId?: string;
  lockTimeoutMs?: number;
  heartbeatMs?: number;
  /** Max time to wait for a job in backoff before giving up (ms). */
  maxWaitMs?: number;
  signal?: AbortSignal;
  db?: DB;
  onJob?: (job: Job, outcome: Awaited<ReturnType<typeof executeJob>>) => void;
}

/** Process the jobs of one run in-process until the run finishes (or is stuck). */
export async function processRunInline(runId: string, opts: InlineOptions = {}): Promise<Run> {
  const db = opts.db ?? getDb();
  const workerId = opts.workerId ?? defaultWorkerId("inline");
  const lockTimeoutMs = opts.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
  const started = Date.now();
  const shutdownAc = new AbortController();
  opts.signal?.addEventListener("abort", () => shutdownAc.abort("shutdown"), { once: true });
  for (;;) {
    if (opts.signal?.aborted) break;
    await reapStale(lockTimeoutMs, db);
    const [job] = await claim(workerId, { runId, limit: 1 }, db);
    if (job) {
      const res = await executeJob(job, { workerId, heartbeatMs: opts.heartbeatMs, shutdownSignal: shutdownAc.signal, db });
      opts.onJob?.(job, res);
      if (res.outcome === "released") break;
      continue;
    }
    const run = await getRun(runId, db);
    if (!run) throw new Error(`run ${runId} not found`);
    if (["succeeded", "partial", "failed", "cancelled"].includes(run.status)) return run;
    const live = await liveJobs(runId, db);
    if (!live.length) return run; // interrupted run with nothing queued: caller should --resume
    if (opts.maxWaitMs !== undefined && Date.now() - started > opts.maxWaitMs) return run;
    const queued = live.filter((j) => j.status === "queued");
    const nextAt = queued.length ? Math.min(...queued.map((j) => j.runAt.getTime())) : Date.now() + 1000;
    const wait = Math.min(5_000, Math.max(200, nextAt - Date.now()));
    if (queued.length && nextAt - Date.now() > 2000) engineConfig().log.info(`waiting ${Math.round((nextAt - Date.now()) / 1000)}s for backoff of ${queued[0]!.kind} job`);
    await sleep(wait, opts.signal);
  }
  return (await getRun(runId, db))!;
}
