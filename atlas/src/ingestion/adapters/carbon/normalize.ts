/**
 * Merge Carbon parse fragments into a NormalizedBundle. Deterministic: inputs are sorted by
 * plan order / names, never by fetch completion order.
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
import { ADAPTER_ID, LICENSE_APACHE, MONOREPO_URL, normKey, PKG } from "./constants";
import type { A11yData, AboutData, CodeData, ComponentIndexEntry, DocKeyboard, PatternData, StyleData, UsageData } from "./docs";
import { lifecycleFromLabel, type LiveMeta } from "./live";
import type { PatternPlan, PlanItem } from "./plan";
import type { ExtractedProp } from "./proptypes";
import type { WcTag } from "./wca";

/* ------------------------------- fragments -------------------------------- */

export interface Ev {
  sourceUrl: string;
  retrievedAt: string;
  contentHash: string | null;
  location: string;
}

export type CarbonFragment =
  | { t: "nav"; plan: PlanItem[]; patterns: PatternPlan[]; ev: Ev }
  | { t: "index"; entries: ComponentIndexEntry[]; ev: Ev }
  | { t: "usage"; slug: string; data: UsageData; ev: Ev }
  | { t: "style"; slug: string; data: StyleData; ev: Ev }
  | { t: "code"; slug: string; data: CodeData; ev: Ev }
  | { t: "a11y"; slug: string; data: A11yData; ev: Ev }
  | { t: "live"; slug: string; meta: LiveMeta; ev: Ev }
  | { t: "react"; slug: string; exportName: string; implementation: string; found: boolean; props: ExtractedProp[]; sourcePath: string | null; version: string; ev: Ev }
  | { t: "wca"; tags: WcTag[]; version: string; ev: Ev }
  | { t: "pattern"; slug: string; plan: PatternPlan; data: PatternData; ev: Ev }
  | { t: "about"; docsUrl: string; data: AboutData; ev: Ev }
  | { t: "tokens"; setKey: string; part: string; order: number; tokens: NormalizedToken[]; fileDescription: string | null; colorScheme: string | null; pkg: string; version: string; ev: Ev }
  | { t: "cssvars"; names: string[]; pkg: string; version: string; ev: Ev }
  | { t: "pkg"; name: string; version: string; license: string | null; publishedAt: string | null; ev: Ev };

/* -------------------------------- helpers --------------------------------- */

const method = (parser: string) => `adapter:${ADAPTER_ID}:${parser}`;

function evidence(field: string, ev: Ev, parser: string, confidence: number, extra: Partial<EvidenceInput> = {}): EvidenceInput {
  return {
    field,
    sourceUrl: ev.sourceUrl,
    retrievedAt: ev.retrievedAt,
    contentHash: ev.contentHash,
    extractionMethod: method(parser),
    location: extra.location ?? ev.location,
    state: "verified",
    confidence,
    ...extra,
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

const ROLE_TYPES: Record<string, string> = {
  switch: "switch",
  slider: "slider",
  tree: "tree",
  checkbox: "checkbox",
  progressbar: "progress-indicator",
  tooltip: "tooltip",
};

function classify(name: string, altNames: string[], roles: string[]): { slug: string; state: "verified" | "inferred"; method: string; confidence: number } | null {
  const candidates: { slug: string; method: string; confidence: number }[] = [];
  const add = (n: string, label: string | null) => {
    const c = classifyComponentName(n);
    if (c) candidates.push({ ...c, method: label ? `${c.method} (${label})` : c.method });
    // Plural page titles ("Menu buttons") -> singular.
    if (/s$/i.test(n)) {
      const s = classifyComponentName(n.replace(/s$/i, ""));
      if (s && s.confidence >= 0.9) candidates.push({ ...s, confidence: 0.8, method: `${s.method} (singular of "${n}")` });
    }
  };
  add(name, null);
  for (const a of altNames) add(a, `implementation name ${a}`);
  // An explicitly documented ARIA role that only fits one taxonomy type is source-backed.
  for (const r of roles) {
    const slug = ROLE_TYPES[r];
    if (slug) return { slug, state: "verified", method: `aria-role:${r} (accessibility tab)`, confidence: 0.85 };
  }
  if (!candidates.length) return null;
  const best = [...candidates].sort((a, b) => b.confidence - a.confidence)[0]!;
  return { slug: best.slug, state: "inferred", method: best.method, confidence: best.confidence };
}

/* ------------------------------- components ------------------------------- */

interface ByComponent {
  usage?: Extract<CarbonFragment, { t: "usage" }>;
  style?: Extract<CarbonFragment, { t: "style" }>;
  code?: Extract<CarbonFragment, { t: "code" }>;
  a11y?: Extract<CarbonFragment, { t: "a11y" }>;
  live?: Extract<CarbonFragment, { t: "live" }>;
  react: Extract<CarbonFragment, { t: "react" }>[];
}

function wcTagsFor(item: PlanItem, live: LiveMeta | null, tags: WcTag[]): WcTag[] {
  if (item.family) return [];
  const byName = new Map(tags.map((t) => [t.name, t]));
  if (item.wcTags) return item.wcTags.map((n) => byName.get(n)).filter((t): t is WcTag => !!t);
  const key = normKey(item.name);
  const nameMatch = tags.find((t) => normKey(t.name.replace(/^cds-/, "")) === key);
  if (nameMatch) return [nameMatch];
  if (live?.wcFolder) {
    const primary = tags.find((t) => t.folder === live.wcFolder && t.file === live.wcFolder);
    if (primary) return [primary];
  }
  return [];
}

function keyboardFor(item: PlanItem, own: DocKeyboard[], parentA11y: A11yData | null): DocKeyboard[] {
  if (item.kind === "page") return own;
  if (!parentA11y) return [];
  const key = normKey(item.name);
  return parentA11y.keyboard.filter((k) => k.context && (normKey(k.context) === key || normKey(k.context) === `${key}s`));
}

function childDescription(item: PlanItem, parentUsage: UsageData | null): { text: string; location: string } | null {
  if (!parentUsage) return null;
  const key = normKey(item.name);
  const v = parentUsage.variants.find((x) => normKey(x.name) === key || normKey(x.name) === `${key}s`);
  if (v?.description) return { text: v.description, location: v.location };
  const s = parentUsage.sectionSummaries.find((x) => normKey(x.title) === key && x.firstParagraph);
  if (s?.firstParagraph) return { text: s.firstParagraph, location: `#${s.title}` };
  return null;
}

function buildComponent(
  item: PlanItem,
  f: ByComponent,
  parent: { item: PlanItem; f: ByComponent } | null,
  index: Extract<CarbonFragment, { t: "index" }> | undefined,
  wca: Extract<CarbonFragment, { t: "wca" }> | undefined,
  slugByDoc: Map<string, string>,
  children: PlanItem[],
): NormalizedComponent {
  const ev: EvidenceInput[] = [];
  const coverage: Record<string, CoverageState> = {};
  const usage = f.usage?.data ?? null;
  const style = f.style?.data ?? null;
  const code = f.code?.data ?? null;
  const a11y = f.a11y?.data ?? null;
  const live = f.live?.meta ?? null;
  const isPage = item.kind === "page";

  // Existence / identity evidence.
  if (index && item.indexPointer) ev.push(evidence("*", index.ev, "components-json", 0.9, { location: `${index.ev.location}#${item.indexPointer}` }));
  if (f.usage) ev.push(evidence("*", f.usage.ev, "mdx-usage", 0.95, { location: `${f.usage.ev.location}#frontmatter.title` }));

  // Description
  let description: string | null = null;
  if (usage?.description) {
    description = usage.description;
    ev.push(evidence("description", f.usage!.ev, "mdx-usage", 0.95, { location: usage.descriptionLocation ?? f.usage!.ev.location, excerpt: description }));
  } else if (!isPage && parent?.f.usage) {
    const d = childDescription(item, parent.f.usage.data);
    if (d) {
      description = d.text;
      ev.push(evidence("description", parent.f.usage.ev, "mdx-usage", 0.8, { location: d.location.startsWith("#") ? `${parent.f.usage.ev.location}${d.location}` : d.location, excerpt: d.text }));
    }
  }
  coverage.description = description ? "documented" : isPage && f.usage ? "not-documented" : "not-extracted";

  // Variants
  const variants = (usage?.variants ?? []).map((v) => ({ axis: v.axis, name: v.name, description: v.description, sourceUrl: item.docsUrl, location: v.location }));
  if (variants.length) ev.push(evidence("variants", f.usage!.ev, "mdx-usage", 0.95, { location: variants[0]!.location }));
  coverage.variants = variants.length ? "documented" : f.usage ? (usage?.variantsSectionFound ? "not-extracted" : "not-documented") : "not-extracted";

  // States (usage tables/bold terms + style interactive-state tables)
  const stateList = [
    ...(usage?.states ?? []).map((s) => ({ ...s, url: item.docsUrl })),
    ...(style?.states ?? []).map((s) => ({ ...s, url: item.specUrl })),
  ];
  const states = uniqBy(stateList, (s) => slugify(s.name)).map((s) => ({
    name: s.name,
    canonical: canonicalState(s.name) ?? (/^enabled\b/i.test(s.name) ? "default" : null),
    description: s.description,
    sourceUrl: s.url,
  }));
  if (usage?.states.length) ev.push(evidence("states", f.usage!.ev, "mdx-usage", usage.states.some((s) => s.method === "table") ? 0.95 : 0.8, { location: usage.states[0]!.location }));
  if (style?.states.length) ev.push(evidence("states", f.style!.ev, "mdx-style", 0.9, { location: style.states[0]!.location }));
  coverage.states = states.length ? "documented" : f.usage && f.style ? (usage?.statesSectionFound ? "not-extracted" : "not-documented") : "not-extracted";

  // Sizes (spec tab preferred)
  let sizes: string[] | null = null;
  if (style?.sizes.length) {
    sizes = style.sizes;
    ev.push(evidence("sizes", f.style!.ev, "mdx-style", 0.9, { location: `${f.style!.ev.location}#Size` }));
  } else if (usage?.sizes.length) {
    sizes = usage.sizes;
    ev.push(evidence("sizes", f.usage!.ev, "mdx-usage", 0.85, { location: `${f.usage!.ev.location}#Sizes` }));
  }
  coverage.sizes = sizes ? "documented" : f.style && f.usage ? (style?.sizeSectionFound || usage?.sizesSectionFound ? "not-extracted" : "not-documented") : "not-extracted";

  // Implementations (properties + frameworks)
  const properties: NormalizedComponent["properties"] = [];
  const frameworks: NormalizedComponent["frameworks"] = [];
  const aliases: string[] = [];
  const reactFound = f.react.filter((r) => r.found).sort((a, b) => a.implementation.localeCompare(b.implementation));
  for (const r of reactFound) {
    for (const p of r.props.slice(0, 120)) {
      properties.push({
        implementation: r.implementation,
        name: p.name,
        type: p.type,
        defaultValue: p.defaultValue,
        required: p.required,
        deprecated: p.deprecated,
        description: p.description,
        allowedValues: p.allowedValues,
        sourceUrl: r.ev.sourceUrl,
      });
    }
    ev.push(evidence("properties", r.ev, "react-proptypes", 0.9, { location: `${r.ev.location}#${r.exportName}.propTypes` }));
    if (normKey(r.exportName) !== normKey(item.name)) aliases.push(r.exportName);
  }
  const tags = wca ? wcTagsFor(item, live, wca.tags) : [];
  for (const t of tags) {
    const impl = tags.length === 1 ? "web-components" : `web-components:${t.name}`;
    for (const a of t.attributes.slice(0, 120)) {
      properties.push({
        implementation: impl,
        name: a.name,
        type: a.type,
        defaultValue: a.defaultValue,
        required: null,
        deprecated: a.deprecated,
        description: a.description,
        allowedValues: null,
        sourceUrl: wca!.ev.sourceUrl,
      });
    }
    ev.push(evidence("properties", wca!.ev, "wca-manifest", 0.9, { location: `${wca!.ev.location}#${t.pointer} (${t.name})` }));
    aliases.push(t.name);
  }
  coverage.properties = properties.length ? "documented" : "not-extracted";

  const reactPrimary = reactFound[0] ?? null;
  const codeLabels = (code?.frameworks ?? []).filter((x) => !x.community).map((x) => x.label.toLowerCase());
  const reactSource = live?.reactSourceUrl ?? (reactPrimary?.sourcePath ? `${MONOREPO_URL}/blob/main/packages/react/${reactPrimary.sourcePath}` : null);
  if (codeLabels.includes("react") || reactFound.length) {
    frameworks.push({
      slug: "react",
      packageName: PKG.react,
      importName: reactFound.length === 1 ? reactPrimary!.exportName : null,
      sourceUrl: reactSource,
    });
  }
  if (codeLabels.includes("web components") || tags.length) {
    frameworks.push({
      slug: "web-components",
      packageName: PKG.webComponents,
      importName: tags.length === 1 ? tags[0]!.name : null,
      sourceUrl: live?.wcSourceUrl ?? null,
    });
  }
  if (f.code && codeLabels.length) ev.push(evidence("frameworks", f.code.ev, "mdx-code", 0.9));
  coverage.frameworks = frameworks.length ? "documented" : "not-extracted";

  // Accessibility
  const ownKb = [...(a11y?.keyboard ?? []), ...(usage?.keyboard ?? [])];
  const kb = uniqBy(keyboardFor(item, ownKb, parent?.f.a11y?.data ?? null), (k) => k.action.toLowerCase()).slice(0, 20);
  const keyboard: KeyboardInteraction[] = kb.map((k) => ({ keys: k.keys, action: k.action }));
  const a11ySrc = isPage ? f.a11y : null;
  let accessibility: NormalizedComponent["accessibility"] = null;
  if (a11ySrc || keyboard.length) {
    const acov: Record<string, CoverageState> = {
      keyboard: keyboard.length ? "documented" : a11y?.keyboardSectionFound || usage?.keyboardSectionFound ? "not-extracted" : "not-documented",
      guidance: a11y?.guidance ? "documented" : "not-documented",
      focusManagement: a11y?.focusManagement ? "documented" : a11y?.focusSectionFound ? "not-extracted" : "not-documented",
      screenReader: a11y?.screenReader ? "documented" : a11y?.screenReaderSectionFound ? "not-extracted" : "not-documented",
      roles: a11y?.roles.length ? "documented" : "not-extracted",
      ariaPattern: a11y?.ariaPattern ? "documented" : "not-documented",
      wcagCriteria: "not-extracted",
    };
    if (!isPage) for (const k of Object.keys(acov)) if (k !== "keyboard") acov[k] = "not-extracted";
    accessibility = {
      ariaPattern: isPage ? (a11y?.ariaPattern ?? null) : null,
      roles: isPage && a11y?.roles.length ? a11y.roles : null,
      keyboard: keyboard.length ? keyboard : null,
      guidance: isPage ? (a11y?.guidance ?? null) : null,
      screenReader: isPage ? (a11y?.screenReader ?? null) : null,
      focusManagement: isPage ? (a11y?.focusManagement ?? null) : null,
      wcagCriteria: null,
      docsUrl: item.a11yUrl,
      coverage: acov,
    };
    if (f.a11y) ev.push(evidence("accessibility", f.a11y.ev, "mdx-a11y", 0.9));
    const kbSrc = isPage ? (a11y?.keyboard.length ? f.a11y : f.usage) : parent?.f.a11y;
    if (keyboard.length && kbSrc) ev.push(evidence("keyboard", kbSrc.ev, isPage && !a11y?.keyboard.length ? "mdx-usage" : "mdx-a11y", 0.85, { location: kb[0]!.location }));
  }
  coverage.accessibility = accessibility ? "documented" : isPage && f.a11y ? "not-documented" : "not-extracted";
  coverage.keyboard = keyboard.length ? "documented" : isPage && f.a11y ? (a11y?.keyboardSectionFound || usage?.keyboardSectionFound ? "not-extracted" : "not-documented") : "not-extracted";
  coverage.responsive = "not-extracted";

  // Token usages from spec tables
  const tokenUsages = uniqBy(style?.tokenUsages ?? [], (u) => `${u.tokenName}|${u.property}`)
    .slice(0, 200)
    .map((u) => ({ tokenName: u.tokenName, property: u.property }));
  if (tokenUsages.length) ev.push(evidence("tokens", f.style!.ev, "mdx-style", 0.9, { location: style!.tokenUsages[0]!.location }));
  coverage.tokens = tokenUsages.length ? "documented" : f.style ? (style?.tokenTablesFound ? "not-extracted" : "not-documented") : "not-extracted";

  // Examples: Storybook stories referenced by the docs (links only; no code copied).
  const stories = uniqBy([...(code?.storybook ?? []), ...(usage?.storybook ?? [])], (s) => s.storyId);
  const examples: NormalizedComponent["examples"] = [];
  const exSlugs = new Set<string>();
  const addEx = (slugBase: string, ex: Omit<NormalizedComponent["examples"][number], "slug">) => {
    let s = slugify(slugBase) || "example";
    for (let i = 2; exSlugs.has(s); i++) s = `${slugify(slugBase)}-${i}`;
    exSlugs.add(s);
    examples.push({ slug: s, ...ex });
  };
  for (const s of stories.slice(0, 24)) {
    const fw = s.url.includes("web-components.") ? "web-components" : "react";
    addEx(`${fw}-${s.label}`, { title: `${s.label} (${fw === "react" ? "React" : "Web Components"} Storybook)`, kind: "storybook-link", url: s.url, attribution: "Carbon Design System Storybook (IBM)" });
  }
  if (live?.reactStorybookUrl) addEx("react-storybook-docs", { title: "React Storybook docs", kind: "storybook-link", url: live.reactStorybookUrl, attribution: "Carbon Design System (IBM)" });
  if (live?.wcStorybookUrl) addEx("web-components-storybook-docs", { title: "Web Components Storybook docs", kind: "storybook-link", url: live.wcStorybookUrl, attribution: "Carbon Design System (IBM)" });
  if (isPage && item.codeUrl) addEx("code-docs", { title: `${item.name} code documentation`, kind: "docs-link", url: item.codeUrl, attribution: "Carbon Design System (IBM)" });
  if (stories.length && (f.code ?? f.usage)) ev.push(evidence("examples", (f.code ?? f.usage)!.ev, f.code ? "mdx-code" : "mdx-usage", 0.9));
  coverage.examples = examples.length ? "documented" : "not-extracted";

  // Relationships
  const relationships: NormalizedComponent["relationships"] = [];
  for (const c of children) relationships.push({ kind: "subcomponent", targetSlug: c.slug, targetType: null });
  if (children.length && index) ev.push(evidence("relationships", index.ev, "components-json", 0.9, { location: `${index.ev.location} (parentComponent = "${item.indexName ?? item.name}")` }));
  for (const l of usage?.related ?? []) {
    const target = l.componentDocSlug ? slugByDoc.get(l.componentDocSlug.toLowerCase()) : undefined;
    if (!target || target === item.slug) continue;
    if (relationships.some((r) => r.targetSlug === target)) continue;
    relationships.push({ kind: "related", targetSlug: target, targetType: null });
  }
  if (usage?.related.some((l) => l.componentDocSlug)) ev.push(evidence("relationships", f.usage!.ev, "mdx-usage", 0.85, { location: `${f.usage!.ev.location}#Related` }));
  if (!isPage && item.parentSlug) relationships.push({ kind: "related", targetSlug: item.parentSlug, targetType: null });
  coverage.relationships = relationships.length ? "documented" : f.usage && usage?.relatedSectionFound ? "not-extracted" : "not-documented";

  // Lifecycle (live status label, React implementation status)
  let lifecycle: NormalizedComponent["lifecycle"] = "unknown";
  if (live?.statusLabel) {
    lifecycle = lifecycleFromLabel(live.statusLabel);
    ev.push(evidence("lifecycle", f.live!.ev, "live-meta", 0.9, { excerpt: `statusLabel: ${live.statusLabel}` }));
  }
  if (reactSource && f.live?.meta.reactSourceUrl) ev.push(evidence("sourceCodeUrl", f.live.ev, "live-meta", 0.9));

  const cls = classify(item.name, [...reactFound.map((r) => r.exportName)], isPage ? (a11y?.roles ?? []) : []);
  return {
    slug: item.slug,
    name: item.name,
    aliases: uniqBy(aliases, (a) => a),
    description,
    docsUrl: item.docsUrl,
    sourceCodeUrl: reactSource,
    lifecycle,
    canonicalType: cls?.slug ?? null,
    classification: cls ? { state: cls.state, method: cls.method, confidence: cls.confidence } : null,
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
    evidence: uniqBy(ev, (e) => `${e.field}|${e.sourceUrl}|${e.location}`),
  };
}

/* --------------------------------- tokens --------------------------------- */

const SET_META: Record<string, { name: string; theme: (scheme: string | null) => string | null; format: NormalizedTokenSet["format"] }> = {
  palette: { name: "Color palette", theme: () => null, format: "dtcg" },
  "theme-white": { name: "White theme", theme: (s) => s, format: "dtcg" },
  "theme-g10": { name: "Gray 10 theme", theme: (s) => s, format: "dtcg" },
  "theme-g90": { name: "Gray 90 theme", theme: (s) => s, format: "dtcg" },
  "theme-g100": { name: "Gray 100 theme", theme: (s) => s, format: "dtcg" },
  layout: { name: "Layout (spacing, sizing, radius)", theme: () => null, format: "dtcg" },
  motion: { name: "Motion", theme: () => null, format: "dtcg" },
  typography: { name: "Typography", theme: () => null, format: "scss" },
};

function buildTokenSets(frags: Extract<CarbonFragment, { t: "tokens" }>[], cssVars: Extract<CarbonFragment, { t: "cssvars" }> | undefined): NormalizedTokenSet[] {
  const verified = new Set(cssVars?.names ?? []);
  const groups = new Map<string, Extract<CarbonFragment, { t: "tokens" }>[]>();
  for (const fr of frags) {
    if (!groups.has(fr.setKey)) groups.set(fr.setKey, []);
    groups.get(fr.setKey)!.push(fr);
  }
  const out: NormalizedTokenSet[] = [];
  for (const key of Object.keys(SET_META)) {
    const parts = (groups.get(key) ?? []).sort((a, b) => a.order - b.order || a.part.localeCompare(b.part));
    if (!parts.length) continue;
    const meta = SET_META[key]!;
    const tokens: NormalizedToken[] = [];
    const names = new Set<string>();
    for (const p of parts) {
      for (const tk of p.tokens) {
        if (names.has(tk.name)) continue;
        names.add(tk.name);
        tokens.push({ ...tk, cssVar: tk.cssVar && verified.has(tk.cssVar) ? tk.cssVar : null });
      }
    }
    const first = parts[0]!;
    const scheme = parts.find((p) => p.colorScheme)?.colorScheme ?? null;
    const ev: EvidenceInput[] = parts.map((p) =>
      evidence("*", p.ev, p.ev.location.endsWith(".scss") ? "type-scss" : p.ev.location.endsWith(".js") ? "type-scale" : "dtcg-json", 0.95, {
        excerpt: p.fileDescription ? p.fileDescription.slice(0, 280) : null,
      }),
    );
    if (cssVars && tokens.some((t) => t.cssVar)) ev.push(evidence("cssVar", cssVars.ev, "compiled-css", 0.9, { location: `${cssVars.ev.location} (declared --cds-* custom properties)` }));
    out.push({
      slug: key,
      name: meta.name,
      theme: meta.theme(scheme),
      format: meta.format,
      sourceUrl: first.ev.sourceUrl,
      packageName: first.pkg,
      packageVersion: first.version,
      license: LICENSE_APACHE,
      redistribution: "permitted",
      tokens,
      evidence: ev,
    });
  }
  return out;
}

/* -------------------------------- patterns -------------------------------- */

function buildPatterns(frags: Extract<CarbonFragment, { t: "pattern" }>[], slugByDoc: Map<string, string>): NormalizedPattern[] {
  return [...frags]
    .sort((a, b) => a.plan.order - b.plan.order)
    .map((p) => {
      const cls = classifyPatternName(p.plan.name.replace(/\bpattern\b/i, "").trim());
      const componentSlugs = uniqBy(
        p.data.componentDocSlugs.map((d) => slugByDoc.get(d.toLowerCase())).filter((s): s is string => !!s),
        (s) => s,
      );
      const ev: EvidenceInput[] = [evidence("*", p.ev, "mdx-pattern", 0.95, { excerpt: p.data.description })];
      if (componentSlugs.length) ev.push(evidence("componentSlugs", p.ev, "mdx-pattern", 0.85, { location: `${p.ev.location} (links to component docs)` }));
      return {
        slug: p.plan.slug,
        name: p.plan.name,
        description: p.data.description,
        docsUrl: p.plan.docsUrl,
        canonicalType: cls?.slug ?? null,
        classification: cls ? { state: "inferred" as const, method: cls.method, confidence: cls.confidence } : null,
        componentSlugs,
        coverage: {
          description: p.data.description ? "documented" : "not-documented",
          components: componentSlugs.length ? "documented" : "not-documented",
        },
        evidence: ev,
      };
    });
}

/* --------------------------------- bundle --------------------------------- */

export function normalizeCarbon(systemSlug: string, fragments: { data: unknown }[]): NormalizedBundle {
  const frs = fragments.map((f) => f.data as CarbonFragment).filter((f) => f && typeof f === "object" && "t" in f);
  const nav = frs.find((f): f is Extract<CarbonFragment, { t: "nav" }> => f.t === "nav");
  const index = frs.find((f): f is Extract<CarbonFragment, { t: "index" }> => f.t === "index");
  const wca = frs.find((f): f is Extract<CarbonFragment, { t: "wca" }> => f.t === "wca");
  const by = new Map<string, ByComponent>();
  const get = (slug: string) => {
    if (!by.has(slug)) by.set(slug, { react: [] });
    return by.get(slug)!;
  };
  for (const f of frs) {
    if (f.t === "usage" || f.t === "style" || f.t === "code" || f.t === "a11y") (get(f.slug) as Record<string, unknown>)[f.t] = f;
    else if (f.t === "live") get(f.slug).live = f;
    else if (f.t === "react") get(f.slug).react.push(f);
  }
  const plan = [...(nav?.plan ?? [])].sort((a, b) => a.order - b.order);
  const slugByDoc = new Map(plan.filter((p) => p.docSlug).map((p) => [p.docSlug!.toLowerCase(), p.slug]));
  const planBySlug = new Map(plan.map((p) => [p.slug, p]));
  const components: NormalizedComponent[] = [];
  for (const item of plan) {
    const f = by.get(item.slug) ?? { react: [] };
    const parentItem = item.parentSlug ? planBySlug.get(item.parentSlug) : undefined;
    const parent = parentItem ? { item: parentItem, f: by.get(parentItem.slug) ?? { react: [] } } : null;
    // Skip planned components with no source data at all (all fetches failed).
    const hasData = f.usage || f.react.some((r) => r.found) || item.kind !== "page";
    if (!hasData) continue;
    const children = plan.filter((p) => p.parentSlug === item.slug);
    const comp = buildComponent(item, f, parent, index, wca, slugByDoc, children);
    if (!comp.evidence.length) continue;
    components.push(comp);
  }

  const tokenSets = buildTokenSets(
    frs.filter((f): f is Extract<CarbonFragment, { t: "tokens" }> => f.t === "tokens"),
    frs.find((f): f is Extract<CarbonFragment, { t: "cssvars" }> => f.t === "cssvars"),
  );
  const patterns = buildPatterns(
    frs.filter((f): f is Extract<CarbonFragment, { t: "pattern" }> => f.t === "pattern"),
    slugByDoc,
  );

  // System facts
  const pkgs = frs.filter((f): f is Extract<CarbonFragment, { t: "pkg" }> => f.t === "pkg");
  const react = pkgs.find((p) => p.name === PKG.react);
  const about = frs.find((f): f is Extract<CarbonFragment, { t: "about" }> => f.t === "about");
  const factsEv: EvidenceInput[] = [];
  if (react) factsEv.push(evidence("latestVersion", react.ev, "npm-version", 0.95, { excerpt: `${react.name}@${react.version}${react.publishedAt ? ` published ${react.publishedAt}` : ""}` }));
  let philosophy: string | null = null;
  let principles: NormalizedSystemFacts["principles"] = null;
  if (about) {
    if (about.data.principles.length) {
      principles = about.data.principles.map((name) => ({ name, sourceUrl: about.docsUrl }));
      factsEv.push(evidence("principles", about.ev, "mdx-about", 0.9, { location: `${about.ev.location}#${about.data.principlesHeading ?? "principles"}` }));
    }
    if (about.data.description && about.data.principles.length) {
      philosophy = `Carbon's documentation describes it as follows: "${about.data.description}" It lists these guiding principles: ${about.data.principles.join("; ")}.`.slice(0, 1500);
      factsEv.push(evidence("philosophy", about.ev, "mdx-about", 0.8, { excerpt: about.data.description }));
    }
  }
  const fw: { slug: string; packageName: string }[] = [];
  for (const p of pkgs) {
    if (p.name === PKG.react) fw.push({ slug: "react", packageName: p.name });
    if (p.name === PKG.webComponents) fw.push({ slug: "web-components", packageName: p.name });
    if (p.name === PKG.react || p.name === PKG.webComponents) factsEv.push(evidence("frameworks", p.ev, "npm-version", 0.9));
  }
  const facts: NormalizedSystemFacts | null =
    react || about
      ? {
          latestVersion: react?.version ?? null,
          latestReleaseAt: react?.publishedAt ?? null,
          philosophy,
          principles,
          frameworks: fw.length ? fw.sort((a, b) => a.slug.localeCompare(b.slug)) : null,
          evidence: factsEv,
        }
      : null;

  return { systemSlug, components, tokenSets, patterns, facts };
}
