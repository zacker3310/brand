import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { AlertTriangleIcon, ListIcon, RowsIcon, SearchIcon, SearchXIcon } from "lucide-react";
import { EmptyState, PageContainer } from "@/components/atlas";
import { SegmentedLinks } from "@/components/discovery/segmented-links";
import { Interpretation, SearchFacets, SearchHits, SearchPagination } from "@/components/discovery/search/search-view";
import { ResultKeys } from "@/components/discovery/search/result-keys";
import { ENTITY_LABELS, hasFilters, parseSearchPage, searchHref, type SearchPageState } from "@/components/discovery/lib/search";
import type { RawSearchParams } from "@/components/discovery/lib/params";
import type { SearchEntityType, SearchResult } from "@/lib/contracts";
import { formatCount } from "@/lib/utils";
import { search } from "@/server/search";
import { getSystemNames } from "@/server/queries/systems";
import { connection } from "next/server";

type Props = { searchParams: Promise<RawSearchParams> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const parsed = parseSearchPage(await searchParams);
  const q = parsed.state.q;
  return { title: q ? `“${q}” · Search` : "Search", robots: { index: false } };
}

const SUGGESTIONS = ["React combobox", "date picker", "snackbar", "dark theme color tokens", "government", "accessible tabs", "Carbon button", "empty states"];

function SearchBox({ state }: { state: SearchPageState }) {
  return (
    <Form action="/search" role="search" aria-label="Search ATLAS" className="flex gap-2">
      <label htmlFor="search-q" className="sr-only">
        Search systems, components, tokens and patterns
      </label>
      <div className="relative min-w-0 flex-1">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <input
          id="search-q"
          name="q"
          type="search"
          defaultValue={state.q}
          maxLength={200}
          autoComplete="off"
          spellCheck={false}
          autoFocus={!state.q}
          placeholder="Search systems, components, tokens, patterns…"
          aria-describedby="search-keys-hint"
          className="h-10 w-full rounded-lg border border-input bg-card pr-3 pl-9 text-[15px] shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40"
        />
      </div>
      {state.view !== "ranked" && <input type="hidden" name="view" value={state.view} />}
      <button type="submit" className="h-10 shrink-0 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow-xs hover:bg-primary/90 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none">
        Search
      </button>
    </Form>
  );
}

function Suggestions({ title = "Try" }: { title?: string }) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-1.5">
      <span className="text-xs text-muted-foreground">{title}</span>
      {SUGGESTIONS.map((q) => (
        <Link key={q} href={`/search?q=${encodeURIComponent(q)}`} className="inline-flex h-7 items-center rounded-md border bg-surface-1 px-2.5 text-xs text-muted-foreground hover:text-foreground">
          {q}
        </Link>
      ))}
    </div>
  );
}

export default async function SearchPage({ searchParams }: Props) {
  await connection();
  const parsed = parseSearchPage(await searchParams);
  const { state } = parsed;

  if (!parsed.ok) {
    return (
      <PageContainer className="space-y-6">
        <h1 className="text-2xl font-semibold tracking-tight">Search</h1>
        <SearchBox state={state} />
        <EmptyState
          icon={AlertTriangleIcon}
          title="This search link has invalid parameters"
          description={
            <ul className="space-y-0.5 text-left font-mono text-xs">
              {parsed.issues.map((i) => (
                <li key={i.path + i.message}>
                  {i.path}: {i.message}
                </li>
              ))}
            </ul>
          }
          action={
            <Link href={state.q ? `/search?q=${encodeURIComponent(state.q)}` : "/search"} className="text-sm underline underline-offset-2">
              Search without filters
            </Link>
          }
        />
      </PageContainer>
    );
  }

  const browsing = !state.q && !hasFilters(state);
  let result: SearchResult | null = null;
  let failed = false;
  if (!browsing) {
    try {
      result = await search(parsed.query);
    } catch (e) {
      console.error("[search page] search failed", e);
      failed = true;
    }
  }
  const slugs = new Set<string>([...(result?.facets.system ?? []).map((f) => f.value), ...(result?.hits ?? []).map((h) => h.systemSlug ?? "").filter(Boolean), ...state.systems]);
  const systemNames = slugs.size ? await getSystemNames([...slugs]) : {};

  return (
    <PageContainer className="space-y-6">
      <header className="space-y-4 border-b border-border/70 pb-6">
        <p className="type-eyebrow">Search</p>
        <h1 className="text-2xl font-semibold tracking-tight break-words sm:text-3xl">
          {state.q ? (
            <>
              Results for <span className="text-foreground">“{state.q}”</span>
            </>
          ) : browsing ? (
            "Search the index"
          ) : (
            "Browse by filter"
          )}
        </h1>
        <SearchBox state={state} />
        <p id="search-keys-hint" className="text-xs text-muted-foreground">
          Understands frameworks, component synonyms and states (“React combobox”, “snackbar”, “disabled button”). Press ↓ to move into results.
        </p>
      </header>

      {browsing ? (
        <EmptyState
          icon={SearchIcon}
          title="Search systems, components, tokens and patterns"
          description="Queries are matched against names, aliases, descriptions and source terminology. Each result links to the record and its evidence."
          action={<Suggestions />}
        />
      ) : failed || !result ? (
        <EmptyState
          icon={AlertTriangleIcon}
          title="Search is unavailable right now"
          description="The search index could not be queried. Browsing still works."
          action={
            <Link href="/systems" className="text-sm underline underline-offset-2">
              Browse design systems
            </Link>
          }
        />
      ) : (
        <div className="grid gap-8 lg:grid-cols-[220px_minmax(0,1fr)]">
          <aside aria-label="Refine results" className="order-2 lg:order-1">
            <details className="group/f rounded-xl border bg-card p-3 lg:hidden" open={hasFilters(state) || undefined}>
              <summary className="cursor-pointer list-none text-[13px] font-medium select-none [&::-webkit-details-marker]:hidden">
                Refine results{hasFilters(state) ? " · filters active" : ""}
              </summary>
              <div className="mt-4">
                <SearchFacets result={result} state={state} systemNames={systemNames} />
              </div>
            </details>
            <div className="hidden lg:sticky lg:top-20 lg:block">
              <SearchFacets result={result} state={state} systemNames={systemNames} />
            </div>
          </aside>

          <section aria-labelledby="results-count" className="order-1 min-w-0 space-y-4 lg:order-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p id="results-count" className="text-sm text-muted-foreground" role="status" aria-live="polite">
                <span className="tabular font-medium text-foreground">{formatCount(result.total)}</span> {result.total === 1 ? "result" : "results"}
                {state.types.length > 0 && <> in {state.types.map((t) => ENTITY_LABELS[t as SearchEntityType]?.many.toLowerCase() ?? t).join(", ")}</>}
                <span className="text-subtle-foreground"> · {result.tookMs} ms</span>
              </p>
              {result.total > 0 && (
                <SegmentedLinks
                  label="Result layout"
                  items={[
                    { href: searchHref(state, { view: "ranked" }), label: "Ranked", icon: ListIcon, active: state.view === "ranked" },
                    { href: searchHref(state, { view: "grouped" }), label: "Grouped", icon: RowsIcon, active: state.view === "grouped" },
                  ]}
                />
              )}
            </div>
            <Interpretation result={result} systemNames={systemNames} />

            {result.total === 0 ? (
              <EmptyState
                icon={SearchXIcon}
                title={state.q ? `Nothing in the index matches “${state.q}”` : "No records match these filters"}
                description={
                  <>
                    ATLAS only returns records it has indexed. {hasFilters(state) ? "Removing a filter may help. " : ""}A component may exist in a system that is not deeply indexed yet;
                    its docs link is on the system page.
                  </>
                }
                action={
                  <div className="space-y-3">
                    {hasFilters(state) && (
                      <Link href={searchHref(state, { types: [], systems: [], frameworks: [], categories: [], page: 1 })} className="text-sm underline underline-offset-2">
                        Search “{state.q}” without filters
                      </Link>
                    )}
                    <Suggestions title="Or try" />
                  </div>
                }
              />
            ) : result.hits.length === 0 ? (
              <EmptyState
                icon={SearchXIcon}
                title="This page is past the last result"
                action={
                  <Link href={searchHref(state, { page: 1 })} className="text-sm underline underline-offset-2">
                    Back to the first page
                  </Link>
                }
              />
            ) : (
              <ResultKeys inputId="search-q" className="-mx-3">
                <SearchHits result={result} state={state} systemNames={systemNames} />
              </ResultKeys>
            )}
            <SearchPagination total={result.total} state={state} />
          </section>
        </div>
      )}
    </PageContainer>
  );
}
