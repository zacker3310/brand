/**
 * "mui" source adapter: Material UI ("mui"), Joy UI ("joy-ui") and Base UI ("base-ui").
 *
 * Sources, first-party and machine-readable first, all pinned:
 *  - npm registry metadata (dist-tags.latest) for @mui/material, @mui/joy, @base-ui/react. The git
 *    tag that published the version is derived (v<version>; for @mui/joy from its @mui/* dependency
 *    line, because 5.0.0-beta.52 was released from the v5.x branch) and verified by reading the
 *    package.json version at that tag.
 *  - github.com/mui/material-ui @ tag (raw.githubusercontent.com / cdn.jsdelivr.net/gh, same bytes):
 *    docs/data/<product>/pages.ts + pagesApi.js, docs/pages/<product>/react-*.js (markdown path only),
 *    usage markdown, generated API JSON (docs/pages/<product>/api/*.json) and generated translations
 *    (prop/slot/component descriptions), overview / about-the-lab / CSS variables pages.
 *  - npm package files via jsDelivr: @mui/material colors + palette/transition/z-index defaults;
 *    @mui/joy colors + extendTheme defaults. Static object-literal reads only.
 *  - github.com/mui/base-ui @ v<version>: components index (generated), component page.mdx and
 *    generated types.md API tables, About and Forms handbook pages.
 * The mui/material-ui repository is too large for jsDelivr listings; file names come from the docs'
 * own index files. Nothing fetched is executed.
 */
import type { FetchResult } from "@/ingestion/http";
import { githubBlobUrl, githubListingUrl, githubRawUrl, listFiles, npmFileUrl, npmLatest } from "@/ingestion/http";
import type { AdapterContext, DiscoveredDocument, FetchedDocument, ParsedFragment, SourceAdapter } from "@/ingestion/types";
import { parseApiJson, parseApiTranslations } from "./mui/api-json";
import { parseBaseIndex, parseBasePage, parseBaseTextPage, parseBaseTypes } from "./mui/baseui";
import { ADAPTER_ID, BASE_DOCS_DIR, BASE_DOCS_ORIGIN, BASE_PKG, BASE_REPO, CORE_PROFILES, CORE_REPO, DOC_KINDS, MUI_OWNER, SYSTEMS, prioritize, type CoreProfile, type MuiSystem } from "./mui/constants";
import type { DocMeta, MuiFragment, NpmPin } from "./mui/fragments";
import { parseMuiMarkdown } from "./mui/markdown";
import { pageMarkdownPath, parseNavPages, parsePagesApi } from "./mui/nav";
import { baseStatements, normalizeBase } from "./mui/normalize-base";
import { coreStatements, normalizeCore, pageUrlFor } from "./mui/normalize-core";
import type { Prov } from "./mui/shared";
import { parseTokenFile, type TokenRole } from "./mui/tokens";
import { validateMuiBundle } from "./mui/validate";

/** Bodies fetched during discover(), handed to fetch() once to avoid duplicate downloads in one run. */
const prefetched = new Map<string, FetchResult>();

const usable = (r: FetchResult) => r.ok && r.body !== null && !/^Package size exceeded/.test(r.body);

/** GitHub file at a tag via raw.githubusercontent.com or cdn.jsdelivr.net/gh (alternating), with fallback. */
function repoUrls(repo: string, tag: string, file: string, alt: boolean): { url: string; fallback: string } {
  const raw = githubRawUrl(MUI_OWNER, repo, tag, file);
  const cdn = `https://cdn.jsdelivr.net/gh/${MUI_OWNER}/${repo}@${tag}/${file}`;
  return alt ? { url: cdn, fallback: raw } : { url: raw, fallback: cdn };
}

async function getWithFallback(ctx: AdapterContext, url: string, fallback: string | null, prev: { etag?: string | null; lastModified?: string | null; lastHash?: string | null } = {}): Promise<FetchResult> {
  const r = await ctx.http.get(url, { etag: prev.etag, lastModified: prev.lastModified, lastHash: prev.lastHash });
  if (usable(r) || !fallback) return r;
  const f = await ctx.http.get(fallback, { lastHash: prev.lastHash });
  return usable(f) ? { ...f, url } : r;
}

async function prefetch(ctx: AdapterContext, url: string, fallback: string | null): Promise<FetchResult> {
  const r = await getWithFallback(ctx, url, fallback);
  if (usable(r)) prefetched.set(url, r);
  return r;
}

/* ---------------------------------- pinning ---------------------------------- */

async function resolvePin(ctx: AdapterContext, pkg: string, repo: string, packageDir: string): Promise<{ pin: NpmPin; pkgDoc: DiscoveredDocument }> {
  const npm = await npmLatest(ctx.http, pkg);
  if (!npm.ok || !npm.latest) throw new Error(`npm metadata for ${pkg} unavailable (${npm.status} ${npm.error ?? ""})`);
  const version = npm.latest;
  const candidates: { tag: string; method: string }[] = [{ tag: `v${version}`, method: `tag v<version>` }];
  if (pkg === "@mui/joy") {
    // @mui/joy is versioned separately; its release shares the monorepo tag of its @mui/* dependency line.
    const { data } = await ctx.http.getJson<{ dependencies?: Record<string, string> }>(`https://registry.npmjs.org/${pkg.replace("/", "%2F")}/${encodeURIComponent(version)}`);
    for (const dep of ["@mui/core-downloads-tracker", "@mui/system", "@mui/utils"]) {
      const v = data?.dependencies?.[dep]?.replace(/^[\^~]/, "");
      if (v && /^\d+\.\d+\.\d+/.test(v)) candidates.unshift({ tag: `v${v}`, method: `monorepo tag of dependency ${dep}@${data!.dependencies![dep]}` });
    }
  }
  for (const c of candidates) {
    const file = `${packageDir}/package.json`;
    const { url, fallback } = repoUrls(repo, c.tag, file, false);
    const r = await getWithFallback(ctx, url, fallback);
    if (!usable(r)) continue;
    let v: string | null = null;
    try {
      v = (JSON.parse(r.body!) as { version?: string }).version ?? null;
    } catch {
      v = null;
    }
    if (v !== version) continue;
    prefetched.set(url, r);
    const pin: NpmPin = { pkg, version, publishedAt: npm.publishedAt, license: npm.license, deprecated: npm.deprecated, tag: c.tag, tagMethod: `${c.method}; ${file} version ${v} verified`, npmUrl: npm.url };
    ctx.log.info(`mui: pinned ${pkg}@${version} -> ${MUI_OWNER}/${repo}@${c.tag}`);
    return {
      pin,
      pkgDoc: { url, evidenceUrl: githubBlobUrl(MUI_OWNER, repo, c.tag, file), docKind: DOC_KINDS.pkgJson, source: { kind: "repository", url: `https://github.com/${MUI_OWNER}/${repo}`, label: `${MUI_OWNER}/${repo}` }, title: file, priority: 0, meta: { file, fallbackUrl: fallback } },
    };
  }
  throw new Error(`could not find the ${MUI_OWNER}/${repo} tag that published ${pkg}@${version} (tried ${candidates.map((c) => c.tag).join(", ")})`);
}

/* --------------------------------- discovery --------------------------------- */

async function discoverCore(ctx: AdapterContext, profile: CoreProfile): Promise<DiscoveredDocument[]> {
  const { pin, pkgDoc } = await resolvePin(ctx, profile.pkg, CORE_REPO, profile.packageDir);
  const repoSource = { kind: "repository", url: `https://github.com/${MUI_OWNER}/${CORE_REPO}`, label: `${MUI_OWNER}/${CORE_REPO}` };
  const pkgSource = { kind: "package", url: `https://www.npmjs.com/package/${profile.pkg}`, label: `${profile.pkg} (npm)` };
  let toggle = 0;
  const meta = (file: string, extra: Partial<DocMeta> = {}): DocMeta => ({ system: profile.system, file, pin, ...extra });
  const repoDoc = (file: string, docKind: string, priority: number, extra: Partial<DocMeta> = {}): DiscoveredDocument => {
    const { url, fallback } = repoUrls(CORE_REPO, pin.tag, file, toggle++ % 2 === 1);
    return { url, evidenceUrl: githubBlobUrl(MUI_OWNER, CORE_REPO, pin.tag, file), docKind, source: repoSource, title: file, priority, meta: { ...meta(file, extra), fallbackUrl: fallback } };
  };
  const docs: DiscoveredDocument[] = [{ ...pkgDoc, meta: { ...meta(pkgDoc.meta!.file as string), fallbackUrl: pkgDoc.meta!.fallbackUrl } }];

  const navFile = `docs/data/${profile.dataDir}/pages.ts`;
  const apiFile = `docs/data/${profile.dataDir}/pagesApi.js`;
  const navDoc = repoDoc(navFile, DOC_KINDS.coreNav, 1);
  const apiIdxDoc = repoDoc(apiFile, DOC_KINDS.corePagesApi, 1);
  const [navRes, apiRes] = await Promise.all([prefetch(ctx, navDoc.url, navDoc.meta!.fallbackUrl as string), prefetch(ctx, apiIdxDoc.url, apiIdxDoc.meta!.fallbackUrl as string)]);
  if (!usable(navRes)) throw new Error(`${navFile} unavailable at ${pin.tag} (HTTP ${navRes.status})`);
  if (!usable(apiRes)) throw new Error(`${apiFile} unavailable at ${pin.tag} (HTTP ${apiRes.status})`);
  docs.push(navDoc, apiIdxDoc);
  const navPages = parseNavPages(navRes.body!, profile.product);
  const apiSlugs = parsePagesApi(apiRes.body!, profile.product);
  ctx.log.info(`mui: ${profile.system}: ${navPages.length} component pages, ${apiSlugs.length} API pages at ${pin.tag}`);

  // Page modules -> markdown files (prefetched; only the import path is read).
  const mdByPath = new Map<string, string>();
  await Promise.all(
    navPages.map(async (p, i) => {
      const base = `docs/pages/${p.pathname.replace(/^\//, "")}`;
      for (const ext of [".js", ".tsx"]) {
        const { url, fallback } = repoUrls(CORE_REPO, pin.tag, `${base}${ext}`, i % 2 === 1);
        const r = await getWithFallback(ctx, url, fallback);
        if (!usable(r)) continue;
        const md = pageMarkdownPath(r.body!);
        if (md) mdByPath.set(p.pathname, md);
        return;
      }
      ctx.log.warn(`mui: page module for ${p.pathname} not found at ${pin.tag}`);
    }),
  );
  const seenMd = new Set<string>();
  for (const p of navPages) {
    const md = mdByPath.get(p.pathname);
    if (!md || seenMd.has(md)) continue;
    seenMd.add(md);
    docs.push(repoDoc(md, DOC_KINDS.coreMd, 10, { pathname: p.pathname, pageUrl: pageUrlFor(profile, p.pathname) }));
  }
  const texts: [string, string, string][] = [[`docs/data/${profile.dataDir}/getting-started/overview/overview.md`, "overview", `/${profile.product}/getting-started`]];
  if (profile.system === "mui") texts.push(["docs/data/material/components/about-the-lab/about-the-lab.md", "lab", "/material-ui/about-the-lab"]);
  if (profile.system === "joy-ui") texts.push(["docs/data/joy/customization/using-css-variables/using-css-variables.md", "css-vars", "/joy-ui/customization/using-css-variables"]);
  for (const [file, role, pathname] of texts) docs.push(repoDoc(file, DOC_KINDS.coreText, 5, { role, pageUrl: pageUrlFor(profile, pathname) }));
  docs.push(repoDoc("LICENSE", DOC_KINDS.license, 2));

  for (const slug of prioritize(apiSlugs, profile.system, ctx.limit)) {
    docs.push(repoDoc(`docs/pages/${profile.product}/api/${slug}.json`, DOC_KINDS.coreApi, 20, { slug }));
    docs.push(repoDoc(profile.translationPath(slug), DOC_KINDS.coreApiTr, 21, { slug }));
  }

  // Token files from the published npm package (jsDelivr).
  const tokenDoc = (file: string, tokenRole: TokenRole, extra: Partial<DocMeta> = {}): DiscoveredDocument => {
    const url = npmFileUrl(profile.pkg, pin.version, file);
    return { url, evidenceUrl: url, docKind: DOC_KINDS.tokenJs, source: pkgSource, title: `${profile.pkg}@${pin.version}/${file}`, priority: 15, meta: meta(file, { tokenRole, ...extra }) };
  };
  if (profile.system === "mui") {
    const idx = npmFileUrl(profile.pkg, pin.version, "colors/index.mjs");
    const r = await prefetch(ctx, idx, null);
    const hues = usable(r) ? [...r.body!.matchAll(/export \{ default as ([A-Za-z]+) \} from "\.\/([A-Za-z]+)\.mjs"/g)].map((m) => m[2]!).sort() : [];
    if (!hues.length) ctx.log.warn(`mui: ${idx} unavailable or unparsable (HTTP ${r.status}); color palette tokens not extracted`);
    else prefetched.delete(idx);
    for (const h of hues) docs.push(tokenDoc(`colors/${h}.mjs`, "mui-color", { hue: h }));
    docs.push(tokenDoc("styles/createPalette.mjs", "mui-palette"), tokenDoc("styles/createTransitions.mjs", "mui-transitions"), tokenDoc("styles/zIndex.mjs", "mui-zindex"));
  } else {
    docs.push(tokenDoc("colors/colors.js", "joy-colors"), tokenDoc("styles/extendTheme.js", "joy-theme"), tokenDoc("styles/shouldSkipGeneratingVar.js", "joy-skip-vars"));
  }
  return docs;
}

async function discoverBase(ctx: AdapterContext): Promise<DiscoveredDocument[]> {
  const { pin, pkgDoc } = await resolvePin(ctx, BASE_PKG, BASE_REPO, "packages/react");
  const repoSource = { kind: "repository", url: `https://github.com/${MUI_OWNER}/${BASE_REPO}`, label: `${MUI_OWNER}/${BASE_REPO}` };
  let toggle = 0;
  const meta = (file: string, extra: Partial<DocMeta> = {}): DocMeta => ({ system: "base-ui", file, pin, ...extra });
  const repoDoc = (file: string, docKind: string, priority: number, extra: Partial<DocMeta> = {}): DiscoveredDocument => {
    const { url, fallback } = repoUrls(BASE_REPO, pin.tag, file, toggle++ % 2 === 1);
    return { url, evidenceUrl: githubBlobUrl(MUI_OWNER, BASE_REPO, pin.tag, file), docKind, source: repoSource, title: file, priority, meta: { ...meta(file, extra), fallbackUrl: fallback } };
  };
  const docs: DiscoveredDocument[] = [{ ...pkgDoc, meta: { ...meta(pkgDoc.meta!.file as string), fallbackUrl: pkgDoc.meta!.fallbackUrl } }];
  const listing = await listFiles(ctx.http, githubListingUrl(MUI_OWNER, BASE_REPO, pin.tag));
  const files = new Set(listing.files);
  if (!files.size) ctx.log.warn(`mui: jsDelivr listing for ${MUI_OWNER}/${BASE_REPO}@${pin.tag} unavailable (HTTP ${listing.status}); using documented paths, source folders unknown`);
  const indexFile = `${BASE_DOCS_DIR}/components/page.mdx`;
  const indexDoc = repoDoc(indexFile, DOC_KINDS.baseIndex, 1);
  const idxRes = await prefetch(ctx, indexDoc.url, indexDoc.meta!.fallbackUrl as string);
  if (!usable(idxRes)) throw new Error(`${indexFile} unavailable at ${pin.tag} (HTTP ${idxRes.status})`);
  docs.push(indexDoc);
  const entries = parseBaseIndex(idxRes.body!);
  ctx.log.info(`mui: base-ui: ${entries.length} components in the index at ${pin.tag}`);
  for (const slug of prioritize(entries.map((e) => e.slug), "base-ui", ctx.limit)) {
    const dir = `${BASE_DOCS_DIR}/components/${slug}`;
    const srcDir = `packages/react/src/${slug}`;
    const hasSrc = [...files].some((f) => f.startsWith(`${srcDir}/`));
    if (!files.size || files.has(`${dir}/page.mdx`)) docs.push(repoDoc(`${dir}/page.mdx`, DOC_KINDS.basePage, 10, { slug, pageUrl: `${BASE_DOCS_ORIGIN}/react/components/${slug}`, sourceDir: hasSrc ? srcDir : null }));
    if (!files.size || files.has(`${dir}/types.md`)) docs.push(repoDoc(`${dir}/types.md`, DOC_KINDS.baseTypes, 11, { slug }));
  }
  for (const [path, role] of [
    ["overview/about", "about"],
    ["handbook/forms", "forms"],
  ] as const) {
    const file = `${BASE_DOCS_DIR}/${path}/page.mdx`;
    if (files.size && !files.has(file)) continue;
    docs.push(repoDoc(file, DOC_KINDS.baseText, 5, { role, pageUrl: `${BASE_DOCS_ORIGIN}/react/${path}` }));
  }
  docs.push(repoDoc("LICENSE", DOC_KINDS.license, 2));
  return docs;
}

/* ----------------------------------- adapter ----------------------------------- */

export const adapter: SourceAdapter = {
  id: ADAPTER_ID,
  version: "1.0.0",
  systems: [...SYSTEMS],
  description:
    "MUI: Material UI and Joy UI generated API JSON + translations, usage markdown and nav index from mui/material-ui at the release tag of the npm latest version; static token reads from @mui/material and @mui/joy package files; Base UI generated components index, page.mdx and types.md from mui/base-ui at v<@base-ui/react latest>.",

  async discover(ctx) {
    const system = ctx.systemSlug as MuiSystem;
    if (!SYSTEMS.includes(system)) throw new Error(`mui adapter does not handle ${ctx.systemSlug}`);
    return system === "base-ui" ? discoverBase(ctx) : discoverCore(ctx, CORE_PROFILES[system]);
  },

  async fetch(ctx, doc, prev) {
    const pre = prefetched.get(doc.url);
    if (pre) {
      prefetched.delete(doc.url);
      return pre;
    }
    const fallback = typeof doc.meta?.fallbackUrl === "string" ? doc.meta.fallbackUrl : null;
    return getWithFallback(ctx, doc.url, fallback, prev);
  },

  async parse(ctx, fetched: FetchedDocument): Promise<ParsedFragment | null> {
    const { doc, result } = fetched;
    const body = result.body;
    if (body === null) return null;
    const meta = doc.meta as DocMeta;
    const prov: Prov = { sourceUrl: doc.evidenceUrl ?? doc.url, fetchedUrl: result.finalUrl || doc.url, retrievedAt: result.fetchedAt ?? ctx.runStartedAt, contentHash: result.hash, file: meta.file };
    const frag = (data: MuiFragment, warnings: string[] = []): ParsedFragment => ({ docUrl: doc.url, docKind: doc.docKind, data, warnings: warnings.length ? warnings : undefined });
    const product = meta.system === "base-ui" ? "" : CORE_PROFILES[meta.system].product;
    switch (doc.docKind) {
      case DOC_KINDS.pkgJson: {
        const j = JSON.parse(body) as { name?: string; version?: string; peerDependencies?: Record<string, string> };
        return frag({ kind: "pkg", prov, meta, name: j.name ?? null, version: j.version ?? null, peerReact: j.peerDependencies?.react ?? null });
      }
      case DOC_KINDS.coreNav:
        return frag({ kind: "nav", prov, meta, pages: parseNavPages(body, product) });
      case DOC_KINDS.corePagesApi:
        return frag({ kind: "pages-api", prov, meta, slugs: parsePagesApi(body, product) });
      case DOC_KINDS.coreMd:
        return frag({ kind: "md", prov, meta, pathname: meta.pathname!, pageUrl: meta.pageUrl!, doc: parseMuiMarkdown(body) });
      case DOC_KINDS.coreText:
        return frag({ kind: "text", prov, meta, role: meta.role!, pageUrl: meta.pageUrl ?? null, doc: parseMuiMarkdown(body), statements: coreStatements(meta.role!, body) });
      case DOC_KINDS.coreApi: {
        const api = parseApiJson(body);
        return frag({ kind: "api", prov, meta, slug: meta.slug!, api }, api.name ? [] : [`${meta.file}: no component name`]);
      }
      case DOC_KINDS.coreApiTr:
        return frag({ kind: "api-tr", prov, meta, slug: meta.slug!, tr: parseApiTranslations(body) });
      case DOC_KINDS.license: {
        const m = /^\s*(Copyright \(c\)[^\n]+?)\s*$/im.exec(body);
        return frag({ kind: "license", prov, meta, copyright: m ? m[1]!.trim().replace(/\.$/, "") : null });
      }
      case DOC_KINDS.tokenJs: {
        const data = parseTokenFile(meta.tokenRole!, meta.file, body, meta.hue);
        return frag({ kind: "tokens", prov, meta, npmUrl: doc.url, data }, data.entries.length || meta.tokenRole === "joy-skip-vars" ? [] : [`${meta.file}: no statically declared values found`]);
      }
      case DOC_KINDS.baseIndex:
        return frag({ kind: "base-index", prov, meta, entries: parseBaseIndex(body) });
      case DOC_KINDS.basePage:
        return frag({ kind: "base-page", prov, meta, slug: meta.slug!, pageUrl: meta.pageUrl!, page: parseBasePage(body) });
      case DOC_KINDS.baseTypes:
        return frag({ kind: "base-types", prov, meta, slug: meta.slug!, parts: parseBaseTypes(body) });
      case DOC_KINDS.baseText: {
        const page = parseBaseTextPage(body);
        return frag({ kind: "base-text", prov, meta, role: meta.role!, pageUrl: meta.pageUrl!, page, statements: baseStatements(meta.role!, page.blocks) });
      }
      default:
        ctx.log.warn(`mui: unknown docKind ${doc.docKind}`);
        return null;
    }
  },

  async normalize(ctx, fragments) {
    const data = fragments.map((f) => f.data as MuiFragment).filter((d) => d && typeof d === "object" && "kind" in d && d.meta?.system === ctx.systemSlug);
    const opts = { limit: ctx.limit && ctx.limit > 0 ? ctx.limit : undefined, runStartedAt: ctx.runStartedAt, log: (m: string) => ctx.log.warn(`mui: ${m}`) };
    if (ctx.systemSlug === "base-ui") return normalizeBase(data, opts);
    return normalizeCore(ctx.systemSlug as "mui" | "joy-ui", data, opts);
  },

  validate(ctx, bundle) {
    return validateMuiBundle(ctx.systemSlug, bundle, ctx.limit && ctx.limit > 0 ? ctx.limit : undefined);
  },
};
