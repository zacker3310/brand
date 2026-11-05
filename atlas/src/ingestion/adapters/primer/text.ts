/** Small, pure text helpers shared by the Primer parsers. */

/** Strip lightweight Markdown (code ticks, emphasis, links, HTML tags) and collapse whitespace. */
export function stripMarkdown(s: string, opts: { keepCode?: boolean } = {}): string {
  let t = s.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  if (!opts.keepCode) t = t.replace(/<[^>]+>/g, " ").replace(/`([^`]*)`/g, "$1");
  return t
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, "$1$2")
    .replace(/(^|[\s(])_([^_\s][^_]*)_/g, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Concise excerpt: whole sentences up to `max` characters (at least the first sentence,
 * truncated with an ellipsis if it alone exceeds `max`). Used to keep stored descriptions short
 * (copyright: concise facts, not page copies).
 */
export function shortText(input: string | null | undefined, max = 280): string | null {
  if (!input) return null;
  const s = input.replace(/\s+/g, " ").trim();
  if (!s) return null;
  if (s.length <= max) return s;
  const sentences = splitSentences(s);
  let out = "";
  for (const sentence of sentences) {
    const next = out ? `${out} ${sentence}` : sentence;
    if (next.length > max) break;
    out = next;
  }
  if (out) return out;
  return `${s.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Split prose into sentences at "<.!?> <Capital|digit|quote|tag>", never after common abbreviations
 * ("e.g.", "i.e.", "etc.", "vs."). Pieces re-join to the input (no text is ever dropped).
 */
export function splitSentences(text: string): string[] {
  return text.split(/(?<!\b(?:e\.g|i\.e|etc|vs|cf|approx|incl|[A-Z])\.)(?<=[.!?])\s+(?=[A-Z0-9"'“(`<])/);
}

/** `'a' | 'b'` (possibly multi-line) -> ["a","b"]; null if the type is not a pure string-literal union. */
export function parseStringLiteralUnion(type: string | null | undefined): string[] | null {
  if (!type) return null;
  const parts = type
    .replace(/\s+/g, " ")
    .split("|")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;
  const out: string[] = [];
  for (const p of parts) {
    const m = /^'([^']*)'$/.exec(p) ?? /^"([^"]*)"$/.exec(p);
    if (!m) return null;
    out.push(m[1]!);
  }
  return out;
}

/** "trailing-counter-with-no-text" -> "Trailing counter with no text" */
export function humanize(s: string): string {
  const t = s.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  return t ? t[0]!.toUpperCase() + t.slice(1) : t;
}

/**
 * Documented default values are kept as authored (e.g. "'medium'" stays a TS string literal);
 * empty strings ("" is used by docs.json for "no documented default") become null.
 */
export function cleanDefault(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).replace(/\s+/g, " ").trim();
  return s ? s.slice(0, 300) : null;
}

export function uniq<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}
