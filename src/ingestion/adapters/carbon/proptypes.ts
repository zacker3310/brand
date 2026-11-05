/**
 * Static extraction of React component props from Carbon's compiled CommonJS build
 * (@carbon/react/lib/components/**). We read `<Component>.propTypes = { ... }` object literals
 * and destructuring defaults as TEXT with a small JS-aware scanner (strings, comments, brackets).
 * Nothing is evaluated or executed.
 */
import { firstSentences } from "./mdx";

export interface ExtractedProp {
  name: string;
  type: string | null;
  defaultValue: string | null;
  required: boolean | null;
  deprecated: boolean;
  description: string | null;
  allowedValues: string[] | null;
}

export interface PropTypesResult {
  exportName: string;
  props: ExtractedProp[];
  /** Original TS/JS source path from the build's `//#region` marker, if present. */
  sourcePath: string | null;
  /** Local files the module requires (for following re-exports). */
  localRequires: string[];
  /** `...spread` entries in the propTypes object (inherited props not resolved statically). */
  spreads: string[];
}

/* ------------------------------- scanner ---------------------------------- */

/** Index just past the end of a string/comment starting at i, or -1 if none starts there. */
function skipNonCode(src: string, i: number): number {
  const c = src[i];
  const n = src[i + 1];
  if (c === "/" && n === "/") {
    const e = src.indexOf("\n", i);
    return e < 0 ? src.length : e;
  }
  if (c === "/" && n === "*") {
    const e = src.indexOf("*/", i + 2);
    return e < 0 ? src.length : e + 2;
  }
  if (c === '"' || c === "'") {
    let j = i + 1;
    while (j < src.length && src[j] !== c) {
      if (src[j] === "\\") j++;
      j++;
    }
    return j + 1;
  }
  if (c === "`") {
    let j = i + 1;
    let depth = 0;
    while (j < src.length) {
      if (src[j] === "\\") {
        j += 2;
        continue;
      }
      if (depth === 0 && src[j] === "`") return j + 1;
      if (src[j] === "$" && src[j + 1] === "{") {
        depth++;
        j += 2;
        continue;
      }
      if (depth > 0 && src[j] === "}") depth--;
      j++;
    }
    return src.length;
  }
  return -1;
}

const OPEN: Record<string, string> = { "{": "}", "(": ")", "[": "]" };

/** Given index of an opening bracket, return index of its matching close bracket (or -1). */
export function matchBracket(src: string, open: number): number {
  const stack: string[] = [];
  for (let i = open; i < src.length; i++) {
    const skip = skipNonCode(src, i);
    if (skip >= 0) {
      i = skip - 1;
      continue;
    }
    const ch = src[i]!;
    if (OPEN[ch]) stack.push(OPEN[ch]!);
    else if (ch === "}" || ch === ")" || ch === "]") {
      if (stack.pop() !== ch) return -1;
      if (!stack.length) return i;
    }
  }
  return -1;
}

export interface TopLevelEntry {
  /** Comments immediately preceding the entry. */
  comments: string[];
  text: string;
}

/** Split the inside of an object/array/param list on top-level commas, keeping leading comments. */
export function splitTopLevel(inner: string): TopLevelEntry[] {
  const out: TopLevelEntry[] = [];
  let depth = 0;
  let start = 0;
  let comments: string[] = [];
  let sawCode = false;
  const push = (end: number) => {
    const text = inner.slice(start, end).replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "").trim();
    if (text) out.push({ comments, text });
    comments = [];
    sawCode = false;
  };
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i]!;
    if (ch === "/" && (inner[i + 1] === "*" || inner[i + 1] === "/")) {
      const end = skipNonCode(inner, i);
      if (depth === 0 && !sawCode) comments.push(inner.slice(i, end));
      i = end - 1;
      continue;
    }
    const skip = skipNonCode(inner, i);
    if (skip >= 0) {
      sawCode = true;
      i = skip - 1;
      continue;
    }
    if (OPEN[ch]) depth++;
    else if (ch === "}" || ch === ")" || ch === "]") depth--;
    else if (ch === "," && depth === 0) {
      push(i);
      start = i + 1;
      continue;
    }
    if (!/\s/.test(ch)) sawCode = true;
  }
  push(inner.length);
  return out;
}

/** Index of the first top-level occurrence of `ch` in s (outside strings/brackets), or -1. */
function topLevelIndex(s: string, pred: (s: string, i: number) => boolean): number {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const skip = skipNonCode(s, i);
    if (skip >= 0) {
      i = skip - 1;
      continue;
    }
    const ch = s[i]!;
    if (OPEN[ch]) depth++;
    else if (ch === "}" || ch === ")" || ch === "]") depth--;
    else if (depth === 0 && pred(s, i)) return i;
  }
  return -1;
}

/* ------------------------------ doc comments ------------------------------ */

export function cleanJsDoc(comments: string[]): { text: string | null; deprecated: boolean } {
  const raw = comments
    .filter((c) => c.startsWith("/**") || c.startsWith("/*"))
    .map((c) =>
      c
        .replace(/^\/\*\*?/, "")
        .replace(/\*\/$/, "")
        .split("\n")
        .map((l) => l.replace(/^\s*\*\s?/, ""))
        .join("\n"),
    )
    .join("\n");
  const deprecated = /@deprecated\b/.test(raw);
  // Drop tag lines (@see, @deprecated ...) and keep prose.
  const prose = raw
    .split(/\n(?=\s*@)/)[0]!
    .replace(/^\s*@\w+.*$/gm, "")
    .replace(/\s+/g, " ")
    .trim();
  return { text: prose ? firstSentences(prose, 280) : null, deprecated };
}

/* ------------------------------- type mapping ----------------------------- */

const SIMPLE: Record<string, string> = {
  bool: "boolean",
  string: "string",
  number: "number",
  func: "function",
  node: "ReactNode",
  element: "ReactElement",
  elementType: "ElementType",
  object: "object",
  array: "array",
  any: "any",
  symbol: "symbol",
  bigint: "bigint",
};

interface MappedType {
  type: string | null;
  allowed: string[] | null;
  required: boolean | null;
  deprecated: boolean;
}

/** Parse a string/number literal list like `["a", "b", 3]`. Returns null if any item is not a literal. */
export function literalList(text: string): string[] | null {
  const t = text.trim();
  if (!t.startsWith("[") || !t.endsWith("]")) return null;
  const items = splitTopLevel(t.slice(1, -1)).map((e) => e.text);
  const out: string[] = [];
  for (const it of items) {
    const s = it.match(/^(["'])((?:\\.|(?!\1).)*)\1$/);
    if (s) out.push(s[2]!.replace(/\\(.)/g, "$1"));
    else if (/^-?\d+(\.\d+)?$/.test(it)) out.push(it);
    else return null;
  }
  return out;
}

/** For an inline literal list, which items are numeric literals (vs. strings). */
function literalKinds(text: string): boolean[] | null {
  const t = text.trim();
  if (!t.startsWith("[") || !t.endsWith("]")) return null;
  return splitTopLevel(t.slice(1, -1)).map((e) => /^-?\d+(\.\d+)?$/.test(e.text));
}

function callArgs(expr: string, calleeLen: number): string[] | null {
  const open = expr.indexOf("(", calleeLen - 1);
  if (open < 0) return null;
  const close = matchBracket(expr, open);
  if (close < 0) return null;
  return splitTopLevel(expr.slice(open + 1, close)).map((e) => e.text);
}

export function mapPropType(exprIn: string, consts: Map<string, string[]>): MappedType {
  let expr = exprIn.replace(/\s+/g, " ").trim().replace(/\/\*#__PURE__\*\/\s*/g, "");
  let required: boolean | null = false;
  let deprecated = false;
  if (/\.isRequired$/.test(expr)) {
    required = true;
    expr = expr.replace(/\.isRequired$/, "");
  }
  expr = expr.replace(/\bprop_types\.default\./g, "PT.").replace(/\bPropTypes\./g, "PT.");
  // Wrappers: deprecate(inner, msg), deprecateValuesWithin(inner, ...), requiredIfGivenPropIsTruthy(name, inner) ...
  const wrapper = expr.match(/^(?:[\w$]+\.)?([\w$]+)\(/);
  if (wrapper && !expr.startsWith("PT.")) {
    const fn = wrapper[1]!;
    const args = callArgs(expr, wrapper[0].length) ?? [];
    if (fn === "deprecate") {
      const inner = args[0] ? mapPropType(args[0], consts) : { type: null, allowed: null, required: null, deprecated: false };
      return { ...inner, deprecated: true, required: inner.required };
    }
    const ptArg = args.find((a) => a.trim().startsWith("PT.") || /prop_types\.default\./.test(a));
    if (ptArg) {
      const inner = mapPropType(ptArg, consts);
      // Conditional-required wrappers (requiredIfGivenPropIsTruthy, isRequiredOneOf...) make required unknown.
      return { ...inner, required: fn === "deprecateValuesWithin" ? inner.required : null };
    }
    return { type: null, allowed: null, required: null, deprecated };
  }
  if (!expr.startsWith("PT.")) {
    // Custom validator functions or unknown references: type not statically known.
    return { type: null, allowed: null, required: /^\(|^function/.test(expr) ? null : required, deprecated };
  }
  const simple = expr.match(/^PT\.(\w+)$/);
  if (simple) return { type: SIMPLE[simple[1]!] ?? simple[1]!, allowed: null, required, deprecated };
  const call = expr.match(/^PT\.(\w+)\(/);
  if (!call) return { type: null, allowed: null, required, deprecated };
  const kind = call[1]!;
  const args = callArgs(expr, call[0].length) ?? [];
  const a0 = args[0] ?? "";
  switch (kind) {
    case "oneOf": {
      const lits = literalList(a0) ?? consts.get(a0.trim()) ?? null;
      if (!lits) return { type: "enum", allowed: null, required, deprecated };
      const numeric = (v: string) => /^-?\d+(\.\d+)?$/.test(v) && !/^["']/.test(v);
      const isNumLit = literalKinds(a0);
      return {
        type: lits.map((v, i) => ((isNumLit?.[i] ?? numeric(v)) ? v : `"${v}"`)).join(" | "),
        allowed: lits,
        required,
        deprecated,
      };
    }
    case "oneOfType": {
      const items = a0.trim().startsWith("[") ? splitTopLevel(a0.trim().slice(1, -1)).map((e) => e.text) : [];
      const types = items.map((it) => mapPropType(it, consts).type ?? "unknown");
      const uniq = [...new Set(types)];
      return { type: uniq.length ? uniq.join(" | ") : null, allowed: null, required, deprecated };
    }
    case "arrayOf": {
      const inner = mapPropType(a0, consts).type;
      return { type: inner ? (inner.includes("|") ? `(${inner})[]` : `${inner}[]`) : "array", allowed: null, required, deprecated };
    }
    case "objectOf": {
      const inner = mapPropType(a0, consts).type;
      return { type: `Record<string, ${inner ?? "unknown"}>`, allowed: null, required, deprecated };
    }
    case "shape":
    case "exact":
      return { type: "object", allowed: null, required, deprecated };
    case "instanceOf": {
      const id = a0.trim();
      return { type: /^[A-Z]\w*$/.test(id) ? id : "object", allowed: null, required, deprecated };
    }
    default:
      return { type: null, allowed: null, required, deprecated };
  }
}

/* ----------------------------- module scanning ---------------------------- */

/** `const NAME = [ "a", "b" ];` literal arrays declared in the module. */
export function constArrays(src: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const m of src.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*\[/g)) {
    const open = (m.index ?? 0) + m[0].length - 1;
    const close = matchBracket(src, open);
    if (close < 0) continue;
    const lits = literalList(src.slice(open, close + 1));
    if (lits) out.set(m[1]!, lits);
  }
  return out;
}

const LITERAL_DEFAULT = /^(true|false|null|-?\d+(\.\d+)?|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`[^`$]*`|\[\]|\{\}|\(\) => \{\}|void 0)$/;

function normalizeDefault(v: string): string | null {
  const t = v.replace(/\s+/g, " ").trim();
  if (!LITERAL_DEFAULT.test(t)) return null;
  if (t === "void 0") return "undefined";
  if (t === "() => {}") return "() => {}";
  return t.replace(/^'(.*)'$/, '"$1"').replace(/^`(.*)`$/, '"$1"');
}

/** Defaults from destructuring patterns in the component's definition. */
export function destructuringDefaults(src: string, exportName: string): Map<string, string> {
  const out = new Map<string, string>();
  const def = new RegExp(`(?:const|let|var)\\s+${exportName}\\s*=|function\\s+${exportName}\\s*\\(`).exec(src);
  if (!def) return out;
  const windowEnd = Math.min(src.length, def.index + 8000);
  const patterns: string[] = [];
  // First parameter pattern: "({ ... }" right after the definition start.
  const paramOpen = src.slice(def.index, windowEnd).search(/\(\s*\{/);
  if (paramOpen >= 0 && paramOpen < 400) {
    const brace = src.indexOf("{", def.index + paramOpen);
    const close = matchBracket(src, brace);
    if (close > 0) patterns.push(src.slice(brace + 1, close));
  }
  // `const { ... } = props;` inside the body.
  const body = src.slice(def.index, windowEnd);
  for (const m of body.matchAll(/(?:const|let)\s*\{/g)) {
    const brace = def.index + (m.index ?? 0) + m[0].length - 1;
    const close = matchBracket(src, brace);
    if (close < 0) continue;
    if (/^\s*=\s*props\b/.test(src.slice(close + 1, close + 20))) patterns.push(src.slice(brace + 1, close));
  }
  for (const p of patterns) {
    for (const { text } of splitTopLevel(p)) {
      if (text.startsWith("...")) continue;
      const eq = topLevelIndex(text, (s, i) => s[i] === "=" && s[i + 1] !== ">" && s[i + 1] !== "=" && s[i - 1] !== "=" && s[i - 1] !== "!");
      if (eq < 0) continue;
      const lhs = text.slice(0, eq).trim();
      const colon = topLevelIndex(lhs, (s, i) => s[i] === ":");
      const keyRaw = (colon >= 0 ? lhs.slice(0, colon) : lhs).trim().replace(/^\[(.*)\]$/, "$1");
      const key = keyRaw.replace(/^["'](.*)["']$/, "$1");
      const val = normalizeDefault(text.slice(eq + 1));
      if (key && val !== null && !out.has(key)) out.set(key, val);
    }
  }
  return out;
}

/** Extract `<exportName>.propTypes = {...}` (and `.defaultProps`) from a compiled module. */
export function extractPropTypes(src: string, exportName: string): PropTypesResult | null {
  const re = new RegExp(`(?:^|[\\s;])${exportName.replace(/\$/g, "\\$")}\\.propTypes\\s*=\\s*\\{`, "m");
  const m = re.exec(src);
  const localRequires = [...src.matchAll(/require\(["'](\.\/[^"']+)["']\)/g)].map((x) => x[1]!);
  const region = src.match(/\/\/#region (src\/components\/[^\s]+)/);
  if (!m) return null;
  const open = m.index + m[0].length - 1;
  const close = matchBracket(src, open);
  if (close < 0) return null;
  const consts = constArrays(src);
  const defaults = destructuringDefaults(src, exportName);
  const dpm = new RegExp(`${exportName}\\.defaultProps\\s*=\\s*\\{`).exec(src);
  if (dpm) {
    const o = dpm.index + dpm[0].length - 1;
    const c = matchBracket(src, o);
    if (c > 0)
      for (const { text } of splitTopLevel(src.slice(o + 1, c))) {
        const colon = topLevelIndex(text, (s, i) => s[i] === ":");
        if (colon < 0) continue;
        const k = text.slice(0, colon).trim().replace(/^["'](.*)["']$/, "$1");
        const v = normalizeDefault(text.slice(colon + 1));
        if (k && v !== null && !defaults.has(k)) defaults.set(k, v);
      }
  }
  const props: ExtractedProp[] = [];
  const spreads: string[] = [];
  for (const entry of splitTopLevel(src.slice(open + 1, close))) {
    if (entry.text.startsWith("...")) {
      spreads.push(entry.text.slice(3).trim());
      continue;
    }
    const colon = topLevelIndex(entry.text, (s, i) => s[i] === ":");
    if (colon < 0) continue;
    const rawKey = entry.text.slice(0, colon).trim();
    const key = rawKey.replace(/^\[(.*)\]$/, "$1").replace(/^["'](.*)["']$/, "$1");
    if (!/^[A-Za-z_$][\w$-]*$/.test(key)) continue;
    const mapped = mapPropType(entry.text.slice(colon + 1), consts);
    const doc = cleanJsDoc(entry.comments);
    if (props.some((p) => p.name === key)) continue;
    props.push({
      name: key,
      type: mapped.type,
      defaultValue: defaults.get(key) ?? null,
      required: mapped.required,
      deprecated: mapped.deprecated || doc.deprecated,
      description: doc.text,
      allowedValues: mapped.allowed,
    });
  }
  return { exportName, props, sourcePath: findRegionFor(src, open) ?? region?.[1] ?? null, localRequires, spreads };
}

/** The `//#region src/...` marker that precedes a position (compiled builds concatenate modules). */
function findRegionFor(src: string, pos: number): string | null {
  let last: string | null = null;
  for (const m of src.matchAll(/\/\/#region (src\/[^\s]+)/g)) {
    if ((m.index ?? 0) > pos) break;
    last = m[1]!;
  }
  return last;
}

/** Local `require("./X.js")` targets of a module, used to follow index.js re-exports. */
export function localRequires(src: string): string[] {
  return [...new Set([...src.matchAll(/require\(["'](\.\/[^"']+\.js)["']\)/g)].map((x) => x[1]!))];
}
