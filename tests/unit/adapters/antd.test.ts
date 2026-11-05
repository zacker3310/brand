import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { NormalizedBundle } from "@/lib/contracts";
import { adapter } from "@/ingestion/adapters/antd";
import { DOC_KINDS, PROFILES, SLUG_ANTD, SLUG_MOBILE } from "@/ingestion/adapters/antd/constants";
import type { AntdDocMeta, AntdFragment, PkgInfo } from "@/ingestion/adapters/antd/fragments";
import { componentSlugFromLink, firstSentences, parseDoc, specSlugFromLink } from "@/ingestion/adapters/antd/markdown";
import { normalizeAntd, normalizeMobile, sameTokenValue } from "@/ingestion/adapters/antd/normalize";
import { deriveFromProps, extractProps, ownerName } from "@/ingestion/adapters/antd/props";
import {
  antdKebab,
  cssVarRefs,
  jsLiteral,
  parseAliasJs,
  parseComponentTokenRefs,
  parseDistCss,
  parseIndexExports,
  parseMobileNav,
  parseMobileThemeCss,
  parsePresetColorsDts,
  parseSeedJs,
} from "@/ingestion/adapters/antd/tokens";
import { validateAntdBundle } from "@/ingestion/adapters/antd/validate";
import type { FetchResult } from "@/ingestion/http";
import type { AdapterContext, DiscoveredDocument, ParsedFragment } from "@/ingestion/types";

const FIX = path.resolve(import.meta.dirname, "../../fixtures/adapters/antd");
const fx = (f: string) => readFileSync(path.join(FIX, f), "utf8");

const ANTD_PKG: PkgInfo = { name: "antd", version: "6.7.0", publishedAt: "2026-11-04T03:59:45.205Z", license: "MIT", gitHead: null, ref: "6.7.0" };
const MOBILE_PKG: PkgInfo = { name: "antd-mobile", version: "5.43.0", publishedAt: "2026-09-14T09:02:40.702Z", license: "MIT", gitHead: null, ref: "v5.43.0" };

function result(url: string, body: string | null, status = 200): FetchResult {
  return {
    url,
    finalUrl: url,
    status,
    ok: status >= 200 && status < 300,
    notModified: false,
    fromCache: false,
    contentType: "text/plain",
    etag: null,
    lastModified: null,
    body,
    hash: body ? `hash-${body.length}` : null,
    byteSize: body?.length ?? 0,
    fetchedAt: "2026-11-05T00:00:00.000Z",
    attempts: 1,
    blockedByRobots: false,
    error: status >= 400 ? `HTTP_${status}` : null,
  };
}

/** Offline context: ctx.http.get serves fixtures by URL suffix (used for <embed> includes). */
function ctxFor(systemSlug: string, files: Record<string, string> = {}): AdapterContext {
  const http = {
    get: async (url: string) => {
      const hit = Object.entries(files).find(([suffix]) => url.endsWith(suffix));
      return hit ? result(url, hit[1]) : result(url, null, 404);
    },
  };
  return {
    systemSlug,
    http: http as unknown as AdapterContext["http"],
    log: { info: () => {}, warn: () => {}, error: () => {} },
    runStartedAt: "2026-11-05T00:00:00.000Z",
  };
}

async function parseFixture(ctx: AdapterContext, docKind: string, url: string, body: string, meta: Partial<AntdDocMeta>): Promise<AntdFragment> {
  const doc: DiscoveredDocument = { url, docKind, source: { kind: "repository", url: "https://github.com/ant-design" }, evidenceUrl: url, meta: { systemSlug: ctx.systemSlug, file: "x", ...meta } };
  const out = (await adapter.parse(ctx, { doc, result: result(url, body) })) as ParsedFragment;
  expect(out).toBeTruthy();
  return out.data as AntdFragment;
}

const raw = (file: string) => `https://raw.githubusercontent.com/ant-design/ant-design/6.7.0/${file}`;
const npm = (file: string) => `https://cdn.jsdelivr.net/npm/antd@6.7.0/${file}`;

async function antdFragments(): Promise<AntdFragment[]> {
  const ctx = ctxFor(SLUG_ANTD, { "components/button/shared/sharedProps.en-US.md": fx("shared/sharedProps.en-US.md") });
  const base = { pkg: ANTD_PKG };
  return Promise.all([
    parseFixture(ctx, DOC_KINDS.npmVersion, "https://registry.npmjs.org/antd/6.7.0", JSON.stringify({ license: "MIT", peerDependencies: { react: ">=18", "react-dom": ">=18" } }), { ...base, file: "antd@6.7.0" }),
    parseFixture(ctx, DOC_KINDS.license, raw("LICENSE"), "MIT LICENSE\n\nCopyright (c) 2015-present Ant UED, https://xtech.antfin.com/\n", { ...base, file: "LICENSE" }),
    parseFixture(ctx, DOC_KINDS.sitemap, "https://ant.design/sitemap.xml", fx("sitemap.xml"), { file: "sitemap.xml", trailingSlash: true }),
    parseFixture(ctx, DOC_KINDS.componentMd, raw("components/button/index.en-US.md"), fx("button.en-US.md"), { ...base, file: "components/button/index.en-US.md", slug: "button", dir: "button", docsUrl: "https://ant.design/components/button/", order: 0 }),
    parseFixture(ctx, DOC_KINDS.componentMd, raw("components/modal/index.en-US.md"), fx("modal.en-US.md"), { ...base, file: "components/modal/index.en-US.md", slug: "modal", dir: "modal", docsUrl: "https://ant.design/components/modal/", order: 1 }),
    parseFixture(ctx, DOC_KINDS.specMd, raw("docs/spec/buttons.en-US.md"), fx("buttons-spec.en-US.md"), { ...base, file: "docs/spec/buttons.en-US.md", slug: "buttons", docsUrl: "https://ant.design/docs/spec/buttons/" }),
    parseFixture(ctx, DOC_KINDS.specMd, raw("docs/spec/values.en-US.md"), fx("values.en-US.md"), { ...base, file: "docs/spec/values.en-US.md", slug: "values", docsUrl: "https://ant.design/docs/spec/values/" }),
    parseFixture(ctx, DOC_KINDS.specMd, raw("docs/spec/introduce.en-US.md"), fx("introduce.en-US.md"), { ...base, file: "docs/spec/introduce.en-US.md", slug: "introduce", docsUrl: "https://ant.design/docs/spec/introduce/" }),
    parseFixture(ctx, DOC_KINDS.specMd, raw("docs/spec/proximity.en-US.md"), fx("proximity.en-US.md"), { ...base, file: "docs/spec/proximity.en-US.md", slug: "proximity", docsUrl: "https://ant.design/docs/spec/proximity/" }),
    parseFixture(ctx, DOC_KINDS.specMd, raw("docs/spec/alignment.en-US.md"), fx("alignment.en-US.md"), { ...base, file: "docs/spec/alignment.en-US.md", slug: "alignment", docsUrl: "https://ant.design/docs/spec/alignment/" }),
    parseFixture(ctx, DOC_KINDS.demo, "https://cdn.jsdelivr.net/gh/ant-design/ant-design@6.7.0/components/button/demo/basic.tsx", "import { Button } from 'antd';\nexport default () => <Button>OK</Button>;\n", { ...base, file: "components/button/demo/basic.tsx", slug: "button", demo: "basic", demoTitle: "Syntactic sugar", anchor: "button-demo-basic" }),
    parseFixture(ctx, DOC_KINDS.tokenMeta, npm("es/version/token-meta.json"), fx("token-meta.json"), { ...base, file: "es/version/token-meta.json" }),
    parseFixture(ctx, DOC_KINDS.tokenJson, npm("es/version/token.json"), fx("token.json"), { ...base, file: "es/version/token.json" }),
    parseFixture(ctx, DOC_KINDS.distCss, npm("dist/antd.css"), fx("antd.css"), { ...base, file: "dist/antd.css" }),
    parseFixture(ctx, DOC_KINDS.seedJs, npm("es/theme/themes/seed.js"), fx("seed.js"), { ...base, file: "es/theme/themes/seed.js" }),
    parseFixture(ctx, DOC_KINDS.aliasJs, npm("es/theme/util/alias.js"), fx("alias.js"), { ...base, file: "es/theme/util/alias.js" }),
    parseFixture(ctx, DOC_KINDS.presetColorsDts, npm("es/theme/interface/presetColors.d.ts"), fx("presetColors.d.ts"), { ...base, file: "es/theme/interface/presetColors.d.ts" }),
    parseFixture(ctx, DOC_KINDS.indexDts, npm("es/index.d.ts"), fx("index.d.ts"), { ...base, file: "es/index.d.ts" }),
    parseFixture(ctx, DOC_KINDS.styleTokenJs, npm("es/button/style/token.js"), fx("button-style-token.js"), { ...base, file: "es/button/style/token.js", slug: "button", dir: "button" }),
  ]);
}

/* ------------------------------------------------------------------------------------------ */

describe("antd markdown parsing", () => {
  const doc = parseDoc(fx("button.en-US.md"));

  it("reads frontmatter, demos, token table, embeds and source line numbers", () => {
    expect(doc.frontmatter.title).toBe("Button");
    expect(doc.frontmatter.designUrl).toBe("/docs/spec/buttons");
    expect(doc.demos.map((d) => [d.src, d.title, d.debug])).toEqual([
      ["./demo/basic.tsx", "Syntactic sugar", false],
      ["./demo/color-variant.tsx", "Color & Variant", false],
      ["./demo/debug-color-variant", "Debug Color & Variant", true],
      ["./demo/size.tsx", "Size", false],
    ]);
    expect(doc.tokenTableComponents).toEqual(["Button"]);
    expect(doc.embeds.map((e) => [e.src, e.headings.map((h) => h.text)])).toEqual([["./shared/sharedProps.en-US.md", ["API", "Common API"]]]);
    const api = doc.tables[0]!;
    // Table header is line 29 of the fixture (frontmatter lines are counted).
    expect(fx("button.en-US.md").split("\n")[api.line - 1]).toMatch(/^\| Property \| Description/);
    expect(doc.a11yNotes[0]).toMatch(/Screen readers announce the loading state/);
  });

  it("parses union type cells, strikethrough and links", () => {
    const api = doc.tables[0]!;
    const color = api.rows.find((r) => r[0]!.text === "color")!;
    expect(color[2]!.segments.map((s) => s.code)).toEqual(["default", "primary", "danger", null]);
    const icon = api.rows.find((r) => r[0]!.text === "iconPosition")!;
    expect(icon[0]!.struck).toBe(true);
    expect(doc.links).toContain("/components/dropdown/");
  });

  it("maps docs links to component and spec slugs", () => {
    expect(componentSlugFromLink("/components/dropdown/", "https://ant.design")).toBe("dropdown");
    expect(componentSlugFromLink("https://ant.design/components/space#api", "https://ant.design")).toBe("space");
    expect(componentSlugFromLink("/components/input-cn", "https://ant.design")).toBe("input");
    expect(componentSlugFromLink("https://example.com/components/x", "https://ant.design")).toBeNull();
    expect(specSlugFromLink("/docs/spec/buttons", "https://ant.design")).toBe("buttons");
    expect(firstSentences("One. Two two. Three three three.", 14)).toBe("One. Two two.");
  });
});

describe("antd API props", () => {
  const doc = parseDoc(fx("button.en-US.md"));
  const props = extractProps(doc.tables, {
    mainNames: ["Button", "API", "Common API"],
    scope: (t) => t.headings.some((h) => h.depth === 2 && h.text === "API"),
    ownerOf: (t) => t.headings.filter((h) => h.depth >= 3).pop()?.text ?? null,
  });

  it("extracts documented props, skipping method tables, with deprecation and literals", () => {
    expect(props.map((p) => p.name)).toEqual(["block", "color", "disabled", "htmlType", "iconPosition", "loading", "shape", "size", "type", "variant"]);
    const icon = props.find((p) => p.name === "iconPosition")!;
    expect(icon.deprecated).toBe(true);
    const color = props.find((p) => p.name === "color")!;
    expect(color.literals).toEqual(["default", "primary", "danger"]);
    expect(color.allLiteral).toBe(false);
    expect(props.find((p) => p.name === "size")!.allLiteral).toBe(true);
    expect(props.find((p) => p.name === "block")!.defaultValue).toBe("false");
    expect(props.find((p) => p.name === "variant")!.defaultValue).toBeNull();
  });

  it("derives variants, sizes and states from documented props", () => {
    const d = deriveFromProps(props);
    expect(d.sizes?.values).toEqual(["large", "medium", "small"]);
    expect([...new Set(d.variants.map((v) => v.axis))]).toEqual(["color", "shape", "type", "variant"]);
    expect(d.states.map((s) => [s.name, s.canonical])).toEqual([
      ["disabled", "disabled"],
      ["loading", "loading"],
    ]);
  });

  it("treats a native `type` prop as non-variant and cleans owner headings", () => {
    const m = parseDoc(fx("mobile/button.en.md"));
    const mp = extractProps(m.tables, { mainNames: ["Button", "Props"], scope: () => true, ownerOf: (t) => t.headings.filter((h) => !/^props$/i.test(h.text)).pop()?.text ?? null });
    expect(mp.map((p) => p.name)).toEqual(["color", "disabled", "fill", "size", "type"]);
    const d = deriveFromProps(mp);
    expect([...new Set(d.variants.map((v) => v.axis))]).toEqual(["color", "fill"]);
    expect(d.sizes?.values).toEqual(["mini", "small", "middle", "large"]);
    expect(ownerName("Avatar.Group <Badge>4.5.0+</Badge>")).toBe("Avatar.Group");
    expect(ownerName("Statistic.Countdown Deprecated")).toBe("Statistic.Countdown");
    expect(ownerName("Select props")).toBe("Select");
    expect(ownerName("DatePicker\\[picker=week]")).toBe("DatePicker[picker=week]");
  });
});

describe("antd static token parsers", () => {
  it("transforms token keys like @ant-design/cssinjs token2CSSVar", () => {
    expect(antdKebab("colorBgContainer")).toBe("color-bg-container");
    expect(antdKebab("fontSizeHeading1")).toBe("font-size-heading-1");
    expect(antdKebab("blue10")).toBe("blue-10");
    expect(antdKebab("QRCode")).toBe("qr-code");
    expect(antdKebab("paddingInlineLG")).toBe("padding-inline-lg");
  });

  it("picks the default-theme scope of dist/antd.css by component usage", () => {
    const css = parseDistCss(fx("antd.css"));
    expect(css.scope).toBe(".css-var-_R_0_");
    expect(css.global["--ant-color-primary"]).toBe("#1677ff");
    expect(css.global["--ant-font-family"]).toBe("-apple-system, BlinkMacSystemFont, 'Noto Sans', sans-serif");
    expect(css.global["--ant-motion-duration-fast"]).toBeUndefined();
    expect(css.component["--ant-button-default-color"]).toBe("rgba(0,0,0,0.88)");
    expect(css.component["--ant-modal-content-bg"]).toBe("#ffffff");
  });

  it("reads seed literals (with the preset spread) without executing code", () => {
    const s = parseSeedJs(fx("seed.js"));
    expect(s.presetColors).toEqual({ blue: "#1677FF", pink: "#EB2F96" });
    expect(s.values.blue).toBe("#1677FF");
    expect(s.values.fontSize).toBe(14);
    expect(s.values.motionUnit).toBe(0.1);
    expect(s.values.wireframe).toBe(false);
    expect(s.values.colorTextBase).toBe("");
    expect(s.values.fontFamily).toBe("-apple-system, BlinkMacSystemFont, 'Noto Sans', sans-serif");
    expect(jsLiteral("token.colorText")).toBeUndefined();
  });

  it("reads alias derivations: references, constants, offsets and literals", () => {
    const a = parseAliasJs(fx("alias.js"));
    expect(a.consts).toEqual({ screenXS: 480, screenSM: 576 });
    expect(a.entries.colorTextHeading).toEqual({ kind: "ref", target: "colorText" });
    expect(a.entries.screenXS).toEqual({ kind: "const", name: "screenXS", value: 480 });
    expect(a.entries.screenXSMin).toEqual({ kind: "const", name: "screenXS", value: 480 });
    expect(a.entries.screenXSMax).toEqual({ kind: "const-offset", name: "screenSM", offset: -1 });
    expect(a.entries.fontWeightStrong).toEqual({ kind: "literal", value: 600 });
    expect(a.entries.fontHeight).toBeUndefined();
    expect(a.entries.boxShadow).toBeUndefined();
  });

  it("reads plain component-token aliases from prepareComponentToken", () => {
    expect(parseComponentTokenRefs(fx("button-style-token.js"))).toEqual({ textTextColor: "colorText", defaultColor: "colorText", defaultBg: "colorBgContainer", defaultBgDisabled: "colorBgContainerDisabled" });
  });

  it("reads preset colors, exports, mobile theme CSS and nav", () => {
    expect(parsePresetColorsDts(fx("presetColors.d.ts"))).toEqual({ presets: ["blue", "purple"], palettes: true, legacyPalettes: true });
    expect(parseIndexExports(fx("index.d.ts"))).toEqual({ button: ["Button"], modal: ["Modal"], "qr-code": ["QRCode"] });
    expect(parseIndexExports(fx("mobile/index.d.ts"), "./components/")).toEqual({ button: ["Button"], "config-provider": ["ConfigProvider"], grid: ["Grid"], tabs: ["Tabs"] });
    const t = parseMobileThemeCss(`${fx("mobile/theme-default.css")}\n${fx("mobile/theme-dark.css")}`);
    expect(t.root.map((d) => d.name)).toContain("--adm-color-highlight");
    expect(t.dark).toHaveLength(7);
    expect(t.darkSelector).toBe("html[data-prefers-color-scheme='dark']");
    expect(parseMobileNav(fx("mobile/components.ts"))).toEqual([
      { group: "common", routes: ["/components/button", "/components/icon"] },
      { group: "layout", routes: ["/components/grid"] },
      { group: "navigation", routes: ["/components/tabs"] },
      { group: "dataDisplay", routes: ["/components/segmented"] },
      { group: "experimental", routes: ["/guide/what-is-experimental", "/components/calendar"] },
    ]);
    expect(cssVarRefs("solid 1px var(--adm-border-color, var(--x))")).toEqual(["--adm-border-color", "--x"]);
    expect(sameTokenValue("8px", 8)).toBe(true);
    expect(sameTokenValue("#FFF", "#ffffff")).toBe(true);
    expect(sameTokenValue("rgba(0,0,0,0.85)", "rgba(0, 0, 0, 0.88)")).toBe(false);
  });
});

describe("antd normalize (ant-design)", () => {
  it("builds a contract-valid bundle with components, tokens, patterns and facts", async () => {
    const frags = await antdFragments();
    const bundle = normalizeAntd(SLUG_ANTD, frags);
    expect(NormalizedBundle.safeParse(bundle).success).toBe(true);
    expect(bundle.components.map((c) => c.slug)).toEqual(["button", "modal"]);

    const button = bundle.components.find((c) => c.slug === "button")!;
    expect(button.name).toBe("Button");
    expect(button.description).toBe("To trigger an operation.");
    expect(button.docsUrl).toBe("https://ant.design/components/button/");
    expect(button.sourceCodeUrl).toBe("https://github.com/ant-design/ant-design/tree/6.7.0/components/button");
    expect(button.canonicalType).toBe("button");
    expect(button.classification?.state).toBe("inferred");
    expect(button.lifecycle).toBe("unknown");
    expect(button.frameworks).toEqual([{ slug: "react", packageName: "antd", importName: "Button", sourceUrl: "https://ant.design/components/button/" }]);
    // Embedded shared API table merged; Methods table skipped.
    expect(button.properties.map((p) => p.name)).toContain("autoFocus");
    expect(button.properties.map((p) => p.name)).not.toContain("focus()");
    expect(button.properties.find((p) => p.name === "iconPosition")?.deprecated).toBe(true);
    expect(button.properties.find((p) => p.name === "size")?.allowedValues).toEqual(["large", "medium", "small"]);
    expect(button.sizes).toEqual(["large", "medium", "small"]);
    expect(button.states.map((s) => s.canonical)).toEqual(["disabled", "loading"]);
    // Links to Dropdown/Space/ConfigProvider point at components outside this bundle: no dangling relationships.
    expect(button.relationships).toEqual([]);
    expect(button.coverage.relationships).toBe("not-extracted");
    // Docs demo anchors (debug demos skipped) + one MIT code sample with attribution.
    expect(button.examples.filter((e) => e.kind === "docs-link").map((e) => e.url)).toEqual([
      "https://ant.design/components/button/#button-demo-basic",
      "https://ant.design/components/button/#button-demo-color-variant",
      "https://ant.design/components/button/#button-demo-size",
    ]);
    const code = button.examples.find((e) => e.kind === "code-snippet")!;
    expect(code.attribution).toMatch(/MIT License, Copyright \(c\) 2015-present Ant UED/);
    // Token usages: token.json globals that exist + documented component tokens; unknown names dropped.
    expect(button.tokenUsages.map((u) => u.tokenName)).toEqual(["Button.defaultBg", "Button.defaultColor", "Button.paddingInline", "Button.textTextColor", "colorBgContainer", "colorText", "fontSize"]);
    expect(button.coverage).toMatchObject({ description: "documented", properties: "documented", variants: "documented", sizes: "documented", states: "inferred", tokens: "documented", examples: "documented", frameworks: "documented" });
    expect(button.accessibility?.coverage.keyboard).toBe("not-documented");
    expect(button.evidence.some((e) => e.field === "*" && e.extractionMethod === "adapter:antd:docs-markdown")).toBe(true);

    // Modal: keyboard prop documents Esc-to-close; sub-section heading with {#id} becomes an owner prefix.
    const modal = bundle.components.find((c) => c.slug === "modal")!;
    expect(modal.accessibility?.keyboard).toEqual([{ keys: "Esc", action: "Closes the Modal while the `keyboard` prop is enabled (documented default: true)." }]);
    expect(modal.coverage.keyboard).toBe("documented");
    expect(modal.canonicalType).toBe("modal");
  });

  it("emits seed/map/alias/component token sets with confirmed references only", async () => {
    const bundle = normalizeAntd(SLUG_ANTD, await antdFragments());
    const sets = Object.fromEntries(bundle.tokenSets.map((s) => [s.slug, s]));
    expect(Object.keys(sets).sort()).toEqual(["alias-tokens", "component-tokens", "map-tokens", "seed-tokens"]);
    for (const s of bundle.tokenSets) {
      expect(s.theme).toBe("light");
      expect(s.license?.redistribution).toBe("permitted");
      expect(s.packageVersion).toBe("6.7.0");
    }
    const tok = (set: string, name: string) => sets[set]!.tokens.find((t) => t.name === name);
    // Seed: CSS value preferred; seed.js literal when the token is not rendered as CSS; preset colors.
    expect(tok("seed-tokens", "colorPrimary")).toMatchObject({ rawValue: "#1677ff", cssVar: "--ant-color-primary", tier: "primitive", path: ["seed", "colorPrimary"] });
    expect(tok("seed-tokens", "motionUnit")).toMatchObject({ rawValue: 0.1, cssVar: null, type: "number", location: "es/theme/themes/seed.js#seedToken.motionUnit" });
    expect(tok("seed-tokens", "wireframe")).toMatchObject({ rawValue: false, type: "boolean" });
    expect(tok("seed-tokens", "fontSize")).toMatchObject({ rawValue: "14px", type: null, category: "typography" });
    // Map: palettes typed by ColorPalettes and present in CSS.
    expect(tok("map-tokens", "blue6")).toMatchObject({ rawValue: "#1677ff", cssVar: "--ant-blue-6", tier: "primitive" });
    expect(tok("map-tokens", "purple1")).toBeUndefined();
    // Alias: reference confirmed when the rendered values agree; colorTextLabel's target is absent -> no reference.
    expect(tok("alias-tokens", "colorTextHeading")).toMatchObject({ rawValue: "rgba(0,0,0,0.88)", references: ["colorText"] });
    expect(tok("alias-tokens", "colorTextLabel")?.references).toEqual([]);
    expect(tok("alias-tokens", "screenXSMin")).toMatchObject({ rawValue: 480, references: ["screenXS"] });
    expect(tok("alias-tokens", "screenXSMax")).toMatchObject({ rawValue: "{screenSM} - 1", references: ["screenSM"], type: null });
    // Component: token.json values; references only where the alias is static AND values match.
    expect(tok("component-tokens", "Button.defaultColor")).toMatchObject({ rawValue: "rgba(0,0,0,0.88)", references: ["colorText"], cssVar: "--ant-button-default-color", tier: "component", tierState: "verified" });
    expect(tok("component-tokens", "Button.textTextColor")?.references).toEqual([]); // 0.85 != 0.88
    expect(tok("component-tokens", "Button.paddingInline")).toMatchObject({ rawValue: 15, cssVar: "--ant-button-padding-inline", type: null });
    expect(tok("component-tokens", "Button.missingValue")).toBeUndefined();
    expect(tok("component-tokens", "QRCode.colorText")).toMatchObject({ rawValue: "rgba(0,0,0,0.88)" });
  });

  it("emits documented patterns and system facts with evidence", async () => {
    const bundle = normalizeAntd(SLUG_ANTD, await antdFragments());
    expect(bundle.patterns.map((p) => [p.slug, p.name, p.componentSlugs])).toEqual([["buttons", "Button", ["button", "modal"]]]);
    expect(bundle.patterns[0]!.description).toBe("Guide users to achieve the desired actions. Prevent user to make mistakes.");
    const f = bundle.facts!;
    expect(f.latestVersion).toBe("6.7.0");
    expect(f.principles).toEqual([
      { name: "Proximity", sourceUrl: "https://ant.design/docs/spec/proximity/" },
      { name: "Alignment", sourceUrl: "https://ant.design/docs/spec/alignment/" },
    ]);
    expect(f.philosophy).toMatch(/^Ant Design's guidance is organized around 4 design values \(Natural, Certain, Meaningful, Growing\)/);
    expect(f.frameworks).toEqual([{ slug: "react", packageName: "antd" }]);
    const fields = new Set(f.evidence.map((e) => e.field));
    for (const k of ["latestVersion", "latestReleaseAt", "principles", "philosophy", "frameworks"]) expect(fields.has(k)).toBe(true);
  });

  it("is deterministic and passes adapter validation", async () => {
    const a = normalizeAntd(SLUG_ANTD, await antdFragments());
    const b = normalizeAntd(SLUG_ANTD, (await antdFragments()).reverse());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const issues = validateAntdBundle(a, { systemSlug: SLUG_ANTD, limit: 2 });
    expect(issues.filter((i) => i.severity === "error")).toEqual([]);
    // Without a limit the well-known components are required.
    expect(validateAntdBundle(a, { systemSlug: SLUG_ANTD }).some((i) => i.severity === "error" && /select/.test(i.message))).toBe(true);
  });
});

describe("antd normalize (ant-design-mobile)", () => {
  async function mobileFragments(): Promise<AntdFragment[]> {
    const ctx = ctxFor(SLUG_MOBILE);
    const rawM = (file: string) => `https://raw.githubusercontent.com/ant-design/ant-design-mobile/v5.43.0/${file}`;
    const npmM = (file: string) => `https://cdn.jsdelivr.net/npm/antd-mobile@5.43.0/${file}`;
    const base = { pkg: MOBILE_PKG };
    const md = (slug: string, group: string, order: number) =>
      parseFixture(ctx, DOC_KINDS.mobileComponentMd, rawM(`src/components/${slug}/index.en.md`), fx(`mobile/${slug}.en.md`), {
        ...base,
        file: `src/components/${slug}/index.en.md`,
        slug,
        route: `/components/${slug}`,
        group,
        docsUrl: `https://mobile.ant.design/components/${slug}/`,
        order,
      });
    return Promise.all([
      parseFixture(ctx, DOC_KINDS.npmVersion, "https://registry.npmjs.org/antd-mobile/5.43.0", JSON.stringify({ license: "MIT", peerDependencies: { react: "^16.8.0 || ^17.0.0 || ^18.0.0" } }), { ...base, file: "antd-mobile@5.43.0" }),
      parseFixture(ctx, DOC_KINDS.license, rawM("LICENSE.txt"), "MIT LICENSE\n\nCopyright (c) 2016-present Alipay.com, https://www.alipay.com/\n", { ...base, file: "LICENSE.txt" }),
      parseFixture(ctx, DOC_KINDS.mobileNav, rawM("config/components.ts"), fx("mobile/components.ts"), { ...base, file: "config/components.ts" }),
      md("button", "common", 0),
      md("tabs", "navigation", 1),
      md("grid", "layout", 2),
      md("segmented", "experimental", 3),
      parseFixture(ctx, DOC_KINDS.mobileThemeCss, npmM("es/global/theme-default.css"), fx("mobile/theme-default.css"), { ...base, file: "es/global/theme-default.css", part: "default" }),
      parseFixture(ctx, DOC_KINDS.mobileThemeCss, npmM("es/global/theme-dark.css"), fx("mobile/theme-dark.css"), { ...base, file: "es/global/theme-dark.css", part: "dark" }),
      parseFixture(ctx, DOC_KINDS.mobileIndexDts, npmM("es/index.d.ts"), fx("mobile/index.d.ts"), { ...base, file: "es/index.d.ts" }),
      parseFixture(ctx, DOC_KINDS.mobileGuideMd, rawM("docs/guide/theming.en.md"), fx("mobile/theming.en.md"), { ...base, file: "docs/guide/theming.en.md", key: "theming", docsUrl: "https://mobile.ant.design/guide/theming/" }),
    ]);
  }

  it("splits theme CSS into theme-agnostic, light and dark sets", async () => {
    const bundle = normalizeMobile(SLUG_MOBILE, await mobileFragments());
    expect(NormalizedBundle.safeParse(bundle).success).toBe(true);
    const sets = Object.fromEntries(bundle.tokenSets.map((s) => [s.slug, s]));
    expect(Object.keys(sets).sort()).toEqual(["component-css-variables", "global", "theme-dark", "theme-light"]);
    expect(sets.global!.theme).toBeNull();
    expect(sets["theme-light"]!.theme).toBe("light");
    expect(sets["theme-dark"]!.theme).toBe("dark");
    expect(sets.global!.tokens.map((t) => t.name)).toEqual(["--adm-color-highlight", "--adm-font-family", "--adm-radius-s"]);
    expect(sets["theme-light"]!.tokens.map((t) => t.name)).toEqual(["--adm-border-color", "--adm-color-background", "--adm-color-border", "--adm-color-danger", "--adm-color-primary", "--adm-color-text"]);
    const highlight = sets.global!.tokens.find((t) => t.name === "--adm-color-highlight")!;
    expect(highlight).toMatchObject({ rawValue: "var(--adm-color-danger)", references: ["--adm-color-danger"], cssVar: "--adm-color-highlight" });
    const deprecated = sets["theme-dark"]!.tokens.find((t) => t.name === "--adm-border-color")!;
    expect(deprecated.deprecated).toBe(true);
    expect(deprecated.description).toBe("Deprecated since 5.14.0; use --adm-color-border.");
  });

  it("names component CSS variables per owner, keeps references and avoids ambiguous local names", async () => {
    const bundle = normalizeMobile(SLUG_MOBILE, await mobileFragments());
    const comp = bundle.tokenSets.find((s) => s.slug === "component-css-variables")!;
    const t = (n: string) => comp.tokens.find((x) => x.name === n)!;
    expect(comp.theme).toBeNull();
    expect(t("button.background-color")).toMatchObject({ cssVar: "--adm-button-background-color", rawValue: "var(--adm-color-background)", references: ["--adm-color-background"], tier: "component" });
    // "--gap" is documented by Button and Grid: no cssVar, so var(--gap) cannot resolve to the wrong component.
    expect(t("button.gap").cssVar).toBeNull();
    expect(t("grid.gap").cssVar).toBeNull();
    expect(t("grid.gap-horizontal")).toMatchObject({ rawValue: "var(--gap)", references: ["grid.gap"], cssVar: "--gap-horizontal" });
    // Unique local names keep their scoped custom property; same-component references resolve by name.
    expect(t("tabs.active-line-border-radius")).toMatchObject({ references: ["tabs.active-line-height"], cssVar: "--active-line-border-radius" });
    // Prose defaults are not values.
    expect(comp.tokens.some((x) => x.name === "tabs.title-font-size")).toBe(false);
  });

  it("builds components with nav lifecycle, props, variants and token usages", async () => {
    const bundle = normalizeMobile(SLUG_MOBILE, await mobileFragments());
    expect(bundle.components.map((c) => c.slug)).toEqual(["button", "grid", "segmented", "tabs"]);
    const button = bundle.components.find((c) => c.slug === "button")!;
    expect(button).toMatchObject({ name: "Button", description: "Used to start an immediate operation.", docsUrl: "https://mobile.ant.design/components/button/", lifecycle: "unknown" });
    expect(button.frameworks[0]).toMatchObject({ slug: "react", packageName: "antd-mobile", importName: "Button" });
    expect(button.properties.map((p) => p.name)).toEqual(["color", "disabled", "fill", "size", "type"]);
    expect(button.properties.find((p) => p.name === "fill")?.allowedValues).toEqual(["solid", "outline", "none"]);
    expect(button.sizes).toEqual(["mini", "small", "middle", "large"]);
    expect(button.variants.map((v) => `${v.axis}:${v.name}`)).toEqual(["color:default", "color:primary", "color:success", "color:warning", "color:danger", "fill:solid", "fill:outline", "fill:none"]);
    expect(button.tokenUsages.map((u) => u.tokenName)).toEqual(["button.background-color", "button.border-radius", "button.gap"]);
    const grid = bundle.components.find((c) => c.slug === "grid")!;
    expect(grid.properties.map((p) => p.name)).toEqual(["columns", "Grid.Item.span"]);
    const seg = bundle.components.find((c) => c.slug === "segmented")!;
    expect(seg.lifecycle).toBe("experimental");
    expect(seg.description).toBe("When displaying multiple options and user can select a single option; When switching the selected option, the content of the associated area changes.");
    expect(bundle.patterns).toEqual([]);
    expect(bundle.facts?.frameworks).toEqual([{ slug: "react", packageName: "antd-mobile" }]);
    expect(validateAntdBundle(bundle, { systemSlug: SLUG_MOBILE, limit: 4 }).filter((i) => i.severity === "error")).toEqual([]);
  });

  it("declares both registry systems", () => {
    expect(adapter.id).toBe("antd");
    expect(adapter.systems).toEqual(["ant-design", "ant-design-mobile"]);
    expect(PROFILES[SLUG_ANTD]!.refCandidates("6.7.0")[0]).toBe("6.7.0");
    expect(PROFILES[SLUG_MOBILE]!.refCandidates("5.43.0")[0]).toBe("v5.43.0");
  });
});

describe("antd links", () => {
  it("ignores links in table header cells", () => {
    const d = parseDoc(fx("button.en-US.md"));
    expect(d.links.some((l) => l.includes("#component-config"))).toBe(false);
    expect(d.links).toContain("https://developer.mozilla.org/en-US/docs/Web/HTML/Element/button#type");
  });
});
