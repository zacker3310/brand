/**
 * URL search params are the source of truth for the component catalog: every filter, sort and
 * view is encoded here so pages are shareable and work without JavaScript (GET forms).
 * Pure functions only (unit-tested in tests/unit/catalog).
 */

export const CATALOG_VIEWS = ["types", "components"] as const;
export type CatalogView = (typeof CATALOG_VIEWS)[number];

export const TYPE_LAYOUTS = ["list", "matrix"] as const;
export type TypeLayout = (typeof TYPE_LAYOUTS)[number];

export const CLASSIFICATION_FACETS = ["verified", "inferred", "conflicting", "unverified", "unclassified"] as const;
export type ClassificationFacet = (typeof CLASSIFICATION_FACETS)[number];

export const HAS_FACETS = ["source", "props"] as const;
export type HasFacet = (typeof HAS_FACETS)[number];

export const COMPONENT_SORTS = ["relevance", "name", "system", "type", "coverage"] as const;
export type ComponentSort = (typeof COMPONENT_SORTS)[number];

export const PAGE_SIZE = 50;
const MAX_LIST = 24;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface CatalogParams {
  view: CatalogView;
  layout: TypeLayout;
  q: string;
  systems: string[];
  group: string | null;
  frameworks: string[];
  platforms: string[];
  patterns: string[];
  a11y: boolean;
  has: HasFacet[];
  classification: ClassificationFacet[];
  sort: ComponentSort;
  page: number;
}

export type RawSearchParams = Record<string, string | string[] | undefined>;

export const DEFAULT_PARAMS: CatalogParams = {
  view: "types",
  layout: "list",
  q: "",
  systems: [],
  group: null,
  frameworks: [],
  platforms: [],
  patterns: [],
  a11y: false,
  has: [],
  classification: [],
  sort: "relevance",
  page: 1,
};

function all(v: string | string[] | undefined): string[] {
  if (v === undefined) return [];
  const arr = Array.isArray(v) ? v : [v];
  // Accept both repeated params (?system=a&system=b) and comma lists (?system=a,b).
  return arr.flatMap((x) => x.split(",")).map((x) => x.trim()).filter(Boolean);
}

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function slugList(v: string | string[] | undefined): string[] {
  const out: string[] = [];
  for (const s of all(v)) {
    const n = s.toLowerCase();
    if (SLUG_RE.test(n) && n.length <= 80 && !out.includes(n)) out.push(n);
    if (out.length >= MAX_LIST) break;
  }
  return out;
}

function enumList<T extends string>(v: string | string[] | undefined, allowed: readonly T[]): T[] {
  const out: T[] = [];
  for (const s of all(v)) {
    const n = s.toLowerCase() as T;
    if (allowed.includes(n) && !out.includes(n)) out.push(n);
  }
  return out;
}

function enumOne<T extends string>(v: string | string[] | undefined, allowed: readonly T[], fallback: T): T {
  const s = first(v)?.toLowerCase() as T | undefined;
  return s && allowed.includes(s) ? s : fallback;
}

/** Normalizes a free-text query: trims, collapses whitespace, strips control chars, caps length. */
export function normalizeQuery(q: string | undefined): string {
  if (!q) return "";
  return q
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

export function parseCatalogParams(sp: RawSearchParams): CatalogParams {
  const pageRaw = Number.parseInt(first(sp.page) ?? "1", 10);
  const group = slugList(sp.group)[0] ?? null;
  const a11yRaw = first(sp.a11y)?.toLowerCase();
  return {
    view: enumOne(sp.view, CATALOG_VIEWS, DEFAULT_PARAMS.view),
    layout: enumOne(sp.layout, TYPE_LAYOUTS, DEFAULT_PARAMS.layout),
    q: normalizeQuery(first(sp.q)),
    systems: slugList(sp.system),
    group,
    frameworks: slugList(sp.framework),
    platforms: slugList(sp.platform),
    patterns: slugList(sp.pattern),
    a11y: a11yRaw === "documented" || a11yRaw === "1" || a11yRaw === "true",
    has: enumList(sp.has, HAS_FACETS),
    classification: enumList(sp.class, CLASSIFICATION_FACETS),
    sort: enumOne(sp.sort, COMPONENT_SORTS, DEFAULT_PARAMS.sort),
    page: Number.isFinite(pageRaw) && pageRaw >= 1 ? Math.min(pageRaw, 10_000) : 1,
  };
}

/** Filters that restrict which components count (everything except view/layout/sort/page). */
export function activeFilterCount(p: CatalogParams): number {
  return (
    (p.q ? 1 : 0) +
    p.systems.length +
    (p.group ? 1 : 0) +
    p.frameworks.length +
    p.platforms.length +
    p.patterns.length +
    (p.a11y ? 1 : 0) +
    p.has.length +
    p.classification.length
  );
}

/** True when a filter restricts implementations (not just which types are listed). */
export function hasComponentLevelFilters(p: CatalogParams): boolean {
  return p.systems.length + p.frameworks.length + p.platforms.length + p.has.length + p.classification.length > 0 || p.a11y;
}

/** Serializes params into a canonical, minimal query string (defaults omitted, stable order). */
export function toSearchParams(p: CatalogParams): URLSearchParams {
  const u = new URLSearchParams();
  if (p.view !== DEFAULT_PARAMS.view) u.set("view", p.view);
  if (p.view === "types" && p.layout !== DEFAULT_PARAMS.layout) u.set("layout", p.layout);
  if (p.q) u.set("q", p.q);
  for (const s of p.systems) u.append("system", s);
  if (p.group) u.set("group", p.group);
  for (const s of p.frameworks) u.append("framework", s);
  for (const s of p.platforms) u.append("platform", s);
  for (const s of p.patterns) u.append("pattern", s);
  if (p.a11y) u.set("a11y", "documented");
  for (const s of p.has) u.append("has", s);
  for (const s of p.classification) u.append("class", s);
  if (p.view === "components" && p.sort !== DEFAULT_PARAMS.sort) u.set("sort", p.sort);
  if (p.view === "components" && p.page > 1) u.set("page", String(p.page));
  return u;
}

export function catalogHref(p: CatalogParams, overrides: Partial<CatalogParams> = {}): string {
  const next: CatalogParams = { ...p, ...overrides };
  // Any change other than an explicit page change resets pagination.
  if (!("page" in overrides)) next.page = 1;
  const qs = toSearchParams(next).toString();
  return qs ? `/components?${qs}` : "/components";
}

export type FilterKey = "q" | "system" | "group" | "framework" | "platform" | "pattern" | "a11y" | "has" | "class";

/** Href that removes one filter value (or the whole filter when value is omitted). */
export function withoutFilter(p: CatalogParams, key: FilterKey, value?: string): string {
  const drop = (arr: string[]) => (value === undefined ? [] : arr.filter((x) => x !== value));
  switch (key) {
    case "q":
      return catalogHref(p, { q: "" });
    case "system":
      return catalogHref(p, { systems: drop(p.systems) });
    case "group":
      return catalogHref(p, { group: null });
    case "framework":
      return catalogHref(p, { frameworks: drop(p.frameworks) });
    case "platform":
      return catalogHref(p, { platforms: drop(p.platforms) });
    case "pattern":
      return catalogHref(p, { patterns: drop(p.patterns) });
    case "a11y":
      return catalogHref(p, { a11y: false });
    case "has":
      return catalogHref(p, { has: drop(p.has) as HasFacet[] });
    case "class":
      return catalogHref(p, { classification: drop(p.classification) as ClassificationFacet[] });
  }
}

export function clearFiltersHref(p: CatalogParams): string {
  return catalogHref({ ...DEFAULT_PARAMS, view: p.view, layout: p.layout, sort: p.sort });
}

/** Escapes LIKE/ILIKE wildcards so user input is matched literally. */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}

export function pageWindow(page: number, totalPages: number, span = 1): (number | "gap")[] {
  if (totalPages <= 1) return [1];
  const pages = new Set<number>([1, totalPages]);
  for (let i = page - span; i <= page + span; i++) if (i >= 1 && i <= totalPages) pages.add(i);
  const sorted = [...pages].sort((a, b) => a - b);
  const out: (number | "gap")[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const cur = sorted[i]!;
    if (i > 0 && cur - sorted[i - 1]! > 1) out.push("gap");
    out.push(cur);
  }
  return out;
}
