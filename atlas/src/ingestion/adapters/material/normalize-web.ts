/**
 * material-web (Material Web Components, @material/web) component modeling.
 *
 * Modeling decision (truthful to the source):
 *  - One ATLAS component per docs page (docs/components/<stem>.md), named with the page title
 *    ("Buttons", "Icon Buttons", "Text field"), slug = the docs file stem ("button").
 *  - Custom elements that the page documents as *types* of that component (listed under
 *    "## Types", or given their own "## <Type>" section, or adjective-prefixed element families such
 *    as md-filled-select/md-outlined-select) become variants on axis "type". Their API tables are
 *    merged into the component's properties (implementation "web-components"); properties present
 *    on only some elements say so in their description.
 *  - Other custom elements documented on the page (md-menu-item, md-sub-menu, md-list-item,
 *    md-chip-set, md-select-option) become separate components linked with
 *    "subcomponent"/"parent" relationships, because they are distinct parts, not variants.
 *  - Custom elements in custom-elements.json that have no docs page (labs/*, field/*) are emitted
 *    from the manifest only; labs elements carry lifecycle "experimental" (labs/README.md).
 */
import type { CoverageMap, EvidenceInput, NormalizedComponent, NormalizedExample, NormalizedProperty, NormalizedState, NormalizedVariant } from "@/lib/contracts";
import { canonicalState, classifyComponentName } from "@/lib/taxonomy";
import { slugify } from "@/lib/utils";
import { githubBlobUrl } from "@/ingestion/http";
import type { CemElement } from "./cem";
import { githubAnchor, type ApiElement, type DocTableRow, type MwcDoc } from "./mwc-docs";
import { MW_OWNER, MW_PACKAGE, MW_REPO, MW_REPO_URL, clip, evidence, firstSentence, singularize, sortBy, uniq, type Prov } from "./shared";

export interface MwcDocInput {
  prov: Prov;
  stem: string;
  doc: MwcDoc;
}

export interface MwcContext {
  version: string;
  ref: string;
  cem: { prov: Prov; elements: CemElement[] } | null;
  labsReadme: { prov: Prov; excerpt: string | null } | null;
  /** CSS custom property -> material-web token name (from the token build). */
  tokenByCssVar: Map<string, string>;
}

const GENERIC_SECTIONS = new Set(["types", "usage", "accessibility", "theming", "api", "interactive demo", "icon items", "image items"]);
const VARIANT_ADJ = /^md-(filled|outlined|elevated|text|tonal|filled-tonal|standard|primary|secondary|branded|linear|circular)-/;

export function displayName(className: string): string {
  const words = className
    .replace(/^Md/, "")
    .replace(/El$/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(" ");
  return words.map((w, i) => (i === 0 ? w : w.toLowerCase())).join(" ");
}

const norm = (s: string) =>
  singularize(s.toLowerCase().replace(/\(.*?\)/g, " ").replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " "))
    .split(" ")
    .map((w) => singularize(w))
    .join(" ");

/** Classify, trying the authored name, then a singular / parenthesis-free form, then extra aliases. */
export function classifyName(name: string, extra: string[] = []) {
  const bare = name.replace(/\s*\(.*?\)\s*/g, " ").replace(/\s+/g, " ").trim();
  const paren = /\(([^)]+)\)/.exec(name)?.[1];
  const candidates: [string, string][] = [
    [name, ""],
    [singularize(bare), "singular+"],
    ...(paren ? ([[paren, "parenthetical+"]] as [string, string][]) : []),
    ...extra.map((e) => [e, "alias+"] as [string, string]),
  ];
  for (const [c, tag] of candidates) {
    const r = classifyComponentName(c);
    if (r) return { slug: r.slug, method: `${tag}${r.method}`, confidence: tag ? Math.min(r.confidence, 0.8) : r.confidence };
  }
  return null;
}

export function literalUnion(type: string | null | undefined): string[] | null {
  if (!type) return null;
  const parts = type.split("|").map((p) => p.trim());
  if (parts.length < 2) return null;
  const vals: string[] = [];
  for (const p of parts) {
    const m = /^(["'])(.*)\1$/.exec(p);
    if (!m) return null;
    vals.push(m[2]!);
  }
  return vals;
}

const STATE_PROPS: Record<string, string> = {
  disabled: "disabled",
  softDisabled: "disabled",
  checked: "selected",
  selected: "selected",
  indeterminate: "indeterminate",
  error: "error",
  readOnly: "readonly",
  open: "expanded",
  focused: "focus",
};

function pin(url: string | null, ref: string): string | null {
  if (!url) return null;
  if (url.startsWith(`${MW_REPO_URL}/tree/main/`) || url.startsWith(`${MW_REPO_URL}/blob/main/`)) return url.replace(/\/(tree|blob)\/main\//, `/$1/${ref}/`);
  return url;
}

function propsFromRows(rows: DocTableRow[], sourceUrl: string): NormalizedProperty[] {
  return rows
    .filter((r) => r.Property)
    .map((r) => {
      const desc = r.Description || null;
      const attr = r.Attribute || null;
      const lead = attr ? `Attribute \`${attr}\`.` : "Property only (no attribute).";
      return {
        implementation: "web-components",
        name: r.Property!,
        type: r.Type || null,
        defaultValue: r.Default || null,
        required: null,
        deprecated: /@deprecated|\bdeprecated\b/i.test(desc ?? ""),
        description: clip([lead, firstSentence(desc, 400)].filter(Boolean).join(" "), 600),
        allowedValues: literalUnion(r.Type),
        sourceUrl,
      };
    });
}

function propsFromCem(el: CemElement, sourceUrl: string): NormalizedProperty[] {
  return el.properties.map((p) => ({
    implementation: "web-components",
    name: p.name,
    type: p.type,
    defaultValue: p.default,
    required: null,
    deprecated: /@deprecated|\bdeprecated\b/i.test(p.description ?? ""),
    description: clip([p.attribute ? `Attribute \`${p.attribute}\`.` : "Property only (no attribute).", firstSentence(p.description, 400)].filter(Boolean).join(" "), 600),
    allowedValues: literalUnion(p.type),
    sourceUrl,
  }));
}

/** Merge per-element property lists; note element-specific properties. */
function mergeProps(perElement: { tag: string; props: NormalizedProperty[] }[]): NormalizedProperty[] {
  const byName = new Map<string, { p: NormalizedProperty; tags: string[] }>();
  for (const { tag, props } of perElement) {
    for (const p of props) {
      const cur = byName.get(p.name);
      if (cur) cur.tags.push(tag);
      else byName.set(p.name, { p, tags: [tag] });
    }
  }
  const all = perElement.length;
  return [...byName.values()].map(({ p, tags }) =>
    tags.length < all && all > 1 ? { ...p, description: clip(`${p.description ?? ""} Only on: ${uniq(tags).map((t) => `<${t}>`).join(", ")}.`, 600) } : p,
  );
}

function statesFromProps(props: NormalizedProperty[], sourceUrl: string): NormalizedState[] {
  const out: NormalizedState[] = [];
  for (const p of props) {
    const canon = STATE_PROPS[p.name];
    if (!canon || !/boolean/.test(p.type ?? "")) continue;
    const attr = /Attribute `([^`]+)`/.exec(p.description ?? "")?.[1] ?? p.name;
    out.push({ name: attr, canonical: canonicalState(attr) ?? canon, description: `Boolean property \`${p.name}\` documented in the API table.`, sourceUrl });
  }
  return sortBy(
    out.filter((s, i) => out.findIndex((o) => o.name === s.name) === i),
    (s) => s.name,
  );
}

interface ElementRole {
  api: ApiElement | null;
  cem: CemElement | null;
  tag: string;
  className: string;
  role: "variant" | "primary" | "sub";
  variantName: string | null;
}

export function classifyElements(doc: MwcDoc, stem: string, cemByTag: Map<string, CemElement>): ElementRole[] {
  const stemSing = singularize(stem.replace(/-/g, " ")).replace(/ /g, "-");
  const typeNames = uniq([...doc.types, ...doc.sections.filter((s) => s.depth === 2 && !GENERIC_SECTIONS.has(s.title.toLowerCase())).map((s) => s.title)]);
  const els: { api: ApiElement | null; tag: string; className: string }[] = doc.api.map((a) => ({ api: a, tag: a.tagName, className: a.className }));
  if (!els.length) {
    const cem = cemByTag.get(`md-${stem}`) ?? cemByTag.get(`md-${stemSing}`);
    if (cem) els.push({ api: null, tag: cem.tagName, className: cem.className });
  }
  return els.map((e) => {
    const dn = displayName(e.className);
    const typeMatch = typeNames.find((t) => norm(t) === norm(dn));
    const tagVariant = VARIANT_ADJ.test(e.tag) && (e.tag.endsWith(`-${stem}`) || e.tag.endsWith(`-${stemSing}`));
    const role: ElementRole["role"] = typeMatch || tagVariant ? "variant" : e.tag === `md-${stem}` || e.tag === `md-${stemSing}` || els.length === 1 ? "primary" : "sub";
    return { api: e.api, cem: cemByTag.get(e.tag) ?? null, tag: e.tag, className: e.className, role, variantName: role === "variant" ? (typeMatch ?? dn) : null };
  });
}

function baseCoverage(): CoverageMap {
  return {
    description: "not-documented",
    variants: "not-documented",
    states: "not-documented",
    sizes: "not-documented",
    properties: "not-documented",
    accessibility: "not-documented",
    keyboard: "not-documented",
    responsive: "not-documented",
    tokens: "not-documented",
    examples: "not-documented",
    frameworks: "not-documented",
    relationships: "not-documented",
  };
}

const ATTRIBUTION = (file: string, ref: string) => `Copyright Google LLC, Apache-2.0. From ${MW_OWNER}/${MW_REPO}@${ref} ${file}.`;

export function normalizeMwcComponents(docs: MwcDocInput[], ctx: MwcContext): { components: NormalizedComponent[]; warnings: string[] } {
  const warnings: string[] = [];
  const cemByTag = new Map((ctx.cem?.elements ?? []).map((e) => [e.tagName, e]));
  const documentedTags = new Set<string>();
  const components: NormalizedComponent[] = [];
  const blob = (file: string, anchor?: string) => `${githubBlobUrl(MW_OWNER, MW_REPO, ctx.ref, file)}${anchor ? `#${anchor}` : ""}`;
  const npmFile = (p: string) => `https://cdn.jsdelivr.net/npm/${MW_PACKAGE}@${ctx.version}/${p}`;
  const cemEvidence = (el: CemElement, field: string) =>
    ctx.cem ? evidence(ctx.cem.prov, field, "custom-elements-manifest", { location: `custom-elements.json#${el.pointer}`, excerpt: `<${el.tagName}> ${el.className} (${el.modulePath})` }) : null;

  for (const { prov, stem, doc } of sortBy(docs, (d) => d.stem)) {
    if (!doc.title) {
      warnings.push(`${prov.file}: no H1 title; skipped`);
      continue;
    }
    const roles = classifyElements(doc, stem, cemByTag);
    roles.forEach((r) => documentedTags.add(r.tag));
    const famEls = roles.filter((r) => r.role !== "sub");
    const subs = roles.filter((r) => r.role === "sub");
    const docsUrl = doc.catalogUrl ?? blob(prov.file);
    const famSlug = slugify(stem);
    const ev: EvidenceInput[] = [evidence(prov, "*", "mwc-docs-md", { location: prov.file, title: doc.title, excerpt: doc.title })];
    const coverage = baseCoverage();

    // description
    const description = firstSentence(doc.intro);
    if (description) {
      coverage.description = "documented";
      ev.push(evidence(prov, "description", "mwc-docs-md", { location: `${prov.file}#L${doc.introLine ?? 0}`, excerpt: description }));
    }

    // variants
    const variants: NormalizedVariant[] = [];
    const typeOrder = doc.types.length ? doc.types : famEls.filter((r) => r.role === "variant").map((r) => r.variantName!);
    const seenVariant = new Set<string>();
    const addVariant = (name: string, el: ElementRole | undefined) => {
      if (seenVariant.has(norm(name))) return;
      seenVariant.add(norm(name));
      const section = doc.sections.find((s) => norm(s.title) === norm(name) && s.depth === 2) ?? doc.sections.find((s) => norm(s.title) === norm(name));
      const anchor = section?.anchor ?? (doc.types.includes(name) ? "types" : undefined);
      const sentence = firstSentence(section?.firstParagraph ?? null, 240) ?? (el?.cem ? firstSentence(el.cem.summary, 240) : null);
      variants.push({
        axis: "type",
        name,
        description: clip([el ? `Element <${el.tag}>.` : null, sentence].filter(Boolean).join(" "), 400),
        sourceUrl: blob(prov.file, anchor),
        location: `${prov.file}#${anchor ?? ""}`,
      });
    };
    for (const t of typeOrder) addVariant(t, famEls.find((r) => r.role === "variant" && norm(r.variantName!) === norm(t)));
    for (const r of famEls.filter((x) => x.role === "variant")) addVariant(r.variantName!, r);
    if (variants.length) {
      coverage.variants = "documented";
      ev.push(evidence(prov, "variants", "mwc-docs-md", { location: `${prov.file}#types`, excerpt: variants.map((v) => v.name).join(", ") }));
    }

    // properties (merged across family elements)
    const perEl = famEls
      .map((r) => {
        const anchor = r.api ? githubAnchor(`${r.api.className} <${r.api.tagName}>`) : undefined;
        const props = r.api ? propsFromRows(r.api.properties, blob(prov.file, anchor)) : r.cem ? propsFromCem(r.cem, npmFile("custom-elements.json")) : [];
        return { tag: r.tag, props };
      })
      .filter((p) => p.props.length || famEls.length === 1);
    const properties = sortBy(mergeProps(perEl), (p) => p.name);
    if (properties.length) {
      coverage.properties = "documented";
      ev.push(evidence(prov, "properties", "mwc-docs-api-table", { location: `${prov.file}#api`, excerpt: `${properties.length} properties across ${perEl.map((p) => `<${p.tag}>`).join(", ")}` }));
    }

    // sizes (only when a `size` property enumerates literal values)
    const sizeProp = properties.find((p) => p.name === "size" && p.allowedValues?.length);
    const sizes = sizeProp?.allowedValues ?? null;
    if (sizes) coverage.sizes = "documented";

    // states (derived from documented boolean properties)
    const states = statesFromProps(properties, blob(prov.file, "api"));
    if (states.length) coverage.states = "inferred";

    // accessibility
    let accessibility: NormalizedComponent["accessibility"] = null;
    if (doc.accessibility && doc.accessibility.paragraphs.length) {
      const guidance = clip(
        doc.accessibility.paragraphs.map((p) => (p.heading ? `${p.heading}: ${p.text}` : p.text)).join(" "),
        1100,
      );
      const kb = uniq(doc.accessibility.keyboard.map((k) => JSON.stringify({ keys: k.keys, action: clip(k.action, 240)! }))).map((s) => JSON.parse(s) as { keys: string; action: string });
      accessibility = {
        ariaPattern: null,
        roles: doc.accessibility.roles.length ? doc.accessibility.roles : null,
        keyboard: kb.length ? kb : null,
        guidance,
        screenReader: null,
        focusManagement: null,
        wcagCriteria: null,
        docsUrl: blob(prov.file, "accessibility"),
        coverage: {
          guidance: "documented",
          roles: doc.accessibility.roles.length ? "documented" : "not-documented",
          keyboard: kb.length ? "documented" : "not-documented",
          screenReader: "not-extracted",
          focusManagement: "not-extracted",
          wcagCriteria: "not-documented",
        },
      };
      coverage.accessibility = "documented";
      coverage.keyboard = kb.length ? "documented" : "not-documented";
      ev.push(evidence(prov, "accessibility", "mwc-docs-md", { location: `${prov.file}#L${doc.accessibility.line}`, excerpt: guidance }));
    }

    // tokens (documented theming tables)
    const tokenUsages: NormalizedComponent["tokenUsages"] = [];
    for (const table of doc.theming) {
      for (const t of table.tokens) tokenUsages.push({ tokenName: ctx.tokenByCssVar.get(t.name) ?? t.name, property: t.name });
    }
    if (tokenUsages.length) {
      coverage.tokens = "documented";
      ev.push(evidence(prov, "tokens", "mwc-docs-md", { location: `${prov.file}#theming`, excerpt: tokenUsages.slice(0, 6).map((t) => t.property).join(", ") }));
    }

    // examples: docs links + short code samples (Apache-2.0, attributed)
    const examples: NormalizedExample[] = [];
    if (doc.catalogUrl) examples.push({ slug: "catalog", title: `Material Web catalog: ${doc.title}`, kind: "docs-link", url: doc.catalogUrl, language: null, code: null, attribution: null });
    if (doc.designArticleUrl) examples.push({ slug: "m3-design-article", title: "Material Design 3 design article", kind: "docs-link", url: doc.designArticleUrl, language: null, code: null, attribution: null });
    for (const c of doc.codeSamples.filter((s) => (s.lang ?? "html") === "html").slice(0, 3)) {
      examples.push({
        slug: slugify(`code-${c.anchor ?? "sample"}-${c.line}`),
        title: `${doc.title}: ${c.heading ?? "example"}`,
        kind: "code-snippet",
        language: "html",
        code: c.code.slice(0, 4000),
        url: blob(prov.file, c.anchor ?? undefined),
        attribution: ATTRIBUTION(prov.file, ctx.ref),
      });
    }
    if (examples.length) coverage.examples = "documented";

    // frameworks
    const primary = famEls.length === 1 ? famEls[0]! : null;
    const frameworks: NormalizedComponent["frameworks"] = famEls.length
      ? [
          {
            slug: "web-components",
            packageName: MW_PACKAGE,
            importName: primary?.cem ? `${MW_PACKAGE}/${primary.cem.modulePath}` : null,
            sourceUrl: `https://www.npmjs.com/package/${MW_PACKAGE}/v/${ctx.version}`,
          },
        ]
      : [];
    if (frameworks.length) {
      coverage.frameworks = "documented";
      for (const r of famEls) {
        const e = r.cem ? cemEvidence(r.cem, "frameworks") : null;
        if (e) ev.push(e);
      }
    }

    // relationships
    const relationships = subs.map((s) => ({ kind: "subcomponent", targetSlug: slugify(s.tag.replace(/^md-/, "")), targetType: null }));
    if (relationships.length) coverage.relationships = "documented";

    const cls = classifyName(doc.title, doc.frontmatter.name ? [doc.frontmatter.name] : []);
    const sourceCodeUrl = pin(doc.sourceCodeUrl, ctx.ref) ?? (famEls[0]?.cem ? `${MW_REPO_URL}/tree/${ctx.ref}/${famEls[0].cem.modulePath.split("/")[0]}` : null);
    components.push({
      slug: famSlug,
      name: doc.title,
      aliases: uniq([...(doc.frontmatter.name && doc.frontmatter.name !== doc.title ? [doc.frontmatter.name] : []), ...famEls.map((r) => `<${r.tag}>`)]),
      description,
      docsUrl,
      sourceCodeUrl,
      lifecycle: "unknown",
      canonicalType: cls?.slug ?? null,
      classification: cls ? { state: "inferred", method: cls.method, confidence: cls.confidence } : null,
      frameworks,
      variants,
      states,
      sizes,
      properties,
      accessibility,
      examples,
      relationships,
      tokenUsages,
      responsiveGuidance: null,
      coverage,
      evidence: ev,
    });

    // subcomponents
    for (const s of subs) {
      const anchor = s.api ? githubAnchor(`${s.api.className} <${s.api.tagName}>`) : undefined;
      const sev: EvidenceInput[] = [evidence(prov, "*", "mwc-docs-api-table", { location: `${prov.file}#${anchor ?? "api"}`, excerpt: `${s.className} <${s.tag}>` })];
      const scov = baseCoverage();
      const desc = firstSentence(s.cem?.summary ?? s.cem?.description ?? null);
      if (desc && s.cem) {
        scov.description = "documented";
        const e = cemEvidence(s.cem, "description");
        if (e) sev.push({ ...e, excerpt: desc });
      }
      const props = sortBy(s.api ? propsFromRows(s.api.properties, blob(prov.file, anchor)) : [], (p) => p.name);
      if (props.length) {
        scov.properties = "documented";
        sev.push(evidence(prov, "properties", "mwc-docs-api-table", { location: `${prov.file}#${anchor}`, excerpt: `${props.length} properties of <${s.tag}>` }));
      }
      const sstates = statesFromProps(props, blob(prov.file, anchor));
      if (sstates.length) scov.states = "inferred";
      scov.accessibility = "not-extracted";
      scov.keyboard = "not-extracted";
      scov.frameworks = "documented";
      scov.relationships = "documented";
      scov.examples = "not-extracted";
      scov.tokens = "not-extracted";
      const name = displayName(s.className);
      const scls = classifyName(name);
      if (s.cem) {
        const e = cemEvidence(s.cem, "frameworks");
        if (e) sev.push(e);
      }
      components.push({
        slug: slugify(s.tag.replace(/^md-/, "")),
        name,
        aliases: [`<${s.tag}>`, s.className],
        description: desc,
        docsUrl,
        sourceCodeUrl: s.cem ? `${MW_REPO_URL}/tree/${ctx.ref}/${s.cem.modulePath.split("/").slice(0, -1).join("/")}` : sourceCodeUrl,
        lifecycle: "unknown",
        canonicalType: scls?.slug ?? null,
        classification: scls ? { state: "inferred", method: scls.method, confidence: scls.confidence } : null,
        frameworks: [{ slug: "web-components", packageName: MW_PACKAGE, importName: s.cem ? `${MW_PACKAGE}/${s.cem.modulePath}` : null, sourceUrl: `https://www.npmjs.com/package/${MW_PACKAGE}/v/${ctx.version}` }],
        variants: [],
        states: sstates,
        sizes: null,
        properties: props,
        accessibility: null,
        examples: [],
        relationships: [{ kind: "parent", targetSlug: famSlug, targetType: null }],
        tokenUsages: [],
        responsiveGuidance: null,
        coverage: scov,
        evidence: sev,
      });
    }
  }

  // Custom elements without a docs page (manifest only).
  if (ctx.cem) {
    const undocumented = ctx.cem.elements.filter((e) => !documentedTags.has(e.tagName));
    const groups = new Map<string, CemElement[]>();
    for (const e of undocumented) {
      const dir = e.modulePath.split("/").slice(0, -1).join("/");
      const dn = displayName(e.className);
      const lastWord = dn.split(" ").slice(-1)[0]!.toLowerCase();
      const adjective = /^md-(filled|outlined|elevated)-/.test(e.tagName);
      const key = adjective ? `${dir}|${lastWord}` : `${dir}|${e.tagName}`;
      groups.set(key, [...(groups.get(key) ?? []), e]);
    }
    for (const [key, els] of sortBy([...groups.entries()], ([k]) => k)) {
      const isFamily = els.length > 1;
      const first = els[0]!;
      const dir = key.split("|")[0]!;
      const isLabs = first.modulePath.startsWith("labs/");
      const name = isFamily ? (() => {
        const w = displayName(first.className).split(" ").slice(-1)[0]!;
        return w.charAt(0).toUpperCase() + w.slice(1);
      })() : displayName(first.className);
      const slug = slugify(isFamily ? `${isLabs ? "labs-" : ""}${name}` : `${isLabs ? "labs-" : ""}${first.tagName.replace(/^md-/, "")}`);
      const scov = baseCoverage();
      const ev: EvidenceInput[] = [];
      for (const e of els) {
        const x = cemEvidence(e, "*");
        if (x) ev.push(x);
      }
      if (isLabs && ctx.labsReadme) ev.push(evidence(ctx.labsReadme.prov, "lifecycle", "mwc-readme", { location: ctx.labsReadme.prov.file, excerpt: ctx.labsReadme.excerpt }));
      const desc = firstSentence(els.map((e) => e.summary ?? e.description).find(Boolean) ?? null);
      if (desc) scov.description = "documented";
      const perEl = els.map((e) => ({ tag: e.tagName, props: propsFromCem(e, npmFile("custom-elements.json")) }));
      const properties = sortBy(mergeProps(perEl), (p) => p.name);
      if (properties.length) scov.properties = "documented";
      const variants: NormalizedVariant[] = isFamily
        ? els.map((e) => ({ axis: "type", name: displayName(e.className), description: `Element <${e.tagName}>.`, sourceUrl: npmFile("custom-elements.json"), location: `custom-elements.json#${e.pointer}` }))
        : [];
      if (variants.length) scov.variants = "documented";
      const states = statesFromProps(properties, npmFile("custom-elements.json"));
      if (states.length) scov.states = "inferred";
      scov.frameworks = "documented";
      scov.accessibility = "not-documented";
      scov.keyboard = "not-documented";
      scov.examples = "not-documented";
      scov.tokens = "not-extracted";
      const cls = classifyName(name);
      components.push({
        slug,
        name,
        aliases: els.map((e) => `<${e.tagName}>`),
        description: desc,
        docsUrl: null,
        sourceCodeUrl: `${MW_REPO_URL}/tree/${ctx.ref}/${dir}`,
        lifecycle: isLabs ? "experimental" : "unknown",
        canonicalType: cls?.slug ?? null,
        classification: cls ? { state: "inferred", method: cls.method, confidence: cls.confidence } : null,
        frameworks: [{ slug: "web-components", packageName: MW_PACKAGE, importName: isFamily ? null : `${MW_PACKAGE}/${first.modulePath}`, sourceUrl: `https://www.npmjs.com/package/${MW_PACKAGE}/v/${ctx.version}` }],
        variants,
        states,
        sizes: null,
        properties,
        accessibility: null,
        examples: [],
        relationships: [],
        tokenUsages: [],
        responsiveGuidance: null,
        coverage: scov,
        evidence: ev.length ? ev : [evidence(ctx.cem.prov, "*", "custom-elements-manifest", { location: "custom-elements.json" })],
      });
    }
  }
  return { components: sortBy(components, (c) => c.slug), warnings };
}
