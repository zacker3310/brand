/**
 * Spectrum adapter tests. Fixtures in tests/fixtures/adapters/spectrum are short, trimmed excerpts
 * of real Adobe sources (Apache-2.0, Copyright Adobe): @adobe/spectrum-tokens src/*.json,
 * @adobe/spectrum-design-data components/button.json, @spectrum-css/tokens index.css,
 * spectrum.adobe.com query-index / .plain.html pages / component options JSON, and the
 * react-spectrum.adobe.com / react-aria.adobe.com llms.txt + page markdown + page MDX. No network.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { COMPONENT_FIELDS, NormalizedBundle } from "@/lib/contracts";
import { validateTokenValue } from "@/lib/tokens/validate";
import { adapter, exportsFromListing } from "@/ingestion/adapters/spectrum";
import { monorepoBlob, monorepoRaw, releaseTag, sitePlainUrl } from "@/ingestion/adapters/spectrum/constants";
import { hookPageOf, isComponentPage, literalUnion, parseDocsMd, parseLlms, parseMdxMeta, splitRow } from "@/ingestion/adapters/spectrum/docs-md";
import type { SpectrumFragment } from "@/ingestion/adapters/spectrum/fragments";
import { normalizeDesign } from "@/ingestion/adapters/spectrum/normalize-design";
import { cleanExampleCode, compactPage, normalizeReact } from "@/ingestion/adapters/spectrum/normalize-react";
import { packageOfImportPath, parseComponentSchema } from "@/ingestion/adapters/spectrum/schema";
import { firstSentence, lifecycleFromStatus, type Ev } from "@/ingestion/adapters/spectrum/shared";
import {
  componentLinks,
  parseA11yFragment,
  parsePrinciples,
  parseSiteData,
  parseSiteIndex,
  parseSitePage,
  parseStatesFragment,
  siteComponents,
  sitePatternRows,
} from "@/ingestion/adapters/spectrum/site";
import { buildTokenSets, declaredCustomProperties, mapType, parseTokenFile, refsIn, setKind } from "@/ingestion/adapters/spectrum/tokens";
import { validateSpectrumBundle } from "@/ingestion/adapters/spectrum/validate";

const FX = path.resolve(import.meta.dirname, "../../fixtures/adapters/spectrum");
const fx = (f: string) => readFileSync(path.join(FX, f), "utf8");
const ev = (sourceUrl: string, location: string): Ev => ({ sourceUrl, retrievedAt: "2026-11-05T00:00:00.000Z", contentHash: "abc", location });
const wrap = (data: SpectrumFragment) => ({ data });

const TOKEN_FILES = ["accordion", "button", "color-palette", "layout", "semantic-color-palette", "typography"];
function tokenInputs() {
  return TOKEN_FILES.map((n) => {
    const file = `src/${n}.json`;
    return { file, tokens: parseTokenFile(fx(`tokens-${n}.json`), file).tokens, ev: ev(`https://cdn.jsdelivr.net/npm/@adobe/spectrum-tokens@15.6.0/${file}`, file) };
  });
}

/* --------------------------------- tokens --------------------------------- */

describe("spectrum tokens", () => {
  it("parses values, theme sets, scale sets and metadata as authored", () => {
    const { tokens, warnings } = parseTokenFile(fx("tokens-color-palette.json"), "src/color-palette.json");
    expect(warnings).toEqual([]);
    const blue = tokens.find((t) => t.name === "blue-100")!;
    expect(Object.keys(blue.sets!)).toEqual(["light", "dark", "wireframe"]);
    expect(blue.sets!.light).toEqual({ schema: "color", value: "rgb(245, 249, 255)" });
    expect(tokens.find((t) => t.name === "black")).toMatchObject({ schema: "color", value: "rgb(0, 0, 0)" });
    const btn = parseTokenFile(fx("tokens-button.json"), "src/button.json").tokens[0]!;
    expect(btn).toMatchObject({ name: "button-minimum-width-multiplier", component: "button", schema: "multiplier", value: 2.25 });
    expect(parseTokenFile("{not json", "src/x.json").warnings[0]).toMatch(/invalid JSON/);
  });

  it("maps token-type schemas to DTCG types and classifies set kinds", () => {
    expect(mapType("color")).toBe("color");
    expect(mapType("font-size")).toBe("dimension");
    expect(mapType("multiplier")).toBe("number");
    expect(mapType("drop-shadow")).toBe("shadow");
    expect(mapType("alias")).toBeNull();
    expect(setKind(["light", "dark", "wireframe"])).toBe("theme");
    expect(setKind(["desktop", "mobile"])).toBe("scale");
    expect(setKind(["spectrum", "express"])).toBe("other");
    expect(refsIn({ fontSize: "{font-size-200}", fontFamily: "{sans-serif-font-family}" })).toEqual(["font-size-200", "sans-serif-font-family"]);
  });

  it("models color themes as themed sets and platform scales as theme-agnostic sets", () => {
    const css = new Set(declaredCustomProperties(fx("spectrum-css-vars.css")));
    const r = buildTokenSets(tokenInputs(), { pkg: "@adobe/spectrum-tokens", version: "15.6.0", cssVars: css, cssEv: ev("https://cdn.jsdelivr.net/npm/@spectrum-css/tokens@16.0.2/dist/css/index.css", "dist/css/index.css") });
    const by = new Map(r.sets.map((s) => [s.slug, s]));
    expect([...by.keys()].sort()).toEqual(["color-dark", "color-light", "color-palette", "color-wireframe", "component", "layout", "scale-desktop", "scale-mobile", "semantic-color-palette"]);
    expect(by.get("color-light")!.theme).toBe("light");
    expect(by.get("color-dark")!.theme).toBe("dark");
    expect(by.get("scale-desktop")!.theme).toBeNull();
    expect(by.get("scale-mobile")!.theme).toBeNull();
    const blueLight = by.get("color-light")!.tokens.find((t) => t.name === "blue-100")!;
    const blueDark = by.get("color-dark")!.tokens.find((t) => t.name === "blue-100")!;
    expect(blueLight).toMatchObject({ rawValue: "rgb(245, 249, 255)", type: "color", category: "color", cssVar: "--spectrum-blue-100", location: "src/color-palette.json#/blue-100/sets/light" });
    expect(blueDark.rawValue).not.toEqual(blueLight.rawValue);
    // Theme-agnostic alias into themed tokens stays in its own set (engine resolves it per theme).
    const accent = by.get("semantic-color-palette")!.tokens.find((t) => t.name === "accent-color-100")!;
    expect(accent).toMatchObject({ rawValue: "{blue-100}", references: ["blue-100"], type: "color", tier: "semantic", cssVar: "--spectrum-accent-color-100" });
    // Scale-set values per scale; aliases that reach a scale-set token are carried into both scale sets.
    const desk = by.get("scale-desktop")!;
    const mob = by.get("scale-mobile")!;
    expect(desk.tokens.map((t) => t.name)).toEqual(mob.tokens.map((t) => t.name));
    const d = desk.tokens.find((t) => t.name === "accordion-bottom-to-text-extra-large")!;
    const m = mob.tokens.find((t) => t.name === "accordion-bottom-to-text-extra-large")!;
    expect(d.rawValue).not.toEqual(m.rawValue);
    expect(d).toMatchObject({ tier: "component", tierState: "verified", type: "dimension" });
    const alias = desk.tokens.find((t) => t.name === "accordion-bottom-to-text-regular-extra-large")!;
    expect(alias).toMatchObject({ rawValue: "{accordion-bottom-to-text-extra-large}", references: ["accordion-bottom-to-text-extra-large"], type: "dimension" });
    expect(by.get("component")!.tokens.some((t) => t.name === "accordion-bottom-to-text-regular-extra-large")).toBe(false);
    // Typography composite referencing a scale-set font size is scale-dependent too.
    expect(desk.tokens.find((t) => t.name === "component-l-bold")?.type).toBe("typography");
    expect(by.get("layout")!.tokens.find((t) => t.name === "spacing-100")).toMatchObject({ rawValue: "8px", cssVar: "--spectrum-spacing-100" });
    // Component ownership from the token `component` field.
    expect(r.componentTokens.get("button")).toEqual(["button-minimum-width-multiplier"]);
    // Every literal passes the shared value validator for its declared type.
    for (const s of r.sets) for (const t of s.tokens) if (!t.references.length) expect(validateTokenValue(t.type, t.rawValue).ok, `${s.slug}:${t.name}`).toBe(true);
    for (const s of r.sets) expect(s).toMatchObject({ packageName: "@adobe/spectrum-tokens", packageVersion: "15.6.0", redistribution: "permitted" });
  });
});

/* -------------------------------- site ----------------------------------- */

describe("spectrum.adobe.com", () => {
  const index = parseSiteIndex(fx("site-query-index.json"));

  it("groups implementation pages per component and finds pattern pages", () => {
    const comps = siteComponents(index.rows);
    const button = comps.find((c) => c.slug === "button")!;
    expect(button.pages.map((p) => p.impl)).toEqual(["rsp", "swc"]);
    expect(button.fragments).toContain("/fragments/components/button/accessibility");
    expect(comps.find((c) => c.slug === "rating")!.pages.map((p) => p.impl)).toEqual(["design-only"]);
    expect(sitePatternRows(index.rows).map((r) => r.path)).toEqual(["/content/voice-and-tone", "/foundations/app-frame/overview"]);
    expect(sitePlainUrl("/web/rsp/components/button")).toBe("https://spectrum.adobe.com/web/rsp/components/button.plain.html");
  });

  it("reads the component options data link from a page", () => {
    const p = parseSitePage(fx("site-button-rsp.plain.html"));
    expect(p).toMatchObject({ title: "Button", dataPath: "/deps/rsp/data/Button.json", dataName: "Button" });
    expect(p.headings).toContain("Accessibility");
  });

  it("parses states support, keyboard and WCAG tables", () => {
    const st = parseStatesFragment(fx("site-button-states.plain.html"));
    expect(st.filter((s) => s.supported).map((s) => s.name)).toEqual(["Default", "Hover", "Down", "Keyboard focus", "Disabled"]);
    expect(st.filter((s) => s.supported === false).map((s) => s.name)).toEqual(["Selected", "Dragged", "Error"]);
    const a = parseA11yFragment(fx("site-button-accessibility.plain.html"));
    expect(a.keyboard[0]).toEqual({ keys: "Tab", action: "Moves focus onto or off of the button." });
    expect(a.keyboard.map((k) => k.keys)).toEqual(["Tab", "Space or Enter"]);
    expect(a.wcag[0]).toMatchObject({ requirement: "Non-text content", criteria: ["1.1.1"], level: "A" });
    expect(a.wcag.flatMap((w) => w.criteria)).toContain("1.3.6");
    expect(a.keyboardSection).toBe(true);
    expect(componentLinks('<p><a href="/web/swc/components/progress-bar">x</a> <a href="https://spectrum.adobe.com/web/rsp/components/link#a">y</a></p>')).toEqual(["link", "progress-bar"]);
  });

  it("parses React Spectrum and Web Components options data", () => {
    const rsp = parseSiteData(fx("site-rsp-Button.json"))!;
    expect(rsp.status).toBe("stable");
    expect(rsp.props.find((p) => p.name === "variant")).toMatchObject({ kind: "enum", values: ["primary", "secondary", "accent", "negative", "premium", "genai"], defaultValue: "primary" });
    expect(rsp.props.find((p) => p.name === "children")?.required).toBe(true);
    const swc = parseSiteData(fx("site-swc-button.json"))!;
    expect(swc.status).toBeNull();
    expect(swc.props[1]).toMatchObject({ name: "fillStyle", attribute: "fill-style", required: true, defaultValue: "fill" });
    expect(parseSiteData("<html>")).toBeNull();
  });

  it("extracts principles from headings", () => {
    const p = parsePrinciples(fx("site-principles.plain.html"));
    expect(p.principles.map((x) => x.name)).toEqual(["Rational", "Human", "Focused", "Collaborative"]);
    expect(p.intro).toMatch(/^Spectrum's foundational principles/);
  });
});

/* ------------------------------ design data ------------------------------ */

describe("design-data component schema", () => {
  it("reads options, states, implementations and accessibility", () => {
    const s = parseComponentSchema(fx("schema-button.json"))!;
    expect(s).toMatchObject({ name: "button", displayName: "Button", role: "button" });
    expect(s.options.find((o) => o.name === "variant")).toMatchObject({ values: ["accent", "negative", "primary", "secondary"], defaultValue: "accent" });
    expect(s.options.find((o) => o.name === "size")?.values).toEqual(["s", "m", "l", "xl"]);
    expect(s.states).toEqual(["hover", "down", "focus", "disabled"]);
    expect(s.implementations).toEqual([
      { platform: "web", componentName: "Button", packageName: "@react-spectrum/s2", importPath: null },
      { platform: "web", componentName: "Button", packageName: "@adobe/spectrum-wc", importPath: "@adobe/spectrum-wc/components/button" },
    ]);
    expect(s.wcag).toEqual(["2.1.1", "4.1.2"]);
    expect(packageOfImportPath("lit/decorators")).toBe("lit");
    expect(parseComponentSchema("[]")).toBeNull();
  });
});

/* ------------------------------- docs markdown ------------------------------ */

describe("React Spectrum / React Aria docs markdown", () => {
  it("indexes llms.txt and keeps only component pages for components", () => {
    const e = parseLlms(fx("rsp-llms.txt"));
    expect(e.map((x) => x.page)).toEqual(["Button", "CheckboxGroup/testing", "ComboBox", "SideNavPanel", "forms", "icons", "releases/v1-8-0"]);
    expect(e.filter((x) => isComponentPage(x.page)).map((x) => x.page)).toEqual(["Button", "ComboBox", "SideNavPanel"]);
    expect(e.find((x) => x.page === "CheckboxGroup/testing")?.description).toBeNull();
    const rac = parseLlms(fx("rac-llms.txt"));
    expect(rac.map((x) => hookPageOf(x.page)).filter(Boolean)).toEqual([{ component: "Button", hook: "useButton" }]);
  });

  it("splits table rows without breaking code spans that contain pipes", () => {
    expect(splitRow("| `size` | `\"L\" | \"M\" | undefined` | 'M' | The size. |")).toEqual(["`size`", '`"L" | "M" | undefined`', "'M'", "The size."]);
    expect(literalUnion('"L" | "M" | "S" | "XL" | undefined')).toEqual(["L", "M", "S", "XL"]);
    expect(literalUnion("string | undefined")).toBeNull();
  });

  it("parses page description, sections, code and API tables", () => {
    const p = parseDocsMd(fx("rsp-Button.md"));
    expect(p.title).toBe("Button");
    expect(p.description).toMatch(/^Buttons allow users to perform an action\./);
    expect(p.sections.map((s) => s.title)).toEqual(["Events", "Pending", "API"]);
    expect(p.api.map((a) => a.name)).toEqual(["Button"]);
    const variant = p.api[0]!.props.find((x) => x.name === "variant")!;
    expect(variant).toMatchObject({ defaultValue: "primary", required: false, allowedValues: ["accent", "genai", "negative", "premium", "primary", "secondary"] });
    expect(p.api[0]!.props.find((x) => x.name === "children")?.type).toBe("ReactNode");
    expect(p.imports).toContain("@react-spectrum/s2/Button");
    const compact = compactPage(p);
    expect(compact.sections.find((s) => s.title === "Events")!.code[0]!.value).not.toMatch(/begin highlight/);
    expect(compact.sections.find((s) => s.title === "API")!.code).toEqual([]);
    expect(cleanExampleCode("a\n    /*- begin highlight -*/\n<B onPress={x}>\n{/*- end highlight -*/}\nc")).toBe("a\n<B onPress={x}>\nc");
  });

  it("assigns API tables to their export headings and marks required rows", () => {
    const p = parseDocsMd(fx("rac-ComboBox.md"));
    expect(p.api.map((a) => a.name)).toEqual(["ComboBox", "ComboBoxValue"]);
    expect(p.links).toContain("ListBox");
    const hook = parseDocsMd(fx("rac-useButton.md"));
    expect(hook.title).toBe("useButton");
    expect(hook.api[0]!.name).toBe("AriaButtonProps");
  });

  it("reads MDX metadata exports without executing anything", () => {
    const m = parseMdxMeta(fx("rsp-SideNavPanel.mdx"));
    expect(m).toMatchObject({ version: "alpha", primaryExport: "SideNavPanel", tags: ["navigation", "collapsible", "sidebar", "rail"] });
    expect(m.relatedPages).toEqual([{ title: "SideNav", url: "./SideNav" }]);
    const b = parseMdxMeta(fx("rac-Button.mdx"));
    expect(b).toMatchObject({ version: null, primaryExport: "Button", relatedPages: [{ title: "useButton", url: "./Button/useButton" }] });
  });

  it("derives export modules from npm listings", () => {
    expect(exportsFromListing(["/exports/Button.ts", "/exports/index.ts", "/src/Button.tsx", "/src/utils.ts"])).toEqual({ exports: ["Button"], srcFiles: ["Button"] });
    expect(exportsFromListing(["/dist/exports/ComboBox.mjs", "/dist/exports/ComboBox.mjs.map"]).exports).toEqual(["ComboBox"]);
    expect(releaseTag("@react-spectrum/s2", "1.8.2")).toBe("@react-spectrum/s2@1.8.2");
    expect(monorepoRaw("@react-spectrum/s2@1.8.2", "packages/@react-spectrum/s2/src/Button.tsx")).toBe(
      "https://raw.githubusercontent.com/adobe/react-spectrum/%40react-spectrum%2Fs2%401.8.2/packages/%40react-spectrum/s2/src/Button.tsx",
    );
    expect(monorepoBlob("react-aria-components@1.22.1", "a/b.tsx")).toBe("https://github.com/adobe/react-spectrum/blob/react-aria-components%401.22.1/a/b.tsx");
  });
});

/* -------------------------------- helpers -------------------------------- */

describe("helpers", () => {
  it("keeps the first sentence and maps lifecycle words", () => {
    expect(firstSentence("Buttons allow users to perform an action. They have multiple styles.")).toBe("Buttons allow users to perform an action.");
    expect(firstSentence("x".repeat(400))!.length).toBeLessThanOrEqual(280);
    expect(lifecycleFromStatus("alpha")).toBe("experimental");
    expect(lifecycleFromStatus("beta")).toBe("beta");
    expect(lifecycleFromStatus("stable")).toBe("stable");
    expect(lifecycleFromStatus("")).toBe("unknown");
  });
});

/* ------------------------------- normalize -------------------------------- */

function rspFragments(): SpectrumFragment[] {
  const origin = "https://react-spectrum.adobe.com";
  const md = (page: string, file: string): SpectrumFragment => ({ t: "md", page, md: compactPage(parseDocsMd(fx(file))), docsUrl: `${origin}/${page}`, ev: ev(`${origin}/${page}`, `${page}.md`) });
  const page = parseSitePage(fx("site-button-rsp.plain.html"));
  return [
    { t: "pkg", name: "@react-spectrum/s2", version: "1.8.2", publishedAt: "2026-10-15T23:31:33.590Z", license: "Apache-2.0", ev: ev("https://www.npmjs.com/package/@react-spectrum/s2/v/1.8.2", "@react-spectrum/s2@1.8.2") },
    { t: "llms", entries: parseLlms(fx("rsp-llms.txt")), ev: ev(`${origin}/llms.txt`, "llms.txt") },
    { t: "listing", pkg: "@react-spectrum/s2", version: "1.8.2", exports: ["Button", "ComboBox"], srcFiles: ["Button"], ev: ev("https://www.npmjs.com/package/@react-spectrum/s2/v/1.8.2?activeTab=code", "listing") },
    md("Button", "rsp-Button.md"),
    { t: "mdx", page: "Button", meta: parseMdxMeta(fx("rac-Button.mdx")), ref: "@react-spectrum/s2@1.8.2", ev: ev("https://github.com/adobe/react-spectrum/blob/x/Button.mdx", "packages/dev/s2-docs/pages/s2/Button.mdx") },
    { t: "src", page: "Button", url: "https://github.com/adobe/react-spectrum/blob/%40react-spectrum%2Fs2%401.8.2/packages/%40react-spectrum/s2/src/Button.tsx", ev: ev("https://github.com/adobe/react-spectrum/blob/x/Button.tsx", "packages/@react-spectrum/s2/src/Button.tsx") },
    { t: "site-page", slug: "button", impl: "rsp", path: "/web/rsp/components/button", page, data: parseSiteData(fx("site-rsp-Button.json")), dataEv: ev("https://spectrum.adobe.com/web/rsp/components/button", "/deps/rsp/data/Button.json"), ev: ev("https://spectrum.adobe.com/web/rsp/components/button", "/web/rsp/components/button.plain.html") },
    { t: "site-fragment", slug: "button", section: "states", states: parseStatesFragment(fx("site-button-states.plain.html")), a11y: null, links: [], ev: ev("https://spectrum.adobe.com/web/rsp/components/button", "/fragments/components/button/states.plain.html") },
    { t: "site-fragment", slug: "button", section: "accessibility", states: null, a11y: parseA11yFragment(fx("site-button-accessibility.plain.html")), links: [], ev: ev("https://spectrum.adobe.com/web/rsp/components/button", "/fragments/components/button/accessibility.plain.html") },
    { t: "guide", page: "forms", md: { ...parseDocsMd(fx("rsp-forms.md")), api: [] }, docsUrl: `${origin}/forms`, ev: ev(`${origin}/forms`, "forms.md") },
  ];
}

describe("normalizeReact", () => {
  it("builds a contract-valid React Spectrum bundle with site states and keyboard tables", () => {
    const bundle = normalizeReact("react-spectrum", rspFragments().map(wrap));
    expect(NormalizedBundle.safeParse(bundle).success).toBe(true);
    const b = bundle.components.find((c) => c.slug === "button")!;
    expect(b).toMatchObject({ name: "Button", docsUrl: "https://react-spectrum.adobe.com/Button", lifecycle: "stable", canonicalType: "button" });
    expect(b.classification?.state).toBe("inferred");
    expect(b.description).toBe("Buttons allow users to perform an action.");
    expect(b.frameworks).toEqual([{ slug: "react", packageName: "@react-spectrum/s2", importName: "Button", sourceUrl: expect.stringContaining("/src/Button.tsx") }]);
    expect(b.sizes).toEqual(["L", "M", "S", "XL"]);
    expect(b.variants.filter((v) => v.axis === "variant").map((v) => v.name)).toEqual(["accent", "genai", "negative", "premium", "primary", "secondary"]);
    expect(b.variants.filter((v) => v.axis === "appearance").map((v) => v.name)).toEqual(["fill", "outline"]);
    expect(b.states.map((s) => s.canonical)).toEqual(["default", "hover", "active", "focus", "disabled"]);
    expect(b.coverage.states).toBe("documented");
    expect(b.accessibility?.keyboard?.[0]).toEqual({ keys: "Tab", action: "Moves focus onto or off of the button." });
    expect(b.accessibility?.docsUrl).toBe("https://spectrum.adobe.com/web/rsp/components/button");
    expect(b.properties.every((p) => p.implementation === "react")).toBe(true);
    expect(b.examples.map((e) => e.slug)).toEqual(["events", "pending"]);
    expect(b.examples[0]).toMatchObject({ kind: "code-snippet", language: "tsx", attribution: expect.stringContaining("Apache-2.0") });
    for (const f of COMPONENT_FIELDS) expect(b.coverage[f], f).toBeDefined();
    expect(bundle.patterns.map((p) => [p.slug, p.canonicalType])).toEqual([["forms", "forms"]]);
    expect(bundle.facts).toMatchObject({ latestVersion: "1.8.2", latestReleaseAt: "2026-10-15T23:31:33.590Z", frameworks: [{ slug: "react", packageName: "@react-spectrum/s2" }] });
    expect(validateSpectrumBundle("react-spectrum", bundle, 2).filter((i) => i.severity === "error")).toEqual([]);
  });

  it("builds React Aria components with hook implementations, inferred states and prose a11y guidance", () => {
    const origin = "https://react-aria.adobe.com";
    const frs: SpectrumFragment[] = [
      { t: "md", page: "GridList", md: compactPage(parseDocsMd(fx("rac-GridList.md"))), docsUrl: `${origin}/GridList`, ev: ev(`${origin}/GridList`, "GridList.md") },
      { t: "md", page: "ComboBox", md: compactPage(parseDocsMd(fx("rac-ComboBox.md"))), docsUrl: `${origin}/ComboBox`, ev: ev(`${origin}/ComboBox`, "ComboBox.md") },
      { t: "md", page: "Button", md: compactPage(parseDocsMd(fx("rsp-Button.md"))), docsUrl: `${origin}/Button`, ev: ev(`${origin}/Button`, "Button.md") },
      { t: "hook", component: "Button", hook: "useButton", md: parseDocsMd(fx("rac-useButton.md")), docsUrl: `${origin}/Button/useButton`, ev: ev(`${origin}/Button/useButton`, "Button/useButton.md") },
      { t: "mdx", page: "Button", meta: parseMdxMeta(fx("rac-Button.mdx")), ref: "react-aria-components@1.22.1", ev: ev("https://github.com/adobe/react-spectrum/blob/x/Button.mdx", "Button.mdx") },
    ];
    const bundle = normalizeReact("react-aria", frs.map(wrap));
    expect(NormalizedBundle.safeParse(bundle).success).toBe(true);
    const cb = bundle.components.find((c) => c.slug === "combo-box")!;
    expect(cb.aliases).toEqual(["ComboBoxValue"]);
    expect(cb.states.map((s) => s.canonical).sort()).toEqual(["disabled", "error"]);
    expect(cb.coverage.states).toBe("inferred");
    expect(cb.relationships).toEqual([]);
    expect(cb.properties.some((p) => p.name === "onPointerDown")).toBe(false); // undescribed DOM pass-through omitted
    const gl = bundle.components.find((c) => c.slug === "grid-list")!;
    expect(gl.accessibility?.guidance).toMatch(/^Keyboard navigation: By default, GridList uses arrow key navigation/);
    expect(gl.coverage.keyboard).toBe("not-extracted");
    expect(gl.properties.some((p) => p.name === "onMouseDown")).toBe(false);
    const btn = bundle.components.find((c) => c.slug === "button")!;
    expect([...new Set(btn.properties.map((p) => p.implementation))].sort()).toEqual(["react", "react:useButton"]);
    expect(btn.aliases).toContain("useButton");
    expect(btn.lifecycle).toBe("stable");
    expect(bundle.facts).toBeNull();
  });
});

describe("normalizeDesign", () => {
  it("joins guideline pages, design-data schemas and tokens into an adobe-spectrum bundle", () => {
    const index = parseSiteIndex(fx("site-query-index.json"));
    const page = parseSitePage(fx("site-button-rsp.plain.html"));
    const site = "https://spectrum.adobe.com";
    const tokenFrags: SpectrumFragment[] = tokenInputs().map((t) => ({ t: "tokens", file: t.file, tokens: t.tokens, ev: t.ev }));
    const frs: SpectrumFragment[] = [
      { t: "pkg", name: "@adobe/spectrum-tokens", version: "15.6.0", publishedAt: "2026-10-16T20:45:24.948Z", license: "Apache-2.0", ev: ev("https://www.npmjs.com/package/@adobe/spectrum-tokens/v/15.6.0", "@adobe/spectrum-tokens@15.6.0") },
      { t: "site-index", rows: index.rows, ev: ev(`${site}/query-index.json`, "/query-index.json") },
      { t: "site-page", slug: "button", impl: "rsp", path: "/web/rsp/components/button", page, data: parseSiteData(fx("site-rsp-Button.json")), dataEv: ev(`${site}/web/rsp/components/button`, "/deps/rsp/data/Button.json"), ev: ev(`${site}/web/rsp/components/button`, "/web/rsp/components/button.plain.html") },
      { t: "site-page", slug: "button", impl: "swc", path: "/web/swc/components/button", page: { ...page, dataPath: "/deps/swc/data/swc-button.json", dataName: "swc-button", links: ["link"] }, data: parseSiteData(fx("site-swc-button.json")), dataEv: ev(`${site}/web/swc/components/button`, "/deps/swc/data/swc-button.json"), ev: ev(`${site}/web/swc/components/button`, "/web/swc/components/button.plain.html") },
      { t: "site-fragment", slug: "button", section: "states", states: parseStatesFragment(fx("site-button-states.plain.html")), a11y: null, links: [], ev: ev(`${site}/web/rsp/components/button`, "/fragments/components/button/states.plain.html") },
      { t: "site-fragment", slug: "button", section: "accessibility", states: null, a11y: parseA11yFragment(fx("site-button-accessibility.plain.html")), links: [], ev: ev(`${site}/web/rsp/components/button`, "/fragments/components/button/accessibility.plain.html") },
      { t: "schema", name: "button", schema: parseComponentSchema(fx("schema-button.json"))!, ev: ev("https://cdn.jsdelivr.net/npm/@adobe/spectrum-design-data@3.8.2/components/button.json", "components/button.json") },
      { t: "principles", data: parsePrinciples(fx("site-principles.plain.html")), url: `${site}/getting-started/principles`, ev: ev(`${site}/getting-started/principles`, "/getting-started/principles.plain.html") },
      { t: "cssvars", names: declaredCustomProperties(fx("spectrum-css-vars.css")), pkg: "@spectrum-css/tokens", version: "16.0.2", ev: ev("https://cdn.jsdelivr.net/npm/@spectrum-css/tokens@16.0.2/dist/css/index.css", "dist/css/index.css") },
      ...tokenFrags,
    ];
    const { tokenReport, ...bundle } = normalizeDesign(frs.map(wrap));
    expect(tokenReport).toEqual({ skipped: [], themedToScale: [] });
    const parsed = NormalizedBundle.safeParse(bundle);
    expect(parsed.success, JSON.stringify(parsed.error?.issues?.slice(0, 3))).toBe(true);
    expect(bundle.components.map((c) => c.slug)).toEqual(["button", "link", "rating"]);
    const b = bundle.components[0]!;
    expect(b).toMatchObject({ name: "Button", docsUrl: `${site}/web/rsp/components/button`, lifecycle: "stable", canonicalType: "button" });
    expect(b.description).toBe("Buttons enable actions or navigation between views.");
    expect(b.variants.filter((v) => v.axis === "variant").map((v) => v.name)).toEqual(["accent", "negative", "primary", "secondary"]);
    expect(b.variants.filter((v) => v.axis === "appearance").map((v) => v.name)).toEqual(["fill", "outline"]);
    expect(b.sizes).toEqual(["s", "m", "l", "xl"]);
    expect(b.states.map((s) => s.name)).toEqual(["Default", "Hover", "Down", "Keyboard focus", "Disabled"]);
    expect(b.frameworks).toEqual([
      { slug: "react", packageName: "@react-spectrum/s2", importName: "Button", sourceUrl: `${site}/web/rsp/components/button` },
      { slug: "web-components", packageName: "@adobe/spectrum-wc", importName: "Button", sourceUrl: `${site}/web/swc/components/button` },
    ]);
    expect([...new Set(b.properties.map((p) => p.implementation))]).toEqual(["default", "react", "web-components"]);
    expect(b.properties.find((p) => p.implementation === "web-components")?.name).toBe("variant");
    expect(b.accessibility).toMatchObject({ roles: ["button"], keyboard: [{ keys: "Tab" }, { keys: "Space or Enter" }] });
    expect(b.accessibility?.wcagCriteria).toEqual(expect.arrayContaining(["1.1.1", "2.1.1", "4.1.2"]));
    expect(b.tokenUsages).toEqual([{ tokenName: "button-minimum-width-multiplier", property: null }]);
    expect(b.relationships).toEqual([{ kind: "related", targetSlug: "link", targetType: null }]);
    expect(b.examples.map((e) => e.slug)).toEqual(["rsp-guidelines", "swc-guidelines"]);
    const rating = bundle.components.find((c) => c.slug === "rating")!;
    expect(rating.frameworks).toEqual([]);
    expect(rating.coverage.frameworks).toBe("documented-none");
    expect(bundle.patterns.map((p) => [p.slug, p.canonicalType, p.classification?.state])).toEqual([
      ["voice-and-tone", "content-and-writing", "inferred"],
      ["app-frame-overview", "layout-and-structure", "inferred"],
    ]);
    expect(bundle.facts?.principles?.map((p) => p.name)).toEqual(["Rational", "Human", "Focused", "Collaborative"]);
    expect(bundle.facts?.latestVersion).toBe("15.6.0");
    expect(bundle.facts?.frameworks).toEqual([{ slug: "react", packageName: "@react-spectrum/s2" }, { slug: "web-components", packageName: "@adobe/spectrum-wc" }]);
    for (const f of ["latestVersion", "principles", "philosophy", "frameworks"]) expect(bundle.facts?.evidence.some((e) => e.field === f), f).toBe(true);
    expect(bundle.tokenSets.find((s) => s.slug === "color-light")?.evidence.some((e) => e.field === "cssVar")).toBe(true);
    const errors = validateSpectrumBundle("adobe-spectrum", bundle, 3).filter((i) => i.severity === "error");
    expect(errors).toEqual([]);
  });

  it("is deterministic regardless of fragment order", () => {
    const frs = tokenInputs().map((t): SpectrumFragment => ({ t: "tokens", file: t.file, tokens: t.tokens, ev: t.ev }));
    const a = normalizeDesign(frs.map(wrap));
    const b = normalizeDesign([...frs].reverse().map(wrap));
    expect(JSON.stringify(a.tokenSets)).toBe(JSON.stringify(b.tokenSets));
  });
});

describe("adapter", () => {
  it("declares the three Spectrum systems", () => {
    expect(adapter.id).toBe("spectrum");
    expect(adapter.systems).toEqual(["adobe-spectrum", "react-spectrum", "react-aria"]);
  });

  it("flags duplicates and missing well-known components on full runs", () => {
    const bundle = normalizeReact("react-aria", []);
    const issues = validateSpectrumBundle("react-aria", bundle);
    expect(issues.some((i) => i.code === "REQUIRED_FIELD" && /button/.test(i.message))).toBe(true);
  });
});
