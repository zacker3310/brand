import Link from "next/link";
import { requireAdminPage } from "@/server/admin";
import { listRuns, opsOverview } from "@/server/queries/ops";
import { RunsTable } from "@/components/ops/runs-table";
import { Meter, SectionTitle, Tile, Time } from "@/components/ops/ui";
import { formatCount } from "@/lib/utils";

export const metadata = { title: "Overview" };

export default async function OpsOverviewPage() {
  await requireAdminPage("/ops");
  const [o, runs] = await Promise.all([opsOverview(), listRuns({ page: 1, pageSize: 8 })]);
  const verified = o.registry.verified ?? 0;
  const ingestionTotal = Object.values(o.ingestion).reduce((a, b) => a + b, 0);
  const docsTotal = Object.values(o.documents).reduce((a, b) => a + b, 0);
  const failedJobs = (o.jobs.failed ?? 0) + (o.jobs.dead ?? 0);
  return (
    <div className="space-y-10">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Overview</h1>
        <p className="text-sm text-muted-foreground">
          Live from the database. Last run finished <Time at={o.runs.lastFinishedAt} />.
        </p>
      </header>

      <section aria-labelledby="health" className="space-y-3">
        <h2 id="health" className="sr-only">
          Health
        </h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Tile label="Open errors" value={o.errors.openErrors} tone={o.errors.openErrors ? "bad" : "ok"} href="/ops/errors" hint={`${formatCount(o.errors.openWarnings)} open warnings · ${formatCount(o.errors.resolved)} resolved`} />
          <Tile label="Failed / dead jobs" value={failedJobs} tone={failedJobs ? "bad" : "ok"} href="/ops/queue" hint={`${formatCount(o.jobs.queued ?? 0)} queued · ${formatCount(o.jobs.running ?? 0)} running · ${formatCount(o.dueJobs)} due`} />
          <Tile label="Quarantined extractions" value={o.quarantined} tone={o.quarantined ? "warn" : "ok"} href="/ops/quarantine" hint="Latest observation invalid or conflicting" />
          <Tile label="Broken source links" value={o.brokenSources} tone={o.brokenSources ? "warn" : "ok"} href="/ops/sources#broken" hint="HTTP ≥ 400 or network error at last check" />
          <Tile label="Verified systems" value={verified} href="/ops/registry" hint={`${formatCount(o.registry.rejected ?? 0)} rejected · ${formatCount(o.registry.duplicate ?? 0)} duplicate`} />
          <Tile label="Stale verification" value={o.staleVerification} tone={o.staleVerification ? "warn" : "ok"} href="/ops/registry#stale" hint="Verified systems last checked > 30 days ago" />
          <Tile label="Runs" value={o.runs.total} href="/ops/runs" hint={`${formatCount(o.runs.active)} active · ${formatCount(o.runs.failed7d)} failed in 7 days`} />
          <Tile label="Evidence records" value={o.evidence} href="/ops/evidence" hint="Provenance rows (verification_evidence)" />
        </div>
      </section>

      <div className="grid gap-8 lg:grid-cols-2">
        <section aria-labelledby="ingestion-title">
          <SectionTitle id="ingestion-title" count={ingestionTotal} description="Verified systems by ingestion status.">
            Ingestion depth
          </SectionTitle>
          <ul className="space-y-2.5 rounded-xl border bg-card p-4">
            {Object.entries(o.ingestion)
              .sort((a, b) => b[1] - a[1])
              .map(([status, n]) => (
                <li key={status} className="grid grid-cols-[8rem_minmax(0,1fr)_3rem] items-center gap-3 text-sm">
                  <Link href={`/ops/systems?status=${status}`} className="truncate text-muted-foreground hover:text-foreground">
                    {status.replace(/_/g, " ")}
                  </Link>
                  <Meter value={n} max={ingestionTotal} tone={status === "indexed" ? "ok" : status === "failed" || status === "blocked" ? "bad" : status === "partial" ? "warn" : "neutral"} label={`${status}: ${n}`} />
                  <span className="tabular text-right font-mono text-xs">{n}</span>
                </li>
              ))}
          </ul>
        </section>
        <section aria-labelledby="docs-title">
          <SectionTitle id="docs-title" count={docsTotal} description="Fetched source documents by status.">
            Source documents
          </SectionTitle>
          <ul className="space-y-2.5 rounded-xl border bg-card p-4">
            {Object.keys(o.documents).length === 0 ? (
              <li className="text-sm text-muted-foreground">No documents fetched yet.</li>
            ) : (
              Object.entries(o.documents).map(([status, n]) => (
                <li key={status} className="grid grid-cols-[8rem_minmax(0,1fr)_3rem] items-center gap-3 text-sm">
                  <span className="text-muted-foreground">{status}</span>
                  <Meter value={n} max={docsTotal} tone={status === "active" ? "ok" : status === "gone" ? "neutral" : "bad"} label={`${status}: ${n}`} />
                  <span className="tabular text-right font-mono text-xs">{n}</span>
                </li>
              ))
            )}
          </ul>
        </section>
      </div>

      <section aria-labelledby="recent-runs">
        <SectionTitle
          id="recent-runs"
          description="Most recent ingestion runs."
          actions={
            <Link href="/ops/runs" className="text-xs font-medium text-muted-foreground hover:text-foreground">
              All runs →
            </Link>
          }
        >
          Recent runs
        </SectionTitle>
        <RunsTable rows={runs.rows} />
      </section>
    </div>
  );
}
