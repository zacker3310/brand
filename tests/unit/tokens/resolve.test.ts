import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { flattenTokenTree } from "@/lib/tokens/tree";
import { resolveTokenGraph, countResolutionStates, embedValue, type ResolvableToken } from "@/lib/tokens/resolve";
import { parseCssCustomProperties, cssThemeTokens } from "@/lib/tokens/css";

const fx = (f: string) => readFileSync(path.join(import.meta.dirname, "fixtures", f), "utf8");
const dtcg = flattenTokenTree(JSON.parse(fx("dtcg-2025.tokens.json")), { format: "dtcg" });
const sd = flattenTokenTree(JSON.parse(fx("style-dictionary-legacy.json")), { format: "style-dictionary" });

describe("resolveTokenGraph — DTCG 2025 fixture", () => {
  const r = resolveTokenGraph(dtcg);
  const get = (n: string) => {
    const v = r.get(n);
    if (!v) throw new Error(`missing ${n}`);
    return v;
  };

  it("returns one entry per token", () => {
    expect(r.size).toBe(dtcg.length);
  });

  it("literals keep their value with depth 0", () => {
    const w = get("color.white");
    expect(w.state).toBe("literal");
    expect(w.depth).toBe(0);
    expect(w.chain).toEqual([]);
    expect(w.resolvedValue).toEqual({ colorSpace: "srgb", components: [1, 1, 1], hex: "#ffffff" });
  });

  it("whole-value aliases substitute the typed target value", () => {
    const bg = get("color.bg.default");
    expect(bg.state).toBe("resolved");
    expect(bg.resolvedValue).toEqual({ colorSpace: "srgb", components: [1, 1, 1], hex: "#ffffff" });
    expect(bg.targets).toEqual(["color.white"]);
    expect(bg.chain).toEqual(["color.white"]);
    expect(bg.depth).toBe(1);
    expect(bg.refs).toEqual([{ raw: "{color.white}", ref: "color.white", syntax: "dtcg", target: "color.white", state: "resolved", depth: 1, usedFallback: false }]);
  });

  it("follows multi-hop chains (size.control -> size.4)", () => {
    const c = get("size.control");
    expect(c.resolvedValue).toEqual({ value: 1, unit: "rem" });
    expect(c.chain).toEqual(["size.4"]);
  });

  it("resolves JSON-pointer $ref values", () => {
    const a = get("color.accent");
    expect(a.state).toBe("resolved");
    expect(a.targets).toEqual(["color.blue.500"]);
    expect(a.refs[0]!.syntax).toBe("json-pointer");
    expect(a.resolvedValue).toEqual({ colorSpace: "oklch", components: [0.62, 0.19, 255] });
  });

  it("interpolates embedded references using dimension objects", () => {
    const inset = get("space.inset");
    expect(inset.state).toBe("resolved");
    expect(inset.resolvedValue).toBe("4px 8px");
    expect(inset.targets).toEqual(["size.1", "size.2"]);
  });

  it("resolves references inside composite shadow arrays", () => {
    const s = get("shadow.raised");
    expect(s.state).toBe("resolved");
    const v = s.resolvedValue as Record<string, unknown>[];
    expect(v).toHaveLength(2);
    expect(v[0]!.offsetX).toEqual({ value: 4, unit: "px" });
    expect(v[0]!.color).toEqual({ colorSpace: "srgb", components: [0, 0, 0], alpha: 0.2, hex: "#000000" });
    expect(v[1]!.inset).toBe(true);
    expect(v[1]!.blur).toEqual({ value: 8, unit: "px" });
    expect(s.targets.sort()).toEqual(["color.shadow", "size.1", "size.2"]);
    // refs keeps every occurrence (color.shadow twice, size.2 twice)
    expect(s.refs).toHaveLength(5);
  });

  it("resolves typography composites and reports the deepest chain", () => {
    const t = get("typography.body");
    expect(t.state).toBe("resolved");
    expect(t.resolvedValue).toEqual({
      fontFamily: ["Inter", "Helvetica Neue", "sans-serif"],
      fontSize: { value: 1, unit: "rem" },
      fontWeight: 700,
      lineHeight: 1.5,
      letterSpacing: { value: 0, unit: "px" },
    });
    expect(t.depth).toBe(1);
  });

  it("resolves border -> alias -> literal with depth 2", () => {
    const b = get("border.focus");
    expect(b.state).toBe("resolved");
    expect(b.depth).toBe(2);
    expect(b.chain).toEqual(["color.fg.link", "color.blue.700"]);
    expect((b.resolvedValue as Record<string, unknown>).style).toBe("solid");
  });

  it("marks a direct missing target as external with null value and partialValue", () => {
    const m = get("broken.missing");
    expect(m.state).toBe("external");
    expect(m.resolvedValue).toBeNull();
    expect(m.missing).toEqual(["color.does.not.exist"]);
    expect(m.targets).toEqual([]);
    expect(m.partialValue).toBe("{color.does.not.exist}");
    expect(m.refs[0]!.state).toBe("external");
    expect(m.issues.map((i) => i.kind)).toContain("missing-target");
  });

  it("marks tokens depending on an external token as unresolved (transitive)", () => {
    const t = get("broken.transitive");
    expect(t.state).toBe("unresolved");
    expect(t.resolvedValue).toBeNull();
    expect(t.targets).toEqual(["broken.missing"]);
    expect(t.missing).toEqual(["color.does.not.exist"]);
    expect(t.issues.map((i) => i.kind)).toContain("dependency-unresolved");
  });

  it("partial embedded resolution keeps the resolvable part in partialValue", () => {
    const p = get("broken.partial");
    expect(p.state).toBe("external");
    expect(p.resolvedValue).toBeNull();
    expect(p.partialValue).toBe("4px {size.nope}");
    expect(p.targets).toEqual(["size.1"]);
  });

  it("detects 3-cycles and self references", () => {
    for (const n of ["broken.cycleA", "broken.cycleB", "broken.cycleC"]) {
      const c = get(n);
      expect(c.state).toBe("cycle");
      expect(c.resolvedValue).toBeNull();
      expect(c.chain).toHaveLength(3);
      expect(c.chain[c.chain.length - 1]).toBe(n);
    }
    expect(get("broken.cycleA").chain).toEqual(["broken.cycleB", "broken.cycleC", "broken.cycleA"]);
    const s = get("broken.self");
    expect(s.state).toBe("cycle");
    expect(s.chain).toEqual(["broken.self"]);
  });

  it("a token pointing INTO a cycle is unresolved (not itself a cycle member)", () => {
    const o = get("broken.onCycle");
    expect(o.state).toBe("unresolved");
    expect(o.issues.map((i) => i.kind)).toContain("cycle-dependency");
    expect(o.refs[0]!.state).toBe("cycle");
  });

  it("keeps the depth === chain.length invariant for every token", () => {
    for (const v of r.values()) expect(v.depth).toBe(v.chain.length);
  });

  it("counts states", () => {
    const c = countResolutionStates(r);
    expect(c.cycle).toBe(4);
    expect(c.external).toBe(2);
    expect(c.unresolved).toBe(2);
    expect(c.literal + c.resolved + c.external + c.cycle + c.unresolved).toBe(dtcg.length);
  });
});

describe("resolveTokenGraph — Style Dictionary legacy", () => {
  const r = resolveTokenGraph(sd);
  it("strips the legacy .value suffix", () => {
    const f = r.get("color.font.base")!;
    expect(f.state).toBe("resolved");
    expect(f.resolvedValue).toBe("#333333");
    expect(f.targets).toEqual(["color.base.gray.dark"]);
  });
  it("substitutes inside calc() without evaluating it", () => {
    const d = r.get("size.padding.double")!;
    expect(d.state).toBe("resolved");
    expect(d.resolvedValue).toBe("calc(16px * 2)");
  });
});

describe("resolveTokenGraph — CSS var()", () => {
  const css = fx("themed-app.css");
  const decls = parseCssCustomProperties(css);
  const base = resolveTokenGraph(cssThemeTokens(decls, null));
  const dark = resolveTokenGraph(cssThemeTokens(decls, "dark"));

  it("maps var() through cssVar names", () => {
    const bg = base.get("--color-bg")!;
    expect(bg.state).toBe("resolved");
    expect(bg.resolvedValue).toBe("#fff");
    expect(bg.refs[0]).toMatchObject({ syntax: "css-var", target: "--color-white" });
  });

  it("applies theme overrides on top of the default scope", () => {
    // [data-theme="dark"] sets var(--color-gray-900); the later @media (prefers-color-scheme: dark) block sets #000.
    expect(dark.get("--color-bg")!.resolvedValue).toBe("#000");
    expect(dark.get("--color-fg")!.resolvedValue).toBe("#fff");
    // non-overridden tokens are inherited from :root
    expect(dark.get("--space-1")!.resolvedValue).toBe("4px");
  });

  it("interpolates var() inside calc() and multi-layer shadows", () => {
    expect(base.get("--space-2")!.resolvedValue).toBe("calc(4px * 2)");
    expect(base.get("--shadow-focus")!.resolvedValue).toBe("0 0 0 2px #fff, 0 0 0 4px oklch(62% 0.19 255)");
  });

  it("uses an authored fallback when the var target is not in the set (state external, usedFallback)", () => {
    const link = base.get("--color-link")!;
    expect(link.state).toBe("external");
    expect(link.usedFallback).toBe(true);
    expect(link.resolvedValue).toBe("oklch(62% 0.19 255)");
    expect(link.missing).toEqual(["--brand-link"]);
    expect(link.targets).toEqual([]);
    expect(link.chain).toEqual(["--color-blue-500"]);
    expect(link.issues.map((i) => i.kind)).toContain("fallback-used");
  });

  it("can disable fallbacks", () => {
    const r = resolveTokenGraph(cssThemeTokens(decls, null), { useCssVarFallbacks: false });
    const link = r.get("--color-link")!;
    expect(link.state).toBe("external");
    expect(link.resolvedValue).toBeNull();
    expect(link.usedFallback).toBe(false);
  });

  it("supports empty fallbacks var(--x,)", () => {
    const e = base.get("--empty-fallback")!;
    expect(e.state).toBe("external");
    expect(e.resolvedValue).toBe("");
  });

  it("propagates fallback usage to dependants as resolved+usedFallback", () => {
    const r = resolveTokenGraph([
      { name: "--a", rawValue: "var(--missing, 3px)", references: [], cssVar: "--a" },
      { name: "--b", rawValue: "var(--a)", references: [], cssVar: "--b" },
    ]);
    expect(r.get("--a")!.state).toBe("external");
    expect(r.get("--b")!.state).toBe("resolved");
    expect(r.get("--b")!.usedFallback).toBe(true);
    expect(r.get("--b")!.resolvedValue).toBe("3px");
  });

  it("maps var() refs to DTCG-named tokens through cssVar", () => {
    const r = resolveTokenGraph([
      { name: "color.blue.5", rawValue: "#0969da", references: [], cssVar: "--color-blue-5" },
      { name: "color.accent", rawValue: "var(--color-blue-5)", references: [], cssVar: "--color-accent" },
    ]);
    expect(r.get("color.accent")).toMatchObject({ state: "resolved", resolvedValue: "#0969da", targets: ["color.blue.5"] });
  });
});

describe("resolveTokenGraph — robustness", () => {
  it("never throws on garbage input", () => {
    const bad = [null, undefined, 42, "x", { name: 3 }, { name: "" }, { name: "ok", rawValue: "{ok}" }] as unknown as ResolvableToken[];
    expect(() => resolveTokenGraph(bad)).not.toThrow();
    const r = resolveTokenGraph(bad);
    expect([...r.keys()]).toEqual(["ok"]);
    expect(r.get("ok")!.state).toBe("cycle");
    expect(resolveTokenGraph(null as unknown as ResolvableToken[]).size).toBe(0);
  });

  it("handles a very long chain with the depth guard (no stack overflow)", () => {
    const n = 5000;
    const toks: ResolvableToken[] = [{ name: "t0", rawValue: "1px", references: [] }];
    for (let i = 1; i < n; i++) toks.push({ name: `t${i}`, rawValue: `{t${i - 1}}`, references: [] });
    const r = resolveTokenGraph(toks, { maxDepth: 40 });
    expect(r.get("t40")!.state).toBe("resolved");
    expect(r.get("t40")!.depth).toBe(40);
    expect(r.get("t41")!.state).toBe("unresolved");
    expect(r.get("t41")!.issues.map((i) => i.kind)).toContain("max-depth");
    expect(r.get(`t${n - 1}`)!.state).toBe("unresolved");
    expect(r.get(`t${n - 1}`)!.chain.length).toBeLessThanOrEqual(41);
  });

  it("resolves a large wide graph quickly (memoised)", () => {
    const toks: ResolvableToken[] = [];
    for (let i = 0; i < 200; i++) toks.push({ name: `base.${i}`, rawValue: `${i}px`, references: [] });
    for (let i = 0; i < 5000; i++) toks.push({ name: `alias.${i}`, rawValue: `{base.${i % 200}} {base.${(i * 7) % 200}}`, references: [] });
    const t0 = performance.now();
    const r = resolveTokenGraph(toks);
    expect(performance.now() - t0).toBeLessThan(3000);
    expect(r.get("alias.201")!.resolvedValue).toBe("1px 7px");
  });

  it("duplicate names: last definition wins and is reported", () => {
    const r = resolveTokenGraph([
      { name: "a", rawValue: "#000", references: [] },
      { name: "a", rawValue: "#fff", references: [] },
      { name: "b", rawValue: "{a}", references: [] },
    ]);
    expect(r.get("a")!.resolvedValue).toBe("#fff");
    expect(r.get("a")!.issues[0]!.kind).toBe("duplicate-name");
    expect(r.get("b")!.resolvedValue).toBe("#fff");
  });

  it("cannot embed composite objects into strings -> unresolved/not-embeddable", () => {
    const r = resolveTokenGraph([
      { name: "shadow", rawValue: { offsetX: "1px", offsetY: "1px", color: "#000" }, references: [] },
      { name: "s2", rawValue: "{shadow}, 0 0 1px red", references: [] },
    ]);
    const s2 = r.get("s2")!;
    expect(s2.state).toBe("unresolved");
    expect(s2.issues.map((i) => i.kind)).toContain("not-embeddable");
    expect(s2.partialValue).toBe("{shadow}, 0 0 1px red");
  });

  it("uses declared references when rawValue has no syntactic refs", () => {
    const r = resolveTokenGraph([
      { name: "palette.blue", rawValue: "#00f", references: [] },
      { name: "accent", rawValue: "#00f", references: ["palette.blue"] },
      { name: "ghost", rawValue: "#111", references: ["palette.nope"] },
    ]);
    expect(r.get("accent")).toMatchObject({ state: "resolved", resolvedValue: "#00f", targets: ["palette.blue"], depth: 1 });
    // the raw value is concrete: it stays the resolved value; the state describes the declared edge
    expect(r.get("ghost")).toMatchObject({ state: "external", resolvedValue: "#111", missing: ["palette.nope"] });
  });

  it("custom lookup and separator-normalised names", () => {
    const r = resolveTokenGraph([
      { name: "color/blue/500", rawValue: "#00f", references: [] },
      { name: "link", rawValue: "{color.blue.500}", references: [] },
      { name: "x", rawValue: "{alias-for-blue}", references: [] },
    ], { lookup: (ref) => (ref === "alias-for-blue" ? "color/blue/500" : null) });
    expect(r.get("link")!.resolvedValue).toBe("#00f");
    expect(r.get("x")!.resolvedValue).toBe("#00f");
  });

  it("does not treat JSON-ish or CSS-block braces as references", () => {
    const r = resolveTokenGraph([{ name: "j", rawValue: '{ "a": 1 }', references: [] }]);
    expect(r.get("j")!.state).toBe("literal");
  });

  it("embedValue stringifies fontFamily arrays and DTCG colors", () => {
    expect(embedValue(["Inter", "Helvetica Neue", "sans-serif"])).toBe('Inter, "Helvetica Neue", sans-serif');
    expect(embedValue({ colorSpace: "srgb", components: [1, 0, 0] })).toBe("#ff0000");
    expect(embedValue({ value: 2, unit: "rem" })).toBe("2rem");
    expect(embedValue({ a: 1 })).toBeNull();
  });
});

describe("persistence helpers", () => {
  it("resolutionColumns / tokenAliasRows", async () => {
    const { resolutionColumns, tokenAliasRows } = await import("@/lib/tokens/resolve");
    const r = resolveTokenGraph(dtcg);
    expect(resolutionColumns(r.get("color.white"))).toEqual({ resolvedValue: { colorSpace: "srgb", components: [1, 1, 1], hex: "#ffffff" }, isAlias: false, aliasState: null, depth: 0 });
    expect(resolutionColumns(r.get("border.focus"))).toMatchObject({ isAlias: true, aliasState: "resolved", depth: 2 });
    expect(resolutionColumns(r.get("broken.missing"))).toEqual({ resolvedValue: null, isAlias: true, aliasState: "external", depth: null });
    expect(resolutionColumns(undefined)).toEqual({ resolvedValue: null, isAlias: false, aliasState: null, depth: null });
    const rows = tokenAliasRows(r.get("shadow.raised"));
    expect(rows.map((x) => x.targetRef).sort()).toEqual(["{color.shadow}", "{size.1}", "{size.2}"]);
    expect(rows.every((x) => x.state === "resolved" && x.targetName !== null)).toBe(true);
    expect(tokenAliasRows(r.get("broken.partial"))).toEqual([
      { targetRef: "{size.1}", targetName: "size.1", state: "resolved", depth: 1 },
      { targetRef: "{size.nope}", targetName: null, state: "external", depth: null },
    ]);
  });

  it("resolves slash-separated refs to dotted names", () => {
    const r = resolveTokenGraph([
      { name: "color.blue.500", rawValue: "#00f", references: [] },
      { name: "link", rawValue: "{color/blue/500}", references: [] },
    ]);
    expect(r.get("link")!.resolvedValue).toBe("#00f");
  });
});
