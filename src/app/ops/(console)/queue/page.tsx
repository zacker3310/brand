import Link from "next/link";
import { requireAdminPage } from "@/server/admin";
import { queueView, type JobRow } from "@/server/queries/ops";
import { JobActions } from "@/components/ops/job-actions";
import { EmptyRow, Mono, OpsNotice, SectionTitle, ShortId, StatusPill, TableFrame, Tile, Time, one, stickyCell, td, th } from "@/components/ops/ui";
import { cn, formatCount } from "@/lib/utils";

export const metadata = { title: "Queue" };

export default async function QueuePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminPage("/ops/queue");
  const sp = await searchParams;
  const problemStatus = ["failed", "dead", "cancelled"].includes(one(sp.show) ?? "") ? one(sp.show) : undefined;
  const q = await queueView({ problemStatus });
  const total = (s: string) => q.matrix.reduce((a, m) => a + (m.counts[s] ?? 0), 0);
  const returnTo = `/ops/queue${problemStatus ? `?show=${problemStatus}` : ""}`;
  return (
    <div className="space-y-10">
      <header className="space-y-3">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight">Queue</h1>
          <p className="text-sm text-muted-foreground">
            The durable PostgreSQL job queue (ingestion_job). Workers claim due jobs with SKIP LOCKED; failures back off exponentially and become dead after their last attempt.
          </p>
        </div>
        <OpsNotice sp={sp} />
      </header>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="Due now" value={q.due} hint="Queued with run_at in the past" />
        <Tile label="Scheduled (backoff)" value={q.scheduled} hint="Queued with a future run_at" />
        <Tile label="Running" value={total("running")} />
        <Tile label="Failed + dead" value={total("failed") + total("dead")} tone={total("failed") + total("dead") ? "bad" : "ok"} />
      </div>
      {q.oldestQueuedAt && (
        <p className="-mt-6 text-xs text-muted-foreground">
          Oldest queued job was created <Time at={q.oldestQueuedAt} />. If nothing moves, check that a worker is running (npm run worker).
        </p>
      )}

      <section aria-labelledby="matrix-title">
        <SectionTitle id="matrix-title" description="Job counts by kind and status.">
          Jobs by kind
        </SectionTitle>
        <TableFrame label="Job counts by kind and status">
          <table className="w-full min-w-[640px] border-collapse">
            <thead className="border-b bg-surface-1">
              <tr>
                <th scope="col" className={`${th} ${stickyCell} bg-surface-1`}>
                  Kind
                </th>
                {q.statuses.map((s) => (
                  <th key={s} scope="col" className={`${th} text-right`}>
                    {s}
                  </th>
                ))}
                <th scope="col" className={`${th} text-right`}>
                  Total
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {q.matrix.length === 0 ? (
                <EmptyRow colSpan={q.statuses.length + 2}>The queue is empty: no job has ever been enqueued.</EmptyRow>
              ) : (
                q.matrix.map((m) => (
                  <tr key={m.kind}>
                    <th scope="row" className={`${td} ${stickyCell} text-left font-normal`}>
                      <Mono>{m.kind}</Mono>
                    </th>
                    {q.statuses.map((s) => (
                      <td
                        key={s}
                        className={cn(
                          td,
                          "tabular text-right font-mono text-xs",
                          !m.counts[s] && "text-muted-foreground",
                          (s === "failed" || s === "dead") && m.counts[s] && "text-conflicting",
                        )}
                      >
                        {formatCount(m.counts[s] ?? 0)}
                      </td>
                    ))}
                    <td className={`${td} tabular text-right font-mono text-xs font-medium`}>{formatCount(m.total)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </TableFrame>
      </section>

      <section aria-labelledby="problems-title">
        <SectionTitle
          id="problems-title"
          count={q.problemTotal}
          description="Failed, dead and cancelled jobs with their last error. Retry requeues with attempts reset."
          actions={
            <nav aria-label="Filter problem jobs" className="flex gap-1">
              {[undefined, "failed", "dead", "cancelled"].map((s) => (
                <Link
                  key={s ?? "all"}
                  href={s ? `/ops/queue?show=${s}` : "/ops/queue"}
                  aria-current={problemStatus === s ? "page" : undefined}
                  className={cn("rounded-full border px-2.5 py-0.5 text-xs", problemStatus === s ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}
                >
                  {s ?? "all"}
                </Link>
              ))}
            </nav>
          }
        >
          Needs attention
        </SectionTitle>
        <JobTable rows={q.problems} returnTo={returnTo} empty={problemStatus ? `No ${problemStatus} jobs.` : "No failed, dead or cancelled jobs. Nothing needs attention."} showError />
      </section>

      <section aria-labelledby="running-title">
        <SectionTitle id="running-title" count={q.running.length} description="Claimed jobs and their worker lock. Stale locks are reaped back to the queue by workers.">
          Running
        </SectionTitle>
        <JobTable rows={q.running} returnTo={returnTo} empty="No job is running right now." showLock />
      </section>

      <section aria-labelledby="waiting-title">
        <SectionTitle id="waiting-title" count={q.waiting.length} description="Queued jobs in claim order (priority, then run_at).">
          Waiting
        </SectionTitle>
        <JobTable rows={q.waiting} returnTo={returnTo} empty="Nothing is waiting." showRunAt />
      </section>
    </div>
  );
}

function JobTable({ rows, returnTo, empty, showError, showLock, showRunAt }: { rows: JobRow[]; returnTo: string; empty: string; showError?: boolean; showLock?: boolean; showRunAt?: boolean }) {
  const cols = 5 + (showError ? 1 : 0) + (showLock ? 1 : 0) + (showRunAt ? 1 : 0);
  return (
    <TableFrame label="Jobs">
      <table className="w-full min-w-[820px] border-collapse">
        <thead className="border-b bg-surface-1">
          <tr>
            <th scope="col" className={`${th} ${stickyCell} bg-surface-1`}>
              Job
            </th>
            <th scope="col" className={th}>
              System
            </th>
            <th scope="col" className={th}>
              Status
            </th>
            <th scope="col" className={th}>
              Attempts
            </th>
            {showError && (
              <th scope="col" className={th}>
                Last error
              </th>
            )}
            {showLock && (
              <th scope="col" className={th}>
                Locked by
              </th>
            )}
            {showRunAt && (
              <th scope="col" className={th}>
                Runs
              </th>
            )}
            <th scope="col" className={th}>
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.length === 0 ? (
            <EmptyRow colSpan={cols}>{empty}</EmptyRow>
          ) : (
            rows.map((j) => (
              <tr key={j.id} className="hover:bg-muted/40">
                <td className={`${td} ${stickyCell}`}>
                  <Mono className="font-medium">{j.kind}</Mono>
                  <div className="text-[11px] text-muted-foreground">
                    <ShortId id={j.id} /> · prio {j.priority}
                  </div>
                </td>
                <td className={td}>
                  {j.system ?? <span className="text-muted-foreground">—</span>}
                  {j.runId && (
                    <div className="text-[11px] text-muted-foreground">
                      run <ShortId id={j.runId} href={`/ops/runs/${j.runId}`} />
                    </div>
                  )}
                </td>
                <td className={td}>
                  <StatusPill status={j.status} />
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    <Time at={j.updatedAt} />
                  </div>
                </td>
                <td className={`${td} tabular font-mono text-xs`}>
                  {j.attempts}/{j.maxAttempts}
                </td>
                {showError && (
                  <td className={`${td} max-w-md`}>
                    {j.lastError ? (
                      <details className="text-xs">
                        <summary className="cursor-pointer truncate text-conflicting">{j.lastError.split("\n")[0]}</summary>
                        <pre className="mt-1 overflow-x-auto rounded bg-muted p-2 font-mono text-[11px] whitespace-pre-wrap text-muted-foreground">{j.lastError}</pre>
                      </details>
                    ) : (
                      <span className="text-xs text-muted-foreground">no error recorded</span>
                    )}
                  </td>
                )}
                {showLock && (
                  <td className={`${td} text-xs`}>
                    <Mono>{j.lockedBy ?? "—"}</Mono>
                    <div className="text-[11px] text-muted-foreground">
                      since <Time at={j.lockedAt} fallback="—" />
                    </div>
                  </td>
                )}
                {showRunAt && (
                  <td className={`${td} text-xs text-muted-foreground`}>
                    <Time at={j.runAt} />
                  </td>
                )}
                <td className={`${td} text-right`}>
                  <JobActions jobId={j.id} status={j.status} returnTo={returnTo} />
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </TableFrame>
  );
}
