/**
 * Reference syntax shared by the token library (resolve.ts, graph.ts, css.ts, validate.ts).
 *
 * Recognised reference forms (all static; nothing is evaluated):
 *  - DTCG / Style Dictionary curly refs: "{color.blue.500}", embedded ("{size.1} {size.2}"),
 *    legacy Style Dictionary "{color.base.red.value}" (".value" suffix handled by the resolver).
 *  - CSS custom-property refs: "var(--x)", "var(--x, fallback)", nested "var(--a, var(--b, 4px))".
 *  - DTCG JSON-pointer refs inside composite values: { "$ref": "#/color/blue/500" }.
 *
 * Pure functions; never throw on malformed input (unbalanced parens/braces are left as text).
 */

export type RefSyntax = "dtcg" | "css-var" | "json-pointer";

export interface StringReference {
  syntax: "dtcg" | "css-var";
  /** Target key: "color.blue.500" (dtcg) or "--color-blue-500" (css-var). */
  ref: string;
  /** Exact source text of the reference: "{color.blue.500}" or "var(--x, 4px)". */
  raw: string;
  /** css-var only: fallback text after the first top-level comma (trimmed); null when absent. "" is a valid empty fallback. */
  fallback: string | null;
  start: number;
  end: number;
}

export interface ValueReference {
  syntax: RefSyntax;
  ref: string;
  raw: string;
  fallback: string | null;
  /** True when the reference is the entire (trimmed) string value, so the target's typed value can be substituted. */
  whole: boolean;
  /** Location inside a composite value, e.g. ["offsetX"] or [0, "color"]. [] for a plain string value. */
  path: (string | number)[];
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

const IDENT_CHAR = /[A-Za-z0-9_-]/;
const MAX_STRING_SCAN = 200_000;

/** Index of the ")" matching the "(" at `open` (respecting quotes); -1 if unbalanced. */
export function matchParen(s: string, open: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < s.length; i++) {
    const c = s[i]!;
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Split on top-level commas (outside parens/brackets/quotes). */
export function splitTopLevel(s: string, sep = ","): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (quote) {
      cur += c;
      if (c === "\\" && i + 1 < s.length) cur += s[++i];
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth = Math.max(0, depth - 1);
    if (c === sep && depth === 0) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out;
}

/** Parse a single "var(" occurrence at index `at` (pointing at "v"). */
function parseVarAt(s: string, at: number): StringReference | null {
  const open = at + 3;
  if (s[open] !== "(") return null;
  const close = matchParen(s, open);
  if (close < 0) return null;
  const inner = s.slice(open + 1, close);
  // first top-level comma separates name and fallback
  let depth = 0;
  let quote: string | null = null;
  let comma = -1;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i]!;
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === "," && depth === 0) {
      comma = i;
      break;
    }
  }
  const name = (comma < 0 ? inner : inner.slice(0, comma)).trim();
  if (!/^--[^\s,()]*$/.test(name) || name.length < 3) return null;
  return {
    syntax: "css-var",
    ref: name,
    raw: s.slice(at, close + 1),
    fallback: comma < 0 ? null : inner.slice(comma + 1).trim(),
    start: at,
    end: close + 1,
  };
}

/**
 * Find top-level references in a string (DTCG curly refs and outer CSS var() calls), in source order.
 * Nested var() inside a fallback is NOT returned here (it belongs to the fallback); use
 * findCssVarReferences() to list every var name including nested fallbacks.
 */
export function findStringReferences(s: string): StringReference[] {
  if (typeof s !== "string" || s.length === 0) return [];
  const str = s.length > MAX_STRING_SCAN ? s.slice(0, MAX_STRING_SCAN) : s;
  const out: StringReference[] = [];
  let i = 0;
  while (i < str.length) {
    const c = str[i]!;
    if (c === "{") {
      const close = str.indexOf("}", i + 1);
      const nextOpen = str.indexOf("{", i + 1);
      if (close > i + 1 && (nextOpen < 0 || nextOpen > close)) {
        const inner = str.slice(i + 1, close).trim();
        // Exclude JSON-ish / CSS-block-ish text: refs never contain ":" ";" quotes or line breaks.
        if (inner && !/[:;"'\n\r]/.test(inner)) {
          out.push({ syntax: "dtcg", ref: inner, raw: str.slice(i, close + 1), fallback: null, start: i, end: close + 1 });
          i = close + 1;
          continue;
        }
      }
      i++;
      continue;
    }
    if ((c === "v" || c === "V") && str.slice(i, i + 4).toLowerCase() === "var(" && (i === 0 || !IDENT_CHAR.test(str[i - 1]!))) {
      const ref = parseVarAt(str, i);
      if (ref) {
        out.push(ref);
        i = ref.end;
        continue;
      }
    }
    i++;
  }
  return out;
}

/** Every custom-property name referenced via var(), including names nested in fallbacks. Unique, source order. */
export function findCssVarReferences(s: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const visit = (text: string, depth: number) => {
    if (depth > 16) return;
    for (const r of findStringReferences(text)) {
      if (r.syntax !== "css-var") continue;
      if (!seen.has(r.ref)) {
        seen.add(r.ref);
        out.push(r.ref);
      }
      if (r.fallback) visit(r.fallback, depth + 1);
    }
  };
  if (typeof s === "string") visit(s, 0);
  return out;
}

/** "#/color/blue/500" (optionally ending in "/$value") -> "color.blue.500"; null if not a local JSON pointer. */
export function jsonPointerToPath(pointer: string): string | null {
  if (typeof pointer !== "string" || !pointer.startsWith("#/")) return null;
  const parts = pointer
    .slice(2)
    .split("/")
    .map((p) => p.replace(/~1/g, "/").replace(/~0/g, "~"));
  while (parts.length && (parts[parts.length - 1] === "$value" || parts[parts.length - 1] === "")) parts.pop();
  if (!parts.length || parts.some((p) => p === "")) return null;
  return parts.join(".");
}

/** True for a DTCG JSON-pointer reference object: { "$ref": "#/..." } (no other keys). */
export function isJsonPointerRef(v: unknown): v is { $ref: string } {
  return isObj(v) && typeof v.$ref === "string" && Object.keys(v).length === 1 && jsonPointerToPath(v.$ref) !== null;
}

/** Collect top-level references anywhere in a raw token value (strings, arrays, objects). */
export function collectValueReferences(value: unknown, maxNodes = 10_000): ValueReference[] {
  const out: ValueReference[] = [];
  let budget = maxNodes;
  const visit = (v: unknown, path: (string | number)[], depth: number) => {
    if (budget-- <= 0 || depth > 32) return;
    if (typeof v === "string") {
      const refs = findStringReferences(v);
      const trimmed = v.trim();
      for (const r of refs) out.push({ syntax: r.syntax, ref: r.ref, raw: r.raw, fallback: r.fallback, whole: refs.length === 1 && trimmed === r.raw, path });
    } else if (Array.isArray(v)) {
      v.forEach((x, i) => visit(x, [...path, i], depth + 1));
    } else if (isJsonPointerRef(v)) {
      out.push({ syntax: "json-pointer", ref: jsonPointerToPath(v.$ref)!, raw: v.$ref, fallback: null, whole: true, path });
    } else if (isObj(v)) {
      for (const [k, x] of Object.entries(v)) visit(x, [...path, k], depth + 1);
    }
  };
  visit(value, [], 0);
  return out;
}

/** True if the value contains any reference (DTCG, var(), or JSON pointer). */
export function hasReferences(value: unknown): boolean {
  return collectValueReferences(value, 2_000).length > 0;
}

/** True if a string is exactly one reference (whole-value alias). */
export function isWholeReference(value: unknown): boolean {
  if (typeof value !== "string") return isJsonPointerRef(value);
  const refs = findStringReferences(value);
  return refs.length === 1 && refs[0]!.raw === value.trim();
}
