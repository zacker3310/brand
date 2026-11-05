/**
 * Merge GOV.UK parse fragments into a NormalizedBundle. Deterministic: components are ordered by
 * slug, tokens by settings-file order then source order, patterns by slug. The component plan is
 * derived from fragment bodies (package listing + docs sitemap), never from document metadata, so a
 * reused fragment (unchanged source) can never carry a stale plan.
 */
import type {
  CoverageState,
  EvidenceInput,
  KeyboardInteraction,
  NormalizedBundle,
  NormalizedComponent,
  NormalizedPattern,
  NormalizedSystemFacts,
  NormalizedToken,
  NormalizedTokenSet,
} from "@/lib/contracts";
import { canonicalState, classifyComponentName, classifyPatternName } from "@/lib/taxonomy";
import { slugify } from "@/lib/utils";
import { ADAPTER_ID, GOVUK, componentSrcDir, docsUrlFor, frontendTree, normKey, profileFor, type FrontendProfile, type TokenSetKey } from "./constants";
import { lifecycleFromStatus, type ComponentDoc, type DocColour, type HomeData, type LifecycleRules, type PatternDoc, type Principle } from "./docs";
import { clip } from "./markdown";
import { humanizeMethod, type JsInfo, type TemplateInfo } from "./markup";
import { optionToComponent, statesFromExamples, statesFromParams, type ParsedParams } from "./params";
import { tokenCategory, tokenTier, tokenType, type MixinAnalysis, type SettingsParse, type SettingsToken } from "./scss";

const TOKEN_SET_ORDER: TokenSetKey[] = ["colour-palette", "functional-colours", "applied-colours", "organisation-colours", "spacing", "typography", "layout", "component-settings"];

/* ------------------------------- fragments -------------------------------- */

export interface Ev {
  sourceUrl: string;
  retrievedAt: string;
  contentHash: string | null;
  location: string;
}

export interface ListingComponent {
  name: string;
  files: string[];
}

export type GovukFragment =
  | { t: "pkg"; name: string; version: string; license: string | null; publishedAt: string | null; ev: Ev }
  | { t: "listing"; version: string; components: ListingComponent[]; settingsFiles: string[]; ev: Ev }
  | { t: "sitemap"; components: string[]; patterns: string[]; styles: string[]; ev: Ev }
  | { t: "docs-component"; docSlug: string; data: ComponentDoc; ev: Ev }
  | { t: "docs-pattern"; docSlug: string; data: PatternDoc; ev: Ev }
  | { t: "readme"; name: string; title: string | null; guidance: string | null; ev: Ev }
  | { t: "params"; name: string; data: ParsedParams; fromTag: boolean; version: string; ev: Ev }
  | { t: "template"; name: string; data: TemplateInfo; fromTag?: boolean; ev: Ev }
  | { t: "styles"; name: string; file: string; data: MixinAnalysis; ev: Ev }
  | { t: "js"; name: string; data: JsInfo; ev: Ev }
  | { t: "html-example"; name: string; html: string | null; version: string; ev: Ev }
  | { t: "settings"; file: string; set: TokenSetKey; order: number; data: SettingsParse; version: string; ev: Ev }
  | { t: "css"; customProperties: string[]; ev: Ev }
  | { t: "macros"; macros: Record<string, string>; ev: Ev }
  | { t: "macro"; name: string; macroName: string | null; ev: Ev }
  | { t: "colours-json"; colours: DocColour[]; ev: Ev }
  | { t: "lifecycle"; rules: LifecycleRules; ev: Ev }
  | { t: "home"; data: HomeData; ev: Ev }
  | { t: "principles"; title: string | null; updatedAt: string | null; principles: Principle[]; ev: Ev };

type F<K extends GovukFragment["t"]> = Extract<GovukFragment, { t: K }>;

/* -------------------------------- helpers --------------------------------- */

const method = (parser: string) => `adapter:${ADAPTER_ID}:${parser}`;

function evidence(field: string, ev: Ev, parser: string, confidence: number, extra: Partial<EvidenceInput> = {}): EvidenceInput {
  return {
    field,
    sourceUrl: ev.sourceUrl,
    retrievedAt: ev.retrievedAt,
    contentHash: ev.contentHash,
    extractionMethod: method(parser),
    location: ev.location,
    state: "verified",
    confidence,
    ...extra,
    excerpt: extra.excerpt ? clip(extra.excerpt, 280) : null,
  };
}

function uniqBy<T>(arr: T[], key: (t: T) => string): T[] {
  const seen = new Set<string>();
  return arr.filter((x) => {
    const k = key(x);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

const sortBy = <T>(arr: T[], key: (t: T) => string) => [...arr].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));

const humanize = (s: string) => {
  const w = s.replace(/[-_]+/g, " ").trim();
  return w.charAt(0).toUpperCase() + w.slice(1);
};

/* --------------------------------- plan ----------------------------------- */

export interface PlanItem {
  slug: string;
  /** govuk-frontend component folder (dist/govuk/components/<name>), null for docs-only pages. */
  frontend: string | null;
  docSlug: string | null;
  files: string[];
}

/** Components = govuk-frontend component folders (with a macro) ∪ docs component pages. */
export function planComponents(listing: F<"listing"> | undefined, sitemap: F<"sitemap"> | undefined, docSlugsFetched: string[], limit?: number, profile: FrontendProfile = GOVUK): PlanItem[] {
  const docs = new Set(sitemap ? sitemap.components : docSlugsFetched);
  const items = new Map<string, PlanItem>();
  for (const c of listing?.components ?? []) {
    if (!c.files.includes("macro.njk") && !c.files.includes("template.njk")) continue;
    const mapped = profile.docsSlugForFrontend[c.name];
    const docSlug = mapped && docs.has(mapped) ? mapped : docs.has(c.name) ? c.name : null;
    const slug = docSlug ?? c.name;
    items.set(slug, { slug, frontend: c.name, docSlug, files: c.files });
  }
  for (const d of docs) if (!items.has(d)) items.set(d, { slug: d, frontend: null, docSlug: d, files: [] });
  const all = sortBy([...items.values()], (i) => i.slug);
  return limit ? all.slice(0, limit) : all;
}

/* ---------------------------- classification ------------------------------ */

function classify(name: string, frontend: string | null, aliases: string[], pkg: string): { slug: string; state: "inferred"; method: string; confidence: number } | null {
  const tries: { n: string; label: string | null; min: number; cap: number }[] = [
    { n: name, label: null, min: 0.75, cap: 1 },
    ...(frontend ? [{ n: frontend, label: `${pkg} folder "${frontend}"`, min: 0.75, cap: 0.8 }] : []),
    ...aliases.map((a) => ({ n: a, label: `docs alias "${a}"`, min: 0.85, cap: 0.6 })),
    { n: name, label: null, min: 0, cap: 1 },
  ];
  for (const t of tries) {
    const c = classifyComponentName(t.n);
    if (!c || c.confidence < t.min) continue;
    return { slug: c.slug, state: "inferred", method: t.label ? `${c.method} (${t.label})` : c.method, confidence: Math.min(c.confidence, t.cap) };
  }
  return null;
}

/* ------------------------------- variants --------------------------------- */

const STATE_MODIFIERS: Record<string, { name: string; canonical: string }> = {
  error: { name: "Error", canonical: "error" },
  disabled: { name: "Disabled", canonical: "disabled" },
  "is-disabled": { name: "Disabled", canonical: "disabled" },
  open: { name: "Open", canonical: "expanded" },
  expanded: { name: "Expanded", canonical: "expanded" },
  active: { name: "Active", canonical: "active" },
  current: { name: "Current", canonical: "selected" },
  selected: { name: "Selected", canonical: "selected" },
  focused: { name: "Focused", canonical: "focus" },
};
const NON_VARIANT_MODIFIER = /^(js-|no-js|hidden$|visually-hidden|visible$|with-|has-|is-)/;
const SIZE_MODIFIER = /^(small|large|s|m|l|xl|width-.+|fixed-width.*|full-width)$/;
const TONE_MODIFIER = /^(dark-|pale-|light-)?(grey|green|turquoise|teal|blue|purple|pink|magenta|red|orange|yellow|warm-yellow|aqua-green|brown|black|white)$/;

function variantAxis(mod: string): string {
  if (SIZE_MODIFIER.test(mod)) return "size";
  if (TONE_MODIFIER.test(mod)) return "tone";
  return "variant";
}

/** Docs section describing a modifier: inline code naming the class, else a heading containing the modifier word. */
function sectionFor(doc: ComponentDoc | null, block: string, mod: string): ComponentDoc["sections"][number] | null {
  if (!doc) return null;
  const cls = `${block}--${mod}`;
  const byCode = doc.sections.find((s) => s.codes.some((c) => c.split(/\s+/).includes(cls)));
  if (byCode) return byCode;
  const word = mod.replace(/-/g, " ");
  const re = new RegExp(`(^|\\s)${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(er|s)?(\\s|$)`, "i");
  return doc.sections.find((s) => s.depth >= 3 && re.test(s.title)) ?? null;
}

/* ------------------------------ components -------------------------------- */

interface ByComponent {
  docs?: F<"docs-component">;
  readme?: F<"readme">;
  macro?: F<"macro">;
  params?: F<"params">;
  template?: F<"template">;
  styles?: F<"styles">;
  js?: F<"js">;
  html?: F<"html-example">;
}

interface Ctx {
  profile: FrontendProfile;
  version: string | null;
  macros?: F<"macros">;
  lifecycle?: F<"lifecycle">;
  slugByFrontend: Map<string, string>;
  slugByDoc: Map<string, string>;
  tokenNames: Set<string>;
  fixRef: (name: string) => string;
}

function buildComponent(item: PlanItem, f: ByComponent, cx: Ctx): NormalizedComponent {
  const ev: EvidenceInput[] = [];
  const coverage: Record<string, CoverageState> = {};
  const doc = f.docs?.data ?? null;
  const P = cx.profile;
  const docsUrl = item.docSlug ? docsUrlFor(P, "components", item.docSlug) : null;
  const block = item.frontend ? `${P.prefix}-${item.frontend}` : null;

  // Identity
  if (f.docs) ev.push(evidence("*", f.docs.ev, "docs-markdown", 0.95, { location: `${f.docs.ev.location}#frontmatter.title`, excerpt: doc?.title ?? null }));
  if (f.params) ev.push(evidence("*", f.params.ev, f.params.fromTag ? "params-yaml" : "macro-options-json", 0.95));
  if (f.readme && !f.docs) ev.push(evidence("*", f.readme.ev, "readme", 0.9, { excerpt: f.readme.title }));
  if (!ev.length && f.template) ev.push(evidence("*", f.template.ev, "template-njk", 0.9));
  if (!ev.length && f.styles) ev.push(evidence("*", f.styles.ev, "scss-static", 0.85));
  const name = doc?.title ?? f.readme?.title ?? humanize(item.frontend ?? item.slug);

  // Description
  let description: string | null = null;
  if (doc?.description) {
    description = doc.description;
    ev.push(evidence("description", f.docs!.ev, "docs-markdown", 0.95, { location: `${f.docs!.ev.location}#frontmatter.${doc.descriptionFrom === "intro" ? "intro" : "description"}`, excerpt: description }));
  } else if (f.readme?.guidance) {
    description = f.readme.guidance;
    ev.push(evidence("description", f.readme.ev, "readme", 0.8, { location: `${f.readme.ev.location}#Guidance and Examples`, excerpt: description }));
  }
  coverage.description = description ? "documented" : f.docs || f.readme ? "not-documented" : "not-extracted";

  // Lifecycle: docs status tag; no tag = stable per the documented lifecycle rule; a page stating the
  // component no longer exists = deprecated.
  let lifecycle: NormalizedComponent["lifecycle"] = "unknown";
  if (doc?.withdrawn) {
    lifecycle = "deprecated";
    ev.push(evidence("lifecycle", f.docs!.ev, "docs-markdown", 0.9, { location: `${f.docs!.ev.location}#intro`, excerpt: doc.withdrawn }));
  } else if (doc?.status) {
    lifecycle = lifecycleFromStatus(doc.status);
    ev.push(evidence("lifecycle", f.docs!.ev, "docs-markdown", 0.95, { location: `${f.docs!.ev.location}#frontmatter.status`, excerpt: `status.type: ${doc.status}${doc.statusDate ? ` (${doc.statusDate})` : ""}` }));
  } else if (doc && cx.lifecycle?.rules.stableHasNoTag) {
    lifecycle = "stable";
    ev.push(evidence("lifecycle", f.docs!.ev, "docs-markdown", 0.85, { location: `${f.docs!.ev.location}#frontmatter (no status tag)` }));
    ev.push(evidence("lifecycle", cx.lifecycle.ev, "docs-lifecycle", 0.85, { excerpt: cx.lifecycle.rules.stableExcerpt }));
  }

  // Properties (Nunjucks macro options)
  const params = f.params?.data.params ?? [];
  const paramUrl = f.params?.ev.sourceUrl ?? null;
  const properties: NormalizedComponent["properties"] = params.map((p) => ({
    implementation: "nunjucks",
    name: p.name,
    type: p.type,
    defaultValue: p.defaultValue,
    required: p.required,
    deprecated: p.deprecated,
    description: p.description,
    allowedValues: null,
    sourceUrl: paramUrl,
  }));
  if (properties.length) ev.push(evidence("properties", f.params!.ev, f.params!.fromTag ? "params-yaml" : "macro-options-json", 0.95, { location: `${f.params!.ev.location}#params${f.params!.data.truncated ? ` (${f.params!.data.truncated} nested options beyond depth/size bounds not stored)` : ""}` }));
  coverage.properties = properties.length ? "documented" : f.params ? "not-documented" : "not-extracted";

  // Frameworks
  const frameworks: NormalizedComponent["frameworks"] = [];
  const kitMacro = item.frontend ? (cx.macros?.macros[item.frontend] ?? null) : null;
  const macroName = kitMacro ?? f.macro?.macroName ?? null;
  // Source folder link only when a file was read from that folder at the release tag.
  const fromTag = !!f.params?.fromTag || !!f.template?.fromTag;
  const srcDir = item.frontend && fromTag && cx.version ? frontendTree(P, cx.version, componentSrcDir(P, item.frontend)) : null;
  if (item.frontend && (macroName || item.files.includes("macro.njk"))) {
    frameworks.push({ slug: "nunjucks", packageName: P.npmPkg, importName: macroName, sourceUrl: srcDir });
    if (kitMacro) ev.push(evidence("frameworks", cx.macros!.ev, "prototype-kit-config", 0.95, { location: `${cx.macros!.ev.location}#nunjucksMacros (${kitMacro})` }));
    else if (f.macro?.macroName) ev.push(evidence("frameworks", f.macro.ev, "macro-njk", 0.95, { location: `${f.macro.ev.location} ({% macro ${f.macro.macroName} %})` }));
  }
  if (item.frontend && (f.html || item.files.includes("template.njk"))) {
    frameworks.push({ slug: "html-css", packageName: P.npmPkg, importName: block, sourceUrl: srcDir });
    if (f.html) ev.push(evidence("frameworks", f.html.ev, "html-fixture", 0.9));
  }
  if (doc?.htmlAndNunjucks) ev.push(evidence("frameworks", f.docs!.ev, "docs-markdown", 0.9, { location: `${f.docs!.ev.location}#How it works`, excerpt: "You can use HTML or ... the Nunjucks macro." }));
  coverage.frameworks = frameworks.length ? "documented" : "not-extracted";

  // Variants (block-level BEM modifiers in the component stylesheet)
  const mods = f.styles && block ? f.styles.data.modifiers.filter((m) => m.block === block) : [];
  const variants: NormalizedComponent["variants"] = [];
  const modStates: { name: string; canonical: string; via: string }[] = [];
  for (const m of mods) {
    const st = STATE_MODIFIERS[m.modifier];
    if (st) {
      modStates.push({ ...st, via: `.${m.block}--${m.modifier}` });
      continue;
    }
    if (NON_VARIANT_MODIFIER.test(m.modifier)) continue;
    const sec = sectionFor(doc, m.block, m.modifier);
    variants.push({
      axis: variantAxis(m.modifier),
      name: m.modifier,
      description: sec?.firstParagraph ?? null,
      sourceUrl: sec && docsUrl ? docsUrl : (f.styles?.ev.sourceUrl ?? null),
      location: sec ? `docs: ${sec.title}` : `${f.styles!.ev.location}#L${m.line} (.${m.block}--${m.modifier})`,
    });
  }
  if (variants.length) {
    ev.push(evidence("variants", f.styles!.ev, "scss-static", 0.9, { location: `${f.styles!.ev.location} (block modifiers of .${block})` }));
    if (variants.some((v) => v.description)) ev.push(evidence("variants", f.docs!.ev, "docs-markdown", 0.85, { location: `${f.docs!.ev.location} (sections describing modifiers)` }));
  }
  coverage.variants = variants.length ? "documented" : f.styles ? "not-documented" : "not-extracted";

  // Sizes
  const sizes = variants.filter((v) => v.axis === "size").map((v) => v.name);
  coverage.sizes = sizes.length ? "documented" : f.styles ? "not-documented" : "not-extracted";

  // States
  const stateList: NormalizedComponent["states"] = [];
  const addState = (n: string, canonical: string, description: string | null, sourceUrl: string | null) => {
    if (stateList.some((s) => s.name.toLowerCase() === n.toLowerCase())) return;
    stateList.push({ name: n, canonical: canonicalState(canonical) ?? canonical, description, sourceUrl });
  };
  const exStates = f.params ? statesFromExamples(f.params.data.examples) : [];
  for (const s of exStates) addState(s.name, s.canonicalHint, null, paramUrl);
  const pStates = statesFromParams(params);
  for (const s of pStates) addState(s.name, s.canonicalHint, s.description, paramUrl);
  for (const s of modStates) addState(s.name, s.canonical, null, f.styles?.ev.sourceUrl ?? null);
  if (doc?.errorMessages) addState("Error", "error", doc.errorMessages, docsUrl);
  if (exStates.length) ev.push(evidence("states", f.params!.ev, "params-yaml", 0.9, { location: `${f.params!.ev.location}#examples (${exStates.map((s) => s.via).join(", ")})` }));
  if (pStates.length) ev.push(evidence("states", f.params!.ev, f.params!.fromTag ? "params-yaml" : "macro-options-json", 0.85, { location: `${f.params!.ev.location}#${pStates.map((s) => s.via).join(", ")}` }));
  if (modStates.length) ev.push(evidence("states", f.styles!.ev, "scss-static", 0.85, { location: `${f.styles!.ev.location} (${modStates.map((s) => s.via).join(", ")})` }));
  if (doc?.errorMessages) ev.push(evidence("states", f.docs!.ev, "docs-markdown", 0.9, { location: `${f.docs!.ev.location}#Error messages`, excerpt: doc.errorMessages }));
  coverage.states = stateList.length ? "documented" : f.params || f.styles ? "not-documented" : "not-extracted";

  // Accessibility
  const docKb: KeyboardInteraction[] = (doc?.keyboard ?? []).map((k) => ({ keys: k.keys, action: k.action }));
  const jsKb: KeyboardInteraction[] = (f.js?.data.keyHandlers ?? []).map((h) => ({ keys: h.keys.join(" / "), action: humanizeMethod(h.method) }));
  const keyboard = uniqBy([...docKb, ...jsKb], (k) => `${k.keys}|${k.action.toLowerCase()}`).slice(0, 16);
  const roles = [...new Set([...(f.template?.data.roles ?? []), ...(f.js?.data.roles ?? [])])].sort();
  const guidanceSentences = doc?.a11y.guidance ?? [];
  const guidance = guidanceSentences.length ? clip(guidanceSentences.join(" "), 1200) : null;
  const screenReader = doc?.a11y.screenReader.length ? clip(doc.a11y.screenReader.join(" "), 800) : null;
  const focusManagement = doc?.a11y.focus.length ? clip(doc.a11y.focus.join(" "), 800) : null;
  const wcag = doc?.a11y.wcag ?? [];
  const docState = (has: boolean): CoverageState => (has ? "documented" : f.docs ? "not-documented" : "not-extracted");
  const kbState: CoverageState = docKb.length ? "documented" : jsKb.length ? "inferred" : f.docs ? "not-documented" : "not-extracted";
  const rolesState: CoverageState = roles.length ? "documented" : f.template || f.js ? "not-documented" : "not-extracted";
  const acov: Record<string, CoverageState> = {
    keyboard: kbState,
    guidance: docState(!!guidance),
    screenReader: docState(!!screenReader),
    focusManagement: docState(!!focusManagement),
    roles: rolesState,
    ariaPattern: f.docs ? "not-documented" : "not-extracted",
    wcagCriteria: docState(wcag.length > 0),
  };
  const anyA11y = keyboard.length || roles.length || guidance || screenReader || focusManagement || wcag.length;
  const accessibility: NormalizedComponent["accessibility"] = anyA11y
    ? {
        ariaPattern: null,
        roles: roles.length ? roles : null,
        keyboard: keyboard.length ? keyboard : null,
        guidance,
        screenReader,
        focusManagement,
        wcagCriteria: wcag.length ? wcag : null,
        docsUrl,
        coverage: acov,
      }
    : null;
  if (guidance || screenReader || focusManagement || wcag.length) ev.push(evidence("accessibility", f.docs!.ev, "docs-markdown", 0.85, { location: `${f.docs!.ev.location} (${doc!.a11y.sections.slice(0, 4).join("; ")})`, excerpt: guidanceSentences[0] ?? null }));
  if (f.template?.data.roles.length) ev.push(evidence("accessibility", f.template.ev, "template-njk", 0.9, { location: `${f.template.ev.location} (role=${f.template.data.roles.join(", ")})` }));
  if (f.js?.data.roles.length) ev.push(evidence("accessibility", f.js.ev, "js-static", 0.85, { location: `${f.js.ev.location} (setAttribute role ${f.js.data.roles.join(", ")})` }));
  if (docKb.length) ev.push(evidence("keyboard", f.docs!.ev, "docs-markdown", 0.85, { location: `${f.docs!.ev.location}#${doc!.keyboard[0]!.section ?? "intro"}`, excerpt: doc!.keyboard[0]!.action }));
  if (jsKb.length) ev.push(evidence("keyboard", f.js!.ev, "js-static", 0.6, { state: "inferred", location: `${f.js!.ev.location} (switch (event.key): ${f.js!.data.keyHandlers.map((h) => `${h.keys.join("/")} -> ${h.method}()`).join("; ")})` }));
  const a11yStates = Object.entries(acov).filter(([k]) => k !== "ariaPattern").map(([, v]) => v);
  coverage.accessibility = a11yStates.includes("documented") ? "documented" : a11yStates.includes("inferred") ? "inferred" : f.docs || f.template ? "not-documented" : "not-extracted";
  coverage.keyboard = kbState;

  // Responsive
  const responsiveGuidance = doc?.responsive.length ? clip(doc.responsive.join(" "), 800) : null;
  if (responsiveGuidance) ev.push(evidence("responsive", f.docs!.ev, "docs-markdown", 0.8, { excerpt: doc!.responsive[0]! }));
  coverage.responsive = responsiveGuidance ? "documented" : f.docs ? "not-documented" : "not-extracted";

  // Token usages (SCSS static analysis of the component stylesheet)
  const tokenUsages = uniqBy(
    (f.styles?.data.usages ?? []).map((u) => ({ tokenName: cx.fixRef(u.tokenName), property: u.property })).filter((u) => cx.tokenNames.has(u.tokenName)),
    (u) => `${u.tokenName}|${u.property}`,
  ).slice(0, 200);
  if (tokenUsages.length) ev.push(evidence("tokens", f.styles!.ev, "scss-static", 0.9, { location: `${f.styles!.ev.location} (helper calls and $${P.prefix}-* settings)` }));
  coverage.tokens = tokenUsages.length ? "documented" : f.styles ? "not-documented" : "not-extracted";

  // Examples
  const examples: NormalizedComponent["examples"] = [];
  const exSlugs = new Set<string>();
  const addEx = (base: string, ex: Omit<NormalizedComponent["examples"][number], "slug">) => {
    const b = slugify(base) || "example";
    let s = b;
    for (let i = 2; exSlugs.has(s); i++) s = `${b}-${i}`;
    exSlugs.add(s);
    examples.push({ slug: s, ...ex });
  };
  for (const e of (doc?.examples ?? []).slice(0, 30)) {
    const group = e.group ?? "components";
    const itemSlug = e.item ?? item.docSlug ?? item.slug;
    addEx(`${itemSlug === item.slug ? "" : `${itemSlug}-`}${e.example}`, {
      title: `${humanize(e.example)}${e.heading ? ` (${e.heading})` : ""}`,
      kind: "docs-link",
      url: P.docs.exampleUrl(group, itemSlug, e.example),
      attribution: P.docsAttribution,
    });
  }
  if (doc?.examples.length) ev.push(evidence("examples", f.docs!.ev, "docs-markdown", 0.9, { location: `${f.docs!.ev.location} (example() calls)` }));
  if (f.html?.html && cx.version) {
    addEx("default-html", { title: "Default example (HTML)", kind: "code-snippet", language: "html", code: f.html.html, url: f.html.ev.sourceUrl, attribution: P.codeAttribution(cx.version) });
    ev.push(evidence("examples", f.html.ev, "html-fixture", 0.95));
  }
  coverage.examples = examples.length ? "documented" : f.docs ? "not-documented" : "not-extracted";

  // Relationships
  const relationships: NormalizedComponent["relationships"] = [];
  const addRel = (kind: string, target: string | undefined) => {
    if (!target || target === item.slug || relationships.some((r) => r.targetSlug === target && r.kind === kind)) return;
    relationships.push({ kind, targetSlug: target, targetType: null });
  };
  const composed = params.filter((p) => p.isComponent && p.depth === 0);
  for (const p of composed) addRel("composes", cx.slugByFrontend.get(optionToComponent(p.name)));
  for (const imp of f.template?.data.imports ?? []) addRel("composes", cx.slugByFrontend.get(imp));
  if (composed.length) ev.push(evidence("relationships", f.params!.ev, f.params!.fromTag ? "params-yaml" : "macro-options-json", 0.9, { location: `${f.params!.ev.location}#params (isComponent: ${composed.map((p) => p.name).join(", ")})` }));
  if (f.template?.data.imports.length) ev.push(evidence("relationships", f.template.ev, "template-njk", 0.9, { location: `${f.template.ev.location} (imports ${f.template.data.imports.join(", ")})` }));
  const docRels = (doc?.componentLinks ?? []).filter((l) => cx.slugByDoc.has(l.slug));
  for (const l of docRels) addRel(l.alternative ? "alternative" : "related", cx.slugByDoc.get(l.slug));
  if (docRels.length) ev.push(evidence("relationships", f.docs!.ev, "docs-markdown", 0.85, { location: `${f.docs!.ev.location} (links to component pages)` }));
  coverage.relationships = relationships.length ? "documented" : f.docs ? "not-documented" : "not-extracted";

  // Aliases
  const aliases = uniqBy(
    [...(doc?.aliases ?? []), ...(macroName ? [macroName] : []), ...(item.frontend && item.frontend !== item.slug ? [item.frontend] : [])].filter((a) => normKey(a) !== normKey(name)),
    (a) => a.toLowerCase(),
  );

  const cls = classify(name, item.frontend, doc?.aliases ?? [], P.npmPkg);
  return {
    slug: item.slug,
    name,
    aliases,
    description,
    docsUrl,
    sourceCodeUrl: srcDir,
    lifecycle,
    canonicalType: cls?.slug ?? null,
    classification: cls ? { state: cls.state, method: cls.method, confidence: cls.confidence } : null,
    frameworks,
    variants,
    states: stateList,
    sizes: sizes.length ? sizes : null,
    properties,
    accessibility,
    examples,
    relationships,
    tokenUsages,
    responsiveGuidance,
    coverage,
    evidence: uniqBy(ev, (e) => `${e.field}|${e.sourceUrl}|${e.location}`),
  };
}

/* --------------------------------- tokens --------------------------------- */

/** "govuk-palette.white.primary" -> "govuk-palette.white" when white has no variants; pre-brand names -> correspondence table. */
export function makeRefFixer(names: Set<string>): (ref: string) => string {
  return (ref: string) => {
    if (names.has(ref)) return ref;
    const m = /^govuk-palette\.([\w-]+)\.([\w-]+)$/.exec(ref);
    if (m) {
      if (m[2] === "primary" && names.has(`govuk-palette.${m[1]}`)) return `govuk-palette.${m[1]}`;
      if (m[2] === "primary" && names.has(`govuk-pre-brand-colours.${m[1]}`)) return `govuk-pre-brand-colours.${m[1]}`;
    }
    return ref;
  };
}

function fixRawValue(raw: string | number, refs: string[], fix: (r: string) => string): { rawValue: string | number; references: string[] } {
  if (typeof raw !== "string" || !refs.length) return { rawValue: raw, references: refs };
  const rawValue = raw.replace(/\{([^{}]+)\}/g, (_m, r: string) => `{${fix(r)}}`);
  return { rawValue, references: [...new Set(refs.map(fix))] };
}

function tokenDescription(t: SettingsToken, extra: string[]): string | null {
  const parts = [...extra, t.comment, t.doc, t.deprecated ? `Deprecated${t.deprecationNote ? `: ${t.deprecationNote}` : "."}` : null].filter((x): x is string => !!x);
  return parts.length ? clip(parts.join(" "), 600) : null;
}

const CSS_VAR_RULES: { re: RegExp; cssVar: (m: RegExpExecArray) => string }[] = [
  { re: /^govuk-functional-colours\.([\w-]+)$/, cssVar: (m) => `--govuk-${m[1]}-colour` },
  { re: /^(govuk|nhsuk)-breakpoints\.([\w-]+)$/, cssVar: (m) => `--${m[1]}-breakpoint-${m[2]}` },
  { re: /^nhsuk-colours\.([\w-]+)$/, cssVar: (m) => `--nhsuk-${m[1]}-colour` },
  { re: /^(nhsuk-[\w-]+-colour)$/, cssVar: (m) => `--${m[1]}` },
];

function buildTokenSets(
  P: FrontendProfile,
  settings: F<"settings">[],
  css: F<"css"> | undefined,
  colours: F<"colours-json"> | undefined,
  warnings: string[],
): { sets: NormalizedTokenSet[]; names: Set<string>; fix: (r: string) => string } {
  const declared = new Set(css?.customProperties ?? []);
  const docColours = new Map((colours?.colours ?? []).map((c) => [c.name, c]));
  const fileOrder = new Map(P.settingsFiles.map((s, i) => [s.file, i]));
  const ordered = [...settings].sort((a, b) => (fileOrder.get(a.file) ?? 99) - (fileOrder.get(b.file) ?? 99) || a.file.localeCompare(b.file));
  const allNames = new Set<string>();
  for (const s of ordered) for (const t of s.data.tokens) allNames.add(t.name);
  const fix = makeRefFixer(allNames);
  const bySet = new Map<TokenSetKey, { frags: F<"settings">[]; tokens: NormalizedToken[] }>();
  for (const s of ordered) {
    let g = bySet.get(s.set);
    if (!g) bySet.set(s.set, (g = { frags: [], tokens: [] }));
    g.frags.push(s);
    for (const t of s.data.tokens) {
      if (g.tokens.some((x) => x.name === t.name)) {
        warnings.push(`${s.file}: duplicate token ${t.name}; kept first`);
        continue;
      }
      const { rawValue, references } = fixRawValue(t.rawValue, t.references, fix);
      let cssVar: string | null = null;
      for (const r of CSS_VAR_RULES) {
        const m = r.re.exec(t.name);
        if (m && declared.has(r.cssVar(m))) cssVar = r.cssVar(m);
      }
      const extra: string[] = [];
      const fn = /^govuk-functional-colours\.([\w-]+)$/.exec(t.name);
      const dc = fn ? docColours.get(fn[1]!) : undefined;
      if (dc) extra.push(`Docs colour group: ${dc.group}.`, ...(dc.notes ? [/[.!?]$/.test(dc.notes) ? dc.notes : `${dc.notes}.`] : []));
      g.tokens.push({
        name: t.name,
        path: t.path,
        cssVar,
        type: tokenType(s.set, t.name, rawValue),
        category: tokenCategory(s.set, t.name),
        tier: tokenTier(s.set, t.name),
        tierState: "inferred",
        rawValue,
        references,
        description: tokenDescription(t, extra),
        deprecated: t.deprecated,
        location: `${s.file.startsWith("components/") ? P.componentsDir.replace(/\/components$/, "") : P.settingsDir}/${s.file}#L${t.line}`,
      });
    }
  }
  const sets: NormalizedTokenSet[] = [];
  const keys = [...bySet.keys()].sort((a, b) => TOKEN_SET_ORDER.indexOf(a) - TOKEN_SET_ORDER.indexOf(b));
  for (const key of keys) {
    const g = bySet.get(key)!;
    if (!g.tokens.length) continue;
    const first = g.frags[0]!;
    const version = first.version;
    const ev = g.frags.map((s) =>
      evidence("tokens", s.ev, "scss-settings", 0.95, {
        excerpt: `${s.data.tokens.length} tokens from ${[...new Set(s.data.tokens.map((t) => `$${t.variable}`))].slice(0, 6).join(", ")}${s.data.skipped.length ? `; skipped ${s.data.skipped.length} (${[...new Set(s.data.skipped.map((x) => x.reason))].join(", ")})` : ""}`,
      }),
    );
    if (css && g.tokens.some((t) => t.cssVar)) ev.push(evidence("cssVar", css.ev, "compiled-css", 0.9, { location: `${css.ev.location} (:root custom properties)` }));
    if (colours && key === "functional-colours") ev.push(evidence("description", colours.ev, "docs-colours-json", 0.85, { location: `${colours.ev.location}#/functional` }));
    sets.push({
      slug: key,
      name: `${P.setNames[key] ?? key} (${P.npmPkg} ${version})`,
      theme: null,
      format: "scss",
      sourceUrl: first.ev.sourceUrl,
      packageName: P.npmPkg,
      packageVersion: version,
      license: P.license(version),
      redistribution: "permitted",
      tokens: g.tokens,
      evidence: ev,
    });
  }
  return { sets, names: allNames, fix };
}

/* -------------------------------- patterns -------------------------------- */

const THEME_TYPES: Record<string, string> = { "ask users for": "data-entry" };

function buildPatterns(P: FrontendProfile, frags: F<"docs-pattern">[], slugByDoc: Map<string, string>, limit?: number): NormalizedPattern[] {
  const live = sortBy(frags.filter((p) => !p.data.archived && p.data.title), (p) => p.docSlug);
  return (limit ? live.slice(0, limit) : live).map((p) => {
    const d = p.data;
    const name = d.title!;
    const exact = classifyPatternName(name);
    let cls: NormalizedPattern["classification"] = null;
    let canonicalType: string | null = null;
    if (exact && exact.confidence >= 0.8) {
      canonicalType = exact.slug;
      cls = { state: "inferred", method: exact.method, confidence: exact.confidence };
    } else {
      const theme = d.theme ? d.theme.replace(/[….]+$/u, "").trim().toLowerCase() : null;
      const byTheme = theme ? THEME_TYPES[theme] : undefined;
      const byAlias = d.aliases.map((a) => classifyPatternName(a)).find((c) => c && c.confidence >= 0.8);
      if (byTheme) {
        canonicalType = byTheme;
        cls = { state: "inferred", method: `docs-theme:"${d.theme}"`, confidence: 0.6 };
      } else if (byAlias) {
        canonicalType = byAlias.slug;
        cls = { state: "inferred", method: `${byAlias.method} (docs alias)`, confidence: 0.6 };
      }
    }
    const componentSlugs = uniqBy(d.componentLinks.map((l) => slugByDoc.get(l.slug)).filter((s): s is string => !!s), (s) => s);
    const ev: EvidenceInput[] = [evidence("*", p.ev, "docs-markdown", 0.95, { location: `${p.ev.location}#frontmatter.title`, excerpt: name })];
    if (d.description) ev.push(evidence("description", p.ev, "docs-markdown", 0.95, { location: `${p.ev.location}#frontmatter.description`, excerpt: d.description }));
    if (componentSlugs.length) ev.push(evidence("componentSlugs", p.ev, "docs-markdown", 0.85, { location: `${p.ev.location} (links to component pages)` }));
    for (const [field, text, heading] of [
      ["whenToUse", d.whenToUse, "When to use"],
      ["whenNotToUse", d.whenNotToUse, "When not to use"],
      ["howItWorks", d.howItWorks, "How it works"],
      ["research", d.research, "Research"],
    ] as const) {
      if (text) ev.push(evidence(field, p.ev, "docs-markdown", 0.9, { location: `${p.ev.location}#${heading}`, excerpt: text }));
    }
    if (d.examples.length) ev.push(evidence("examples", p.ev, "docs-markdown", 0.9, { location: `${p.ev.location} (${d.examples.length} example() calls)` }));
    return {
      slug: slugify(p.docSlug),
      name,
      description: d.description,
      docsUrl: docsUrlFor(P, "patterns", p.docSlug),
      canonicalType,
      classification: cls,
      componentSlugs,
      coverage: {
        description: d.description ? "documented" : "not-documented",
        components: componentSlugs.length ? "documented" : "not-documented",
        whenToUse: d.whenToUse ? "documented" : "not-documented",
        whenNotToUse: d.whenNotToUse ? "documented" : "not-documented",
        howItWorks: d.howItWorks ? "documented" : "not-documented",
        research: d.research ? "documented" : "not-documented",
        examples: d.examples.length ? "documented" : "not-documented",
      },
      evidence: ev,
    };
  });
}

/* ---------------------------------- facts ---------------------------------- */

function buildFacts(
  P: FrontendProfile,
  pkg: F<"pkg"> | undefined,
  home: F<"home"> | undefined,
  principles: F<"principles"> | undefined,
  macros: F<"macros"> | undefined,
  listing: F<"listing"> | undefined,
  macroFrags: F<"macro">[],
): NormalizedSystemFacts | null {
  const ev: EvidenceInput[] = [];
  const facts: NormalizedSystemFacts = { evidence: ev };
  if (pkg) {
    facts.latestVersion = pkg.version;
    ev.push(evidence("latestVersion", pkg.ev, "npm-registry", 0.95, { excerpt: `${pkg.name}@${pkg.version}${pkg.license ? ` (${pkg.license})` : ""}` }));
    if (pkg.publishedAt) {
      facts.latestReleaseAt = pkg.publishedAt;
      ev.push(evidence("latestReleaseAt", pkg.ev, "npm-registry", 0.95, { excerpt: `published ${pkg.publishedAt}` }));
    }
  }
  const humanUrl = P.principles.humanUrl;
  // GOV.UK: the principles live on GOV.UK and the design system states that it follows them;
  // NHS: the principles page is part of the design system section of the service manual.
  const followsPrinciples = P.principles.kind === "docs-page" || !!home?.data.principleLinks.some((l) => l.url.startsWith(humanUrl));
  if (P.id === "govuk" && home?.data.principlesText && followsPrinciples) {
    facts.philosophy = "ATLAS summary: the GOV.UK Design System exists to help teams that work on government services follow the Government Design Principles and the GOV.UK Service Manual.";
    ev.push(evidence("philosophy", home.ev, "docs-home", 0.85, { location: `${home.ev.location} ("Principles we follow")`, excerpt: home.data.principlesText }));
  } else if (P.id === "nhs" && home?.data.description) {
    facts.philosophy = "ATLAS summary: the NHS design system aims to help teams build consistent, accessible NHS services for the public and staff, drawing on the research and experience of other NHS digital teams.";
    ev.push(evidence("philosophy", home.ev, "docs-home", 0.85, { location: `${home.ev.location} (pageDescription)`, excerpt: home.data.description }));
  }
  if (principles?.principles.length && followsPrinciples) {
    facts.principles = principles.principles.map((p) => ({ name: p.name, sourceUrl: p.anchor ? `${humanUrl}#${p.anchor}` : humanUrl }));
    ev.push(evidence("principles", principles.ev, P.principles.kind === "govuk-content-api" ? "govuk-content-api" : "docs-principles", 0.9, { excerpt: `${principles.title ?? "Design principles"}: ${principles.principles.map((p) => p.name).join("; ")}` }));
    if (P.principles.kind === "govuk-content-api" && home) ev.push(evidence("principles", home.ev, "docs-home", 0.85, { location: `${home.ev.location} (links to Government Design Principles)`, excerpt: home.data.principlesText }));
  }
  const nMacros = macros ? Object.keys(macros.macros).length : macroFrags.filter((m) => m.macroName).length;
  if (nMacros || listing) {
    facts.frameworks = [...(listing ? [{ slug: "html-css", packageName: P.npmPkg }] : []), ...(nMacros ? [{ slug: "nunjucks", packageName: P.npmPkg }] : [])];
    if (macros && nMacros) ev.push(evidence("frameworks", macros.ev, "prototype-kit-config", 0.95, { location: `${macros.ev.location}#nunjucksMacros`, excerpt: `${nMacros} Nunjucks macros` }));
    else if (nMacros) ev.push(evidence("frameworks", macroFrags.find((m) => m.macroName)!.ev, "macro-njk", 0.9, { excerpt: `${nMacros} component macro.njk files with a Nunjucks macro` }));
    if (listing) ev.push(evidence("frameworks", listing.ev, "npm-listing", 0.9, { excerpt: `${listing.components.length} component folders with HTML templates` }));
  }
  return ev.length ? facts : null;
}

/* --------------------------------- bundle ---------------------------------- */

export interface NormalizeResult {
  bundle: NormalizedBundle;
  warnings: string[];
  /** Functional colours whose source-resolved hex differs from the docs colour table. */
  colourMismatches: { name: string; source: string; docs: string }[];
}

export function normalizeGovuk(systemSlug: string, fragments: { data: unknown }[], opts: { limit?: number; profile?: FrontendProfile } = {}): NormalizeResult {
  const P = opts.profile ?? profileFor(systemSlug) ?? GOVUK;
  const frags = fragments.map((f) => f.data as GovukFragment).filter((f) => f && typeof f === "object" && "t" in f);
  const warnings: string[] = [];
  const one = <K extends GovukFragment["t"]>(t: K) => frags.find((f) => f.t === t) as F<K> | undefined;
  const all = <K extends GovukFragment["t"]>(t: K) => frags.filter((f) => f.t === t) as F<K>[];
  const pkg = one("pkg");
  const listing = one("listing");
  const sitemap = one("sitemap");
  const version = pkg?.version ?? listing?.version ?? null;

  const docsComponents = all("docs-component");
  const plan = planComponents(listing, sitemap, docsComponents.map((d) => d.docSlug), opts.limit, P);
  const slugByFrontend = new Map(plan.filter((p) => p.frontend).map((p) => [p.frontend!, p.slug]));
  const slugByDoc = new Map(plan.filter((p) => p.docSlug).map((p) => [p.docSlug!, p.slug]));

  const tok = buildTokenSets(P, all("settings"), one("css"), one("colours-json"), warnings);

  const byComp = new Map<string, ByComponent>();
  const get = (slug: string | undefined) => {
    if (!slug) return null;
    let b = byComp.get(slug);
    if (!b) byComp.set(slug, (b = {}));
    return b;
  };
  for (const d of docsComponents) {
    const b = get(slugByDoc.get(d.docSlug));
    if (b) b.docs = d;
  }
  for (const f of frags) {
    if (!("name" in f) || f.t === "pkg") continue;
    const b = get(slugByFrontend.get((f as { name: string }).name));
    if (!b) continue;
    if (f.t === "readme") b.readme = f;
    else if (f.t === "macro") b.macro = f;
    else if (f.t === "params") b.params = !b.params || (f.fromTag && !b.params.fromTag) ? f : b.params;
    else if (f.t === "template") b.template = f;
    else if (f.t === "styles") b.styles = f;
    else if (f.t === "js") b.js = f;
    else if (f.t === "html-example") b.html = f;
  }

  const cx: Ctx = { profile: P, version, macros: one("macros"), lifecycle: one("lifecycle"), slugByFrontend, slugByDoc, tokenNames: tok.names, fixRef: tok.fix };
  const components: NormalizedComponent[] = [];
  for (const item of plan) {
    const f = byComp.get(item.slug) ?? {};
    if (!f.docs && !f.params && !f.template && !f.styles && !f.readme) {
      warnings.push(`${item.slug}: no source document parsed; component skipped`);
      continue;
    }
    components.push(buildComponent(item, f, cx));
  }

  const patterns = buildPatterns(P, all("docs-pattern"), slugByDoc, opts.limit);

  // Cross-check: functional colour defaults vs docs colour table.
  const colourMismatches: NormalizeResult["colourMismatches"] = [];
  const palette = new Map<string, unknown>();
  for (const s of tok.sets) for (const t of s.tokens) palette.set(t.name, t.rawValue);
  for (const c of one("colours-json")?.colours ?? []) {
    const raw = palette.get(`govuk-functional-colours.${c.name}`);
    if (raw === undefined || !c.colour) continue;
    const m = typeof raw === "string" ? /^\{([^{}]+)\}$/.exec(raw) : null;
    const resolved = m ? palette.get(m[1]!) : raw;
    if (typeof resolved === "string" && resolved.toLowerCase() !== c.colour) colourMismatches.push({ name: c.name, source: resolved, docs: c.colour });
  }

  const facts = buildFacts(P, pkg, one("home"), one("principles"), one("macros"), listing, all("macro"));
  return { bundle: { systemSlug, components, tokenSets: tok.sets, patterns, facts }, warnings, colourMismatches };
}

