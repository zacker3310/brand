import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseCssCustomProperties, inferThemeFromSelector, inferThemeFromMedia, themeFromClassName, listCssThemes, cssThemeTokens } from "@/lib/tokens/css";

const fx = (f: string) => readFileSync(path.join(import.meta.dirname, "fixtures", f), "utf8");

describe("parseCssCustomProperties — Primer excerpts", () => {
  const light = parseCssCustomProperties(fx("primer-light-excerpt.css"));
  const dark = parseCssCustomProperties(fx("primer-dark-excerpt.css"));

  it("extracts every declaration in source order with line numbers", () => {
    expect(light).toHaveLength(10);
    expect(light[0]).toMatchObject({ name: "--bgColor-success-emphasis", value: "#1f883d", line: 13, theme: "light", themeInferred: false, scope: "theme" });
    expect(light.map((d) => d.name).slice(0, 3)).toEqual(["--bgColor-success-emphasis", "--fgColor-danger", "--bgColor-open-emphasis"]);
  });

  it("reads the theme from the specific data-*-theme attribute (literal, not inferred)", () => {
    expect(dark.every((d) => d.theme === "dark" && !d.themeInferred)).toBe(true);
    // Selector theme wins over the surrounding prefers-color-scheme media query.
    const inMedia = light.filter((d) => d.media);
    expect(inMedia).toHaveLength(2);
    expect(inMedia[0]).toMatchObject({ media: "(prefers-color-scheme: dark)", theme: "light" });
  });

  it("captures same-line trailing comments as short descriptions", () => {
    expect(light[0]!.comment).toBe("Strong success background for prominent positive actions");
    expect(light.find((d) => d.name === "--button-danger-fgColor-rest")!.comment).toBeNull();
  });

  it("records var() references", () => {
    expect(light.find((d) => d.name === "--bgColor-open-emphasis")!.references).toEqual(["--bgColor-success-emphasis"]);
  });
});

describe("parseCssCustomProperties — edge cases (synthetic)", () => {
  const decls = parseCssCustomProperties(fx("themed-app.css"));
  const find = (name: string, pred: (d: (typeof decls)[number]) => boolean = () => true) => decls.find((d) => d.name === name && pred(d));

  it("handles @layer blocks and records the layer", () => {
    const s = find("--space-1")!;
    expect(s).toMatchObject({ selector: ":root", theme: null, scope: "root", layer: "tokens", value: "4px" });
  });

  it("keeps strings with delimiters intact and does not split on ; or {} inside them", () => {
    expect(find("--content")!.value).toBe('"a;b{c}"');
    expect(find("--semi-in-url")!.value).toBe('url("data:image/svg+xml;utf8,<svg></svg>")');
    expect(find("--json-like")!.value).toBe('{ "a": 1 }');
  });

  it("strips comments and !important", () => {
    const r = find("--radius-md")!;
    expect(r.value).toBe("8px");
    expect(r.comment).toBe("medium radius");
    const imp = find("--important-thing")!;
    expect(imp).toMatchObject({ value: "1px", important: true });
  });

  it("collects nested var() fallback references", () => {
    expect(find("--color-link")!.references).toEqual(["--brand-link", "--color-blue-500"]);
    expect(find("--shadow-focus")!.references).toEqual(["--color-bg", "--color-blue-500"]);
  });

  it("infers themes from attribute, class and media", () => {
    expect(find("--color-bg", (d) => d.selector === '[data-theme="dark"]')).toMatchObject({ theme: "dark", themeInferred: false, scope: "theme" });
    expect(find("--color-fg", (d) => d.selector === ".theme-high-contrast")).toMatchObject({ theme: "high-contrast", themeInferred: true });
    // :root:not([data-theme="light"]) inside prefers-color-scheme: dark -> attribute value "light" is inside :not(),
    // the media query decides: dark.
    const m = find("--color-bg", (d) => d.media === "(prefers-color-scheme: dark)")!;
    expect(m.theme).toBe("dark");
    const hc = find("--color-fg", (d) => !!d.media && d.media.includes("prefers-contrast"))!;
    expect(hc).toMatchObject({ theme: "dark-high-contrast", themeInferred: true });
    expect(find("--cds-background")).toMatchObject({ theme: "g100", themeInferred: true, scope: "theme" });
  });

  it("keeps component-scoped declarations with resolved nested selectors", () => {
    expect(find("--button-bg", (d) => d.selector === ".Button")).toMatchObject({ scope: "scoped", theme: null });
    expect(find("--button-bg", (d) => d.selector === ".Button:hover")).toBeTruthy();
    expect(find("--icon-size")!.selector).toBe(".Button .Icon");
    const noScoped = parseCssCustomProperties(fx("themed-app.css"), { includeScoped: false });
    expect(noScoped.some((d) => d.scope === "scoped")).toBe(false);
  });

  it("skips @keyframes and @font-face, keeps @supports with condition", () => {
    expect(find("--rotation")).toBeUndefined();
    expect(find("--color-accent")).toMatchObject({ conditions: "@supports (color: oklch(0 0 0))", theme: null });
  });

  it("keeps duplicate declarations in order (cascade decided by consumers)", () => {
    expect(decls.filter((d) => d.name === "--color-dup").map((d) => d.value)).toEqual(["red", "blue"]);
  });

  it("lists themes and builds per-theme token sets", () => {
    expect(listCssThemes(decls)).toEqual([null, "dark", "high-contrast", "dark-high-contrast", "g100"]);
    const dark = cssThemeTokens(decls, "dark");
    const bg = dark.find((t) => t.name === "--color-bg")!;
    // [data-theme=dark] then the media-query dark block: later wins
    expect(bg.rawValue).toBe("#000");
    expect(bg.inherited).toBe(false);
    expect(dark.find((t) => t.name === "--space-1")!.inherited).toBe(true);
    expect(cssThemeTokens(decls, null).find((t) => t.name === "--color-dup")!.rawValue).toBe("blue");
  });

  it("forces a theme when the caller asserts one", () => {
    const forced = parseCssCustomProperties(":root { --a: 1px; }", { theme: "light" });
    expect(forced[0]).toMatchObject({ theme: "light", themeInferred: false, scope: "theme" });
  });
});

describe("parseCssCustomProperties — robustness", () => {
  it("never throws on malformed CSS", () => {
    const bad = [":root { --a: 1px", ":root { --a: var(--b; }", "}}}{{{", "/* unterminated", ':root { --s: "unterminated; }', "", "@media {", ":root{--x:;}"];
    for (const b of bad) expect(() => parseCssCustomProperties(b)).not.toThrow();
    expect(parseCssCustomProperties(":root { --a: 1px")).toEqual([expect.objectContaining({ name: "--a", value: "1px" })]);
    expect(parseCssCustomProperties(":root{--x:;}")[0]).toMatchObject({ name: "--x", value: "" });
    expect(parseCssCustomProperties(null as unknown as string)).toEqual([]);
  });

  it("ignores custom-property-looking text outside rules and in regular properties", () => {
    const out = parseCssCustomProperties("--top: 1px; .a { color: var(--x); content: '--y: 2px'; }");
    expect(out).toEqual([]);
    // the stray top-level statement must not leak into the next rule's selector
    const next = parseCssCustomProperties("--top: 1px; :root { --a: 1px; }");
    expect(next).toEqual([expect.objectContaining({ selector: ":root", name: "--a", scope: "root" })]);
  });

  it("supports @media nested inside a style rule (CSS nesting)", () => {
    const out = parseCssCustomProperties(":root { --a: 1px; @media (prefers-color-scheme: dark) { --a: 2px; } }");
    expect(out.map((d) => [d.value, d.theme, d.media])).toEqual([
      ["1px", null, null],
      ["2px", "dark", "(prefers-color-scheme: dark)"],
    ]);
  });

  it("handles minified CSS and multiple rules", () => {
    const out = parseCssCustomProperties(":root{--a:1px;--b:var(--a)}.dark{--a:2px}");
    expect(out.map((d) => [d.name, d.value, d.theme])).toEqual([
      ["--a", "1px", null],
      ["--b", "var(--a)", null],
      ["--a", "2px", "dark"],
    ]);
  });

  it("parses a large file quickly", () => {
    let css = ":root {\n";
    for (let i = 0; i < 20000; i++) css += `  --t-${i}: var(--t-${i + 1}, #${(i % 4096).toString(16).padStart(3, "0")}); /* c ${i} */\n`;
    css += "}\n";
    const t0 = performance.now();
    const out = parseCssCustomProperties(css);
    expect(out).toHaveLength(20000);
    expect(performance.now() - t0).toBeLessThan(3000);
    expect(out[19999]!.line).toBe(20001);
  });
});

describe("theme inference helpers", () => {
  it("inferThemeFromSelector", () => {
    expect(inferThemeFromSelector(":root")).toEqual({ theme: null, inferred: false, kind: "root" });
    expect(inferThemeFromSelector("[data-theme='dark']")).toEqual({ theme: "dark", inferred: false, kind: "theme" });
    expect(inferThemeFromSelector("[data-bs-theme=dark]").theme).toBe("dark");
    expect(inferThemeFromSelector(':root, [data-theme="light"]')).toMatchObject({ theme: "light", kind: "theme" });
    expect(inferThemeFromSelector('[data-color-mode="dark"][data-dark-theme="dark_dimmed"]').theme).toBe("dark_dimmed");
    expect(inferThemeFromSelector("html.dark")).toEqual({ theme: "dark", inferred: true, kind: "theme" });
    expect(inferThemeFromSelector(".dark-theme").theme).toBe("dark");
    expect(inferThemeFromSelector(".theme-ocean").theme).toBe("ocean");
    expect(inferThemeFromSelector(":host([theme=dark])").theme).toBe("dark");
    expect(inferThemeFromSelector(".Button")).toEqual({ theme: null, inferred: false, kind: "scoped" });
    expect(inferThemeFromSelector(".card > .title")).toMatchObject({ kind: "scoped" });
    // conflicting list -> first theme, flagged as inferred
    expect(inferThemeFromSelector('[data-theme="light"], [data-theme="dark"]')).toEqual({ theme: "light", inferred: true, kind: "theme" });
  });

  it("themeFromClassName", () => {
    expect(themeFromClassName("dark")).toBe("dark");
    expect(themeFromClassName("is-dark")).toBe("dark");
    expect(themeFromClassName("theme-dark-high-contrast")).toBe("dark-high-contrast");
    expect(themeFromClassName("cds--g100")).toBe("g100");
    expect(themeFromClassName("cds--white")).toBe("white");
    expect(themeFromClassName("Button")).toBeNull();
    expect(themeFromClassName("highlight")).toBeNull();
  });

  it("inferThemeFromMedia", () => {
    expect(inferThemeFromMedia("(prefers-color-scheme: dark)")).toEqual({ theme: "dark", inferred: false });
    expect(inferThemeFromMedia("screen and (prefers-color-scheme:light)")).toEqual({ theme: "light", inferred: false });
    expect(inferThemeFromMedia("(prefers-contrast: more)")).toEqual({ theme: "high-contrast", inferred: true });
    expect(inferThemeFromMedia("(forced-colors: active)")).toEqual({ theme: "forced-colors", inferred: true });
    expect(inferThemeFromMedia("(min-width: 768px)")).toBeNull();
  });
});
