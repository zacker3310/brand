/**
 * Static token parsers for Ant Design and Ant Design Mobile. Pure; fetched JavaScript and CSS are
 * scanned as text (object-literal entries, custom property declarations) and never executed.
 *
 * Ant Design publishes in the npm package:
 *  - es/version/token-meta.json  names, descriptions, declared TS type and layer (seed/map/alias) of
 *                                global tokens, plus documented component tokens per component;
 *  - es/version/token.json       per component: global tokens used + default component token values;
 *  - dist/antd.css               the default theme rendered as CSS custom properties (--ant-*);
 *  - es/theme/themes/seed.js     seed token literals; es/theme/util/alias.js alias derivations.
 */
import { parseCssCustomProperties } from "@/lib/tokens/css";

/** Ant Design's token -> CSS variable key transform (token2CSSVar in @ant-design/cssinjs). */
export function antdKebab(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z0-9]+)/g, "$1-$2")
    .replace(/([a-z])([0-9])/g, "$1-$2")
    .toLowerCase();
}

/* ------------------------------- token-meta.json ------------------------------ */

export interface MetaGlobal {
  name: string;
  nameEn: string | null;
  descEn: string | null;
  type: string | null;
  source: "seed" | "map" | "alias" | string;
}
export interface MetaComponentToken {
  token: string;
  type: string | null;
  descEn: string | null;
}
export interface TokenMeta {
  global: MetaGlobal[];
  /** Keyed by the component name used in token-meta.json (e.g. "Button", "QrCode"). */
  components: Record<string, MetaComponentToken[]>;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

export function parseTokenMeta(text: string): TokenMeta {
  const j = JSON.parse(text) as { global?: Record<string, Record<string, unknown>>; components?: Record<string, Record<string, unknown>[]> };
  const global: MetaGlobal[] = Object.entries(j.global ?? {})
    .map(([name, v]) => ({ name, nameEn: str(v.nameEn), descEn: str(v.descEn), type: str(v.type), source: str(v.source) ?? "unknown" }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const components: Record<string, MetaComponentToken[]> = {};
  for (const [comp, list] of Object.entries(j.components ?? {})) {
    if (!Array.isArray(list)) continue;
    components[comp] = list
      .filter((x) => typeof x?.token === "string")
      .map((x) => ({ token: String(x.token), type: str(x.type), descEn: str(x.descEn) }));
  }
  return { global, components };
}

/* --------------------------------- token.json --------------------------------- */

export interface TokenJsonEntry {
  global: string[];
  component: Record<string, string | number | boolean>;
}

export function parseTokenJson(text: string): Record<string, TokenJsonEntry> {
  const j = JSON.parse(text) as Record<string, { global?: unknown; component?: unknown }>;
  const out: Record<string, TokenJsonEntry> = {};
  for (const [comp, v] of Object.entries(j)) {
    const global = Array.isArray(v?.global) ? (v.global as unknown[]).filter((x): x is string => typeof x === "string") : [];
    const component: Record<string, string | number | boolean> = {};
    if (v?.component && typeof v.component === "object") {
      for (const [k, val] of Object.entries(v.component as Record<string, unknown>)) {
        if (typeof val === "string" || typeof val === "number" || typeof val === "boolean") component[k] = val;
      }
    }
    out[comp] = { global: [...new Set(global)], component };
  }
  return out;
}

/* --------------------------------- dist/antd.css -------------------------------- */

export interface DistCssVars {
  /** Generated scope class of the default theme block, e.g. ".css-var-_R_0_". */
  scope: string | null;
  /** Global token custom properties declared on the bare scope class (default theme). */
  global: Record<string, string>;
  /** Component-scoped custom properties declared on ".<scope>.ant-<component>" rules (first occurrence wins). */
  component: Record<string, string>;
  declarations: number;
}

export function parseDistCss(css: string): DistCssVars {
  const decls = parseCssCustomProperties(css, { maxLength: 4_000_000 });
  // The default theme scope is the bare `.css-var-<id>` class used by the most component rules.
  const usage = new Map<string, number>();
  for (const d of decls) {
    const m = /^(\.css-var-[A-Za-z0-9_-]+)\.ant-/.exec(d.selector);
    if (m) usage.set(m[1]!, (usage.get(m[1]!) ?? 0) + 1);
  }
  const scope = [...usage.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
  const global: Record<string, string> = {};
  const component: Record<string, string> = {};
  if (scope) {
    for (const d of decls) {
      if (d.media || d.conditions) continue;
      if (d.selector === scope) {
        if (!(d.name in global)) global[d.name] = d.value;
      } else if (d.selector.startsWith(`${scope}.`) && !d.selector.includes(",") && !d.selector.includes(" ")) {
        if (!(d.name in component)) component[d.name] = d.value;
      }
    }
  }
  return { scope, global, component, declarations: decls.length };
}

/* ------------------------------ JS object literals ------------------------------ */

export type Literal = string | number | boolean;

/** Index of the brace matching the "{" at `open` (skips strings, template literals and comments). */
function matchBrace(src: string, open: number): number {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i]!;
    if (c === "/" && src[i + 1] === "/") {
      const nl = src.indexOf("\n", i);
      i = nl < 0 ? src.length : nl;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const e = src.indexOf("*/", i + 2);
      i = e < 0 ? src.length : e + 1;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") {
      let j = i + 1;
      while (j < src.length && src[j] !== c) j += src[j] === "\\" ? 2 : 1;
      i = j;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** Split an object-literal body on top-level commas. */
function topLevelEntries(body: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (let i = 0; i < body.length; i++) {
    const c = body[i]!;
    if (c === "'" || c === '"' || c === "`") {
      let j = i + 1;
      while (j < body.length && body[j] !== c) j += body[j] === "\\" ? 2 : 1;
      cur += body.slice(i, j + 1);
      i = j;
      continue;
    }
    if (c === "{" || c === "(" || c === "[") depth++;
    if (c === "}" || c === ")" || c === "]") depth--;
    if (c === "," && depth === 0) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  if (cur.trim()) out.push(cur);
  return out.map((e) => e.trim()).filter(Boolean);
}

/** Literal value of a JS expression string, or undefined when it is not a plain literal. */
export function jsLiteral(expr: string): Literal | undefined {
  const e = expr.trim();
  if (/^-?\d+(\.\d+)?$/.test(e)) return Number(e);
  if (e === "true") return true;
  if (e === "false") return false;
  const q = /^(['"])((?:\\.|(?!\1).)*)\1$/s.exec(e);
  if (q) return q[2]!.replace(/\\(['"\\])/g, "$1");
  const t = /^`([^`$]*)`$/s.exec(e);
  if (t) return t[1]!.replace(/\s*\n\s*/g, " ").trim();
  return undefined;
}

export interface ObjectEntry {
  key: string;
  /** Raw expression text ("'#1677ff'", "mergedToken.colorText", "screenSM - 1", "...spread"). */
  expr: string;
  spread: boolean;
}

/** Entries of the object literal that starts at the first "{" at or after `from`. */
export function objectEntriesAt(src: string, from: number): ObjectEntry[] {
  const open = src.indexOf("{", from);
  if (open < 0) return [];
  const close = matchBrace(src, open);
  if (close < 0) return [];
  const body = stripComments(src.slice(open + 1, close));
  const out: ObjectEntry[] = [];
  for (const e of topLevelEntries(body)) {
    if (e.startsWith("...")) {
      out.push({ key: e.slice(3).trim(), expr: e, spread: true });
      continue;
    }
    const m = /^(?:(['"])([^'"]+)\1|([A-Za-z_$][\w$]*))\s*:\s*([\s\S]+)$/.exec(e);
    if (m) out.push({ key: (m[2] ?? m[3])!, expr: m[4]!.trim(), spread: false });
    else if (/^[A-Za-z_$][\w$]*$/.test(e)) out.push({ key: e, expr: e, spread: false }); // shorthand
  }
  return out;
}

/** es/theme/themes/seed.js: `defaultPresetColors` and `seedToken` literal values (spreads resolved within the file). */
export function parseSeedJs(js: string): { values: Record<string, Literal>; presetColors: Record<string, string> } {
  const presetColors: Record<string, string> = {};
  const pIdx = js.search(/\bdefaultPresetColors\s*=\s*\{/);
  if (pIdx >= 0) for (const e of objectEntriesAt(js, pIdx)) {
    const v = jsLiteral(e.expr);
    if (!e.spread && typeof v === "string") presetColors[e.key] = v;
  }
  const values: Record<string, Literal> = {};
  const sIdx = js.search(/\bseedToken\s*=\s*(?:Object\.assign\()?\s*[{(]?/);
  if (sIdx >= 0) {
    for (const e of objectEntriesAt(js, sIdx)) {
      if (e.spread) {
        if (e.key === "defaultPresetColors") Object.assign(values, presetColors);
        continue;
      }
      const v = jsLiteral(e.expr);
      if (v !== undefined) values[e.key] = v;
    }
  }
  return { values, presetColors };
}

export type AliasDerivation =
  | { kind: "ref"; target: string }
  | { kind: "const"; name: string; value: number }
  | { kind: "const-offset"; name: string; offset: number }
  | { kind: "literal"; value: Literal };

/**
 * es/theme/util/alias.js (formatToken): `const screenXS = 480;` constants and the aliasToken object
 * entries that are plain aliases (`key: mergedToken.other`), constants, constant offsets
 * (`screenSM - 1`) or literals. Computed entries (function calls, arithmetic on tokens) are skipped.
 */
export function parseAliasJs(js: string): { consts: Record<string, number>; entries: Record<string, AliasDerivation> } {
  const consts: Record<string, number> = {};
  for (const m of js.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*(-?\d+(?:\.\d+)?)\s*;/g)) consts[m[1]!] = Number(m[2]);
  const entries: Record<string, AliasDerivation> = {};
  const aIdx = js.search(/\baliasToken\s*=\s*\{/);
  if (aIdx < 0) return { consts, entries };
  for (const e of objectEntriesAt(js, aIdx)) {
    if (e.spread) continue;
    const x = e.expr.replace(/\s+/g, " ").trim();
    let m: RegExpExecArray | null;
    if ((m = /^mergedToken\.([A-Za-z_$][\w$]*)$/.exec(x))) entries[e.key] = { kind: "ref", target: m[1]! };
    else if (x in consts) entries[e.key] = { kind: "const", name: x, value: consts[x]! };
    else if ((m = /^([A-Za-z_$][\w$]*)\s*([-+])\s*(\d+)$/.exec(x)) && m[1]! in consts) entries[e.key] = { kind: "const-offset", name: m[1]!, offset: (m[2] === "-" ? -1 : 1) * Number(m[3]) };
    else {
      const v = jsLiteral(x);
      if (v !== undefined) entries[e.key] = { kind: "literal", value: v };
    }
  }
  return { consts, entries };
}

/**
 * es/<component>/style/{token,index}.js: component token defaults that are plain aliases of a global
 * token inside `prepareComponentToken` (`defaultColor: token.colorText`, or `const x = token.y; ... x,`).
 */
export function parseComponentTokenRefs(js: string): Record<string, string> {
  const out: Record<string, string> = {};
  const start = js.search(/\bprepareComponentToken\s*=/);
  if (start < 0) return out;
  // Function body: from the arrow to the matching brace of its body (or object for `=> ({`).
  const arrow = js.indexOf("=>", start);
  if (arrow < 0) return out;
  const open = js.indexOf("{", arrow);
  if (open < 0) return out;
  const close = matchBrace(js, open);
  if (close < 0) return out;
  const body = js.slice(open, close + 1);
  const locals = new Map<string, string>();
  for (const m of body.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*token\.([A-Za-z_$][\w$]*)\s*;/g)) locals.set(m[1]!, m[2]!);
  // Returned object: last `return {` in the body, or the arrow's object literal itself.
  const retIdx = body.lastIndexOf("return {");
  const objStart = retIdx >= 0 ? retIdx : /^\{\s*\.\.\.|^\{\s*[A-Za-z_$]/.test(body) ? 0 : -1;
  if (objStart < 0) return out;
  for (const e of objectEntriesAt(body, objStart)) {
    if (e.spread) continue;
    const x = e.expr.replace(/\s+/g, " ").trim();
    const m = /^token\.([A-Za-z_$][\w$]*)$/.exec(x);
    if (m) out[e.key] = m[1]!;
    else if (/^[A-Za-z_$][\w$]*$/.test(x) && locals.has(x)) out[e.key] = locals.get(x)!;
  }
  return out;
}

/** es/theme/interface/presetColors.d.ts: preset color names and whether palette keys (`blue1`..`blue10`) are typed. */
export function parsePresetColorsDts(dts: string): { presets: string[]; palettes: boolean; legacyPalettes: boolean } {
  const m = /PresetColors\s*:\s*readonly\s*\[([^\]]*)\]/.exec(dts);
  const presets = m ? [...m[1]!.matchAll(/["']([a-z]+)["']/g)].map((x) => x[1]!) : [];
  return {
    presets,
    palettes: /type\s+ColorPalettes\s*=/.test(dts) && /\$\{keyof PresetColorType\}\$\{ColorPaletteKeyIndex\}/.test(dts),
    legacyPalettes: /type\s+LegacyColorPalettes\s*=/.test(dts),
  };
}

/** es/index.d.ts: `export { default as Button } from './button'` -> { "button": ["Button"] }. */
export function parseIndexExports(dts: string, prefix = "./"): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const re = new RegExp(`export\\s*\\{\\s*default\\s+as\\s+([A-Za-z_$][\\w$]*)\\s*\\}\\s*from\\s*['"]${prefix.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}([a-z0-9-]+)['"]`, "g");
  for (const m of dts.matchAll(re)) {
    const dir = m[2]!;
    out[dir] = [...new Set([...(out[dir] ?? []), m[1]!])];
  }
  return out;
}

/* ---------------------------------- mobile ---------------------------------- */

export interface MobileThemeCss {
  root: { name: string; value: string; line: number }[];
  dark: { name: string; value: string; line: number }[];
  darkSelector: string | null;
}

/** es/global/theme-default.css (`:root`) and theme-dark.css (`html[data-prefers-color-scheme='dark']`). */
export function parseMobileThemeCss(css: string): MobileThemeCss {
  const decls = parseCssCustomProperties(css);
  const root: MobileThemeCss["root"] = [];
  const dark: MobileThemeCss["dark"] = [];
  let darkSelector: string | null = null;
  const seenRoot = new Set<string>();
  const seenDark = new Set<string>();
  for (const d of decls) {
    if (d.media || d.conditions) continue;
    if (d.selector === ":root") {
      if (!seenRoot.has(d.name)) root.push({ name: d.name, value: d.value, line: d.line });
      seenRoot.add(d.name);
    } else if (/prefers-color-scheme=['"]?dark/.test(d.selector)) {
      darkSelector = darkSelector ?? d.selector;
      if (!seenDark.has(d.name)) dark.push({ name: d.name, value: d.value, line: d.line });
      seenDark.add(d.name);
    }
  }
  return { root, dark, darkSelector };
}

/** `var(--x)` targets in a CSS value. */
export function cssVarRefs(value: string): string[] {
  return [...new Set([...value.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)/g)].map((m) => m[1]!))];
}

/** Ant Design Mobile config/components.ts: nav groups -> component routes. */
export function parseMobileNav(ts: string): { group: string; routes: string[] }[] {
  const out: { group: string; routes: string[] }[] = [];
  const idx = ts.search(/export\s+const\s+components\s*=\s*\{/);
  if (idx < 0) return out;
  for (const e of objectEntriesAt(ts, idx)) {
    if (e.spread) continue;
    const routes = [...stripComments(e.expr).matchAll(/['"](\/[a-z0-9/-]+)['"]/g)].map((m) => m[1]!);
    out.push({ group: e.key, routes });
  }
  return out;
}
