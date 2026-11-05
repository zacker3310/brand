import Link from "next/link";
import type { RunRow } from "@/server/queries/ops";
import { formatCount } from "@/lib/utils";
import { EmptyRow, Mono, ShortId, StatusPill, TableFrame, Time, formatDuration, stickyCell, td, th } from "./ui";

const n = (v: number | undefined) => (typeof v === "number" ? formatCount(v) : "–");

export function RunsTable({ rows, emptyText = "No ingestion runs yet. Enqueue one from Systems, or run npm run ingest." }: { rows: RunRow[]; emptyText?: string }) {
  return (
    <TableFrame label="Ingestion runs">
      <table className="w-full min-w-[960px] border-collapse">
        <thead className="border-b bg-surface-1">
          <tr>
            <th scope="col" className={`${th} ${stickyCell} bg-surface-1`}>
              System
            </th>
            <th scope="col" className={th}>
              Run
            </th>
            <th scope="col" className={th}>
              Status
            </th>
            <th scope="col" className={th}>
              Stage
            </th>
            <th scope="col" className={`${th} text-right`}>
              Docs
            </th>
            <th scope="col" className={`${th} text-right`}>
              Fetched
            </th>
            <th scope="col" className={`${th} text-right`}>
              Published
            </th>
            <th scope="col" className={`${th} text-right`}>
              Issues
            </th>
            <th scope="col" className={`${th} text-right`}>
              Duration
            </th>
            <th scope="col" className={th}>
              Created
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.length === 0 ? (
            <EmptyRow colSpan={10}>{emptyText}</EmptyRow>
          ) : (
            rows.map((r) => (
              <tr key={r.id} className="transition-colors hover:bg-muted/40">
                <td className={`${td} ${stickyCell}`}>
                  <Link href={`/ops/runs/${r.id}`} className="font-medium hover:underline">
                    {r.systemName ?? r.system ?? "—"}
                  </Link>
                  <div className="text-[11px] text-muted-foreground">
                    <Mono>{r.adapterId ?? "no adapter"}</Mono>
                    {r.adapterVersion && <Mono className="text-muted-foreground"> @{r.adapterVersion}</Mono>}
                  </div>
                </td>
                <td className={td}>
                  <ShortId id={r.id} href={`/ops/runs/${r.id}`} />
                  <div className="text-[11px] text-muted-foreground">
                    {r.kind} · {r.triggeredBy}
                  </div>
                </td>
                <td className={td}>
                  <StatusPill status={r.status} />
                </td>
                <td className={td}>
                  <Mono className="text-muted-foreground">{r.stage ?? "–"}</Mono>
                </td>
                <td className={`${td} tabular text-right font-mono text-xs`}>{n(r.stats.discovered)}</td>
                <td className={`${td} tabular text-right font-mono text-xs`}>
                  {n(r.stats.fetched)}
                  {typeof r.stats.notModified === "number" && r.stats.notModified > 0 && <div className="text-[10px] text-muted-foreground">{formatCount(r.stats.notModified)} 304</div>}
                </td>
                <td className={`${td} tabular text-right font-mono text-xs`}>
                  {n(r.stats.published)}
                  {(r.stats.created || r.stats.updated) ? (
                    <div className="text-[10px] text-muted-foreground">
                      +{r.stats.created ?? 0} ~{r.stats.updated ?? 0}
                    </div>
                  ) : null}
                </td>
                <td className={`${td} tabular text-right font-mono text-xs`}>
                  {r.errors || r.quarantined || r.warnings ? (
                    <span className="inline-flex flex-col items-end gap-0.5">
                      {r.errors > 0 && <span className="text-[color-mix(in_oklch,var(--conflicting)_78%,var(--foreground))]">{r.errors} err</span>}
                      {r.quarantined > 0 && <span className="text-[color-mix(in_oklch,var(--inferred)_62%,var(--foreground))]">{r.quarantined} quar.</span>}
                      {r.warnings > 0 && <span className="text-muted-foreground">{r.warnings} warn</span>}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">0</span>
                  )}
                </td>
                <td className={`${td} tabular text-right font-mono text-xs`}>
                  {formatDuration(r.durationMs)}
                  {r.queueWaitMs !== null && r.queueWaitMs > 1000 && <div className="text-[10px] text-muted-foreground">waited {formatDuration(r.queueWaitMs)}</div>}
                </td>
                <td className={`${td} text-xs text-muted-foreground`}>
                  <Time at={r.createdAt} />
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </TableFrame>
  );
}
