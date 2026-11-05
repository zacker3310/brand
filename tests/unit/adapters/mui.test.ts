/**
 * Unit tests for the "mui" adapter (Material UI, Joy UI, Base UI). No network: inputs are trimmed
 * fixtures from mui/material-ui@v9.5.0 / v5.17.1, mui/base-ui@v1.9.0 and the published npm
 * packages (MIT); see tests/fixtures/adapters/mui/README.md.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { NormalizedBundle } from "@/lib/contracts";
import { adapter } from "@/ingestion/adapters/mui";
import { parseApiJson, parseApiTranslations, splitComponentDescription } from "@/ingestion/adapters/mui/api-json";
import { parseBaseIndex, parseBasePage, parseBaseTextPage, parseBaseTypes, stripMdx } from "@/ingestion/adapters/mui/baseui";
import { classifyFor, prioritize } from "@/ingestion/adapters/mui/constants";
import type { DocMeta, MuiFragment, NpmPin } from "@/ingestion/adapters/mui/fragments";
import { findValue, flattenObject, functionReturns } from "@/ingestion/adapters/mui/js-literal";
import { keysIn, keyboardFromBlocks, parseMuiMarkdown, rolesIn } from "@/ingestion/adapters/mui/markdown";
import { pageMarkdownPath, parseDemosHtml, parseNavPages, parsePagesApi } from "@/ingestion/adapters/mui/nav";
import { baseStatements, normalizeBase } from "@/ingestion/adapters/mui/normalize-base";
import { coreStatements, normalizeCore, primaryComponents } from "@/ingestion/adapters/mui/normalize-core";
import { createSlugger, firstSentence, htmlToText, literalUnion, typeDescriptionToText, type Prov } from "@/ingestion/adapters/mui/shared";
import { buildJoyTokenSets, buildMuiTokenSets, parseTokenFile } from "@/ingestion/adapters/mui/tokens";
import { validateMuiBundle } from "@/ingestion/adapters/mui/validate";
import { classifyComponentName } from "@/lib/taxonomy";
import type { FetchResult, PoliteFetcher } from "@/ingestion/http";
import type { AdapterContext } from "@/ingestion/types";

const FX = path.resolve(__dirname, "../../fixtures/adapters/mui");
const fx = (f: string) => readFileSync(path.join(FX, f), "utf8");
const AT = "2026-11-05T00:00:00.000Z";
const prov = (file: string, sourceUrl = `https://github.com/mui/material-ui/blob/v9.5.0/${file}`): Prov => ({ sourceUrl, fetchedUrl: sourceUrl, retrievedAt: AT, contentHash: "abc123", file });
const PIN: NpmPin = { pkg: "@mui/material", version: "9.5.0", publishedAt: "2026-10-09T09:12:59.956Z", license: "MIT", deprecated: null, tag: "v9.5.0", tagMethod: "tag v<version>", npmUrl: "https://www.npmjs.com/package/@mui/material" };
const meta = (file: string, extra: Partial<DocMeta> = {}): DocMeta => ({ system: "mui", file, pin: PIN, ...extra });

/* ---------------------------------- helpers ---------------------------------- */

describe("shared text helpers", () => {
  it("generates mui.com and github-style heading anchors with their duplicate suffixes", () => {
    const mui = createSlugger("mui");
    expect([mui("Basic button"), mui("Sizes"), mui("Icon button"), mui("Sizes")]).toEqual(["basic-button", "sizes", "icon-button", "sizes-2"]);
    const gh = createSlugger("github");
    expect([gh("Open multiple panels"), gh("Root"), gh("Root")]).toEqual(["open-multiple-panels", "root", "root-1"]);
  });
  it("decodes MUI generated type descriptions and literal unions", () => {
    const t = typeDescriptionToText("'small'<br>&#124;&nbsp;'medium'<br>&#124;&nbsp;'large'<br>&#124;&nbsp;string");
    expect(t).toBe("'small' | 'medium' | 'large' | string");
    expect(literalUnion(t)).toEqual(["small", "medium", "large"]);
    expect(literalUnion("bool")).toBeNull();
    expect(htmlToText("If <code>true</code>, the component is disabled.")).toBe("If true, the component is disabled.");
    expect(firstSentence("Buttons allow users to take actions, e.g. submit. Second sentence.")).toBe("Buttons allow users to take actions, e.g. submit.");
  });
  it("prioritizes well-known components for --limit runs, deterministically", () => {
    expect(prioritize(["zoom", "button", "alert", "dialog"], "mui", 3)).toEqual(["button", "dialog", "alert"]);
  });
});

describe("js-literal (static object literal reader)", () => {
  it("reads color palette objects with comments and references", () => {
    const v = findValue(fx("blue.mjs.txt"), /const\s+blue\s*=\s*/)!.value;
    const flat = flattenObject(v, ["blue"]);
    expect(flat.find((f) => f.path.join(".") === "blue.700")!.value).toEqual({ t: "string", v: "#1976d2" });
    expect(flat).toHaveLength(14);
  });
  it("reads function return literals per mode branch and keeps member references", () => {
    const src = fx("createPalette.mjs.txt");
    const prim = functionReturns(src, "getDefaultPrimary");
    expect(prim.map((p) => p.mode)).toEqual(["dark", "default"]);
    const light = flattenObject(prim[1]!.value);
    expect(light.find((f) => f.path[0] === "main")!.value).toMatchObject({ t: "ref", path: ["blue", "700"] });
    const getLight = flattenObject(functionReturns(src, "getLight")[0]!.value);
    expect(getLight.find((f) => f.path.join(".") === "background.paper")!.value).toMatchObject({ t: "ref", path: ["common", "white"] });
  });
  it("marks calls and template substitutions unsupported instead of evaluating them", () => {
    const v = findValue("const x = { a: '1px', b: getCssVar('x'), c: `${y}px`, d: `plain`, e: 2 * 3 };", /const x = /)!.value;
    const flat = Object.fromEntries(flattenObject(v).map((f) => [f.path.join("."), f.value.t]));
    expect(flat).toEqual({ a: "string", b: "unsupported", c: "unsupported", d: "string", e: "unsupported" });
  });
});

/* ------------------------------------ nav ------------------------------------ */

describe("nav files", () => {
  it("lists component pages with sections, including non react-* pages in the Components group", () => {
    const pages = parseNavPages(fx("pages.ts.txt"), "material-ui");
    const paths = pages.map((p) => p.pathname);
    expect(paths).toContain("/material-ui/react-button");
    expect(paths).toContain("/material-ui/icons");
    expect(paths).not.toContain("/material-ui/about-the-lab");
    expect(paths).not.toContain("/material-ui/getting-started");
    expect(pages.find((p) => p.pathname === "/material-ui/react-button-group")).toMatchObject({ title: "Button Group", section: "inputs" });
    expect(pages.find((p) => p.pathname === "/material-ui/react-masonry")!.section).toBe("lab");
    expect(pages.find((p) => p.pathname === "/material-ui/react-number-field")!.newFeature).toBe(true);
  });
  it("reads API slugs, page markdown paths and demos links", () => {
    expect(parsePagesApi(fx("pagesApi.js.txt"), "material-ui")).toEqual(["button", "button-base", "circular-progress", "icon-button", "skeleton", "speed-dial"]);
    expect(pageMarkdownPath(fx("react-button.js.txt"))).toBe("docs/data/material/components/buttons/buttons.md");
    expect(parseDemosHtml('<ul><li><a href="/material-ui/react-button/">Button</a></li></ul>')).toEqual([{ pathname: "/material-ui/react-button", title: "Button" }]);
  });
});

/* ---------------------------------- API JSON ---------------------------------- */

describe("API JSON + translations", () => {
  const api = parseApiJson(fx("button.api.json"));
  const tr = parseApiTranslations(fx("button.tr.json"));
  it("parses props with types, defaults and documented imports", () => {
    expect(api.name).toBe("Button");
    expect(api.packageName).toBe("@mui/material");
    expect(api.filename).toBe("packages/mui-material/src/Button/Button.js");
    const variant = api.props.find((p) => p.name === "variant")!;
    expect(variant).toMatchObject({ type: "'contained' | 'outlined' | 'text' | string", defaultValue: "'text'", required: false });
    expect(api.inheritance).toEqual({ component: "ButtonBase", pathname: "/material-ui/api/button-base/" });
    expect(api.classes.filter((c) => c.isGlobal).map((c) => c.className)).toEqual(["Mui-disabled", "Mui-focusVisible"]);
    expect(api.demos.map((d) => d.pathname)).toContain("/material-ui/react-button");
  });
  it("parses translated descriptions to plain text", () => {
    expect(tr.props.disabled!.description).toBe("If true, the component is disabled.");
  });
  it("splits componentDescription into lead and ## sections", () => {
    const cp = parseApiTranslations(fx("circular-progress.tr.json"));
    const s = splitComponentDescription(cp.componentDescription);
    expect(s.lead).toBeNull();
    expect(s.sections[0]!.heading).toBe("ARIA");
  });
  it("parses Joy UI slots", () => {
    const joy = parseApiJson(fx("joy-button.api.json"));
    expect(joy.packageName).toBe("@mui/joy");
    expect(joy.slots[0]).toMatchObject({ name: "root", defaultValue: "'button'", className: "MuiButton-root" });
  });
});

/* ---------------------------------- markdown ---------------------------------- */

describe("MUI docs markdown", () => {
  it("reads front matter, title, description and demo sections with live anchors", () => {
    const d = parseMuiMarkdown(fx("buttons.md"));
    expect(d.frontmatter.components).toEqual(["Button", "IconButton", "ButtonBase"]);
    expect(d.frontmatter.waiAria).toBe("https://www.w3.org/WAI/ARIA/apg/patterns/button/");
    expect(d.h1).toBe("Button");
    expect(d.description).toBe("Buttons allow users to take actions, and make choices, with a single tap.");
    const anchors = d.demoSections.map((s) => s.anchor);
    expect(anchors).toContain("contained-button");
    expect(anchors).toContain("sizes-2");
    expect(d.demoSections.find((s) => s.anchor === "contained-button")!.demos).toEqual(["ContainedButtons.js", "DisableElevation.js"]);
    expect(d.a11y).toBeNull();
  });
  it("extracts keyboard interactions from documented prose and ARIA roles", () => {
    const d = parseMuiMarkdown(fx("speed-dial.md"));
    expect(d.a11y!.anchor).toBe("accessibility");
    expect(d.a11y!.keyboard.map((k) => k.keys)).toEqual(["Enter / Space", "Arrow keys", "Escape"]);
    expect(d.a11y!.roles).toEqual(["menu", "menuitem"]);
    expect(d.a11y!.apgPatterns).toEqual([]);
  });
  it("records an explicit 'not focusable' keyboard statement as documented-none", () => {
    const d = parseMuiMarkdown(fx("skeleton.md"));
    expect(d.a11y!.keyboard).toEqual([]);
    expect(d.a11y!.keyboardNone).toBe(true);
  });
  it("only treats capitalized key names as keys", () => {
    expect(keysIn("The pagination items are in tab order.")).toEqual([]);
    expect(keysIn("Press Shift+Tab to go back.")).toEqual(["Shift+Tab"]);
    expect(keyboardFromBlocks(["Users should be able to open a link by pressing Enter."])).toEqual([{ keys: "Enter", action: "Users should be able to open a link by pressing Enter." }]);
    expect(rolesIn('has a role of "img" and role="menu"')).toEqual(["img", "menu"]);
  });
  it("reads overview statements from the description paragraph", () => {
    const st = coreStatements("overview", '<p class="description">Joy UI is an open-source React component library that implements MUI\'s own design principles.</p>\n\nText.');
    expect(st.principles).toMatch(/implements MUI's own design principles/);
  });
});

describe("primaryComponents", () => {
  it("prefers exact title matches, then singular, then suffix, then githubSource", () => {
    expect(primaryComponents({ h1: "Button", navTitle: null, githubSource: null }, ["Button", "IconButton", "ButtonBase"])).toEqual(["Button"]);
    expect(primaryComponents({ h1: "Links", navTitle: null, githubSource: null }, ["Link"])).toEqual(["Link"]);
    expect(primaryComponents({ h1: "Progress", navTitle: null, githubSource: "packages/mui-material/src/LinearProgress" }, ["CircularProgress", "LinearProgress"])).toEqual(["CircularProgress", "LinearProgress"]);
    expect(primaryComponents({ h1: "Floating Action Button", navTitle: null, githubSource: "packages/mui-material/src/Fab" }, ["Fab"])).toEqual(["Fab"]);
    expect(primaryComponents({ h1: "Autocomplete", navTitle: null, githubSource: null }, ["TextField", "Popper", "Autocomplete"])).toEqual(["Autocomplete"]);
  });
});

describe("classification corrections", () => {
  it("leaves known heuristic mismatches unclassified and keeps the rest inferred", () => {
    expect(classifyFor("mui", "Collapse", classifyComponentName)).toBeNull();
    expect(classifyFor("mui", "SpeedDial", classifyComponentName)!.slug).toBe("floating-action-button");
    expect(classifyFor("base-ui", "Toggle", classifyComponentName)).toMatchObject({ slug: "toggle-button" });
    expect(classifyFor("mui", "Button", classifyComponentName)!.slug).toBe("button");
  });
});

/* ----------------------------------- tokens ----------------------------------- */

describe("tokens", () => {
  const files = [
    { data: parseTokenFile("mui-color", "colors/blue.mjs", fx("blue.mjs.txt"), "blue"), prov: prov("colors/blue.mjs"), npmUrl: "https://cdn.jsdelivr.net/npm/@mui/material@9.5.0/colors/blue.mjs" },
    { data: parseTokenFile("mui-color", "colors/common.mjs", fx("common.mjs.txt"), "common"), prov: prov("colors/common.mjs"), npmUrl: "https://cdn.jsdelivr.net/npm/@mui/material@9.5.0/colors/common.mjs" },
    { data: parseTokenFile("mui-color", "colors/orange.mjs", fx("orange.mjs.txt"), "orange"), prov: prov("colors/orange.mjs"), npmUrl: "https://cdn.jsdelivr.net/npm/@mui/material@9.5.0/colors/orange.mjs" },
    { data: parseTokenFile("mui-palette", "styles/createPalette.mjs", fx("createPalette.mjs.txt")), prov: prov("styles/createPalette.mjs"), npmUrl: "https://cdn.jsdelivr.net/npm/@mui/material@9.5.0/styles/createPalette.mjs" },
    { data: parseTokenFile("mui-transitions", "styles/createTransitions.mjs", fx("createTransitions.mjs.txt")), prov: prov("styles/createTransitions.mjs"), npmUrl: "https://cdn.jsdelivr.net/npm/@mui/material@9.5.0/styles/createTransitions.mjs" },
    { data: parseTokenFile("mui-zindex", "styles/zIndex.mjs", fx("zIndex.mjs.txt")), prov: prov("styles/zIndex.mjs"), npmUrl: "https://cdn.jsdelivr.net/npm/@mui/material@9.5.0/styles/zIndex.mjs" },
  ];
  const { sets } = buildMuiTokenSets({ pkg: "@mui/material", version: "9.5.0", files, license: null });
  const set = (slug: string) => sets.find((s) => s.slug === slug)!;
  it("builds Material UI sets with literal values and preserved references", () => {
    expect(sets.map((s) => s.slug).sort()).toEqual(["mui-color-palette", "mui-palette-dark", "mui-palette-light", "mui-transitions", "mui-z-index"]);
    expect(set("mui-color-palette").tokens.find((t) => t.name === "blue.700")).toMatchObject({ rawValue: "#1976d2", type: "color", tier: "primitive", path: ["blue", "700"] });
    const light = set("mui-palette-light");
    expect(light.theme).toBe("light");
    expect(light.tokens.find((t) => t.name === "palette.primary.main")).toMatchObject({ rawValue: "{blue.700}", references: ["blue.700"] });
    expect(light.tokens.find((t) => t.name === "palette.background.paper")).toMatchObject({ rawValue: "{common.white}", references: ["common.white"] });
    expect(light.tokens.find((t) => t.name === "palette.warning.main")!.rawValue).toBe("#ed6c02");
    expect(light.tokens.find((t) => t.name === "palette.action.hoverOpacity")).toMatchObject({ rawValue: 0.04, category: "opacity" });
    expect(set("mui-palette-dark").tokens.find((t) => t.name === "palette.primary.main")!.rawValue).toBe("{blue.200}");
    expect(set("mui-transitions").tokens.find((t) => t.name === "easing.sharp")).toMatchObject({ rawValue: "cubic-bezier(0.4, 0, 0.6, 1)", type: "cubicBezier", category: "motion" });
    expect(set("mui-z-index").tokens.find((t) => t.name === "zIndex.appBar")!.rawValue).toBe(1100);
    const result = NormalizedBundle.safeParse({ systemSlug: "mui", tokenSets: sets });
    expect(result.success).toBe(true);
  });
  it("builds Joy UI sets: palette scales reference colors, scales carry documented CSS variables", () => {
    const joy = buildJoyTokenSets({
      pkg: "@mui/joy",
      version: "5.0.0-beta.52",
      license: null,
      files: [
        { data: parseTokenFile("joy-colors", "colors/colors.js", fx("joy-colors.js.txt")), prov: prov("colors/colors.js"), npmUrl: "https://cdn.jsdelivr.net/npm/@mui/joy@5.0.0-beta.52/colors/colors.js" },
        { data: parseTokenFile("joy-theme", "styles/extendTheme.js", fx("joy-extendTheme.js.txt")), prov: prov("styles/extendTheme.js"), npmUrl: "https://cdn.jsdelivr.net/npm/@mui/joy@5.0.0-beta.52/styles/extendTheme.js" },
      ],
    });
    const theme = joy.sets.find((s) => s.slug === "joy-theme-defaults")!;
    expect(theme.tokens.find((t) => t.name === "palette.primary.500")).toMatchObject({ rawValue: "{blue.500}", references: ["blue.500"], cssVar: "--joy-palette-primary-500" });
    expect(theme.tokens.find((t) => t.name === "radius.md")).toMatchObject({ rawValue: "8px", cssVar: "--joy-radius-md", category: "shape" });
    expect(theme.tokens.find((t) => t.name === "fontWeight.lg")!.rawValue).toBe(600);
    expect(theme.tokens.find((t) => t.name === "fontFamily.fallback")!.rawValue).toMatch(/^-apple-system/);
    expect(theme.tokens.some((t) => t.name === "fontFamily.body")).toBe(false); // template with substitutions: not extracted
    expect(theme.tokens.some((t) => t.name.startsWith("shadow."))).toBe(false); // computed: not extracted
    expect(joy.warnings.some((w) => /danger/.test(w))).toBe(true); // red scale trimmed from the fixture
  });
});

/* ----------------------------------- normalize ----------------------------------- */

function coreFragments(): MuiFragment[] {
  const nav = parseNavPages(fx("pages.ts.txt"), "material-ui");
  const md = (file: string, pathname: string) => ({ kind: "md" as const, prov: prov(file), meta: meta(file), pathname, pageUrl: `https://mui.com${pathname}/`, doc: parseMuiMarkdown(fx(file.split("/").pop()!)) });
  const api = (slug: string, file: string) => ({ kind: "api" as const, prov: prov(`docs/pages/material-ui/api/${slug}.json`), meta: meta(`docs/pages/material-ui/api/${slug}.json`, { slug }), slug, api: parseApiJson(fx(file)) });
  const tr = (slug: string, file: string) => ({ kind: "api-tr" as const, prov: prov(`docs/translations/api-docs/${slug}/${slug}.json`), meta: meta(`docs/translations/api-docs/${slug}/${slug}.json`, { slug }), slug, tr: parseApiTranslations(fx(file)) });
  return [
    { kind: "nav", prov: prov("docs/data/material/pages.ts"), meta: meta("docs/data/material/pages.ts"), pages: nav },
    { kind: "pages-api", prov: prov("docs/data/material/pagesApi.js"), meta: meta("docs/data/material/pagesApi.js"), slugs: ["button", "button-base"] },
    md("docs/data/material/components/buttons/buttons.md", "/material-ui/react-button"),
    api("button", "button.api.json"),
    tr("button", "button.tr.json"),
    api("button-base", "button-base.api.json"),
    tr("button-base", "button-base.tr.json"),
  ];
}

describe("normalizeCore (Material UI)", () => {
  const bundle = normalizeCore("mui", coreFragments(), { runStartedAt: AT });
  const button = bundle.components.find((c) => c.slug === "button")!;
  const base = bundle.components.find((c) => c.slug === "button-base")!;
  it("produces a contract-valid bundle", () => {
    const r = NormalizedBundle.safeParse(bundle);
    expect(r.success).toBe(true);
    expect(bundle.components.map((c) => c.slug)).toEqual(["button", "button-base"]);
  });
  it("builds Button from the API JSON, translations and its primary docs page", () => {
    expect(button).toMatchObject({
      name: "Button",
      description: "Buttons allow users to take actions, and make choices, with a single tap.",
      docsUrl: "https://mui.com/material-ui/react-button/",
      sourceCodeUrl: "https://github.com/mui/material-ui/blob/v9.5.0/packages/mui-material/src/Button/Button.js",
      lifecycle: "stable",
      canonicalType: "button",
      sizes: ["small", "medium", "large"],
    });
    expect(button.classification).toMatchObject({ state: "verified" });
    expect(button.evidence.some((e) => e.field === "canonicalType" && /waiAria/.test(e.location ?? ""))).toBe(true);
    expect(button.variants.filter((v) => v.axis === "variant").map((v) => v.name)).toEqual(["contained", "outlined", "text"]);
    expect(button.states.map((s) => [s.name, s.canonical])).toEqual([
      ["disabled", "disabled"],
      ["focusVisible", "focus"],
      ["loading", "loading"],
    ]);
    expect(button.coverage.states).toBe("documented");
    expect(button.properties.find((p) => p.name === "disabled")).toMatchObject({ type: "bool", defaultValue: "false", description: "If true, the component is disabled.", implementation: "react" });
    expect(button.frameworks).toEqual([{ slug: "react", packageName: "@mui/material", importName: "Button", sourceUrl: "https://mui.com/material-ui/api/button/" }]);
    expect(button.examples.find((e) => e.title === "Contained button")!.url).toBe("https://mui.com/material-ui/react-button/#contained-button");
    expect(button.relationships).toEqual([
      { kind: "extends", targetSlug: "button-base", targetType: null },
      { kind: "related", targetSlug: "button-base", targetType: null },
    ]);
    // The Button page has no Accessibility section: absent documentation, not "unknown".
    expect(button.accessibility).toBeNull();
    expect(button.coverage.accessibility).toBe("not-documented");
  });
  it("does not attribute the page description to non-primary components", () => {
    expect(base.docsUrl).toBe("https://mui.com/material-ui/api/button-base/");
    expect(base.description).toMatch(/^ButtonBase contains as few styles as possible/);
    expect(base.evidence.find((e) => e.field === "description")!.location).toMatch(/componentDescription/);
  });
  it("emits system facts with evidence for every provided field", () => {
    expect(bundle.facts!.latestVersion).toBe("9.5.0");
    const fields = new Set(bundle.facts!.evidence.map((e) => e.field));
    expect(fields.has("latestVersion") && fields.has("latestReleaseAt")).toBe(true);
    expect(bundle.facts!.philosophy).toBeNull(); // no overview fragment in this fixture set
  });
  it("respects limit and validates", () => {
    const limited = normalizeCore("mui", coreFragments(), { runStartedAt: AT, limit: 1 });
    expect(limited.components.map((c) => c.slug)).toEqual(["button"]);
    expect(limited.components[0]!.relationships).toEqual([]);
    expect(validateMuiBundle("mui", limited, 1).filter((i) => i.severity === "error")).toEqual([]);
    expect(validateMuiBundle("mui", bundle).some((i) => i.severity === "error" && /only 2 components/.test(i.message))).toBe(true);
  });
});

/* ----------------------------------- Base UI ----------------------------------- */

describe("Base UI parsers + normalize", () => {
  const BPIN: NpmPin = { ...PIN, pkg: "@base-ui/react", version: "1.9.0", tag: "v1.9.0", publishedAt: "2026-10-09T08:52:43.788Z" };
  const bmeta = (file: string, extra: Partial<DocMeta> = {}): DocMeta => ({ system: "base-ui", file, pin: BPIN, ...extra });
  const bprov = (file: string) => prov(file, `https://github.com/mui/base-ui/blob/v1.9.0/${file}`);
  it("parses the generated components index", () => {
    const idx = parseBaseIndex(fx("baseui-components.mdx"));
    expect(idx.map((e) => e.slug)).toEqual(["accordion", "button", "menu"]);
    expect(idx[0]!.description).toBe("A set of collapsible panels with headings.");
  });
  it("parses page.mdx and the generated types.md", () => {
    const page = parseBasePage(fx("baseui-accordion.mdx"));
    expect(page).toMatchObject({ title: "Accordion", subtitle: "A set of collapsible panels with headings.", importName: "Accordion", importPath: "@base-ui/react/accordion" });
    expect(page.examples.map((e) => e.anchor)).toEqual(["open-multiple-panels", "hidden-until-found"]);
    const parts = parseBaseTypes(fx("baseui-accordion.types.md"));
    expect(parts.map((p) => p.name)).toEqual(["Root", "Panel"]);
    expect(parts[0]!.props.find((p) => p.name === "multiple")).toMatchObject({ type: "boolean", defaultValue: "false" });
    expect(parts[1]!.cssVariables.map((v) => v.name)).toEqual(["--accordion-panel-height", "--accordion-panel-width"]);
    const menu = parseBasePage(fx("baseui-menu-excerpt.mdx"));
    expect(menu.keyboard.map((k) => k.keys)).toEqual(["Arrow keys", "Shift+Tab / Tab"]);
    expect(stripMdx("import { X } from './demos/hero';\n<DemoX />\nText").trim()).toBe("Text");
  });
  it("normalizes a component with part-prefixed props, documented states and documented-none tokens", () => {
    const aboutPage = parseBaseTextPage(fx("baseui-about.mdx"));
    const frags: MuiFragment[] = [
      { kind: "base-index", prov: bprov("docs/src/app/(docs)/react/components/page.mdx"), meta: bmeta("docs/src/app/(docs)/react/components/page.mdx"), entries: parseBaseIndex(fx("baseui-components.mdx")) },
      { kind: "base-page", prov: bprov("docs/src/app/(docs)/react/components/accordion/page.mdx"), meta: bmeta("docs/src/app/(docs)/react/components/accordion/page.mdx", { slug: "accordion", sourceDir: "packages/react/src/accordion" }), slug: "accordion", pageUrl: "https://base-ui.com/react/components/accordion", page: parseBasePage(fx("baseui-accordion.mdx")) },
      { kind: "base-types", prov: bprov("docs/src/app/(docs)/react/components/accordion/types.md"), meta: bmeta("docs/src/app/(docs)/react/components/accordion/types.md", { slug: "accordion" }), slug: "accordion", parts: parseBaseTypes(fx("baseui-accordion.types.md")) },
      { kind: "base-text", prov: bprov("docs/src/app/(docs)/react/overview/about/page.mdx"), meta: bmeta("docs/src/app/(docs)/react/overview/about/page.mdx", { role: "about" }), role: "about", pageUrl: "https://base-ui.com/react/overview/about", page: aboutPage, statements: baseStatements("about", aboutPage.blocks) },
    ];
    const b = normalizeBase(frags, { runStartedAt: AT });
    expect(NormalizedBundle.safeParse(b).success).toBe(true);
    const acc = b.components.find((c) => c.slug === "accordion")!;
    expect(acc).toMatchObject({ name: "Accordion", lifecycle: "stable", canonicalType: "accordion", docsUrl: "https://base-ui.com/react/components/accordion", sourceCodeUrl: "https://github.com/mui/base-ui/tree/v1.9.0/packages/react/src/accordion" });
    expect(acc.properties.some((p) => p.name === "Root.multiple" && p.implementation === "react")).toBe(true);
    expect(acc.properties.some((p) => p.name === "Panel --accordion-panel-height" && p.implementation === "css")).toBe(true);
    expect(acc.states.map((s) => s.name)).toContain("data-disabled");
    expect(acc.coverage.tokens).toBe("documented-none");
    expect(acc.coverage.variants).toBe("not-documented");
    // Button and Menu have no page/types fragments in this set: unknown, not absent.
    const btn = b.components.find((c) => c.slug === "button")!;
    expect(btn.coverage.properties).toBe("not-extracted");
    expect(b.facts!.principles!.map((p) => p.name)).toEqual(["Headless", "Accessible", "Composable"]);
    expect(b.facts!.philosophy).toMatch(/unstyled/);
  });
});

/* ----------------------------------- adapter ----------------------------------- */

describe("adapter", () => {
  it("is registered for the three MUI systems", () => {
    expect(adapter.id).toBe("mui");
    expect(adapter.systems).toEqual(["mui", "joy-ui", "base-ui"]);
  });

  it("falls back to raw.githubusercontent.com when jsDelivr refuses the large mui/material-ui repo", async () => {
    const mk = (url: string, status: number, body: string | null): FetchResult => ({ url, finalUrl: url, status, ok: status === 200, notModified: false, fromCache: false, contentType: "text/plain", etag: null, lastModified: null, body, hash: body ? "h" : null, byteSize: body?.length ?? 0, fetchedAt: AT, attempts: 1, blockedByRobots: false, error: null });
    const cdn = "https://cdn.jsdelivr.net/gh/mui/material-ui@v9.5.0/docs/pages/material-ui/api/button.json";
    const raw = "https://raw.githubusercontent.com/mui/material-ui/v9.5.0/docs/pages/material-ui/api/button.json";
    const http = { get: async (url: string) => (url === cdn ? mk(url, 403, "Package size exceeded the configured limit of 50 MB.") : mk(url, 200, fx("button.api.json"))) } as unknown as PoliteFetcher;
    const ctx = { systemSlug: "mui", http, log: { info: () => {}, warn: () => {}, error: () => {} }, runStartedAt: AT } as AdapterContext;
    const r = await adapter.fetch!(ctx, { url: cdn, docKind: "mui-api-json", source: { kind: "repository", url: "https://github.com/mui/material-ui" }, meta: { fallbackUrl: raw } }, {});
    expect(r.ok).toBe(true);
    expect(r.finalUrl).toBe(raw);
    expect(JSON.parse(r.body!).name).toBe("Button");
  });

  it("discovers Base UI documents at the verified tag without network (fake fetcher)", async () => {
    const body = (s: string): FetchResult => ({ url: "", finalUrl: "", status: 200, ok: true, notModified: false, fromCache: false, contentType: "text/plain", etag: null, lastModified: null, body: s, hash: "h", byteSize: s.length, fetchedAt: AT, attempts: 1, blockedByRobots: false, error: null });
    const notFound: FetchResult = { ...body(""), status: 404, ok: false, body: null };
    const routes: Record<string, string> = {
      "https://registry.npmjs.org/@base-ui%2Freact": JSON.stringify({ name: "@base-ui/react", "dist-tags": { latest: "1.9.0" }, time: { "1.9.0": "2026-10-09T08:52:43.788Z" }, versions: { "1.9.0": { license: "MIT" } } }),
      "https://raw.githubusercontent.com/mui/base-ui/v1.9.0/packages/react/package.json": JSON.stringify({ name: "@base-ui/react", version: "1.9.0", peerDependencies: { react: "^17 || ^18 || ^19" } }),
      "https://data.jsdelivr.com/v1/packages/gh/mui/base-ui@v1.9.0?structure=flat": JSON.stringify({ files: [] }),
      "https://raw.githubusercontent.com/mui/base-ui/v1.9.0/docs/src/app/(docs)/react/components/page.mdx": fx("baseui-components.mdx"),
    };
    const get = async (url: string) => (routes[url] !== undefined ? { ...body(routes[url]!), url, finalUrl: url } : { ...notFound, url });
    const http = { get, getJson: async (url: string) => { const r = await get(url); return { data: r.body ? JSON.parse(r.body) : null, res: r }; } } as unknown as PoliteFetcher;
    const logs: string[] = [];
    const ctx: AdapterContext = { systemSlug: "base-ui", http, log: { info: (m) => logs.push(m), warn: (m) => logs.push(m), error: (m) => logs.push(m) }, runStartedAt: AT, limit: 2 };
    const docs = await adapter.discover(ctx);
    expect(docs[0]!.docKind).toBe("mui-package-json");
    expect((docs[0]!.meta as DocMeta).pin).toMatchObject({ version: "1.9.0", tag: "v1.9.0" });
    const pages = docs.filter((d) => d.docKind === "baseui-component-page").map((d) => (d.meta as DocMeta).slug);
    expect(pages).toEqual(["button", "accordion"]);
    expect(docs.every((d) => d.evidenceUrl?.startsWith("https://github.com/mui/base-ui/blob/v1.9.0/"))).toBe(true);
    expect(logs.some((l) => /listing .* unavailable/.test(l))).toBe(true);
  });
});
