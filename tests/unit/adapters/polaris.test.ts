import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { NormalizedBundle } from "@/lib/contracts";
import { adapter } from "@/ingestion/adapters/polaris";
import { displayType, parsePolarisCem } from "@/ingestion/adapters/polaris/cem";
import { DOC_KINDS, PATTERNS_PREFIX, WC_PREFIX } from "@/ingestion/adapters/polaris/constants";
import { parseIndexPage, parsePatternPage, parseSystemPage, parseWcPage } from "@/ingestion/adapters/polaris/devdocs";
import { DtsResolver, parseDts, parseJsDoc, splitTop } from "@/ingestion/adapters/polaris/dts";
import type { NpmInfo, PolarisFragmentData, ReactProp } from "@/ingestion/adapters/polaris/fragments";
import { componentPathFromLink, componentPathsFromRedirects, kbdKeys, parseReactMdx, parseRedirects, phraseKeys } from "@/ingestion/adapters/polaris/mdx";
import { assignReactSlugs, classify, normalizePolaris, valueNotes, wcSlugFromUrl } from "@/ingestion/adapters/polaris/normalize";
import { firstSentence, kebab, literalMembers, literalUnion, splitUnion, type Stamp } from "@/ingestion/adapters/polaris/text";
import { parseTokenDescriptions, parseTokensCss, themeTokens, tokenTier, toPolarisToken } from "@/ingestion/adapters/polaris/tokens";
import { validatePolarisBundle } from "@/ingestion/adapters/polaris/validate";
import type { FetchResult } from "@/ingestion/http";
import type { AdapterContext } from "@/ingestion/types";

const FIX = path.resolve(import.meta.dirname, "../../fixtures/adapters/polaris");
const fx = (f: string) => readFileSync(path.join(FIX, f), "utf8");
const WC = "https://shopify.dev/docs/api/app-home/latest/web-components";
const T = "2026-11-05T00:00:00.000Z";
const stamp = (evidenceUrl: string, url = evidenceUrl): Stamp => ({ url, evidenceUrl, retrievedAt: T, hash: "abc123" });

const typesNpm: NpmInfo = { packageName: "@shopify/polaris-types", version: "2.0.0", publishedAt: "2026-10-21T12:20:24.195Z", license: null, deprecated: null };
const reactNpm: NpmInfo = { packageName: "@shopify/polaris", version: "13.9.5", publishedAt: "2025-03-26T17:16:25.641Z", license: "SEE LICENSE IN LICENSE.md", deprecated: "Polaris React is deprecated and no longer maintained. For building Shopify admin experiences, use Polaris web components." };
const tokensNpm: NpmInfo = { packageName: "@shopify/polaris-tokens", version: "9.4.2", publishedAt: null, license: "SEE LICENSE IN LICENSE.md", deprecated: null };

/** Loader for the trimmed declaration fixtures, keyed like package paths ("build/ts/src/..."). */
const dtsLoader = async (p: string) => {
  const rel = p.replace(/^build\/ts\/src\//, "");
  try {
    return readFileSync(path.join(FIX, "dts", rel), "utf8");
  } catch {
    return null;
  }
};

describe("polaris text helpers", () => {
  it("splits unions at top level and reads literal members", () => {
    expect(splitUnion(`'a' | "b|c" | Foo<'x' | 'y'> | (() => void)`)).toEqual([`'a'`, `"b|c"`, `Foo<'x' | 'y'>`, `(() => void)`]);
    expect(literalUnion(`"auto" | "primary"`)).toEqual(["auto", "primary"]);
    expect(literalUnion(`"auto" | AnyString`)).toBeNull();
    expect(literalMembers(`"auto" | AnyString | '_blank'`)).toEqual(["auto", "_blank"]);
  });

  it("keeps the first sentence and kebab-cases class names", () => {
    expect(firstSentence("Buttons trigger actions, e.g. saving. Second sentence follows here and is long enough to skip.", 60)).toBe("Buttons trigger actions, e.g. saving.");
    expect(kebab("ButtonGroup")).toBe("button-group");
    expect(kebab("URLField")).toBe("url-field");
  });
});

describe("polaris custom elements manifest", () => {
  const cem = parsePolarisCem(fx("custom-elements.json"));

  it("reads public fields, attributes, events and slots; drops private, static and methods", () => {
    expect(cem.schemaVersion).toBe("2.1.0");
    expect(cem.elements.map((e) => e.tagName)).toEqual(["s-button", "s-table", "s-table-row", "s-text"]);
    const button = cem.elements[0]!;
    expect(button.className).toBe("Button");
    expect(button.description).toBeNull(); // "Configure the following properties…" boilerplate
    const names = button.properties.map((p) => p.name);
    expect(names).toContain("variant");
    expect(names).not.toContain("_internal");
    expect(names).not.toContain("styles");
    expect(names).not.toContain("focus");
    expect(button.properties.find((p) => p.name === "accessibilityLabel")!.attribute).toBe("accessibilitylabel");
    expect(button.properties.find((p) => p.name === "variant")!.default).toBe("'auto'");
    expect(button.events.map((e) => e.name)).toEqual(["click"]);
    expect(button.slots).toEqual([{ name: "", description: expect.stringContaining("label text") }]);
    expect(button.pointer).toMatch(/^\/modules\/\d+\/declarations\/0$/);
  });

  it("bounds very long union types for display", () => {
    const icon = cem.elements[0]!.properties.find((p) => p.name === "icon")!;
    const shown = displayType(icon.type, 120)!;
    expect(shown.length).toBeLessThanOrEqual(160);
    expect(shown).toMatch(/values in total\)$/);
    expect(displayType("string")).toBe("string");
  });
});

describe("polaris shopify.dev markdown", () => {
  it("parses the component index cards", () => {
    const idx = parseIndexPage(fx("wc-index.md"), `${WC}/`);
    expect(idx.apiVersion).toBe("v2.0");
    expect(idx.items.map((i) => i.title)).toEqual(["Button", "Button group", "Table"]);
    expect(idx.items[0]).toMatchObject({ url: `${WC}/actions/button`, section: "Actions", summary: expect.stringMatching(/^Trigger actions or events/) });
    expect(idx.sections[0]).toEqual({ name: "Actions", description: expect.stringMatching(/^Action components/) });
    expect(wcSlugFromUrl(idx.items[1]!.url)).toBe("button-group");
  });

  it("parses a component page: properties, events, slots, examples, best practices", () => {
    const p = parseWcPage(fx("wc-button.md"));
    expect(p.title).toBe("Button");
    expect(p.htmlUrl).toBe(`${WC}/actions/button`);
    expect(p.description).toMatch(/^The button component triggers actions/);
    expect(p.intro).toHaveLength(2);
    expect(p.useCases).toHaveLength(4);
    expect(p.introLinks.map((l) => wcSlugFromUrl(l.url))).toEqual(["link", "button-group"]);
    expect(p.api).toHaveLength(1);
    const main = p.api[0]!;
    expect(main.main).toBe(true);
    expect(main.props.map((x) => x.name)).toEqual(["accessibilityLabel", "disabled", "loading", "tone", "variant"]); // zero-width chars stripped
    expect(main.props.find((x) => x.name === "tone")).toMatchObject({ type: `"auto" | "neutral" | "critical"`, defaultValue: "'auto'", deprecated: false });
    expect(main.events.map((x) => x.name)).toEqual(["blur", "click", "focus"]);
    expect(main.slots.map((x) => x.name)).toEqual(["children"]);
    expect(p.examples.map((e) => e.title)).toEqual(["Add a basic button", "Add primary and secondary buttons"]); // "## html" tabs are not examples
    expect(p.bestPractices.some((b) => /screen reader/.test(b))).toBe(true);
    expect(p.limitations.length).toBeGreaterThan(0);
  });

  it("attributes subcomponent sections (## Table row) separately", () => {
    const p = parseWcPage(fx("wc-table.md"));
    expect(p.api.map((a) => [a.heading, a.main])).toEqual([
      ["", true],
      ["Table row", false],
    ]);
    expect(p.api[0]!.props.map((x) => x.name)).toEqual(["loading", "variant"]);
    expect(p.api[0]!.slots.map((x) => x.name)).toEqual(["children", "filters"]);
    expect(p.api[1]!.props.map((x) => x.name)).toEqual(["clickDelegate"]);
  });

  it("reads pattern pages and system pages", () => {
    const pat = parsePatternPage(fx("pattern-account-connection.md"));
    expect(pat.title).toBe("Account connection");
    expect(pat.components.map((c) => c.title)).toEqual(["Button", "Grid", "Heading", "Section", "Stack", "Text"]);
    expect(pat.examples).toEqual(["Display connection status with connect button and terms"]);
    expect(pat.intro[0]).toMatch(/^Many apps integrate/);
    const v = parseSystemPage(fx("versioning.md"));
    expect(v.documentedVersion).toBe("2.0");
    expect(v.htmlUrl).toBe(`${WC}/versioning`);
    const o = parseSystemPage(fx("polaris-overview.md"));
    expect(o.paragraphs.some((x) => /unified UI framework built on web components/.test(x))).toBe(true);
  });
});

describe("polaris archive MDX", () => {
  const redirects = parseRedirects(fx("redirects.js"));
  const rmap = new Map(redirects.map((r) => [r.source, r.destination]));

  it("reads redirects.js as data and resolves legacy links", () => {
    expect(redirects).toHaveLength(4);
    expect(componentPathsFromRedirects(redirects)).toEqual(["/components/actions/button", "/components/lists/listbox", "/components/navigation/link"]);
    expect(componentPathFromLink("https://polaris.shopify.com/components/link", rmap)).toBe("/components/navigation/link");
    expect(componentPathFromLink("/components/actions/button-group#examples", rmap)).toBe("/components/actions/button-group");
    expect(componentPathFromLink("https://shopify.dev/docs/api/polaris", rmap)).toBeNull();
  });

  it("parses frontmatter, lede, related links and keyboard support", () => {
    const d = parseReactMdx(fx("react-button.mdx"), "/components/actions/button");
    expect(d.title).toBe("Button");
    expect(d.category).toBe("Actions");
    expect(d.webComponent).toEqual({ name: "s-button", url: "https://shopify.dev/docs/api/app-home/polaris-web-components/button", type: "polaris" });
    expect(d.examples.map((e) => e.fileName)).toEqual(["button-default.tsx", "button-plain.tsx"]);
    expect(d.lede).toMatch(/^Buttons are used primarily for actions/);
    expect(d.related.map((r) => r.sitePath)).toEqual(["/components/actions/button-group", "/components/link"]);
    expect(d.bestPractices[1]).toBe("Be clearly and accurately labeled.");
    expect(d.accessibility!.keyboard).toEqual([
      { keys: "Tab, Shift+Tab", action: "Give buttons keyboard focus with the tab key (or shift + tab when tabbing backwards)" },
      { keys: "Enter / Return, Space", action: "Activate buttons with the enter/return key or the space key" },
    ]);
    expect(d.accessibility!.guidance).toMatch(/^Buttons can have different states/);
  });

  it("detects an explicitly named ARIA pattern and prose key names", () => {
    const d = parseReactMdx(fx("react-listbox.mdx"), "/components/lists/listbox");
    expect(d.accessibility!.ariaPattern).toBe("listbox");
    expect(d.accessibility!.keyboard.map((k) => k.keys)).toEqual(["ArrowUp / ArrowDown", "Enter / Return"]);
    expect(kbdKeys("Close with <kbd>esc</kbd>")).toBe("Escape");
    expect(phraseKeys("Press the escape key to close")).toBe("Escape");
    expect(phraseKeys("Move with the left or right arrow keys")).toBe("ArrowLeft / ArrowRight");
    expect(phraseKeys("Keep focus on the task")).toBeNull();
  });
});

describe("polaris React declarations", () => {
  it("parses interfaces, JSDoc tags and method signatures", () => {
    const f = parseDts(fx("dts/components/Button/Button.d.ts"));
    const props = f.decls.get("ButtonProps")!;
    expect(props.extends).toEqual(["BaseButton"]);
    expect(f.imports.get("BaseButton")).toEqual({ module: "../../types", name: "BaseButton" });
    const size = props.members.find((m) => m.name === "size")!;
    expect(size).toMatchObject({ optional: true, type: "'micro' | 'slim' | 'medium' | 'large'", defaultValue: "'medium'", description: "Changes the size of the button, giving it more or less padding" });
    expect(props.members.find((m) => m.name === "removeUnderline")).toMatchObject({ deprecated: true, deprecationNote: "Use a variant instead" });
    expect(parseJsDoc("/** Hello\n * @default 'x'\n */")).toMatchObject({ description: "Hello", defaultValue: "'x'" });
    expect(splitTop("A & (B | C) & Omit<D, 'x' & 'y'>", "&")).toEqual(["A", "(B | C)", "Omit<D, 'x' & 'y'>"]);
  });

  it("resolves inherited props across modules and alias literal values", async () => {
    const r = new DtsResolver(dtsLoader);
    const file = "build/ts/src/components/Button/Button.d.ts";
    const res = (await r.props(file, "ButtonProps"))!;
    const names = res.props.map((p) => p.name);
    expect(names.slice(0, 6)).toEqual(["children", "size", "removeUnderline", "icon", "tone", "variant"]);
    expect(names).toEqual(expect.arrayContaining(["id", "url", "target", "disabled", "loading", "pressed", "onClick", "onKeyPress"]));
    const target = res.props.find((p) => p.name === "target")!;
    expect(target.from).toBe("BaseButton");
    expect(await r.allowedValues(target.file, target.type)).toEqual(["_blank", "_self", "_parent", "_top"]);
    expect(res.props.find((p) => p.name === "onKeyPress")!.type).toBe("(event: React.KeyboardEvent<HTMLButtonElement>) => void");
  });

  it("expands intersections with unions (optional) and Omit through re-export chains", async () => {
    const r = new DtsResolver(dtsLoader);
    const badge = (await r.props("build/ts/src/components/Badge/Badge.d.ts", "BadgeProps"))!;
    expect(badge.props.map((p) => p.name)).toEqual(["children", "tone", "size", "progress", "icon"]);
    expect(badge.props.find((p) => p.name === "progress")!.optional).toBe(true);
    const tone = badge.props.find((p) => p.name === "tone")!;
    expect(await r.allowedValues(tone.file, tone.type)).toEqual(["info", "success", "warning", "critical"]);
    const modal = (await r.props("build/ts/src/components/Modal/Modal.d.ts", "ModalProps"))!;
    expect(modal.props.map((p) => p.name)).toEqual(["open", "size", "onClose", "primaryAction", "secondaryActions"]); // footer omitted
    expect(modal.props.find((p) => p.name === "open")!.optional).toBe(false);
    expect(modal.files).toContain("build/ts/src/components/Modal/components/Footer/Footer.d.ts");
  });

  it("never requests module candidates a listing says are missing", async () => {
    const requested: string[] = [];
    const listed = new Set(["build/ts/src/components/Button/Button.d.ts", "build/ts/src/types.d.ts"]);
    const r = new DtsResolver(
      async (p) => {
        requested.push(p);
        return dtsLoader(p);
      },
      (p) => listed.has(p),
    );
    await r.props("build/ts/src/components/Button/Button.d.ts", "ButtonProps");
    expect(requested.every((p) => listed.has(p))).toBe(true);
  });
});

describe("polaris tokens", () => {
  const blocks = parseTokensCss(fx("tokens-styles.css"));

  it("groups custom properties by theme selector and keeps references as token names", () => {
    expect(blocks.map((b) => [b.selector, b.themes, b.isDefault])).toEqual([
      [":root,.p-theme-light", ["light"], true],
      [".p-theme-light-mobile", ["light-mobile"], false],
      [".p-theme-dark-experimental", ["dark-experimental"], false],
    ]);
    const root = blocks[0]!;
    expect(root.decls[0]).toEqual({ name: "color-scheme", cssVar: null, value: "light", references: [] });
    expect(root.decls.find((d) => d.name === "space-card-gap")).toEqual({ name: "space-card-gap", cssVar: "--p-space-card-gap", value: "var(--p-space-400)", references: ["space-400"] });
  });

  it("builds each theme as the cascade of :root plus the theme's overrides", () => {
    const dark = themeTokens(blocks, "dark-experimental");
    expect(dark.find((t) => t.name === "color-bg")).toMatchObject({ value: "rgba(26, 26, 26, 1)", inherited: false, selector: ".p-theme-dark-experimental" });
    expect(dark.find((t) => t.name === "space-100")).toMatchObject({ value: "0.25rem", inherited: true });
    expect(dark.find((t) => t.name === "color-scheme")!.value).toBe("dark");
    const mobile = themeTokens(blocks, "light-mobile");
    expect(mobile.find((t) => t.name === "shadow-button")!.references).toEqual(["border-width-025", "color-border"]);
    expect(themeTokens(blocks, "light").every((t) => !t.inherited)).toBe(true);
  });

  it("reads descriptions from ESM metadata as text and classifies tokens", () => {
    const desc = parseTokenDescriptions(fx("tokens-color.mjs"));
    expect(desc.get("color-bg")).toBe("The default background color of the admin's pages.");
    expect(desc.has("color-scheme")).toBe(false);
    const light = themeTokens(blocks, "light");
    const tok = toPolarisToken(light.find((t) => t.name === "color-bg")!, desc, "dist/css/styles.css");
    expect(tok).toMatchObject({ name: "color-bg", path: ["color", "color-bg"], cssVar: "--p-color-bg", category: "color", tier: "semantic", tierState: "inferred", type: null });
    expect(toPolarisToken(light.find((t) => t.name === "z-index-1")!, desc, "x").category).toBe("elevation");
    expect(tokenTier("color-avatar-bg-fill")).toBe("component");
    expect(tokenTier("space-400")).toBe("primitive");
    expect(tokenTier("text-heading-3xl-font-family")).toBe("semantic");
  });
});

describe("polaris normalize", () => {
  function fragments(): PolarisFragmentData[] {
    const cem = parsePolarisCem(fx("custom-elements.json"));
    const btnPage = parseWcPage(fx("wc-button.md"));
    const tablePage = parseWcPage(fx("wc-table.md"));
    const r = new DtsResolver(dtsLoader);
    return [
      { type: "cem", stamp: stamp("https://cdn.jsdelivr.net/npm/@shopify/polaris-types@2.0.0/dist/custom-elements.json"), npm: typesNpm, file: "dist/custom-elements.json", schemaVersion: cem.schemaVersion, elements: cem.elements },
      { type: "wc-index", stamp: stamp(WC), page: parseIndexPage(fx("wc-index.md"), WC_PREFIX) },
      { type: "wc-page", stamp: stamp(btnPage.htmlUrl!), slug: "button", section: "Actions", summary: null, page: btnPage },
      { type: "wc-page", stamp: stamp(tablePage.htmlUrl!), slug: "table", section: "Layout and structure", summary: null, page: tablePage },
      { type: "system-page", stamp: stamp(`${WC}/versioning`), key: "versioning", page: parseSystemPage(fx("versioning.md")) },
      { type: "system-page", stamp: stamp("https://shopify.dev/docs/api/polaris"), key: "overview", page: parseSystemPage(fx("polaris-overview.md")) },
      { type: "pattern-page", stamp: stamp("https://shopify.dev/docs/api/app-home/latest/patterns/compositions/account-connection"), slug: "account-connection", group: "Compositions", summary: null, page: parsePatternPage(fx("pattern-account-connection.md")) },
      { type: "redirects", stamp: stamp("https://github.com/Shopify/polaris-react-archive/blob/main/polaris.shopify.com/redirects.js"), redirects: parseRedirects(fx("redirects.js")) },
      {
        type: "react-mdx",
        stamp: stamp("https://github.com/Shopify/polaris-react-archive/blob/main/polaris.shopify.com/content/components/actions/button.mdx"),
        file: "polaris.shopify.com/content/components/actions/button.mdx",
        doc: parseReactMdx(fx("react-button.mdx"), "/components/actions/button"),
      },
      {
        type: "react-mdx",
        stamp: stamp("https://github.com/Shopify/polaris-react-archive/blob/main/polaris.shopify.com/content/components/lists/listbox.mdx"),
        file: "polaris.shopify.com/content/components/lists/listbox.mdx",
        doc: parseReactMdx(fx("react-listbox.mdx"), "/components/lists/listbox"),
      },
      { type: "react-index", stamp: stamp("https://cdn.jsdelivr.net/npm/@shopify/polaris@13.9.5/build/ts/src/index.d.ts"), npm: reactNpm, file: "build/ts/src/index.d.ts", exports: { Button: "Button", Badge: "Badge", BulkActions: "UnstableBulkActions" } },
      { type: "archive-readme", stamp: stamp("https://github.com/Shopify/polaris-react-archive/blob/main/README.md"), archived: true, statement: "This repository is archived and unmaintained." },
      { type: "license", stamp: stamp("https://cdn.jsdelivr.net/npm/@shopify/polaris-tokens@9.4.2/LICENSE.md"), key: "tokens", copyright: "Copyright (c) 2017-present Shopify Inc", fieldOfUse: true },
      { type: "tokens-css", stamp: stamp("https://cdn.jsdelivr.net/npm/@shopify/polaris-tokens@9.4.2/dist/css/styles.css"), npm: tokensNpm, file: "dist/css/styles.css", blocks: parseTokensCss(fx("tokens-styles.css")) },
      { type: "tokens-meta", stamp: stamp("https://cdn.jsdelivr.net/npm/@shopify/polaris-tokens@9.4.2/dist/esm/src/themes/base/color.mjs"), npm: tokensNpm, file: "dist/esm/src/themes/base/color.mjs", descriptions: Object.fromEntries(parseTokenDescriptions(fx("tokens-color.mjs"))) },
      {
        type: "storybook",
        stamp: stamp("https://storybook.polaris.shopify.dev/index.json"),
        stories: [{ title: "All components/Button", id: "all-components-button--all", name: "All", importPath: "./src/components/Button/Button.stories.tsx" }],
      },
      // react-dts appended asynchronously below
    ];
  }

  async function bundle() {
    const frags = fragments();
    const r = new DtsResolver(dtsLoader);
    const file = "build/ts/src/components/Button/Button.d.ts";
    const res = (await r.props(file, "ButtonProps"))!;
    const props: ReactProp[] = [];
    for (const p of res.props) props.push({ ...p, allowedValues: await r.allowedValues(p.file, p.type) });
    frags.push({ type: "react-dts", stamp: stamp(`https://cdn.jsdelivr.net/npm/@shopify/polaris@13.9.5/${file}`), npm: reactNpm, docPath: "/components/actions/button", dir: "Button", file, propsName: "ButtonProps", found: true, props, unresolved: res.unresolved, files: res.files });
    return normalizePolaris(frags, { systemSlug: "shopify-polaris", runStartedAt: T });
  }

  it("produces a contract-valid bundle with both implementations", async () => {
    const b = await bundle();
    expect(NormalizedBundle.safeParse(b).success).toBe(true);
    expect(b.components.map((c) => c.slug)).toEqual(["button", "react-button", "react-listbox", "table", "table-row", "text"]);
    expect(validatePolarisBundle(b, { limit: 5 }).filter((i) => i.severity === "error")).toEqual([]);
  });

  it("models a web component from the manifest + shopify.dev page", async () => {
    const c = (await bundle()).components.find((x) => x.slug === "button")!;
    expect(c).toMatchObject({ name: "Button", lifecycle: "stable", docsUrl: `${WC}/actions/button`, canonicalType: "button" });
    expect(c.aliases).toEqual(["s-button"]);
    expect(c.description).toBe("The button component triggers actions or events, such as submitting forms, opening dialogs, or navigating to other pages.");
    expect(c.frameworks).toEqual([{ slug: "web-components", packageName: null, importName: "s-button", sourceUrl: `${WC}/actions/button` }]);
    expect(c.properties.every((p) => p.implementation === "web-components")).toBe(true);
    expect(c.properties.find((p) => p.name === "click")!.type).toBe("event");
    expect(c.properties.find((p) => p.name === "children")!.type).toBe("slot");
    expect(c.properties.find((p) => p.name === "accessibilityLabel")!.description).toMatch(/^Attribute `accessibilitylabel`\./);
    expect(c.variants.filter((v) => v.axis === "variant").map((v) => v.name)).toEqual(["auto", "primary", "secondary", "tertiary"]);
    expect(c.variants.find((v) => v.axis === "tone" && v.name === "critical")!.description).toBe("Urgent problems or destructive actions.");
    expect(c.states.map((s) => s.name)).toEqual(["disabled", "loading"]);
    expect(c.coverage.states).toBe("inferred");
    expect(c.examples.every((e) => e.kind === "docs-link" && !e.code)).toBe(true);
    expect(c.accessibility!.guidance).toMatch(/accessibilityLabel/);
    expect(c.evidence.find((e) => e.field === "lifecycle")).toMatchObject({ state: "inferred", extractionMethod: "adapter:polaris:shopify-dev-markdown" });
    expect(c.evidence.every((e) => e.extractionMethod.startsWith("adapter:polaris:"))).toBe(true);
  });

  it("links documented subcomponents to their parent and keeps undocumented elements unknown", async () => {
    const b = await bundle();
    const table = b.components.find((x) => x.slug === "table")!;
    const row = b.components.find((x) => x.slug === "table-row")!;
    expect(table.relationships).toContainEqual({ kind: "subcomponent", targetSlug: "table-row", targetType: null });
    expect(row).toMatchObject({ name: "Table row", lifecycle: "stable", docsUrl: `${WC}/layout-and-structure/table`, canonicalType: null });
    expect(row.relationships).toEqual([{ kind: "parent", targetSlug: "table", targetType: null }]);
    const text = b.components.find((x) => x.slug === "text")!;
    expect(text.lifecycle).toBe("unknown");
    expect(text.docsUrl).toBeUndefined();
    expect(text.coverage.accessibility).toBe("not-extracted");
  });

  it("models Polaris React as deprecated with props, keyboard support and a replacement", async () => {
    const c = (await bundle()).components.find((x) => x.slug === "react-button")!;
    expect(c).toMatchObject({ name: "Button", lifecycle: "deprecated", canonicalType: "button" });
    expect(c.docsUrl).toBe("https://github.com/Shopify/polaris-react-archive/blob/main/polaris.shopify.com/content/components/actions/button.mdx");
    expect(c.sourceCodeUrl).toBe("https://github.com/Shopify/polaris-react-archive/tree/%40shopify%2Fpolaris%4013.9.5/polaris-react/src/components/Button");
    expect(c.frameworks).toEqual([{ slug: "react", packageName: "@shopify/polaris", importName: "Button", sourceUrl: "https://www.npmjs.com/package/@shopify/polaris" }]);
    expect(c.relationships).toEqual([{ kind: "replaced-by", targetSlug: "button", targetType: null }]);
    expect(c.properties.every((p) => p.implementation === "react")).toBe(true);
    expect(c.properties.find((p) => p.name === "removeUnderline")).toMatchObject({ deprecated: true, required: false });
    expect(c.sizes).toEqual(["micro", "slim", "medium", "large"]);
    expect(c.states.map((s) => s.canonical)).toEqual(["disabled", "loading", "active"]);
    expect(c.accessibility!.keyboard).toHaveLength(2);
    expect(c.examples.map((e) => e.kind)).toEqual(["docs-link", "docs-link", "storybook-link"]);
    expect(c.examples[0]!.url).toBe("https://github.com/Shopify/polaris-react-archive/blob/main/polaris.shopify.com/pages/examples/button-default.tsx");
    expect(c.examples.every((e) => !e.code)).toBe(true);
    expect(c.evidence.find((e) => e.field === "lifecycle" && e.extractionMethod === "adapter:polaris:npm-metadata")!.excerpt).toMatch(/deprecated/);
  });

  it("classifies from an explicitly named ARIA pattern as verified; React without declarations stays not-extracted", async () => {
    const c = (await bundle()).components.find((x) => x.slug === "react-listbox")!;
    expect(c.canonicalType).toBe("listbox");
    expect(c.classification).toMatchObject({ state: "verified", method: "source-aria-pattern:listbox" });
    expect(c.coverage.properties).toBe("not-extracted");
    expect(c.frameworks[0]!.importName).toBeNull();
  });

  it("emits one restricted token set per declared theme, patterns and facts with evidence", async () => {
    const b = await bundle();
    expect(b.tokenSets.map((s) => [s.slug, s.theme, s.tokens.length])).toEqual([
      ["tokens-dark-experimental", "dark-experimental", 18],
      ["tokens-light", "light", 18],
      ["tokens-light-mobile", "light-mobile", 18],
    ]);
    for (const s of b.tokenSets) {
      expect(s).toMatchObject({ format: "css-vars", packageName: "@shopify/polaris-tokens", packageVersion: "9.4.2", redistribution: "restricted" });
      expect(s.license!.slug).toBe("polaris-license");
    }
    const p = b.patterns[0]!;
    expect(p).toMatchObject({ slug: "account-connection", name: "Account connection", componentSlugs: ["button", "table", "text"].filter((x) => ["button", "text"].includes(x)) });
    expect(b.facts!.latestVersion).toBe("2.0.0");
    expect(new Set(b.facts!.evidence.map((e) => e.field))).toEqual(new Set(["latestVersion", "latestReleaseAt", "frameworks", "philosophy"]));
    expect(b.facts!.philosophy).toMatch(/^ATLAS summary:/);
  });
});

describe("polaris slugs, classification and validation", () => {
  it("prefixes React slugs and qualifies the deprecated duplicate", () => {
    const m = assignReactSlugs(["/components/deprecated/card", "/components/layout-and-structure/card", "/components/actions/button"]);
    expect(m.get("/components/layout-and-structure/card")).toBe("react-card");
    expect(m.get("/components/deprecated/card")).toBe("react-deprecated-card");
    expect(m.get("/components/actions/button")).toBe("react-button");
  });

  it("only keeps contained-alias classifications for trailing head nouns", () => {
    expect(classify(["Inline error"], null).slug).toBeNull();
    expect(classify(["Index filters"], null).slug).toBe("filter");
    expect(classify(["Table header"], null, { subcomponent: true }).slug).toBeNull();
    expect(classify(["Button"], null)).toMatchObject({ slug: "button", state: "inferred" });
  });

  it("extracts per-value notes from manifest descriptions", () => {
    const n = valueNotes("The tone. - `critical`: Urgent problems. - `auto`: Automatically determined based on context.");
    expect(n.get("critical")).toBe("Urgent problems.");
    expect(n.get("auto")).toBe("Automatically determined based on context.");
  });

  it("flags stored code and unrestricted token sets", () => {
    const issues = validatePolarisBundle(
      {
        systemSlug: "shopify-polaris",
        components: [
          {
            slug: "button",
            name: "Button",
            aliases: [],
            lifecycle: "stable",
            frameworks: [{ slug: "web-components" }],
            variants: [],
            states: [],
            properties: [{ implementation: "web-components", name: "tone", deprecated: false }],
            examples: [{ slug: "x", title: "X", kind: "code-snippet", code: "<s-button>" }],
            relationships: [],
            tokenUsages: [],
            coverage: {},
            evidence: [],
          },
        ],
        tokenSets: [{ slug: "tokens-light", name: "x", format: "css-vars", sourceUrl: "https://x.test", redistribution: "permitted", tokens: [], evidence: [] }],
        patterns: [],
      } as unknown as NormalizedBundle,
      { limit: 1 },
    );
    expect(issues.filter((i) => i.severity === "error").map((i) => i.code).sort()).toEqual(["LICENSE", "LICENSE"]);
  });
});

describe("polaris adapter", () => {
  it("declares its id and system", () => {
    expect(adapter.id).toBe("polaris");
    expect(adapter.systems).toEqual(["shopify-polaris"]);
  });

  it("parses documents through parse() without network for local declarations", async () => {
    const result = (body: string, url: string): FetchResult => ({ url, finalUrl: url, status: 200, ok: true, notModified: false, fromCache: false, contentType: "text/plain", etag: null, lastModified: null, body, hash: "h", byteSize: body.length, fetchedAt: T, attempts: 1, blockedByRobots: false, error: null });
    const ctx = {
      systemSlug: "shopify-polaris",
      runStartedAt: T,
      log: { info() {}, warn() {}, error() {} },
      http: {
        async get(url: string) {
          const rel = url.replace("https://cdn.jsdelivr.net/npm/@shopify/polaris@13.9.5/build/ts/src/", "");
          const body = await dtsLoader(`build/ts/src/${rel}`);
          return body === null ? { ...result("", url), ok: false, status: 404, body: null } : result(body, url);
        },
      },
    } as unknown as AdapterContext;
    const url = "https://cdn.jsdelivr.net/npm/@shopify/polaris@13.9.5/build/ts/src/components/Button/Button.d.ts";
    const out = (await adapter.parse(ctx, {
      doc: { url, docKind: DOC_KINDS.reactDts, source: { kind: "package", url: "https://www.npmjs.com/package/@shopify/polaris" }, meta: { npm: reactNpm, file: "build/ts/src/components/Button/Button.d.ts", dir: "Button", docPath: "/components/actions/button", propsName: "ButtonProps" } },
      result: result(fx("dts/components/Button/Button.d.ts"), url),
    })) as { data: Extract<PolarisFragmentData, { type: "react-dts" }> };
    expect(out.data.found).toBe(true);
    expect(out.data.props.find((p) => p.name === "target")!.allowedValues).toEqual(["_blank", "_self", "_parent", "_top"]);
    const idx = (await adapter.parse(ctx, { doc: { url: "https://x.test/idx.d.ts", docKind: DOC_KINDS.reactIndex, source: { kind: "package", url: "https://x.test" }, meta: { npm: reactNpm } }, result: result(fx("dts/index.d.ts"), "https://x.test/idx.d.ts") })) as {
      data: Extract<PolarisFragmentData, { type: "react-index" }>;
    };
    expect(idx.data.exports).toEqual({ AppProvider: "AppProvider", Badge: "Badge", BulkActions: "UnstableBulkActions", Button: "Button", Modal: "Modal" });
    const pat = (await adapter.parse(ctx, { doc: { url: `${PATTERNS_PREFIX}compositions/account-connection.md`, docKind: DOC_KINDS.patternPage, source: { kind: "docs", url: "https://shopify.dev" }, meta: { slug: "account-connection", group: "Compositions" } }, result: result(fx("pattern-account-connection.md"), "u") })) as {
      data: Extract<PolarisFragmentData, { type: "pattern-page" }>;
    };
    expect(pat.data.stamp.evidenceUrl).toBe("https://shopify.dev/docs/api/app-home/latest/patterns/compositions/account-connection");
  });
});
