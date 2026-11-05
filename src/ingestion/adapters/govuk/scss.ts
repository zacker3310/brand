/**
 * Static SCSS parsing for govuk-frontend: settings files -> design tokens, component `_mixin.scss`
 * -> BEM modifiers and token usages. Sass is never evaluated: values stay as authored, except that
 * GOV.UK helper calls with literal arguments are rewritten to ATLAS reference syntax:
 *
 *   govuk-colour("blue", $variant: "tint-25")   -> {govuk-palette.blue.tint-25}   (variant defaults to "primary")
 *   govuk-functional-colour(brand)              -> {govuk-functional-colours.brand}
 *   govuk-spacing(3)                            -> {govuk-spacing-points.3}
 *   (name: "blue", variant: "tint-95")          -> {govuk-palette.blue.tint-95}   (functional colour maps)
 *   "magenta" "tint-50"                         -> {govuk-palette.magenta.tint-50} (pre-brand correspondence list)
 *   $govuk-gutter / base.$govuk-gutter          -> {govuk-gutter}
 *   string.unquote("max(1px, .0625rem)")        -> max(1px, .0625rem)               (literal unquote only)
 *
 * Palette references are finalized in normalize (fixPaletteRefs) once every palette name is known.
 */
import type { NormalizedToken, TokenCategory, TokenTier } from "@/lib/contracts";
import { parseScssVariables, type ScssValue, type ScssVariable } from "@/lib/tokens/scss";
import type { TokenSetKey } from "./constants";
import { clip, collapse } from "./markdown";

/* --------------------------------- SassDoc --------------------------------- */

export interface SassDoc {
  description: string | null;
  type: string | null;
  access: string | null;
  deprecated: string | null;
}

export function parseSassDoc(doc: string | null): SassDoc {
  if (!doc) return { description: null, type: null, access: null, deprecated: null };
  const lines = doc.split("\n");
  const desc: string[] = [];
  let type: string | null = null;
  let access: string | null = null;
  let deprecated: string | null = null;
  let inTag: string | null = null;
  for (const raw of lines) {
    const l = raw.trim();
    const tag = /^@([\w-]+)\s*(.*)$/.exec(l);
    if (tag) {
      inTag = tag[1]!.toLowerCase();
      if (inTag === "type") type = tag[2]!.trim() || null;
      else if (inTag === "access") access = tag[2]!.trim() || null;
      else if (inTag === "deprecated") deprecated = tag[2]!.trim();
      continue;
    }
    if (inTag === "deprecated" && l) deprecated = `${deprecated ? `${deprecated} ` : ""}${l}`;
    else if (!inTag) desc.push(l);
  }
  // First paragraph is a title ("Brand colour"); keep title + following paragraph(s), stop at examples.
  const text = collapse(desc.join("\n").split(/\n\s*\n/).slice(0, 3).join(" ").replace(/`/g, ""));
  return { description: text || null, type, access, deprecated: deprecated === null ? null : collapse(deprecated.replace(/`/g, "")) };
}

/* ------------------------------ value rewriting ------------------------------ */

const NS = String.raw`(?:[\w-]+\.)?`;
export type Prefix = "govuk" | "nhsuk";

const RULES = new Map<Prefix, { colour: RegExp; functional: RegExp | null; spacing: RegExp; varRef: RegExp }>(
  (["govuk", "nhsuk"] as const).map((px) => [
    px,
    {
      colour: new RegExp(String.raw`${NS}${px}-colour\(\s*["']?([\w-]+)["']?\s*(?:,\s*(?:\$variant\s*:\s*)?["']?([\w-]+)["']?\s*)?\)`, "g"),
      functional: px === "govuk" ? new RegExp(String.raw`${NS}govuk-functional-colour\(\s*["']?([\w-]+)["']?\s*\)`, "g") : null,
      spacing: new RegExp(String.raw`${NS}${px}-spacing\(\s*(\d)\s*\)`, "g"),
      varRef: new RegExp(String.raw`${NS}\$(${px}-[\w-]+)`, "g"),
    },
  ]),
);
const UNQUOTE = new RegExp(String.raw`^${NS}unquote\(\s*(["'])(.*)\1\s*\)$`);

/** GOV.UK palette entries have variants (`primary` by default); the NHS palette is a flat map. */
export const paletteRef = (name: string, variant: string | null | undefined, prefix: Prefix = "govuk") =>
  prefix === "govuk" ? `govuk-palette.${name}.${variant ?? "primary"}` : `nhsuk-colours.${name}`;

/** Rewrite helper calls / variable refs in an SCSS value; returns the raw value and reference names. */
export function rewriteScssValue(raw: string, opts: { localVars?: Set<string>; prefix?: Prefix } = {}): { rawValue: string | number; references: string[] } {
  const prefix = opts.prefix ?? "govuk";
  const rules = RULES.get(prefix)!;
  const refs: string[] = [];
  let v = collapse(raw);
  const unq = UNQUOTE.exec(v);
  if (unq) v = unq[2]!;
  const pre = prefix === "govuk" ? /^"([\w-]+)"\s+"([\w-]+)"$/.exec(v) : null;
  if (pre) {
    const r = paletteRef(pre[1]!, pre[2]!);
    return { rawValue: `{${r}}`, references: [r] };
  }
  v = v.replace(rules.colour, (_m, n: string, variant?: string) => {
    const r = paletteRef(n, variant, prefix);
    refs.push(r);
    return `{${r}}`;
  });
  if (rules.functional)
    v = v.replace(rules.functional, (_m, n: string) => {
      const r = `govuk-functional-colours.${n}`;
      refs.push(r);
      return `{${r}}`;
    });
  v = v.replace(rules.spacing, (_m, n: string) => {
    const r = `${prefix}-spacing-points.${n}`;
    refs.push(r);
    return `{${r}}`;
  });
  v = v.replace(rules.varRef, (m, n: string) => {
    if (opts.localVars?.has(n)) return m;
    refs.push(n);
    return `{${n}}`;
  });
  if (!refs.length && /^-?\d+(\.\d+)?$/.test(v)) return { rawValue: Number(v), references: [] };
  return { rawValue: v, references: [...new Set(refs)] };
}

/* ------------------------------ settings tokens ------------------------------ */

export interface SettingsToken {
  name: string;
  path: string[];
  rawValue: string | number;
  references: string[];
  /** Variable-level SassDoc description (first paragraphs). */
  doc: string | null;
  /** `//` comment directly above a map entry (when enabled for the file). */
  comment: string | null;
  sassType: string | null;
  deprecated: boolean;
  deprecationNote: string | null;
  line: number;
  variable: string;
}

export interface SettingsParse {
  tokens: SettingsToken[];
  skipped: { name: string; reason: string; line: number }[];
}

/** Blank the outer parens of `$x: ((...));` (a map wrapped in a redundant list), preserving offsets. */
export function unwrapDoubleParens(src: string): string {
  let out = src;
  for (const m of src.matchAll(/\$[\w-]+\s*:\s*\(/g)) {
    const open = m.index! + m[0].length - 1;
    const close = matchParen(src, open);
    if (close < 0) continue;
    const inner = src.slice(open + 1, close);
    const lead = inner.length - inner.trimStart().length;
    const trimmed = inner.trim();
    if (!trimmed.startsWith("(")) continue;
    const innerOpen = open + 1 + lead;
    const innerClose = matchParen(src, innerOpen);
    if (innerClose < 0 || src.slice(innerClose + 1, close).trim() !== "") continue;
    out = `${out.slice(0, open)} ${out.slice(open + 1, close)} ${out.slice(close + 1)}`;
  }
  return out;
}

function matchParen(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    const c = s[i]!;
    if (c === '"' || c === "'") {
      const e = s.indexOf(c, i + 1);
      if (e < 0) return -1;
      i = e;
      continue;
    }
    if (c === "/" && s[i + 1] === "/") {
      const e = s.indexOf("\n", i);
      i = e < 0 ? s.length : e;
      continue;
    }
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * SassDoc block (`///` lines) above a 1-based line, allowing up to two blank lines in between
 * (govuk-frontend separates doc blocks from variables with a blank line). `////` group markers end the block.
 */
export function sassDocAbove(lines: string[], line: number): string | null {
  let i = line - 2;
  let blanks = 0;
  while (i >= 0 && lines[i]!.trim() === "" && blanks < 2) {
    i--;
    blanks++;
  }
  const out: string[] = [];
  for (; i >= 0; i--) {
    const l = lines[i]!;
    if (/^\s*\/\/\/\//.test(l)) break;
    const m = /^\s*\/\/\/\s?(.*)$/.exec(l);
    if (!m) break;
    out.unshift(m[1]!.trimEnd());
  }
  return out.length ? out.join("\n") : null;
}

/** `//` comment lines directly above a 1-based line (not `///` SassDoc). */
function commentAbove(lines: string[], line: number): string | null {
  const out: string[] = [];
  for (let i = line - 2; i >= 0; i--) {
    const m = /^\s*\/\/(?!\/)\s?(.*)$/.exec(lines[i]!);
    if (!m) break;
    out.unshift(m[1]!.trim());
  }
  return out.length ? collapse(out.join(" ")) : null;
}

const isColourRefMap = (v: ScssValue): boolean =>
  v.kind === "map" && v.entries.length > 0 && v.entries.every((e) => (e.key === "name" || e.key === "variant") && e.value.kind === "scalar") && v.entries.some((e) => e.key === "name");

const unquote = (s: string) => s.trim().replace(/^["']|["']$/g, "");

/**
 * Parse a settings file into flat tokens. Rules (all static):
 *  - Boolean settings (SassDoc `@type Boolean`) and private `$_x` variables are skipped (configuration flags).
 *  - `$public: $default-map !default;` makes `$default-map`'s entries tokens under the public name.
 *  - Later reassignments of an already emitted variable are skipped (internal merges).
 *  - Map entries named `deprecation-message` mark sibling tokens deprecated instead of becoming tokens.
 */
export function parseSettingsFile(text: string, opts: { entryComments?: boolean; prefix?: Prefix } = {}): SettingsParse {
  const prefix = opts.prefix ?? "govuk";
  const src = unwrapDoubleParens(text);
  const lines = text.split("\n");
  const res = parseScssVariables(src, { includeFunctionReturnMaps: false });
  const skipped: SettingsParse["skipped"] = [];
  const vars = res.variables.filter((v) => v.context === "module");
  // Public aliases of whole maps.
  const mapVars = new Map(vars.filter((v) => v.isMap).map((v) => [v.name, v]));
  const renamed = new Map<string, string>();
  for (const v of vars) {
    const m = /^\$([\w-]+)$/.exec(v.rawValue.trim());
    if (m && mapVars.has(m[1]!) && !v.private) renamed.set(m[1]!, v.name);
  }
  const tokens: SettingsToken[] = [];
  const emitted = new Set<string>();
  for (const v of vars) {
    const doc = parseSassDoc(v.doc ?? sassDocAbove(lines, v.line));
    if (v.private) {
      skipped.push({ name: v.name, reason: "private variable", line: v.line });
      continue;
    }
    if ((doc.type && /^bool/i.test(doc.type)) || /^(true|false)$/.test(v.rawValue.trim())) {
      skipped.push({ name: v.name, reason: "boolean setting", line: v.line });
      continue;
    }
    if (/-(path|url)$/.test(v.name) || v.rawValue.includes("#{")) {
      skipped.push({ name: v.name, reason: "configuration path or interpolated string", line: v.line });
      continue;
    }
    if ([...renamed.values()].includes(v.name) && /^\$[\w-]+$/.test(v.rawValue.trim())) continue; // alias line itself
    const name = renamed.get(v.name) ?? v.name;
    if (emitted.has(name)) {
      skipped.push({ name: v.name, reason: "reassignment of an emitted variable", line: v.line });
      continue;
    }
    emitted.add(name);
    const base = {
      doc: doc.description,
      sassType: doc.type,
      deprecated: doc.deprecated !== null,
      deprecationNote: doc.deprecated,
      variable: v.name,
    };
    const walk = (val: ScssValue, path: string[], line: number, depth: number) => {
      if (depth > 8) return;
      if (prefix === "govuk" && val.kind === "map" && isColourRefMap(val)) {
        const n = unquote((val.entries.find((e) => e.key === "name")!.value as { raw: string }).raw);
        const variantEntry = val.entries.find((e) => e.key === "variant");
        const variant = variantEntry ? unquote((variantEntry.value as { raw: string }).raw) : null;
        const r = paletteRef(n, variant);
        tokens.push({ ...base, name: path.join("."), path, rawValue: `{${r}}`, references: [r], comment: opts.entryComments ? commentAbove(lines, line) : null, line });
        return;
      }
      if (val.kind === "map") {
        if (!val.entries.length) return;
        const depMsg = val.entries.find((e) => e.key === "deprecation-message" && e.value.kind === "scalar");
        for (const e of val.entries) {
          if (e === depMsg) continue;
          const before = tokens.length;
          walk(e.value, [...path, e.key], e.line, depth + 1);
          if (depMsg) {
            const note = clip(unquote((depMsg.value as { raw: string }).raw).replace(/`/g, ""), 300);
            for (let i = before; i < tokens.length; i++) tokens[i] = { ...tokens[i]!, deprecated: true, deprecationNote: note };
          }
        }
        return;
      }
      // Empty maps/lists (e.g. `$nhsuk-colours-aliases: () !default;`) are extension points, not tokens.
      if (val.kind === "list" && val.items.length === 0) return;
      const rawText = val.kind === "scalar" ? val.raw : listText(val);
      const { rawValue, references } = rewriteScssValue(rawText, { prefix });
      tokens.push({ ...base, name: path.join("."), path, rawValue, references, comment: opts.entryComments && depth > 0 ? commentAbove(lines, line) : null, line });
    };
    walk(v.value, [name], v.line, 0);
  }
  for (const s of res.skipped) skipped.push({ name: s.text.slice(0, 60), reason: s.reason, line: s.line });
  return { tokens, skipped };
}

function listText(v: ScssValue): string {
  if (v.kind === "scalar") return v.raw;
  if (v.kind === "list") return `(${v.items.map(listText).join(", ")})`;
  return `(${v.entries.map((e) => `${e.key}: ${listText(e.value)}`).join(", ")})`;
}

/* ------------------------------ token metadata ------------------------------- */

const isHexColour = (v: unknown) => typeof v === "string" && /^#[0-9a-f]{3,8}$/i.test(v.trim());
const isRefValue = (v: unknown) => typeof v === "string" && /^\{[^{}]+\}$/.test(v.trim());
const isLength = (v: unknown) => typeof v === "number" || (typeof v === "string" && /^-?\d*\.?\d+(px|rem|em|pt|%)$/.test(v.trim()));

export function tokenType(setKey: TokenSetKey, name: string, rawValue: unknown): string | null {
  const last = name.split(".").pop() ?? name;
  if (setKey === "colour-palette" || setKey === "functional-colours" || setKey === "applied-colours" || setKey === "organisation-colours" || /colou?r$/.test(name)) {
    return isHexColour(rawValue) || isRefValue(rawValue) ? "color" : null;
  }
  if (/font-family/.test(name)) return typeof rawValue === "string" && !isRefValue(rawValue) ? "fontFamily" : null;
  if (/font-weight/.test(name)) return typeof rawValue === "number" ? "fontWeight" : null;
  if (last === "line-height") return isLength(rawValue) ? "lineHeight" : null;
  if (isLength(rawValue) && typeof rawValue !== "number") return "dimension";
  if (typeof rawValue === "number" && (setKey === "spacing" || last === "font-size")) return "dimension";
  return null;
}

export function tokenCategory(setKey: TokenSetKey, name: string): TokenCategory {
  if (setKey === "colour-palette" || setKey === "functional-colours" || setKey === "applied-colours" || setKey === "organisation-colours") return "color";
  if (setKey === "spacing") return "spacing";
  if (/colou?r/.test(name)) return "color";
  if (/border-width|focus-width|hover-width|border-radius|-border$|chevron-border|shadow-size/.test(name)) return "shape";
  if (/page-width|grid-widths|gutter|breakpoint/.test(name)) return "layout";
  if (setKey === "typography") return "typography";
  if (setKey === "layout") return "layout";
  return "other";
}

export function tokenTier(setKey: TokenSetKey, name: string): TokenTier | null {
  switch (setKey) {
    case "colour-palette":
    case "organisation-colours":
      return "primitive";
    case "functional-colours":
    case "applied-colours":
      return "semantic";
    case "spacing":
      return /^[a-z]+-spacing-points\./.test(name) ? "primitive" : "semantic";
    case "component-settings":
      return "component";
    default:
      return null;
  }
}

/* --------------------------- component stylesheets --------------------------- */

export interface ModifierRef {
  block: string;
  modifier: string;
  line: number;
}

export interface TokenUsageRef {
  tokenName: string;
  property: string | null;
  line: number;
}

export interface MixinAnalysis {
  /** Block-level BEM modifiers (`.govuk-button--secondary`), source order, unique. */
  modifiers: ModifierRef[];
  usages: TokenUsageRef[];
  mediaQueries: number;
}

/** Analyse a component stylesheet (`_mixin.scss` / `_index.scss`). */
export function analyseComponentScss(text: string, prefix: Prefix = "govuk"): MixinAnalysis {
  const lines = text.split("\n");
  const modifiers: ModifierRef[] = [];
  const usages: TokenUsageRef[] = [];
  const seenMod = new Set<string>();
  const seenUse = new Set<string>();
  let mediaQueries = 0;
  // Local (mixin-scoped) variables are not tokens.
  const localVars = new Set<string>();
  for (const l of lines) {
    const m = new RegExp(String.raw`^\s+\$(${prefix}-[\w-]+)\s*:`).exec(l);
    if (m) localVars.add(m[1]!);
  }
  lines.forEach((raw, i) => {
    const line = raw.replace(/\/\/.*$/, "");
    if (/(govuk|nhsuk)-media-query\(/.test(line)) mediaQueries++;
    for (const m of line.matchAll(new RegExp(String.raw`\.(${prefix}-[a-z0-9]+(?:-[a-z0-9]+)*)--([a-z0-9]+(?:-[a-z0-9]+)*)`, "g"))) {
      const block = m[1]!;
      if (block.includes("__")) continue;
      const k = `${block}--${m[2]}`;
      if (seenMod.has(k)) continue;
      seenMod.add(k);
      modifiers.push({ block, modifier: m[2]!, line: i + 1 });
    }
    const decl = /^\s*([a-z-]+)\s*:\s*(.+)$/.exec(line);
    const prop = decl && !line.trim().startsWith("$") ? decl[1]! : null;
    const { references } = rewriteScssValue(line, { localVars, prefix });
    for (const r of references) {
      const k = `${r}|${prop}`;
      if (seenUse.has(k)) continue;
      seenUse.add(k);
      usages.push({ tokenName: r, property: prop, line: i + 1 });
    }
  });
  return { modifiers, usages, mediaQueries };
}

/* ------------------------------ compiled CSS ------------------------------ */

/** Custom properties declared in compiled CSS (`--govuk-brand-colour:`), unique, sorted. */
export function declaredCustomProperties(css: string, prefix: Prefix = "govuk"): string[] {
  const out = new Set<string>();
  for (const m of css.matchAll(new RegExp(String.raw`(?:^|[;{\s])(--${prefix}-[a-z0-9-]+)\s*:`, "g"))) out.add(m[1]!);
  return [...out].sort();
}

export type { ScssVariable };
export type { NormalizedToken };
