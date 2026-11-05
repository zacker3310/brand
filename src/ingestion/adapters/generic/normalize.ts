/**
 * Generic adapter: fragment shapes, component selection shared by discover() and normalize(),
 * metadata-level normalization and adapter-specific validation.
 *
 * Versioning design. Parsed fragments are a pure function of the fetched document: index fragments
 * keep the document's raw entries (sitemap/Storybook URLs, listing paths, the nav page's link
 * outline) and page fragments keep the page's metadata keyed by URL. No fragment depends on a target.
 * normalize(), which the engine runs on every publish, applies the system's CURRENT target (include /
 * exclude / selector / templates / names...) to those fragments. So the effective version of a system's
 * output is (ADAPTER_VERSION, that system's own target): editing one target re-derives only that
 * system's bundle on its next run, and never invalidates the parse cache of any system. ADAPTER_VERSION
 * (the engine's parse-cache key) changes only when parser code changes. targetFingerprint() identifies
 * the target a run used (logged by discover()).
 */
import { COMPONENT_FIELDS, type CoverageState, type EvidenceInput, type NormalizedBundle, type NormalizedComponent, type ValidationIssue } from "@/lib/contracts";
import { classifyComponentName } from "@/lib/taxonomy";
import { stableStringify } from "@/lib/utils";
import { excerpt, sha256 } from "../../http";
import {
  chooseName,
  clean,
  compileTarget,
  extractNavLinks,
  humanizeSegment,
  matchOne,
  relatesToSegment,
  segmentKey,
  selectCandidates,
  shortDescription,
  type Candidate,
  type CompiledTarget,
  type PageMeta,
} from "./extract";
import type { GenericTarget } from "./types";

export const ADAPTER_ID = "generic";
/** Parser code version (engine parse-cache key). Bump ONLY when parse() output changes; never for target edits. */
export const ADAPTER_VERSION = "2.0.0";
export const DEFAULT_MAX_COMPONENTS = 300;
export const DEFAULT_MAX_PAGES = 120;

export const DOC_KINDS = {
  sitemap: "generic-sitemap",
  nav: "generic-nav",
  listing: "generic-listing",
  page: "generic-page",
} as const;

export interface SourceStamp {
  /** Fetched URL. */
  url: string;
  /** Human-facing URL for evidence. */
  evidenceUrl: string;
  retrievedAt: string;
  hash: string | null;
}

/**
 * One index document, target-independent: what the document lists, not what a target selects.
 * Candidates are derived in normalize() with indexCandidates().
 */
export interface IndexFragment {
  type: "index";
  /** Kind of index document (from its docKind). */
  source: GenericTarget["strategy"];
  stamp: SourceStamp;
  /** sitemap (XML urlset or Storybook index) and repo-listing: listed absolute URLs / file paths. */
  values?: string[];
  /** Storybook index: entry titles, parallel to values. */
  texts?: (string | null)[];
  /** nav: link outline of the page (navOutline) and the base URL of relative links. */
  outline?: string;
  base?: string;
  /** repo-listing: resolved coordinates (version pinned, from the listing URL) for evidence/docs URLs. */
  repo?: { kind: "gh" | "npm"; name: string; ref: string };
}

/** One fetched component page, keyed by its fetched URL (stamp.url); target-independent. */
export interface PageFragment {
  type: "page";
  stamp: SourceStamp;
  finalUrl: string;
  status: number;
  meta: PageMeta;
}

export type GenericFragment = IndexFragment | PageFragment;

export interface PlannedComponent extends Candidate {
  /** Human docs URL candidate (matched URL, or docsUrlTemplate applied). */
  docsUrl: string | null;
  /** URL fetched for page metadata (raw file for GitHub blob docs URLs; otherwise docsUrl). */
  fetchUrl: string | null;
  /** docsUrl was constructed from a template (must be confirmed by a successful page fetch). */
  constructed: boolean;
  /** A page fetch is planned for this component. */
  fetchPage: boolean;
}

/** Stable fingerprint of one target's configuration (identifies the config a run used; not a cache key). */
export const targetFingerprint = (t: GenericTarget) => sha256(stableStringify(t)).slice(0, 10);

/** Component candidates of one index fragment under a target (shared by discover() and normalize()). */
export function indexCandidates(f: Pick<IndexFragment, "source" | "values" | "texts" | "outline" | "base" | "stamp">, target: GenericTarget, c: CompiledTarget = compileTarget(target)): Candidate[] {
  if (f.source === "nav") return selectCandidates(extractNavLinks(f.outline ?? "", f.base ?? f.stamp.url, target.navSelector), c, { distinctPages: true });
  const values = (f.values ?? []).map((value, i) => ({ value, text: f.texts?.[i] ?? null }));
  return selectCandidates(values, c, { distinctPages: f.source === "sitemap" });
}

/**
 * Placeholders: {segment} (captured segment), {segmentLower} (lowercased segment), {path} (matched
 * file path, repo-listing), {dir} (directory of the matched file), {ref} (resolved repo ref/version).
 */
export function applyTemplate(template: string, vars: { segment: string; path?: string; ref?: string }): string {
  const path = vars.path ?? vars.segment;
  const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : path;
  return template
    .replace(/\{segmentLower\}/g, vars.segment.toLowerCase())
    .replace(/\{segment\}/g, vars.segment)
    .replace(/\{path\}/g, path)
    .replace(/\{dir\}/g, dir)
    .replace(/\{ref\}/g, vars.ref ?? "");
}

const FILE_HOSTS = new Set(["github.com", "raw.githubusercontent.com", "cdn.jsdelivr.net"]);

/** GitHub blob URL -> raw file URL (fetched for metadata); other URLs unchanged. */
export function rawFileUrl(url: string): string {
  const m = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/(.+)$/.exec(url);
  return m ? `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}` : url;
}

/**
 * Merge candidates from every index source, dedupe by key (shortest matched value wins),
 * cap to maxComponents (and ctx.limit) and mark which components get a page fetch.
 * Used identically by discover() and normalize() so both agree on the selection.
 */
export function planComponents(
  target: GenericTarget,
  candidateLists: Candidate[][],
  limit?: number,
  repoRef?: string,
): { planned: PlannedComponent[]; total: number; truncated: number } {
  const byKey = new Map<string, Candidate>();
  for (const list of candidateLists) {
    for (const c of list) {
      if (!c.key) continue;
      const prev = byKey.get(c.key);
      if (!prev || c.matched.length < prev.matched.length || (c.matched.length === prev.matched.length && c.matched < prev.matched)) byKey.set(c.key, prev?.text && !c.text ? { ...c, text: prev.text } : c);
    }
  }
  const keys = [...byKey.keys()].sort();
  const cap = Math.min(target.maxComponents ?? DEFAULT_MAX_COMPONENTS, limit && limit > 0 ? limit : Infinity);
  const selected = keys.slice(0, cap);
  const template = target.repo?.docsUrlTemplate ?? target.docsUrlTemplate ?? null;
  const listing = target.strategy === "repo-listing";
  const ref = repoRef ?? target.repo?.ref;
  const pageCap = Math.min(target.maxPages ?? DEFAULT_MAX_PAGES, cap);
  const planned = selected.map((key, i): PlannedComponent => {
    const c = byKey.get(key)!;
    const fromTemplate = template ? applyTemplate(template, { segment: c.segment, path: listing ? c.matched : undefined, ref }) : null;
    const docsUrl = fromTemplate ?? (listing ? null : c.matched);
    let host = "";
    try {
      host = docsUrl ? new URL(docsUrl).host : "";
    } catch {
      /* invalid template output: treated as constructed and dropped unless confirmed */
    }
    // A URL to the listed file itself is proven by the listing; any other template output is constructed.
    const listingProven = listing && !!template && /\{(path|dir)\}/.test(template) && FILE_HOSTS.has(host);
    const constructed = !!fromTemplate && fromTemplate !== c.matched && !listingProven;
    const fetchUrl = docsUrl ? rawFileUrl(docsUrl) : null;
    return { ...c, docsUrl, fetchUrl, constructed, fetchPage: target.fetchPages !== false && !!fetchUrl && i < pageCap };
  });
  return { planned, total: keys.length, truncated: keys.length - selected.length };
}

/* -------------------------------------------------------------------------- */
/* Normalize                                                                   */
/* -------------------------------------------------------------------------- */

const OTHER_FIELDS = COMPONENT_FIELDS.filter((f) => f !== "description" && f !== "frameworks");

const sameDoc = (a: string, b: string) => {
  try {
    const x = new URL(a);
    const y = new URL(b);
    return x.host === y.host && x.pathname.replace(/\/+$/, "").replace(/\.html$/, "") === y.pathname.replace(/\/+$/, "").replace(/\.html$/, "");
  } catch {
    return a === b;
  }
};

const normalizeHttp = (u: string): boolean => /^https?:\/\//.test(u);

const safePathTail = (u: string): string | null => {
  try {
    return new URL(u).pathname.split("/").filter(Boolean).pop()?.replace(/\.html?$/, "") ?? null;
  } catch {
    return null;
  }
};

/** Forms of a component's own name to blank out of its description: segment-derived forms first (they
 * name the component identically on every page), then the page headings (which may carry decoration
 * such as " class" or status badges). Lowercased, longest first within each group. */
function nameForms(segment: string, meta: Pick<PageMeta, "h1" | "h1Own">): string[] {
  const last = segment.split("/").filter(Boolean).pop() ?? segment;
  const group = (xs: (string | null | undefined)[]) =>
    [...new Set(xs.map((x) => clean(x).toLowerCase()).filter((x) => x.length >= 2))].sort((x, y) => y.length - x.length || (x < y ? -1 : 1));
  const key = segmentKey(last);
  return [...group([last, humanizeSegment(last), last.replace(/[-_]+/g, " "), key.replace(/-/g, " "), key.replace(/-/g, "")]), ...group([meta.h1, meta.h1Own])];
}

/** A description with the component's own name blanked out ("{x}"). */
export function maskName(description: string, segment: string, meta: Pick<PageMeta, "h1" | "h1Own">): string {
  let t = clean(description).toLowerCase();
  for (const f of nameForms(segment, meta)) t = t.split(f).join("{x}");
  return t;
}

/**
 * Descriptions that are site boilerplate rather than component descriptions: identical on more
 * than one page, or identical on more than two pages once each page's own component name is masked
 * ("Calcite X is one of many reusable elements...", dartdoc "API docs for the X class from the
 * cupertino_ui library..."). Returns lowercased, trimmed descriptions.
 */
export function siteWideDescriptions(pages: { meta: PageMeta; segment: string }[]): Set<string> {
  const exact = new Map<string, number>();
  const templ = new Map<string, Set<string>>();
  for (const p of pages) {
    const d = (p.meta.metaDescription ?? "").trim().toLowerCase();
    if (!d) continue;
    exact.set(d, (exact.get(d) ?? 0) + 1);
    const t = maskName(d, p.segment, p.meta);
    if (t !== clean(d)) templ.set(t, (templ.get(t) ?? new Set()).add(d));
  }
  const out = new Set([...exact.entries()].filter(([, n]) => n > 1).map(([d]) => d));
  for (const ds of templ.values()) if (ds.size > 2) for (const d of ds) out.add(d);
  return out;
}

export interface NormalizeOptions {
  systemSlug: string;
  target: GenericTarget;
  limit?: number;
  log?: (msg: string) => void;
}

const SHELL_DOCS_NOTE = "docs URL not confirmed by static fetch";

export function normalizeGeneric(fragments: GenericFragment[], opts: NormalizeOptions): NormalizedBundle {
  const { target } = opts;
  const c = compileTarget(target);
  const indexes = fragments
    .filter((f): f is IndexFragment => f.type === "index")
    .sort((a, b) => (a.stamp.url < b.stamp.url ? -1 : a.stamp.url > b.stamp.url ? 1 : 0))
    .map((frag) => ({ frag, candidates: indexCandidates(frag, target, c) }));
  const pages = new Map<string, PageFragment>();
  for (const p of fragments.filter((f): f is PageFragment => f.type === "page")) pages.set(p.stamp.url, p);

  const repoRef = indexes.find((x) => x.frag.repo)?.frag.repo?.ref;
  const { planned } = planComponents(target, indexes.map((x) => x.candidates), opts.limit, repoRef);
  const pageOf = (p: PlannedComponent) => (p.fetchPage && p.fetchUrl ? (pages.get(p.fetchUrl) ?? null) : null);
  const boilerplate = siteWideDescriptions(planned.flatMap((p) => (pageOf(p) ? [{ meta: pageOf(p)!.meta, segment: p.segment }] : [])));
  // The index source that listed the selected candidate (evidence for existence).
  const sourceOf = new Map<string, { frag: IndexFragment; cand: Candidate }>();
  const wanted = new Map(planned.map((p) => [p.key, p.matched]));
  for (const { frag, candidates } of indexes) {
    for (const cand of candidates) {
      const k = cand.key;
      if (!k || !wanted.has(k)) continue;
      const prev = sourceOf.get(k);
      if (!prev || (prev.cand.matched !== wanted.get(k) && cand.matched === wanted.get(k))) sourceOf.set(k, { frag, cand });
    }
  }
  const method = `adapter:${ADAPTER_ID}:${target.strategy}`;
  const components: NormalizedComponent[] = [];

  for (const p of planned) {
    const src = sourceOf.get(p.key);
    if (!src) continue;
    const page = pageOf(p);
    // 304: the engine re-parses the cached body of an unchanged page (e.g. after an adapter version bump).
    const fetchedOk = !!page && ((page.status >= 200 && page.status < 300) || page.status === 304) && !page.meta.soft404;
    let pageOk = fetchedOk;
    if (page && !pageOk) opts.log?.(`${p.key}: page ${page.stamp.url} ${page.meta.soft404 ? "looks like a not-found page" : `HTTP ${page.status}`}`);
    // Client-rendered shells answer 200 for any path: a page only counts when it names something
    // (an h1, or a title that names the segment).
    let shell = false;
    if (pageOk && !page!.meta.h1 && !(page!.meta.title && relatesToSegment(page!.meta.title, p.segment))) {
      opts.log?.(`${p.key}: page ${page!.stamp.url} has no h1 and a generic title (client-rendered shell?); page metadata ignored`);
      pageOk = false;
      shell = true;
    }

    // Docs URL: matched URLs come from the source; constructed ones need a confirming fetch.
    let docsUrl: string | null = p.docsUrl;
    const fetchedIsDocs = !!p.fetchUrl && p.fetchUrl === p.docsUrl;
    if (pageOk) {
      const final = page!.finalUrl || page!.stamp.url;
      const canonical = page!.meta.canonical;
      if (fetchedIsDocs && canonical && normalizeHttp(canonical) && sameDoc(canonical, page!.stamp.url)) {
        docsUrl = canonical; // stable across fresh fetches and cached (304) re-parses
      } else if (sameDoc(final, page!.stamp.url)) {
        if (fetchedIsDocs && final !== docsUrl && normalizeHttp(final)) docsUrl = final; // e.g. trailing-slash redirect: keep the resolved URL
      } else if (!fetchedIsDocs) {
        // Raw file fetched for a GitHub blob docs URL: a redirect means the file moved.
        opts.log?.(`${p.key}: ${page!.stamp.url} redirected to ${final}; page metadata ignored`);
        pageOk = false;
      } else {
        // Redirected: adopt the final URL only when it is still this component's page.
        const finalSeg = matchOne(final, c);
        const lastPart = safePathTail(final);
        const stillThisComponent = (!!finalSeg && segmentKey(finalSeg) === segmentKey(p.segment)) || (!!lastPart && relatesToSegment(lastPart, p.segment));
        if (stillThisComponent) docsUrl = final;
        else {
          opts.log?.(`${p.key}: ${page!.stamp.url} redirects to unrelated ${final}; page metadata ignored`);
          pageOk = false;
        }
      }
    }
    // Constructed URL that no page confirmed: dropped, unless the target declares client-rendered docs
    // (acceptShellDocs: verified URL pattern, shell pages) and the server did not reject the URL.
    // A planned fetch without a page fragment failed (HTTP error, robots): never accepted.
    const unconfirmed = !pageOk && p.constructed && !!docsUrl && !!target.acceptShellDocs && (p.fetchPage ? shell : true);
    if (!pageOk && p.constructed && !unconfirmed) docsUrl = null;

    const { name } = chooseName(p.segment, pageOk ? page!.meta : null, p.text, c.titleSuffix);

    let description: string | null = null;
    if (pageOk && page?.meta.metaDescription && !boilerplate.has(page.meta.metaDescription.trim().toLowerCase())) {
      description = shortDescription(page.meta.metaDescription);
    }

    const cls = classifyComponentName(name);
    const coverage: Record<string, CoverageState> = {};
    coverage.description = description ? "documented" : "not-extracted";
    coverage.frameworks = target.frameworks?.length ? "inferred" : "not-extracted";
    for (const f of OTHER_FIELDS) coverage[f] = "not-extracted";
    if (unconfirmed) coverage.docsUrl = "inferred";

    const evidence: EvidenceInput[] = [];
    const s = src.frag.stamp;
    const listingEvidenceUrl = src.frag.source === "repo-listing" ? repoEvidenceUrl(src.frag, src.cand.matched) : s.evidenceUrl;
    evidence.push({
      field: "name",
      sourceUrl: listingEvidenceUrl,
      sourceTitle: src.frag.source === "sitemap" ? "Sitemap" : src.frag.source === "nav" ? "Documentation index" : "Repository file listing",
      retrievedAt: s.retrievedAt,
      contentHash: s.hash,
      extractionMethod: method,
      location: src.cand.matched,
      excerpt: src.cand.text ? excerpt(src.cand.text, 120) : null,
      state: "verified",
      confidence: 0.65,
    });
    if (unconfirmed && docsUrl) {
      evidence.push({
        field: "docsUrl",
        sourceUrl: docsUrl,
        sourceTitle: null,
        retrievedAt: page?.stamp.retrievedAt ?? s.retrievedAt,
        contentHash: null,
        extractionMethod: `adapter:${ADAPTER_ID}:docs-url-template`,
        location: target.repo?.docsUrlTemplate ?? target.docsUrlTemplate ?? null,
        excerpt: `${SHELL_DOCS_NOTE} (client-rendered docs); built from the verified docs URL pattern`,
        state: "unverified",
        confidence: 0.35,
      });
    }
    if (pageOk && page && docsUrl) {
      evidence.push({
        field: "docsUrl",
        sourceUrl: docsUrl,
        sourceTitle: page.meta.title ? excerpt(page.meta.title, 200) : null,
        retrievedAt: page.stamp.retrievedAt,
        contentHash: page.stamp.hash,
        extractionMethod: `adapter:${ADAPTER_ID}:page`,
        location: page.meta.h1 ? "h1" : "title",
        excerpt: page.meta.h1 ? excerpt(page.meta.h1, 120) : null,
        state: "verified",
        confidence: 0.7,
      });
      if (description) {
        evidence.push({
          field: "description",
          sourceUrl: docsUrl,
          sourceTitle: page.meta.title ? excerpt(page.meta.title, 200) : null,
          retrievedAt: page.stamp.retrievedAt,
          contentHash: page.stamp.hash,
          extractionMethod: `adapter:${ADAPTER_ID}:page-meta`,
          location: 'meta[name="description"]',
          excerpt: excerpt(description, 280),
          state: "verified",
          confidence: 0.6,
        });
      }
    }

    components.push({
      slug: p.key,
      name,
      aliases: [],
      description,
      docsUrl,
      sourceCodeUrl: null,
      lifecycle: "unknown",
      canonicalType: cls?.slug ?? null,
      classification: cls ? { state: "inferred", method: `generic:${cls.method}`, confidence: Math.min(cls.confidence, unconfirmed ? 0.6 : 0.8) } : null,
      frameworks: (target.frameworks ?? []).map((slug) => ({ slug })),
      variants: [],
      states: [],
      sizes: null,
      properties: [],
      accessibility: null,
      examples: [],
      relationships: [],
      tokenUsages: [],
      responsiveGuidance: null,
      coverage,
      evidence,
    });
  }

  return { systemSlug: opts.systemSlug, components, tokenSets: [], patterns: [], facts: null };
}

/** Human-facing URL for a matched repository/package path. */
export function repoEvidenceUrl(f: IndexFragment, path: string): string {
  const r = f.repo;
  if (!r) return f.stamp.evidenceUrl;
  const p = path.replace(/^\/+/, "");
  if (r.kind === "gh") {
    const [owner, repo] = r.name.split("/");
    return `https://github.com/${owner}/${repo}/blob/${r.ref}/${p}`;
  }
  return `https://cdn.jsdelivr.net/npm/${r.name}@${r.ref}/${p}`;
}

/* -------------------------------------------------------------------------- */
/* Validate                                                                    */
/* -------------------------------------------------------------------------- */

/** Documentation section names that are not components (foundations, guides, site pages). */
const NON_COMPONENT =
  /^(overview|introduction|installation|install|getting started|quick ?start|setup|theming|themes|customi[sz]ation|customi[sz]e|colou?rs?|colou?r palette|typography|spacing|layout grid|grid system|breakpoints|elevation|shadows?|motion|animation|iconography|icon library|changelog|migration|migrating|upgrade guide|usage|dark mode|accessibility|a11y|contributing|faq|roadmap|release notes|design tokens|tokens|resources|principles|guidelines|patterns|templates|showcase|playground|examples|utilities|helpers|mixins|variables|sass|css variables|browser support|rtl|i18n|internationali[sz]ation|localization|server side rendering|ssr|typescript|license|community|support|figma|design kit|ui kit|blocks)$/i;

export function validateGeneric(bundle: NormalizedBundle, target: GenericTarget, opts: { limit?: number; truncated?: number } = {}): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const n = bundle.components.length;
  const systemKey = bundle.systemSlug;
  if (n === 0) {
    issues.push({ entityKind: "bundle", entityKey: systemKey, code: "NO_COMPONENTS", message: `generic ${target.strategy} source enumerated no components; check the target include/exclude rules or source availability`, severity: "error" });
  } else if (n < 5 && !opts.limit) {
    issues.push({ entityKind: "bundle", entityKey: systemKey, code: "TOO_FEW_COMPONENTS", message: `only ${n} components enumerated from the ${target.strategy} source`, severity: "warning" });
  }
  const cap = target.maxComponents ?? DEFAULT_MAX_COMPONENTS;
  if (!opts.limit && n >= cap) {
    issues.push({ entityKind: "bundle", entityKey: systemKey, code: "TRUNCATED", message: `component list capped at maxComponents=${cap}; the source may list more`, severity: "warning" });
  }
  const byName = new Map<string, string[]>();
  for (const comp of bundle.components) {
    const nm = comp.name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (NON_COMPONENT.test(nm)) {
      issues.push({ entityKind: "component", entityKey: comp.slug, code: "SUSPICIOUS", message: `"${comp.name}" looks like a documentation section, not a component; tighten the target exclude rules`, severity: "warning", path: "name" });
    }
    const g = byName.get(nm) ?? [];
    g.push(comp.slug);
    byName.set(nm, g);
    if (!comp.docsUrl) issues.push({ entityKind: "component", entityKey: comp.slug, code: "NO_DOCS_URL", message: "docs URL not confirmed (page not fetched, failed or not found)", severity: "warning", path: "docsUrl" });
    else if (comp.coverage?.docsUrl === "inferred")
      issues.push({ entityKind: "component", entityKey: comp.slug, code: "UNCONFIRMED_DOCS_URL", message: `${SHELL_DOCS_NOTE}: built from the target's verified URL pattern (client-rendered docs)`, severity: "warning", path: "docsUrl" });
  }
  for (const [nm, slugs] of byName) {
    if (slugs.length > 1) {
      for (const s of slugs) issues.push({ entityKind: "component", entityKey: s, code: "DUPLICATE", message: `${slugs.length} components share the name "${nm}" (${slugs.join(", ")})`, severity: "warning", path: "name" });
    }
  }
  return issues;
}
