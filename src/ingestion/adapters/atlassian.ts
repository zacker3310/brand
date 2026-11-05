/**
 * Atlassian Design System adapter ("atlassian").
 *
 * Sources (first-party, machine-readable first; see atlassian/constants.ts for details):
 *  - @atlaskit/tokens (npm, pinned via the registry `latest` manifest): codegen artifacts
 *    tokens-raw/*.js, palettes-raw/*.js and token-names.js via jsDelivr, parsed as JSON literals.
 *  - registry.npmjs.org `latest` manifests of every documented @atlaskit package (version,
 *    peerDependencies, `atlassian.website` status) and the @atlaskit/button packument (release time).
 *  - atlassian.design (static Gatsby HTML; no robots.txt): side navigation, per-component Code tab
 *    (installation table + generated props tables), Examples tab (documented headings) and Usage tab
 *    (accessibility, behavior, related), content-guidance pages (patterns), About page (principles).
 *  - atlassian.design/llms-components.txt: explicit release status per export.
 *
 * The Atlassian Design System License Agreement forbids redistribution: no code examples are stored,
 * descriptions are short excerpts, token sets are marked redistribution "restricted".
 */
import type { NormalizedBundle } from "@/lib/contracts";
import type { FetchResult } from "../http";
import { npmFileUrl } from "../http";
import type { AdapterContext, DiscoveredDocument, FetchedDocument, ParsedFragment, SourceAdapter } from "../types";
import {
  ABOUT_URL,
  ADAPTER_ID,
  COMPONENT_TABS,
  COMPONENTS_INDEX_URL,
  DOC_KINDS,
  DOCS_ORIGIN,
  LICENSE_URL,
  LLMS_COMPONENTS_URL,
  MESSAGES_URL,
  PATTERN_FIXED_PATHS,
  PATTERN_PREFIXES,
  REPRESENTATIVE_PKG,
  SYSTEM_SLUG,
  TOKEN_NAMES_FILE,
  TOKEN_SETS,
  TOKENS_PKG,
  npmManifestUrl,
  npmPackumentUrl,
  npmPageUrl,
} from "./atlassian/constants";
import type { AtlDocMeta, AtlFragmentData, PinnedPackage, SourceStamp } from "./atlassian/fragments";
import { parseDocsPage, parseIndexPage, parseRedirectStub, type NavEntry } from "./atlassian/html";
import { parseLlmsComponents } from "./atlassian/llms";
import { normalizeAtlassian, selectComponentEntries } from "./atlassian/normalize";
import { parseNpmManifest, parseNpmPackument } from "./atlassian/npm";
import { docsPath, uniq } from "./atlassian/text";
import { parseTokenNames, parseTokensRaw } from "./atlassian/tokens";
import { validateAtlassianBundle } from "./atlassian/validate";

/** Bodies fetched during discover(), handed to fetch() once to avoid duplicate downloads in one run. */
const prefetched = new Map<string, FetchResult>();

const isNotFoundHtml = (body: string) => /property="og:url" content="https:\/\/atlassian\.design\/404"/.test(body.slice(0, 20_000));

async function prefetch(ctx: AdapterContext, url: string): Promise<FetchResult> {
  const res = await ctx.http.get(url, { signal: ctx.signal });
  if (res.ok && res.body !== null) prefetched.set(url, res);
  return res;
}

/** Tab paths from a component page's `[role=tablist]` (cheap regex scan; full parsing happens in parse()). */
export function tabPathsFromHtml(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<a\b[^>]*\brole="tab"[^>]*>/g)) {
    const href = /\bhref="([^"]+)"/.exec(m[0])?.[1];
    if (href && href.startsWith("/")) out.push(docsPath(href));
  }
  return uniq(out);
}

/** Package named in the code tab's installation table (first npm link after "Installation"). */
export function packageFromCodeHtml(html: string): string | null {
  const i = html.indexOf('id="installation"');
  const seg = i >= 0 ? html.slice(i, i + 20_000) : html;
  return /href="https:\/\/www\.npmjs\.com\/package\/(@atlaskit\/[a-z0-9._-]+)"/.exec(seg)?.[1] ?? null;
}

interface ComponentPlan {
  entry: NavEntry;
  tabs: { tab: string; path: string }[];
  packageName: string | null;
  /** Navigation entries nested under this component (visible only on its own pages). */
  children: NavEntry[];
}

async function planComponent(ctx: AdapterContext, entry: NavEntry): Promise<ComponentPlan> {
  const codeUrl = `${DOCS_ORIGIN}${entry.path}/code`;
  let first: { url: string; html: string } | null = null;
  const res = await prefetch(ctx, codeUrl);
  if (res.ok && res.body && !isNotFoundHtml(res.body)) first = { url: codeUrl, html: res.body };
  else {
    prefetched.delete(codeUrl);
    // No code tab: follow the base path's redirect stub to the default tab.
    const stub = await ctx.http.get(`${DOCS_ORIGIN}${entry.path}`, { signal: ctx.signal });
    const target = stub.ok && stub.body ? parseRedirectStub(stub.body) : null;
    if (target && target.startsWith(`${entry.path}/`)) {
      const url = `${DOCS_ORIGIN}${target}`;
      const r2 = await prefetch(ctx, url);
      if (r2.ok && r2.body && !isNotFoundHtml(r2.body)) first = { url, html: r2.body };
      else prefetched.delete(url);
    }
  }
  if (!first) {
    ctx.log.warn(`atlassian: no readable docs tab for ${entry.path}`);
    return { entry, tabs: [], packageName: null, children: [] };
  }
  const paths = uniq([docsPath(first.url), ...tabPathsFromHtml(first.html)]);
  const tabs = paths
    .filter((p) => p.startsWith(`${entry.path}/`) && !p.slice(entry.path.length + 1).includes("/"))
    .map((p) => ({ tab: p.slice(entry.path.length + 1), path: p }))
    .filter((t) => (COMPONENT_TABS as readonly string[]).includes(t.tab));
  const children = /aria-expanded="true"/.test(first.html) ? parseIndexPage(first.html).entries.filter((e) => e.path.startsWith(`${entry.path}/`)) : [];
  return { entry, tabs, packageName: first.url === codeUrl ? packageFromCodeHtml(first.html) : null, children };
}

export const adapter: SourceAdapter = {
  id: ADAPTER_ID,
  version: "1.0.0",
  systems: [SYSTEM_SLUG],
  description:
    "Atlassian Design System: @atlaskit/tokens codegen artifacts (tokens-raw/palettes-raw JSON literals, token-names CSS vars; light/dark/increased-contrast themes + base palettes); @atlaskit/* npm manifests; atlassian.design static HTML (navigation, code-tab props tables, examples, usage/accessibility, content guidance, principles); llms-components.txt release status.",

  async discover(ctx) {
    const docs: DiscoveredDocument[] = [];
    const docsSource = { kind: "docs", url: `${DOCS_ORIGIN}/`, label: "atlassian.design" };
    const npmSource = (pkg: string) => ({ kind: "package", url: npmPageUrl(pkg), label: `${pkg} (npm)` });

    // 1. Components index (side navigation drives the component list)
    const idx = await prefetch(ctx, COMPONENTS_INDEX_URL);
    if (!idx.ok || !idx.body) throw new Error(`${COMPONENTS_INDEX_URL}: HTTP ${idx.status} ${idx.error ?? ""}`);
    const { entries, navPaths } = parseIndexPage(idx.body);
    const selected = selectComponentEntries(entries, ctx.limit);
    if (!selected.length) throw new Error("atlassian: no component entries found in the atlassian.design navigation");
    docs.push({ url: COMPONENTS_INDEX_URL, docKind: DOC_KINDS.index, source: docsSource, title: "atlassian.design components", evidenceUrl: COMPONENTS_INDEX_URL, priority: 0 });

    // 2. @atlaskit/tokens version pin
    const tokManifestUrl = npmManifestUrl(TOKENS_PKG);
    const tokRes = await prefetch(ctx, tokManifestUrl);
    const tokInfo = tokRes.ok && tokRes.body ? parseNpmManifest(tokRes.body) : null;
    if (!tokInfo) ctx.log.warn(`atlassian: ${TOKENS_PKG} manifest unavailable (HTTP ${tokRes.status} ${tokRes.error ?? ""}); tokens skipped`);

    // 3. Per-component docs tabs (code tab first: it names the npm package and lists the tabs). Sub-pages
    //    (e.g. Button > Icon button) only appear in the navigation of their parent's pages: second wave.
    const plans = await Promise.all(selected.map((e) => planComponent(ctx, e)));
    const planned = new Set(plans.map((p) => p.entry.path));
    const withChildren = selectComponentEntries([...entries, ...plans.flatMap((p) => p.children)], ctx.limit).filter((e) => !planned.has(e.path));
    plans.push(...(await Promise.all(withChildren.map((e) => planComponent(ctx, e)))));
    ctx.log.info(`atlassian: ${selected.length} components planned (${plans.filter((p) => p.tabs.length).length} with docs tabs)`);
    let i = 0;
    for (const plan of plans) {
      for (const t of plan.tabs) {
        const url = `${DOCS_ORIGIN}${t.path}`;
        docs.push({
          url,
          docKind: DOC_KINDS.componentPage,
          source: docsSource,
          title: `${plan.entry.name} (${t.tab})`,
          evidenceUrl: url,
          meta: { componentPath: plan.entry.path, tab: t.tab } satisfies AtlDocMeta,
          priority: 10 + i++,
        });
      }
    }

    // 4. npm manifests of documented packages (the representative package as a packument, for its release time)
    const pkgs = uniq([REPRESENTATIVE_PKG, ...plans.map((p) => p.packageName).filter((p): p is string => !!p)]).sort();
    for (const pkg of pkgs) {
      const packument = pkg === REPRESENTATIVE_PKG;
      docs.push({
        url: packument ? npmPackumentUrl(pkg) : npmManifestUrl(pkg),
        docKind: packument ? DOC_KINDS.npmPackument : DOC_KINDS.npmManifest,
        source: npmSource(pkg),
        title: `${pkg} npm ${packument ? "packument" : "latest manifest"}`,
        evidenceUrl: npmPageUrl(pkg),
        meta: { packageName: pkg } satisfies AtlDocMeta,
        priority: 5,
      });
    }

    // 5. Generated component index (explicit release status)
    docs.push({ url: LLMS_COMPONENTS_URL, docKind: DOC_KINDS.llms, source: docsSource, title: "llms-components.txt", evidenceUrl: LLMS_COMPONENTS_URL, priority: 3 });

    // 6. Tokens (pinned)
    if (tokInfo) {
      const npm: PinnedPackage = { packageName: TOKENS_PKG, version: tokInfo.version };
      const tokSource = npmSource(TOKENS_PKG);
      docs.push({ url: tokManifestUrl, docKind: DOC_KINDS.npmManifest, source: tokSource, title: `${TOKENS_PKG} npm latest manifest`, evidenceUrl: npmPageUrl(TOKENS_PKG), meta: { packageName: TOKENS_PKG } satisfies AtlDocMeta, priority: 1 });
      for (const spec of TOKEN_SETS) {
        const url = npmFileUrl(TOKENS_PKG, tokInfo.version, spec.file);
        docs.push({ url, docKind: DOC_KINDS.tokensRaw, source: tokSource, title: `${TOKENS_PKG}@${tokInfo.version}/${spec.file}`, evidenceUrl: url, meta: { setSlug: spec.slug, file: spec.file, npm } satisfies AtlDocMeta, priority: 2 });
      }
      const namesUrl = npmFileUrl(TOKENS_PKG, tokInfo.version, TOKEN_NAMES_FILE);
      docs.push({ url: namesUrl, docKind: DOC_KINDS.tokenNames, source: tokSource, title: `${TOKENS_PKG}@${tokInfo.version}/${TOKEN_NAMES_FILE}`, evidenceUrl: namesUrl, meta: { file: TOKEN_NAMES_FILE, npm } satisfies AtlDocMeta, priority: 2 });
    }

    // 7. Guidance pages recorded as patterns (discovered through the content-guidance navigation)
    const msg = await prefetch(ctx, MESSAGES_URL);
    const guidePaths = new Set(navPaths);
    if (msg.ok && msg.body && !isNotFoundHtml(msg.body)) for (const p of parseIndexPage(msg.body).navPaths) guidePaths.add(p);
    else ctx.log.warn(`atlassian: ${MESSAGES_URL} unavailable (HTTP ${msg.status}); content guidance pages limited to the components navigation`);
    let patternPaths = [...guidePaths].filter((p) => PATTERN_FIXED_PATHS.includes(p) || PATTERN_PREFIXES.some((pre) => p.startsWith(pre))).sort();
    if (ctx.limit) patternPaths = patternPaths.slice(0, ctx.limit);
    for (const p of patternPaths) {
      const url = `${DOCS_ORIGIN}${p}`;
      docs.push({ url, docKind: DOC_KINDS.guidancePage, source: docsSource, title: p, evidenceUrl: url, priority: 200 });
    }
    if (!patternPaths.includes(docsPath(MESSAGES_URL))) prefetched.delete(MESSAGES_URL);

    // 8. System pages
    docs.push({ url: ABOUT_URL, docKind: DOC_KINDS.systemPage, source: docsSource, title: "About the design system", evidenceUrl: ABOUT_URL, meta: { key: "about" } satisfies AtlDocMeta, priority: 4 });
    docs.push({ url: LICENSE_URL, docKind: DOC_KINDS.systemPage, source: docsSource, title: "ADS License", evidenceUrl: LICENSE_URL, meta: { key: "license" } satisfies AtlDocMeta, priority: 4 });
    return docs;
  },

  async fetch(ctx, doc, prev) {
    const pre = prefetched.get(doc.url);
    if (pre) {
      prefetched.delete(doc.url);
      return pre;
    }
    return ctx.http.get(doc.url, { etag: prev.etag, lastModified: prev.lastModified, lastHash: prev.lastHash, signal: ctx.signal, ...(doc.docKind === DOC_KINDS.npmPackument ? { maxBytes: 60 * 1024 * 1024, timeoutMs: 60_000 } : {}) });
  },

  async parse(ctx, fetched: FetchedDocument): Promise<ParsedFragment | null> {
    const { doc, result } = fetched;
    const body = result.body;
    if (body === null) return null;
    const meta = (doc.meta ?? {}) as AtlDocMeta;
    const stamp: SourceStamp = { url: doc.url, evidenceUrl: doc.evidenceUrl ?? doc.url, retrievedAt: result.fetchedAt ?? ctx.runStartedAt, hash: result.hash };
    const frag = (data: AtlFragmentData, warnings?: string[]): ParsedFragment => ({ docUrl: doc.url, docKind: doc.docKind, data, warnings: warnings?.length ? warnings : undefined });

    switch (doc.docKind) {
      case DOC_KINDS.index: {
        const { entries, navPaths } = parseIndexPage(body);
        return frag({ type: "index", stamp, entries, navPaths }, entries.length ? undefined : ["no navigation entries"]);
      }
      case DOC_KINDS.componentPage: {
        const page = parseDocsPage(body, doc.url, { code: meta.tab === "code", navUnder: meta.componentPath });
        return frag({ type: "component-page", stamp, componentPath: meta.componentPath ?? docsPath(doc.url), tab: meta.tab ?? "examples", page }, page.notFound ? ["404 page"] : undefined);
      }
      case DOC_KINDS.npmManifest:
      case DOC_KINDS.npmPackument: {
        const packument = doc.docKind === DOC_KINDS.npmPackument;
        const info = packument ? parseNpmPackument(body) : parseNpmManifest(body);
        return frag({ type: "npm", stamp, packageName: meta.packageName ?? info?.name ?? "", packument, info }, info ? undefined : ["unparseable npm metadata"]);
      }
      case DOC_KINDS.llms:
        return frag({ type: "llms", stamp, entries: parseLlmsComponents(body) });
      case DOC_KINDS.tokensRaw: {
        const tokens = parseTokensRaw(body);
        return frag({ type: "tokens", stamp, setSlug: meta.setSlug!, file: meta.file!, npm: meta.npm!, tokens });
      }
      case DOC_KINDS.tokenNames:
        return frag({ type: "token-names", stamp, file: meta.file!, npm: meta.npm!, map: parseTokenNames(body) });
      case DOC_KINDS.guidancePage:
        return frag({ type: "guidance-page", stamp, page: parseDocsPage(body, doc.url) });
      case DOC_KINDS.systemPage:
        return frag({ type: "system-page", stamp, key: meta.key ?? "other", page: parseDocsPage(body, doc.url) });
      default:
        ctx.log.warn(`atlassian: unknown docKind ${doc.docKind}`);
        return null;
    }
  },

  async normalize(ctx, fragments): Promise<NormalizedBundle> {
    const data = fragments.map((f) => f.data as AtlFragmentData).filter((d) => d && typeof d === "object" && "type" in d);
    return normalizeAtlassian(data, { systemSlug: ctx.systemSlug, limit: ctx.limit, log: (m) => ctx.log.warn(`atlassian: ${m}`) });
  },

  validate(ctx, bundle) {
    return validateAtlassianBundle(bundle, { limit: ctx.limit });
  },
};
