/**
 * Merge Primer fragments into a NormalizedBundle. Pure (no I/O). Deterministic ordering.
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
} from "@/lib/contracts";
import { excerpt, npmFileUrl } from "@/ingestion/http";
import { canonicalState, classifyComponentName, classifyPatternName, componentTypeBySlug } from "@/lib/taxonomy";
import { slugify } from "@/lib/utils";
import type { PrimerDocsComponent, PrimerProp } from "./components-json";
import { sourceDir } from "./components-json";
import {
  DOCS_ORIGIN,
  METHOD,
  PATTERN_SECTIONS,
  PRIMITIVES_PKG,
  REACT_PKG,
  STATE_BOOLEAN_PROPS,
  STORYBOOK_STORY_URL,
  SYSTEM_PAGES,
  TOKEN_SETS,
  VARIANT_AXIS_PROPS,
} from "./constants";
import { canonicalDocsUrl, componentSlugFromUrl, type ParsedComponentPage } from "./docs-pages";
import type { NpmInfo, PrimerFragmentData, SourceStamp } from "./fragments";
import { humanize, parseStringLiteralUnion, shortText, uniq } from "./text";

type Lifecycle = NormalizedComponent["lifecycle"];
type Ev = EvidenceInput;

/* ------------------------------------------------------------------------------------------ */
/* Component selection & slugs (shared with discover)                                          */
/* ------------------------------------------------------------------------------------------ */

/** Well-known components first so `--limit N` runs exercise representative data. */
const PRIORITY_NAMES = ["Button", "ActionMenu", "Dialog", "TreeView", "TextInput", "SegmentedControl", "Tooltip", "Banner"];

export function selectComponents(comps: PrimerDocsComponent[], limit?: number): PrimerDocsComponent[] {
  const sorted = [...comps].sort((a, b) => {
    const pa = PRIORITY_NAMES.indexOf(a.name);
    const pb = PRIORITY_NAMES.indexOf(b.name);
    const ra = pa < 0 ? 999 : pa;
    const rb = pb < 0 ? 999 : pb;
    return ra - rb || a.name.localeCompare(b.name) || rankForSlug(a) - rankForSlug(b) || a.id.localeCompare(b.id);
  });
  return limit && limit > 0 ? sorted.slice(0, limit) : sorted;
}

const rankForSlug = (c: PrimerDocsComponent) => (c.status === "deprecated" ? 2 : 0) + (c.importPath === REACT_PKG ? 0 : 1);

/**
 * Stable slugs. Components sharing a name (e.g. current Dialog and the deprecated DialogV1) are
 * ranked (non-deprecated, main entry point first); the first gets slugify(name), the others the
 * source directory name (e.g. "dialog-v1") or a "-deprecated"/id suffix.
 */
export function assignSlugs(comps: PrimerDocsComponent[]): Map<string, string> {
  const groups = new Map<string, PrimerDocsComponent[]>();
  for (const c of comps) {
    const base = slugify(c.name) || slugify(c.id);
    groups.set(base, [...(groups.get(base) ?? []), c]);
  }
  const used = new Set<string>();
  const out = new Map<string, string>();
  for (const [base, members] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const ranked = [...members].sort((a, b) => rankForSlug(a) - rankForSlug(b) || a.id.localeCompare(b.id));
    ranked.forEach((c, idx) => {
      let slug = base;
      if (idx > 0 || used.has(slug)) {
        const dirName = sourceDir(c.source)?.split("/").pop() ?? "";
        const candidates = [slugify(dirName), `${base}-${c.status === "deprecated" ? "deprecated" : slugify((c.importPath ?? "").split("/").pop() ?? "")}`, `${base}-${slugify(c.id)}`];
        slug = candidates.find((s) => s && s !== base && !used.has(s) && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s)) ?? `${base}-${idx + 1}`;
      }
      used.add(slug);
      out.set(c.key, slug);
    });
  }
  return out;
}

/* ------------------------------------------------------------------------------------------ */
/* Helpers                                                                                     */
/* ------------------------------------------------------------------------------------------ */

const ev = (stamp: SourceStamp, field: string, method: string, opts: { location?: string | null; excerpt?: string | null; state?: Ev["state"]; confidence?: number; title?: string | null } = {}): Ev => ({
  field,
  sourceUrl: stamp.evidenceUrl,
  sourceTitle: opts.title ?? null,
  retrievedAt: stamp.retrievedAt,
  contentHash: stamp.hash,
  extractionMethod: method,
  location: opts.location ?? null,
  excerpt: excerpt(opts.excerpt ?? null),
  state: opts.state ?? "verified",
  confidence: opts.confidence ?? 0.9,
});

const DOCS_STATUS: Record<string, Lifecycle> = { ready: "stable", stable: "stable", experimental: "experimental", beta: "beta", deprecated: "deprecated" };
const DOCSJSON_STATUS: Record<string, Lifecycle> = { deprecated: "deprecated", draft: "experimental", beta: "beta" };

function mitLicense(npm: NpmInfo, licenseUrl: string | null, copyright: string | null): LicenseRef | null {
  if (!npm.license || npm.license.toUpperCase() !== "MIT") return null;
  return {
    slug: "mit",
    spdxId: "MIT",
    name: "MIT License",
    url: licenseUrl,
    isOpenSource: true,
    redistribution: "permitted",
    notes: `${copyright ? `${copyright}. ` : ""}Redistribution permitted with the copyright and permission notice retained.`,
  };
}

interface PageSet {
  overview?: { page: ParsedComponentPage; stamp: SourceStamp };
  guidelines?: { page: ParsedComponentPage; stamp: SourceStamp };
  accessibility?: { page: ParsedComponentPage; stamp: SourceStamp };
}

/** Sitemap URLs for a component docs slug: overview + sub-pages (sitemap has typos such as "acessibility", "guidlines"). */
function sitemapComponentPages(urls: string[]): Map<string, { overview?: string; guidelines?: string; accessibility?: string }> {
  const out = new Map<string, { overview?: string; guidelines?: string; accessibility?: string }>();
  for (const raw of urls) {
    const url = canonicalDocsUrl(raw);
    if (!url) continue;
    const m = /^\/product\/components\/([a-z0-9-]+)\/(?:([a-z0-9-]+)\/)?$/.exec(new URL(url).pathname);
    if (!m) continue;
    const slug = m[1]!;
    const sub = m[2];
    const e = out.get(slug) ?? {};
    if (!sub) e.overview = url;
    else if (/^acc|^aces/.test(sub)) e.accessibility = url;
    else if (/^guid/.test(sub)) e.guidelines = url;
    out.set(slug, e);
  }
  return out;
}

export function sitemapPageType(url: string): "overview" | "guidelines" | "accessibility" | "other" {
  const m = /^\/product\/components\/[a-z0-9-]+\/(?:([a-z0-9-]+)\/)?$/.exec(new URL(url).pathname);
  if (!m) return "other";
  const sub = m[1];
  if (!sub) return "overview";
  if (/^acc|^aces/.test(sub)) return "accessibility";
  if (/^guid/.test(sub)) return "guidelines";
  return "other";
}

/* ------------------------------------------------------------------------------------------ */
/* normalize                                                                                   */
/* ------------------------------------------------------------------------------------------ */

export interface NormalizeOptions {
  systemSlug: string;
  limit?: number;
  log?: (msg: string) => void;
}

export function normalizePrimer(fragments: PrimerFragmentData[], opts: NormalizeOptions): NormalizedBundle {
  const log = opts.log ?? (() => {});
  const byType = <T extends PrimerFragmentData["type"]>(t: T) => fragments.filter((f): f is Extract<PrimerFragmentData, { type: T }> => f.type === t);

  const cj = byType("components-json")[0] ?? null;
  const sitemap = byType("sitemap")[0] ?? null;
  const licenses = byType("license");
  const reactLicense = licenses.find((l) => l.npm.packageName === REACT_PKG) ?? null;
  const primLicense = licenses.find((l) => l.npm.packageName === PRIMITIVES_PKG) ?? null;

  /* ---------------------------------- tokens ---------------------------------- */
  const tokenSets: NormalizedTokenSet[] = [];
  const tokenFrags = byType("tokens");
  for (const spec of TOKEN_SETS) {
    const frags = spec.files.map((f) => tokenFrags.find((t) => t.setSlug === spec.slug && t.file === f)).filter((f): f is NonNullable<typeof f> => !!f);
    if (!frags.length) continue;
    const npm = frags[0]!.npm;
    const seen = new Set<string>();
    const tokens: NormalizedToken[] = [];
    for (const fr of frags) {
      for (const t of fr.tokens) {
        if (seen.has(t.name)) {
          log(`token set ${spec.slug}: duplicate token ${t.name} in ${fr.file}; kept first`);
          continue;
        }
        seen.add(t.name);
        tokens.push(t);
      }
    }
    tokens.sort((a, b) => a.name.localeCompare(b.name));
    tokenSets.push({
      slug: spec.slug,
      name: spec.name,
      theme: spec.theme,
      format: "dtcg",
      sourceUrl: npmFileUrl(npm.packageName, npm.version, spec.sourcePath),
      packageName: npm.packageName,
      packageVersion: npm.version,
      license: mitLicense(npm, primLicense?.stamp.evidenceUrl ?? null, primLicense?.copyright ?? null),
      redistribution: npm.license?.toUpperCase() === "MIT" ? "permitted" : "unknown",
      tokens,
      evidence: frags.map((fr) =>
        ev(fr.stamp, "tokens", spec.kind === "json5" ? METHOD.tokenJson5 : METHOD.tokenDocsJson, {
          location: fr.file,
          excerpt: `${fr.tokens.length} tokens from ${npm.packageName}@${npm.version}/${fr.file}${spec.theme ? ` (theme: ${spec.theme})` : ""}`,
          confidence: 0.95,
        }),
      ),
    });
  }
  /** cssVar -> token name (theme-independent names, so any set works). */
  const cssVarToToken = new Map<string, string>();
  for (const s of tokenSets) for (const t of s.tokens) if (t.cssVar && !cssVarToToken.has(t.cssVar)) cssVarToToken.set(t.cssVar, t.name);

  /* -------------------------------- components -------------------------------- */
  const components: NormalizedComponent[] = [];
  const componentPages = byType("component-page");
  const pagesBySlug = new Map<string, PageSet>();
  for (const f of componentPages) {
    const e = pagesBySlug.get(f.page.docsSlug) ?? {};
    if (f.page.pageType === "overview" || f.page.pageType === "guidelines" || f.page.pageType === "accessibility") e[f.page.pageType] = { page: f.page, stamp: f.stamp };
    pagesBySlug.set(f.page.docsSlug, e);
  }
  const sitemapPages = sitemapComponentPages(sitemap?.urls ?? []);
  const cssFrags = byType("css");
  const componentsJsonUrl = cj ? cj.stamp.evidenceUrl : null;

  if (cj) {
    const all = cj.data.components;
    const slugs = assignSlugs(all);
    const selected = selectComponents(all, opts.limit);
    const selectedKeys = new Set(selected.map((c) => c.key));

    // Docs page -> component assignment: the React "Source" link on the overview page decides among
    // same-named components; otherwise the primary (bare-slug) component gets the page.
    const docsOwner = new Map<string, string>(); // docsSlug -> component key
    const byBase = new Map<string, PrimerDocsComponent[]>();
    for (const c of all) byBase.set(slugify(c.name), [...(byBase.get(slugify(c.name)) ?? []), c]);
    for (const [docsSlug, sp] of sitemapPages) {
      if (!sp.overview) continue;
      const cands = byBase.get(docsSlug) ?? [];
      if (!cands.length) continue;
      const src = pagesBySlug.get(docsSlug)?.overview?.page.implementations.find((i) => /react/i.test(i.label))?.links.find((l) => /source/i.test(l.text))?.href;
      const norm = (u: string | null | undefined) => (u ?? "").replace(/\/+$/, "");
      const bySource = src ? cands.find((c) => norm(c.source) === norm(src)) : undefined;
      const primary = cands.find((c) => slugs.get(c.key) === docsSlug) ?? cands[0]!;
      docsOwner.set(docsSlug, (bySource ?? primary).key);
      if (src && !bySource) log(`docs page ${docsSlug}: React source link ${src} matches no docs.json entry; assigned to ${primary.name}`);
    }
    const docsSlugForKey = new Map([...docsOwner.entries()].map(([d, k]) => [k, d]));
    const docsUrlToSlug = new Map<string, string>();
    for (const [docsSlug, key] of docsOwner) {
      const ov = sitemapPages.get(docsSlug)?.overview;
      if (ov && selectedKeys.has(key)) docsUrlToSlug.set(ov, slugs.get(key)!);
    }
    const nameToSlug = new Map<string, string>();
    for (const c of all) if (slugs.get(c.key) === slugify(c.name)) nameToSlug.set(c.name, slugs.get(c.key)!);

    for (const c of selected) {
      const slug = slugs.get(c.key)!;
      const docsSlug = docsSlugForKey.get(c.key) ?? null;
      const sp = docsSlug ? sitemapPages.get(docsSlug) : undefined;
      const pages: PageSet = docsSlug ? (pagesBySlug.get(docsSlug) ?? {}) : {};
      components.push(
        buildComponent({ c, slug, cj, docsUrl: sp?.overview ?? null, sitemapEntry: sp ?? null, pages, cssFrags, cssVarToToken, docsUrlToSlug, nameToSlug, componentsJsonUrl: componentsJsonUrl!, reactCopyright: reactLicense?.copyright ?? null }),
      );
    }
  }
  components.sort((a, b) => a.slug.localeCompare(b.slug));

  /* --------------------------------- patterns --------------------------------- */
  const patterns: NormalizedPattern[] = [];
  const usedPatternSlugs = new Set<string>();
  const docsToComponent = new Map(components.filter((c) => c.docsUrl).map((c) => [c.docsUrl!, c.slug]));
  const patternFrags = byType("pattern-page").sort((a, b) => {
    const sa = PATTERN_SECTIONS.findIndex((s) => s.short === a.section);
    const sb = PATTERN_SECTIONS.findIndex((s) => s.short === b.section);
    return sa - sb || a.page.url.localeCompare(b.page.url);
  });
  for (const f of patternFrags) {
    const p = f.page;
    const name = p.title;
    if (!name) continue;
    const seg = new URL(p.url).pathname.replace(/\/+$/, "").split("/").pop() ?? "";
    let slug = slugify(seg) || slugify(name);
    if (usedPatternSlugs.has(slug)) slug = `${slug}-${f.section}`;
    if (usedPatternSlugs.has(slug)) continue;
    usedPatternSlugs.add(slug);
    const cls = classifyPatternName(name);
    const componentSlugs = uniq(p.componentLinks.map((u) => docsToComponent.get(u)).filter((s): s is string => !!s)).sort();
    const description = shortText(p.description, 280);
    patterns.push({
      slug,
      name,
      description,
      docsUrl: p.url,
      canonicalType: cls?.slug ?? null,
      classification: cls ? { state: "inferred", method: `taxonomy:${cls.method}`, confidence: cls.confidence } : null,
      componentSlugs,
      coverage: {
        description: description ? "documented" : "not-documented",
        components: componentSlugs.length ? "documented" : p.componentLinks.length ? "not-extracted" : "not-documented",
      },
      evidence: [
        ev(f.stamp, "*", METHOD.docsHtml, {
          title: `${f.sectionLabel}: ${name}`,
          location: "main h1 + p",
          excerpt: description,
          confidence: 0.9,
        }),
      ],
    });
    if (opts.limit && patterns.length >= opts.limit) break;
  }
  patterns.sort((a, b) => a.slug.localeCompare(b.slug));

  /* ----------------------------------- facts ----------------------------------- */
  const facts = buildFacts(cj, byType("system-page"), sitemap);

  return { systemSlug: opts.systemSlug, components, tokenSets, patterns, facts };
}

/* ------------------------------------------------------------------------------------------ */
/* Component builder                                                                           */
/* ------------------------------------------------------------------------------------------ */

interface BuildArgs {
  c: PrimerDocsComponent;
  slug: string;
  cj: Extract<PrimerFragmentData, { type: "components-json" }>;
  docsUrl: string | null;
  sitemapEntry: { overview?: string; guidelines?: string; accessibility?: string } | null;
  pages: PageSet;
  cssFrags: Extract<PrimerFragmentData, { type: "css" }>[];
  cssVarToToken: Map<string, string>;
  docsUrlToSlug: Map<string, string>;
  nameToSlug: Map<string, string>;
  componentsJsonUrl: string;
  reactCopyright: string | null;
}

function variantsFrom(c: PrimerDocsComponent, url: string, file: string) {
  const out: NormalizedComponent["variants"] = [];
  for (const p of c.props) {
    const axis = VARIANT_AXIS_PROPS[p.name];
    if (!axis || p.deprecated) continue;
    const values = parseStringLiteralUnion(p.type);
    if (!values) continue;
    for (const v of values) out.push({ axis, name: v, description: null, sourceUrl: url, location: `${file}#${p.pointer}` });
  }
  return out;
}

function sizesFrom(c: PrimerDocsComponent): { sizes: string[]; prop: PrimerProp | null } {
  for (const p of c.props) {
    if (p.deprecated || !(p.name === "size" || /^[a-z]+Size$/.test(p.name))) continue;
    const values = parseStringLiteralUnion(p.type);
    if (values?.length) return { sizes: values, prop: p };
  }
  return { sizes: [], prop: null };
}

function statesFrom(c: PrimerDocsComponent, url: string) {
  const out: NormalizedComponent["states"] = [];
  const seen = new Set<string>();
  for (const p of c.props) {
    const key = STATE_BOOLEAN_PROPS[p.name.toLowerCase()];
    if (key && /\bboolean\b/.test(p.type ?? "") && !seen.has(key)) {
      seen.add(key);
      out.push({ name: p.name, canonical: canonicalState(key) ?? canonicalState(p.name), description: `Documented \`${p.name}\` prop (${p.type}).`, sourceUrl: url });
    }
    if (p.name === "validationStatus") {
      for (const v of parseStringLiteralUnion(p.type) ?? []) {
        if (seen.has(v)) continue;
        seen.add(v);
        out.push({ name: v, canonical: canonicalState(v), description: `Documented \`validationStatus\` value '${v}'.`, sourceUrl: url });
      }
    }
  }
  return out;
}

function propertiesFrom(c: PrimerDocsComponent, url: string): NormalizedComponent["properties"] {
  const out: NormalizedComponent["properties"] = [];
  const push = (p: PrimerProp, prefix: string | null) =>
    out.push({
      implementation: "react",
      name: prefix ? `${prefix}.${p.name}` : p.name,
      type: p.type,
      defaultValue: p.defaultValue,
      required: p.required,
      deprecated: p.deprecated,
      description: p.description,
      allowedValues: parseStringLiteralUnion(p.type),
      sourceUrl: url,
    });
  for (const p of c.props) push(p, null);
  for (const s of c.subcomponents) for (const p of s.props) push(p, s.name);
  return out;
}

function storyTitle(id: string): string {
  const [group = "", story = id] = id.split("--");
  const tail = group.split("-").pop() ?? "";
  const base = humanize(story);
  return /^(features|examples|dev|playground)$/.test(tail) ? `${base} (${tail})` : base;
}

function buildComponent(a: BuildArgs): NormalizedComponent {
  const { c, slug, cj, pages } = a;
  const file = cj.file;
  const cjStamp = cj.stamp;
  const evidence: Ev[] = [];
  const coverage: Record<string, CoverageState> = {};
  const ov = pages.overview;
  const gl = pages.guidelines;
  const ax = pages.accessibility;

  evidence.push(
    ev(cjStamp, "*", METHOD.componentsJson, {
      title: `${REACT_PKG}@${cj.npm.version} generated/components.json`,
      location: `${file}#${c.pointer}`,
      excerpt: `${c.name} (id ${c.id}): status ${c.status ?? "n/a"}; importPath ${c.importPath ?? "n/a"}; a11yReviewed ${c.a11yReviewed ?? "no"}; ${c.props.length} props, ${c.subcomponents.length} subcomponents`,
      confidence: 0.95,
    }),
  );

  // Description (docs page)
  const description = shortText(ov?.page.description ?? null, 280);
  coverage.description = description ? "documented" : ov || !a.docsUrl ? "not-documented" : "not-extracted";
  if (ov) evidence.push(ev(ov.stamp, "description", METHOD.docsHtml, { title: ov.page.title, location: "main h1 + p", excerpt: description, confidence: 0.9 }));

  // Lifecycle
  const reactImpl = ov?.page.implementations.find((i) => /^react$/i.test(i.label));
  let lifecycle: Lifecycle = "unknown";
  if (reactImpl?.status && DOCS_STATUS[reactImpl.status]) lifecycle = DOCS_STATUS[reactImpl.status]!;
  else if (c.status && DOCSJSON_STATUS[c.status]) lifecycle = DOCSJSON_STATUS[c.status]!;

  // Classification
  const cls = classifyComponentName(c.name);
  let classification: NormalizedComponent["classification"] = null;
  if (cls) {
    const def = componentTypeBySlug.get(cls.slug);
    const apg = ax?.page.a11y?.apgPatterns ?? [];
    if (def?.ariaPattern && apg.includes(def.ariaPattern)) {
      classification = { state: "verified", method: `taxonomy:${cls.method}+apg-link:${def.ariaPattern}`, confidence: 0.95 };
    } else classification = { state: "inferred", method: `taxonomy:${cls.method}`, confidence: cls.confidence };
  }

  // Frameworks
  const frameworks: NormalizedComponent["frameworks"] = [
    { slug: "react", packageName: c.importPath ?? REACT_PKG, importName: c.name, sourceUrl: a.docsUrl ?? a.componentsJsonUrl },
  ];
  const figma = ov?.page.implementations.find((i) => /^figma$/i.test(i.label));
  const figmaLink = figma?.links.find((l) => /^https:\/\/(www\.)?figma\.com\//.test(l.href));
  if (figmaLink && ov) {
    frameworks.push({ slug: "figma", packageName: null, importName: null, sourceUrl: figmaLink.href });
    evidence.push(ev(ov.stamp, "frameworks.figma", METHOD.docsHtml, { location: "implementation card: Figma", excerpt: `Figma: ${figmaLink.text} (${figmaLink.href})` }));
  }
  const rails = ov?.page.implementations.find((i) => /^rails$/i.test(i.label));
  if (rails && ov) {
    // Rails (primer/view_components) has no ATLAS framework slug yet; recorded as evidence only.
    evidence.push(
      ev(ov.stamp, "frameworks.rails", METHOD.docsHtml, {
        location: "implementation card: Rails",
        excerpt: `Rails implementation: ${rails.status ?? "status n/a"}; ${rails.links.map((l) => `${l.text}: ${l.href}`).join("; ")}`,
      }),
    );
  }
  if (reactImpl && ov) evidence.push(ev(ov.stamp, "lifecycle", METHOD.docsHtml, { location: "implementation card: React", excerpt: `React implementation status: ${reactImpl.status ?? "n/a"}` }));
  coverage.frameworks = "documented";

  // Variants / sizes / states / properties (docs.json)
  const variants = variantsFrom(c, a.componentsJsonUrl, file);
  coverage.variants = variants.length ? "documented" : "not-documented";
  const { sizes } = sizesFrom(c);
  coverage.sizes = sizes.length ? "documented" : "not-documented";
  const states = statesFrom(c, a.componentsJsonUrl);
  coverage.states = states.length ? "inferred" : "not-documented";
  const properties = propertiesFrom(c, a.componentsJsonUrl);
  coverage.properties = properties.length ? "documented" : "not-documented";

  // Accessibility
  let accessibility: NormalizedComponent["accessibility"] = null;
  const a11y = ax?.page.a11y ?? null;
  if (ax && a11y) {
    const keyboard = a11y.keyboard.map((k) => ({ keys: k.keys, action: (k.context ? shortText(`${k.context}: ${k.action}`, 280) : k.action) ?? k.action }));
    const has = (v: unknown) => (Array.isArray(v) ? v.length > 0 : !!v);
    const cov = (v: unknown): CoverageState => (has(v) ? "documented" : "not-extracted");
    accessibility = {
      ariaPattern: a11y.apgPatterns[0] ?? null,
      roles: a11y.roles.length ? a11y.roles : null,
      keyboard: keyboard.length ? keyboard : null,
      guidance: a11y.guidance,
      screenReader: a11y.screenReader?.text ?? null,
      focusManagement: a11y.focusManagement?.text ?? null,
      wcagCriteria: a11y.wcag.length ? a11y.wcag : null,
      docsUrl: ax.page.url,
      coverage: {
        keyboard: keyboard.length ? "documented" : a11y.keyboardSectionFound || a11y.mentionsKeys ? "not-extracted" : "not-documented",
        roles: cov(a11y.roles),
        guidance: cov(a11y.guidance),
        screenReader: cov(a11y.screenReader),
        focusManagement: cov(a11y.focusManagement),
        wcagCriteria: cov(a11y.wcag),
        ariaPattern: cov(a11y.apgPatterns),
      },
    };
    coverage.accessibility = "documented";
    coverage.keyboard = accessibility.coverage.keyboard!;
    const kbAnchor = a11y.keyboard.find((k) => k.anchor)?.anchor;
    evidence.push(
      ev(ax.stamp, "accessibility", METHOD.docsHtml, {
        title: `Accessibility - ${ax.page.title ?? c.name}`,
        location: kbAnchor ? `#${kbAnchor}` : "main",
        excerpt: a11y.guidance ?? a11y.keyboard[0]?.action ?? null,
        confidence: 0.85,
      }),
    );
  } else {
    // No accessibility page listed in the sitemap => not documented; listed but not fetched => not extracted.
    const listed = !!a.sitemapEntry?.accessibility;
    coverage.accessibility = listed ? "not-extracted" : "not-documented";
    coverage.keyboard = listed ? "not-extracted" : "not-documented";
  }
  if (c.a11yReviewed) {
    evidence.push(ev(cjStamp, "accessibility.reviewed", METHOD.componentsJson, { location: `${file}#${c.pointer}/a11yReviewed`, excerpt: `a11yReviewed: ${c.a11yReviewed}`, confidence: 0.95 }));
  }

  // Responsive guidance
  const resp = gl?.page.responsive ?? ov?.page.responsive ?? null;
  const respPage = gl?.page.responsive ? gl : ov?.page.responsive ? ov : null;
  const anyPage = ov || gl;
  coverage.responsive = resp ? "documented" : anyPage && ![ov, gl].some((p) => p?.page.mentionsResponsive) ? "not-documented" : "not-extracted";
  if (resp && respPage) evidence.push(ev(respPage.stamp, "responsiveGuidance", METHOD.docsHtml, { location: resp.anchor ? `#${resp.anchor}` : resp.heading, excerpt: resp.text, confidence: 0.8 }));

  // Examples
  const examples: NormalizedComponent["examples"] = [];
  if (ov && a.docsUrl) {
    for (const e of ov.page.examples.slice(0, 25)) examples.push({ slug: `docs-${slugify(e.id) || "example"}`, title: e.title, kind: "docs-link", url: `${a.docsUrl}#${e.id}` });
  }
  const copyright = a.reactCopyright ?? "Copyright (c) GitHub, Inc.";
  for (const s of c.stories.slice(0, 15)) {
    examples.push({ slug: `story-${slugify(s.id)}`, title: storyTitle(s.id), kind: "storybook-link", url: STORYBOOK_STORY_URL(s.id) });
  }
  for (const s of c.stories) {
    if (!s.code) continue;
    examples.push({
      slug: `code-${slugify(s.id)}`,
      title: storyTitle(s.id),
      kind: "code-snippet",
      language: "tsx",
      code: s.code,
      url: STORYBOOK_STORY_URL(s.id),
      attribution: `Story "${s.id}" from ${REACT_PKG}@${cj.npm.version} (generated/components.json). MIT License, ${copyright}.`,
    });
  }
  const exSeen = new Set<string>();
  const examplesDedup = examples.filter((e) => (exSeen.has(e.slug) ? false : (exSeen.add(e.slug), true)));
  coverage.examples = examplesDedup.length ? "documented" : "not-documented";

  // Relationships: in-content links between component docs pages (see-also) and documented prop passthrough (composes).
  const rel: NormalizedComponent["relationships"] = [];
  const linkUrls = uniq([ov, gl, ax].flatMap((p) => p?.page.componentLinks ?? []));
  for (const u of linkUrls) {
    const target = a.docsUrlToSlug.get(u);
    if (target && target !== slug) rel.push({ kind: "see-also", targetSlug: target, targetType: null });
  }
  if (c.passthrough) {
    const target = a.nameToSlug.get(c.passthrough.element);
    if (target && target !== slug) {
      rel.push({ kind: "composes", targetSlug: target, targetType: null });
      evidence.push(ev(cjStamp, "relationships", METHOD.componentsJson, { location: `${file}#${c.pointer}/passthrough`, excerpt: `passthrough element: ${c.passthrough.element}` }));
    }
  }
  const relSeen = new Set<string>();
  const relationships = rel
    .filter((r) => {
      const k = `${r.kind}|${r.targetSlug}`;
      if (relSeen.has(k)) return false;
      relSeen.add(k);
      return true;
    })
    .sort((x, y) => x.kind.localeCompare(y.kind) || (x.targetSlug ?? "").localeCompare(y.targetSlug ?? ""));
  if (relationships.some((r) => r.kind === "see-also")) {
    const p = [ov, gl, ax].find((pp) => pp?.page.componentLinks.length);
    if (p) evidence.push(ev(p.stamp, "relationships", METHOD.docsHtml, { location: "in-content links to /product/components/*", excerpt: `Links to: ${relationships.filter((r) => r.kind === "see-also").map((r) => r.targetSlug).join(", ")}`, confidence: 0.8 }));
  }
  coverage.relationships = relationships.length ? "documented" : "not-extracted";

  // Token usages from compiled CSS modules in the component's source directory (inferred attribution).
  const dir = sourceDir(c.source);
  const css = dir ? a.cssFrags.filter((f) => f.dir === dir).sort((x, y) => x.file.localeCompare(y.file)) : [];
  const tuSeen = new Set<string>();
  const tokenUsages: NormalizedComponent["tokenUsages"] = [];
  for (const f of css) {
    for (const u of f.usages) {
      const tokenName = a.cssVarToToken.get(u.varName);
      if (!tokenName) continue;
      const k = `${tokenName}|${u.property}`;
      if (tuSeen.has(k)) continue;
      tuSeen.add(k);
      tokenUsages.push({ tokenName, property: u.property });
    }
  }
  tokenUsages.sort((x, y) => x.tokenName.localeCompare(y.tokenName) || (x.property ?? "").localeCompare(y.property ?? ""));
  const tokenUsagesCapped = tokenUsages.slice(0, 400);
  coverage.tokens = tokenUsagesCapped.length ? "inferred" : "not-extracted";
  for (const f of css) {
    evidence.push(
      ev(f.stamp, "tokenUsages", METHOD.cssVars, {
        location: f.file,
        excerpt: `${f.usages.length} var() usages in ${f.file} (component source dir ${dir})`,
        state: "inferred",
        confidence: 0.7,
      }),
    );
  }

  return {
    slug,
    name: c.name,
    aliases: [],
    description,
    docsUrl: a.docsUrl,
    sourceCodeUrl: c.source && /^https:\/\//.test(c.source) ? c.source : null,
    lifecycle,
    canonicalType: cls?.slug ?? null,
    classification,
    frameworks,
    variants,
    states,
    sizes: sizes.length ? sizes : null,
    properties,
    accessibility,
    examples: examplesDedup,
    relationships,
    tokenUsages: tokenUsagesCapped,
    responsiveGuidance: resp?.text ?? null,
    coverage,
    evidence,
  };
}

/* ------------------------------------------------------------------------------------------ */
/* System facts                                                                                */
/* ------------------------------------------------------------------------------------------ */

function buildFacts(
  cj: Extract<PrimerFragmentData, { type: "components-json" }> | null,
  sys: Extract<PrimerFragmentData, { type: "system-page" }>[],
  sitemap: Extract<PrimerFragmentData, { type: "sitemap" }> | null,
): NormalizedSystemFacts | null {
  const evidence: Ev[] = [];
  const gs = sys.find((s) => s.key === "gettingStarted");
  const ph = sys.find((s) => s.key === "reactPhilosophy");
  const hasFigmaPage = (sitemap?.urls ?? []).some((u) => canonicalDocsUrl(u) === `${DOCS_ORIGIN}${SYSTEM_PAGES.figma}`);

  if (cj) {
    evidence.push({
      field: "latestVersion",
      sourceUrl: `https://www.npmjs.com/package/${REACT_PKG}/v/${cj.npm.version}`,
      sourceTitle: `${REACT_PKG} on npm`,
      retrievedAt: cj.stamp.retrievedAt,
      contentHash: null,
      extractionMethod: METHOD.npm,
      location: "dist-tags.latest",
      excerpt: `latest ${cj.npm.version}${cj.npm.publishedAt ? ` published ${cj.npm.publishedAt}` : ""}; license ${cj.npm.license ?? "n/a"}`,
      state: "verified",
      confidence: 0.95,
    });
  }

  const principles = (gs?.page.headings ?? [])
    .filter((h) => h.level === 2)
    .map((h) => ({ name: h.text, sourceUrl: h.id ? `${gs!.page.url}#${h.id}` : gs!.page.url }));
  if (gs && principles.length) {
    evidence.push(ev(gs.stamp, "principles", METHOD.docsHtml, { title: gs.page.title, location: "main h2", excerpt: principles.map((p) => p.name).join("; ") }));
  }

  let philosophy: string | null = null;
  if (gs) {
    const parts: string[] = [];
    const builtFor = /built by GitHub for GitHub/i.test(gs.page.description ?? "");
    parts.push(builtFor ? `Primer is GitHub's design system, described in its getting-started guide as "built by GitHub for GitHub".` : "Primer is GitHub's design system.");
    if (principles.length) parts.push(`That guide is organized around: ${principles.map((p) => p.name).join("; ")}.`);
    const noData = ph?.page.paragraphs.some((p) => /don't handle fetching|do not handle fetching/i.test(p.replace(/&#x27;|’/g, "'")));
    if (ph && ph.page.headings.some((h) => /presentational components/i.test(h.text))) {
      parts.push(`Primer React's stated philosophy focuses on presentational components${noData ? " that do not fetch or submit data themselves" : ""}.`);
      evidence.push(ev(ph.stamp, "philosophy", METHOD.docsHtml, { title: ph.page.title, location: "main h2", excerpt: ph.page.headings.map((h) => h.text).join("; ") }));
    }
    philosophy = parts.join(" ");
    evidence.push(ev(gs.stamp, "philosophy", METHOD.docsHtml, { title: gs.page.title, location: "main h1 + p", excerpt: gs.page.description }));
  }

  const frameworks: NonNullable<NormalizedSystemFacts["frameworks"]> = [{ slug: "react", packageName: REACT_PKG }];
  if (hasFigmaPage) frameworks.push({ slug: "figma", packageName: null });
  if (hasFigmaPage && sitemap) evidence.push(ev(sitemap.stamp, "frameworks.figma", METHOD.docsHtml, { location: SYSTEM_PAGES.figma, excerpt: `Sitemap lists ${DOCS_ORIGIN}${SYSTEM_PAGES.figma}` }));

  if (!cj && !gs) return null;
  return {
    latestVersion: cj?.npm.version ?? null,
    latestReleaseAt: cj?.npm.publishedAt ?? null,
    philosophy,
    principles: principles.length ? principles : null,
    frameworks,
    evidence,
  };
}

export { componentSlugFromUrl };
