import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRightIcon, ShapesIcon } from "lucide-react";
import { EmptyState, PageContainer, PageHeader, Section, SourceLink, Stat, SystemMark } from "@/components/atlas";
import { excerpt, patternHref, patternTypeHref } from "@/components/patterns/lib";
import { formatCount } from "@/lib/utils";
import { getPatternTotals, listPatternTypes, listUnclassifiedPatterns } from "@/server/queries/patterns";

export const metadata: Metadata = {
  title: "Pattern library",
  description: "UX patterns documented by real design systems, mapped onto ATLAS pattern types, with links to each system's official guidance.",
};

export default async function PatternsPage() {
  const [types, unclassified, totals] = await Promise.all([listPatternTypes(), listUnclassifiedPatterns(), getPatternTotals()]);
  const documented = types.filter((t) => t.patternCount > 0).sort((a, b) => b.systems.length - a.systems.length || b.patternCount - a.patternCount);
  const empty = types.filter((t) => t.patternCount === 0);
  return (
    <PageContainer>
      <PageHeader
        eyebrow={<span className="text-muted-foreground">Pattern library</span>}
        title="Patterns"
        display
        description={
          <>
            Product and UX patterns as each design system documents them, grouped under ATLAS pattern types. A type is an ATLAS definition; each system&apos;s own
            guidance stays one click away. Patterns that do not fit a type are listed as unclassified rather than forced into one.
          </>
        }
      />
      <div className="mt-8 grid grid-cols-2 gap-6 sm:grid-cols-4">
        <Stat value={totals.patterns} label="Documented patterns" />
        <Stat value={totals.systems} label="Systems with patterns" />
        <Stat value={`${formatCount(totals.typesCovered)} / ${formatCount(totals.types)}`} label="Pattern types covered" />
        <Stat value={totals.patterns - totals.classified} label="Unclassified (no type match)" />
      </div>

      {totals.patterns === 0 ? (
        <EmptyState
          className="mt-10"
          icon={ShapesIcon}
          title="No patterns indexed yet"
          description="Patterns appear once an adapter has extracted a system's pattern documentation. Nothing is shown in their place."
        />
      ) : (
        <div className="mt-12 space-y-14">
          <Section
            id="types"
            title="Pattern types documented by indexed systems"
            description={`${formatCount(documented.length)} of ${formatCount(types.length)} ATLAS pattern types have at least one system's documentation mapped to them.`}
          >
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {documented.map((t) => (
                <li key={t.slug}>
                  <Link
                    href={patternTypeHref(t.slug)}
                    className="group flex h-full flex-col gap-3 rounded-xl border bg-card p-4 transition-colors hover:border-primary/30 hover:bg-accent/30"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="text-[15px] font-medium">{t.name}</h3>
                      <ArrowRightIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
                    </div>
                    <p className="text-sm leading-relaxed text-muted-foreground">{t.description}</p>
                    <div className="mt-auto flex items-center gap-2 border-t pt-3">
                      <span className="flex -space-x-1.5" aria-hidden>
                        {t.systems.slice(0, 4).map((s) => (
                          <SystemMark key={s.slug} name={s.name} slug={s.slug} size="sm" className="ring-2 ring-card" />
                        ))}
                      </span>
                      <span className="min-w-0 text-xs text-muted-foreground">
                        <span className="tabular font-medium text-foreground">{formatCount(t.systems.length)}</span> system{t.systems.length === 1 ? "" : "s"} ·{" "}
                        <span className="tabular">{formatCount(t.patternCount)}</span> pattern{t.patternCount === 1 ? "" : "s"}
                        <span className="block truncate">{t.systems.map((s) => s.name).join(", ")}</span>
                      </span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </Section>

          {empty.length > 0 && (
            <Section
              id="uncovered"
              title="Types with no indexed documentation yet"
              description="No pattern from an indexed system maps to these types so far. This reflects what ATLAS has ingested, not what the systems cover."
            >
              <ul className="flex flex-wrap gap-2">
                {empty.map((t) => (
                  <li key={t.slug}>
                    <Link href={patternTypeHref(t.slug)} className="inline-flex rounded-md border border-dashed px-2.5 py-1 text-sm text-muted-foreground hover:border-border hover:text-foreground" title={t.description}>
                      {t.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <Section
            id="unclassified"
            title="Unclassified system patterns"
            description={`${formatCount(unclassified.length)} documented patterns whose names match no ATLAS pattern type. Listed as the systems name them.`}
          >
            {unclassified.length === 0 ? (
              <p className="text-sm text-muted-foreground">Every indexed pattern maps to a type.</p>
            ) : (
              <div className="relative overflow-x-auto rounded-xl border">
                <table className="w-full min-w-[720px] border-collapse text-left text-sm [&_td]:px-3 [&_td]:py-2.5 [&_th]:px-3 [&_th]:py-2">
                  <caption className="sr-only">Unclassified patterns</caption>
                  <thead>
                    <tr className="border-b bg-surface-1 text-xs text-muted-foreground">
                      <th scope="col" className="font-medium">
                        Pattern
                      </th>
                      <th scope="col" className="font-medium">
                        System
                      </th>
                      <th scope="col" className="font-medium">
                        Summary
                      </th>
                      <th scope="col" className="text-right font-medium">
                        Components
                      </th>
                      <th scope="col" className="font-medium">
                        <span className="sr-only">Docs</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {unclassified.map((p) => (
                      <tr key={p.id} className="border-b border-border/60 align-top last:border-0">
                        <th scope="row" className="text-left font-normal">
                          <Link href={patternHref(p.system.slug, p.slug)} className="font-medium hover:underline">
                            {p.name}
                          </Link>
                        </th>
                        <td className="whitespace-nowrap">
                          <span className="inline-flex items-center gap-2">
                            <SystemMark name={p.system.name} slug={p.system.slug} size="sm" className="size-6 text-[9px]" />
                            {p.system.name}
                          </span>
                        </td>
                        <td className="max-w-md text-muted-foreground">{excerpt(p.description, 140) ?? "—"}</td>
                        <td className="tabular text-right">{formatCount(p.components.length)}</td>
                        <td className="whitespace-nowrap">{p.docsUrl && <SourceLink href={p.docsUrl} className="text-xs">Docs</SourceLink>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
        </div>
      )}
    </PageContainer>
  );
}
