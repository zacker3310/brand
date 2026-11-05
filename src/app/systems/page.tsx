import type { Metadata } from "next";
import Link from "next/link";
import { LayoutGridIcon, ListIcon, SearchIcon, SearchXIcon, SlidersHorizontalIcon, XIcon } from "lucide-react";
import { EmptyState, PageContainer, PageHeader } from "@/components/atlas";
import { AutoSubmitForm } from "@/components/discovery/auto-submit-form";
import { DirectoryFilters } from "@/components/discovery/directory-filters";
import {
  SORT_LABELS,
  activeFilterChips,
  activeFilterCount,
  applyDirectory,
  clearedFilters,
  depthOf,
  directoryHref,
  parseDirectoryParams,
  type DirectorySort,
} from "@/components/discovery/lib/directory";
import { depthLabel } from "@/components/discovery/lib/home";
import { formatDate } from "@/components/discovery/lib/format";
import type { RawSearchParams } from "@/components/discovery/lib/params";
import { RegistryDecisions } from "@/components/discovery/registry-decisions";
import { SegmentedLinks } from "@/components/discovery/segmented-links";
import { SystemCard } from "@/components/discovery/system-card";
import { SystemsTable } from "@/components/discovery/systems-table";
import { Button } from "@/components/ui/button";
import { getRegistryDecisions, listDirectoryRows } from "@/server/queries/systems";

export const metadata: Metadata = {
  title: "Design systems",
  description: "Every verified design system in ATLAS, filterable by framework, platform, license, maintenance and how deeply it is indexed.",
};

export default async function SystemsPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const params = parseDirectoryParams(await searchParams);
  const [rows, registry] = await Promise.all([listDirectoryRows(params.q), getRegistryDecisions()]);
  const result = applyDirectory(rows, params);

  const depthCounts = { indexed: 0, partial: 0, metadata: 0 };
  for (const r of rows) depthCounts[depthOf(r.ingestionStatus)]++;
  const max = {
    components: Math.max(0, ...rows.map((r) => r.counts.components)),
    tokens: Math.max(0, ...rows.map((r) => r.counts.tokens)),
    patterns: Math.max(0, ...rows.map((r) => r.counts.patterns)),
  };
  const lastVerified = rows.reduce<string | null>((m, r) => (r.lastVerifiedAt && (!m || r.lastVerifiedAt > m) ? r.lastVerifiedAt : m), null);
  const decisionsCount = registry.decisions.length;
  const isDecisions = params.registry === "all";
  const chips = activeFilterChips(params, result.facets);
  const filterCount = activeFilterCount(params);
  const sortOptions: DirectorySort[] = params.q ? ["relevance", "coverage", "name", "recent", "rank"] : ["coverage", "name", "recent", "rank"];
  const defaultSort: DirectorySort = params.q ? "relevance" : "coverage";

  return (
    <PageContainer className="space-y-6">
      <PageHeader
        eyebrow="Directory"
        title="Design systems"
        display
        description={
          <>
            <span className="tabular">{registry.summary.verified}</span> verified systems ·{" "}
            {depthLabel(depthCounts.indexed, depthCounts.partial, depthCounts.metadata)}. Every fact is checked against the official source it links to
            {lastVerified ? (
              <>
                {" "}
                · last verified <time dateTime={lastVerified}>{formatDate(lastVerified)}</time>
              </>
            ) : null}
            .
          </>
        }
        className="pb-6"
      />

      <SegmentedLinks
        label="Registry view"
        size="md"
        items={[
          { href: directoryHref({ ...params, registry: "verified" }), label: "Verified systems", count: registry.summary.verified, active: !isDecisions },
          { href: directoryHref(clearedFilters({ ...params, q: "", sort: null }), { registry: "all" }), label: "Registry decisions", count: decisionsCount, active: isDecisions },
        ]}
      />

      {isDecisions ? (
        <section aria-labelledby="decisions-title" className="space-y-4">
          <div className="max-w-3xl space-y-1">
            <h2 id="decisions-title" className="text-base font-semibold tracking-tight">
              How the registry reached {registry.summary.verified}
            </h2>
            <p className="text-sm text-muted-foreground">
              Candidates that were rejected (no public documentation, discontinued) or merged as duplicates stay on record with the reasoning and the system that took their
              place. Nothing is silently dropped.
            </p>
          </div>
          <RegistryDecisions decisions={registry.decisions} summary={registry.summary} />
        </section>
      ) : (
        <AutoSubmitForm action="/systems" aria-label="Filter design systems" className="space-y-5">
          {params.view !== "grid" && <input type="hidden" name="view" value={params.view} />}

          {/* toolbar */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div role="search" className="relative min-w-0 flex-1">
              <label htmlFor="directory-q" className="sr-only">
                Search systems by name, alias or organization
              </label>
              <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <input
                id="directory-q"
                type="search"
                name="q"
                defaultValue={params.q}
                placeholder="Search by name, alias or organization…"
                autoComplete="off"
                spellCheck={false}
                className="h-9 w-full rounded-lg border border-input bg-card pr-3 pl-9 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40"
              />
            </div>
            <div className="flex items-center gap-2">
              <label htmlFor="directory-sort" className="text-xs whitespace-nowrap text-muted-foreground">
                Sort
              </label>
              <select
                id="directory-sort"
                name="sort"
                defaultValue={result.sort}
                data-default={defaultSort}
                className="h-9 min-w-0 flex-1 rounded-lg border border-input bg-card px-2.5 text-[13px] shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40 sm:flex-none"
              >
                {sortOptions.map((s) => (
                  <option key={s} value={s}>
                    {SORT_LABELS[s]}
                  </option>
                ))}
              </select>
              <SegmentedLinks
                label="Layout"
                items={[
                  { href: directoryHref(params, { view: "grid" }), label: "Grid view", icon: LayoutGridIcon, iconOnly: true, active: params.view === "grid" },
                  { href: directoryHref(params, { view: "list" }), label: "List view", icon: ListIcon, iconOnly: true, active: params.view === "list" },
                ]}
              />
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-[232px_minmax(0,1fr)] lg:gap-8">
            {/* filters: visible on desktop; disclosed by a CSS-only toggle on small screens (works without JS) */}
            <div className="lg:sticky lg:top-20 lg:max-h-[calc(100dvh-6rem)] lg:self-start lg:overflow-y-auto lg:pr-1 lg:pb-6">
              <input type="checkbox" id="filters-toggle" className="peer sr-only" aria-label="Show filters" data-no-sync data-no-autosubmit />
              <label
                htmlFor="filters-toggle"
                className="flex h-9 cursor-pointer items-center justify-between rounded-lg border bg-card px-3 text-[13px] font-medium shadow-xs peer-focus-visible:ring-[3px] peer-focus-visible:ring-ring/40 lg:hidden"
              >
                <span className="inline-flex items-center gap-2">
                  <SlidersHorizontalIcon className="size-4 text-muted-foreground" aria-hidden /> Filters
                </span>
                {filterCount > 0 && <span className="tabular rounded bg-accent px-1.5 text-[11px] text-accent-foreground">{filterCount} active</span>}
              </label>
              <aside aria-label="Filters" className="mt-3 hidden rounded-xl border bg-card p-4 peer-checked:block lg:mt-0 lg:block lg:border-0 lg:bg-transparent lg:p-0">
                <DirectoryFilters facets={result.facets} />
              </aside>
            </div>

            <section aria-labelledby="results-heading" className="min-w-0 space-y-4 group-data-[pending]/form:opacity-60 motion-safe:transition-opacity">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 id="results-heading" className="text-sm text-muted-foreground" aria-live="polite">
                  <span className="tabular font-medium text-foreground">{result.total}</span>
                  {result.total === result.universe ? ` ${result.total === 1 ? "system" : "systems"}` : ` of ${result.universe} systems`}
                  {params.q && <> matching “{params.q}”</>}
                  <span className="text-subtle-foreground"> · sorted by {SORT_LABELS[result.sort].toLowerCase()}</span>
                </h2>
              </div>

              {chips.length > 0 && (
                <ul className="flex flex-wrap items-center gap-1.5" aria-label="Active filters">
                  {chips.map((c) => (
                    <li key={`${c.key}:${c.value}`}>
                      <Link
                        href={c.href}
                        scroll={false}
                        className="inline-flex h-7 items-center gap-1 rounded-md border bg-accent/60 pr-1.5 pl-2 text-xs text-accent-foreground transition-colors hover:bg-accent"
                      >
                        <span className="text-muted-foreground">{c.key === "q" ? "Search" : facetTitle(c.key)}:</span> {c.label}
                        <XIcon className="size-3" aria-hidden />
                        <span className="sr-only">(remove)</span>
                      </Link>
                    </li>
                  ))}
                  <li>
                    <Link href={directoryHref(clearedFilters({ ...params, q: "", sort: null }))} scroll={false} className="px-1.5 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
                      Clear all
                    </Link>
                  </li>
                </ul>
              )}

              {result.total === 0 ? (
                <EmptyState
                  icon={SearchXIcon}
                  title="No systems match these filters"
                  description={
                    <>
                      Nothing in the verified registry matches{params.q ? <> “{params.q}”</> : null}
                      {filterCount ? ` with ${filterCount} ${filterCount === 1 ? "filter" : "filters"}` : ""}. Facet counts on the left show what each option would return.
                    </>
                  }
                  action={
                    <div className="flex flex-wrap justify-center gap-2">
                      {filterCount > 0 && (
                        <Button asChild size="sm" variant="outline">
                          <Link href={directoryHref(clearedFilters(params))}>Keep the search, clear filters</Link>
                        </Button>
                      )}
                      {params.q && (
                        <Button asChild size="sm" variant="outline">
                          <Link href={`/search?q=${encodeURIComponent(params.q)}`}>Search components, tokens & patterns</Link>
                        </Button>
                      )}
                      <Button asChild size="sm" variant="ghost">
                        <Link href="/systems">Reset</Link>
                      </Button>
                    </div>
                  }
                />
              ) : params.view === "list" ? (
                <SystemsTable rows={result.rows} />
              ) : (
                <ul className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
                  {result.rows.map((r) => (
                    <li key={r.id}>
                      <SystemCard row={r} max={max} />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </AutoSubmitForm>
      )}
    </PageContainer>
  );
}

function facetTitle(key: string): string {
  const map: Record<string, string> = {
    category: "Category",
    depth: "Depth",
    framework: "Framework",
    platform: "Platform",
    licenseType: "License type",
    license: "License",
    maintenance: "Maintenance",
    access: "Docs",
    tag: "Tag",
  };
  return map[key] ?? key;
}
