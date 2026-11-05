/**
 * Merge Atlassian fragments into a NormalizedBundle. Pure (no I/O). Deterministic ordering.
 */
import type {
  CoverageState,
  EvidenceInput,
  NormalizedBundle,
  NormalizedComponent,
  NormalizedPattern,
  NormalizedSystemFacts,
  NormalizedTokenSet,
} from "@/lib/contracts";
import { excerpt, npmFileUrl } from "@/ingestion/http";
import { canonicalState, classifyComponentName, classifyPatternName, componentTypeBySlug } from "@/lib/taxonomy";
import { slugify } from "@/lib/utils";
import {
  ADS_LICENSE,
  ARIA_ROLES,
  CLASSIFICATION_OVERRIDES,
  DOCS_ORIGIN,
  EXCLUDED_COMPONENT_PATHS,
  METHOD,
  NON_COMPONENT_GROUPS,
  PATTERN_CLASSIFICATION_OVERRIDES,
  RELEASE_PHASE_LIFECYCLE,
  REPRESENTATIVE_PKG,
  STATE_BOOLEAN_PROPS,
  TOKEN_SETS,
  TOKENS_PKG,
  VARIANT_AXIS_PROPS,
  npmPageUrl,
} from "./constants";
import type { AtlFragmentData, SourceStamp } from "./fragments";
import type { NavEntry, ParsedDocsPage, PropRow, Section } from "./html";
import type { LlmsComponentEntry } from "./llms";
import type { NpmManifestInfo } from "./npm";
import { buildPaletteIndex, buildTokens } from "./tokens";
import { cleanText, docsPath, parseStringLiteralUnion, pascalCase, shortText, sortBy, splitSentences, uniq } from "./text";

type Lifecycle = NormalizedComponent["lifecycle"];
type Ev = EvidenceInput;
type Frag<T extends AtlFragmentData["type"]> = Extract<AtlFragmentData, { type: T }>;

/* ------------------------------------------------------------------------------------------ */
/* Selection & slugs (shared with discover)                                                    */
/* ------------------------------------------------------------------------------------------ */

/** Well-known components first so `--limit N` runs exercise representative data. */
const PRIORITY_PATHS = [
  "/components/button",
  "/components/dropdown-menu",
  "/components/modal-dialog",
  "/components/select",
  "/components/tabs",
  "/components/textfield",
  "/components/tooltip",
  "/components/banner",
  "/components/primitives/box",
  "/components/menu",
  "/components/side-navigation",
];

export function isComponentEntry(e: NavEntry): boolean {
  return !NON_COMPONENT_GROUPS.has(e.category ?? "") && !EXCLUDED_COMPONENT_PATHS[e.path] && /^\/components\/[a-z0-9-]+(\/[a-z0-9-]+)?$/.test(e.path);
}

export function selectComponentEntries(entries: NavEntry[], limit?: number): NavEntry[] {
  const eligible = entries.filter(isComponentEntry);
  const rank = (p: string) => {
    const i = PRIORITY_PATHS.indexOf(p);
    return i < 0 ? 999 : i;
  };
  const sorted = [...eligible].sort((a, b) => rank(a.path) - rank(b.path) || a.path.localeCompare(b.path));
  return limit && limit > 0 ? sorted.slice(0, limit) : sorted;
}

/** Stable component slugs from navigation names; collisions fall back to the docs path. */
export function assignSlugs(entries: NavEntry[]): Map<string, string> {
  const out = new Map<string, string>();
  const used = new Set<string>();
  for (const e of sortBy(entries, (x) => x.path)) {
    let slug = slugify(e.name) || slugify(e.path);
    if (used.has(slug)) slug = slugify(e.path.replace(/^\/components\//, ""));
    let n = 2;
    while (used.has(slug)) slug = `${slugify(e.name)}-${n++}`;
    used.add(slug);
    out.set(e.path, slug);
  }
  return out;
}

/** "/components/button/button-group/usage" -> "/components/button/button-group" (known component paths only). */
function componentPathOf(path: string, known: Set<string>): string | null {
  const p = docsPath(path);
  if (known.has(p)) return p;
  const parent = p.replace(/\/[a-z0-9-]+$/, "");
  return known.has(parent) ? parent : null;
}

const normKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/* ------------------------------------------------------------------------------------------ */
/* Evidence helpers                                                                            */
/* ------------------------------------------------------------------------------------------ */

const ev = (
  stamp: SourceStamp,
  field: string,
  method: string,
  opts: { location?: string | null; excerpt?: string | null; state?: Ev["state"]; confidence?: number; title?: string | null; url?: string } = {},
): Ev => ({
  field,
  sourceUrl: opts.url ?? stamp.evidenceUrl,
  sourceTitle: opts.title ?? null,
  retrievedAt: stamp.retrievedAt,
  contentHash: stamp.hash,
  extractionMethod: method,
  location: opts.location ?? null,
  excerpt: excerpt(opts.excerpt ?? null),
  state: opts.state ?? "verified",
  confidence: opts.confidence ?? 0.9,
});

/* ------------------------------------------------------------------------------------------ */
/* normalize                                                                                   */
/* ------------------------------------------------------------------------------------------ */

export interface NormalizeOptions {
  systemSlug: string;
  limit?: number;
  log?: (msg: string) => void;
}

interface PageRef {
  page: ParsedDocsPage;
  stamp: SourceStamp;
}

interface ComponentPages {
  code?: PageRef;
  examples?: PageRef;
  usage?: PageRef;
  overview?: PageRef;
  about?: PageRef;
}

export function normalizeAtlassian(fragments: AtlFragmentData[], opts: NormalizeOptions): NormalizedBundle {
  const log = opts.log ?? (() => {});
  const byType = <T extends AtlFragmentData["type"]>(t: T) => fragments.filter((f): f is Frag<T> => f.type === t);

  const index = byType("index")[0] ?? null;
  const npmByPkg = new Map<string, Frag<"npm">>();
  for (const n of sortBy(byType("npm"), (x) => `${x.packageName}|${x.packument ? 0 : 1}`)) if (n.info && !npmByPkg.has(n.packageName)) npmByPkg.set(n.packageName, n);
  const llms = byType("llms")[0] ?? null;

  /* ---------------------------------- tokens ---------------------------------- */
  const tokenSets = buildTokenSets(byType("tokens"), byType("token-names")[0] ?? null, npmByPkg.get(TOKENS_PKG) ?? null, log);

  /* -------------------------------- components -------------------------------- */
  const components: NormalizedComponent[] = [];
  const entries = index ? selectComponentEntries(index.entries, opts.limit) : [];
  const slugs = assignSlugs(index ? index.entries.filter(isComponentEntry) : []);
  const known = new Set(entries.map((e) => e.path));
  const pagesByPath = new Map<string, ComponentPages>();
  for (const f of byType("component-page")) {
    if (f.page.notFound) continue;
    const e = pagesByPath.get(f.componentPath) ?? {};
    const tab = f.tab as keyof ComponentPages;
    if (["code", "examples", "usage", "overview", "about"].includes(tab) && !e[tab]) e[tab] = { page: f.page, stamp: f.stamp };
    pagesByPath.set(f.componentPath, e);
  }
  const slugByPath = new Map([...known].map((p) => [p, slugs.get(p)!]));
  for (const e of entries) {
    components.push(
      buildComponent({
        entry: e,
        slug: slugs.get(e.path)!,
        pages: pagesByPath.get(e.path) ?? {},
        index: index!,
        npmByPkg,
        llms,
        slugByPath,
      }),
    );
  }
  components.sort((a, b) => a.slug.localeCompare(b.slug));

  /* --------------------------------- patterns --------------------------------- */
  const patterns: NormalizedPattern[] = [];
  const allComponentPaths = new Set(index ? index.entries.filter(isComponentEntry).map((e) => e.path) : []);
  const usedPatternSlugs = new Set<string>();
  for (const f of sortBy(byType("guidance-page"), (x) => x.page.path)) {
    const p = f.page;
    if (p.notFound || !p.title) continue;
    let slug = slugify(p.path.split("/").filter(Boolean).pop() ?? "") || slugify(p.title);
    if (usedPatternSlugs.has(slug)) slug = slugify(p.path);
    if (usedPatternSlugs.has(slug)) continue;
    usedPatternSlugs.add(slug);
    const ov = PATTERN_CLASSIFICATION_OVERRIDES[slug];
    const cls = ov ? (ov.slug ? { slug: ov.slug, method: `adapter-override:${ov.reason}`, confidence: 0.7 } : null) : classifyPatternName(p.title);
    const componentSlugs = uniq(
      p.componentLinks
        .map((l) => componentPathOf(l, allComponentPaths))
        .filter((x): x is string => !!x)
        .map((x) => slugByPath.get(x))
        .filter((x): x is string => !!x),
    ).sort();
    const description = shortText(p.lead ?? p.metaDescription, 280);
    patterns.push({
      slug,
      name: p.title,
      description,
      docsUrl: p.url,
      canonicalType: cls?.slug ?? null,
      classification: cls ? { state: "inferred", method: ov ? cls.method : `taxonomy:${cls.method}`, confidence: cls.confidence } : null,
      componentSlugs,
      coverage: {
        description: description ? "documented" : "not-documented",
        components: componentSlugs.length ? "documented" : p.componentLinks.length ? "not-extracted" : "not-documented",
      },
      evidence: [
        ev(f.stamp, "*", METHOD.guidance, {
          title: p.title,
          location: "#main-content h1 + lead",
          excerpt: description,
        }),
        ...(componentSlugs.length
          ? [ev(f.stamp, "components", METHOD.guidance, { location: "#main-content a[href^='/components/']", excerpt: `Links to component docs: ${componentSlugs.join(", ")}`, confidence: 0.85 })]
          : []),
      ],
    });
    if (opts.limit && patterns.length >= opts.limit) break;
  }
  patterns.sort((a, b) => a.slug.localeCompare(b.slug));

  /* ----------------------------------- facts ----------------------------------- */
  const facts = buildFacts(byType("system-page"), npmByPkg.get(REPRESENTATIVE_PKG) ?? null);

  return { systemSlug: opts.systemSlug, components, tokenSets, patterns, facts };
}

/* ------------------------------------------------------------------------------------------ */
/* Tokens                                                                                      */
/* ------------------------------------------------------------------------------------------ */

function buildTokenSets(frags: Frag<"tokens">[], names: Frag<"token-names"> | null, tokensNpm: Frag<"npm"> | null, log: (m: string) => void): NormalizedTokenSet[] {
  const bySlug = new Map(frags.map((f) => [f.setSlug, f]));
  const palettes = TOKEN_SETS.filter((s) => s.kind === "palette")
    .map((s) => bySlug.get(s.slug)?.tokens)
    .filter((t): t is NonNullable<typeof t> => !!t);
  const { index, collisions } = buildPaletteIndex(palettes);
  for (const c of collisions) log(`palette key collision ${c}; first kept`);
  const cssVars = names?.map ?? {};
  const out: NormalizedTokenSet[] = [];
  for (const spec of TOKEN_SETS) {
    const f = bySlug.get(spec.slug);
    if (!f) continue;
    const { tokens, warnings } = buildTokens(f.tokens, spec, index, cssVars);
    for (const w of warnings) log(w);
    if (spec.kind === "theme") {
      // Cross-check: Atlassian's built value must equal the referenced palette value for whole-value aliases.
      const palByName = new Map(palettes.flat().map((t) => [t.name, t.value]));
      let mismatch = 0;
      for (const raw of f.tokens) {
        const ov = raw.original;
        const target = typeof ov === "string" ? index.get(ov) : undefined;
        if (target && String(palByName.get(target)).toLowerCase() !== String(raw.value).toLowerCase()) mismatch++;
      }
      if (mismatch) log(`${spec.slug}: ${mismatch} tokens whose built value differs from the referenced palette value`);
    }
    const withVar = tokens.filter((t) => t.cssVar).length;
    const evidence: Ev[] = [
      ev(f.stamp, "tokens", METHOD.tokensRaw, {
        title: `${f.npm.packageName}@${f.npm.version}/${f.file}`,
        location: f.file,
        excerpt: `${tokens.length} tokens from ${f.npm.packageName}@${f.npm.version}/${f.file}${spec.theme ? ` (theme: ${spec.theme})` : ""}; palette keys in authored values expressed as {references}`,
        confidence: 0.95,
      }),
    ];
    if (names && withVar)
      evidence.push(
        ev(names.stamp, "tokens.cssVar", METHOD.tokenNames, {
          title: `${names.npm.packageName}@${names.npm.version}/${names.file}`,
          location: names.file,
          excerpt: `${withVar}/${tokens.length} tokens mapped to CSS custom properties (--ds-*)`,
          confidence: 0.95,
        }),
      );
    if (tokensNpm?.info)
      evidence.push(
        ev(tokensNpm.stamp, "packageVersion", METHOD.npm, {
          url: npmPageUrl(TOKENS_PKG, tokensNpm.info.version),
          location: "dist-tags.latest",
          excerpt: `${TOKENS_PKG} latest ${tokensNpm.info.version}; npm license field ${tokensNpm.info.license ?? "n/a"} (ADS License Agreement applies)`,
          confidence: 0.95,
        }),
      );
    out.push({
      slug: spec.slug,
      name: spec.name,
      theme: spec.theme,
      format: "js-module",
      sourceUrl: npmFileUrl(f.npm.packageName, f.npm.version, f.file),
      packageName: f.npm.packageName,
      packageVersion: f.npm.version,
      license: ADS_LICENSE,
      redistribution: "restricted",
      tokens,
      evidence,
    });
  }
  return out;
}

/* ------------------------------------------------------------------------------------------ */
/* Component builder                                                                           */
/* ------------------------------------------------------------------------------------------ */

interface BuildArgs {
  entry: NavEntry;
  slug: string;
  pages: ComponentPages;
  index: Frag<"index">;
  npmByPkg: Map<string, Frag<"npm">>;
  llms: Frag<"llms"> | null;
  slugByPath: Map<string, string>;
}

const tabUrl = (pages: ComponentPages, tab: keyof ComponentPages) => pages[tab]?.page.url ?? null;
const hasTab = (pages: ComponentPages, tab: string) => Object.values(pages).some((p) => (p as PageRef | undefined)?.page.tabs.some((t) => t.path.endsWith(`/${tab}`)));

function findSection(p: PageRef | undefined, re: RegExp, level?: number): Section | null {
  return p?.page.sections.find((s) => re.test(s.heading) && (level === undefined || s.level === level)) ?? null;
}

/** h3 (or deeper) headings directly under the h2 section matching `re` on the examples page. */
function childHeadings(p: PageRef | undefined, re: RegExp): { text: string; id: string | null }[] {
  if (!p) return [];
  const hs = p.page.headings;
  const i = hs.findIndex((h) => re.test(h.text) && h.level <= 2);
  if (i < 0) return [];
  const lvl = hs[i]!.level;
  const out: { text: string; id: string | null }[] = [];
  for (let j = i + 1; j < hs.length && hs[j]!.level > lvl; j++) if (hs[j]!.level === lvl + 1) out.push({ text: hs[j]!.text, id: hs[j]!.id });
  return out;
}

const KEY_PATTERNS: [RegExp, string][] = [
  [/\bshift\s*\+\s*tab\b|\bshift[- ]tab\b/i, "Shift+Tab"],
  [/\b(?:left and right|right and left|left or right) arrow keys?\b/i, "ArrowLeft / ArrowRight"],
  [/\b(?:up and down|down and up|up or down) arrow keys?\b/i, "ArrowUp / ArrowDown"],
  [/\b(?:left|right) arrow(?: key)?\b/i, "ArrowLeft / ArrowRight"],
  [/\b(?:up|down) arrow(?: key)?\b/i, "ArrowUp / ArrowDown"],
  [/\barrow keys?\b/i, "Arrow keys"],
  [/\btab key\b|\bpress(?:ing|es)? (?:the )?tab\b|\b(?:use|using) (?:the )?tab\b|\btab(?:bing)? (?:to|through|into|out of)\b/i, "Tab"],
  [/\benter key\b|\bpress(?:ing|es)? enter\b|\benter or space\b|\bspace or enter\b|\benter\/space\b/i, "Enter"],
  [/\bspace ?bar\b|\bspace key\b|\bpress(?:ing|es)? space\b|\benter or space\b|\bspace or enter\b/i, "Space"],
  [/\b(?:esc|escape) key\b|\bpress(?:ing|es)? (?:esc|escape)\b|\bESC\b|\bEscape\b/, "Escape"],
  [/\bhome (?:and end )?keys?\b|\bhome and end\b/i, "Home / End"],
  [/\bpage up\b|\bpage down\b/i, "PageUp / PageDown"],
];

/** Keyboard behavior sentences (documented prose) with the keys they name. */
export function extractKeyboard(textBlock: string): { keys: string; action: string }[] {
  const out: { keys: string; action: string }[] = [];
  const seen = new Set<string>();
  for (const sentence of sentencesOf(textBlock)) {
    if (!/\bkey(?:s|board)?\b|\bpress|\barrow\b|\btab(?:bing)?\b|\bescape\b|\besc\b/i.test(sentence)) continue;
    const keys: string[] = [];
    for (const [re, k] of KEY_PATTERNS) if (re.test(sentence) && !keys.includes(k)) keys.push(k);
    // "Arrow keys" is redundant when a specific arrow pair was found.
    const specific = keys.filter((k) => !(k === "Arrow keys" && keys.some((x) => x.startsWith("Arrow") && x !== "Arrow keys")));
    if (!specific.length) continue;
    const action = shortText(sentence, 280)!;
    const key = `${specific.join(", ")}|${action}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ keys: specific.join(", "), action });
  }
  return out.slice(0, 12);
}

export function extractRoles(textBlock: string): string[] {
  const roles = new Set<string>();
  for (const m of textBlock.matchAll(/\brole\s*=\s*["“']?([a-z]+)/gi)) if (ARIA_ROLES.has(m[1]!.toLowerCase())) roles.add(m[1]!.toLowerCase());
  for (const m of textBlock.matchAll(/\b(?:an?|the)\s+["“']?([a-z]+)["”']?\s+role\b/gi)) if (ARIA_ROLES.has(m[1]!.toLowerCase())) roles.add(m[1]!.toLowerCase());
  return [...roles].sort();
}

/** Complete sentences only (a bounded section may end in a truncated "…" sentence). */
const sentencesOf = (textBlock: string) => splitSentences(cleanText(textBlock)).filter((x) => !x.endsWith("…"));

function sentencesMatching(textBlock: string, re: RegExp, max: number): string | null {
  const s = sentencesOf(textBlock).filter((x) => re.test(x));
  return s.length ? shortText(s.join(" "), max) : null;
}

function implementationFor(groupsCount: number, group: string | null, name: string): string {
  if (groupsCount <= 1) return "react";
  return `react:${pascalCase(group ?? name) || "Main"}`;
}

/** The props group documenting the page's main export: unlabeled, or labeled like the component. */
function primaryGroup(props: PropRow[], name: string): string | null | undefined {
  const groups = uniq(props.map((p) => p.group));
  if (!groups.length) return undefined;
  if (groups.includes(null)) return null;
  const want = normKey(name);
  return groups.find((g) => g && normKey(g) === want) ?? groups[0];
}

function lifecycleFrom(phase: string | null | undefined): Lifecycle | null {
  if (!phase) return null;
  return RELEASE_PHASE_LIFECYCLE[phase.toLowerCase().trim()] ?? null;
}

function buildComponent(a: BuildArgs): NormalizedComponent {
  const { entry, slug, pages } = a;
  const evidence: Ev[] = [];
  const coverage: Record<string, CoverageState> = {};
  const code = pages.code;
  const examples = pages.examples;
  const usage = pages.usage;
  const anyPage = code ?? examples ?? usage ?? pages.overview ?? pages.about;
  const docsUrl = `${DOCS_ORIGIN}${entry.path}`;
  const name = anyPage?.page.title ?? entry.name;
  const pkg = code?.page.code?.packageName ?? null;
  const npm = pkg ? (a.npmByPkg.get(pkg) ?? null) : null;

  // Whole-record evidence: navigation listing (+ the main fetched page)
  evidence.push(
    ev(a.index.stamp, "*", METHOD.nav, {
      title: "atlassian.design components navigation",
      location: `nav [role=group] "${entry.category ?? ""}" > a[href="${entry.path}"]`,
      excerpt: `${entry.name} (${entry.category ?? "uncategorized"})${entry.badge ? ` [${entry.badge}]` : ""}`,
      confidence: 0.95,
    }),
  );

  // Description (page lead)
  const descPage = [code, examples, usage, pages.overview, pages.about].find((p) => p?.page.lead);
  const description = shortText(descPage?.page.lead ?? null, 280);
  coverage.description = description ? "documented" : anyPage ? "not-documented" : "not-extracted";
  if (descPage && description) evidence.push(ev(descPage.stamp, "description", METHOD.docsHtml, { title: name, location: "#main-content h1 + span", excerpt: description }));

  // Lifecycle: page status notes > nav lozenge/group > npm website status > llms status
  let lifecycle: Lifecycle = "unknown";
  const notes = [code, examples, usage, pages.overview, pages.about].filter((p): p is PageRef => !!p).flatMap((p) => p.page.statusNotes.map((n) => ({ n, p })));
  const phaseNote = notes.find(({ n }) => lifecycleFrom(n.heading));
  const llmsEntry: LlmsComponentEntry | null = pkg && a.llms ? (a.llms.entries.find((x) => x.packageName === pkg && normKey(x.exportName) === normKey(name)) ?? null) : null;
  // Package-level status: every export of the package listed with the same status (main docs page of the package only).
  const pkgEntries = pkg && a.llms && !llmsEntry && entry.path === `/components/${pkg.replace(/^@atlaskit\//, "")}` ? a.llms.entries.filter((x) => x.packageName === pkg) : [];
  const pkgStatus = pkgEntries.length && pkgEntries.every((x) => x.status && x.status === pkgEntries[0]!.status) ? pkgEntries[0]!.status : null;
  const subPage = npm?.info?.website?.subPages.find((sp) => normKey(sp.title) === normKey(name) || sp.id === entry.path.split("/").pop());
  if (phaseNote) {
    lifecycle = lifecycleFrom(phaseNote.n.heading)!;
    evidence.push(ev(phaseNote.p.stamp, "lifecycle", METHOD.docsHtml, { location: "#main-content section (status message)", excerpt: `${phaseNote.n.heading}: ${phaseNote.n.text}`, confidence: 0.95 }));
  } else if (lifecycleFrom(entry.badge) || entry.category === "Deprecated") {
    lifecycle = lifecycleFrom(entry.badge) ?? "deprecated";
    evidence.push(ev(a.index.stamp, "lifecycle", METHOD.nav, { location: `nav item ${entry.path}`, excerpt: entry.badge ? `Navigation lozenge: ${entry.badge}` : "Listed under the Deprecated navigation group", confidence: 0.9 }));
  } else if (npm?.info?.deprecated) {
    lifecycle = "deprecated";
    evidence.push(ev(npm.stamp, "lifecycle", METHOD.npm, { url: npmPageUrl(npm.packageName, npm.info.version), location: "deprecated", excerpt: npm.info.deprecated, confidence: 0.9 }));
  } else if (lifecycleFrom(subPage?.status ?? null)) {
    lifecycle = lifecycleFrom(subPage!.status)!;
    evidence.push(ev(npm!.stamp, "lifecycle", METHOD.npm, { url: npmPageUrl(npm!.packageName, npm!.info!.version), location: "atlassian.website.subPages[].status", excerpt: `${subPage!.title}: ${subPage!.status}${subPage!.statusDescription ? ` (${subPage!.statusDescription})` : ""}`, confidence: 0.85 }));
  } else if (lifecycleFrom(llmsEntry?.status ?? null)) {
    lifecycle = lifecycleFrom(llmsEntry!.status)!;
    evidence.push(ev(a.llms!.stamp, "lifecycle", METHOD.llms, { location: `line ${llmsEntry!.line}`, excerpt: `${llmsEntry!.packageName} ${llmsEntry!.exportName}: Status ${llmsEntry!.status}`, confidence: 0.85 }));
  } else if (lifecycleFrom(pkgStatus)) {
    lifecycle = lifecycleFrom(pkgStatus)!;
    evidence.push(ev(a.llms!.stamp, "lifecycle", METHOD.llms, { location: `lines ${pkgEntries.map((x) => x.line).join(", ")}`, excerpt: `${pkg}: all ${pkgEntries.length} exports (${pkgEntries.map((x) => x.exportName).join(", ")}) have Status ${pkgStatus}`, confidence: 0.8 }));
  }

  // Classification (inferred from the name; overrides where the taxonomy match is wrong/missing)
  const override = CLASSIFICATION_OVERRIDES[name] ?? CLASSIFICATION_OVERRIDES[entry.name];
  const cls = override ? (override.slug ? { slug: override.slug, method: `adapter-override:${override.reason}`, confidence: 0.7 } : null) : classifyComponentName(name.replace(/\s*\((legacy|spotlight)\)\s*$/i, ""));
  let classification: NormalizedComponent["classification"] = cls ? { state: "inferred", method: override ? cls.method : `taxonomy:${cls.method}`, confidence: cls.confidence } : null;

  // Frameworks (React package documented on the code tab; npm peerDependencies confirm React)
  const frameworks: NormalizedComponent["frameworks"] = [];
  if (pkg && (!npm?.info || npm.info.peerDependencies.includes("react"))) {
    frameworks.push({ slug: "react", packageName: pkg, importName: null, sourceUrl: npmPageUrl(pkg) });
    evidence.push(ev(code!.stamp, "frameworks", METHOD.docsHtml, { location: "#installation table (npm)", excerpt: code!.page.code?.installCommand ?? `npm ${pkg}`, confidence: 0.9 }));
    if (npm?.info) evidence.push(ev(npm.stamp, "frameworks", METHOD.npm, { url: npmPageUrl(pkg, npm.info.version), location: "peerDependencies", excerpt: `${pkg}@${npm.info.version} peerDependencies: ${npm.info.peerDependencies.join(", ")}`, confidence: 0.95 }));
  }
  coverage.frameworks = frameworks.length ? "documented" : code ? "not-documented" : "not-extracted";

  // Properties (generated props tables on the code tab)
  const codeTab = code?.page.code ?? null;
  const props = codeTab?.props ?? [];
  const groupsCount = uniq(props.map((p) => p.group)).length;
  const codeUrl = tabUrl(pages, "code");
  const properties: NormalizedComponent["properties"] = [];
  const propSeen = new Set<string>();
  for (const p of props) {
    const impl = implementationFor(groupsCount, p.group, name);
    const k = `${impl}|${p.name}`;
    if (propSeen.has(k)) continue;
    propSeen.add(k);
    properties.push({
      implementation: impl,
      name: p.name,
      type: p.type ? p.type.slice(0, 500) : null,
      defaultValue: p.defaultValue,
      required: p.required,
      deprecated: p.deprecated,
      description: shortText(p.description, 400),
      allowedValues: parseStringLiteralUnion(p.type),
      sourceUrl: codeUrl ? `${codeUrl}${p.anchor ? `#${p.anchor}` : ""}` : null,
    });
    if (properties.length >= 200) break;
  }
  coverage.properties = properties.length ? "documented" : code ? "not-documented" : hasTab(pages, "code") ? "not-extracted" : "not-documented";
  if (properties.length && code)
    evidence.push(
      ev(code.stamp, "properties", METHOD.props, {
        title: `${name} code`,
        location: `[data-testid=tsmorph-props--container] (${codeTab!.groups.map((g) => `${g.label ?? "main"}: ${g.count}`).join("; ")})`,
        excerpt: `${properties.length} props documented${pkg ? ` for ${pkg}` : ""}`,
        confidence: 0.95,
      }),
    );

  // Variants: string-literal unions of variant-like props on the main export; else examples "Appearance" headings
  const primary = primaryGroup(props, name);
  const mainProps = primary === undefined ? [] : props.filter((p) => p.group === primary);
  const variants: NormalizedComponent["variants"] = [];
  const variantSeen = new Set<string>();
  const addVariant = (axis: string, vname: string, sourceUrl: string | null, location: string) => {
    const k = `${axis}|${slugify(vname)}`;
    if (!slugify(vname) || variantSeen.has(k)) return;
    variantSeen.add(k);
    variants.push({ axis, name: vname, description: null, sourceUrl, location });
  };
  for (const p of mainProps) {
    const axis = VARIANT_AXIS_PROPS[p.name];
    if (!axis || p.deprecated) continue;
    for (const v of parseStringLiteralUnion(p.type) ?? []) addVariant(axis, v, codeUrl ? `${codeUrl}${p.anchor ? `#${p.anchor}` : ""}` : null, `props table: ${p.name}`);
  }
  let variantSource: "props" | "examples" | null = variants.length ? "props" : null;
  if (!variants.length && examples) {
    for (const h of childHeadings(examples, /^(appearances?|variants?|types?|styles?)$/i)) addVariant("appearance", h.text, `${examples.page.url}${h.id ? `#${h.id}` : ""}`, `examples h3 under "Appearance"`);
    if (variants.length) variantSource = "examples";
  }
  coverage.variants = variants.length ? "documented" : code || examples ? "not-documented" : "not-extracted";
  if (variantSource === "props" && code) evidence.push(ev(code.stamp, "variants", METHOD.props, { location: "props tables: variant-like props", excerpt: variants.map((v) => `${v.axis}=${v.name}`).join(", "), confidence: 0.95 }));
  if (variantSource === "examples" && examples) evidence.push(ev(examples.stamp, "variants", METHOD.examples, { location: "examples headings", excerpt: variants.map((v) => v.name).join(", "), confidence: 0.8 }));

  // Sizes: `size` union on the main export; else examples "Sizes" headings
  let sizes: string[] = [];
  const sizeProp = mainProps.find((p) => p.name === "size" && !p.deprecated && parseStringLiteralUnion(p.type));
  if (sizeProp) {
    sizes = parseStringLiteralUnion(sizeProp.type)!;
    evidence.push(ev(code!.stamp, "sizes", METHOD.props, { location: `props table: size`, excerpt: `size: ${sizeProp.type}`, confidence: 0.95 }));
  } else if (examples) {
    const hs = childHeadings(examples, /^sizes?$/i);
    if (hs.length) {
      sizes = uniq(hs.map((h) => h.text));
      evidence.push(ev(examples.stamp, "sizes", METHOD.examples, { location: `examples h3 under "Size"`, excerpt: sizes.join(", "), confidence: 0.8 }));
    }
  }
  coverage.sizes = sizes.length ? "documented" : code || examples ? "not-documented" : "not-extracted";

  // States: examples "States" headings and usage "Behavior" items (documented), boolean props (inferred)
  const states: NormalizedComponent["states"] = [];
  const stateSeen = new Set<string>();
  const addState = (sname: string, description: string | null, sourceUrl: string | null) => {
    const k = slugify(sname);
    if (!k || stateSeen.has(k)) return false;
    stateSeen.add(k);
    states.push({ name: sname, canonical: canonicalState(sname) ?? (/^press(ed)?$/i.test(sname) ? "active" : null), description, sourceUrl });
    return true;
  };
  let documentedStates = 0;
  if (examples) {
    const hs = childHeadings(examples, /^states?$/i);
    for (const h of hs) if (addState(h.text, null, `${examples.page.url}${h.id ? `#${h.id}` : ""}`)) documentedStates++;
    if (hs.length) evidence.push(ev(examples.stamp, "states", METHOD.examples, { location: `examples h3 under "States"`, excerpt: hs.map((h) => h.text).join(", "), confidence: 0.85 }));
  }
  const behavior = findSection(usage, /^(behaviou?r|states|interaction states)$/i);
  if (behavior && behavior.items.length && usage) {
    const items = behavior.items.filter((i) => canonicalState(i.term) || /^press(ed)?$/i.test(i.term));
    for (const i of items) if (addState(i.term, shortText(i.text, 200), `${usage.page.url}${behavior.id ? `#${behavior.id}` : ""}`)) documentedStates++;
    if (items.length) evidence.push(ev(usage.stamp, "states", METHOD.usage, { location: `#${behavior.id ?? "behavior"} list`, excerpt: items.map((i) => `${i.term}: ${i.text}`).join(" "), confidence: 0.85 }));
  }
  const boolStates: string[] = [];
  for (const p of mainProps) {
    const canon = STATE_BOOLEAN_PROPS[p.name.toLowerCase()];
    if (!canon || p.deprecated || !/\bboolean\b/.test(p.type ?? "")) continue;
    if (states.some((s) => s.canonical === canon)) continue;
    if (addState(p.name, `Documented \`${p.name}\` prop (boolean).`, codeUrl ? `${codeUrl}${p.anchor ? `#${p.anchor}` : ""}` : null)) {
      states[states.length - 1]!.canonical = canon;
      boolStates.push(p.name);
    }
  }
  if (boolStates.length && code) evidence.push(ev(code.stamp, "states", METHOD.props, { location: "props table: boolean state props", excerpt: boolStates.join(", "), state: "inferred", confidence: 0.75 }));
  coverage.states = documentedStates ? "documented" : states.length ? "inferred" : code || examples || usage ? "not-documented" : "not-extracted";

  // Accessibility (usage "Accessibility" section; examples "Accessibility" section as fallback)
  const a11yUsage = findSection(usage, /^accessibility\b/i);
  const a11yExamples = findSection(examples, /^accessibility\b/i);
  const a11yRef = a11yUsage ? { s: a11yUsage, p: usage! } : a11yExamples ? { s: a11yExamples, p: examples! } : null;
  const kbSections = [a11yUsage, a11yExamples, ...(usage?.page.sections ?? []).filter((s) => /keyboard/i.test(s.heading))].filter((s): s is Section => !!s);
  const a11yText = uniq(kbSections.map((s) => s.fullText)).join(" ");
  let accessibility: NormalizedComponent["accessibility"] = null;
  if (a11yRef) {
    const keyboard = extractKeyboard(a11yText);
    const roles = extractRoles(a11yText);
    const apg = uniq(kbSections.flatMap((s) => s.links).map((l) => /w3\.org\/WAI\/ARIA\/apg\/patterns\/([a-z-]+)/.exec(l)?.[1] ?? "").filter(Boolean));
    const screenReader = sentencesMatching(a11yText, /screen ?readers?|assistive tech/i, 600);
    const focusManagement = sentencesMatching(a11yText, /\bfocus/i, 600);
    const wcag = uniq([...a11yText.matchAll(/\b([1-4]\.\d{1,2}\.\d{1,2})\b/g)].map((m) => m[1]!)).sort();
    const guidance = shortText(a11yRef.s.fullText || a11yRef.s.text, 1000);
    const has = (v: unknown) => (Array.isArray(v) ? v.length > 0 : !!v);
    accessibility = {
      ariaPattern: apg[0] ?? null,
      roles: roles.length ? roles : null,
      keyboard: keyboard.length ? keyboard : null,
      guidance,
      screenReader,
      focusManagement,
      wcagCriteria: wcag.length ? wcag : null,
      docsUrl: `${a11yRef.p.page.url}${a11yRef.s.id ? `#${a11yRef.s.id}` : ""}`,
      coverage: {
        guidance: guidance ? "documented" : "not-documented",
        keyboard: keyboard.length ? "documented" : /keyboard|\bkeys?\b/i.test(a11yText) ? "not-extracted" : "not-documented",
        roles: has(roles) ? "documented" : "not-documented",
        screenReader: screenReader ? "documented" : "not-documented",
        focusManagement: focusManagement ? "documented" : "not-documented",
        wcagCriteria: wcag.length ? "documented" : "not-documented",
        ariaPattern: apg.length ? "documented" : "not-documented",
      },
    };
    coverage.accessibility = "documented";
    coverage.keyboard = accessibility.coverage.keyboard!;
    evidence.push(ev(a11yRef.p.stamp, "accessibility", a11yRef.p === usage ? METHOD.usage : METHOD.examples, { title: `${name} - Accessibility`, location: `#${a11yRef.s.id ?? "accessibility"}`, excerpt: guidance, confidence: 0.9 }));
    if (keyboard.length) evidence.push(ev(a11yRef.p.stamp, "keyboard", a11yRef.p === usage ? METHOD.usage : METHOD.examples, { location: `#${a11yRef.s.id ?? "accessibility"} (sentences naming keys)`, excerpt: keyboard.map((k) => `${k.keys}: ${k.action}`).join(" | "), confidence: 0.75 }));
    // Verified classification only when the docs link the matching WAI-ARIA APG pattern.
    if (cls && classification) {
      const def = componentTypeBySlug.get(cls.slug);
      if (def?.ariaPattern && apg.includes(def.ariaPattern)) classification = { state: "verified", method: `${classification.method}+apg-link:${def.ariaPattern}`, confidence: 0.95 };
    }
  } else {
    const usageExpected = hasTab(pages, "usage");
    coverage.accessibility = usage || !usageExpected ? "not-documented" : "not-extracted";
    coverage.keyboard = coverage.accessibility;
  }

  // Responsive guidance
  const respSection = [usage, examples].flatMap((p) => (p ? p.page.sections.map((s) => ({ s, p })) : [])).find(({ s }) => /responsive|breakpoint|screen sizes?|mobile|small screens/i.test(s.heading));
  const responsiveGuidance = respSection ? shortText(respSection.s.fullText || respSection.s.text, 800) : null;
  coverage.responsive = responsiveGuidance ? "documented" : usage || examples ? "not-documented" : "not-extracted";
  if (respSection && responsiveGuidance) evidence.push(ev(respSection.p.stamp, "responsiveGuidance", METHOD.docsHtml, { location: `#${respSection.s.id ?? ""} (${respSection.s.heading})`, excerpt: responsiveGuidance, confidence: 0.8 }));

  // Examples: documentation links to example sections (no code is stored: ADS license forbids redistribution)
  const exampleList: NormalizedComponent["examples"] = [];
  if (examples) {
    const exSeen = new Set<string>();
    for (const h of examples.page.headings) {
      if (h.level < 2 || h.level > 3 || !h.id || /^accessibility$/i.test(h.text)) continue;
      const s = `docs-${slugify(h.id)}`;
      if (!slugify(h.id) || exSeen.has(s)) continue;
      exSeen.add(s);
      exampleList.push({ slug: s, title: h.text, kind: "docs-link", url: `${examples.page.url}#${h.id}`, attribution: "Atlassian Design System documentation (atlassian.design)" });
      if (exampleList.length >= 25) break;
    }
    if (exampleList.length) evidence.push(ev(examples.stamp, "examples", METHOD.examples, { location: "examples tab headings", excerpt: exampleList.map((e) => e.title).join(", "), confidence: 0.9 }));
  }
  coverage.examples = exampleList.length ? "documented" : examples || !hasTab(pages, "examples") ? "not-documented" : "not-extracted";

  // Relationships: usage "Related" links (related) and status-note alternatives (replaced-by)
  const rel: NormalizedComponent["relationships"] = [];
  const related = findSection(usage, /^related$/i);
  const relTargets: string[] = [];
  for (const l of related?.links ?? []) {
    const p = componentPathOf(l, new Set(a.slugByPath.keys()));
    const target = p ? a.slugByPath.get(p) : undefined;
    if (target && target !== slug) {
      rel.push({ kind: "related", targetSlug: target, targetType: null });
      relTargets.push(target);
    }
  }
  if (relTargets.length && usage) evidence.push(ev(usage.stamp, "relationships", METHOD.usage, { location: `#${related!.id ?? "related"}`, excerpt: `Related: ${uniq(relTargets).join(", ")}`, confidence: 0.85 }));
  const altTargets: string[] = [];
  const deprecatingNote = notes.find(({ n }) => lifecycleFrom(n.heading) === "deprecated");
  for (const l of deprecatingNote?.n.links ?? []) {
    const p = componentPathOf(l, new Set(a.slugByPath.keys()));
    const target = p ? a.slugByPath.get(p) : undefined;
    if (target && target !== slug) {
      rel.push({ kind: "replaced-by", targetSlug: target, targetType: null });
      altTargets.push(target);
    }
  }
  if (altTargets.length && deprecatingNote) evidence.push(ev(deprecatingNote.p.stamp, "relationships", METHOD.docsHtml, { location: "#main-content section (status message) links", excerpt: `${deprecatingNote.n.heading}: ${deprecatingNote.n.text}`, confidence: 0.85 }));
  const relSeen = new Set<string>();
  const relationships = rel
    .filter((r) => {
      const k = `${r.kind}|${r.targetSlug}`;
      if (relSeen.has(k)) return false;
      relSeen.add(k);
      return true;
    })
    .sort((x, y) => x.kind.localeCompare(y.kind) || (x.targetSlug ?? "").localeCompare(y.targetSlug ?? ""));
  coverage.relationships = relationships.length ? "documented" : usage ? "not-documented" : "not-extracted";

  // Token usage is not extracted (components' compiled styles are not parsed).
  coverage.tokens = "not-extracted";

  // Aliases: the export name from the generated llms index when it differs from the docs name
  const aliases = llmsEntry && llmsEntry.exportName !== name && normKey(llmsEntry.exportName) === normKey(name) ? [llmsEntry.exportName] : [];

  if (code?.page.code?.sourceUrl) evidence.push(ev(code.stamp, "sourceCodeUrl", METHOD.docsHtml, { location: "#installation table (Source)", excerpt: code.page.code.sourceUrl, confidence: 0.95 }));

  return {
    slug,
    name,
    aliases,
    description,
    docsUrl,
    sourceCodeUrl: code?.page.code?.sourceUrl ?? null,
    lifecycle,
    canonicalType: cls?.slug ?? null,
    classification,
    frameworks,
    variants,
    states,
    sizes: sizes.length ? sizes : null,
    properties,
    accessibility,
    examples: exampleList,
    relationships,
    tokenUsages: [],
    responsiveGuidance,
    coverage,
    evidence,
  };
}

/* ------------------------------------------------------------------------------------------ */
/* System facts                                                                                */
/* ------------------------------------------------------------------------------------------ */

function buildFacts(sys: Frag<"system-page">[], rep: Frag<"npm"> | null): NormalizedSystemFacts | null {
  const evidence: Ev[] = [];
  const about = sys.find((s) => s.key === "about" && !s.page.notFound) ?? null;
  const info: NpmManifestInfo | null = rep?.info ?? null;
  if (info && rep) {
    evidence.push(
      ev(rep.stamp, "latestVersion", METHOD.npm, {
        url: npmPageUrl(info.name, info.version),
        title: `${info.name} on npm`,
        location: "dist-tags.latest",
        excerpt: `${info.name} latest ${info.version}${info.publishedAt ? ` published ${info.publishedAt}` : ""} (representative package; ADS has no single system version)`,
        confidence: 0.9,
      }),
    );
    if (info.publishedAt) evidence.push(ev(rep.stamp, "latestReleaseAt", METHOD.npm, { url: npmPageUrl(info.name, info.version), location: `time["${info.version}"]`, excerpt: info.publishedAt, confidence: 0.9 }));
  }

  // Principles: h3 headings under "Our principles" on the About page
  let principles: { name: string; sourceUrl: string }[] = [];
  let philosophy: string | null = null;
  if (about) {
    const hs = about.page.headings;
    const i = hs.findIndex((h) => /^our principles$/i.test(h.text));
    if (i >= 0) {
      for (let j = i + 1; j < hs.length && hs[j]!.level > hs[i]!.level; j++) {
        if (hs[j]!.level !== hs[i]!.level + 1) continue;
        const n = hs[j]!.text.replace(/^\d+\.\s*/, "").trim();
        if (n) principles.push({ name: n, sourceUrl: `${about.page.url}${hs[j]!.id ? `#${hs[j]!.id}` : ""}` });
      }
    }
    principles = principles.slice(0, 12);
    if (principles.length) evidence.push(ev(about.stamp, "principles", METHOD.docsHtml, { title: about.page.title, location: "#our-principles h3", excerpt: principles.map((p) => p.name).join("; ") }));

    const parts = about.page.sections.find((s) => /^the parts of the design system$/i.test(s.heading));
    const values = about.page.sections.find((s) => /^our values$/i.test(s.heading));
    const valueNames = (values?.items ?? []).map((v) => v.term).filter(Boolean);
    const collection = parts ? splitSentences(parts.text)[0] ?? null : null;
    const bits: string[] = [];
    if (collection && /collection of/i.test(collection)) bits.push(`Atlassian describes its design system as ${collection.replace(/^The Atlassian Design System is\s+/i, "").replace(/\.$/, "")}.`);
    if (valueNames.length) bits.push(`Its stated values are ${valueNames.join("; ")}.`);
    if (principles.length) bits.push(`Its principles: ${principles.map((p) => p.name).join("; ")}.`);
    if (bits.length) {
      philosophy = bits.join(" ");
      evidence.push(
        ev(about.stamp, "philosophy", METHOD.docsHtml, {
          title: about.page.title,
          location: "#the-parts-of-the-design-system, #our-values, #our-principles",
          excerpt: [collection, valueNames.length ? `Values: ${valueNames.join("; ")}` : null].filter(Boolean).join(" "),
          confidence: 0.85,
        }),
      );
    }
  }

  const frameworks: NonNullable<NormalizedSystemFacts["frameworks"]> = [];
  if (info?.peerDependencies.includes("react") && rep) {
    frameworks.push({ slug: "react", packageName: info.name });
    evidence.push(ev(rep.stamp, "frameworks", METHOD.npm, { url: npmPageUrl(info.name, info.version), location: "peerDependencies", excerpt: `${info.name}@${info.version} peerDependencies: ${info.peerDependencies.join(", ")}`, confidence: 0.9 }));
  }

  if (!info && !about) return null;
  return {
    latestVersion: info?.version ?? null,
    latestReleaseAt: info?.publishedAt ?? null,
    philosophy,
    principles: principles.length ? principles : null,
    frameworks: frameworks.length ? frameworks : null,
    evidence,
  };
}
