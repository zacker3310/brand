/**
 * fluent-ui-react (Fluent UI React v9) component modeling.
 *
 *  - One ATLAS component per Storybook component docs page ("Components/*", "Compat Components/*",
 *    "Preview Components/*"), named with the React export the page documents (`component:` in the
 *    story index file) so names are the system's own ("SpinButton", "TabList", "CounterBadge").
 *  - Subcomponents: exports listed under `subcomponents:` in the story meta (documented), plus other
 *    components exported by the same package whose name extends the page component's name
 *    (structural, e.g. DialogSurface for Dialog; coverage "inferred"). Each becomes its own ATLAS
 *    component linked with subcomponent/parent relationships.
 *  - Props come from the package's dist/index.d.ts (`XProps`), statically resolved; slots are props.
 *  - Description: the page's ComponentDescription.md (first sentence), else the export's TSDoc.
 *  - Accessibility: ComponentAccessibilitySpec.mdx when published (roles, keyboard tables), or the
 *    component's A11y markdown / "Accessibility" best-practice group.
 */
import type { EvidenceInput, NormalizedComponent } from "@/lib/contracts";
import { classifyComponentName } from "@/lib/taxonomy";
import { slugify } from "@/lib/utils";
import { baseCoverage, pick, sizesFromProps, statesFromProps, strongest, toProperty, variantsFromProps, type FluentFragment, type FragOf, type ReactComponentLite } from "./fragments";
import { SB_REACT, clip, evidence, firstSentence, humanize, leadSentences, lifecycleFromVersion, npmFile, npmPage, repoTree, sortBy, uniq } from "./shared";

type Example = NormalizedComponent["examples"][number];

export interface ReactNormalizeResult {
  components: NormalizedComponent[];
  warnings: string[];
}

export function normalizeReact(frags: FluentFragment[], opts: { limit?: number } = {}): ReactNormalizeResult {
  const warnings: string[] = [];
  const index = pick(frags, "react-index-dts")[0] ?? null;
  const sbIndex = pick(frags, "sb-index").find((f) => f.system === "fluent-ui-react") ?? null;
  const dtsByPkg = new Map(pick(frags, "react-dts").map((f) => [f.pkg, f]));
  const specs = new Map(pick(frags, "react-a11y-spec").map((f) => [f.page.component, f]));
  const sectionOrder = { Components: 0, "Compat Components": 1, "Preview Components": 2 } as const;
  const pages = sortBy(pick(frags, "react-stories"), (p) => `${sectionOrder[p.page.section]}|${p.page.id}`);
  const components: NormalizedComponent[] = [];
  const usedSlugs = new Set<string>();
  const claim = (base: string, suffix: string) => {
    let s = slugify(base);
    if (usedSlugs.has(s)) s = slugify(`${base}-${suffix}`);
    let n = 2;
    while (usedSlugs.has(s)) s = slugify(`${base}-${suffix}-${n++}`);
    usedSlugs.add(s);
    return s;
  };

  // Main component name per page.
  const mainName = (p: FragOf<"react-stories">) => p.meta.component ?? p.page.leaf.replace(/\s+/g, "");
  const slugOf = new Map<FragOf<"react-stories">, string>();
  for (const p of pages) {
    const name = mainName(p);
    const suffix = p.page.section === "Components" ? "react" : p.page.section === "Compat Components" ? "compat" : "preview";
    slugOf.set(p, claim(name, suffix));
  }
  const mainNames = new Set(pages.map((p) => mainName(p)));

  // Subcomponent assignment.
  interface Sub {
    comp: ReactComponentLite;
    pkg: string;
    owners: { slug: string; documented: boolean; page: FragOf<"react-stories"> }[];
  }
  const subs = new Map<string, Sub>();
  for (const p of pages) {
    const ownerSlug = slugOf.get(p)!;
    const dts = dtsByPkg.get(p.page.pkg);
    if (!dts) continue;
    const main = mainName(p);
    const listed = new Set(p.meta.subcomponents);
    for (const c of dts.components) {
      if (c.name === main || mainNames.has(c.name)) continue;
      const documented = listed.has(c.name);
      // Structural rule: longest page-component prefix within the same package wins.
      const prefixOwner = pages
        .filter((q) => q.page.pkg === p.page.pkg && c.name.startsWith(mainName(q)) && c.name !== mainName(q))
        .sort((a, b) => mainName(b).length - mainName(a).length)[0];
      if (!documented && prefixOwner !== p) continue;
      const cur = subs.get(c.name) ?? { comp: c, pkg: dts.pkg, owners: [] };
      if (!cur.owners.some((o) => o.slug === ownerSlug)) cur.owners.push({ slug: ownerSlug, documented, page: p });
      subs.set(c.name, cur);
    }
  }
  const subSlug = new Map<string, string>();
  for (const name of [...subs.keys()].sort()) subSlug.set(name, claim(name, "react"));

  const storiesFor = (docId: string) =>
    (sbIndex?.entries ?? [])
      .filter((e) => e.type === "story" && e.id.startsWith(docId.replace(/--docs$/, "--")))
      .slice(0, 12);

  const reexported = (name: string) => index?.reexports[name] ?? null;
  const frameworksFor = (name: string, pkg: string, version: string | null, importedFrom: string | null) => {
    const viaSuite = reexported(name) === pkg && index ? index.npm.pkg : null;
    const packageName = importedFrom ?? viaSuite ?? pkg;
    return [{ slug: "react", packageName, importName: name, sourceUrl: npmPage(packageName === pkg ? pkg : packageName, packageName === pkg ? version : index?.npm.version) }];
  };

  const buildProps = (c: ReactComponentLite | null, pkg: string, version: string | null) => {
    if (!c || !version) return [];
    const url = npmFile(pkg, version, "dist/index.d.ts");
    return sortBy(c.props, (p) => p.name).map((p) => toProperty(p, "react", url));
  };

  for (const p of pages) {
    const slug = slugOf.get(p)!;
    const name = mainName(p);
    const dts = dtsByPkg.get(p.page.pkg) ?? null;
    const comp = dts?.components.find((c) => c.name === name) ?? null;
    if (!dts) warnings.push(`${name}: ${p.page.pkg} declarations unavailable`);
    else if (!comp) warnings.push(`${name}: no component declaration with props found in ${p.page.pkg}`);
    const version = dts?.version ?? null;
    const dtsUrl = version ? npmFile(p.page.pkg, version, "dist/index.d.ts") : null;
    const ev: EvidenceInput[] = [evidence(p.prov, "*", "storybook-stories", { location: `${p.prov.file}#default`, excerpt: `title: '${p.meta.title ?? p.page.title}', component: ${name}`, title: p.page.title })];
    if (sbIndex) ev.push(evidence(sbIndex.prov, "*", "storybook-index", { location: `index.json#/entries/${p.page.id}`, excerpt: `${p.page.title} -> ${p.page.storiesFile}` }));
    const coverage = baseCoverage("not-extracted");

    // description
    let description: string | null = null;
    if (p.description) {
      description = firstSentence(p.description.text);
      if (description) ev.push(evidence(p.description.prov, "description", "story-description-md", { excerpt: description }));
    }
    if (!description && comp?.summary && dts) {
      description = firstSentence(comp.summary);
      if (description) ev.push(evidence(dts.prov, "description", "dts-tsdoc", { location: `dist/index.d.ts#L${comp.line}`, excerpt: description }));
    }
    coverage.description = description ? "documented" : "not-documented";

    // properties / variants / sizes / states
    const properties = buildProps(comp, p.page.pkg, version);
    if (comp && dts) {
      coverage.properties = properties.length ? "documented" : "not-documented";
      ev.push(
        evidence(dts.prov, "properties", "dts-props", {
          location: `dist/index.d.ts#L${comp.line}`,
          excerpt: `${comp.propsType}: ${properties.length} props${comp.primarySlots.length ? `; native props of the ${comp.primarySlots.join("/")} slot` : ""}${comp.unresolved.length ? `; also extends ${comp.unresolved.slice(0, 4).join(", ")} (not resolved)` : ""}`,
        }),
      );
    }
    const variants = comp ? variantsFromProps(comp.props, dtsUrl, "dist/index.d.ts") : [];
    const sizes = comp ? sizesFromProps(comp.props) : null;
    const states = comp ? statesFromProps(comp.props, dtsUrl) : [];
    if (comp) {
      coverage.variants = variants.length ? "documented" : "not-documented";
      coverage.sizes = sizes ? "documented" : "not-documented";
      coverage.states = states.length ? "inferred" : "not-documented";
      if (variants.length && dts) ev.push(evidence(dts.prov, "variants", "dts-props", { location: `dist/index.d.ts#${comp.propsType}`, excerpt: uniq(variants.map((v) => `${v.axis}: ${v.name}`)).slice(0, 12).join(", ") }));
      if (sizes && dts) ev.push(evidence(dts.prov, "sizes", "dts-props", { location: `dist/index.d.ts#${comp.propsType}.size`, excerpt: `size: ${sizes.join(" | ")}` }));
    }

    // accessibility
    const spec = specs.get(name) ?? null;
    let accessibility: NormalizedComponent["accessibility"] = null;
    const a11yGroups = [...(p.a11yMd?.data.groups ?? []), ...(p.bestPractices?.data.groups.filter((g) => /accessib/i.test(g.heading)) ?? [])];
    if (spec) {
      const kb = spec.spec.keyboard.map((k) => ({ keys: k.keys, action: clip(k.context ? `${k.action} (${k.context})` : k.action, 240)! }));
      const guidance = clip([spec.spec.intro, ...a11yGroups.flatMap((g) => g.items)].filter(Boolean).join(" "), 1100);
      accessibility = {
        ariaPattern: null,
        roles: spec.spec.roles.length ? spec.spec.roles : null,
        keyboard: kb.length ? kb : null,
        guidance,
        screenReader: clip(spec.spec.screenReader, 800),
        focusManagement: clip(spec.spec.focus, 800),
        wcagCriteria: spec.spec.wcag.length ? spec.spec.wcag : null,
        docsUrl: spec.page.docsUrl,
        coverage: {
          guidance: guidance ? "documented" : "not-documented",
          roles: spec.spec.roles.length ? "documented" : "not-documented",
          keyboard: kb.length ? "documented" : "not-documented",
          screenReader: spec.spec.screenReader ? "documented" : "not-documented",
          focusManagement: spec.spec.focus ? "documented" : "not-documented",
          wcagCriteria: spec.spec.wcag.length ? "documented" : "not-documented",
        },
      };
      coverage.accessibility = "documented";
      coverage.keyboard = kb.length ? "documented" : "not-documented";
      ev.push(evidence(spec.prov, "accessibility", "a11y-spec-mdx", { location: spec.prov.file, excerpt: spec.spec.intro ?? spec.spec.title ?? "Accessibility spec" }));
      if (kb.length) ev.push(evidence(spec.prov, "keyboard", "a11y-spec-mdx", { location: `${spec.prov.file}#keyboard-interaction`, excerpt: kb.slice(0, 4).map((k) => `${k.keys}: ${k.action}`).join("; ") }));
    } else if (a11yGroups.length) {
      const guidance = clip(a11yGroups.flatMap((g) => g.items).join(" "), 1100);
      const src = p.a11yMd ?? p.bestPractices!;
      accessibility = {
        ariaPattern: null,
        roles: null,
        keyboard: null,
        guidance,
        screenReader: null,
        focusManagement: null,
        wcagCriteria: null,
        docsUrl: p.page.docsUrl,
        coverage: { guidance: "documented", roles: "not-extracted", keyboard: "not-extracted", screenReader: "not-extracted", focusManagement: "not-extracted", wcagCriteria: "not-extracted" },
      };
      coverage.accessibility = "documented";
      ev.push(evidence(src.prov, "accessibility", p.a11yMd ? "story-a11y-md" : "story-best-practices-md", { excerpt: guidance }));
    }

    // frameworks
    const frameworks = frameworksFor(name, p.page.pkg, version, p.meta.importedFrom[name] ?? null);
    coverage.frameworks = "documented";
    ev.push(evidence(p.prov, "frameworks", "storybook-stories", { location: p.prov.file, excerpt: `import { ${name} } from '${p.meta.importedFrom[name] ?? p.page.pkg}'` }));

    // examples
    const examples: Example[] = [{ slug: "storybook-docs", title: `Storybook: ${p.page.title}`, kind: "docs-link", url: p.page.docsUrl, language: null, code: null, attribution: null }];
    for (const s of storiesFor(p.page.id)) examples.push({ slug: slugify(`story-${s.id.split("--")[1]}`), title: `${name}: ${s.name}`, kind: "storybook-link", url: `${SB_REACT}?path=/story/${s.id}`, language: null, code: null, attribution: null });
    if (spec) examples.push({ slug: "accessibility-spec", title: `${name} accessibility spec`, kind: "docs-link", url: spec.page.docsUrl, language: null, code: null, attribution: null });
    coverage.examples = "documented";
    ev.push(evidence(p.prov, "examples", "storybook-stories", { location: p.prov.file, excerpt: `stories: ${p.meta.stories.slice(0, 10).join(", ")}` }));

    // relationships
    const mySubs = [...subs.entries()].filter(([, s]) => s.owners.some((o) => o.slug === slug));
    const relationships = mySubs.map(([n]) => ({ kind: "subcomponent", targetSlug: subSlug.get(n)!, targetType: null }));
    if (relationships.length) {
      const documented = mySubs.some(([, s]) => s.owners.find((o) => o.slug === slug)?.documented);
      coverage.relationships = documented ? "documented" : "inferred";
      if (documented) ev.push(evidence(p.prov, "relationships", "storybook-stories", { location: `${p.prov.file}#subcomponents`, excerpt: `subcomponents: ${p.meta.subcomponents.join(", ")}` }));
    } else coverage.relationships = "not-documented";

    // lifecycle
    const lifecycle = comp?.deprecated ? "deprecated" : lifecycleFromVersion(version, { preview: p.page.section === "Preview Components" });
    if (version) ev.push(evidence(dts!.prov, "lifecycle", "npm-version", { location: `${p.page.pkg}@${version}`, excerpt: `${p.page.pkg}@${version}${p.page.section !== "Components" ? ` (Storybook section "${p.page.section}")` : ""}` }));

    const cls = strongest([classifyComponentName(name), classifyComponentName(humanize(name)), classifyComponentName(p.page.leaf), classifyComponentName(name.replace(/(?<=[a-z])list$/i, " list"))]);
    components.push({
      slug,
      name,
      aliases: uniq([p.page.leaf !== name ? p.page.leaf : null, humanize(name) !== name ? humanize(name) : null].filter((x): x is string => !!x)),
      description,
      docsUrl: p.page.docsUrl,
      sourceCodeUrl: repoTree(p.ref, `packages/react-components/${p.page.pkgDir}`),
      lifecycle,
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
      tokenUsages: [],
      responsiveGuidance: null,
      coverage,
      evidence: ev,
    });
  }

  // Subcomponents.
  for (const [name, s] of sortBy([...subs.entries()], ([n]) => n)) {
    const slug = subSlug.get(name)!;
    const dts = dtsByPkg.get(s.pkg)!;
    const owner = s.owners[0]!;
    const ev: EvidenceInput[] = [evidence(dts.prov, "*", "dts-props", { location: `dist/index.d.ts#L${s.comp.line}`, excerpt: `${name}: ${s.comp.propsType}` })];
    const coverage = baseCoverage("not-extracted");
    const description = firstSentence(s.comp.summary);
    coverage.description = description ? "documented" : "not-documented";
    if (description) ev.push(evidence(dts.prov, "description", "dts-tsdoc", { location: `dist/index.d.ts#L${s.comp.line}`, excerpt: description }));
    const url = npmFile(s.pkg, dts.version, "dist/index.d.ts");
    const properties = sortBy(s.comp.props, (p) => p.name).map((p) => toProperty(p, "react", url));
    coverage.properties = properties.length ? "documented" : "not-documented";
    if (properties.length) ev.push(evidence(dts.prov, "properties", "dts-props", { location: `dist/index.d.ts#${s.comp.propsType}`, excerpt: `${s.comp.propsType}: ${properties.length} props${s.comp.unresolved.length ? `; also extends ${s.comp.unresolved.slice(0, 4).join(", ")} (not resolved)` : ""}` }));
    const variants = variantsFromProps(s.comp.props, url, "dist/index.d.ts");
    const sizes = sizesFromProps(s.comp.props);
    const states = statesFromProps(s.comp.props, url);
    coverage.variants = variants.length ? "documented" : "not-documented";
    coverage.sizes = sizes ? "documented" : "not-documented";
    coverage.states = states.length ? "inferred" : "not-documented";
    if (variants.length) ev.push(evidence(dts.prov, "variants", "dts-props", { location: `dist/index.d.ts#${s.comp.propsType}`, excerpt: uniq(variants.map((v) => `${v.axis}: ${v.name}`)).slice(0, 12).join(", ") }));
    if (sizes) ev.push(evidence(dts.prov, "sizes", "dts-props", { location: `dist/index.d.ts#${s.comp.propsType}.size`, excerpt: `size: ${sizes.join(" | ")}` }));
    coverage.frameworks = "documented";
    ev.push(evidence(dts.prov, "frameworks", "dts-props", { location: `dist/index.d.ts#L${s.comp.line}`, excerpt: `export declare const ${name}` }));
    const documented = s.owners.some((o) => o.documented);
    coverage.relationships = documented ? "documented" : "inferred";
    if (documented) {
      const o = s.owners.find((x) => x.documented)!;
      ev.push(evidence(o.page.prov, "relationships", "storybook-stories", { location: `${o.page.prov.file}#subcomponents`, excerpt: `subcomponents of ${mainName(o.page)}: ${o.page.meta.subcomponents.join(", ")}` }));
    }
    coverage.examples = "documented";
    coverage.accessibility = "not-extracted";
    coverage.keyboard = "not-extracted";
    const cls = strongest([classifyComponentName(name), classifyComponentName(humanize(name))]);
    components.push({
      slug,
      name,
      aliases: humanize(name) !== name ? [humanize(name)] : [],
      description,
      docsUrl: owner.page.page.docsUrl,
      sourceCodeUrl: repoTree(owner.page.ref, `packages/react-components/${owner.page.page.pkgDir}`),
      lifecycle: s.comp.deprecated ? "deprecated" : lifecycleFromVersion(dts.version, { preview: owner.page.page.section === "Preview Components" }),
      canonicalType: cls?.slug ?? null,
      classification: cls ? { state: "inferred", method: cls.method, confidence: cls.confidence } : null,
      frameworks: frameworksFor(name, s.pkg, dts.version, owner.page.meta.importedFrom[name] ?? null),
      variants,
      states,
      sizes,
      properties,
      accessibility: null,
      examples: [{ slug: "storybook-docs", title: `Storybook: ${owner.page.page.title}`, kind: "docs-link", url: owner.page.page.docsUrl, language: null, code: null, attribution: null }],
      relationships: s.owners.map((o) => ({ kind: "parent", targetSlug: o.slug, targetType: null })),
      tokenUsages: [],
      responsiveGuidance: null,
      coverage,
      evidence: ev,
    });
  }

  let out = sortBy(components, (c) => c.slug);
  if (opts.limit && opts.limit > 0) {
    const keep = new Set(out.filter((c) => !c.relationships.some((r) => r.kind === "parent")).slice(0, opts.limit).map((c) => c.slug));
    out = out.filter((c) => keep.has(c.slug) || c.relationships.some((r) => r.kind === "parent" && keep.has(r.targetSlug ?? "")));
  }
  const slugs = new Set(out.map((c) => c.slug));
  out = out.map((c) => ({ ...c, relationships: c.relationships.filter((r) => !r.targetSlug || slugs.has(r.targetSlug)) }));
  return { components: out, warnings };
}

/** ATLAS-authored short statement for facts, only from README statements that were found. */
export function reactPhilosophy(readme: Record<string, string | null> | null): string | null {
  if (!readme) return null;
  const parts: string[] = [];
  if (readme.suite) parts.push("@fluentui/react-components is the suite package of Fluent UI React v9, bundling the converged React components and related utilities.");
  if (readme.provider) parts.push("Applications render components inside a FluentProvider configured with a theme of design tokens.");
  return parts.length ? parts.join(" ") : null;
}
