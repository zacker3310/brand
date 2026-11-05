import Link from "next/link";
import { Fragment } from "react";
import type { CatalogTypesResult, SystemLabel } from "@/server/queries/components";
import { cn } from "@/lib/utils";
import { componentHref, componentTypeHref } from "./lib/urls";

const MAX_NAMES = 9;

function SystemDots({ present, scope }: { present: Set<string>; scope: SystemLabel[] }) {
  if (scope.length > 12) return null;
  return (
    <span aria-hidden className="flex gap-1">
      {scope.map((s) => (
        <span
          key={s.slug}
          title={`${s.name}: ${present.has(s.slug) ? "implementation found" : "not found in ATLAS's index"}`}
          className={cn("size-1.5 rounded-full", present.has(s.slug) ? "bg-primary" : "border border-hairline bg-transparent")}
        />
      ))}
    </span>
  );
}

export function TypeGroups({
  result,
  systems,
  scope,
  filtered = false,
}: {
  result: CatalogTypesResult;
  systems: Map<string, SystemLabel>;
  /** Systems in scope (selected, or all with indexed components): the denominator for "n of m systems". */
  scope: SystemLabel[];
  filtered?: boolean;
}) {
  return (
    <div className="space-y-10">
      {result.groups.map((g) => (
        <section key={g.slug} aria-labelledby={`group-${g.slug}`} className="space-y-1">
          <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-border/80 pb-2">
            <h2 id={`group-${g.slug}`} className="text-[15px] font-semibold tracking-tight">
              {g.name}
            </h2>
            <p className="text-xs text-muted-foreground">
              <span className="tabular">{g.types.length}</span> with implementations
              {g.empty.length > 0 && (
                <>
                  {" · "}
                  <span className="tabular">{g.empty.length}</span> not found
                </>
              )}
            </p>
          </header>
          {g.types.length > 0 && (
            <ul className="divide-y divide-border/60">
              {g.types.map((t) => {
                const present = new Set(t.systems.map((s) => s.systemSlug));
                const flat = t.systems.flatMap((s) => s.implementations.map((i) => ({ ...i, systemSlug: s.systemSlug, systemName: s.systemName })));
                const shown = flat.slice(0, MAX_NAMES);
                const more = flat.length - shown.length;
                return (
                  <li
                    key={t.slug}
                    className="grid gap-x-8 gap-y-2 py-3.5 md:grid-cols-[minmax(0,15rem)_minmax(0,1fr)_7.5rem] md:items-start"
                  >
                    <div className="min-w-0 space-y-0.5">
                      <Link href={componentTypeHref(t.slug)} className="text-sm font-medium hover:underline hover:underline-offset-4">
                        {t.name}
                      </Link>
                      <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">{t.description}</p>
                    </div>
                    <p className="min-w-0 text-[13px] leading-6 text-pretty">
                      <span className="sr-only">Implementations: </span>
                      {shown.map((i, idx) => (
                        <Fragment key={`${i.systemSlug}/${i.slug}`}>
                          {idx > 0 && (
                            <span aria-hidden className="text-subtle-foreground">{"  ·  "}</span>
                          )}
                          <span className="inline-block max-w-full break-words">
                            <Link
                              href={componentHref(i.systemSlug, i.slug)}
                              className={cn("text-foreground/90 hover:text-foreground underline decoration-foreground/25 underline-offset-4 hover:decoration-foreground", i.lifecycle === "deprecated" && "text-muted-foreground line-through")}
                            >
                              {i.name}
                            </Link>{" "}
                            <span className="text-muted-foreground">({systems.get(i.systemSlug)?.shortName ?? i.systemName})</span>
                            {i.lifecycle === "deprecated" && <span className="sr-only"> (deprecated)</span>}
                          </span>
                        </Fragment>
                      ))}
                      {more > 0 && (
                        <>
                          <span aria-hidden className="text-subtle-foreground">{"  ·  "}</span>
                          <Link href={componentTypeHref(t.slug)} className="whitespace-nowrap text-muted-foreground hover:text-foreground underline decoration-foreground/25 underline-offset-4 hover:decoration-foreground">
                            +{more} more
                          </Link>
                        </>
                      )}
                    </p>
                    <div className="flex items-center gap-2.5 md:flex-col md:items-end md:gap-1.5">
                      <span className="tabular text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">{present.size}</span> of {scope.length} systems
                      </span>
                      <SystemDots present={present} scope={scope} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {g.empty.length > 0 && (
            <p className="pt-2.5 text-xs leading-relaxed text-muted-foreground">
              <span className="font-medium text-foreground/80">Not found in ATLAS&apos;s index</span>
              {filtered && <span className="text-muted-foreground"> under the current filters</span>}:{" "}
              {g.empty.map((e, i) => (
                <Fragment key={e.slug}>
                  {i > 0 && ", "}
                  <Link href={componentTypeHref(e.slug)} className="link-underline">
                    {e.name}
                  </Link>
                </Fragment>
              ))}
            </p>
          )}
        </section>
      ))}
      {result.unclassified.length > 0 && (
        <section aria-labelledby="group-unclassified" className="space-y-2">
          <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-dashed border-border pb-2">
            <h2 id="group-unclassified" className="text-[15px] font-semibold tracking-tight">
              Unclassified
            </h2>
            <p className="text-xs text-muted-foreground">
              <span className="tabular">{result.unclassified.length}</span> components ATLAS could not map to a canonical type
            </p>
          </header>
          <p className="text-[13px] leading-6 text-pretty">
            {result.unclassified.map((u, i) => (
              <Fragment key={`${u.systemSlug}/${u.slug}`}>
                {i > 0 && (
                  <span aria-hidden className="text-subtle-foreground">{"  ·  "}</span>
                )}
                <span className="inline-block max-w-full break-words">
                  <Link href={componentHref(u.systemSlug, u.slug)} className="underline decoration-foreground/25 underline-offset-4 hover:decoration-foreground">
                    {u.name}
                  </Link>{" "}
                  <span className="text-muted-foreground">({systems.get(u.systemSlug)?.shortName ?? u.systemName})</span>
                </span>
              </Fragment>
            ))}
          </p>
        </section>
      )}
    </div>
  );
}
