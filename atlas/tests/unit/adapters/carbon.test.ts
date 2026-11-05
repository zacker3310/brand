/**
 * Carbon adapter parser tests. Fixtures in tests/fixtures/adapters/carbon are short excerpts of
 * real Carbon sources (carbon-website MDX/data, @carbon/* npm files, live docs page payload),
 * Apache-2.0, Copyright IBM Corp. No network access.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { COMPONENT_FIELDS, NormalizedBundle } from "@/lib/contracts";
import { adapter } from "@/ingestion/adapters/carbon";
import {
  keyLabel,
  parseA11y,
  parseAbout,
  parseCode,
  parseComponentIndex,
  parseNav,
  parseSitemapLocs,
  parseStyle,
  parseUsage,
} from "@/ingestion/adapters/carbon/docs";
import { lifecycleFromLabel, parseLiveMeta } from "@/ingestion/adapters/carbon/live";
import { normalizeCarbon, type CarbonFragment, type Ev } from "@/ingestion/adapters/carbon/normalize";
import { liveComponentUrl } from "@/ingestion/adapters/carbon/constants";
import { planComponents, planPatterns, resolveReact, reactFileIndex } from "@/ingestion/adapters/carbon/plan";
import { destructuringDefaults, extractPropTypes, mapPropType, splitTopLevel } from "@/ingestion/adapters/carbon/proptypes";
import {
  declaredCssVars,
  parseDtcgFile,
  parseFontFamilies,
  parseTypeScale,
  parseTypeStyles,
  pointerRefName,
  rootCustomProperties,
} from "@/ingestion/adapters/carbon/tokens";
import { parseWcaManifest } from "@/ingestion/adapters/carbon/wca";

const FX = path.resolve(import.meta.dirname, "../../fixtures/adapters/carbon");
const fx = (f: string) => readFileSync(path.join(FX, f), "utf8");

const ev = (sourceUrl: string, location: string): Ev => ({ sourceUrl, retrievedAt: "2026-11-05T00:00:00.000Z", contentHash: "abc", location });

describe("carbon nav + component index", () => {
  it("lists component and pattern pages from nav-items.yaml, skipping Overview and preserving folder case", () => {
    const nav = parseNav(fx("nav-items.yaml"));
    expect(nav.components.map((c) => c.title)).toEqual(["Accordion", "Button", "Dropdown", "Menu buttons", "UI shell header"]);
    expect(nav.components.find((c) => c.title === "UI shell header")?.slug).toBe("UI-shell-header");
    expect(nav.patterns.map((p) => p.slug)).toEqual(["dialog-pattern", "empty-states-pattern", "forms-pattern"]);
    expect(nav.aboutPath).toBe("/all-about-carbon/what-is-carbon/");
  });

  it("reads parent/child relationships from components.json", () => {
    const idx = parseComponentIndex(fx("components.json"));
    expect(idx.find((e) => e.name === "Combo box")).toMatchObject({ parent: "Dropdown", overview: false });
    expect(idx.find((e) => e.name === "Button")).toMatchObject({ parent: null, overview: true });
    expect(idx.find((e) => e.name === "Aspect ratio")).toMatchObject({ parent: null, overview: false });
  });

  it("extracts sitemap locations", () => {
    expect(parseSitemapLocs("<urlset><url><loc>https://x.test/a?b=1&amp;c=2</loc></url><url><loc> https://x.test/b </loc></url></urlset>")).toEqual([
      "https://x.test/a?b=1&c=2",
      "https://x.test/b",
    ]);
  });
});

describe("carbon MDX parsers", () => {
  const usage = parseUsage(fx("button-usage.mdx"), "src/pages/components/button/usage.mdx");
  const style = parseStyle(fx("button-style.mdx"), "src/pages/components/button/style.mdx");

  it("usage: description, variants table, sizes, keyboard, related links, storybook stories", () => {
    expect(usage.description).toBe(
      "Buttons are used to initialize an action. Button labels express what action will occur when the user interacts with it.",
    );
    expect(usage.variants.map((v) => v.name)).toEqual(["Primary", "Secondary", "Tertiary", "Ghost", "Danger"]);
    expect(usage.variants[0]).toMatchObject({ axis: "variant", location: "src/pages/components/button/usage.mdx#Variants" });
    expect(usage.variants[0]!.description).toMatch(/^For the principal call to action on the page\./);
    expect(usage.sizes).toEqual(["Extra small", "Small", "Medium", "Large (productive)", "Large (expressive)", "Extra large", "2XL"]);
    expect(usage.keyboard).toEqual([
      expect.objectContaining({ keys: "Enter / Space", action: "Users can trigger a button by pressing Enter or Space while the button has focus." }),
    ]);
    const relatedDocs = usage.related.map((r) => r.componentDocSlug).filter(Boolean);
    expect(relatedDocs).toEqual(["link", "menu-buttons", "modal"]);
    expect(usage.related.find((r) => r.text === "Form pattern")?.patternSlug).toBe("forms-pattern");
    expect(usage.storybook[0]).toEqual({
      label: "Default",
      storyId: "components-button--default",
      url: "https://react.carbondesignsystem.com/?path=/story/components-button--default",
    });
    // A States section exists but only defers to the Style tab (no names) -> nothing invented.
    expect(usage.statesSectionFound).toBe(true);
    expect(usage.states).toEqual([]);
  });

  it("style: interactive state names, size column and token usages with fill-down", () => {
    expect(style.states.map((s) => s.name)).toEqual(["Hover", "Focus", "Active", "Disabled"]);
    expect(style.sizes).toHaveLength(7);
    expect(style.tokenUsages).toEqual(
      expect.arrayContaining([
        { tokenName: "button-primary", property: "Container background-color", location: "src/pages/components/button/style.mdx#Color" },
        { tokenName: "button-primary-hover", property: "Container background-color (hover)", location: "src/pages/components/button/style.mdx#Color" },
        // Empty State/Element cells inherit the row above.
        { tokenName: "focus-inset", property: "Container inset (focus)", location: "src/pages/components/button/style.mdx#Color" },
        { tokenName: "icon-on-color-disabled", property: "Icon svg (disabled)", location: "src/pages/components/button/style.mdx#Color" },
      ]),
    );
  });

  it("code: official vs community framework cards", () => {
    const code = parseCode(fx("button-code.mdx"));
    expect(code.frameworks.map((f) => [f.label, f.community])).toEqual([
      ["React", false],
      ["Web Components", false],
      ["Angular (Community)", true],
      ["Vue (Community)", true],
    ]);
  });

  it("accessibility: keyboard sentences with normalized keys, sub-heading context, roles and APG pattern", () => {
    const a = parseA11y(fx("dropdown-accessibility.mdx"));
    expect(a.keyboardSectionFound).toBe(true);
    expect(a.keyboard[0]).toMatchObject({ keys: "Tab / ArrowUp / ArrowDown" });
    const combo = a.keyboard.filter((k) => k.context === "Combo box");
    expect(combo.length).toBeGreaterThan(0);
    expect(combo[0]!.action.startsWith("Combo box: ")).toBe(true);
    expect(a.keyboard.some((k) => k.keys.includes("Escape"))).toBe(true);
    expect(a.roles).toContain("listbox");
    expect(a.ariaPattern).toBe("combobox");
    expect(a.guidance).toBeTruthy();
  });

  it("normalizes key names and chords", () => {
    expect(keyLabel("Down arrow")).toBe("ArrowDown");
    expect(keyLabel("esc")).toBe("Escape");
    expect(keyLabel("Shift+Tab")).toBe("Shift+Tab");
    expect(keyLabel("Ctrl + C")).toBe("Control+C");
    expect(keyLabel("aria-pressed")).toBeNull();
  });

  it("about: guiding principle names from bold lead-ins", () => {
    const about = parseAbout(fx("what-is-carbon.mdx"));
    expect(about.principles).toEqual([
      "Carbon is open",
      "Carbon is inclusive",
      "Carbon is modular and flexible",
      "Carbon puts the user first",
      "Carbon builds consistency",
    ]);
    expect(about.description).toMatch(/^Carbon is IBM's open source design system/);
  });
});

describe("carbon React propTypes (static)", () => {
  const src = fx("Button.lib.js");
  const res = extractPropTypes(src, "Button")!;
  const prop = (n: string) => res.props.find((p) => p.name === n);

  it("extracts names, types, enum values, defaults and descriptions without executing code", () => {
    expect(res).toBeTruthy();
    expect(res.sourcePath).toBe("src/components/Button/Button.tsx");
    expect(res.props.length).toBeGreaterThanOrEqual(25);
    expect(prop("size")).toMatchObject({
      type: '"xs" | "sm" | "md" | "lg" | "xl" | "2xl"',
      allowedValues: ["xs", "sm", "md", "lg", "xl", "2xl"],
      required: false,
    });
    expect(prop("tooltipPosition")).toMatchObject({ defaultValue: '"top"', allowedValues: ["top", "right", "bottom", "left"] });
    expect(prop("kind")).toMatchObject({ type: null, defaultValue: '"primary"', required: null }); // custom validator
    expect(prop("hasIconOnly")).toMatchObject({ type: "boolean", defaultValue: "false" });
    expect(prop("disabled")?.description).toBe("Specify whether the Button should be disabled, or not");
    expect(prop("renderIcon")?.type).toBe("function | object");
  });

  it("maps PropTypes expressions", () => {
    const consts = new Map([["Sizes", ["sm", "md"]]]);
    expect(mapPropType("prop_types.default.string.isRequired", consts)).toMatchObject({ type: "string", required: true });
    expect(mapPropType('require_deprecate.deprecate(prop_types.default.bool, "use x")', consts)).toMatchObject({ type: "boolean", deprecated: true });
    expect(mapPropType("prop_types.default.oneOf(Sizes)", consts)).toMatchObject({ type: '"sm" | "md"', allowed: ["sm", "md"] });
    expect(mapPropType("prop_types.default.arrayOf(prop_types.default.shape({ id: prop_types.default.string }))", consts).type).toBe("object[]");
    expect(mapPropType("prop_types.default.oneOfType([prop_types.default.string, prop_types.default.number])", consts).type).toBe("string | number");
    expect(mapPropType("prop_types.default.instanceOf(Date)", consts).type).toBe("Date");
    expect(mapPropType("require_x.requiredIfGivenPropIsTruthy('a', prop_types.default.string)", consts)).toMatchObject({ type: "string", required: null });
  });

  it("splits top-level entries while respecting strings, comments and brackets", () => {
    const parts = splitTopLevel(`/** a, b */ a: f(1, 2), b: "x,y", c: [1, 2]`);
    expect(parts.map((p) => p.text)).toEqual(["a: f(1, 2)", 'b: "x,y"', "c: [1, 2]"]);
    expect(parts[0]!.comments[0]).toContain("a, b");
  });

  it("reads destructuring defaults from parameter patterns", () => {
    const d = destructuringDefaults(`const Foo = ({ a = "x", b: bee = false, c, ...rest }) => null;`, "Foo");
    expect(Object.fromEntries(d)).toEqual({ a: '"x"', b: "false" });
  });
});

describe("carbon web-components manifest", () => {
  it("keeps tag folder/file, attributes and deprecation", () => {
    const { tags, format } = parseWcaManifest(fx("custom-elements.json"));
    expect(format).toBe("wca");
    const btn = tags.find((t) => t.name === "cds-button")!;
    expect(btn).toMatchObject({ folder: "button", file: "button" });
    expect(btn.attributes[0]).toMatchObject({ name: "autofocus", type: "boolean", defaultValue: "false", deprecated: false });
    expect(tags.some((t) => t.attributes.some((a) => a.deprecated))).toBe(true);
  });
});

describe("carbon live page metadata", () => {
  it("decodes the embedded header JSON and validates URLs", () => {
    const m = parseLiveMeta(fx("live-button.html"))!;
    expect(m).toMatchObject({
      title: "Button",
      statusLabel: "Stable",
      reactFolder: "Button",
      wcFolder: "button",
      reactSourceUrl: "https://github.com/carbon-design-system/carbon/tree/main/packages/react/src/components/Button",
      rejected: [],
    });
    expect(lifecycleFromLabel(m.statusLabel)).toBe("stable");
  });

  it("rejects malformed source URLs instead of storing them", () => {
    const html = fx("live-button.html").replace(
      "packages/web-components/src/components/button",
      "packages/web-components/src/components/buttonhttps://web-components.carbondesignsystem.com/?path=/docs/x--overview",
    );
    const m = parseLiveMeta(html)!;
    expect(m.wcSourceUrl).toBeNull();
    expect(m.rejected).toContain("webComponentsResources.githubUrl");
  });

  it("returns null when no metadata is embedded", () => {
    expect(parseLiveMeta("<html><body>nothing</body></html>")).toBeNull();
  });
});

describe("carbon tokens", () => {
  it("DTCG theme file: brace and JSON-pointer references, color scheme, contextual names", () => {
    const r = parseDtcgFile(fx("white-theme.tokens.json"), { file: "tokens/themes/white/theme.tokens.json", cssVar: (n) => `--cds-${n}` });
    expect(r.colorScheme).toBe("light");
    expect(r.contextual).toContain("layer");
    const bg = r.tokens.find((t) => t.name === "background")!;
    expect(bg).toMatchObject({ rawValue: "{white}", references: ["white"], category: "color", cssVar: "--cds-background" });
    const active = r.tokens.find((t) => t.name === "background-active")!;
    expect(active.references).toEqual(["gray.50"]);
    expect((active.rawValue as Record<string, unknown>).alpha).toBe(0.5); // as authored, unresolved
    expect(pointerRefName("#/gray/50/$value/components")).toBe("gray.50");
  });

  it("DTCG palette with declared tier", () => {
    const r = parseDtcgFile(fx("colors.tokens.json"), { file: "tokens/colors.tokens.json", tier: { tier: "primitive", state: "verified" } });
    expect(r.tokens.map((t) => t.name)).toEqual(["white", "gray.10", "gray.50", "gray.100"]);
    expect(r.tokens[1]).toMatchObject({ tier: "primitive", tierState: "verified", path: ["gray", "10"] });
    expect((r.tokens[1]!.rawValue as { hex: string }).hex).toBe("#f4f4f4");
  });

  it("SCSS type styles as authored with Sass lookups recorded as references", () => {
    const t = parseTypeStyles(fx("type-styles.scss"), "scss/_styles.scss");
    expect(t.map((x) => x.name)).toEqual(["caption-01", "label-01", "body-short-01", "body-compact-01", "body-long-01", "expressive-heading-03"]);
    expect(t[0]!.deprecated).toBe(true);
    expect(t.find((x) => x.name === "body-compact-01")).toMatchObject({ rawValue: "$body-short-01", references: ["body-short-01"] });
    const eh = t.find((x) => x.name === "expressive-heading-03")!;
    expect(eh.references).toEqual(expect.arrayContaining(["type-scale.5", "type-scale.6", "font-weight.regular"]));
    expect((eh.rawValue as Record<string, Record<string, unknown>>).breakpoints!.max).toEqual({ "font-size": "scale.type-scale(6)", "line-height": "1.334" });
  });

  it("font families/weights and the published type scale literal", () => {
    const ff = parseFontFamilies(
      `$font-families: (\n  'mono':\n    string.unquote(\n      "'IBM Plex Mono', monospace"\n    ),\n) !default;\n$font-weights: (\n  'regular': 400,\n) !default;`,
      "scss/_font-family.scss",
    );
    expect(ff.map((x) => [x.name, x.rawValue])).toEqual([
      ["font-family.mono", "'IBM Plex Mono', monospace"],
      ["font-weight.regular", 400],
    ]);
    const sc = parseTypeScale("const scale = [\n\t12,\n\t14,\n\t16\n];", "es/index.js");
    expect(sc.map((x) => [x.name, x.rawValue])).toEqual([
      ["type-scale.1", 12],
      ["type-scale.2", 14],
      ["type-scale.3", 16],
    ]);
  });

  it("compiled CSS: declared vs merely referenced custom properties; :root contextual values", () => {
    const css = fx("styles-excerpt.css");
    const declared = declaredCssVars(css);
    expect(declared).toContain("--cds-background");
    expect(declared).toContain("--cds-layer");
    expect(declared).not.toContain("--cds-button-primary"); // only used inside var()
    expect(rootCustomProperties(css)["--cds-layer"]).toBe("var(--cds-layer-01, #f4f4f4)");
  });
});

describe("carbon planning", () => {
  const nav = parseNav(fx("nav-items.yaml"));
  const index = parseComponentIndex(fx("components.json"));
  const reactFiles = [
    "lib/components/Button/Button.js",
    "lib/components/Button/index.js",
    "lib/components/Accordion/Accordion.js",
    "lib/components/Dropdown/Dropdown.js",
    "lib/components/ComboBox/ComboBox.js",
    "lib/components/IconButton/index.js",
    "lib/components/MenuButton/index.js",
    "lib/components/UIShell/Header.js",
    "lib/components/AspectRatio/AspectRatio.js",
  ];
  const sitemap = new Set(["https://www.carbondesignsystem.com/building-blocks/core/components/button/guidelines"]);
  const live = (d: string, tab: string) => liveComponentUrl(d, tab);
  const legacy = (d: string, tab: string) => `https://carbondesignsystem.com/components/${d}/${tab}/`;

  it("plans pages, children and implementation files", () => {
    const plan = planComponents({ nav, index, reactFiles, sitemap, liveUrl: live, legacyUrl: legacy });
    const by = new Map(plan.map((p) => [p.slug, p]));
    expect(by.get("button")).toMatchObject({ kind: "page", docSlug: "button", react: [{ folder: "Button", file: "lib/components/Button/Button.js", exports: ["Button"] }] });
    expect(by.get("button")!.docsUrl).toBe("https://www.carbondesignsystem.com/building-blocks/core/components/button/guidelines");
    // Not in sitemap -> legacy URL (redirects), never a guessed URL.
    expect(by.get("accordion")!.docsUrl).toBe("https://carbondesignsystem.com/components/accordion/usage/");
    expect(by.get("menu-buttons")).toMatchObject({ family: true, react: [] });
    expect(by.get("ui-shell-header")!.react).toEqual([{ folder: "UIShell", file: "lib/components/UIShell/Header.js", exports: ["Header"] }]);
    expect(by.get("combo-box")).toMatchObject({ kind: "child", parentSlug: "dropdown", react: [{ folder: "ComboBox", exports: ["ComboBox"] }] });
    expect(by.get("icon-button")).toMatchObject({ parentSlug: "button", react: [{ file: "lib/components/IconButton/index.js" }] });
    expect(by.get("aspect-ratio")?.kind).toBe("standalone");
    expect(by.has("ui-shell")).toBe(false); // overview umbrella entry without its own nav page
  });

  it("limit caps pages and drops standalone entries", () => {
    const plan = planComponents({ nav, index, reactFiles, sitemap, liveUrl: live, legacyUrl: legacy, limit: 2 });
    expect(plan.filter((p) => p.kind === "page").map((p) => p.slug)).toEqual(["accordion", "button"]);
    expect(plan.some((p) => p.kind === "standalone")).toBe(false);
    expect(plan.find((p) => p.slug === "icon-button")?.parentSlug).toBe("button");
  });

  it("resolves React files by normalized name, including files inside other folders", () => {
    const idx = reactFileIndex(["lib/components/Tooltip/DefinitionTooltip.js", "lib/components/Tooltip/Tooltip.js"]);
    expect(resolveReact(idx, "Definition tooltip")).toEqual({ folder: "Tooltip", file: "lib/components/Tooltip/DefinitionTooltip.js", exports: ["DefinitionTooltip"] });
    expect(resolveReact(idx, "Nonexistent widget")).toBeNull();
  });

  it("maps pattern pages to sitemap URLs", () => {
    const sm = new Set(["https://www.carbondesignsystem.com/building-blocks/core/patterns/dialogs", "https://www.carbondesignsystem.com/building-blocks/core/patterns/forms"]);
    const p = planPatterns(nav, sm, "https://www.carbondesignsystem.com", "https://carbondesignsystem.com");
    expect(p.map((x) => x.docsUrl)).toEqual([
      "https://www.carbondesignsystem.com/building-blocks/core/patterns/dialogs",
      "https://carbondesignsystem.com/patterns/empty-states-pattern/",
      "https://www.carbondesignsystem.com/building-blocks/core/patterns/forms",
    ]);
    expect(p[0]).toMatchObject({ slug: "dialogs", file: "src/pages/patterns/dialog-pattern/index.mdx" });
  });
});

describe("carbon normalize + validate", () => {
  const nav = parseNav(fx("nav-items.yaml"));
  const index = parseComponentIndex(fx("components.json"));
  const plan = planComponents({
    nav,
    index,
    reactFiles: ["lib/components/Button/Button.js"],
    sitemap: new Set(),
    liveUrl: (d, tab) => liveComponentUrl(d, tab),
    legacyUrl: (d, tab) => `https://carbondesignsystem.com/components/${d}/${tab}/`,
    limit: 2,
  });
  const blob = (f: string) => `https://github.com/carbon-design-system/carbon-website/blob/main/${f}`;
  const pkg = (p: string, f: string) => `https://cdn.jsdelivr.net/npm/${p}/${f}`;
  const react = extractPropTypes(fx("Button.lib.js"), "Button")!;
  const theme = parseDtcgFile(fx("white-theme.tokens.json"), { file: "tokens/themes/white/theme.tokens.json", cssVar: (n) => `--cds-${n}`, tier: null });
  const frags: CarbonFragment[] = [
    { t: "nav", plan, patterns: [], ev: ev(blob("src/data/nav-items.yaml"), "src/data/nav-items.yaml") },
    { t: "index", entries: index, ev: ev(blob("src/data/components.json"), "src/data/components.json") },
    { t: "usage", slug: "button", data: parseUsage(fx("button-usage.mdx"), "src/pages/components/button/usage.mdx"), ev: ev(blob("src/pages/components/button/usage.mdx"), "src/pages/components/button/usage.mdx") },
    { t: "style", slug: "button", data: parseStyle(fx("button-style.mdx"), "src/pages/components/button/style.mdx"), ev: ev(blob("src/pages/components/button/style.mdx"), "src/pages/components/button/style.mdx") },
    { t: "code", slug: "button", data: parseCode(fx("button-code.mdx")), ev: ev(blob("src/pages/components/button/code.mdx"), "src/pages/components/button/code.mdx") },
    { t: "live", slug: "button", meta: parseLiveMeta(fx("live-button.html"))!, ev: ev("https://www.carbondesignsystem.com/building-blocks/core/components/button/guidelines", "/x") },
    {
      t: "react",
      slug: "button",
      exportName: "Button",
      implementation: "react",
      found: true,
      props: react.props,
      spreads: react.spreads,
      sourcePath: react.sourcePath,
      version: "1.120.0",
      ev: ev(pkg("@carbon/react@1.120.0", "lib/components/Button/Button.js"), "lib/components/Button/Button.js"),
    },
    { t: "wca", tags: parseWcaManifest(fx("custom-elements.json")).tags, version: "2.67.0", ev: ev(pkg("@carbon/web-components@2.67.0", "custom-elements.json"), "custom-elements.json") },
    {
      t: "tokens",
      setKey: "theme-white",
      part: "theme",
      order: 0,
      tokens: theme.tokens,
      fileDescription: theme.description,
      colorScheme: theme.colorScheme,
      contextual: theme.contextual,
      pkg: "@carbon/themes",
      version: "11.85.0",
      ev: ev(pkg("@carbon/themes@11.85.0", "tokens/themes/white/theme.tokens.json"), "tokens/themes/white/theme.tokens.json"),
    },
    {
      t: "cssvars",
      names: declaredCssVars(fx("styles-excerpt.css")),
      rootValues: rootCustomProperties(fx("styles-excerpt.css")),
      pkg: "@carbon/styles",
      version: "1.119.0",
      ev: ev(pkg("@carbon/styles@1.119.0", "css/styles.css"), "css/styles.css"),
    },
  ];
  const bundle = normalizeCarbon("carbon", frags.map((data) => ({ data })));
  const button = bundle.components.find((c) => c.slug === "button")!;

  it("produces a contract-valid bundle", () => {
    const parsed = NormalizedBundle.safeParse(bundle);
    if (!parsed.success) console.error(parsed.error.issues.slice(0, 5));
    expect(parsed.success).toBe(true);
  });

  it("Button: documented fields with evidence and honest coverage", () => {
    expect(button.name).toBe("Button");
    expect(button.lifecycle).toBe("stable");
    // Empty sitemap (unavailable) -> live URL scheme is used as-is.
    expect(button.docsUrl).toBe("https://www.carbondesignsystem.com/building-blocks/core/components/button/guidelines");
    expect(button.sourceCodeUrl).toBe("https://github.com/carbon-design-system/carbon/tree/main/packages/react/src/components/Button");
    expect(button.canonicalType).toBe("button");
    expect(button.classification?.state).toBe("inferred");
    expect(button.variants.map((v) => v.name)).toEqual(["Primary", "Secondary", "Tertiary", "Ghost", "Danger"]);
    expect(button.states.map((s) => s.canonical)).toEqual(["hover", "focus", "active", "disabled"]);
    expect(button.sizes).toHaveLength(7);
    expect(button.frameworks.map((f) => [f.slug, f.packageName, f.importName])).toEqual([
      ["react", "@carbon/react", "Button"],
      ["web-components", "@carbon/web-components", "cds-button"],
    ]);
    expect(button.properties.filter((p) => p.implementation === "react").length).toBe(react.props.length);
    expect(button.properties.some((p) => p.implementation === "web-components" && p.name === "autofocus")).toBe(true);
    expect(button.tokenUsages).toContainEqual({ tokenName: "button-primary", property: "Container background-color" });
    expect(button.relationships).toContainEqual({ kind: "subcomponent", targetSlug: "icon-button", targetType: null });
    for (const f of COMPONENT_FIELDS) expect(button.coverage[f]).toBeDefined();
    // Keyboard is documented on the usage tab; the accessibility tab was not supplied in this test.
    expect(button.coverage.keyboard).toBe("documented");
    expect(button.accessibility?.keyboard?.[0]).toMatchObject({ keys: "Enter / Space" });
    expect(button.accessibility?.coverage.guidance).toBe("not-extracted");
    expect(button.coverage.responsive).toBe("not-extracted");
    for (const e of button.evidence) {
      expect(e.state).toBe("verified");
      expect(e.extractionMethod).toMatch(/^adapter:carbon:/);
      expect(e.sourceUrl).toMatch(/^https:\/\//);
    }
    expect(button.examples.every((e) => e.kind !== "code-snippet" && !e.code)).toBe(true);
  });

  it("child components get parent docs URL and no invented details", () => {
    const icon = bundle.components.find((c) => c.slug === "icon-button")!;
    expect(icon.docsUrl).toBe(button.docsUrl);
    expect(icon.variants).toEqual([]);
    expect(icon.lifecycle).toBe("unknown");
    expect(icon.coverage.description).toBe("not-extracted");
  });

  it("token sets: cssVar kept only when compiled CSS declares it; contextual set from :root", () => {
    const white = bundle.tokenSets.find((s) => s.slug === "theme-white")!;
    expect(white.theme).toBe("light");
    expect(white.tokens.find((t) => t.name === "background")!.cssVar).toBe("--cds-background");
    expect(white.tokens.find((t) => t.name === "layer-01")!.cssVar).toBeNull(); // not declared in the excerpt
    const ctx = bundle.tokenSets.find((s) => s.slug === "contextual")!;
    expect(ctx.tokens.find((t) => t.name === "layer")).toMatchObject({ rawValue: "var(--cds-layer-01, #f4f4f4)", references: ["layer-01"], cssVar: "--cds-layer" });
  });

  it("validate flags duplicate slugs and passes the clean bundle", () => {
    const ctx = { systemSlug: "carbon", runStartedAt: "", http: null as never, log: console, limit: 2 };
    expect(adapter.validate!(ctx, bundle).filter((i) => i.severity === "error")).toEqual([]);
    const dup = { ...bundle, components: [...bundle.components, button] };
    expect(adapter.validate!(ctx, dup).some((i) => i.code === "DUPLICATE" && i.entityKey === "button")).toBe(true);
  });
});
