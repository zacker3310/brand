/**
 * @primer/primitives token parsers.
 *
 *  - dist/docs/**.json (built "docs" output): one entry per token with `path`, CSS `name`,
 *    `filePath` (DTCG source file) and `original` = the authored token for that build/theme
 *    (`$value` with "{a.b}" references preserved, `$type`, `$description`, `$deprecated`, `alpha`).
 *  - src/tokens/base/color/**.json5 (DTCG sources for the base color scales, which are not part of
 *    the docs output).
 *
 * Aliases are never resolved here (the engine does that). Primer's non-standard `alpha` sibling
 * property is preserved by wrapping the raw value as `{ value, alpha }`.
 */
import type { NormalizedToken, TokenCategory, TokenTier } from "@/lib/contracts";
import { extractReferences, flattenTokenTree, inferTokenCategory } from "@/lib/tokens/tree";
import { parseJson5 } from "./json5";

const esc = (s: string) => s.replace(/~/g, "~0").replace(/\//g, "~1");
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Tier as declared by Primer's source layout (src/tokens/{base,functional,component}). */
export function tierFromFile(filePath: string): TokenTier | null {
  if (/(^|\/)src\/tokens\/base\//.test(filePath)) return "primitive";
  if (/(^|\/)src\/tokens\/functional\//.test(filePath)) return "semantic";
  if (/(^|\/)src\/tokens\/component\//.test(filePath)) return "component";
  return null;
}

/** Category from Primer's source file organization, falling back to shared inference. */
export function categoryFor(filePath: string, name: string, type: string | null, raw: unknown): TokenCategory {
  const f = filePath.toLowerCase();
  if (/\/color\//.test(f)) return "color";
  if (/\/shadow\//.test(f)) return "elevation";
  if (/\/typography\//.test(f)) return "typography";
  if (/\/motion\//.test(f)) return "motion";
  if (/\/z-index\.json5$/.test(f)) return "elevation";
  if (/\/(breakpoints|viewport)\.json5$/.test(f)) return "layout";
  if (/\/size\/(radius|border)\.json5$/.test(f)) return "shape";
  if (/\/spacing\//.test(f)) return "spacing";
  if (/\/size\/size(-coarse|-fine)?\.json5$/.test(f)) return "spacing";
  return inferTokenCategory(name, type, raw).category;
}

function withAlpha(raw: unknown, alpha: unknown): unknown {
  return typeof alpha === "number" ? { value: raw, alpha } : raw;
}

function deprecationNote(dep: unknown): string | null {
  if (typeof dep !== "string") return null;
  const refs = extractReferences(dep);
  return refs.length ? `Deprecated; replaced by ${refs.join(", ")}.` : `Deprecated: ${dep}`.slice(0, 200);
}

function joinDescription(...parts: (string | null | undefined)[]): string | null {
  const s = parts.filter((p): p is string => !!p && !!p.trim()).join(" ").replace(/\s+/g, " ").trim();
  return s ? s.slice(0, 600) : null;
}

export interface TokenParseResult {
  tokens: NormalizedToken[];
  warnings: string[];
}

/**
 * Parse a @primer/primitives dist/docs JSON file. `theme` selects which override pointer is reported
 * in `location` when the authored value comes from `$extensions["org.primer.overrides"][theme]`.
 */
export function parsePrimitivesDocsJson(body: string, theme: string | null): TokenParseResult {
  const warnings: string[] = [];
  const json = JSON.parse(body) as Record<string, unknown>;
  const out: NormalizedToken[] = [];
  for (const [key, entry] of Object.entries(json)) {
    if (!isObj(entry)) continue;
    const path = Array.isArray(entry.path) ? entry.path.filter((p): p is string => typeof p === "string") : [];
    const original = isObj(entry.original) ? entry.original : null;
    if (!path.length || !original || !("$value" in original)) {
      warnings.push(`docs entry ${key} has no path/original.$value; skipped`);
      continue;
    }
    const filePath = typeof entry.filePath === "string" ? entry.filePath : "";
    const type = typeof original.$type === "string" ? original.$type : typeof entry.type === "string" ? entry.type : null;
    const raw = withAlpha(original.$value, original.alpha);
    const name = path.join(".");
    const overrides = isObj(original.$extensions) && isObj(original.$extensions["org.primer.overrides"]) ? original.$extensions["org.primer.overrides"] : null;
    let pointer = `/${path.map(esc).join("/")}`;
    if (theme && overrides && theme in overrides) pointer += `/$extensions/org.primer.overrides/${esc(theme)}`;
    const tier = tierFromFile(filePath);
    out.push({
      name,
      path,
      cssVar: typeof entry.name === "string" && entry.name ? `--${entry.name}` : null,
      type,
      category: categoryFor(filePath, name, type, raw),
      tier,
      tierState: tier ? "verified" : "inferred",
      rawValue: raw,
      references: extractReferences(raw),
      description: joinDescription(typeof original.$description === "string" ? original.$description : null, deprecationNote(original.$deprecated)),
      deprecated: original.$deprecated === true || typeof original.$deprecated === "string",
      location: filePath ? `${filePath}#${pointer}` : `#${pointer}`,
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return { tokens: out, warnings };
}

/** Parse a DTCG JSON5 source file (base color scales). */
export function parsePrimitivesJson5(body: string, filePath: string): TokenParseResult {
  const warnings: string[] = [];
  const tree = parseJson5(body);
  const flat = flattenTokenTree(tree, { format: "dtcg", location: filePath, cssVar: (p) => `--${p.join("-")}` });
  const nodeAt = (path: string[]): Record<string, unknown> | null => {
    let n: unknown = tree;
    for (const k of path) {
      if (!isObj(n)) return null;
      n = n[k];
    }
    return isObj(n) ? n : null;
  };
  const tier = tierFromFile(filePath);
  const out: NormalizedToken[] = flat.map((t) => {
    const node = nodeAt(t.path);
    const raw = withAlpha(t.rawValue, node?.alpha);
    return {
      name: t.name,
      path: t.path,
      cssVar: t.cssVar,
      type: t.type,
      category: categoryFor(filePath, t.name, t.type, raw),
      tier,
      tierState: tier ? "verified" : "inferred",
      rawValue: raw,
      references: extractReferences(raw),
      description: joinDescription(t.description, deprecationNote(node?.$deprecated)),
      deprecated: t.deprecated,
      location: t.location,
    };
  });
  if (!out.length) warnings.push(`${filePath}: no tokens found`);
  out.sort((a, b) => a.name.localeCompare(b.name));
  return { tokens: out, warnings };
}
