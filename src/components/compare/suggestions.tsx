import { ArrowRightIcon, BookmarkIcon, SparklesIcon } from "lucide-react";
import Link from "next/link";
import { SystemMark } from "@/components/atlas/system-mark";
import { componentCompareHref, systemCompareHref } from "@/lib/scoring/params";
import type { SavedComparison, SuggestedComparison } from "@/server/queries/compare";

function MarkStack({ systems, names }: { systems: string[]; names: Map<string, string> }) {
  return (
    <span className="hidden -space-x-1 sm:flex" aria-hidden>
      {systems.slice(0, 5).map((s) => (
        <SystemMark key={s} name={names.get(s) ?? s} slug={s} size="sm" className="size-6 text-[9px] ring-2 ring-card" />
      ))}
    </span>
  );
}

export function SuggestedList({ items, names }: { items: SuggestedComparison[]; names: Map<string, string> }) {
  return (
    <ul className="divide-y rounded-lg border bg-card">
      {items.map((s) => (
        <li key={s.type}>
          <Link
            href={componentCompareHref({ type: s.type, systems: s.systems })}
            className="group flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-accent/50 focus-visible:bg-accent/60 focus-visible:outline-none"
          >
            <MarkStack systems={s.systems} names={names} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{s.typeName}</span>
              <span className="block truncate text-xs text-muted-foreground">{s.systems.map((x) => names.get(x) ?? x).join(" · ")}</span>
            </span>
            <span className="tabular shrink-0 text-right text-[11px] leading-tight text-muted-foreground">
              {s.systemCount} systems
              <span className="block text-muted-foreground">{s.componentCount} components</span>
            </span>
            <ArrowRightIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function SavedList({ items, names, featured }: { items: SavedComparison[]; names: Map<string, string>; featured?: boolean }) {
  return (
    <ul className="divide-y rounded-lg border bg-card">
      {items.map((c) => (
        <li key={c.slug}>
          <Link href={`/compare/s/${c.slug}`} className="group flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-accent/50 focus-visible:bg-accent/60 focus-visible:outline-none">
            {featured ? <SparklesIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden /> : <BookmarkIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{c.title}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {c.typeName ? `${c.typeName} · ` : "System comparison · "}
                {c.systemSlugs.map((s) => names.get(s) ?? s).join(", ")}
              </span>
            </span>
            <MarkStack systems={c.systemSlugs} names={names} />
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function SystemCompareTeaser({ indexed, names }: { indexed: string[]; names: Map<string, string> }) {
  return (
    <div className="space-y-3 rounded-lg border bg-card p-4">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold">Compare whole systems</h3>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Evidence-based rubrics for coverage, accessibility documentation, frameworks, tokens, theming and maintenance. Scores use only what ATLAS has
          observed; thin evidence shows as “Insufficient data”, never as a low score.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {indexed.length >= 2 && (
          <Link
            href={systemCompareHref({ systems: indexed })}
            className="inline-flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-accent"
          >
            <MarkStack systems={indexed} names={names} />
            Compare the {indexed.length} indexed systems
          </Link>
        )}
        <Link href="/compare/systems" className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground">
          Choose systems <ArrowRightIcon className="size-3.5" aria-hidden />
        </Link>
      </div>
    </div>
  );
}
