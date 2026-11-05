import Link from "next/link";
import { SystemMark } from "@/components/atlas";
import { SYSTEM_CATEGORY_LABELS } from "@/lib/contracts";
import { cn, formatCount } from "@/lib/utils";
import { MaintenanceBadge } from "./badges";
import { MetadataOnly } from "./coverage-meter";
import { licenseKind, type DirectoryRow } from "./lib/directory";
import { formatDate, percent } from "./lib/format";
import { FrameworkChips } from "./system-card";

function Count({ n }: { n: number }) {
  if (n === 0) return <span className="text-muted-foreground" title="None indexed (not necessarily none in the system)">—</span>;
  return <span className="tabular">{formatCount(n)}</span>;
}

/** Dense list view. Scrolls horizontally inside its own container; the system column is sticky. */
export function SystemsTable({ rows }: { rows: DirectoryRow[] }) {
  return (
    <div className="relative overflow-x-auto rounded-xl border bg-card" role="region" aria-label="Design systems table" tabIndex={0}>
      <table className="w-full min-w-[880px] table-fixed border-separate border-spacing-0 text-sm">
        <caption className="sr-only">Design systems with category, frameworks, license, maintenance and indexed record counts</caption>
        <colgroup>
          <col className="w-[26%]" />
          <col className="w-[19%]" />
          <col className="w-[14%]" />
          <col className="w-[11%]" />
          <col className="w-[9%]" />
          <col className="w-[7%]" />
          <col className="w-[6%]" />
          <col className="w-[8%]" />
        </colgroup>
        <thead>
          <tr className="text-left text-[10.5px] font-medium text-muted-foreground uppercase">
            <th scope="col" className="sticky left-0 z-10 border-b bg-card px-4 py-2.5 font-medium">
              System
            </th>
            <th scope="col" className="border-b px-3 py-2.5 font-medium">Frameworks</th>
            <th scope="col" className="border-b px-3 py-2.5 font-medium">License</th>
            <th scope="col" className="border-b px-3 py-2.5 font-medium">Status</th>
            <th scope="col" className="border-b px-3 py-2.5 text-right font-medium">Components</th>
            <th scope="col" className="border-b px-3 py-2.5 text-right font-medium">Tokens</th>
            <th scope="col" className="border-b px-3 py-2.5 text-right font-medium">Patterns</th>
            <th scope="col" className="border-b px-3 py-2.5 text-right font-medium">Verified</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const indexed = r.ingestionStatus === "indexed" || r.ingestionStatus === "partial";
            const lk = licenseKind(r.license);
            return (
              <tr key={r.id} className="group/row align-middle transition-colors hover:bg-surface-1">
                <th scope="row" className="sticky left-0 z-10 border-b border-border/60 bg-card px-4 py-2.5 text-left font-normal group-hover/row:bg-surface-1">
                  <div className="flex items-center gap-2.5">
                    <SystemMark name={r.name} slug={r.slug} size="sm" />
                    <div className="min-w-0 flex-1">
                      <Link href={`/systems/${r.slug}`} className="block truncate font-medium hover:underline">
                        {r.name}
                      </Link>
                      <span className="block truncate text-xs text-muted-foreground">
                        {r.organization?.name ?? "—"} · {SYSTEM_CATEGORY_LABELS[r.category]}
                      </span>
                    </div>
                  </div>
                </th>
                <td className="border-b border-border/60 px-3 py-2.5">
                  <FrameworkChips frameworks={r.frameworks} max={2} className="flex-nowrap overflow-hidden" />
                </td>
                <td className="border-b border-border/60 px-3 py-2.5 text-xs whitespace-nowrap">
                  {r.license ? (
                    <span title={r.license.name} className="block truncate">
                      {r.license.spdxId ? <span className="font-mono">{r.license.spdxId}</span> : <span className="block truncate">{r.license.name}</span>}
                      <span className="block text-[11px] text-muted-foreground">{lk === "open-source" ? "Open source" : lk === "proprietary" ? "Proprietary" : "Openness unknown"}</span>
                    </span>
                  ) : (
                    <span className="text-muted-foreground">Not recorded</span>
                  )}
                </td>
                <td className="border-b border-border/60 px-3 py-2.5">
                  <MaintenanceBadge status={r.maintenance} interactive={false} />
                </td>
                {indexed ? (
                  <>
                    <td className="border-b border-border/60 px-3 py-2.5 text-right">
                      <Count n={r.counts.components} />
                    </td>
                    <td className="border-b border-border/60 px-3 py-2.5 text-right">
                      <Count n={r.counts.tokens} />
                    </td>
                    <td className="border-b border-border/60 px-3 py-2.5 text-right">
                      <Count n={r.counts.patterns} />
                    </td>
                  </>
                ) : (
                  <td colSpan={3} className="border-b border-border/60 px-3 py-2.5">
                    <MetadataOnly compact className="ml-auto w-full max-w-[14rem]" />
                  </td>
                )}
                <td className={cn("border-b border-border/60 px-3 py-2.5 text-right text-xs whitespace-nowrap text-muted-foreground")}>
                  <span className="tabular font-mono">{percent(r.confidence)}</span>
                  <span className="block text-[11px]">{formatDate(r.lastVerifiedAt) ?? "—"}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
