/**
 * Design-system directory: URL params, filtering, disjunctive facet counts and sorting.
 *
 * Pure (unit-tested). The SQL read model (src/server/queries/systems.ts) loads every published,
 * verified system in ONE aggregated query (counts, framework/platform/tag arrays and a server-side
 * ILIKE + trigram text-match score). The registry is ~100 rows, so facets are computed here:
 * each facet's counts apply every other active filter but not its own (OR within a facet, AND
 * across facets), which is what makes counts trustworthy when several options are selected.
 */
import {
  DOC_ACCESS,
  MAINTENANCE_STATUSES,
  SYSTEM_CATEGORIES,
  SYSTEM_CATEGORY_LABELS,
  type DocAccess,
  type IngestionStatus,
  type MaintenanceStatus,
  type Redistribution,
  type SystemCategory,
  type VerificationState,
} from "@/lib/contracts";
import { buildHref, enumList, enumOne, slugList, text, type RawSearchParams } from "./params";

/* -------------------------------------------------------------------------- */
/* Row model                                                                   */
/* -------------------------------------------------------------------------- */

export interface DirectoryLicense {
  slug: string;
  name: string;
  spdxId: string | null;
  isOpenSource: boolean | null;
  redistribution: Redistribution;
}

export interface DirectoryFramework {
  slug: string;
  name: string;
  state: VerificationState;
  support: string;
  packageName: string | null;
}

export interface DirectoryRow {
  id: string;
  slug: string;
  name: string;
  aliases: string[];
  organization: { slug: string; name: string } | null;
  category: SystemCategory;
  summary: string | null;
  maintenance: MaintenanceStatus;
  docAccess: DocAccess;
  license: DirectoryLicense | null;
  frameworks: DirectoryFramework[];
  platforms: { slug: string; name: string }[];
  tags: { slug: string; name: string }[];
  ingestionStatus: IngestionStatus;
  confidence: number;
  lastVerifiedAt: string | null;
  lastIngestedAt: string | null;
  registryRank: number | null;
  latestVersion: string | null;
  homepageUrl: string | null;
  docsUrl: string | null;
  repositoryUrl: string | null;
  counts: { components: number; tokens: number; patterns: number };
  /** Server-side text-match score for `q` (0 = no match). Null when there is no query. */
  match: number | null;
}

/* -------------------------------------------------------------------------- */
/* Derived classifications                                                     */
/* -------------------------------------------------------------------------- */

export const LICENSE_KINDS = ["open-source", "proprietary", "unknown"] as const;
export type LicenseKind = (typeof LICENSE_KINDS)[number];
export const LICENSE_KIND_LABELS: Record<LicenseKind, string> = {
  "open-source": "Open source",
  proprietary: "Proprietary / commercial",
  unknown: "Unknown",
};

/** is_open_source true/false is a verified registry fact; null or missing license is "unknown". */
export function licenseKind(l: DirectoryLicense | null): LicenseKind {
  if (!l || l.isOpenSource === null) return "unknown";
  return l.isOpenSource ? "open-source" : "proprietary";
}

export const DEPTHS = ["indexed", "partial", "inventory", "metadata"] as const;
export type Depth = (typeof DEPTHS)[number];
export const DEPTH_LABELS: Record<Depth, string> = {
  indexed: "Deeply indexed",
  partial: "Partially indexed",
  inventory: "Component inventory",
  metadata: "Metadata only",
};
export const DEPTH_DESCRIPTIONS: Record<Depth, string> = {
  indexed: "A dedicated ATLAS adapter ingested official sources and published component, token or pattern records.",
  partial: "Some official documents were ingested; coverage is incomplete.",
  inventory:
    "The component list (names and official docs links) was read from the official docs. Variants, props, states, accessibility and tokens have not been extracted.",
  metadata: "Registry facts (links, license, frameworks, maintenance) are verified, but components, tokens and patterns have not been extracted yet.",
};

export function depthOf(status: IngestionStatus): Depth {
  if (status === "indexed") return "indexed";
  if (status === "partial") return "partial";
  if (status === "inventory") return "inventory";
  return "metadata";
}

export const MAINTENANCE_LABELS: Record<MaintenanceStatus, string> = {
  active: "Active",
  maintenance: "Maintenance mode",
  deprecated: "Deprecated",
  archived: "Archived",
  unknown: "Unknown",
};

export const DOC_ACCESS_LABELS: Record<DocAccess, string> = {
  public: "Public docs",
  partial: "Partially public",
  private: "Private",
  unknown: "Unknown",
};

export function coverageScore(c: DirectoryRow["counts"]): number {
  return c.components + c.tokens;
}

/* -------------------------------------------------------------------------- */
/* Params                                                                      */
/* -------------------------------------------------------------------------- */

export const SORTS = ["relevance", "coverage", "name", "recent", "rank"] as const;
export type DirectorySort = (typeof SORTS)[number];
export const SORT_LABELS: Record<DirectorySort, string> = {
  relevance: "Best match",
  coverage: "Coverage (components + tokens)",
  name: "Name (A–Z)",
  recent: "Recently verified",
  rank: "Registry rank",
};

export const VIEWS = ["grid", "list"] as const;
export type DirectoryView = (typeof VIEWS)[number];

export interface DirectoryParams {
  q: string;
  category: SystemCategory[];
  framework: string[];
  platform: string[];
  licenseType: LicenseKind[];
  license: string[];
  maintenance: MaintenanceStatus[];
  access: DocAccess[];
  depth: Depth[];
  tag: string[];
  /** Explicit sort; null means the default (relevance with a query, coverage otherwise). */
  sort: DirectorySort | null;
  view: DirectoryView;
  registry: "verified" | "all";
}

export const FACET_KEYS = ["category", "depth", "framework", "platform", "licenseType", "license", "maintenance", "access", "tag"] as const;
export type FacetKey = (typeof FACET_KEYS)[number];

export function parseDirectoryParams(sp: RawSearchParams): DirectoryParams {
  const sortRaw = enumOne(sp, "sort", [...SORTS, ""] as const, "");
  return {
    q: text(sp, "q", 120),
    category: enumList(sp, "category", SYSTEM_CATEGORIES),
    framework: slugList(sp, "framework"),
    platform: slugList(sp, "platform"),
    licenseType: enumList(sp, "licenseType", LICENSE_KINDS),
    license: slugList(sp, "license"),
    maintenance: enumList(sp, "maintenance", MAINTENANCE_STATUSES),
    access: enumList(sp, "access", DOC_ACCESS),
    depth: enumList(sp, "depth", DEPTHS),
    tag: slugList(sp, "tag"),
    sort: sortRaw === "" ? null : sortRaw,
    view: enumOne(sp, "view", VIEWS, "grid"),
    registry: enumOne(sp, "registry", ["verified", "all"] as const, "verified"),
  };
}

export function effectiveSort(p: Pick<DirectoryParams, "q" | "sort">): DirectorySort {
  if (p.sort === "relevance" && !p.q) return "coverage";
  return p.sort ?? (p.q ? "relevance" : "coverage");
}

export function activeFilterCount(p: DirectoryParams): number {
  return FACET_KEYS.reduce((n, k) => n + p[k].length, 0);
}

/** Canonical URL for a directory state; defaults are omitted so URLs stay short and shareable. */
export function directoryHref(p: DirectoryParams, patch: Partial<DirectoryParams> = {}): string {
  const s = { ...p, ...patch };
  return buildHref("/systems", [
    ["q", s.q],
    ["category", s.category],
    ["depth", s.depth],
    ["framework", s.framework],
    ["platform", s.platform],
    ["licenseType", s.licenseType],
    ["license", s.license],
    ["maintenance", s.maintenance],
    ["access", s.access],
    ["tag", s.tag],
    ["sort", s.sort],
    ["view", s.view === "grid" ? null : s.view],
    ["registry", s.registry === "verified" ? null : s.registry],
  ]);
}

export function clearedFilters(p: DirectoryParams): DirectoryParams {
  return { ...p, category: [], framework: [], platform: [], licenseType: [], license: [], maintenance: [], access: [], depth: [], tag: [] };
}

/* -------------------------------------------------------------------------- */
/* Filtering & facets                                                          */
/* -------------------------------------------------------------------------- */

/** The facet values a row carries, per facet key. */
export function rowFacetValues(r: DirectoryRow, key: FacetKey): string[] {
  switch (key) {
    case "category":
      return [r.category];
    case "depth":
      return [depthOf(r.ingestionStatus)];
    case "framework":
      return r.frameworks.map((f) => f.slug);
    case "platform":
      return r.platforms.map((p) => p.slug);
    case "licenseType":
      return [licenseKind(r.license)];
    case "license":
      return r.license ? [r.license.slug] : [];
    case "maintenance":
      return [r.maintenance];
    case "access":
      return [r.docAccess];
    case "tag":
      return r.tags.map((t) => t.slug);
  }
}

function matchesFacet(r: DirectoryRow, key: FacetKey, selected: readonly string[]): boolean {
  if (!selected.length) return true;
  const vals = rowFacetValues(r, key);
  return selected.some((s) => vals.includes(s));
}

function matchesText(r: DirectoryRow, q: string): boolean {
  return !q || (r.match ?? 0) > 0;
}

function matchesAllExcept(r: DirectoryRow, p: DirectoryParams, except: FacetKey | null): boolean {
  if (!matchesText(r, p.q)) return false;
  for (const k of FACET_KEYS) {
    if (k !== except && !matchesFacet(r, k, p[k])) return false;
  }
  return true;
}

export interface FacetOption {
  value: string;
  label: string;
  count: number;
  selected: boolean;
}

export interface DirectoryResult {
  rows: DirectoryRow[];
  total: number;
  /** Rows before any filter or query (the published verified registry). */
  universe: number;
  facets: Record<FacetKey, FacetOption[]>;
  sort: DirectorySort;
}

function labelFor(rows: DirectoryRow[], key: FacetKey, value: string): string {
  switch (key) {
    case "category":
      return SYSTEM_CATEGORY_LABELS[value as SystemCategory] ?? value;
    case "depth":
      return DEPTH_LABELS[value as Depth] ?? value;
    case "licenseType":
      return LICENSE_KIND_LABELS[value as LicenseKind] ?? value;
    case "maintenance":
      return MAINTENANCE_LABELS[value as MaintenanceStatus] ?? value;
    case "access":
      return DOC_ACCESS_LABELS[value as DocAccess] ?? value;
    case "framework":
      for (const r of rows) for (const f of r.frameworks) if (f.slug === value) return f.name;
      return value;
    case "platform":
      for (const r of rows) for (const pl of r.platforms) if (pl.slug === value) return pl.name;
      return value;
    case "tag":
      for (const r of rows) for (const t of r.tags) if (t.slug === value) return t.name;
      return value;
    case "license":
      for (const r of rows) if (r.license?.slug === value) return r.license.name;
      return value;
  }
}

/** Fixed vocabularies keep their canonical order; open vocabularies sort by count then label. */
const FIXED_ORDER: Partial<Record<FacetKey, readonly string[]>> = {
  category: SYSTEM_CATEGORIES,
  depth: DEPTHS,
  licenseType: LICENSE_KINDS,
  maintenance: MAINTENANCE_STATUSES,
  access: DOC_ACCESS,
};

export function computeFacets(all: DirectoryRow[], p: DirectoryParams): Record<FacetKey, FacetOption[]> {
  const out = {} as Record<FacetKey, FacetOption[]>;
  for (const key of FACET_KEYS) {
    const counts = new Map<string, number>();
    // every value present in the universe is listed (count may drop to 0 under other filters)
    for (const r of all) for (const v of rowFacetValues(r, key)) if (!counts.has(v)) counts.set(v, 0);
    for (const r of all) {
      if (!matchesAllExcept(r, p, key)) continue;
      for (const v of new Set(rowFacetValues(r, key))) counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    // keep a selected value visible even when the universe no longer contains it
    for (const s of p[key]) if (!counts.has(s)) counts.set(s, 0);
    const opts: FacetOption[] = [...counts.entries()].map(([value, count]) => ({
      value,
      count,
      label: labelFor(all, key, value),
      selected: (p[key] as readonly string[]).includes(value),
    }));
    const fixed = FIXED_ORDER[key];
    if (fixed) opts.sort((a, b) => fixed.indexOf(a.value) - fixed.indexOf(b.value));
    else opts.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
    out[key] = opts;
  }
  return out;
}

const byName = (a: DirectoryRow, b: DirectoryRow) => a.name.localeCompare(b.name, "en", { sensitivity: "base" });
const byRank = (a: DirectoryRow, b: DirectoryRow) => (a.registryRank ?? Number.MAX_SAFE_INTEGER) - (b.registryRank ?? Number.MAX_SAFE_INTEGER);
const time = (s: string | null) => (s ? new Date(s).getTime() : 0);

export function sortRows(rows: DirectoryRow[], sort: DirectorySort): DirectoryRow[] {
  const r = [...rows];
  switch (sort) {
    case "relevance":
      return r.sort((a, b) => (b.match ?? 0) - (a.match ?? 0) || coverageScore(b.counts) - coverageScore(a.counts) || byRank(a, b) || byName(a, b));
    case "coverage":
      return r.sort(
        (a, b) =>
          coverageScore(b.counts) - coverageScore(a.counts) || b.counts.patterns - a.counts.patterns || byRank(a, b) || byName(a, b),
      );
    case "name":
      return r.sort(byName);
    case "recent":
      return r.sort((a, b) => time(b.lastVerifiedAt) - time(a.lastVerifiedAt) || byName(a, b));
    case "rank":
      return r.sort((a, b) => byRank(a, b) || byName(a, b));
  }
}

export function applyDirectory(all: DirectoryRow[], p: DirectoryParams): DirectoryResult {
  const sort = effectiveSort(p);
  const rows = sortRows(
    all.filter((r) => matchesAllExcept(r, p, null)),
    sort,
  );
  return { rows, total: rows.length, universe: all.length, facets: computeFacets(all, p), sort };
}

/** Chips for the active-filter bar: each removes exactly one value. */
export function activeFilterChips(p: DirectoryParams, facets: Record<FacetKey, FacetOption[]>): { key: FacetKey | "q"; value: string; label: string; href: string }[] {
  const chips: { key: FacetKey | "q"; value: string; label: string; href: string }[] = [];
  if (p.q) chips.push({ key: "q", value: p.q, label: `“${p.q}”`, href: directoryHref(p, { q: "", sort: p.sort === "relevance" ? null : p.sort }) });
  for (const key of FACET_KEYS) {
    for (const v of p[key] as readonly string[]) {
      const label = facets[key].find((o) => o.value === v)?.label ?? v;
      chips.push({ key, value: v, label, href: directoryHref(p, { [key]: (p[key] as readonly string[]).filter((x) => x !== v) } as Partial<DirectoryParams>) });
    }
  }
  return chips;
}

export const FACET_TITLES: Record<FacetKey, string> = {
  category: "Category",
  depth: "Ingestion depth",
  framework: "Framework",
  platform: "Platform",
  licenseType: "License type",
  license: "License",
  maintenance: "Maintenance",
  access: "Documentation access",
  tag: "Tags",
};
