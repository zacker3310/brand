import { describe, expect, it } from "vitest";
import {
  compareHref,
  depthLabel,
  humanizeRegistrySummaries,
  pickFeatured,
  pickRecent,
  suggestComparisons,
  summarizeActivity,
  type TypeImplementation,
} from "@/components/discovery/lib/home";
import { groupHits, pageWindow, parseSearchPage, sanitizeHighlight, searchHref } from "@/components/discovery/lib/search";
import { pickSwatches } from "@/components/discovery/lib/swatches";
import type { SearchHit } from "@/lib/contracts";

describe("pickFeatured", () => {
  it("ranks by components + tokens, excludes systems with no deep records", () => {
    const rows = [
      { slug: "a", name: "A", components: 10, tokens: 100, patterns: 0, registryRank: 5 },
      { slug: "b", name: "B", components: 80, tokens: 2700, patterns: 25, registryRank: 9 },
      { slug: "c", name: "C", components: 0, tokens: 0, patterns: 0, registryRank: 1 },
      { slug: "d", name: "D", components: 50, tokens: 60, patterns: 3, registryRank: 2 },
      { slug: "e", name: "E", components: 60, tokens: 50, patterns: 3, registryRank: 1 },
    ];
    expect(pickFeatured(rows).map((r) => r.slug)).toEqual(["b", "e", "d", "a"]);
    expect(pickFeatured(rows, 2)).toHaveLength(2);
  });
});

describe("suggestComparisons", () => {
  const sys = (slug: string, rank: number, verified = 0) => ({ slug, name: slug.toUpperCase(), registryRank: rank, verified, inferred: verified ? 0 : 1 });
  const types: TypeImplementation[] = [
    { typeSlug: "button", typeName: "Button", group: "actions", typeSortOrder: 1, systems: [sys("a", 3), sys("b", 1), sys("c", 2), sys("d", 4), sys("e", 5)] },
    { typeSlug: "link", typeName: "Link", group: "actions", typeSortOrder: 2, systems: [sys("a", 3), sys("b", 1), sys("c", 2)] },
    { typeSlug: "tabs", typeName: "Tabs", group: "navigation", typeSortOrder: 1, systems: [sys("a", 3), sys("b", 1), sys("c", 2, 1)] },
    { typeSlug: "card", typeName: "Card", group: "data-display", typeSortOrder: 1, systems: [sys("a", 3), sys("b", 1)] },
  ];
  it("only includes types implemented by >= 3 systems, round-robin across groups", () => {
    const s = suggestComparisons(types, 6);
    expect(s.map((x) => x.typeSlug)).toEqual(["button", "tabs", "link"]);
  });
  it("links up to 4 systems in registry-rank order and reports the total", () => {
    const [button] = suggestComparisons(types, 1);
    expect(button!.systems.map((x) => x.slug)).toEqual(["b", "c", "a", "d"]);
    expect(button!.systemCount).toBe(5);
    expect(button!.href).toBe("/compare?type=button&systems=b%2Cc%2Ca%2Cd");
    expect(button!.allInferred).toBe(true);
    expect(suggestComparisons(types).find((x) => x.typeSlug === "tabs")!.allInferred).toBe(false);
  });
  it("builds compare URLs", () => {
    expect(compareHref("date-picker", ["x", "y"])).toBe("/compare?type=date-picker&systems=x%2Cy");
  });
});

describe("activity helpers", () => {
  it("summarizes change counts, largest first", () => {
    expect(
      summarizeActivity([
        { entityType: "token_set", changeKind: "created", count: 9 },
        { entityType: "component", changeKind: "created", count: 76 },
        { entityType: "pattern", changeKind: "updated", count: 1 },
        { entityType: "component", changeKind: "updated", count: 0 },
      ]),
    ).toEqual(["76 components added", "9 token sets added", "1 pattern updated"]);
  });
  it("balances ingestion runs against registry re-checks", () => {
    const mk = (kind: "ingest" | "registry", t: string) => ({ kind, lastActivityAt: `2026-11-05T0${t}:00:00Z`, registrySummaries: [] });
    const rows = [mk("registry", "9"), mk("registry", "9"), mk("registry", "9"), mk("registry", "8"), mk("ingest", "4"), mk("ingest", "3")];
    const picked = pickRecent(rows, 4, 2, 6);
    expect(picked.filter((r) => r.kind === "ingest")).toHaveLength(2);
    expect(picked).toHaveLength(6);
    expect(picked[0]!.lastActivityAt >= picked[5]!.lastActivityAt).toBe(true);
  });
  it("humanizes registry change summaries", () => {
    expect(humanizeRegistrySummaries(["registry evidence: 1 check(s) added or changed", "registryEvidence changed"])).toEqual(["1 registry check re-run"]);
    expect(humanizeRegistrySummaries(["registry evidence: 3 check(s) added or changed"])).toEqual(["3 registry checks re-run"]);
  });
  it("labels library depth honestly", () => {
    expect(depthLabel(4, 0, 96)).toBe("4 systems deeply indexed · 96 metadata-level");
    expect(depthLabel(1, 2, 97)).toBe("1 system deeply indexed · 2 partial · 97 metadata-level");
  });
});

describe("search page state", () => {
  it("maps page to offset and keeps filters", () => {
    const r = parseSearchPage({ q: "React combobox", types: "component,component-type", page: "3", view: "grouped" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.query.offset).toBe(40);
    expect(r.query.limit).toBe(20);
    expect(r.query.types).toEqual(["component", "component-type"]);
    expect(r.state.view).toBe("grouped");
    expect(searchHref(r.state, { page: 1 })).toBe("/search?q=React+combobox&types=component%2Ccomponent-type&view=grouped");
  });
  it("reports invalid parameters instead of throwing", () => {
    const r = parseSearchPage({ q: "x", types: "nope" });
    expect(r.ok).toBe(false);
  });
  it("ignores caller-supplied limit/offset", () => {
    const r = parseSearchPage({ q: "x", limit: "100", offset: "999" });
    expect(r.ok && r.query.limit === 20 && r.query.offset === 0).toBe(true);
  });
  it("windows pagination with gaps", () => {
    expect(pageWindow(1, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(pageWindow(6, 12)).toEqual([1, "gap", 5, 6, 7, "gap", 12]);
    expect(pageWindow(1, 12)).toEqual([1, 2, "gap", 12]);
  });
  it("groups hits by entity type in a fixed order", () => {
    const h = (entityType: SearchHit["entityType"], id: string): SearchHit => ({ entityType, entityId: id, title: id, subtitle: null, url: "/", systemSlug: null, score: 1, highlight: null, facets: {} });
    const g = groupHits([h("token", "1"), h("component", "2"), h("system", "3"), h("component", "4")]);
    expect(g.map((x) => x.type)).toEqual(["system", "component", "token"]);
    expect(g[1]!.hits.map((x) => x.entityId)).toEqual(["2", "4"]);
  });
  it("sanitizes highlights to <mark> only", () => {
    expect(sanitizeHighlight("a <mark>b</mark> &lt;c&gt;")).toBe("a <mark>b</mark> &lt;c&gt;");
    expect(sanitizeHighlight('<img src=x onerror=alert(1)><mark>ok</mark><script>')).toBe("&lt;img src=x onerror=alert(1)&gt;<mark>ok</mark>&lt;script&gt;");
  });
});

describe("pickSwatches", () => {
  it("keeps only concrete colors, one per value and name, spread across hues", () => {
    const c = (name: string, resolved: unknown) => ({ name, setSlug: "s", theme: "light", resolved, valueText: null });
    const out = pickSwatches(
      [
        c("bg", "#ffffff"),
        c("bg", "#f4f4f4"), // same name in another theme
        c("fg", "#000000"),
        c("dup", "#ffffff"), // same value
        c("danger", { colorSpace: "srgb", components: [0.854902, 0.117647, 0.156863], hex: "#da1e28" }),
        c("link", "#0f62fe"),
        c("ref", "{color.blue}"), // unresolved reference text, not a color
        c("current", "currentColor"),
      ],
      16,
    );
    expect(out.map((s) => s.name)).toEqual(["bg", "fg", "danger", "link"]);
    expect(out.map((s) => s.hex)).toEqual(["#ffffff", "#000000", "#da1e28", "#0f62fe"]);
  });
});
