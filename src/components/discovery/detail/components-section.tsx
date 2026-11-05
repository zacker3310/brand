import Link from "next/link";
import { CoverageChip, VerificationBadge } from "@/components/atlas";
import type { CoverageState } from "@/lib/contracts";
import { COMPONENT_GROUPS } from "@/lib/taxonomy";
import { cn } from "@/lib/utils";
import type { DetailComponent } from "@/server/queries/systems";
import { percent, plural } from "../lib/format";

function CountOrCoverage({ n, state, noun }: { n: number; state: CoverageState | undefined; noun: string }) {
  if (n > 0) {
    return (
      <span className="tabular text-xs">
        {n} <span className="text-muted-foreground">{n === 1 ? noun : `${noun}s`}</span>
      </span>
    );
  }
  // never render unknown as 0: no records + documented coverage is still shown as the coverage state
  return <CoverageChip state={state ?? "not-extracted"} />;
}

export function ClassificationBadge({ c }: { c: Pick<DetailComponent, "classificationState" | "classificationMethod" | "confidence"> }) {
  const state = c.classificationState === "verified" ? "verified" : "inferred";
  const how =
    state === "verified"
      ? `Declared by the official source${c.classificationMethod ? ` (${c.classificationMethod})` : ""}.`
      : `Matched by ATLAS taxonomy heuristics${c.classificationMethod ? ` (${c.classificationMethod})` : ""}, confidence ${percent(c.confidence)}. Not a claim made by the source.`;
  return <VerificationBadge state={state} compact detail={how} />;
}

/** Components grouped by ATLAS taxonomy group, each row with classification and coverage. */
export function ComponentsSection({ systemSlug, components }: { systemSlug: string; components: DetailComponent[] }) {
  const groups = [...COMPONENT_GROUPS.map((g) => ({ slug: g.slug as string | null, name: g.name })), { slug: null, name: "Unclassified" }]
    .map((g) => ({ ...g, rows: components.filter((c) => (c.group ?? null) === g.slug).sort((a, b) => a.typeSortOrder - b.typeSortOrder || a.name.localeCompare(b.name)) }))
    .filter((g) => g.rows.length);
  const classified = components.filter((c) => c.typeSlug);
  const verified = classified.filter((c) => c.classificationState === "verified").length;
  const withA11y = components.filter((c) => c.coverage.accessibility === "documented").length;
  const withProps = components.filter((c) => c.properties > 0).length;
  const withVariants = components.filter((c) => c.variants > 0).length;

  return (
    <div className="space-y-5">
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-4">
        {[
          { n: classified.length, of: components.length, label: "classified", hint: `${verified} source-declared · ${classified.length - verified} inferred` },
          { n: withVariants, of: components.length, label: "with variants" },
          { n: withProps, of: components.length, label: "with properties" },
          { n: withA11y, of: components.length, label: "with accessibility docs" },
        ].map((s) => (
          <div key={s.label} className="bg-card px-4 py-3">
            <dt className="text-[11px] text-muted-foreground">{s.label}</dt>
            <dd className="tabular mt-0.5 text-lg font-semibold tracking-tight">
              {s.n}
              <span className="text-sm font-normal text-muted-foreground"> / {s.of}</span>
            </dd>
            {s.hint && <dd className="text-[11px] text-subtle-foreground">{s.hint}</dd>}
          </div>
        ))}
      </dl>

      <div className="space-y-3">
        {groups.map((g) => (
          <details key={g.slug ?? "none"} open className="group/grp overflow-hidden rounded-xl border bg-card">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-2.5 select-none hover:bg-surface-1 [&::-webkit-details-marker]:hidden">
              <h3 className="text-[13px] font-semibold">
                {g.name}
                <span className="tabular ml-2 text-xs font-normal text-muted-foreground">{plural(g.rows.length, "component")}</span>
              </h3>
              {g.slug && (
                <span className="text-[11px] text-muted-foreground group-open/grp:hidden" aria-hidden>
                  Show
                </span>
              )}
            </summary>
            <div className="hidden border-t border-border/70 px-4 py-1.5 text-[10.5px] font-medium tracking-wide text-subtle-foreground uppercase md:grid md:grid-cols-[minmax(0,1.3fr)_minmax(0,1.2fr)_repeat(3,minmax(0,0.7fr))] md:gap-4">
              <span>Component</span>
              <span>Canonical type</span>
              <span>Variants</span>
              <span>Props</span>
              <span>Accessibility</span>
            </div>
            <ul className="divide-y divide-border/60 border-t border-border/70 md:border-t-0">
              {g.rows.map((c) => (
                <li
                  key={c.id}
                  className="grid gap-x-4 gap-y-1.5 px-4 py-2.5 text-sm md:grid-cols-[minmax(0,1.3fr)_minmax(0,1.2fr)_repeat(3,minmax(0,0.7fr))] md:items-center"
                >
                  <div className="min-w-0">
                    <Link href={`/systems/${systemSlug}/components/${c.slug}`} className="font-medium hover:underline">
                      {c.name}
                    </Link>
                    {c.lifecycle !== "stable" && c.lifecycle !== "unknown" && (
                      <span className={cn("ml-2 font-mono text-[10.5px]", c.lifecycle === "deprecated" ? "text-conflicting" : "text-muted-foreground")}>{c.lifecycle}</span>
                    )}
                  </div>
                  <div className="flex min-w-0 items-center gap-1.5">
                    {c.typeSlug ? (
                      <>
                        <Link href={`/components/${c.typeSlug}`} className="truncate text-[13px] text-muted-foreground hover:text-foreground hover:underline">
                          {c.typeName}
                        </Link>
                        <ClassificationBadge c={c} />
                      </>
                    ) : (
                      <span className="text-xs text-subtle-foreground">No taxonomy match</span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 md:contents">
                    <div>
                      <span className="mr-1.5 text-[11px] text-muted-foreground md:hidden">Variants</span>
                      <CountOrCoverage n={c.variants} state={c.coverage.variants} noun="variant" />
                    </div>
                    <div>
                      <span className="mr-1.5 text-[11px] text-muted-foreground md:hidden">Props</span>
                      <CountOrCoverage n={c.properties} state={c.coverage.properties} noun="prop" />
                    </div>
                    <div>
                      <span className="mr-1.5 text-[11px] text-muted-foreground md:hidden">A11y</span>
                      <CoverageChip state={c.coverage.accessibility ?? "not-extracted"} />
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </details>
        ))}
      </div>
    </div>
  );
}
