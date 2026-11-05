/** Shared helpers for the Spectrum adapter: provenance, evidence, text, ordering. */
import type { EvidenceInput } from "@/lib/contracts";
import { ADAPTER_ID } from "./constants";

/** Provenance of one fetched document (carried in every parse fragment). */
export interface Ev {
  /** Human-facing URL (docs page, npm/jsDelivr file, GitHub blob). */
  sourceUrl: string;
  retrievedAt: string;
  contentHash: string | null;
  /** File path / URL path of the document; JSON pointers or anchors are appended per claim. */
  location: string;
}

export const method = (parser: string) => `adapter:${ADAPTER_ID}:${parser}`;

export function evidence(field: string, ev: Ev, parser: string, confidence: number, extra: Partial<EvidenceInput> = {}): EvidenceInput {
  const out: EvidenceInput = {
    field,
    sourceUrl: ev.sourceUrl,
    retrievedAt: ev.retrievedAt,
    contentHash: ev.contentHash,
    extractionMethod: method(parser),
    location: ev.location,
    state: "verified",
    confidence,
    ...extra,
  };
  if (out.excerpt) out.excerpt = clip(out.excerpt, 280);
  return out;
}

export const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

export function clip(s: string, max: number): string {
  const c = collapse(s);
  return c.length > max ? `${c.slice(0, max - 1).trimEnd()}…` : c;
}

/**
 * First sentence of a text (<= max chars). Falls back to a clipped prefix ending on a word
 * boundary. Never invents text.
 */
export function firstSentence(text: string | null | undefined, max = 280): string | null {
  if (!text) return null;
  const c = collapse(text);
  if (!c) return null;
  const m = /^(.+?[.!?])(\s|$)/.exec(c);
  const s = m && m[1]!.length >= 12 ? m[1]! : c;
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max / 2)).trimEnd()}…`;
}

export function uniqBy<T>(arr: T[], key: (t: T) => string): T[] {
  const seen = new Set<string>();
  return arr.filter((x) => {
    const k = key(x);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export const byString = <T>(key: (t: T) => string) => (a: T, b: T) => {
  const x = key(a);
  const y = key(b);
  return x < y ? -1 : x > y ? 1 : 0;
};

/** Decode the handful of HTML entities that appear in text nodes we read with string ops. */
export function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&");
}

/** Lifecycle mapping for documented status words. */
export function lifecycleFromStatus(s: string | null | undefined): "stable" | "beta" | "experimental" | "deprecated" | "unknown" {
  const v = (s ?? "").trim().toLowerCase();
  if (!v) return "unknown";
  if (/deprecat/.test(v)) return "deprecated";
  if (/^(stable|ga|released|production|available)$/.test(v)) return "stable";
  if (/beta|preview|rc/.test(v)) return "beta";
  if (/alpha|experimental|unstable|incubat|draft/.test(v)) return "experimental";
  return "unknown";
}
