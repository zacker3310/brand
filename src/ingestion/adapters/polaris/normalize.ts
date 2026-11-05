/**
 * Merge Polaris fragments into a NormalizedBundle.
 *
 * Two component families are modeled as separate records because their lifecycles differ:
 *  - Polaris web components (current, App Home): slug = tag without "s-" ("button"); properties from
 *    the Custom Elements Manifest (implementation "web-components"), docs from shopify.dev Markdown.
 *  - Polaris React (deprecated): slug "react-<docs slug>"; docs from the archived polaris.shopify.com
 *    MDX, props from @shopify/polaris type declarations (implementation "react"); lifecycle
 *    "deprecated" per the npm deprecation notice. MDX `webComponent` mappings become "replaced-by".
 * Tokens: four theme sets from @shopify/polaris-tokens styles.css (redistribution restricted).
 * No code is stored (Polaris License field-of-use restriction; @shopify/polaris-types has no license).
 */
import type { CoverageState, EvidenceInput, KeyboardInteraction, NormalizedBundle, NormalizedComponent, NormalizedPattern, NormalizedSystemFacts, NormalizedTokenSet } from "@/lib/contracts";
import { canonicalState, classifyComponentName, classifyPatternName, componentTypeBySlug } from "@/lib/taxonomy";
import { slugify } from "@/lib/utils";
import { githubBlobUrl, npmFileUrl } from "../../http";
import { displayType, type WcElement } from "./cem";
import {
  ARCHIVE_DOCS_REF,
  ARCHIVE_EXAMPLES_DIR,
  ARCHIVE_REPO,
  ARCHIVE_REPO_URL,
  METHOD,
  polarisLicense,
  REACT_PKG,
  STATE_PROPS,
  storybookStoryUrl,
  TOKEN_THEMES,
  TOKENS_PKG,
  TYPES_PKG,
  VARIANT_AXIS_PROPS,
} from "./constants";
import type { DocApiSection, DocProp, WcPage } from "./devdocs";
import type { NpmInfo, PolarisFragmentData, ReactProp, StoryRef } from "./fragments";
import { componentPathFromLink, phraseKeys, type ReactMdxDoc } from "./mdx";
import { clip, evidence, firstSentence, literalUnion, sortBy, type Stamp, uniq } from "./text";
import { themeTokens, toPolarisToken } from "./tokens";

export interface NormalizeOptions {
  systemSlug: string;
  limit?: number;
  log?: (msg: string) => void;
}

type Frag<T extends PolarisFragmentData["type"]> = Extract<PolarisFragmentData, { type: T }>;
type NormalizedProperty = NormalizedComponent["properties"][number];
type CoverageMap = Record<string, CoverageState>;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const npmPage = (pkg: string) => `https://www.npmjs.com/package/${pkg}`;
const tagRef = (pkg: string, version: string) => encodeURIComponent(`${pkg}@${version}`);

function npmStamp(npm: NpmInfo, retrievedAt: string): Stamp {
  return { url: `https://registry.npmjs.org/${npm.packageName.replace("/", "%2F")}`, evidenceUrl: npmPage(npm.packageName), retrievedAt, hash: null };
}

/**
 * Taxonomy classification (inferred unless the source names the WAI-ARIA pattern). Weak "contained alias"
 * matches are kept only when the alias is the trailing head noun ("Index filters" -> filter) and never for
 * subcomponents ("Table header" is not a page header); everything else stays unclassified.
 */
export function classify(names: string[], ariaPattern: string | null, opts: { subcomponent?: boolean } = {}): NormalizedComponent["classification"] & { slug: string | null } {
  if (ariaPattern && componentTypeBySlug.has(ariaPattern)) return { slug: ariaPattern, state: "verified", method: `source-aria-pattern:${ariaPattern}`, confidence: 0.95 };
  for (const n of names) {
    const c = classifyComponentName(n);
    if (!c) continue;
    const contained = /^alias-contained:(.+)$/.exec(c.method);
    if (contained) {
      if (opts.subcomponent) continue;
      const words = n.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      const alias = contained[1]!;
      const singular = words.replace(/s$/, "");
      if (!(words.endsWith(` ${alias}`) || words === alias || singular.endsWith(` ${alias}`))) continue;
    }
    return { slug: c.slug, state: "inferred", method: c.method, confidence: c.confidence };
  }
  return { slug: null, state: "inferred", method: "unclassified", confidence: 0 };
}

/** Per-value notes in descriptions: "- `critical`: Urgent problems. - `auto`: …". */
export function valueNotes(text: string | null | undefined): Map<string, string> {
  const out = new Map<string, string>();
  if (!text) return out;
  for (const m of text.matchAll(/`([^`]+)`:\s*(.+?)(?=\s+-\s+`[^`]+`:|\s+\*\s+`[^`]+`:|$)/g)) {
    const v = clip(m[2]!.replace(/\s+-\s*$/, ""), 200);
    if (v && !out.has(m[1]!)) out.set(m[1]!, v);
  }
  return out;
}

/** Description text with per-value bullet notes removed (they become variant descriptions). */
function leadText(text: string | null | undefined): string | null {
  if (!text) return null;
  const cut = text.search(/\s(?:-|\*)\s+`[^`]+`:/);
  return cut > 0 ? text.slice(0, cut) : text;
}

function variantsFromProps(props: NormalizedProperty[], notes: Map<string, Map<string, string>>, sourceUrl: string | null, locationPrefix: string): NormalizedComponent["variants"] {
  const out: NormalizedComponent["variants"] = [];
  for (const p of props) {
    if (!VARIANT_AXIS_PROPS.has(p.name) || !p.allowedValues?.length) continue;
    for (const v of p.allowedValues) {
      if (!v) continue;
      out.push({ axis: p.name, name: v, description: notes.get(p.name)?.get(v) ?? null, sourceUrl: sourceUrl ?? undefined, location: `${locationPrefix}.${p.name}` });
    }
  }
  return out;
}

function statesFromProps(props: NormalizedProperty[], sourceUrl: string | null): NormalizedComponent["states"] {
  const out: NormalizedComponent["states"] = [];
  const seen = new Set<string>();
  for (const p of props) {
    const state = STATE_PROPS[p.name];
    if (!state || seen.has(state) || p.type === "event" || p.type === "slot") continue;
    const isBool = /^(boolean|true|false)(\s*\|\s*(null|undefined))*$/.test((p.type ?? "").trim()) || /\bboolean\b/.test(p.type ?? "");
    if (!isBool && p.name !== "error") continue;
    seen.add(state);
    out.push({ name: state, canonical: canonicalState(state), description: clip(p.description, 200), sourceUrl: sourceUrl ?? undefined });
  }
  return out;
}

function sizesFromProps(props: NormalizedProperty[]): string[] {
  const p = props.find((x) => x.name === "size" && x.allowedValues?.length);
  return p ? [...p.allowedValues!] : [];
}

const A11Y_RE =
  /\b(accessibility\w*|accessible (?:name|label)s?|screen readers?|assistive technolog\w*|keyboard|focusable|(?:receive|move|moves|keep|trap|return)s? focus|focus (?:state|ring|order|indicator|management)|aria-[a-z]+|tab order|alt text|alternative text)\b/i;

const RESPONSIVE_PROSE = /\b(responsive|smaller screens?|small screens?|mobile|breakpoints?|narrow (?:screens?|viewports?))\b/i;

function dedupeExamples(ex: NormalizedComponent["examples"]): NormalizedComponent["examples"] {
  const seen = new Set<string>();
  const out: NormalizedComponent["examples"] = [];
  for (const e of ex) {
    let slug = e.slug || "example";
    let i = 2;
    while (seen.has(slug)) slug = `${e.slug}-${i++}`;
    seen.add(slug);
    out.push({ ...e, slug });
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Web components                                                              */
/* -------------------------------------------------------------------------- */

interface WcContext {
  cem: Frag<"cem">;
  pages: Map<string, Frag<"wc-page">>;
  index: Frag<"wc-index"> | null;
  versioning: Frag<"system-page"> | null;
  typesNpm: NpmInfo;
}

interface SubInfo {
  parentSlug: string;
  section: DocApiSection;
  page: Frag<"wc-page">;
}

export const wcSlugFromTag = (tag: string) => slugify(tag.replace(/^s-/, ""));
/** Web component docs URL -> component slug ("…/web-components/forms/text-field" -> "text-field"). */
export const wcSlugFromUrl = (url: string): string | null => {
  const m = /\/web-components\/[a-z0-9-]+\/([a-z0-9-]+)\/?$/.exec(url.split("#")[0]!.split("?")[0]!);
  return m ? m[1]! : null;
};

function wcProperties(el: WcElement, docApi: DocApiSection | null, cemUrl: string, docsUrl: string | null): { props: NormalizedProperty[]; notes: Map<string, Map<string, string>> } {
  const docProps = new Map((docApi?.props ?? []).map((p) => [p.name, p]));
  const notes = new Map<string, Map<string, string>>();
  const props: NormalizedProperty[] = [];
  const names = new Set<string>();
  for (const p of el.properties) {
    const d = docProps.get(p.name);
    const descSrc = d?.description ?? p.description;
    notes.set(p.name, valueNotes(p.description ?? d?.description));
    const attr = p.attribute && p.attribute !== p.name ? `Attribute \`${p.attribute}\`.` : null;
    const dep = d?.deprecated ? `Deprecated${d.deprecationNote ? `: ${d.deprecationNote}` : "."}` : null;
    props.push({
      implementation: "web-components",
      name: p.name,
      type: displayType(p.type),
      defaultValue: p.default,
      required: null,
      deprecated: !!d?.deprecated,
      description: clip([attr, firstSentence(leadText(descSrc), 360), dep].filter(Boolean).join(" "), 600),
      allowedValues: literalUnion(p.type),
      sourceUrl: cemUrl,
    });
    names.add(p.name);
  }
  // Properties documented on shopify.dev but absent from the pinned manifest.
  for (const d of docApi?.props ?? []) {
    if (names.has(d.name)) continue;
    names.add(d.name);
    props.push(docOnlyProp(d, docsUrl));
  }
  const docEvents = new Map((docApi?.events ?? []).map((e) => [e.name, e]));
  for (const e of el.events) {
    if (names.has(e.name)) continue;
    names.add(e.name);
    const d = docEvents.get(e.name);
    props.push({ implementation: "web-components", name: e.name, type: "event", defaultValue: null, required: null, deprecated: !!d?.deprecated, description: clip(`Event. ${firstSentence(d?.description ?? e.description, 360) ?? ""}`, 600), allowedValues: null, sourceUrl: cemUrl });
  }
  const docSlots = new Map((docApi?.slots ?? []).map((s) => [s.name, s]));
  for (const s of el.slots) {
    const name = s.name || "children";
    if (names.has(name)) continue;
    names.add(name);
    const d = docSlots.get(name);
    props.push({ implementation: "web-components", name, type: "slot", defaultValue: null, required: null, deprecated: false, description: clip(`Slot${s.name ? "" : " (default)"}. ${firstSentence(d?.description ?? s.description, 360) ?? ""}`, 600), allowedValues: null, sourceUrl: cemUrl });
  }
  return { props, notes };
}

function docOnlyProp(d: DocProp, docsUrl: string | null): NormalizedProperty {
  return {
    implementation: "web-components",
    name: d.name,
    type: displayType(d.type),
    defaultValue: d.defaultValue,
    required: null,
    deprecated: d.deprecated,
    description: clip([firstSentence(leadText(d.description), 360), d.deprecated ? `Deprecated${d.deprecationNote ? `: ${d.deprecationNote}` : "."}` : null].filter(Boolean).join(" "), 600),
    allowedValues: literalUnion(d.type),
    sourceUrl: docsUrl ?? undefined,
  };
}

function wcAccessibility(page: WcPage | null, docsUrl: string | null): { a11y: NormalizedComponent["accessibility"]; keyboard: KeyboardInteraction[]; items: string[] } {
  if (!page) return { a11y: null, keyboard: [], items: [] };
  const items = [...page.bestPractices, ...page.limitations, ...(page.guidelines ?? [])].filter((t) => A11Y_RE.test(t));
  if (!items.length) return { a11y: null, keyboard: [], items };
  const keyboard: KeyboardInteraction[] = [];
  for (const t of items) {
    const keys = phraseKeys(t);
    if (keys) keyboard.push({ keys, action: clip(t, 240)! });
  }
  return {
    a11y: {
      guidance: clip(items.join(" "), 600),
      keyboard: keyboard.length ? keyboard : null,
      roles: null,
      docsUrl: docsUrl ?? undefined,
      coverage: { guidance: "documented", keyboard: keyboard.length ? "documented" : "not-documented", roles: "not-documented", screenReader: "not-extracted", focusManagement: "not-extracted" },
    },
    keyboard,
    items,
  };
}

function buildWebComponents(w: WcContext, limit: number | undefined, log: (m: string) => void): NormalizedComponent[] {
  const cemUrl = w.cem.stamp.evidenceUrl;
  const indexItems = new Map((w.index?.page.items ?? []).map((it) => [wcSlugFromUrl(it.url) ?? "", it]));
  const byNorm = new Map(w.cem.elements.map((el) => [norm(el.className), el]));
  // Subcomponents documented on a parent page ("## Table row", "## Option group").
  const subOf = new Map<string, SubInfo>();
  const subsOfParent = new Map<string, string[]>();
  for (const [slug, pf] of sortBy([...w.pages.entries()], ([s]) => s)) {
    for (const sec of pf.page.api) {
      if (sec.main) continue;
      const el = byNorm.get(norm(sec.heading));
      if (!el) {
        if (sec.props.length || sec.events.length || sec.slots.length) log(`web components: API section "${sec.heading}" on ${slug} has no manifest element`);
        continue;
      }
      const subSlug = wcSlugFromTag(el.tagName);
      if (subSlug === slug || subOf.has(subSlug)) continue;
      subOf.set(subSlug, { parentSlug: slug, section: sec, page: pf });
      subsOfParent.set(slug, [...(subsOfParent.get(slug) ?? []), subSlug]);
    }
  }
  let elements = sortBy(w.cem.elements, (e) => e.tagName);
  if (limit) {
    const top = elements.filter((e) => !subOf.has(wcSlugFromTag(e.tagName))).slice(0, limit);
    const keep = new Set(top.map((e) => wcSlugFromTag(e.tagName)));
    for (const t of [...keep]) for (const s of subsOfParent.get(t) ?? []) keep.add(s);
    elements = elements.filter((e) => keep.has(wcSlugFromTag(e.tagName)));
  }
  const allSlugs = new Set(w.cem.elements.map((e) => wcSlugFromTag(e.tagName)));
  const versionEv = w.versioning?.page.documentedVersion ?? null;
  const out: NormalizedComponent[] = [];
  for (const el of elements) {
    const slug = wcSlugFromTag(el.tagName);
    const pf = w.pages.get(slug) ?? null;
    const sub = subOf.get(slug) ?? null;
    const page = pf?.page ?? null;
    const item = indexItems.get(slug) ?? null;
    const docsUrl = page?.htmlUrl ?? item?.url ?? sub?.page.page.htmlUrl ?? null;
    const documented = !!pf || !!sub;
    const name = page?.title || item?.title || sub?.section.heading || el.className;
    const docApi = page ? (page.api.find((a) => a.main) ?? null) : (sub?.section ?? null);
    const { props, notes } = wcProperties(el, docApi, cemUrl, docsUrl);
    const evidenceList: EvidenceInput[] = [];
    const cemLoc = `dist/custom-elements.json#${el.pointer}`;
    const ev = (stamp: Stamp, field: string, method: string, o: Parameters<typeof evidence>[3] = {}) => evidenceList.push(evidence(stamp, field, method, o));
    ev(w.cem.stamp, "name", METHOD.cem, { location: cemLoc, excerpt: `${el.tagName} (${el.className})`, title: `${TYPES_PKG}@${w.typesNpm.version} custom-elements.json` });
    ev(w.cem.stamp, "frameworks", METHOD.cem, { location: cemLoc, excerpt: `customElement tagName ${el.tagName}` });

    // description
    const descSrc = page ? (page.description ?? page.intro[0] ?? null) : null;
    const description = firstSentence(descSrc, 280) ?? (el.description ? firstSentence(el.description, 280) : null);
    if (description && pf) ev(pf.stamp, "description", METHOD.devMd, { location: "frontmatter.description", excerpt: description });
    else if (description) ev(w.cem.stamp, "description", METHOD.cem, { location: cemLoc, excerpt: description });

    // lifecycle
    let lifecycle: NormalizedComponent["lifecycle"] = "unknown";
    if (documented && w.versioning) {
      lifecycle = "stable";
      ev(w.versioning.stamp, "lifecycle", METHOD.devMd, {
        location: "Versioning for web components",
        excerpt: `${versionEv ? `This reference documents Polaris ${versionEv}.` : "Versioned web component library."} Component listed in the ${w.typesNpm.version} (non-prerelease) reference; no per-component status is published.`,
        state: "inferred",
        confidence: 0.7,
      });
    }

    const variants = variantsFromProps(props, notes, docsUrl ?? cemUrl, el.tagName);
    const sizes = sizesFromProps(props);
    const states = statesFromProps(props, docsUrl ?? cemUrl);
    if (props.length) ev(w.cem.stamp, "properties", METHOD.cem, { location: `${cemLoc}/members`, excerpt: `${el.properties.length} fields, ${el.events.length} events, ${el.slots.length} slots` });
    if (variants.length) ev(w.cem.stamp, "variants", METHOD.cem, { location: `${cemLoc}/members`, excerpt: uniq(variants.map((v) => v.axis)).map((a) => `${a}: ${variants.filter((v) => v.axis === a).map((v) => v.name).join(" | ")}`).join("; ") });
    if (sizes.length) ev(w.cem.stamp, "sizes", METHOD.cem, { location: `${cemLoc}/members (size)`, excerpt: sizes.join(" | ") });
    if (states.length) ev(w.cem.stamp, "states", METHOD.cem, { location: `${cemLoc}/members`, excerpt: `boolean props: ${states.map((s) => s.name).join(", ")}`, state: "inferred", confidence: 0.75 });
    if (docApi && pf && docApi.props.some((p) => p.deprecated)) ev(pf.stamp, "properties", METHOD.devMd, { location: "Properties", excerpt: `deprecated: ${docApi.props.filter((p) => p.deprecated).map((p) => p.name).join(", ")}` });

    // accessibility
    const { a11y, keyboard } = wcAccessibility(page, docsUrl);
    if (a11y && pf) ev(pf.stamp, "accessibility", METHOD.devMd, { location: "Best practices / Limitations / guidelines", excerpt: a11y.guidance });
    if (keyboard.length && pf) ev(pf.stamp, "keyboard", METHOD.devMd, { location: "Best practices / Limitations", excerpt: keyboard.map((k) => `${k.keys}: ${k.action}`).join("; ") });

    // examples (titles + docs link only; no code)
    const examples = dedupeExamples((page?.examples ?? []).slice(0, 20).map((e) => ({ slug: slugify(e.title).slice(0, 60) || "example", title: e.title, kind: "docs-link" as const, url: docsUrl ?? undefined, language: null, code: null, attribution: null })));
    if (examples.length && pf) ev(pf.stamp, "examples", METHOD.devMd, { location: "Examples", excerpt: examples.map((e) => e.title).slice(0, 6).join("; ") });

    // relationships
    const relationships: NormalizedComponent["relationships"] = [];
    for (const s of subsOfParent.get(slug) ?? []) relationships.push({ kind: "subcomponent", targetSlug: s, targetType: null });
    if (sub) relationships.push({ kind: "parent", targetSlug: sub.parentSlug, targetType: null });
    for (const l of page?.introLinks ?? []) {
      const t = wcSlugFromUrl(l.url);
      if (t && t !== slug && allSlugs.has(t) && !relationships.some((r) => r.targetSlug === t)) relationships.push({ kind: "related", targetSlug: t, targetType: null });
    }
    if (relationships.length) ev((pf ?? sub?.page)!.stamp, "relationships", METHOD.devMd, { location: sub && !pf ? `## ${sub.section.heading}` : "intro / subcomponent sections", excerpt: relationships.map((r) => `${r.kind}: ${r.targetSlug}`).join(", ") });

    // responsive values: properties typed MaybeResponsive<…> (base value or `@container` query string)
    const responsiveProps = el.properties.filter((p) => /\bMaybeResponsive</.test(p.type ?? "")).map((p) => p.name);
    const responsiveGuidance = responsiveProps.length ? clip(`Responsive properties (MaybeResponsive: a base value or an @container query string): ${responsiveProps.join(", ")}.`, 800) : null;
    if (responsiveGuidance) ev(w.cem.stamp, "responsive", METHOD.cem, { location: `${cemLoc}/members`, excerpt: responsiveGuidance });

    const cls = classify([name, el.className], null, { subcomponent: !!sub });
    const coverage: CoverageMap = {
      description: description ? "documented" : "not-documented",
      variants: variants.length ? "documented" : "not-documented",
      states: states.length ? "inferred" : "not-documented",
      sizes: sizes.length ? "documented" : "not-documented",
      properties: props.length ? "documented" : "not-documented",
      accessibility: a11y ? "documented" : page ? "not-documented" : "not-extracted",
      keyboard: keyboard.length ? "documented" : page ? "not-documented" : "not-extracted",
      responsive: responsiveGuidance ? "documented" : "not-documented",
      tokens: "not-documented",
      examples: examples.length ? "documented" : page ? "not-documented" : "not-extracted",
      frameworks: "documented",
      relationships: relationships.length ? "documented" : documented ? "not-documented" : "not-extracted",
    };
    out.push({
      slug,
      name,
      aliases: uniq([el.tagName, el.className].filter((a) => a !== name)),
      description,
      docsUrl: docsUrl ?? undefined,
      sourceCodeUrl: undefined,
      lifecycle,
      canonicalType: cls.slug,
      classification: cls.slug ? { state: cls.state, method: cls.method, confidence: cls.confidence } : null,
      frameworks: [{ slug: "web-components", packageName: null, importName: el.tagName, sourceUrl: docsUrl ?? cemUrl }],
      variants,
      states,
      // [] would read as "documented-none" (source states there are no sizes); null = none extracted.
      sizes: sizes.length ? sizes : null,
      properties: props,
      accessibility: a11y,
      examples,
      relationships,
      tokenUsages: [],
      responsiveGuidance,
      coverage,
      evidence: evidenceList,
    });
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Polaris React (deprecated)                                                  */
/* -------------------------------------------------------------------------- */

interface ReactContext {
  mdx: Frag<"react-mdx">[];
  dts: Map<string, Frag<"react-dts">>;
  /** component directory -> exported import name (package index). */
  exports: Map<string, string> | null;
  stories: Map<string, StoryRef[]>;
  storybook: Frag<"storybook"> | null;
  reactNpm: NpmInfo | null;
  readme: Frag<"archive-readme"> | null;
  wcSlugs: Set<string>;
  redirects: Map<string, string>;
  css: Frag<"react-css"> | null;
  tokenNames: Set<string>;
  runStartedAt: string;
}

/** Docs slug -> ATLAS slug; the deprecated-category copy of a name gets a category-qualified slug. */
export function assignReactSlugs(docPaths: string[]): Map<string, string> {
  const ordered = [...docPaths].sort((a, b) => {
    const da = a.includes("/deprecated/") ? 1 : 0;
    const db = b.includes("/deprecated/") ? 1 : 0;
    return da - db || (a < b ? -1 : a > b ? 1 : 0);
  });
  const out = new Map<string, string>();
  const used = new Set<string>();
  for (const p of ordered) {
    const [, , cat, base] = p.split("/");
    let slug = `react-${base}`;
    if (used.has(slug)) slug = `react-${cat}-${base}`;
    used.add(slug);
    out.set(p, slug);
  }
  return out;
}

function reactProps(d: Frag<"react-dts">): NormalizedProperty[] {
  return d.props.map((p: ReactProp) => ({
    implementation: "react",
    name: p.name,
    type: displayType(p.type),
    defaultValue: p.defaultValue,
    required: !p.optional,
    deprecated: p.deprecated,
    description: clip([firstSentence(p.description, 380), p.deprecated ? `Deprecated${p.deprecationNote ? `: ${p.deprecationNote}` : "."}` : null].filter(Boolean).join(" "), 600),
    allowedValues: p.allowedValues,
    sourceUrl: npmFileUrl(REACT_PKG, d.npm.version, p.file),
  }));
}

function buildReactComponents(r: ReactContext, limit: number | undefined): NormalizedComponent[] {
  let docs = sortBy(r.mdx, (m) => m.doc.docPath);
  if (limit) docs = docs.slice(0, limit);
  const slugs = assignReactSlugs(docs.map((d) => d.doc.docPath));
  const allSlugs = new Set(slugs.values());
  const out: NormalizedComponent[] = [];
  for (const m of docs) {
    const doc: ReactMdxDoc = m.doc;
    const slug = slugs.get(doc.docPath)!;
    const docsUrl = m.stamp.evidenceUrl;
    const dts = r.dts.get(doc.docPath) ?? null;
    const dir = dts?.dir ?? null;
    const importName = dir ? (r.exports ? (r.exports.get(dir) ?? null) : dir) : null;
    const exported = !!importName;
    const ev: EvidenceInput[] = [];
    const push = (stamp: Stamp, field: string, method: string, o: Parameters<typeof evidence>[3] = {}) => ev.push(evidence(stamp, field, method, o));
    const mdxLoc = m.file;
    push(m.stamp, "name", METHOD.mdx, { location: `${mdxLoc}#frontmatter.title`, excerpt: doc.title });

    const description = firstSentence(doc.lede ?? doc.shortDescription, 280);
    if (description) push(m.stamp, "description", METHOD.mdx, { location: `${mdxLoc}#${doc.lede ? "Lede" : "frontmatter.shortDescription"}`, excerpt: description });

    // lifecycle: the whole React library is deprecated (npm deprecation notice; archived repository)
    let lifecycle: NormalizedComponent["lifecycle"] = "unknown";
    if (r.reactNpm?.deprecated) {
      lifecycle = "deprecated";
      push(npmStamp(r.reactNpm, r.runStartedAt), "lifecycle", METHOD.npm, { location: `${REACT_PKG}@${r.reactNpm.version} deprecated`, excerpt: r.reactNpm.deprecated });
    }
    if (doc.status && /deprecat/i.test(doc.status)) {
      lifecycle = "deprecated";
      push(m.stamp, "lifecycle", METHOD.mdx, { location: `${mdxLoc}#frontmatter.status`, excerpt: `status: ${doc.status}` });
    }
    if (r.readme?.archived && r.readme.statement) push(r.readme.stamp, "lifecycle", METHOD.readme, { location: "README.md", excerpt: r.readme.statement, confidence: 0.9 });

    // frameworks
    const frameworks: NormalizedComponent["frameworks"] = [];
    if (r.reactNpm) {
      frameworks.push({ slug: "react", packageName: REACT_PKG, importName, sourceUrl: npmPage(REACT_PKG) });
      if (dts) push(dts.stamp, "frameworks", METHOD.dts, { location: dts.file, excerpt: `${REACT_PKG}@${dts.npm.version} components/${dir}${exported ? ` (exported as ${importName})` : " (not exported from the package index)"}` });
      else push(npmStamp(r.reactNpm, r.runStartedAt), "frameworks", METHOD.npm, { location: `${REACT_PKG}@${r.reactNpm.version}`, excerpt: `React component documented for ${REACT_PKG}` });
    }

    // properties (React)
    const props = dts?.found ? reactProps(dts) : [];
    if (dts?.found && props.length) push(dts.stamp, "properties", METHOD.dts, { location: `${dts.file}#${dts.propsName}`, excerpt: `${props.length} props${dts.unresolved.length ? `; not expanded: ${dts.unresolved.slice(0, 6).join(", ")}` : ""}` });
    const notes = new Map<string, Map<string, string>>();
    const propUrl = dts ? dts.stamp.evidenceUrl : null;
    const variants = variantsFromProps(props, notes, propUrl, dts?.propsName ?? doc.title);
    const sizes = sizesFromProps(props);
    const states = statesFromProps(props, propUrl);
    if (dts && variants.length) push(dts.stamp, "variants", METHOD.dts, { location: `${dts.file}#${dts.propsName}`, excerpt: uniq(variants.map((v) => v.axis)).map((a) => `${a}: ${variants.filter((v) => v.axis === a).map((v) => v.name).join(" | ")}`).join("; ") });
    if (dts && sizes.length) push(dts.stamp, "sizes", METHOD.dts, { location: `${dts.file}#${dts.propsName}.size`, excerpt: sizes.join(" | ") });
    if (dts && states.length) push(dts.stamp, "states", METHOD.dts, { location: `${dts.file}#${dts.propsName}`, excerpt: `boolean props: ${states.map((s) => s.name).join(", ")}`, state: "inferred", confidence: 0.75 });

    // accessibility
    const a = doc.accessibility;
    let accessibility: NormalizedComponent["accessibility"] = null;
    if (a && (a.guidance || a.keyboard.length || a.keyboardText || a.roles.length)) {
      accessibility = {
        ariaPattern: a.ariaPattern,
        roles: a.roles.length ? a.roles : null,
        keyboard: a.keyboard.length ? a.keyboard : null,
        guidance: a.guidance,
        focusManagement: null,
        screenReader: null,
        docsUrl,
        coverage: {
          guidance: a.guidance ? "documented" : "not-documented",
          keyboard: a.keyboard.length ? "documented" : a.keyboardText ? "not-extracted" : "not-documented",
          roles: a.roles.length ? "documented" : "not-documented",
          ariaPattern: a.ariaPattern ? "documented" : "not-documented",
        },
      };
      push(m.stamp, "accessibility", METHOD.mdx, { location: `${mdxLoc}#accessibility`, excerpt: a.guidance ?? a.keyboardText ?? `sections: ${a.headings.join(", ")}` });
      if (a.keyboard.length) push(m.stamp, "keyboard", METHOD.mdx, { location: `${mdxLoc}#keyboard-support`, excerpt: a.keyboard.map((k) => `${k.keys}: ${k.action}`).join("; ") });
    }

    // examples: docs links to the archived example files + Storybook stories (no code stored)
    const examples: NormalizedComponent["examples"] = doc.examples.slice(0, 25).map((e) => ({
      slug: slugify(e.fileName.replace(/\.(tsx|jsx|ts|js)$/, "")).slice(0, 60) || "example",
      title: e.title,
      kind: "docs-link",
      url: githubBlobUrl(ARCHIVE_REPO.owner, ARCHIVE_REPO.repo, ARCHIVE_DOCS_REF, `${ARCHIVE_EXAMPLES_DIR}/${e.fileName}`),
      language: null,
      code: null,
      attribution: null,
    }));
    if (examples.length) push(m.stamp, "examples", METHOD.mdx, { location: `${mdxLoc}#frontmatter.examples`, excerpt: examples.map((e) => e.title).slice(0, 6).join("; ") });
    const story = dir ? r.stories.get(dir)?.[0] : undefined;
    if (story && r.storybook) {
      examples.push({ slug: "storybook", title: `Storybook: ${story.title}`, kind: "storybook-link", url: storybookStoryUrl(story.id), language: null, code: null, attribution: null });
      push(r.storybook.stamp, "examples", METHOD.storybook, { location: `index.json#entries.${story.id}`, excerpt: `${story.title} (${r.stories.get(dir!)!.length} stories)` });
    }

    // relationships
    const relationships: NormalizedComponent["relationships"] = [];
    if (doc.webComponent?.type === "polaris") {
      const target = wcSlugFromTag(doc.webComponent.name);
      if (r.wcSlugs.has(target)) {
        relationships.push({ kind: "replaced-by", targetSlug: target, targetType: null });
        push(m.stamp, "relationships", METHOD.mdx, { location: `${mdxLoc}#frontmatter.webComponent`, excerpt: `webComponent: ${doc.webComponent.name}` });
      }
    }
    for (const rel of doc.related) {
      const path = rel.sitePath ? componentPathFromLink(rel.sitePath, r.redirects) : null;
      const t = path && path !== doc.docPath ? slugs.get(path) : undefined;
      if (t && t !== slug && allSlugs.has(t) && !relationships.some((x) => x.targetSlug === t)) relationships.push({ kind: "related", targetSlug: t, targetType: null });
    }
    if (doc.related.length) push(m.stamp, "relationships", METHOD.mdx, { location: `${mdxLoc}#related-components`, excerpt: doc.related.map((x) => x.text).join(" / ") });

    // token usage from the compiled stylesheet (rules whose subject is `.Polaris-<Dir>`)
    const usages = dir && r.css ? (r.css.usages[dir] ?? []).filter((u) => r.tokenNames.has(u.tokenName)) : [];
    if (usages.length && r.css) push(r.css.stamp, "tokens", METHOD.reactCss, { location: `${r.css.file} .Polaris-${dir}`, excerpt: `${uniq(usages.map((u) => u.tokenName)).length} Polaris tokens referenced via var(--p-*) in ${usages.length} declarations`, state: "inferred", confidence: 0.8 });

    // responsive props (ResponsiveProp<…> values per breakpoint)
    const responsiveProps = (dts?.found ? dts.props : []).filter((p) => p.responsive || /\bResponsiveProp\b/.test(p.type ?? "")).map((p) => p.name);
    const responsiveGuidance = responsiveProps.length ? clip(`Responsive props (type ResponsiveProp, values per breakpoint alias): ${responsiveProps.join(", ")}.`, 800) : null;
    if (responsiveGuidance && dts) push(dts.stamp, "responsive", METHOD.dts, { location: `${dts.file}#${dts.propsName}`, excerpt: responsiveGuidance });

    const cls = classify([doc.title, ...(dir ? [dir] : [])], a?.ariaPattern ?? null);
    const coverage: CoverageMap = {
      description: description ? "documented" : "not-documented",
      variants: variants.length ? "documented" : dts?.found ? "not-documented" : "not-extracted",
      states: states.length ? "inferred" : dts?.found ? "not-documented" : "not-extracted",
      sizes: sizes.length ? "documented" : dts?.found ? "not-documented" : "not-extracted",
      // A props declaration with no members is an explicit "no props" (absent capability).
      properties: props.length ? "documented" : dts?.found ? "documented-none" : "not-extracted",
      accessibility: accessibility ? "documented" : "not-documented",
      keyboard: a?.keyboard.length ? "documented" : a?.keyboardText ? "not-extracted" : "not-documented",
      // Responsive behaviour stated in prose (Form layout: "Field groups will wrap automatically on smaller
      // screens") is not parsed into guidance: unknown, not "not documented".
      responsive: responsiveGuidance ? "documented" : RESPONSIVE_PROSE.test([doc.lede, ...doc.examples.map((e) => e.description), ...doc.bestPractices, ...doc.keywords].filter(Boolean).join(" ")) ? "not-extracted" : dts?.found ? "not-documented" : "not-extracted",
      tokens: usages.length ? "inferred" : r.css && dir ? "not-documented" : "not-extracted",
      examples: examples.length ? "documented" : "not-documented",
      frameworks: frameworks.length ? "documented" : "not-extracted",
      relationships: relationships.length ? "documented" : "not-documented",
    };
    out.push({
      slug,
      name: doc.title,
      aliases: dir && norm(dir) !== norm(doc.title) ? [dir] : [],
      description,
      docsUrl,
      sourceCodeUrl: dir ? `${ARCHIVE_REPO_URL}/tree/${tagRef(REACT_PKG, dts!.npm.version)}/polaris-react/src/components/${dir}` : undefined,
      lifecycle,
      canonicalType: cls.slug,
      classification: cls.slug ? { state: cls.state, method: cls.method, confidence: cls.confidence } : null,
      frameworks,
      variants,
      states,
      // [] would read as "documented-none" (source states there are no sizes); null = none extracted.
      sizes: sizes.length ? sizes : null,
      properties: props,
      accessibility,
      examples: dedupeExamples(examples),
      relationships,
      tokenUsages: usages.map((u) => ({ tokenName: u.tokenName, property: u.property })),
      responsiveGuidance,
      coverage,
      evidence: ev,
    });
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Patterns                                                                    */
/* -------------------------------------------------------------------------- */

function buildPatterns(pages: Frag<"pattern-page">[], wcSlugs: Set<string>, limit: number | undefined): NormalizedPattern[] {
  let list = sortBy(pages, (p) => p.slug);
  if (limit) list = list.slice(0, limit);
  return list.map((pf) => {
    const p = pf.page;
    const name = p.title || pf.slug;
    const description = firstSentence(p.description ?? p.intro[0] ?? pf.summary, 280);
    const componentSlugs = uniq(p.components.map((c) => wcSlugFromUrl(c.url)).filter((s): s is string => !!s && wcSlugs.has(s))).sort();
    const cls = classifyPatternName(name);
    const ev: EvidenceInput[] = [evidence(pf.stamp, "name", METHOD.devMd, { location: "frontmatter.title", excerpt: `${pf.group ? `${pf.group}: ` : ""}${name}` })];
    if (description) ev.push(evidence(pf.stamp, "description", METHOD.devMd, { location: "frontmatter.description", excerpt: description }));
    if (componentSlugs.length) ev.push(evidence(pf.stamp, "components", METHOD.devMd, { location: "Supported components", excerpt: p.components.map((c) => c.title).join(", ") }));
    return {
      slug: slugify(pf.slug),
      name,
      description,
      docsUrl: p.htmlUrl ?? pf.stamp.evidenceUrl,
      canonicalType: cls?.slug ?? null,
      classification: cls ? { state: "inferred", method: cls.method, confidence: cls.confidence } : null,
      componentSlugs,
      coverage: { description: description ? "documented" : "not-documented", components: componentSlugs.length ? "documented" : "not-documented", examples: p.examples.length ? "documented" : "not-documented" },
      evidence: ev,
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Tokens                                                                      */
/* -------------------------------------------------------------------------- */

function buildTokenSets(css: Frag<"tokens-css"> | null, metas: Frag<"tokens-meta">[], license: Frag<"license"> | null): NormalizedTokenSet[] {
  if (!css) return [];
  const descriptions = new Map<string, string>();
  for (const m of sortBy(metas, (x) => x.file)) for (const [k, v] of Object.entries(m.descriptions)) if (!descriptions.has(k)) descriptions.set(k, v);
  const licUrl = license?.stamp.evidenceUrl ?? npmFileUrl(TOKENS_PKG, css.npm.version, "LICENSE.md");
  const out: NormalizedTokenSet[] = [];
  for (const t of TOKEN_THEMES) {
    const declared = css.blocks.some((b) => b.themes.includes(t.theme));
    if (!declared) continue;
    const rows = themeTokens(css.blocks, t.theme);
    const tokens = sortBy(rows.map((row) => toPolarisToken(row, descriptions, css.file)), (x) => x.name);
    const overrides = rows.filter((x) => !x.inherited);
    const ev: EvidenceInput[] = [
      evidence(css.stamp, "tokens", METHOD.tokensCss, {
        location: `${css.file} .p-theme-${t.theme}`,
        excerpt: `${tokens.length} custom properties for theme "${t.theme}" (${overrides.length} declared in the theme's own selector, the rest inherited from :root)`,
        title: `${TOKENS_PKG}@${css.npm.version} ${css.file}`,
      }),
    ];
    for (const m of metas) ev.push(evidence(m.stamp, "description", METHOD.tokensMeta, { location: m.file, excerpt: `${Object.keys(m.descriptions).length} token descriptions` }));
    if (license) ev.push(evidence(license.stamp, "license", METHOD.license, { location: "LICENSE.md", excerpt: `${license.copyright ?? "Shopify Inc."}; ${license.fieldOfUse ? "rights limited to applications that integrate or interoperate with Shopify" : "MIT-style"}` }));
    out.push({
      slug: `tokens-${t.theme}`,
      name: t.name,
      theme: t.theme,
      format: "css-vars",
      sourceUrl: css.stamp.evidenceUrl,
      packageName: TOKENS_PKG,
      packageVersion: css.npm.version,
      license: polarisLicense(licUrl),
      redistribution: "restricted",
      tokens,
      evidence: ev,
    });
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* System facts                                                                */
/* -------------------------------------------------------------------------- */

function buildFacts(o: { typesNpm: NpmInfo | null; overview: Frag<"system-page"> | null; versioning: Frag<"system-page"> | null; readme: Frag<"archive-readme"> | null; runStartedAt: string }): NormalizedSystemFacts | null {
  const ev: EvidenceInput[] = [];
  const facts: NormalizedSystemFacts = { evidence: ev };
  if (o.typesNpm) {
    facts.latestVersion = o.typesNpm.version;
    ev.push(evidence(npmStamp(o.typesNpm, o.runStartedAt), "latestVersion", METHOD.npm, { location: `${TYPES_PKG} dist-tags.latest`, excerpt: `${TYPES_PKG} latest ${o.typesNpm.version} (types versioned with the Polaris web component library release)`, confidence: 0.85 }));
    if (o.versioning?.page.documentedVersion) ev.push(evidence(o.versioning.stamp, "latestVersion", METHOD.devMd, { location: "Versioning for web components", excerpt: `This reference documents Polaris ${o.versioning.page.documentedVersion}. Match the @shopify/polaris-types version to the release your app loads.` }));
    if (o.typesNpm.publishedAt) {
      facts.latestReleaseAt = o.typesNpm.publishedAt;
      ev.push(evidence(npmStamp(o.typesNpm, o.runStartedAt), "latestReleaseAt", METHOD.npm, { location: `${TYPES_PKG} time.${o.typesNpm.version}`, excerpt: `${TYPES_PKG}@${o.typesNpm.version} published ${o.typesNpm.publishedAt} (types package publish time; the CDN library release date is not published)`, state: "inferred", confidence: 0.6 }));
    }
  }
  if (o.overview) {
    facts.frameworks = [{ slug: "web-components", packageName: null }];
    ev.push(evidence(o.overview.stamp, "frameworks", METHOD.devMd, { location: "Polaris references", excerpt: o.overview.page.paragraphs.find((p) => /web components/i.test(p)) ?? o.overview.page.description }));
    const statement = o.overview.page.paragraphs.find((p) => /unified UI framework/i.test(p));
    if (statement) {
      facts.philosophy =
        "ATLAS summary: Polaris is Shopify's unified UI framework for apps on every Shopify surface (App Home, admin, checkout, customer accounts, POS), delivered as framework-agnostic web components so apps look and behave like native Shopify; the earlier Polaris React library is archived.";
      ev.push(evidence(o.overview.stamp, "philosophy", METHOD.devMd, { location: "Polaris references", excerpt: statement }));
      if (o.readme?.statement) ev.push(evidence(o.readme.stamp, "philosophy", METHOD.readme, { location: "README.md", excerpt: o.readme.statement, confidence: 0.85 }));
    }
  }
  return ev.length ? facts : null;
}

/* -------------------------------------------------------------------------- */
/* Entry                                                                       */
/* -------------------------------------------------------------------------- */

export function normalizePolaris(fragments: PolarisFragmentData[], opts: NormalizeOptions & { runStartedAt: string }): NormalizedBundle {
  const log = opts.log ?? (() => {});
  const of = <T extends PolarisFragmentData["type"]>(t: T) => fragments.filter((f): f is Frag<T> => f.type === t);
  const first = <T extends PolarisFragmentData["type"]>(t: T) => sortBy(of(t), (f) => f.stamp.url)[0] ?? null;

  const cem = first("cem");
  const typesNpm = cem?.npm ?? null;
  const systemPages = of("system-page");
  const overview = systemPages.find((p) => p.key === "overview") ?? null;
  const versioning = systemPages.find((p) => p.key === "versioning") ?? null;
  const readme = first("archive-readme");

  let web: NormalizedComponent[] = [];
  if (cem && typesNpm) {
    const pages = new Map(of("wc-page").map((p) => [p.slug, p]));
    web = buildWebComponents({ cem, pages, index: first("wc-index"), versioning, typesNpm }, opts.limit, log);
  } else log("custom elements manifest missing; web components not extracted");
  const wcSlugs = new Set(web.map((c) => c.slug));

  const dtsFrags = of("react-dts");
  const reactIndex = first("react-index");
  const reactNpm = dtsFrags[0]?.npm ?? reactIndex?.npm ?? null;
  const storybook = first("storybook");
  const stories = new Map<string, StoryRef[]>();
  for (const s of storybook?.stories ?? []) {
    const dir = s.title.replace(/^All components\//i, "");
    stories.set(dir, [...(stories.get(dir) ?? []), s]);
  }
  const dtsByDoc = new Map<string, Frag<"react-dts">>();
  for (const d of sortBy(dtsFrags, (x) => x.file)) if (d.docPath && !dtsByDoc.has(d.docPath)) dtsByDoc.set(d.docPath, d);
  const tokenSets = buildTokenSets(first("tokens-css"), of("tokens-meta"), of("license").find((l) => l.key === "tokens") ?? first("license"));
  const tokenNames = new Set(tokenSets.flatMap((s) => s.tokens.map((t) => t.name)));
  const react = buildReactComponents(
    {
      mdx: of("react-mdx"),
      dts: dtsByDoc,
      exports: reactIndex ? new Map(Object.entries(reactIndex.exports)) : null,
      stories,
      storybook,
      reactNpm,
      readme,
      wcSlugs,
      redirects: new Map((first("redirects")?.redirects ?? []).map((x) => [x.source, x.destination])),
      css: first("react-css"),
      tokenNames,
      runStartedAt: opts.runStartedAt,
    },
    opts.limit,
  );

  const patterns = buildPatterns(of("pattern-page"), wcSlugs, opts.limit);
  const facts = buildFacts({ typesNpm, overview, versioning, readme, runStartedAt: opts.runStartedAt });

  return {
    systemSlug: opts.systemSlug,
    components: sortBy([...web, ...react], (c) => c.slug),
    tokenSets: sortBy(tokenSets, (s) => s.slug),
    patterns,
    facts,
  };
}
