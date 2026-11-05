/**
 * Unit tests for the "fluent" adapter (fluent-2, fluent-ui-react, fluent-ui-web-components). No network:
 * every input is a trimmed fixture copied from first-party sources (MIT, Copyright (c) Microsoft
 * Corporation): @fluentui/react-button@9.11.3 and @fluentui/web-components@3.1.4 declaration files,
 * @fluentui/tokens@1.0.0-alpha.24 lib modules (trimmed), microsoft/fluentui story docs at
 * @fluentui/react-components_v9.75.1, the Storybook index.json files and fluent2.microsoft.design HTML.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { NormalizedBundle } from "@/lib/contracts";
import { adapter, reactDtsComponents, readmeStatements, validateFluentBundle, wcDtsElements } from "@/ingestion/adapters/fluent";
import { customElementsOf, defaultOf, literalValues, memberDescription, parseDts, parseJsDoc, resolveProps, splitTop } from "@/ingestion/adapters/fluent/dts";
import { componentEntries, deserializeAstro, parseF2Page, parseNav } from "@/ingestion/adapters/fluent/f2-html";
import type { FluentFragment } from "@/ingestion/adapters/fluent/fragments";
import { Interpreter, parseModule, render } from "@/ingestion/adapters/fluent/jsmod";
import { descriptionText, normalizeKeys, parseA11ySpec, parseBestPractices } from "@/ingestion/adapters/fluent/markdown";
import { f2Facts, normalizeF2 } from "@/ingestion/adapters/fluent/normalize-f2";
import { describingSentence, normalizeReact } from "@/ingestion/adapters/fluent/normalize-react";
import { ariaRefs, dropMismatchedLead, normalizeWc } from "@/ingestion/adapters/fluent/normalize-wc";
import { humanize, lifecycleFromVersion, nameCandidates, repoBlob, repoRaw, type Prov } from "@/ingestion/adapters/fluent/shared";
import { parseStoriesFile, parseStoryIndex, reactA11ySpecPages, reactComponentPages, storybookIdFromUrl, wcComponentPages } from "@/ingestion/adapters/fluent/storybook";
import { buildFluentTokenSets, moduleImports, themeSlug, type TokenModuleSource } from "@/ingestion/adapters/fluent/tokens";
import type { AdapterContext, DiscoveredDocument } from "@/ingestion/types";
import type { FetchResult, PoliteFetcher } from "@/ingestion/http";

const FX = path.resolve(__dirname, "../../fixtures/adapters/fluent");
const fx = (f: string) => readFileSync(path.join(FX, f), "utf8");
const prov = (file: string, sourceUrl = `https://cdn.jsdelivr.net/npm/@fluentui/react-button@9.11.3/${file}`): Prov => ({ sourceUrl, retrievedAt: "2026-11-05T00:00:00.000Z", contentHash: "abc123", file });
const REF = "@fluentui/react-components_v9.75.1";

function tokenModules(): TokenModuleSource[] {
  const root = path.join(FX, "tokens");
  const walk = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(path.join(d, f)).isDirectory() ? walk(path.join(d, f)) : [path.join(d, f)]));
  return walk(path.join(root, "lib"))
    .sort()
    .map((f) => {
      const rel = path.relative(root, f).split(path.sep).join("/");
      return { path: rel, text: readFileSync(f, "utf8"), prov: prov(rel, `https://cdn.jsdelivr.net/npm/@fluentui/tokens@1.0.0-alpha.24/${rel}`) };
    });
}

/* ------------------------------------ d.ts ------------------------------------ */

describe("TSDoc + declaration parsing", () => {
  it("parses TSDoc summary and block tags; inline links keep their text", () => {
    const d = parseJsDoc("/**\n * Sets the {@link https://x.dev | `disabled`} state.\n *\n * @default 'medium'\n * @remarks\n * HTML Attribute: `size`\n */");
    expect(d.summary).toBe("Sets the `disabled` state.");
    expect(d.tags.default).toEqual(["'medium'"]);
    expect(d.tags.remarks![0]).toMatch(/HTML Attribute: `size`/);
    expect(d.raw).toMatch(/https:\/\/x\.dev/);
    expect(defaultOf(d)).toBe("medium");
  });

  it("splits only at top level", () => {
    expect(splitTop("A & Pick<B, 'a' | 'b'> & { c: (x: X, y: Y) => void }", "&")).toEqual(["A", "Pick<B, 'a' | 'b'>", "{ c: (x: X, y: Y) => void }"]);
  });

  it("resolves Fluent props: object literals, aliases, slots via ComponentProps, intersections", () => {
    const file = parseDts(fx("react-button.d.ts.txt"));
    const r = resolveProps("ButtonProps", file);
    const byName = new Map(r.members.map((m) => [m.name, m]));
    expect([...byName.keys()].sort()).toEqual(["appearance", "disabled", "disabledFocusable", "icon", "iconPosition", "shape", "size"]);
    expect(byName.get("icon")!.slot).toBe(true);
    expect(r.primarySlots).toEqual(["root"]);
    expect(literalValues(byName.get("size")!.type, file)).toEqual(["small", "medium", "large"]);
    expect(defaultOf(byName.get("appearance")!.doc)).toBe("secondary");
    const toggle = resolveProps("ToggleButtonProps", file);
    expect(toggle.members.map((m) => m.name)).toEqual(expect.arrayContaining(["appearance", "checked", "defaultChecked", "isAccessible"]));
  });

  it("finds exported components, including `export { X_2 as X }` aliases, and reports unresolved imports", () => {
    const comps = reactDtsComponents(fx("react-button.d.ts.txt"));
    expect(comps.map((c) => c.name)).toEqual(["Breadcrumb", "Button", "ToggleButton"]);
    const bc = comps.find((c) => c.name === "Breadcrumb")!;
    expect(bc.unresolved).toEqual(["PortalProps"]);
    expect(bc.props.find((p) => p.name === "focusMode")!.allowedValues).toEqual(["arrow", "tab"]);
    const btn = comps.find((c) => c.name === "Button")!;
    expect(btn.summary).toBe("Buttons give people a way to trigger an action.");
    expect(btn.props.find((p) => p.name === "size")).toMatchObject({ defaultValue: "medium", allowedValues: ["small", "medium", "large"], origin: "ButtonProps" });
  });

  it("drops placeholder TSDoc", () => {
    expect(memberDescription(parseJsDoc("/** Breadcrumb component - TODO: add more docs */"))).toBeNull();
  });
});

describe("custom elements (web-components roll-up)", () => {
  const file = parseDts(fx("web-components.d.ts.txt"));
  const els = customElementsOf(file);

  it("pairs XDefinition docs with classes and walks the class chain", () => {
    expect(els.map((e) => e.tagName)).toEqual(["fluent-button", "fluent-checkbox", "fluent-menu-item"]);
    const btn = els[0]!;
    expect(btn.chain).toEqual(["Button", "BaseButton"]);
    const names = btn.members.map((m) => m.name);
    expect(names).toEqual(expect.arrayContaining(["appearance", "disabled", "disabledFocusable", "form", "type", "iconOnly"]));
    expect(names).not.toContain("elementInternals"); // @internal
    expect(names).not.toContain("disabledChanged"); // method
    expect(btn.members.find((m) => m.name === "disabledFocusable")!.attribute).toBe("disabled-focusable");
    expect(btn.members.find((m) => m.name === "form")!.readonly).toBe(true);
    expect(literalValues("ButtonAppearance", file)).toEqual(["primary", "outline", "subtle", "transparent"]);
    expect(btn.slots).toEqual(expect.arrayContaining(["start", "end"]));
  });

  it("extracts ARIA roles from TSDoc links and repairs mismatched leads", () => {
    const lite = wcDtsElements(fx("web-components.d.ts.txt"));
    const cb = lite.find((e) => e.tagName === "fluent-checkbox")!;
    expect(ariaRefs(cb.rawDocs).roles).toEqual(["checkbox"]);
    expect(cb.events).toEqual(expect.arrayContaining(["change", "input"]));
    expect(dropMismatchedLead("A Switch Custom HTML Element. Implements ARIA menuitem.", "MenuItem")).toBe("Implements ARIA menuitem.");
    expect(dropMismatchedLead("A Button Custom HTML Element. Based on BaseButton.", "Button")).toMatch(/^A Button/);
  });
});

/* ------------------------------------ tokens ------------------------------------ */

describe("static token module interpreter", () => {
  it("never executes code: unknown constructs evaluate to opaque values", () => {
    const interp = new Interpreter({ source: (p) => (p === "lib/a.js" ? "export const a = require('fs');\nexport const b = process.exit(1);\nexport const c = `x${a}`;" : null), groupFor: () => undefined, scalarRef: () => null });
    const rec = interp.load("lib/a.js");
    expect(rec.exports.get("a")!.t).toBe("opaque");
    expect(rec.exports.get("b")!.t).toBe("opaque");
    expect(render(rec.exports.get("c")!).opaque.length).toBe(1);
  });

  it("rejects syntax outside the subset with a warning instead of throwing", () => {
    expect(() => parseModule("for (const k of keys) {}")).toThrow();
    const interp = new Interpreter({ source: () => "for (const k of x) {}", groupFor: () => undefined, scalarRef: () => null });
    expect(interp.load("lib/x.js").warnings[0]).toMatch(/lib\/x\.js/);
  });

  it("builds global, brand, shared and themed sets with references preserved", () => {
    const r = buildFluentTokenSets({ pkg: "@fluentui/tokens", version: "1.0.0-alpha.24", modules: tokenModules() });
    expect(r.themes).toEqual(["web-light"]);
    expect(r.sets.map((s) => s.slug).sort()).toEqual(["fluent-brand-ramps", "fluent-global-colors", "fluent-global-tokens", "fluent-theme-web-light", "fluent-typography-styles"]);
    const theme = r.sets.find((s) => s.slug === "fluent-theme-web-light")!;
    expect(theme.theme).toBe("web-light");
    const t = (n: string) => theme.tokens.find((x) => x.name === n)!;
    expect(t("colorNeutralForeground1")).toMatchObject({ rawValue: "{grey.14}", references: ["grey.14"], cssVar: "--colorNeutralForeground1", category: "color", tier: "semantic", tierState: "verified" });
    expect(t("colorBrandBackground").rawValue).toBe("{brandWeb.80}");
    // Array#reduce palette with template keys + one-off patch
    expect(t("colorPaletteRedBackground1").rawValue).toBe("{red.tint60}");
    expect(t("colorPaletteGreenForeground1").rawValue).toBe("{green.shade10}");
    expect(t("colorPaletteRedForegroundInverted").rawValue).toBe("{red.tint20}");
    // shadows keep references to the theme's shadow colors
    expect(t("shadow4")).toMatchObject({ rawValue: "0 0 2px {colorNeutralShadowAmbient}, 0 2px 4px {colorNeutralShadowKey}", category: "elevation" });
    expect(t("shadow4").references).toEqual(["colorNeutralShadowAmbient", "colorNeutralShadowKey"]);
    const shared = r.sets.find((s) => s.slug === "fluent-global-tokens")!;
    expect(shared.theme).toBeNull();
    expect(shared.tokens.map((x) => x.name)).toEqual(["fontFamilyBase", "fontSizeBase300"]);
    expect(theme.tokens.some((x) => x.name === "fontSizeBase300")).toBe(false);
    const colors = r.sets.find((s) => s.slug === "fluent-global-colors")!;
    expect(colors.tokens.find((x) => x.name === "red.tint60")).toMatchObject({ rawValue: "#fdf3f4", tier: "primitive", cssVar: null });
    expect(colors.tokens.find((x) => x.name === "white")!.rawValue).toBe("#ffffff");
    const typo = r.sets.find((s) => s.slug === "fluent-typography-styles")!;
    expect(typo.tokens[0]).toMatchObject({ name: "typographyStyles.body1", rawValue: { fontFamily: "{fontFamilyBase}", fontSize: "{fontSizeBase300}" } });
    // every reference resolves inside the bundle
    const names = new Set(r.sets.flatMap((s) => s.tokens.map((x) => x.name)));
    expect(r.sets.flatMap((s) => s.tokens.flatMap((x) => x.references)).filter((x) => !names.has(x))).toEqual([]);
    expect(r.warnings.some((w) => /themeToTokensObject/.test(w))).toBe(true);
    expect(theme.license?.redistribution).toBe("permitted");
  });

  it("names themes and follows relative imports", () => {
    expect(themeSlug("webLightTheme")).toBe("web-light");
    expect(themeSlug("teamsHighContrastTheme")).toBe("teams-high-contrast");
    expect(themeSlug("teamsLightV21Theme")).toBe("teams-light-v21");
    expect(moduleImports("lib/utils/createLightTheme.js", fx("tokens/lib/utils/createLightTheme.js"))).toEqual(["lib/alias/lightColor.js", "lib/alias/lightColorPalette.js", "lib/global/fonts.js", "lib/utils/shadows.js"]);
  });
});

/* ---------------------------------- storybook ---------------------------------- */

describe("Storybook index + story files", () => {
  const react = parseStoryIndex(fx("storybook-react-index.json"));

  it("selects component docs pages and accessibility specs", () => {
    const pages = reactComponentPages(react);
    expect(pages.map((p) => p.title)).toEqual(["Components/Button/Button", "Components/Dialog"]);
    expect(pages[0]).toMatchObject({ pkg: "@fluentui/react-button", storiesFile: "packages/react-components/react-button/stories/src/Button/index.stories.tsx", docsUrl: "https://storybooks.fluentui.dev/react/?path=/docs/components-button-button--docs" });
    expect(reactA11ySpecPages(react).map((s) => s.component)).toEqual(["Button"]);
    expect(wcComponentPages(parseStoryIndex(fx("storybook-wc-index.json"))).map((p) => p.dir)).toEqual(["button", "checkbox"]);
    expect(storybookIdFromUrl("https://react.fluentui.dev/?path=/docs/components-button-button--docs")).toBe("components-button-button--docs");
  });

  it("reads story meta in both `export default {}` and `const metadata = {}` forms", () => {
    const b = parseStoriesFile(fx("button-index.stories.tsx.txt"));
    expect(b).toMatchObject({ title: "Components/Button/Button", component: "Button", subcomponents: [] });
    expect(b.mdImports.map((m) => m.file)).toEqual(["ButtonDescription.md", "ButtonBestPractices.md"]);
    expect(b.importedFrom.Button).toBe("@fluentui/react-components");
    const d = parseStoriesFile(fx("dialog-index.stories.tsx.txt"));
    expect(d).toMatchObject({ title: "Components/Dialog", component: "Dialog", subcomponents: ["DialogTrigger", "DialogSurface", "DialogTitle", "DialogActions"] });
    expect(d.descriptionLocals).toEqual(["descriptionMd", "bestPracticesMd", "a11yMd", "ssrMd"]);
    expect(d.stories).toEqual(["Default", "NonModal", "Alert"]);
  });
});

/* ---------------------------------- markdown ---------------------------------- */

describe("story markdown + accessibility specs", () => {
  it("descriptions skip pointer sentences", () => {
    expect(descriptionText(fx("ButtonDescription.md"))).toBe("A button triggers an action or event when activated.");
    expect(describingSentence(descriptionText(fx("BreadcrumbDescription.md")))).toBeNull();
    expect(describingSentence("💡 This component is low-level. Use DataGrid instead.")).toBe("This component is low-level.");
  });

  it("groups best practices by heading", () => {
    const bp = parseBestPractices(fx("ButtonBestPractices.md"));
    expect(bp.groups.map((g) => g.heading)).toEqual(["Layout", "Content"]);
    expect(bp.groups[0]!.items[0]).toMatch(/right-align buttons/);
  });

  it("extracts roles and keyboard tables from AccessibilitySpec.mdx", () => {
    const spec = parseA11ySpec(fx("ButtonAccessibilitySpec.mdx"));
    expect(spec.title).toBe("Button Accessibility Spec");
    expect(spec.intro).toMatch(/^Button triggers an action or event when activated\./);
    expect(spec.roles).toEqual(["button", "link"]);
    expect(spec.keyboard.map((k) => k.keys)).toEqual(["Tab", "Shift+Tab", "Enter", "Space"]);
    expect(spec.keyboard[2]).toMatchObject({ action: "Activates the button (fires onClick)", context: "Activate button" });
    const spin = parseA11ySpec(fx("SpinButtonAccessibilitySpec.mdx"));
    expect(spin.keyboard.map((k) => k.keys)).toEqual(["Home", "End", "ArrowUp", "ArrowDown", "PageUp", "PageDown", "Typing valid value"]);
    expect(normalizeKeys("Up arrow")).toBe("ArrowUp");
    expect(normalizeKeys("Arrow down")).toBe("ArrowDown");
  });
});

/* ------------------------------- fluent2.microsoft.design ------------------------------- */

describe("Fluent 2 site", () => {
  const html = fx("f2-button-usage.html");
  const url = "https://fluent2.microsoft.design/components/web/react/core/button/usage/";

  it("decodes the Astro nav island into the component catalog", () => {
    expect(deserializeAstro([1, [[0, { a: [0, "x"] }], [0, 2]]])).toEqual([{ a: "x" }, 2]);
    const groups = parseNav(html);
    expect(groups.map((g) => `${g.title}:${g.library ?? ""}`)).toEqual(["UX frameworks and guidelines:", "Components:web/react", "Components:ios"]);
    const entries = componentEntries(groups);
    expect(entries.map((e) => `${e.library}|${e.title}`)).toEqual(["web/react|Avatar group", "web/react|Button", "web/react|Tooltip", "ios|Avatar group", "ios|Button", "ios|Tooltip"]);
    expect(entries[1]).toMatchObject({ url, desc: "A button triggers a single action or event.", libraries: ["web/react", "web/web-components"] });
  });

  it("reads intro, resources, types and accessibility sections from server HTML", () => {
    const p = parseF2Page(html, url);
    expect(p.title).toBe("React Button - Fluent 2 Design System");
    expect(p.h1).toBe("Button");
    expect(p.intro[0]).toBe("A button triggers a single action or event.");
    expect(p.resources.map((r) => r.subtitle)).toEqual(["React guidance", "Web Components guidance", "WAI guidance", "React guidance"]);
    const types = p.sections.find((s) => s.id === "types")!;
    expect(types.cards.map((c) => c.name)).toEqual(["Button", "Split button", "Menu button", "Compound button"]);
    const a11y = p.sections.find((s) => s.id === "accessibility")!;
    expect(a11y.h3.map((h) => h.title)).toEqual(["Toggle button actions and states", "Color contrast on buttons", "Tooltips and ARIA labels"]);
    expect(a11y.prose.join(" ")).toMatch(/4\.5:1/);
  });

  it("normalizes a component with frameworks, verified APG classification and variants", () => {
    const page = parseF2Page(html, url);
    const entry = componentEntries(parseNav(html))[1]!;
    const frags: FluentFragment[] = [{ kind: "f2-page", prov: prov("/components/web/react/core/button/usage/", url), entry, page }];
    const res = normalizeF2(frags);
    expect(res.components).toHaveLength(1);
    const c = res.components[0]!;
    expect(c).toMatchObject({ slug: "button", name: "Button", docsUrl: url, description: "A button triggers a single action or event.", canonicalType: "button" });
    expect(c.classification).toMatchObject({ state: "verified" });
    expect(c.frameworks.map((f) => [f.slug, f.packageName])).toEqual([
      ["react", "@fluentui/react-components"],
      ["web-components", "@fluentui/web-components"],
    ]);
    expect(c.frameworks[0]!.sourceUrl).toBe("https://storybooks.fluentui.dev/react/?path=/docs/components-button-button--docs");
    expect(c.variants.map((v) => v.name)).toEqual(["Button", "Split button", "Menu button", "Compound button"]);
    expect(c.accessibility?.ariaPattern).toBe("button");
    expect(c.coverage).toMatchObject({ properties: "not-documented", accessibility: "documented", variants: "documented" });
    expect(NormalizedBundle.safeParse({ systemSlug: "fluent-2", components: res.components }).success).toBe(true);
  });

  it("derives principles from the design principles page", () => {
    const page = parseF2Page(fx("f2-design-principles.html"), "https://fluent2.microsoft.design/design-principles/");
    const facts = f2Facts([{ kind: "f2-content", prov: prov("/design-principles/", "https://fluent2.microsoft.design/design-principles/"), role: "principles", navTitle: null, page }]);
    expect(facts.principles!.map((p) => p.name)).toEqual(["Natural on every platform", "Built for focus", "One for all, all for one", "Unmistakably Microsoft"]);
    expect(facts.principles![0]!.sourceUrl).toBe("https://fluent2.microsoft.design/design-principles/#natural-on-every-platform");
    expect(facts.evidence.some((e) => e.field === "principles")).toBe(true);
  });
});

/* ---------------------------------- normalizers ---------------------------------- */

function reactFragments(): FluentFragment[] {
  const index = parseStoryIndex(fx("storybook-react-index.json"));
  const page = reactComponentPages(index)[0]!;
  const spec = reactA11ySpecPages(index)[0]!;
  return [
    { kind: "sb-index", prov: prov("index.json", "https://storybooks.fluentui.dev/react/"), system: "fluent-ui-react", entries: index },
    { kind: "react-dts", prov: prov("dist/index.d.ts"), pkg: "@fluentui/react-button", version: "9.11.3", components: reactDtsComponents(fx("react-button.d.ts.txt")) },
    {
      kind: "react-stories",
      prov: prov(page.storiesFile, repoBlob(REF, page.storiesFile)),
      page,
      ref: REF,
      meta: parseStoriesFile(fx("button-index.stories.tsx.txt")),
      description: { prov: prov("ButtonDescription.md", repoBlob(REF, "x/ButtonDescription.md")), text: descriptionText(fx("ButtonDescription.md"))! },
      bestPractices: { prov: prov("ButtonBestPractices.md", repoBlob(REF, "x/ButtonBestPractices.md")), data: parseBestPractices(fx("ButtonBestPractices.md")) },
      a11yMd: null,
    },
    { kind: "react-a11y-spec", prov: prov(spec.file, repoBlob(REF, spec.file)), page: spec, spec: parseA11ySpec(fx("ButtonAccessibilitySpec.mdx")) },
  ];
}

describe("fluent-ui-react normalization", () => {
  it("models the docs page component with props, variants, sizes, states, a11y and subcomponents", () => {
    const { components } = normalizeReact(reactFragments());
    // ToggleButton is exported by the same package but is neither a docs page here, a listed
    // subcomponent, nor named after "Button" as a prefix: it is not emitted from this fixture.
    expect(components.map((c) => c.slug)).toEqual(["button"]);
    const b = components.find((c) => c.slug === "button")!;
    expect(b).toMatchObject({ name: "Button", lifecycle: "stable", canonicalType: "button", description: "A button triggers an action or event when activated.", docsUrl: "https://storybooks.fluentui.dev/react/?path=/docs/components-button-button--docs" });
    expect(b.sourceCodeUrl).toBe("https://github.com/microsoft/fluentui/tree/%40fluentui%2Freact-components_v9.75.1/packages/react-components/react-button");
    expect(b.properties.map((p) => p.name)).toEqual(["appearance", "disabled", "disabledFocusable", "icon", "iconPosition", "shape", "size"]);
    expect(b.properties.find((p) => p.name === "icon")!.description).toMatch(/^Slot\./);
    expect(b.properties.every((p) => p.implementation === "react" && p.required === false)).toBe(true);
    expect(b.variants.filter((v) => v.axis === "appearance").map((v) => v.name)).toEqual(["secondary", "primary", "outline", "subtle", "transparent"]);
    expect(b.sizes).toEqual(["small", "medium", "large"]);
    expect(b.states.map((s) => s.canonical)).toEqual(["disabled", "disabled"]);
    expect(b.accessibility?.roles).toEqual(["button", "link"]);
    expect(b.accessibility?.keyboard?.map((k) => k.keys)).toEqual(["Tab", "Shift+Tab", "Enter", "Space"]);
    expect(b.coverage).toMatchObject({ description: "documented", properties: "documented", accessibility: "documented", keyboard: "documented", states: "inferred", responsive: "not-extracted" });
    expect(b.frameworks[0]).toMatchObject({ slug: "react", packageName: "@fluentui/react-components", importName: "Button" });
    expect(b.examples.filter((e) => e.kind === "storybook-link").length).toBeGreaterThan(3);
    const bundle = { systemSlug: "fluent-ui-react", components, tokenSets: [], patterns: [], facts: null };
    expect(NormalizedBundle.safeParse(bundle).success).toBe(true);
    // all documented coverage fields carry evidence
    for (const c of components) for (const [f, st] of Object.entries(c.coverage)) if (st === "documented") expect(c.evidence.some((e) => e.field === f || e.field === "*")).toBe(true);
  });
});

describe("fluent-ui-web-components normalization", () => {
  it("one component per defined element, attributes and enum variants from the d.ts", () => {
    const frags: FluentFragment[] = [
      { kind: "wc-dts", prov: prov("dist/web-components.d.ts", "https://cdn.jsdelivr.net/npm/@fluentui/web-components@3.1.4/dist/web-components.d.ts"), npm: { pkg: "@fluentui/web-components", version: "3.1.4", publishedAt: null, license: "MIT", deprecated: null, url: "https://www.npmjs.com/package/@fluentui/web-components" }, elements: wcDtsElements(fx("web-components.d.ts.txt")), distDirs: [] },
      { kind: "sb-index", prov: prov("index.json", "https://storybooks.fluentui.dev/web-components/"), system: "fluent-ui-web-components", entries: parseStoryIndex(fx("storybook-wc-index.json")) },
    ];
    const { components } = normalizeWc(frags);
    expect(components.map((c) => c.slug)).toEqual(["button", "checkbox", "menu-item"]);
    const b = components[0]!;
    expect(b.docsUrl).toBe("https://storybooks.fluentui.dev/web-components/?path=/docs/components-button-button--docs");
    expect(b.properties.find((p) => p.name === "disabledFocusable")!.description).toMatch(/^Attribute `disabled-focusable`\./);
    expect(b.properties.find((p) => p.name === "form")!.description).toMatch(/Read-only\./);
    expect(b.variants.filter((v) => v.axis === "appearance").map((v) => v.name)).toEqual(["primary", "outline", "subtle", "transparent"]);
    expect(b.sizes).toEqual(["small", "medium", "large"]);
    const cb = components[1]!;
    expect(cb.classification).toMatchObject({ state: "verified" });
    expect(cb.accessibility?.roles).toEqual(["checkbox"]);
    const mi = components[2]!;
    expect(mi.description).not.toMatch(/Switch/);
    expect(mi.docsUrl).toBeNull();
    expect(NormalizedBundle.safeParse({ systemSlug: "fluent-ui-web-components", components }).success).toBe(true);
  });
});

/* ---------------------------------- adapter ---------------------------------- */

function fakeCtx(files: Record<string, string>, system = "fluent-ui-react", limit?: number): AdapterContext {
  const http = {
    async get(url: string): Promise<FetchResult> {
      const body = files[url] ?? null;
      return { url, finalUrl: url, status: body === null ? 404 : 200, ok: body !== null, notModified: false, fromCache: false, contentType: null, etag: null, lastModified: null, body, hash: body ? "h" : null, byteSize: body?.length ?? 0, fetchedAt: "2026-11-05T00:00:00.000Z", attempts: 1, blockedByRobots: false, error: null };
    },
  } as unknown as PoliteFetcher;
  return { systemSlug: system, http, log: { info() {}, warn() {}, error() {} }, runStartedAt: "2026-11-05T00:00:00.000Z", limit };
}

const fetched = (doc: DiscoveredDocument, body: string) => ({ doc, result: { url: doc.url, finalUrl: doc.url, status: 200, ok: true, notModified: false, fromCache: false, contentType: null, etag: null, lastModified: null, body, hash: "h", byteSize: body.length, fetchedAt: "2026-11-05T00:00:00.000Z", attempts: 1, blockedByRobots: false, error: null } satisfies FetchResult });

describe("adapter.parse", () => {
  it("story docs fetch their linked markdown at the pinned tag", async () => {
    const page = reactComponentPages(parseStoryIndex(fx("storybook-react-index.json")))[0]!;
    const dir = page.storiesFile.replace(/\/[^/]+$/, "");
    const ctx = fakeCtx({ [repoRaw(REF, `${dir}/ButtonDescription.md`)]: fx("ButtonDescription.md"), [repoRaw(REF, `${dir}/ButtonBestPractices.md`)]: fx("ButtonBestPractices.md") });
    const doc: DiscoveredDocument = { url: repoRaw(REF, page.storiesFile), evidenceUrl: repoBlob(REF, page.storiesFile), docKind: "fluent-react-stories", source: { kind: "repository", url: "https://github.com/microsoft/fluentui" }, meta: { system: "fluent-ui-react", file: page.storiesFile, page, ref: REF } };
    const frag = await adapter.parse(ctx, fetched(doc, fx("button-index.stories.tsx.txt")));
    const data = (Array.isArray(frag) ? frag[0] : frag)!.data as Extract<FluentFragment, { kind: "react-stories" }>;
    expect(data.kind).toBe("react-stories");
    expect(data.description?.text).toBe("A button triggers an action or event when activated.");
    expect(data.description?.prov.sourceUrl).toBe(repoBlob(REF, `${dir}/ButtonDescription.md`));
    expect(data.bestPractices?.data.groups.length).toBe(2);
    expect(data.a11yMd).toBeNull();
  });

  it("token entry documents fetch the module graph and build sets", async () => {
    const mods = tokenModules();
    const files = Object.fromEntries(mods.map((m) => [`https://cdn.jsdelivr.net/npm/@fluentui/tokens@1.0.0-alpha.24/${m.path}`, m.text]));
    const ctx = fakeCtx(files, "fluent-ui-web-components");
    const url = "https://cdn.jsdelivr.net/npm/@fluentui/tokens@1.0.0-alpha.24/lib/index.js";
    const doc: DiscoveredDocument = { url, evidenceUrl: url, docKind: "fluent-tokens", source: { kind: "package", url: "https://www.npmjs.com/package/@fluentui/tokens" }, meta: { system: "fluent-ui-web-components", file: "lib/index.js", pkg: "@fluentui/tokens", version: "1.0.0-alpha.24", via: null } };
    const frag = await adapter.parse(ctx, fetched(doc, files[url]!));
    const data = (Array.isArray(frag) ? frag[0] : frag)!.data as Extract<FluentFragment, { kind: "tokens" }>;
    expect(data.sets.find((s) => s.slug === "fluent-theme-web-light")!.tokens.length).toBe(11);
    const bundle = await adapter.normalize(ctx, [{ docUrl: url, docKind: "fluent-tokens", data }]);
    expect(bundle.tokenSets.length).toBe(5);
    const issues = validateFluentBundle("fluent-ui-web-components", bundle);
    expect(issues.some((i) => i.entityKey === "fluent-theme-web-light" && i.severity === "error")).toBe(true); // fixture is far smaller than the real theme
    expect(issues.some((i) => /references do not resolve/.test(i.message))).toBe(false);
  });

  it("README statements feed facts only when found", () => {
    expect(readmeStatements("react-readme", "This is a suite package for converged components and related utilities.").suite).toMatch(/suite package/);
    expect(readmeStatements("wc-readme", "Nothing relevant here.").purpose).toBeNull();
  });
});

describe("helpers", () => {
  it("lifecycle from version semantics", () => {
    expect(lifecycleFromVersion("9.11.3")).toBe("stable");
    expect(lifecycleFromVersion("9.0.2-beta.1")).toBe("beta");
    expect(lifecycleFromVersion("0.4.8")).toBe("experimental");
    expect(lifecycleFromVersion("9.1.0", { preview: true })).toBe("experimental");
    expect(lifecycleFromVersion("9.1.0", { deprecated: "use X" })).toBe("deprecated");
  });
  it("names", () => {
    expect(humanize("MenuButton")).toBe("Menu button");
    expect(nameCandidates("Tablist")).toContain("Tab list");
    expect(nameCandidates("Searchbox")).toContain("Search box");
  });
  it("validate flags duplicates and missing Button on full runs", () => {
    const issues = validateFluentBundle("fluent-ui-web-components", { systemSlug: "fluent-ui-web-components", components: [], tokenSets: [], patterns: [], facts: null });
    expect(issues.some((i) => /Button missing/.test(i.message))).toBe(true);
    expect(validateFluentBundle("fluent-ui-web-components", { systemSlug: "x", components: [], tokenSets: [], patterns: [], facts: null }, 3).some((i) => /Button missing/.test(i.message))).toBe(false);
  });
});
