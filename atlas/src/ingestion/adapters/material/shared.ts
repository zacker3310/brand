/**
 * Shared constants, types and text helpers for the "material" adapter
 * (systems: material-design, material-web).
 *
 * Sources (all first-party, Google):
 *  - github.com/material-components/material-web (Apache-2.0): docs/components/*.md, tokens/**,
 *    README/roadmap/intro, labs/README.md. Fetched at a pinned git tag (v<npm latest>) via
 *    raw.githubusercontent.com and cdn.jsdelivr.net/gh (same bytes, two hosts for throughput).
 *  - npm @material/web (custom-elements.json manifest) via cdn.jsdelivr.net/npm.
 *  - m3.material.io (sitemap + server-delivered <title>/<meta description>; pages are client-rendered).
 */
import type { EvidenceInput, LicenseRef } from "@/lib/contracts";

export const ADAPTER_ID = "material";
export const MW_OWNER = "material-components";
export const MW_REPO = "material-web";
export const MW_PACKAGE = "@material/web";
export const MW_REPO_URL = `https://github.com/${MW_OWNER}/${MW_REPO}`;
export const M3_ORIGIN = "https://m3.material.io";

export const APACHE_2: LicenseRef = {
  slug: "apache-2.0",
  spdxId: "Apache-2.0",
  name: "Apache License 2.0",
  url: "https://www.apache.org/licenses/LICENSE-2.0",
  isOpenSource: true,
  redistribution: "permitted",
  notes: "Redistribution permitted with license and NOTICE/attribution retained (Copyright Google LLC).",
};

/** Doc kinds parse() switches on. */
export const DOC_KINDS = {
  mwcDoc: "mwc-component-doc",
  mwcReadme: "mwc-readme",
  mwcIntro: "mwc-intro",
  mwcRoadmap: "mwc-roadmap",
  mwcLabsReadme: "mwc-labs-readme",
  mwcCem: "mwc-custom-elements-manifest",
  mwcV0192: "mwc-token-scss-v0192",
  mwcTopTokens: "mwc-token-scss-supported",
  m3Sass: "m3-token-scss-latest",
  m3Sitemap: "m3-sitemap",
  m3Page: "m3-page",
} as const;

/** Per-document provenance carried inside every fragment. */
export interface Prov {
  /** Human-facing URL (GitHub blob at pinned tag, docs page). */
  sourceUrl: string;
  /** URL actually fetched (raw/CDN). */
  fetchedUrl: string;
  retrievedAt: string;
  contentHash: string | null;
  /** Repo-relative path or page path. */
  file: string;
}

export function evidence(
  prov: Prov,
  field: string,
  parser: string,
  opts: { location?: string | null; excerpt?: string | null; state?: EvidenceInput["state"]; confidence?: number; title?: string | null } = {},
): EvidenceInput {
  return {
    field,
    sourceUrl: prov.sourceUrl,
    sourceTitle: opts.title ?? null,
    retrievedAt: prov.retrievedAt,
    contentHash: prov.contentHash,
    extractionMethod: `adapter:${ADAPTER_ID}:${parser}`,
    location: opts.location ?? prov.file,
    excerpt: opts.excerpt ? clip(opts.excerpt, 280) : null,
    state: opts.state ?? "verified",
    confidence: opts.confidence ?? 0.95,
  };
}

/** Collapse whitespace and bound length (never store whole documents). */
export function clip(text: string | null | undefined, max = 280): string | null {
  if (!text) return null;
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return null;
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

/** First sentence of a paragraph (bounded). Falls back to a clipped excerpt. */
export function firstSentence(text: string | null | undefined, max = 280): string | null {
  if (!text) return null;
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return null;
  // Sentence end: ". " followed by an uppercase letter / quote, or end of string. Avoid "e.g." and "i.e.".
  const re = /(?<!\b(?:e\.g|i\.e|etc|vs))[.!?](?=\s+[A-Z("'`<]|$)/g;
  const m = re.exec(clean);
  const s = m ? clean.slice(0, m.index + 1) : clean;
  return clip(s, max);
}

/** Simple English singularization for display names ("Buttons" -> "Button", "Progress indicators" -> "Progress indicator"). */
export function singularize(name: string): string {
  return name
    .split(" ")
    .map((w, i, arr) => {
      if (i !== arr.length - 1) return w;
      if (/ss$/i.test(w) || w.length <= 3) return w;
      if (/ies$/i.test(w)) return w.replace(/ies$/i, "y");
      if (/(sh|ch|x)es$/i.test(w)) return w.replace(/es$/i, "");
      if (/s$/i.test(w)) return w.replace(/s$/i, "");
      return w;
    })
    .join(" ");
}

export const sortBy = <T>(arr: T[], key: (t: T) => string): T[] => [...arr].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));

export function uniq<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}
