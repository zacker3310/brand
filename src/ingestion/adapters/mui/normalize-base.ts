/**
 * Normalize Base UI ("base-ui") fragments into a NormalizedBundle. Pure.
 *
 * One ATLAS component per entry of the generated components index (docs/.../components/page.mdx).
 * Parts (Accordion.Root, Accordion.Item, ...) come from the generated types.md API reference and
 * are stored as properties named "<Part>.<prop>"; documented presence data attributes
 * (data-disabled, data-open, ...) are the component's documented states. Base UI is unstyled:
 * no visual variants, sizes or design tokens are documented.
 */
import type { CoverageState, EvidenceInput, NormalizedBundle, NormalizedComponent, NormalizedPattern, NormalizedSystemFacts } from "@/lib/contracts";
import { canonicalState, classifyComponentName, classifyPatternName } from "@/lib/taxonomy";
import { slugify } from "@/lib/utils";
import { BASE_DOCS_ORIGIN, BASE_REPO, MUI_OWNER, PARSERS, classifyFor, prioritize } from "./constants";
import { byKind, type FragOf, type MuiFragment, type NpmPin } from "./fragments";
import { keyboardFromBlocks } from "./markdown";
import { clip, evidence, isPrerelease, literalUnion, sortBy, uniq } from "./shared";

/** Presence data attributes that describe interaction/validity state. */
const STATE_ATTRS: Record<string, string | null> = {
  disabled: "disabled",
  open: "expanded",
  closed: "collapsed",
  checked: "selected",
  unchecked: null,
  indeterminate: "indeterminate",
  pressed: "active",
  highlighted: null,
  selected: "selected",
  invalid: "error",
  valid: "success",
  touched: null,
  dirty: null,
  filled: null,
  focused: "focus",
  readonly: "readonly",
  required: null,
  "panel-open": "expanded",
  "popup-open": "expanded",
  expanded: "expanded",
  dragging: "dragged",
  scrolling: null,
  empty: null,
  loading: "loading",
  complete: null,
};

const A11Y_TEXT = /screen reader|assistive|accessib|aria-|\brole\b|keyboard|focus/i;

export const baseDocsUrl = (slug: string) => `${BASE_DOCS_ORIGIN}/react/components/${slug}`;

function npmEv(pin: NpmPin, retrievedAt: string) {
  return (field: string, excerpt: string): EvidenceInput => ({
    field,
    sourceUrl: `https://www.npmjs.com/package/${pin.pkg}/v/${pin.version}`,
    sourceTitle: `${pin.pkg} on npm`,
    retrievedAt,
    contentHash: null,
    extractionMethod: `adapter:mui:${PARSERS.npm}`,
    location: `https://registry.npmjs.org/${pin.pkg.replace("/", "%2F")}#/dist-tags/latest`,
    excerpt,
    state: "verified",
    confidence: 0.95,
  });
}

interface BuildCtx {
  pin: NpmPin;
  npm: (field: string, excerpt: string) => EvidenceInput;
  unstyled: FragOf<"base-text"> | null;
  slugs: Set<string>;
}

function buildComponent(b: BuildCtx, entry: FragOf<"base-index">["entries"][number], indexFrag: FragOf<"base-index">, page: FragOf<"base-page"> | null, types: FragOf<"base-types"> | null): NormalizedComponent {
  const slug = entry.slug;
  const docsUrl = baseDocsUrl(slug);
  const ev: EvidenceInput[] = [];
  const coverage: Record<string, CoverageState> = {};
  const p = page?.page ?? null;
  const parts = (types?.parts ?? []).filter((x) => x.props.length || x.dataAttributes.length || x.cssVariables.length);
  const importName = p?.importName ?? null;

  ev.push(
    evidence(indexFrag.prov, "*", PARSERS.baseIndex, {
      title: "Base UI components index",
      location: `${indexFrag.prov.file}#${slug}`,
      excerpt: `${entry.name}${entry.description ? `: ${entry.description}` : ""}`,
    }),
  );

  const description = clip(p?.subtitle ?? entry.description ?? null, 280);
  coverage.description = description ? "documented" : "not-documented";
  if (description) ev.push(page ? evidence(page.prov, "description", PARSERS.basePage, { location: `${page.prov.file} <Subtitle>`, excerpt: description }) : evidence(indexFrag.prov, "description", PARSERS.baseIndex, { location: `${indexFrag.prov.file}#${slug}`, excerpt: description }));

  const lifecycle: NormalizedComponent["lifecycle"] = isPrerelease(b.pin.version) ? "unknown" : "stable";
  // Derived from the package's stable (non-prerelease) release, not a per-component status claim.
  if (lifecycle === "stable") ev.push({ ...b.npm("lifecycle", `documented in ${b.pin.pkg}@${b.pin.version} (stable, non-prerelease release)`), state: "inferred", confidence: 0.8 });

  const cls = classifyFor("base-ui", entry.name, classifyComponentName);
  const frameworks: NormalizedComponent["frameworks"] = [{ slug: "react", packageName: p?.importPath ?? b.pin.pkg, importName: importName ?? entry.name.replace(/\s+/g, ""), sourceUrl: docsUrl }];
  coverage.frameworks = "documented";
  if (page && p?.importPath) ev.push(evidence(page.prov, "frameworks", PARSERS.basePage, { location: `${page.prov.file}#anatomy`, excerpt: `import { ${importName} } from '${p.importPath}'` }));

  // Properties per part (+ documented component CSS variables)
  const single = parts.length === 1;
  const properties: NormalizedComponent["properties"] = [];
  const apiUrl = `${docsUrl}#api-reference`;
  for (const part of parts) {
    for (const pr of part.props) {
      properties.push({
        implementation: "react",
        name: single ? pr.name : `${part.name}.${pr.name}`,
        type: pr.type,
        defaultValue: pr.defaultValue,
        required: null,
        deprecated: /\bdeprecated\b/i.test(pr.description ?? ""),
        description: pr.description,
        allowedValues: literalUnion(pr.type),
        sourceUrl: apiUrl,
      });
    }
    for (const v of part.cssVariables) {
      properties.push({ implementation: "css", name: single ? v.name : `${part.name} ${v.name}`, type: v.type, defaultValue: null, required: null, deprecated: false, description: v.description, allowedValues: null, sourceUrl: apiUrl });
    }
  }
  const seenP = new Set<string>();
  const props = properties.filter((x) => (seenP.has(`${x.implementation}|${x.name}`) ? false : (seenP.add(`${x.implementation}|${x.name}`), true)));
  coverage.properties = props.length ? "documented" : types ? "not-documented" : "not-extracted";
  if (types) ev.push(evidence(types.prov, "properties", PARSERS.baseTypes, { location: `${types.prov.file}#api-reference`, excerpt: `${parts.length} parts: ${parts.map((x) => `${x.name} (${x.props.length} props)`).slice(0, 8).join(", ")}` }));

  // States from documented presence data attributes
  const states: NormalizedComponent["states"] = [];
  const seenS = new Set<string>();
  for (const part of parts) {
    for (const a of part.dataAttributes) {
      const key = a.name.replace(/^data-/, "");
      if (!(key in STATE_ATTRS) || a.type || seenS.has(key)) continue;
      seenS.add(key);
      states.push({ name: a.name, canonical: STATE_ATTRS[key] ?? canonicalState(key), description: clip(`${single ? "" : `${part.name}: `}${a.description ?? ""}`, 280), sourceUrl: apiUrl });
    }
  }
  coverage.states = states.length ? "documented" : types ? "not-documented" : "not-extracted";
  if (states.length && types) ev.push(evidence(types.prov, "states", PARSERS.baseTypes, { location: `${types.prov.file} Data Attributes`, excerpt: states.map((s) => s.name).join(", ") }));

  // Unstyled library: no visual variants/sizes documented.
  coverage.variants = "not-documented";
  coverage.sizes = "not-documented";

  // Accessibility: a11y/keyboard/focus sections + usage-guideline items about assistive technology.
  const a11yTexts = [...(p?.a11y.map((s) => s.text).filter((t): t is string => !!t) ?? []), ...(p?.usageGuidelines.filter((g) => A11Y_TEXT.test(g)) ?? [])];
  const keyboard = uniq([...(p?.keyboard ?? []), ...keyboardFromBlocks(p?.usageGuidelines.filter((g) => A11Y_TEXT.test(g)) ?? [])].map((k) => JSON.stringify(k))).map((k) => JSON.parse(k) as { keys: string; action: string });
  let accessibility: NormalizedComponent["accessibility"] = null;
  if (a11yTexts.length && page) {
    const guidance = clip(uniq(a11yTexts).join(" "), 1200);
    const anchor = p?.a11y[0]?.anchor ?? "usage-guidelines";
    accessibility = {
      ariaPattern: null,
      roles: null,
      keyboard: keyboard.length ? keyboard : null,
      guidance,
      screenReader: null,
      focusManagement: null,
      wcagCriteria: null,
      docsUrl: `${docsUrl}#${anchor}`,
      coverage: { guidance: "documented", keyboard: keyboard.length ? "documented" : "not-documented", roles: "not-extracted", ariaPattern: "not-documented", screenReader: "not-extracted", focusManagement: "not-extracted", wcagCriteria: "not-documented" },
    };
    coverage.accessibility = "documented";
    coverage.keyboard = keyboard.length ? "documented" : "not-documented";
    ev.push(evidence(page.prov, "accessibility", PARSERS.basePage, { location: `${page.prov.file}#${anchor}`, excerpt: guidance, confidence: 0.85 }));
    if (keyboard.length) ev.push(evidence(page.prov, "keyboard", PARSERS.basePage, { location: `${page.prov.file}#${anchor}`, excerpt: keyboard[0]!.action, confidence: 0.8 }));
  } else {
    coverage.accessibility = page ? "not-documented" : "not-extracted";
    coverage.keyboard = page ? "not-documented" : "not-extracted";
  }

  // Examples
  const examples: NormalizedComponent["examples"] = (p?.examples ?? []).slice(0, 25).map((e) => ({ slug: `example-${slugify(e.anchor) || "section"}`, title: e.title, kind: "docs-link" as const, url: `${docsUrl}#${e.anchor}` }));
  const exSeen = new Set<string>();
  const exList = examples.filter((e) => (exSeen.has(e.slug) ? false : (exSeen.add(e.slug), true)));
  coverage.examples = exList.length ? "documented" : page ? "not-documented" : "not-extracted";
  if (exList.length && page) ev.push(evidence(page.prov, "examples", PARSERS.basePage, { location: `${page.prov.file}#examples`, excerpt: exList.map((e) => e.title).join("; ") }));

  // Relationships: in-content links to other component pages.
  const relationships = (p?.componentLinks ?? []).filter((s) => s !== slug && b.slugs.has(s)).map((s) => ({ kind: "see-also", targetSlug: s, targetType: null }));
  coverage.relationships = relationships.length ? "documented" : page ? "not-documented" : "not-extracted";
  if (relationships.length && page) ev.push(evidence(page.prov, "relationships", PARSERS.basePage, { location: `${page.prov.file} links to /react/components/*`, excerpt: `Links to: ${relationships.map((r) => r.targetSlug).join(", ")}` }));

  // Tokens: unstyled components ship no CSS (documented on the About page).
  if (b.unstyled?.statements.unstyled) {
    coverage.tokens = "documented-none";
    ev.push(evidence(b.unstyled.prov, "tokens", PARSERS.basePage, { location: `${b.unstyled.prov.file}#headless`, excerpt: b.unstyled.statements.unstyled, confidence: 0.85 }));
  } else coverage.tokens = "not-documented";
  coverage.responsive = p?.mentionsResponsive ? "not-extracted" : page ? "not-documented" : "not-extracted";

  return {
    slug,
    name: entry.name,
    aliases: importName && importName !== entry.name ? [importName] : [],
    description,
    docsUrl,
    sourceCodeUrl: typeof page?.meta.sourceDir === "string" ? `https://github.com/${MUI_OWNER}/${BASE_REPO}/tree/${b.pin.tag}/${page.meta.sourceDir}` : null,
    lifecycle,
    canonicalType: cls?.slug ?? null,
    classification: cls ? { state: "inferred", method: `taxonomy:${cls.method}`, confidence: cls.confidence } : null,
    frameworks,
    variants: [],
    states,
    sizes: null,
    properties: props,
    accessibility,
    examples: exList,
    relationships,
    tokenUsages: [],
    responsiveGuidance: null,
    coverage,
    evidence: ev,
  };
}

export function baseStatements(role: string, blocks: string[]): Record<string, string | null> {
  const find = (re: RegExp) => {
    for (const b of blocks) for (const s of b.split(/(?<=[.!?])\s+(?=[A-Z])/)) if (re.test(s)) return clip(s, 280);
    return null;
  };
  switch (role) {
    case "about":
      return {
        library: find(/is an unstyled React component library/i),
        unstyled: find(/components are unstyled, don't bundle CSS/i),
        wai: find(/adhere to \[?WAI-ARIA design patterns/i),
        focus: find(/Our focus is on accessibility/i),
      };
    default:
      return {};
  }
}

function buildFacts(pin: NpmPin, npm: BuildCtx["npm"], about: FragOf<"base-text"> | null): NormalizedSystemFacts {
  const ev: EvidenceInput[] = [npm("latestVersion", `dist-tags.latest = ${pin.version}${pin.publishedAt ? `, published ${pin.publishedAt}` : ""}; source tag ${pin.tag} (${pin.tagMethod})`)];
  if (pin.publishedAt) ev.push(npm("latestReleaseAt", `time[${pin.version}] = ${pin.publishedAt}`));
  const parts: string[] = [];
  let principles: NormalizedSystemFacts["principles"] = null;
  if (about) {
    const s = about.statements;
    if (s.library) {
      parts.push("Base UI is an unstyled (headless) React component library for building accessible user interfaces, from the creators of Radix, Material UI and Floating UI.");
      ev.push(evidence(about.prov, "philosophy", PARSERS.basePage, { location: `${about.prov.file} intro`, excerpt: s.library }));
    }
    if (s.unstyled) {
      parts.push("Components ship without CSS and leave the styling solution to the application.");
      ev.push(evidence(about.prov, "philosophy", PARSERS.basePage, { location: `${about.prov.file}#headless`, excerpt: s.unstyled }));
    }
    if (s.wai) {
      parts.push("Accessibility is its stated primary focus; components follow WAI-ARIA design patterns.");
      ev.push(evidence(about.prov, "philosophy", PARSERS.basePage, { location: `${about.prov.file}#accessible`, excerpt: s.wai }));
    }
    const features = about.page.headings.findIndex((h) => h.depth === 2 && /^features$/i.test(h.text));
    if (features >= 0) {
      const list: { name: string; sourceUrl: string }[] = [];
      for (const h of about.page.headings.slice(features + 1)) {
        if (h.depth === 2) break;
        if (h.depth === 3) list.push({ name: h.text, sourceUrl: `${about.pageUrl}#${h.anchor}` });
      }
      if (list.length) {
        principles = list;
        ev.push(evidence(about.prov, "principles", PARSERS.basePage, { location: `${about.prov.file}#features (h3)`, excerpt: list.map((x) => x.name).join("; ") }));
      }
    }
  }
  ev.push(npm("frameworks", `${pin.pkg} is a React package (import path ${pin.pkg}/<component>)`));
  return {
    latestVersion: pin.version,
    latestReleaseAt: pin.publishedAt,
    philosophy: parts.length ? parts.join(" ") : null,
    principles,
    frameworks: [{ slug: "react", packageName: pin.pkg }],
    evidence: ev,
  };
}

export function normalizeBase(frags: MuiFragment[], opts: { limit?: number; runStartedAt: string; log?: (m: string) => void }): NormalizedBundle {
  const pin = frags[0]?.meta.pin;
  if (!pin) return { systemSlug: "base-ui", components: [], tokenSets: [], patterns: [], facts: null };
  const npm = npmEv(pin, opts.runStartedAt);
  const index = byKind(frags, "base-index")[0] ?? null;
  const pages = new Map(byKind(frags, "base-page").map((f) => [f.slug, f]));
  const types = new Map(byKind(frags, "base-types").map((f) => [f.slug, f]));
  const texts = byKind(frags, "base-text");
  const about = texts.find((t) => t.role === "about") ?? null;
  const entries = index?.entries ?? [];
  const chosen = new Set(prioritize(entries.map((e) => e.slug), "base-ui", opts.limit));
  const selected = entries.filter((e) => chosen.has(e.slug));
  const ctx: BuildCtx = { pin, npm, unstyled: about, slugs: new Set(selected.map((e) => e.slug)) };
  const components = index ? selected.map((e) => buildComponent(ctx, e, index, pages.get(e.slug) ?? null, types.get(e.slug) ?? null)) : [];

  const patterns: NormalizedPattern[] = [];
  for (const t of texts.filter((x) => x.role === "forms")) {
    const name = t.page.title ?? "Forms";
    const cls = classifyPatternName(name);
    const componentSlugs = t.page.componentLinks.filter((s) => ctx.slugs.has(s)).sort();
    const description = clip(t.page.subtitle, 280);
    patterns.push({
      slug: slugify(name) || "forms",
      name,
      description,
      docsUrl: t.pageUrl,
      canonicalType: cls?.slug ?? null,
      classification: cls ? { state: "inferred", method: `taxonomy:${cls.method}`, confidence: cls.confidence } : null,
      componentSlugs,
      coverage: { description: description ? "documented" : "not-documented", components: componentSlugs.length ? "documented" : "not-extracted" },
      evidence: [evidence(t.prov, "*", PARSERS.basePage, { title: `Base UI handbook: ${name}`, location: `${t.prov.file} <Subtitle>`, excerpt: description })],
    });
  }

  return { systemSlug: "base-ui", components: sortBy(components, (c) => c.slug), tokenSets: [], patterns, facts: buildFacts(pin, npm, about) };
}
