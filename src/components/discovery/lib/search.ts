/**
 * /search page state: URL <-> SearchQuery, pagination, grouping and highlight safety. Pure (unit-tested).
 * Parsing delegates to the search API's own validator so the page and /api/search agree exactly.
 */
import type { SearchEntityType, SearchHit, SearchQuery } from "@/lib/contracts";
import { parseSearchParams, type InputIssue } from "@/server/search/params";
import { buildHref, enumOne, positiveInt, toURLSearchParams, type RawSearchParams } from "./params";

export const SEARCH_PAGE_SIZE = 20;
export const SEARCH_MAX_PAGE = 50;

export const ENTITY_ORDER: SearchEntityType[] = ["system", "component-type", "component", "pattern-type", "pattern", "token", "framework", "category"];

export const ENTITY_LABELS: Record<SearchEntityType, { one: string; many: string }> = {
  system: { one: "Design system", many: "Design systems" },
  component: { one: "Component", many: "Components" },
  "component-type": { one: "Component type", many: "Component types" },
  pattern: { one: "Pattern", many: "Patterns" },
  "pattern-type": { one: "Pattern type", many: "Pattern types" },
  token: { one: "Token", many: "Tokens" },
  framework: { one: "Framework", many: "Frameworks" },
  category: { one: "Component group", many: "Component groups" },
};

export const SEARCH_VIEWS = ["ranked", "grouped"] as const;
export type SearchView = (typeof SEARCH_VIEWS)[number];

export interface SearchPageState {
  q: string;
  types: SearchEntityType[];
  systems: string[];
  frameworks: string[];
  /** Component group / system category slugs (search `categories` filter). */
  categories: string[];
  page: number;
  view: SearchView;
}

export type SearchPageParse =
  | { ok: true; state: SearchPageState; query: SearchQuery }
  | { ok: false; state: SearchPageState; issues: InputIssue[] };

export function parseSearchPage(sp: RawSearchParams): SearchPageParse {
  const page = Math.min(positiveInt(sp, "page", 1), SEARCH_MAX_PAGE);
  const view = enumOne(sp, "view", SEARCH_VIEWS, "ranked");
  const u = toURLSearchParams(sp);
  // the page owns pagination; anything the API accepts besides that is passed through
  u.delete("page");
  u.delete("view");
  u.delete("limit");
  u.delete("offset");
  u.set("limit", String(SEARCH_PAGE_SIZE));
  u.set("offset", String((page - 1) * SEARCH_PAGE_SIZE));
  const parsed = parseSearchParams(u);
  if (!parsed.ok) {
    return {
      ok: false,
      issues: parsed.issues,
      state: { q: (u.get("q") ?? "").trim().slice(0, 200), types: [], systems: [], frameworks: [], categories: [], page: 1, view },
    };
  }
  const v = parsed.value;
  return {
    ok: true,
    query: v,
    state: {
      q: v.q,
      types: v.types ?? [],
      systems: v.systems ?? [],
      frameworks: v.frameworks ?? [],
      categories: v.categories ?? [],
      page,
      view,
    },
  };
}

export function searchHref(s: SearchPageState, patch: Partial<SearchPageState> = {}): string {
  const n = { ...s, ...patch };
  return buildHref("/search", [
    ["q", n.q],
    ["types", n.types],
    ["systems", n.systems],
    ["frameworks", n.frameworks],
    ["categories", n.categories],
    ["view", n.view === "ranked" ? null : n.view],
    ["page", n.page > 1 ? n.page : null],
  ]);
}

export function hasFilters(s: SearchPageState): boolean {
  return s.types.length + s.systems.length + s.frameworks.length + s.categories.length > 0;
}

export function pageCount(total: number): number {
  return Math.max(1, Math.min(SEARCH_MAX_PAGE, Math.ceil(total / SEARCH_PAGE_SIZE)));
}

/** Compact page list with gaps: [1, "gap", 4, 5, 6, "gap", 12]. */
export function pageWindow(current: number, total: number): (number | "gap")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const set = new Set([1, total, current - 1, current, current + 1].filter((n) => n >= 1 && n <= total));
  const sorted = [...set].sort((a, b) => a - b);
  const out: (number | "gap")[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const n = sorted[i]!;
    if (i > 0 && n - sorted[i - 1]! > 1) out.push("gap");
    out.push(n);
  }
  return out;
}

/** Group hits by entity type, in ENTITY_ORDER, keeping rank order inside each group. */
export function groupHits(hits: SearchHit[]): { type: SearchEntityType; hits: SearchHit[] }[] {
  const m = new Map<SearchEntityType, SearchHit[]>();
  for (const h of hits) m.set(h.entityType, [...(m.get(h.entityType) ?? []), h]);
  return ENTITY_ORDER.filter((t) => m.has(t)).map((t) => ({ type: t, hits: m.get(t)! }));
}

/**
 * Defence in depth for hit.highlight. The provider already HTML-escapes the snippet and only
 * introduces <mark>; this re-escapes anything that is not exactly <mark> or </mark>.
 */
export function sanitizeHighlight(html: string): string {
  return html
    .split(/(<\/?mark>)/)
    .map((part) => (part === "<mark>" || part === "</mark>" ? part : part.replace(/</g, "&lt;").replace(/>/g, "&gt;")))
    .join("");
}

/** Human labels for interpretedFilters keys returned by the search engine. */
export const INTERPRETATION_LABELS: Record<string, string> = {
  frameworks: "framework",
  platforms: "platform",
  types: "type",
  entityTypes: "looking for",
  componentTypes: "component type",
  relatedComponentTypes: "related type",
  patternTypes: "pattern type",
  states: "state",
  tags: "tag",
  themes: "theme",
  systems: "system",
  categories: "category",
  accessibility: "accessibility",
  relaxed: "relaxed",
};
