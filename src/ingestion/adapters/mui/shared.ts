/**
 * Shared provenance, evidence and text helpers for the "mui" adapter. Pure functions.
 */
import type { EvidenceInput } from "@/lib/contracts";
import { ADAPTER_ID } from "./constants";

/** Per-document provenance carried inside every fragment. */
export interface Prov {
  /** Human-facing URL (GitHub blob at the pinned tag, npm file URL, docs page). */
  sourceUrl: string;
  /** URL actually fetched. */
  fetchedUrl: string;
  retrievedAt: string;
  contentHash: string | null;
  /** Repo- or package-relative path. */
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

/** Sentence splitter that does not break on "e.g." / "i.e." / "etc." / "vs.". */
export function splitSentences(text: string): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const out: string[] = [];
  const re = /(?<!\b(?:e\.g|i\.e|etc|vs|approx))[.!?](?=\s+[A-Z("'`<[]|$)/g;
  let last = 0;
  for (let m = re.exec(clean); m; m = re.exec(clean)) {
    out.push(clean.slice(last, m.index + 1).trim());
    last = m.index + 1;
  }
  if (last < clean.length) out.push(clean.slice(last).trim());
  return out.filter(Boolean);
}

/** First sentence (bounded); falls back to a clipped excerpt. */
export function firstSentence(text: string | null | undefined, max = 280): string | null {
  if (!text) return null;
  const s = splitSentences(text)[0];
  return clip(s ?? text, max);
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  "#39": "'",
  "#124": "|",
  "#xA": " ",
  "#xa": " ",
  hellip: "…",
  mdash: "—",
  ndash: "–",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (m, e: string) => {
    if (ENTITIES[e] !== undefined) return ENTITIES[e]!;
    if (/^#x/i.test(e)) return String.fromCodePoint(parseInt(e.slice(2), 16));
    if (/^#\d+$/.test(e)) return String.fromCodePoint(Number(e.slice(1)));
    return m;
  });
}

/**
 * HTML fragment (as used in MUI's generated translations / type descriptions) -> plain text.
 * <br> becomes a space, tags are dropped (code text kept), entities decoded.
 */
export function htmlToText(html: string | null | undefined): string | null {
  if (!html) return null;
  const t = decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<\/(p|li|ul|ol|div)>/gi, " ")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/\s+/g, " ")
    .trim();
  return t || null;
}

/** "'a'<br>&#124;&nbsp;'b'" (MUI generated type description) -> "'a' | 'b'". */
export function typeDescriptionToText(desc: string | null | undefined): string | null {
  const t = htmlToText(desc);
  return t ? t.replace(/\s*\|\s*/g, " | ").trim() : null;
}

/** String literal members of a TypeScript-ish union: "'a' | 'b' | string" -> ["a", "b"]. Null when none. */
export function literalUnion(type: string | null | undefined): string[] | null {
  if (!type) return null;
  const parts = type.split("|").map((p) => p.trim());
  const values: string[] = [];
  for (const p of parts) {
    const m = /^'([^']*)'$/.exec(p) ?? /^"([^"]*)"$/.exec(p);
    if (m) values.push(m[1]!);
  }
  return values.length ? [...new Set(values)] : null;
}

/** Strip surrounding quotes from a documented default ("'medium'" -> "medium"); keeps expressions as-is. */
export function cleanDefault(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const t = String(v).trim();
  if (!t || t === "-") return null;
  return t;
}

/**
 * Heading anchor generators matching the docs sites (verified against live HTML ids):
 *  - "mui": mui.com docs (textToHash): lowercase, punctuation/whitespace runs -> "-", duplicates "-2", "-3".
 *  - "github": github-slugger style used by base-ui.com (rehype-slug): duplicates "-1", "-2".
 */
export function createSlugger(style: "mui" | "github") {
  const seen = new Map<string, number>();
  return (text: string): string => {
    let base: string;
    if (style === "mui") {
      base = text
        .toLowerCase()
        .replace(/<\/?[^>]+(>|$)/g, "")
        .replace(/[!@#$%^&*()=_+[\]{}`~;:'"|,.<>/?\s]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");
    } else {
      base = text
        .toLowerCase()
        .trim()
        .replace(/[^\p{L}\p{N}\s_-]/gu, "")
        .replace(/\s/g, "-");
    }
    const n = seen.get(base);
    if (n === undefined) {
      seen.set(base, style === "mui" ? 1 : 0);
      return base;
    }
    const next = n + 1;
    seen.set(base, next);
    return `${base}-${next}`;
  };
}

export const sortBy = <T>(arr: T[], key: (t: T) => string): T[] => [...arr].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));

export function uniq<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

/** Normalized identity key for names ("Button Group" ~ "ButtonGroup" ~ "button-group"). */
export const normKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Is this an npm prerelease version (e.g. "5.0.0-beta.52")? */
export const isPrerelease = (v: string) => /-/.test(v);
