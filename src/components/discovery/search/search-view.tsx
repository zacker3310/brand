import Link from "next/link";
import { BoxIcon, CheckIcon, ChevronLeftIcon, ChevronRightIcon, CompassIcon, LayersIcon, LibraryIcon, PaletteIcon, PuzzleIcon, ShapesIcon } from "lucide-react";
import { SystemMark } from "@/components/atlas";
import type { SearchEntityType, SearchHit, SearchResult } from "@/lib/contracts";
import { COMPONENT_GROUPS, FRAMEWORKS, PATTERN_TYPES, componentTypeBySlug } from "@/lib/taxonomy";
import { SYSTEM_CATEGORY_LABELS, type SystemCategory } from "@/lib/contracts";
import { cn, formatCount } from "@/lib/utils";
import { INFERRED_TEXT } from "../badges";
import { toggle } from "../lib/params";
import {
  ENTITY_LABELS,
  INTERPRETATION_LABELS,
  SEARCH_PAGE_SIZE,
  groupHits,
  hasFilters,
  pageCount,
  pageWindow,
  sanitizeHighlight,
  searchHref,
  type SearchPageState,
} from "../lib/search";

const ENTITY_ICON: Record<SearchEntityType, typeof BoxIcon> = {
  system: LibraryIcon,
  component: BoxIcon,
  "component-type": ShapesIcon,
  pattern: PuzzleIcon,
  "pattern-type": PuzzleIcon,
  token: PaletteIcon,
  framework: LayersIcon,
  category: CompassIcon,
};

const frameworkName = new Map(FRAMEWORKS.map((f) => [f.slug, f.name]));
const groupName = new Map(COMPONENT_GROUPS.map((g) => [g.slug, g.name]));
const patternTypeName = new Map(PATTERN_TYPES.map((p) => [p.slug, p.name]));

export function categoryLabel(v: string): string {
  return groupName.get(v) ?? SYSTEM_CATEGORY_LABELS[v as SystemCategory] ?? v;
}

/* -------------------------------------------------------------------------- */
/* Interpretation                                                              */
/* -------------------------------------------------------------------------- */

export function Interpretation({ result, systemNames }: { result: SearchResult; systemNames: Record<string, string> }) {
  const entries = Object.entries(result.interpretedFilters).filter(([k, v]) => k !== "relaxed" && v.length);
  const relaxed = result.interpretedFilters.relaxed ?? [];
  if (!entries.length && !result.expansions.length && !relaxed.length) return null;
  const valueLabel = (k: string, v: string) =>
    k === "frameworks"
      ? (frameworkName.get(v) ?? v)
      : k === "systems"
        ? (systemNames[v] ?? v)
        : k === "categories"
          ? categoryLabel(v)
          : k === "componentTypes" || k === "relatedComponentTypes"
            ? (componentTypeBySlug.get(v)?.name ?? v)
            : k === "patternTypes"
              ? (patternTypeName.get(v) ?? v)
              : k === "types" || k === "entityTypes"
                ? (ENTITY_LABELS[v as SearchEntityType]?.many ?? v)
                : v.replace(/-/g, " ");
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs" aria-label="How the query was interpreted">
      {entries.length > 0 && (
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="text-muted-foreground">Interpreted:</span>
          {entries.map(([k, vs]) => (
            <span key={k} className="inline-flex items-center gap-1 rounded-md border border-info/25 bg-info-soft px-1.5 py-0.5 text-info">
              <span className="opacity-75">{INTERPRETATION_LABELS[k] ?? k}</span>
              <span className="font-medium">{vs.map((v) => valueLabel(k, v)).join(", ")}</span>
            </span>
          ))}
        </span>
      )}
      {result.expansions.length > 0 && (
        <span className="text-muted-foreground">
          Also searching: <span className="text-foreground/85">{result.expansions.slice(0, 6).join(", ")}</span>
        </span>
      )}
      {relaxed.length > 0 && (
        <span className={INFERRED_TEXT}>
          No exact match, so the search was relaxed ({relaxed.map((r) => (r === "filters" ? "interpreted filters became preferences" : r === "fuzzy" ? "typo-tolerant matching" : "any word may match")).join(", ")}).
        </span>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Facets                                                                      */
/* -------------------------------------------------------------------------- */

type FacetParam = "types" | "systems" | "frameworks" | "categories";

function FacetList({
  title,
  param,
  options,
  state,
  label,
  max = 8,
}: {
  title: string;
  param: FacetParam;
  options: { value: string; count: number }[];
  state: SearchPageState;
  label: (v: string) => string;
  max?: number;
}) {
  const selected = state[param] as string[];
  const merged = [...options];
  for (const s of selected) if (!merged.some((o) => o.value === s)) merged.push({ value: s, count: 0 });
  if (!merged.length) return null;
  const head = merged.slice(0, max);
  const tail = merged.slice(max);
  const item = (o: { value: string; count: number }) => {
    const on = selected.includes(o.value);
    const href = searchHref(state, { [param]: toggle(selected, o.value), page: 1 } as Partial<SearchPageState>);
    return (
      <li key={o.value}>
        <Link
          href={href}
          scroll={false}
          aria-current={on ? "true" : undefined}
          className={cn(
            "flex items-center gap-2 rounded-md px-1.5 py-1 text-[13px] transition-colors hover:bg-accent/60",
            on && "bg-accent text-accent-foreground",
          )}
        >
          <span className={cn("grid size-3.5 shrink-0 place-items-center rounded-[4px] border", on ? "border-primary bg-primary text-primary-foreground" : "border-input")} aria-hidden>
            {on && <CheckIcon className="size-2.5" strokeWidth={3} />}
          </span>
          <span className="min-w-0 flex-1 truncate">{label(o.value)}</span>
          <span className="tabular text-[11px] text-muted-foreground">{formatCount(o.count)}</span>
          <span className="sr-only">{on ? "(selected, activate to remove)" : "(activate to filter)"}</span>
        </Link>
      </li>
    );
  };
  return (
    <div className="space-y-1.5">
      <h3 className="text-xs font-medium">{title}</h3>
      <ul className="space-y-px">{head.map(item)}</ul>
      {tail.length > 0 && (
        <details className="group/more" open={tail.some((o) => selected.includes(o.value)) || undefined}>
          <summary className="cursor-pointer list-none rounded px-1.5 py-1 text-xs text-muted-foreground select-none hover:text-foreground [&::-webkit-details-marker]:hidden">
            <span className="group-open/more:hidden">Show {tail.length} more</span>
            <span className="hidden group-open/more:inline">Show fewer</span>
          </summary>
          <ul className="space-y-px">{tail.map(item)}</ul>
        </details>
      )}
    </div>
  );
}

export function SearchFacets({ result, state, systemNames }: { result: SearchResult; state: SearchPageState; systemNames: Record<string, string> }) {
  const f = result.facets;
  return (
    <div className="space-y-6">
      <FacetList title="Result type" param="types" options={f.entityType ?? []} state={state} label={(v) => ENTITY_LABELS[v as SearchEntityType]?.many ?? v} />
      <FacetList title="Design system" param="systems" options={f.system ?? []} state={state} label={(v) => systemNames[v] ?? v} max={6} />
      <FacetList title="Framework" param="frameworks" options={f.framework ?? []} state={state} label={(v) => frameworkName.get(v) ?? v} max={6} />
      <FacetList title="Group or category" param="categories" options={[...(f.group ?? []), ...(f.category ?? [])]} state={state} label={categoryLabel} max={6} />
      {hasFilters(state) && (
        <Link href={searchHref(state, { types: [], systems: [], frameworks: [], categories: [], page: 1 })} scroll={false} className="block px-1.5 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
          Clear all filters
        </Link>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Hits                                                                        */
/* -------------------------------------------------------------------------- */

function HitRow({ hit, systemNames, showType }: { hit: SearchHit; systemNames: Record<string, string>; showType: boolean }) {
  const Icon = ENTITY_ICON[hit.entityType] ?? BoxIcon;
  const sysName = hit.systemSlug ? (systemNames[hit.systemSlug] ?? hit.systemSlug) : null;
  return (
    <li>
      <Link
        href={hit.url}
        data-result-link
        className="group grid grid-cols-[2rem_minmax(0,1fr)] gap-3 rounded-lg px-3 py-3 transition-colors outline-none hover:bg-surface-1 focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="pt-0.5">
          {hit.entityType === "system" && hit.systemSlug ? (
            <SystemMark name={hit.title} slug={hit.systemSlug} size="sm" />
          ) : (
            <span className="grid size-7 place-items-center rounded-lg border bg-surface-1 text-muted-foreground">
              <Icon className="size-3.5" aria-hidden />
            </span>
          )}
        </span>
        <span className="min-w-0 space-y-0.5">
          <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className={cn("text-[15px] font-medium group-hover:underline", hit.entityType === "token" && "font-mono text-[13px]")}>{hit.title}</span>
            {showType && !hit.subtitle?.startsWith(ENTITY_LABELS[hit.entityType]?.one ?? "\u0000") && (
              <span className="text-[11px] text-muted-foreground">{ENTITY_LABELS[hit.entityType]?.one ?? hit.entityType}</span>
            )}
          </span>
          {hit.subtitle && <span className="block truncate text-xs text-muted-foreground">{hit.subtitle}</span>}
          {hit.highlight && (
            <span
              className="line-clamp-2 block text-[13px] leading-relaxed text-foreground/80 [&_mark]:rounded-sm [&_mark]:bg-inferred-soft [&_mark]:px-0.5 [&_mark]:text-foreground"
              dangerouslySetInnerHTML={{ __html: sanitizeHighlight(hit.highlight) }}
            />
          )}
          <span className="block truncate font-mono text-[10.5px] text-muted-foreground">
            {sysName && hit.entityType !== "system" ? `${sysName} · ` : ""}
            {hit.url}
          </span>
        </span>
      </Link>
    </li>
  );
}

export function SearchHits({ result, state, systemNames }: { result: SearchResult; state: SearchPageState; systemNames: Record<string, string> }) {
  if (state.view === "grouped") {
    return (
      <div className="space-y-6">
        {groupHits(result.hits).map((g) => {
          const total = result.facets.entityType?.find((e) => e.value === g.type)?.count;
          return (
            <section key={g.type} aria-labelledby={`grp-${g.type}`}>
              <div className="flex items-baseline justify-between gap-2 border-b border-border/70 px-3 pb-1.5">
                <h2 id={`grp-${g.type}`} className="text-xs font-medium text-muted-foreground">
                  {ENTITY_LABELS[g.type].many}
                  {total !== undefined && <span className="tabular"> · {formatCount(total)}</span>}
                </h2>
                {total !== undefined && total > g.hits.length && !state.types.includes(g.type) && (
                  <Link href={searchHref(state, { types: [g.type], page: 1 })} className="text-xs text-muted-foreground hover:text-foreground hover:underline">
                    Only {ENTITY_LABELS[g.type].many.toLowerCase()}
                  </Link>
                )}
              </div>
              <ul className="mt-1 space-y-px">
                {g.hits.map((h) => (
                  <HitRow key={`${h.entityType}:${h.entityId}`} hit={h} systemNames={systemNames} showType={false} />
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    );
  }
  return (
    <ul className="space-y-px">
      {result.hits.map((h) => (
        <HitRow key={`${h.entityType}:${h.entityId}`} hit={h} systemNames={systemNames} showType />
      ))}
    </ul>
  );
}

/* -------------------------------------------------------------------------- */
/* Pagination                                                                  */
/* -------------------------------------------------------------------------- */

export function SearchPagination({ total, state }: { total: number; state: SearchPageState }) {
  const pages = pageCount(total);
  if (pages <= 1) return null;
  const cur = Math.min(state.page, pages);
  const btn = "inline-flex h-8 min-w-8 items-center justify-center gap-1 rounded-md border px-2 text-[13px] transition-colors";
  return (
    <nav aria-label="Search result pages" className="flex flex-wrap items-center justify-between gap-3 border-t border-border/70 pt-4">
      <p className="tabular text-xs text-muted-foreground">
        {formatCount((cur - 1) * SEARCH_PAGE_SIZE + 1)}–{formatCount(Math.min(cur * SEARCH_PAGE_SIZE, total))} of {formatCount(total)}
      </p>
      <ul className="flex flex-wrap items-center gap-1">
        <li>
          {cur > 1 ? (
            <Link href={searchHref(state, { page: cur - 1 })} className={cn(btn, "bg-card hover:bg-accent")} rel="prev">
              <ChevronLeftIcon className="size-3.5" aria-hidden /> Previous
            </Link>
          ) : (
            <span className={cn(btn, "text-muted-foreground opacity-50")} aria-disabled="true">
              <ChevronLeftIcon className="size-3.5" aria-hidden /> Previous
            </span>
          )}
        </li>
        {pageWindow(cur, pages).map((p, i) =>
          p === "gap" ? (
            <li key={`gap-${i}`} className="px-1 text-xs text-muted-foreground" aria-hidden>
              …
            </li>
          ) : (
            <li key={p} className="hidden sm:block">
              <Link
                href={searchHref(state, { page: p })}
                aria-current={p === cur ? "page" : undefined}
                aria-label={`Page ${p}`}
                className={cn(btn, "tabular", p === cur ? "border-primary/40 bg-accent font-medium text-accent-foreground" : "bg-card hover:bg-accent")}
              >
                {p}
              </Link>
            </li>
          ),
        )}
        <li>
          {cur < pages ? (
            <Link href={searchHref(state, { page: cur + 1 })} className={cn(btn, "bg-card hover:bg-accent")} rel="next">
              Next <ChevronRightIcon className="size-3.5" aria-hidden />
            </Link>
          ) : (
            <span className={cn(btn, "text-muted-foreground opacity-50")} aria-disabled="true">
              Next <ChevronRightIcon className="size-3.5" aria-hidden />
            </span>
          )}
        </li>
      </ul>
    </nav>
  );
}
