import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { NormalizedBundle } from "@/lib/contracts";
import { validateBundle } from "@/ingestion/engine/validate";
import type { FetchResult, PoliteFetcher } from "@/ingestion/http";
import type { AdapterContext } from "@/ingestion/types";
import { adapter, packageFromCodeHtml, tabPathsFromHtml } from "@/ingestion/adapters/atlassian";
import { DOCS_ORIGIN, TOKEN_SETS, npmManifestUrl, npmPackumentUrl } from "@/ingestion/adapters/atlassian/constants";
import type { AtlFragmentData, SourceStamp } from "@/ingestion/adapters/atlassian/fragments";
import { parseDocsPage, parseIndexPage, parseRedirectStub, resolveHref } from "@/ingestion/adapters/atlassian/html";
import { parseLlmsComponents } from "@/ingestion/adapters/atlassian/llms";
import { assignSlugs, extractKeyboard, extractRoles, normalizeAtlassian, selectComponentEntries } from "@/ingestion/adapters/atlassian/normalize";
import { parseNpmManifest, parseNpmPackument } from "@/ingestion/adapters/atlassian/npm";
import { cleanText, parseStringLiteralUnion, shortText } from "@/ingestion/adapters/atlassian/text";
import { buildPaletteIndex, buildTokens, extractTokensLiteral, parseTokenNames, parseTokensRaw, toRawValue, TokenArtifactError } from "@/ingestion/adapters/atlassian/tokens";
import { validateAtlassianBundle } from "@/ingestion/adapters/atlassian/validate";

const FIX = path.resolve(import.meta.dirname, "../../fixtures/adapters/atlassian");
const fx = (f: string) => readFileSync(path.join(FIX, f), "utf8");
const stamp = (url: string): SourceStamp => ({ url, evidenceUrl: url, retrievedAt: "2026-11-05T00:00:00.000Z", hash: "abc123" });
const C = `${DOCS_ORIGIN}/components`;
const npm = { packageName: "@atlaskit/tokens", version: "20.9.0" };

describe("atlassian text helpers", () => {
  it("cleans link suffixes and zero-width characters", () => {
    expect(cleanText("Bitbucket.org﻿ , (opens new window) here")).toBe("Bitbucket.org here");
  });
  it("keeps whole sentences within the limit", () => {
    const s = "First sentence is short. Second sentence is a bit longer than the first one. Third.";
    expect(shortText(s, 40)).toBe("First sentence is short.");
    expect(shortText(s, 500)).toBe(s);
  });
  it("parses double-quoted string literal unions only", () => {
    expect(parseStringLiteralUnion('"default" | "compact"')).toEqual(["default", "compact"]);
    expect(parseStringLiteralUnion("boolean")).toBeNull();
    expect(parseStringLiteralUnion('"a" | number')).toBeNull();
  });
});

describe("atlassian.design HTML parsers", () => {
  it("parses side navigation entries with categories and release-phase lozenges", () => {
    const { entries, navPaths } = parseIndexPage(fx("components-index.html"));
    const byPath = new Map(entries.map((e) => [e.path, e]));
    expect(byPath.get("/components/button")).toMatchObject({ name: "Button", category: "Forms and input", badge: null });
    expect(byPath.get("/components/button/button-legacy")).toMatchObject({ name: "Button (legacy)", badge: "Caution" });
    expect(byPath.get("/components/side-navigation")).toMatchObject({ name: "Side navigation", category: "Deprecated", badge: "Deprecated" });
    expect(byPath.get("/components/tokens")?.category).toBe("Libraries");
    expect(navPaths).toContain("/foundations/accessibility");
    expect(navPaths).toContain("/amp");
  });

  it("selects UI components only (no libraries, index pages or styling APIs), priority first, limit respected", () => {
    const { entries } = parseIndexPage(fx("components-index.html"));
    const all = selectComponentEntries(entries).map((e) => e.path);
    expect(all).not.toContain("/components/tokens");
    expect(all).not.toContain("/components/primitives/overview");
    expect(all).not.toContain("/components/primitives/xcss");
    expect(all[0]).toBe("/components/button");
    expect(selectComponentEntries(entries, 2).map((e) => e.path)).toEqual(["/components/button", "/components/tabs"]);
  });

  it("assigns stable slugs: index entries first, colliding sub-pages get the parent prefix", () => {
    const entries = [
      { name: "Grid", path: "/components/primitives/grid", category: "Primitives", badge: null },
      { name: "Page", path: "/components/page", category: "Layout", badge: null },
      { name: "Grid", path: "/components/page/grid", category: "Layout", badge: null },
    ];
    const slugs = assignSlugs(entries, new Set(["/components/primitives/grid", "/components/page"]));
    expect(slugs.get("/components/primitives/grid")).toBe("grid");
    expect(slugs.get("/components/page/grid")).toBe("page-grid");
  });

  it("parses the code tab: header, status notes, tabs, installation table and props", () => {
    const html = fx("button-code.html");
    const p = parseDocsPage(html, `${C}/button/code`, { code: true, navUnder: "/components/button" });
    expect(p.title).toBe("Button");
    expect(p.lead).toBe("A button triggers an event or action. They let users know what will happen next.");
    expect(p.statusNotes.map((n) => n.heading)).toEqual(["Neutral selected states"]);
    expect(p.tabs.map((t) => t.path)).toEqual(["/components/button/examples", "/components/button/code", "/components/button/usage", "/components/button/changelog"]);
    expect(p.tabs.find((t) => t.selected)?.label).toBe("Code");
    expect(p.code?.packageName).toBe("@atlaskit/button");
    expect(p.code?.sourceUrl).toBe("https://bitbucket.org/atlassian/atlassian-frontend-mirror/src/master/design-system/button");
    expect(p.code?.installCommand).toBe("yarn add @atlaskit/button");
    const props = new Map(p.code!.props.map((x) => [x.name, x]));
    expect([...props.keys()]).toEqual(["appearance", "children", "isDisabled", "spacing", "shouldFitContainer"]);
    expect(props.get("appearance")?.type).toBe('"warning" | "default" | "subtle" | "primary" | "discovery" | "danger"');
    expect(props.get("children")).toMatchObject({ required: true, deprecated: false });
    expect(props.get("shouldFitContainer")).toMatchObject({ deprecated: true, description: null, defaultValue: "false" });
    expect(p.navChildren.map((e) => e.path)).toEqual(["/components/button/icon-button", "/components/button/button-legacy"]);
    // cheap discover-time scans agree with the full parser
    expect(tabPathsFromHtml(html)).toEqual(p.tabs.map((t) => t.path));
    expect(packageFromCodeHtml(html)).toBe("@atlaskit/button");
  });

  it("groups props by documented export and skips hooks", () => {
    const p = parseDocsPage(fx("tabs-code.html"), `${C}/tabs/code`, { code: true });
    expect(p.code?.groups).toEqual([
      { label: "Tabs", count: 1 },
      { label: "Tab panel", count: 1 },
    ]);
    expect(p.code?.props.map((x) => `${x.group}.${x.name}`)).toEqual(["Tabs.id", "Tab panel.children"]);
    expect(p.code?.props[0]?.required).toBe(true);
  });

  it("parses usage sections (flat sibling flow), list items and links", () => {
    const p = parseDocsPage(fx("tabs-usage.html"), `${C}/tabs/usage`);
    expect(p.sections.map((s) => s.heading)).toEqual(["Usage", "Accessibility", "Best practices", "Hierarchy", "Behavior", "Related"]);
    const a11y = p.sections.find((s) => s.id === "accessibility")!;
    expect(a11y.text).toContain("left and right arrow keys");
    expect(a11y.text).toContain("tab content, not to the next tab. This is so");
    const bp = p.sections.find((s) => s.id === "best-practices")!;
    expect(bp.text).toContain("Do: Use short labels.");
    expect(bp.text).not.toContain("Don't nest tabs");
    expect(bp.fullText).toContain("Don't nest tabs");
    const behavior = p.sections.find((s) => s.id === "behavior")!;
    expect(behavior.items.map((i) => i.term)).toEqual(["Default", "Focus", "Hover", "Press", "Selected"]);
    expect(behavior.items[1]?.text).toBe("Keyboard focus on a tab.");
    expect(p.sections.find((s) => s.id === "related")!.links).toEqual(["/components/button/usage", "/components/textfield", "https://example.com/x"]);
  });

  it("reads examples headings but never code blocks or rendered example headings", () => {
    const p = parseDocsPage(fx("button-examples.html"), `${C}/button/examples`);
    expect(p.headings.map((h) => `${h.level}:${h.text}`)).toEqual(["2:Default", "2:Appearance", "3:Primary", "3:Subtle", "2:States", "3:Disabled", "3:Loading", "2:Spacing"]);
    expect(JSON.stringify(p)).not.toContain("import Button");
  });

  it("resolves hrefs and redirect stubs", () => {
    expect(resolveHref("https://atlassian.design/components/flag/")).toBe("/components/flag");
    expect(resolveHref("#props")).toBeNull();
    expect(resolveHref("mailto:x@y.z")).toBeNull();
    expect(parseRedirectStub('<script>window.location.href="/components/button/examples"</script>')).toBe("/components/button/examples");
    expect(parseRedirectStub("<html>" + "x".repeat(3000))).toBeNull();
  });
});

describe("atlassian keyboard and roles extraction", () => {
  it("keeps documented sentences that name keys", () => {
    const kb = extractKeyboard(
      "Keyboard users can navigate between tabs using the left and right arrow keys. They also aren't reachable in the tab order. Pressing Esc on a keyboard closes it. Use the DELETE key to clear contents and CTRL+A to select all.",
    );
    expect(kb).toEqual([
      { keys: "ArrowLeft / ArrowRight", action: "Keyboard users can navigate between tabs using the left and right arrow keys." },
      { keys: "Escape", action: "Pressing Esc on a keyboard closes it." },
      { keys: "Delete, Ctrl+A", action: "Use the DELETE key to clear contents and CTRL+A to select all." },
    ]);
  });
  it("finds ARIA roles only when named as roles", () => {
    expect(extractRoles('Uses role="dialog" and the status role; a button is not a role here.')).toEqual(["dialog", "status"]);
  });
});

describe("@atlaskit/tokens artifacts", () => {
  it("extracts the JSON literal statically and rejects non-JSON", () => {
    expect(extractTokensLiteral("const tokens = [1, 2];\nexport default tokens;\n")).toBe("[1, 2]");
    expect(() => parseTokensRaw("const tokens = [foo()];\nexport default tokens;")).toThrow(TokenArtifactError);
    expect(() => parseTokensRaw("module.exports = []")).toThrow(TokenArtifactError);
  });

  it("parses token-names.js into a CSS custom property map", () => {
    const m = parseTokenNames(fx("token-names.js"));
    expect(m["color.background.accent.blue.bolder"]).toBe("--ds-background-accent-blue-bolder");
    expect(m["elevation.shadow.raised"]).toBe("--ds-shadow-raised");
  });

  it("expresses substituted palette keys as references and keeps build-preserved keys literal", () => {
    const index = new Map([
      ["Duration150", "motion.duration.Duration150"],
      ["FadeIn0to100", "motion.keyframe.FadeIn0to100"],
    ]);
    const r = toRawValue({ duration: "Duration150", keyframes: ["FadeIn0to100"] }, { duration: 150, keyframes: ["FadeIn0to100"] }, index);
    expect(r.rawValue).toEqual({ duration: "{motion.duration.Duration150}", keyframes: ["FadeIn0to100"] });
    expect(r.references).toEqual(["motion.duration.Duration150"]);
    // different shape (typography object -> CSS shorthand): every palette key becomes a reference
    expect(toRawValue({ duration: "Duration150" }, "150ms", index).references).toEqual(["motion.duration.Duration150"]);
  });

  it("builds normalized tokens with cssVar, type, tier, references and the source schema location", () => {
    const palette = parseTokensRaw(fx("palette.js"));
    const light = parseTokensRaw(fx("atlassian-light.js"));
    const { index, collisions } = buildPaletteIndex([palette]);
    expect(collisions).toEqual([]);
    const names = parseTokenNames(fx("token-names.js"));
    const lightSpec = TOKEN_SETS.find((s) => s.slug === "theme-light")!;
    const { tokens } = buildTokens(light, lightSpec, index, names);
    const by = new Map(tokens.map((t) => [t.name, t]));
    expect(by.get("color.background.accent.blue.bolder")).toMatchObject({
      path: ["color", "background", "accent", "blue", "bolder", "[default]"],
      cssVar: "--ds-background-accent-blue-bolder",
      type: "color",
      category: "color",
      tier: "semantic",
      rawValue: "{color.palette.Blue700}",
      references: ["color.palette.Blue700"],
    });
    expect(by.get("opacity.disabled")).toMatchObject({ type: "opacity", rawValue: "{value.opacity.Opacity40}" });
    const shadow = by.get("elevation.shadow.raised")!;
    expect(shadow.type).toBeNull();
    expect(shadow.category).toBe("elevation");
    expect(JSON.stringify(shadow.rawValue)).toContain("{color.palette.Neutral1100}");
    expect(by.get("utility.UNSAFE.transparent")).toMatchObject({ rawValue: "transparent", references: [] });
    expect(by.get("color.background.accent.blue.bolder")!.location).toMatch(/atlassian-light\.js#\/\d+ \(schema\/themes\/atlassian-light\//);
    const paletteSpec = TOKEN_SETS.find((s) => s.slug === "palette-color")!;
    const pal = buildTokens(palette, paletteSpec, index, names).tokens;
    expect(pal.find((t) => t.name === "color.palette.Blue700")).toMatchObject({ tier: "primitive", type: "color", references: [], cssVar: null });
  });

  it("does not type percentage radii as dimensions", () => {
    const pal = parseTokensRaw(fx("shape-palette.js"));
    const { index } = buildPaletteIndex([pal]);
    const { tokens } = buildTokens(parseTokensRaw(fx("atlassian-shape.js")), TOKEN_SETS.find((s) => s.slug === "shape")!, index, {});
    expect(tokens.find((t) => t.name === "radius.small")?.type).toBe("dimension");
    expect(tokens.find((t) => t.name === "radius.tile")?.type).toBeNull();
  });
});

describe("npm metadata and llms index", () => {
  it("reads manifests and packument publish times", () => {
    const m = parseNpmManifest(fx("button-manifest.json"))!;
    expect(m.name).toBe("@atlaskit/button");
    expect(m.peerDependencies).toContain("react");
    expect(m.website?.subPages.find((s) => s.id === "button-legacy")?.status).toBe("intent-to-deprecate");
    const p = parseNpmPackument(fx("button-packument.json"))!;
    expect(p.version).toBe(m.version);
    expect(p.publishedAt).toBe("2026-11-02T01:55:12.806Z");
    expect(parseNpmManifest("not json")).toBeNull();
  });
  it("parses explicit statuses and ignores fenced code", () => {
    const e = parseLlmsComponents(fx("llms-components.txt"));
    expect(e.map((x) => `${x.packageName}:${x.exportName}:${x.status}`)).toEqual(["@atlaskit/button:ButtonGroup:general-availability", "@atlaskit/button:Button:general-availability", "@atlaskit/tabs:Tabs:general-availability"]);
    expect(e[2]?.categories).toEqual(["navigation"]);
  });
});

/* ------------------------------------------------------------------------------------------ */
/* normalize + validate                                                                        */
/* ------------------------------------------------------------------------------------------ */

function fixtureFragments(): AtlFragmentData[] {
  const idx = parseIndexPage(fx("components-index.html"));
  const page = (file: string, componentPath: string, tab: string, url: string) =>
    ({ type: "component-page", stamp: stamp(url), componentPath, tab, page: parseDocsPage(fx(file), url, { code: tab === "code", navUnder: componentPath }) }) as AtlFragmentData;
  const tokensFrag = (slug: string, file: string) => ({ type: "tokens", stamp: stamp(`https://cdn.jsdelivr.net/npm/@atlaskit/tokens@20.9.0/${file}`), setSlug: slug, file: TOKEN_SETS.find((s) => s.slug === slug)!.file, npm, tokens: parseTokensRaw(fx(file)) }) as AtlFragmentData;
  return [
    { type: "index", stamp: stamp(C), entries: idx.entries, navPaths: idx.navPaths },
    page("button-code.html", "/components/button", "code", `${C}/button/code`),
    page("button-examples.html", "/components/button", "examples", `${C}/button/examples`),
    page("tabs-code.html", "/components/tabs", "code", `${C}/tabs/code`),
    page("tabs-usage.html", "/components/tabs", "usage", `${C}/tabs/usage`),
    { type: "npm", stamp: stamp(npmPackumentUrl("@atlaskit/button")), packageName: "@atlaskit/button", packument: true, info: parseNpmPackument(fx("button-packument.json")) },
    { type: "npm", stamp: stamp(npmManifestUrl("@atlaskit/tokens")), packageName: "@atlaskit/tokens", packument: false, info: parseNpmManifest(fx("tokens-manifest.json")) },
    { type: "llms", stamp: stamp(`${DOCS_ORIGIN}/llms-components.txt`), entries: parseLlmsComponents(fx("llms-components.txt")) },
    tokensFrag("palette-color", "palette.js"),
    tokensFrag("palette-motion", "motion-palette.js"),
    tokensFrag("palette-shape", "shape-palette.js"),
    tokensFrag("theme-light", "atlassian-light.js"),
    tokensFrag("motion", "atlassian-motion.js"),
    tokensFrag("shape", "atlassian-shape.js"),
    { type: "token-names", stamp: stamp("https://cdn.jsdelivr.net/npm/@atlaskit/tokens@20.9.0/dist/es2019/artifacts/token-names.js"), file: "dist/es2019/artifacts/token-names.js", npm, map: parseTokenNames(fx("token-names.js")) },
    { type: "guidance-page", stamp: stamp(`${DOCS_ORIGIN}/foundations/content/designing-messages`), page: parseDocsPage(fx("designing-messages.html"), `${DOCS_ORIGIN}/foundations/content/designing-messages`) },
    { type: "system-page", stamp: stamp(`${DOCS_ORIGIN}/get-started/about-atlassian-design-system`), key: "about", page: parseDocsPage(fx("about.html"), `${DOCS_ORIGIN}/get-started/about-atlassian-design-system`) },
  ];
}

describe("atlassian normalize", () => {
  const bundle = normalizeAtlassian(fixtureFragments(), { systemSlug: "atlassian" });

  it("produces a contract-valid bundle the engine accepts without errors", () => {
    expect(NormalizedBundle.safeParse(bundle).success).toBe(true);
    const v = validateBundle(bundle, { systemSlug: "atlassian", adapterIssues: validateAtlassianBundle(bundle, { limit: 5 }) });
    expect(v.bundleIssues.filter((i) => i.severity === "error")).toEqual([]);
    expect(v.entities.filter((e) => e.validation === "invalid" || e.validation === "conflict")).toEqual([]);
    expect(v.entities.reduce((n, e) => n + (e.droppedTokens?.length ?? 0), 0)).toBe(0);
  });

  it("includes navigation sub-pages found on component pages and keeps deterministic order", () => {
    expect(bundle.components.map((c) => c.slug)).toEqual(["box", "button", "button-legacy", "icon-button", "side-navigation", "tabs", "text-field"]);
    expect(normalizeAtlassian(fixtureFragments(), { systemSlug: "atlassian" })).toEqual(bundle);
  });

  it("builds Button from code, examples, npm and llms sources", () => {
    const b = bundle.components.find((c) => c.slug === "button")!;
    expect(b.description).toBe("A button triggers an event or action. They let users know what will happen next.");
    expect(b.docsUrl).toBe(`${C}/button`);
    expect(b.sourceCodeUrl).toContain("bitbucket.org/atlassian/atlassian-frontend-mirror");
    expect(b.lifecycle).toBe("stable");
    expect(b.evidence.find((e) => e.field === "lifecycle")?.extractionMethod).toBe("adapter:atlassian:llms-components");
    expect(b.canonicalType).toBe("button");
    expect(b.classification?.state).toBe("inferred");
    expect(b.frameworks).toEqual([{ slug: "react", packageName: "@atlaskit/button", importName: null, sourceUrl: "https://www.npmjs.com/package/@atlaskit/button" }]);
    expect(b.variants.filter((v) => v.axis === "appearance").map((v) => v.name)).toEqual(["warning", "default", "subtle", "primary", "discovery", "danger"]);
    expect(b.variants.filter((v) => v.axis === "density").map((v) => v.name)).toEqual(["default", "compact"]);
    expect(b.states.map((s) => `${s.name}:${s.canonical}`)).toEqual(["Disabled:disabled", "Loading:loading"]);
    expect(b.coverage.states).toBe("documented");
    expect(b.properties.map((p) => `${p.implementation}.${p.name}`)).toEqual(["react.appearance", "react.children", "react.isDisabled", "react.spacing", "react.shouldFitContainer"]);
    expect(b.properties.find((p) => p.name === "appearance")?.allowedValues).toContain("primary");
    expect(b.properties.find((p) => p.name === "appearance")?.sourceUrl).toBe(`${C}/button/code#appearance`);
    expect(b.examples.every((e) => e.kind === "docs-link" && !e.code)).toBe(true);
    expect(b.examples.map((e) => e.url)).toContain(`${C}/button/examples#primary`);
    expect(b.coverage.tokens).toBe("not-extracted");
    expect(b.coverage.accessibility).toBe("not-extracted"); // usage tab listed, but no usage fragment in this fixture set
  });

  it("inherits the parent's package for sub-pages and reads release phases from lozenges", () => {
    const legacy = bundle.components.find((c) => c.slug === "button-legacy")!;
    expect(legacy.lifecycle).toBe("deprecated");
    expect(legacy.evidence.find((e) => e.field === "lifecycle")?.excerpt).toContain("Caution");
    const sideNav = bundle.components.find((c) => c.slug === "side-navigation")!;
    expect(sideNav.lifecycle).toBe("deprecated");
    expect(sideNav.coverage.description).toBe("not-extracted");
  });

  it("builds Tabs accessibility, keyboard, behavior states, per-export props and related links", () => {
    const t = bundle.components.find((c) => c.slug === "tabs")!;
    expect(t.lifecycle).toBe("stable");
    expect(t.properties.map((p) => `${p.implementation}.${p.name}`)).toEqual(["react:Tabs.id", "react:TabPanel.children"]);
    expect(t.states.map((s) => s.canonical)).toEqual(["default", "focus", "hover", "active", "selected"]);
    expect(t.accessibility?.keyboard?.map((k) => k.keys)).toEqual(["ArrowLeft / ArrowRight", "Tab", "Tab"]);
    expect(t.accessibility?.docsUrl).toBe(`${C}/tabs/usage#accessibility`);
    expect(t.accessibility?.screenReader).toContain("screen readers");
    expect(t.coverage.keyboard).toBe("documented");
    expect(t.relationships).toEqual([
      { kind: "related", targetSlug: "button", targetType: null },
      { kind: "related", targetSlug: "text-field", targetType: null },
    ]);
    for (const field of ["description", "properties", "states", "accessibility", "keyboard", "relationships"]) expect(t.evidence.some((e) => e.field === field)).toBe(true);
  });

  it("builds restricted token sets with resolvable references", () => {
    const slugs = bundle.tokenSets.map((s) => s.slug);
    expect(slugs).toEqual(["palette-color", "palette-shape", "palette-motion", "theme-light", "shape", "motion"]);
    for (const s of bundle.tokenSets) {
      expect(s.redistribution).toBe("restricted");
      expect(s.license?.slug).toBe("atlassian-design-system-license");
      expect(s.packageVersion).toBe("20.9.0");
    }
    const names = new Set(bundle.tokenSets.flatMap((s) => s.tokens.map((t) => t.name)));
    for (const s of bundle.tokenSets) for (const t of s.tokens) for (const r of t.references) expect(names.has(r)).toBe(true);
    const motion = bundle.tokenSets.find((s) => s.slug === "motion")!.tokens[0]!;
    expect(motion).toMatchObject({ name: "motion.avatar.enter", tier: "component", cssVar: "--ds-avatar-enter" });
    expect((motion.rawValue as { keyframes: string[] }).keyframes).toEqual(["ScaleIn80to100", "FadeIn0to100"]);
    expect(bundle.tokenSets.find((s) => s.slug === "theme-light")!.theme).toBe("light");
  });

  it("records guidance pages as patterns and system facts with evidence", () => {
    expect(bundle.patterns).toHaveLength(1);
    expect(bundle.patterns[0]).toMatchObject({ slug: "designing-messages", canonicalType: "notifications", componentSlugs: ["tabs"] });
    expect(bundle.patterns[0]!.classification?.state).toBe("inferred");
    const f = bundle.facts!;
    expect(f.latestVersion).toBe(parseNpmManifest(fx("button-manifest.json"))!.version);
    expect(f.latestReleaseAt).toBe("2026-11-02T01:55:12.806Z");
    expect(f.principles?.map((p) => p.name)).toEqual(["Trusted fundamentals before comprehensive patterns", "Meet system needs before delivering individual features"]);
    expect(f.principles?.[0]?.sourceUrl).toBe(`${DOCS_ORIGIN}/get-started/about-atlassian-design-system#1-trusted-fundamentals-before-comprehensive-patterns`);
    expect(f.philosophy).toContain("Foundational; Harmonious");
    for (const field of ["latestVersion", "latestReleaseAt", "principles", "philosophy", "frameworks"]) expect(f.evidence.some((e) => e.field === field)).toBe(true);
  });

  it("uses page status notes and links deprecation alternatives", () => {
    const frags = [...fixtureFragments(), { type: "component-page", stamp: stamp(`${C}/menu/examples`), componentPath: "/components/menu", tab: "examples", page: parseDocsPage(fx("menu-examples.html"), `${C}/menu/examples`) } as AtlFragmentData];
    const idx = frags[0] as Extract<AtlFragmentData, { type: "index" }>;
    idx.entries.push({ name: "Menu", path: "/components/menu", category: "Navigation", badge: "Caution" });
    const b = normalizeAtlassian(frags, { systemSlug: "atlassian" });
    const menu = b.components.find((c) => c.slug === "menu")!;
    expect(menu.lifecycle).toBe("deprecated");
    expect(menu.evidence.find((e) => e.field === "lifecycle")?.excerpt).toMatch(/^Caution: We're planning to deprecate Menu/);
    expect(menu.relationships).toEqual([{ kind: "replaced-by", targetSlug: "tabs", targetType: null }]);
  });
});

describe("atlassian validate", () => {
  it("flags stored code examples and non-restricted token sets", () => {
    const bundle = normalizeAtlassian(fixtureFragments(), { systemSlug: "atlassian" });
    const bad = structuredClone(bundle);
    bad.components[1]!.examples.push({ slug: "code", title: "x", kind: "code-snippet", code: "<Button />", attribution: "x" });
    bad.tokenSets[0]!.redistribution = "permitted";
    const issues = validateAtlassianBundle(bad, { limit: 5 });
    expect(issues.filter((i) => i.severity === "error").map((i) => i.code).sort()).toEqual(["LICENSE", "LICENSE"]);
    expect(validateAtlassianBundle(bundle, { limit: 5 }).filter((i) => i.severity === "error")).toEqual([]);
  });
});

/* ------------------------------------------------------------------------------------------ */
/* discover (offline, fake fetcher)                                                            */
/* ------------------------------------------------------------------------------------------ */

function fakeHttp(routes: Record<string, { status: number; body: string }>) {
  const calls: string[] = [];
  const get = async (url: string): Promise<FetchResult> => {
    calls.push(url);
    const r = routes[url] ?? { status: 404, body: '<html><head><meta property="og:url" content="https://atlassian.design/404"/></head></html>' };
    return { url, finalUrl: url, status: r.status, ok: r.status < 400, notModified: false, fromCache: false, contentType: "text/html", etag: null, lastModified: null, body: r.body, hash: `h${r.body.length}`, byteSize: r.body.length, fetchedAt: "2026-11-05T00:00:00.000Z", attempts: 1, blockedByRobots: false, error: null };
  };
  return { http: { get } as unknown as PoliteFetcher, calls };
}

describe("atlassian discover", () => {
  it("plans tabs from code pages, falls back to redirect stubs, adds nav sub-pages, pins token artifacts", async () => {
    const tabsExamples = fx("tabs-usage.html").replace("Tabs - Usage", "Tabs - Examples");
    const { http, calls } = fakeHttp({
      [`${C}`]: { status: 200, body: fx("components-index.html") },
      [npmManifestUrl("@atlaskit/tokens")]: { status: 200, body: fx("tokens-manifest.json") },
      [`${C}/button/code`]: { status: 200, body: fx("button-code.html") },
      [`${C}/tabs`]: { status: 200, body: '<script>window.location.href="/components/tabs/usage"</script>' },
      [`${C}/tabs/usage`]: { status: 200, body: tabsExamples },
    });
    const ctx: AdapterContext = { systemSlug: "atlassian", http, log: { info() {}, warn() {}, error() {} }, runStartedAt: "2026-11-05T00:00:00.000Z", limit: 3 };
    const docs = await adapter.discover(ctx);
    const pages = docs.filter((d) => d.docKind === "atl-component-page").map((d) => `${(d.meta as { componentPath: string }).componentPath}|${(d.meta as { tab: string }).tab}`);
    expect(pages).toContain("/components/button|code");
    expect(pages).toContain("/components/button|examples");
    expect(pages).toContain("/components/button|usage");
    expect(pages).not.toContain("/components/button|changelog");
    expect(pages).toContain("/components/tabs|usage");
    // limit 3: button, tabs + one sub-page/other entry, never more
    expect(new Set(pages.map((p) => p.split("|")[0])).size).toBeLessThanOrEqual(3);
    expect(calls).toContain(`${C}/tabs/code`); // tried first, 404
    const tokenDocs = docs.filter((d) => d.docKind === "atl-tokens-raw");
    expect(tokenDocs).toHaveLength(TOKEN_SETS.length);
    expect(tokenDocs.every((d) => d.url.startsWith("https://cdn.jsdelivr.net/npm/@atlaskit/tokens@20.9.0/dist/es2019/artifacts/"))).toBe(true);
    expect(docs.some((d) => d.docKind === "atl-npm-packument" && d.url === npmPackumentUrl("@atlaskit/button"))).toBe(true);
    expect(docs.some((d) => d.docKind === "atl-npm-manifest" && d.url === npmManifestUrl("@atlaskit/tokens"))).toBe(true);
    expect(new Set(docs.map((d) => d.url)).size).toBe(docs.length);
    // prefetched bodies are served once by fetch()
    const first = await adapter.fetch!(ctx, docs.find((d) => d.url === `${C}/button/code`)!, {});
    expect(first.body).toBe(fx("button-code.html"));
  });
});
