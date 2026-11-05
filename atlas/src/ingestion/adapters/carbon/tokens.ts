/**
 * Carbon token parsers (static):
 *  - DTCG 2025.10 JSON from @carbon/colors, @carbon/themes, @carbon/layout, @carbon/motion.
 *    Values are kept as authored. Brace references ("{blue.60}") and JSON-pointer references
 *    ({ "$ref": "#/gray/50/$value/components" }) are both recorded in `references`.
 *  - @carbon/type SCSS maps (scss/_styles.scss, scss/_font-family.scss) as authored, with
 *    Sass lookups recorded as references (font-weight('regular') -> font-weight.regular).
 *  - @carbon/type published `scale` array (es/index.js literal) as type-scale steps.
 *  - @carbon/styles compiled CSS: inventory of declared --cds-* custom properties, used only to
 *    verify cssVar names (a cssVar is set only when the compiled CSS declares it).
 */
import type { NormalizedToken, TokenCategory, TokenTier } from "@/lib/contracts";
import { flattenTokenTree, toNormalizedToken } from "@/lib/tokens/tree";
import { matchBracket, splitTopLevel } from "./proptypes";

export interface TokenFileResult {
  tokens: NormalizedToken[];
  /** Root-level $description of the file. */
  description: string | null;
  /** $extensions["com.ibm.carbon"]["color-scheme"] for theme files. */
  colorScheme: string | null;
}

/** "#/gray/50/$value/components" -> "gray.50" */
export function pointerRefName(ptr: string): string | null {
  if (!ptr.startsWith("#/")) return null;
  const segs = ptr
    .slice(2)
    .split("/")
    .map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"));
  const vi = segs.indexOf("$value");
  const path = vi >= 0 ? segs.slice(0, vi) : segs;
  return path.length ? path.join(".") : null;
}

function pointerRefs(value: unknown): string[] {
  const out = new Set<string>();
  const visit = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(visit);
    else if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      if (typeof o.$ref === "string") {
        const n = pointerRefName(o.$ref);
        if (n) out.add(n);
      }
      Object.values(o).forEach(visit);
    }
  };
  visit(value);
  return [...out];
}

export interface DtcgOptions {
  /** Evidence location prefix (package-relative file path). */
  file: string;
  /** "path" => name = path joined by "."; "leaf" => name = last segment (Carbon leaf names are globally unique). */
  nameMode?: "path" | "leaf";
  cssVar?: (name: string, path: string[]) => string | null;
  category?: (path: string[], type: string | null) => TokenCategory | null;
  tier?: { tier: TokenTier; state: "verified" | "inferred" } | null;
}

export function parseDtcgFile(jsonText: string, opts: DtcgOptions): TokenFileResult {
  const tree = JSON.parse(jsonText) as Record<string, unknown>;
  const flat = flattenTokenTree(tree, { format: "dtcg", location: opts.file });
  const tokens: NormalizedToken[] = [];
  for (const f of flat) {
    const name = opts.nameMode === "leaf" ? f.path[f.path.length - 1]! : f.path.join(".");
    const references = [...new Set([...f.references, ...pointerRefs(f.rawValue)])];
    const base = toNormalizedToken({ ...f, name, references, cssVar: opts.cssVar ? opts.cssVar(name, f.path) : null });
    const cat = opts.category?.(f.path, f.type);
    tokens.push({
      ...base,
      category: cat ?? base.category,
      tier: opts.tier ? opts.tier.tier : base.tier,
      tierState: opts.tier ? opts.tier.state : "inferred",
    });
  }
  const ext = (tree.$extensions as Record<string, Record<string, unknown>> | undefined)?.["com.ibm.carbon"];
  return {
    tokens,
    description: typeof tree.$description === "string" ? tree.$description : null,
    colorScheme: typeof ext?.["color-scheme"] === "string" ? (ext["color-scheme"] as string) : null,
  };
}

/* --------------------------------- SCSS ----------------------------------- */

interface ScssVar {
  name: string;
  value: string;
  doc: string;
  line: number;
}

/** Top-level `$name: value !default;` declarations with their preceding `///` doc lines. */
export function scssVariables(src: string): ScssVar[] {
  const out: ScssVar[] = [];
  const re = /^\$([a-z][a-z0-9-]*)\s*:\s*/gm;
  for (const m of src.matchAll(re)) {
    const start = (m.index ?? 0) + m[0].length;
    let end: number;
    if (src[start] === "(") {
      const close = matchBracket(src, start);
      if (close < 0) continue;
      end = src.indexOf(";", close);
    } else end = src.indexOf(";", start);
    if (end < 0) continue;
    const value = src
      .slice(start, end)
      .replace(/!default\s*$/, "")
      .trim();
    // Collect contiguous `///` lines directly above.
    const before = src.slice(0, m.index).split("\n");
    before.pop();
    const doc: string[] = [];
    for (let i = before.length - 1; i >= 0 && /^\s*\/\/\//.test(before[i]!); i--) doc.unshift(before[i]!.replace(/^\s*\/\/\/\s?/, ""));
    out.push({ name: m[1]!, value, doc: doc.join("\n"), line: src.slice(0, m.index).split("\n").length });
  }
  return out;
}

export type ScssValue = string | { [k: string]: ScssValue };

export function parseScssMap(text: string): ScssValue {
  const t = text.trim();
  if (!t.startsWith("(") || matchBracket(t, 0) !== t.length - 1) return t.replace(/\s+/g, " ");
  const out: Record<string, ScssValue> = {};
  for (const { text: entry } of splitTopLevel(t.slice(1, -1))) {
    const i = entry.indexOf(":");
    if (i < 0) continue;
    const key = entry
      .slice(0, i)
      .trim()
      .replace(/^['"](.*)['"]$/, "$1");
    out[key] = parseScssMap(entry.slice(i + 1));
  }
  return out;
}

/** References implied by Sass lookups inside a raw SCSS value. */
export function scssReferences(v: ScssValue): string[] {
  const out = new Set<string>();
  const visit = (x: ScssValue) => {
    if (typeof x === "string") {
      for (const m of x.matchAll(/font-weight\(\s*['"]([a-z-]+)['"]\s*\)/g)) out.add(`font-weight.${m[1]}`);
      for (const m of x.matchAll(/font-family\(\s*['"]([a-z-]+)['"]\s*\)/g)) out.add(`font-family.${m[1]}`);
      for (const m of x.matchAll(/type-scale\(\s*(\d+)\s*\)/g)) out.add(`type-scale.${m[1]}`);
      const alias = x.match(/^\$([a-z][a-z0-9-]*)$/);
      if (alias) out.add(alias[1]!);
    } else Object.values(x).forEach(visit);
  };
  visit(v);
  return [...out];
}

const TYPE_STYLE_SKIP = new Set(["tokens", "font-families", "font-weights", "type-scale"]);

/** @carbon/type scss/_styles.scss type styles (maps with font-size etc., or aliases to other styles). */
export function parseTypeStyles(src: string, file: string): NormalizedToken[] {
  const vars = scssVariables(src);
  const names = new Set(vars.map((v) => v.name));
  const out: NormalizedToken[] = [];
  for (const v of vars) {
    if (TYPE_STYLE_SKIP.has(v.name)) continue;
    const raw = parseScssMap(v.value);
    const isAlias = typeof raw === "string" && /^\$[a-z][a-z0-9-]*$/.test(raw) && names.has(raw.slice(1));
    const isStyle = typeof raw === "object" && ("font-size" in raw || "line-height" in raw);
    if (!isAlias && !isStyle) continue;
    out.push({
      name: v.name,
      path: [v.name],
      cssVar: null,
      type: "typography",
      category: "typography",
      tier: null,
      tierState: "inferred",
      rawValue: raw,
      references: scssReferences(raw),
      description: null,
      deprecated: /@deprecated\b/.test(v.doc),
      location: `${file}#$${v.name} (line ${v.line})`,
    });
  }
  return out;
}

/** @carbon/type scss/_font-family.scss: $font-families and $font-weights maps. */
export function parseFontFamilies(src: string, file: string): NormalizedToken[] {
  const out: NormalizedToken[] = [];
  for (const v of scssVariables(src)) {
    if (v.name !== "font-families" && v.name !== "font-weights") continue;
    const map = parseScssMap(v.value);
    if (typeof map !== "object") continue;
    const group = v.name === "font-families" ? "font-family" : "font-weight";
    for (const [k, val] of Object.entries(map)) {
      if (typeof val !== "string") continue;
      const unq = val.match(/^string\.unquote\(\s*"([\s\S]*)"\s*\)$/);
      const raw: string | number = unq ? unq[1]! : /^\d+$/.test(val) ? Number(val) : val;
      out.push({
        name: `${group}.${k}`,
        path: [group, k],
        cssVar: null,
        type: group === "font-family" ? "fontFamily" : "fontWeight",
        category: "typography",
        tier: "primitive",
        tierState: "inferred",
        rawValue: raw,
        references: [],
        description: null,
        deprecated: false,
        location: `${file}#$${v.name}.${k}`,
      });
    }
  }
  return out;
}

/** The published `const scale = [12, 14, ...]` literal in @carbon/type es/index.js. */
export function parseTypeScale(src: string, file: string): NormalizedToken[] {
  const m = src.match(/const scale = \[([\d\s,.]+)\];/);
  if (!m) return [];
  const nums = m[1]!
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .map(Number)
    .filter((n) => Number.isFinite(n));
  return nums.map((n, i) => ({
    name: `type-scale.${i + 1}`,
    path: ["type-scale", String(i + 1)],
    cssVar: null,
    type: "number",
    category: "typography" as const,
    tier: "primitive" as const,
    tierState: "inferred" as const,
    rawValue: n,
    references: [],
    description: `Step ${i + 1} of the @carbon/type default type scale (pixel value as published in the scale array).`,
    deprecated: false,
    location: `${file}#scale[${i}]`,
  }));
}

/* ---------------------------------- CSS ----------------------------------- */

/** All `--cds-*` custom property names declared (not merely referenced) in compiled CSS. */
export function declaredCssVars(css: string): string[] {
  const out = new Set<string>();
  for (const m of css.matchAll(/(--cds-[a-z0-9-]+)\s*:/g)) out.add(m[1]!);
  return [...out].sort();
}

/** Layout token categories by DTCG group in @carbon/layout (ATLAS mapping). */
export function layoutCategory(path: string[]): TokenCategory | null {
  const g = path[0] ?? "";
  if (g === "spacing" || g === "fluid-spacing" || g === "layout") return "spacing";
  if (g === "border-radius") return "shape";
  if (g === "container" || g === "size" || g === "icon-size") return "layout";
  return null;
}
