/**
 * React Spectrum S2 ("react-spectrum") and React Aria Components ("react-aria") bundles.
 *
 * Per component page: the published markdown docs (<Page>.md: description, sections, API prop
 * tables per export), the page MDX at the package's release tag (lifecycle `version` export,
 * relatedPages), the npm package listing (export module exists), a verified source file URL, and
 * for React Spectrum the matching spectrum.adobe.com /web/rsp/ guideline page (states support and
 * keyboard interaction tables). Deterministic: everything is ordered by page name / source order.
 */
import type { CoverageState, EvidenceInput, KeyboardInteraction, NormalizedBundle, NormalizedComponent, NormalizedPattern, NormalizedSystemFacts } from "@/lib/contracts";
import { canonicalState, classifyComponentName, classifyPatternName } from "@/lib/taxonomy";
import { slugify } from "@/lib/utils";
import { CODE_ATTRIBUTION, PKG, RAC_ORIGIN, RSP_ORIGIN } from "./constants";
import type { MdApiSection, MdPage } from "./docs-md";
import { fragsOf, pick, type Frag, type ReactSystem } from "./fragments";
import { clip, evidence, firstSentence, lifecycleFromStatus, uniqBy, type Ev } from "./shared";

export const MAX_PROPS_PER_IMPL = 150;
const MAX_EXAMPLES = 6;

export const SYSTEM_PKG: Record<ReactSystem, string> = { "react-spectrum": PKG.s2, "react-aria": PKG.rac };
export const SYSTEM_ORIGIN: Record<ReactSystem, string> = { "react-spectrum": RSP_ORIGIN, "react-aria": RAC_ORIGIN };

/** Boolean props whose presence documents a component state (prop-derived => coverage "inferred"). */
const STATE_PROPS: Record<string, string> = {
  isDisabled: "disabled",
  isPending: "loading",
  isInvalid: "error",
  isReadOnly: "readonly",
  isSelected: "selected",
  isIndeterminate: "indeterminate",
  isExpanded: "expanded",
};
/** Enum props that document a visual variant axis. */
const VARIANT_PROPS: Record<string, string> = { variant: "variant", fillStyle: "appearance", density: "density" };
const SKIP_EXAMPLE_SECTION = /^(vanilla css example|tailwind example|api|related types|examples|properties|methods)$/i;

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Remove docs-site highlight markers from example code. */
export function cleanExampleCode(code: string): string {
  return code
    .split("\n")
    .filter((l) => !/^\s*(\{\s*)?\/\*-\s*(begin|end) highlight\s*-\*\/(\s*\})?\s*$/.test(l))
    .map((l) => l.replace(/\{?\/\*-\s*(begin|end) highlight\s*-\*\/\}?/g, ""))
    .join("\n")
    .trim();
}

/** Shrink a parsed page before it is persisted: one example per section, bounded code. */
export function compactPage(md: MdPage): MdPage {
  return {
    ...md,
    sections: md.sections.map((s) => {
      const keep = !SKIP_EXAMPLE_SECTION.test(s.title) && !/\.(tsx?|jsx?|css)$/i.test(s.title);
      const first = keep ? s.code.find((c) => c.lang && /^(tsx|jsx)$/i.test(c.lang)) : undefined;
      const code = first ? cleanExampleCode(first.value) : "";
      return { ...s, code: code && code.length <= 4000 ? [{ lang: first!.lang, value: code }] : [] };
    }),
  };
}

function primaryApi(page: string, title: string | null, primaryExport: string | null, api: MdApiSection[]): MdApiSection | null {
  return api.find((a) => a.name === primaryExport) ?? api.find((a) => a.name === page) ?? api.find((a) => a.name === title) ?? null;
}

interface PageBits {
  md: Frag<"md">;
  mdx?: Frag<"mdx">;
  src?: Frag<"src">;
  hooks: Frag<"hook">[];
  site?: { page: Frag<"site-page">; states?: Frag<"site-fragment">; a11y?: Frag<"site-fragment"> };
}

function buildComponent(system: ReactSystem, page: string, b: PageBits, ctx: { slugByPage: Map<string, string>; llms?: Frag<"llms">; listing?: Frag<"listing">; pkgVersion: string | null }): NormalizedComponent {
  const { md, mdx, src, hooks, site } = b;
  const ev: EvidenceInput[] = [];
  const coverage: Record<string, CoverageState> = {};
  const p = md.md;
  const name = p.title ?? page;
  const slug = ctx.slugByPage.get(page)!;
  const loc = (frag: string) => `${page}.md#${frag}`;
  ev.push(evidence("*", md.ev, "docs-md", 0.95, { location: loc("title"), excerpt: `# ${name}` }));
  const llmsEntry = ctx.llms?.entries.find((e) => e.page === page);
  if (ctx.llms && llmsEntry) ev.push(evidence("*", ctx.llms.ev, "llms-index", 0.9, { location: `${ctx.llms.ev.location}#${page}`, excerpt: llmsEntry.description ?? llmsEntry.title }));

  // Description: page description paragraph (rendered from the export's JSDoc), else index text, else MDX.
  let description: string | null = null;
  if (p.description) {
    description = firstSentence(p.description);
    ev.push(evidence("description", md.ev, "docs-md", 0.95, { location: loc("description"), excerpt: p.description }));
  } else if (llmsEntry?.description && ctx.llms) {
    description = firstSentence(llmsEntry.description);
    ev.push(evidence("description", ctx.llms.ev, "llms-index", 0.85, { location: `${ctx.llms.ev.location}#${page}`, excerpt: llmsEntry.description }));
  } else if (mdx?.meta.description) {
    description = firstSentence(mdx.meta.description);
    ev.push(evidence("description", mdx.ev, "docs-mdx", 0.85, { location: `${mdx.ev.location}#export const description`, excerpt: mdx.meta.description }));
  }
  coverage.description = description ? "documented" : "not-documented";

  // Properties: one implementation per documented export, plus hook options (React Aria).
  const primaryExport = mdx?.meta.primaryExport ?? null;
  const primary = primaryApi(page, p.title, primaryExport, p.api);
  const properties: NormalizedComponent["properties"] = [];
  const aliases: string[] = [];
  const addProps = (impl: string, sec: MdApiSection, url: string) => {
    const seen = new Set<string>();
    for (const pr of sec.props) {
      if (seen.has(pr.name) || seen.size >= MAX_PROPS_PER_IMPL) continue;
      seen.add(pr.name);
      properties.push({
        implementation: impl,
        name: pr.name,
        type: pr.type,
        defaultValue: pr.defaultValue,
        required: pr.required,
        deprecated: /^deprecated\b|@deprecated/i.test(pr.description ?? ""),
        description: pr.description ? clip(pr.description, 600) : null,
        allowedValues: pr.allowedValues,
        sourceUrl: url,
      });
    }
  };
  const apiSorted = [...p.api].sort((a, b) => (a === primary ? -1 : b === primary ? 1 : a.line - b.line));
  for (const sec of apiSorted) {
    const impl = sec === primary ? "react" : `react:${sec.name}`;
    if (properties.some((x) => x.implementation === impl)) continue;
    addProps(impl, sec, md.docsUrl);
    ev.push(evidence("properties", md.ev, "docs-md-api", 0.95, { location: `${loc(`API/${sec.name}`)} (line ${sec.line}; ${sec.props.length} rows${sec.props.length > MAX_PROPS_PER_IMPL ? `, first ${MAX_PROPS_PER_IMPL} stored` : ""})` }));
    if (sec !== primary && sec.name !== name && /^[A-Z][A-Za-z0-9_]*$/.test(sec.name)) aliases.push(sec.name);
  }
  for (const h of hooks) {
    const sec = h.md.api.find((a) => /(Options|Props)$/.test(a.name)) ?? h.md.api[0];
    if (!sec) continue;
    addProps(`react:${h.hook}`, sec, h.docsUrl);
    ev.push(evidence("properties", h.ev, "docs-md-api", 0.9, { location: `${h.component}/${h.hook}.md#API/${sec.name}` }));
    aliases.push(h.hook);
  }
  coverage.properties = properties.length ? "documented" : "not-documented";

  // Variants + sizes from the primary export's enum props.
  const variants: NormalizedComponent["variants"] = [];
  let sizes: string[] | null = null;
  for (const pr of primary?.props ?? []) {
    const axis = VARIANT_PROPS[pr.name];
    if (axis && pr.allowedValues?.length) {
      for (const v of pr.allowedValues) variants.push({ axis, name: v, description: null, sourceUrl: md.docsUrl, location: loc(`API/${primary!.name}.${pr.name}`) });
      ev.push(evidence("variants", md.ev, "docs-md-api", 0.9, { location: loc(`API/${primary!.name}.${pr.name}`), excerpt: `${pr.name}: ${pr.type ?? ""}` }));
    }
    if (pr.name === "size" && pr.allowedValues?.length) {
      sizes = [...pr.allowedValues];
      ev.push(evidence("sizes", md.ev, "docs-md-api", 0.9, { location: loc(`API/${primary!.name}.size`), excerpt: `size: ${pr.type ?? ""}` }));
    }
  }
  coverage.variants = variants.length ? "documented" : primary ? "not-documented" : "not-extracted";
  coverage.sizes = sizes ? "documented" : primary ? "not-documented" : "not-extracted";

  // States: spectrum.adobe.com support table (React Spectrum) > state props (inferred).
  let states: NormalizedComponent["states"] = [];
  const siteStates = site?.states?.states?.filter((s) => s.supported === true) ?? [];
  if (site?.states && siteStates.length) {
    const url = site.page.ev.sourceUrl;
    states = uniqBy(siteStates, (s) => slugify(s.name)).map((s) => ({ name: s.name, canonical: canonicalState(s.name), description: null, sourceUrl: url }));
    ev.push(evidence("states", site.states.ev, "site-states", 0.9, { location: `${site.states.ev.location} (State | Support status = Supported)` }));
    coverage.states = "documented";
  } else {
    for (const pr of primary?.props ?? []) {
      const canon = STATE_PROPS[pr.name];
      if (canon) states.push({ name: cap(canon), canonical: canon, description: `Exposed through the \`${pr.name}\` prop`, sourceUrl: md.docsUrl });
    }
    states = uniqBy(states, (s) => s.name);
    if (states.length) ev.push(evidence("states", md.ev, "docs-md-api", 0.6, { location: loc(`API/${primary!.name} (state props)`) }));
    coverage.states = states.length ? "inferred" : primary ? "not-documented" : "not-extracted";
  }

  // Accessibility: keyboard tables (spectrum.adobe.com rsp page) + keyboard/accessibility prose sections.
  const kbRows = site?.a11y?.a11y?.keyboard ?? [];
  const keyboard: KeyboardInteraction[] = uniqBy(kbRows, (k) => `${k.keys}|${k.action}`).slice(0, 20).map((k) => ({ keys: clip(k.keys, 80), action: clip(k.action, 300) }));
  const proseSecs = p.sections.filter((s) => /keyboard|accessib|screen reader|focus management/i.test(s.title) && s.firstParagraph);
  const guidance = proseSecs.length ? clip(proseSecs.map((s) => `${s.title}: ${s.firstParagraph}`).join(" "), 1200) : null;
  const wcag = [...new Set((site?.a11y?.a11y?.wcag ?? []).flatMap((w) => w.criteria))].sort();
  let accessibility: NormalizedComponent["accessibility"] = null;
  if (keyboard.length || guidance || wcag.length) {
    accessibility = {
      ariaPattern: null,
      roles: null,
      keyboard: keyboard.length ? keyboard : null,
      guidance,
      screenReader: null,
      focusManagement: null,
      wcagCriteria: wcag.length ? wcag : null,
      docsUrl: keyboard.length || wcag.length ? site!.page.ev.sourceUrl : md.docsUrl,
      coverage: {
        keyboard: keyboard.length ? "documented" : proseSecs.some((s) => /keyboard/i.test(s.title)) ? "not-extracted" : site?.a11y ? "not-documented" : "not-extracted",
        guidance: guidance ? "documented" : "not-extracted",
        wcagCriteria: wcag.length ? "documented" : site?.a11y ? "not-documented" : "not-extracted",
        roles: "not-extracted",
        ariaPattern: "not-extracted",
        screenReader: "not-extracted",
        focusManagement: "not-extracted",
      },
    };
    if (site?.a11y && (keyboard.length || wcag.length)) ev.push(evidence("accessibility", site.a11y.ev, "site-a11y", 0.9, { location: `${site.a11y.ev.location} (Keyboard interactions / WCAG 2.2 compliance tables)` }));
    if (keyboard.length && site?.a11y) ev.push(evidence("keyboard", site.a11y.ev, "site-a11y", 0.9, { location: `${site.a11y.ev.location}#keyboard-interactions`, excerpt: `${keyboard[0]!.keys}: ${keyboard[0]!.action}` }));
    if (guidance) ev.push(evidence("accessibility", md.ev, "docs-md", 0.85, { location: loc(proseSecs[0]!.title), excerpt: proseSecs[0]!.firstParagraph }));
  }
  coverage.accessibility = accessibility ? "documented" : "not-documented";
  coverage.keyboard = keyboard.length ? "documented" : proseSecs.some((s) => /keyboard/i.test(s.title)) ? "not-extracted" : "not-documented";
  coverage.responsive = "not-extracted";
  coverage.tokens = "not-extracted";

  // Examples: code snippets from the docs (Apache-2.0, stored with attribution).
  const examples: NormalizedComponent["examples"] = [];
  const exSlugs = new Set<string>();
  for (const s of p.sections) {
    if (examples.length >= MAX_EXAMPLES) break;
    const c = s.code[0];
    if (!c) continue;
    let es = slugify(s.title) || "example";
    for (let i = 2; exSlugs.has(es); i++) es = `${slugify(s.title)}-${i}`;
    exSlugs.add(es);
    examples.push({ slug: es, title: s.title, kind: "code-snippet", language: c.lang, code: c.value, url: md.docsUrl, attribution: CODE_ATTRIBUTION[system] });
  }
  if (examples.length) ev.push(evidence("examples", md.ev, "docs-md", 0.9, { location: loc(`sections (${examples.map((e) => e.title).join(", ").slice(0, 160)})`) }));
  coverage.examples = examples.length ? "documented" : "not-documented";

  // Relationships: MDX relatedPages + prose links to other component pages.
  const relationships: NormalizedComponent["relationships"] = [];
  const addRel = (target: string | undefined) => {
    if (!target || target === slug || relationships.some((r) => r.targetSlug === target)) return;
    relationships.push({ kind: "related", targetSlug: target, targetType: null });
  };
  let relFromMdx = false;
  for (const r of mdx?.meta.relatedPages ?? []) {
    const last = r.url.replace(/[#?].*$/, "").split("/").filter(Boolean).pop() ?? "";
    const t = ctx.slugByPage.get(last);
    if (t && t !== slug) {
      relFromMdx = true;
      addRel(t);
    }
  }
  if (relFromMdx && mdx) ev.push(evidence("relationships", mdx.ev, "docs-mdx", 0.9, { location: `${mdx.ev.location}#export const relatedPages` }));
  const linked = p.links.map((l) => ctx.slugByPage.get(l)).filter((x): x is string => !!x && x !== slug);
  for (const t of linked) addRel(t);
  if (linked.length) ev.push(evidence("relationships", md.ev, "docs-md", 0.75, { location: loc(`links (${p.links.join(", ").slice(0, 120)})`) }));
  coverage.relationships = relationships.length ? "documented" : "not-documented";

  // Framework + source.
  const exportFile = ctx.listing?.exports.includes(page) ? page : null;
  const frameworks: NormalizedComponent["frameworks"] = [
    { slug: "react", packageName: SYSTEM_PKG[system], importName: primaryExport ?? primary?.name ?? page, sourceUrl: src?.url ?? null },
  ];
  if (ctx.listing && exportFile) ev.push(evidence("frameworks", ctx.listing.ev, "npm-listing", 0.95, { location: `${ctx.listing.pkg}@${ctx.listing.version} export module "${ctx.listing.pkg}/${page}"` }));
  coverage.frameworks = "documented";
  if (src) ev.push(evidence("sourceCodeUrl", src.ev, "source-check", 0.9, { location: `${src.ev.location} (HTTP 200 at release tag)` }));

  // Lifecycle: MDX `version` export marks pre-release pages ('alpha' | 'beta'); none = released.
  let lifecycle: NormalizedComponent["lifecycle"] = "unknown";
  if (mdx) {
    if (mdx.meta.version) {
      lifecycle = lifecycleFromStatus(mdx.meta.version);
      ev.push(evidence("lifecycle", mdx.ev, "docs-mdx", 0.9, { location: `${mdx.ev.location}#export const version`, excerpt: `version = '${mdx.meta.version}'` }));
    } else if (primaryExport?.startsWith("UNSTABLE_")) {
      lifecycle = "experimental";
      ev.push(evidence("lifecycle", mdx.ev, "docs-mdx", 0.8, { location: `${mdx.ev.location}#PageDescription`, excerpt: `documents export ${primaryExport}` }));
    } else {
      lifecycle = "stable";
      ev.push(evidence("lifecycle", mdx.ev, "docs-mdx", 0.75, { location: `${mdx.ev.location} (no 'version' pre-release export${ctx.pkgVersion ? `; ${SYSTEM_PKG[system]}@${ctx.pkgVersion}` : ""})` }));
    }
  }

  const cls = classifyComponentName(name);
  return {
    slug,
    name,
    aliases: uniqBy(aliases, (a) => a).sort(),
    description,
    docsUrl: md.docsUrl,
    sourceCodeUrl: src?.url ?? null,
    lifecycle,
    canonicalType: cls?.slug ?? null,
    classification: cls ? { state: "inferred", method: cls.method, confidence: cls.confidence } : null,
    frameworks,
    variants: uniqBy(variants, (v) => `${v.axis}|${v.name}`),
    states,
    sizes,
    properties,
    accessibility,
    examples,
    relationships,
    tokenUsages: [],
    responsiveGuidance: null,
    coverage,
    evidence: uniqBy(ev, (e) => `${e.field}|${e.sourceUrl}|${e.location}`),
  };
}

function buildPatterns(guides: Frag<"guide">[], slugByPage: Map<string, string>): NormalizedPattern[] {
  return [...guides]
    .sort((a, b) => a.page.localeCompare(b.page))
    .map((g) => {
      const name = g.md.title ?? g.page;
      const raw = classifyPatternName(name);
      const cls = raw && raw.confidence >= 0.8 ? raw : null;
      const componentSlugs = [...new Set(g.md.links.map((l) => slugByPage.get(l)).filter((s): s is string => !!s))].sort();
      const description = firstSentence(g.md.description);
      const ev: EvidenceInput[] = [evidence("*", g.ev, "docs-md", 0.95, { location: `${g.page}.md#title`, excerpt: g.md.description ?? name })];
      if (componentSlugs.length) ev.push(evidence("componentSlugs", g.ev, "docs-md", 0.8, { location: `${g.page}.md (links to component pages)` }));
      return {
        slug: slugify(g.page) || slugify(name),
        name,
        description,
        docsUrl: g.docsUrl,
        canonicalType: cls?.slug ?? null,
        classification: cls ? { state: "inferred" as const, method: cls.method, confidence: cls.confidence } : null,
        componentSlugs,
        coverage: { description: description ? "documented" : "not-documented", components: componentSlugs.length ? "documented" : "not-documented" },
        evidence: ev,
      };
    });
}

function buildFacts(system: ReactSystem, pkg: Frag<"pkg"> | undefined, quality: Frag<"quality"> | undefined): NormalizedSystemFacts | null {
  const ev: EvidenceInput[] = [];
  let principles: NormalizedSystemFacts["principles"] = null;
  let philosophy: string | null = null;
  if (pkg) {
    ev.push(evidence("latestVersion", pkg.ev, "npm-version", 0.95, { excerpt: `${pkg.name}@${pkg.version}${pkg.publishedAt ? ` published ${pkg.publishedAt}` : ""}` }));
    if (pkg.publishedAt) ev.push(evidence("latestReleaseAt", pkg.ev, "npm-version", 0.95, { excerpt: `${pkg.name}@${pkg.version} published ${pkg.publishedAt}` }));
    ev.push(evidence("frameworks", pkg.ev, "npm-version", 0.9, { excerpt: `${pkg.name} (React)` }));
  }
  if (quality?.md.description) {
    // Principles named in the Quality page intro that also head their own section.
    const intro = quality.md.description;
    const names = quality.md.sections.filter((s) => s.depth === 2 && new RegExp(`\\b${s.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(intro)).map((s) => s.title);
    if (names.length) {
      principles = names.map((n) => ({ name: n, sourceUrl: quality.docsUrl }));
      ev.push(evidence("principles", quality.ev, "docs-md", 0.9, { location: `${quality.ev.location}#intro + section headings`, excerpt: intro }));
      philosophy = `React Aria's Quality page states: "${firstSentence(intro, 400)}"`;
      ev.push(evidence("philosophy", quality.ev, "docs-md", 0.85, { location: `${quality.ev.location}#intro`, excerpt: intro }));
    }
  }
  if (!pkg && !principles) return null;
  return {
    latestVersion: pkg?.version ?? null,
    latestReleaseAt: pkg?.publishedAt ?? null,
    philosophy,
    principles,
    frameworks: pkg ? [{ slug: "react", packageName: SYSTEM_PKG[system] }] : null,
    evidence: ev,
  };
}

export function normalizeReact(system: ReactSystem, fragments: { data: unknown }[]): NormalizedBundle {
  const frs = fragsOf(fragments);
  const mds = pick(frs, "md").sort((a, b) => a.page.localeCompare(b.page));
  const mdxBy = new Map(pick(frs, "mdx").map((f) => [f.page, f]));
  const srcBy = new Map(pick(frs, "src").map((f) => [f.page, f]));
  const hooksBy = new Map<string, Frag<"hook">[]>();
  for (const h of pick(frs, "hook").sort((a, b) => a.hook.localeCompare(b.hook))) {
    const l = hooksBy.get(h.component) ?? [];
    l.push(h);
    hooksBy.set(h.component, l);
  }
  // spectrum.adobe.com rsp pages, keyed by the React Spectrum export their options data documents.
  const siteByExport = new Map<string, { page: Frag<"site-page">; states?: Frag<"site-fragment">; a11y?: Frag<"site-fragment"> }>();
  if (system === "react-spectrum") {
    const fragsBySlug = new Map<string, Frag<"site-fragment">[]>();
    for (const f of pick(frs, "site-fragment")) fragsBySlug.set(f.slug, [...(fragsBySlug.get(f.slug) ?? []), f]);
    for (const sp of pick(frs, "site-page").sort((a, b) => a.slug.localeCompare(b.slug))) {
      if (sp.impl !== "rsp" || !sp.page.dataName || siteByExport.has(sp.page.dataName)) continue;
      const fr = fragsBySlug.get(sp.slug) ?? [];
      siteByExport.set(sp.page.dataName, { page: sp, states: fr.find((f) => f.section === "states"), a11y: fr.find((f) => f.section === "accessibility") });
    }
  }
  const slugByPage = new Map<string, string>();
  const used = new Set<string>();
  for (const m of mds) {
    let s = slugify(m.page) || "component";
    for (let i = 2; used.has(s); i++) s = `${slugify(m.page)}-${i}`;
    used.add(s);
    slugByPage.set(m.page, s);
  }
  const pkg = pick(frs, "pkg").find((p) => p.name === SYSTEM_PKG[system]);
  const ctx = { slugByPage, llms: pick(frs, "llms")[0], listing: pick(frs, "listing")[0], pkgVersion: pkg?.version ?? null };
  const components = mds.map((md) => {
    const mdx = mdxBy.get(md.page);
    const exp = mdx?.meta.primaryExport ?? md.page;
    const site = siteByExport.get(exp) ?? siteByExport.get(md.page);
    return buildComponent(system, md.page, { md, mdx, src: srcBy.get(md.page), hooks: hooksBy.get(md.page) ?? [], site }, ctx);
  });
  const patterns = buildPatterns(pick(frs, "guide"), slugByPage);
  const facts = buildFacts(system, pkg, pick(frs, "quality")[0]);
  return { systemSlug: system, components, tokenSets: [], patterns, facts };
}

export type { Ev };
