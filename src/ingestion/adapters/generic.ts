/**
 * Generic metadata-level adapter ("generic").
 *
 * Gives every verified registry system WITHOUT a dedicated adapter real component-level coverage at
 * METADATA level: component name, human docs URL and (when statically present and specific to the
 * page) a short meta description. Canonical type is always heuristic ("inferred"); frameworks come
 * from the researched target config; every other field is "not-extracted".
 *
 * Per-system sources are researched in ./generic/targets-*.ts (contract: ./generic/types.ts):
 *  - sitemap:      sitemap / sitemap index (explicit URL, robots.txt Sitemap: lines, or /sitemap.xml)
 *  - nav:          links inside an official docs index page (static HTML, optional CSS selector)
 *  - repo-listing: jsDelivr flat file listing of a GitHub repo or npm package + docs URL template
 * All requests go through PoliteFetcher (robots.txt, rate limits). Static parsing only.
 */
import type { NormalizedBundle } from "@/lib/contracts";
import { stableStringify } from "@/lib/utils";
import type { FetchResult } from "../http";
import { sha256 } from "../http";
import type { AdapterContext, DiscoveredDocument, FetchedDocument, ParsedFragment, SourceAdapter } from "../types";
import { compileTarget, extractNavLinks, isMarkdownDoc, normalizeUrl, parseListing, parseMarkdownMeta, parsePageMeta, parseSitemapXml, parseStorybookIndex, selectCandidates, type Candidate } from "./generic/extract";
import {
  ADAPTER_ID,
  DOC_KINDS,
  normalizeGeneric,
  planComponents,
  validateGeneric,
  type GenericFragment,
  type IndexFragment,
  type PageFragment,
  type SourceStamp,
} from "./generic/normalize";
import { GENERIC_TARGETS } from "./generic/targets";
import type { GenericTarget } from "./generic/types";

const MAX_SITEMAPS = 40;
const MAX_SITEMAP_DEPTH = 3;
const SITEMAP_MAX_BYTES = 40 * 1024 * 1024;

/** Bodies fetched during discover(), handed to fetch() once to avoid duplicate downloads in one run. */
const prefetched = new Map<string, FetchResult>();

/** Target config changes alter parse output, so they are part of the adapter version (forces re-parse). */
const fingerprint = (targets: GenericTarget[]) => sha256(stableStringify(targets)).slice(0, 10);

export function targetFor(slug: string): GenericTarget | undefined {
  return GENERIC_TARGETS.find((t) => t.slug === slug);
}

function requireTarget(targets: GenericTarget[], slug: string): GenericTarget {
  const t = targets.find((x) => x.slug === slug);
  if (!t) throw new Error(`generic: no target configured for "${slug}"`);
  return t;
}

/** Origin of a target's docs: explicit URLs first, else the literal prefix of the include regex. */
export function targetOrigin(t: GenericTarget): string | null {
  for (const u of [t.sitemapUrl, t.navUrl, t.docsUrlTemplate]) {
    if (!u) continue;
    try {
      return new URL(u.replace(/\{segment\}/g, "x")).origin;
    } catch {
      /* ignore */
    }
  }
  const m = /^\^?(https?):\\?\/\\?\/((?:[a-z0-9-]|\\\.)+)/i.exec(t.include);
  return m ? `${m[1]}://${m[2]!.replace(/\\\./g, ".")}` : null;
}

const isExactVersion = (v: string) => /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(v);

async function resolveNpmVersion(ctx: AdapterContext, pkg: string, specifier: string): Promise<string> {
  const { data, res } = await ctx.http.getJson<{ version?: string | null }>(`https://data.jsdelivr.com/v1/packages/npm/${pkg}/resolved?specifier=${encodeURIComponent(specifier)}`);
  if (!data?.version) throw new Error(`generic: cannot resolve ${pkg}@${specifier} via jsDelivr (HTTP ${res.status} ${res.error ?? ""})`);
  return data.version;
}

/** jsDelivr listing URL with the ref pinned (npm dist-tags/ranges resolved to an exact version). */
async function resolveListing(ctx: AdapterContext, repo: NonNullable<GenericTarget["repo"]>): Promise<{ listingUrl: string; ref: string; evidenceUrl: string }> {
  if (repo.kind === "npm") {
    const version = isExactVersion(repo.ref) ? repo.ref : await resolveNpmVersion(ctx, repo.name, repo.ref || "latest");
    return {
      listingUrl: `https://data.jsdelivr.com/v1/packages/npm/${repo.name}@${version}?structure=flat`,
      ref: version,
      evidenceUrl: `https://www.npmjs.com/package/${repo.name}/v/${version}`,
    };
  }
  const [owner, name] = repo.name.split("/");
  if (!owner || !name) throw new Error(`generic: invalid GitHub repo "${repo.name}" (expected owner/repo)`);
  // "{npm:<pkg>}" in a gh ref resolves to that package's latest npm version, so a release tag
  // (immutable, unlike jsDelivr's cached branch listings) tracks new releases automatically.
  // "{latest}" resolves to the newest stable release tag jsDelivr knows for the repo (write the
  // repo's tag prefix around it, e.g. "v{latest}").
  let ref = repo.ref;
  for (const m of [...repo.ref.matchAll(/\{npm:([^}]+)\}/g)]) {
    const v = await resolveNpmVersion(ctx, m[1]!, "latest");
    ref = ref.replace(m[0], v);
  }
  if (ref.includes("{latest}")) {
    const { data, res } = await ctx.http.getJson<{ versions?: { version?: string }[] }>(`https://data.jsdelivr.com/v1/packages/gh/${owner}/${name}`);
    const latest = (data?.versions ?? []).map((v) => v.version ?? "").find((v) => isExactVersion(v) && !v.includes("-"));
    if (!latest) throw new Error(`generic: no stable release tag for ${repo.name} on jsDelivr (HTTP ${res.status} ${res.error ?? ""})`);
    ref = ref.replace(/\{latest\}/g, latest);
  }
  return {
    listingUrl: `https://data.jsdelivr.com/v1/packages/gh/${owner}/${name}@${encodeURIComponent(ref)}?structure=flat`,
    ref,
    evidenceUrl: `https://github.com/${owner}/${name}/tree/${ref}`,
  };
}

async function prefetch(ctx: AdapterContext, url: string, maxBytes?: number): Promise<FetchResult> {
  const res = await ctx.http.get(url, maxBytes ? { maxBytes } : {});
  if (res.ok && res.body !== null) prefetched.set(url, res);
  return res;
}

/** Candidates from a sitemap document: XML urlset, or a Storybook index.json/stories.json. */
export function sitemapCandidates(body: string, url: string, c: ReturnType<typeof compileTarget>): Candidate[] {
  const sm = parseSitemapXml(body);
  if (sm.kind === "urlset") return selectCandidates(sm.locs.map((u) => ({ value: normalizeUrl(u) ?? u })), c, { distinctPages: true });
  if (/^\s*[{[]/.test(body)) {
    const sb = parseStorybookIndex(body, url);
    if (sb) return selectCandidates(sb, c, { distinctPages: true });
  }
  return [];
}

interface IndexDoc {
  doc: DiscoveredDocument;
  candidates: Candidate[];
}

/** Sitemap strategy: follow sitemap indexes (bounded) and keep leaf sitemaps that list components. */
async function discoverSitemaps(ctx: AdapterContext, t: GenericTarget): Promise<IndexDoc[]> {
  const c = compileTarget(t);
  let roots: string[] = [];
  if (t.sitemapUrl) roots = [t.sitemapUrl];
  else {
    const origin = targetOrigin(t);
    if (!origin) throw new Error(`generic: ${t.slug} sitemap target has no sitemapUrl and no derivable origin`);
    const fromRobots = await ctx.http.sitemapsFor(origin);
    roots = fromRobots.length ? fromRobots : [`${origin}/sitemap.xml`];
  }
  const out: IndexDoc[] = [];
  const seen = new Set<string>();
  let queue = roots.map((u) => ({ url: u, depth: 0 }));
  while (queue.length && seen.size < MAX_SITEMAPS) {
    const next: typeof queue = [];
    for (const { url, depth } of queue) {
      if (seen.has(url) || seen.size >= MAX_SITEMAPS) continue;
      seen.add(url);
      if (/\.gz($|\?)/i.test(url)) {
        ctx.log.warn(`generic: ${t.slug}: skipping compressed sitemap ${url}`);
        continue;
      }
      const res = await prefetch(ctx, url, SITEMAP_MAX_BYTES);
      if (!res.ok || res.body === null) {
        ctx.log.warn(`generic: ${t.slug}: sitemap ${url} unavailable (${res.blockedByRobots ? "robots.txt disallows" : `HTTP ${res.status} ${res.error ?? ""}`})`);
        continue;
      }
      const sm = parseSitemapXml(res.body);
      if (sm.kind === "index") {
        prefetched.delete(url);
        if (depth < MAX_SITEMAP_DEPTH) next.push(...sm.locs.map((u) => ({ url: u, depth: depth + 1 })));
        continue;
      }
      const candidates = sitemapCandidates(res.body, url, c);
      if (!candidates.length) {
        prefetched.delete(url);
        continue;
      }
      out.push({
        doc: { url, docKind: DOC_KINDS.sitemap, source: { kind: "sitemap", url, label: `${new URL(url).host} sitemap` }, title: url, evidenceUrl: url, priority: 0 },
        candidates,
      });
    }
    queue = next;
  }
  if (seen.size >= MAX_SITEMAPS && queue.length) ctx.log.warn(`generic: ${t.slug}: sitemap traversal capped at ${MAX_SITEMAPS} files`);
  return out;
}

async function discoverNav(ctx: AdapterContext, t: GenericTarget): Promise<IndexDoc[]> {
  if (!t.navUrl) throw new Error(`generic: ${t.slug} nav target has no navUrl`);
  const res = await prefetch(ctx, t.navUrl);
  if (!res.ok || res.body === null) {
    throw new Error(`generic: ${t.slug}: nav page ${t.navUrl} unavailable (${res.blockedByRobots ? "robots.txt disallows" : `HTTP ${res.status} ${res.error ?? ""}`})`);
  }
  const links = extractNavLinks(res.body, res.finalUrl || t.navUrl, t.navSelector);
  const candidates = selectCandidates(links, compileTarget(t), { distinctPages: true });
  return [{ doc: { url: t.navUrl, docKind: DOC_KINDS.nav, source: { kind: "docs", url: t.navUrl, label: `${new URL(t.navUrl).host} docs index` }, title: t.navUrl, evidenceUrl: t.navUrl, priority: 0 }, candidates }];
}

async function discoverListing(ctx: AdapterContext, t: GenericTarget): Promise<IndexDoc[]> {
  if (!t.repo) throw new Error(`generic: ${t.slug} repo-listing target has no repo coordinates`);
  const r = await resolveListing(ctx, t.repo);
  const res = await prefetch(ctx, r.listingUrl);
  if (!res.ok || res.body === null) {
    throw new Error(`generic: ${t.slug}: listing ${r.listingUrl} unavailable (HTTP ${res.status} ${res.error ?? ""}; jsDelivr refuses listings for repos/packages > 50 MB)`);
  }
  const candidates = selectCandidates(parseListing(res.body).map((p) => ({ value: p })), compileTarget(t));
  const repoMeta = { kind: t.repo.kind, name: t.repo.name, ref: r.ref };
  return [
    {
      doc: {
        url: r.listingUrl,
        docKind: DOC_KINDS.listing,
        source: { kind: t.repo.kind === "gh" ? "repository" : "package", url: r.evidenceUrl, label: `${t.repo.name}@${r.ref}` },
        title: `${t.repo.name}@${r.ref} file listing`,
        evidenceUrl: r.evidenceUrl,
        meta: { repo: repoMeta },
        priority: 0,
      },
      candidates,
    },
  ];
}

const stampOf = (ctx: AdapterContext, doc: DiscoveredDocument, result: FetchResult): SourceStamp => ({
  url: doc.url,
  evidenceUrl: doc.evidenceUrl ?? doc.url,
  retrievedAt: result.fetchedAt ?? ctx.runStartedAt,
  hash: result.hash,
});

/** Per-run truncation counts (for validate()). */
const truncatedBySystem = new Map<string, number>();

/** Build the generic adapter over a target list (tests inject their own targets). */
export function createGenericAdapter(targets: GenericTarget[] = GENERIC_TARGETS): SourceAdapter {
  return {
    id: ADAPTER_ID,
    version: `1.0.0+${fingerprint(targets)}`,
    systems: targets.map((t) => t.slug),
    description:
      "Generic metadata-level adapter: component names, docs URLs and page-specific meta descriptions enumerated from each system's official sitemap, docs index page or repository/package file listing (researched per system); classification inferred; all other fields not-extracted.",

    async discover(ctx) {
      const t = requireTarget(targets, ctx.systemSlug);
      const indexDocs = t.strategy === "sitemap" ? await discoverSitemaps(ctx, t) : t.strategy === "nav" ? await discoverNav(ctx, t) : await discoverListing(ctx, t);
      const repoRef = (indexDocs[0]?.doc.meta as { repo?: { ref?: string } } | undefined)?.repo?.ref;
      const { planned, total, truncated } = planComponents(t, indexDocs.map((d) => d.candidates), ctx.limit, repoRef);
      truncatedBySystem.set(ctx.systemSlug, truncated);
      ctx.log.info(`generic: ${t.slug}: ${t.strategy} enumerated ${total} components (${planned.length} selected, ${planned.filter((p) => p.fetchPage).length} pages to fetch)`);
      if (!total) ctx.log.warn(`generic: ${t.slug}: no URLs/paths matched the include rule`);
      const docs: DiscoveredDocument[] = indexDocs.map((d) => d.doc);
      let i = 0;
      for (const p of planned) {
        if (!p.fetchPage || !p.fetchUrl || !p.docsUrl) continue;
        let origin: string;
        try {
          origin = new URL(p.docsUrl).origin;
          new URL(p.fetchUrl);
        } catch {
          continue;
        }
        const isRepoFile = p.fetchUrl !== p.docsUrl;
        docs.push({
          url: p.fetchUrl,
          docKind: DOC_KINDS.page,
          source: isRepoFile && t.repo ? { kind: t.repo.kind === "gh" ? "repository" : "package", url: (indexDocs[0]?.doc.source.url ?? origin + "/"), label: indexDocs[0]?.doc.source.label } : { kind: "docs", url: `${origin}/`, label: new URL(origin).host },
          title: p.docsUrl,
          evidenceUrl: p.docsUrl,
          meta: { key: p.key, segment: p.segment },
          priority: 10 + i++,
        });
      }
      return docs;
    },

    async fetch(ctx, doc, prev) {
      const pre = prefetched.get(doc.url);
      if (pre) {
        prefetched.delete(doc.url);
        return pre;
      }
      const maxBytes = doc.docKind === DOC_KINDS.sitemap ? SITEMAP_MAX_BYTES : undefined;
      return ctx.http.get(doc.url, { etag: prev.etag, lastModified: prev.lastModified, lastHash: prev.lastHash, signal: ctx.signal, ...(maxBytes ? { maxBytes } : {}) });
    },

    async parse(ctx, fetched: FetchedDocument): Promise<ParsedFragment | null> {
      const { doc, result } = fetched;
      const body = result.body;
      if (body === null) return null;
      const t = requireTarget(targets, ctx.systemSlug);
      const c = compileTarget(t);
      const stamp = stampOf(ctx, doc, result);
      const frag = (data: GenericFragment, warnings?: string[]): ParsedFragment => ({ docUrl: doc.url, docKind: doc.docKind, data, warnings: warnings?.length ? warnings : undefined });
      switch (doc.docKind) {
        case DOC_KINDS.sitemap: {
          const candidates = sitemapCandidates(body, doc.url, c);
          return frag({ type: "index", strategy: "sitemap", stamp, candidates } satisfies IndexFragment, candidates.length ? [] : ["no component URLs matched in sitemap"]);
        }
        case DOC_KINDS.nav: {
          const links = extractNavLinks(body, result.finalUrl || doc.url, t.navSelector);
          return frag({ type: "index", strategy: "nav", stamp, candidates: selectCandidates(links, c, { distinctPages: true }) } satisfies IndexFragment);
        }
        case DOC_KINDS.listing: {
          const repo = (doc.meta as { repo?: IndexFragment["repo"] } | undefined)?.repo;
          const candidates = selectCandidates(parseListing(body).map((p) => ({ value: p })), c);
          return frag({ type: "index", strategy: "repo-listing", stamp, candidates, repo } satisfies IndexFragment);
        }
        case DOC_KINDS.page: {
          const m = (doc.meta ?? {}) as { key?: string; segment?: string };
          if (!m.key || !m.segment) return null;
          const meta = isMarkdownDoc(doc.url, result.contentType) ? parseMarkdownMeta(body) : parsePageMeta(body, result.finalUrl || doc.url);
          return frag({ type: "page", key: m.key, segment: m.segment, stamp, finalUrl: result.finalUrl || doc.url, status: result.status, meta } satisfies PageFragment);
        }
        default:
          ctx.log.warn(`generic: unknown docKind ${doc.docKind}`);
          return null;
      }
    },

    async normalize(ctx, fragments): Promise<NormalizedBundle> {
      const t = requireTarget(targets, ctx.systemSlug);
      const data = fragments.map((f) => f.data as GenericFragment).filter((d) => d && typeof d === "object" && "type" in d);
      return normalizeGeneric(data, { systemSlug: ctx.systemSlug, target: t, limit: ctx.limit, log: (m) => ctx.log.warn(`generic: ${t.slug}: ${m}`) });
    },

    validate(ctx, bundle) {
      const t = targets.find((x) => x.slug === ctx.systemSlug);
      if (!t) return [];
      return validateGeneric(bundle, t, { limit: ctx.limit, truncated: truncatedBySystem.get(ctx.systemSlug) });
    },
  };
}

export const adapter: SourceAdapter = createGenericAdapter();
