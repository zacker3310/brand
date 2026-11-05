/** Text helpers for the Polaris adapter (pure). */
import type { EvidenceInput } from "@/lib/contracts";

/** Zero-width characters shopify.dev inserts into camelCase names ("accessibility​Label"). */
const ZW = /[​-‍⁠﻿]/g;

export const stripZw = (s: string) => s.replace(ZW, "");

export const collapse = (s: string) => stripZw(s).replace(/\s+/g, " ").trim();

/** Collapse whitespace and bound length (never store whole documents). */
export function clip(text: string | null | undefined, max = 280): string | null {
  if (!text) return null;
  const clean = collapse(text);
  if (!clean) return null;
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

const SENTENCE_END = /(?<!\b(?:e\.g|i\.e|etc|vs|approx))[.!?](?=\s+[A-Z("'`<*[]|$)/g;

/** Split prose into sentences (avoids "e.g." / "i.e."). */
export function sentences(text: string): string[] {
  const clean = collapse(text);
  const out: string[] = [];
  let last = 0;
  for (const m of clean.matchAll(SENTENCE_END)) {
    const end = (m.index ?? 0) + 1;
    out.push(clean.slice(last, end).trim());
    last = end;
  }
  if (last < clean.length) out.push(clean.slice(last).trim());
  return out.filter(Boolean);
}

/** First sentence(s) within `max` chars; a single over-long sentence is clipped. */
export function firstSentence(text: string | null | undefined, max = 280): string | null {
  if (!text) return null;
  const ss = sentences(text);
  if (!ss.length) return null;
  let out = ss[0]!;
  if (out.length > max) return clip(out, max);
  for (const s of ss.slice(1)) {
    if (out.length + 1 + s.length > max) break;
    if (out.length >= 120) break;
    out = `${out} ${s}`;
  }
  return out;
}

/** "ButtonGroup" -> "button-group"; "URLField" -> "url-field". */
export function kebab(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** String-literal union ("'a' | \"b\"") -> values; null when any member is not a literal. */
export function literalUnion(type: string | null | undefined): string[] | null {
  if (!type) return null;
  const parts = splitUnion(type);
  if (parts.length < 2) return null;
  const vals: string[] = [];
  for (const p of parts) {
    const m = /^(["'`])(.*)\1$/.exec(p.trim());
    if (!m) return null;
    vals.push(m[2]!);
  }
  return vals;
}

/** Literal members of a union that may also contain non-literal members ("'a' | 'b' | AnyString"). */
export function literalMembers(type: string | null | undefined): string[] {
  if (!type) return [];
  const out: string[] = [];
  for (const p of splitUnion(type)) {
    const m = /^(["'`])(.*)\1$/.exec(p.trim());
    if (m) out.push(m[2]!);
  }
  return out;
}

/** Split a TS type on top-level "|" (ignores pipes inside <>, (), {}, [] and strings). */
export function splitUnion(type: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let cur = "";
  for (let i = 0; i < type.length; i++) {
    const c = type[i]!;
    if (quote) {
      cur += c;
      if (c === "\\") {
        cur += type[i + 1] ?? "";
        i++;
      } else if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") {
      quote = c;
      cur += c;
      continue;
    }
    if ("<({[".includes(c)) depth++;
    else if (">)}]".includes(c) && !(c === ">" && type[i - 1] === "=")) depth = Math.max(0, depth - 1);
    if (c === "|" && depth === 0) {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

export interface Stamp {
  /** URL actually fetched. */
  url: string;
  /** Human-facing URL for evidence. */
  evidenceUrl: string;
  retrievedAt: string;
  hash: string | null;
}

export function evidence(
  stamp: Stamp,
  field: string,
  method: string,
  opts: { location?: string | null; excerpt?: string | null; state?: EvidenceInput["state"]; confidence?: number; title?: string | null; sourceUrl?: string } = {},
): EvidenceInput {
  return {
    field,
    sourceUrl: opts.sourceUrl ?? stamp.evidenceUrl,
    sourceTitle: opts.title ?? null,
    retrievedAt: stamp.retrievedAt,
    contentHash: stamp.hash,
    extractionMethod: method,
    location: opts.location ?? null,
    excerpt: opts.excerpt ? clip(opts.excerpt, 280) : null,
    state: opts.state ?? "verified",
    confidence: opts.confidence ?? 0.95,
  };
}

export const sortBy = <T>(arr: readonly T[], key: (t: T) => string): T[] => [...arr].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));

export const uniq = <T>(arr: readonly T[]): T[] => [...new Set(arr)];
