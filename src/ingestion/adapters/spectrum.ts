/**
 * "spectrum" source adapter: Adobe Spectrum (adobe-spectrum), React Spectrum S2 (react-spectrum)
 * and React Aria Components (react-aria). One adapter, three bundles (switch on ctx.systemSlug).
 *
 * Sources (first-party; machine-readable first; static parsing only; versions pinned at run time):
 *  adobe-spectrum
 *   - @adobe/spectrum-tokens@<npm latest> src/*.json via jsDelivr (file list from the package's own
 *     manifest.json): color themes (light/dark/wireframe) and platform scales (desktop/mobile).
 *   - @adobe/spectrum-design-data@<latest> components/*.json (Adobe's component schemas: options,
 *     states, implementations, ARIA role, WCAG, token bindings), listed via data.jsdelivr.com.
 *   - @spectrum-css/tokens@<latest> dist/css/index.css, only to verify --spectrum-* custom properties.
 *   - spectrum.adobe.com (robots: allow all): /query-index.json + statically served .plain.html
 *     component pages and fragments (states support, keyboard + WCAG tables, component options JSON).
 *     Why the guidelines site for the component catalog: it is the published Spectrum 2 catalog and,
 *     unlike the Spectrum CSS packages, documents the design component (not one CSS implementation).
 *  react-spectrum / react-aria
 *   - npm latest of @react-spectrum/s2 / react-aria-components; jsDelivr package listing (export modules).
 *   - react-spectrum.adobe.com / react-aria.adobe.com llms.txt + per-page markdown (props tables).
 *   - adobe/react-spectrum page MDX at the package release tag (raw.githubusercontent.com):
 *     lifecycle (`version`), relatedPages; component source files verified at the same tag.
 *   - react-spectrum only: spectrum.adobe.com /web/rsp/ guideline pages (states + keyboard tables).
 * The adobe/react-spectrum repo is too large for jsDelivr listings; component names come from the
 * npm listing intersected with the docs llms.txt index and files are fetched by known paths.
 */
import type { NormalizedBundle, ValidationIssue } from "@/lib/contracts";
import { npmFileUrl, npmLatest, npmListingUrl, type FetchResult } from "../http";
import type { AdapterContext, DiscoveredDocument, FetchedDocument, ParsedFragment, SourceAdapter } from "../types";
import {
  ADAPTER_ID,
  DOC,
  DOCS_MDX_DIR,
  PKG,
  SITE_INDEX_URL,
  SITE_ORIGIN,
  SITE_PRINCIPLES_PATH,
  SRC_DIR,
  SYSTEMS,
  monorepoBlob,
  monorepoRaw,
  normKey,
  releaseTag,
  sitePlainUrl,
  siteUrl,
  type SpectrumSystem,
} from "./spectrum/constants";
import { hookPageOf, isComponentPage, parseDocsMd, parseLlms, parseMdxMeta } from "./spectrum/docs-md";
import type { ReactSystem, SpectrumFragment } from "./spectrum/fragments";
import { normalizeDesign } from "./spectrum/normalize-design";
import { SYSTEM_ORIGIN, SYSTEM_PKG, compactPage, normalizeReact } from "./spectrum/normalize-react";
import { parseComponentSchema } from "./spectrum/schema";
import type { Ev } from "./spectrum/shared";
import { componentLinks, parseA11yFragment, parsePrinciples, parseSiteData, parseSiteIndex, parseSitePage, parseStatesFragment, siteComponents } from "./spectrum/site";
import { declaredCustomProperties, parseTokenFile } from "./spectrum/tokens";
import { validateSpectrumBundle } from "./spectrum/validate";

/** Site fragment sections parsed for component data. */
const SITE_SECTIONS = ["states", "accessibility"] as const;
/** Docs guide pages ingested as patterns. */
const GUIDE_PAGES = ["collections", "dnd", "forms", "selection"];
/** Global token files always ingested (also in limited runs). */
const GLOBAL_TOKEN_FILES = ["color-aliases", "color-palette", "icons", "layout", "layout-component", "semantic-color-palette", "typography"];

/* ------------------------------ run-scoped cache ------------------------------ */

const prefetched = new Map<string, { run: string; result: FetchResult }>();
function remember(ctx: AdapterContext, url: string, result: FetchResult) {
  for (const [k, v] of prefetched) if (v.run !== ctx.runStartedAt) prefetched.delete(k);
  prefetched.set(url, { run: ctx.runStartedAt, result });
}
async function getText(ctx: AdapterContext, url: string): Promise<{ text: string | null; res: FetchResult }> {
  const res = await ctx.http.get(url, { signal: ctx.signal });
  if (res.ok && res.body !== null) remember(ctx, url, res);
  return { text: res.ok ? res.body : null, res };
}

const npmPage = (pkg: string) => `https://www.npmjs.com/package/${pkg}`;
const pkgSource = (pkg: string) => ({ kind: "package", url: npmPage(pkg), label: pkg });

interface Pinned {
  pkg: string;
  version: string;
  publishedAt: string | null;
  license: string | null;
}

async function pin(ctx: AdapterContext, pkg: string): Promise<Pinned | null> {
  const r = await npmLatest(ctx.http, pkg);
  if (!r.ok || !r.latest) {
    ctx.log.warn(`npm latest unavailable for ${pkg}`, { status: r.status });
    return null;
  }
  return { pkg, version: r.latest, publishedAt: r.publishedAt, license: r.license };
}

const npmVersionDoc = (p: Pinned): DiscoveredDocument => ({
  url: `https://registry.npmjs.org/${p.pkg.replace("/", "%2F")}/${p.version}`,
  docKind: DOC.npm,
  source: pkgSource(p.pkg),
  evidenceUrl: `${npmPage(p.pkg)}/v/${p.version}`,
  title: `${p.pkg}@${p.version}`,
  meta: { pkg: p.pkg, version: p.version, publishedAt: p.publishedAt, license: p.license },
  priority: 1,
});

/** Export module names in a jsDelivr flat listing (S2: exports/*.ts; RAC: dist/exports/*.mjs). */
export function exportsFromListing(files: string[]): { exports: string[]; srcFiles: string[] } {
  const ex = new Set<string>();
  const src = new Set<string>();
  for (const f0 of files) {
    const f = f0.replace(/^\//, "");
    const m = /^(?:exports\/([A-Za-z0-9_]+)\.ts|dist\/exports\/([A-Za-z0-9_]+)\.mjs)$/.exec(f);
    if (m) ex.add((m[1] ?? m[2])!);
    const s = /^src\/([A-Z][A-Za-z0-9]+)\.tsx$/.exec(f);
    if (s) src.add(s[1]!);
  }
  ex.delete("index");
  return { exports: [...ex].sort(), srcFiles: [...src].sort() };
}

function listingFiles(text: string | null): string[] {
  if (!text) return [];
  try {
    const d = JSON.parse(text) as { files?: { name?: unknown }[] };
    return (d.files ?? []).map((f) => (typeof f.name === "string" ? f.name : "")).filter(Boolean);
  } catch {
    return [];
  }
}

/* --------------------------------- discover --------------------------------- */

async function discoverSite(ctx: AdapterContext, opts: { rspOnly: boolean; keep?: (title: string, slug: string) => boolean; limit?: number }): Promise<DiscoveredDocument[]> {
  const docs: DiscoveredDocument[] = [];
  const idx = await getText(ctx, SITE_INDEX_URL);
  if (!idx.text) {
    ctx.log.error("spectrum.adobe.com query-index.json unavailable", { status: idx.res.status, error: idx.res.error });
    return docs;
  }
  const parsed = parseSiteIndex(idx.text);
  if (parsed.total !== null && parsed.total > parsed.rows.length) ctx.log.warn(`query-index lists ${parsed.total} pages but returned ${parsed.rows.length}`);
  const source = { kind: "docs-site", url: `${SITE_ORIGIN}/`, label: "spectrum.adobe.com (Spectrum 2 guidelines)" };
  docs.push({ url: SITE_INDEX_URL, docKind: DOC.siteIndex, source, evidenceUrl: `${SITE_ORIGIN}/query-index.json`, title: "spectrum.adobe.com query index", meta: {}, priority: 0 });
  let comps = siteComponents(parsed.rows);
  if (opts.rspOnly) comps = comps.filter((c) => c.pages.some((p) => p.impl === "rsp"));
  if (opts.keep) comps = comps.filter((c) => opts.keep!(c.title, c.slug));
  if (opts.limit) comps = comps.slice(0, opts.limit);
  comps.forEach((c, i) => {
    const pr = 20 + i;
    const pages = c.pages.filter((p) => p.impl !== "design-only" && (!opts.rspOnly || p.impl === "rsp"));
    for (const p of pages) {
      docs.push({ url: sitePlainUrl(p.path), docKind: DOC.sitePage, source, evidenceUrl: siteUrl(p.path), title: `${c.title} (${p.impl})`, meta: { slug: c.slug, impl: p.impl, path: p.path }, priority: pr });
    }
    const humanPage = (pages[0] ?? c.pages[0])!.path;
    for (const f of c.fragments) {
      const section = f.split("/").pop()!;
      if (!(SITE_SECTIONS as readonly string[]).includes(section)) continue;
      docs.push({ url: sitePlainUrl(f), docKind: DOC.siteFragment, source, evidenceUrl: siteUrl(humanPage), title: `${c.title}: ${section}`, meta: { slug: c.slug, section, path: f }, priority: pr });
    }
  });
  return docs;
}

async function discoverDesign(ctx: AdapterContext): Promise<DiscoveredDocument[]> {
  const docs: DiscoveredDocument[] = [];
  const [tok, dd, css] = await Promise.all([pin(ctx, PKG.tokens), pin(ctx, PKG.designData), pin(ctx, PKG.cssTokens)]);
  const siteDocs = await discoverSite(ctx, { rspOnly: false, limit: ctx.limit });
  docs.push(...siteDocs);
  const siteSlugs = new Set(siteDocs.map((d) => d.meta?.slug as string | undefined).filter((s): s is string => !!s));
  if (tok) {
    docs.push(npmVersionDoc(tok));
    const manUrl = npmFileUrl(PKG.tokens, tok.version, "manifest.json");
    const man = await getText(ctx, manUrl);
    let files: string[] = [];
    try {
      const arr = JSON.parse(man.text ?? "[]") as unknown;
      files = Array.isArray(arr) ? arr.filter((f): f is string => typeof f === "string" && /^src\/[a-z0-9-]+\.json$/.test(f)).sort() : [];
    } catch {
      files = [];
    }
    if (!files.length) ctx.log.error(`${PKG.tokens}@${tok.version} manifest.json unavailable or empty; no tokens`, { status: man.res.status });
    if (ctx.limit) files = files.filter((f) => GLOBAL_TOKEN_FILES.includes(f.slice(4, -5)) || siteSlugs.has(f.slice(4, -5)));
    for (const f of files) {
      const url = npmFileUrl(PKG.tokens, tok.version, f);
      docs.push({ url, docKind: DOC.tokens, source: pkgSource(PKG.tokens), evidenceUrl: url, title: `${PKG.tokens} ${f}`, meta: { file: f, version: tok.version }, priority: 5 });
    }
  }
  if (css) {
    const url = npmFileUrl(PKG.cssTokens, css.version, "dist/css/index.css");
    docs.push({ url, docKind: DOC.cssVars, source: pkgSource(PKG.cssTokens), evidenceUrl: url, title: `${PKG.cssTokens} dist/css/index.css`, meta: { file: "dist/css/index.css", version: css.version }, priority: 4 });
  }
  if (dd) {
    const listUrl = npmListingUrl(PKG.designData, dd.version);
    const list = await getText(ctx, listUrl);
    let names = listingFiles(list.text)
      .map((f) => /^\/?components\/([a-z0-9-]+)\.json$/.exec(f)?.[1])
      .filter((n): n is string => !!n)
      .sort();
    if (!names.length) ctx.log.warn(`${PKG.designData}@${dd.version} listing has no components/*.json`, { status: list.res.status });
    if (ctx.limit) names = names.filter((n) => siteSlugs.has(n));
    names.forEach((n, i) => {
      const file = `components/${n}.json`;
      const url = npmFileUrl(PKG.designData, dd.version, file);
      docs.push({ url, docKind: DOC.schema, source: pkgSource(PKG.designData), evidenceUrl: url, title: `${PKG.designData} ${file}`, meta: { name: n, file, version: dd.version }, priority: 20 + i });
    });
  }
  docs.push({
    url: sitePlainUrl(SITE_PRINCIPLES_PATH),
    docKind: DOC.sitePrinciples,
    source: { kind: "docs-site", url: `${SITE_ORIGIN}/`, label: "spectrum.adobe.com (Spectrum 2 guidelines)" },
    evidenceUrl: siteUrl(SITE_PRINCIPLES_PATH),
    title: "Spectrum principles",
    meta: { path: SITE_PRINCIPLES_PATH },
    priority: 2,
  });
  return docs;
}

async function discoverReact(ctx: AdapterContext, system: ReactSystem): Promise<DiscoveredDocument[]> {
  const docs: DiscoveredDocument[] = [];
  const pkg = SYSTEM_PKG[system];
  const origin = SYSTEM_ORIGIN[system];
  const p = await pin(ctx, pkg);
  if (!p) {
    ctx.log.error(`${pkg}: npm latest unavailable; cannot pin docs sources`);
    return docs;
  }
  docs.push(npmVersionDoc(p));
  const listUrl = npmListingUrl(pkg, p.version);
  const [list, llms] = await Promise.all([getText(ctx, listUrl), getText(ctx, `${origin}/llms.txt`)]);
  const { exports } = exportsFromListing(listingFiles(list.text));
  if (!exports.length) ctx.log.error(`${pkg}@${p.version} listing has no export modules`, { status: list.res.status });
  docs.push({ url: listUrl, docKind: DOC.pkgListing, source: pkgSource(pkg), evidenceUrl: `${npmPage(pkg)}/v/${p.version}?activeTab=code`, title: `${pkg}@${p.version} file listing`, meta: { pkg, version: p.version }, priority: 0 });
  const entries = llms.text ? parseLlms(llms.text) : [];
  if (!entries.length) ctx.log.error(`${origin}/llms.txt unavailable or empty`, { status: llms.res.status });
  const docsSource = { kind: "docs-site", url: `${origin}/`, label: new URL(origin).hostname };
  docs.push({ url: `${origin}/llms.txt`, docKind: DOC.llms, source: docsSource, evidenceUrl: `${origin}/llms.txt`, title: `${new URL(origin).hostname} llms.txt`, meta: {}, priority: 0 });
  const exportSet = new Set(exports);
  let pages = entries.filter((e) => isComponentPage(e.page) && exportSet.has(e.page)).map((e) => e.page);
  if (ctx.limit) pages = pages.slice(0, ctx.limit);
  const tag = releaseTag(pkg, p.version);
  const repoSource = { kind: "repository", url: "https://github.com/adobe/react-spectrum", label: `adobe/react-spectrum @ ${tag}` };
  pages.forEach((page, i) => {
    const pr = 10 + i;
    docs.push({ url: `${origin}/${page}.md`, docKind: DOC.mdPage, source: docsSource, evidenceUrl: `${origin}/${page}`, title: `${page} (docs markdown)`, meta: { page, system }, priority: pr });
    const file = `${DOCS_MDX_DIR[system]}/${page}.mdx`;
    const src = `${SRC_DIR[system]}/${page}.tsx`;
    docs.push({ url: monorepoRaw(tag, file), docKind: DOC.mdx, source: repoSource, evidenceUrl: monorepoBlob(tag, file), title: `${page}.mdx @ ${tag}`, meta: { page, file, tag, src }, priority: pr });
  });
  const pageSet = new Set(pages);
  if (system === "react-aria") {
    for (const e of entries) {
      const h = hookPageOf(e.page);
      if (!h || !pageSet.has(h.component)) continue;
      docs.push({ url: `${origin}/${e.page}.md`, docKind: DOC.hookPage, source: docsSource, evidenceUrl: `${origin}/${e.page}`, title: `${e.page} (docs markdown)`, meta: { component: h.component, hook: h.hook, page: e.page }, priority: 40 });
    }
    if (entries.some((e) => e.page === "quality")) docs.push({ url: `${origin}/quality.md`, docKind: DOC.quality, source: docsSource, evidenceUrl: `${origin}/quality`, title: "Quality (principles)", meta: { page: "quality" }, priority: 3 });
  }
  for (const e of entries) {
    if (!GUIDE_PAGES.includes(e.page)) continue;
    docs.push({ url: `${origin}/${e.page}.md`, docKind: DOC.guide, source: docsSource, evidenceUrl: `${origin}/${e.page}`, title: `${e.title} (guide)`, meta: { page: e.page }, priority: 45 });
  }
  if (system === "react-spectrum") {
    const keys = new Set(pages.map(normKey));
    const keep = ctx.limit ? (title: string) => keys.has(normKey(title)) : undefined;
    docs.push(...(await discoverSite(ctx, { rspOnly: true, keep })));
  }
  return docs;
}

async function discover(ctx: AdapterContext): Promise<DiscoveredDocument[]> {
  const system = ctx.systemSlug as SpectrumSystem;
  if (!SYSTEMS.includes(system)) throw new Error(`spectrum adapter does not handle ${ctx.systemSlug}`);
  return system === "adobe-spectrum" ? discoverDesign(ctx) : discoverReact(ctx, system);
}

/* ----------------------------------- fetch ----------------------------------- */

async function fetchDoc(ctx: AdapterContext, doc: DiscoveredDocument, prev: { etag?: string | null; lastModified?: string | null; lastHash?: string | null }): Promise<FetchResult> {
  const cached = prefetched.get(doc.url);
  if (cached && cached.run === ctx.runStartedAt) return cached.result;
  return ctx.http.get(doc.url, { etag: prev.etag, lastModified: prev.lastModified, lastHash: prev.lastHash, signal: ctx.signal });
}

/* ----------------------------------- parse ----------------------------------- */

function evOf(fetched: FetchedDocument, location?: string): Ev {
  const { doc, result } = fetched;
  return {
    sourceUrl: doc.evidenceUrl ?? result.finalUrl ?? doc.url,
    retrievedAt: result.fetchedAt,
    contentHash: result.hash,
    location: location ?? (doc.meta?.file as string | undefined) ?? (doc.meta?.path as string | undefined) ?? new URL(doc.url).pathname,
  };
}

const frag = (fetched: FetchedDocument, data: SpectrumFragment, warnings?: string[]): ParsedFragment => ({
  docUrl: fetched.doc.url,
  docKind: fetched.doc.docKind,
  data,
  warnings: warnings?.length ? warnings : undefined,
});

async function parse(ctx: AdapterContext, fetched: FetchedDocument): Promise<ParsedFragment | ParsedFragment[] | null> {
  const { doc, result } = fetched;
  const body = result.body ?? "";
  const meta = (doc.meta ?? {}) as Record<string, unknown>;
  switch (doc.docKind) {
    case DOC.npm: {
      let license = (meta.license as string | null) ?? null;
      try {
        const j = JSON.parse(body) as { license?: unknown };
        if (typeof j.license === "string") license = j.license;
      } catch {
        /* keep packument license */
      }
      return frag(fetched, { t: "pkg", name: meta.pkg as string, version: meta.version as string, publishedAt: (meta.publishedAt as string | null) ?? null, license, ev: evOf(fetched, `${meta.pkg as string}@${meta.version as string}`) });
    }
    case DOC.tokens: {
      const file = meta.file as string;
      const r = parseTokenFile(body, file);
      return frag(fetched, { t: "tokens", file, tokens: r.tokens, ev: evOf(fetched, file) }, r.warnings);
    }
    case DOC.cssVars: {
      const names = declaredCustomProperties(body).filter((n) => n.startsWith("--spectrum-"));
      return frag(fetched, { t: "cssvars", names, pkg: PKG.cssTokens, version: meta.version as string, ev: evOf(fetched) }, names.length ? undefined : ["no --spectrum-* custom properties declared"]);
    }
    case DOC.schema: {
      const s = parseComponentSchema(body);
      if (!s) return null;
      return frag(fetched, { t: "schema", name: meta.name as string, schema: s, ev: evOf(fetched) });
    }
    case DOC.siteIndex: {
      const { rows } = parseSiteIndex(body);
      return frag(fetched, { t: "site-index", rows, ev: evOf(fetched, "/query-index.json") });
    }
    case DOC.sitePage: {
      const page = parseSitePage(body);
      let data: { props: import("./spectrum/site").SiteProp[]; status: string | null } | null = null;
      let dataEv: Ev | null = null;
      const warnings: string[] = [];
      if (page.dataPath) {
        const res = await ctx.http.get(siteUrl(page.dataPath), { signal: ctx.signal });
        if (res.ok && res.body) {
          data = parseSiteData(res.body);
          dataEv = { sourceUrl: doc.evidenceUrl ?? siteUrl(meta.path as string), retrievedAt: res.fetchedAt, contentHash: res.hash, location: page.dataPath };
          if (!data) warnings.push(`unparseable component options data ${page.dataPath}`);
        } else warnings.push(`component options data ${page.dataPath}: HTTP ${res.status} ${res.error ?? ""}`);
      }
      return frag(fetched, { t: "site-page", slug: meta.slug as string, impl: meta.impl as "rsp" | "swc", path: meta.path as string, page, data, dataEv, ev: evOf(fetched, `${meta.path as string}.plain.html`) }, warnings);
    }
    case DOC.siteFragment: {
      const section = meta.section as string;
      const states = section === "states" ? parseStatesFragment(body) : null;
      const a11y = section === "accessibility" ? parseA11yFragment(body) : null;
      return frag(fetched, { t: "site-fragment", slug: meta.slug as string, section, states, a11y, links: componentLinks(body), ev: evOf(fetched, `${meta.path as string}.plain.html`) });
    }
    case DOC.sitePrinciples:
      return frag(fetched, { t: "principles", data: parsePrinciples(body), url: siteUrl(meta.path as string), ev: evOf(fetched, `${meta.path as string}.plain.html`) });
    case DOC.llms:
      return frag(fetched, { t: "llms", entries: parseLlms(body), ev: evOf(fetched, "llms.txt") });
    case DOC.pkgListing: {
      const { exports, srcFiles } = exportsFromListing(listingFiles(body));
      return frag(fetched, { t: "listing", pkg: meta.pkg as string, version: meta.version as string, exports, srcFiles, ev: evOf(fetched, `${meta.pkg as string}@${meta.version as string} (jsDelivr file listing)`) });
    }
    case DOC.mdPage: {
      const page = meta.page as string;
      const md = compactPage(parseDocsMd(body));
      return frag(fetched, { t: "md", page, md, docsUrl: doc.evidenceUrl ?? doc.url.replace(/\.md$/, ""), ev: evOf(fetched, `${page}.md`) });
    }
    case DOC.mdx: {
      const page = meta.page as string;
      const tag = meta.tag as string;
      const out: ParsedFragment[] = [frag(fetched, { t: "mdx", page, meta: parseMdxMeta(body), ref: tag, ev: evOf(fetched, meta.file as string) })];
      // Source file of the component at the same release tag (HEAD; only recorded when it exists).
      const srcPath = meta.src as string;
      const res = await ctx.http.get(monorepoRaw(tag, srcPath), { method: "HEAD", signal: ctx.signal });
      if (res.ok && res.status === 200) {
        const url = monorepoBlob(tag, srcPath);
        out.push(frag(fetched, { t: "src", page, url, ev: { sourceUrl: url, retrievedAt: res.fetchedAt, contentHash: null, location: `${srcPath} @ ${tag}` } }));
      }
      return out;
    }
    case DOC.hookPage: {
      const md = parseDocsMd(body);
      return frag(fetched, { t: "hook", component: meta.component as string, hook: meta.hook as string, md: { ...md, sections: md.sections.map((s) => ({ ...s, code: [] })) }, docsUrl: doc.evidenceUrl!, ev: evOf(fetched, `${meta.page as string}.md`) });
    }
    case DOC.guide: {
      const md = parseDocsMd(body);
      return frag(fetched, { t: "guide", page: meta.page as string, md: { ...md, sections: md.sections.map((s) => ({ ...s, code: [] })), api: [] }, docsUrl: doc.evidenceUrl!, ev: evOf(fetched, `${meta.page as string}.md`) });
    }
    case DOC.quality: {
      const md = parseDocsMd(body);
      return frag(fetched, { t: "quality", md: { ...md, sections: md.sections.map((s) => ({ ...s, code: [] })), api: [] }, docsUrl: doc.evidenceUrl!, ev: evOf(fetched, "quality.md") });
    }
    default:
      return null;
  }
}

/* ---------------------------------- adapter ---------------------------------- */

export const adapter: SourceAdapter = {
  id: ADAPTER_ID,
  version: "1.0.0",
  systems: [...SYSTEMS],
  description:
    "Adobe Spectrum: @adobe/spectrum-tokens (themes + platform scales), @adobe/spectrum-design-data component schemas and spectrum.adobe.com guideline pages (query-index + .plain.html); React Spectrum S2 and React Aria: llms.txt + per-page docs markdown, page MDX at the release tag, npm listings (jsDelivr, pinned to npm latest).",
  discover,
  fetch: fetchDoc,
  parse,
  async normalize(ctx, fragments): Promise<NormalizedBundle> {
    const system = ctx.systemSlug as SpectrumSystem;
    let bundle: NormalizedBundle;
    if (system === "adobe-spectrum") {
      const { tokenReport, ...b } = normalizeDesign(fragments, { limit: ctx.limit });
      if (tokenReport.skipped.length) ctx.log.warn(`${tokenReport.skipped.length} tokens with unsupported set keys skipped`, { sample: tokenReport.skipped.slice(0, 5) });
      if (tokenReport.themedToScale.length) ctx.log.warn(`${tokenReport.themedToScale.length} themed tokens reference scale-dependent tokens`, { sample: tokenReport.themedToScale.slice(0, 5) });
      bundle = b;
    } else if (system === "react-spectrum" || system === "react-aria") {
      bundle = normalizeReact(system, fragments);
    } else throw new Error(`spectrum adapter does not handle ${ctx.systemSlug}`);
    ctx.log.info(`${system} normalized: ${bundle.components.length} components, ${bundle.tokenSets.reduce((n, s) => n + s.tokens.length, 0)} tokens in ${bundle.tokenSets.length} sets, ${bundle.patterns.length} patterns`);
    return bundle;
  },
  validate(ctx: AdapterContext, bundle: NormalizedBundle): ValidationIssue[] {
    return validateSpectrumBundle(ctx.systemSlug as SpectrumSystem, bundle, ctx.limit);
  },
};
