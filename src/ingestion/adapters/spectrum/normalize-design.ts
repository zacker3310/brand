/**
 * Adobe Spectrum ("adobe-spectrum") bundle.
 *
 * Components = the Spectrum 2 component catalog published on spectrum.adobe.com (query-index:
 * /web/{rsp|swc|design-only}/components/<slug>) joined by slug with Adobe's machine-readable
 * component schemas (@adobe/spectrum-design-data components/<slug>.json). Schemas without a
 * published guideline page are included too (design-data definitions; docsUrl null).
 *  - guideline pages: description, states support table, keyboard + WCAG tables, per-implementation
 *    component options data (React Spectrum props + status, Spectrum Web Components attributes).
 *  - schemas: design-level options (variants, sizes), states, implementations, ARIA role, WCAG, token bindings.
 *  - tokens: Spectrum token `component` ownership -> tokenUsages.
 * Tokens: see tokens.ts. Patterns: content-design and app-frame guideline pages.
 */
import type { CoverageState, EvidenceInput, KeyboardInteraction, NormalizedBundle, NormalizedComponent, NormalizedPattern, NormalizedSystemFacts } from "@/lib/contracts";
import { canonicalState, classifyComponentName, classifyPatternName } from "@/lib/taxonomy";
import { slugify } from "@/lib/utils";
import { PKG, siteUrl } from "./constants";
import { fragsOf, pick, type Frag } from "./fragments";
import type { ComponentSchema } from "./schema";
import { clip, evidence, firstSentence, lifecycleFromStatus, uniqBy, cmp } from "./shared";
import { siteComponents, sitePatternRows, type SiteComponent, type SiteProp } from "./site";
import { buildTokenSets } from "./tokens";

const MAX_PROPS = 150;
const MAX_TOKEN_USAGES = 200;

/** ARIA roles that map to exactly one ATLAS type (source-declared role => verified classification). */
const ROLE_TYPES: Record<string, string> = {
  switch: "switch",
  slider: "slider",
  checkbox: "checkbox",
  tooltip: "tooltip",
  tree: "tree",
  treegrid: "tree",
  progressbar: "progress-indicator",
  meter: "progress-indicator",
  combobox: "combobox",
  tablist: "tabs",
  radiogroup: "radio",
  breadcrumb: "breadcrumbs",
  separator: "divider",
};

/** Schema option names that are visual variant axes. */
const OPTION_AXES: Record<string, string> = { variant: "variant", style: "appearance", fillStyle: "appearance", density: "density", shape: "shape" };

function frameworkSlugFor(pkg: string | null, importPath: string | null): "react" | "web-components" | null {
  const s = `${pkg ?? ""} ${importPath ?? ""}`;
  if (/@react-spectrum\//.test(s)) return "react";
  if (/spectrum-wc|spectrum-web-components/.test(s)) return "web-components";
  return null;
}

interface Parts {
  site?: SiteComponent;
  schema?: Frag<"schema">;
  pages: Frag<"site-page">[];
  frags: Frag<"site-fragment">[];
}

function propRows(props: SiteProp[], impl: string, url: string, attrName: boolean): NormalizedComponent["properties"] {
  const out: NormalizedComponent["properties"] = [];
  const seen = new Set<string>();
  for (const p of props) {
    const name = attrName ? (p.attribute ?? p.name) : p.name;
    if (seen.has(name) || seen.size >= MAX_PROPS) continue;
    seen.add(name);
    out.push({
      implementation: impl,
      name,
      type: p.type,
      defaultValue: p.defaultValue,
      required: p.required,
      deprecated: /^deprecated\b|@deprecated/i.test(p.description ?? ""),
      description: p.description ? clip(p.description, 600) : null,
      allowedValues: p.values.length ? p.values : null,
      sourceUrl: url,
    });
  }
  return out;
}

function buildComponent(slug: string, parts: Parts, ctx: { slugs: Set<string>; index?: Frag<"site-index">; componentTokens: Map<string, string[]>; tokenNames: Set<string>; tokensEv: EvidenceInput | null }): NormalizedComponent {
  const { site, schema: sf } = parts;
  const schema: ComponentSchema | undefined = sf?.schema;
  const ev: EvidenceInput[] = [];
  const coverage: Record<string, CoverageState> = {};
  const primaryPage = site?.pages[0];
  const docsUrl = primaryPage ? siteUrl(primaryPage.path) : null;
  const name = site?.title ?? schema?.displayName ?? slug;
  const pageFrag = (impl: string) => parts.pages.find((p) => p.impl === impl);
  const frag = (section: string) => parts.frags.find((f) => f.section === section);

  if (site && ctx.index) for (const p of site.pages) ev.push(evidence("*", ctx.index.ev, "site-index", 0.95, { location: `${ctx.index.ev.location}#path=${p.path}`, excerpt: `${p.title} (${p.impl})` }));
  if (sf) ev.push(evidence("*", sf.ev, "component-schema", 0.95, { location: `${sf.ev.location}#/name`, excerpt: `${schema!.name}${schema!.displayName ? ` (${schema!.displayName})` : ""}` }));

  // Description
  let description: string | null = null;
  if (site?.description && ctx.index) {
    description = firstSentence(site.description);
    ev.push(evidence("description", ctx.index.ev, "site-index", 0.9, { location: `${ctx.index.ev.location}#path=${primaryPage!.path}/description`, excerpt: site.description }));
  } else if (schema?.description && sf) {
    description = firstSentence(schema.description);
    ev.push(evidence("description", sf.ev, "component-schema", 0.9, { location: `${sf.ev.location}#/description`, excerpt: schema.description }));
  }
  coverage.description = description ? "documented" : "not-documented";

  // Variants + sizes (design-level options from the schema; rsp options data as fallback)
  const variants: NormalizedComponent["variants"] = [];
  let sizes: string[] | null = null;
  const rsp = pageFrag("rsp");
  const swc = pageFrag("swc");
  for (const o of schema?.options ?? []) {
    const axis = OPTION_AXES[o.name];
    if (axis && o.values.length) {
      for (const v of o.values) variants.push({ axis, name: v, description: null, sourceUrl: docsUrl, location: `${sf!.ev.location}#/options/${o.name}` });
      ev.push(evidence("variants", sf!.ev, "component-schema", 0.95, { location: `${sf!.ev.location}#/options/${o.name}`, excerpt: `${o.name}: ${o.values.join(", ")}` }));
    }
    if (o.name === "size" && o.values.length) {
      sizes = [...o.values];
      ev.push(evidence("sizes", sf!.ev, "component-schema", 0.95, { location: `${sf!.ev.location}#/options/size`, excerpt: `size: ${o.values.join(", ")}` }));
    }
  }
  if (!variants.length && rsp?.data) {
    const vp = rsp.data.props.find((p) => p.name === "variant" && p.values.length);
    if (vp) {
      for (const v of vp.values) variants.push({ axis: "variant", name: v, description: null, sourceUrl: siteUrl(rsp.path), location: `${rsp.dataEv!.location}#variant` });
      ev.push(evidence("variants", rsp.dataEv!, "site-options-data", 0.85, { location: `${rsp.dataEv!.location}#variant`, excerpt: `variant: ${vp.values.join(", ")}` }));
    }
  }
  if (!sizes && rsp?.data) {
    const sp = rsp.data.props.find((p) => p.name === "size" && p.values.length);
    if (sp) {
      sizes = [...sp.values];
      ev.push(evidence("sizes", rsp.dataEv!, "site-options-data", 0.85, { location: `${rsp.dataEv!.location}#size`, excerpt: `size: ${sp.values.join(", ")}` }));
    }
  }
  coverage.variants = variants.length ? "documented" : schema || rsp?.data ? "not-documented" : "not-extracted";
  coverage.sizes = sizes ? "documented" : schema || rsp?.data ? "not-documented" : "not-extracted";

  // States: guideline support table (Supported rows) > schema states.
  let states: NormalizedComponent["states"] = [];
  const st = frag("states");
  const supported = st?.states?.filter((s) => s.supported === true) ?? [];
  if (st && supported.length) {
    states = uniqBy(supported, (s) => slugify(s.name)).map((s) => ({ name: s.name, canonical: canonicalState(s.name), description: null, sourceUrl: docsUrl }));
    const unsupported = (st.states ?? []).filter((s) => s.supported === false).map((s) => s.name);
    ev.push(evidence("states", st.ev, "site-states", 0.95, { location: `${st.ev.location} (State | Support status)`, excerpt: `Supported: ${supported.map((s) => s.name).join(", ")}${unsupported.length ? `; not supported: ${unsupported.join(", ")}` : ""}` }));
    coverage.states = "documented";
  } else if (schema?.states.length) {
    states = uniqBy(schema.states, (s) => slugify(s)).map((s) => ({ name: s, canonical: canonicalState(s), description: null, sourceUrl: docsUrl }));
    ev.push(evidence("states", sf!.ev, "component-schema", 0.9, { location: `${sf!.ev.location}#/states` }));
    coverage.states = "documented";
  } else coverage.states = st || schema ? "not-documented" : "not-extracted";

  // Properties per implementation
  const properties: NormalizedComponent["properties"] = [];
  if (schema?.options.length) {
    for (const o of schema.options.slice(0, MAX_PROPS)) {
      properties.push({
        implementation: "default",
        name: o.name,
        type: o.type,
        defaultValue: o.defaultValue,
        required: null,
        deprecated: false,
        description: o.description ? clip(o.description, 600) : null,
        allowedValues: o.values.length ? o.values : null,
        sourceUrl: docsUrl ?? sf!.ev.sourceUrl,
      });
    }
    ev.push(evidence("properties", sf!.ev, "component-schema", 0.95, { location: `${sf!.ev.location}#/options (design-level component options)` }));
  }
  if (rsp?.data?.props.length) {
    properties.push(...propRows(rsp.data.props, "react", siteUrl(rsp.path), false));
    ev.push(evidence("properties", rsp.dataEv!, "site-options-data", 0.9, { location: `${rsp.dataEv!.location} (React Spectrum component options)` }));
  }
  if (swc?.data?.props.length) {
    properties.push(...propRows(swc.data.props, "web-components", siteUrl(swc.path), true));
    ev.push(evidence("properties", swc.dataEv!, "site-options-data", 0.9, { location: `${swc.dataEv!.location} (Spectrum Web Components attributes)` }));
  }
  coverage.properties = properties.length ? "documented" : schema || rsp || swc ? "not-documented" : "not-extracted";

  // Frameworks: schema implementations + implementation pages on the guidelines site.
  const frameworks: NormalizedComponent["frameworks"] = [];
  const addFw = (slugFw: "react" | "web-components", packageName: string | null, importName: string | null, sourceUrl: string | null) => {
    const ex = frameworks.find((f) => f.slug === slugFw);
    if (ex) {
      ex.packageName ??= packageName;
      ex.importName ??= importName;
      ex.sourceUrl ??= sourceUrl;
      return;
    }
    frameworks.push({ slug: slugFw, packageName, importName, sourceUrl });
  };
  for (const im of schema?.implementations ?? []) {
    const fw = frameworkSlugFor(im.packageName, im.importPath);
    if (!fw) continue;
    addFw(fw, im.packageName, im.componentName, fw === "react" && rsp ? siteUrl(rsp.path) : fw === "web-components" && swc ? siteUrl(swc.path) : null);
  }
  if (schema?.implementations.some((im) => frameworkSlugFor(im.packageName, im.importPath))) ev.push(evidence("frameworks", sf!.ev, "component-schema", 0.95, { location: `${sf!.ev.location}#/implementations` }));
  const implPages = site?.pages ?? [];
  for (const p of implPages) {
    if (p.impl === "rsp") addFw("react", null, rsp?.page.dataName && /^[A-Z]/.test(rsp.page.dataName) ? rsp.page.dataName : null, siteUrl(p.path));
    if (p.impl === "swc") addFw("web-components", null, null, siteUrl(p.path));
  }
  if (ctx.index && implPages.some((p) => p.impl !== "design-only")) ev.push(evidence("frameworks", ctx.index.ev, "site-index", 0.9, { location: `${ctx.index.ev.location} (implementation pages: ${implPages.map((p) => p.impl).join(", ")})` }));
  const designOnly = implPages.length > 0 && implPages.every((p) => p.impl === "design-only");
  if (designOnly && ctx.index && !frameworks.length) ev.push(evidence("frameworks", ctx.index.ev, "site-index", 0.85, { location: `${ctx.index.ev.location}#path=${primaryPage!.path} (published as design-only)` }));
  coverage.frameworks = frameworks.length ? "documented" : designOnly ? "documented-none" : schema ? "not-documented" : "not-extracted";
  frameworks.sort((a, b) => cmp(a.slug, b.slug));

  // Accessibility: keyboard + WCAG tables (guidelines), ARIA role + WCAG (schema).
  const a11yFrag = frag("accessibility");
  const kb: KeyboardInteraction[] = uniqBy(a11yFrag?.a11y?.keyboard ?? [], (k) => `${k.keys}|${k.action}`)
    .slice(0, 20)
    .map((k) => ({ keys: clip(k.keys, 80), action: clip(k.action, 300) }));
  const wcag = [...new Set([...(a11yFrag?.a11y?.wcag ?? []).flatMap((w) => w.criteria), ...(schema?.wcag ?? [])])].sort();
  const roles = schema?.role ? [schema.role] : [];
  let accessibility: NormalizedComponent["accessibility"] = null;
  if (kb.length || wcag.length || roles.length) {
    accessibility = {
      ariaPattern: null,
      roles: roles.length ? roles : null,
      keyboard: kb.length ? kb : null,
      guidance: null,
      screenReader: null,
      focusManagement: null,
      wcagCriteria: wcag.length ? wcag : null,
      docsUrl,
      coverage: {
        keyboard: kb.length ? "documented" : a11yFrag?.a11y?.keyboardSection ? "not-extracted" : a11yFrag ? "not-documented" : "not-extracted",
        wcagCriteria: wcag.length ? "documented" : "not-extracted",
        roles: roles.length ? "documented" : "not-extracted",
        ariaPattern: "not-extracted",
        guidance: "not-extracted",
        screenReader: "not-extracted",
        focusManagement: "not-extracted",
      },
    };
    if (a11yFrag && (kb.length || a11yFrag.a11y?.wcag.length)) ev.push(evidence("accessibility", a11yFrag.ev, "site-a11y", 0.95, { location: `${a11yFrag.ev.location} (Keyboard interactions / WCAG 2.2 compliance tables)` }));
    if (kb.length) ev.push(evidence("keyboard", a11yFrag!.ev, "site-a11y", 0.95, { location: `${a11yFrag!.ev.location}#keyboard-interactions`, excerpt: `${kb[0]!.keys}: ${kb[0]!.action}` }));
    if (sf && (roles.length || schema?.wcag.length)) ev.push(evidence("accessibility", sf.ev, "component-schema", 0.9, { location: `${sf.ev.location}#/accessibility`, excerpt: roles.length ? `role: ${roles[0]}` : null }));
  }
  coverage.accessibility = accessibility ? "documented" : a11yFrag || schema ? "not-documented" : "not-extracted";
  coverage.keyboard = kb.length ? "documented" : a11yFrag?.a11y?.keyboardSection ? "not-extracted" : a11yFrag ? "not-documented" : "not-extracted";
  coverage.responsive = "not-extracted";

  // Token usages: tokens owned by this component (`component` field) + schema token bindings.
  const owned = [...(ctx.componentTokens.get(slug) ?? []), ...(schema && schema.name !== slug ? (ctx.componentTokens.get(schema.name) ?? []) : [])];
  const bound = (schema?.tokenBindings ?? []).filter((t) => ctx.tokenNames.has(t));
  const tokenUsages = uniqBy([...bound, ...owned], (t) => t)
    .slice(0, MAX_TOKEN_USAGES)
    .map((t) => ({ tokenName: t, property: null }));
  if (owned.length && ctx.tokensEv) ev.push({ ...ctx.tokensEv, field: "tokens", location: `${ctx.tokensEv.location} (tokens with "component": "${slug}")` });
  if (bound.length && sf) ev.push(evidence("tokens", sf.ev, "component-schema", 0.9, { location: `${sf.ev.location}#/tokenBindings` }));
  coverage.tokens = tokenUsages.length ? "documented" : "not-documented";

  // Examples: links to the per-implementation guideline pages.
  const examples: NormalizedComponent["examples"] = implPages.map((p) => ({
    slug: `${p.impl}-guidelines`,
    title: p.impl === "rsp" ? `${name} guidelines (React Spectrum)` : p.impl === "swc" ? `${name} guidelines (Spectrum Web Components)` : `${name} guidelines (design only)`,
    kind: "docs-link" as const,
    language: null,
    code: null,
    url: siteUrl(p.path),
    attribution: "Adobe Spectrum (spectrum.adobe.com)",
  }));
  if (examples.length && ctx.index) ev.push(evidence("examples", ctx.index.ev, "site-index", 0.9, { location: `${ctx.index.ev.location} (implementation pages)` }));
  coverage.examples = examples.length ? "documented" : "not-documented";

  // Relationships: links to other component pages from fetched pages/fragments.
  const linked = new Set<string>();
  for (const p of parts.pages) for (const l of p.page.links) linked.add(l);
  for (const f of parts.frags) for (const l of f.links) linked.add(l);
  linked.delete(slug);
  const relationships: NormalizedComponent["relationships"] = [...linked]
    .filter((l) => ctx.slugs.has(l))
    .sort()
    .map((l) => ({ kind: "related", targetSlug: l, targetType: null }));
  const linkSrc = [...parts.pages, ...parts.frags].find((x) => ("page" in x ? x.page.links : x.links).some((l) => l !== slug && ctx.slugs.has(l)));
  if (relationships.length && linkSrc) ev.push(evidence("relationships", linkSrc.ev, "site-links", 0.75, { location: `${linkSrc.ev.location} (links to component pages)` }));
  coverage.relationships = relationships.length ? "documented" : parts.pages.length || parts.frags.length ? "not-documented" : "not-extracted";

  // Lifecycle: status published in the React Spectrum options data; schema deprecation.
  let lifecycle: NormalizedComponent["lifecycle"] = "unknown";
  if (schema?.lifecycle.deprecated && sf) {
    lifecycle = "deprecated";
    ev.push(evidence("lifecycle", sf.ev, "component-schema", 0.9, { location: `${sf.ev.location}#/lifecycle/deprecated`, excerpt: `deprecated: ${schema.lifecycle.deprecated}` }));
  } else if (rsp?.data?.status) {
    lifecycle = lifecycleFromStatus(rsp.data.status);
    ev.push(evidence("lifecycle", rsp.dataEv!, "site-options-data", 0.8, { location: `${rsp.dataEv!.location}#status`, excerpt: `status: ${rsp.data.status} (React Spectrum implementation)` }));
  }

  // Classification
  // An ARIA role is not a component type (Picker uses role combobox, Color area uses slider), so the
  // source-declared role only upgrades a name-based classification to verified when both agree.
  let canonicalType: string | null = null;
  let classification: NormalizedComponent["classification"] = null;
  const roleType = schema?.role ? ROLE_TYPES[schema.role] : undefined;
  const byName = classifyComponentName(name) ?? (schema?.displayName ? classifyComponentName(schema.displayName) : null);
  if (byName && roleType === byName.slug) {
    canonicalType = byName.slug;
    classification = { state: "verified", method: `${byName.method} + aria-role:${schema!.role} (design-data accessibility.role)`, confidence: 0.9 };
  } else if (byName) {
    canonicalType = byName.slug;
    classification = { state: "inferred", method: byName.method, confidence: byName.confidence };
  } else if (roleType) {
    canonicalType = roleType;
    classification = { state: "inferred", method: `aria-role:${schema!.role} (design-data accessibility.role)`, confidence: 0.6 };
  }

  const aliases: string[] = [];
  if (schema?.displayName && schema.displayName.toLowerCase() !== name.toLowerCase()) aliases.push(schema.displayName);
  for (const f of frameworks) if (f.importName && f.importName.toLowerCase() !== name.replace(/\s+/g, "").toLowerCase()) aliases.push(f.importName);

  return {
    slug,
    name,
    aliases: uniqBy(aliases, (a) => a).sort(),
    description,
    docsUrl,
    sourceCodeUrl: null,
    lifecycle,
    canonicalType,
    classification,
    frameworks,
    variants: uniqBy(variants, (v) => `${v.axis}|${v.name}`),
    states,
    sizes,
    properties,
    accessibility,
    examples,
    relationships,
    tokenUsages,
    responsiveGuidance: null,
    coverage,
    evidence: uniqBy(ev, (e) => `${e.field}|${e.sourceUrl}|${e.location}`),
  };
}

function buildPatterns(index: Frag<"site-index"> | undefined): NormalizedPattern[] {
  if (!index) return [];
  const used = new Set<string>();
  return sitePatternRows(index.rows).map((r) => {
    const rel = r.path.replace(/^\/(content|foundations)\//, "");
    let slug = slugify(rel.replace(/\//g, "-")) || slugify(r.title);
    for (let i = 2; used.has(slug); i++) slug = `${slugify(rel)}-${i}`;
    used.add(slug);
    const isContent = r.path.startsWith("/content/");
    const exact = classifyPatternName(r.title);
    const cls =
      exact && exact.confidence >= 0.8
        ? { slug: exact.slug, method: exact.method, confidence: exact.confidence }
        : isContent
          ? { slug: "content-and-writing", method: "site-section:/content/ (content design guidance)", confidence: 0.7 }
          : { slug: "layout-and-structure", method: "site-section:/foundations/app-frame/ (app frame composition)", confidence: 0.65 };
    const description = firstSentence(r.description);
    return {
      slug,
      name: r.title,
      description,
      docsUrl: siteUrl(r.path),
      canonicalType: cls.slug,
      classification: { state: "inferred" as const, method: cls.method, confidence: cls.confidence },
      componentSlugs: [],
      coverage: { description: description ? "documented" : "not-documented", components: "not-extracted" },
      evidence: [evidence("*", index.ev, "site-index", 0.9, { location: `${index.ev.location}#path=${r.path}`, excerpt: r.description ?? r.title })],
    };
  });
}

function buildFacts(pkg: Frag<"pkg"> | undefined, principles: Frag<"principles"> | undefined, schemas: Frag<"schema">[]): NormalizedSystemFacts | null {
  const ev: EvidenceInput[] = [];
  if (pkg) {
    ev.push(evidence("latestVersion", pkg.ev, "npm-version", 0.95, { excerpt: `${pkg.name}@${pkg.version}${pkg.publishedAt ? ` published ${pkg.publishedAt}` : ""}` }));
    if (pkg.publishedAt) ev.push(evidence("latestReleaseAt", pkg.ev, "npm-version", 0.95, { excerpt: `${pkg.name}@${pkg.version} published ${pkg.publishedAt}` }));
  }
  let pr: NormalizedSystemFacts["principles"] = null;
  let philosophy: string | null = null;
  if (principles?.data.principles.length) {
    pr = principles.data.principles.map((p) => ({ name: p.name, sourceUrl: principles.url }));
    ev.push(evidence("principles", principles.ev, "site-principles", 0.95, { location: `${principles.ev.location} (h2 headings)`, excerpt: principles.data.principles.map((p) => p.name).join(", ") }));
    if (principles.data.intro) {
      philosophy = `Spectrum's principles page states: "${firstSentence(principles.data.intro, 600)}" It lists these principles: ${principles.data.principles.map((p) => p.name).join("; ")}.`;
      ev.push(evidence("philosophy", principles.ev, "site-principles", 0.85, { location: `${principles.ev.location} (intro paragraph)`, excerpt: principles.data.intro }));
    }
  }
  const fw = new Map<string, string | null>();
  let fwEv: Frag<"schema"> | undefined;
  for (const s of [...schemas].sort((a, b) => cmp(a.name, b.name))) {
    for (const im of s.schema.implementations) {
      const f = frameworkSlugFor(im.packageName, im.importPath);
      if (f && !fw.has(f)) {
        fw.set(f, im.packageName);
        fwEv ??= s;
      }
    }
  }
  if (fwEv) ev.push(evidence("frameworks", fwEv.ev, "component-schema", 0.85, { location: `${fwEv.ev.location}#/implementations` }));
  if (!pkg && !pr && !fw.size) return null;
  return {
    latestVersion: pkg?.version ?? null,
    latestReleaseAt: pkg?.publishedAt ?? null,
    philosophy: philosophy ? philosophy.slice(0, 1500) : null,
    principles: pr,
    frameworks: fw.size ? [...fw.entries()].sort((a, b) => cmp(a[0], b[0])).map(([slug, packageName]) => ({ slug, packageName })) : null,
    evidence: ev,
  };
}

export function normalizeDesign(fragments: { data: unknown }[], opts: { limit?: number } = {}): NormalizedBundle & { tokenReport: { skipped: string[]; themedToScale: string[] } } {
  const frs = fragsOf(fragments);
  const index = pick(frs, "site-index")[0];
  const schemas = pick(frs, "schema").sort((a, b) => cmp(a.name, b.name));
  const pages = pick(frs, "site-page");
  const sfrags = pick(frs, "site-fragment");

  // Tokens first (component token ownership feeds tokenUsages).
  const tokPkg = pick(frs, "pkg").find((p) => p.name === PKG.tokens);
  const tokFiles = pick(frs, "tokens");
  const css = pick(frs, "cssvars")[0];
  const built = buildTokenSets(
    tokFiles.map((f) => ({ file: f.file, tokens: f.tokens, ev: f.ev })),
    { pkg: PKG.tokens, version: tokPkg?.version ?? tokFiles[0]?.ev.sourceUrl.match(/@(\d+\.\d+\.\d+[^/]*)\//)?.[1] ?? "unknown", cssVars: css ? new Set(css.names) : null, cssEv: css?.ev ?? null },
  );
  const tokenNames = new Set(built.sets.flatMap((s) => s.tokens.map((t) => t.name)));
  const firstTokFile = [...tokFiles].sort((a, b) => cmp(a.file, b.file))[0];
  const tokensEv = firstTokFile ? evidence("tokens", { ...firstTokFile.ev, location: `${PKG.tokens} src/*.json` }, "tokens-json", 0.9) : null;

  // Component identity: guideline pages (by slug) + design-data schemas (by name).
  const site = index ? siteComponents(index.rows) : [];
  const limitedSite = opts.limit ? site.slice(0, opts.limit) : site;
  const bySlug = new Map<string, Parts>();
  for (const c of limitedSite) bySlug.set(c.slug, { site: c, pages: [], frags: [] });
  for (const s of schemas) {
    const p = bySlug.get(s.name);
    if (p) p.schema = s;
    else if (!opts.limit) bySlug.set(s.name, { schema: s, pages: [], frags: [] });
  }
  for (const p of pages) bySlug.get(p.slug)?.pages.push(p);
  for (const f of sfrags) bySlug.get(f.slug)?.frags.push(f);
  const slugs = new Set(bySlug.keys());
  const components = [...bySlug.entries()]
    .sort((a, b) => cmp(a[0], b[0]))
    .filter(([, p]) => p.site || p.schema)
    .map(([slug, p]) => {
      p.pages.sort((a, b) => cmp(a.impl, b.impl));
      p.frags.sort((a, b) => cmp(a.section, b.section));
      return buildComponent(slug, p, { slugs, index, componentTokens: built.componentTokens, tokenNames, tokensEv });
    });

  return {
    systemSlug: "adobe-spectrum",
    components,
    tokenSets: built.sets,
    patterns: buildPatterns(index),
    facts: buildFacts(tokPkg, pick(frs, "principles")[0], schemas),
    tokenReport: { skipped: built.skipped, themedToScale: built.themedToScale },
  };
}
