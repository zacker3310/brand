/**
 * Shopify Polaris adapter ("shopify-polaris").
 *
 * Polaris is mid-transition; both implementations are modeled with their own lifecycle:
 *  - Polaris web components (current; App Home iframe surface): `@shopify/polaris-types`
 *    dist/custom-elements.json (Custom Elements Manifest: fields, attributes, events, slots), pinned
 *    via npm dist-tags.latest; shopify.dev reference pages read through their published Markdown
 *    alternates (`<page>.md`, robots-allowed): component index, component pages (descriptions,
 *    subcomponents, deprecations, example titles, best practices), App Home patterns, versioning.
 *  - Polaris React (deprecated): archived polaris.shopify.com MDX content in
 *    Shopify/polaris-react-archive (raw.githubusercontent.com; legacy redirects.js seeds discovery,
 *    page links close it), `@shopify/polaris` type declarations (props) and compiled stylesheet
 *    build/esm/styles.css (var(--p-*) token usage per `.Polaris-<Component>`), Storybook index.json.
 *  - `@shopify/polaris-tokens` dist/css/styles.css (four themes) + ESM metadata descriptions.
 * License: Polaris License (field-of-use restricted) -> token sets "restricted"; no code is stored.
 * Static parsing only; nothing fetched is executed.
 */
import type { NormalizedBundle } from "@/lib/contracts";
import type { FetchResult } from "../http";
import { githubBlobUrl, githubRawUrl, listFiles, npmFileUrl, npmLatest, npmListingUrl } from "../http";
import type { AdapterContext, DiscoveredDocument, FetchedDocument, ParsedFragment, SourceAdapter } from "../types";
import { parsePolarisCem } from "./polaris/cem";
import {
  ADAPTER_ID,
  ARCHIVE_DOCS_REF,
  ARCHIVE_REDIRECTS_FILE,
  ARCHIVE_REPO,
  DOC_KINDS,
  htmlUrlFromMd,
  mdUrl,
  PATTERNS_INDEX_URL,
  PATTERNS_PREFIX,
  POLARIS_OVERVIEW_URL,
  REACT_PKG,
  STORYBOOK_INDEX_URL,
  STORYBOOK_ORIGIN,
  SYSTEM_SLUG,
  TOKENS_PKG,
  TYPES_PKG,
  VERSIONING_URL,
  WC_INDEX_URL,
  WC_PREFIX,
} from "./polaris/constants";
import { parseIndexPage, parsePatternPage, parseSystemPage, parseWcPage } from "./polaris/devdocs";
import { DtsResolver } from "./polaris/dts";
import type { NpmInfo, PolarisDocMeta, PolarisFragmentData, ReactProp, StoryRef } from "./polaris/fragments";
import { componentPathFromLink, componentPathsFromRedirects, mdxFileForPath, parseReactMdx, parseRedirects } from "./polaris/mdx";
import { normalizePolaris, wcSlugFromUrl } from "./polaris/normalize";
import { parseReactCssUsages } from "./polaris/react-css";
import { clip, collapse, sentences, type Stamp } from "./polaris/text";
import { parseTokenDescriptions, parseTokensCss } from "./polaris/tokens";
import { validatePolarisBundle } from "./polaris/validate";

const CEM_FILE = "dist/custom-elements.json";
const TOKENS_CSS = "dist/css/styles.css";
/** Token groups whose ESM metadata modules carry descriptions. */
const TOKEN_META_GROUPS = ["breakpoints", "color", "motion"];
const REACT_INDEX = "build/ts/src/index.d.ts";
const REACT_CSS = "build/esm/styles.css";
const MAX_MDX = 250;

/** Bodies fetched during discover(), handed to fetch() once to avoid duplicate downloads in one run. */
const prefetched = new Map<string, FetchResult>();
/** Linked declaration files loaded while resolving React props (per pinned URL, per process). */
const dtsBodies = new Map<string, Promise<string | null>>();
/** Package file listings seen in discover() ("pkg@version" -> files), used to skip non-existent module candidates. */
const listings = new Map<string, Set<string>>();

async function npmInfo(ctx: AdapterContext, pkg: string): Promise<NpmInfo> {
  const r = await npmLatest(ctx.http, pkg);
  if (!r.ok || !r.latest) throw new Error(`npm metadata for ${pkg} unavailable (HTTP ${r.status} ${r.error ?? ""})`);
  return { packageName: pkg, version: r.latest, publishedAt: r.publishedAt, license: r.license, deprecated: r.deprecated };
}

async function getPrefetch(ctx: AdapterContext, url: string): Promise<FetchResult> {
  const res = await ctx.http.get(url);
  if (res.ok && res.body !== null) prefetched.set(url, res);
  return res;
}

const archiveRaw = (file: string) => githubRawUrl(ARCHIVE_REPO.owner, ARCHIVE_REPO.repo, ARCHIVE_DOCS_REF, file);
const archiveBlob = (file: string) => githubBlobUrl(ARCHIVE_REPO.owner, ARCHIVE_REPO.repo, ARCHIVE_DOCS_REF, file);
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Crawl archived component MDX: redirect destinations, then links found in fetched pages (closure). */
async function crawlReactDocs(ctx: AdapterContext, redirectsBody: string): Promise<{ docPath: string; url: string }[]> {
  const redirects = parseRedirects(redirectsBody);
  const rmap = new Map(redirects.map((r) => [r.source, r.destination]));
  let frontier = componentPathsFromRedirects(redirects);
  if (ctx.limit) frontier = frontier.slice(0, ctx.limit);
  const seen = new Set<string>(frontier);
  const found: { docPath: string; url: string }[] = [];
  while (frontier.length && seen.size <= MAX_MDX) {
    const results = await Promise.all(
      frontier.map(async (docPath) => {
        const url = archiveRaw(mdxFileForPath(docPath));
        const res = await getPrefetch(ctx, url);
        return { docPath, url, res };
      }),
    );
    const next: string[] = [];
    for (const { docPath, url, res } of results) {
      if (!res.ok || res.body === null) continue;
      found.push({ docPath, url });
      if (ctx.limit) continue;
      for (const p of parseReactMdx(res.body, docPath).linkedPaths) {
        const target = componentPathFromLink(p, rmap);
        if (target && !seen.has(target)) {
          seen.add(target);
          next.push(target);
        }
      }
    }
    frontier = next.sort();
  }
  return found.sort((a, b) => (a.docPath < b.docPath ? -1 : 1));
}

export const adapter: SourceAdapter = {
  id: ADAPTER_ID,
  version: "1.0.0",
  systems: [SYSTEM_SLUG],
  description:
    "Shopify Polaris: web components from @shopify/polaris-types custom-elements.json + shopify.dev App Home reference Markdown (components, patterns, versioning); deprecated Polaris React from the archived polaris.shopify.com MDX, @shopify/polaris type declarations, compiled CSS (token usage) and Storybook index; @shopify/polaris-tokens CSS themes (license-restricted, no code stored).",

  async discover(ctx) {
    const [react, tokens, types] = await Promise.all([npmInfo(ctx, REACT_PKG), npmInfo(ctx, TOKENS_PKG), npmInfo(ctx, TYPES_PKG)]);
    ctx.log.info(`polaris: pinned ${TYPES_PKG}@${types.version}, ${REACT_PKG}@${react.version}${react.deprecated ? " (deprecated)" : ""}, ${TOKENS_PKG}@${tokens.version}`);
    const devSource = { kind: "docs", url: `${WC_INDEX_URL}`, label: "shopify.dev Polaris web components" };
    const typesSource = { kind: "package", url: `https://www.npmjs.com/package/${TYPES_PKG}`, label: `${TYPES_PKG} (npm)` };
    const reactSource = { kind: "package", url: `https://www.npmjs.com/package/${REACT_PKG}`, label: `${REACT_PKG} (npm)` };
    const tokensSource = { kind: "package", url: `https://www.npmjs.com/package/${TOKENS_PKG}`, label: `${TOKENS_PKG} (npm)` };
    const archiveSource = { kind: "repository", url: `https://github.com/${ARCHIVE_REPO.owner}/${ARCHIVE_REPO.repo}`, label: `${ARCHIVE_REPO.owner}/${ARCHIVE_REPO.repo} (archived)` };
    const storybookSource = { kind: "storybook", url: `${STORYBOOK_ORIGIN}/`, label: "Polaris React Storybook" };

    const docs: DiscoveredDocument[] = [];
    const cemUrl = npmFileUrl(TYPES_PKG, types.version, CEM_FILE);
    docs.push({ url: cemUrl, docKind: DOC_KINDS.cem, source: typesSource, title: `${TYPES_PKG}@${types.version} ${CEM_FILE}`, evidenceUrl: cemUrl, meta: { npm: types, file: CEM_FILE } satisfies PolarisDocMeta, priority: 0 });

    // shopify.dev (Markdown alternates): component index -> pages; patterns index -> pages; system pages.
    const devTask = (async () => {
      const out: DiscoveredDocument[] = [];
      const idxUrl = mdUrl(WC_INDEX_URL);
      const idxRes = await getPrefetch(ctx, idxUrl);
      if (idxRes.ok && idxRes.body) {
        out.push({ url: idxUrl, docKind: DOC_KINDS.wcIndex, source: devSource, title: "Polaris web components (App Home)", evidenceUrl: WC_INDEX_URL, priority: 1 });
        let items = parseIndexPage(idxRes.body, WC_PREFIX).items.sort((a, b) => (a.url < b.url ? -1 : 1));
        if (ctx.limit) items = items.sort((a, b) => ((wcSlugFromUrl(a.url) ?? "") < (wcSlugFromUrl(b.url) ?? "") ? -1 : 1)).slice(0, ctx.limit);
        for (const it of items) {
          const slug = wcSlugFromUrl(it.url);
          if (!slug) continue;
          out.push({ url: mdUrl(it.url), docKind: DOC_KINDS.wcPage, source: devSource, title: it.title, evidenceUrl: it.url, meta: { slug, section: it.section, summary: it.summary } satisfies PolarisDocMeta });
        }
      } else ctx.log.warn(`polaris: web components index unavailable (HTTP ${idxRes.status} ${idxRes.error ?? ""})`);
      const patUrl = mdUrl(PATTERNS_INDEX_URL);
      const patRes = await getPrefetch(ctx, patUrl);
      if (patRes.ok && patRes.body) {
        out.push({ url: patUrl, docKind: DOC_KINDS.patternsIndex, source: devSource, title: "App Home patterns", evidenceUrl: PATTERNS_INDEX_URL, priority: 1 });
        let items = parseIndexPage(patRes.body, PATTERNS_PREFIX).items.sort((a, b) => (a.url < b.url ? -1 : 1));
        if (ctx.limit) items = items.slice(0, ctx.limit);
        for (const it of items) {
          const m = /\/patterns\/([a-z0-9-]+)\/([a-z0-9-]+)$/.exec(it.url);
          if (!m) continue;
          out.push({ url: mdUrl(it.url), docKind: DOC_KINDS.patternPage, source: devSource, title: it.title, evidenceUrl: it.url, meta: { slug: m[2]!, group: it.section || m[1]!, summary: it.summary } satisfies PolarisDocMeta });
        }
      } else ctx.log.warn(`polaris: patterns index unavailable (HTTP ${patRes.status} ${patRes.error ?? ""})`);
      for (const [key, url] of [["overview", POLARIS_OVERVIEW_URL], ["versioning", VERSIONING_URL]] as const) {
        out.push({ url: mdUrl(url), docKind: DOC_KINDS.systemPage, source: devSource, title: key, evidenceUrl: url, meta: { key } satisfies PolarisDocMeta, priority: 2 });
      }
      return out;
    })();

    // Archive: redirects.js -> MDX closure; README + LICENSE.
    const archiveTask = (async () => {
      const out: DiscoveredDocument[] = [];
      const redUrl = archiveRaw(ARCHIVE_REDIRECTS_FILE);
      const redRes = await getPrefetch(ctx, redUrl);
      for (const file of ["README.md", "LICENSE.md"]) {
        out.push({ url: archiveRaw(file), docKind: file === "README.md" ? DOC_KINDS.readme : DOC_KINDS.license, source: archiveSource, title: file, evidenceUrl: archiveBlob(file), meta: { key: file === "README.md" ? "readme" : "archive" } satisfies PolarisDocMeta, priority: 2 });
      }
      if (!redRes.ok || !redRes.body) {
        ctx.log.warn(`polaris: archive redirects.js unavailable (HTTP ${redRes.status}); Polaris React docs skipped`);
        return { out, mdx: [] as { docPath: string; url: string }[] };
      }
      out.push({ url: redUrl, docKind: DOC_KINDS.redirects, source: archiveSource, title: ARCHIVE_REDIRECTS_FILE, evidenceUrl: archiveBlob(ARCHIVE_REDIRECTS_FILE), priority: 1 });
      const mdx = await crawlReactDocs(ctx, redRes.body);
      for (const m of mdx) {
        const file = mdxFileForPath(m.docPath);
        out.push({ url: m.url, docKind: DOC_KINDS.reactMdx, source: archiveSource, title: file, evidenceUrl: archiveBlob(file), meta: { docPath: m.docPath, file } satisfies PolarisDocMeta });
      }
      return { out, mdx };
    })();

    // npm listing of @shopify/polaris -> component declaration files.
    const listingTask = listFiles(ctx.http, npmListingUrl(REACT_PKG, react.version));

    const [devDocs, archive, listing] = await Promise.all([devTask, archiveTask, listingTask]);
    docs.push(...devDocs, ...archive.out);

    // React declarations: docs title / <Props componentName> -> build/ts/src/components/<Dir>/<Dir>.d.ts
    const dirs = new Map<string, string>();
    if (listing.files.length) listings.set(`${REACT_PKG}@${react.version}`, new Set(listing.files));
    for (const f of listing.files) {
      const m = /^build\/ts\/src\/components\/([A-Za-z0-9]+)\/\1\.d\.ts$/.exec(f);
      if (m) dirs.set(norm(m[1]!), m[1]!);
    }
    if (!listing.files.length) ctx.log.warn(`polaris: npm listing for ${REACT_PKG}@${react.version} empty (HTTP ${listing.status}); React props not extracted`);
    const reactIndexUrl = npmFileUrl(REACT_PKG, react.version, REACT_INDEX);
    docs.push({ url: reactIndexUrl, docKind: DOC_KINDS.reactIndex, source: reactSource, title: REACT_INDEX, evidenceUrl: reactIndexUrl, meta: { npm: react, file: REACT_INDEX } satisfies PolarisDocMeta, priority: 3 });
    const dtsDocs: DiscoveredDocument[] = [];
    for (const m of archive.mdx) {
      const pre = prefetched.get(m.url);
      if (!pre?.body) continue;
      const doc = parseReactMdx(pre.body, m.docPath);
      const dir = dirs.get(norm(doc.propsComponent ?? doc.title)) ?? dirs.get(norm(m.docPath.split("/").pop()!));
      if (!dir) continue;
      const file = `build/ts/src/components/${dir}/${dir}.d.ts`;
      const url = npmFileUrl(REACT_PKG, react.version, file);
      if (dtsDocs.some((d) => d.url === url)) continue;
      dtsDocs.push({ url, docKind: DOC_KINDS.reactDts, source: reactSource, title: file, evidenceUrl: url, meta: { npm: react, file, dir, docPath: m.docPath, propsName: `${dir}Props` } satisfies PolarisDocMeta });
    }

    if (!listing.files.length || listing.files.includes(REACT_CSS)) {
      const url = npmFileUrl(REACT_PKG, react.version, REACT_CSS);
      docs.push({ url, docKind: DOC_KINDS.reactCss, source: reactSource, title: `${REACT_PKG}@${react.version} ${REACT_CSS}`, evidenceUrl: url, meta: { npm: react, file: REACT_CSS } satisfies PolarisDocMeta, priority: 3 });
    }

    // Storybook (React stories), tokens.
    docs.push({ url: STORYBOOK_INDEX_URL, docKind: DOC_KINDS.storybook, source: storybookSource, title: "Storybook index.json", evidenceUrl: STORYBOOK_INDEX_URL, priority: 3 });
    const cssUrl = npmFileUrl(TOKENS_PKG, tokens.version, TOKENS_CSS);
    docs.push({ url: cssUrl, docKind: DOC_KINDS.tokensCss, source: tokensSource, title: `${TOKENS_PKG}@${tokens.version} ${TOKENS_CSS}`, evidenceUrl: cssUrl, meta: { npm: tokens, file: TOKENS_CSS } satisfies PolarisDocMeta, priority: 2 });
    for (const g of TOKEN_META_GROUPS) {
      const file = `dist/esm/src/themes/base/${g}.mjs`;
      const url = npmFileUrl(TOKENS_PKG, tokens.version, file);
      docs.push({ url, docKind: DOC_KINDS.tokensMeta, source: tokensSource, title: file, evidenceUrl: url, meta: { npm: tokens, file } satisfies PolarisDocMeta, priority: 2 });
    }
    const tokLicense = npmFileUrl(TOKENS_PKG, tokens.version, "LICENSE.md");
    docs.push({ url: tokLicense, docKind: DOC_KINDS.license, source: tokensSource, title: "LICENSE.md", evidenceUrl: tokLicense, meta: { key: "tokens", npm: tokens } satisfies PolarisDocMeta, priority: 2 });

    // Interleave hosts so per-host queues stay busy (shopify.dev pages / jsDelivr declarations / GitHub raw MDX are already prefetched).
    const devPages = docs.filter((d) => d.docKind === DOC_KINDS.wcPage || d.docKind === DOC_KINDS.patternPage);
    const rest = docs.filter((d) => !devPages.includes(d));
    const n = Math.max(devPages.length, dtsDocs.length);
    const ordered: DiscoveredDocument[] = [...rest];
    for (let i = 0; i < n; i++) {
      if (devPages[i]) ordered.push({ ...devPages[i]!, priority: 10 + i * 2 });
      if (dtsDocs[i]) ordered.push({ ...dtsDocs[i]!, priority: 11 + i * 2 });
    }
    return ordered;
  },

  async fetch(ctx, doc, prev) {
    const pre = prefetched.get(doc.url);
    if (pre) {
      prefetched.delete(doc.url);
      return pre;
    }
    return ctx.http.get(doc.url, { etag: prev.etag, lastModified: prev.lastModified, lastHash: prev.lastHash });
  },

  async parse(ctx, fetched: FetchedDocument): Promise<ParsedFragment | null> {
    const { doc, result } = fetched;
    const body = result.body;
    if (body === null) return null;
    const meta = (doc.meta ?? {}) as PolarisDocMeta;
    const stamp: Stamp = { url: doc.url, evidenceUrl: doc.evidenceUrl ?? doc.url, retrievedAt: result.fetchedAt ?? ctx.runStartedAt, hash: result.hash };
    const frag = (data: PolarisFragmentData, warnings?: string[]): ParsedFragment => ({ docUrl: doc.url, docKind: doc.docKind, data, warnings: warnings?.length ? warnings : undefined });

    switch (doc.docKind) {
      case DOC_KINDS.cem: {
        const r = parsePolarisCem(body);
        return frag({ type: "cem", stamp, npm: meta.npm!, file: meta.file ?? CEM_FILE, schemaVersion: r.schemaVersion, elements: r.elements });
      }
      case DOC_KINDS.wcIndex:
        return frag({ type: "wc-index", stamp, page: parseIndexPage(body, WC_PREFIX) });
      case DOC_KINDS.wcPage: {
        const page = parseWcPage(body);
        const stampHtml = { ...stamp, evidenceUrl: page.htmlUrl ?? htmlUrlFromMd(doc.url) };
        return frag({ type: "wc-page", stamp: stampHtml, slug: meta.slug ?? wcSlugFromUrl(htmlUrlFromMd(doc.url)) ?? "", section: meta.section ?? null, summary: meta.summary ?? null, page });
      }
      case DOC_KINDS.patternsIndex:
        return frag({ type: "patterns-index", stamp, page: parseIndexPage(body, PATTERNS_PREFIX) });
      case DOC_KINDS.patternPage: {
        const page = parsePatternPage(body);
        return frag({ type: "pattern-page", stamp: { ...stamp, evidenceUrl: page.htmlUrl ?? htmlUrlFromMd(doc.url) }, slug: meta.slug ?? "", group: meta.group ?? null, summary: meta.summary ?? null, page });
      }
      case DOC_KINDS.systemPage: {
        const page = parseSystemPage(body);
        return frag({ type: "system-page", stamp: { ...stamp, evidenceUrl: page.htmlUrl ?? htmlUrlFromMd(doc.url) }, key: meta.key ?? "other", page });
      }
      case DOC_KINDS.redirects:
        return frag({ type: "redirects", stamp, redirects: parseRedirects(body) });
      case DOC_KINDS.reactMdx:
        return frag({ type: "react-mdx", stamp, file: meta.file ?? "", doc: parseReactMdx(body, meta.docPath ?? "") });
      case DOC_KINDS.reactIndex: {
        const exports: Record<string, string> = {};
        for (const m of body.matchAll(/export\s*\{([^}]*)\}\s*from\s*'\.\/components\/([A-Za-z0-9]+)'/g)) {
          for (const spec of m[1]!.split(",")) {
            const [local, exported] = spec.trim().split(/\s+as\s+/).map((x) => x.trim());
            if (local === m[2] && !(m[2]! in exports)) exports[m[2]!] = exported ?? local!;
          }
        }
        return frag({ type: "react-index", stamp, npm: meta.npm!, file: meta.file ?? REACT_INDEX, exports });
      }
      case DOC_KINDS.reactDts: {
        const npm = meta.npm!;
        const file = meta.file!;
        const load = (path: string): Promise<string | null> => {
          if (path === file) return Promise.resolve(body);
          const url = npmFileUrl(REACT_PKG, npm.version, path);
          let p = dtsBodies.get(url);
          if (!p) {
            p = ctx.http.get(url).then((r) => (r.ok && r.body !== null ? r.body : null));
            dtsBodies.set(url, p);
          }
          return p;
        };
        const files = listings.get(`${REACT_PKG}@${npm.version}`);
        const resolver = new DtsResolver(load, files ? (p) => files.has(p) : undefined);
        const res = await resolver.props(file, meta.propsName ?? "");
        const props: ReactProp[] = [];
        for (const p of res?.props ?? []) props.push({ ...p, allowedValues: await resolver.allowedValues(p.file, p.type) });
        return frag(
          { type: "react-dts", stamp, npm, docPath: meta.docPath ?? null, dir: meta.dir ?? "", file, propsName: meta.propsName ?? "", found: !!res, props, unresolved: res?.unresolved ?? [], files: res?.files ?? [] },
          res ? undefined : [`${meta.propsName} not found in ${file}`],
        );
      }
      case DOC_KINDS.storybook: {
        let stories: StoryRef[] = [];
        try {
          const j = JSON.parse(body) as { entries?: Record<string, { type?: string; id?: string; title?: string; name?: string; importPath?: string }> };
          const perTitle = new Map<string, number>();
          for (const e of Object.values(j.entries ?? {})) {
            if (e.type !== "story" || !e.id || !e.title || !/^All components\//i.test(e.title)) continue;
            const n = perTitle.get(e.title) ?? 0;
            perTitle.set(e.title, n + 1);
            if (n < 3) stories.push({ title: e.title, id: e.id, name: e.name ?? e.id, importPath: e.importPath ?? "" });
          }
        } catch {
          stories = [];
        }
        return frag({ type: "storybook", stamp, stories });
      }
      case DOC_KINDS.reactCss:
        return frag({ type: "react-css", stamp, npm: meta.npm!, file: meta.file ?? REACT_CSS, usages: parseReactCssUsages(body) });
      case DOC_KINDS.tokensCss:
        return frag({ type: "tokens-css", stamp, npm: meta.npm!, file: meta.file ?? TOKENS_CSS, blocks: parseTokensCss(body) });
      case DOC_KINDS.tokensMeta:
        return frag({ type: "tokens-meta", stamp, npm: meta.npm!, file: meta.file ?? "", descriptions: Object.fromEntries(parseTokenDescriptions(body)) });
      case DOC_KINDS.license: {
        const m = /^\s*(Copyright \(c\)[^\n]+?)\s*$/im.exec(body);
        const fieldOfUse = /may only be exercised to develop and distribute\s+applications that integrate or interoperate with Shopify/i.test(body.replace(/\s+/g, " "));
        return frag({ type: "license", stamp, key: meta.key ?? "archive", copyright: m ? m[1]!.trim().replace(/\.$/, "") : null, fieldOfUse });
      }
      case DOC_KINDS.readme: {
        const text = collapse(body.replace(/[#>*_`]/g, " "));
        const archived = /archived and unmaintained/i.test(text);
        const picked = sentences(text).filter((s) => /archived and unmaintained|library is deprecated|technology-agnostic/i.test(s));
        return frag({ type: "archive-readme", stamp, archived, statement: clip(picked.join(" "), 280) });
      }
      default:
        ctx.log.warn(`polaris: unknown docKind ${doc.docKind}`);
        return null;
    }
  },

  async normalize(ctx, fragments): Promise<NormalizedBundle> {
    const data = fragments.map((f) => f.data as PolarisFragmentData).filter((d) => d && typeof d === "object" && "type" in d);
    return normalizePolaris(data, { systemSlug: ctx.systemSlug, limit: ctx.limit, runStartedAt: ctx.runStartedAt, log: (m) => ctx.log.warn(`polaris: ${m}`) });
  },

  validate(ctx, bundle) {
    return validatePolarisBundle(bundle, { limit: ctx.limit });
  },
};
