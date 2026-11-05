/**
 * Token extraction for Material UI and Joy UI from published npm package files (static reads of
 * object literals; nothing is executed). Only statically declared values are extracted; values
 * computed in code (shadows built by functions, template strings with substitutions, color
 * manipulation) are counted as not extracted.
 *
 * Material UI (@mui/material):
 *  - colors/<hue>.mjs              -> "mui-color-palette" (theme null, primitive)
 *  - styles/createPalette.mjs      -> getLight()/getDark() + getDefault<Intent>(mode) literals
 *                                     -> "mui-palette-light" / "mui-palette-dark" (references preserved)
 *  - styles/createTransitions.mjs  -> easing + duration -> "mui-transitions"
 *  - styles/zIndex.mjs             -> "mui-z-index"
 * Joy UI (@mui/joy):
 *  - colors/colors.js              -> "joy-color-palette" (theme null, primitive)
 *  - styles/extendTheme.js         -> defaultColors (palette scales, references to colors) and the
 *                                     literal default scales (fontSize, fontWeight, lineHeight, radius,
 *                                     zIndex, focus.thickness, fontFamily.code/fallback) -> "joy-theme-defaults"
 *    CSS variables follow the documented `--joy-<path joined by "-">` convention
 *    (using-css-variables.md; shouldSkipGeneratingVar.js lists the skipped groups).
 */
import type { NormalizedToken, NormalizedTokenSet, TokenCategory } from "@/lib/contracts";
import { findValue, flattenObject, functionReturns, objectGet, type JsValue } from "./js-literal";
import { PARSERS } from "./constants";
import { evidence, type Prov } from "./shared";

const PARSER_TOKENS = PARSERS.jsLiteral;

/** One extracted entry: token path + value as authored (literal or member reference). */
export interface TokenEntry {
  path: string[];
  value: JsValue;
  /** "file#object.path" */
  location: string;
}

export interface TokenFileData {
  role: TokenRole;
  file: string;
  entries: TokenEntry[];
  /** Static members whose values are computed in code (not extracted). */
  skipped: string[];
}

export type TokenRole = "mui-color" | "mui-palette" | "mui-transitions" | "mui-zindex" | "joy-colors" | "joy-theme" | "joy-skip-vars";

const INTENTS = ["Primary", "Secondary", "Error", "Info", "Success", "Warning"] as const;

function entriesOf(v: JsValue | null | undefined, prefix: string[], file: string, objPath: string): { entries: TokenEntry[]; skipped: string[] } {
  const entries: TokenEntry[] = [];
  const skipped: string[] = [];
  if (!v) return { entries, skipped };
  for (const f of flattenObject(v, prefix)) {
    const loc = `${file}#${objPath}${f.path.slice(prefix.length).length ? `.${f.path.slice(prefix.length).join(".")}` : ""}`;
    if (f.value.t === "unsupported" || f.value.t === "array" || f.value.t === "null" || f.value.t === "bool") skipped.push(f.path.join("."));
    else entries.push({ path: f.path, value: f.value, location: loc });
  }
  return { entries, skipped };
}

/** Parse one package file for its role. Pure. */
export function parseTokenFile(role: TokenRole, file: string, src: string, hue?: string): TokenFileData {
  const out: TokenFileData = { role, file, entries: [], skipped: [] };
  const add = (r: { entries: TokenEntry[]; skipped: string[] }) => {
    out.entries.push(...r.entries);
    out.skipped.push(...r.skipped);
  };
  switch (role) {
    case "mui-color": {
      const name = hue ?? file.split("/").pop()!.replace(/\.m?js$/, "");
      add(entriesOf(findValue(src, new RegExp(`const\\s+${name}\\s*=\\s*`))?.value, [name], file, name));
      break;
    }
    case "mui-palette": {
      for (const [fn, mode] of [["getLight", "light"], ["getDark", "dark"]] as const) {
        for (const r of functionReturns(src, fn)) {
          const e = entriesOf(r.value, ["palette"], file, `${fn}()`);
          out.entries.push(...e.entries.map((x) => ({ ...x, path: [mode, ...x.path] })));
          out.skipped.push(...e.skipped);
        }
      }
      for (const intent of INTENTS) {
        for (const r of functionReturns(src, `getDefault${intent}`)) {
          const mode = r.mode === "dark" ? "dark" : "light";
          const key = intent.toLowerCase();
          const e = entriesOf(r.value, ["palette", key], file, `getDefault${intent}(${r.mode === "default" ? "'light'" : `'${r.mode}'`})`);
          out.entries.push(...e.entries.map((x) => ({ ...x, path: [mode, ...x.path] })));
          out.skipped.push(...e.skipped);
        }
      }
      break;
    }
    case "mui-transitions":
      add(entriesOf(findValue(src, /export\s+const\s+easing\s*=\s*/)?.value, ["easing"], file, "easing"));
      add(entriesOf(findValue(src, /export\s+const\s+duration\s*=\s*/)?.value, ["duration"], file, "duration"));
      break;
    case "mui-zindex":
      add(entriesOf(findValue(src, /const\s+zIndex\s*=\s*/)?.value, ["zIndex"], file, "zIndex"));
      break;
    case "joy-colors":
      add(entriesOf(findValue(src, /const\s+colors\s*=\s*/)?.value, [], file, "colors"));
      break;
    case "joy-theme": {
      const defaultColors = findValue(src, /const\s+defaultColors\s*=\s*/)?.value ?? null;
      if (defaultColors && defaultColors.t === "object") {
        for (const e of defaultColors.entries) {
          // primary: colors.blue -> expanded against the colors palette in normalize (reference kept)
          if (e.value.t === "ref") out.entries.push({ path: ["palette", e.key], value: e.value, location: `${file}#defaultColors.${e.key}` });
          else add(entriesOf(e.value, ["palette", e.key], file, `defaultColors.${e.key}`));
        }
      }
      for (const scale of ["fontWeight", "fontSize", "lineHeight"]) add(entriesOf(findValue(src, new RegExp(`const\\s+${scale}\\s*=\\s*_extends\\(\\s*`))?.value, [scale], file, scale));
      const ff = findValue(src, /const\s+fontFamily\s*=\s*_extends\(\s*/)?.value;
      const fallback = findValue(src, /const\s+fontFamilyFallback\s*=\s*/)?.value;
      if (ff && ff.t === "object") {
        for (const e of ff.entries) {
          if (e.value.t === "string") out.entries.push({ path: ["fontFamily", e.key], value: e.value, location: `${file}#fontFamily.${e.key}` });
          else if (e.value.t === "ref" && e.value.path.join(".") === "fontFamilyFallback" && fallback?.t === "string")
            out.entries.push({ path: ["fontFamily", e.key], value: fallback, location: `${file}#fontFamilyFallback` });
          else out.skipped.push(`fontFamily.${e.key}`);
        }
      }
      const scales = findValue(src, /const\s+defaultScales\s*=\s*/)?.value ?? null;
      for (const key of ["radius", "zIndex"]) add(entriesOf(objectGet(scales, key), [key], file, `defaultScales.${key}`));
      const focus = objectGet(scales, "focus");
      const thickness = objectGet(focus, "thickness");
      if (thickness?.t === "string") out.entries.push({ path: ["focus", "thickness"], value: thickness, location: `${file}#defaultScales.focus.thickness` });
      const shadow = objectGet(scales, "shadow");
      if (shadow?.t === "object") out.skipped.push(...shadow.entries.map((e) => `shadow.${e.key}`));
      break;
    }
    case "joy-skip-vars":
      break;
  }
  return out;
}

/* --------------------------------- building --------------------------------- */

export interface TokenBuildInput {
  pkg: string;
  version: string;
  files: { data: TokenFileData; prov: Prov; npmUrl: string }[];
  license: NormalizedTokenSet["license"];
  /** Evidence for the documented CSS variable naming (Joy). */
  cssVarDoc?: { prov: Prov; excerpt: string } | null;
}

const refName = (path: string[]) => path.join(".");

function valueOf(v: JsValue, refMap: (path: string[]) => string[] | null): { raw: unknown; refs: string[] } | null {
  switch (v.t) {
    case "string":
      return { raw: v.v, refs: [] };
    case "number":
      return { raw: v.v, refs: [] };
    case "ref": {
      const target = refMap(v.path);
      if (!target) return null;
      return { raw: `{${refName(target)}}`, refs: [refName(target)] };
    }
    default:
      return null;
  }
}

interface Classified {
  type: string | null;
  category: TokenCategory;
}

function classifyMui(path: string[], raw: unknown): Classified {
  const top = path[0];
  const leaf = path[path.length - 1] ?? "";
  if (top === "easing") return { type: "cubicBezier", category: "motion" };
  if (top === "duration") return { type: "duration", category: "motion" };
  if (top === "zIndex") return { type: "number", category: "elevation" };
  if (/Opacity$/.test(leaf)) return { type: "number", category: "opacity" };
  if (top === "fontSize") return { type: "dimension", category: "typography" };
  if (top === "fontWeight") return { type: "fontWeight", category: "typography" };
  if (top === "lineHeight") return { type: "lineHeight", category: "typography" };
  if (top === "fontFamily") return { type: "fontFamily", category: "typography" };
  if (top === "radius") return { type: "dimension", category: "shape" };
  if (top === "focus") return { type: "dimension", category: "shape" };
  if (typeof raw === "number") return { type: "number", category: "other" };
  return { type: "color", category: "color" };
}

function makeToken(name: string[], raw: unknown, refs: string[], location: string, opts: { tier: NormalizedToken["tier"]; cssVar?: string | null; description?: string | null }): NormalizedToken {
  const c = classifyMui(name, raw);
  return {
    name: name.join("."),
    path: name,
    cssVar: opts.cssVar ?? null,
    type: c.type,
    category: c.category,
    tier: opts.tier,
    tierState: "inferred",
    rawValue: raw,
    references: refs,
    description: opts.description ?? null,
    deprecated: false,
    location,
  };
}

const byName = (a: NormalizedToken, b: NormalizedToken) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

function setEvidence(files: TokenBuildInput["files"], extra: string, count?: number): NormalizedTokenSet["evidence"] {
  return files.map((f) =>
    evidence(f.prov, "tokens", PARSER_TOKENS, {
      location: f.data.file,
      excerpt: `${count ?? f.data.entries.length} statically declared values read from ${f.data.file}${f.data.skipped.length ? `; ${f.data.skipped.length} computed values not extracted (${f.data.skipped.slice(0, 4).join(", ")}${f.data.skipped.length > 4 ? ", …" : ""})` : ""}${extra}`,
    }),
  );
}

/** Material UI token sets. */
export function buildMuiTokenSets(inp: TokenBuildInput): { sets: NormalizedTokenSet[]; warnings: string[] } {
  const warnings: string[] = [];
  const sets: NormalizedTokenSet[] = [];
  const colorFiles = inp.files.filter((f) => f.data.role === "mui-color").sort((a, b) => (a.data.file < b.data.file ? -1 : 1));
  const colorTokens: NormalizedToken[] = [];
  for (const f of colorFiles) for (const e of f.data.entries) {
    const v = valueOf(e.value, () => null);
    if (!v) continue;
    colorTokens.push(makeToken(e.path, v.raw, [], e.location, { tier: "primitive" }));
  }
  const colorNames = new Set(colorTokens.map((t) => t.name));
  const base = { packageName: inp.pkg, packageVersion: inp.version, license: inp.license, redistribution: "permitted" as const, format: "js-module" as const };
  if (colorTokens.length) {
    sets.push({
      ...base,
      slug: "mui-color-palette",
      name: "Material UI color palette (@mui/material/colors)",
      theme: null,
      sourceUrl: colorFiles.find((f) => /index/.test(f.npmUrl))?.npmUrl ?? colorFiles[0]!.npmUrl.replace(/[^/]+$/, "index.mjs"),
      tokens: colorTokens.sort(byName),
      evidence: setEvidence(colorFiles, ""),
    });
  }
  const refMap = (path: string[]): string[] | null => {
    const name = path.join(".");
    if (colorNames.has(name)) return path;
    warnings.push(`palette reference ${name} not found in color palette`);
    return null;
  };
  const pal = inp.files.find((f) => f.data.role === "mui-palette");
  if (pal) {
    for (const mode of ["light", "dark"] as const) {
      const tokens: NormalizedToken[] = [];
      const seen = new Set<string>();
      for (const e of pal.data.entries) {
        if (e.path[0] !== mode) continue;
        const name = e.path.slice(1);
        const v = valueOf(e.value, refMap);
        if (!v || seen.has(name.join("."))) continue;
        seen.add(name.join("."));
        tokens.push(makeToken(name, v.raw, v.refs, e.location, { tier: "semantic" }));
      }
      if (!tokens.length) continue;
      sets.push({
        ...base,
        slug: `mui-palette-${mode}`,
        name: `Material UI default palette (${mode} mode)`,
        theme: mode,
        sourceUrl: pal.npmUrl,
        tokens: tokens.sort(byName),
        evidence: setEvidence([pal], ` for ${mode} mode (getLight/getDark and getDefault<Intent>(mode)); contrastText and other derived values are computed and not extracted`, tokens.length),
      });
    }
  }
  for (const [role, slug, name] of [
    ["mui-transitions", "mui-transitions", "Material UI transitions (easing and duration)"],
    ["mui-zindex", "mui-z-index", "Material UI z-index scale"],
  ] as const) {
    const f = inp.files.find((x) => x.data.role === role);
    if (!f) continue;
    const tokens = f.data.entries
      .map((e) => {
        const v = valueOf(e.value, () => null);
        return v ? makeToken(e.path, v.raw, [], e.location, { tier: null }) : null;
      })
      .filter((t): t is NormalizedToken => !!t);
    if (!tokens.length) continue;
    sets.push({ ...base, slug, name, theme: null, sourceUrl: f.npmUrl, tokens: tokens.sort(byName), evidence: setEvidence([f], role === "mui-transitions" ? "; durations are numbers (milliseconds) as authored" : "") });
  }
  return { sets, warnings };
}

/** Joy UI token sets. */
export function buildJoyTokenSets(inp: TokenBuildInput): { sets: NormalizedTokenSet[]; warnings: string[] } {
  const warnings: string[] = [];
  const sets: NormalizedTokenSet[] = [];
  const base = { packageName: inp.pkg, packageVersion: inp.version, license: inp.license, redistribution: "permitted" as const, format: "js-module" as const };
  const colors = inp.files.find((f) => f.data.role === "joy-colors");
  const colorTokens: NormalizedToken[] = [];
  if (colors) {
    for (const e of colors.data.entries) {
      const v = valueOf(e.value, () => null);
      if (v) colorTokens.push(makeToken(e.path, v.raw, [], e.location, { tier: "primitive" }));
    }
    if (colorTokens.length)
      sets.push({ ...base, slug: "joy-color-palette", name: "Joy UI color palette (@mui/joy/colors)", theme: null, sourceUrl: colors.npmUrl, tokens: colorTokens.sort(byName), evidence: setEvidence([colors], "") });
  }
  const colorNames = new Set(colorTokens.map((t) => t.name));
  const theme = inp.files.find((f) => f.data.role === "joy-theme");
  const skip = inp.files.find((f) => f.data.role === "joy-skip-vars");
  if (theme) {
    const cssVar = (path: string[]) => `--joy-${path.join("-")}`;
    const tokens: NormalizedToken[] = [];
    for (const e of theme.data.entries) {
      if (e.path[0] === "palette" && e.value.t === "ref") {
        // palette.primary = colors.blue: one reference token per shade of the referenced scale.
        const target = e.value.path[0] === "colors" ? e.value.path.slice(1) : e.value.path;
        const shades = colorTokens.filter((t) => t.path.length === target.length + 1 && target.every((p, i) => t.path[i] === p));
        if (!shades.length) {
          warnings.push(`defaultColors.${e.path[1]} -> ${e.value.raw}: no matching color scale`);
          continue;
        }
        for (const s of shades) {
          const name = [...e.path, s.path[s.path.length - 1]!];
          tokens.push(makeToken(name, `{${s.name}}`, [s.name], `${e.location} (= ${e.value.raw}.${s.path[s.path.length - 1]})`, { tier: "semantic", cssVar: cssVar(name) }));
        }
        continue;
      }
      const v = valueOf(e.value, (p) => (colorNames.has(p.join(".")) ? p : null));
      if (!v) continue;
      tokens.push(makeToken(e.path, v.raw, v.refs, e.location, { tier: e.path[0] === "palette" ? "semantic" : null, cssVar: cssVar(e.path) }));
    }
    if (tokens.length) {
      const ev = setEvidence([theme, ...(skip ? [skip] : [])], "; values passed through _extends(defaults, themeInput) are the defaults");
      if (inp.cssVarDoc) ev.push(evidence(inp.cssVarDoc.prov, "tokens.cssVar", PARSER_TOKENS, { location: inp.cssVarDoc.prov.file, excerpt: inp.cssVarDoc.excerpt }));
      sets.push({ ...base, slug: "joy-theme-defaults", name: "Joy UI default theme scales (extendTheme)", theme: null, sourceUrl: theme.npmUrl, tokens: tokens.sort(byName), evidence: ev });
    }
  }
  return { sets, warnings };
}
