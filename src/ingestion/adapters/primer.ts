/**
 * GitHub Primer adapter ("github-primer").
 *
 * Sources (first-party, pinned, machine-readable first):
 *  - @primer/react (npm, version pinned via dist-tags.latest) generated/components.json
 *    (aggregated *.docs.json: props, subcomponents, status, stories) and compiled CSS modules
 *    (dist/<Component>/*.css) for token usage, via jsDelivr.
 *  - @primer/primitives (npm, pinned): DTCG JSON5 base color scales + built dist/docs JSON
 *    (authored values with references preserved, per theme), via jsDelivr.
 *  - primer.style sitemap + prerendered docs pages (component overview/guidelines/accessibility,
 *    UI/scenario/accessibility patterns, getting-started) parsed statically with cheerio.
 *  - LICENSE files for attribution (MIT).
 */
import type { NormalizedBundle } from "@/lib/contracts";
import type { FetchResult } from "../http";
import { githubBlobUrl, githubRawUrl, listFiles, npmFileUrl, npmLatest, npmListingUrl } from "../http";
import type { AdapterContext, DiscoveredDocument, FetchedDocument, ParsedFragment, SourceAdapter } from "../types";
import { parseComponentsJson, sourceDir } from "./primer/components-json";
import {
  ADAPTER_ID,
  DOC_KINDS,
  DOCS_ORIGIN,
  PATTERN_SECTIONS,
  PRIMITIVES_PKG,
  REACT_PKG,
  REACT_REPO,
  SITEMAP_URL,
  SYSTEM_PAGES,
  SYSTEM_SLUG,
  TOKEN_SETS,
} from "./primer/constants";
import { parseCssVarUsages } from "./primer/css-usage";
import { canonicalDocsUrl, componentSlugFromUrl, parseComponentPage, parseSimplePage, parseSitemap } from "./primer/docs-pages";
import type { NpmInfo, PrimerDocMeta, PrimerFragmentData, SourceStamp } from "./primer/fragments";
import { normalizePrimer, selectComponents, sitemapPageType } from "./primer/normalize";
import { parsePrimitivesDocsJson, parsePrimitivesJson5 } from "./primer/tokens";
import { validatePrimerBundle } from "./primer/validate";
import { slugify } from "@/lib/utils";

const COMPONENTS_FILE = "generated/components.json";

/** Bodies fetched during discover(), handed to fetch() once to avoid duplicate downloads in one run. */
const prefetched = new Map<string, FetchResult>();

async function npmInfo(ctx: AdapterContext, pkg: string): Promise<NpmInfo> {
  const r = await npmLatest(ctx.http, pkg);
  if (!r.ok || !r.latest) throw new Error(`npm metadata for ${pkg} unavailable (HTTP ${r.status} ${r.error ?? ""})`);
  return { packageName: pkg, version: r.latest, publishedAt: r.publishedAt, license: r.license };
}

async function getPrefetch(ctx: AdapterContext, url: string): Promise<FetchResult> {
  const res = await ctx.http.get(url);
  if (res.ok && res.body !== null) prefetched.set(url, res);
  return res;
}

const tagRef = (pkg: string, version: string) => encodeURIComponent(`${pkg}@${version}`);

export const adapter: SourceAdapter = {
  id: ADAPTER_ID,
  version: "1.0.0",
  systems: [SYSTEM_SLUG],
  description:
    "GitHub Primer: @primer/react generated/components.json (docs.json: props, subcomponents, status, stories) and compiled CSS (token usage); @primer/primitives DTCG tokens (base scales + light/dark functional themes); primer.style component, accessibility and pattern pages (sitemap-driven, static HTML parse).",

  async discover(ctx) {
    const [react, prim] = await Promise.all([npmInfo(ctx, REACT_PKG), npmInfo(ctx, PRIMITIVES_PKG)]);
    ctx.log.info(`primer: pinned ${REACT_PKG}@${react.version}, ${PRIMITIVES_PKG}@${prim.version}`);
    const docs: DiscoveredDocument[] = [];
    const reactSource = { kind: "package", url: `https://www.npmjs.com/package/${REACT_PKG}`, label: `${REACT_PKG} (npm)` };
    const primSource = { kind: "package", url: `https://www.npmjs.com/package/${PRIMITIVES_PKG}`, label: `${PRIMITIVES_PKG} (npm)` };
    const docsSource = { kind: "docs", url: `${DOCS_ORIGIN}/`, label: "primer.style" };

    // 1. components.json (needed here to plan per-component documents)
    const cjUrl = npmFileUrl(REACT_PKG, react.version, COMPONENTS_FILE);
    const cjRes = await getPrefetch(ctx, cjUrl);
    if (!cjRes.ok || !cjRes.body) throw new Error(`${cjUrl}: HTTP ${cjRes.status} ${cjRes.error ?? ""}`);
    const cjData = parseComponentsJson(cjRes.body);
    const selected = selectComponents(cjData.components, ctx.limit);
    docs.push({ url: cjUrl, docKind: DOC_KINDS.componentsJson, source: reactSource, title: `${REACT_PKG}@${react.version} ${COMPONENTS_FILE}`, evidenceUrl: cjUrl, meta: { npm: react, file: COMPONENTS_FILE } satisfies PrimerDocMeta, priority: 0 });

    // 2. Licenses
    const reactLicenseUrl = githubRawUrl(REACT_REPO.owner, REACT_REPO.repo, tagRef(REACT_PKG, react.version), "LICENSE");
    docs.push({
      url: reactLicenseUrl,
      docKind: DOC_KINDS.license,
      source: { kind: "repository", url: "https://github.com/primer/react", label: "primer/react" },
      evidenceUrl: githubBlobUrl(REACT_REPO.owner, REACT_REPO.repo, tagRef(REACT_PKG, react.version), "LICENSE"),
      meta: { npm: react } satisfies PrimerDocMeta,
      priority: 1,
    });
    const primLicenseUrl = npmFileUrl(PRIMITIVES_PKG, prim.version, "LICENSE");
    docs.push({ url: primLicenseUrl, docKind: DOC_KINDS.license, source: primSource, evidenceUrl: primLicenseUrl, meta: { npm: prim } satisfies PrimerDocMeta, priority: 1 });

    // 3. Tokens
    for (const spec of TOKEN_SETS) {
      for (const file of spec.files) {
        const url = npmFileUrl(PRIMITIVES_PKG, prim.version, file);
        docs.push({
          url,
          docKind: spec.kind === "json5" ? DOC_KINDS.tokenJson5 : DOC_KINDS.tokenDocsJson,
          source: primSource,
          title: `${PRIMITIVES_PKG}@${prim.version}/${file}`,
          evidenceUrl: url,
          meta: { npm: prim, file, setSlug: spec.slug, theme: spec.theme } satisfies PrimerDocMeta,
          priority: 2,
        });
      }
    }

    // 4. Compiled CSS for selected components (token usage)
    const listing = await listFiles(ctx.http, npmListingUrl(REACT_PKG, react.version));
    const wantedDirs = new Set(selected.map((c) => sourceDir(c.source)).filter((d): d is string => !!d));
    const cssDocs: DiscoveredDocument[] = listing.files
      .filter((f) => f.startsWith("dist/") && f.endsWith(".css"))
      .map((f) => ({ f, dir: f.slice("dist/".length).split("/").slice(0, -1).join("/") }))
      .filter(({ dir }) => wantedDirs.has(dir))
      .sort((a, b) => a.f.localeCompare(b.f))
      .map(({ f, dir }) => {
        const url = npmFileUrl(REACT_PKG, react.version, f);
        return { url, docKind: DOC_KINDS.componentCss, source: reactSource, title: f, evidenceUrl: url, meta: { npm: react, file: f, dir } satisfies PrimerDocMeta };
      });
    if (!listing.files.length) ctx.log.warn(`primer: npm listing for ${REACT_PKG}@${react.version} empty (HTTP ${listing.status}); token usage will be not-extracted`);

    // 5. primer.style sitemap -> component, pattern and system pages
    const smRes = await getPrefetch(ctx, SITEMAP_URL);
    const pageDocs: DiscoveredDocument[] = [];
    if (smRes.ok && smRes.body) {
      docs.push({ url: SITEMAP_URL, docKind: DOC_KINDS.sitemap, source: docsSource, evidenceUrl: SITEMAP_URL, priority: 1 });
      const urls = parseSitemap(smRes.body).map((u) => canonicalDocsUrl(u)).filter((u): u is string => !!u);
      const wantedDocSlugs = new Set(selected.map((c) => slugify(c.name)));
      for (const url of urls) {
        const ds = componentSlugFromUrl(url);
        if (!ds || !wantedDocSlugs.has(ds)) continue;
        const pageType = sitemapPageType(url);
        if (pageType === "other") continue;
        pageDocs.push({ url, docKind: DOC_KINDS.componentPage, source: docsSource, title: url, evidenceUrl: url, meta: { pageType } satisfies PrimerDocMeta });
      }
      let patternCount = 0;
      for (const section of PATTERN_SECTIONS) {
        for (const url of urls) {
          const path = new URL(url).pathname;
          if (!path.startsWith(section.prefix) || path === section.prefix) continue;
          const rest = path.slice(section.prefix.length).replace(/\/$/, "");
          if (rest.includes("/")) continue; // only direct children (sub-pages are component-specific guidance)
          if (section.short === "a11y" && rest === "primer-components") continue; // index of per-component guidance
          if (ctx.limit && patternCount >= ctx.limit) break;
          patternCount++;
          pageDocs.push({ url, docKind: DOC_KINDS.patternPage, source: docsSource, title: url, evidenceUrl: url, meta: { section: section.short, sectionLabel: section.label } satisfies PrimerDocMeta });
        }
      }
      for (const [key, path] of Object.entries(SYSTEM_PAGES)) {
        const url = `${DOCS_ORIGIN}${path}`;
        if (key === "figma" || !urls.includes(url)) continue;
        pageDocs.push({ url, docKind: DOC_KINDS.systemPage, source: docsSource, title: url, evidenceUrl: url, meta: { key } satisfies PrimerDocMeta });
      }
    } else {
      ctx.log.warn(`primer: sitemap unavailable (HTTP ${smRes.status} ${smRes.error ?? ""}); docs pages skipped`);
    }

    // Interleave hosts (jsDelivr CSS / primer.style pages) so both per-host queues stay busy.
    const n = Math.max(cssDocs.length, pageDocs.length);
    for (let i = 0; i < n; i++) {
      if (pageDocs[i]) docs.push({ ...pageDocs[i]!, priority: 10 + i * 2 });
      if (cssDocs[i]) docs.push({ ...cssDocs[i]!, priority: 11 + i * 2 });
    }
    return docs;
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
    const meta = (doc.meta ?? {}) as PrimerDocMeta;
    const stamp: SourceStamp = { url: doc.url, evidenceUrl: doc.evidenceUrl ?? doc.url, retrievedAt: result.fetchedAt ?? ctx.runStartedAt, hash: result.hash };
    const frag = (data: PrimerFragmentData, warnings?: string[]): ParsedFragment => ({ docUrl: doc.url, docKind: doc.docKind, data, warnings: warnings?.length ? warnings : undefined });
    const pageUrl = canonicalDocsUrl(result.finalUrl || doc.url) ?? doc.url;

    switch (doc.docKind) {
      case DOC_KINDS.sitemap:
        return frag({ type: "sitemap", stamp, urls: parseSitemap(body) });
      case DOC_KINDS.componentsJson: {
        const data = parseComponentsJson(body);
        return frag({ type: "components-json", stamp, npm: meta.npm!, file: meta.file ?? COMPONENTS_FILE, data }, data.warnings);
      }
      case DOC_KINDS.license: {
        const m = /^\s*(Copyright \(c\)[^\n]+?)\s*$/im.exec(body);
        return frag({ type: "license", stamp, npm: meta.npm!, copyright: m ? m[1]!.trim().replace(/\.$/, "") : null });
      }
      case DOC_KINDS.componentCss:
        return frag({ type: "css", stamp, npm: meta.npm!, file: meta.file!, dir: meta.dir!, usages: parseCssVarUsages(body) });
      case DOC_KINDS.tokenDocsJson: {
        const r = parsePrimitivesDocsJson(body, meta.theme ?? null);
        return frag({ type: "tokens", stamp, npm: meta.npm!, setSlug: meta.setSlug!, file: meta.file!, tokens: r.tokens, warnings: r.warnings }, r.warnings);
      }
      case DOC_KINDS.tokenJson5: {
        const r = parsePrimitivesJson5(body, meta.file!);
        return frag({ type: "tokens", stamp, npm: meta.npm!, setSlug: meta.setSlug!, file: meta.file!, tokens: r.tokens, warnings: r.warnings }, r.warnings);
      }
      case DOC_KINDS.componentPage: {
        const page = parseComponentPage(body, pageUrl, meta.pageType ?? sitemapPageType(pageUrl));
        return frag({ type: "component-page", stamp: { ...stamp, evidenceUrl: pageUrl }, page });
      }
      case DOC_KINDS.patternPage:
        return frag({ type: "pattern-page", stamp: { ...stamp, evidenceUrl: pageUrl }, section: meta.section ?? "ui", sectionLabel: meta.sectionLabel ?? "Pattern", page: parseSimplePage(body, pageUrl) });
      case DOC_KINDS.systemPage:
        return frag({ type: "system-page", stamp: { ...stamp, evidenceUrl: pageUrl }, key: meta.key ?? "other", page: parseSimplePage(body, pageUrl) });
      default:
        ctx.log.warn(`primer: unknown docKind ${doc.docKind}`);
        return null;
    }
  },

  async normalize(ctx, fragments): Promise<NormalizedBundle> {
    const data = fragments.map((f) => f.data as PrimerFragmentData).filter((d) => d && typeof d === "object" && "type" in d);
    return normalizePrimer(data, { systemSlug: ctx.systemSlug, limit: ctx.limit, log: (m) => ctx.log.warn(`primer: ${m}`) });
  },

  validate(ctx, bundle) {
    return validatePrimerBundle(bundle, { limit: ctx.limit });
  },
};
