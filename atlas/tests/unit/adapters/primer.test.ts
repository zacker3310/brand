import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { NormalizedBundle } from "@/lib/contracts";
import { assignSlugs, normalizePrimer, selectComponents, sitemapPageType } from "@/ingestion/adapters/primer/normalize";
import { parseComponentsJson, sourceDir } from "@/ingestion/adapters/primer/components-json";
import { parseCssVarUsages } from "@/ingestion/adapters/primer/css-usage";
import { canonicalDocsUrl, extractRoles, parseComponentPage, parseSimplePage, parseSitemap } from "@/ingestion/adapters/primer/docs-pages";
import type { NpmInfo, PrimerFragmentData, SourceStamp } from "@/ingestion/adapters/primer/fragments";
import { Json5SyntaxError, parseJson5 } from "@/ingestion/adapters/primer/json5";
import { parseStringLiteralUnion, shortText } from "@/ingestion/adapters/primer/text";
import { parsePrimitivesDocsJson, parsePrimitivesJson5 } from "@/ingestion/adapters/primer/tokens";
import { validatePrimerBundle } from "@/ingestion/adapters/primer/validate";
import { adapter } from "@/ingestion/adapters/primer";

const FIX = path.resolve(import.meta.dirname, "../../fixtures/adapters/primer");
const fx = (f: string) => readFileSync(path.join(FIX, f), "utf8");
const DOCS = "https://primer.style/product/components";

describe("primer json5 parser", () => {
  it("parses JSON5 syntax used by @primer/primitives sources", () => {
    const v = parseJson5(`// line comment
      /* block */ {
        unquoted: 'single \\'quoted\\'',
        "double": "a\\nb",
        'org.primer.figma': { collection: 'base', },
        list: [1, +2, -3.5, .5, 5., 0x1F, Infinity, ],
        nested: { t: true, f: false, n: null },
        cont: 'line \\
continued',
      }`) as Record<string, unknown>;
    expect(v.unquoted).toBe("single 'quoted'");
    expect(v.double).toBe("a\nb");
    expect(v["org.primer.figma"]).toEqual({ collection: "base" });
    expect(v.list).toEqual([1, 2, -3.5, 0.5, 5, 31, Infinity]);
    expect(v.nested).toEqual({ t: true, f: false, n: null });
    expect(v.cont).toBe("line continued");
  });

  it("is safe against prototype keys and keeps the last duplicate key", () => {
    const v = parseJson5(`{ __proto__: { polluted: true }, a: 1, a: 2 }`) as Record<string, unknown>;
    expect(Object.getPrototypeOf(v)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(v, "__proto__")).toBe(true);
    expect(v.a).toBe(2);
  });

  it("rejects malformed input with a position", () => {
    expect(() => parseJson5(`{ a: 1 `)).toThrow(Json5SyntaxError);
    expect(() => parseJson5(`{ a: 'x' } trailing`)).toThrow(/trailing/i);
    expect(() => parseJson5(`{ a: @ }`)).toThrow(/Unexpected character/);
  });
});

describe("primer text helpers", () => {
  it("shortText keeps whole sentences and never drops leading text", () => {
    const s = "Performs the default action (e.g. onclick event) for the focused node. Second sentence here. Third one.";
    expect(shortText(s, 80)).toBe("Performs the default action (e.g. onclick event) for the focused node.");
    expect(shortText("x".repeat(300), 50)!.length).toBe(50);
  });
  it("parses string literal unions only", () => {
    expect(parseStringLiteralUnion("'small'\n| 'medium'\n| 'large'")).toEqual(["small", "medium", "large"]);
    expect(parseStringLiteralUnion("'a' | boolean")).toBeNull();
    expect(parseStringLiteralUnion("React.ReactNode")).toBeNull();
  });
});

describe("primer tokens", () => {
  it("parses base color JSON5 (DTCG) with alpha preserved and references kept", () => {
    const { tokens } = parsePrimitivesJson5(fx("base-color-light.json5"), "src/tokens/base/color/light/light.json5");
    const by = new Map(tokens.map((t) => [t.name, t]));
    expect([...by.keys()]).toEqual(["base.color.black", "base.color.neutral.0", "base.color.neutral.13", "base.color.transparent", "base.color.white"]);
    expect(by.get("base.color.black")!.rawValue).toEqual({ colorSpace: "hsl", components: [213.3, 12.7, 13.9], hex: "#1f2328" });
    expect(by.get("base.color.transparent")!.rawValue).toEqual({ value: { colorSpace: "hsl", components: [0, 0, 100], hex: "#ffffff" }, alpha: 0 });
    const n0 = by.get("base.color.neutral.0")!;
    expect(n0.rawValue).toBe("{base.color.white}");
    expect(n0.references).toEqual(["base.color.white"]);
    expect(n0.cssVar).toBe("--base-color-neutral-0");
    expect(n0.tier).toBe("primitive");
    expect(n0.tierState).toBe("verified");
    expect(n0.category).toBe("color");
    expect(n0.location).toBe("src/tokens/base/color/light/light.json5#/base/color/neutral/0");
  });

  it("parses themed docs JSON keeping authored per-theme values and override locations", () => {
    const dark = new Map(parsePrimitivesDocsJson(fx("primitives-docs-dark.json"), "dark").tokens.map((t) => [t.name, t]));
    const light = new Map(parsePrimitivesDocsJson(fx("primitives-docs-light.json"), "light").tokens.map((t) => [t.name, t]));
    const fgD = dark.get("fgColor.default")!;
    expect(fgD.rawValue).toBe("{base.color.neutral.12}");
    expect(fgD.cssVar).toBe("--fgColor-default");
    expect(fgD.location).toBe("src/tokens/functional/color/fgColor.json5#/fgColor/default/$extensions/org.primer.overrides/dark");
    expect(fgD.tier).toBe("semantic");
    expect(light.get("fgColor.default")!.rawValue).toBe("{base.color.neutral.13}");
    expect(light.get("fgColor.default")!.location).toBe("src/tokens/functional/color/fgColor.json5#/fgColor/default");
    expect(dark.get("avatar.bgColor")!.rawValue).toEqual({ value: "{base.color.neutral.13}", alpha: 0.1 });
    expect(dark.get("avatar.bgColor")!.tier).toBe("component");
    const dep = dark.get("color.ansi.black")!;
    expect(dep.deprecated).toBe(true);
    expect(dep.references).toEqual(["ansi.black"]);
    const border = dark.get("border.default")!;
    expect(border.type).toBe("border");
    expect(border.references.sort()).toEqual(["borderColor.default", "borderWidth.default"]);
    expect(dark.get("button.primary.bgColor.rest")!.references).toEqual(["bgColor.success.emphasis"]);
  });

  it("classifies base sizes as primitive spacing", () => {
    const { tokens } = parsePrimitivesDocsJson(fx("primitives-docs-base-size.json"), null);
    expect(tokens.map((t) => [t.name, t.category, t.tier])).toEqual([
      ["base.size.4", "spacing", "primitive"],
      ["base.size.8", "spacing", "primitive"],
    ]);
    expect(tokens[0]!.rawValue).toEqual({ value: 4, unit: "px" });
  });
});

describe("primer components.json", () => {
  const data = parseComponentsJson(fx("components.json"));

  it("parses entries deterministically with props, stories and pointers", () => {
    expect(data.schemaVersion).toBe(2);
    expect(data.components.map((c) => c.id)).toEqual(["action_menu", "button", "data_table", "text_input", "text_input_with_tokens", "tooltip", "tooltip_v2"]);
    const button = data.components.find((c) => c.id === "button")!;
    expect(button.status).toBe("alpha");
    expect(button.importPath).toBe("@primer/react");
    const variant = button.props.find((p) => p.name === "variant")!;
    expect(variant.type).toBe("'default' | 'primary' | 'danger' | 'invisible' | 'link'");
    expect(variant.defaultValue).toBe("'default'");
    expect(variant.pointer).toMatch(/^\/components\/button\/props\/\d+$/);
    expect(button.props.find((p) => p.name === "leadingIcon")!.deprecated).toBe(true);
    expect(button.props.find((p) => p.name === "disabled")!.defaultValue).toBeNull(); // "" => no documented default
    expect(button.stories[0]).toEqual({ id: "components-button--default", code: "() => <Button>Default</Button>" });
    expect(sourceDir(button.source)).toBe("Button");
    expect(sourceDir("https://github.com/primer/react/tree/main/packages/react/src/deprecated/DialogV1")).toBe("deprecated/DialogV1");
  });

  it("assigns stable unique slugs for same-named components", () => {
    const slugs = assignSlugs(data.components);
    expect(slugs.get("tooltip_v2")).toBe("tooltip");
    expect(slugs.get("tooltip")).toBe("tooltip-deprecated");
    expect(slugs.get("text_input_with_tokens")).toBe("text-input-with-tokens");
    expect(new Set(slugs.values()).size).toBe(slugs.size);
    expect(selectComponents(data.components, 2).map((c) => c.name)).toEqual(["Button", "ActionMenu"]);
  });
});

describe("primer css usage", () => {
  it("extracts var() usages per property, including nested fallbacks", () => {
    const u = parseCssVarUsages(fx("ButtonBase.css"));
    expect(u).toContainEqual({ varName: "--borderWidth-thin", property: "border" });
    expect(u).toContainEqual({ varName: "--button-default-fgColor-rest", property: "color" });
    expect(u).toContainEqual({ varName: "--focus-outlineColor", property: "outline" });
    expect(u).toContainEqual({ varName: "--control-medium-paddingInline-normal", property: "padding" });
    expect(new Set(u.map((x) => `${x.varName}|${x.property}`)).size).toBe(u.length);
  });
});

describe("primer docs pages", () => {
  it("parses the sitemap and classifies sub-pages (including sitemap typos)", () => {
    const urls = parseSitemap(fx("sitemap.xml"));
    expect(urls).toHaveLength(8);
    expect(sitemapPageType(canonicalDocsUrl(`${DOCS}/anchored-overlay/acessibility`)!)).toBe("accessibility");
    expect(sitemapPageType(canonicalDocsUrl(`${DOCS}/nav-list/guidlines`)!)).toBe("guidelines");
    expect(sitemapPageType(canonicalDocsUrl(`${DOCS}/button`)!)).toBe("overview");
    expect(canonicalDocsUrl("/product/components/button?x=1#y")).toBe(`${DOCS}/button/`);
  });

  it("parses an overview page: header, implementation cards, example anchors", () => {
    const p = parseComponentPage(fx("button-overview.html"), `${DOCS}/button/`, "overview");
    expect(p.title).toBe("Button");
    expect(p.description).toBe("Button is used to initiate actions on a page or form.");
    expect(p.implementations.map((i) => [i.label, i.status])).toEqual([
      ["React", "ready"],
      ["Rails", "ready"],
      ["Figma", null],
    ]);
    expect(p.implementations[0]!.links.find((l) => l.text === "Source")!.href).toBe("https://github.com/primer/react/tree/main/packages/react/src/Button");
    expect(p.implementations[2]!.links[0]!.href).toBe("https://www.figma.com/file/GCvY3Qv8czRgZgvl1dG6lp/?node-id=30258%3A5582");
    expect(p.examples.map((e) => e.id)).toEqual(["default", "style-variants", "full-width"]);
  });

  it("collects in-content links to other component pages", () => {
    const p = parseComponentPage(fx("button-guidelines.html"), `${DOCS}/button/guidelines/`, "guidelines");
    expect(p.componentLinks).toEqual([`${DOCS}/select-panel/`, `${DOCS}/action-menu/`]);
  });

  it("extracts keyboard tables, roles, focus and screen reader notes (TreeView)", () => {
    const a = parseComponentPage(fx("tree-view-accessibility.html"), `${DOCS}/tree-view/accessibility/`, "accessibility").a11y!;
    expect(a.keyboard.map((k) => k.keys)).toEqual(["Enter", "Tab", "ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft", "Home", "End", "a-z, A-Z, all printable characters"]);
    expect(a.keyboard[2]!.action).toMatch(/^Moves focus to the next node/);
    expect(a.keyboard[0]!.anchor).toBe("keyboard-navigation");
    expect(a.roles).toEqual(expect.arrayContaining(["tree", "group", "treeitem"]));
    expect(a.focusManagement!.text).toMatch(/first time, focus on the first node/);
    expect(a.screenReader!.text).toMatch(/logical reading order/);
    expect(a.guidance).toMatch(/^The TreeView replicates the experience/);
  });

  it("extracts contextual keyboard tables, roles and the APG pattern link (ActionMenu)", () => {
    const a = parseComponentPage(fx("action-menu-accessibility.html"), `${DOCS}/action-menu/accessibility/`, "accessibility").a11y!;
    expect(a.keyboard[0]).toMatchObject({ keys: "Enter", action: "Opens the menu.", context: "Trigger button" });
    expect(a.keyboard.find((k) => k.keys === "Esc")).toMatchObject({ action: "Close menu", context: "Menu items" });
    expect(a.roles.slice(0, 4)).toEqual(["menu", "menuitem", "menuitemcheckbox", "menuitemradio"]);
    expect(a.apgPatterns).toContain("menu-button");
  });

  it("extracts heading-style keys (SegmentedControl)", () => {
    const a = parseComponentPage(fx("segmented-control-accessibility.html"), `${DOCS}/segmented-control/accessibility/`, "accessibility").a11y!;
    expect(a.keyboard.map((k) => k.keys)).toEqual(["Tab", "Enter or Space", "Arrow Left or Arrow Right"]);
    expect(a.keyboard[1]!.action).toBe("Selects a focused, unselected button. Pressing again on a selected button does nothing.");
  });

  it("extracts prose keyboard requirements and skips conditional role statements (ButtonGroup)", () => {
    const a = parseComponentPage(fx("button-group-accessibility.html"), `${DOCS}/button-group/accessibility/`, "accessibility").a11y!;
    expect(a.keyboard.map((k) => k.keys)).toEqual(["Tab", "Enter / Space", "Arrow keys"]);
    expect(a.keyboard[2]!.action).toMatch(/^When role="toolbar" is used/);
    expect(a.roles).toEqual([]);
    expect(extractRoles('The component itself has a role="menu" and each item a role of menuitem')).toEqual(["menuitem", "menu"]);
  });

  it("parses simple pages (patterns, getting started)", () => {
    const p = parseSimplePage(fx("empty-states.html"), "https://primer.style/product/ui-patterns/empty-states/");
    expect(p.title).toBe("Empty states");
    expect(p.componentLinks).toEqual([`${DOCS}/blankslate/`]);
    const g = parseSimplePage(fx("getting-started.html"), "https://primer.style/product/getting-started/");
    expect(g.headings.map((h) => h.text)).toEqual(["A cohesive experience", "Inclusive and accessible design", "Design for efficiency", "The Zen of GitHub"]);
  });
});

describe("primer normalize + validate (fixtures, no network)", () => {
  const stamp = (url: string): SourceStamp => ({ url, evidenceUrl: url, retrievedAt: "2026-11-05T00:00:00.000Z", hash: "abc123" });
  const react: NpmInfo = { packageName: "@primer/react", version: "38.44.0", publishedAt: "2026-11-03T16:40:52.057Z", license: "MIT" };
  const prim: NpmInfo = { packageName: "@primer/primitives", version: "11.10.0", publishedAt: null, license: "MIT" };
  const cjUrl = "https://cdn.jsdelivr.net/npm/@primer/react@38.44.0/generated/components.json";
  const page = (file: string, url: string, type: "overview" | "guidelines" | "accessibility"): PrimerFragmentData => ({
    type: "component-page",
    stamp: stamp(url),
    page: parseComponentPage(fx(file), url, type),
  });
  const fragments: PrimerFragmentData[] = [
    {
      type: "sitemap",
      stamp: stamp("https://primer.style/sitemap.xml"),
      urls: [...parseSitemap(fx("sitemap.xml")), `${DOCS}/action-menu`, `${DOCS}/action-menu/accessibility`, `${DOCS}/tooltip`, `${DOCS}/select-panel`],
    },
    { type: "components-json", stamp: stamp(cjUrl), npm: react, file: "generated/components.json", data: parseComponentsJson(fx("components.json")) },
    { type: "license", stamp: stamp("https://raw.githubusercontent.com/primer/react/x/LICENSE"), npm: react, copyright: "Copyright (c) 2018 GitHub, Inc" },
    page("button-overview.html", `${DOCS}/button/`, "overview"),
    page("button-guidelines.html", `${DOCS}/button/guidelines/`, "guidelines"),
    page("action-menu-accessibility.html", `${DOCS}/action-menu/accessibility/`, "accessibility"),
    { type: "css", stamp: stamp("https://cdn.jsdelivr.net/npm/@primer/react@38.44.0/dist/Button/ButtonBase-c8dab214.css"), npm: react, file: "dist/Button/ButtonBase-c8dab214.css", dir: "Button", usages: parseCssVarUsages(fx("ButtonBase.css")) },
    {
      type: "tokens",
      stamp: stamp("https://cdn.jsdelivr.net/npm/@primer/primitives@11.10.0/dist/docs/base/size/size.json"),
      npm: prim,
      setSlug: "primitives-base-size",
      file: "dist/docs/base/size/size.json",
      tokens: parsePrimitivesDocsJson(fx("primitives-docs-base-size.json"), null).tokens,
      warnings: [],
    },
    {
      type: "tokens",
      stamp: stamp("https://cdn.jsdelivr.net/npm/@primer/primitives@11.10.0/dist/docs/functional/themes/dark.json"),
      npm: prim,
      setSlug: "primitives-theme-dark",
      file: "dist/docs/functional/themes/dark.json",
      tokens: parsePrimitivesDocsJson(fx("primitives-docs-dark.json"), "dark").tokens,
      warnings: [],
    },
    { type: "pattern-page", stamp: stamp("https://primer.style/product/ui-patterns/empty-states/"), section: "ui", sectionLabel: "UI pattern", page: parseSimplePage(fx("empty-states.html"), "https://primer.style/product/ui-patterns/empty-states/") },
    { type: "system-page", stamp: stamp("https://primer.style/product/getting-started/"), key: "gettingStarted", page: parseSimplePage(fx("getting-started.html"), "https://primer.style/product/getting-started/") },
  ];
  const bundle = normalizePrimer(fragments, { systemSlug: "github-primer" });

  it("produces a contract-valid bundle", () => {
    const r = NormalizedBundle.safeParse(bundle);
    if (!r.success) throw new Error(JSON.stringify(r.error.issues.slice(0, 5), null, 2));
    expect(bundle.components.map((c) => c.slug)).toEqual(["action-menu", "button", "data-table", "text-input", "text-input-with-tokens", "tooltip", "tooltip-deprecated"]);
  });

  it("maps Button from docs.json + docs pages with honest coverage", () => {
    const b = bundle.components.find((c) => c.slug === "button")!;
    expect(b.description).toBe("Button is used to initiate actions on a page or form.");
    expect(b.docsUrl).toBe(`${DOCS}/button/`);
    expect(b.lifecycle).toBe("stable"); // React card "ready"; docs.json says "alpha"
    expect(b.variants.map((v) => v.name)).toEqual(["default", "primary", "danger", "invisible", "link"]);
    expect(b.sizes).toEqual(["small", "medium", "large"]);
    expect(b.states.map((s) => [s.name, s.canonical])).toEqual([
      ["disabled", "disabled"],
      ["inactive", "inactive"],
      ["loading", "loading"],
    ]);
    expect(b.frameworks.map((f) => f.slug)).toEqual(["react", "figma"]);
    expect(b.classification).toMatchObject({ state: "inferred" });
    expect(b.examples.find((e) => e.kind === "code-snippet")!.attribution).toMatch(/MIT License/);
    expect(b.examples.filter((e) => e.kind === "docs-link").map((e) => e.url)).toContain(`${DOCS}/button/#style-variants`);
    expect(b.relationships).toEqual([{ kind: "see-also", targetSlug: "action-menu", targetType: null }]);
    expect(b.tokenUsages).toContainEqual({ tokenName: "base.size.8", property: "gap" });
    expect(b.coverage).toMatchObject({ variants: "documented", sizes: "documented", states: "inferred", accessibility: "not-extracted", tokens: "inferred" });
    expect(b.evidence.some((e) => e.field === "frameworks.rails")).toBe(true);
  });

  it("verifies classification only via an explicit APG link and records composes/dedupes props", () => {
    const am = bundle.components.find((c) => c.slug === "action-menu")!;
    expect(am.canonicalType).toBe("menu-button");
    expect(am.classification).toMatchObject({ state: "verified" });
    expect(am.accessibility!.keyboard!.length).toBeGreaterThan(5);
    const tw = bundle.components.find((c) => c.slug === "text-input-with-tokens")!;
    expect(tw.relationships).toContainEqual({ kind: "composes", targetSlug: "text-input", targetType: null });
    const dt = bundle.components.find((c) => c.slug === "data-table")!;
    expect(dt.properties.map((p) => p.name)).toEqual(["aria-describedby", "aria-labelledby"]);
    expect(dt.frameworks[0]!.packageName).toBe("@primer/react/experimental");
    const ti = bundle.components.find((c) => c.slug === "text-input")!;
    expect(ti.states.map((s) => s.name)).toEqual(expect.arrayContaining(["disabled", "error", "success"]));
    const dep = bundle.components.find((c) => c.slug === "tooltip-deprecated")!;
    expect(dep.docsUrl).toBeNull();
    expect(dep.lifecycle).toBe("deprecated");
    expect(dep.coverage.description).toBe("not-documented");
  });

  it("emits token sets with package, license and evidence", () => {
    const dark = bundle.tokenSets.find((s) => s.slug === "primitives-theme-dark")!;
    expect(dark.theme).toBe("dark");
    expect(dark.packageVersion).toBe("11.10.0");
    expect(dark.license?.spdxId).toBe("MIT");
    expect(dark.redistribution).toBe("permitted");
    expect(dark.evidence[0]!.contentHash).toBe("abc123");
  });

  it("builds patterns and system facts with evidence", () => {
    expect(bundle.patterns).toHaveLength(1);
    expect(bundle.patterns[0]).toMatchObject({ slug: "empty-states", canonicalType: "empty-states", componentSlugs: [] });
    expect(bundle.facts!.latestVersion).toBe("38.44.0");
    expect(bundle.facts!.principles!.map((p) => p.name)).toContain("Design for efficiency");
    expect(bundle.facts!.philosophy).toMatch(/built by GitHub for GitHub/);
    expect(bundle.facts!.evidence.some((e) => e.field === "philosophy")).toBe(true);
  });

  it("validates without errors in limited mode and flags missing essentials in full mode", () => {
    expect(validatePrimerBundle(bundle, { limit: 7 }).filter((i) => i.severity === "error")).toEqual([]);
    const full = validatePrimerBundle(bundle);
    expect(full.some((i) => i.severity === "error" && /functional light theme/.test(i.message))).toBe(true);
  });

  it("parse() routes fragments by docKind without network", async () => {
    const ctx = { systemSlug: "github-primer", runStartedAt: "2026-11-05T00:00:00.000Z", log: { info() {}, warn() {}, error() {} } } as never;
    const frag = await adapter.parse(ctx, {
      doc: { url: "https://primer.style/sitemap.xml", docKind: "primer-sitemap", source: { kind: "docs", url: "https://primer.style/" } },
      result: { url: "", finalUrl: "https://primer.style/sitemap.xml", status: 200, ok: true, notModified: false, fromCache: false, contentType: "application/xml", etag: null, lastModified: null, body: fx("sitemap.xml"), hash: "h", byteSize: 1, fetchedAt: "2026-11-05T00:00:00.000Z", attempts: 1, blockedByRobots: false, error: null },
    });
    expect((frag as { data: { type: string; urls: string[] } }).data.urls).toHaveLength(8);
    expect(adapter.systems).toEqual(["github-primer"]);
  });
});
