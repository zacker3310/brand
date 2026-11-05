import Link from "next/link";
import { SystemMark } from "@/components/atlas";
import { SYSTEM_CATEGORY_LABELS } from "@/lib/contracts";
import { cn, formatCount } from "@/lib/utils";
import { DepthBadge, MaintenanceBadge } from "./badges";
import { licenseKind, type DirectoryRow } from "./lib/directory";
import { formatDate, percent } from "./lib/format";
import { FrameworkChips } from "./system-card";

function Count({ n, indexed }: { n: number; indexed: boolean }) {
  if (!indexed) return <span className="text-[11px] text-muted-foreground">not extracted</span>;
  if (n === 0) return <span className="text-muted-foreground" title="None indexed (not necessarily none in the system)">—</span>;
  return <span className="tabular">{formatCount(n)}</span>;
}

/** Dense list view. Scrolls horizontally inside its own container; the system column is sticky. */
export function SystemsTable({ rows }: { rows: DirectoryRow[] }) {
  return (
    <div className="relative overflow-x-auto rounded-xl border bg-card" role="region" aria-label="Design systems table" tabIndex={0}>
      <table className="w-full min-w-[980px] border-separate border-spacing-0 text-sm">
        <caption className="sr-only">Design systems with category, frameworks, license, maintenance and indexed record counts</caption>
        <thead>
          <tr className="text-left text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            <th scope="col" className="sticky left-0 z-10 border-b bg-card px-4 py-2.5 font-medium">
              System
            </th>
            <th scope="col" className="border-b px-3 py-2.5 font-medium">Category</th>
            <th scope="col" className="border-b px-3 py-2.5 font-medium">Frameworks</th>
            <th scope="col" className="border-b px-3 py-2.5 font-medium">License</th>
            <th scope="col" className="border-b px-3 py-2.5 font-medium">Status</th>
            <th scope="col" className="border-b px-3 py-2.5 text-right font-medium">Components</th>
            <th scope="col" className="border-b px-3 py-2.5 text-right font-medium">Tokens</th>
            <th scope="col" className="border-b px-3 py-2.5 text-right font-medium">Patterns</th>
            <th scope="col" className="border-b px-3 py-2.5 font-medium">Depth</th>
            <th scope="col" className="border-b px-4 py-2.5 text-right font-medium">Verified</th>
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
                    <div className="min-w-0">
                      <Link href={`/systems/${r.slug}`} className="block max-w-[15rem] truncate font-medium hover:underline">
                        {r.name}
                      </Link>
                      <span className="block max-w-[15rem] truncate text-xs text-muted-foreground">{r.organization?.name ?? "—"}</span>
                    </div>
                  </div>
                </th>
                <td className="border-b border-border/60 px-3 py-2.5 text-xs whitespace-nowrap text-muted-foreground">{SYSTEM_CATEGORY_LABELS[r.category]}</td>
                <td className="border-b border-border/60 px-3 py-2.5">
                  <FrameworkChips frameworks={r.frameworks} max={3} className="flex-nowrap" />
                </td>
                <td className="border-b border-border/60 px-3 py-2.5 text-xs whitespace-nowrap">
                  {r.license ? (
                    <span title={r.license.name}>
                      <span className="font-mono">{r.license.spdxId ?? r.license.slug}</span>
                      <span className="block text-[11px] text-muted-foreground">{lk === "open-source" ? "Open source" : lk === "proprietary" ? "Proprietary" : "Openness unknown"}</span>
                    </span>
                  ) : (
                    <span className="text-muted-foreground">Not recorded</span>
                  )}
                </td>
                <td className="border-b border-border/60 px-3 py-2.5">
                  <MaintenanceBadge status={r.maintenance} />
                </td>
                <td className="border-b border-border/60 px-3 py-2.5 text-right">
                  <Count n={r.counts.components} indexed={indexed} />
                </td>
                <td className="border-b border-border/60 px-3 py-2.5 text-right">
                  <Count n={r.counts.tokens} indexed={indexed} />
                </td>
                <td className="border-b border-border/60 px-3 py-2.5 text-right">
                  <Count n={r.counts.patterns} indexed={indexed} />
                </td>
                <td className="border-b border-border/60 px-3 py-2.5">
                  <DepthBadge status={r.ingestionStatus} />
                </td>
                <td className={cn("border-b border-border/60 px-4 py-2.5 text-right text-xs whitespace-nowrap text-muted-foreground")}>
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
