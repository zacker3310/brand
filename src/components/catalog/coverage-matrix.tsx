import Link from "next/link";
import { Fragment } from "react";
import { COMPONENT_FIELDS } from "@/lib/contracts";
import { cn, formatCount } from "@/lib/utils";
import type { CatalogTypesResult, ImplementationRef, SystemLabel } from "@/server/queries/components";
import { componentHref, componentTypeHref } from "./lib/urls";

/** 0..1 share of fields documented -> tint strength. Never 0 for a present cell, so presence is always visible. */
function heat(share: number): string {
  const pct = Math.round(10 + share * 34);
  return `color-mix(in oklch, var(--primary) ${pct}%, var(--card))`;
}

function bestShare(impls: ImplementationRef[]): number {
  return Math.max(0, ...impls.map((i) => i.docFields / COMPONENT_FIELDS.length));
}

export function MatrixLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[11px] text-muted-foreground">
      <span className="inline-flex items-center gap-2">
        <span aria-hidden className="h-3.5 w-6 rounded-[3px] border border-dashed border-border bg-transparent" />
        <span>
          <span className="font-medium text-foreground/85">Not found in ATLAS&apos;s index</span> of that system. Not evidence the system
          lacks it.
        </span>
      </span>
      <span className="inline-flex items-center gap-2">
        <span aria-hidden className="flex">
          {[0, 0.25, 0.5, 0.75, 1].map((s) => (
            <span key={s} className="h-3.5 w-3 first:rounded-l-[3px] last:rounded-r-[3px]" style={{ background: heat(s) }} />
          ))}
        </span>
        <span>
          <span className="font-medium text-foreground/85">Present</span>, shaded by share of the 12 fields the source documents (best
          implementation)
        </span>
      </span>
    </div>
  );
}

export function CoverageMatrix({
  result,
  columns,
  systems,
}: {
  result: CatalogTypesResult;
  columns: SystemLabel[];
  systems: Map<string, SystemLabel>;
}) {
  const colSlugs = new Set(columns.map((c) => c.slug));
  const groups = result.groups
    .map((g) => ({
      ...g,
      rows: g.types.filter((t) => t.systems.some((s) => colSlugs.has(s.systemSlug))),
    }))
    .filter((g) => g.rows.length > 0);
  const missingTypes = result.groups.flatMap((g) => [
    ...g.empty,
    ...g.types.filter((t) => !t.systems.some((s) => colSlugs.has(s.systemSlug))).map((t) => ({ slug: t.slug, name: t.name })),
  ]);

  return (
    <div className="space-y-3">
      <div className="relative max-h-[calc(100dvh-10rem)] overflow-auto rounded-xl border bg-card" tabIndex={0} role="region" aria-label="Coverage matrix, scrollable">
        <table className="w-full border-separate border-spacing-0 text-[13px]">
          <caption className="sr-only">
            Canonical component types (rows) by design system (columns). Cells list the system-specific component names ATLAS indexed.
            Empty cells mean not found in ATLAS&apos;s index of that system, which is not evidence the system lacks the component.
          </caption>
          <thead>
            <tr>
              <th
                scope="col"
                className="sticky top-0 left-0 z-30 min-w-36 border-r border-b bg-surface-1 px-3 py-2.5 text-left align-bottom font-mono text-[11px] font-medium tracking-[0.12em] text-muted-foreground uppercase sm:min-w-52"
              >
                Type
              </th>
              {columns.map((c) => (
                <th
                  key={c.slug}
                  scope="col"
                  title={c.name}
                  className="sticky top-0 z-20 min-w-36 border-b bg-surface-1 px-3 py-2.5 text-left align-bottom font-medium"
                >
                  <span className="block truncate text-[13px]">{c.shortName}</span>
                  <span className="tabular block font-mono text-[10px] font-normal text-muted-foreground">
                    {formatCount(c.componentCount)} indexed
                  </span>
                  {c.shortName !== c.name && <span className="sr-only"> ({c.name})</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <Fragment key={g.slug}>
                <tr>
                  <th
                    scope="colgroup"
                    colSpan={columns.length + 1}
                    className="sticky left-0 border-b bg-card px-3 pt-4 pb-1.5 text-left font-mono text-[11px] font-medium tracking-[0.12em] text-muted-foreground uppercase"
                  >
                    {g.name}
                  </th>
                </tr>
                {g.rows.map((t) => {
                  const bySystem = new Map(t.systems.map((s) => [s.systemSlug, s.implementations]));
                  return (
                    <tr key={t.slug} className="group/row">
                      <th
                        scope="row"
                        className="sticky left-0 z-10 border-r border-b border-border/60 bg-card px-3 py-2 text-left font-medium group-hover/row:bg-accent"
                      >
                        <Link href={componentTypeHref(t.slug)} className="hover:underline hover:underline-offset-4">
                          {t.name}
                        </Link>
                      </th>
                      {columns.map((c) => {
                        const impls = bySystem.get(c.slug);
                        if (!impls?.length) {
                          return (
                            <td key={c.slug} className="border-b border-border/60 px-3 py-2 align-top text-muted-foreground">
                              <span aria-hidden>–</span>
                              <span className="sr-only">Not found in ATLAS&apos;s index of {c.name}</span>
                            </td>
                          );
                        }
                        const share = bestShare(impls);
                        return (
                          <td
                            key={c.slug}
                            className="border-b border-border/60 px-3 py-2 align-top"
                            style={{ background: heat(share) }}
                            title={`${Math.round(share * 100)}% of fields documented (best implementation)`}
                          >
                            <ul className="space-y-0.5">
                              {impls.slice(0, 3).map((i) => (
                                <li key={i.slug} className="leading-snug">
                                  <Link
                                    href={componentHref(c.slug, i.slug)}
                                    className={cn(
                                      "font-medium text-foreground hover:underline hover:underline-offset-4",
                                      i.lifecycle === "deprecated" && "font-normal text-foreground/70 line-through",
                                    )}
                                  >
                                    {i.name}
                                  </Link>
                                  {i.lifecycle === "deprecated" && <span className="sr-only"> (deprecated)</span>}
                                </li>
                              ))}
                              {impls.length > 3 && (
                                <li>
                                  <Link href={componentTypeHref(t.slug)} className="text-xs text-foreground/75 hover:text-foreground">
                                    +{impls.length - 3} more
                                  </Link>
                                </li>
                              )}
                            </ul>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {missingTypes.length > 0 && (
        <p className="text-xs leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground/80">
            {missingTypes.length} {missingTypes.length === 1 ? "type has" : "types have"} no implementation in ATLAS&apos;s index of the
            systems shown:
          </span>{" "}
          {missingTypes.map((m, i) => (
            <Fragment key={m.slug}>
              {i > 0 && ", "}
              <Link href={componentTypeHref(m.slug)} className="link-underline">
                {m.name}
              </Link>
            </Fragment>
          ))}
        </p>
      )}
      {systems.size > columns.length && (
        <p className="text-xs text-muted-foreground">
          Showing {columns.length} of {systems.size} systems with indexed components. Select systems in the filters to choose columns.
        </p>
      )}
    </div>
  );
}
