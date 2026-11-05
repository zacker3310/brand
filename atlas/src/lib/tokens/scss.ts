/**
 * Conservative static SCSS variable parser (pure; never evaluates Sass; never throws).
 *
 * Supported (the shapes used by Material Web token SCSS and Carbon theme SCSS):
 *  - Module-level variables:  `$name: value;` with `!default` / `!global` flags.
 *  - Maps and nested maps:    `$white: (background: #ffffff, layer: (01: #f4f4f4), 'key': value) !default;`
 *  - Lists:                   `$supported-tokens: ('background', 'error');`
 *  - Function-return maps:    `@function values($deps: $_default) { @return ( 'k': v, ... ); }`
 *                             (Material Web v0_192 token files) -> emitted with context "@function values".
 *  - References in values:    `$other`, `module.$var` (namespaced, from `@use`), `map.get($m, 'a', 'b')`
 *                             / `map-get($m, a)`.
 *  - Doc comments:            consecutive `///` lines before a variable (Material Web: first line holds the
 *                             canonical token name, e.g. "md.sys.color.primary"); `@deprecated` detected.
 *  - `@use` / `@forward` / `@import` paths and namespaces.
 *
 * Limits (by design; values are kept as authored text and flagged, never guessed):
 *  - No evaluation of expressions, math, functions (`utilities.merge(...)`, `rgba($c, .5)`), interpolation
 *    `#{...}`, control flow (`@if/@each/@for`), mixins, placeholder selectors, or variable shadowing.
 *  - Variables declared inside selectors, mixins, control blocks or non-map-returning functions are skipped
 *    (counted in `skipped`).
 *  - A variable reassigned later in the file appears once per assignment (source order); consumers
 *    decide (Sass semantics: `!default` does not override an earlier value).
 *  - Map keys are unquoted (`'background'` -> `background`); numeric-looking keys stay strings ("01").
 */

export type ScssValue = { kind: "scalar"; raw: string } | { kind: "map"; entries: ScssMapEntry[] } | { kind: "list"; items: ScssValue[] };

export interface ScssMapEntry {
  key: string;
  value: ScssValue;
  line: number;
}

export interface ScssReference {
  /** As authored: "$primary", "md-sys-color.$primary", "map.get($deps, 'md-ref-palette', 'neutral6')". */
  raw: string;
  kind: "variable" | "map-get";
  /** Variable name without "$" (for map-get: the map variable). */
  name: string;
  /** `@use` namespace ("md-sys-color") or null for local variables. */
  namespace: string | null;
  /** map-get keys (unquoted), e.g. ["md-ref-palette", "neutral6"]. */
  keys?: string[];
}

export interface ScssVariable {
  /** Name without "$" ("md-sys-color-primary"), or the function name for function-return maps. */
  name: string;
  value: ScssValue;
  /** Value text as authored (comments removed, flags stripped, whitespace collapsed for scalars). */
  rawValue: string;
  isMap: boolean;
  flags: { default: boolean; global: boolean };
  /** References found anywhere in the value (unique by raw). */
  references: ScssReference[];
  line: number;
  /** `///` doc comment text (lines joined with "\n"), null if none. */
  doc: string | null;
  deprecated: boolean;
  /** Private by Sass convention (name starts with "-" or "_"). */
  private: boolean;
  /** "module" for top-level variables; "@function <name>" for function-return maps. */
  context: string;
}

export interface ScssParseResult {
  variables: ScssVariable[];
  uses: { kind: "use" | "forward" | "import"; path: string; namespace: string | null; line: number }[];
  skipped: { line: number; reason: string; text: string }[];
}

export interface ParseScssOptions {
  /** Include `$-private`/`$_private` variables (default true; flagged via `private`). */
  includePrivate?: boolean;
  /** Parse `@function x() { @return (map) }` bodies (default true). */
  includeFunctionReturnMaps?: boolean;
  /** Safety cap on input size (default 5_000_000 chars). */
  maxLength?: number;
}

const collapse = (s: string) => s.replace(/\s+/g, " ").trim();
const unquote = (s: string) => {
  const t = s.trim();
  return (t.startsWith("'") && t.endsWith("'")) || (t.startsWith('"') && t.endsWith('"')) ? t.slice(1, -1) : t;
};

class Src {
  readonly s: string;
  private lineStarts: number[];
  constructor(s: string) {
    this.s = s;
    this.lineStarts = [0];
    for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 10) this.lineStarts.push(i + 1);
  }
  line(pos: number): number {
    let lo = 0;
    let hi = this.lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.lineStarts[mid]! <= pos) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  }
}

/** True when "//" at i starts a line comment (not "://" inside a URL). */
function isLineComment(s: string, i: number): boolean {
  return s[i] === "/" && s[i + 1] === "/" && s[i - 1] !== ":";
}

function skipString(s: string, i: number): number {
  const q = s[i]!;
  for (let j = i + 1; j < s.length; j++) {
    if (s[j] === "\\") j++;
    else if (s[j] === q) return j + 1;
  }
  return s.length;
}

/** Index of ";" (or "}" closing the current block) at depth 0 starting at i; handles strings, comments, (), #{}. */
function findStatementEnd(s: string, i: number): number {
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    const c = s[j]!;
    if (c === '"' || c === "'") {
      j = skipString(s, j) - 1;
      continue;
    }
    if (c === "/" && s[j + 1] === "*") {
      const e = s.indexOf("*/", j + 2);
      j = e < 0 ? s.length : e + 1;
      continue;
    }
    if (isLineComment(s, j)) {
      const e = s.indexOf("\n", j);
      j = e < 0 ? s.length : e;
      continue;
    }
    if (c === "(" || c === "[" || (c === "{" && s[j - 1] === "#")) depth++;
    else if (c === ")" || c === "]") depth = Math.max(0, depth - 1);
    else if (c === "}" && depth > 0) depth--;
    else if (depth === 0 && (c === ";" || c === "}")) return j;
    else if (depth === 0 && c === "{") return j;
  }
  return s.length;
}

function matchBrace(s: string, open: number): number {
  let depth = 0;
  for (let j = open; j < s.length; j++) {
    const c = s[j]!;
    if (c === '"' || c === "'") {
      j = skipString(s, j) - 1;
      continue;
    }
    if (c === "/" && s[j + 1] === "*") {
      const e = s.indexOf("*/", j + 2);
      j = e < 0 ? s.length : e + 1;
      continue;
    }
    if (isLineComment(s, j)) {
      const e = s.indexOf("\n", j);
      j = e < 0 ? s.length : e;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return j;
    }
  }
  return s.length;
}

/** Remove // and /* *\/ comments outside strings, preserving newlines (for line numbers). */
function stripComments(s: string): string {
  let out = "";
  for (let j = 0; j < s.length; j++) {
    const c = s[j]!;
    if (c === '"' || c === "'") {
      const e = skipString(s, j);
      out += s.slice(j, e);
      j = e - 1;
      continue;
    }
    if (c === "/" && s[j + 1] === "*") {
      const e = s.indexOf("*/", j + 2);
      const end = e < 0 ? s.length : e + 2;
      out += s.slice(j, end).replace(/[^\n]/g, " ");
      j = end - 1;
      continue;
    }
    if (isLineComment(s, j)) {
      const e = s.indexOf("\n", j);
      const end = e < 0 ? s.length : e;
      out += " ".repeat(end - j);
      j = end - 1;
      continue;
    }
    out += c;
  }
  return out;
}

/** Split on top-level commas (outside (), [], strings, #{}). Returns [text, offset] pairs. */
function splitTop(s: string, sep: string): [string, number][] {
  const out: [string, number][] = [];
  let depth = 0;
  let start = 0;
  for (let j = 0; j < s.length; j++) {
    const c = s[j]!;
    if (c === '"' || c === "'") {
      j = skipString(s, j) - 1;
      continue;
    }
    if (c === "(" || c === "[" || (c === "{" && s[j - 1] === "#")) depth++;
    else if (c === ")" || c === "]" || c === "}") depth = Math.max(0, depth - 1);
    else if (c === sep && depth === 0) {
      out.push([s.slice(start, j), start]);
      start = j + 1;
    }
  }
  out.push([s.slice(start), start]);
  return out;
}

/** Index of the first top-level ":" (outside parens/strings/#{}); -1 if none. */
function topLevelColon(s: string): number {
  let depth = 0;
  for (let j = 0; j < s.length; j++) {
    const c = s[j]!;
    if (c === '"' || c === "'") {
      j = skipString(s, j) - 1;
      continue;
    }
    if (c === "(" || c === "[" || (c === "{" && s[j - 1] === "#")) depth++;
    else if (c === ")" || c === "]" || c === "}") depth = Math.max(0, depth - 1);
    else if (c === ":" && depth === 0) return j;
  }
  return -1;
}

/** True if text is "( ... )" with the outer parens matching each other. */
function isWrapped(t: string): boolean {
  if (!t.startsWith("(") || !t.endsWith(")")) return false;
  let depth = 0;
  for (let j = 0; j < t.length; j++) {
    const c = t[j]!;
    if (c === '"' || c === "'") {
      j = skipString(t, j) - 1;
      continue;
    }
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0 && j < t.length - 1) return false;
    }
  }
  return depth === 0;
}

/** Parse a value (comments already stripped). `base` is the absolute offset of `text` for line numbers. */
function parseValue(text: string, base: number, src: Src, depth = 0): ScssValue {
  const t = text.trim();
  if (depth < 16 && isWrapped(t)) {
    const lead = text.indexOf("(");
    const inner = t.slice(1, -1);
    const innerBase = base + lead + 1;
    const parts = splitTop(inner, ",").filter(([p]) => p.trim().length > 0);
    const isMap = parts.length > 0 && parts.every(([p]) => topLevelColon(p) > 0);
    if (isMap) {
      const entries: ScssMapEntry[] = parts.map(([p, off]) => {
        const colon = topLevelColon(p);
        const keyText = p.slice(0, colon);
        const lead2 = keyText.length - keyText.trimStart().length;
        return { key: unquote(keyText), value: parseValue(p.slice(colon + 1), innerBase + off + colon + 1, src, depth + 1), line: src.line(innerBase + off + lead2) };
      });
      return { kind: "map", entries };
    }
    if (parts.length > 1 || (parts.length === 1 && splitTop(inner, ",").length > 1)) {
      return { kind: "list", items: parts.map(([p, off]) => parseValue(p, innerBase + off, src, depth + 1)) };
    }
    if (parts.length === 0) return { kind: "list", items: [] };
  }
  return { kind: "scalar", raw: collapse(t) };
}

const MAP_GET_RE = /\b(?:map\.get|map-get)\(\s*(?:([\w-]+)\.)?\$([\w-]+)\s*((?:,\s*(?:"[^"]*"|'[^']*'|[^,()]+)\s*)+)\)/g;
const VAR_RE = /(?:\b([a-zA-Z_][\w-]*)\.)?\$([a-zA-Z_-][\w-]*)/g;

/** References in a scalar SCSS value. */
export function findScssReferences(raw: string): ScssReference[] {
  const out: ScssReference[] = [];
  const seen = new Set<string>();
  const covered: [number, number][] = [];
  for (const m of raw.matchAll(MAP_GET_RE)) {
    const keys = splitTop(m[3]!.replace(/^\s*,/, ""), ",")
      .map(([k]) => unquote(k))
      .filter(Boolean);
    const r: ScssReference = { raw: m[0], kind: "map-get", name: m[2]!, namespace: m[1] ?? null, keys };
    covered.push([m.index!, m.index! + m[0].length]);
    if (!seen.has(r.raw)) {
      seen.add(r.raw);
      out.push(r);
    }
  }
  for (const m of raw.matchAll(VAR_RE)) {
    const at = m.index!;
    if (covered.some(([a, b]) => at >= a && at < b)) continue;
    // Skip "$" inside quoted strings.
    const before = raw.slice(0, at);
    if (((before.match(/'/g)?.length ?? 0) % 2 === 1) || ((before.match(/"/g)?.length ?? 0) % 2 === 1)) continue;
    const r: ScssReference = { raw: m[0], kind: "variable", name: m[2]!, namespace: m[1] ?? null };
    if (!seen.has(r.raw)) {
      seen.add(r.raw);
      out.push(r);
    }
  }
  return out;
}

function collectRefs(v: ScssValue, out: ScssReference[], seen: Set<string>) {
  if (v.kind === "scalar") {
    for (const r of findScssReferences(v.raw)) {
      if (!seen.has(r.raw)) {
        seen.add(r.raw);
        out.push(r);
      }
    }
  } else if (v.kind === "map") v.entries.forEach((e) => collectRefs(e.value, out, seen));
  else v.items.forEach((x) => collectRefs(x, out, seen));
}

function makeVariable(
  name: string,
  valueText: string,
  valueBase: number,
  src: Src,
  line: number,
  doc: string[] | null,
  context: string,
  flags: { default: boolean; global: boolean },
): ScssVariable {
  const value = parseValue(valueText, valueBase, src);
  const refs: ScssReference[] = [];
  collectRefs(value, refs, new Set());
  const docText = doc && doc.length ? doc.join("\n").trim() || null : null;
  return {
    name,
    value,
    rawValue: value.kind === "scalar" ? value.raw : valueText.trim(),
    isMap: value.kind === "map",
    flags,
    references: refs,
    line,
    doc: docText,
    deprecated: !!docText && /@deprecated\b/i.test(docText),
    private: /^[-_]/.test(name),
    context,
  };
}

const FLAG_RE = /\s*!(default|global)\b/gi;

function splitFlags(valueText: string): { text: string; flags: { default: boolean; global: boolean } } {
  const flags = { default: false, global: false };
  // Only strip flags at top level at the end of the value.
  let text = valueText;
  for (;;) {
    const m = /\s*!(default|global)\s*$/i.exec(text);
    if (!m) break;
    if (m[1]!.toLowerCase() === "default") flags.default = true;
    else flags.global = true;
    text = text.slice(0, m.index);
  }
  void FLAG_RE;
  return { text, flags };
}

/** Parse SCSS source and return module-level variables, maps and function-return maps. */
export function parseScssVariables(scss: string, opts: ParseScssOptions = {}): ScssParseResult {
  const result: ScssParseResult = { variables: [], uses: [], skipped: [] };
  if (typeof scss !== "string" || !scss) return result;
  try {
    const maxLength = opts.maxLength ?? 5_000_000;
    const raw = scss.length > maxLength ? scss.slice(0, maxLength) : scss;
    const src = new Src(raw);
    const clean = stripComments(raw);
    const includePrivate = opts.includePrivate !== false;
    const includeFn = opts.includeFunctionReturnMaps !== false;

    // Doc comments: map line number -> "///" text. Collect consecutive runs and attach to the next statement.
    const docLines = new Map<number, string>();
    raw.split("\n").forEach((l, idx) => {
      const m = /^\s*\/\/\/\s?(.*)$/.exec(l);
      if (m) docLines.set(idx + 1, m[1]!.trimEnd());
    });
    const docFor = (line: number): string[] | null => {
      const out: string[] = [];
      let l = line - 1;
      while (docLines.has(l)) {
        out.unshift(docLines.get(l)!);
        l--;
      }
      return out.length ? out : null;
    };

    let i = 0;
    const n = clean.length;
    while (i < n) {
      const c = clean[i]!;
      if (/\s/.test(c) || c === ";" || c === "}") {
        i++;
        continue;
      }
      if (c === "$") {
        const m = /^\$([a-zA-Z_-][\w-]*)\s*:/.exec(clean.slice(i, i + 300));
        const end = findStatementEnd(clean, i);
        if (!m) {
          result.skipped.push({ line: src.line(i), reason: "unparsed-statement", text: collapse(clean.slice(i, Math.min(end, i + 80))) });
          i = end + 1;
          continue;
        }
        const name = m[1]!;
        const valueStart = i + m[0].length;
        const { text, flags } = splitFlags(clean.slice(valueStart, end));
        const line = src.line(i);
        if (includePrivate || !/^[-_]/.test(name)) {
          result.variables.push(makeVariable(name, text, valueStart, src, line, docFor(line), "module", flags));
        }
        i = end + 1;
        continue;
      }
      if (c === "@") {
        const m = /^@([\w-]+)/.exec(clean.slice(i, i + 64));
        const kw = (m?.[1] ?? "").toLowerCase();
        const end = findStatementEnd(clean, i);
        const line = src.line(i);
        if (kw === "use" || kw === "forward" || kw === "import") {
          const stmt = clean.slice(i, end);
          const paths = [...stmt.matchAll(/(["'])([^"']+)\1/g)].map((x) => x[2]!);
          const ns = /\bas\s+([\w-]+|\*)/.exec(stmt)?.[1] ?? null;
          for (const p of paths) {
            const defaultNs = kw === "use" ? (p.split("/").pop() ?? p).replace(/^_/, "").replace(/\.s[ac]ss$/, "").replace(/^sass:/, "") : null;
            result.uses.push({ kind: kw, path: p, namespace: kw === "use" ? (ns === "*" ? null : (ns ?? defaultNs)) : null, line });
          }
          i = end + 1;
          continue;
        }
        if (clean[end] === "{") {
          const close = matchBrace(clean, end);
          if (kw === "function" && includeFn) {
            const fname = /^@function\s+([\w-]+)/.exec(clean.slice(i, end))?.[1] ?? "anonymous";
            const body = clean.slice(end + 1, close);
            const ret = /@return\s*/.exec(body);
            let emitted = false;
            if (ret) {
              const rStart = end + 1 + ret.index + ret[0].length;
              const rEnd = findStatementEnd(clean, rStart);
              const text = clean.slice(rStart, rEnd);
              const value = parseValue(text, rStart, src);
              const onlyReturn = (body.match(/@return\b/g)?.length ?? 0) === 1 && !/@if\b|@each\b|@for\b|@while\b/.test(body);
              if (value.kind === "map" && onlyReturn) {
                result.variables.push(makeVariable(fname, text, rStart, src, src.line(rStart), docFor(line), `@function ${fname}`, { default: false, global: false }));
                emitted = true;
              }
            }
            if (!emitted) result.skipped.push({ line, reason: "function-body", text: collapse(clean.slice(i, Math.min(end, i + 80))) });
          } else {
            const inner = clean.slice(end + 1, close);
            if (/\$[\w-]+\s*:/.test(inner)) result.skipped.push({ line, reason: `@${kw}-block`, text: collapse(clean.slice(i, Math.min(end, i + 80))) });
          }
          i = close + 1;
          continue;
        }
        i = end + 1;
        continue;
      }
      // Selector / placeholder / mixin include at top level: skip blocks entirely.
      const end = findStatementEnd(clean, i);
      if (clean[end] === "{") {
        const close = matchBrace(clean, end);
        const inner = clean.slice(end + 1, close);
        if (/\$[\w-]+\s*:/.test(inner)) result.skipped.push({ line: src.line(i), reason: "selector-block", text: collapse(clean.slice(i, Math.min(end, i + 80))) });
        i = close + 1;
      } else i = end + 1;
    }
  } catch {
    /* return partial result */
  }
  return result;
}

/* -------------------------------------------------------------------------- */
/* Flattening                                                                  */
/* -------------------------------------------------------------------------- */

export interface FlatScssEntry {
  /** "white.background", "md-sys-color-primary", "values-dark.on-primary". */
  name: string;
  path: string[];
  /** Scalar value as authored. */
  rawValue: string;
  references: ScssReference[];
  line: number;
  doc: string | null;
  deprecated: boolean;
  /** Name of the top-level variable this entry came from. */
  variable: string;
  context: string;
}

/**
 * Flatten variables and (nested) maps into scalar entries. Lists are kept as their authored text.
 * Map entries take the line of their key; doc/deprecated come from the owning variable.
 */
export function flattenScssVariables(result: ScssParseResult, opts: { separator?: string } = {}): FlatScssEntry[] {
  const sep = opts.separator ?? ".";
  const out: FlatScssEntry[] = [];
  const listText = (v: ScssValue): string => (v.kind === "scalar" ? v.raw : v.kind === "list" ? `(${v.items.map(listText).join(", ")})` : `(${v.entries.map((e) => `${e.key}: ${listText(e.value)}`).join(", ")})`);
  const walk = (v: ScssValue, path: string[], line: number, owner: ScssVariable, depth: number) => {
    if (depth > 16) return;
    if (v.kind === "map") {
      for (const e of v.entries) walk(e.value, [...path, e.key], e.line, owner, depth + 1);
      return;
    }
    const rawValue = listText(v);
    out.push({ name: path.join(sep), path, rawValue, references: findScssReferences(rawValue), line, doc: owner.doc, deprecated: owner.deprecated, variable: owner.name, context: owner.context });
  };
  for (const v of result?.variables ?? []) walk(v.value, [v.name], v.line, v, 0);
  return out;
}

/**
 * Convert an SCSS reference into a dotted token key, e.g. "md-sys-color.$primary" -> "md-sys-color.primary",
 * "map.get($deps, 'md-ref-palette', 'neutral6')" -> "md-ref-palette.neutral6" (when the map is a function
 * dependency parameter listed in `paramMaps`, default ["deps"]), otherwise "<map>.<keys...>".
 */
export function scssReferenceKey(ref: ScssReference, opts: { paramMaps?: string[]; separator?: string } = {}): string {
  const sep = opts.separator ?? ".";
  if (ref.kind === "variable") return ref.namespace ? `${ref.namespace}${sep}${ref.name}` : ref.name;
  const params = opts.paramMaps ?? ["deps"];
  const keys = ref.keys ?? [];
  if (params.includes(ref.name)) return keys.join(sep);
  return [ref.namespace ? `${ref.namespace}${sep}${ref.name}` : ref.name, ...keys].join(sep);
}
