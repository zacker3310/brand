/**
 * @atlaskit/tokens codegen artifacts (dist/es2019/artifacts):
 *  - tokens-raw/<theme>.js and palettes-raw/<palette>.js: `const tokens = [ ... ]; export default tokens;`
 *    where the array literal is strict JSON (Style Dictionary output: name, path, cleanName, value,
 *    original.value, attributes{group, state, description, ...}, filePath).
 *  - token-names.js: `const tokens = { 'color.text': '--ds-text', ... }` (token -> CSS custom property).
 *
 * Parsed statically (the literal is extracted and JSON.parse'd); the modules are never executed.
 *
 * Raw values: theme/foundation tokens keep their authored `original.value`; palette keys used there
 * ("Lime100", "Space100", "FontWeight653") are expressed as DTCG references "{color.palette.Lime100}"
 * wherever Atlassian's own build substitutes them (the built `value` differs from the key). Keys the
 * build keeps verbatim (CSS @keyframes names in motion tokens) stay literal. Palette (base) tokens use
 * the published, unit-bearing `value` ("8px", "#1868DB") because their authored numbers are unitless.
 */
import type { NormalizedToken, TokenCategory, TokenTier } from "@/lib/contracts";
import type { TokenSetSpec } from "./constants";

export interface RawAtlToken {
  name: string;
  cleanName: string | null;
  path: string[];
  value: unknown;
  original: unknown;
  group: string | null;
  category: string | null;
  state: string | null;
  description: string | null;
  replacement: string | null;
  filePath: string | null;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

export class TokenArtifactError extends Error {}

/** Extract the `const tokens = <literal>;` initializer text (array or object literal). */
export function extractTokensLiteral(body: string): string {
  const start = /\bconst\s+tokens\s*=\s*/.exec(body);
  if (!start) throw new TokenArtifactError("no `const tokens =` declaration");
  const from = start.index + start[0].length;
  const end = body.search(/;\s*export\s+default\s+tokens\s*;?\s*$/);
  if (end < from) throw new TokenArtifactError("no `export default tokens` after the literal");
  return body.slice(from, end).trim();
}

/** Parse a tokens-raw / palettes-raw artifact into raw token records. */
export function parseTokensRaw(body: string): RawAtlToken[] {
  const literal = extractTokensLiteral(body);
  let data: unknown;
  try {
    data = JSON.parse(literal);
  } catch (e) {
    throw new TokenArtifactError(`tokens literal is not strict JSON: ${(e as Error).message}`);
  }
  if (!Array.isArray(data)) throw new TokenArtifactError("tokens literal is not an array");
  const out: RawAtlToken[] = [];
  for (const t of data) {
    if (!isObj(t)) continue;
    const name = str(t.name);
    const path = Array.isArray(t.path) ? t.path.filter((p): p is string => typeof p === "string") : [];
    if (!name || !path.length) continue;
    const attrs = isObj(t.attributes) ? t.attributes : {};
    const original = isObj(t.original) ? t.original.value : undefined;
    out.push({
      name,
      cleanName: str(t.cleanName),
      path,
      value: t.value,
      original: original === undefined ? t.value : original,
      group: str(attrs.group),
      category: str(attrs.category),
      state: str(attrs.state),
      description: str(attrs.description),
      replacement: typeof attrs.replacement === "string" ? attrs.replacement : Array.isArray(attrs.replacement) ? attrs.replacement.filter((x) => typeof x === "string").join(", ") || null : null,
      filePath: str(t.filePath),
    });
  }
  return out;
}

/** Parse token-names.js (single-quoted object literal of token name -> CSS custom property). */
export function parseTokenNames(body: string): Record<string, string> {
  const literal = extractTokensLiteral(body);
  const out: Record<string, string> = {};
  for (const m of literal.matchAll(/'([^'\\]+)'\s*:\s*'(--[A-Za-z0-9_-]+)'/g)) out[m[1]!] = m[2]!;
  return out;
}

/* ------------------------------------------------------------------------------------------ */
/* Normalization                                                                               */
/* ------------------------------------------------------------------------------------------ */

/** Palette key ("Lime100") -> palette token name ("color.palette.Lime100"). */
export type PaletteIndex = Map<string, string>;

export function buildPaletteIndex(palettes: RawAtlToken[][]): { index: PaletteIndex; collisions: string[] } {
  const index: PaletteIndex = new Map();
  const collisions: string[] = [];
  for (const list of palettes) {
    for (const t of list) {
      const key = t.path[t.path.length - 1]!;
      const prev = index.get(key);
      if (prev && prev !== t.name) collisions.push(`${key}: ${prev} / ${t.name}`);
      else index.set(key, t.name);
    }
  }
  return { index, collisions };
}

/** Express palette keys inside an authored value as "{target}" references (see module doc). */
export function toRawValue(original: unknown, built: unknown, index: PaletteIndex): { rawValue: unknown; references: string[] } {
  const refs = new Set<string>();
  const walk = (o: unknown, b: unknown): unknown => {
    if (typeof o === "string") {
      const target = index.get(o);
      if (!target) return o;
      if (typeof b === "string" && b === o) return o; // build keeps the key verbatim (e.g. @keyframes name)
      refs.add(target);
      return `{${target}}`;
    }
    if (Array.isArray(o)) return o.map((x, i) => walk(x, Array.isArray(b) && b.length === o.length ? b[i] : undefined));
    if (isObj(o)) {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(o)) out[k] = walk(v, isObj(b) ? b[k] : undefined);
      return out;
    }
    return o;
  };
  const rawValue = walk(original, built);
  return { rawValue, references: [...refs] };
}

const GROUP_TYPE: Record<string, string | null> = {
  paint: "color",
  opacity: "opacity",
  spacing: "dimension",
  typography: "typography",
  fontWeight: "fontWeight",
  fontFamily: "fontFamily",
  fontSize: "dimension",
  lineHeight: "lineHeight",
  letterSpacing: "dimension",
  motionDuration: "duration",
  motionEasing: "cubicBezier",
};

const GROUP_CATEGORY: Record<string, TokenCategory> = {
  paint: "color",
  raw: "color",
  shadow: "elevation",
  opacity: "opacity",
  spacing: "spacing",
  shape: "shape",
  typography: "typography",
  fontWeight: "typography",
  fontFamily: "typography",
  fontSize: "typography",
  lineHeight: "typography",
  letterSpacing: "typography",
  motion: "motion",
  motionDuration: "motion",
  motionEasing: "motion",
  motionFillMode: "motion",
  motionKeyframe: "motion",
  motionProperty: "motion",
};

const isPercent = (v: unknown) => typeof v === "string" && /%$/.test(v.trim());
const isColorString = (v: unknown) => typeof v === "string" && /^(#[0-9a-f]{3,8}|rgba?\(|hsla?\(|transparent$)/i.test(v.trim());

/** ATLAS type/category for an Atlassian token (types are adapter-assigned: the source declares no $type). */
export function classifyAtlToken(t: RawAtlToken, value: unknown): { type: string | null; category: TokenCategory } {
  const g = t.group ?? "";
  if (g === "palette") {
    if (t.category === "opacity" || /^opacity\./i.test(t.name)) return { type: "opacity", category: "opacity" };
    return { type: isColorString(value) ? "color" : null, category: "color" };
  }
  if (g === "shape") return { type: isPercent(value) ? null : "dimension", category: "shape" };
  const category = GROUP_CATEGORY[g] ?? (t.name.startsWith("color.") ? "color" : "other");
  let type = GROUP_TYPE[g] ?? null;
  if (type === "dimension" && isPercent(value)) type = null;
  return { type, category };
}

function tierFor(spec: TokenSetSpec, t: RawAtlToken): TokenTier {
  if (spec.kind === "palette") return "primitive";
  if (t.group === "motion") return "component"; // motion.<component>.<interaction> animation tokens
  return "semantic";
}

export interface BuildTokensResult {
  tokens: NormalizedToken[];
  warnings: string[];
}

export function buildTokens(raw: RawAtlToken[], spec: TokenSetSpec, index: PaletteIndex, cssVars: Record<string, string>): BuildTokensResult {
  const warnings: string[] = [];
  const seen = new Set<string>();
  const tokens: NormalizedToken[] = [];
  raw.forEach((t, i) => {
    const name = t.cleanName ?? t.name;
    if (seen.has(name)) {
      warnings.push(`${spec.slug}: duplicate token ${name}; kept first`);
      return;
    }
    seen.add(name);
    let rawValue: unknown;
    let references: string[] = [];
    if (spec.kind === "palette") rawValue = t.value;
    else ({ rawValue, references } = toRawValue(t.original, t.value, index));
    if (rawValue === undefined || rawValue === null || rawValue === "") {
      warnings.push(`${spec.slug}: token ${name} has no value; skipped`);
      return;
    }
    const { type, category } = classifyAtlToken(t, spec.kind === "palette" ? t.value : t.value);
    const deprecated = t.state === "deprecated" || t.state === "deleted";
    let description = t.description;
    if (t.state === "experimental") description = description ? `${description} (state: experimental)` : "State: experimental.";
    if (deprecated && t.replacement) description = `${description ? `${description} ` : ""}Replacement: ${t.replacement}.`;
    tokens.push({
      name,
      path: t.path,
      cssVar: cssVars[name] ?? null,
      type,
      category,
      tier: tierFor(spec, t),
      tierState: "inferred",
      rawValue,
      references,
      description: description ? description.slice(0, 600) : null,
      deprecated,
      location: `${spec.file}#/${i}${t.filePath ? ` (${t.filePath})` : ""}`,
    });
  });
  tokens.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { tokens, warnings };
}
