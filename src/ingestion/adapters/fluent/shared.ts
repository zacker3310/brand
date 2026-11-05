/**
 * Shared constants, provenance and text helpers for the "fluent" adapter
 * (systems: fluent-2, fluent-ui-react, fluent-ui-web-components).
 *
 * Sources (all first-party, Microsoft; static parsing only, nothing fetched is executed):
 *  - npm: @fluentui/react-components (+ the per-component @fluentui/react-* packages it depends on),
 *    @fluentui/web-components, @fluentui/tokens, @fluentui/react-theme. Versions pinned from the npm
 *    `latest` dist-tag / the exact dependency ranges, files read from cdn.jsdelivr.net/npm.
 *  - github.com/microsoft/fluentui at the release tag @fluentui/react-components_v<version>
 *    (raw.githubusercontent.com): Storybook story index files, component Description/BestPractices
 *    markdown and AccessibilitySpec MDX.
 *  - storybooks.fluentui.dev/{react,web-components}/index.json (Storybook 8 story index: docs ids/titles).
 *  - fluent2.microsoft.design: statically rendered (Astro) pages; robots.txt allows all.
 */
import type { EvidenceInput, LicenseRef } from "@/lib/contracts";

export const ADAPTER_ID = "fluent";

export const SYSTEMS = ["fluent-2", "fluent-ui-react", "fluent-ui-web-components"] as const;
export type FluentSystem = (typeof SYSTEMS)[number];

export const PKG = {
  reactComponents: "@fluentui/react-components",
  webComponents: "@fluentui/web-components",
  tokens: "@fluentui/tokens",
  reactTheme: "@fluentui/react-theme",
} as const;

export const REPO_OWNER = "microsoft";
export const REPO_NAME = "fluentui";
export const REPO_URL = `https://github.com/${REPO_OWNER}/${REPO_NAME}`;
export const F2_ORIGIN = "https://fluent2.microsoft.design";
export const SB_REACT = "https://storybooks.fluentui.dev/react/";
export const SB_WC = "https://storybooks.fluentui.dev/web-components/";

export const MIT: LicenseRef = {
  slug: "mit",
  spdxId: "MIT",
  name: "MIT License",
  url: "https://github.com/microsoft/fluentui/blob/master/LICENSE",
  isOpenSource: true,
  redistribution: "permitted",
  notes: "microsoft/fluentui code is MIT (Copyright (c) Microsoft Corporation). Fonts and icons are under a separate assets license and are not redistributed by ATLAS.",
};

/** Git tag beachball creates for each @fluentui/react-components release. */
export const reactReleaseTag = (version: string) => `@fluentui/react-components_v${version}`;

/** raw.githubusercontent.com URL for a repo file at a (possibly slash/at-containing) ref. */
export const repoRaw = (ref: string, file: string) => `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${encodeURIComponent(ref)}/${file.replace(/^\//, "")}`;
/** Human-facing GitHub blob URL at a pinned ref. */
export const repoBlob = (ref: string, file: string) => `${REPO_URL}/blob/${encodeURIComponent(ref)}/${file.replace(/^\//, "")}`;
export const repoTree = (ref: string, dir: string) => `${REPO_URL}/tree/${encodeURIComponent(ref)}/${dir.replace(/^\//, "").replace(/\/$/, "")}`;
export const npmFile = (pkg: string, version: string, file: string) => `https://cdn.jsdelivr.net/npm/${pkg}@${version}/${file.replace(/^\//, "")}`;
export const npmPage = (pkg: string, version?: string | null) => `https://www.npmjs.com/package/${pkg}${version ? `/v/${version}` : ""}`;
export const storybookDocsUrl = (base: string, id: string) => `${base}?path=/docs/${id}`;

/** Per-document provenance carried inside every fragment. */
export interface Prov {
  /** Human-facing URL (GitHub blob at pinned tag, npm file on jsDelivr, docs page). */
  sourceUrl: string;
  retrievedAt: string;
  contentHash: string | null;
  /** Repo/package-relative path or page path. */
  file: string;
}

export function evidence(
  prov: Prov,
  field: string,
  parser: string,
  opts: { location?: string | null; excerpt?: string | null; state?: EvidenceInput["state"]; confidence?: number; title?: string | null; sourceUrl?: string } = {},
): EvidenceInput {
  return {
    field,
    sourceUrl: opts.sourceUrl ?? prov.sourceUrl,
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

/** First sentence (bounded). Avoids splitting on "e.g." / "i.e." / "etc.". */
export function firstSentence(text: string | null | undefined, max = 280): string | null {
  if (!text) return null;
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return null;
  const re = /(?<!\b(?:e\.g|i\.e|etc|vs))[.!?](?=\s+[A-Z("'`<]|$)/g;
  const m = re.exec(clean);
  return clip(m ? clean.slice(0, m.index + 1) : clean, max);
}

/** Leading sentences up to `max` characters, cut on a sentence boundary when possible. */
export function leadSentences(text: string | null | undefined, max = 280): string | null {
  if (!text) return null;
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return null;
  if (clean.length <= max) return clean;
  const parts = clean.split(/(?<!\b(?:e\.g|i\.e|etc|vs))(?<=[.!?])\s+(?=[A-Z("'`<])/);
  let out = "";
  for (const p of parts) {
    if ((out ? out.length + 1 : 0) + p.length > max) break;
    out = out ? `${out} ${p}` : p;
  }
  return out || clip(clean, max);
}

export const sortBy = <T>(arr: readonly T[], key: (t: T) => string): T[] => [...arr].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));

export function uniq<T>(arr: readonly T[]): T[] {
  return [...new Set(arr)];
}

/** "MenuButton" -> "Menu button"; "AccordionItem" -> "Accordion item"; keeps acronyms ("TagPicker", "ARIA"). */
export function humanize(identifier: string): string {
  const words = identifier
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/\s+/)
    .filter(Boolean);
  return words.map((w, i) => (i === 0 || /^[A-Z0-9]{2,}$/.test(w) ? w : w.toLowerCase())).join(" ");
}

/** Decode the HTML entities that appear in server-rendered attribute values and text. */
export function decodeEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&");
}

/** Map npm version semantics to an ATLAS lifecycle. */
export function lifecycleFromVersion(version: string | null | undefined, opts: { deprecated?: string | null; preview?: boolean } = {}): "stable" | "beta" | "experimental" | "deprecated" | "unknown" {
  if (opts.deprecated) return "deprecated";
  if (!version) return "unknown";
  if (opts.preview) return "experimental";
  if (/-alpha/.test(version)) return "experimental";
  if (/-(beta|rc)/.test(version)) return "beta";
  if (/^0\./.test(version)) return "experimental";
  if (/^\d+\.\d+\.\d+$/.test(version)) return "stable";
  return "unknown";
}
