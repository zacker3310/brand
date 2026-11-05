import Link from "next/link";
import { CoverageChip, SourceLink, SystemMark } from "@/components/atlas";
import { cn, formatCount } from "@/lib/utils";
import type { TypeImplementation } from "@/server/queries/components";
import { ClassificationBadge, LifecycleBadge } from "./badges";
import { CoverageStrip } from "./coverage-strip";
import { fieldState } from "./lib/coverage";
import { componentHref } from "./lib/urls";

function Count({ n, field, coverage }: { n: number; field: string; coverage: TypeImplementation["coverage"] }) {
  if (n > 0) return <span className="tabular font-mono text-xs">{formatCount(n)}</span>;
  const state = fieldState(coverage, field);
  // A zero count is only "none" when the source says so; otherwise show why it is empty.
  return <CoverageChip state={state} />;
}

export function ImplementationsTable({ rows }: { rows: TypeImplementation[] }) {
  return (
    <div className="relative overflow-x-auto rounded-xl border bg-card" role="region" aria-label="Implementations, scrollable" tabIndex={0}>
      <table className="w-full min-w-[960px] border-separate border-spacing-0 text-[13px]">
        <caption className="sr-only">Implementations of this canonical type across indexed design systems</caption>
        <thead>
          <tr className="text-left font-mono text-[11px] tracking-[0.1em] text-muted-foreground uppercase">
            <th scope="col" className="sticky left-0 z-10 border-r border-b bg-surface-1 px-3 py-2.5 font-medium">
              Implementation
            </th>
            <th scope="col" className="border-b bg-surface-1 px-3 py-2.5 font-medium">
              Classification
            </th>
            <th scope="col" className="border-b bg-surface-1 px-3 py-2.5 text-right font-medium">
              Variants
            </th>
            <th scope="col" className="border-b bg-surface-1 px-3 py-2.5 font-medium">
              States
            </th>
            <th scope="col" className="border-b bg-surface-1 px-3 py-2.5 text-right font-medium">
              Props
            </th>
            <th scope="col" className="border-b bg-surface-1 px-3 py-2.5 font-medium">
              A11y / keyboard
            </th>
            <th scope="col" className="border-b bg-surface-1 px-3 py-2.5 font-medium">
              Frameworks
            </th>
            <th scope="col" className="border-b bg-surface-1 px-3 py-2.5 font-medium">
              Coverage
            </th>
            <th scope="col" className="border-b bg-surface-1 px-3 py-2.5 font-medium">
              Docs
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const canon = [...new Set(r.states.map((s) => s.canonical).filter((x): x is string => !!x))];
            const unmapped = r.states.filter((s) => !s.canonical).length;
            return (
              <tr key={r.id} className="group/row align-top">
                <th scope="row" className="sticky left-0 z-10 border-r border-b border-border/60 bg-card px-3 py-3 text-left font-normal group-hover/row:bg-accent">
                  <div className="flex items-start gap-2.5">
                    <SystemMark name={r.systemName} slug={r.systemSlug} size="sm" className="mt-0.5" />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Link href={componentHref(r.systemSlug, r.slug)} className="font-medium hover:underline hover:underline-offset-4">
                          {r.name}
                        </Link>
                        <LifecycleBadge lifecycle={r.lifecycle} dense />
                      </div>
                      <p className="text-xs text-muted-foreground">{r.systemName}</p>
                    </div>
                  </div>
                </th>
                <td className="border-b border-border/60 px-3 py-3">
                  <ClassificationBadge state={r.classificationState} method={r.classificationMethod} />
                </td>
                <td className="border-b border-border/60 px-3 py-3 text-right">
                  <Count n={r.variantCount} field="variants" coverage={r.coverage} />
                </td>
                <td className="max-w-56 border-b border-border/60 px-3 py-3">
                  {r.states.length === 0 ? (
                    <CoverageChip state={fieldState(r.coverage, "states")} />
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {canon.slice(0, 6).map((c) => (
                        <span key={c} className="rounded border px-1 py-px font-mono text-[10px] text-muted-foreground">
                          {c}
                        </span>
                      ))}
                      {canon.length > 6 && <span className="text-[11px] text-muted-foreground">+{canon.length - 6}</span>}
                      {unmapped > 0 && (
                        <span className="text-[11px] text-muted-foreground" title="States with no canonical mapping">
                          +{unmapped} unmapped
                        </span>
                      )}
                    </div>
                  )}
                </td>
                <td className="border-b border-border/60 px-3 py-3 text-right">
                  <Count n={r.propsCount} field="properties" coverage={r.coverage} />
                  {r.implementationCount > 1 && (
                    <p className="text-[10px] whitespace-nowrap text-muted-foreground">{r.implementationCount} implementations</p>
                  )}
                </td>
                <td className="border-b border-border/60 px-3 py-3">
                  <div className="flex flex-col items-start gap-1">
                    <CoverageChip state={fieldState(r.coverage, "accessibility")} label="A11y" />
                    <CoverageChip state={fieldState(r.coverage, "keyboard")} label="Keys" />
                  </div>
                </td>
                <td className="max-w-40 border-b border-border/60 px-3 py-3 text-xs text-muted-foreground">
                  {r.frameworks.length ? r.frameworks.join(", ") : <CoverageChip state={fieldState(r.coverage, "frameworks")} />}
                </td>
                <td className="border-b border-border/60 px-3 py-3">
                  <CoverageStrip coverage={r.coverage} />
                </td>
                <td className={cn("border-b border-border/60 px-3 py-3")}>
                  {r.docsUrl ? (
                    <SourceLink href={r.docsUrl} className="text-xs whitespace-nowrap">
                      Docs
                    </SourceLink>
                  ) : (
                    <CoverageChip state="not-extracted" label="Docs link" />
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
