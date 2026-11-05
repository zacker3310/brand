/**
 * Static CSS custom-property extraction (pure; never executes or fetches anything; never throws).
 *
 * parseCssCustomProperties(css) returns every `--name: value` declaration found in style rules,
 * including rules nested in @media / @supports / @layer / @container / @scope blocks and CSS nesting.
 * Handles comments, quoted strings, `{}` inside custom-property values, nested var() fallbacks and
 * `!important`. @keyframes, @font-face, @property, @page and other non-style at-rules are skipped.
 *
 * Theme inference (heuristic; see inferThemeFromSelector / inferThemeFromMedia):
 *  - :root / html / :host / body              -> theme null (default scope)
 *  - [data-theme="dark"], [data-color-mode=..], [data-*-theme=..], [data-bs-theme=..], [theme=..]
 *                                              -> literal attribute value, themeInferred=false
 *  - @media (prefers-color-scheme: dark|light) -> "dark"/"light", themeInferred=false
 *  - @media (prefers-contrast: more)           -> "high-contrast" (combined: "dark-high-contrast"), inferred
 *  - .dark / .theme-dark / .dark-theme / .cds--g100 style classes -> keyword or class-derived name, inferred
 *  - anything else (.Button, .card > .title)   -> theme null, scope "scoped" (component-level)
 * opts.theme overrides inference (caller-asserted, themeInferred=false).
 */
import { findCssVarReferences, splitTopLevel } from "./refs";
import type { ResolvableToken } from "./resolve";

export interface CssCustomProperty {
  /** Selector list as authored (whitespace collapsed). For nested rules, the resolved full selector. */
  selector: string;
  theme: string | null;
  themeInferred: boolean;
  /** root: default scope; theme: theme-scoped selector or media; scoped: component/other selector. */
  scope: "root" | "theme" | "scoped";
  /** Custom property name including "--". */
  name: string;
  /** Value as authored, comments removed, whitespace collapsed, "!important" stripped. */
  value: string;
  /** Every var() name referenced (including nested fallbacks). */
  references: string[];
  important: boolean;
  /** Enclosing @media conditions joined with " and " (null when none). */
  media: string | null;
  /** Enclosing @layer name(s) joined with "." (null when none). */
  layer: string | null;
  /** Other enclosing conditional at-rules (@supports / @container / @scope), joined with " ; ". */
  conditions: string | null;
  /** 1-based line of the declaration. */
  line: number;
  /** Comment on the same line after the declaration, or the comment immediately before it (<= 280 chars). */
  comment: string | null;
}

export interface ParseCssOptions {
  /** Force a theme for every declaration (caller-asserted). */
  theme?: string | null;
  /** Include declarations from component/other selectors (default true). */
  includeScoped?: boolean;
  /** Safety cap on returned declarations (default 50_000). */
  maxDeclarations?: number;
  /** Safety cap on input size in characters (default 5_000_000); larger input is truncated. */
  maxLength?: number;
}

interface Ctx {
  media: string[];
  layer: string[];
  conditions: string[];
  selector: string | null;
}

const SKIP_AT_RULES = new Set(["keyframes", "-webkit-keyframes", "-moz-keyframes", "font-face", "property", "page", "counter-style", "font-feature-values", "font-palette-values", "view-transition", "position-try", "viewport"]);
const CONDITIONAL_AT_RULES = new Set(["media", "supports", "layer", "container", "scope", "document", "-moz-document", "starting-style"]);

const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

/** Remove /* *\/ comments outside strings. */
function stripComments(s: string): string {
  let out = "";
  let quote: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (quote) {
      out += c;
      if (c === "\\" && i + 1 < s.length) out += s[++i];
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      out += c;
      continue;
    }
    if (c === "/" && s[i + 1] === "*") {
      const end = s.indexOf("*/", i + 2);
      i = end < 0 ? s.length : end + 1;
      out += " ";
      continue;
    }
    out += c;
  }
  return out;
}

function cleanComment(raw: string): string | null {
  const t = raw
    .replace(/^\/\*+/, "")
    .replace(/\*+\/$/, "")
    .split("\n")
    .map((l) => l.replace(/^\s*\*\s?/, "").trim())
    .filter(Boolean)
    .join(" ")
    .trim();
  if (!t) return null;
  return t.length > 280 ? `${t.slice(0, 279)}…` : t;
}

class Scanner {
  readonly src: string;
  private lineStarts: number[];
  constructor(src: string) {
    this.src = src;
    this.lineStarts = [0];
    for (let i = 0; i < src.length; i++) if (src.charCodeAt(i) === 10) this.lineStarts.push(i + 1);
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
  /** Skip a comment starting at i (must be "/*"); returns index after it. */
  skipComment(i: number): number {
    const end = this.src.indexOf("*/", i + 2);
    return end < 0 ? this.src.length : end + 2;
  }
  skipString(i: number): number {
    const q = this.src[i]!;
    for (let j = i + 1; j < this.src.length; j++) {
      const c = this.src[j]!;
      if (c === "\\") j++;
      else if (c === q) return j + 1;
      else if (c === "\n") return j; // unterminated string ends at newline (CSS error recovery)
    }
    return this.src.length;
  }
  /** Find the "}" matching the "{" at `open`; returns src.length if unbalanced. */
  matchBrace(open: number): number {
    let depth = 0;
    for (let i = open; i < this.src.length; i++) {
      const c = this.src[i]!;
      if (c === "/" && this.src[i + 1] === "*") {
        i = this.skipComment(i) - 1;
        continue;
      }
      if (c === '"' || c === "'") {
        i = this.skipString(i) - 1;
        continue;
      }
      if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) return i;
      }
    }
    return this.src.length;
  }
  /**
   * Read from i until one of the stop chars at depth 0 (parens/brackets/braces tracked unless the stop
   * set includes "{"). Returns the index of the stop char (or end).
   */
  readUntil(i: number, stops: string, end: number, trackBraces: boolean): number {
    let depth = 0;
    for (let j = i; j < end; j++) {
      const c = this.src[j]!;
      if (c === "/" && this.src[j + 1] === "*") {
        j = this.skipComment(j) - 1;
        continue;
      }
      if (c === '"' || c === "'") {
        j = this.skipString(j) - 1;
        continue;
      }
      if (depth === 0 && stops.includes(c)) return j;
      if (c === "(" || c === "[" || (trackBraces && c === "{")) depth++;
      else if (c === ")" || c === "]" || (trackBraces && c === "}")) {
        if (depth === 0 && c === "}") return j;
        depth = Math.max(0, depth - 1);
      }
    }
    return end;
  }
}

/** Combine a nested selector with its parent (CSS nesting: "&" or implicit descendant). */
function nestSelector(parent: string | null, child: string): string {
  if (!parent) return child;
  const parents = splitTopLevel(parent).map((s) => s.trim()).filter(Boolean);
  const kids = splitTopLevel(child).map((s) => s.trim()).filter(Boolean);
  const out: string[] = [];
  for (const k of kids) {
    for (const p of parents) out.push(k.includes("&") ? k.replace(/&/g, p) : `${p} ${k}`);
  }
  return out.join(", ");
}

function parseBlock(sc: Scanner, start: number, end: number, ctx: Ctx, out: CssCustomProperty[], opts: Required<Pick<ParseCssOptions, "maxDeclarations">> & ParseCssOptions, depth: number) {
  if (depth > 32) return;
  const s = sc.src;
  let i = start;
  let pendingComment: { text: string; end: number } | null = null;
  let lastDeclLine = -1;
  while (i < end && out.length < opts.maxDeclarations) {
    const c = s[i]!;
    if (c === " " || c === "\n" || c === "\t" || c === "\r" || c === "\f" || c === ";") {
      i++;
      continue;
    }
    if (c === "/" && s[i + 1] === "*") {
      const ce = sc.skipComment(i);
      // A comment on the same line as the previous declaration is that declaration's trailing comment.
      pendingComment = sc.line(i) === lastDeclLine ? null : { text: s.slice(i, ce), end: ce };
      i = ce;
      continue;
    }
    if (c === "}") {
      i++;
      continue;
    }
    if (c === "<" && s.startsWith("<!--", i)) {
      i += 4;
      continue;
    }
    if (c === "-" && s.startsWith("-->", i)) {
      i += 3;
      continue;
    }
    if (c === "@") {
      const m = /^@([\w-]+)/.exec(s.slice(i, i + 64));
      const name = (m?.[1] ?? "").toLowerCase();
      const stop = sc.readUntil(i, ";{", end, false);
      if (stop >= end || s[stop] === ";") {
        i = stop + 1;
        pendingComment = null;
        continue;
      }
      const close = Math.min(sc.matchBrace(stop), end);
      const prelude = collapse(stripComments(s.slice(i + 1 + name.length, stop)));
      if (CONDITIONAL_AT_RULES.has(name)) {
        const next: Ctx = { ...ctx, media: [...ctx.media], layer: [...ctx.layer], conditions: [...ctx.conditions] };
        if (name === "media") next.media.push(prelude);
        else if (name === "layer") next.layer.push(prelude || "(anonymous)");
        else next.conditions.push(`@${name}${prelude ? ` ${prelude}` : ""}`);
        parseBlock(sc, stop + 1, close, next, out, opts, depth + 1);
      } else if (!SKIP_AT_RULES.has(name)) {
        // Unknown block at-rule: be conservative and look inside only for style rules.
        parseBlock(sc, stop + 1, close, { ...ctx, conditions: [...ctx.conditions, `@${name}${prelude ? ` ${prelude}` : ""}`] }, out, opts, depth + 1);
      }
      i = close + 1;
      pendingComment = null;
      continue;
    }
    // Custom property declaration (only meaningful inside a style rule).
    if (c === "-" && s[i + 1] === "-" && ctx.selector !== null) {
      const colon = sc.readUntil(i, ":;{}", end, false);
      if (s[colon] === ":") {
        const name = s.slice(i, colon).trim();
        if (/^--[^\s:;{}]+$/.test(name)) {
          const vEnd = sc.readUntil(colon + 1, ";}", end, true);
          emit(sc, out, ctx, name, s.slice(colon + 1, vEnd), i, vEnd, pendingComment, opts);
          pendingComment = null;
          lastDeclLine = sc.line(Math.min(vEnd, s.length - 1));
          i = vEnd < end && s[vEnd] === ";" ? vEnd + 1 : vEnd;
          continue;
        }
      }
    }
    // Either a regular declaration (inside a rule) or a (nested) style rule.
    const stop = sc.readUntil(i, ";{}", end, false);
    if (stop >= end) break;
    if (s[stop] === "{") {
      const close = Math.min(sc.matchBrace(stop), end);
      const selector = collapse(stripComments(s.slice(i, stop)));
      if (selector) {
        const full = nestSelector(ctx.selector, selector);
        parseBlock(sc, stop + 1, close, { ...ctx, selector: full }, out, opts, depth + 1);
      }
      i = close + 1;
    } else {
      i = stop + 1;
    }
    pendingComment = null;
  }
}

function emit(
  sc: Scanner,
  out: CssCustomProperty[],
  ctx: Ctx,
  name: string,
  rawValue: string,
  declStart: number,
  vEnd: number,
  pendingComment: { text: string; end: number } | null,
  opts: ParseCssOptions,
) {
  let value = collapse(stripComments(rawValue));
  let important = false;
  const imp = /\s*!\s*important\s*$/i.exec(value);
  if (imp) {
    important = true;
    value = value.slice(0, imp.index).trim();
  }
  const selector = ctx.selector ?? "";
  const media = ctx.media.length ? ctx.media.join(" and ") : null;
  let theme: string | null = null;
  let themeInferred = false;
  let scope: CssCustomProperty["scope"];
  const fromSel = inferThemeFromSelector(selector);
  const fromMedia = media ? inferThemeFromMedia(media) : null;
  if (fromSel.theme) {
    theme = fromSel.theme;
    themeInferred = fromSel.inferred;
  } else if (fromMedia && fromSel.kind !== "scoped") {
    theme = fromMedia.theme;
    themeInferred = fromMedia.inferred;
  }
  scope = fromSel.kind === "scoped" ? "scoped" : theme ? "theme" : "root";
  if (opts.theme !== undefined) {
    theme = opts.theme;
    themeInferred = false;
    if (scope !== "scoped") scope = theme ? "theme" : "root";
  }
  if (scope === "scoped" && opts.includeScoped === false) return;

  // Same-line trailing comment wins over a preceding comment.
  let comment: string | null = null;
  const s = sc.src;
  let j = vEnd < s.length && s[vEnd] === ";" ? vEnd + 1 : vEnd;
  while (j < s.length && (s[j] === " " || s[j] === "\t")) j++;
  if (s[j] === "/" && s[j + 1] === "*") {
    const ce = sc.skipComment(j);
    if (sc.line(j) === sc.line(declStart)) comment = cleanComment(s.slice(j, ce));
  }
  if (!comment && pendingComment) {
    const between = s.slice(pendingComment.end, declStart);
    if (/^\s*$/.test(between) && (between.match(/\n/g)?.length ?? 0) <= 1) comment = cleanComment(pendingComment.text);
  }
  // Also handle comments inside the value (e.g. "#fff /* note */"): already stripped from value.
  out.push({
    selector,
    theme,
    themeInferred,
    scope,
    name,
    value,
    references: findCssVarReferences(value),
    important,
    media,
    layer: ctx.layer.length ? ctx.layer.join(".") : null,
    conditions: ctx.conditions.length ? ctx.conditions.join(" ; ") : null,
    line: sc.line(declStart),
    comment,
  });
}

/** Parse CSS text and return custom-property declarations in source order. */
export function parseCssCustomProperties(css: string, opts: ParseCssOptions = {}): CssCustomProperty[] {
  const out: CssCustomProperty[] = [];
  if (typeof css !== "string" || !css) return out;
  try {
    const maxLength = opts.maxLength ?? 5_000_000;
    const src = css.length > maxLength ? css.slice(0, maxLength) : css;
    const sc = new Scanner(src.charCodeAt(0) === 0xfeff ? ` ${src.slice(1)}` : src);
    parseBlock(sc, 0, sc.src.length, { media: [], layer: [], conditions: [], selector: null }, out, { ...opts, maxDeclarations: opts.maxDeclarations ?? 50_000 }, 0);
  } catch {
    /* return what we have */
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Theme inference                                                             */
/* -------------------------------------------------------------------------- */

export interface SelectorThemeInfo {
  theme: string | null;
  inferred: boolean;
  kind: "root" | "theme" | "scoped";
}

const ROOT_SELECTOR = /^(?::root|html|:host|body|\*|:where\(:root\)|:is\(:root\)|:scope)$/i;
const THEME_ATTR_RE = /\[\s*((?:data-)?[\w-]*?(?:theme|mode|scheme|appearance))\s*([~|^$*]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]+))\s*(?:[is]\s*)?\]/gi;
const THEME_KEYWORDS = ["light", "dark", "dim", "dimmed", "high-contrast", "hc", "contrast", "night", "day", "colorblind", "tritanopia", "protanopia", "deuteranopia"];
const CLASS_RE = /\.(-?[_a-zA-Z][\w-]*)/g;

function normalizeKeywordTheme(cls: string): string | null {
  const n = cls.toLowerCase().replace(/_/g, "-");
  const found: string[] = [];
  // Order-preserving keyword detection within the class name.
  const parts = n.split(/-+/);
  for (let k = 0; k < parts.length; k++) {
    const p = parts[k]!;
    if (p === "high" && parts[k + 1] === "contrast") {
      found.push("high-contrast");
      k++;
    } else if (p === "hc") found.push("high-contrast");
    else if (THEME_KEYWORDS.includes(p) && p !== "contrast") found.push(p === "dimmed" ? "dim" : p);
  }
  return found.length ? [...new Set(found)].join("-") : null;
}

/** Theme from a single class name; null when the class does not look like a theme scope. */
export function themeFromClassName(cls: string): string | null {
  const kw = normalizeKeywordTheme(cls);
  const lower = cls.toLowerCase();
  const themed = /(^|[-_])(theme|themes|mode|scheme)([-_]|$)/.test(lower);
  if (kw && (themed || /^(is-|t-|theme-)?[a-z-]+$/.test(lower))) return kw;
  if (themed) {
    const rest = lower.replace(/(^|[-_]+)(theme|themes|mode|scheme)([-_]+|$)/g, "-").replace(/^-+|-+$/g, "");
    return rest || null;
  }
  // Carbon-style theme zone classes: .cds--white, .cds--g10, .cds--g90, .cds--g100, .bx--g100
  const carbon = /^(?:[a-z]+--)?(white|g\d{2,3})$/.exec(lower);
  if (carbon) return carbon[1]!;
  return null;
}

/** Remove negations (":not(...)") so their contents do not count as theme signals. */
function stripNegations(sel: string): string {
  let out = sel;
  for (let guard = 0; guard < 32; guard++) {
    const at = out.toLowerCase().indexOf(":not(");
    if (at < 0) break;
    let depth = 0;
    let close = -1;
    for (let j = at + 4; j < out.length; j++) {
      if (out[j] === "(") depth++;
      else if (out[j] === ")") {
        depth--;
        if (depth === 0) {
          close = j;
          break;
        }
      }
    }
    out = close < 0 ? out.slice(0, at) : out.slice(0, at) + out.slice(close + 1);
  }
  return out;
}

function themeOfCompound(sel: string): SelectorThemeInfo {
  const s = stripNegations(sel).trim();
  if (!s) return { theme: null, inferred: false, kind: "root" };
  if (ROOT_SELECTOR.test(s)) return { theme: null, inferred: false, kind: "root" };
  // Attribute-based themes (literal values).
  const attrs: { name: string; value: string }[] = [];
  for (const m of s.matchAll(THEME_ATTR_RE)) {
    const value = (m[3] ?? m[4] ?? m[5] ?? "").trim();
    if (value) attrs.push({ name: m[1]!.toLowerCase(), value });
  }
  if (attrs.length) {
    const specific = attrs.find((a) => /-theme$/.test(a.name) && a.name !== "data-theme" && a.value.toLowerCase() !== "auto");
    const generic = attrs.find((a) => a.value.toLowerCase() !== "auto");
    const pick = specific ?? generic;
    if (pick) return { theme: pick.value, inferred: false, kind: "theme" };
  }
  // Root-ish compound with a theme class: ":root.dark", "html.theme-dark", ".dark", "body.dark-mode".
  const head = s.replace(/^(?::root|html|body|:host)/i, "");
  const classes = [...head.matchAll(CLASS_RE)].map((m) => m[1]!);
  const isSimple = /^(?::root|html|body|:host)?(?:\.[\w-]+)+(?:\s*,\s*)?$/i.test(s) || /^(?::root|html|body|:host)?(?:\.[\w-]+)+\s+(?::root|html|body)?$/i.test(s);
  for (const cls of classes) {
    const t = themeFromClassName(cls);
    if (t) return { theme: t, inferred: true, kind: "theme" };
  }
  // :host([theme=dark]) handled by attr; :host(.dark)
  const host = /^:host\(\s*\.([\w-]+)\s*\)$/i.exec(s);
  if (host) {
    const t = themeFromClassName(host[1]!);
    if (t) return { theme: t, inferred: true, kind: "theme" };
  }
  void isSimple;
  return { theme: null, inferred: false, kind: "scoped" };
}

/** Infer theme from a (possibly comma-separated) selector list. */
export function inferThemeFromSelector(selector: string): SelectorThemeInfo {
  if (typeof selector !== "string" || !selector.trim()) return { theme: null, inferred: false, kind: "root" };
  const parts = splitTopLevel(selector)
    .map((p) => p.trim())
    .filter(Boolean);
  const infos = parts.map(themeOfCompound);
  const themed = infos.filter((x) => x.theme);
  if (themed.length) {
    const unique = [...new Set(themed.map((x) => x.theme))];
    const first = themed[0]!;
    return { theme: first.theme, inferred: unique.length > 1 ? true : first.inferred, kind: "theme" };
  }
  if (infos.some((x) => x.kind === "root")) return { theme: null, inferred: false, kind: "root" };
  return { theme: null, inferred: false, kind: "scoped" };
}

/** Infer theme from an @media prelude; null when it carries no theme signal. */
export function inferThemeFromMedia(media: string): { theme: string; inferred: boolean } | null {
  if (typeof media !== "string") return null;
  const m = media.toLowerCase();
  if (/\bnot\s+all\s+and\s+\(\s*prefers-color-scheme/.test(m)) return null;
  const scheme = /prefers-color-scheme\s*:\s*(dark|light)/.exec(m)?.[1] ?? null;
  const contrast = /prefers-contrast\s*:\s*(more|high)/.test(m);
  const forced = /forced-colors\s*:\s*active/.test(m);
  if (scheme && !contrast) return { theme: scheme, inferred: false };
  if (contrast) return { theme: scheme ? `${scheme}-high-contrast` : "high-contrast", inferred: true };
  if (forced) return { theme: "forced-colors", inferred: true };
  return null;
}

/* -------------------------------------------------------------------------- */
/* Helpers for adapters                                                        */
/* -------------------------------------------------------------------------- */

/** Distinct themes present (null = default scope), in first-seen order. */
export function listCssThemes(decls: readonly CssCustomProperty[]): (string | null)[] {
  const out: (string | null)[] = [];
  for (const d of decls) if (d.scope !== "scoped" && !out.includes(d.theme)) out.push(d.theme);
  return out;
}

export interface CssThemeTokenOptions {
  /** Include default-scope (:root, theme null) declarations as the base for a themed set (default true). */
  includeDefault?: boolean;
  /** Include component-scoped declarations (default false). */
  includeScoped?: boolean;
}

/**
 * Build a resolvable token list for one theme: default-scope declarations overridden by the theme's
 * declarations (later declarations win, as in the cascade). theme=null returns the default scope only.
 * Output entries are ready for resolveTokenGraph(): name = cssVar = "--x".
 */
export function cssThemeTokens(
  decls: readonly CssCustomProperty[],
  theme: string | null,
  opts: CssThemeTokenOptions = {},
): (ResolvableToken & { cssVar: string; declaration: CssCustomProperty; inherited: boolean })[] {
  const byName = new Map<string, { d: CssCustomProperty; inherited: boolean }>();
  const includeDefault = opts.includeDefault !== false;
  // Pass 1: default scope (theme null). Later declarations win unless an earlier one is !important.
  if (theme === null || includeDefault) {
    for (const d of decls) {
      if (d.theme !== null || (d.scope === "scoped" && !opts.includeScoped)) continue;
      const prev = byName.get(d.name);
      if (prev && prev.d.important && !d.important) continue;
      byName.set(d.name, { d, inherited: theme !== null });
    }
  }
  if (theme !== null) {
    for (const d of decls) {
      if (d.theme !== theme) continue;
      if (d.scope === "scoped" && !opts.includeScoped) continue;
      const prev = byName.get(d.name);
      if (prev && !prev.inherited && prev.d.important && !d.important) continue;
      byName.set(d.name, { d, inherited: false });
    }
  }
  return [...byName.values()].map(({ d, inherited }) => ({
    name: d.name,
    cssVar: d.name,
    rawValue: d.value,
    references: d.references,
    declaration: d,
    inherited,
  }));
}
