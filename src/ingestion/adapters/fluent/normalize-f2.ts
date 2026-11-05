/**
 * fluent-2 (Fluent 2 design system, fluent2.microsoft.design) modeling: the design guidance catalog.
 *
 *  - Components: the site navigation's "Components" groups (web/react, iOS, Android). Entries with the
 *    same title on several platforms are one ATLAS component (slug from the title); the web page is
 *    the primary docs page, platform pages are kept as docs-link examples and their Types as variants.
 *  - Variants = the page's "Types" gallery (axis "type"); accessibility = the "Accessibility" section
 *    prose; frameworks = the page's Resources links to the React / Web Components Storybooks; the WAI
 *    APG link gives ariaPattern (classification is upgraded to verified only when the APG pattern is
 *    the ariaPattern of the inferred ATLAS type).
 *  - Fluent 2 pages do not document component APIs (they link to the Storybooks): properties are
 *    "not-documented" here; implementation APIs live in fluent-ui-react / fluent-ui-web-components.
 *  - Patterns: the "UX frameworks and guidelines" navigation group (minus "Design tokens").
 */
import type { EvidenceInput, NormalizedComponent, NormalizedPattern, NormalizedSystemFacts } from "@/lib/contracts";
import { classifyComponentName, classifyPatternName, componentTypeBySlug } from "@/lib/taxonomy";
import { slugify } from "@/lib/utils";
import type { F2Page, F2Section } from "./f2-html";
import { sectionById } from "./f2-html";
import { baseCoverage, pick, strongest, type FluentFragment, type FragOf } from "./fragments";
import { storybookIdFromUrl } from "./storybook";
import { PKG, SB_REACT, SB_WC, clip, evidence, firstSentence, leadSentences, nameCandidates, sortBy, storybookDocsUrl, uniq } from "./shared";

const LIB_ORDER: Record<string, number> = { "web/react": 0, "web/web-components": 1, ios: 2, android: 3, windows: 4 };
const LIB_LABEL: Record<string, string> = { "web/react": "Web", "web/web-components": "Web Components", ios: "iOS", android: "Android", windows: "Windows" };

const KEY_WORDS = /\b(Tab|Enter|Space(bar)?|Escape|Esc|Arrow|Home|End|Page ?(Up|Down)|Shift)\b/;

export interface F2Result {
  components: NormalizedComponent[];
  patterns: NormalizedPattern[];
  warnings: string[];
}

function apgPattern(page: F2Page): { slug: string; url: string } | null {
  for (const r of page.resources) {
    const m = /^https?:\/\/www\.w3\.org\/WAI\/ARIA\/apg\/patterns\/([a-z-]+)\/?/.exec(r.href);
    if (m) return { slug: m[1]!, url: r.href };
  }
  return null;
}

function implementations(page: F2Page): { slug: string; packageName: string; url: string; title: string }[] {
  const out: { slug: string; packageName: string; url: string; title: string }[] = [];
  for (const r of page.resources) {
    if (/migration/i.test(r.title) || /migration/.test(r.href)) continue;
    const id = storybookIdFromUrl(r.href);
    if (!id) continue;
    if (/react\.fluentui\.dev|storybooks\.fluentui\.dev\/react/.test(r.href) && /react/i.test(r.subtitle)) out.push({ slug: "react", packageName: PKG.reactComponents, url: storybookDocsUrl(SB_REACT, id), title: r.title });
    else if (/web-components\.fluentui\.dev|storybooks\.fluentui\.dev\/web-components/.test(r.href)) out.push({ slug: "web-components", packageName: PKG.webComponents, url: storybookDocsUrl(SB_WC, id), title: r.title });
  }
  return out.filter((x, i) => out.findIndex((y) => y.slug === x.slug) === i);
}

const a11yText = (s: F2Section | undefined) => (s ? clip(s.prose.join(" "), 1100) : null);

export function normalizeF2(frags: FluentFragment[], opts: { limit?: number } = {}): F2Result {
  const warnings: string[] = [];
  const pages = pick(frags, "f2-page");
  const byKey = new Map<string, FragOf<"f2-page">[]>();
  for (const p of sortBy(pages, (x) => `${LIB_ORDER[x.entry.library] ?? 9}|${x.entry.url}`)) {
    const key = slugify(p.entry.title);
    byKey.set(key, [...(byKey.get(key) ?? []), p]);
  }
  const urlToSlug = new Map<string, string>();
  for (const [slug, list] of byKey) for (const p of list) urlToSlug.set(p.entry.url, slug);
  const components: NormalizedComponent[] = [];
  let keys = [...byKey.keys()].sort();
  if (opts.limit && opts.limit > 0) keys = keys.slice(0, opts.limit);
  const kept = new Set(keys);

  for (const slug of keys) {
    const list = byKey.get(slug)!;
    const primary = list[0]!;
    const page = primary.page;
    const name = primary.entry.title;
    const docsUrl = primary.entry.url;
    const ev: EvidenceInput[] = [evidence(primary.prov, "*", "f2-html", { location: new URL(docsUrl).pathname, excerpt: page.title ?? name, title: page.title })];
    for (const other of list.slice(1)) ev.push(evidence(other.prov, "*", "f2-html", { location: new URL(other.entry.url).pathname, excerpt: other.page.title ?? other.entry.title, title: other.page.title }));
    const nav = pick(frags, "f2-nav")[0];
    if (nav) ev.push(evidence(nav.prov, "*", "f2-nav", { location: `Nav island props: Components (${primary.entry.library})`, excerpt: `${name} -> ${new URL(docsUrl).pathname}` }));
    const coverage = baseCoverage("not-extracted");

    // description: first sentence of the page intro (falls back to the nav card description)
    const descSrc = page.intro[0] ?? primary.entry.desc;
    const description = firstSentence(descSrc);
    coverage.description = description ? "documented" : "not-documented";
    if (description) ev.push(evidence(primary.prov, "description", "f2-html", { location: `${new URL(docsUrl).pathname} h1 + p`, excerpt: description }));

    // variants: Types galleries (primary first, then other platforms)
    const variants: NormalizedComponent["variants"] = [];
    const seen = new Set<string>();
    for (const p of list) {
      const types = sectionById(p.page, /^types$/i);
      for (const c of types?.cards ?? []) {
        const k = c.name.toLowerCase();
        if (seen.has(k)) continue;
        seen.add(k);
        const platform = p === primary ? null : LIB_LABEL[p.entry.library] ?? p.entry.library;
        variants.push({ axis: "type", name: c.name, description: clip([platform ? `${platform}:` : null, c.description].filter(Boolean).join(" "), 400), sourceUrl: `${p.entry.url}#${types!.id ?? "types"}`, location: `${new URL(p.entry.url).pathname}#types` });
      }
    }
    coverage.variants = variants.length ? "documented" : "not-documented";
    if (variants.length) ev.push(evidence(primary.prov, "variants", "f2-html", { location: `${new URL(docsUrl).pathname}#types`, excerpt: variants.map((v) => v.name).join(", ") }));

    // accessibility
    const a11ySec = sectionById(page, /^accessibility$/i);
    const guidance = a11yText(a11ySec);
    const apg = apgPattern(page);
    let accessibility: NormalizedComponent["accessibility"] = null;
    const keyboard = (a11ySec?.keyboard ?? []).map((k) => ({ keys: k.keys, action: clip(k.action, 240)! }));
    if (guidance || apg) {
      const mentionsKeys = !!a11ySec && KEY_WORDS.test(a11ySec.prose.join(" "));
      accessibility = {
        ariaPattern: apg?.slug ?? null,
        roles: null,
        keyboard: keyboard.length ? keyboard : null,
        guidance,
        screenReader: null,
        focusManagement: a11ySec ? clip(a11ySec.prose.filter((t) => /\bfocus/i.test(t)).join(" "), 800) : null,
        wcagCriteria: null,
        docsUrl: a11ySec ? `${docsUrl}#${a11ySec.id ?? "accessibility"}` : (apg?.url ?? null),
        coverage: {
          guidance: guidance ? "documented" : "not-documented",
          keyboard: keyboard.length ? "documented" : mentionsKeys ? "not-extracted" : "not-documented",
          ariaPattern: apg ? "documented" : "not-documented",
          roles: "not-documented",
          screenReader: "not-extracted",
          wcagCriteria: "not-extracted",
        },
      };
      coverage.accessibility = "documented";
      coverage.keyboard = keyboard.length ? "documented" : mentionsKeys ? "not-extracted" : "not-documented";
      if (guidance) ev.push(evidence(primary.prov, "accessibility", "f2-html", { location: `${new URL(docsUrl).pathname}#accessibility`, excerpt: guidance }));
      if (apg) ev.push(evidence(primary.prov, "accessibility", "f2-html", { location: `${new URL(docsUrl).pathname}#resources`, excerpt: `WAI guidance link: ${apg.url}` }));
    } else {
      coverage.accessibility = "not-documented";
      coverage.keyboard = "not-documented";
    }

    // responsive guidance (only when a section is explicitly about it)
    const resp = page.sections.find((s) => /responsive|adaptive|reflow|breakpoint/i.test(`${s.id} ${s.title}`));
    const responsiveGuidance = resp ? clip(resp.prose.join(" "), 800) : null;
    coverage.responsive = responsiveGuidance ? "documented" : "not-documented";
    if (responsiveGuidance) ev.push(evidence(primary.prov, "responsive", "f2-html", { location: `${new URL(docsUrl).pathname}#${resp!.id ?? ""}`, excerpt: responsiveGuidance }));

    // frameworks (Resources: implementation Storybooks)
    const impls = implementations(page);
    const frameworks = impls.map((i) => ({ slug: i.slug, packageName: i.packageName, importName: null, sourceUrl: i.url }));
    coverage.frameworks = frameworks.length ? "documented" : "not-documented";
    if (frameworks.length) ev.push(evidence(primary.prov, "frameworks", "f2-html", { location: `${new URL(docsUrl).pathname}#resources`, excerpt: impls.map((i) => `${i.title} (${i.slug})`).join("; ") }));

    // examples: platform pages, implementation storybooks, CodeSandbox links are not stored as code
    const examples: NormalizedComponent["examples"] = [];
    for (const p of list) examples.push({ slug: slugify(`guidance-${p.entry.library}`), title: `Fluent 2 ${LIB_LABEL[p.entry.library] ?? p.entry.library} guidance: ${p.entry.title}`, kind: "docs-link", url: p.entry.url, language: null, code: null, attribution: null });
    for (const i of impls) examples.push({ slug: slugify(`storybook-${i.slug}`), title: `${i.title} (${i.slug === "react" ? "Fluent UI React" : "Fluent UI Web Components"})`, kind: "storybook-link", url: i.url, language: null, code: null, attribution: null });
    coverage.examples = "documented";

    // relationships: body links to other component pages
    const rel = uniq(list.flatMap((p) => p.page.componentLinks).map((u) => urlToSlug.get(u)).filter((s): s is string => !!s && s !== slug));
    const relationships = rel.map((t) => ({ kind: "related", targetSlug: t, targetType: null }));
    coverage.relationships = relationships.length ? "documented" : "not-documented";
    if (relationships.length) ev.push(evidence(primary.prov, "relationships", "f2-html", { location: new URL(docsUrl).pathname, excerpt: `links to: ${rel.join(", ")}` }));

    // sourceCodeUrl: only explicit "code" resources (e.g. fluentui-apple / fluentui-android folders)
    const code = page.resources.find((r) => /^https:\/\/github\.com\//.test(r.href) && /code/i.test(r.title));
    coverage.properties = "not-documented";
    coverage.states = "not-documented";
    coverage.sizes = "not-documented";
    coverage.tokens = "not-documented";

    const cls = strongest(nameCandidates(name).map((x) => classifyComponentName(x)));
    let classification: NormalizedComponent["classification"] = cls ? { state: "inferred", method: cls.method, confidence: cls.confidence } : null;
    if (cls && apg && componentTypeBySlug.get(cls.slug)?.ariaPattern === apg.slug) classification = { state: "verified", method: `${cls.method} + wai-apg-link:${apg.slug}`, confidence: Math.max(cls.confidence, 0.9) };
    components.push({
      slug,
      name,
      aliases: [],
      description,
      docsUrl,
      sourceCodeUrl: code?.href ?? null,
      lifecycle: list.some((p) => p.entry.inPreview) ? "beta" : "unknown",
      canonicalType: cls?.slug ?? null,
      classification,
      frameworks,
      variants,
      states: [],
      sizes: null,
      properties: [],
      accessibility,
      examples,
      relationships,
      tokenUsages: [],
      responsiveGuidance,
      coverage,
      evidence: ev,
    });
  }
  const out = components.map((c) => ({ ...c, relationships: c.relationships.filter((r) => !r.targetSlug || kept.has(r.targetSlug)) }));

  // Patterns
  const nameToSlug = new Map(out.map((c) => [c.name.toLowerCase(), c.slug]));
  const patterns: NormalizedPattern[] = [];
  for (const f of sortBy(pick(frags, "f2-content").filter((x) => x.role === "pattern"), (x) => x.navTitle ?? "")) {
    const name = f.navTitle ?? f.page.h1 ?? f.page.title ?? "";
    if (!name) continue;
    const url = f.prov.sourceUrl;
    const description = firstSentence(f.page.intro[0] ?? f.page.metaDescription);
    const linked = uniq([
      ...f.page.componentLinks.map((u) => urlToSlug.get(u)).filter((s): s is string => !!s),
      ...f.page.sections.flatMap((s) => s.h3.map((h) => nameToSlug.get(h.title.toLowerCase()))).filter((s): s is string => !!s),
    ]).filter((s) => kept.has(s));
    const cls = classifyPatternName(name);
    const ev: EvidenceInput[] = [evidence(f.prov, "*", "f2-html", { location: new URL(url).pathname, excerpt: f.page.title ?? name, title: f.page.title })];
    if (description) ev.push(evidence(f.prov, "description", "f2-html", { location: `${new URL(url).pathname} h1 + p`, excerpt: description }));
    if (linked.length) ev.push(evidence(f.prov, "componentSlugs", "f2-html", { location: new URL(url).pathname, excerpt: `components named or linked: ${linked.join(", ")}` }));
    patterns.push({
      slug: slugify(name),
      name,
      description,
      docsUrl: url,
      canonicalType: cls?.slug ?? null,
      classification: cls ? { state: "inferred", method: cls.method, confidence: cls.confidence } : null,
      componentSlugs: linked,
      coverage: { description: description ? "documented" : "not-documented", components: linked.length ? "documented" : "not-documented", sections: f.page.sections.length ? "documented" : "not-documented" },
      evidence: ev,
    });
  }
  return { components: sortBy(out, (c) => c.slug), patterns: sortBy(patterns, (p) => p.slug), warnings };
}

/** System facts for fluent-2 (principles, frameworks, ATLAS-authored philosophy with evidence). */
export function f2Facts(frags: FluentFragment[]): NormalizedSystemFacts {
  const content = new Map(pick(frags, "f2-content").map((f) => [f.role, f]));
  const ev: EvidenceInput[] = [];
  const parts: string[] = [];
  const home = content.get("home");
  if (home?.page.metaDescription && /design system/i.test(home.page.metaDescription)) {
    parts.push("Fluent 2 is Microsoft's design system, built so teams can move fluidly from design to development, between apps and across platforms.");
    ev.push(evidence(home.prov, "philosophy", "f2-html", { location: "/ <meta name=description>", excerpt: home.page.metaDescription }));
  }
  const nav = pick(frags, "f2-nav")[0];
  const libs = uniq((nav?.groups ?? []).filter((g) => g.title === "Components" && g.library && g.pages.some((p) => /\/usage\/?$/.test(p.href))).map((g) => g.library!));
  const LABEL: Record<string, string> = { "web/react": "web", ios: "iOS", android: "Android" };
  if (nav && libs.length) {
    const names = libs.map((l) => LABEL[l] ?? l);
    parts.push(`Its site publishes component usage guidance for ${names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0]}.`);
    ev.push(evidence(nav.prov, "philosophy", "f2-nav", { location: "Nav island props: Components groups", excerpt: `Component libraries in navigation: ${libs.join(", ")}` }));
  }
  const principlesPage = content.get("principles");
  const principles: { name: string; sourceUrl: string }[] = [];
  if (principlesPage) {
    for (const s of principlesPage.page.sections) {
      if (!s.id || !s.title) continue;
      principles.push({ name: s.title, sourceUrl: `${principlesPage.prov.sourceUrl}#${s.id}` });
    }
    if (principles.length) {
      ev.push(evidence(principlesPage.prov, "principles", "f2-html", { location: "/design-principles h2", excerpt: principles.map((p) => p.name).join("; ") }));
      parts.push(`Its four published design principles are ${principles.map((p) => p.name).join(", ").replace(/, ([^,]+)$/, " and $1")}.`.replace("four", principles.length === 4 ? "four" : String(principles.length)));
      ev.push(evidence(principlesPage.prov, "philosophy", "f2-html", { location: "/design-principles", excerpt: principlesPage.page.intro[0] ?? principles.map((p) => p.name).join("; ") }));
    }
  }
  const tokens = content.get("design-tokens");
  const glob = tokens ? sectionById(tokens.page, /global-tokens|^global tokens$/i) : undefined;
  const alias = tokens ? sectionById(tokens.page, /alias-tokens|^alias tokens$/i) : undefined;
  if (tokens && glob && alias) {
    parts.push("Styles are expressed as a two-layer token system: context-agnostic global tokens holding raw values, and alias tokens that add semantic meaning, with themes for light, dark, high contrast and brand.");
    ev.push(evidence(tokens.prov, "philosophy", "f2-html", { location: "/design-tokens#global-tokens", excerpt: glob.prose[0] ?? glob.title }));
  }
  const develop = content.get("develop");
  const frameworks: { slug: string; packageName: string | null }[] = [];
  if (develop) {
    const text = develop.page.sections.flatMap((s) => s.prose).join(" ");
    if (/@fluentui\/react-components/.test(text) || /Fluent UI React v9/.test(text)) frameworks.push({ slug: "react", packageName: PKG.reactComponents });
    if (/@fluentui\/web-components/.test(text) || /Fluent UI Web Components/.test(text)) frameworks.push({ slug: "web-components", packageName: PKG.webComponents });
    if (frameworks.length) ev.push(evidence(develop.prov, "frameworks", "f2-html", { location: "/get-started/develop", excerpt: leadSentences(develop.page.sections.find((s) => /tooling/i.test(s.title))?.prose[0] ?? develop.page.metaDescription, 280) }));
  }
  return {
    latestVersion: null,
    latestReleaseAt: null,
    philosophy: parts.length ? clip(parts.join(" "), 1500) : null,
    principles: principles.length ? principles : null,
    frameworks: frameworks.length ? frameworks : null,
    evidence: ev,
  };
}
