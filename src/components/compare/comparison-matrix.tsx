import Link from "next/link";
import { CoverageChip } from "@/components/atlas/coverage-chip";
import { SystemMark } from "@/components/atlas/system-mark";
import { componentHref } from "@/lib/scoring/matrix";
import type { ComparisonColumn, ComponentMatrix, MatrixGroup, MatrixRow } from "@/lib/scoring/types";
import { cn } from "@/lib/utils";
import { CellView } from "./cell-view";
import { ComponentPickSelect } from "./component-pick-select";
import { PropsToggle } from "./matrix-controls";

/** Hidden when "show differences only" is on (data attribute on MatrixRoot). */
const DIFF_HIDE = "group-data-[diff=on]/matrix:hidden";
const OVERFLOW_HIDE = "group-data-[props=collapsed]/matrix:hidden";

const MISSING_TEXT = {
  "not-indexed": "Registry metadata only: components not indexed yet.",
  "no-component": "No indexed component classified as this type.",
} as const;

export interface MatrixLinks {
  type: string;
  systems: string[];
  picks: Record<string, string>;
  diffOnly: boolean;
  propsToggleHref: string;
}

function ColumnHeader({ col, links, typeName }: { col: ComparisonColumn; links: MatrixLinks; typeName: string }) {
  const c = col.component;
  return (
    <div className="flex min-w-0 items-start gap-2.5">
      <SystemMark name={col.system.name} slug={col.system.slug} size="sm" className="mt-0.5" />
      <div className="min-w-0 flex-1 space-y-1">
        <Link href={`/systems/${col.system.slug}`} className="block truncate text-xs font-normal text-muted-foreground hover:text-foreground">
          {col.system.name}
        </Link>
        {c ? (
          <Link href={componentHref(col.system.slug, c.slug)} className="block truncate text-[15px] leading-tight font-semibold tracking-tight hover:underline">
            {c.name}
          </Link>
        ) : (
          <p className="text-[13px] leading-tight font-medium text-muted-foreground">Not in ATLAS index</p>
        )}
        {col.candidates.length > 1 && c && (
          <div className="pt-0.5">
            <ComponentPickSelect
              system={col.system.slug}
              systemName={col.system.name}
              type={links.type}
              systems={links.systems}
              picks={links.picks}
              value={c.slug}
              options={col.candidates.map((x) => ({ slug: x.slug, name: x.name, lifecycle: x.lifecycle }))}
              diffOnly={links.diffOnly}
            />
            <p className="sr-only">
              {col.candidates.length} components classified as {typeName}
            </p>
          </div>
        )}
        {!c && col.missing && <p className="text-[11px] leading-snug font-normal text-muted-foreground">{MISSING_TEXT[col.missing]}</p>}
      </div>
    </div>
  );
}

function RowLabel({ row, sameLabel }: { row: MatrixRow; sameLabel: string }) {
  return (
    <div className="space-y-1">
      <div className={cn("text-[13px] leading-snug font-medium break-words", row.alignment && "font-mono text-xs")}>{row.label}</div>
      {row.alignment ? (
        <div className={cn("text-[11px] leading-snug", row.alignment.method === "normalized" ? "text-inferred" : "text-subtle-foreground")}>
          aligned by {row.alignment.method === "exact" ? "name" : "normalized name"} (inferred)
          {row.alignment.method === "normalized" && <span className="block font-mono text-subtle-foreground">{row.alignment.names.join(" · ")}</span>}
        </div>
      ) : row.hint ? (
        <div className="text-[11px] leading-snug text-subtle-foreground">{row.hint}</div>
      ) : null}
      {row.same && !row.span && <div className="text-[11px] text-subtle-foreground">{sameLabel}</div>}
    </div>
  );
}

function GroupHeading({ group, id }: { group: MatrixGroup; id: string }) {
  return (
    <div className="space-y-1">
      <h3 id={id} className="scroll-mt-48 text-sm font-semibold tracking-tight max-lg:scroll-mt-20">
        {group.title}
      </h3>
      {group.description && <p className="text-xs font-normal text-muted-foreground">{group.description}</p>}
      {group.note && (
        <p className="inline-flex max-w-3xl items-start gap-1.5 rounded-md border border-inferred/30 bg-inferred-soft px-2 py-1 text-xs font-normal text-inferred">{group.note}</p>
      )}
    </div>
  );
}

/** Desktop: one table with a sticky column header row. */
function DesktopMatrix({ matrix, columns, links, typeName }: { matrix: ComponentMatrix; columns: ComparisonColumn[]; links: MatrixLinks; typeName: string }) {
  const n = columns.length;
  return (
    <table className="hidden w-full table-fixed border-separate border-spacing-0 lg:table">
      <caption className="sr-only">
        {typeName} compared across {columns.map((c) => c.system.name).join(", ")}. Rows are attributes; columns are systems.
      </caption>
      <colgroup>
        <col className="w-44 xl:w-52" />
        {columns.map((c) => (
          <col key={c.system.slug} />
        ))}
      </colgroup>
      <thead>
        <tr>
          <th scope="col" className="sticky top-14 z-20 border-b bg-background px-3 py-3 text-left align-bottom">
            <span className="type-eyebrow">Attribute</span>
          </th>
          {columns.map((col) => (
            <th
              key={col.system.slug}
              scope="col"
              className="sticky top-14 z-20 border-b border-l border-l-border/60 bg-background px-3 py-3 text-left align-top"
            >
              <ColumnHeader col={col} links={links} typeName={typeName} />
            </th>
          ))}
        </tr>
      </thead>
      {matrix.groups.map((g) => (
        <tbody key={g.id} aria-labelledby={`g-${g.id}`}>
          <tr className={cn(g.allSame && DIFF_HIDE)}>
            <th scope="colgroup" colSpan={n + 1} className="px-3 pt-9 pb-3 text-left font-normal">
              <GroupHeading group={g} id={`g-${g.id}`} />
            </th>
          </tr>
          {g.rows.map((r) => (
            <tr key={r.id} className={cn("transition-colors hover:bg-surface-1/60", r.same && DIFF_HIDE, r.overflow && OVERFLOW_HIDE)}>
              <th scope="row" className="border-t px-3 py-3 text-left align-top font-normal">
                <RowLabel row={r} sameLabel={matrix.sameBasis === "indexed" ? "Same in all indexed columns" : "Same in all columns"} />
              </th>
              {r.span ? (
                <td colSpan={n} className="border-t border-l border-l-border/60 px-3 py-3 align-top">
                  <div className="rounded-md border border-dashed bg-surface-1/70 px-3 py-2">
                    <CellView value={r.span} />
                  </div>
                </td>
              ) : (
                columns.map((col) => (
                  <td key={col.system.slug} className="min-w-0 border-t border-l border-l-border/60 px-3 py-3 align-top">
                    {r.cells[col.system.slug] && <CellView value={r.cells[col.system.slug]!.value} />}
                  </td>
                ))
              )}
            </tr>
          ))}
          {g.overflowCount > 0 && (
            <tr>
              <td colSpan={n + 1} className="border-t px-1 py-2">
                <PropsToggle hiddenCount={g.overflowCount} hrefToggle={links.propsToggleHref} />
              </td>
            </tr>
          )}
        </tbody>
      ))}
    </table>
  );
}

/** Mobile: per row group, one card per system. Aligned prop rows only list the system's own props. */
function MobileMatrix({ matrix, columns, links, typeName }: { matrix: ComponentMatrix; columns: ComparisonColumn[]; links: MatrixLinks; typeName: string }) {
  return (
    <div className="space-y-10 lg:hidden">
      {matrix.groups.map((g) => {
        const spans = g.rows.filter((r) => r.span);
        const rows = g.rows.filter((r) => !r.span);
        return (
          <section key={g.id} aria-labelledby={`m-${g.id}`} className={cn("space-y-3", g.allSame && DIFF_HIDE)}>
            <GroupHeading group={g} id={`m-${g.id}`} />
            {spans.map((r) => (
              <div key={r.id} className="rounded-lg border border-dashed bg-surface-1/70 px-3 py-2.5">
                <p className="type-eyebrow mb-1">{r.label}</p>
                <CellView value={r.span!} />
              </div>
            ))}
            {rows.length > 0 &&
              columns.map((col) => {
                const own = rows.filter((r) => !r.alignment || r.cells[col.system.slug]?.value.kind !== "coverage");
                const absentAligned = rows.filter((r) => r.alignment && r.cells[col.system.slug]?.value.kind === "coverage");
                const absentState = absentAligned[0]?.cells[col.system.slug]?.value;
                return (
                  <article key={col.system.slug} className="overflow-hidden rounded-lg border bg-card">
                    <header className="flex items-center gap-2.5 border-b bg-surface-1/60 px-3 py-2">
                      <SystemMark name={col.system.name} slug={col.system.slug} size="sm" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs text-muted-foreground">{col.system.name}</p>
                        <p className="truncate text-sm font-semibold">{col.component?.name ?? "Not in ATLAS index"}</p>
                      </div>
                    </header>
                    <dl className="divide-y divide-border/70">
                      {own.map((r) => (
                        <div
                          key={r.id}
                          className={cn("grid grid-cols-[minmax(0,6.5rem)_minmax(0,1fr)] gap-3 px-3 py-2.5", r.same && DIFF_HIDE, r.overflow && OVERFLOW_HIDE)}
                        >
                          <dt className={cn("text-xs font-medium break-words text-muted-foreground", r.alignment && "font-mono text-[11px] text-foreground/80")}>{r.label}</dt>
                          <dd className="min-w-0">{r.cells[col.system.slug] && <CellView value={r.cells[col.system.slug]!.value} />}</dd>
                        </div>
                      ))}
                      {absentAligned.length > 0 && absentState?.kind === "coverage" && (
                        <div className="grid grid-cols-[minmax(0,6.5rem)_minmax(0,1fr)] gap-3 px-3 py-2.5">
                          <dt className="text-xs font-medium text-muted-foreground">Other systems&apos; props</dt>
                          <dd className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                            <CoverageChip state={absentState.state} />
                            <span>
                              {absentAligned.length} aligned prop{absentAligned.length === 1 ? "" : "s"} not in this API
                            </span>
                          </dd>
                        </div>
                      )}
                    </dl>
                  </article>
                );
              })}
            {g.overflowCount > 0 && <PropsToggle hiddenCount={g.overflowCount} hrefToggle={links.propsToggleHref} />}
          </section>
        );
      })}
      <p className="sr-only">{typeName} comparison ends.</p>
    </div>
  );
}

export function ComparisonMatrix(props: { matrix: ComponentMatrix; columns: ComparisonColumn[]; links: MatrixLinks; typeName: string }) {
  return (
    <>
      <DesktopMatrix {...props} />
      <MobileMatrix {...props} />
    </>
  );
}
