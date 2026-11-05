import { describe, expect, it } from "vitest";
import {
  activeFilterCount,
  catalogHref,
  clearFiltersHref,
  DEFAULT_PARAMS,
  escapeLike,
  hasComponentLevelFilters,
  normalizeQuery,
  pageWindow,
  parseCatalogParams,
  toSearchParams,
  withoutFilter,
} from "@/components/catalog/lib/params";

describe("parseCatalogParams", () => {
  it("returns defaults for empty input", () => {
    expect(parseCatalogParams({})).toEqual(DEFAULT_PARAMS);
  });

  it("accepts repeated and comma-separated multi-value params, dedupes and lowercases", () => {
    const p = parseCatalogParams({ system: ["carbon", "github-primer,Carbon"], framework: "react,web-components" });
    expect(p.systems).toEqual(["carbon", "github-primer"]);
    expect(p.frameworks).toEqual(["react", "web-components"]);
  });

  it("drops invalid slugs and unknown enum values instead of guessing", () => {
    const p = parseCatalogParams({
      system: ["carbon", "../etc", "drop table", "ok-slug"],
      view: "grid",
      layout: "nope",
      class: ["verified", "bogus", "unclassified"],
      has: ["props", "everything"],
      sort: "random",
    });
    expect(p.systems).toEqual(["carbon", "ok-slug"]);
    expect(p.view).toBe("types");
    expect(p.layout).toBe("list");
    expect(p.classification).toEqual(["verified", "unclassified"]);
    expect(p.has).toEqual(["props"]);
    expect(p.sort).toBe("relevance");
  });

  it("parses a11y flag variants and clamps page", () => {
    expect(parseCatalogParams({ a11y: "documented" }).a11y).toBe(true);
    expect(parseCatalogParams({ a11y: "1" }).a11y).toBe(true);
    expect(parseCatalogParams({ a11y: "no" }).a11y).toBe(false);
    expect(parseCatalogParams({ page: "-3" }).page).toBe(1);
    expect(parseCatalogParams({ page: "abc" }).page).toBe(1);
    expect(parseCatalogParams({ page: "4" }).page).toBe(4);
    expect(parseCatalogParams({ page: "999999" }).page).toBe(10_000);
  });

  it("keeps only the first group", () => {
    expect(parseCatalogParams({ group: ["inputs", "actions"] }).group).toBe("inputs");
  });
});

describe("normalizeQuery", () => {
  it("trims, collapses whitespace, strips control chars and caps length", () => {
    expect(normalizeQuery("  combo\u0000  box \n")).toBe("combo box");
    expect(normalizeQuery("x".repeat(500))).toHaveLength(120);
    expect(normalizeQuery(undefined)).toBe("");
  });
});

describe("URL building", () => {
  it("omits defaults and serializes in a stable order", () => {
    const p = parseCatalogParams({ q: "menu", system: ["carbon"], view: "components", sort: "coverage", page: "2" });
    expect(toSearchParams(p).toString()).toBe("view=components&q=menu&system=carbon&sort=coverage&page=2");
    expect(catalogHref(DEFAULT_PARAMS)).toBe("/components");
  });

  it("drops layout outside the types view and sort/page outside the components view", () => {
    const p = parseCatalogParams({ layout: "matrix", sort: "name", page: "3" });
    expect(toSearchParams(p).toString()).toBe("layout=matrix");
  });

  it("resets pagination on any change except an explicit page change", () => {
    const p = parseCatalogParams({ view: "components", page: "3" });
    expect(catalogHref(p, { sort: "name" })).toBe("/components?view=components&sort=name");
    expect(catalogHref(p, { page: 4 })).toBe("/components?view=components&page=4");
  });

  it("removes a single filter value or a whole filter", () => {
    const p = parseCatalogParams({ system: ["carbon", "github-primer"], q: "tabs", a11y: "1" });
    expect(withoutFilter(p, "system", "carbon")).toBe("/components?q=tabs&system=github-primer&a11y=documented");
    expect(withoutFilter(p, "q")).toBe("/components?system=carbon&system=github-primer&a11y=documented");
    expect(withoutFilter(p, "a11y")).toBe("/components?q=tabs&system=carbon&system=github-primer");
  });

  it("clear keeps view and layout but drops every filter", () => {
    const p = parseCatalogParams({ layout: "matrix", system: "carbon", q: "x" });
    expect(clearFiltersHref(p)).toBe("/components?layout=matrix");
  });
});

describe("filter counting", () => {
  it("counts every active filter value", () => {
    const p = parseCatalogParams({ q: "a", system: ["x", "y"], group: "inputs", has: ["source", "props"], class: "inferred", a11y: "1" });
    expect(activeFilterCount(p)).toBe(8);
    expect(hasComponentLevelFilters(p)).toBe(true);
    expect(hasComponentLevelFilters(parseCatalogParams({ q: "a", group: "inputs", pattern: "tabs" }))).toBe(false);
  });
});

describe("escapeLike", () => {
  it("escapes LIKE wildcards and backslashes", () => {
    expect(escapeLike("50%_off\\")).toBe("50\\%\\_off\\\\");
  });
});

describe("pageWindow", () => {
  it("shows first, last and neighbours with gaps", () => {
    expect(pageWindow(1, 1)).toEqual([1]);
    expect(pageWindow(1, 3)).toEqual([1, 2, 3]);
    expect(pageWindow(5, 10)).toEqual([1, "gap", 4, 5, 6, "gap", 10]);
    expect(pageWindow(10, 10)).toEqual([1, "gap", 9, 10]);
  });
});
