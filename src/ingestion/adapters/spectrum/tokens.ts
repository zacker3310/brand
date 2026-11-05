/**
 * @adobe/spectrum-tokens (src/*.json) -> ATLAS token sets.
 *
 * Source format (one flat JSON object per file, Apache-2.0):
 *   "name": { "$schema": ".../token-types/<type>.json", "value": <literal | "{ref}">, "component"?, "deprecated"?, ... }
 *   "name": { "$schema": ".../color-set.json", "sets": { "light": {...}, "dark": {...}, "wireframe": {...} } }
 *   "name": { "$schema": ".../scale-set.json", "sets": { "desktop": {...}, "mobile": {...} } }
 *
 * Modeling (truthful themes and scales):
 *  - Color themes are themes: one set per theme ("color-light", "color-dark", "color-wireframe",
 *    theme = light|dark|wireframe) holding every color-set token's value for that theme.
 *  - Platform scale is NOT a theme: "scale-desktop" / "scale-mobile" are theme-agnostic sets (theme null)
 *    holding scale-set values plus every alias that (transitively) points at a scale-set token, so each
 *    scale set resolves completely inside itself (the engine resolves a set's own tokens first).
 *  - Everything else stays in theme-agnostic sets grouped by source file; aliases into themed sets
 *    are resolved per theme by the engine (alias_state "theme-dependent").
 * Values and references are stored exactly as authored; nothing is resolved or invented here.
 */
import type { EvidenceInput, NormalizedToken, NormalizedTokenSet, TokenTier } from "@/lib/contracts";
import { categorizeToken } from "@/lib/tokens/categorize";
import { LICENSE_APACHE } from "./constants";
import { evidence, type Ev, cmp } from "./shared";

export const THEME_KEYS = ["light", "dark", "darkest", "wireframe"] as const;
export const SCALE_KEYS = ["desktop", "mobile"] as const;

export interface RawSetEntry {
  schema: string | null;
  value: unknown;
}

export interface RawToken {
  name: string;
  file: string;
  schema: string | null;
  component: string | null;
  value?: unknown;
  sets?: Record<string, RawSetEntry>;
  deprecated: boolean;
  deprecatedComment: string | null;
  description: string | null;
  private: boolean;
}

const schemaName = (s: unknown): string | null => {
  if (typeof s !== "string") return null;
  const m = /\/([a-z0-9-]+)\.json$/i.exec(s);
  return m ? m[1]!.toLowerCase() : null;
};

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Parse one src/<file>.json. Unknown shapes are skipped with a warning (never guessed). */
export function parseTokenFile(text: string, file: string): { tokens: RawToken[]; warnings: string[] } {
  const warnings: string[] = [];
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return { tokens: [], warnings: [`${file}: invalid JSON (${(e as Error).message})`] };
  }
  if (!isObj(data)) return { tokens: [], warnings: [`${file}: top level is not an object`] };
  const tokens: RawToken[] = [];
  for (const [name, t] of Object.entries(data)) {
    if (!isObj(t)) {
      warnings.push(`${file}#/${name}: not an object`);
      continue;
    }
    const base: RawToken = {
      name,
      file,
      schema: schemaName(t.$schema),
      component: typeof t.component === "string" ? t.component : null,
      deprecated: t.deprecated === true,
      deprecatedComment: typeof t.deprecated_comment === "string" ? t.deprecated_comment : null,
      description: typeof t.description === "string" ? t.description : null,
      private: t.private === true,
    };
    if (isObj(t.sets)) {
      const sets: Record<string, RawSetEntry> = {};
      for (const [k, e] of Object.entries(t.sets)) {
        if (!isObj(e) || !("value" in e)) {
          warnings.push(`${file}#/${name}/sets/${k}: no value (nested sets are not supported)`);
          continue;
        }
        sets[k] = { schema: schemaName(e.$schema), value: e.value };
      }
      if (!Object.keys(sets).length) continue;
      tokens.push({ ...base, sets });
    } else if ("value" in t) {
      tokens.push({ ...base, value: t.value });
    } else {
      warnings.push(`${file}#/${name}: neither value nor sets`);
    }
  }
  return { tokens, warnings };
}

/** "{a-b}" refs anywhere in a value (strings, arrays, composite objects). */
export function refsIn(v: unknown, out: string[] = []): string[] {
  if (typeof v === "string") for (const m of v.matchAll(/\{([^{}\s]+)\}/g)) out.push(m[1]!);
  else if (Array.isArray(v)) for (const x of v) refsIn(x, out);
  else if (isObj(v)) for (const x of Object.values(v)) refsIn(x, out);
  return out;
}

/** Spectrum token-type schema -> DTCG-style $type (null when DTCG has no equivalent or for aliases). */
export function mapType(schema: string | null): string | null {
  switch (schema) {
    case "color":
      return "color";
    case "dimension":
    case "font-size":
      return "dimension";
    case "opacity":
      return "opacity";
    case "multiplier":
    case "gradient-stop":
    case "angle":
      return "number";
    case "font-weight":
      return "fontWeight";
    case "font-family":
      return "fontFamily";
    case "font-style":
      return "fontStyle";
    case "drop-shadow":
      return "shadow";
    case "typography":
      return "typography";
    default:
      return null; // alias, alignment, text-transform, unknown
  }
}

export type SetKind = "theme" | "scale" | "other";
export function setKind(keys: string[]): SetKind {
  if (keys.length && keys.every((k) => (THEME_KEYS as readonly string[]).includes(k))) return "theme";
  if (keys.length && keys.every((k) => (SCALE_KEYS as readonly string[]).includes(k))) return "scale";
  return "other";
}

/* ------------------------------ set grouping ------------------------------ */

interface BaseGroup {
  slug: string;
  name: string;
  tier: TokenTier | null;
}

const BASE_GROUPS: Record<string, BaseGroup> = {
  "color-palette.json": { slug: "color-palette", name: "Color palette (theme-independent values)", tier: "primitive" },
  "semantic-color-palette.json": { slug: "semantic-color-palette", name: "Semantic color palette", tier: "semantic" },
  "color-aliases.json": { slug: "color-aliases", name: "Color aliases", tier: "semantic" },
  "icons.json": { slug: "icons", name: "Icons", tier: null },
  "layout.json": { slug: "layout", name: "Layout (scale-independent)", tier: null },
  "layout-component.json": { slug: "layout-component", name: "Component layout (scale-independent)", tier: null },
  "typography.json": { slug: "typography", name: "Typography (scale-independent)", tier: null },
};
const COMPONENT_GROUP: BaseGroup = { slug: "component", name: "Component tokens (theme- and scale-independent)", tier: "component" };
const THEME_NAMES: Record<string, string> = { light: "Color: light theme", dark: "Color: dark theme", darkest: "Color: darkest theme", wireframe: "Color: wireframe theme" };
const SCALE_NAMES: Record<string, string> = {
  desktop: "Desktop scale (platform-scale dimensions and font sizes)",
  mobile: "Mobile scale (platform-scale dimensions and font sizes)",
};

export interface TokenFileInput {
  file: string; // "src/button.json"
  tokens: RawToken[];
  ev: Ev;
}

export interface BuildOptions {
  pkg: string;
  version: string;
  /** Custom property names declared by @spectrum-css/tokens (verifies cssVar mapping). */
  cssVars: Set<string> | null;
  cssEv: Ev | null;
}

export interface BuildResult {
  sets: NormalizedTokenSet[];
  /** Spectrum `component` field -> token names (documented component ownership). */
  componentTokens: Map<string, string[]>;
  /** Spectrum `component` field -> evidence of the token files that hold that component's tokens. */
  componentTokenFiles: Map<string, Ev[]>;
  /** Tokens whose set keys are neither themes nor scales (skipped, reported). */
  skipped: string[];
  /** Theme-set tokens that reference scale-dependent tokens (resolution ambiguity, reported). */
  themedToScale: string[];
}

export function buildTokenSets(files: TokenFileInput[], opts: BuildOptions): BuildResult {
  const ordered = [...files].sort((a, b) => cmp(a.file, b.file));
  const all = new Map<string, { t: RawToken; ev: Ev }>();
  for (const f of ordered) for (const t of f.tokens) if (!all.has(t.name)) all.set(t.name, { t, ev: f.ev });

  // Resolved $type of an alias = type of the token it points to (followed through the source graph).
  const typeCache = new Map<string, string | null>();
  const typeOf = (name: string, seen = new Set<string>()): string | null => {
    if (typeCache.has(name)) return typeCache.get(name)!;
    if (seen.has(name)) return null;
    seen.add(name);
    const e = all.get(name);
    let ty: string | null = null;
    if (e) {
      const entries: RawSetEntry[] = e.t.sets ? Object.values(e.t.sets) : [{ schema: e.t.schema, value: e.t.value }];
      for (const en of entries) {
        ty = valueType(en.schema, en.value, seen);
        if (ty) break;
      }
    }
    typeCache.set(name, ty);
    return ty;
  };
  const valueType = (schema: string | null, value: unknown, seen = new Set<string>()): string | null => {
    const direct = mapType(schema);
    if (direct) return direct;
    if (schema === "alias" || (typeof value === "string" && /^\{[^{}]+\}$/.test(value))) {
      const r = refsIn(value)[0];
      return r ? typeOf(r, seen) : null;
    }
    return null;
  };

  // Scale dependence: direct scale-set tokens, then aliases that reach them (fixpoint).
  const scaleDep = new Set<string>();
  for (const [n, { t }] of all) if (t.sets && setKind(Object.keys(t.sets)) === "scale") scaleDep.add(n);
  for (let changed = true; changed; ) {
    changed = false;
    for (const [n, { t }] of all) {
      if (scaleDep.has(n) || t.sets) continue;
      if (refsIn(t.value).some((r) => scaleDep.has(r))) {
        scaleDep.add(n);
        changed = true;
      }
    }
  }

  const skipped: string[] = [];
  const themedToScale: string[] = [];
  const componentTokens = new Map<string, string[]>();
  const componentFiles = new Map<string, Set<string>>();
  const themed = new Map<string, NormalizedToken[]>(); // theme key -> tokens
  const scaled = new Map<string, NormalizedToken[]>(); // scale key -> tokens
  const base = new Map<string, { group: BaseGroup; tokens: NormalizedToken[]; files: Set<string> }>();
  const evByFile = new Map(ordered.map((f) => [f.file, f.ev]));
  const themedFiles = new Map<string, Set<string>>();
  const scaledFiles = new Map<string, Set<string>>();

  const mk = (t: RawToken, value: unknown, type: string | null, location: string, tier: TokenTier | null): NormalizedToken => {
    const refs = [...new Set(refsIn(value))];
    const cssVar = `--spectrum-${t.name}`;
    const cat = categorizeToken(t.name, type, value).category;
    const description = t.description ?? (t.deprecatedComment ? `Deprecated: ${t.deprecatedComment}` : null);
    return {
      name: t.name,
      path: [t.name],
      cssVar: opts.cssVars?.has(cssVar) ? cssVar : null,
      type,
      category: type === "typography" ? "typography" : type === "shadow" ? "elevation" : cat,
      tier: t.component ? "component" : tier,
      tierState: t.component ? "verified" : "inferred",
      rawValue: value,
      references: refs,
      description: description ? description.slice(0, 600) : null,
      deprecated: t.deprecated,
      location,
    };
  };
  const push = <K>(m: Map<K, NormalizedToken[]>, k: K, tok: NormalizedToken) => {
    const l = m.get(k) ?? [];
    l.push(tok);
    m.set(k, l);
  };
  const addFile = (m: Map<string, Set<string>>, k: string, file: string) => {
    const s = m.get(k) ?? new Set<string>();
    s.add(file);
    m.set(k, s);
  };

  for (const [name, { t }] of all) {
    if (t.component) {
      const l = componentTokens.get(t.component) ?? [];
      l.push(name);
      componentTokens.set(t.component, l);
      addFile(componentFiles, t.component, t.file);
    }
    const fileBase = t.file.replace(/^src\//, "");
    const group = BASE_GROUPS[fileBase] ?? COMPONENT_GROUP;
    const loc = `${t.file}#/${name}`;
    if (t.sets) {
      const keys = Object.keys(t.sets);
      const kind = setKind(keys);
      if (kind === "other") {
        skipped.push(name);
        continue;
      }
      for (const k of keys) {
        const e = t.sets[k]!;
        const ty = valueType(e.schema, e.value);
        const tok = mk(t, e.value, ty ?? (kind === "theme" && t.schema === "color-set" ? "color" : null), `${loc}/sets/${k}`, group.tier);
        if (kind === "theme") {
          if (tok.references.some((r) => scaleDep.has(r))) themedToScale.push(name);
          push(themed, k, tok);
          addFile(themedFiles, k, t.file);
        } else {
          push(scaled, k, tok);
          addFile(scaledFiles, k, t.file);
        }
      }
      continue;
    }
    const ty = valueType(t.schema, t.value);
    const tok = mk(t, t.value, ty, loc, group.tier);
    if (scaleDep.has(name)) {
      // Scale-agnostic alias whose target differs per scale: carried (as authored) into each scale set.
      for (const k of SCALE_KEYS) {
        push(scaled, k, tok);
        addFile(scaledFiles, k, t.file);
      }
      continue;
    }
    const b = base.get(group.slug) ?? { group, tokens: [], files: new Set<string>() };
    b.tokens.push(tok);
    b.files.add(t.file);
    base.set(group.slug, b);
  }

  const setEvidence = (fileSet: Set<string>, note: string): EvidenceInput[] => {
    const evs: EvidenceInput[] = [];
    for (const file of [...fileSet].sort()) {
      const ev = evByFile.get(file);
      if (ev) evs.push(evidence("*", ev, "tokens-json", 0.95, { location: `${file} (${note})` }));
    }
    return evs;
  };
  const sets: NormalizedTokenSet[] = [];
  const finish = (slug: string, name: string, theme: string | null, tokens: NormalizedToken[], files: Set<string>, note: string) => {
    if (!tokens.length) return;
    const sorted = [...tokens].sort((a, b) => cmp(a.name, b.name));
    const ev = setEvidence(files, note);
    if (opts.cssEv && sorted.some((t) => t.cssVar)) ev.push(evidence("cssVar", opts.cssEv, "spectrum-css-vars", 0.85, { location: `${opts.cssEv.location} (declared --spectrum-* custom properties)` }));
    const first = [...files].sort()[0]!;
    sets.push({
      slug,
      name,
      theme,
      format: "json",
      sourceUrl: evByFile.get(first)?.sourceUrl ?? ev[0]!.sourceUrl,
      packageName: opts.pkg,
      packageVersion: opts.version,
      license: LICENSE_APACHE,
      redistribution: "permitted",
      tokens: sorted,
      evidence: ev,
    });
  };
  for (const k of THEME_KEYS) finish(`color-${k}`, THEME_NAMES[k]!, k, themed.get(k) ?? [], themedFiles.get(k) ?? new Set(), `sets.${k} of color-set tokens`);
  for (const k of SCALE_KEYS) finish(`scale-${k}`, SCALE_NAMES[k]!, null, scaled.get(k) ?? [], scaledFiles.get(k) ?? new Set(), `sets.${k} of scale-set tokens and aliases that resolve through them`);
  for (const g of [...Object.values(BASE_GROUPS), COMPONENT_GROUP]) {
    const b = base.get(g.slug);
    if (b) finish(g.slug, g.name, null, b.tokens, b.files, "tokens without theme or scale sets");
  }
  for (const l of componentTokens.values()) l.sort();
  // Evidence per component: the file(s) that actually declare its tokens (not the first file of the package).
  const componentTokenFiles = new Map<string, Ev[]>();
  for (const [c, fs] of componentFiles) componentTokenFiles.set(c, [...fs].sort().map((f) => evByFile.get(f)).filter((e): e is Ev => !!e));
  return { sets, componentTokens, componentTokenFiles, skipped: skipped.sort(), themedToScale: [...new Set(themedToScale)].sort() };
}

/** Custom property names declared in a CSS file (`--name:`), used to verify cssVar mappings. */
export function declaredCustomProperties(css: string): string[] {
  const out = new Set<string>();
  for (const m of css.matchAll(/(--[A-Za-z0-9_-]+)\s*:/g)) out.add(m[1]!);
  return [...out].sort();
}
