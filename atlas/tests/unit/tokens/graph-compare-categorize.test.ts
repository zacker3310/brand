import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { flattenTokenTree, inferTokenCategory } from "@/lib/tokens/tree";
import { buildAliasGraph, tokenGraphStats } from "@/lib/tokens/graph";
import { resolveTokenGraph } from "@/lib/tokens/resolve";
import { extractScale, compareScales, contrastPairs, SCALE_COMPARISON_NOTE } from "@/lib/tokens/compare";
import { categorizeToken, normalizeTokenName } from "@/lib/tokens/categorize";
import { parseCssCustomProperties, cssThemeTokens } from "@/lib/tokens/css";
import * as tokensIndex from "@/lib/tokens";

const fx = (f: string) => readFileSync(path.join(import.meta.dirname, "fixtures", f), "utf8");
const dtcg = flattenTokenTree(JSON.parse(fx("dtcg-2025.tokens.json")), { format: "dtcg" });

describe("buildAliasGraph", () => {
  const g = buildAliasGraph(dtcg);

  it("builds edges in the 'references' direction with orphan refs", () => {
    expect(g.edges).toContainEqual({ from: "color.bg.default", to: "color.white", ref: "color.white", raw: "{color.white}", syntax: "dtcg", viaFallback: false });
    expect(g.orphanRefs.map((o) => [o.from, o.ref]).sort()).toEqual([
      ["broken.missing", "color.does.not.exist"],
      ["broken.partial", "size.nope"],
    ]);
  });

  it("finds roots, leaves and isolated tokens", () => {
    expect(g.roots).toContain("color.white");
    expect(g.roots).toContain("size.1");
    expect(g.leaves).toContain("border.focus");
    expect(g.leaves).toContain("shadow.raised");
    expect(g.leaves).not.toContain("color.fg.link"); // referenced by border.focus
    // every literal in the fixture is referenced by some alias
    expect(g.isolated).toEqual([]);
    const g2 = buildAliasGraph([{ name: "lonely", rawValue: "1px" }, { name: "a", rawValue: "{b}" }, { name: "b", rawValue: "2px" }]);
    expect(g2).toMatchObject({ isolated: ["lonely"], roots: ["b"], leaves: ["a"] });
  });

  it("reports cycles as concrete loops", () => {
    expect(g.cycles).toHaveLength(2);
    const three = g.cycles.find((c) => c.length === 3)!;
    expect(new Set(three)).toEqual(new Set(["broken.cycleA", "broken.cycleB", "broken.cycleC"]));
    expect(g.cycles.find((c) => c.length === 1)).toEqual(["broken.self"]);
    const onCycle = g.nodes.find((n) => n.name === "broken.onCycle")!;
    expect(onCycle.inCycle).toBe(false);
    expect(onCycle.depth).toBeNull();
  });

  it("reports longest chains leaf -> root", () => {
    expect(g.longestChains[0]).toEqual(["border.focus", "color.fg.link", "color.blue.700"]);
    expect(g.nodes.find((n) => n.name === "border.focus")!.depth).toBe(2);
  });

  it("tokenGraphStats summarises the graph and resolution states", () => {
    const s = tokenGraphStats(dtcg, resolveTokenGraph(dtcg));
    expect(s.tokens).toBe(dtcg.length);
    expect(s.cycles).toBe(2);
    expect(s.tokensInCycles).toBe(4);
    expect(s.orphanRefs).toBe(2);
    expect(s.maxDepth).toBe(2);
    expect(s.states).toMatchObject({ cycle: 4, external: 2, unresolved: 2 });
    expect(s.aliasRatio).toBeGreaterThan(0);
    expect(s.mostReferenced[0]!.name).toBe("size.1");
  });

  it("includes var() fallback edges for missing targets", () => {
    const g2 = buildAliasGraph([
      { name: "--a", rawValue: "1px", cssVar: "--a" },
      { name: "--b", rawValue: "var(--missing, var(--a))", cssVar: "--b" },
    ]);
    expect(g2.edges).toContainEqual(expect.objectContaining({ from: "--b", to: "--a", viaFallback: true }));
    expect(g2.orphanRefs).toEqual([{ from: "--b", ref: "--missing", raw: "var(--missing, var(--a))", syntax: "css-var" }]);
  });

  it("never throws", () => {
    expect(() => buildAliasGraph(null as never)).not.toThrow();
    expect(tokenGraphStats([]).tokens).toBe(0);
  });
});

describe("extractScale / compareScales", () => {
  const sd = flattenTokenTree(JSON.parse(fx("style-dictionary-legacy.json")), { format: "style-dictionary" });

  it("extracts px steps sorted by value and keeps original names", () => {
    const steps = extractScale(
      dtcg.map((t) => ({ name: t.name, rawValue: t.rawValue, type: t.type })),
      "spacing",
    );
    expect(steps.map((s) => [s.name, s.value])).toEqual([
      ["size.1", 4],
      ["size.2", 8],
      ["size.4", 16],
    ]);
    expect(steps[2]).toMatchObject({ display: "1rem", converted: true, unit: "px" });
  });

  it("uses resolved values when given and skips unresolved refs", () => {
    const r = resolveTokenGraph(dtcg);
    const steps = extractScale(
      dtcg.map((t) => ({ name: t.name, rawValue: t.rawValue, resolvedValue: r.get(t.name)!.resolvedValue, type: t.type })),
      "spacing",
    );
    expect(steps.map((s) => s.name)).toContain("size.control");
    expect(steps.map((s) => s.name)).not.toContain("broken.partial");
  });

  it("supports subcategories (fontSize, zIndex, breakpoint, borderWidth, lineHeight, duration)", () => {
    const toks = sd.map((t) => ({ name: t.name, rawValue: t.rawValue, type: t.type }));
    expect(extractScale(toks, "fontSize").map((s) => [s.name, s.value, s.unitAssumed])).toEqual([
      ["size.font.small", 0.75, true],
      ["size.font.base", 16, false],
      ["size.font.large", 32, false],
    ]);
    expect(extractScale(toks, "zIndex")).toEqual([expect.objectContaining({ name: "z-index.modal", value: 1000, unit: "number" })]);
    expect(extractScale(toks, "breakpoint").map((s) => s.value)).toEqual([768]);
    expect(extractScale(toks, "borderWidth").map((s) => s.name)).toEqual(["border.width.thin"]);
    expect(extractScale(toks, "lineHeight").map((s) => s.name)).toEqual(["size.line-height.body"]);
    expect(extractScale(toks, "duration")).toEqual([expect.objectContaining({ name: "time.base", value: 200, unit: "ms" })]);
    // line-height must not leak into spacing
    expect(extractScale(toks, "spacing").map((s) => s.name)).toEqual(["size.padding.base"]);
  });

  it("aligns scales by value only, never by name", () => {
    const a = [
      { name: "space.1", value: 4, unit: "px" as const, display: "4px", unitAssumed: false, converted: false },
      { name: "space.2", value: 8, unit: "px" as const, display: "8px", unitAssumed: false, converted: false },
      { name: "space.3", value: 12, unit: "px" as const, display: "12px", unitAssumed: false, converted: false },
      { name: "space.4", value: 16, unit: "px" as const, display: "16px", unitAssumed: false, converted: false },
    ];
    const b = [
      // same NAMES, different values: must not be aligned by name
      { name: "space.1", value: 2, unit: "px" as const, display: "2px", unitAssumed: false, converted: false },
      { name: "space.2", value: 8, unit: "px" as const, display: "0.5rem", unitAssumed: false, converted: true },
      { name: "spacing-03", value: 12.5, unit: "px" as const, display: "12.5px", unitAssumed: false, converted: false },
      { name: "spacing-05", value: 16, unit: "px" as const, display: "1rem", unitAssumed: false, converted: true },
      { name: "spacing-05-alt", value: 16, unit: "px" as const, display: "16px", unitAssumed: false, converted: false },
    ];
    const c = compareScales(a, b);
    expect(c.alignment).toBe("value");
    expect(c.note).toBe(SCALE_COMPARISON_NOTE);
    expect(c.rows.map((r) => [r.value, r.match, r.a.map((s) => s.name), r.b.map((s) => s.name)])).toEqual([
      [2, "b-only", [], ["space.1"]],
      [4, "a-only", ["space.1"], []],
      [8, "exact", ["space.2"], ["space.2"]],
      [12, "a-only", ["space.3"], []],
      [12.5, "b-only", [], ["spacing-03"]],
      [16, "exact", ["space.4"], ["spacing-05", "spacing-05-alt"]],
    ]);
    expect(c.summary).toMatchObject({ aSteps: 4, bSteps: 5, aValues: 4, bValues: 4, exact: 2, near: 0, aOnly: 2, bOnly: 2, overlap: 0.333 });
    const tol = compareScales(a, b, { tolerance: 0.5 });
    expect(tol.rows.find((r) => r.value === 12)).toMatchObject({ match: "near", delta: 0.5 });
  });

  it("does not align different units", () => {
    const c = compareScales(
      [{ name: "d", value: 200, unit: "ms", display: "200ms", unitAssumed: false, converted: false }],
      [{ name: "w", value: 200, unit: "px", display: "200px", unitAssumed: false, converted: false }],
    );
    expect(c.rows.map((r) => r.match).sort()).toEqual(["a-only", "b-only"]);
  });
});

describe("contrastPairs", () => {
  it("pairs Primer fg/bg roles within one theme (role swap)", () => {
    const decls = [...parseCssCustomProperties(fx("primer-light-excerpt.css")), ...parseCssCustomProperties(fx("primer-dark-excerpt.css"))];
    const all = (["light", "dark"] as const).flatMap((theme) => {
      const toks = cssThemeTokens(decls, theme, { includeDefault: false });
      const r = resolveTokenGraph(toks);
      return toks.map((t) => ({ name: t.name, resolvedValue: r.get(t.name)!.resolvedValue, theme }));
    });
    const pairs = contrastPairs(all);
    const light = pairs.find((p) => p.theme === "light" && p.fg === "--fgColor-default" && p.bg === "--bgColor-default")!;
    expect(light).toMatchObject({ fgValue: "#1f2328", bgValue: "#ffffff", pairing: "inferred", rule: "role-swap", approximate: false });
    expect(light.ratio).toBeGreaterThan(15);
    expect(light.aa.normal).toBe(true);
    const dark = pairs.find((p) => p.theme === "dark" && p.fg === "--fgColor-muted" && p.bg === "--bgColor-muted")!;
    expect(dark.ratio).toBeGreaterThan(4.5);
    // never pairs across themes
    expect(pairs.every((p) => all.find((t) => t.name === p.fg && t.theme === p.theme))).toBe(true);
    // the translucent header color is not paired with anything named header-bgColor (absent)
    expect(pairs.some((p) => p.fg === "--header-fgColor-default")).toBe(false);
  });

  it("supports Material on-x and shadcn x-foreground conventions", () => {
    const pairs = contrastPairs([
      { name: "md.sys.color.primary", value: "#6750a4" },
      { name: "md.sys.color.on-primary", value: "#ffffff" },
      { name: "md.sys.color.primary-container", value: "#eaddff" },
      { name: "md.sys.color.on-primary-container", value: "#21005d" },
      { name: "--primary", value: "hsl(222.2 47.4% 11.2%)" },
      { name: "--primary-foreground", value: "hsl(210 40% 98%)" },
      { name: "--background", value: "#ffffff" },
      { name: "--foreground", value: "#020817" },
    ]);
    const key = (p: { fg: string; bg: string; rule: string }) => `${p.fg}|${p.bg}|${p.rule}`;
    expect(pairs.map(key).sort()).toEqual(
      [
        "md.sys.color.on-primary|md.sys.color.primary|on-x",
        "md.sys.color.on-primary-container|md.sys.color.primary-container|on-x",
        "--primary-foreground|--primary|x-foreground",
        "--foreground|--background|role-swap",
      ].sort(),
    );
    expect(pairs.every((p) => p.pairing === "inferred")).toBe(true);
  });

  it("evaluates declared pairs and flags translucent colors", () => {
    const pairs = contrastPairs(
      [
        { name: "text", value: "rgba(0,0,0,0.6)" },
        { name: "panel", value: "#ffffff" },
      ],
      { pairs: [["text", "panel"]], heuristics: false },
    );
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({ pairing: "declared", rule: "declared", approximate: true });
  });

  it("skips unresolved references and non-colors", () => {
    expect(contrastPairs([{ name: "fg.a", rawValue: "{x}" }, { name: "bg.a", rawValue: "#fff" }])).toEqual([]);
  });
});

describe("categorizeToken", () => {
  const c = (name: string, type: string | null = null, value?: unknown) => {
    const r = categorizeToken(name, type, value);
    return [r.category, r.subcategory];
  };

  it("explicit types are explicit", () => {
    expect(categorizeToken("anything", "color", "#fff")).toMatchObject({ category: "color", explicit: true, confidence: 1, rule: "type:color" });
    expect(categorizeToken("x", "shadow")).toMatchObject({ category: "elevation", subcategory: "shadow", explicit: true });
    expect(categorizeToken("x", "fontWeights")).toMatchObject({ category: "typography", subcategory: "fontWeight", explicit: true });
    expect(categorizeToken("x", "boxShadow").category).toBe("elevation");
  });

  it("refines ambiguous dimension/number types by name", () => {
    expect(c("font.lineHeight.body", "dimension")).toEqual(["typography", "lineHeight"]);
    expect(c("size.line-height.body", "dimension")).toEqual(["typography", "lineHeight"]);
    expect(c("letterSpacing.wide", "dimension")).toEqual(["typography", "letterSpacing"]);
    expect(c("z-index.modal", "number")).toEqual(["elevation", "zIndex"]);
    expect(c("zIndex.overlay", "number")).toEqual(["elevation", "zIndex"]);
    expect(c("breakpoint.md", "dimension")).toEqual(["layout", "breakpoint"]);
    expect(c("borderWidth.thin", "dimension")).toEqual(["shape", "borderWidth"]);
    expect(c("border.width.thin", "dimension")).toEqual(["shape", "borderWidth"]);
    expect(c("radius.md", "dimension")).toEqual(["shape", "radius"]);
    expect(c("opacity.disabled", "number")).toEqual(["opacity", "opacity"]);
    expect(c("space.4", "dimension")).toEqual(["spacing", "spacing"]);
    expect(c("icon.size.md", "dimension")).toEqual(["spacing", "sizing"]);
    expect(c("mystery", "dimension")).toEqual(["spacing", null]);
    expect(categorizeToken("mystery", "dimension").confidence).toBeLessThan(0.5);
    expect(c("mystery", "number")).toEqual(["other", null]);
    // a dimension can never be a color, even with a color-ish name
    expect(c("border.color.width", "dimension")[0]).not.toBe("color");
  });

  it("uses values when no type is declared", () => {
    expect(c("--fgColor-default", null, "#1f2328")).toEqual(["color", "color"]);
    expect(c("--shadow-resting-small", null, "#ff0000")).toEqual(["color", "color"]);
    expect(c("--duration-fast", null, "80ms")).toEqual(["motion", "duration"]);
    expect(c("--ease-out", null, "cubic-bezier(0, 0, .2, 1)")).toEqual(["motion", "easing"]);
    expect(c("anything", null, { colorSpace: "srgb", components: [0, 0, 0] })).toEqual(["color", "color"]);
    expect(c("anything", null, [{ offsetX: "0", offsetY: "1px", color: "#000" }])).toEqual(["elevation", "shadow"]);
    expect(c("anything", null, { fontFamily: "Inter", fontSize: "16px" })).toEqual(["typography", "typography"]);
  });

  it("name rules for untyped tokens", () => {
    expect(c("--fgColor-default", null, "var(--x)")).toEqual(["color", "color"]);
    expect(c("--body-bg", null, "var(--x)")).toEqual(["color", "color"]);
    expect(c("--text-body-size", null, "14px")).toEqual(["typography", "fontSize"]);
    expect(c("--font-weight-semibold", null, 600)).toEqual(["typography", "fontWeight"]);
    expect(c("--transition-timing-function", null, "var(--x)")).toEqual(["motion", "easing"]);
    expect(c("--layer-index-modal", null, 300)).toEqual(["elevation", "zIndex"]);
    expect(c("md.sys.typescale.body-large.size", null, "16px")).toEqual(["typography", "fontSize"]);
    expect(c("md.sys.typescale.body-large.font", null, "Roboto")).toEqual(["typography", "typography"]);
    expect(c("md.comp.fab.primary.focus.indicator.thickness", null, "3px")).toEqual(["shape", "borderWidth"]);
    expect(c("size.font.small", null, "0.75")).toEqual(["typography", "fontSize"]);
    expect(c("--borderWidth-default", null, "1px")).toEqual(["shape", "borderWidth"]);
    expect(c("--border-default", null, "var(--borderWidth-default) solid var(--borderColor-default)")).toEqual(["shape", "border"]);
    expect(c("--border-default", null, "#d0d7de")).toEqual(["color", "color"]);
    expect(c("--container-max-width", null, "1280px")).toEqual(["layout", "container"]);
    expect(c("unknown-thing", null, "foo")).toEqual(["other", null]);
    // utility-framework conventions (Tailwind v4 theme variables, Open Props)
    expect(c("--container-3xl", null, "48rem")).toEqual(["layout", "container"]);
    expect(c("--text-2xl", null, "1.5rem")).toEqual(["typography", "fontSize"]);
    expect(c("--text-primary", null, "#161616")).toEqual(["color", "color"]);
    expect(c("--animate-spin", null, "spin 1s linear infinite")).toEqual(["motion", "transition"]);
    expect(c("--layer-1", null, "1")).toEqual(["elevation", "zIndex"]);
    expect(c("layer-01", null, "#f4f4f4")).toEqual(["color", "color"]);
    expect(c("md.comp.fab.container.height", null, "56px")).toEqual(["spacing", "sizing"]);
    expect(c("md.comp.fab.container.elevation", null, "6px")).toEqual(["elevation", "shadow"]);
    expect(c("md.comp.fab.container.shape", null, "16px")).toEqual(["shape", null]);
  });

  it("normalizeTokenName splits camelCase", () => {
    expect(normalizeTokenName("--fgColor-onEmphasis")).toBe("fg-color-on-emphasis");
    expect(normalizeTokenName("$md-sys-color-primary")).toBe("md-sys-color-primary");
    expect(normalizeTokenName("zIndex.HTMLOverlay")).toBe("z-index.html-overlay");
  });

  it("stays compatible with tree.ts inferTokenCategory for explicit types", () => {
    for (const type of ["color", "fontFamily", "duration", "shadow", "borderRadius", "opacity", "spacing", "sizing", "gradient"]) {
      const a = inferTokenCategory("x", type, null);
      const b = categorizeToken("x", type, null);
      expect([b.category, b.explicit]).toEqual([a.category, a.explicit]);
    }
  });
});

describe("index exports", () => {
  it("publishes the stable public API", () => {
    for (const name of [
      "resolveTokenGraph",
      "formatTokenValue",
      "validateTokenValue",
      "parseCssCustomProperties",
      "parseScssVariables",
      "flattenScssVariables",
      "buildAliasGraph",
      "tokenGraphStats",
      "extractScale",
      "compareScales",
      "contrastPairs",
      "categorizeToken",
      "toHex",
      "toOklch",
      "contrastRatio",
      "checkContrast",
      "dimensionToPx",
      "flattenTokenTree",
      "inferTokenCategory",
      "cssThemeTokens",
    ]) {
      expect(typeof (tokensIndex as Record<string, unknown>)[name]).toBe("function");
    }
  });
});
