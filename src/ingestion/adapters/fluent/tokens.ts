/**
 * @fluentui/tokens -> ATLAS token sets.
 *
 * The package ships generated ES modules (lib/global/*.js, lib/alias/*.js, lib/themes/**). They are
 * read with the static interpreter in ./jsmod (never executed). Token naming follows the package:
 *  - global color ramps / constants:  "grey.14", "red.tint60", "white", "hcCanvas"  (lib/global/colors.js)
 *  - brand ramps:                     "brandWeb.80"                              (lib/global/brandColors.js)
 *  - theme tokens:                    "colorNeutralForeground1", "fontSizeBase300", "shadow4" — the keys of
 *    the exported theme objects, exposed as CSS custom properties (lib/tokens.js maps each to var(--name)).
 *
 * Sets:
 *  - fluent-global-colors, fluent-brand-ramps (theme null, primitive, directory lib/global = "global" tier)
 *  - fluent-global-tokens: theme tokens whose value comes from lib/global/* identically in every theme
 *    (sizes, spacing, radii, strokes, fonts, motion) (theme null)
 *  - fluent-typography-styles: typographyStyles composites referencing theme tokens (theme null)
 *  - fluent-theme-<theme>: per exported theme (webLightTheme -> "web-light"), the theme tokens that are
 *    not shared (alias colors from lib/alias/*, palette/status tokens, shadows, overrides).
 * Raw values preserve references as "{name}"; aliases are never resolved here (the engine does that).
 */
import type { EvidenceInput, NormalizedToken, NormalizedTokenSet, TokenCategory, TokenTier } from "@/lib/contracts";
import { inferTokenCategory } from "@/lib/tokens/tree";
import { Interpreter, render, type ModuleHost, type ObjVal, type Origin, type Val } from "./jsmod";
import { MIT, clip, evidence, npmFile, sortBy, type Prov } from "./shared";

export interface TokenModuleSource {
  path: string; // "lib/alias/lightColor.js"
  text: string;
  prov: Prov;
}

export interface TokenBuildInput {
  pkg: string;
  version: string;
  modules: TokenModuleSource[];
  /** Optional theme allow-list (theme slugs); default: every theme exported from lib/index.js. */
  themes?: string[];
  /** Short note recorded in set evidence (e.g. "via @fluentui/react-theme@9.2.2"). */
  via?: string | null;
}

export interface TokenBuildResult {
  sets: NormalizedTokenSet[];
  warnings: string[];
  /** theme token name -> CSS custom property (from lib/tokens.js) */
  cssVars: Map<string, string>;
  themes: string[];
}

export const GLOBAL_COLORS_MODULE = "lib/global/colors.js";
export const BRAND_MODULE = "lib/global/brandColors.js";
export const TOKENS_MODULE = "lib/tokens.js";
export const ENTRY_MODULE = "lib/index.js";

/** "webLightTheme" -> "web-light", "teamsLightV21Theme" -> "teams-light-v21". */
export function themeSlug(exportName: string): string {
  return exportName
    .replace(/Theme$/, "")
    .replace(/([a-z])([A-Z0-9])/g, "$1-$2")
    .replace(/([0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .replace(/-v-?(\d+)/, "-v$1");
}

/** Relative import specifiers of an ES module (static `import`/`export ... from`). */
export function moduleImports(path: string, text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/\b(?:import|export)\s*(?:type\s+)?(?:[\w*{}\s,$]+?\s+from\s+)?["'](\.{1,2}\/[^"']+)["']/g)) {
    const spec = m[1]!;
    const parts = path.split("/").slice(0, -1);
    for (const seg of spec.split("/")) {
      if (seg === "." || !seg) continue;
      if (seg === "..") parts.pop();
      else parts.push(seg);
    }
    out.add(parts.join("/"));
  }
  return [...out].sort();
}

/** ATLAS category for Fluent token names (inferred from the documented naming scheme). */
export function fluentCategory(name: string, raw: unknown): TokenCategory {
  const n = name.replace(/^typographyStyles\./, "");
  if (/^shadow\d/.test(n)) return "elevation";
  if (/^(color|brand)/.test(n)) return "color";
  if (/^(fontSize|fontWeight|fontFamily|lineHeight)/.test(n) || name.startsWith("typographyStyles.")) return "typography";
  if (/^spacing(Horizontal|Vertical)/.test(n)) return "spacing";
  if (/^(borderRadius|strokeWidth)/.test(n)) return "shape";
  if (/^(duration|curve)/.test(n)) return "motion";
  return inferTokenCategory(name, null, raw).category;
}

const scalar = (v: Val) => v.t === "str" || v.t === "num" || v.t === "tpl" || v.t === "ref";

export function buildFluentTokenSets(input: TokenBuildInput): TokenBuildResult {
  const warnings: string[] = [];
  const byPath = new Map(input.modules.map((m) => [m.path, m]));
  // 1. CSS custom property names from lib/tokens.js (a plain object literal of 'var(--x)' strings).
  const cssVars = new Map<string, string>();
  const tokenNames = new Set<string>();
  const pre = new Interpreter({ source: (p) => byPath.get(p)?.text ?? null, groupFor: () => undefined, scalarRef: () => null });
  const tokMod = pre.load(TOKENS_MODULE);
  const tokObj = tokMod.exports.get("tokens");
  if (tokObj?.t === "obj") {
    for (const [k, v] of tokObj.props) {
      tokenNames.add(k);
      const m = v.t === "str" ? /^var\((--[A-Za-z0-9_-]+)\)$/.exec(v.v) : null;
      if (m) cssVars.set(k, m[1]!);
    }
  } else warnings.push(`${TOKENS_MODULE}: tokens map not found; CSS custom properties unknown`);

  // 2. Evaluate the package entry with token-group naming.
  const host: ModuleHost = {
    source: (p) => byPath.get(p)?.text ?? null,
    groupFor(module, name, value) {
      if (value.t !== "obj") return undefined;
      const allScalar = [...value.props.values()].every(scalar);
      if ((module === GLOBAL_COLORS_MODULE || module === BRAND_MODULE) && allScalar) return name;
      if (value.props.size && [...value.props.keys()].every((k) => tokenNames.has(k))) return "";
      return undefined;
    },
    scalarRef: (module, name) => (module === GLOBAL_COLORS_MODULE ? name : null),
    isTokenName: (n) => tokenNames.has(n),
  };
  const interp = new Interpreter(host);
  const entry = interp.load(ENTRY_MODULE);
  const colors = interp.load(GLOBAL_COLORS_MODULE);
  const brands = interp.load(BRAND_MODULE);
  warnings.push(...interp.warnings);

  const provOf = (module: string): Prov | null => byPath.get(module)?.prov ?? null;
  const loc = (o: Origin | undefined, name: string) => (o ? `${o.module}#L${o.line}` : `#${name}`);
  const sets: NormalizedTokenSet[] = [];
  const setEvidence = (modules: string[], excerpt: string): EvidenceInput[] =>
    modules
      .map((m) => provOf(m))
      .filter((p): p is Prov => !!p)
      .map((p) => evidence(p, "tokens", "tokens-js-static", { location: p.file, excerpt: `${excerpt}${input.via ? ` (${input.via})` : ""}` }));
  const mkToken = (name: string, path: string[], v: Val, o: Origin | undefined, tier: TokenTier | null, tierVerified: boolean, description: string | null = null): NormalizedToken | null => {
    const r = render(v);
    if (r.opaque.length || r.raw === null || r.raw === undefined) {
      warnings.push(`${name}: value not statically extractable (${r.opaque.join(", ") || "empty"})`);
      return null;
    }
    const cssVar = cssVars.get(name) ?? null;
    return {
      name,
      path,
      cssVar,
      type: null,
      category: fluentCategory(name, r.raw),
      tier,
      tierState: tierVerified ? "verified" : "inferred",
      rawValue: r.raw,
      references: r.references.sort(),
      description,
      deprecated: false,
      location: loc(o, name),
    };
  };
  const setBase = (slug: string, name: string, theme: string | null, module: string, tokens: NormalizedToken[], ev: EvidenceInput[]): NormalizedTokenSet | null => {
    if (!tokens.length || !ev.length) return null;
    return {
      slug,
      name,
      theme,
      format: "js-module",
      sourceUrl: provOf(module)?.sourceUrl ?? npmFile(input.pkg, input.version, module),
      packageName: input.pkg,
      packageVersion: input.version,
      license: MIT,
      redistribution: "permitted",
      tokens: sortBy(tokens, (t) => t.name),
      evidence: ev,
    };
  };

  // 3. Global color ramps and constants.
  const flatGroup = (rec: typeof colors): NormalizedToken[] => {
    const out: NormalizedToken[] = [];
    for (const [exp, v] of rec.exports) {
      if (v.t === "obj" && [...v.props.values()].every(scalar)) {
        for (const [k, val] of v.props) {
          const t = mkToken(`${exp}.${k}`, [exp, k], val, v.origins.get(k), "primitive", true);
          if (t) out.push(t);
        }
      } else if (scalar(v)) {
        const t = mkToken(exp, [exp], v, { module: rec.path, line: 0 }, "primitive", true);
        if (t) out.push({ ...t, location: `${rec.path}#${exp}` });
      }
    }
    return out;
  };
  const gc = setBase("fluent-global-colors", "Fluent global color ramps and constants", null, GLOBAL_COLORS_MODULE, flatGroup(colors), setEvidence([GLOBAL_COLORS_MODULE], "Generated global color ramps (lib/global/colors.js)"));
  if (gc) sets.push(gc);
  const br = setBase("fluent-brand-ramps", "Fluent brand color ramps", null, BRAND_MODULE, flatGroup(brands), setEvidence([BRAND_MODULE], "Brand ramps brandWeb / brandTeams / brandOffice / brandTeamsV21 (lib/global/brandColors.js)"));
  if (br) sets.push(br);

  // 4. Themes exported from the package entry.
  const themes: { slug: string; exportName: string; obj: ObjVal }[] = [];
  for (const [exp, v] of entry.exports) {
    if (!/Theme$/.test(exp) || v.t !== "obj" || !v.props.size) continue;
    const slug = themeSlug(exp);
    if (input.themes && !input.themes.includes(slug)) continue;
    themes.push({ slug, exportName: exp, obj: v });
  }
  themes.sort((a, b) => (a.slug < b.slug ? -1 : 1));
  if (!themes.length) warnings.push(`${ENTRY_MODULE}: no theme objects could be evaluated`);

  // Shared tokens: value defined in lib/global/* and identical (as rendered) in every theme.
  const isGlobalOrigin = (o: Origin | undefined) => !!o && o.module.startsWith("lib/global/");
  const shared = new Map<string, { v: Val; o: Origin; raw: string }>();
  const notShared = new Set<string>();
  for (const th of themes) {
    for (const [k, v] of th.obj.props) {
      const o = th.obj.origins.get(k);
      if (!isGlobalOrigin(o)) continue;
      const raw = JSON.stringify(render(v).raw);
      const cur = shared.get(k);
      if (!cur) shared.set(k, { v, o: o!, raw });
      else if (cur.raw !== raw) notShared.add(k);
    }
  }
  for (const th of themes) for (const k of shared.keys()) if (!th.obj.props.has(k)) notShared.add(k);
  const sharedTokens: NormalizedToken[] = [];
  const sharedModules = new Set<string>();
  for (const [k, { v, o }] of shared) {
    if (notShared.has(k)) continue;
    const t = mkToken(k, [k], v, o, "primitive", true);
    if (t) {
      sharedTokens.push(t);
      sharedModules.add(o.module);
    }
  }
  const gs = setBase(
    "fluent-global-tokens",
    "Fluent global theme tokens (size, spacing, shape, stroke, typography, motion)",
    null,
    [...sharedModules].sort()[0] ?? "lib/global/index.js",
    sharedTokens,
    setEvidence([...sharedModules].sort(), `Theme tokens defined in lib/global and spread unchanged into ${themes.length} themes`),
  );
  if (gs) sets.push({ ...gs, sourceUrl: npmFile(input.pkg, input.version, "lib/global/index.js") });

  // Typography styles (composites referencing theme tokens through the tokens map).
  const typoExport = entry.exports.get("typographyStyles");
  if (typoExport?.t === "obj") {
    const tokens: NormalizedToken[] = [];
    for (const [k, v] of typoExport.props) {
      const t = mkToken(`typographyStyles.${k}`, ["typographyStyles", k], v, typoExport.origins.get(k), "semantic", false);
      if (t) tokens.push({ ...t, category: "typography", cssVar: null });
    }
    const ts = setBase("fluent-typography-styles", "Fluent typography styles (typographyStyles)", null, "lib/global/typographyStyles.js", tokens, setEvidence(["lib/global/typographyStyles.js"], "Global typography styles (fontFamily, fontSize, fontWeight, lineHeight)"));
    if (ts) sets.push(ts);
  }

  // Themed sets.
  for (const th of themes) {
    const tokens: NormalizedToken[] = [];
    const modules = new Set<string>();
    for (const [k, v] of th.obj.props) {
      const o = th.obj.origins.get(k);
      if (isGlobalOrigin(o) && shared.has(k) && !notShared.has(k)) continue;
      const fromAlias = !!o && o.module.startsWith("lib/alias/");
      const t = mkToken(k, [k], v, o, fromAlias ? "semantic" : isGlobalOrigin(o) ? "primitive" : "semantic", fromAlias || isGlobalOrigin(o));
      if (t) {
        tokens.push(t);
        if (o) modules.add(o.module);
      }
    }
    // The module that *defines* the theme (not a re-exporting index).
    const defRe = new RegExp(`export\\s+const\\s+${th.exportName}\\b`);
    const themeModule = sortBy(input.modules.filter((m) => m.path.startsWith("lib/themes/") && defRe.test(m.text)), (m) => m.path)[0]?.path ?? ENTRY_MODULE;
    const ev = setEvidence([themeModule, ...[...modules].sort()], `${th.exportName}: ${tokens.length} theme-specific tokens`);
    const s = setBase(`fluent-theme-${th.slug}`, `Fluent ${th.exportName} tokens`, th.slug, themeModule, tokens, ev);
    if (s) sets.push(s);
  }
  return { sets, warnings, cssVars, themes: themes.map((t) => t.slug) };
}

/** Short human summary of a token build for logs/evidence. */
export function describeBuild(r: TokenBuildResult): string {
  return clip(`${r.sets.length} sets, ${r.sets.reduce((n, s) => n + s.tokens.length, 0)} tokens, themes: ${r.themes.join(", ")}`, 280)!;
}
