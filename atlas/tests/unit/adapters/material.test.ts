/**
 * Unit tests for the "material" adapter (material-design + material-web). No network: every
 * input is a trimmed fixture copied from material-components/material-web@v2.5.0 (Apache-2.0)
 * or from m3.material.io server HTML / sitemap.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { NormalizedBundle } from "@/lib/contracts";
import { adapter, findSentence, plainBlocks, validateMaterialBundle } from "@/ingestion/adapters/material";
import { cleanDoc, parseCem } from "@/ingestion/adapters/material/cem";
import { m3ComponentPages, parseM3Page, parseSitemap, titleMatchesSlug } from "@/ingestion/adapters/material/m3-html";
import { githubAnchor, keyboardFrom, parseMwcDoc } from "@/ingestion/adapters/material/mwc-docs";
import { m3ComponentForStem, statesFromGroups } from "@/ingestion/adapters/material/normalize-design";
import { classifyElements, classifyName, displayName, literalUnion, normalizeMwcComponents } from "@/ingestion/adapters/material/normalize-web";
import { addToIndex, latestValueToRaw, parseLatestSass, parseSupportedTokens, parseV0192, unwrapList, type SassVarIndex } from "@/ingestion/adapters/material/sass";
import { firstSentence, singularize, type Prov } from "@/ingestion/adapters/material/shared";
import { buildM3TokenSets, buildMwTokenSets, commonPrefix, m3Category, m3SetFor, tierFor } from "@/ingestion/adapters/material/tokens";
import type { AdapterContext, DiscoveredDocument, ParsedFragment } from "@/ingestion/types";
import type { FetchResult, PoliteFetcher } from "@/ingestion/http";

const FX = path.resolve(__dirname, "../../fixtures/adapters/material");
const fx = (f: string) => readFileSync(path.join(FX, f), "utf8");
const prov = (file: string, sourceUrl = `https://github.com/material-components/material-web/blob/v2.5.0/${file}`): Prov => ({
  sourceUrl,
  fetchedUrl: sourceUrl,
  retrievedAt: "2026-11-05T00:00:00.000Z",
  contentHash: "abc123",
  file,
});

/* ------------------------------------ sass ------------------------------------ */

describe("parseLatestSass (M3 token DB sass_vars export)", () => {
  const color = parseLatestSass(fx("_md-sys-color.scss"));

  it("reads the generator header", () => {
    expect(color.designSystem).toBe("Google Material 3");
    expect(color.version).toBe("34.0.21");
    expect(color.contextTags).toMatchObject({ audience: "3p", platform: "web" });
    expect(color.uses).toEqual(["md-ref-palette"]);
  });

  it("extracts dotted names, groups, descriptions and references; drops dangling doc blocks", () => {
    const names = color.tokens.map((t) => t.tokenName);
    expect(names).toEqual(["md.sys.color.background", "md.sys.color.error"]);
    const bg = color.tokens[0]!;
    expect(bg.varName).toBe("background");
    expect(bg.group).toBe("Add-ons / Add-on surface colors");
    expect(bg.description).toMatch(/legacy color role/);
    expect(bg.refs).toEqual([{ module: "md-ref-palette", varName: "neutral98" }]);
  });

  it("flags deprecated tokens and generator placeholders", () => {
    const elev = parseLatestSass(fx("_md-sys-elevation.scss"));
    const tint = elev.tokens.find((t) => t.tokenName === "md.sys.elevation.surface-tint-color")!;
    expect(tint.deprecated).toBe(true);
    expect(tint.description).toMatch(/Deprecated: Moved to/);
    const motion = parseLatestSass(fx("_md-sys-motion.scss"));
    expect(motion.tokens.find((t) => t.tokenName === "md.sys.motion.path")!.unsupported).toBe(true);
    expect(motion.tokens.find((t) => t.tokenName === "md.sys.motion.easing.standard")!.rawScss).toBe("cubic-bezier(0.2, 0, 0, 1)");
  });

  it("ignores mixins", () => {
    const ts = parseLatestSass(fx("_md-sys-typescale.scss"));
    expect(ts.tokens.map((t) => t.tokenName)).toEqual(["md.sys.typescale.body-large.font", "md.sys.typescale.body-large.weight"]);
  });

  it("converts references to DTCG braces only when the target is documented", () => {
    const index: SassVarIndex = new Map();
    addToIndex(index, "md-ref-palette", parseLatestSass(fx("_md-ref-palette.scss")));
    const bg = color.tokens[0]!;
    expect(latestValueToRaw(bg, index)).toEqual({ rawValue: "{md.ref.palette.neutral98}", references: ["md.ref.palette.neutral98"], unresolved: [] });
    const missing = latestValueToRaw({ ...bg, rawScss: "md-ref-palette.$nope1", refs: [{ module: "md-ref-palette", varName: "nope1" }] }, index);
    expect(missing.references).toEqual([]);
    expect(missing.unresolved).toEqual(["md-ref-palette.$nope1"]);
  });
});

describe("parseV0192 (Sass map functions)", () => {
  it("classifies references, hard-coded literals and composites", () => {
    const f = parseV0192(fx("v0_192_md-comp-filled-button.scss"));
    expect(f.designSystemVersion).toBe("v0.192");
    const e = Object.fromEntries(f.functions.values!.map((x) => [x.key, x]));
    expect(e["container-color"]).toMatchObject({ kind: "ref", module: "md-sys-color", refKey: "primary" });
    expect(e["container-height"]).toMatchObject({ kind: "literal", literal: "40px" });
    expect(e["disabled-container-opacity"]).toMatchObject({ kind: "literal", literal: "0.12" });
    expect(e["label-text-type"]!.kind).toBe("composite");
    expect(e["label-text-weight"]).toMatchObject({ kind: "ref", module: "md-sys-typescale", refKey: "label-large-weight" });
  });

  it("parses multiple functions (values-dark / values-light)", () => {
    const f = parseV0192(fx("v0_192_md-sys-color.scss"));
    expect(Object.keys(f.functions).sort()).toEqual(["values-dark", "values-light"]);
    expect(f.functions["values-dark"]!.find((x) => x.key === "background")).toMatchObject({ kind: "ref", refKey: "neutral6" });
  });

  it("unwraps Sass list literals", () => {
    expect(unwrapList("(Roboto)")).toBe("Roboto");
    expect(unwrapList("(16px 16px 0px 0px)")).toBe("16px 16px 0px 0px");
    expect(unwrapList("40px")).toBe("40px");
  });
});

describe("parseSupportedTokens (material-web wrappers)", () => {
  it("reads supported keys, wrapped v0.192 module and CSS custom property prefix", () => {
    const w = parseSupportedTokens(fx("_md-comp-filled-button.top.scss"));
    expect(w.supported).toContain("container-color");
    expect(w.supported).not.toContain("go/keep-sorted start");
    expect(w.v0192Modules).toEqual(["md-comp-filled-button"]);
    expect(w.customPropertyPrefix).toBe("md-filled-button");
  });
});

/* ------------------------------------ tokens ------------------------------------ */

describe("token set builders", () => {
  it("assigns M3 files to sets with themes and tiers", () => {
    expect(m3SetFor("md-sys-color")).toMatchObject({ slug: "m3-sys-color-light", theme: "light" });
    expect(m3SetFor("md-sys-color__dark__high-contrast")).toMatchObject({ slug: "m3-sys-color-dark-high-contrast", theme: "dark-high-contrast" });
    expect(m3SetFor("md-comp-button-filled").slug).toBe("m3-component-tokens");
    expect(tierFor("md.ref.palette.primary40")).toBe("primitive");
    expect(tierFor("md.sys.color.primary")).toBe("semantic");
    expect(tierFor("md.comp.button.filled.container.color")).toBe("component");
    expect(commonPrefix(["md.sys.state.focus-indicator.thickness", "md.sys.state.focus-indicator.outer-offset"])).toBe("md.sys.state.focus-indicator");
  });

  it("categorizes by M3 naming", () => {
    expect(m3Category("md.sys.typescale.headline-small.size", "1.5rem")).toBe("typography");
    expect(m3Category("md.comp.button.filled.container.color", "{x}")).toBe("color");
    expect(m3Category("md.comp.button.filled.disabled.icon.opacity", 0.38)).toBe("opacity");
    expect(m3Category("md.comp.filled-button.container-height", "40px")).toBe("spacing");
    expect(m3Category("md.comp.filled-button.label-text-size", "{x}")).toBe("typography");
  });

  it("builds M3 sets preserving references, deprecations and skipping placeholders", () => {
    const inputs = ["md-ref-palette", "md-sys-color", "md-sys-elevation", "md-sys-motion", "md-comp-button-filled"].map((stem) => ({
      prov: prov(`tokens/versions/latest/sass/_${stem}.scss`),
      stem,
      file: parseLatestSass(fx(`_${stem}.scss`)),
    }));
    const r = buildM3TokenSets(inputs, { version: "2.5.0", ref: "v2.5.0", treeUrl: "https://github.com/material-components/material-web/tree/v2.5.0/tokens/versions/latest/sass" });
    const slugs = r.sets.map((s) => s.slug);
    expect(slugs).toEqual(["m3-component-tokens", "m3-ref-palette", "m3-sys-color-light", "m3-sys-elevation", "m3-sys-motion"]);
    const light = r.sets.find((s) => s.slug === "m3-sys-color-light")!;
    expect(light.theme).toBe("light");
    expect(light.name).toMatch(/M3 token DB 34\.0\.21/);
    expect(light.packageVersion).toBe("2.5.0");
    expect(light.license?.spdxId).toBe("Apache-2.0");
    expect(light.tokens.find((t) => t.name === "md.sys.color.error")).toMatchObject({ rawValue: "{md.ref.palette.error40}", references: ["md.ref.palette.error40"], tier: "semantic", category: "color" });
    const comp = r.sets.find((s) => s.slug === "m3-component-tokens")!;
    const hov = comp.tokens.find((t) => t.name === "md.comp.button.filled.hovered.container.elevation")!;
    expect(hov.deprecated).toBe(true);
    expect(hov.rawValue).toBe("{md.sys.elevation.level1}");
    expect(comp.tokens.find((t) => t.name === "md.comp.button.filled.disabled.icon.opacity")!.rawValue).toBe(0.38);
    expect(r.sets.find((s) => s.slug === "m3-sys-motion")!.tokens.map((t) => t.name)).not.toContain("md.sys.motion.path");
    expect(r.warnings.some((w) => /md\.sys\.motion\.path has no value/.test(w))).toBe(true);
    expect(r.groupsByStem.get("md-comp-button-filled")).toEqual(expect.arrayContaining(["Disabled", "Enabled", "Hovered"]));
  });

  it("builds material-web sets with CSS custom properties only for exact wrapper modules", () => {
    const v0192 = [
      { prov: prov("tokens/versions/v0_192/_md-comp-filled-button.scss"), stem: "md-comp-filled-button", file: parseV0192(fx("v0_192_md-comp-filled-button.scss")) },
      { prov: prov("tokens/versions/v0_192/_md-sys-color.scss"), stem: "md-sys-color", file: parseV0192(fx("v0_192_md-sys-color.scss")) },
      { prov: prov("tokens/versions/v0_192/_md-comp-snackbar.scss"), stem: "md-comp-snackbar", file: parseV0192(fx("v0_192_md-comp-filled-button.scss")) },
    ];
    const supported = [{ prov: prov("tokens/_md-comp-filled-button.scss"), stem: "md-comp-filled-button", file: parseSupportedTokens(fx("_md-comp-filled-button.top.scss")) }];
    const r = buildMwTokenSets(v0192, supported, { version: "2.5.0" });
    expect(r.sets.map((s) => s.slug)).toEqual(["mw-component-tokens", "mw-sys-color-dark", "mw-sys-color-light"]);
    const comp = r.sets.find((s) => s.slug === "mw-component-tokens")!;
    // snackbar module is not wrapped by any material-web component -> excluded
    expect(comp.tokens.every((t) => t.name.startsWith("md.comp.filled-button."))).toBe(true);
    const cc = comp.tokens.find((t) => t.name === "md.comp.filled-button.container-color")!;
    expect(cc).toMatchObject({ cssVar: "--md-filled-button-container-color", rawValue: "{md.sys.color.primary}", references: ["md.sys.color.primary"] });
    // supported list in the trimmed fixture does not include disabled-* keys -> no cssVar claimed
    expect(comp.tokens.find((t) => t.name === "md.comp.filled-button.disabled-container-opacity")!.cssVar).toBeNull();
    expect(comp.tokens.map((t) => t.name)).not.toContain("md.comp.filled-button.label-text-type");
    expect(r.byCssVar.get("--md-filled-button-container-color")).toBe("md.comp.filled-button.container-color");
    expect(r.sets.find((s) => s.slug === "mw-sys-color-dark")!.theme).toBe("dark");
  });
});

/* ------------------------------------- docs ------------------------------------- */

describe("parseMwcDoc (docs/components/*.md)", () => {
  const doc = parseMwcDoc(fx("button.md"), "docs/components/button.md");

  it("reads title, catalog/design/source links and intro", () => {
    expect(doc.title).toBe("Buttons");
    expect(doc.frontmatter).toEqual({ name: "Buttons", dirname: "button" });
    expect(doc.catalogUrl).toBe("https://material-web.dev/components/button/");
    expect(doc.designArticleUrl).toBe("https://m3.material.io/components/buttons");
    expect(doc.sourceCodeUrl).toBe("https://github.com/material-components/material-web/tree/main/button");
    expect(doc.intro).toMatch(/^Buttons help people initiate actions/);
  });

  it("reads documented types and section paragraphs (ignoring catalog-only HTML comments)", () => {
    expect(doc.types).toEqual(["Elevated button", "Filled button"]);
    const filled = doc.sections.find((s) => s.title === "Filled button")!;
    expect(filled.anchor).toBe("filled-button");
    expect(filled.firstParagraph).toMatch(/^Filled buttons have the most visual impact/);
    expect(doc.sections.some((s) => /Interactive Demo/.test(s.title) && s.firstParagraph)).toBe(false);
  });

  it("reads theming token tables with their All tokens links", () => {
    expect(doc.theming.map((t) => t.heading)).toEqual(["Elevated button tokens", "Filled button tokens"]);
    expect(doc.theming[1]!.tokens[0]).toEqual({ name: "--md-filled-button-container-color", defaultValue: "--md-sys-color-primary" });
    expect(doc.theming[1]!.allTokensUrl).toBe("https://github.com/material-components/material-web/blob/main/tokens/_md-comp-filled-button.scss");
  });

  it("reads API tables per element, unescaping pipes and <br>", () => {
    expect(doc.api.map((a) => a.tagName)).toEqual(["md-elevated-button", "md-filled-button"]);
    const target = doc.api[0]!.properties.find((p) => p.Property === "target")!;
    expect(target.Type).toBe('"" | "_blank" | "_parent" | "_self" | "_top"');
    expect(doc.api[0]!.properties[0]!.Description).toMatch(/focusable\)\. Use this when/);
    expect(doc.api[1]!.properties).toHaveLength(3);
  });

  it("collects accessibility guidance but no roles/keys unless stated", () => {
    expect(doc.accessibility!.paragraphs[0]!.text).toMatch(/aria-label attribute to buttons/);
    expect(doc.accessibility!.roles).toEqual([]);
    expect(doc.accessibility!.keyboard).toEqual([]);
    expect(doc.codeSamples.length).toBeGreaterThan(0);
  });

  it("only takes default roles ('By default ...'), and keys from event docs", () => {
    const menu = parseMwcDoc(fx("menu.md"), "docs/components/menu.md");
    expect(menu.accessibility!.roles).toEqual(["menu", "menuitem"]);
    const dialog = parseMwcDoc(fx("dialog.md"), "docs/components/dialog.md");
    expect(dialog.accessibility!.keyboard).toEqual([
      { keys: "Escape", action: "Dispatched when the dialog has been canceled by clicking on the scrim or pressing Escape.", location: "docs/components/dialog.md#mddialog-md-dialog" },
    ]);
    expect(keyboardFrom("Use arrow keys to move.", "x")).toEqual([]);
  });

  it("computes GitHub anchors", () => {
    expect(githubAnchor("MdMenuItem <md-menu-item>")).toBe("mdmenuitem-md-menu-item");
    expect(githubAnchor("Focusable and disabled")).toBe("focusable-and-disabled");
  });
});

describe("text helpers", () => {
  it("extracts the README maintenance statement as one sentence", () => {
    expect(findSentence(fx("README.md"), /maintenance mode/i)).toBe("Note: MWC is in maintenance mode pending new maintainers.");
    expect(plainBlocks("* [Intro](./a.md)\n* Roadmap").slice(0, 2)).toEqual(["Intro", "Roadmap"]);
  });

  it("first sentence / singularize", () => {
    expect(firstSentence("FAB represents the most important action on a screen. It puts key actions within reach.")).toBe("FAB represents the most important action on a screen.");
    expect(firstSentence("Use e.g. this. Then that.")).toBe("Use e.g. this.");
    expect(singularize("Progress indicators")).toBe("Progress indicator");
    expect(singularize("Switches")).toBe("Switch");
    expect(singularize("Progress")).toBe("Progress");
  });
});

/* --------------------------------- manifest / web --------------------------------- */

describe("parseCem (custom-elements.json)", () => {
  const els = parseCem(fx("custom-elements.json"));
  it("resolves inherited members and attributes through the superclass chain", () => {
    const fb = els.find((e) => e.tagName === "md-filled-button")!;
    expect(fb.className).toBe("MdFilledButton");
    expect(fb.modulePath).toBe("button/filled-button.js");
    expect(fb.summary).toMatch(/^Buttons help people take action/);
    // softDisabled is declared on the internal Button superclass (two hops up the chain)
    expect(fb.properties.find((p) => p.name === "softDisabled")).toMatchObject({ attribute: "soft-disabled", type: "boolean", default: "false" });
    expect(fb.properties.map((p) => p.name)).not.toContain("styles");
  });
  it("drops placeholder descriptions", () => {
    const badge = els.find((e) => e.tagName === "md-badge")!;
    expect(badge.description).toBeNull();
    expect(cleanDoc("TODO(b/228525797): add docs")).toBeNull();
    expect(cleanDoc("A card component.")).toBe("A card component.");
  });
});

describe("material-web component modeling", () => {
  const cemProv = prov("custom-elements.json", "https://cdn.jsdelivr.net/npm/@material/web@2.5.0/custom-elements.json");
  const cem = { prov: cemProv, elements: parseCem(fx("custom-elements.json")) };
  const docs = [
    { prov: prov("docs/components/button.md"), stem: "button", doc: parseMwcDoc(fx("button.md"), "docs/components/button.md") },
    { prov: prov("docs/components/menu.md"), stem: "menu", doc: parseMwcDoc(fx("menu.md"), "docs/components/menu.md") },
  ];

  it("names and literal unions", () => {
    expect(displayName("MdFilledTonalIconButton")).toBe("Filled tonal icon button");
    expect(displayName("ListItemEl")).toBe("List item");
    expect(literalUnion('"" | "_blank"')).toEqual(["", "_blank"]);
    expect(literalUnion("FabSize")).toBeNull();
    expect(classifyName("Icon Buttons")?.slug).toBe("icon-button");
    expect(classifyName("Floating action buttons (FAB)")?.slug).toBe("floating-action-button");
  });

  it("splits page elements into variants, primary element and subcomponents", () => {
    const byTag = new Map(cem.elements.map((e) => [e.tagName, e]));
    const roles = classifyElements(docs[1]!.doc, "menu", byTag);
    expect(roles.map((r) => `${r.tag}:${r.role}`)).toEqual(["md-menu:primary", "md-menu-item:sub"]);
    const broles = classifyElements(docs[0]!.doc, "button", byTag);
    expect(broles.map((r) => `${r.tag}:${r.role}:${r.variantName}`)).toEqual(["md-elevated-button:variant:Elevated button", "md-filled-button:variant:Filled button"]);
  });

  it("emits a Button family with documented variants, merged properties and docs-backed coverage", () => {
    const { components } = normalizeMwcComponents(docs, {
      version: "2.5.0",
      ref: "v2.5.0",
      cem,
      labsReadme: null,
      tokenByCssVar: new Map([["--md-filled-button-container-color", "md.comp.filled-button.container-color"]]),
    });
    const slugs = components.map((c) => c.slug);
    expect(slugs).toEqual(["button", "labs-badge", "menu", "menu-item"]);
    const button = components.find((c) => c.slug === "button")!;
    expect(button.name).toBe("Buttons");
    expect(button.docsUrl).toBe("https://material-web.dev/components/button/");
    expect(button.sourceCodeUrl).toBe("https://github.com/material-components/material-web/tree/v2.5.0/button");
    expect(button.canonicalType).toBe("button");
    expect(button.classification?.state).toBe("inferred");
    expect(button.variants.map((v) => [v.axis, v.name])).toEqual([
      ["type", "Elevated button"],
      ["type", "Filled button"],
    ]);
    expect(button.variants[1]!.sourceUrl).toBe("https://github.com/material-components/material-web/blob/v2.5.0/docs/components/button.md#filled-button");
    // elevated has 4 rows in the fixture, filled 3 -> the 4th is element-specific
    const target = button.properties.find((p) => p.name === "target")!;
    expect(target.implementation).toBe("web-components");
    expect(target.allowedValues).toEqual(["", "_blank", "_parent", "_self", "_top"]);
    expect(target.description).toMatch(/Only on: <md-elevated-button>/);
    expect(button.states.map((s) => [s.name, s.canonical])).toEqual([["soft-disabled", "disabled"]]);
    expect(button.coverage).toMatchObject({ description: "documented", variants: "documented", properties: "documented", states: "inferred", keyboard: "not-documented", responsive: "not-documented", tokens: "documented" });
    expect(button.tokenUsages).toContainEqual({ tokenName: "md.comp.filled-button.container-color", property: "--md-filled-button-container-color" });
    // unmapped documented CSS var keeps its authored name
    expect(button.tokenUsages).toContainEqual({ tokenName: "--md-elevated-button-container-color", property: "--md-elevated-button-container-color" });
    const code = button.examples.find((e) => e.kind === "code-snippet")!;
    expect(code.attribution).toMatch(/Apache-2\.0/);
    expect(button.evidence.every((e) => e.extractionMethod.startsWith("adapter:material:"))).toBe(true);
  });

  it("links subcomponents and marks labs elements experimental", () => {
    const { components } = normalizeMwcComponents(docs, { version: "2.5.0", ref: "v2.5.0", cem, labsReadme: null, tokenByCssVar: new Map() });
    const menu = components.find((c) => c.slug === "menu")!;
    expect(menu.relationships).toEqual([{ kind: "subcomponent", targetSlug: "menu-item", targetType: null }]);
    expect(menu.accessibility?.roles).toEqual(["menu", "menuitem"]);
    const item = components.find((c) => c.slug === "menu-item")!;
    expect(item.relationships).toEqual([{ kind: "parent", targetSlug: "menu", targetType: null }]);
    expect(item.name).toBe("Menu item");
    const badge = components.find((c) => c.slug === "labs-badge")!;
    expect(badge.lifecycle).toBe("experimental");
    expect(badge.docsUrl).toBeNull();
    expect(badge.description).toBeNull(); // placeholder "b/... add docs" not stored
    expect(badge.coverage.description).toBe("not-documented");
  });
});

/* ------------------------------------- M3 ------------------------------------- */

describe("m3.material.io helpers", () => {
  it("reads only title/meta from the client-rendered shell", () => {
    const p = parseM3Page(fx("m3-buttons-overview.html"));
    expect(p.title).toBe("Buttons – Material Design 3");
    expect(p.name).toBe("Buttons");
    expect(p.description).toMatch(/^Buttons help people take action/);
    expect(p.clientRendered).toBe(true);
  });

  it("parses the sitemap into component pages (excluding XR and tab-less pages)", () => {
    const entries = parseSitemap(fx("m3-sitemap.xml"));
    const pages = m3ComponentPages(entries);
    expect(pages.map((p) => p.slug)).toEqual(["badges", "buttons"]);
    expect(Object.keys(pages[1]!.tabs).sort()).toEqual(["accessibility", "guidelines", "overview", "specs"]);
  });

  it("validates titles against URL slugs", () => {
    expect(titleMatchesSlug("Badge", "badges")).toBe(true);
    expect(titleMatchesSlug("FAB", "floating-action-button")).toBe(true);
    expect(titleMatchesSlug("Top app bar", "app-bars")).toBe(true);
    expect(titleMatchesSlug("Accessibility overview", "principles")).toBe(false);
  });

  it("maps token files to M3 components and reads states from token groups", () => {
    expect(m3ComponentForStem("md-comp-button-filled")).toBe("buttons");
    expect(m3ComponentForStem("md-comp-button-group-standard-small")).toBe("button-groups");
    expect(m3ComponentForStem("md-comp-filled-tonal-icon-button")).toBe("icon-buttons");
    expect(m3ComponentForStem("md-comp-sheet-bottom")).toBe("bottom-sheets");
    expect(m3ComponentForStem("md-comp-data-table")).toBeNull();
    expect(m3ComponentForStem("md-sys-color")).toBeNull();
    expect(statesFromGroups(["Color / Focused - Selected", "[Deprecated] Hovered / [Deprecated] Container", "Spacing"]).sort()).toEqual(["Focused", "Hovered", "Selected"]);
  });
});

/* ---------------------------- adapter parse+normalize ---------------------------- */

function fetched(url: string, body: string): FetchResult {
  return {
    url,
    finalUrl: url,
    status: 200,
    ok: true,
    notModified: false,
    fromCache: false,
    contentType: "text/plain",
    etag: null,
    lastModified: null,
    body,
    hash: "f".repeat(64),
    byteSize: body.length,
    fetchedAt: "2026-11-05T00:00:00.000Z",
    attempts: 1,
    blockedByRobots: false,
    error: null,
  };
}

const npm = { version: "2.5.0", publishedAt: "2026-07-15T14:39:18.532Z", license: "Apache-2.0", deprecated: null, url: "https://www.npmjs.com/package/@material/web" };
const ctxFor = (systemSlug: string): AdapterContext => ({
  systemSlug,
  http: {} as PoliteFetcher,
  log: { info: () => {}, warn: () => {}, error: () => {} },
  runStartedAt: "2026-11-05T00:00:00.000Z",
});

async function run(systemSlug: string, docs: [DiscoveredDocument, string][]) {
  const ctx = ctxFor(systemSlug);
  const frags: ParsedFragment[] = [];
  for (const [doc, body] of docs) {
    const out = await adapter.parse(ctx, { doc, result: fetched(doc.url, body) });
    if (out) frags.push(...(Array.isArray(out) ? out : [out]));
  }
  return adapter.normalize(ctx, frags);
}

const repoDoc = (file: string, docKind: string, extra: Record<string, unknown> = {}): DiscoveredDocument => ({
  url: `https://raw.githubusercontent.com/material-components/material-web/v2.5.0/${file}`,
  evidenceUrl: `https://github.com/material-components/material-web/blob/v2.5.0/${file}`,
  docKind,
  source: { kind: "repository", url: "https://github.com/material-components/material-web" },
  meta: { file, version: "2.5.0", ref: "v2.5.0", npm, ...extra },
});

describe("adapter end-to-end on fixtures (no network)", () => {
  it("material-design bundle satisfies the contract", async () => {
    const page: DiscoveredDocument = {
      url: "https://m3.material.io/components/buttons/overview",
      evidenceUrl: "https://m3.material.io/components/buttons/overview",
      docKind: "m3-page",
      source: { kind: "docs-site", url: "https://m3.material.io" },
      meta: { file: "/components/buttons/overview", version: "2.5.0", ref: "v2.5.0", npm, pageKind: "component", slug: "buttons", tabs: ["accessibility", "guidelines", "overview", "specs"] },
    };
    const stems = ["md-ref-palette", "md-sys-color", "md-sys-elevation", "md-comp-button-filled"];
    const bundle = await run("material-design", [
      [page, fx("m3-buttons-overview.html")],
      ...stems.map((s) => [repoDoc(`tokens/versions/latest/sass/_${s}.scss`, "m3-token-scss-latest", { stem: s }), fx(`_${s}.scss`)] as [DiscoveredDocument, string]),
    ]);
    expect(NormalizedBundle.safeParse(bundle).success).toBe(true);
    const buttons = bundle.components[0]!;
    expect(buttons).toMatchObject({ slug: "buttons", name: "Buttons", docsUrl: "https://m3.material.io/components/buttons/overview", canonicalType: "button" });
    expect(buttons.coverage.variants).toBe("not-extracted");
    expect(buttons.coverage.tokens).toBe("inferred");
    expect(buttons.states.map((s) => s.name).sort()).toEqual(["Disabled", "Enabled", "Hovered"]);
    expect(buttons.tokenUsages.map((t) => t.tokenName)).toContain("md.comp.button.filled.container.color");
    expect(bundle.facts?.latestVersion).toBeNull();
    // validation only flags what is genuinely missing in this tiny fixture bundle
    const issues = validateMaterialBundle("material-design", bundle, 1);
    expect(issues.filter((i) => i.code === "DUPLICATE")).toEqual([]);
  });

  it("material-web bundle satisfies the contract and records maintenance status", async () => {
    const bundle = await run("material-web", [
      [repoDoc("docs/components/button.md", "mwc-component-doc", { stem: "button" }), fx("button.md")],
      [repoDoc("README.md", "mwc-readme"), fx("README.md")],
      [{ ...repoDoc("custom-elements.json", "mwc-custom-elements-manifest"), url: "https://cdn.jsdelivr.net/npm/@material/web@2.5.0/custom-elements.json", evidenceUrl: "https://cdn.jsdelivr.net/npm/@material/web@2.5.0/custom-elements.json" }, fx("custom-elements.json")],
      [repoDoc("tokens/versions/v0_192/_md-comp-filled-button.scss", "mwc-token-scss-v0192", { stem: "md-comp-filled-button" }), fx("v0_192_md-comp-filled-button.scss")],
      [repoDoc("tokens/versions/v0_192/_md-sys-color.scss", "mwc-token-scss-v0192", { stem: "md-sys-color" }), fx("v0_192_md-sys-color.scss")],
      [repoDoc("tokens/_md-comp-filled-button.scss", "mwc-token-scss-supported", { stem: "md-comp-filled-button" }), fx("_md-comp-filled-button.top.scss")],
    ]);
    const parsed = NormalizedBundle.safeParse(bundle);
    expect(parsed.success).toBe(true);
    expect(bundle.facts?.latestVersion).toBe("2.5.0");
    expect(bundle.facts?.evidence.find((e) => e.field === "maintenanceStatus")?.excerpt).toBe("Note: MWC is in maintenance mode pending new maintainers.");
    expect(bundle.facts?.frameworks).toEqual([{ slug: "web-components", packageName: "@material/web" }]);
    const button = bundle.components.find((c) => c.slug === "button")!;
    expect(button.tokenUsages).toContainEqual({ tokenName: "md.comp.filled-button.container-color", property: "--md-filled-button-container-color" });
  });

  it("validate flags duplicates and empty names", () => {
    const base = { slug: "x", name: "X", aliases: [], lifecycle: "unknown" as const, frameworks: [], variants: [], states: [], properties: [], examples: [], relationships: [], tokenUsages: [], coverage: {}, evidence: [] };
    const issues = validateMaterialBundle("material-web", { systemSlug: "material-web", components: [base, { ...base, name: " " }], tokenSets: [], patterns: [] }, 1);
    expect(issues.map((i) => i.code)).toEqual(expect.arrayContaining(["DUPLICATE", "REQUIRED_FIELD", "MISSING_EVIDENCE"]));
  });
});
