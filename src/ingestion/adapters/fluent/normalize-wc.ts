/**
 * fluent-ui-web-components (@fluentui/web-components v3) component modeling.
 *
 *  - One ATLAS component per custom element *defined* by the pinned package: each
 *    `XDefinition` in dist/web-components.d.ts documented as "The definition for the `<fluent-x>`
 *    element", paired with `class X` (and its base classes). Slug = tag without the "fluent-" prefix.
 *  - The package also ships custom-elements.json, but at 3.1.x its module paths and some tag names
 *    describe an older source layout (e.g. fluent-text-area vs the defined fluent-textarea), so the
 *    declaration roll-up is the authoritative API source.
 *  - Properties: public, non-internal class members incl. inherited ones; HTML attribute names come
 *    from the TSDoc "HTML Attribute: `x`" remarks; enum values from the `as const` option objects.
 *  - Roles / APG patterns: only when the class TSDoc links an ARIA role or APG pattern.
 *  - Docs URLs: the official Storybook (storybooks.fluentui.dev/web-components) docs page whose story
 *    directory matches the tag.
 */
import type { EvidenceInput, NormalizedComponent } from "@/lib/contracts";
import { classifyComponentName } from "@/lib/taxonomy";
import { slugify } from "@/lib/utils";
import { baseCoverage, pick, sizesFromProps, statesFromProps, strongest, toProperty, variantsFromProps, type FluentFragment, type WcElementLite } from "./fragments";
import { wcComponentPages, type WcDocPage } from "./storybook";
import { PKG, REPO_URL, SB_WC, clip, evidence, humanize, leadSentences, lifecycleFromVersion, nameCandidates, npmFile, npmPage, sortBy, uniq } from "./shared";

/** ARIA roles and APG pattern slugs linked from TSDoc (`https://w3c.github.io/aria/#checkbox`). */
export function ariaRefs(raw: string[]): { roles: string[]; patterns: string[] } {
  const roles = new Set<string>();
  const patterns = new Set<string>();
  for (const r of raw) {
    for (const m of r.matchAll(/https?:\/\/(?:w3c\.github\.io\/aria\/|www\.w3\.org\/TR\/wai-aria-1\.[12]\/)#([a-z]+)/g)) roles.add(m[1]!);
    for (const m of r.matchAll(/https?:\/\/www\.w3\.org\/WAI\/ARIA\/apg\/patterns\/([a-z-]+)\/?/g)) patterns.add(m[1]!);
    for (const m of r.matchAll(/https?:\/\/www\.w3\.org\/TR\/wai-aria-practices(?:-1\.[12])?\/#([a-z-]+)/g)) patterns.add(m[1]!);
    for (const m of r.matchAll(/\bARIA\s+`?([a-z]+)`?\s+role\b/g)) roles.add(m[1]!);
  }
  return { roles: [...roles].sort(), patterns: [...patterns].sort() };
}

const cleanClass = (n: string) => n.replace(/_\d+$/, "");

/**
 * Drop a leading "A Foo Custom HTML Element." sentence when Foo is not the documented class
 * (upstream copy-paste, e.g. MenuItem's TSDoc starts "A Switch Custom HTML Element.").
 */
export function dropMismatchedLead(summary: string | null, className: string): string | null {
  if (!summary) return null;
  const m = /^An?\s+([A-Za-z ]+?)\s+Custom HTML Element\.?\s*/.exec(summary);
  if (!m) return summary;
  const said = m[1]!.replace(/\s+/g, "").toLowerCase();
  const cls = className.toLowerCase();
  if (cls.includes(said) || said.includes(cls)) return summary;
  const rest = summary.slice(m[0].length).trim();
  return rest || summary;
}

export function normalizeWc(frags: FluentFragment[], opts: { limit?: number } = {}): { components: NormalizedComponent[]; warnings: string[] } {
  const warnings: string[] = [];
  const dts = pick(frags, "wc-dts")[0];
  if (!dts) return { components: [], warnings: ["web-components declarations unavailable"] };
  const sb = pick(frags, "sb-index").find((f) => f.system === "fluent-ui-web-components") ?? null;
  const pages = sb ? wcComponentPages(sb.entries) : [];
  const byDir = new Map<string, WcDocPage>();
  for (const p of pages) if (!byDir.has(p.dir)) byDir.set(p.dir, p);
  const version = dts.npm.version;
  const dtsUrl = npmFile(PKG.webComponents, version, "dist/web-components.d.ts");
  const components: NormalizedComponent[] = [];
  const used = new Set<string>();
  let elements: WcElementLite[] = sortBy(dts.elements, (e) => e.tagName);
  if (opts.limit && opts.limit > 0) elements = elements.slice(0, opts.limit);
  const tagToSlug = new Map<string, string>();
  for (const el of elements) {
    let slug = slugify(el.tagName.replace(/^fluent-/, ""));
    if (used.has(slug)) slug = slugify(el.tagName);
    used.add(slug);
    tagToSlug.set(el.tagName, slug);
  }

  for (const el of elements) {
    const slug = tagToSlug.get(el.tagName)!;
    const dir = el.tagName.replace(/^fluent-/, "");
    // Exact story directory, else the longest documented directory the tag extends (drawer-body -> drawer).
    const page = byDir.get(dir) ?? sortBy([...byDir.values()].filter((p) => dir.startsWith(`${p.dir}-`)), (p) => String(100 - p.dir.length))[0] ?? null;
    const name = cleanClass(el.className);
    const ev: EvidenceInput[] = [evidence(dts.prov, "*", "dts-custom-element", { location: `dist/web-components.d.ts#L${el.line}`, excerpt: `class ${el.className} (${el.chain.join(" > ")}) defines <${el.tagName}>` })];
    const coverage = baseCoverage("not-extracted");
    const description = leadSentences(dropMismatchedLead(el.summary, name), 280);
    coverage.description = description ? "documented" : "not-documented";
    if (description) ev.push(evidence(dts.prov, "description", "dts-tsdoc", { location: `dist/web-components.d.ts#L${el.line}`, excerpt: description }));

    const properties = sortBy(el.props, (p) => p.name).map((p) => toProperty(p, "web-components", dtsUrl));
    coverage.properties = properties.length ? "documented" : "not-documented";
    ev.push(
      evidence(dts.prov, "properties", "dts-custom-element", {
        location: `dist/web-components.d.ts#${el.className}`,
        excerpt: `${properties.length} public properties (${el.props.filter((p) => p.attribute).length} with HTML attributes)${el.slots.length ? `; slots: ${el.slots.join(", ")}` : ""}${el.events.length ? `; events: ${el.events.join(", ")}` : ""}`,
      }),
    );
    const variants = variantsFromProps(el.props, dtsUrl, "dist/web-components.d.ts");
    const sizes = sizesFromProps(el.props);
    const states = statesFromProps(el.props, dtsUrl);
    coverage.variants = variants.length ? "documented" : "not-documented";
    coverage.sizes = sizes ? "documented" : "not-documented";
    coverage.states = states.length ? "inferred" : "not-documented";
    if (variants.length) ev.push(evidence(dts.prov, "variants", "dts-custom-element", { location: `dist/web-components.d.ts#${el.className}`, excerpt: uniq(variants.map((v) => `${v.axis}: ${v.name}`)).slice(0, 12).join(", ") }));
    if (sizes) ev.push(evidence(dts.prov, "sizes", "dts-custom-element", { location: `dist/web-components.d.ts#${el.className}.size`, excerpt: `size: ${sizes.join(" | ")}` }));

    const aria = ariaRefs(el.rawDocs);
    let accessibility: NormalizedComponent["accessibility"] = null;
    if (aria.roles.length || aria.patterns.length) {
      accessibility = {
        ariaPattern: aria.patterns[0] ?? null,
        roles: aria.roles.length ? aria.roles : null,
        keyboard: null,
        guidance: null,
        screenReader: null,
        focusManagement: null,
        wcagCriteria: null,
        docsUrl: page?.docsUrl ?? null,
        coverage: { roles: aria.roles.length ? "documented" : "not-documented", ariaPattern: aria.patterns.length ? "documented" : "not-documented", guidance: "not-extracted", keyboard: "not-extracted", screenReader: "not-extracted", focusManagement: "not-extracted", wcagCriteria: "not-extracted" },
      };
      coverage.accessibility = "documented";
      ev.push(evidence(dts.prov, "accessibility", "dts-tsdoc", { location: `dist/web-components.d.ts#L${el.line}`, excerpt: `${aria.roles.length ? `ARIA roles: ${aria.roles.join(", ")}` : ""}${aria.patterns.length ? ` APG patterns: ${aria.patterns.join(", ")}` : ""}`.trim() }));
    }

    const frameworks = [{ slug: "web-components", packageName: PKG.webComponents, importName: name, sourceUrl: npmPage(PKG.webComponents, version) }];
    coverage.frameworks = "documented";
    ev.push(evidence(dts.prov, "frameworks", "dts-custom-element", { location: `dist/web-components.d.ts#${el.className}Definition`, excerpt: `${el.className}Definition: The definition for the <${el.tagName}> element.` }));

    const examples: NormalizedComponent["examples"] = [];
    if (page) {
      examples.push({ slug: "storybook-docs", title: `Storybook: ${page.title}`, kind: "docs-link", url: page.docsUrl, language: null, code: null, attribution: null });
      for (const s of (sb?.entries ?? []).filter((e) => e.type === "story" && e.id.startsWith(page.id.replace(/--docs$/, "--"))).slice(0, 10))
        examples.push({ slug: slugify(`story-${s.id.split("--")[1]}`), title: `${name}: ${s.name}`, kind: "storybook-link", url: `${SB_WC}?path=/story/${s.id}`, language: null, code: null, attribution: null });
      coverage.examples = "documented";
      if (sb) ev.push(evidence(sb.prov, "examples", "storybook-index", { location: `index.json#/entries/${page.id}`, excerpt: `${page.title} -> ${page.dir}` }));
    } else coverage.examples = "not-documented";

    // Relationships: inheritance between defined elements (e.g. ToggleButton extends Button).
    const relationships: NormalizedComponent["relationships"] = [];
    for (const base of el.chain.slice(1)) {
      const parentEl = elements.find((x) => x.className === base);
      if (parentEl) relationships.push({ kind: "extends", targetSlug: tagToSlug.get(parentEl.tagName)!, targetType: null });
    }
    // TSDoc that links or names other elements ("designed for use in the Dropdown element",
    // {@link (BaseDropdown:class)}) describes relationships this inheritance scan does not model.
    const docText = el.rawDocs[0] ?? "";
    const mentionsOthers = /\{@link\s+\(?[A-Z][\w$]*(?::class)?\)?\s*[|}]/.test(docText) || elements.some((x) => x !== el && x.className.length > 3 && new RegExp(`\\b${x.className}\\b`).test(docText.replace(new RegExp(`\\b${el.className}\\b`, "g"), "")));
    coverage.relationships = relationships.length ? "documented" : mentionsOthers ? "not-extracted" : "not-documented";
    if (relationships.length) ev.push(evidence(dts.prov, "relationships", "dts-custom-element", { location: `dist/web-components.d.ts#L${el.line}`, excerpt: `class ${el.className} extends ${el.chain[1]}` }));
    coverage.keyboard = "not-extracted";
    coverage.tokens = "not-extracted";
    const lifecycle = el.deprecated ? "deprecated" : lifecycleFromVersion(version);
    ev.push(evidence(dts.prov, "lifecycle", "npm-version", { location: `${PKG.webComponents}@${version}`, excerpt: `${PKG.webComponents}@${version}` }));

    const cls = strongest([...nameCandidates(name), dir.replace(/-/g, " ")].map((x) => classifyComponentName(x)));
    let canonicalType = cls?.slug ?? null;
    let classification: NormalizedComponent["classification"] = cls ? { state: "inferred", method: cls.method, confidence: cls.confidence } : null;
    if (cls && aria.roles.includes(cls.slug)) classification = { state: "verified", method: `${cls.method} + tsdoc-aria-role:${cls.slug}`, confidence: Math.max(cls.confidence, 0.9) };
    if (!canonicalType) canonicalType = null;
    components.push({
      slug,
      name,
      aliases: uniq([`<${el.tagName}>`, humanize(name) !== name ? humanize(name) : null, el.className !== name ? el.className : null].filter((x): x is string => !!x)),
      description: description ? clip(description, 400) : null,
      docsUrl: page?.docsUrl ?? null,
      sourceCodeUrl: page ? `${REPO_URL}/tree/master/packages/web-components/src/${page.dir}` : `${REPO_URL}/tree/master/packages/web-components`,
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
      tokenUsages: [],
      responsiveGuidance: null,
      coverage,
      evidence: ev,
    });
    if (!page) warnings.push(`<${el.tagName}>: no Storybook docs page found`);
  }
  return { components: sortBy(components, (c) => c.slug), warnings };
}
