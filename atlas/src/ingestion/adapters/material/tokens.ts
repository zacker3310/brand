/**
 * Token set construction for both Material bundles.
 *
 *  material-design: tokens/versions/latest/sass/_md-*.scss (M3 token database export; names are the
 *    authored dotted names from the generator's doc comments, e.g. "md.sys.color.primary").
 *  material-web:    tokens/versions/v0_192/_md-*.scss (the M3 v0.192 token values @material/web
 *    implements) + material-web wrappers (tokens/_md-*.scss) for CSS custom property support.
 *
 * Raw values preserve references as "{token.name}"; aliases are never resolved here.
 */
import type { EvidenceInput, NormalizedToken, NormalizedTokenSet, TokenCategory, TokenTier } from "@/lib/contracts";
import { inferTokenCategory } from "@/lib/tokens/tree";
import { slugify } from "@/lib/utils";
import { addToIndex, latestValueToRaw, literal, v0192ModulePrefix, type LatestSassFile, type SassVarIndex, type SupportedTokensFile, type V0192File } from "./sass";
import { APACHE_2, MW_PACKAGE, clip, evidence, sortBy, type Prov } from "./shared";

/* ---------------------------------- helpers ---------------------------------- */

export function tierFor(name: string): TokenTier | null {
  if (/^md\.ref\./.test(name)) return "primitive";
  if (/^md\.sys\./.test(name)) return "semantic";
  if (/^md\.(comp\.|[a-z])/.test(name)) return "component";
  return null;
}

/** ATLAS category assignment (inferred) tuned for M3 token naming. */
export function m3Category(name: string, value: unknown): TokenCategory {
  const n = name.toLowerCase();
  const segs = n.split(".");
  const last = segs[segs.length - 1] ?? "";
  if (/^md\.(ref\.palette|sys\.color)\./.test(n)) return "color";
  if (/^md\.(ref\.typeface|sys\.typescale)\./.test(n)) return "typography";
  if (/^md\.sys\.shape\./.test(n)) return "shape";
  if (/^md\.sys\.elevation\./.test(n)) return "elevation";
  if (/^md\.sys\.motion\./.test(n)) return "motion";
  if (/^md\.sys\.state\.focus-indicator\./.test(n)) return "shape";
  if (/^md\.sys\.state\./.test(n)) return "opacity";
  if (/color$/.test(last)) return "color";
  if (/(^|-)opacity$/.test(last)) return "opacity";
  if (/(^|-)elevation$/.test(last)) return "elevation";
  if (/(^|-)shape(-|$)|corner/.test(last)) return "shape";
  if (/duration|easing|damping|stiffness/.test(last)) return "motion";
  if (/(^|-)(font|weight|tracking|line-height|type)$/.test(last)) return "typography";
  const textish = segs.some((s) => /(text|label|headline|title|font|typescale|supporting|overline|subhead)/.test(s));
  if (textish && /(^|-)size$/.test(last)) return "typography";
  if (/(size|height|width|space|padding|margin|gap|offset|thickness|inset|spacing)$/.test(last)) return "spacing";
  return inferTokenCategory(name, null, value).category;
}

function describe(desc: string | null, group: string | null): string | null {
  const d = desc ? clip(desc, 520) : null;
  if (d && group) return clip(`${d} (group: ${group})`, 600);
  if (group) return `Group: ${group}`;
  return d;
}

/** Longest common dotted prefix ("md.sys.state.focus-indicator"). */
export function commonPrefix(names: string[]): string | null {
  if (!names.length) return null;
  let parts = names[0]!.split(".");
  for (const n of names.slice(1)) {
    const p = n.split(".");
    let k = 0;
    while (k < parts.length && k < p.length && parts[k] === p[k]) k++;
    parts = parts.slice(0, k);
  }
  return parts.length ? parts.join(".") : null;
}

/* ------------------------------ material-design ------------------------------ */

export interface M3SassInput {
  prov: Prov;
  stem: string; // "md-sys-color__dark"
  file: LatestSassFile;
}

interface SetSpec {
  slug: string;
  name: string;
  theme: string | null;
}

/** Which ATLAS token set a latest-format file belongs to. Component files share one set. */
export function m3SetFor(stem: string): SetSpec {
  const color = /^md-sys-color(?:__(dark))?(?:__(medium-contrast|high-contrast))?$/.exec(stem);
  if (color) {
    const theme = [color[1] ?? "light", color[2]].filter(Boolean).join("-");
    return { slug: `m3-sys-color-${theme}`, name: `M3 md.sys.color tokens (${theme.replace(/-/g, " ")})`, theme };
  }
  if (/^md-(ref|sys)-/.test(stem)) {
    // Display name is replaced by the tokens' common dotted prefix once tokens are known.
    return { slug: `m3-${slugify(stem.replace(/^md-/, ""))}`, name: `M3 ${stem} tokens`, theme: null };
  }
  return { slug: "m3-component-tokens", name: "M3 component tokens (md.comp.*)", theme: null };
}

export interface BuildResult {
  sets: NormalizedTokenSet[];
  warnings: string[];
  /** token file stem -> token names (for component linkage) */
  namesByStem: Map<string, string[]>;
  /** token file stem -> distinct group labels */
  groupsByStem: Map<string, string[]>;
}

export function buildM3TokenSets(inputs: M3SassInput[], opts: { version: string; ref: string; treeUrl: string }): BuildResult {
  const warnings: string[] = [];
  const index: SassVarIndex = new Map();
  const ordered = sortBy(inputs, (i) => i.stem);
  // Reference index uses the light/base file for each module stem (references are theme-independent names).
  for (const i of ordered) addToIndex(index, i.stem, i.file);
  const bySet = new Map<string, { spec: SetSpec; tokens: Map<string, NormalizedToken>; evidence: EvidenceInput[]; sourceUrl: string; versions: Set<string> }>();
  const namesByStem = new Map<string, string[]>();
  const groupsByStem = new Map<string, string[]>();
  for (const i of ordered) {
    const spec = m3SetFor(i.stem);
    let s = bySet.get(spec.slug);
    if (!s) {
      s = { spec, tokens: new Map(), evidence: [], sourceUrl: spec.slug === "m3-component-tokens" ? opts.treeUrl : i.prov.sourceUrl, versions: new Set() };
      bySet.set(spec.slug, s);
    }
    if (i.file.version) s.versions.add(i.file.version);
    s.evidence.push(
      evidence(i.prov, "tokens", "m3-sass-vars", {
        location: i.prov.file,
        excerpt: `${i.file.designSystem ?? "?"} token database export, version ${i.file.version ?? "?"}; ${i.file.tokens.length} documented tokens`,
      }),
    );
    const names: string[] = [];
    const groups = new Set<string>();
    for (const t of i.file.tokens) {
      if (t.unsupported) {
        warnings.push(`${i.stem}: ${t.tokenName} has no value in source (generator placeholder); skipped`);
        continue;
      }
      if (s.tokens.has(t.tokenName)) {
        warnings.push(`${i.stem}: duplicate token ${t.tokenName} in set ${spec.slug}; kept first`);
        continue;
      }
      const { rawValue, references, unresolved } = latestValueToRaw(t, index);
      if (unresolved.length) warnings.push(`${i.stem}: ${t.tokenName} unresolved reference ${unresolved.join(", ")}`);
      names.push(t.tokenName);
      if (t.group) groups.add(t.group);
      s.tokens.set(t.tokenName, {
        name: t.tokenName,
        path: t.tokenName.split("."),
        cssVar: null,
        type: null,
        category: m3Category(t.tokenName, rawValue),
        tier: tierFor(t.tokenName),
        tierState: "inferred",
        rawValue,
        references,
        description: describe(t.description, t.group),
        deprecated: t.deprecated,
        location: `${i.prov.file}#L${t.line}`,
      });
    }
    namesByStem.set(i.stem, names);
    groupsByStem.set(i.stem, [...groups]);
  }
  const sets: NormalizedTokenSet[] = [];
  for (const s of sortBy([...bySet.values()], (x) => x.spec.slug)) {
    const tokens = sortBy([...s.tokens.values()], (t) => t.name);
    if (!tokens.length) continue;
    const prefix = commonPrefix(tokens.map((t) => t.name));
    const display = s.spec.slug === "m3-component-tokens" || s.spec.theme ? s.spec.name : prefix ? `M3 ${prefix} tokens` : s.spec.name;
    sets.push({
      slug: s.spec.slug,
      name: `${display}, M3 token DB ${[...s.versions].join("/") || "?"}`,
      theme: s.spec.theme,
      format: "scss",
      sourceUrl: s.sourceUrl,
      packageName: MW_PACKAGE,
      packageVersion: opts.version,
      license: APACHE_2,
      redistribution: "permitted",
      tokens,
      evidence: s.evidence,
    });
  }
  return { sets, warnings, namesByStem, groupsByStem };
}

/* -------------------------------- material-web -------------------------------- */

export interface V0192Input {
  prov: Prov;
  stem: string; // "md-sys-color", "md-comp-filled-button"
  file: V0192File;
}

export interface SupportedInput {
  prov: Prov;
  stem: string; // "md-comp-filled-button" (tokens/_md-comp-filled-button.scss)
  file: SupportedTokensFile;
}

export interface MwBuildResult {
  sets: NormalizedTokenSet[];
  warnings: string[];
  /** CSS custom property -> token name */
  byCssVar: Map<string, string>;
  /** token name -> raw value (for docs cross-checks) */
  rawByName: Map<string, unknown>;
}

const SYS_FUNCS: Record<string, { fn: string; theme: string | null }[]> = {
  "md-sys-color": [
    { fn: "values-light", theme: "light" },
    { fn: "values-dark", theme: "dark" },
  ],
};

export function buildMwTokenSets(v0192: V0192Input[], supported: SupportedInput[], opts: { version: string }): MwBuildResult {
  const warnings: string[] = [];
  const byCssVar = new Map<string, string>();
  const rawByName = new Map<string, unknown>();
  // module stem -> { cssPrefix, supported keys, wrapper prov } (prefer the wrapper with the same stem)
  const cssSupport = new Map<string, { prefix: string; keys: Set<string>; exact: boolean }>();
  const usedComp = new Set<string>();
  for (const w of sortBy(supported, (s) => s.stem)) {
    for (const mod of w.file.v0192Modules) {
      if (mod.startsWith("md-comp-")) usedComp.add(mod);
      if (!w.file.customPropertyPrefix || !w.file.supported) continue;
      const exact = mod === w.stem;
      const prev = cssSupport.get(mod);
      if (!prev || (exact && !prev.exact)) cssSupport.set(mod, { prefix: w.file.customPropertyPrefix, keys: new Set(w.file.supported), exact });
    }
  }
  const sets: NormalizedTokenSet[] = [];
  let compTokens: NormalizedToken[] = [];
  const compEvidence: EvidenceInput[] = [];
  let compSource: string | null = null;
  for (const input of sortBy(v0192, (i) => i.stem)) {
    const isComp = input.stem.startsWith("md-comp-");
    if (isComp && !usedComp.has(input.stem)) continue; // M3 tokens shipped but not implemented by a material-web component
    const prefix = v0192ModulePrefix(input.stem);
    const funcs = SYS_FUNCS[input.stem] ?? [{ fn: "values", theme: null }];
    const support = cssSupport.get(input.stem);
    for (const { fn, theme } of funcs) {
      const entries = input.file.functions[fn];
      if (!entries) {
        warnings.push(`${input.stem}: function ${fn}() not found`);
        continue;
      }
      const tokens: NormalizedToken[] = [];
      let composite = 0;
      for (const e of entries) {
        const name = `${prefix}.${e.key}`;
        let rawValue: unknown;
        let references: string[] = [];
        if (e.kind === "ref") {
          const target = `${v0192ModulePrefix(e.module!)}.${e.refKey}`;
          rawValue = `{${target}}`;
          references = [target];
        } else if (e.kind === "literal") rawValue = literal(e.literal!);
        else {
          composite++;
          continue;
        }
        const cssVar = support && support.keys.has(e.key) ? `--${support.prefix}-${e.key}` : null;
        if (cssVar && !byCssVar.has(cssVar)) byCssVar.set(cssVar, name);
        rawByName.set(name, rawValue);
        tokens.push({
          name,
          path: [...prefix.split("."), e.key],
          cssVar,
          type: null,
          category: m3Category(name, rawValue),
          tier: tierFor(name),
          tierState: "inferred",
          rawValue,
          references,
          description: cssVar ? `Exposed by @material/web as CSS custom property ${cssVar}.` : null,
          deprecated: false,
          location: `${input.prov.file}#L${e.line}`,
        });
      }
      if (composite) warnings.push(`${input.stem}.${fn}: ${composite} composite (multi-value) entries not extracted`);
      const ev = evidence(input.prov, "tokens", "mwc-sass-v0192", {
        location: `${input.prov.file}#${fn}()`,
        excerpt: `Google Material 3 design system version ${input.file.designSystemVersion ?? "?"}; ${tokens.length} simple entries in ${fn}()`,
      });
      if (isComp) {
        compTokens = compTokens.concat(tokens);
        compEvidence.push(ev);
        compSource ??= input.prov.sourceUrl.replace(/\/[^/]+$/, "");
        continue;
      }
      if (!tokens.length) continue;
      const base = input.stem.replace(/^md-/, "");
      sets.push({
        slug: slugify(`mw-${base}${theme ? `-${theme}` : ""}`),
        name: `Material Web ${base.replace(/-/g, " ")}${theme ? ` (${theme})` : ""} tokens, M3 ${input.file.designSystemVersion ?? ""}`.trim(),
        theme,
        format: "scss",
        sourceUrl: input.prov.sourceUrl,
        packageName: MW_PACKAGE,
        packageVersion: opts.version,
        license: APACHE_2,
        redistribution: "permitted",
        tokens: sortBy(tokens, (t) => t.name),
        evidence: [ev],
      });
    }
  }
  if (compTokens.length && compSource) {
    const seen = new Set<string>();
    const unique = compTokens.filter((t) => (seen.has(t.name) ? false : (seen.add(t.name), true)));
    sets.push({
      slug: "mw-component-tokens",
      name: "Material Web component tokens (M3 v0.192, md.comp.*)",
      theme: null,
      format: "scss",
      sourceUrl: compSource.replace("/blob/", "/tree/"),
      packageName: MW_PACKAGE,
      packageVersion: opts.version,
      license: APACHE_2,
      redistribution: "permitted",
      tokens: sortBy(unique, (t) => t.name),
      evidence: compEvidence,
    });
  }
  return { sets: sortBy(sets, (s) => s.slug), warnings, byCssVar, rawByName };
}
