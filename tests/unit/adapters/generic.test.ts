import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { NormalizedBundle } from "@/lib/contracts";
import { createGenericAdapter, sitemapCandidates, sitemapEntries, targetOrigin } from "@/ingestion/adapters/generic";
import {
  chooseName,
  compileTarget,
  extractNavLinks,
  humanizeSegment,
  navOutline,
  parseListing,
  parseMarkdownMeta,
  parseMdxExportMeta,
  parsePageMeta,
  parseSitemapXml,
  parseStorybookIndex,
  relatesToSegment,
  selectCandidates,
  shortDescription,
  stripComponentWord,
  stripDecoration,
  type PageMeta,
} from "@/ingestion/adapters/generic/extract";
import {
  ADAPTER_VERSION,
  applyTemplate,
  indexCandidates,
  maskName,
  normalizeGeneric,
  planComponents,
  rawFileUrl,
  siteWideDescriptions,
  targetFingerprint,
  validateGeneric,
  type GenericFragment,
  type IndexFragment,
  type PageFragment,
} from "@/ingestion/adapters/generic/normalize";
import { GENERIC_TARGETS } from "@/ingestion/adapters/generic/targets";
import type { GenericTarget } from "@/ingestion/adapters/generic/types";
import { PoliteFetcher } from "@/ingestion/http";
import type { AdapterContext, ParsedFragment } from "@/ingestion/types";

const FIX = path.resolve(import.meta.dirname, "../../fixtures/adapters/generic");
const fx = (f: string) => readFileSync(path.join(FIX, f), "utf8");
const T0 = "2026-11-05T00:00:00.000Z";

const sitemapTarget: GenericTarget = {
  slug: "example-ds",
  strategy: "sitemap",
  sitemapUrl: "https://ds.example.com/sitemap-index.xml",
  include: "^https://ds\\.example\\.com/components/(?:[a-z]+/)?([a-z0-9-]+)/$",
  exclude: ["/components/(?:overview|changelog)/$", "/components/(?:forms|display)/$", "/usage/$"],
  frameworks: ["react"],
  titleSuffix: "\\s+\\|\\s+Example Design System$",
  notes: "test",
};

const stamp = (url: string) => ({ url, evidenceUrl: url, retrievedAt: T0, hash: "h" });
const sitemapIndex = (file: string, url: string): IndexFragment => ({ type: "index", source: "sitemap", stamp: stamp(url), ...sitemapEntries(fx(file), url) });
const meta = (m: Partial<PageMeta>): PageMeta => ({ title: null, h1: null, h1Own: null, metaDescription: null, canonical: null, lang: null, soft404: false, ...m });

describe("generic extract: sitemaps", () => {
  it("parses sitemap indexes and urlsets (CDATA, entities)", () => {
    const idx = parseSitemapXml(fx("sitemap-index.xml"));
    expect(idx.kind).toBe("index");
    expect(idx.locs).toEqual(["https://ds.example.com/sitemap-0.xml", "https://ds.example.com/sitemap-blog.xml"]);
    const sm = parseSitemapXml(fx("sitemap-0.xml"));
    expect(sm.kind).toBe("urlset");
    expect(sm.locs).toContain("https://ds.example.com/components/text-field/");
    expect(sm.locs).toContain("https://ds.example.com/components/tabs/?ref=nav&x=1");
    expect(parseSitemapXml("<html><body>not a sitemap</body></html>")).toEqual({ kind: "unknown", locs: [] });
  });

  it("filters by include/exclude, collapses URL variants and keeps distinct pages apart", () => {
    const c = compileTarget(sitemapTarget);
    const cands = sitemapCandidates(fx("sitemap-0.xml"), "https://ds.example.com/sitemap-0.xml", c);
    expect(cands.map((x) => x.key)).toEqual(["button", "date-picker", "display-text", "forms-text", "tabs", "text-field"]);
    const button = cands.find((x) => x.key === "button")!;
    expect(button.matched).toBe("https://ds.example.com/components/button/"); // "/button" (no slash) does not match the include
    expect(cands.find((x) => x.key === "tabs")!.matched).toBe("https://ds.example.com/components/tabs/"); // query stripped
  });

  it("derives a target origin from explicit URLs or the include regex", () => {
    expect(targetOrigin(sitemapTarget)).toBe("https://ds.example.com");
    expect(targetOrigin({ ...sitemapTarget, sitemapUrl: undefined })).toBe("https://ds.example.com");
  });
});

describe("generic extract: nav pages and listings", () => {
  it("collects links inside the nav selector only, absolutized, without hash/query, never running scripts", () => {
    const links = extractNavLinks(fx("nav.html"), "https://ds.example.com/docs/intro/", "#docs-nav");
    expect(links.some((l) => l.text.includes("header"))).toBe(false);
    expect(links.some((l) => /javascript|mailto/.test(l.value))).toBe(false);
    const target: GenericTarget = { slug: "x", strategy: "nav", navUrl: "https://ds.example.com/docs/intro/", include: "^https://ds\\.example\\.com/docs/components/([a-z0-9-]+)/?$", exclude: ["/overview$"], notes: "t" };
    const cands = selectCandidates(links, compileTarget(target), { distinctPages: true });
    expect(cands.map((c) => [c.key, c.text])).toEqual([
      ["accordion", "Accordion"],
      ["alert", "Alert"], // shortest link text among duplicates ("Alert New" badge dropped)
      ["checkbox-group", "Checkbox group"],
    ]);
  });

  it("parses jsDelivr flat listings and matches file paths", () => {
    const files = parseListing(fx("listing.json"));
    expect(files[0]).toBe("README.md");
    const target: GenericTarget = { slug: "x", strategy: "repo-listing", include: "^components/([A-Z][A-Za-z]+)/README\\.en-US\\.md$", exclude: ["/Overview/"], notes: "t" };
    const cands = selectCandidates(files.map((value) => ({ value })), compileTarget(target));
    expect(cands.map((c) => c.segment)).toEqual(["AutoComplete", "Button", "DatePicker"]);
    expect(parseListing("not json")).toEqual([]);
  });

  it("reads Storybook index.json as a sitemap of docs entries", () => {
    const sb = parseStorybookIndex(fx("storybook-index.json"), "https://sb.example.com/index.json")!;
    expect(sb).toContainEqual({ value: "https://sb.example.com/?path=/docs/components-button--overview", text: "Components/Button" });
    const target: GenericTarget = {
      slug: "x",
      strategy: "sitemap",
      include: "^https://sb\\.example\\.com/\\?path=/docs/components-([a-z0-9-]+?)--overview$",
      exclude: ["-feature-flag--"],
      fetchPages: false,
      notes: "t",
    };
    const cands = sitemapCandidates(fx("storybook-index.json"), "https://sb.example.com/index.json", compileTarget(target));
    const names = cands.map((c) => chooseName(c.segment, null, c.text, null).name);
    expect(names).toEqual(["Button", "DataTable", "Notifications / Inline", "Skeleton Icon"]);
  });
});

describe("generic extract: page metadata and names", () => {
  it("extracts title, h1 (and its own text), meta description, canonical; scripts are inert", () => {
    const m = parsePageMeta(fx("page-button.html"), "https://ds.example.com/components/button/");
    expect(m.title).toBe("Button | Example Design System");
    expect(m.h1).toBe("Button Ready");
    expect(m.h1Own).toBe("Button");
    expect(m.metaDescription).toBe("Buttons let people take actions with a single tap or click.");
    expect(m.canonical).toBe("https://ds.example.com/components/button/");
    expect(m.soft404).toBe(false);
    expect(parsePageMeta(fx("page-soft404.html"), "https://ds.example.com/x/").soft404).toBe(true);
  });

  it("chooses names: heading that agrees with the title, then related h1/title/link, then the segment", () => {
    const suffix = compileTarget(sitemapTarget).titleSuffix;
    const page = parsePageMeta(fx("page-button.html"), "https://ds.example.com/components/button/");
    expect(chooseName("button", page, null, suffix)).toEqual({ name: "Button", from: "h1" });
    expect(chooseName("numeric", { title: "Basic number field | Example Design System", h1: "Basic number field", h1Own: null }, null, suffix).name).toBe("Basic number field");
    expect(chooseName("tabs", { title: "Example Design System", h1: "Example Design System", h1Own: null }, "Tabs", suffix)).toEqual({ name: "Tabs", from: "link" });
    expect(chooseName("tabs", { title: "Docs", h1: null, h1Own: null }, null, null)).toEqual({ name: "Tabs", from: "segment" });
    const dx = compileTarget({ ...sitemapTarget, titleSuffix: "^JavaScript/jQuery\\s+|\\s+API(?:\\s*\\|.*)?$" }).titleSuffix;
    expect(chooseName("dxDataGrid", { title: "JavaScript/jQuery DataGrid API | jQuery/JS Documentation v26.1", h1: "JavaScript/jQuery DataGrid API", h1Own: null }, null, dx).name).toBe("DataGrid");
    expect(chooseName("calendar2", { title: null, h1: "Calendar", h1Own: null }, null, null).name).toBe("Calendar2");
    expect(chooseName("select-v2", { title: "Virtualized Select", h1: "Virtualized Select", h1Own: null }, null, null).name).toBe("Virtualized Select");
  });

  it("humanizes segments and relates names to segments", () => {
    expect(humanizeSegment("date-picker")).toBe("Date Picker");
    expect(humanizeSegment("table_data_grid")).toBe("Table Data Grid");
    expect(humanizeSegment("AutoComplete")).toBe("AutoComplete");
    expect(humanizeSegment("forms/checkbox")).toBe("Checkbox");
    expect(relatesToSegment("Buttons", "button")).toBe(true);
    expect(relatesToSegment("Example Design System", "button")).toBe(false);
  });

  it("parses markdown docs sources (fenced headers, frontmatter, badges, admonitions)", () => {
    const arco = parseMarkdownMeta(fx("button.en-US.md"));
    expect(arco.h1).toBe("Button");
    expect(arco.metaDescription).toBe("A button is a command component to trigger an operation.");
    const ep = parseMarkdownMeta(fx("select-v2.md"));
    expect(ep.title).toBe("Virtualized Select");
    expect(ep.h1).toBe("Virtualized Select");
    expect(ep.metaDescription).toBeNull(); // only admonition text before the first sub-heading
  });

  it("bounds descriptions and rejects fragments", () => {
    expect(shortDescription("Text field")).toBeNull();
    expect(shortDescription("Building block only")).toBeNull();
    const long = `${"A sentence about buttons. ".repeat(20)}`;
    expect(shortDescription(long)!.length).toBeLessThanOrEqual(300);
  });
});

describe("generic planning and normalization", () => {
  it("applies templates; constructed URLs vs listing-proven file URLs; caps", () => {
    expect(applyTemplate("https://x.dev/{segment}/", { segment: "button" })).toBe("https://x.dev/button/");
    expect(applyTemplate("https://github.com/o/r/tree/{ref}/{dir}", { segment: "a", path: "src/c/a/index.scss", ref: "v1" })).toBe("https://github.com/o/r/tree/v1/src/c/a");
    expect(rawFileUrl("https://github.com/o/r/blob/1.2.3/docs/a.md")).toBe("https://raw.githubusercontent.com/o/r/1.2.3/docs/a.md");
    const cands = [
      { key: "a", segment: "A", matched: "components/A/README.en-US.md" },
      { key: "b", segment: "B", matched: "components/B/README.en-US.md" },
      { key: "c", segment: "C", matched: "components/C/README.en-US.md" },
    ];
    const proven = planComponents({ slug: "x", strategy: "repo-listing", include: ".", repo: { kind: "gh", name: "o/r", ref: "{latest}", docsUrlTemplate: "https://github.com/o/r/blob/{ref}/{path}" }, maxPages: 2, notes: "" }, [cands], undefined, "1.2.3");
    expect(proven.planned.map((p) => [p.docsUrl, p.constructed, p.fetchPage])).toEqual([
      ["https://github.com/o/r/blob/1.2.3/components/A/README.en-US.md", false, true],
      ["https://github.com/o/r/blob/1.2.3/components/B/README.en-US.md", false, true],
      ["https://github.com/o/r/blob/1.2.3/components/C/README.en-US.md", false, false],
    ]);
    expect(proven.planned[0]!.fetchUrl).toBe("https://raw.githubusercontent.com/o/r/1.2.3/components/A/README.en-US.md");
    const constructed = planComponents({ slug: "x", strategy: "repo-listing", include: ".", repo: { kind: "npm", name: "p", ref: "latest", docsUrlTemplate: "https://docs.example.com/{segment}" }, notes: "" }, [cands], 2);
    expect(constructed.planned.map((p) => p.constructed)).toEqual([true, true]);
    expect(constructed.truncated).toBe(1);
  });

  it("rejects site-wide and templated meta descriptions", () => {
    const page = (key: string, h1: string, d: string) => ({ segment: key, meta: meta({ title: h1, h1, metaDescription: d }) });
    const set = siteWideDescriptions([
      page("a", "Alpha", "Same site text for everyone here."),
      page("b", "Beta", "Same site text for everyone here."),
      page("c", "Gamma", "Gamma is one of many reusable elements of the kit."),
      page("d", "Delta", "Delta is one of many reusable elements of the kit."),
      page("e", "Epsilon", "Epsilon is one of many reusable elements of the kit."),
      page("f", "Zeta", "Zeta shows a short unique message."),
    ]);
    expect(set.has("same site text for everyone here.")).toBe(true);
    expect(set.has("delta is one of many reusable elements of the kit.")).toBe(true);
    expect(set.has("zeta shows a short unique message.")).toBe(false);
  });

  it("normalizes metadata-level components with honest coverage and evidence", () => {
    const index = sitemapIndex("sitemap-0.xml", "https://ds.example.com/sitemap-0.xml");
    const pageFrag = (file: string, url: string, finalUrl = url): PageFragment => ({ type: "page", stamp: stamp(url), finalUrl, status: 200, meta: parsePageMeta(fx(file), finalUrl) });
    const frags: GenericFragment[] = [
      index,
      pageFrag("page-button.html", "https://ds.example.com/components/button/"),
      pageFrag("page-date-picker.html", "https://ds.example.com/components/date-picker/"),
      pageFrag("page-text-field.html", "https://ds.example.com/components/text-field/"),
      pageFrag("page-soft404.html", "https://ds.example.com/components/tabs/"),
      pageFrag("page-shell.html", "https://ds.example.com/components/forms/text/"),
    ];
    const logs: string[] = [];
    const bundle = normalizeGeneric(frags, { systemSlug: "example-ds", target: sitemapTarget, log: (m) => logs.push(m) });
    expect(NormalizedBundle.safeParse(bundle).success).toBe(true);
    const by = new Map(bundle.components.map((x) => [x.slug, x]));
    expect([...by.keys()]).toEqual(["button", "date-picker", "display-text", "forms-text", "tabs", "text-field"]);

    const button = by.get("button")!;
    expect(button.name).toBe("Button");
    expect(button.description).toBe("Buttons let people take actions with a single tap or click.");
    expect(button.coverage.description).toBe("documented");
    expect(button.coverage.frameworks).toBe("inferred");
    for (const f of ["variants", "states", "sizes", "properties", "accessibility", "keyboard", "responsive", "tokens", "examples", "relationships"]) expect(button.coverage[f]).toBe("not-extracted");
    expect(button.canonicalType).toBe("button");
    expect(button.classification?.state).toBe("inferred");
    expect(button.frameworks).toEqual([{ slug: "react" }]);
    expect(button.evidence.map((e) => [e.field, e.extractionMethod])).toEqual([
      ["name", "adapter:generic:sitemap"],
      ["docsUrl", "adapter:generic:page"],
      ["description", "adapter:generic:page-meta"],
    ]);
    for (const e of button.evidence) {
      expect(e.confidence).toBeGreaterThanOrEqual(0.6);
      expect(e.confidence).toBeLessThanOrEqual(0.7);
    }

    // Shared boilerplate description is rejected, name still from the page.
    expect(by.get("date-picker")!.description).toBeNull();
    expect(by.get("date-picker")!.coverage.description).toBe("not-extracted");
    // Soft-404 and client-rendered shell: page metadata ignored, sitemap URL kept, humanized name.
    expect(by.get("tabs")!.name).toBe("Tabs");
    expect(by.get("tabs")!.docsUrl).toBe("https://ds.example.com/components/tabs/");
    expect(by.get("forms-text")!.name).toBe("Text");
    expect(logs.some((l) => l.includes("not-found"))).toBe(true);
    expect(logs.some((l) => l.includes("client-rendered shell"))).toBe(true);
    // Not fetched: name from the segment, evidence from the sitemap only.
    expect(by.get("display-text")!.evidence.map((e) => e.field)).toEqual(["name"]);
  });

  it("treats a re-parsed 304 (cached body) like a fresh 200", () => {
    const index = sitemapIndex("sitemap-0.xml", "https://ds.example.com/sitemap-0.xml");
    const url = "https://ds.example.com/components/button/";
    const mk = (status: number): PageFragment => ({ type: "page", stamp: stamp(url), finalUrl: url, status, meta: parsePageMeta(fx("page-button.html"), url) });
    const fresh = normalizeGeneric([index, mk(200)], { systemSlug: "example-ds", target: sitemapTarget });
    const cached = normalizeGeneric([index, mk(304)], { systemSlug: "example-ds", target: sitemapTarget });
    expect(JSON.stringify(cached)).toBe(JSON.stringify(fresh));
    expect(cached.components.find((x) => x.slug === "button")!.description).toBeTruthy();
  });

  it("drops constructed docs URLs that no page confirmed", () => {
    const t: GenericTarget = { slug: "x", strategy: "repo-listing", include: "^c/([a-z]+)/index\\.js$", repo: { kind: "npm", name: "p", ref: "1.0.0", docsUrlTemplate: "https://docs.example.com/{segment}/" }, notes: "" };
    const index: IndexFragment = { type: "index", source: "repo-listing", stamp: stamp("https://data.jsdelivr.com/x"), values: ["c/alpha/index.js", "c/beta/index.js", "README.md"], repo: { kind: "npm", name: "p", ref: "1.0.0" } };
    const ok: PageFragment = { type: "page", stamp: stamp("https://docs.example.com/alpha/"), finalUrl: "https://docs.example.com/alpha/", status: 200, meta: meta({ title: "Alpha | Docs", h1: "Alpha" }) };
    const bundle = normalizeGeneric([index, ok], { systemSlug: "x", target: t });
    expect(bundle.components.map((c) => [c.slug, c.docsUrl])).toEqual([
      ["alpha", "https://docs.example.com/alpha/"],
      ["beta", null],
    ]);
    expect(bundle.components[1]!.evidence[0]!.sourceUrl).toBe("https://cdn.jsdelivr.net/npm/p@1.0.0/c/beta/index.js");
  });

  it("validates: no components is an error, documentation sections and duplicate names are warnings", () => {
    const empty = validateGeneric({ systemSlug: "x", components: [], tokenSets: [], patterns: [], facts: null }, sitemapTarget);
    expect(empty).toEqual([expect.objectContaining({ code: "NO_COMPONENTS", severity: "error", entityKind: "bundle" })]);
    const comp = (slug: string, name: string) => ({ slug, name, aliases: [], docsUrl: `https://x.dev/${slug}`, lifecycle: "unknown" as const, frameworks: [], variants: [], states: [], properties: [], examples: [], relationships: [], tokenUsages: [], coverage: {}, evidence: [] });
    const issues = validateGeneric({ systemSlug: "x", components: [comp("a", "Colors"), comp("b", "Pie chart"), comp("c", "Pie chart")], tokenSets: [], patterns: [], facts: null } as never, sitemapTarget);
    expect(issues.map((i) => i.code).sort()).toEqual(["DUPLICATE", "DUPLICATE", "SUSPICIOUS", "TOO_FEW_COMPONENTS"]);
  });
});

describe("generic adapter end-to-end (mocked network)", () => {
  const routes: Record<string, { body: string; type: string; status?: number }> = {
    "https://ds.example.com/robots.txt": { body: "User-agent: *\nDisallow: /private/\n", type: "text/plain" },
    "https://ds.example.com/sitemap-index.xml": { body: fx("sitemap-index.xml"), type: "application/xml" },
    "https://ds.example.com/sitemap-0.xml": { body: fx("sitemap-0.xml"), type: "application/xml" },
    "https://ds.example.com/sitemap-blog.xml": { body: `<?xml version="1.0"?><urlset><url><loc>https://ds.example.com/blog/a/</loc></url></urlset>`, type: "application/xml" },
    "https://ds.example.com/components/button/": { body: fx("page-button.html"), type: "text/html" },
    "https://ds.example.com/components/date-picker/": { body: fx("page-date-picker.html"), type: "text/html" },
    "https://ds.example.com/components/text-field/": { body: fx("page-text-field.html"), type: "text/html" },
  };
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const r = routes[url];
    return new Response(r?.body ?? "not found", { status: r ? (r.status ?? 200) : 404, headers: { "content-type": r?.type ?? "text/html" } });
  }) as typeof fetch;

  it("discovers, fetches, parses and normalizes from a sitemap index", async () => {
    const adapter = createGenericAdapter([{ ...sitemapTarget, maxPages: 3 }]);
    expect(adapter.systems).toEqual(["example-ds"]);
    expect(adapter.version).toBe(ADAPTER_VERSION); // parser code version only, never a target fingerprint
    const http = new PoliteFetcher({ fetchImpl, cacheDir: null, hostDelayMs: 0 });
    const log = { info: () => {}, warn: () => {}, error: () => {} };
    const ctx: AdapterContext = { systemSlug: "example-ds", http, log, runStartedAt: T0 };
    const docs = await adapter.discover(ctx);
    expect(docs.map((d) => [d.docKind, d.url])).toEqual([
      ["generic-sitemap", "https://ds.example.com/sitemap-0.xml"],
      ["generic-page", "https://ds.example.com/components/button/"],
      ["generic-page", "https://ds.example.com/components/date-picker/"],
      ["generic-page", "https://ds.example.com/components/display/text/"],
    ]);
    const frags: ParsedFragment[] = [];
    for (const doc of docs) {
      const result = await adapter.fetch!(ctx, doc, {});
      if (!result.ok || result.body === null) continue;
      const out = await adapter.parse(ctx, { doc, result });
      if (out) frags.push(...(Array.isArray(out) ? out : [out]));
    }
    const bundle = await adapter.normalize(ctx, frags);
    expect(NormalizedBundle.safeParse(bundle).success).toBe(true);
    expect(bundle.components.map((c) => c.name)).toEqual(["Button", "Date picker", "Text", "Text", "Tabs", "Text Field"]);
    const issues = adapter.validate!(ctx, bundle);
    expect(issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(issues.some((i) => i.code === "DUPLICATE")).toBe(true); // display/text and forms/text are both "Text"
    // Re-normalizing the same fragments is deterministic (idempotent publish).
    expect(JSON.stringify(await adapter.normalize(ctx, [...frags].reverse()))).toBe(JSON.stringify(bundle));
  });

  it("fails discovery when the index source is unreachable or robots-disallowed", async () => {
    const http = new PoliteFetcher({ fetchImpl, cacheDir: null, hostDelayMs: 0 });
    const ctx: AdapterContext = { systemSlug: "example-ds", http, log: { info: () => {}, warn: () => {}, error: () => {} }, runStartedAt: T0 };
    const missing = createGenericAdapter([{ ...sitemapTarget, sitemapUrl: "https://ds.example.com/missing.xml" }]);
    await expect(missing.discover(ctx)).rejects.toThrow(/no sitemap could be fetched/);
    const blocked = createGenericAdapter([{ ...sitemapTarget, strategy: "nav", navUrl: "https://ds.example.com/private/index.html" }]);
    await expect(blocked.discover(ctx)).rejects.toThrow(/robots\.txt disallows/);
  });
});

describe("generic versioning: parse output is target-independent", () => {
  const http = new PoliteFetcher({ fetchImpl: (async () => new Response("")) as typeof fetch, cacheDir: null, hostDelayMs: 0 });
  const ctxFor = (slug: string): AdapterContext => ({ systemSlug: slug, http, log: { info: () => {}, warn: () => {}, error: () => {} }, runStartedAt: T0 });
  const result = (url: string, body: string, contentType = "text/html") => ({
    url, finalUrl: url, status: 200, ok: true, notModified: false, fromCache: false, contentType, etag: null, lastModified: null, body, hash: "h", byteSize: body.length, fetchedAt: T0, attempts: 1, blockedByRobots: false, error: null,
  });
  const navTarget: GenericTarget = { slug: "tree-ds", strategy: "nav", navUrl: "https://tree.example.com/docs/", navSelector: "li:has(> .title:contains('Components')) > ul", include: "^https://tree\\.example\\.com/docs/([a-z]+)\\.html$", notes: "test" };

  it("keeps one adapter version whatever the targets are; fingerprints are per target", () => {
    const a = createGenericAdapter([sitemapTarget, navTarget]);
    const b = createGenericAdapter([{ ...sitemapTarget, exclude: ["/button/$"] }, navTarget, { ...navTarget, slug: "other" }]);
    expect(a.version).toBe(b.version);
    expect(targetFingerprint(sitemapTarget)).not.toBe(targetFingerprint({ ...sitemapTarget, exclude: ["/button/$"] }));
    expect(targetFingerprint(navTarget)).toBe(targetFingerprint({ ...navTarget }));
  });

  it("parses every document kind identically under different targets", async () => {
    const t2: GenericTarget = { ...navTarget, navSelector: "#nope", include: "^x$", titleSuffix: ["a", "b"], exclude: ["y"], preferDoc: "z" };
    const s2: GenericTarget = { ...sitemapTarget, include: "^x$", exclude: [] };
    const docs = [
      { doc: { url: "https://tree.example.com/docs/", docKind: "generic-nav", source: { kind: "docs", url: "https://tree.example.com/" } }, body: fx("nav-tree.html"), slug: "tree-ds", targets: [navTarget, t2] },
      { doc: { url: "https://ds.example.com/sitemap-0.xml", docKind: "generic-sitemap", source: { kind: "sitemap", url: "https://ds.example.com/sitemap-0.xml" } }, body: fx("sitemap-0.xml"), slug: "example-ds", targets: [sitemapTarget, s2] },
      { doc: { url: "https://ds.example.com/components/button/", docKind: "generic-page", source: { kind: "docs", url: "https://ds.example.com/" }, meta: { key: "button", segment: "button" } }, body: fx("page-button.html"), slug: "example-ds", targets: [sitemapTarget, s2] },
    ];
    for (const d of docs) {
      const outs = await Promise.all(d.targets.map((t) => createGenericAdapter([t]).parse(ctxFor(d.slug), { doc: d.doc, result: result(d.doc.url, d.body) })));
      expect(JSON.stringify(outs[0])).toBe(JSON.stringify(outs[1]));
    }
    // A different discover-time key/segment (doc meta) does not change a page fragment either.
    const page = docs[2]!;
    const other = await createGenericAdapter([sitemapTarget]).parse(ctxFor("example-ds"), { doc: { ...page.doc, meta: { key: "x", segment: "y" } }, result: result(page.doc.url, page.body) });
    const first = await createGenericAdapter([sitemapTarget]).parse(ctxFor("example-ds"), { doc: page.doc, result: result(page.doc.url, page.body) });
    expect(JSON.stringify(other)).toBe(JSON.stringify(first));
  });

  it("re-derives a system's components from cached fragments when only its target changes", () => {
    const frags: GenericFragment[] = [sitemapIndex("sitemap-0.xml", "https://ds.example.com/sitemap-0.xml")];
    const before = normalizeGeneric(frags, { systemSlug: "example-ds", target: sitemapTarget });
    const edited = normalizeGeneric(frags, { systemSlug: "example-ds", target: { ...sitemapTarget, exclude: [...sitemapTarget.exclude!, "/date-picker/$"] } });
    expect(before.components.map((c) => c.slug)).toContain("date-picker");
    expect(edited.components.map((c) => c.slug)).not.toContain("date-picker");
    expect(edited.components.length).toBe(before.components.length - 1);
  });
});

describe("generic nav outline", () => {
  const base = "https://tree.example.com/docs/";
  it("keeps links, their ancestors and short labels; drops prose, scripts, media, comments and handlers", () => {
    const html = fx("nav-tree.html");
    const o = navOutline(html);
    expect(o).not.toMatch(/<script|<style|<img|<svg|onclick|style=|a comment|however long it gets/);
    expect(o).toMatch(/<main>Getting started Long introduction prose[^<]{0,81}<\/main>/); // link-less child: a short label only
    expect(o).toContain('<div class="title">Components</div>');
    expect(o.length).toBeLessThan(html.length);
  });

  it("returns the same links as the full page for ancestry, attribute and :has()/:contains() selectors", () => {
    const html = fx("nav-tree.html");
    const o = navOutline(html);
    for (const sel of [undefined, "aside", "li:has(> .title:contains('Components')) > ul", 'tree-item[data-depth="1"], tree-item[data-label="Overview"]', 'tree-item[data-path^="Grids & Lists>"]', "header"]) {
      expect(extractNavLinks(o, base, sel)).toEqual(extractNavLinks(html, base, sel));
    }
    expect(extractNavLinks(o, base, "li:has(> .title:contains('Components')) > ul").map((l) => [l.value, l.text])).toEqual([
      ["https://tree.example.com/docs/accordion.html", "Accordion"],
      ["https://tree.example.com/docs/button.html", "Button"],
    ]);
    expect(extractNavLinks(o, base, 'tree-item[data-depth="1"], tree-item[data-label="Overview"]').map((l) => l.value)).toEqual([
      "https://tree.example.com/docs/inputs/checkbox",
      "https://tree.example.com/docs/grid/grid",
    ]);
  });

  it("derives nav candidates in normalize with the target's selector", () => {
    const t: GenericTarget = { slug: "tree-ds", strategy: "nav", navUrl: base, navSelector: "li:has(> .title:contains('Components')) > ul", include: "^https://tree\\.example\\.com/docs/([a-z]+)\\.html$", notes: "t" };
    const frag: IndexFragment = { type: "index", source: "nav", stamp: stamp(base), outline: navOutline(fx("nav-tree.html")), base };
    expect(indexCandidates(frag, t).map((c) => c.key)).toEqual(["accordion", "button"]);
    expect(indexCandidates(frag, { ...t, navSelector: "aside" }).map((c) => c.key)).toEqual(["accordion", "button", "install", "theming"]);
  });
});

describe("generic quality fixes", () => {
  it("parses MDX 'export const meta' title/description (no '# ' heading) and confirms the docs URL", () => {
    const m = parseMarkdownMeta(fx("paste-alert-dialog.mdx"));
    expect(m.title).toBe("Alert Dialog - Components");
    expect(m.h1).toBeNull();
    expect(m.metaDescription).toBe("An alert dialog displays content over the main page and blocks any interaction with the page.");
    expect(parseMdxExportMeta("export const meta = { title: \"It\\'s \\\"X\\\"\", description: `Plain template` };")).toEqual({ title: "It's \"X\"", description: "Plain template" });
    expect(parseMdxExportMeta("export const meta = {\n  title: `A ${b}`,\n  seo: {\n    title: 'Nested',\n  },\n};\n")).toBeNull(); // interpolation and nested keys are not read
    expect(parseMdxExportMeta("# Title\n")).toBeNull();
    expect(chooseName("alert-dialog", m, null, null)).toEqual({ name: "Alert Dialog", from: "title" });

    const t: GenericTarget = {
      slug: "paste",
      strategy: "repo-listing",
      include: "^([a-z0-9-]+)/package\\.json$",
      repo: { kind: "npm", name: "@twilio-paste/core", ref: "21.5.0", docsUrlTemplate: "https://github.com/twilio-labs/paste/blob/main/packages/paste-website/src/pages/components/{segment}/index.mdx" },
      notes: "t",
    };
    const raw = "https://raw.githubusercontent.com/twilio-labs/paste/main/packages/paste-website/src/pages/components/alert-dialog/index.mdx";
    const bundle = normalizeGeneric(
      [
        { type: "index", source: "repo-listing", stamp: stamp("https://data.jsdelivr.com/v1/packages/npm/@twilio-paste/core@21.5.0?structure=flat"), values: ["alert-dialog/package.json"], repo: { kind: "npm", name: "@twilio-paste/core", ref: "21.5.0" } },
        { type: "page", stamp: stamp(raw), finalUrl: raw, status: 200, meta: m },
      ],
      { systemSlug: "paste", target: t },
    );
    const c = bundle.components[0]!;
    expect([c.name, c.docsUrl, c.description]).toEqual(["Alert Dialog", "https://github.com/twilio-labs/paste/blob/main/packages/paste-website/src/pages/components/alert-dialog/index.mdx", m.metaDescription]);
    expect(c.evidence.map((e) => [e.field, e.location])).toEqual([
      ["name", "alert-dialog/package.json"],
      ["docsUrl", "title"],
      ["description", 'meta[name="description"]'],
    ]);
  });

  it("keeps tab/sub-pages of one component under its plain key, preferring the overview page", () => {
    const t: GenericTarget = {
      slug: "tabs-ds",
      strategy: "sitemap",
      include: "^https://ds\\.example\\.com/latest/components/(?:[a-z0-9-]+/){0,2}([a-z0-9-]+)/[a-z0-9-]+-[A-Za-z0-9]{8}$",
      preferDoc: "/overview-[A-Za-z0-9]{8}$",
      notes: "t",
    };
    const url = "https://ds.example.com/sitemap.xml";
    const cands = sitemapCandidates(fx("sitemap-tabs.xml"), url, compileTarget(t), t);
    expect(cands.map((c) => [c.key, c.matched.replace("https://ds.example.com/latest/components/", "")])).toEqual([
      ["button", "button/overview-Ab12Cd34"],
      ["cell-items", "cells/cell-items/web-Q1w2E3r4"], // no overview tab: shortest URL
      ["display-text", "display/text/web-BBBBbbbb"], // different parents stay distinct components
      ["forms-text", "forms/text/web-AAAAaaaa"],
    ]);
    const noPrefer = sitemapCandidates(fx("sitemap-tabs.xml"), url, compileTarget({ ...t, preferDoc: undefined }));
    expect(noPrefer.find((c) => c.key === "button")!.matched).toBe("https://ds.example.com/latest/components/button/web-eI5EFTLO");
  });

  it("keeps a trailing 'Component' when the segment itself ends in -component", () => {
    expect(stripComponentWord("Details Component", "details-component")).toBe("Details Component");
    expect(stripComponentWord("Details Component", "details")).toBe("Details");
    expect(stripComponentWord("Button Component", "button")).toBe("Button");
    expect(stripComponentWord("Rating Web Component", "rating-web-component")).toBe("Rating Web Component");
    const suffix = compileTarget({ ...sitemapTarget, titleSuffix: "\\s*\\|\\s*Mozilla Protocol$|\\s+full view$" }).titleSuffix;
    expect(chooseName("details-component", { title: "Details Component | Mozilla Protocol", h1: "Details Component full view", h1Own: null }, null, suffix).name).toBe("Details Component");
    expect(chooseName("details", { title: "Details | Mozilla Protocol", h1: "Details full view", h1Own: null }, null, suffix).name).toBe("Details");
  });

  it("takes the title's casing when the h1 equals the title case-insensitively", () => {
    expect(chooseName("form-group", { title: "Form Group | Cedar Design System | REI Co-op", h1: "form group", h1Own: null }, null, null)).toEqual({ name: "Form Group", from: "h1" });
    expect(chooseName("button", { title: "button", h1: "Button", h1Own: null }, null, null).name).toBe("button");
    expect(chooseName("button", { title: "BUTTON | Docs", h1: "Button", h1Own: null }, null, null).name).toBe("Button"); // all-caps titles never win
  });

  it("masks each page's own name so templated boilerplate counts as site-wide (dartdoc)", () => {
    const dart = (cls: string, h1: string) => ({ segment: cls, meta: meta({ h1, metaDescription: `API docs for the ${cls} class from the cupertino_ui library, for the Dart programming language.` }) });
    const pages = [dart("CupertinoButton", "CupertinoButton class"), dart("CupertinoSwitch", "CupertinoSwitch class"), dart("CupertinoRadio", "CupertinoRadio<T> class"), dart("CupertinoSlidingSegmentedControl", "CupertinoSlidingSegmentedControl<T extends Object> class")];
    const set = siteWideDescriptions(pages);
    expect(set.size).toBe(4);
    expect(maskName(pages[2]!.meta.metaDescription!, "CupertinoRadio", pages[2]!.meta)).toBe(maskName(pages[0]!.meta.metaDescription!, "CupertinoButton", pages[0]!.meta));
    // Two pages sharing a template are not enough; distinct descriptions are kept.
    expect(siteWideDescriptions(pages.slice(0, 2)).size).toBe(0);
    expect(siteWideDescriptions([{ segment: "date-picker", meta: meta({ metaDescription: "Date pickers let users select a date." }) }, { segment: "tabs", meta: meta({ metaDescription: "Tabs organize content across views." }) }, { segment: "chip", meta: meta({ metaDescription: "Chips represent small entities." }) }]).size).toBe(0);
  });

  it("strips several title decorations in order (Ignite UI titles and headings)", () => {
    const t: GenericTarget = { ...sitemapTarget, titleSuffix: ["\\s*\\|.*$", "^Angular\\s+", "\\s+Overview$", "\\s+(?:Component|Directive)$"] };
    const sfx = compileTarget(t).titleSuffix;
    expect(sfx).toHaveLength(4);
    expect(stripDecoration("Angular Data Grid Component Overview", sfx)).toBe("Data Grid");
    expect(stripDecoration("Angular Area Chart | Data Visualization | Infragistics | Ignite UI for Angular", sfx)).toBe("Area Chart");
    expect(chooseName("grid", { title: "Angular Data Grid | Build Fast Angular Tables | Infragistics | Ignite UI for Angular", h1: "Angular Data Grid Component Overview", h1Own: null }, null, sfx).name).toBe("Data Grid");
    expect(chooseName("area-chart", { title: "Angular Area Chart | Data Visualization | Infragistics | Ignite UI for Angular", h1: "Angular Area Chart", h1Own: null }, null, sfx).name).toBe("Area Chart");
    expect(chooseName("autocomplete", { title: "Angular Autocomplete Component – Ignite UI for Angular - MIT license | Ignite UI for Angular", h1: "Angular Autocomplete Directive Overview", h1Own: null }, null, sfx).name).toBe("Autocomplete");
    // A single string keeps working (one global pattern).
    expect(compileTarget(sitemapTarget).titleSuffix).toHaveLength(1);
  });

  it("supports {segmentLower} and records verified-pattern shell docs URLs as unconfirmed", () => {
    expect(applyTemplate("https://sb.example.com/?path=/docs/components-{segmentLower}--docs", { segment: "ButtonGroup" })).toBe("https://sb.example.com/?path=/docs/components-buttongroup--docs");
    const t: GenericTarget = {
      slug: "sb",
      strategy: "repo-listing",
      include: "^stories/([A-Z][A-Za-z]+)\\.stories\\.js$",
      repo: { kind: "gh", name: "o/r", ref: "1.0.0" },
      docsUrlTemplate: "https://sb.example.com/?path=/docs/components-{segmentLower}--docs",
      acceptShellDocs: true,
      fetchPages: false,
      notes: "t",
    };
    const index: IndexFragment = { type: "index", source: "repo-listing", stamp: stamp("https://data.jsdelivr.com/x"), values: ["stories/ButtonGroup.stories.js"], repo: { kind: "gh", name: "o/r", ref: "1.0.0" } };
    const bundle = normalizeGeneric([index], { systemSlug: "sb", target: t });
    expect(NormalizedBundle.safeParse(bundle).success).toBe(true);
    const c = bundle.components[0]!;
    expect(c.docsUrl).toBe("https://sb.example.com/?path=/docs/components-buttongroup--docs");
    expect(c.coverage.docsUrl).toBe("inferred");
    expect(c.classification!.confidence).toBeLessThanOrEqual(0.6);
    const ev = c.evidence.find((e) => e.field === "docsUrl")!;
    expect([ev.state, ev.confidence, ev.excerpt?.startsWith("docs URL not confirmed by static fetch")]).toEqual(["unverified", 0.35, true]);
    expect(validateGeneric(bundle, t).map((i) => i.code)).toContain("UNCONFIRMED_DOCS_URL");
    // Without the flag the constructed URL is dropped, as before.
    expect(normalizeGeneric([index], { systemSlug: "sb", target: { ...t, acceptShellDocs: false } }).components[0]!.docsUrl).toBeNull();
    // A planned page fetch that produced no page (HTTP error) is never accepted.
    expect(normalizeGeneric([index], { systemSlug: "sb", target: { ...t, fetchPages: true } }).components[0]!.docsUrl).toBeNull();
    // A fetched shell page (200, no h1, generic title) is accepted as unconfirmed.
    const shell: PageFragment = { type: "page", stamp: stamp(c.docsUrl!), finalUrl: c.docsUrl!, status: 200, meta: meta({ title: "Storybook" }) };
    const withShell = normalizeGeneric([index, shell], { systemSlug: "sb", target: { ...t, fetchPages: true } }).components[0]!;
    expect([withShell.docsUrl, withShell.coverage.docsUrl]).toEqual([c.docsUrl, "inferred"]);
  });
});

describe("generic targets (workstream configs)", () => {
  it("every target is well-formed: unique slug, compilable regexes with a capture group, strategy inputs present", () => {
    const slugs = new Set<string>();
    for (const t of GENERIC_TARGETS) {
      expect(slugs.has(t.slug), `duplicate target ${t.slug}`).toBe(false);
      slugs.add(t.slug);
      const c = compileTarget(t);
      expect(/\((?!\?)/.test(t.include), `${t.slug} include needs a capture group`).toBe(true);
      expect(c.exclude.length).toBe((t.exclude ?? []).length);
      if (t.strategy === "nav") expect(t.navUrl, t.slug).toBeTruthy();
      if (t.strategy === "repo-listing") expect(t.repo, t.slug).toBeTruthy();
      if (t.strategy === "sitemap") expect(t.sitemapUrl ?? targetOrigin(t), t.slug).toBeTruthy();
      expect(t.notes.length, t.slug).toBeGreaterThan(20);
    }
  });
});
