/**
 * npm run worker -- [--concurrency N] [--kinds discover,fetch] [--lock-timeout-ms 300000]
 *
 * Long-running ingestion worker on the PostgreSQL job queue: reaps stale locks, claims due jobs
 * (FOR UPDATE SKIP LOCKED), dispatches by kind, heartbeats while running. SIGINT/SIGTERM stop
 * claiming, let in-flight jobs finish (up to --shutdown-timeout-ms), then release the rest back
 * to the queue so another worker resumes them from their checkpoint.
 */
import { closeDb } from "../src/db/client";
import { Worker } from "../src/ingestion/engine";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const num = (name: string, dflt: number) => {
  const v = arg(name);
  const n = v === undefined ? dflt : Number(v);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${name} must be a non-negative number`);
  return n;
};

async function main() {
  const worker = new Worker({
    concurrency: num("--concurrency", 1),
    kinds: arg("--kinds")?.split(",").filter(Boolean),
    lockTimeoutMs: num("--lock-timeout-ms", 5 * 60_000),
    heartbeatMs: num("--heartbeat-ms", 30_000),
    pollMs: num("--poll-ms", 1_000),
    shutdownTimeoutMs: num("--shutdown-timeout-ms", 30_000),
    onJob: (job, res) => console.log(`[worker] ${job.kind} ${job.id} -> ${res.outcome}${res.error ? ` (${res.error.split("\n")[0]})` : ""}`),
  });
  console.log(`[worker] ${worker.workerId} started (concurrency ${num("--concurrency", 1)})`);
  let signals = 0;
  const shutdown = async (sig: string) => {
    signals++;
    if (signals > 1) {
      console.log(`[worker] second ${sig}: exiting now`);
      process.exit(130);
    }
    console.log(`[worker] ${sig}: stop claiming; waiting for ${worker.running.length} running job(s)`);
    const { released } = await worker.stop();
    if (released.length) console.log(`[worker] released ${released.length} job(s) back to the queue: ${released.join(", ")}`);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  await worker.start();
  console.log(`[worker] stopped after ${worker.processed} job(s)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
