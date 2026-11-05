/** Small, pure text helpers for the Atlassian parsers. */

/** Collapse whitespace; drop zero-width characters and the "(opens new window)" link suffix. */
export function cleanText(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .replace(/[​-‍﻿]/g, "")
    .replace(/\s*,?\s*\(opens new window\)/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([.,;:!?)])/g, "$1")
    .trim();
}

/**
 * Split prose into sentences at "<.!?> <Capital|digit|quote>", never after common abbreviations
 * ("e.g.", "i.e.", "etc.", "vs.").
 */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<!\b(?:e\.g|i\.e|etc|vs|cf|approx|incl|[A-Z])\.)(?<=[.!?])\s+(?=[A-Z0-9"'“(`<])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Concise excerpt: whole sentences up to `max` characters (at least the first sentence,
 * truncated with an ellipsis if it alone exceeds `max`). Keeps stored descriptions short.
 */
export function shortText(input: string | null | undefined, max = 280): string | null {
  const s = cleanText(input);
  if (!s) return null;
  if (s.length <= max) return s;
  let out = "";
  for (const sentence of splitSentences(s)) {
    const next = out ? `${out} ${sentence}` : sentence;
    if (next.length > max) break;
    out = next;
  }
  if (out) return out;
  return `${s.slice(0, max - 1).trimEnd()}…`;
}

/** `"a" | "b"` -> ["a","b"]; null when the type is not a pure string-literal union. */
export function parseStringLiteralUnion(type: string | null | undefined): string[] | null {
  if (!type) return null;
  const parts = type
    .replace(/\s+/g, " ")
    .split("|")
    .map((p) => p.trim())
    .filter(Boolean);
  if (!parts.length) return null;
  const out: string[] = [];
  for (const p of parts) {
    const m = /^"([^"]*)"$/.exec(p) ?? /^'([^']*)'$/.exec(p);
    if (!m) return null;
    out.push(m[1]!);
  }
  return out;
}

/** "Tab panel" -> "TabPanel"; "date time picker" -> "DateTimePicker". */
export function pascalCase(s: string): string {
  return s
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join("");
}

export function uniq<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}

export const sortBy = <T>(arr: T[], key: (t: T) => string): T[] => [...arr].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));

/** Path of an atlassian.design URL without trailing slash ("/components/button"). */
export function docsPath(url: string): string {
  try {
    const u = new URL(url, "https://atlassian.design");
    return u.pathname.replace(/\/+$/, "") || "/";
  } catch {
    return url;
  }
}
