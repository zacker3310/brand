/**
 * Merge antd fragments into NormalizedBundles (Ant Design, Ant Design Mobile). Pure, deterministic.
 */
import type {
  CoverageState,
  EvidenceInput,
  LicenseRef,
  NormalizedBundle,
  NormalizedComponent,
  NormalizedPattern,
  NormalizedSystemFacts,
  NormalizedToken,
  NormalizedTokenSet,
  TokenTier,
} from "@/lib/contracts";
import { excerpt, npmFileUrl } from "@/ingestion/http";
import { classifyComponentName, classifyPatternName } from "@/lib/taxonomy";
import { inferTokenCategory, inferTokenTier } from "@/lib/tokens/tree";
import { validateTokenValue } from "@/lib/tokens/validate";
import { slugify } from "@/lib/utils";
import { METHOD, PROFILES, SLUG_ANTD, SLUG_MOBILE, SPEC_PATTERN_TYPES, SPEC_PRINCIPLE_TYPE, blobUrl, npmPageUrl, treeUrl } from "./constants";
import type { AntdFragment, PkgInfo, Stamp } from "./fragments";
import { componentSlugFromLink, firstSentences, fmString, specSlugFromLink, type MdTable, type ParsedDoc } from "./markdown";
import { deriveFromProps, extractProps, type DocProp } from "./props";
import { antdKebab, cssVarRefs, type Literal } from "./tokens";

type Ev = EvidenceInput;
type F<T extends AntdFragment["t"]> = Extract<AntdFragment, { t: T }>;

export interface NormalizeOptions {
  limit?: number;
  log?: (msg: string) => void;
}

/* ---------------------------------- helpers ---------------------------------- */

const ev = (
  stamp: Stamp,
  field: string,
  method: string,
  o: { location?: string | null; excerpt?: string | null; state?: Ev["state"]; confidence?: number; title?: string | null; url?: string } = {},
): Ev => ({
  field,
  sourceUrl: o.url ?? stamp.evidenceUrl,
  sourceTitle: o.title ?? null,
  retrievedAt: stamp.retrievedAt,
  contentHash: stamp.hash,
  extractionMethod: method,
  location: o.location ?? stamp.file,
  excerpt: excerpt(o.excerpt ?? null),
  state: o.state ?? "verified",
  confidence: o.confidence ?? 0.9,
});

const uniq = <T,>(xs: T[]) => [...new Set(xs)];
const byType = <T extends AntdFragment["t"]>(frags: AntdFragment[], t: T) => frags.filter((f): f is F<T> => f.t === t);

function mitLicense(pkg: PkgInfo | null, lic: F<"license"> | null): LicenseRef | null {
  if (!pkg?.license || pkg.license.toUpperCase() !== "MIT") return null;
  return {
    slug: "mit",
    spdxId: "MIT",
    name: "MIT License",
    url: lic?.stamp.evidenceUrl ?? null,
    isOpenSource: true,
    redistribution: "permitted",
    notes: `${lic?.copyright ? `${lic.copyright}. ` : ""}Redistribution permitted with the copyright and permission notice retained.`,
  };
}

/** Normalized comparison of a CSS value and a JS token value ("8px" ~ 8, "#FFF" ~ "#ffffff"). */
export function sameTokenValue(a: unknown, b: unknown): boolean {
  const n = (v: unknown): string | null => {
    if (typeof v === "number") return String(v);
    if (typeof v !== "string") return null;
    let s = v.replace(/\s+/g, "").toLowerCase();
    const px = /^(-?\d+(?:\.\d+)?)px$/.exec(s);
    if (px) s = String(Number(px[1]));
    const hex3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(s);
    if (hex3) s = `#${hex3[1]}${hex3[1]}${hex3[2]}${hex3[2]}${hex3[3]}${hex3[3]}`;
    return s;
  };
  const x = n(a);
  return x !== null && x === n(b);
}

/** Declared token-meta type, kept only when it validates against the stored raw value. */
function declaredType(metaType: string | null, raw: unknown): string | null {
  const t = (metaType ?? "").trim().toLowerCase();
  if (!["number", "string", "boolean", "color"].includes(t)) return null;
  if (t === "color" && typeof raw !== "string") return null;
  return validateTokenValue(t, raw).ok ? t : null;
}

function mkToken(o: {
  name: string;
  path: string[];
  cssVar: string | null;
  type: string | null;
  rawValue: unknown;
  references: string[];
  description: string | null;
  location: string;
  tier: TokenTier | null;
  tierState: "verified" | "inferred";
  deprecated?: boolean;
}): NormalizedToken {
  const { category } = inferTokenCategory(o.name, o.type, o.rawValue);
  return {
    name: o.name,
    path: o.path,
    cssVar: o.cssVar,
    type: o.type,
    category,
    tier: o.tier,
    tierState: o.tierState,
    rawValue: o.rawValue,
    references: o.references,
    description: o.description ? o.description.slice(0, 600) : null,
    deprecated: o.deprecated ?? false,
    location: o.location,
  };
}

const humanize = (s: string) => s.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

/* ----------------------------- property assembly ----------------------------- */

function toProperties(props: DocProp[], sourceUrl: string | null): NormalizedComponent["properties"] {
  const out: NormalizedComponent["properties"] = [];
  const seen = new Set<string>();
  for (const p of props) {
    const name = p.owner ? `${p.owner}.${p.name}` : p.name;
    if (seen.has(name)) continue;
    seen.add(name);
    const desc = p.description ? `${p.description}${p.version ? ` (version: ${p.version})` : ""}` : p.version ? `Version: ${p.version}` : null;
    out.push({
      implementation: "react",
      name,
      type: p.type,
      defaultValue: p.defaultValue,
      required: null,
      deprecated: p.deprecated,
      description: desc ? desc.slice(0, 600) : null,
      allowedValues: p.allLiteral && p.literals.length >= 2 ? p.literals : null,
      sourceUrl: sourceUrl ?? undefined,
    });
  }
  return out;
}

function headingOwner(t: MdTable, skip: RegExp): string | null {
  for (let i = t.headings.length - 1; i >= 0; i--) {
    const h = t.headings[i]!;
    if (h.depth < 2) break;
    if (skip.test(h.text)) continue;
    return h.text;
  }
  return null;
}

const A11Y_COVERAGE_KEYS = ["roles", "screenReader", "focusManagement", "wcagCriteria", "ariaPattern"] as const;

function accessibilityFrom(doc: ParsedDoc, props: DocProp[], name: string, docsUrl: string | null) {
  const kbProp = props.find((p) => p.owner === null && p.name === "keyboard" && /\besc\b/i.test(p.description ?? ""));
  const keyboard = kbProp
    ? [{ keys: "Esc", action: `Closes the ${name} while the \`keyboard\` prop is enabled (documented default: ${kbProp.defaultValue ?? "not stated"}).` }]
    : [];
  const notes = doc.a11yNotes;
  if (!notes.length && !keyboard.length) return { accessibility: null, kbProp: null };
  const coverage: Record<string, CoverageState> = {
    guidance: notes.length ? "documented" : "not-documented",
    keyboard: keyboard.length ? "documented" : "not-documented",
  };
  for (const k of A11Y_COVERAGE_KEYS) coverage[k] = "not-documented";
  return {
    accessibility: {
      ariaPattern: null,
      roles: null,
      keyboard: keyboard.length ? keyboard : null,
      guidance: notes.length ? notes.join(" ").slice(0, 1200) : null,
      screenReader: null,
      focusManagement: null,
      wcagCriteria: null,
      docsUrl: docsUrl ?? undefined,
      coverage,
    },
    kbProp,
  };
}

/**
 * Names where the shared taxonomy's match is wrong for the documented behavior. `slug` is the taxonomy
 * type that fits the documented description (still "inferred"); null leaves the component unclassified.
 */
export const CLASSIFICATION_OVERRIDES: Record<string, Record<string, { slug: string | null; why: string }>> = {
  [SLUG_ANTD]: {
    Anchor: { slug: "anchor-navigation", why: "documented as hyperlinks to scroll on one page; the 'anchor' alias resolves to link first" },
  },
  [SLUG_MOBILE]: {
    Popup: { slug: "sheet", why: "documented as sliding a content area out from the screen edge; 'popup' alias maps to popover" },
    Stepper: { slug: "number-field", why: "documented as increasing/decreasing a numeric value; 'stepper' alias maps to the step indicator" },
    ImageUploader: { slug: "file-upload", why: "image upload control; the head noun match is unrelated" },
    PickerView: { slug: "select", why: "inline panel of Picker (taxonomy alias 'picker'); the 'view' head noun maps to box" },
    CalendarPickerView: { slug: "date-picker", why: "inline panel of CalendarPicker (taxonomy alias 'calendar picker'); the 'view' head noun maps to box" },
    CascaderView: { slug: null, why: "inline cascading option panel; the 'view' head noun match to box is wrong" },
    PageIndicator: { slug: null, why: "carousel page dots; the 'indicator' token match to badge is wrong" },
    NumberKeyboard: { slug: null, why: "on-screen numeric keypad; the 'keyboard' token match to kbd is wrong" },
    ImageViewer: { slug: null, why: "full-screen image preview; no matching taxonomy type" },
  },
};

export function classify(systemSlug: string, name: string): { canonicalType: string | null; classification: NormalizedComponent["classification"] } {
  const o = CLASSIFICATION_OVERRIDES[systemSlug]?.[name];
  if (o) return o.slug ? { canonicalType: o.slug, classification: { state: "inferred", method: `adapter-override:${o.slug}`, confidence: 0.7 } } : { canonicalType: null, classification: null };
  const c = classifyComponentName(name);
  if (!c) return { canonicalType: null, classification: null };
  return { canonicalType: c.slug, classification: { state: "inferred", method: `taxonomy:${c.method}`, confidence: c.confidence } };
}

function variantsStatesSizes(props: DocProp[], sourceUrl: string, file: string) {
  const d = deriveFromProps(props);
  const variants: NormalizedComponent["variants"] = [];
  const vseen = new Set<string>();
  for (const v of d.variants) {
    const k = `${v.axis}|${v.name}`;
    if (vseen.has(k)) continue;
    vseen.add(k);
    variants.push({ axis: v.axis, name: v.name, description: null, sourceUrl, location: `${v.prop.file ?? file}#L${v.prop.line} (prop \`${v.prop.name}\`)` });
  }
  const states: NormalizedComponent["states"] = d.states.map((s) => ({
    name: s.name,
    canonical: s.canonical,
    description: `Documented ${s.how} (${s.prop.type ?? "type n/a"}).`.slice(0, 600),
    sourceUrl,
  }));
  return { variants, states, sizes: d.sizes?.values ?? null };
}

/* ============================================================================ */
/* Ant Design                                                                    */
/* ============================================================================ */

interface AntdTokenResult {
  sets: NormalizedTokenSet[];
  globalNames: Set<string>;
  componentTokens: Map<string, string[]>; // token.json component key -> token names in the component set
}

function buildAntdTokens(frags: AntdFragment[], pkg: PkgInfo | null, license: LicenseRef | null, log: (m: string) => void): AntdTokenResult {
  const meta = byType(frags, "token-meta")[0] ?? null;
  const tj = byType(frags, "token-json")[0] ?? null;
  const css = byType(frags, "dist-css")[0] ?? null;
  const seed = byType(frags, "seed-js")[0] ?? null;
  const alias = byType(frags, "alias-js")[0] ?? null;
  const preset = byType(frags, "preset-dts")[0] ?? null;
  const styleRefs = byType(frags, "style-refs");
  const out: AntdTokenResult = { sets: [], globalNames: new Set(), componentTokens: new Map() };
  if (!meta || !pkg) return out;
  const scope = css?.css.scope ?? null;
  const cssGlobal = css?.css.global ?? {};
  const cssComp = css?.css.component ?? {};
  const cssLoc = (v: string) => `dist/antd.css ${scope ?? ""} { ${v} }`.replace(/\s+/g, " ");

  /* ------------------------------ global tokens ------------------------------ */
  const layers: Record<string, NormalizedToken[]> = { seed: [], map: [], alias: [] };
  const used: Record<string, Set<string>> = { css: new Set(), seed: new Set(), alias: new Set() };
  const metaNames = new Set(meta.meta.global.map((g) => g.name));
  const skipped: string[] = [];
  const globalValue = (name: string): string | undefined => cssGlobal[`--ant-${antdKebab(name)}`];
  for (const g of meta.meta.global) {
    const layer = g.source === "seed" || g.source === "map" || g.source === "alias" ? g.source : null;
    if (!layer) {
      skipped.push(`${g.name} (layer ${g.source})`);
      continue;
    }
    const cv = `--ant-${antdKebab(g.name)}`;
    const cssVal = cssGlobal[cv];
    let raw: Literal | undefined;
    let location = "";
    let refs: string[] = [];
    let cssVar: string | null = null;
    if (cssVal !== undefined && cssVal !== "") {
      raw = cssVal;
      cssVar = cv;
      location = cssLoc(cv);
      used.css!.add(g.name);
      const d = alias?.entries[g.name];
      // Alias derivations that are plain references (`colorTextHeading: mergedToken.colorText`), confirmed by equal rendered values.
      if (layer === "alias" && d?.kind === "ref" && d.target !== g.name && metaNames.has(d.target) && sameTokenValue(cssVal, globalValue(d.target))) {
        refs = [d.target];
        used.alias!.add(g.name);
      }
    } else if (layer === "seed" && seed && seed.values[g.name] !== undefined && seed.values[g.name] !== "") {
      raw = seed.values[g.name]!;
      location = `es/theme/themes/seed.js#seedToken.${g.name}`;
      used.seed!.add(g.name);
    } else if (alias?.entries[g.name]) {
      const d = alias.entries[g.name]!;
      location = `es/theme/util/alias.js#aliasToken.${g.name}`;
      if (d.kind === "const") {
        raw = d.value;
        if (d.name !== g.name && metaNames.has(d.name)) refs = [d.name];
      } else if (d.kind === "const-offset" && metaNames.has(d.name)) {
        raw = `{${d.name}} ${d.offset < 0 ? "-" : "+"} ${Math.abs(d.offset)}`;
        refs = [d.name];
      } else if (d.kind === "literal") raw = d.value;
      else if (d.kind === "ref" && metaNames.has(d.target)) {
        raw = `{${d.target}}`;
        refs = [d.target];
      }
      if (raw !== undefined) used.alias!.add(g.name);
    }
    if (raw === undefined) {
      skipped.push(g.name);
      continue;
    }
    layers[layer]!.push(
      mkToken({
        name: g.name,
        path: [layer, g.name],
        cssVar,
        type: refs.length && typeof raw === "string" && raw.includes("{") ? null : declaredType(g.type, raw),
        rawValue: raw,
        references: refs,
        description: g.descEn,
        location,
        tier: layer === "seed" ? "primitive" : "semantic",
        tierState: "inferred",
      }),
    );
  }
  if (skipped.length) log(`token-meta global tokens without a static value (omitted): ${skipped.join(", ")}`);

  // Preset color palettes (MapToken extends ColorPalettes: `${preset}${1..10}`), values from dist/antd.css.
  let paletteCount = 0;
  if (preset?.palettes) {
    for (const color of preset.presets) {
      for (let i = 1; i <= 10; i++) {
        const cv = `--ant-${color}-${i}`;
        const v = cssGlobal[cv];
        if (v === undefined || v === "") continue;
        const name = `${color}${i}`;
        if (metaNames.has(name)) continue;
        paletteCount++;
        layers.map!.push(
          mkToken({ name, path: ["map", name], cssVar: cv, type: null, rawValue: v, references: [], description: null, location: cssLoc(cv), tier: "primitive", tierState: "inferred" }),
        );
      }
    }
  }

  const tokenMetaUrl = npmFileUrl(pkg.name, pkg.version, "es/version/token-meta.json");
  const layerInfo: Record<string, { slug: string; name: string }> = {
    seed: { slug: "seed-tokens", name: "Seed tokens (default algorithm)" },
    map: { slug: "map-tokens", name: "Map tokens (default algorithm)" },
    alias: { slug: "alias-tokens", name: "Alias tokens (default algorithm)" },
  };
  for (const layer of ["seed", "map", "alias"] as const) {
    const tokens = layers[layer]!.sort((a, b) => a.name.localeCompare(b.name));
    if (!tokens.length) continue;
    for (const t of tokens) out.globalNames.add(t.name);
    const evidence: Ev[] = [
      ev(meta.stamp, "tokens", METHOD.tokenMeta, {
        location: "es/version/token-meta.json#/global",
        excerpt: `${tokens.length} ${layer} tokens; names, descriptions and layer ("source": "${layer}") from ${pkg.name}@${pkg.version} token-meta.json`,
        confidence: 0.95,
      }),
    ];
    const fromCss = tokens.filter((t) => t.cssVar).length;
    if (css && fromCss)
      evidence.push(ev(css.stamp, "tokens.values", METHOD.cssVars, { location: `dist/antd.css ${scope}`, excerpt: `${fromCss} values from --ant-* custom properties of the default theme scope ${scope}`, confidence: 0.9 }));
    if (layer === "seed" && seed && tokens.some((t) => t.location?.startsWith("es/theme/themes/seed.js")))
      evidence.push(ev(seed.stamp, "tokens.values", METHOD.seedJs, { location: "es/theme/themes/seed.js#seedToken", excerpt: `seedToken literals for tokens not rendered as CSS variables`, confidence: 0.9 }));
    if (layer === "alias" && alias && tokens.some((t) => t.location?.startsWith("es/theme/util/alias.js") || t.references.length))
      evidence.push(ev(alias.stamp, "tokens.references", METHOD.aliasJs, { location: "es/theme/util/alias.js#formatToken", excerpt: `aliasToken entries: plain references (mergedToken.x), screen-size constants and offsets`, confidence: 0.85 }));
    if (layer === "map" && preset && paletteCount)
      evidence.push(ev(preset.stamp, "tokens.palettes", METHOD.cssVars, { location: "es/theme/interface/presetColors.d.ts#ColorPalettes", excerpt: `${paletteCount} palette tokens (\`\${preset}\${1..10}\`, typed by ColorPalettes) valued from dist/antd.css`, confidence: 0.85 }));
    out.sets.push({
      slug: layerInfo[layer]!.slug,
      name: layerInfo[layer]!.name,
      theme: "light",
      format: "css-vars",
      sourceUrl: tokenMetaUrl,
      packageName: pkg.name,
      packageVersion: pkg.version,
      license,
      redistribution: license ? "permitted" : "unknown",
      tokens,
      evidence,
    });
  }

  /* ----------------------------- component tokens ----------------------------- */
  if (tj) {
    const tjByLower = new Map(Object.keys(tj.entries).map((k) => [k.toLowerCase(), k]));
    const merged = new Map<string, Map<string, { token: string; type: string | null; descEn: string | null }>>();
    for (const [mk, list] of Object.entries(meta.meta.components)) {
      const key = tjByLower.get(mk.toLowerCase()) ?? mk;
      const m = merged.get(key) ?? new Map();
      for (const t of list) if (!m.has(t.token)) m.set(t.token, t);
      merged.set(key, m);
    }
    const refsByDir = new Map(styleRefs.map((s) => [s.component, s]));
    const tokens: NormalizedToken[] = [];
    const missingValues: string[] = [];
    const usedRefFiles = new Set<F<"style-refs">>();
    let withRefs = 0;
    let withCss = 0;
    for (const key of [...merged.keys()].sort()) {
      const entry = tj.entries[key];
      const sr = refsByDir.get(antdKebab(key)) ?? null;
      const names: string[] = [];
      for (const t of [...merged.get(key)!.values()].sort((a, b) => a.token.localeCompare(b.token))) {
        const v = entry?.component[t.token];
        if (v === undefined || v === "") {
          missingValues.push(`${key}.${t.token}`);
          continue;
        }
        const cssVar = [`--ant-${antdKebab(key)}-${antdKebab(t.token)}`, `--ant-${key.toLowerCase()}-${antdKebab(t.token)}`].find((c) => c in cssComp) ?? null;
        if (cssVar) withCss++;
        const target = sr?.refs[t.token];
        const refs = target && out.globalNames.has(target) && sameTokenValue(v, globalValue(target)) ? [target] : [];
        if (refs.length) {
          withRefs++;
          usedRefFiles.add(sr!);
        }
        const name = `${key}.${t.token}`;
        names.push(name);
        tokens.push(
          mkToken({
            name,
            path: [key, t.token],
            cssVar,
            type: declaredType(t.type, v),
            rawValue: v,
            references: refs,
            description: t.descEn,
            location: `es/version/token.json#/${key}/component/${t.token}`,
            tier: "component",
            tierState: "verified",
          }),
        );
      }
      out.componentTokens.set(key, names);
    }
    if (missingValues.length) log(`documented component tokens without a default value in token.json (omitted): ${missingValues.join(", ")}`);
    tokens.sort((a, b) => a.name.localeCompare(b.name));
    if (tokens.length) {
      const evidence: Ev[] = [
        ev(meta.stamp, "tokens", METHOD.tokenMeta, { location: "es/version/token-meta.json#/components", excerpt: `${tokens.length} documented component tokens (names, types, descriptions) across ${merged.size} components`, confidence: 0.95 }),
        ev(tj.stamp, "tokens.values", METHOD.tokenJson, { location: "es/version/token.json#/<Component>/component", excerpt: `Default component token values (default algorithm) from ${pkg.name}@${pkg.version} token.json`, confidence: 0.95 }),
      ];
      if (css && withCss) evidence.push(ev(css.stamp, "tokens.cssVar", METHOD.cssVars, { location: `dist/antd.css ${scope}.ant-*`, excerpt: `${withCss} component tokens rendered as --ant-<component>-<token> custom properties`, confidence: 0.9 }));
      for (const sr of [...usedRefFiles].sort((a, b) => a.stamp.file.localeCompare(b.stamp.file)))
        evidence.push(ev(sr.stamp, "tokens.references", METHOD.styleRefs, { location: `${sr.stamp.file}#prepareComponentToken`, excerpt: `Component tokens assigned directly from global tokens (token.x) in prepareComponentToken`, confidence: 0.85 }));
      out.sets.push({
        slug: "component-tokens",
        name: "Component tokens (default algorithm)",
        theme: "light",
        format: "json",
        sourceUrl: npmFileUrl(pkg.name, pkg.version, "es/version/token.json"),
        packageName: pkg.name,
        packageVersion: pkg.version,
        license,
        redistribution: license ? "permitted" : "unknown",
        tokens,
        evidence,
      });
      if (withRefs === 0 && styleRefs.length) log("no component token -> global token references confirmed");
    }
  }
  return out;
}

export function normalizeAntd(systemSlug: string, frags: AntdFragment[], opts: NormalizeOptions = {}): NormalizedBundle {
  const log = opts.log ?? (() => {});
  const profile = PROFILES[SLUG_ANTD]!;
  const pkgF = byType(frags, "pkg")[0] ?? null;
  const pkg = pkgF?.pkg ?? null;
  const lic = byType(frags, "license")[0] ?? null;
  const license = mitLicense(pkg, lic);
  const sitemap = byType(frags, "sitemap")[0] ?? null;
  const idx = byType(frags, "index-dts")[0] ?? null;
  const tjF = byType(frags, "token-json")[0] ?? null;
  const demos = byType(frags, "demo");
  const copyright = lic?.copyright ?? "Copyright (c) 2015-present Ant UED";

  const tok = buildAntdTokens(frags, pkg, license, log);

  /* -------------------------------- components -------------------------------- */
  const docFrags = byType(frags, "component-doc").sort((a, b) => a.order - b.order || a.slug.localeCompare(b.slug));
  const selected = opts.limit && opts.limit > 0 ? docFrags.slice(0, opts.limit) : docFrags;
  const slugs = new Set(selected.map((f) => f.slug));
  const components: NormalizedComponent[] = [];
  for (const f of selected) {
    const c = buildAntdComponent(f, { systemSlug, pkg, slugs, idx, tjF, tok, demos: demos.filter((d) => d.slug === f.slug), sitemap, copyright, origin: profile.docsOrigin });
    if (c) components.push(c);
  }
  components.sort((a, b) => a.slug.localeCompare(b.slug));

  /* --------------------------------- patterns --------------------------------- */
  const specs = byType(frags, "spec-doc").sort((a, b) => a.slug.localeCompare(b.slug));
  const designUrlOwners = new Map<string, string[]>();
  for (const f of selected) {
    const du = fmString(f.doc.frontmatter, "designUrl");
    const s = du ? specSlugFromLink(du, profile.docsOrigin) : null;
    if (s) designUrlOwners.set(s, [...(designUrlOwners.get(s) ?? []), f.slug]);
  }
  const patterns: NormalizedPattern[] = [];
  for (const s of specs) {
    const fm = s.doc.frontmatter;
    const group = fmString(fm, "group") ?? "";
    const type = (fmString(fm, "type") ?? "").toLowerCase();
    if (!/^design patterns/i.test(group) || !SPEC_PATTERN_TYPES.has(type)) continue;
    const name = fmString(fm, "title") ?? humanize(s.slug);
    const description = firstSentences(s.doc.lead ?? Object.values(s.doc.sectionText)[0] ?? null, 280);
    const linked = s.doc.links.map((l) => componentSlugFromLink(l, profile.docsOrigin)).filter((x): x is string => !!x);
    const componentSlugs = uniq([...linked, ...(designUrlOwners.get(s.slug) ?? [])].filter((x) => slugs.has(x))).sort();
    const cls = classifyPatternName(name);
    patterns.push({
      slug: s.slug,
      name,
      description,
      docsUrl: s.docsUrl,
      canonicalType: cls?.slug ?? null,
      classification: cls ? { state: "inferred", method: `taxonomy:${cls.method}`, confidence: cls.confidence } : null,
      componentSlugs,
      coverage: {
        description: description ? "documented" : "not-documented",
        components: componentSlugs.length ? "documented" : linked.length ? "not-extracted" : "not-documented",
      },
      evidence: [
        ev(s.stamp, "*", METHOD.specMd, {
          title: `Ant Design spec: ${name}`,
          location: `${s.stamp.file} (frontmatter group "${group}", type "${fmString(fm, "type")}")`,
          excerpt: description,
          confidence: 0.9,
        }),
        ...(componentSlugs.length
          ? [ev(s.stamp, "componentSlugs", METHOD.specMd, { location: `${s.stamp.file} links to /components/* and component designUrl frontmatter`, excerpt: `Components: ${componentSlugs.join(", ")}`, confidence: 0.85 })]
          : []),
      ],
    });
    if (opts.limit && patterns.length >= opts.limit) break;
  }
  patterns.sort((a, b) => a.slug.localeCompare(b.slug));

  /* ----------------------------------- facts ----------------------------------- */
  const facts = buildAntdFacts(pkgF, specs);
  return { systemSlug, components, tokenSets: tok.sets, patterns, facts };
}

interface AntdBuildCtx {
  systemSlug: string;
  pkg: PkgInfo | null;
  slugs: Set<string>;
  idx: F<"index-dts"> | null;
  tjF: F<"token-json"> | null;
  tok: AntdTokenResult;
  demos: F<"demo">[];
  sitemap: F<"sitemap"> | null;
  copyright: string;
  origin: string;
}

function buildAntdComponent(f: F<"component-doc">, a: AntdBuildCtx): NormalizedComponent | null {
  const d = f.doc;
  const fm = d.frontmatter;
  const profile = PROFILES[SLUG_ANTD]!;
  const name = fmString(fm, "title") ?? d.h1 ?? humanize(f.slug);
  const file = f.stamp.file;
  const sourceUrl = f.docsUrl ?? f.stamp.evidenceUrl;
  const evidence: Ev[] = [];
  const coverage: Record<string, CoverageState> = {};
  const group = fmString(fm, "group");
  const ref = a.pkg?.ref ?? "master";

  // API props (## API section incl. H3 sub-sections, plus "## <Name>.<Sub>" sections such as Form.Item).
  const inScope = (t: MdTable) => t.headings.some((h) => h.depth === 2 && (/^api$/i.test(h.text) || h.text.startsWith(`${name}.`)));
  const props = extractProps(d.tables, {
    mainNames: [name, "API", "Common API", `${name} props`, "Props"],
    scope: inScope,
    ownerOf: (t) => headingOwner(t, /^(api|props?)$/i),
  });
  const properties = toProperties(props, sourceUrl);
  const firstApi = d.tables.find(inScope);
  const hasApiSection = d.headings.some((h) => h.depth === 2 && /^api$/i.test(h.text));
  coverage.properties = properties.length ? "documented" : hasApiSection ? "not-extracted" : "not-documented";

  evidence.push(
    ev(f.stamp, "*", METHOD.docsMd, {
      title: `${name} — ${profile.repo.name} docs source`,
      location: file,
      excerpt: `${name}${group ? ` (group: ${group})` : ""}; ${properties.length} API props; ${d.demos.filter((x) => !x.debug).length} demos${fm.tag ? `; tag ${String(fm.tag)}` : ""}`,
      confidence: 0.95,
    }),
  );

  // Description
  const description = firstSentences(fmString(fm, "description") ?? null, 280) ?? firstSentences(d.sectionText["When To Use"] ?? d.sectionText["When to use"] ?? d.lead ?? null, 280);
  coverage.description = description ? "documented" : "not-documented";
  if (description) evidence.push(ev(f.stamp, "description", METHOD.docsMd, { location: fmString(fm, "description") ? `${file}#frontmatter.description` : `${file} (When To Use)`, excerpt: description }));

  if (properties.length && firstApi) evidence.push(ev(f.stamp, "properties", METHOD.apiTable, { location: `${firstApi.file ?? file}#L${firstApi.line}`, excerpt: `${properties.length} props from API tables (Property | Description | Type | Default | Version)`, confidence: 0.9 }));
  for (const st of f.embedded ?? []) evidence.push(ev(st, "properties", METHOD.apiTable, { location: `${st.file} (embedded in ${file} API section)`, excerpt: `Shared API table included via <embed src>`, confidence: 0.9 }));

  // Variants / sizes / states
  const { variants, states, sizes } = variantsStatesSizes(props, sourceUrl, file);
  coverage.variants = variants.length ? "documented" : properties.length ? "not-documented" : "not-extracted";
  coverage.sizes = sizes?.length ? "documented" : properties.length ? "not-documented" : "not-extracted";
  coverage.states = states.length ? "inferred" : properties.length ? "not-documented" : "not-extracted";
  if (variants.length) evidence.push(ev(f.stamp, "variants", METHOD.apiTable, { location: `${file} API table`, excerpt: `Variant props: ${uniq(variants.map((v) => v.axis)).join(", ")}`, confidence: 0.85 }));
  if (sizes?.length) evidence.push(ev(f.stamp, "sizes", METHOD.apiTable, { location: `${file} API table (size)`, excerpt: `size: ${sizes.join(" | ")}`, confidence: 0.9 }));
  if (states.length) evidence.push(ev(f.stamp, "states", METHOD.apiTable, { location: `${file} API table`, excerpt: `States implied by props: ${states.map((s) => s.name).join(", ")}`, state: "inferred", confidence: 0.7 }));

  // Classification, lifecycle
  const { canonicalType, classification } = classify(a.systemSlug, name);
  const lifecycle: NormalizedComponent["lifecycle"] = fm.deprecated === true ? "deprecated" : "unknown";

  // Frameworks: React (antd is React-only). Import names from es/index.d.ts.
  const exported = a.idx?.exports[f.slug] ?? [];
  const altPkg = !exported.length ? (d.installs.find((x) => x.startsWith("@ant-design/")) ?? null) : null;
  const frameworks: NormalizedComponent["frameworks"] = [
    { slug: "react", packageName: exported.length ? (a.pkg?.name ?? "antd") : altPkg, importName: exported.length ? exported.join(", ") : null, sourceUrl: f.docsUrl ?? f.stamp.evidenceUrl },
  ];
  if (exported.length && a.idx) evidence.push(ev(a.idx.stamp, "frameworks", METHOD.indexDts, { location: "es/index.d.ts", excerpt: `export { default as ${exported.join(", ")} } from './${f.slug}'` }));
  else if (altPkg) evidence.push(ev(f.stamp, "frameworks", METHOD.docsMd, { location: `${file} (install instructions)`, excerpt: `Installed from ${altPkg}` }));
  coverage.frameworks = exported.length || altPkg ? "documented" : "inferred";

  // Accessibility
  const { accessibility, kbProp } = accessibilityFrom(d, props, name, f.docsUrl);
  coverage.accessibility = accessibility ? "documented" : "not-documented";
  coverage.keyboard = accessibility?.keyboard?.length ? "documented" : "not-documented";
  if (accessibility) {
    evidence.push(
      ev(f.stamp, "accessibility", METHOD.docsMd, {
        location: d.a11yNotes.length ? `${file} (prose)` : `${file} API table: keyboard`,
        excerpt: d.a11yNotes[0] ?? `keyboard: ${kbProp?.description ?? ""}`,
        confidence: 0.8,
      }),
    );
    if (kbProp) evidence.push(ev(f.stamp, "keyboard", METHOD.apiTable, { location: `${file}#L${kbProp.line} (prop keyboard)`, excerpt: `keyboard: ${kbProp.description} (default ${kbProp.defaultValue ?? "n/a"})`, confidence: 0.8 }));
  }

  // Responsive guidance: not parsed into prose; record whether the page discusses it.
  coverage.responsive = d.mentionsResponsive ? "not-extracted" : "not-documented";

  // Examples: docs demo anchors + first demo source (MIT, attributed).
  const examples: NormalizedComponent["examples"] = [];
  const exSeen = new Set<string>();
  for (const demo of d.demos) {
    if (demo.debug) continue;
    const base = demo.src.replace(/^.*\//, "").replace(/\.(tsx|jsx|ts|js)$/, "");
    const slug = `demo-${slugify(base) || "example"}`;
    if (exSeen.has(slug) || examples.length >= 30) continue;
    exSeen.add(slug);
    examples.push({
      slug,
      title: demo.title ?? humanize(base),
      kind: "docs-link",
      url: f.docsUrl ? `${f.docsUrl}#${f.slug}-demo-${base}` : blobUrl(profile, ref, `components/${f.slug}/${demo.src.replace(/^\.\//, "")}`),
    });
  }
  for (const dm of a.demos.sort((x, y) => x.demo.localeCompare(y.demo))) {
    if (!dm.code) continue;
    const slug = `code-${slugify(dm.demo) || "demo"}`;
    if (exSeen.has(slug)) continue;
    exSeen.add(slug);
    examples.push({
      slug,
      title: dm.title ?? humanize(dm.demo),
      kind: "code-snippet",
      language: "tsx",
      code: dm.code,
      url: dm.stamp.evidenceUrl,
      attribution: `${dm.stamp.file} from ${profile.repo.owner}/${profile.repo.name}@${ref}. MIT License, ${a.copyright}.`,
    });
    evidence.push(ev(dm.stamp, "examples", METHOD.demo, { location: dm.stamp.file, excerpt: `Demo source "${dm.title ?? dm.demo}" (MIT)`, confidence: 0.95 }));
  }
  coverage.examples = examples.length ? "documented" : "not-documented";
  if (examples.some((e) => e.kind === "docs-link")) evidence.push(ev(f.stamp, "examples.docs", METHOD.docsMd, { location: `${file} (## Examples <code src>)`, excerpt: `${examples.filter((e) => e.kind === "docs-link").length} demo links` }));

  // Relationships: in-content links to other component pages.
  const rel = uniq(d.links.map((l) => componentSlugFromLink(l, a.origin)).filter((x): x is string => !!x && x !== f.slug && a.slugs.has(x))).sort();
  const relationships = rel.map((t) => ({ kind: "see-also", targetSlug: t, targetType: null }));
  coverage.relationships = relationships.length ? "documented" : "not-extracted";
  if (relationships.length) evidence.push(ev(f.stamp, "relationships", METHOD.docsMd, { location: `${file} links to /components/*`, excerpt: `Links to: ${rel.join(", ")}`, confidence: 0.8 }));

  // Token usages: token.json global tokens used + documented component tokens of the design-token table component(s).
  const keys = d.tokenTableComponents.length ? d.tokenTableComponents : [];
  const usages: NormalizedComponent["tokenUsages"] = [];
  const useSeen = new Set<string>();
  for (const key of keys) {
    const entry = a.tjF?.entries[key];
    const names = [...(entry?.global ?? []).filter((g) => a.tok.globalNames.has(g)), ...(a.tok.componentTokens.get(key) ?? [])];
    for (const n of names) {
      if (useSeen.has(n)) continue;
      useSeen.add(n);
      usages.push({ tokenName: n, property: null });
    }
  }
  usages.sort((x, y) => x.tokenName.localeCompare(y.tokenName));
  coverage.tokens = usages.length ? "documented" : keys.length ? "not-extracted" : "not-documented";
  if (usages.length && a.tjF) evidence.push(ev(a.tjF.stamp, "tokenUsages", METHOD.tokenJson, { location: `es/version/token.json#/${keys.join(",")}`, excerpt: `${usages.length} tokens: global tokens used by ${keys.join(", ")} + its component tokens`, confidence: 0.9 }));

  if (f.docsUrl && a.sitemap) evidence.push(ev(a.sitemap.stamp, "docsUrl", METHOD.sitemap, { location: "sitemap.xml", excerpt: `Sitemap lists ${f.docsUrl.replace(/\/$/, "")}` }));

  return {
    slug: f.slug,
    name,
    aliases: [],
    description,
    docsUrl: f.docsUrl,
    sourceCodeUrl: treeUrl(profile, ref, `components/${f.slug}`),
    lifecycle,
    canonicalType,
    classification,
    frameworks,
    variants,
    states,
    sizes,
    properties,
    accessibility,
    examples,
    relationships,
    tokenUsages: usages.slice(0, 600),
    responsiveGuidance: null,
    coverage,
    evidence,
  };
}

function buildAntdFacts(pkgF: F<"pkg"> | null, specs: F<"spec-doc">[]): NormalizedSystemFacts | null {
  if (!pkgF) return null;
  const pkg = pkgF.pkg;
  const evidence: Ev[] = [
    ev(pkgF.stamp, "latestVersion", METHOD.npm, { url: npmPageUrl(pkg.name, pkg.version), title: `${pkg.name} on npm`, location: "dist-tags.latest", excerpt: `latest ${pkg.version}${pkg.publishedAt ? ` published ${pkg.publishedAt}` : ""}; license ${pkg.license ?? "n/a"}`, confidence: 0.95 }),
  ];
  if (pkg.publishedAt) evidence.push(ev(pkgF.stamp, "latestReleaseAt", METHOD.npm, { url: npmPageUrl(pkg.name, pkg.version), location: `time["${pkg.version}"]`, excerpt: `${pkg.version} published ${pkg.publishedAt}`, confidence: 0.95 }));

  // Principles: spec pages typed "Principles" under "Design Patterns", in the documented order.
  const principlePages = specs
    .filter((s) => (fmString(s.doc.frontmatter, "type") ?? "").toLowerCase() === SPEC_PRINCIPLE_TYPE && /^design patterns/i.test(fmString(s.doc.frontmatter, "group") ?? ""))
    .sort((a, b) => Number(a.doc.frontmatter.order ?? 99) - Number(b.doc.frontmatter.order ?? 99) || a.slug.localeCompare(b.slug));
  const principles = principlePages.map((s) => ({ name: fmString(s.doc.frontmatter, "title") ?? humanize(s.slug), sourceUrl: s.docsUrl }));
  for (const s of principlePages) evidence.push(ev(s.stamp, "principles", METHOD.specMd, { location: `${s.stamp.file}#frontmatter (type: Principles)`, excerpt: `${fmString(s.doc.frontmatter, "title")}: ${firstSentences(s.doc.lead, 200) ?? ""}`, confidence: 0.9 }));

  // Philosophy: ATLAS-authored synthesis of the Design Values page (H2 names) and the introduction.
  let philosophy: string | null = null;
  const values = specs.find((s) => s.slug === "values");
  const intro = specs.find((s) => s.slug === "introduce");
  const valueNames = values ? values.doc.headings.filter((h) => h.depth === 2).map((h) => h.text).filter((t) => /^[A-Z][a-z]+$/.test(t)) : [];
  if (values && valueNames.length >= 2) {
    const parts = [`Ant Design's guidance is organized around ${valueNames.length} design values (${valueNames.join(", ")}), which its Design Values page presents as internal evaluation standards that inspire its design principles and patterns.`];
    if (intro && /enterprise/i.test(intro.doc.lead ?? "")) parts.push("Its introduction frames it as a design system for enterprise products, aimed at unifying interface specifications and reducing redundant design and production cost.");
    if (principles.length) parts.push(`Its documented design principles are ${principles.map((p) => p.name).join(", ")}.`);
    philosophy = parts.join(" ").slice(0, 1500);
    evidence.push(ev(values.stamp, "philosophy", METHOD.specMd, { url: values.docsUrl, location: `${values.stamp.file} (lead + H2)`, excerpt: `${firstSentences(values.doc.lead, 180) ?? ""} Values: ${valueNames.join(", ")}`, confidence: 0.85 }));
    if (intro) evidence.push(ev(intro.stamp, "philosophy", METHOD.specMd, { url: intro.docsUrl, location: `${intro.stamp.file} (lead)`, excerpt: firstSentences(intro.doc.lead, 280), confidence: 0.8 }));
  }

  const frameworks: NonNullable<NormalizedSystemFacts["frameworks"]> = [];
  const peers = pkgF.peers ?? [];
  if (peers.includes("react")) {
    frameworks.push({ slug: "react", packageName: pkg.name });
    evidence.push(ev(pkgF.stamp, "frameworks", METHOD.npm, { url: npmPageUrl(pkg.name, pkg.version), location: "peerDependencies", excerpt: `peerDependencies: ${peers.join(", ")}`, confidence: 0.95 }));
  }
  return {
    latestVersion: pkg.version,
    latestReleaseAt: pkg.publishedAt,
    philosophy,
    principles: principles.length ? principles : null,
    frameworks: frameworks.length ? frameworks : null,
    evidence,
  };
}

/* ============================================================================ */
/* Ant Design Mobile                                                             */
/* ============================================================================ */

interface MobileVarRow {
  owner: string;
  ownerSlug: string;
  local: string;
  global: string | null;
  value: string | null;
  description: string | null;
  line: number;
  component: string; // component slug (docs page)
  file: string;
}

function mobileCssVarRows(f: F<"m-component-doc">, title: string): { rows: MobileVarRow[]; skipped: string[] } {
  const rows: MobileVarRow[] = [];
  const skipped: string[] = [];
  for (const t of f.doc.tables) {
    const nearest = t.headings[t.headings.length - 1];
    if (!nearest || !/^css variables$/i.test(nearest.text)) continue;
    const nameIdx = t.headers.findIndex((h) => /^name$/i.test(h));
    const defIdx = t.headers.findIndex((h) => /^default( value)?$/i.test(h));
    const descIdx = t.headers.findIndex((h) => /^description$/i.test(h));
    const globIdx = t.headers.findIndex((h) => /^global$/i.test(h));
    if (nameIdx < 0 || defIdx < 0) continue;
    const parent = [...t.headings].reverse().find((h) => h.depth < nearest.depth);
    const owner = parent && parent.depth >= 2 && /^[A-Z][A-Za-z0-9.]*$/.test(parent.text) ? parent.text : title;
    for (const r of t.rows) {
      const local = (r[nameIdx]?.text ?? "").trim();
      if (!/^--[a-z][a-z0-9-]*$/.test(local)) continue;
      const dc = r[defIdx];
      const value = dc && dc.codes.length === 1 && dc.text === dc.codes[0]!.replace(/\s+/g, " ").trim() ? dc.codes[0]!.trim() : null;
      const glob = globIdx >= 0 ? ((r[globIdx]?.codes[0] ?? r[globIdx]?.text ?? "").trim() || null) : null;
      if (!value) skipped.push(`${owner} ${local}`);
      rows.push({
        owner,
        ownerSlug: slugify(owner.replace(/\./g, "-")),
        local,
        global: glob && /^--adm-[a-z0-9-]+$/.test(glob) ? glob : null,
        value,
        description: r[descIdx]?.text?.trim() || null,
        line: t.line,
        component: f.slug,
        file: f.stamp.file,
      });
    }
  }
  return { rows, skipped };
}

export function normalizeMobile(systemSlug: string, frags: AntdFragment[], opts: NormalizeOptions = {}): NormalizedBundle {
  const log = opts.log ?? (() => {});
  const profile = PROFILES[SLUG_MOBILE]!;
  const pkgF = byType(frags, "pkg")[0] ?? null;
  const pkg = pkgF?.pkg ?? null;
  const lic = byType(frags, "license")[0] ?? null;
  const license = mitLicense(pkg, lic);
  const idx = byType(frags, "index-dts")[0] ?? null;
  const nav = byType(frags, "m-nav")[0] ?? null;
  const demos = byType(frags, "demo");
  const guide = byType(frags, "m-guide").find((g) => g.key === "theming") ?? null;
  const copyright = lic?.copyright ?? "Copyright (c) 2016-present Alipay.com";
  const ref = pkg?.ref ?? "master";

  const docFrags = byType(frags, "m-component-doc").sort((a, b) => a.order - b.order || a.slug.localeCompare(b.slug));
  const selected = opts.limit && opts.limit > 0 ? docFrags.slice(0, opts.limit) : docFrags;
  const slugs = new Set(selected.map((f) => f.slug));
  const titleOf = (f: F<"m-component-doc">) => f.doc.h1?.replace(/<[^>]+>/g, "").trim() || humanize(f.slug);

  /* ---------------------------------- tokens ---------------------------------- */
  const tokenSets: NormalizedTokenSet[] = [];
  const deprecated = new Map((guide?.deprecatedVars ?? []).map((d) => [d.name, d]));
  const def = byType(frags, "m-theme-css").find((t) => t.part === "default") ?? null;
  const dark = byType(frags, "m-theme-css").find((t) => t.part === "dark") ?? null;
  const globalNames = new Set<string>();
  if (def && pkg) {
    const darkDecls = dark?.theme.dark ?? [];
    const darkNames = new Set(darkDecls.map((d) => d.name));
    const sel = dark?.theme.darkSelector ?? "html[data-prefers-color-scheme='dark']";
    const mk = (d: { name: string; value: string; line: number }, file: string, selector: string) =>
      mkToken({
        name: d.name,
        path: [d.name.replace(/^--adm-/, "")],
        cssVar: d.name,
        type: null,
        rawValue: d.value,
        references: cssVarRefs(d.value),
        description: deprecated.has(d.name) ? `Deprecated since ${deprecated.get(d.name)!.since ?? "n/a"}${deprecated.get(d.name)!.replacement ? `; use ${deprecated.get(d.name)!.replacement}` : ""}.` : null,
        location: `${file}#L${d.line} (${selector})`,
        tier: inferTokenTier(d.name, cssVarRefs(d.value).length > 0),
        tierState: "inferred",
        deprecated: deprecated.has(d.name),
      });
    const base = def.theme.root.filter((d) => !darkNames.has(d.name)).map((d) => mk(d, def.stamp.file, ":root"));
    const light = def.theme.root.filter((d) => darkNames.has(d.name)).map((d) => mk(d, def.stamp.file, ":root"));
    const darkTokens = dark ? darkDecls.map((d) => mk(d, dark.stamp.file, sel)) : [];
    const common = { packageName: pkg.name, packageVersion: pkg.version, license, redistribution: (license ? "permitted" : "unknown") as NormalizedTokenSet["redistribution"], format: "css-vars" as const };
    const cssEv = (fr: F<"m-theme-css">, n: number, what: string) => ev(fr.stamp, "tokens", METHOD.mobileCss, { location: fr.stamp.file, excerpt: `${n} ${what} from ${pkg.name}@${pkg.version}/${fr.stamp.file}`, confidence: 0.95 });
    const guideEv = guide && deprecated.size ? [ev(guide.stamp, "tokens.deprecated", METHOD.mobileGuide, { url: guide.docsUrl, location: guide.stamp.file, excerpt: [...deprecated.values()].map((d) => `${d.name} deprecated since ${d.since}`).join("; "), confidence: 0.9 })] : [];
    if (base.length)
      tokenSets.push({ slug: "global", name: "Global variables (theme-agnostic)", theme: null, sourceUrl: npmFileUrl(pkg.name, pkg.version, def.stamp.file), tokens: base.sort((a, b) => a.name.localeCompare(b.name)), evidence: [cssEv(def, base.length, ":root variables not redefined by the dark theme"), ...guideEv], ...common });
    if (light.length)
      tokenSets.push({ slug: "theme-light", name: "Theme variables (default, light)", theme: "light", sourceUrl: npmFileUrl(pkg.name, pkg.version, def.stamp.file), tokens: light.sort((a, b) => a.name.localeCompare(b.name)), evidence: [cssEv(def, light.length, ":root variables that the dark theme redefines"), ...guideEv], ...common });
    if (dark && darkTokens.length)
      tokenSets.push({ slug: "theme-dark", name: "Theme variables (dark)", theme: "dark", sourceUrl: npmFileUrl(pkg.name, pkg.version, dark.stamp.file), tokens: darkTokens.sort((a, b) => a.name.localeCompare(b.name)), evidence: [cssEv(dark, darkTokens.length, `${sel} variables`), ...guideEv], ...common });
    for (const s of tokenSets) for (const t of s.tokens) globalNames.add(t.name);
  }

  // Component CSS variables (docs tables) -> one theme-agnostic set.
  const allRows: MobileVarRow[] = [];
  const skippedRows: string[] = [];
  for (const f of selected) {
    const r = mobileCssVarRows(f, titleOf(f));
    allRows.push(...r.rows);
    skippedRows.push(...r.skipped.map((s) => `${f.slug}: ${s}`));
  }
  if (skippedRows.length) log(`component CSS variables without a literal default (omitted): ${skippedRows.join(", ")}`);
  const localCount = new Map<string, number>();
  for (const r of allRows) if (r.value) localCount.set(r.local, (localCount.get(r.local) ?? 0) + 1);
  const compTokenNames = new Map<string, string[]>();
  const compTokens: NormalizedToken[] = [];
  const nameSeen = new Set<string>();
  const nameOf = (r: Pick<MobileVarRow, "ownerSlug" | "local">) => `${r.ownerSlug}.${r.local.replace(/^--/, "")}`;
  const rowsByOwner = new Map<string, MobileVarRow[]>();
  for (const r of allRows) if (r.value) rowsByOwner.set(r.ownerSlug, [...(rowsByOwner.get(r.ownerSlug) ?? []), r]);
  const byGlobal = new Map(allRows.filter((r) => r.value && r.global).map((r) => [r.global!, nameOf(r)]));
  for (const r of allRows) {
    if (!r.value) continue;
    const name = nameOf(r);
    if (nameSeen.has(name)) continue;
    nameSeen.add(name);
    const refs = cssVarRefs(r.value)
      .map((v) => {
        if (globalNames.has(v)) return v;
        if (byGlobal.has(v)) return byGlobal.get(v)!;
        const sameOwner = rowsByOwner.get(r.ownerSlug)?.find((x) => x.local === v);
        return sameOwner ? nameOf(sameOwner) : v;
      })
      .filter((v, i, a) => a.indexOf(v) === i);
    compTokens.push(
      mkToken({
        name,
        path: [r.ownerSlug, r.local],
        // Scoped custom property: the documented global override when there is one, else the local
        // name when no other component documents the same local name (resolution stays unambiguous).
        cssVar: r.global ?? ((localCount.get(r.local) ?? 0) === 1 ? r.local : null),
        type: null,
        rawValue: r.value,
        references: refs,
        description: r.description ? `${r.description}${r.global ? ` (global: ${r.global})` : ""}` : r.global ? `Global: ${r.global}` : null,
        location: `${r.file}#L${r.line} (${r.owner} CSS Variables ${r.local})`,
        tier: "component",
        tierState: "verified",
      }),
    );
    compTokenNames.set(r.component, [...(compTokenNames.get(r.component) ?? []), name]);
  }
  if (compTokens.length && pkg) {
    const files = uniq(allRows.filter((r) => r.value).map((r) => r.component));
    tokenSets.push({
      slug: "component-css-variables",
      name: "Component CSS variables (documented defaults)",
      theme: null,
      format: "css-vars",
      sourceUrl: `https://github.com/${profile.repo.owner}/${profile.repo.name}/tree/${ref}/src/components`,
      packageName: pkg.name,
      packageVersion: pkg.version,
      license,
      redistribution: license ? "permitted" : "unknown",
      tokens: compTokens.sort((a, b) => a.name.localeCompare(b.name)),
      evidence: selected
        .filter((f) => files.includes(f.slug))
        .map((f) => ev(f.stamp, "tokens", METHOD.mobileCssTable, { location: `${f.stamp.file} (### CSS Variables)`, excerpt: `${compTokenNames.get(f.slug)?.length ?? 0} documented CSS variables of ${titleOf(f)}`, confidence: 0.9 })),
    });
  }

  /* -------------------------------- components -------------------------------- */
  const components: NormalizedComponent[] = [];
  for (const f of selected) {
    const name = titleOf(f);
    const d = f.doc;
    const file = f.stamp.file;
    const evidence: Ev[] = [];
    const coverage: Record<string, CoverageState> = {};
    const props = extractProps(d.tables, {
      mainNames: [name, "Props", "API"],
      scope: () => true,
      ownerOf: (t) => headingOwner(t, /^(props?|api)$/i),
    });
    const properties = toProperties(props, f.docsUrl);
    coverage.properties = properties.length ? "documented" : "not-documented";
    const isExperimental = f.group === "experimental";
    evidence.push(
      ev(f.stamp, "*", METHOD.docsMd, {
        title: `${name} — ${profile.repo.name} docs source`,
        location: file,
        excerpt: `${name}; nav group ${f.group ?? "n/a"}; ${properties.length} props; ${compTokenNames.get(f.slug)?.length ?? 0} CSS variables`,
        confidence: 0.95,
      }),
    );
    if (nav) evidence.push(ev(nav.stamp, "lifecycle", METHOD.mobileNav, { location: `config/components.ts#${f.group ?? "?"}`, excerpt: `${f.route} listed in nav group "${f.group}"`, confidence: 0.9 }));
    // Lead paragraph; version notices ("This component is available since ...") fall back to "When to Use".
    const lead = d.lead && !/^this component is available since\b/i.test(d.lead) ? d.lead : null;
    const whenToUse = Object.entries(d.sectionText).find(([k]) => /^when to use$/i.test(k))?.[1] ?? null;
    const description = firstSentences(lead ?? whenToUse, 280);
    coverage.description = description ? "documented" : "not-documented";
    if (description) evidence.push(ev(f.stamp, "description", METHOD.docsMd, { location: `${file} (${lead ? "lead paragraph" : "When to Use"})`, excerpt: description }));
    const firstProps = d.tables.find((t) => t.headers.some((h) => /^type$/i.test(h)));
    if (properties.length) evidence.push(ev(f.stamp, "properties", METHOD.apiTable, { location: `${file}#L${firstProps?.line ?? 1}`, excerpt: `${properties.length} props from Props tables (Name | Description | Type | Default)`, confidence: 0.9 }));
    const { variants, states, sizes } = variantsStatesSizes(props, f.docsUrl, file);
    coverage.variants = variants.length ? "documented" : properties.length ? "not-documented" : "not-extracted";
    coverage.sizes = sizes?.length ? "documented" : properties.length ? "not-documented" : "not-extracted";
    coverage.states = states.length ? "inferred" : properties.length ? "not-documented" : "not-extracted";
    if (variants.length) evidence.push(ev(f.stamp, "variants", METHOD.apiTable, { location: `${file} Props table`, excerpt: `Variant props: ${uniq(variants.map((v) => v.axis)).join(", ")}`, confidence: 0.85 }));
    if (sizes?.length) evidence.push(ev(f.stamp, "sizes", METHOD.apiTable, { location: `${file} Props table (size)`, excerpt: `size: ${sizes.join(" | ")}` }));
    if (states.length) evidence.push(ev(f.stamp, "states", METHOD.apiTable, { location: `${file} Props table`, excerpt: `States implied by props: ${states.map((s) => s.name).join(", ")}`, state: "inferred", confidence: 0.7 }));

    const { canonicalType, classification } = classify(systemSlug, name);
    const exported = idx?.exports[f.slug] ?? [];
    const altPkg = !exported.length ? (d.installs.find((x) => x !== pkg?.name && /^(antd-mobile-[a-z-]+|@ant-design\/[a-z-]+)$/.test(x)) ?? null) : null;
    const frameworks: NormalizedComponent["frameworks"] = [{ slug: "react", packageName: exported.length ? (pkg?.name ?? "antd-mobile") : altPkg, importName: exported.length ? exported.join(", ") : null, sourceUrl: f.docsUrl }];
    if (exported.length && idx) evidence.push(ev(idx.stamp, "frameworks", METHOD.indexDts, { location: "es/index.d.ts", excerpt: `export { default as ${exported.join(", ")} } from './components/${f.slug}'` }));
    else if (altPkg) evidence.push(ev(f.stamp, "frameworks", METHOD.docsMd, { location: `${file} (install instructions)`, excerpt: `Installed from ${altPkg}` }));
    coverage.frameworks = exported.length || altPkg ? "documented" : "inferred";

    const { accessibility, kbProp } = accessibilityFrom(d, props, name, f.docsUrl);
    coverage.accessibility = accessibility ? "documented" : "not-documented";
    coverage.keyboard = accessibility?.keyboard?.length ? "documented" : "not-documented";
    if (accessibility) evidence.push(ev(f.stamp, "accessibility", METHOD.docsMd, { location: `${file} (prose)`, excerpt: d.a11yNotes[0] ?? kbProp?.description ?? null, confidence: 0.8 }));
    coverage.responsive = d.mentionsResponsive ? "not-extracted" : "not-documented";

    const examples: NormalizedComponent["examples"] = [];
    for (const dm of demos.filter((x) => x.slug === f.slug).sort((x, y) => x.demo.localeCompare(y.demo))) {
      if (!dm.code) continue;
      examples.push({
        slug: `code-${slugify(dm.demo) || "demo"}`,
        title: `${name} demo (${dm.stamp.file.replace(/^.*\/demos\//, "demos/")})`,
        kind: "code-snippet",
        language: "tsx",
        code: dm.code,
        url: dm.stamp.evidenceUrl,
        attribution: `${dm.stamp.file} from ${profile.repo.owner}/${profile.repo.name}@${ref}. MIT License, ${copyright}.`,
      });
      evidence.push(ev(dm.stamp, "examples", METHOD.demo, { location: dm.stamp.file, excerpt: `Demo source ${dm.stamp.file} (MIT)`, confidence: 0.95 }));
    }
    coverage.examples = examples.length ? "documented" : d.demos.length ? "not-extracted" : "not-documented";

    const rel = uniq(d.links.map((l) => componentSlugFromLink(l, profile.docsOrigin)).filter((x): x is string => !!x && x !== f.slug && slugs.has(x))).sort();
    const relationships = rel.map((t) => ({ kind: "see-also", targetSlug: t, targetType: null }));
    coverage.relationships = relationships.length ? "documented" : "not-extracted";
    if (relationships.length) evidence.push(ev(f.stamp, "relationships", METHOD.docsMd, { location: `${file} links to /components/*`, excerpt: `Links to: ${rel.join(", ")}`, confidence: 0.8 }));

    const usages = (compTokenNames.get(f.slug) ?? []).slice().sort().map((n) => ({ tokenName: n, property: null }));
    const hasCssTable = d.headings.some((h) => /^css variables$/i.test(h.text));
    coverage.tokens = usages.length ? "documented" : hasCssTable ? "not-extracted" : "not-documented";
    if (usages.length) evidence.push(ev(f.stamp, "tokenUsages", METHOD.mobileCssTable, { location: `${file} (### CSS Variables)`, excerpt: `${usages.length} documented CSS variables` }));

    components.push({
      slug: f.slug,
      name,
      aliases: [],
      description,
      docsUrl: f.docsUrl,
      sourceCodeUrl: treeUrl(profile, ref, file.replace(/\/[^/]+$/, "")),
      lifecycle: isExperimental ? "experimental" : "unknown",
      canonicalType,
      classification,
      frameworks,
      variants,
      states,
      sizes,
      properties,
      accessibility,
      examples,
      relationships,
      tokenUsages: usages,
      responsiveGuidance: null,
      coverage,
      evidence,
    });
  }
  components.sort((a, b) => a.slug.localeCompare(b.slug));

  /* ----------------------------------- facts ----------------------------------- */
  let facts: NormalizedSystemFacts | null = null;
  if (pkgF && pkg) {
    const evidence: Ev[] = [
      ev(pkgF.stamp, "latestVersion", METHOD.npm, { url: npmPageUrl(pkg.name, pkg.version), title: `${pkg.name} on npm`, location: "dist-tags.latest", excerpt: `latest ${pkg.version}${pkg.publishedAt ? ` published ${pkg.publishedAt}` : ""}; license ${pkg.license ?? "n/a"}`, confidence: 0.95 }),
    ];
    if (pkg.publishedAt) evidence.push(ev(pkgF.stamp, "latestReleaseAt", METHOD.npm, { url: npmPageUrl(pkg.name, pkg.version), location: `time["${pkg.version}"]`, excerpt: `${pkg.version} published ${pkg.publishedAt}`, confidence: 0.95 }));
    const peers = pkgF.peers ?? [];
    const frameworks = peers.includes("react") ? [{ slug: "react", packageName: pkg.name }] : [];
    if (frameworks.length) evidence.push(ev(pkgF.stamp, "frameworks", METHOD.npm, { url: npmPageUrl(pkg.name, pkg.version), location: "peerDependencies", excerpt: `peerDependencies: ${peers.join(", ")}`, confidence: 0.95 }));
    facts = { latestVersion: pkg.version, latestReleaseAt: pkg.publishedAt, philosophy: null, principles: null, frameworks: frameworks.length ? frameworks : null, evidence };
  }
  return { systemSlug, components, tokenSets, patterns: [], facts };
}
