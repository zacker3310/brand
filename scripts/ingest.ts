/**
 * npm run ingest -- <command>
 *
 *   --system <slug> [--inline] [--limit N] [--kind full|incremental]   enqueue (and optionally run) one system
 *   --all [--inline] [--limit N] [--kind ...]                          every registered system that has an adapter
 *   --resume <runId> [--inline]                                        continue an interrupted/failed run
 *   --cancel <runId>                                                   cancel a run and its live jobs
 *   --status [--runs N]                                                queue counts + recent runs
 *
 * Without --inline, jobs are only enqueued; `npm run worker` processes them.
 */
import { inArray } from "drizzle-orm";
import { closeDb, getDb } from "../src/db/client";
import { designSystems } from "../src/db/schema";
import { ADAPTERS } from "../src/ingestion/adapters";
import { cancelRun, enqueueSystemRun, INLINE_QUEUE, processRunInline, queueStatus, recentRuns, resumeRun, type Run } from "../src/ingestion/engine";
import { errorCounts } from "../src/ingestion/engine/runs";

const argv = process.argv.slice(2);
const has = (f: string) => argv.includes(f);
const val = (f: string) => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : undefined;
};

function usage(): never {
  console.error(
    "usage: ingest --system <slug> [--inline] [--limit N] [--kind full|incremental]\n" +
      "       ingest --all [--inline] [--limit N] [--kind full|incremental]\n" +
      "       ingest --resume <runId> [--inline]\n" +
      "       ingest --cancel <runId>\n" +
      "       ingest --status [--runs N]",
  );
  process.exit(64);
}

function options() {
  const limitRaw = val("--limit");
  const limit = limitRaw === undefined ? undefined : Number(limitRaw);
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) throw new Error("--limit must be a positive integer");
  const kind = (val("--kind") ?? "incremental") as "full" | "incremental";
  if (kind !== "full" && kind !== "incremental") throw new Error("--kind must be full or incremental");
  // --inline runs use a private queue so a background worker (possibly running older adapter code)
  // cannot take their stages; `--resume <runId>` without --inline hands an interrupted run back.
  return { limit, kind, triggeredBy: "cli", queue: has("--inline") ? INLINE_QUEUE : undefined };
}

const fmtDur = (ms: number | undefined) => (ms === undefined ? "-" : ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`);

async function summarize(run: Run) {
  const s = run.stats ?? {};
  const errs = await errorCounts(run.id);
  const line = (k: string, keys: string[]) => `  ${k.padEnd(10)} ${keys.map((x) => `${x}=${s[x] ?? 0}`).join("  ")}`;
  console.log(`\nrun ${run.id}  status=${run.status}  stage=${run.stage}  duration=${fmtDur(s.durationMs)}`);
  console.log(line("discover", ["discovered", "gone"]));
  console.log(line("fetch", ["fetched", "notModified", "stale", "fetchErrors", "robotsBlocked"]));
  console.log(line("parse", ["parsed", "parseReused", "parseErrors", "fragments"]));
  console.log(line("validate", ["extracted", "valid", "warnings", "quarantined", "bundleErrors"]));
  console.log(line("publish", ["published", "created", "updated", "unchanged", "removed"]));
  console.log(line("entities", ["components", "tokenSets", "tokens", "patterns"]));
  if (Object.keys(errs).length) console.log(`  errors     ${Object.entries(errs).map(([k, n]) => `${k}=${n}`).join("  ")}`);
}

async function runInline(runId: string) {
  const run = await processRunInline(runId, {
    onJob: (job, res) => console.log(`  ${job.kind.padEnd(10)} -> ${res.outcome}${res.error ? `: ${res.error.split("\n")[0]}` : ""}`),
  });
  await summarize(run);
  if (run.status === "running" || run.status === "pending") console.log(`run is not finished (no runnable jobs); resume with: npm run ingest -- --resume ${run.id} --inline`);
  return run;
}

async function status() {
  const q = await queueStatus();
  console.log("queue (kind / status / count):");
  if (!q.jobs.length) console.log("  (empty)");
  for (const j of q.jobs) console.log(`  ${j.kind.padEnd(12)} ${j.status.padEnd(10)} ${j.n}`);
  console.log(`  due now: ${q.due}${q.oldestQueuedAt ? `  (oldest queued ${q.oldestQueuedAt})` : ""}`);
  const runs = await recentRuns(Number(val("--runs") ?? 15));
  console.log("\nrecent runs:");
  console.log(`  ${"run".padEnd(36)}  ${"system".padEnd(24)} ${"status".padEnd(10)} ${"stage".padEnd(9)} ${"comp".padStart(5)} ${"tok".padStart(6)} ${"chg".padStart(5)} ${"err".padStart(4)} ${"dur".padStart(7)}  created`);
  for (const r of runs) {
    const s = r.stats ?? {};
    const changed = (s.created ?? 0) + (s.updated ?? 0) + (s.removed ?? 0);
    const errs = (s.fetchErrors ?? 0) + (s.parseErrors ?? 0);
    console.log(
      `  ${r.id}  ${(r.system ?? "-").padEnd(24)} ${r.status.padEnd(10)} ${(r.stage ?? "-").padEnd(9)} ${String(s.components ?? "-").padStart(5)} ${String(s.tokens ?? "-").padStart(6)} ${String(changed).padStart(5)} ${String(errs).padStart(4)} ${fmtDur(s.durationMs).padStart(7)}  ${r.createdAt.toISOString().slice(0, 19)}`,
    );
  }
}

async function main() {
  if (has("--status")) return status();
  if (val("--cancel")) {
    const r = await cancelRun(val("--cancel")!);
    console.log(`cancelled run ${val("--cancel")} (${r.cancelledJobs} live job(s) cancelled)`);
    return;
  }
  if (val("--resume")) {
    const r = await resumeRun(val("--resume")!, undefined, { queue: has("--inline") ? INLINE_QUEUE : undefined });
    if (!r.jobId) {
      console.log(`run ${r.runId} already ${r.status}; nothing to resume`);
      return;
    }
    console.log(`resuming run ${r.runId} at stage ${r.resumedStage} (job ${r.jobId})`);
    if (has("--inline")) {
      const run = await runInline(r.runId);
      if (run.status === "failed") process.exitCode = 1;
    }
    return;
  }
  const opts = options();
  if (val("--system")) {
    const slug = val("--system")!;
    const e = await enqueueSystemRun(slug, opts);
    console.log(`${e.deduped ? "active run already exists" : "enqueued"}: system=${slug} run=${e.runId} job=${e.jobId}`);
    if (has("--inline")) {
      const run = await runInline(e.runId);
      if (run.status === "failed") process.exitCode = 1;
    } else console.log("run `npm run worker` to process the queue, or pass --inline");
    return;
  }
  if (has("--all")) {
    const slugs = [...new Set(ADAPTERS.flatMap((a) => a.systems))];
    const rows = slugs.length ? await getDb().select({ slug: designSystems.slug }).from(designSystems).where(inArray(designSystems.slug, slugs)) : [];
    const present = rows.map((r) => r.slug).sort();
    const missing = slugs.filter((s) => !present.includes(s));
    if (missing.length) console.log(`skipping ${missing.length} adapter system(s) not in the registry: ${missing.join(", ")}`);
    if (!present.length) {
      console.log("no registered systems have adapters");
      return;
    }
    let failed = 0;
    for (const slug of present) {
      try {
        const e = await enqueueSystemRun(slug, opts);
        console.log(`${e.deduped ? "active" : "enqueued"}: ${slug} run=${e.runId}`);
        if (has("--inline")) {
          const run = await runInline(e.runId);
          if (run.status === "failed") failed++;
        }
      } catch (err) {
        failed++;
        console.error(`${slug}: ${(err as Error).message}`);
      }
    }
    if (failed) process.exitCode = 1;
    return;
  }
  usage();
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => closeDb());

