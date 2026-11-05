/**
 * Generic adapter: fragment shapes, component selection shared by discover() and normalize(),
 * metadata-level normalization and adapter-specific validation.
 */
import { COMPONENT_FIELDS, type CoverageState, type EvidenceInput, type NormalizedBundle, type NormalizedComponent, type ValidationIssue } from "@/lib/contracts";
import { classifyComponentName } from "@/lib/taxonomy";
import { excerpt } from "../../http";
import { chooseName, compileTarget, humanizeSegment, matchOne, relatesToSegment, segmentKey, shortDescription, type Candidate, type PageMeta } from "./extract";
import type { GenericTarget } from "./types";

export const ADAPTER_ID = "generic";
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

export interface IndexFragment {
  type: "index";
  strategy: GenericTarget["strategy"];
  stamp: SourceStamp;
  candidates: Candidate[];
  /** repo-listing: resolved coordinates (version pinned) for evidence/docs URLs. */
  repo?: { kind: "gh" | "npm"; name: string; ref: string };
}

export interface PageFragment {
  type: "page";
  key: string;
  segment: string;
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

/**
 * Placeholders: {segment} (captured segment), {path} (matched file path, repo-listing),
 * {dir} (directory of the matched file), {ref} (resolved repo ref/version).
 */
export function applyTemplate(template: string, vars: { segment: string; path?: string; ref?: string }): string {
  const path = vars.path ?? vars.segment;
  const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : path;
  return template
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

/**
 * Descriptions that are site boilerplate rather than component descriptions: identical on more
 * than one page, or identical once the page's own name is blanked out ("Calcite X is one of many
 * reusable elements..." on every page).
 */
export function siteWideDescriptions(pages: PageFragment[]): Set<string> {
  const exact = new Map<string, number>();
  const templ = new Map<string, string[]>();
  const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const p of pages) {
    const d = (p.meta.metaDescription ?? "").trim().toLowerCase();
    if (!d) continue;
    exact.set(d, (exact.get(d) ?? 0) + 1);
    let t = d;
    for (const n of [p.meta.h1, p.meta.h1Own, humanizeSegment(p.segment), p.segment.replace(/[-_]+/g, " ")]) {
      const v = (n ?? "").trim().toLowerCase();
      if (v.length >= 2) t = t.replace(new RegExp(esc(v), "g"), "{x}");
    }
    if (t !== d) templ.set(t, [...(templ.get(t) ?? []), d]);
  }
  const out = new Set([...exact.entries()].filter(([, n]) => n > 1).map(([d]) => d));
  for (const ds of templ.values()) if (ds.length > 2) for (const d of ds) out.add(d);
  return out;
}

export interface NormalizeOptions {
  systemSlug: string;
  target: GenericTarget;
  limit?: number;
  log?: (msg: string) => void;
}

export function normalizeGeneric(fragments: GenericFragment[], opts: NormalizeOptions): NormalizedBundle {
  const { target } = opts;
  const c = compileTarget(target);
  const indexes = fragments.filter((f): f is IndexFragment => f.type === "index").sort((a, b) => (a.stamp.url < b.stamp.url ? -1 : a.stamp.url > b.stamp.url ? 1 : 0));
  const pages = new Map<string, PageFragment>();
  for (const p of fragments.filter((f): f is PageFragment => f.type === "page")) pages.set(p.key, p);
  const boilerplate = siteWideDescriptions([...pages.values()]);

  const repoRef = indexes.find((f) => f.repo)?.repo?.ref;
  const { planned } = planComponents(target, indexes.map((f) => f.candidates), opts.limit, repoRef);
  // The index source that listed the selected candidate (evidence for existence).
  const sourceOf = new Map<string, { frag: IndexFragment; cand: Candidate }>();
  const wanted = new Map(planned.map((p) => [p.key, p.matched]));
  for (const f of indexes) {
    for (const cand of f.candidates) {
      const k = cand.key;
      if (!k || !wanted.has(k)) continue;
      const prev = sourceOf.get(k);
      if (!prev || (prev.cand.matched !== wanted.get(k) && cand.matched === wanted.get(k))) sourceOf.set(k, { frag: f, cand });
    }
  }
  const method = `adapter:${ADAPTER_ID}:${target.strategy}`;
  const components: NormalizedComponent[] = [];

  for (const p of planned) {
    const src = sourceOf.get(p.key);
    if (!src) continue;
    const page = pages.get(p.key) ?? null;
    let pageOk = !!page && page.status >= 200 && page.status < 300 && !page.meta.soft404;
    if (page && !pageOk) opts.log?.(`${p.key}: page ${page.stamp.url} ${page.meta.soft404 ? "looks like a not-found page" : `HTTP ${page.status}`}`);
    // Client-rendered shells answer 200 for any path: a page only counts when it names something
    // (an h1, or a title that names the segment).
    if (pageOk && !page!.meta.h1 && !(page!.meta.title && relatesToSegment(page!.meta.title, p.segment))) {
      opts.log?.(`${p.key}: page ${page!.stamp.url} has no h1 and a generic title (client-rendered shell?); page metadata ignored`);
      pageOk = false;
    }

    // Docs URL: matched URLs come from the source; constructed ones need a confirming fetch.
    let docsUrl: string | null = p.docsUrl;
    const fetchedIsDocs = !!p.fetchUrl && p.fetchUrl === p.docsUrl;
    if (pageOk) {
      const final = page!.finalUrl || page!.stamp.url;
      if (sameDoc(final, page!.stamp.url)) {
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
    if (!pageOk && p.constructed) docsUrl = null;

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

    const evidence: EvidenceInput[] = [];
    const s = src.frag.stamp;
    const listingEvidenceUrl = src.frag.strategy === "repo-listing" ? repoEvidenceUrl(src.frag, src.cand.matched) : s.evidenceUrl;
    evidence.push({
      field: "name",
      sourceUrl: listingEvidenceUrl,
      sourceTitle: src.frag.strategy === "sitemap" ? "Sitemap" : src.frag.strategy === "nav" ? "Documentation index" : "Repository file listing",
      retrievedAt: s.retrievedAt,
      contentHash: s.hash,
      extractionMethod: method,
      location: src.cand.matched,
      excerpt: src.cand.text ? excerpt(src.cand.text, 120) : null,
      state: "verified",
      confidence: 0.65,
    });
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
      classification: cls ? { state: "inferred", method: `generic:${cls.method}`, confidence: Math.min(cls.confidence, 0.8) } : null,
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
  /^(overview|introduction|installation|install|getting started|quick ?start|setup|theming|themes|customi[sz]ation|customi[sz]e|colou?rs?|colou?r palette|typography|spacing|space|layout grid|grid system|breakpoints|elevation|shadows?|motion|animation|iconography|icon library|changelog|migration|migrating|upgrade guide|usage|dark mode|accessibility|a11y|contributing|faq|roadmap|release notes|design tokens|tokens|resources|principles|guidelines|patterns|templates|showcase|playground|examples|utilities|helpers|mixins|variables|sass|css variables|browser support|rtl|i18n|internationali[sz]ation|localization|server side rendering|ssr|typescript|license|community|support|figma|design kit|ui kit|blocks)$/i;

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
  }
  for (const [nm, slugs] of byName) {
    if (slugs.length > 1) {
      for (const s of slugs) issues.push({ entityKind: "component", entityKey: s, code: "DUPLICATE", message: `${slugs.length} components share the name "${nm}" (${slugs.join(", ")})`, severity: "warning", path: "name" });
    }
  }
  return issues;
}
