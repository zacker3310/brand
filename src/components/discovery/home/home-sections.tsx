import Form from "next/form";
import Link from "next/link";
import { ArrowRightIcon, ArrowUpRightIcon, SearchIcon } from "lucide-react";
import { CoverageChip, SystemMark, VerificationBadge } from "@/components/atlas";
import { SYSTEM_CATEGORY_LABELS, type SystemCategory } from "@/lib/contracts";
import { cn, formatCount, relativeTime } from "@/lib/utils";
import type { CuratedCollection, FeaturedRow, GroupStat, HomeStats, RecentSystem } from "@/server/queries/home";
import { COMPARISON_RULE, FEATURED_RULE, depthLabel, humanizeRegistrySummaries, summarizeActivity, type ComparisonSuggestion } from "../lib/home";
import { INFERRED_TEXT } from "../badges";
import { formatDate, plural } from "../lib/format";
import { PaletteHint } from "./palette-hint";

/* -------------------------------------------------------------------------- */
/* Shared                                                                      */
/* -------------------------------------------------------------------------- */

export function HomeSection({
  id,
  eyebrow,
  title,
  rule,
  action,
  children,
  className,
}: {
  id: string;
  eyebrow?: string;
  title: string;
  rule?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={cn("space-y-5", className)}>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2 border-b border-border/70 pb-3">
        <div className="space-y-1">
          {eyebrow && <p className="font-mono text-[11px] font-medium tracking-[0.12em] uppercase text-muted-foreground">{eyebrow}</p>}
          <h2 id={`${id}-title`} className="text-lg font-semibold tracking-tight">
            {title}
          </h2>
          {rule && <p className="max-w-2xl text-xs text-muted-foreground">{rule}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function SectionLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="group inline-flex items-center gap-1 text-[13px] text-muted-foreground transition-colors hover:text-foreground">
      {children}
      <ArrowRightIcon className="size-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
    </Link>
  );
}

/* -------------------------------------------------------------------------- */
/* Hero                                                                        */
/* -------------------------------------------------------------------------- */

const EXAMPLE_QUERIES = ["React combobox", "date picker", "dark theme color tokens", "government", "accessible tabs"];

export function Hero({ stats }: { stats: HomeStats }) {
  return (
    <div className="grid grid-cols-1 gap-10 pt-6 pb-2 sm:pt-12 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-end lg:gap-16">
      <div className="space-y-7">
        <p className="font-mono text-[11px] font-medium tracking-[0.12em] uppercase text-muted-foreground">
          Design system intelligence
          {stats.lastIngestedAt && <> · updated {formatDate(stats.lastIngestedAt)}</>}
        </p>
        <h1 className="type-display max-w-4xl text-[2.75rem] text-balance sm:text-6xl lg:text-7xl">The world&apos;s design systems, indexed with their sources.</h1>
        <p className="max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
          ATLAS catalogs <span className="tabular text-foreground">{stats.systemsVerified}</span> verified design systems, their components, tokens, patterns and
          accessibility guidance, and shows where every fact came from. What isn&apos;t known yet is labelled, never guessed.
        </p>
        <div className="max-w-2xl space-y-3">
          <Form action="/search" role="search" aria-label="Search ATLAS" className="flex gap-2">
            <label htmlFor="home-q" className="sr-only">
              Search systems, components, tokens and patterns
            </label>
            <div className="relative min-w-0 flex-1">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <input
                id="home-q"
                name="q"
                type="search"
                required
                maxLength={200}
                autoComplete="off"
                placeholder="Search “React combobox”, “Carbon tokens”, “government”…"
                className="h-11 w-full rounded-lg border border-input bg-card pr-3 pl-10 text-[15px] shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40"
              />
            </div>
            <button
              type="submit"
              className="h-11 shrink-0 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow-xs transition-colors hover:bg-primary/90 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              Search
            </button>
          </Form>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <PaletteHint />
          </div>
          <ul className="flex flex-wrap gap-1.5" aria-label="Example searches">
            {EXAMPLE_QUERIES.map((q) => (
              <li key={q}>
                <Link
                  href={`/search?q=${encodeURIComponent(q)}`}
                  className="inline-flex h-7 items-center rounded-md border border-border/80 bg-surface-1 px-2.5 text-xs text-muted-foreground transition-colors hover:border-foreground/20 hover:text-foreground"
                >
                  {q}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <LibraryLedger stats={stats} />
    </div>
  );
}

/** The library at a glance: every number is a live aggregate of published records. */
function LibraryLedger({ stats }: { stats: HomeStats }) {
  const rows: { label: string; value: number; href?: string; hint?: string }[] = [
    { label: "Verified systems", value: stats.systemsVerified, href: "/systems", hint: depthLabel(stats.systemsIndexed, stats.systemsPartial, stats.systemsMetadataOnly) },
    { label: "Components", value: stats.components, href: "/components", hint: `${stats.componentTypesCovered} of ${stats.componentTypes} canonical types covered` },
    { label: "Design tokens", value: stats.tokens, href: "/tokens", hint: plural(stats.tokenSets, "token set") },
    { label: "Patterns", value: stats.patterns, href: "/patterns" },
    { label: "Evidence records", value: stats.evidence, hint: `from ${plural(stats.documents, "fetched document")} and ${plural(stats.sources, "source")}` },
  ];
  return (
    <aside aria-labelledby="ledger-title" className="rounded-xl border bg-card">
      <div className="flex items-baseline justify-between border-b border-border/70 px-4 py-3">
        <h2 id="ledger-title" className="font-mono text-[11px] font-medium tracking-[0.12em] uppercase text-muted-foreground">
          The library
        </h2>
        <span className="text-[11px] text-muted-foreground">live counts</span>
      </div>
      <dl className="divide-y divide-border/60">
        {rows.map((r) => (
          <div key={r.label} className="flex items-baseline justify-between gap-4 px-4 py-2.5">
            <dt className="min-w-0">
              {r.href ? (
                <Link href={r.href} className="text-[13px] hover:underline">
                  {r.label}
                </Link>
              ) : (
                <span className="text-[13px]">{r.label}</span>
              )}
              {r.hint && <span className="block truncate text-[11px] text-muted-foreground">{r.hint}</span>}
            </dt>
            <dd className="tabular shrink-0 text-xl font-semibold tracking-tight">{formatCount(r.value)}</dd>
          </div>
        ))}
      </dl>
    </aside>
  );
}

/* -------------------------------------------------------------------------- */
/* Featured                                                                    */
/* -------------------------------------------------------------------------- */

export function FeaturedSystems({ rows }: { rows: FeaturedRow[] }) {
  return (
    <HomeSection id="featured" eyebrow="Featured" title="Most deeply indexed" rule={FEATURED_RULE} action={<SectionLink href="/systems?depth=indexed">All indexed systems</SectionLink>}>
      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
          No system has been deeply indexed yet. Every system in the directory has verified registry facts; component and token extraction runs per adapter.
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {rows.map((r, i) => (
            <li key={r.slug}>
              <article className="group relative flex h-full flex-col rounded-xl border bg-card p-4 transition-colors hover:border-foreground/20">
                <div className="flex items-start gap-3">
                  <SystemMark name={r.name} slug={r.slug} />
                  <div className="min-w-0 flex-1">
                    <h3 className="text-[15px] leading-tight font-semibold tracking-tight">
                      <Link href={`/systems/${r.slug}`} className="after:absolute after:inset-0 after:rounded-xl">
                        {r.name}
                      </Link>
                    </h3>
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {r.organization ?? "—"} · {SYSTEM_CATEGORY_LABELS[r.category as SystemCategory] ?? r.category}
                    </p>
                  </div>
                  <span className="tabular font-mono text-[11px] text-muted-foreground" aria-label={`Rank ${i + 1}`}>
                    {String(i + 1).padStart(2, "0")}
                  </span>
                </div>
                <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-border/70 pt-3">
                  {[
                    { k: "Components", v: r.components },
                    { k: "Tokens", v: r.tokens },
                    { k: "Patterns", v: r.patterns },
                  ].map((x) => (
                    <div key={x.k}>
                      <dt className="text-[11px] text-muted-foreground">{x.k}</dt>
                      <dd className="tabular text-base font-semibold tracking-tight">
                        {x.v > 0 ? formatCount(x.v) : <span className="font-normal text-muted-foreground" title="None indexed (not extracted by this adapter)">—</span>}
                      </dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-auto pt-3 text-[11px] text-muted-foreground">
                  {r.frameworks.length ? r.frameworks.slice(0, 3).join(" · ") : "Frameworks not verified"}
                  {r.lastIngestedAt && <> · ingested {relativeTime(r.lastIngestedAt)}</>}
                </p>
              </article>
            </li>
          ))}
        </ul>
      )}
    </HomeSection>
  );
}

/* -------------------------------------------------------------------------- */
/* Component groups                                                            */
/* -------------------------------------------------------------------------- */

export function ComponentGroups({ groups, indexedSystems }: { groups: GroupStat[]; indexedSystems: number }) {
  const maxImpl = Math.max(1, ...groups.map((g) => g.implementations));
  return (
    <HomeSection
      id="categories"
      eyebrow="Universal catalog"
      title="Component categories"
      rule={`ATLAS taxonomy groups with their canonical component types and the implementations indexed across ${plural(indexedSystems, "deeply indexed system")}.`}
      action={<SectionLink href="/components">Browse the catalog</SectionLink>}
    >
      <ul className="grid grid-cols-1 gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-2 lg:grid-cols-5">
        {groups.map((g) => (
          <li key={g.slug} className="bg-card">
            <Link href={`/components?group=${g.slug}`} className="group flex h-full flex-col gap-2 p-4 transition-colors hover:bg-surface-1">
              <span className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-semibold group-hover:underline">{g.name}</span>
                <span className="tabular text-[11px] text-muted-foreground">{plural(g.types, "type")}</span>
              </span>
              {g.description && <span className="line-clamp-2 text-xs leading-snug text-muted-foreground">{g.description}</span>}
              <span className="mt-auto block pt-2">
                <span className="block h-1 overflow-hidden rounded-full bg-muted" aria-hidden>
                  <span className={cn("block h-full rounded-full bg-primary/60", g.implementations === 0 && "hidden")} style={{ width: `${(g.implementations / maxImpl) * 100}%` }} />
                </span>
                <span className="mt-1.5 block text-[11px] text-muted-foreground">
                  {g.implementations > 0 ? (
                    <>
                      <span className="tabular text-foreground">{formatCount(g.implementations)}</span> implementations · {g.typesImplemented}/{g.types} types ·{" "}
                      {plural(g.systems, "system")}
                    </>
                  ) : (
                    "No implementations indexed yet"
                  )}
                </span>
                {g.topTypes.length > 0 && <span className="mt-1 block truncate text-[11px] text-muted-foreground">{g.topTypes.map((t) => t.name).join(", ")}</span>}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </HomeSection>
  );
}

/* -------------------------------------------------------------------------- */
/* Suggested comparisons                                                       */
/* -------------------------------------------------------------------------- */

export function SuggestedComparisons({ items }: { items: ComparisonSuggestion[] }) {
  const allInferred = items.length > 0 && items.every((c) => c.allInferred);
  return (
    <HomeSection
      id="comparisons"
      eyebrow="Compare"
      title="Suggested comparisons"
      rule={
        <>
          {COMPARISON_RULE}
          {allInferred && (
            <span className="mt-1 flex items-center gap-1.5">
              <VerificationBadge state="inferred" compact className={INFERRED_TEXT} detail="Every implementation linked here was matched to its canonical type by ATLAS heuristics, not declared by the source." />
              Type matches are inferred by ATLAS; compare the originals before relying on them.
            </span>
          )}
        </>
      }
      action={<SectionLink href="/compare">Build a comparison</SectionLink>}
    >
      {items.length === 0 ? (
        <p className="rounded-xl border border-dashed p-5 text-sm text-muted-foreground">
          Suggestions appear once at least three indexed systems implement the same component type.
        </p>
      ) : (
        <ul className="divide-y divide-border/70 rounded-xl border bg-card">
          {items.map((c) => (
            <li key={c.typeSlug}>
              <Link href={c.href} className="group flex items-center gap-4 px-4 py-3 transition-colors hover:bg-surface-1">
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="text-sm font-medium group-hover:underline">{c.typeName}</span>
                    {c.allInferred && !allInferred && (
                      <span className={`rounded border border-inferred/30 bg-inferred-soft px-1 text-[10px] font-medium ${INFERRED_TEXT}`}>inferred matches</span>
                    )}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                    {c.systems.map((s) => s.name).join(" vs ")}
                    {c.systemCount > c.systems.length && ` · +${c.systemCount - c.systems.length} more`}
                  </span>
                </span>
                <span className="flex shrink-0 -space-x-1.5" aria-hidden>
                  {c.systems.map((s) => (
                    <SystemMark key={s.slug} name={s.name} slug={s.slug} size="sm" className="ring-2 ring-card" />
                  ))}
                </span>
                <ArrowRightIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </HomeSection>
  );
}

/* -------------------------------------------------------------------------- */
/* Recently updated                                                            */
/* -------------------------------------------------------------------------- */

export function RecentlyUpdated({ rows }: { rows: RecentSystem[] }) {
  return (
    <HomeSection
      id="recent"
      eyebrow="Activity"
      title="Recently updated"
      rule="Latest ingestion runs, plus the most recent registry re-verifications, from the change log."
      action={<SectionLink href="/systems?sort=recent">By verification date</SectionLink>}
    >
      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed p-5 text-sm text-muted-foreground">No ingestion or verification activity recorded yet.</p>
      ) : (
        <ol className="relative space-y-4 border-l border-border/80 pl-5">
          {rows.map((r) => {
            const phrases = r.kind === "ingest" ? summarizeActivity(r.counts) : humanizeRegistrySummaries(r.registrySummaries);
            return (
              <li key={r.slug} className="relative">
                <span className={cn("absolute top-1.5 -left-[24.5px] size-2 rounded-full ring-2 ring-background", r.kind === "ingest" ? "bg-primary" : "bg-muted-foreground/60")} aria-hidden />
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <Link href={`/systems/${r.slug}#changes`} className="text-sm font-medium hover:underline">
                    {r.name}
                  </Link>
                  <span className="text-[11px] text-muted-foreground">{r.kind === "ingest" ? "Ingested" : "Registry re-verified"}</span>
                  <time dateTime={r.lastActivityAt} className="ml-auto font-mono text-[10.5px] text-muted-foreground" title={formatDate(r.lastActivityAt) ?? undefined}>
                    {relativeTime(r.lastActivityAt)}
                  </time>
                </div>
                {phrases.length > 0 && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{phrases.join(" · ")}</p>}
              </li>
            );
          })}
        </ol>
      )}
    </HomeSection>
  );
}

/* -------------------------------------------------------------------------- */
/* Curated collections (omitted entirely when none exist)                      */
/* -------------------------------------------------------------------------- */

export function CuratedCollections({ items }: { items: CuratedCollection[] }) {
  if (!items.length) return null;
  return (
    <HomeSection id="collections" eyebrow="Editorial" title="Curated collections" rule="Hand-picked sets maintained by ATLAS editors." action={<SectionLink href="/collections">All collections</SectionLink>}>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((c) => (
          <li key={`${c.ownerId}:${c.slug}`}>
            <Link href={`/collections/${c.slug}`} className="group flex h-full flex-col rounded-xl border bg-card p-4 transition-colors hover:border-foreground/20">
              <span className="text-sm font-semibold group-hover:underline">{c.name}</span>
              {c.description && <span className="mt-1 line-clamp-2 text-xs leading-snug text-muted-foreground">{c.description}</span>}
              <span className="mt-auto flex items-center justify-between gap-2 pt-3">
                <span className="flex -space-x-1.5" aria-hidden>
                  {c.systems.map((s) => (
                    <SystemMark key={s.slug} name={s.name} slug={s.slug} size="sm" className="ring-2 ring-card" />
                  ))}
                </span>
                <span className="tabular text-[11px] text-muted-foreground">{plural(c.items, "item")}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </HomeSection>
  );
}

/* -------------------------------------------------------------------------- */
/* Coverage honesty                                                            */
/* -------------------------------------------------------------------------- */

export function HonestyStrip({ stats }: { stats: HomeStats }) {
  const inferredClassifications = stats.componentsClassified - stats.componentsClassifiedVerified;
  const pctNotExtracted = stats.fieldsTotal ? Math.round((stats.fieldsNotExtracted / stats.fieldsTotal) * 100) : 0;
  const cols = [
    {
      badge: <VerificationBadge state="verified" />,
      title: "Verified",
      body: "Checked against an official source. Each claim stores the URL, retrieval time, content hash and extraction method.",
      fact: `${formatCount(stats.evidenceVerified)} of ${formatCount(stats.evidence)} evidence records are verified`,
    },
    {
      badge: <VerificationBadge state="inferred" className={INFERRED_TEXT} />,
      title: "Inferred",
      body: "Derived by ATLAS, such as mapping a system's “Snackbar” to the canonical Toast type. Always labelled, never presented as the source's claim.",
      fact: `${formatCount(inferredClassifications)} of ${formatCount(stats.componentsClassified)} component classifications are inferred`,
    },
    {
      badge: <CoverageChip state="not-documented" />,
      title: "Not documented",
      body: "ATLAS checked the official docs and they don't cover it. Missing documentation is not evidence the capability is missing.",
      fact: `${formatCount(stats.fieldsNotDocumented)} of ${formatCount(stats.fieldsTotal)} component fields checked and found undocumented`,
    },
    {
      badge: <CoverageChip state="not-extracted" />,
      title: "Not extracted",
      body: "ATLAS hasn't parsed it yet, so it's unknown, not empty. Metadata-only systems are entirely in this state beyond their registry facts.",
      fact: `${pctNotExtracted}% of component fields · ${plural(stats.systemsMetadataOnly, "system")} metadata-only`,
    },
  ];
  return (
    <section aria-labelledby="honesty-title" className="rounded-2xl border bg-surface-1 p-5 sm:p-7">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <p className="font-mono text-[11px] font-medium tracking-[0.12em] uppercase text-muted-foreground">Coverage honesty</p>
          <h2 id="honesty-title" className="text-lg font-semibold tracking-tight">
            Unknown is never shown as none
          </h2>
        </div>
        <Link href="/about" className="group inline-flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground">
          How ATLAS verifies data <ArrowUpRightIcon className="size-3.5" aria-hidden />
        </Link>
      </div>
      <ul className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4 lg:gap-8">
        {cols.map((c) => (
          <li key={c.title} className="space-y-2">
            <div>{c.badge}</div>
            <p className="text-[13px] leading-relaxed text-muted-foreground">{c.body}</p>
            <p className="tabular border-t border-border/70 pt-2 text-xs text-foreground/85">{c.fact}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
