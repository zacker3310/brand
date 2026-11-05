/**
 * GOV.UK adapter parser tests. Fixtures in tests/fixtures/adapters/govuk are trimmed excerpts of real
 * GOV.UK Design System / govuk-frontend sources (MIT; content OGL v3). No network access.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { COMPONENT_FIELDS, NormalizedBundle } from "@/lib/contracts";
import { adapter, parseListing } from "@/ingestion/adapters/govuk";
import { NHS } from "@/ingestion/adapters/govuk/constants";
import { defaultFixtureHtml } from "@/ingestion/adapters/govuk";
import {
  docsLinkTarget,
  keyboardSentences,
  parseNhsComponentDoc,
  parseNhsHome,
  parseNhsPrinciples,
  lifecycleFromStatus,
  parseComponentDoc,
  parseDocsColours,
  parseHome,
  parseLifecyclePage,
  parsePatternDoc,
  parsePrinciplesApi,
  parseReadme,
  parseSitemapLocs,
  sitemapSlugs,
} from "@/ingestion/adapters/govuk/docs";
import { findExampleCalls, stripNunjucks } from "@/ingestion/adapters/govuk/markdown";
import { humanizeMethod, parseAllMjs, parseComponentJs, parseMacroNjk, parsePrototypeKitConfig, parseTemplate } from "@/ingestion/adapters/govuk/markup";
import { makeRefFixer, normalizeGovuk, planComponents, type Ev, type GovukFragment } from "@/ingestion/adapters/govuk/normalize";
import { defaultFromDescription, optionToComponent, parseMacroOptionsJson, parseParamsYaml, statesFromExamples, statesFromParams } from "@/ingestion/adapters/govuk/params";
import { analyseComponentScss, declaredCustomProperties, parseSassDoc, parseSettingsFile, rewriteScssValue, unwrapDoubleParens } from "@/ingestion/adapters/govuk/scss";
import { validateGovuk } from "@/ingestion/adapters/govuk/validate";

const FX = path.resolve(import.meta.dirname, "../../fixtures/adapters/govuk");
const fx = (f: string) => readFileSync(path.join(FX, f), "utf8");
const ev = (sourceUrl: string, location: string): Ev => ({ sourceUrl, retrievedAt: "2026-11-05T00:00:00.000Z", contentHash: "abc", location });
const ORIGIN = "https://design-system.service.gov.uk";

describe("govuk docs markdown", () => {
  it("parses a component page: frontmatter description, example calls with headings, sections and links", () => {
    const d = parseComponentDoc(fx("button-index.md"));
    expect(d.title).toBe("Button");
    expect(d.description).toBe("Use the button component to help users carry out an action");
    expect(d.descriptionFrom).toBe("frontmatter");
    expect(d.status).toBeNull();
    expect(d.archived).toBe(false);
    expect(d.htmlAndNunjucks).toBe(true);
    expect(d.examples.map((e) => [e.example, e.heading])).toEqual([
      ["default", null],
      ["start", "Start buttons"],
      ["secondary", "Secondary buttons"],
      ["warning", "Warning buttons"],
      ["inverse", "Buttons on dark backgrounds"],
    ]);
    expect(d.sections.find((s) => s.title === "Buttons on dark backgrounds")?.codes).toContain("govuk-button--inverse");
    expect(d.patternLinks.map((l) => l.slug)).toContain("check-answers");
    expect(d.a11y.wcag).toEqual(["1.4.3"]);
    expect(d.a11y.guidance[0]).toMatch(/contrast ratio of at least 4\.5:1/);
    // Research section sentences are not accessibility guidance.
    expect(d.a11y.guidance.join(" ")).not.toMatch(/click-through/);
    expect(d.research).toMatch(/green as the colour of start buttons/);
  });

  it("strips Nunjucks tags without executing them and reads example() arguments as data", () => {
    const src = 'a\n{% from "_example.njk" import example %}\n{{ example({ group: "components", item: "tabs", example: "default", titleSuffix: "second" }) }}\nb';
    expect(stripNunjucks(src).split("\n")).toHaveLength(4);
    expect(stripNunjucks(src)).not.toMatch(/example|\{/);
    expect(findExampleCalls(src)).toEqual([{ group: "components", item: "tabs", example: "default", titleSuffix: "second", line: 3 }]);
  });

  it("extracts documented keyboard interactions, preferring present-tense instructions", () => {
    const d = parseComponentDoc(fx("exit-this-page-index.md"));
    expect(d.keyboard.map((k) => k.keys)).toEqual(["Shift", "Shift"]);
    expect(d.keyboard.map((k) => k.action)).toContain("The user has 5 seconds to press the shift key 3 times.");
    expect(keyboardSentences([{ section: null, blocks: ["We considered using the 'esc' key but rejected it."] }])).toEqual([]);
  });

  it("reads the trial status tag and the lifecycle rule that stable components have no tag", () => {
    const f = parseComponentDoc(fx("feedback-index.md"));
    expect(f.status).toBe("Trial");
    expect(f.statusDate).toBe("August 2026");
    expect(lifecycleFromStatus("Trial")).toBe("beta");
    expect(lifecycleFromStatus(null)).toBe("unknown");
    const rules = parseLifecyclePage(fx("lifecycle.md"));
    expect(rules.statuses).toEqual(["Trial", "Stable"]);
    expect(rules.stableHasNoTag).toBe(true);
  });

  it("parses a pattern page and detects archived pages", () => {
    const p = parsePatternDoc(fx("addresses-index.md"));
    expect(p.title).toBe("Addresses");
    expect(p.description).toBe("Help users provide an address");
    expect(p.theme).toBe("Ask users for…");
    expect(p.aliases).toEqual(["postcode"]);
    expect(p.componentLinks.map((l) => l.slug)).toContain("error-message");
    expect(p.examples.length).toBeGreaterThanOrEqual(3);
    expect(p.whenToUse).toBeTruthy();
    expect(parsePatternDoc(fx("start-pages-index.md")).archived).toBe(true);
  });

  it("maps docs links to sections and slugs", () => {
    expect(docsLinkTarget("/components/text-input/#hint-text")).toEqual({ section: "components", slug: "text-input" });
    expect(docsLinkTarget("https://design-system.service.gov.uk/patterns/dates/")).toEqual({ section: "patterns", slug: "dates" });
    expect(docsLinkTarget("https://example.com/components/x/")).toBeNull();
  });
});

describe("govuk docs data sources", () => {
  it("lists docs slugs from the sitemap, ignoring sub-pages", () => {
    const s = sitemapSlugs(parseSitemapLocs(fx("sitemap.xml")), ORIGIN);
    expect(s.components).toEqual(["button", "feedback", "tabs", "text-input"]);
  });

  it("reads functional colour groups and notes from data/colours.json", () => {
    const c = parseDocsColours(fx("colours.json"));
    expect(c.find((x) => x.name === "inverse-text")).toMatchObject({ group: "Text", colour: "#ffffff", notes: "Use this colour for text on dark backgrounds" });
  });

  it("reads principles from the GOV.UK Content API and the homepage statement", () => {
    const p = parsePrinciplesApi(fx("government-design-principles.json"));
    expect(p.principles.map((x) => x.name)).toEqual(["Start with user needs", "Do less", "Design with data", "Do the hard work to make it simple"]);
    expect(p.principles[0]!.anchor).toBe("start-with-user-needs");
    const h = parseHome(fx("index.njk"));
    expect(h.principlesText).toMatch(/^The GOV\.UK Design System helps teams that work on government services follow the Government Design Principles/);
    expect(h.principlesText).not.toMatch(/\s\./);
    expect(h.principleLinks.map((l) => l.url)).toContain("https://www.gov.uk/guidance/government-design-principles");
  });

  it("reads README title and first guidance sentence", () => {
    expect(parseReadme(fx("hint-README.md"))).toEqual({ title: "Hint", guidance: "The hint component is used in other input components." });
  });
});

describe("govuk macro options", () => {
  it("flattens nested YAML params with dotted names, defaults and isComponent flags", () => {
    const p = parseParamsYaml(fx("input.yaml"));
    expect(p.format).toBe("yaml");
    const names = p.params.map((x) => x.name);
    expect(names.slice(0, 3)).toEqual(["id", "name", "type"]);
    expect(names).toContain("prefix.text");
    expect(names).toContain("formGroup.classes");
    expect(p.params.find((x) => x.name === "label")).toMatchObject({ isComponent: true, required: true, depth: 0 });
    // "Defaults to the value of `name`" is not a literal default.
    expect(p.params.find((x) => x.name === "id")?.defaultValue).toBeNull();
    expect(p.examples.map((e) => e.name)).toEqual(["default", "with error message"]);
    expect(statesFromParams(p.params).map((s) => s.name)).toEqual(["Disabled", "Error"]);
  });

  it("reads defaults, example interaction states and array params from button.yaml", () => {
    const p = parseParamsYaml(fx("button.yaml"));
    expect(p.params.find((x) => x.name === "type")?.defaultValue).toBe("submit");
    expect(statesFromExamples(p.examples).map((s) => s.name)).toEqual(["Hover", "Active", "Focus"]);
    expect(defaultFromDescription("Defaults to `false`.")).toBe("false");
    expect(optionToComponent("errorMessage")).toBe("error-message");
  });

  it("parses macro-options.json (fallback source) with the same shape", () => {
    const p = parseMacroOptionsJson(fx("input-macro-options.json"));
    expect(p.format).toBe("macro-options-json");
    expect(p.params.find((x) => x.name === "errorMessage")?.isComponent).toBe(true);
    expect(p.params.some((x) => x.name === "prefix.text")).toBe(true);
    expect(parseMacroOptionsJson("not json").format).toBe("invalid");
  });

  it("keeps the first of duplicated options", () => {
    const y = "params:\n  - name: slots\n    type: object\n    params:\n      - name: end\n        type: string\n      - name: end\n        type: object\n";
    const p = parseParamsYaml(y);
    expect(p.params.map((x) => x.name)).toEqual(["slots", "slots.end"]);
    expect(p.params[1]!.type).toBe("string");
  });
});

describe("govuk SCSS tokens", () => {
  it("rewrites GOV.UK helper calls and variables to references without evaluating Sass", () => {
    expect(rewriteScssValue('helpers.govuk-colour("green")')).toEqual({ rawValue: "{govuk-palette.green.primary}", references: ["govuk-palette.green.primary"] });
    expect(rewriteScssValue('govuk-colour("blue", $variant: "shade-50")').rawValue).toBe("{govuk-palette.blue.shade-50}");
    expect(rewriteScssValue("govuk-functional-colour(brand)").references).toEqual(["govuk-functional-colours.brand"]);
    expect(rewriteScssValue("math.div($govuk-gutter, 2)")).toEqual({ rawValue: "math.div({govuk-gutter}, 2)", references: ["govuk-gutter"] });
    expect(rewriteScssValue('string.unquote("max(1px, .0625rem)")').rawValue).toBe("max(1px, .0625rem)");
    expect(rewriteScssValue('"magenta" "tint-50"').rawValue).toBe("{govuk-palette.magenta.tint-50}");
    expect(rewriteScssValue("700")).toEqual({ rawValue: 700, references: [] });
  });

  it("parses the palette map and the pre-brand correspondence table", () => {
    const r = parseSettingsFile(fx("_colours-palette--internal.scss"));
    const blue = r.tokens.find((t) => t.name === "govuk-palette.blue.primary");
    expect(blue).toMatchObject({ rawValue: "#1d70b8", path: ["govuk-palette", "blue", "primary"], doc: "Colour palette" });
    expect(r.tokens.find((t) => t.name === "govuk-palette.white")?.rawValue).toBe("#ffffff");
    expect(r.tokens.find((t) => t.name === "govuk-pre-brand-colours.light-pink")?.rawValue).toBe("{govuk-palette.magenta.tint-50}");
  });

  it("parses functional colour reference maps (double-wrapped map, entry comments, public alias name)", () => {
    expect(unwrapDoubleParens("$x: (\n  (\n    a: 1\n  )\n);")).toBe("$x:  \n  (\n    a: 1\n  )\n ;");
    const r = parseSettingsFile(fx("_colours-functional.scss"), { entryComments: true });
    const names = r.tokens.map((t) => t.name);
    expect(names[0]).toBe("govuk-functional-colours.brand");
    expect(names).toContain("govuk-functional-colours.print-text");
    expect(r.tokens.find((t) => t.name === "govuk-functional-colours.template-background")).toMatchObject({ rawValue: "{govuk-palette.blue.tint-95}" });
    expect(r.tokens.find((t) => t.name === "govuk-functional-colours.print-text")?.rawValue).toBe("#000000");
    expect(r.tokens.find((t) => t.name === "govuk-functional-colours.focus")?.comment).toMatch(/keyboard focus/);
    expect(r.skipped.map((s) => s.reason)).toContain("reassignment of an emitted variable");
  });

  it("marks deprecated legacy variables and organisation colours", () => {
    const legacy = parseSettingsFile(fx("_colours-legacy-functional.scss"));
    expect(legacy.tokens[0]).toMatchObject({ name: "govuk-brand-colour", rawValue: "{govuk-functional-colours.brand}", deprecated: true });
    const orgs = parseSettingsFile(fx("_colours-organisations.scss"));
    expect(orgs.tokens.map((t) => t.name)).toEqual([
      "govuk-colours-organisations.attorney-generals-office.colour",
      "govuk-colours-organisations.cabinet-office.colour",
      "govuk-colours-organisations.department-for-business-trade.colour",
      "govuk-colours-organisations.department-for-business-trade.contrast-safe",
    ]);
    expect(orgs.tokens[2]).toMatchObject({ deprecated: true });
    expect(orgs.tokens[2]!.deprecationNote).toMatch(/renamed/);
  });

  it("skips boolean settings and keeps numbers as numbers", () => {
    const t = parseSettingsFile(fx("_typography-font.scss"));
    expect(t.tokens.map((x) => x.name)).toEqual(["govuk-font-family", "govuk-font-family-print", "govuk-font-weight-regular", "govuk-font-weight-bold"]);
    expect(t.tokens[2]!.rawValue).toBe(400);
    expect(t.skipped.map((s) => s.name)).toContain("govuk-include-default-font-face");
    const s = parseSettingsFile(fx("_spacing.scss"));
    expect(s.tokens[0]).toMatchObject({ name: "govuk-spacing-points.0", rawValue: 0 });
    expect(s.tokens.find((x) => x.name === "govuk-spacing-responsive-scale.4.tablet")?.rawValue).toBe("20px");
    const m = parseSettingsFile(fx("_measurements.scss"));
    expect(m.tokens.find((x) => x.name === "govuk-gutter-half")).toMatchObject({ rawValue: "math.div({govuk-gutter}, 2)", references: ["govuk-gutter"] });
    expect(m.tokens.find((x) => x.name === "govuk-border-width-form-group-error")?.references).toEqual(["govuk-border-width"]);
  });

  it("parses SassDoc tags", () => {
    expect(parseSassDoc("Brand colour\n\n@type Colour\n@access public\n@deprecated\n  Use `govuk-functional-colour(brand)`.")).toEqual({
      description: "Brand colour",
      type: "Colour",
      access: "public",
      deprecated: "Use govuk-functional-colour(brand).",
    });
  });

  it("finds block modifiers and token usages in a component stylesheet (local variables excluded)", () => {
    const a = analyseComponentScss(fx("button-mixin.scss"));
    expect(a.modifiers.map((m) => `${m.block}--${m.modifier}`)).toEqual(["govuk-button--secondary", "govuk-button--warning", "govuk-button--inverse", "govuk-button--start"]);
    expect(a.usages.some((u) => u.tokenName === "govuk-spacing-points.2" && u.property === "padding")).toBe(true);
    expect(a.usages.some((u) => u.tokenName === "govuk-palette.green.shade-25" && u.property === null)).toBe(true);
    expect(a.usages.some((u) => u.tokenName === "govuk-border-width-form-element")).toBe(true);
    expect(a.usages.some((u) => u.tokenName === "govuk-button-colour")).toBe(false);
  });

  it("lists declared custom properties in compiled CSS", () => {
    expect(declaredCustomProperties(":root{--govuk-brand-colour:#1d70b8;--govuk-breakpoint-tablet:40.0625rem}.x{color:var(--govuk-text-colour)}")).toEqual(["--govuk-brand-colour", "--govuk-breakpoint-tablet"]);
  });
});

describe("govuk implementation files", () => {
  it("reads literal roles and component imports from Nunjucks templates", () => {
    expect(parseTemplate(fx("error-summary-template.njk")).roles).toEqual(["alert"]);
    expect(parseTemplate(fx("input-template.njk")).imports).toEqual(["error-message", "hint", "label"]);
    expect(parseTemplate('<div role="{{ role }}">').roles).toEqual([]);
  });

  it("reads roles and switch(event.key) handlers from component JS", () => {
    const j = parseComponentJs(fx("tabs.mjs"));
    expect(j.roles).toEqual(["presentation", "tab", "tablist", "tabpanel"]);
    expect(j.keyHandlers).toEqual([
      { keys: ["ArrowLeft"], method: "activatePreviousTab" },
      { keys: ["ArrowRight"], method: "activateNextTab" },
    ]);
    expect(humanizeMethod("activatePreviousTab")).toBe("Activate previous tab");
  });

  it("reads macro names and JS components from package manifests", () => {
    expect(parsePrototypeKitConfig(fx("govuk-prototype-kit.config.json"))).toMatchObject({ button: "govukButton", input: "govukInput", tabs: "govukTabs" });
    expect(parseAllMjs(fx("all.mjs"))).toMatchObject({ tabs: "Tabs", button: "Button" });
  });

  it("parses the jsDelivr flat listing into component folders", () => {
    const l = parseListing(fx("listing.json"));
    expect(l.components.map((c) => c.name)).toEqual(["button", "hint", "input", "tabs"]);
    expect(l.components[0]!.files).toContain("_settings.scss");
    expect(l.settingsFiles).toEqual(["_colours-functional.scss", "_spacing.scss"]);
  });
});

/* ------------------------------- normalize -------------------------------- */

const V = "6.6.0";
const pkgUrl = (f: string) => `https://cdn.jsdelivr.net/npm/govuk-frontend@${V}/${f}`;
const docsBlob = (f: string) => `https://github.com/alphagov/govuk-design-system/blob/main/${f}`;
const tagBlob = (f: string) => `https://github.com/alphagov/govuk-frontend/blob/v${V}/${f}`;

function fixtureFragments(): { data: GovukFragment }[] {
  const l = parseListing(fx("listing.json"));
  const s = sitemapSlugs(parseSitemapLocs(fx("sitemap.xml")), ORIGIN);
  const settings = (file: string, set: "colour-palette" | "functional-colours" | "spacing" | "component-settings", text: string, order = 0): GovukFragment => ({
    t: "settings",
    file,
    set,
    order,
    data: parseSettingsFile(text, { entryComments: /functional/.test(file) }),
    version: V,
    ev: ev(pkgUrl(`dist/govuk/settings/${file}`), `dist/govuk/settings/${file}`),
  });
  const list: GovukFragment[] = [
    { t: "pkg", name: "govuk-frontend", version: V, license: "MIT", publishedAt: "2026-10-15T10:19:51.755Z", ev: ev("https://www.npmjs.com/package/govuk-frontend/v/6.6.0", "govuk-frontend@6.6.0") },
    { t: "listing", version: V, components: l.components, settingsFiles: l.settingsFiles, ev: ev("https://www.jsdelivr.com/package/npm/govuk-frontend?version=6.6.0", "listing") },
    { t: "sitemap", ...s, ev: ev(`${ORIGIN}/sitemap.xml`, "sitemap.xml") },
    { t: "docs-component", docSlug: "button", data: parseComponentDoc(fx("button-index.md")), ev: ev(docsBlob("src/components/button/index.md"), "src/components/button/index.md") },
    { t: "docs-component", docSlug: "feedback", data: parseComponentDoc(fx("feedback-index.md")), ev: ev(docsBlob("src/components/feedback/index.md"), "src/components/feedback/index.md") },
    { t: "docs-pattern", docSlug: "addresses", data: parsePatternDoc(fx("addresses-index.md")), ev: ev(docsBlob("src/patterns/addresses/index.md"), "src/patterns/addresses/index.md") },
    { t: "docs-pattern", docSlug: "start-pages", data: parsePatternDoc(fx("start-pages-index.md")), ev: ev(docsBlob("src/patterns/start-pages/index.md"), "src/patterns/start-pages/index.md") },
    { t: "params", name: "button", data: parseParamsYaml(fx("button.yaml")), fromTag: true, version: V, ev: ev(tagBlob("packages/govuk-frontend/src/govuk/components/button/button.yaml"), "packages/govuk-frontend/src/govuk/components/button/button.yaml") },
    { t: "params", name: "input", data: parseParamsYaml(fx("input.yaml")), fromTag: true, version: V, ev: ev(tagBlob("packages/govuk-frontend/src/govuk/components/input/input.yaml"), "packages/govuk-frontend/src/govuk/components/input/input.yaml") },
    { t: "template", name: "input", data: parseTemplate(fx("input-template.njk")), ev: ev(pkgUrl("dist/govuk/components/input/template.njk"), "dist/govuk/components/input/template.njk") },
    { t: "styles", name: "button", file: "dist/govuk/components/button/_mixin.scss", data: analyseComponentScss(fx("button-mixin.scss")), ev: ev(pkgUrl("dist/govuk/components/button/_mixin.scss"), "dist/govuk/components/button/_mixin.scss") },
    { t: "template", name: "tabs", data: parseTemplate('<div class="govuk-tabs" data-module="govuk-tabs">'), ev: ev(pkgUrl("dist/govuk/components/tabs/template.njk"), "dist/govuk/components/tabs/template.njk") },
    { t: "js", name: "tabs", data: parseComponentJs(fx("tabs.mjs")), ev: ev(pkgUrl("dist/govuk/components/tabs/tabs.mjs"), "dist/govuk/components/tabs/tabs.mjs") },
    { t: "html-example", name: "button", html: fx("button-template-default.html").trim(), version: V, ev: ev(pkgUrl("dist/govuk/components/button/template-default.html"), "dist/govuk/components/button/template-default.html") },
    { t: "readme", name: "hint", ...parseReadme(fx("hint-README.md")), ev: ev(pkgUrl("dist/govuk/components/hint/README.md"), "dist/govuk/components/hint/README.md") },
    { t: "macros", macros: parsePrototypeKitConfig(fx("govuk-prototype-kit.config.json")), ev: ev(pkgUrl("govuk-prototype-kit.config.json"), "govuk-prototype-kit.config.json") },
    { t: "lifecycle", rules: parseLifecyclePage(fx("lifecycle.md")), ev: ev(docsBlob("src/community/component-lifecycle-statuses/index.md"), "src/community/component-lifecycle-statuses/index.md") },
    { t: "colours-json", colours: parseDocsColours(fx("colours.json")), ev: ev(docsBlob("data/colours.json"), "data/colours.json") },
    { t: "css", customProperties: ["--govuk-brand-colour", "--govuk-text-colour"], ev: ev(pkgUrl("dist/govuk/govuk-frontend.min.css"), "dist/govuk/govuk-frontend.min.css") },
    { t: "home", data: parseHome(fx("index.njk")), ev: ev(docsBlob("src/index.njk"), "src/index.njk") },
    { t: "principles", ...parsePrinciplesApi(fx("government-design-principles.json")), ev: ev("https://www.gov.uk/guidance/government-design-principles", "/api/content/guidance/government-design-principles details.body h2") },
    settings("_colours-palette--internal.scss", "colour-palette", fx("_colours-palette--internal.scss")),
    settings("_colours-functional.scss", "functional-colours", fx("_colours-functional.scss")),
    settings("_colours-legacy-functional.scss", "functional-colours", fx("_colours-legacy-functional.scss"), 1),
    settings("_spacing.scss", "spacing", fx("_spacing.scss")),
    settings("components/button/_settings.scss", "component-settings", fx("button-_settings.scss")),
  ];
  return list.map((data) => ({ data }));
}

describe("govuk normalize", () => {
  it("plans components from the package listing and sitemap (input -> text-input, docs-only pages, limit)", () => {
    const l = parseListing(fx("listing.json"));
    const s = sitemapSlugs(parseSitemapLocs(fx("sitemap.xml")), ORIGIN);
    const plan = planComponents({ t: "listing", version: V, ...l, ev: ev("https://x.test", "x") }, { t: "sitemap", ...s, ev: ev("https://x.test", "x") }, []);
    expect(plan.map((p) => [p.slug, p.frontend, p.docSlug])).toEqual([
      ["button", "button", "button"],
      ["feedback", null, "feedback"],
      ["hint", "hint", null],
      ["tabs", "tabs", "tabs"],
      ["text-input", "input", "text-input"],
    ]);
    expect(planComponents({ t: "listing", version: V, ...l, ev: ev("https://x.test", "x") }, undefined, [], 2).map((p) => p.slug)).toEqual(["button", "hint"]);
  });

  it("produces a contract-valid bundle with honest coverage and evidence", () => {
    const { bundle, colourMismatches } = normalizeGovuk("govuk-design-system", fixtureFragments());
    expect(NormalizedBundle.safeParse(bundle).success).toBe(true);
    expect(colourMismatches).toEqual([]);
    expect(bundle.components.map((c) => c.slug)).toEqual(["button", "feedback", "hint", "tabs", "text-input"]);
    for (const c of bundle.components) for (const f of COMPONENT_FIELDS) expect(c.coverage[f], `${c.slug}.${f}`).toBeDefined();

    const button = bundle.components.find((c) => c.slug === "button")!;
    expect(button).toMatchObject({ name: "Button", lifecycle: "stable", canonicalType: "button", docsUrl: `${ORIGIN}/components/button/` });
    expect(button.sourceCodeUrl).toBe("https://github.com/alphagov/govuk-frontend/tree/v6.6.0/packages/govuk-frontend/src/govuk/components/button");
    expect(button.variants.map((v) => v.name)).toEqual(["secondary", "warning", "inverse", "start"]);
    expect(button.variants.find((v) => v.name === "inverse")?.description).toMatch(/govuk-button--inverse modifier class/);
    expect(button.states.map((s) => [s.name, s.canonical])).toEqual([
      ["Hover", "hover"],
      ["Active", "active"],
      ["Focus", "focus"],
      ["Disabled", "disabled"],
    ]);
    expect(button.frameworks.map((f) => [f.slug, f.importName])).toEqual([
      ["nunjucks", "govukButton"],
      ["html-css", "govuk-button"],
    ]);
    expect(button.properties.every((p) => p.implementation === "nunjucks")).toBe(true);
    expect(button.examples.find((e) => e.kind === "code-snippet")).toMatchObject({ language: "html", attribution: expect.stringMatching(/MIT/) });
    expect(button.tokenUsages.some((u) => u.tokenName === "govuk-spacing-points.2" && u.property === "padding")).toBe(true);
    // Usages naming tokens not in the bundle are dropped (palette fixture is trimmed).
    expect(button.tokenUsages.every((u) => u.tokenName !== "govuk-palette.green.shade-25")).toBe(true);
    expect(button.coverage).toMatchObject({ variants: "documented", keyboard: "not-documented", properties: "documented" });
    expect(button.evidence.some((e) => e.field === "lifecycle" && e.extractionMethod === "adapter:govuk:docs-lifecycle")).toBe(true);

    const feedback = bundle.components.find((c) => c.slug === "feedback")!;
    expect(feedback.lifecycle).toBe("beta");
    expect(feedback.coverage.properties).toBe("not-extracted");

    const hint = bundle.components.find((c) => c.slug === "hint")!;
    expect(hint).toMatchObject({ name: "Hint", docsUrl: null, lifecycle: "unknown", description: "The hint component is used in other input components." });

    const tabs = bundle.components.find((c) => c.slug === "tabs")!;
    expect(tabs.accessibility?.keyboard).toEqual([
      { keys: "ArrowLeft", action: "Activate previous tab" },
      { keys: "ArrowRight", action: "Activate next tab" },
    ]);
    expect(tabs.coverage.keyboard).toBe("inferred");
    expect(tabs.evidence.find((e) => e.field === "keyboard")?.state).toBe("inferred");

    const input = bundle.components.find((c) => c.slug === "text-input")!;
    // No docs page fragment in this fixture set: name falls back to the package folder name; docs URL from the sitemap.
    expect(input).toMatchObject({ name: "Input", docsUrl: `${ORIGIN}/components/text-input/`, aliases: ["govukInput"] });
    expect(input.relationships.filter((r) => r.kind === "composes").map((r) => r.targetSlug)).toEqual(["hint"]);
    expect(input.states.map((s) => s.name)).toEqual(["Disabled", "Error"]);
  });

  it("builds token sets with references, verified cssVar names and component tier", () => {
    const { bundle } = normalizeGovuk("govuk-design-system", fixtureFragments());
    expect(bundle.tokenSets.map((s) => s.slug)).toEqual(["colour-palette", "functional-colours", "spacing", "component-settings"]);
    const fn = bundle.tokenSets.find((s) => s.slug === "functional-colours")!;
    const brand = fn.tokens.find((t) => t.name === "govuk-functional-colours.brand")!;
    expect(brand).toMatchObject({ rawValue: "{govuk-palette.blue.primary}", references: ["govuk-palette.blue.primary"], cssVar: "--govuk-brand-colour", type: "color", tier: "semantic" });
    // Not declared in the (fixture) compiled CSS -> no cssVar claimed.
    expect(fn.tokens.find((t) => t.name === "govuk-functional-colours.focus")?.cssVar).toBeNull();
    // White has no variants: the default "primary" variant reference is normalized to the palette entry.
    expect(fn.tokens.find((t) => t.name === "govuk-functional-colours.inverse-text")?.references).toEqual(["govuk-palette.white"]);
    expect(fn.tokens.find((t) => t.name === "govuk-functional-colours.inverse-text")?.description).toMatch(/^Docs colour group: Text\. Use this colour for text on dark backgrounds\./);
    expect(fn.tokens.find((t) => t.name === "govuk-brand-colour")).toMatchObject({ deprecated: true, rawValue: "{govuk-functional-colours.brand}" });
    const comp = bundle.tokenSets.find((s) => s.slug === "component-settings")!;
    expect(comp.tokens[0]).toMatchObject({ name: "govuk-button-background-colour", tier: "component", location: "dist/govuk/components/button/_settings.scss#L12" });
    for (const s of bundle.tokenSets) expect(s).toMatchObject({ theme: null, packageName: "govuk-frontend", packageVersion: V, redistribution: "permitted", format: "scss" });
    const fix = makeRefFixer(new Set(["govuk-palette.white", "govuk-pre-brand-colours.light-grey"]));
    expect(fix("govuk-palette.light-grey.primary")).toBe("govuk-pre-brand-colours.light-grey");
  });

  it("builds patterns (archived pages skipped) and system facts with evidence", () => {
    const { bundle } = normalizeGovuk("govuk-design-system", fixtureFragments());
    expect(bundle.patterns.map((p) => p.slug)).toEqual(["addresses"]);
    expect(bundle.patterns[0]).toMatchObject({ canonicalType: "data-entry", docsUrl: `${ORIGIN}/patterns/addresses/` });
    expect(bundle.facts?.latestVersion).toBe(V);
    expect(bundle.facts?.principles?.[0]).toEqual({ name: "Start with user needs", sourceUrl: "https://www.gov.uk/guidance/government-design-principles#start-with-user-needs" });
    const fields = new Set(bundle.facts?.evidence.map((e) => e.field));
    for (const f of ["latestVersion", "latestReleaseAt", "philosophy", "principles", "frameworks"]) expect(fields.has(f)).toBe(true);
  });

  it("is deterministic regardless of fragment order", () => {
    const a = normalizeGovuk("govuk-design-system", fixtureFragments()).bundle;
    const b = normalizeGovuk("govuk-design-system", [...fixtureFragments()].reverse()).bundle;
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it("validate() flags duplicates and missing well-known entities on full runs only", () => {
    const { bundle } = normalizeGovuk("govuk-design-system", fixtureFragments());
    const limited = validateGovuk(bundle, { limit: 5 });
    expect(limited.filter((i) => i.severity === "error")).toEqual([]);
    const full = validateGovuk(bundle, {});
    expect(full.some((i) => i.severity === "error" && /well-known component missing: radios/.test(i.message))).toBe(true);
    const dup = { ...bundle, components: [...bundle.components, bundle.components[0]!] };
    expect(validateGovuk(dup, { limit: 5 }).some((i) => i.code === "DUPLICATE" && i.severity === "error")).toBe(true);
  });

  it("declares the registry slug it handles", () => {
    expect(adapter.id).toBe("govuk");
    expect(adapter.systems).toContain("govuk-design-system");
  });
});

/* ---------------------------------- NHS ----------------------------------- */

describe("nhs profile", () => {
  const NHS_ORIGIN = "https://service-manual.nhs.uk";

  it("parses NHS service manual page templates (set variables, static HTML sections, designExample calls)", () => {
    const d = parseNhsComponentDoc(fx("nhs-buttons-index.njk"));
    expect(d.title).toBe("Buttons");
    expect(d.description).toBe("Use buttons to help users carry out an action on a page like starting an application or saving their progress.");
    expect(d.whenToUse).toBe("Use buttons to start transactional journeys and carry out actions, like saving information.");
    expect(d.sections.map((s) => [s.depth, s.title]).slice(0, 4)).toEqual([
      [2, "When to use buttons"],
      [2, "When not to use buttons"],
      [2, "How to use buttons"],
      [3, "Primary buttons"],
    ]);
    expect(d.sections.find((s) => s.title === "Primary buttons on dark backgrounds")?.codes).toContain("nhsuk-button--reverse");
    expect(d.examples.map((e) => [e.example, e.heading]).slice(0, 2)).toEqual([
      ["default", "Primary buttons"],
      ["reverse", "Primary buttons on dark backgrounds"],
    ]);
    expect(d.a11y.wcag).toEqual(["1.4.11"]);
    expect(d.htmlAndNunjucks).toBe(true);
    expect(d.withdrawn).toBeNull();
  });

  it("detects withdrawn components and reads principles and the landing page description", () => {
    expect(parseNhsComponentDoc(fx("nhs-review-date-index.njk")).withdrawn).toBe("We no longer have a review date component.");
    const p = parseNhsPrinciples(fx("nhs-design-principles.njk"));
    expect(p.title).toBe("Design principles");
    expect(p.principles).toEqual([
      { name: "Put people at the heart of everything you do", anchor: "put-people-at-the-heart-of-everything-you-do" },
      { name: "Design for the outcome", anchor: "design-for-the-outcome" },
    ]);
    expect(parseNhsHome(fx("nhs-design-system-index.njk")).description).toMatch(/^Build consistent, accessible NHS services/);
  });

  it("maps NHS docs links and sitemap slugs under /design-system", () => {
    expect(docsLinkTarget("/design-system/patterns/know-that-a-page-is-up-to-date")).toEqual({ section: "patterns", slug: "know-that-a-page-is-up-to-date" });
    const s = sitemapSlugs(parseSitemapLocs(fx("nhs-sitemap.xml")), NHS_ORIGIN, "/design-system");
    expect(s.components).toEqual(["buttons", "hint-text", "review-date", "text-input"]);
    expect(s.patterns).toEqual(["check-answers"]);
  });

  it("parses NHS settings (flat palette, applied colours, global settings) with the nhsuk prefix", () => {
    const pal = parseSettingsFile(fx("nhs-_colours-palette.scss"), { prefix: "nhsuk" });
    expect(pal.tokens.map((t) => t.name)).toContain("nhsuk-colours.blue");
    expect(pal.tokens.some((t) => /aliases|deprecated/.test(t.name))).toBe(false);
    const ap = parseSettingsFile(fx("nhs-_colours-applied.scss"), { prefix: "nhsuk" });
    expect(ap.tokens[0]).toMatchObject({ name: "nhsuk-brand-colour", rawValue: "{nhsuk-colours.blue}", references: ["nhsuk-colours.blue"], doc: "Brand colour" });
    const g = parseSettingsFile(fx("nhs-_globals.scss"), { prefix: "nhsuk" });
    expect(g.tokens.find((t) => t.name === "nhsuk-font-family")).toMatchObject({ rawValue: "{nhsuk-font}, {nhsuk-font-fallback}", references: ["nhsuk-font", "nhsuk-font-fallback"] });
    expect(g.tokens.some((t) => /-path$/.test(t.name))).toBe(false);
    expect(g.skipped.map((x) => x.reason)).toContain("configuration path or interpolated string");
    expect(rewriteScssValue("nhsuk-spacing(3)", { prefix: "nhsuk" }).references).toEqual(["nhsuk-spacing-points.3"]);
  });

  it("reads modifiers, macro names and default fixture HTML from nhsuk-frontend files", () => {
    const a = analyseComponentScss(fx("nhs-button-index.scss"), "nhsuk");
    expect(a.modifiers.map((m) => m.modifier)).toEqual(["secondary", "secondary-solid", "reverse", "warning", "brand", "login"]);
    expect(a.usages.some((u) => u.tokenName === "nhsuk-border-width-form-element" && u.property === "border")).toBe(true);
    expect(parseMacroNjk(fx("nhs-button-macro.njk"))).toBe("button");
    expect(defaultFixtureHtml(fx("nhs-button-fixtures.json"))).toMatch(/^<button class="nhsuk-button"/);
    const l = parseListing(fx("nhs-listing.json"), NHS);
    expect(l.components.map((c) => c.name)).toEqual(["button", "hint", "input"]);
    expect(l.settingsFiles).toEqual(["_colours-palette.scss", "_spacing.scss"]);
  });

  it("normalizes an NHS bundle: docs slugs as component slugs, deprecated lifecycle, cssVar from compiled CSS", () => {
    const l = parseListing(fx("nhs-listing.json"), NHS);
    const s = sitemapSlugs(parseSitemapLocs(fx("nhs-sitemap.xml")), NHS_ORIGIN, "/design-system");
    const e = (u: string) => ev(u, u.replace(/^https:\/\/[^/]+\/[^/]+\/[^/]+\/(blob\/[^/]+\/)?/, ""));
    const frags: { data: GovukFragment }[] = [
      { t: "pkg", name: "nhsuk-frontend", version: "10.7.1", license: "MIT", publishedAt: "2026-10-29T12:31:41.146Z", ev: e("https://www.npmjs.com/package/nhsuk-frontend/v/10.7.1") },
      { t: "listing", version: "10.7.1", ...l, ev: e("https://www.jsdelivr.com/package/npm/nhsuk-frontend?version=10.7.1") },
      { t: "sitemap", ...s, ev: e(`${NHS_ORIGIN}/sitemap.xml`) },
      { t: "docs-component", docSlug: "buttons", data: parseNhsComponentDoc(fx("nhs-buttons-index.njk")), ev: e("https://github.com/nhsuk/nhsuk-service-manual/blob/main/app/views/design-system/components/buttons/index.njk") },
      { t: "docs-component", docSlug: "review-date", data: parseNhsComponentDoc(fx("nhs-review-date-index.njk")), ev: e("https://github.com/nhsuk/nhsuk-service-manual/blob/main/app/views/design-system/components/review-date/index.njk") },
      { t: "params", name: "button", data: parseMacroOptionsJson(fx("nhs-button-macro-options.json")), fromTag: false, version: "10.7.1", ev: e("https://cdn.jsdelivr.net/npm/nhsuk-frontend@10.7.1/dist/nhsuk/components/button/macro-options.json") },
      { t: "template", name: "button", data: parseTemplate('<button class="nhsuk-button">'), fromTag: true, ev: e("https://github.com/nhsuk/nhsuk-frontend/blob/v10.7.1/packages/nhsuk-frontend/src/nhsuk/components/button/template.njk") },
      { t: "macro", name: "button", macroName: parseMacroNjk(fx("nhs-button-macro.njk")), ev: e("https://cdn.jsdelivr.net/npm/nhsuk-frontend@10.7.1/dist/nhsuk/components/button/macro.njk") },
      { t: "styles", name: "button", file: "dist/nhsuk/components/button/_index.scss", data: analyseComponentScss(fx("nhs-button-index.scss"), "nhsuk"), ev: e("https://cdn.jsdelivr.net/npm/nhsuk-frontend@10.7.1/dist/nhsuk/components/button/_index.scss") },
      { t: "settings", file: "_colours-palette.scss", set: "colour-palette", order: 0, data: parseSettingsFile(fx("nhs-_colours-palette.scss"), { prefix: "nhsuk" }), version: "10.7.1", ev: e("https://cdn.jsdelivr.net/npm/nhsuk-frontend@10.7.1/dist/nhsuk/core/settings/_colours-palette.scss") },
      { t: "settings", file: "_colours-applied.scss", set: "applied-colours", order: 0, data: parseSettingsFile(fx("nhs-_colours-applied.scss"), { prefix: "nhsuk" }), version: "10.7.1", ev: e("https://cdn.jsdelivr.net/npm/nhsuk-frontend@10.7.1/dist/nhsuk/core/settings/_colours-applied.scss") },
      { t: "css", customProperties: ["--nhsuk-blue-colour", "--nhsuk-brand-colour"], ev: e("https://cdn.jsdelivr.net/npm/nhsuk-frontend@10.7.1/dist/nhsuk/nhsuk-frontend.min.css") },
      { t: "home", data: parseNhsHome(fx("nhs-design-system-index.njk")), ev: e("https://github.com/nhsuk/nhsuk-service-manual/blob/main/app/views/design-system/index.njk") },
      { t: "principles", ...parseNhsPrinciples(fx("nhs-design-principles.njk")), ev: e("https://github.com/nhsuk/nhsuk-service-manual/blob/main/app/views/design-system/design-principles.njk") },
    ].map((data) => ({ data: data as GovukFragment }));
    const { bundle } = normalizeGovuk("nhs-design-system", frags);
    expect(NormalizedBundle.safeParse(bundle).success).toBe(true);
    // Planned components without any parsed source document (hint-text, text-input here) are skipped.
    expect(bundle.components.map((c) => c.slug)).toEqual(["buttons", "review-date"]);
    const b = bundle.components.find((c) => c.slug === "buttons")!;
    expect(b).toMatchObject({ name: "Buttons", docsUrl: `${NHS_ORIGIN}/design-system/components/buttons`, lifecycle: "unknown", canonicalType: "button" });
    expect(b.sourceCodeUrl).toBe("https://github.com/nhsuk/nhsuk-frontend/tree/v10.7.1/packages/nhsuk-frontend/src/nhsuk/components/button");
    expect(b.frameworks.map((f) => [f.slug, f.packageName, f.importName])).toEqual([
      ["nunjucks", "nhsuk-frontend", "button"],
      ["html-css", "nhsuk-frontend", "nhsuk-button"],
    ]);
    expect(b.variants.find((v) => v.name === "reverse")?.description).toMatch(/nhsuk-button--reverse/);
    expect(b.examples[0]!.url).toBe(`${NHS_ORIGIN}/design-example/components/buttons/default`);
    expect(bundle.components.find((c) => c.slug === "review-date")?.lifecycle).toBe("deprecated");
    const ap = bundle.tokenSets.find((x) => x.slug === "applied-colours")!;
    expect(ap.tokens[0]).toMatchObject({ name: "nhsuk-brand-colour", cssVar: "--nhsuk-brand-colour", tier: "semantic", type: "color" });
    expect(bundle.tokenSets.find((x) => x.slug === "colour-palette")?.tokens.find((t) => t.name === "nhsuk-colours.blue")?.cssVar).toBe("--nhsuk-blue-colour");
    for (const set of bundle.tokenSets) expect(set).toMatchObject({ packageName: "nhsuk-frontend", license: { slug: "mit" }, theme: null });
    expect(bundle.facts?.principles?.[0]?.sourceUrl).toBe(`${NHS_ORIGIN}/design-system/design-principles#put-people-at-the-heart-of-everything-you-do`);
    expect(bundle.facts?.philosophy).toMatch(/^ATLAS summary/);
    expect(validateGovuk(bundle, { limit: 4, profile: NHS }).filter((i) => i.severity === "error")).toEqual([]);
  });

  it("handles both registry systems", () => {
    expect(adapter.systems).toEqual(["govuk-design-system", "nhs-design-system"]);
  });
});
