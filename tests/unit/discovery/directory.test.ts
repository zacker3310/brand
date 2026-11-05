import { describe, expect, it } from "vitest";
import {
  activeFilterChips,
  applyDirectory,
  computeFacets,
  depthOf,
  directoryHref,
  effectiveSort,
  licenseKind,
  parseDirectoryParams,
  type DirectoryRow,
} from "@/components/discovery/lib/directory";

function row(p: Partial<DirectoryRow> & { slug: string }): DirectoryRow {
  return {
    id: p.slug,
    name: p.slug,
    aliases: [],
    organization: null,
    category: "design-system",
    summary: null,
    maintenance: "active",
    docAccess: "public",
    license: null,
    frameworks: [],
    platforms: [],
    tags: [],
    ingestionStatus: "metadata_only",
    confidence: 0.9,
    lastVerifiedAt: null,
    lastIngestedAt: null,
    registryRank: null,
    latestVersion: null,
    homepageUrl: null,
    docsUrl: null,
    repositoryUrl: null,
    counts: { components: 0, tokens: 0, patterns: 0 },
    match: null,
    ...p,
  };
}

const fw = (slug: string) => ({ slug, name: slug[0]!.toUpperCase() + slug.slice(1), state: "verified" as const, support: "official", packageName: null });
const mit = { slug: "mit", name: "MIT License", spdxId: "MIT", isOpenSource: true, redistribution: "permitted" as const };
const prop = { slug: "proprietary-x", name: "Proprietary", spdxId: null, isOpenSource: false, redistribution: "restricted" as const };

const ROWS: DirectoryRow[] = [
  row({ slug: "alpha", name: "Alpha", frameworks: [fw("react")], license: mit, ingestionStatus: "indexed", counts: { components: 80, tokens: 2000, patterns: 10 }, registryRank: 3, lastVerifiedAt: "2026-11-01T00:00:00Z" }),
  row({ slug: "beta", name: "Beta", frameworks: [fw("react"), fw("vue")], license: prop, category: "component-library", registryRank: 1, lastVerifiedAt: "2026-11-04T00:00:00Z" }),
  row({ slug: "gamma", name: "Gamma", frameworks: [fw("vue")], license: null, maintenance: "archived", registryRank: 2, lastVerifiedAt: "2026-10-01T00:00:00Z" }),
  row({ slug: "delta", name: "Delta", frameworks: [], license: { ...mit, slug: "etalab", isOpenSource: null }, ingestionStatus: "partial", counts: { components: 5, tokens: 0, patterns: 0 } }),
];

describe("parseDirectoryParams", () => {
  it("accepts repeated and comma-separated values, lowercases and drops invalid slugs", () => {
    const p = parseDirectoryParams({ framework: ["React", "vue,svelte"], tag: "ok,NOT OK!,ok", category: "design-system,bogus" });
    expect(p.framework).toEqual(["react", "vue", "svelte"]);
    expect(p.tag).toEqual(["ok"]);
    expect(p.category).toEqual(["design-system"]);
  });
  it("validates enums and falls back to defaults", () => {
    const p = parseDirectoryParams({ sort: "nope", view: "list", registry: "all", depth: "indexed,metadata,deep", licenseType: "open-source" });
    expect(p.sort).toBeNull();
    expect(p.view).toBe("list");
    expect(p.registry).toBe("all");
    expect(p.depth).toEqual(["indexed", "metadata"]);
    expect(p.licenseType).toEqual(["open-source"]);
  });
  it("trims and bounds the query", () => {
    expect(parseDirectoryParams({ q: "  carbon   design " }).q).toBe("carbon design");
    expect(parseDirectoryParams({ q: "x".repeat(500) }).q).toHaveLength(120);
  });
});

describe("classification helpers", () => {
  it("never treats an unknown license as proprietary or open", () => {
    expect(licenseKind(null)).toBe("unknown");
    expect(licenseKind({ ...mit, isOpenSource: null })).toBe("unknown");
    expect(licenseKind(mit)).toBe("open-source");
    expect(licenseKind(prop)).toBe("proprietary");
  });
  it("maps ingestion statuses to depth", () => {
    expect(depthOf("indexed")).toBe("indexed");
    expect(depthOf("partial")).toBe("partial");
    for (const s of ["metadata_only", "not_started", "failed", "blocked", "queued"] as const) expect(depthOf(s)).toBe("metadata");
  });
  it("defaults sort to relevance with a query and coverage without", () => {
    expect(effectiveSort({ q: "a", sort: null })).toBe("relevance");
    expect(effectiveSort({ q: "", sort: null })).toBe("coverage");
    expect(effectiveSort({ q: "", sort: "relevance" })).toBe("coverage");
    expect(effectiveSort({ q: "", sort: "name" })).toBe("name");
  });
});

describe("applyDirectory", () => {
  it("ORs within a facet and ANDs across facets", () => {
    const p = parseDirectoryParams({ framework: "react,vue", licenseType: "open-source" });
    expect(applyDirectory(ROWS, p).rows.map((r) => r.slug)).toEqual(["alpha"]);
    const p2 = parseDirectoryParams({ framework: "react,vue" });
    expect(applyDirectory(ROWS, p2).total).toBe(3);
  });

  it("computes disjunctive facet counts (a facet ignores its own selection)", () => {
    const p = parseDirectoryParams({ framework: "react" });
    const f = computeFacets(ROWS, p);
    const fwc = Object.fromEntries(f.framework.map((o) => [o.value, o.count]));
    // framework counts ignore the framework filter itself
    expect(fwc).toEqual({ react: 2, vue: 2 });
    expect(f.framework.find((o) => o.value === "react")?.selected).toBe(true);
    // other facets are narrowed by the framework filter: alpha (open source) + beta (proprietary)
    const lic = Object.fromEntries(f.licenseType.map((o) => [o.value, o.count]));
    expect(lic).toEqual({ "open-source": 1, proprietary: 1, unknown: 0 });
  });

  it("keeps a selected value visible even if no row carries it", () => {
    const f = computeFacets(ROWS, parseDirectoryParams({ framework: "svelte" }));
    expect(f.framework.find((o) => o.value === "svelte")).toMatchObject({ count: 0, selected: true });
  });

  it("filters by depth with partial distinct from metadata", () => {
    expect(applyDirectory(ROWS, parseDirectoryParams({ depth: "partial" })).rows.map((r) => r.slug)).toEqual(["delta"]);
    expect(applyDirectory(ROWS, parseDirectoryParams({ depth: "metadata" })).rows.map((r) => r.slug).sort()).toEqual(["beta", "gamma"]);
  });

  it("uses the server-side text match: rows scored 0 are excluded, best match first", () => {
    const scored = ROWS.map((r) => ({ ...r, match: r.slug === "beta" ? 0.9 : r.slug === "gamma" ? 0.6 : 0 }));
    const res = applyDirectory(scored, parseDirectoryParams({ q: "be" }));
    expect(res.sort).toBe("relevance");
    expect(res.rows.map((r) => r.slug)).toEqual(["beta", "gamma"]);
  });

  it("sorts by coverage, name, recency and registry rank", () => {
    const by = (sort: string) => applyDirectory(ROWS, parseDirectoryParams({ sort })).rows.map((r) => r.slug);
    expect(by("coverage")).toEqual(["alpha", "delta", "beta", "gamma"]);
    expect(by("name")).toEqual(["alpha", "beta", "delta", "gamma"]);
    expect(by("recent")).toEqual(["beta", "alpha", "gamma", "delta"]);
    expect(by("rank")).toEqual(["beta", "gamma", "alpha", "delta"]);
  });
});

describe("directoryHref / chips", () => {
  it("omits defaults and comma-joins lists", () => {
    const p = parseDirectoryParams({});
    expect(directoryHref(p)).toBe("/systems");
    expect(directoryHref(p, { framework: ["react", "vue"], view: "list" })).toBe("/systems?framework=react%2Cvue&view=list");
    expect(directoryHref(p, { registry: "all" })).toBe("/systems?registry=all");
  });
  it("round-trips through parse", () => {
    const p = parseDirectoryParams({ q: "car", framework: "react", tag: "enterprise", sort: "name" });
    const href = directoryHref(p);
    const sp = Object.fromEntries(new URL(href, "http://x").searchParams);
    expect(parseDirectoryParams(sp)).toEqual(p);
  });
  it("each chip removes exactly one value", () => {
    const p = parseDirectoryParams({ q: "x", framework: "react,vue" });
    const chips = activeFilterChips(p, computeFacets(ROWS, p));
    expect(chips.map((c) => c.key)).toEqual(["q", "framework", "framework"]);
    expect(chips[1]!.href).toBe("/systems?q=x&framework=vue");
    expect(chips[0]!.href).toBe("/systems?framework=react%2Cvue");
  });
});
