/**
 * Ant Design adapter ("antd"): Ant Design (ant-design) and Ant Design Mobile (ant-design-mobile).
 *
 * Sources (first-party, pinned to npm `latest`, static parsing only):
 *  ant-design
 *   - antd npm package via jsDelivr: es/version/token-meta.json (global + component token names,
 *     descriptions, layer), es/version/token.json (per-component token defaults + global tokens
 *     used), dist/antd.css (default theme as --ant-* custom properties), es/theme/themes/seed.js and
 *     es/theme/util/alias.js (seed literals, alias derivations), es/<component>/style/*.js
 *     (component-token -> global-token aliases), es/index.d.ts (exports).
 *   - ant-design/ant-design repo at the release tag (raw.githubusercontent.com):
 *     components/<dir>/index.en-US.md (frontmatter, API tables, demos, design-token table),
 *     docs/spec/*.en-US.md (design patterns, principles, values); demo sources via jsDelivr's GitHub mirror.
 *   - ant.design/sitemap.xml (component + spec page list and human docs URLs).
 *  ant-design-mobile
 *   - antd-mobile npm package: es/global/theme-default.css + theme-dark.css, es/index.d.ts.
 *   - ant-design/ant-design-mobile repo at the release tag: config/components.ts (docs navigation,
 *     incl. the Experimental group), src/components/<dir>/*.en.md (Props + CSS Variables tables),
 *     docs/guide/theming.en.md; file list via jsDelivr's GitHub listing.
 */
import type { NormalizedBundle } from "@/lib/contracts";
import { listFiles, npmFileUrl, npmLatest, npmListingUrl, type FetchResult } from "../http";
import type { AdapterContext, DiscoveredDocument, FetchedDocument, ParsedFragment, SourceAdapter } from "../types";
import {
  ADAPTER_ID,
  ANTD_NON_COMPONENT_PAGES,
  ANTD_PRIORITY,
  DOC_KINDS,
  MAX_CODE_CHARS,
  MAX_CODE_EXAMPLES,
  MOBILE_PRIORITY,
  PROFILES,
  SLUG_ANTD,
  SLUG_MOBILE,
  SYSTEMS,
  blobUrl,
  ghCdnUrl,
  npmPageUrl,
  rawUrl,
  type ProfileDef,
} from "./antd/constants";
import type { AntdDocMeta, AntdFragment, PkgInfo, Stamp } from "./antd/fragments";
import { parseDoc } from "./antd/markdown";
import { normalizeAntd, normalizeMobile } from "./antd/normalize";
import {
  parseAliasJs,
  parseComponentTokenRefs,
  parseDistCss,
  parseIndexExports,
  parseMobileNav,
  parseMobileThemeCss,
  parsePresetColorsDts,
  parseSeedJs,
  parseTokenJson,
  parseTokenMeta,
} from "./antd/tokens";
import { validateAntdBundle } from "./antd/validate";

/* ------------------------------ run-scoped cache ------------------------------ */
// Bodies fetched during discover() (to plan documents) are handed to fetch() once in the same run.
const prefetched = new Map<string, { run: string; result: FetchResult }>();

async function prefetch(ctx: AdapterContext, url: string): Promise<FetchResult> {
  for (const [k, v] of prefetched) if (v.run !== ctx.runStartedAt) prefetched.delete(k);
  const res = await ctx.http.get(url, { signal: ctx.signal });
  if (res.ok && res.body !== null) prefetched.set(url, { run: ctx.runStartedAt, result: res });
  return res;
}

const profileFor = (slug: string): ProfileDef => {
  const p = PROFILES[slug];
  if (!p) throw new Error(`antd adapter does not handle ${slug}`);
  return p;
};

/* ---------------------------------- discover ---------------------------------- */

async function resolvePackage(ctx: AdapterContext, p: ProfileDef): Promise<{ pkg: PkgInfo; manifestUrl: string; peerDependencies: string[] }> {
  const latest = await npmLatest(ctx.http, p.pkg);
  if (!latest.ok || !latest.latest) throw new Error(`npm metadata for ${p.pkg} unavailable (HTTP ${latest.status} ${latest.error ?? ""})`);
  const version = latest.latest;
  const manifestUrl = `https://registry.npmjs.org/${p.pkg}/${version}`;
  const mres = await prefetch(ctx, manifestUrl);
  let gitHead: string | null = null;
  let license = latest.license;
  let peerDependencies: string[] = [];
  if (mres.ok && mres.body) {
    try {
      const j = JSON.parse(mres.body) as { gitHead?: string; license?: string; peerDependencies?: Record<string, string> };
      gitHead = typeof j.gitHead === "string" && /^[0-9a-f]{40}$/.test(j.gitHead) ? j.gitHead : null;
      if (typeof j.license === "string") license = j.license;
      peerDependencies = Object.keys(j.peerDependencies ?? {}).sort();
    } catch {
      /* keep packument data */
    }
  }
  // Repository ref: the release tag when it serves package.json with this version, else the published gitHead.
  let ref: string | null = null;
  for (const cand of [...p.refCandidates(version), ...(gitHead ? [gitHead] : [])]) {
    const r = await ctx.http.get(rawUrl(p, cand, "package.json"), { signal: ctx.signal });
    if (!r.ok || !r.body) continue;
    try {
      if ((JSON.parse(r.body) as { version?: string }).version === version || cand === gitHead) {
        ref = cand;
        break;
      }
    } catch {
      /* try next */
    }
  }
  if (!ref) throw new Error(`no repository ref for ${p.pkg}@${version} (tags ${p.refCandidates(version).join(", ")}, gitHead ${gitHead ?? "n/a"})`);
  return { pkg: { name: p.pkg, version, publishedAt: latest.publishedAt, license, gitHead, ref }, manifestUrl, peerDependencies };
}

const uniqStrings = (xs: string[]) => [...new Set(xs)];

function byPriority<T>(items: T[], key: (t: T) => string, priority: string[]): T[] {
  const rank = (t: T) => {
    const i = priority.indexOf(key(t));
    return i < 0 ? 999 : i;
  };
  return [...items].sort((a, b) => rank(a) - rank(b) || key(a).localeCompare(key(b)));
}

async function trailingSlash(ctx: AdapterContext, url: string): Promise<boolean> {
  const head = await ctx.http.get(url, { method: "HEAD", signal: ctx.signal });
  return head.ok && head.finalUrl.endsWith("/");
}

function baseDocs(p: ProfileDef, pkg: PkgInfo, manifestUrl: string, peerDependencies: string[]): DiscoveredDocument[] {
  return [
    {
      url: manifestUrl,
      docKind: DOC_KINDS.npmVersion,
      source: { kind: "package", url: npmPageUrl(p.pkg), label: `${p.pkg} (npm)` },
      evidenceUrl: npmPageUrl(p.pkg, pkg.version),
      title: `${p.pkg}@${pkg.version} (npm)`,
      meta: { systemSlug: p.systemSlug, file: `${p.pkg}@${pkg.version}`, pkg, peerDependencies } satisfies AntdDocMeta,
      priority: 0,
    },
    {
      url: rawUrl(p, pkg.ref, p.licenseFile),
      docKind: DOC_KINDS.license,
      source: { kind: "repository", url: `https://github.com/${p.repo.owner}/${p.repo.name}`, label: `${p.repo.owner}/${p.repo.name}` },
      evidenceUrl: blobUrl(p, pkg.ref, p.licenseFile),
      title: `${p.repo.name} ${p.licenseFile}`,
      meta: { systemSlug: p.systemSlug, file: p.licenseFile, pkg } satisfies AntdDocMeta,
      priority: 0,
    },
  ];
}

async function discoverAntd(ctx: AdapterContext): Promise<DiscoveredDocument[]> {
  const p = profileFor(SLUG_ANTD);
  const { pkg, manifestUrl, peerDependencies } = await resolvePackage(ctx, p);
  ctx.log.info(`antd: pinned ${p.pkg}@${pkg.version} (repo ref ${pkg.ref})`);
  const docs = baseDocs(p, pkg, manifestUrl, peerDependencies);
  const repoSource = { kind: "repository", url: `https://github.com/${p.repo.owner}/${p.repo.name}`, label: `${p.repo.owner}/${p.repo.name} (docs content)` };
  const npmSource = { kind: "package", url: npmPageUrl(p.pkg), label: `${p.pkg} (npm)` };
  const siteSource = { kind: "docs-site", url: `${p.docsOrigin}/`, label: "ant.design" };

  const sitemapUrl = `${p.docsOrigin}/sitemap.xml`;
  const [smRes, listing, slash] = await Promise.all([
    prefetch(ctx, sitemapUrl),
    listFiles(ctx.http, npmListingUrl(p.pkg, pkg.version)),
    trailingSlash(ctx, `${p.docsOrigin}/components/button`),
  ]);
  const files = new Set(listing.files);
  if (!files.size) ctx.log.warn(`antd: npm file listing unavailable (HTTP ${listing.status}); component-token alias parsing skipped`);
  const locs = smRes.ok && smRes.body ? [...smRes.body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]!) : [];
  const pathOf = (u: string) => {
    try {
      return new URL(u).pathname.replace(/\/+$/, "");
    } catch {
      return "";
    }
  };
  let componentSlugs = [...new Set(locs.map(pathOf).map((x) => /^\/components\/([a-z0-9_-]+)$/.exec(x)?.[1]).filter((s): s is string => !!s && !s.endsWith("-cn")))].filter((s) => !ANTD_NON_COMPONENT_PAGES.has(s));
  const specSlugs = [...new Set(locs.map(pathOf).map((x) => /^\/docs\/spec\/([a-z0-9-]+)$/.exec(x)?.[1]).filter((s): s is string => !!s && !s.endsWith("-cn")))].sort();
  if (locs.length) {
    docs.push({ url: sitemapUrl, docKind: DOC_KINDS.sitemap, source: siteSource, evidenceUrl: sitemapUrl, title: "ant.design sitemap", meta: { systemSlug: p.systemSlug, file: "sitemap.xml", trailingSlash: slash } satisfies AntdDocMeta, priority: 1 });
  } else {
    ctx.log.warn(`antd: sitemap unavailable (HTTP ${smRes.status}); component list falls back to npm es/ directories, no spec pages`);
    componentSlugs = [...new Set([...files].map((f) => /^es\/([a-z0-9-]+)\/index\.d\.ts$/.exec(f)?.[1]).filter((s): s is string => !!s))].filter((s) => !["locale", "style", "theme", "version", "col", "row", "qrcode", "back-top"].includes(s));
  }
  const docsUrl = (path: string) => (locs.length ? `${p.docsOrigin}${path}${slash ? "/" : ""}` : null);

  // Component docs (prefetched: only pages that exist at this release are planned).
  const ordered = byPriority(componentSlugs, (s) => s, ANTD_PRIORITY);
  const wanted = ctx.limit && ctx.limit > 0 ? ordered.slice(0, ctx.limit) : ordered;
  const mdFile = (s: string) => `components/${s}/index.en-US.md`;
  const mdResults = await Promise.all(wanted.map(async (s) => ({ s, res: await prefetch(ctx, rawUrl(p, pkg.ref, mdFile(s))) })));
  const present = mdResults.filter((r) => r.res.ok && r.res.body);
  const missing = mdResults.filter((r) => !(r.res.ok && r.res.body)).map((r) => `${r.s} (HTTP ${r.res.status})`);
  if (missing.length) ctx.log.warn(`antd: no ${mdFile("<dir>")} at ${pkg.ref} for: ${missing.join(", ")}`);
  present.forEach(({ s, res }, i) => {
    docs.push({
      url: rawUrl(p, pkg.ref, mdFile(s)),
      docKind: DOC_KINDS.componentMd,
      source: repoSource,
      evidenceUrl: blobUrl(p, pkg.ref, mdFile(s)),
      title: `${s} docs (${pkg.ref})`,
      meta: { systemSlug: p.systemSlug, file: mdFile(s), slug: s, dir: s, docsUrl: docsUrl(`/components/${s}`), order: i, pkg } satisfies AntdDocMeta,
      priority: 10 + i,
    });
    // First non-debug demo source(s) as MIT-licensed code examples (jsDelivr GitHub mirror: separate host).
    const doc = parseDoc(res.body!);
    const demos = doc.demos.filter((d) => !d.debug && /^\.\/demo\/[A-Za-z0-9_-]+\.tsx$/.test(d.src)).slice(0, MAX_CODE_EXAMPLES);
    for (const d of demos) {
      const file = `components/${s}/${d.src.replace(/^\.\//, "")}`;
      const base = d.src.replace(/^.*\//, "").replace(/\.tsx$/, "");
      docs.push({
        url: ghCdnUrl(p, pkg.ref, file),
        docKind: DOC_KINDS.demo,
        source: repoSource,
        evidenceUrl: blobUrl(p, pkg.ref, file),
        title: `${s} demo ${base}`,
        meta: { systemSlug: p.systemSlug, file, slug: s, demo: base, demoTitle: d.title, anchor: `${s}-demo-${base}`, pkg } satisfies AntdDocMeta,
        priority: 30 + i,
      });
    }
  });

  // Spec (design) pages.
  const specWanted = ctx.limit && ctx.limit > 0 ? uniqStrings(["values", "introduce", ...specSlugs]).filter((s) => specSlugs.includes(s)).slice(0, ctx.limit + 2) : specSlugs;
  const specFile = (s: string) => `docs/spec/${s}.en-US.md`;
  const specResults = await Promise.all(specWanted.map(async (s) => ({ s, res: await prefetch(ctx, rawUrl(p, pkg.ref, specFile(s))) })));
  specResults
    .filter((r) => r.res.ok && r.res.body)
    .forEach(({ s }, i) => {
      docs.push({
        url: rawUrl(p, pkg.ref, specFile(s)),
        docKind: DOC_KINDS.specMd,
        source: repoSource,
        evidenceUrl: blobUrl(p, pkg.ref, specFile(s)),
        title: `spec ${s} (${pkg.ref})`,
        meta: { systemSlug: p.systemSlug, file: specFile(s), slug: s, docsUrl: docsUrl(`/docs/spec/${s}`), order: i, pkg } satisfies AntdDocMeta,
        priority: 20 + i,
      });
    });

  // npm token + type files.
  const npmDoc = (file: string, docKind: string, priority: number, extra: Partial<AntdDocMeta> = {}) => {
    if (files.size && !files.has(file)) {
      ctx.log.warn(`antd: ${p.pkg}@${pkg.version} has no ${file}`);
      return;
    }
    const url = npmFileUrl(p.pkg, pkg.version, file);
    docs.push({ url, docKind, source: npmSource, evidenceUrl: url, title: `${p.pkg}@${pkg.version}/${file}`, meta: { systemSlug: p.systemSlug, file, pkg, ...extra } satisfies AntdDocMeta, priority });
  };
  npmDoc("es/version/token-meta.json", DOC_KINDS.tokenMeta, 2);
  npmDoc("es/version/token.json", DOC_KINDS.tokenJson, 2);
  npmDoc("dist/antd.css", DOC_KINDS.distCss, 2);
  npmDoc("es/theme/themes/seed.js", DOC_KINDS.seedJs, 3);
  npmDoc("es/theme/util/alias.js", DOC_KINDS.aliasJs, 3);
  npmDoc("es/theme/interface/presetColors.d.ts", DOC_KINDS.presetColorsDts, 3);
  npmDoc("es/index.d.ts", DOC_KINDS.indexDts, 3);
  // Component token -> global token aliases (prepareComponentToken), for documented component dirs.
  if (files.size) {
    present.forEach(({ s }, i) => {
      const file = [`es/${s}/style/token.js`, `es/${s}/style/index.js`].find((f) => files.has(f));
      if (file) npmDoc(file, DOC_KINDS.styleTokenJs, 40 + i, { slug: s, dir: s });
    });
  }
  return docs;
}

async function discoverMobile(ctx: AdapterContext): Promise<DiscoveredDocument[]> {
  const p = profileFor(SLUG_MOBILE);
  const { pkg, manifestUrl, peerDependencies } = await resolvePackage(ctx, p);
  ctx.log.info(`antd-mobile: pinned ${p.pkg}@${pkg.version} (repo ref ${pkg.ref})`);
  const docs = baseDocs(p, pkg, manifestUrl, peerDependencies);
  const repoSource = { kind: "repository", url: `https://github.com/${p.repo.owner}/${p.repo.name}`, label: `${p.repo.owner}/${p.repo.name} (docs content)` };
  const npmSource = { kind: "package", url: npmPageUrl(p.pkg), label: `${p.pkg} (npm)` };

  const navFile = "config/components.ts";
  const [navRes, ghList, npmList, slash] = await Promise.all([
    prefetch(ctx, rawUrl(p, pkg.ref, navFile)),
    listFiles(ctx.http, `https://data.jsdelivr.com/v1/packages/gh/${p.repo.owner}/${p.repo.name}@${pkg.ref}?structure=flat`),
    listFiles(ctx.http, npmListingUrl(p.pkg, pkg.version)),
    trailingSlash(ctx, `${p.docsOrigin}/components/button`),
  ]);
  if (!navRes.ok || !navRes.body) throw new Error(`antd-mobile: ${navFile} unavailable at ${pkg.ref} (HTTP ${navRes.status})`);
  const repoFiles = new Set(ghList.files);
  const npmFiles = new Set(npmList.files);
  if (!repoFiles.size) ctx.log.warn(`antd-mobile: repository listing unavailable (HTTP ${ghList.status}); docs files resolved by probing`);
  docs.push({ url: rawUrl(p, pkg.ref, navFile), docKind: DOC_KINDS.mobileNav, source: repoSource, evidenceUrl: blobUrl(p, pkg.ref, navFile), title: "antd-mobile docs navigation", meta: { systemSlug: p.systemSlug, file: navFile, pkg } satisfies AntdDocMeta, priority: 1 });

  const groups = parseMobileNav(navRes.body);
  const routes: { name: string; route: string; group: string }[] = [];
  const seen = new Set<string>();
  for (const g of groups)
    for (const r of g.routes) {
      const m = /^\/components\/([a-z0-9-]+)$/.exec(r);
      if (!m || seen.has(m[1]!)) continue;
      seen.add(m[1]!);
      routes.push({ name: m[1]!, route: r, group: g.group });
    }
  const ordered = byPriority(routes, (r) => r.name, MOBILE_PRIORITY);
  const wanted = ctx.limit && ctx.limit > 0 ? ordered.slice(0, ctx.limit) : ordered;
  const candidatesFor = (n: string) => [`src/components/${n}/index.en.md`, `src/components/${n}/${n}.en.md`, `docs/components/${n}/index.en.md`];
  let order = 0;
  for (const r of wanted) {
    let file = candidatesFor(r.name).find((f) => repoFiles.has(f)) ?? null;
    if (!file && !repoFiles.size) {
      for (const c of candidatesFor(r.name)) {
        const res = await prefetch(ctx, rawUrl(p, pkg.ref, c));
        if (res.ok && res.body) {
          file = c;
          break;
        }
      }
    }
    if (!file) {
      ctx.log.warn(`antd-mobile: no English docs file for ${r.route} at ${pkg.ref}`);
      continue;
    }
    const i = order++;
    docs.push({
      url: rawUrl(p, pkg.ref, file),
      docKind: DOC_KINDS.mobileComponentMd,
      source: repoSource,
      evidenceUrl: blobUrl(p, pkg.ref, file),
      title: `${r.name} docs (${pkg.ref})`,
      meta: { systemSlug: p.systemSlug, file, slug: r.name, route: r.route, group: r.group, docsUrl: `${p.docsOrigin}${r.route}${slash ? "/" : ""}`, order: i, pkg } satisfies AntdDocMeta,
      priority: 10 + i,
    });
    const dir = file.replace(/\/[^/]+$/, "");
    const demo = [`${dir}/demos/demo1.tsx`].find((f) => repoFiles.has(f));
    if (demo)
      docs.push({
        url: ghCdnUrl(p, pkg.ref, demo),
        docKind: DOC_KINDS.mobileDemo,
        source: repoSource,
        evidenceUrl: blobUrl(p, pkg.ref, demo),
        title: `${r.name} demo1`,
        meta: { systemSlug: p.systemSlug, file: demo, slug: r.name, demo: "demo1", pkg } satisfies AntdDocMeta,
        priority: 30 + i,
      });
  }

  const npmDoc = (file: string, docKind: string, priority: number, extra: Partial<AntdDocMeta> = {}) => {
    if (npmFiles.size && !npmFiles.has(file)) {
      ctx.log.warn(`antd-mobile: ${p.pkg}@${pkg.version} has no ${file}`);
      return;
    }
    const url = npmFileUrl(p.pkg, pkg.version, file);
    docs.push({ url, docKind, source: npmSource, evidenceUrl: url, title: `${p.pkg}@${pkg.version}/${file}`, meta: { systemSlug: p.systemSlug, file, pkg, ...extra } satisfies AntdDocMeta, priority });
  };
  npmDoc("es/global/theme-default.css", DOC_KINDS.mobileThemeCss, 2, { part: "default" });
  npmDoc("es/global/theme-dark.css", DOC_KINDS.mobileThemeCss, 2, { part: "dark" });
  npmDoc("es/index.d.ts", DOC_KINDS.mobileIndexDts, 3);
  const guide = "docs/guide/theming.en.md";
  if (!repoFiles.size || repoFiles.has(guide))
    docs.push({
      url: rawUrl(p, pkg.ref, guide),
      docKind: DOC_KINDS.mobileGuideMd,
      source: repoSource,
      evidenceUrl: blobUrl(p, pkg.ref, guide),
      title: "antd-mobile theming guide",
      meta: { systemSlug: p.systemSlug, file: guide, key: "theming", docsUrl: `${p.docsOrigin}/guide/theming${slash ? "/" : ""}`, pkg } satisfies AntdDocMeta,
      priority: 3,
    });
  return docs;
}

/* ----------------------------------- fetch ----------------------------------- */

async function fetchDoc(ctx: AdapterContext, doc: DiscoveredDocument, prev: { etag?: string | null; lastModified?: string | null; lastHash?: string | null }): Promise<FetchResult> {
  const cached = prefetched.get(doc.url);
  if (cached && cached.run === ctx.runStartedAt) {
    prefetched.delete(doc.url);
    return cached.result;
  }
  // dist/antd.css is ~1 MB; everything else is small.
  return ctx.http.get(doc.url, { etag: prev.etag, lastModified: prev.lastModified, lastHash: prev.lastHash, signal: ctx.signal, maxBytes: 20 * 1024 * 1024 });
}

/* ----------------------------------- parse ----------------------------------- */

function stampOf(ctx: AdapterContext, f: FetchedDocument): Stamp {
  const meta = (f.doc.meta ?? {}) as AntdDocMeta;
  return {
    url: f.doc.url,
    evidenceUrl: f.doc.evidenceUrl ?? f.result.finalUrl ?? f.doc.url,
    retrievedAt: f.result.fetchedAt ?? ctx.runStartedAt,
    hash: f.result.hash,
    file: meta.file ?? new URL(f.doc.url).pathname,
  };
}

async function parse(ctx: AdapterContext, fetched: FetchedDocument): Promise<ParsedFragment | null> {
  const { doc, result } = fetched;
  const body = result.body;
  if (body === null) return null;
  const meta = (doc.meta ?? {}) as AntdDocMeta;
  const stamp = stampOf(ctx, fetched);
  const frag = (data: AntdFragment, warnings?: string[]): ParsedFragment => ({ docUrl: doc.url, docKind: doc.docKind, data, warnings: warnings?.length ? warnings : undefined });
  switch (doc.docKind) {
    case DOC_KINDS.npmVersion: {
      const pkg = { ...meta.pkg! };
      let peers: string[] = [];
      try {
        const j = JSON.parse(body) as { license?: string; peerDependencies?: Record<string, string> };
        if (typeof j.license === "string") pkg.license = j.license;
        peers = Object.keys(j.peerDependencies ?? {}).sort();
      } catch {
        /* keep discover-time data */
      }
      return frag({ t: "pkg", stamp: { ...stamp, file: `${pkg.name}@${pkg.version}` }, pkg, peers });
    }
    case DOC_KINDS.license: {
      const m = /^\s*(Copyright \(c\)[^\n]+?)\s*$/im.exec(body);
      return frag({ t: "license", stamp, copyright: m ? m[1]!.trim().replace(/,?\s*https?:\/\/\S+$/, "").replace(/\.$/, "") : null, spdx: /\bMIT\b/.test(body.slice(0, 200)) ? "MIT" : null });
    }
    case DOC_KINDS.sitemap: {
      const locs = [...body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]!);
      const paths = locs.map((u) => {
        try {
          return new URL(u).pathname.replace(/\/+$/, "");
        } catch {
          return "";
        }
      });
      const components = [...new Set(paths.map((x) => /^\/components\/([a-z0-9_-]+)$/.exec(x)?.[1]).filter((s): s is string => !!s && !s.endsWith("-cn")))].sort();
      const spec = [...new Set(paths.map((x) => /^\/docs\/spec\/([a-z0-9-]+)$/.exec(x)?.[1]).filter((s): s is string => !!s && !s.endsWith("-cn")))].sort();
      return frag({ t: "sitemap", stamp, components, spec, trailingSlash: meta.trailingSlash ?? false });
    }
    case DOC_KINDS.componentMd:
      return frag({ t: "component-doc", stamp, slug: meta.slug!, dir: meta.dir!, docsUrl: meta.docsUrl ?? null, order: meta.order ?? 0, doc: parseDoc(body) });
    case DOC_KINDS.specMd:
      return frag({ t: "spec-doc", stamp, slug: meta.slug!, docsUrl: meta.docsUrl ?? `${PROFILES[SLUG_ANTD]!.docsOrigin}/docs/spec/${meta.slug}`, doc: parseDoc(body) });
    case DOC_KINDS.demo:
    case DOC_KINDS.mobileDemo: {
      const code = body.replace(/\r\n/g, "\n").trim();
      return frag({ t: "demo", stamp, slug: meta.slug!, demo: meta.demo!, title: meta.demoTitle ?? null, code: code.length <= MAX_CODE_CHARS ? code : null, anchor: meta.anchor ?? null }, code.length > MAX_CODE_CHARS ? [`demo ${meta.file} is ${code.length} chars (> ${MAX_CODE_CHARS}); code not stored`] : undefined);
    }
    case DOC_KINDS.tokenMeta:
      return frag({ t: "token-meta", stamp, meta: parseTokenMeta(body) });
    case DOC_KINDS.tokenJson:
      return frag({ t: "token-json", stamp, entries: parseTokenJson(body) });
    case DOC_KINDS.distCss: {
      const css = parseDistCss(body);
      return frag({ t: "dist-css", stamp, css }, css.scope ? undefined : ["no default theme scope (.css-var-*) found in dist/antd.css"]);
    }
    case DOC_KINDS.seedJs: {
      const r = parseSeedJs(body);
      return frag({ t: "seed-js", stamp, values: r.values, presetColors: r.presetColors }, Object.keys(r.values).length ? undefined : ["no seedToken literals parsed"]);
    }
    case DOC_KINDS.aliasJs: {
      const r = parseAliasJs(body);
      return frag({ t: "alias-js", stamp, consts: r.consts, entries: r.entries });
    }
    case DOC_KINDS.presetColorsDts: {
      const r = parsePresetColorsDts(body);
      return frag({ t: "preset-dts", stamp, presets: r.presets, palettes: r.palettes });
    }
    case DOC_KINDS.indexDts:
      return frag({ t: "index-dts", stamp, exports: parseIndexExports(body, "./") });
    case DOC_KINDS.mobileIndexDts:
      return frag({ t: "index-dts", stamp, exports: parseIndexExports(body, "./components/") });
    case DOC_KINDS.styleTokenJs:
      return frag({ t: "style-refs", stamp, component: meta.slug!, refs: parseComponentTokenRefs(body) });
    case DOC_KINDS.mobileNav:
      return frag({ t: "m-nav", stamp, groups: parseMobileNav(body) });
    case DOC_KINDS.mobileComponentMd:
      return frag({ t: "m-component-doc", stamp, slug: meta.slug!, route: meta.route!, docsUrl: meta.docsUrl!, group: meta.group ?? null, order: meta.order ?? 0, doc: parseDoc(body) });
    case DOC_KINDS.mobileThemeCss:
      return frag({ t: "m-theme-css", stamp, part: meta.part ?? "default", theme: parseMobileThemeCss(body) });
    case DOC_KINDS.mobileGuideMd: {
      const d = parseDoc(body);
      const deprecatedVars = [...body.matchAll(/(--adm-[a-z0-9-]+)\s+variable has been deprecated since version\s+([0-9.]+)[^.]*?(?:replace it with\s+(--adm-[a-z0-9-]+))?/gi)].map((m) => ({ name: m[1]!, since: m[2] ?? null, replacement: m[3] ?? null }));
      return frag({ t: "m-guide", stamp, key: meta.key ?? "guide", docsUrl: meta.docsUrl!, doc: d, deprecatedVars });
    }
    default:
      ctx.log.warn(`antd: unknown docKind ${doc.docKind}`);
      return null;
  }
}

/* ---------------------------------- adapter ---------------------------------- */

export const adapter: SourceAdapter = {
  id: ADAPTER_ID,
  version: "1.0.0",
  systems: SYSTEMS,
  description:
    "Ant Design + Ant Design Mobile: repo docs markdown at the release tag (frontmatter, API/Props tables, demos, CSS Variables tables, spec pages, mobile nav config), antd npm token-meta.json/token.json/dist CSS custom properties/seed + alias sources, antd-mobile theme CSS (npm via jsDelivr, pinned to latest), ant.design sitemap.",
  discover(ctx) {
    return ctx.systemSlug === SLUG_MOBILE ? discoverMobile(ctx) : discoverAntd(ctx);
  },
  fetch: fetchDoc,
  parse,
  async normalize(ctx, fragments): Promise<NormalizedBundle> {
    const data = fragments.map((f) => f.data as AntdFragment).filter((d) => d && typeof d === "object" && "t" in d);
    const log = (m: string) => ctx.log.warn(`antd: ${m}`);
    const bundle = ctx.systemSlug === SLUG_MOBILE ? normalizeMobile(ctx.systemSlug, data, { limit: ctx.limit, log }) : normalizeAntd(ctx.systemSlug, data, { limit: ctx.limit, log });
    ctx.log.info(`antd normalized ${ctx.systemSlug}: ${bundle.components.length} components, ${bundle.tokenSets.reduce((n, s) => n + s.tokens.length, 0)} tokens, ${bundle.patterns.length} patterns`);
    return bundle;
  },
  validate(ctx, bundle) {
    return validateAntdBundle(bundle, { systemSlug: ctx.systemSlug, limit: ctx.limit });
  },
};
