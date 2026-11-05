import Link from "next/link";
import { SystemMark } from "@/components/atlas";
import type { CatalogComponentRow, SystemLabel } from "@/server/queries/components";
import { cn, formatCount } from "@/lib/utils";
import { ClassificationBadge, LifecycleBadge } from "./badges";
import { CoverageStrip } from "./coverage-strip";
import { a11yState } from "./lib/coverage";
import { frameworkName } from "./lib/format";
import { componentHref, componentTypeHref } from "./lib/urls";
import { CoverageChip } from "@/components/atlas";

function FrameworkList({ slugs }: { slugs: string[] }) {
  if (slugs.length === 0) return <span className="text-xs text-muted-foreground">None recorded</span>;
  return <span className="text-xs text-muted-foreground">{slugs.map(frameworkName).join(", ")}</span>;
}

export function ComponentTable({ rows, systems }: { rows: CatalogComponentRow[]; systems: Map<string, SystemLabel> }) {
  return (
    <>
      {/* Desktop: dense table */}
      <div className="hidden overflow-x-auto rounded-xl border bg-card md:block">
        <table className="w-full text-[13px]">
          <caption className="sr-only">Published components matching the current filters</caption>
          <thead className="border-b bg-surface-1 text-left">
            <tr className="font-mono text-[11px] tracking-[0.1em] text-subtle-foreground uppercase">
              <th scope="col" className="px-3 py-2.5 font-medium">
                Component
              </th>
              <th scope="col" className="px-3 py-2.5 font-medium">
                System
              </th>
              <th scope="col" className="px-3 py-2.5 font-medium">
                Canonical type
              </th>
              <th scope="col" className="px-3 py-2.5 font-medium">
                Coverage
              </th>
              <th scope="col" className="px-3 py-2.5 text-right font-medium">
                Props
              </th>
              <th scope="col" className="px-3 py-2.5 font-medium">
                A11y
              </th>
              <th scope="col" className="hidden px-3 py-2.5 font-medium xl:table-cell">
                Frameworks
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {rows.map((r) => (
              <tr key={r.id} className="transition-colors hover:bg-accent/40">
                <td className="max-w-72 px-3 py-2.5 align-top">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Link href={componentHref(r.systemSlug, r.slug)} className="font-medium hover:underline hover:underline-offset-4">
                      {r.name}
                    </Link>
                    <LifecycleBadge lifecycle={r.lifecycle} dense />
                  </div>
                  {r.description ? (
                    <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{r.description}</p>
                  ) : (
                    <p className="mt-0.5 font-mono text-[11px] text-subtle-foreground">{r.slug}</p>
                  )}
                </td>
                <td className="px-3 py-2.5 align-top whitespace-nowrap">
                  <span className="inline-flex items-center gap-2" title={r.systemName}>
                    <SystemMark name={r.systemName} slug={r.systemSlug} size="sm" className="size-5 rounded text-[8px]" />
                    {systems.get(r.systemSlug)?.shortName ?? r.systemName}
                  </span>
                </td>
                <td className="px-3 py-2.5 align-top">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {r.typeSlug && r.typeName && (
                      <Link href={componentTypeHref(r.typeSlug)} className="whitespace-nowrap hover:underline hover:underline-offset-4">
                        {r.typeName}
                      </Link>
                    )}
                    <ClassificationBadge state={r.classificationState} method={r.classificationMethod} classified={!!r.typeSlug} />
                  </div>
                </td>
                <td className="px-3 py-2.5 align-top">
                  <CoverageStrip coverage={r.coverage} />
                </td>
                <td className="tabular px-3 py-2.5 text-right align-top font-mono text-xs">
                  {r.propsCount > 0 ? formatCount(r.propsCount) : <CoverageChip state={r.coverage.properties ?? "not-extracted"} />}
                </td>
                <td className="px-3 py-2.5 align-top">
                  <CoverageChip state={a11yState(r.coverage)} />
                </td>
                <td className="hidden max-w-48 px-3 py-2.5 align-top xl:table-cell">
                  <FrameworkList slugs={r.frameworks} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile: stacked cards */}
      <ul className="space-y-2 md:hidden" aria-label="Components">
        {rows.map((r) => (
          <li key={r.id} className="rounded-xl border bg-card p-3.5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Link href={componentHref(r.systemSlug, r.slug)} className="font-medium hover:underline">
                    {r.name}
                  </Link>
                  <LifecycleBadge lifecycle={r.lifecycle} dense />
                </div>
                <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <SystemMark name={r.systemName} slug={r.systemSlug} size="sm" className="size-4 rounded text-[7px]" />
                  {systems.get(r.systemSlug)?.shortName ?? r.systemName}
                </p>
              </div>
              <CoverageStrip coverage={r.coverage} />
            </div>
            <div className={cn("mt-2.5 flex flex-wrap items-center gap-1.5 text-xs")}>
              {r.typeSlug && r.typeName && (
                <Link href={componentTypeHref(r.typeSlug)} className="text-foreground/90 hover:underline">
                  {r.typeName}
                </Link>
              )}
              <ClassificationBadge state={r.classificationState} method={r.classificationMethod} classified={!!r.typeSlug} />
              <span className="text-subtle-foreground" aria-hidden>
                ·
              </span>
              <span className="tabular text-muted-foreground">{r.propsCount > 0 ? `${formatCount(r.propsCount)} props` : "Props:"}</span>
              {r.propsCount === 0 && <CoverageChip state={r.coverage.properties ?? "not-extracted"} />}
              <CoverageChip state={a11yState(r.coverage)} label="A11y" />
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
