/**
 * Normalize Material UI ("mui") and Joy UI ("joy-ui") fragments into a NormalizedBundle. Pure.
 *
 * One ATLAS component per generated API page (docs/pages/<product>/api/<slug>.json): these are the
 * exported React components MUI documents individually (Button, IconButton, ButtonBase, ...).
 * Usage docs pages (react-*.md) are attached through the API "demos" list and the markdown
 * front matter "components" list; a page's description and accessibility section are attributed
 * only to the page's primary component(s) (name matches the page title), never to every component
 * the page mentions.
 */
import type { CoverageState, EvidenceInput, NormalizedBundle, NormalizedComponent, NormalizedSystemFacts, NormalizedTokenSet } from "@/lib/contracts";
import { canonicalState, classifyComponentName, componentTypeBySlug } from "@/lib/taxonomy";
import { slugify } from "@/lib/utils";
import { mdInlineToText, splitComponentDescription, type ApiDoc, type ApiTranslations } from "./api-json";
import { CORE_PROFILES, CORE_REPO, MUI_OWNER, PARSERS, classifyFor, mitLicense, prioritize, type CoreProfile } from "./constants";
import { byKind, type FragOf, type MuiFragment, type NpmPin } from "./fragments";
import { apgSlugs, plainBlocks, rolesIn, type MuiA11y } from "./markdown";
import { clip, evidence, firstSentence, isPrerelease, literalUnion, normKey, sortBy, uniq } from "./shared";
import { buildJoyTokenSets, buildMuiTokenSets } from "./tokens";

type Lifecycle = NormalizedComponent["lifecycle"];
type MdFrag = FragOf<"md">;

export const githubBlob = (tag: string, file: string) => `https://github.com/${MUI_OWNER}/${CORE_REPO}/blob/${tag}/${file.replace(/^\//, "")}`;

export const pageUrlFor = (p: CoreProfile, pathname: string) => `${p.docsOrigin}${pathname.replace(/\/$/, "")}/`;
export const apiUrlFor = (p: CoreProfile, slug: string) => `${p.docsOrigin}/${p.product}/api/${slug}/`;

/** APG patterns ATLAS treats as the same as a taxonomy ariaPattern. */
const APG_EQUIV: Record<string, string> = { "slider-multithumb": "slider" };

/** Global MUI state class keys -> ATLAS canonical states (when canonicalState() does not know them). */
const STATE_KEY_CANON: Record<string, string> = { focusVisible: "focus", focused: "focus", readOnly: "readonly", checked: "selected" };

/** Boolean props treated as (inferred) states when no state class documents them. */
const STATE_PROPS = ["disabled", "loading", "checked", "selected", "indeterminate", "readOnly", "error", "expanded", "open", "required"];

const singular = (s: string) => s.replace(/ies$/i, "y").replace(/(?<!s)s$/i, "");

/**
 * Primary components of a docs page, in priority order: exact title match; singular/plural title
 * match; components whose name ends with the title (e.g. "Progress" -> CircularProgress,
 * LinearProgress); finally the githubSource folder named in front matter.
 */
export function primaryComponents(page: { h1: string | null; navTitle: string | null; githubSource: string | null }, candidates: string[]): string[] {
  const titles = uniq([page.h1, page.navTitle].filter((t): t is string => !!t).map(normKey));
  const keys = new Map(candidates.map((c) => [c, normKey(c)]));
  const exact = candidates.filter((c) => titles.includes(keys.get(c)!));
  if (exact.length) return exact;
  const sing = candidates.filter((c) => titles.some((t) => normKey(singular(t)) === keys.get(c) || `${keys.get(c)}s` === t));
  if (sing.length) return sing;
  const suffix = candidates.filter((c) => titles.some((t) => t.length >= 4 && keys.get(c)!.endsWith(t)));
  if (suffix.length) return suffix;
  const src = page.githubSource?.split("/").pop() ?? null;
  return src && candidates.includes(src) ? [src] : [];
}

interface PageInfo {
  frag: MdFrag;
  pathname: string;
  url: string;
  title: string;
  navOrder: number;
  section: string | null;
  members: string[];
  primaries: string[];
}

interface Ctx {
  profile: CoreProfile;
  pin: NpmPin;
  pages: PageInfo[];
  apiBySlug: Map<string, FragOf<"api">>;
  trBySlug: Map<string, FragOf<"api-tr">>;
  slugByName: Map<string, string>;
  lab: FragOf<"text"> | null;
  overview: FragOf<"text"> | null;
  npmEv: (field: string, excerpt: string) => EvidenceInput;
}

function npmEvidence(pin: NpmPin, retrievedAt: string) {
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

function propertiesOf(api: ApiDoc, tr: ApiTranslations | null, url: string): NormalizedComponent["properties"] {
  const out: NormalizedComponent["properties"] = [];
  for (const p of api.props) {
    const d = tr?.props[p.name];
    out.push({
      implementation: "react",
      name: p.name,
      type: p.type,
      defaultValue: p.defaultValue,
      required: p.required,
      deprecated: p.deprecated || !!d?.deprecated,
      description: clip(d?.description ?? null, 600),
      allowedValues: literalUnion(p.type),
      sourceUrl: url,
    });
  }
  for (const s of api.slots) {
    out.push({
      implementation: "react",
      name: `slots.${s.name}`,
      type: "elementType",
      defaultValue: s.defaultValue,
      required: false,
      deprecated: false,
      description: clip(tr?.slots[s.name] ?? s.description, 600),
      allowedValues: null,
      sourceUrl: `${url}#slots`,
    });
  }
  const seen = new Set<string>();
  return out.filter((p) => (seen.has(p.name) ? false : (seen.add(p.name), true)));
}

function variantsOf(api: ApiDoc, url: string, file: string): NormalizedComponent["variants"] {
  const out: NormalizedComponent["variants"] = [];
  for (const p of api.props) {
    const axis = p.name === "variant" ? "variant" : p.name === "color" ? "color" : null;
    if (!axis || p.deprecated) continue;
    for (const v of literalUnion(p.type) ?? []) out.push({ axis, name: v, description: null, sourceUrl: url, location: `${file}#/props/${p.name}` });
  }
  return out;
}

function statesOf(api: ApiDoc, url: string): { states: NormalizedComponent["states"]; fromClasses: boolean } {
  const out: NormalizedComponent["states"] = [];
  const seen = new Set<string>();
  for (const c of api.classes) {
    if (!c.isGlobal || !/^Mui-/.test(c.className)) continue;
    if (seen.has(c.key)) continue;
    seen.add(c.key);
    out.push({ name: c.key, canonical: STATE_KEY_CANON[c.key] ?? canonicalState(c.key), description: clip(`${c.className}: ${c.description ?? "global state class"}`, 280), sourceUrl: `${url}#classes` });
  }
  const fromClasses = out.length > 0;
  for (const p of api.props) {
    if (!STATE_PROPS.includes(p.name) || p.typeName !== "bool" || seen.has(p.name)) continue;
    seen.add(p.name);
    out.push({ name: p.name, canonical: STATE_KEY_CANON[p.name] ?? canonicalState(p.name), description: `Documented boolean \`${p.name}\` prop.`, sourceUrl: `${url}#props` });
  }
  return { states: out, fromClasses };
}

function lifecycleOf(c: Ctx, api: ApiDoc): { lifecycle: Lifecycle; ev: EvidenceInput | null } {
  if (api.deprecated) return { lifecycle: "deprecated", ev: null };
  if (c.profile.system === "joy-ui") {
    const ov = c.overview;
    const onHold = ov?.statements.onHold;
    return {
      lifecycle: "beta",
      ev: ov && onHold ? evidence(ov.prov, "lifecycle", PARSERS.md, { location: `${ov.prov.file} :::warning`, excerpt: `${c.pin.pkg}@${c.pin.version} is a beta (prerelease) version. ${onHold}` }) : c.npmEv("lifecycle", `${c.pin.pkg}@${c.pin.version} is a prerelease (beta) version`),
    };
  }
  if (api.packageName === "@mui/lab") {
    const lab = c.lab;
    return {
      lifecycle: "experimental",
      ev: lab ? evidence(lab.prov, "lifecycle", PARSERS.md, { location: `${lab.prov.file} <p class="description">`, excerpt: `Imported from @mui/lab. ${lab.doc.description ?? ""}` }) : null,
    };
  }
  if (/^Unstable_/.test(api.name)) return { lifecycle: "experimental", ev: null };
  if (!isPrerelease(c.pin.version)) return { lifecycle: "stable", ev: c.npmEv("lifecycle", `exported by ${api.packageName ?? c.pin.pkg}@${c.pin.version} (stable, non-prerelease release)`) };
  return { lifecycle: "unknown", ev: null };
}

function a11yOf(c: Ctx, tr: FragOf<"api-tr"> | null, primaryPages: PageInfo[], memberPages: PageInfo[]) {
  const ev: EvidenceInput[] = [];
  const page = primaryPages.find((p) => p.frag.doc.a11y) ?? null;
  const a: MuiA11y | null = page?.frag.doc.a11y ?? null;
  const cd = splitComponentDescription(tr?.tr.componentDescription ?? null);
  const cdA11y = cd.sections.filter((s) => /aria|accessib/i.test(s.heading));
  const cdText = cdA11y.length ? clip(cdA11y.map((s) => mdInlineToText(s.text)).filter(Boolean).join(" "), 800) : null;
  const waiAria = primaryPages.map((p) => p.frag.doc.frontmatter.waiAria).find((w) => w && apgSlugs(w).length) ?? null;
  const pattern = (waiAria ? apgSlugs(waiAria)[0] : null) ?? a?.apgPatterns[0] ?? null;
  if (!a && !cdText) {
    const anyPage = memberPages.some((p) => p.frag.doc.a11y);
    return { accessibility: null, coverage: { accessibility: (anyPage ? "not-extracted" : "not-documented") as CoverageState, keyboard: (anyPage ? "not-extracted" : "not-documented") as CoverageState }, ev, pattern: waiAria ? pattern : null };
  }
  const keyboard = a?.keyboard ?? [];
  const roles = uniq([...(a?.roles ?? []), ...(cdA11y.length ? rolesIn(cdA11y.map((s) => s.text).join("\n")) : [])]).sort();
  const guidance = clip([a?.guidance, cdText].filter(Boolean).join(" "), 1200);
  const kbCov: CoverageState = keyboard.length ? "documented" : a?.keyboardNone ? "documented-none" : a?.keyboardText ? "not-extracted" : "not-documented";
  const cov = (v: unknown): CoverageState => (Array.isArray(v) ? (v.length ? "documented" : "not-documented") : v ? "documented" : "not-documented");
  const accessibility: NormalizedComponent["accessibility"] = {
    ariaPattern: pattern,
    roles: roles.length ? roles : null,
    keyboard: keyboard.length ? keyboard : null,
    guidance,
    screenReader: a?.screenReader ?? null,
    focusManagement: null,
    wcagCriteria: a?.wcag.length ? a.wcag : null,
    docsUrl: page ? `${page.url}#${a!.anchor}` : apiUrlFor(c.profile, tr!.slug),
    coverage: { keyboard: kbCov, roles: cov(roles), guidance: cov(guidance), screenReader: cov(a?.screenReader), focusManagement: "not-extracted", wcagCriteria: cov(a?.wcag), ariaPattern: pattern ? "documented" : "not-documented" },
  };
  if (page && a) {
    ev.push(evidence(page.frag.prov, "accessibility", PARSERS.md, { title: `${page.title}: ${a.heading}`, location: `${page.frag.prov.file}#${a.anchor}`, excerpt: a.guidance ?? a.keyboardText, confidence: 0.9 }));
    if (keyboard.length || a.keyboardNone) ev.push(evidence(page.frag.prov, "keyboard", PARSERS.md, { location: `${page.frag.prov.file}#${a.keyboardAnchor ?? a.anchor}`, excerpt: keyboard[0]?.action ?? a.keyboardText, confidence: 0.85 }));
  }
  if (cdText && tr) ev.push(evidence(tr.prov, "accessibility", PARSERS.apiTr, { location: `${tr.prov.file}#/componentDescription`, excerpt: cdText, confidence: 0.9 }));
  return { accessibility, coverage: { accessibility: "documented" as CoverageState, keyboard: kbCov }, ev, pattern };
}

function buildComponent(c: Ctx, slug: string): NormalizedComponent | null {
  const af = c.apiBySlug.get(slug);
  if (!af) return null;
  const api = af.api;
  if (!api.name) return null;
  const tr = c.trBySlug.get(slug) ?? null;
  const apiUrl = apiUrlFor(c.profile, slug);
  const apiFile = af.prov.file;
  const demoPaths = new Set(api.demos.map((d) => d.pathname));
  const memberPages = c.pages.filter((p) => demoPaths.has(p.pathname) || p.members.includes(api.name));
  const primaryPages = memberPages.filter((p) => p.primaries.includes(api.name));
  const primary = primaryPages[0] ?? null;
  const evidenceList: EvidenceInput[] = [];
  const coverage: Record<string, CoverageState> = {};

  evidenceList.push(
    evidence(af.prov, "*", PARSERS.apiJson, {
      title: `${api.name} API (${c.profile.label} ${c.pin.version})`,
      location: apiFile,
      excerpt: `${api.name}: ${api.props.length} props, ${api.slots.length} slots, ${api.classes.length} CSS classes; ${api.imports[0] ?? ""}`,
    }),
  );

  // Description: primary docs page <p class="description"> -> translations componentDescription lead -> none.
  let description: string | null = null;
  if (primary?.frag.doc.description) {
    description = clip(primary.frag.doc.description, 280);
    evidenceList.push(evidence(primary.frag.prov, "description", PARSERS.md, { title: primary.title, location: `${primary.frag.prov.file} <p class="description">`, excerpt: description }));
  } else {
    const lead = splitComponentDescription(tr?.tr.componentDescription ?? null).lead;
    const text = mdInlineToText(lead);
    if (text && tr) {
      description = firstSentence(text, 280);
      evidenceList.push(evidence(tr.prov, "description", PARSERS.apiTr, { location: `${tr.prov.file}#/componentDescription`, excerpt: description }));
    }
  }
  coverage.description = description ? "documented" : "not-documented";

  const { lifecycle, ev: lcEv } = lifecycleOf(c, api);
  if (lcEv) evidenceList.push(lcEv);

  // Classification: inferred from the name; verified when the primary page's waiAria names the matching APG pattern.
  const cls = classifyFor(c.profile.system, api.name, classifyComponentName);
  const a11y = a11yOf(c, tr, primaryPages, memberPages);
  let classification: NormalizedComponent["classification"] = null;
  if (cls) {
    const def = componentTypeBySlug.get(cls.slug);
    const waiAria = primaryPages.map((p) => p.frag.doc.frontmatter.waiAria).find(Boolean) ?? null;
    const pat = waiAria ? apgSlugs(waiAria)[0] : null;
    if (def?.ariaPattern && pat && (APG_EQUIV[pat] ?? pat) === def.ariaPattern && primary) {
      classification = { state: "verified", method: `taxonomy:${cls.method}+waiAria:${pat}`, confidence: 0.95 };
      evidenceList.push(evidence(primary.frag.prov, "canonicalType", PARSERS.md, { location: `${primary.frag.prov.file} front matter waiAria`, excerpt: `waiAria: ${waiAria}` }));
    } else classification = { state: "inferred", method: `taxonomy:${cls.method}`, confidence: cls.confidence };
  }

  // Frameworks
  const frameworks: NormalizedComponent["frameworks"] = [{ slug: "react", packageName: api.packageName ?? c.pin.pkg, importName: api.name, sourceUrl: apiUrl }];
  coverage.frameworks = "documented";
  evidenceList.push(evidence(af.prov, "frameworks", PARSERS.apiJson, { location: `${apiFile}#/imports`, excerpt: api.imports.join(" ") }));

  // Variants / sizes / states / properties
  const variants = variantsOf(api, apiUrl, apiFile);
  coverage.variants = variants.length ? "documented" : "not-documented";
  if (variants.length) evidenceList.push(evidence(af.prov, "variants", PARSERS.apiJson, { location: `${apiFile}#/props/${variants[0]!.axis}`, excerpt: uniq(variants.map((v) => `${v.axis}: ${v.name}`)).join(", ") }));
  const sizeProp = api.props.find((p) => p.name === "size" && !p.deprecated);
  const sizes = literalUnion(sizeProp?.type ?? null);
  coverage.sizes = sizes?.length ? "documented" : "not-documented";
  if (sizes?.length) evidenceList.push(evidence(af.prov, "sizes", PARSERS.apiJson, { location: `${apiFile}#/props/size`, excerpt: `size: ${sizeProp!.type}` }));
  const { states, fromClasses } = statesOf(api, apiUrl);
  coverage.states = fromClasses ? "documented" : states.length ? "inferred" : "not-documented";
  if (states.length)
    evidenceList.push(
      evidence(af.prov, "states", PARSERS.apiJson, {
        location: fromClasses ? `${apiFile}#/classes (isGlobal)` : `${apiFile}#/props`,
        excerpt: states.map((s) => s.name).join(", "),
        state: fromClasses ? "verified" : "inferred",
        confidence: fromClasses ? 0.95 : 0.7,
      }),
    );
  const properties = propertiesOf(api, tr?.tr ?? null, apiUrl);
  coverage.properties = properties.length ? "documented" : "not-documented";
  if (tr) evidenceList.push(evidence(tr.prov, "properties", PARSERS.apiTr, { location: `${tr.prov.file}#/propDescriptions`, excerpt: `${Object.keys(tr.tr.props).length} prop descriptions` }));
  else evidenceList.push(evidence(af.prov, "properties", PARSERS.apiJson, { location: `${apiFile}#/props`, excerpt: `${api.props.length} props (descriptions not available)` }));

  // Accessibility
  evidenceList.push(...a11y.ev);
  coverage.accessibility = a11y.coverage.accessibility;
  coverage.keyboard = a11y.coverage.keyboard;

  // Examples: demo sections of the primary page(s), plus a link to every page that demos the component.
  const examples: NormalizedComponent["examples"] = [];
  for (const p of primaryPages) {
    for (const d of p.frag.doc.demoSections.slice(0, 25)) examples.push({ slug: `demo-${slugify(`${p.pathname.split("/").pop()}-${d.anchor}`) || "example"}`, title: d.heading, kind: "docs-link", url: `${p.url}#${d.anchor}` });
  }
  for (const p of memberPages) examples.push({ slug: `page-${slugify(p.pathname.split("/").pop() ?? "page")}`, title: `${p.title} (docs page)`, kind: "docs-link", url: p.url });
  const exSeen = new Set<string>();
  const exList = examples.filter((e) => (exSeen.has(e.slug) ? false : (exSeen.add(e.slug), true)));
  coverage.examples = exList.length ? "documented" : "not-documented";
  if (exList.length) {
    const src = primary ?? memberPages[0]!;
    evidenceList.push(evidence(src.frag.prov, "examples", PARSERS.md, { location: `${src.frag.prov.file} {{"demo"}} blocks`, excerpt: exList.slice(0, 6).map((e) => e.title).join("; ") }));
  }

  // Relationships: documented prop inheritance + components documented on the same page.
  const rel: NormalizedComponent["relationships"] = [];
  if (api.inheritance) {
    const target = api.inheritance.pathname ? (/\/api\/([a-z0-9-]+)\/?$/.exec(api.inheritance.pathname)?.[1] ?? null) : null;
    if (target && target !== slug && c.apiBySlug.has(target)) {
      rel.push({ kind: "extends", targetSlug: target, targetType: null });
      evidenceList.push(evidence(af.prov, "relationships", PARSERS.apiJson, { location: `${apiFile}#/inheritance`, excerpt: `props of ${api.inheritance.component} are also available on ${api.name}` }));
    }
  }
  let sameDocs = false;
  for (const p of memberPages) {
    const isPrimary = p.primaries.includes(api.name);
    const targets = isPrimary ? p.members.filter((m) => m !== api.name) : p.primaries;
    for (const t of targets) {
      const ts = c.slugByName.get(t);
      if (ts && ts !== slug) {
        rel.push({ kind: "related", targetSlug: ts, targetType: null });
        sameDocs = true;
      }
    }
  }
  if (sameDocs) {
    const src = primary ?? memberPages[0]!;
    evidenceList.push(evidence(src.frag.prov, "relationships", PARSERS.md, { location: `${src.frag.prov.file} front matter components`, excerpt: `components: ${src.frag.doc.frontmatter.components.join(", ")}` }));
  }
  const relSeen = new Set<string>();
  const relationships = rel
    .filter((r) => (relSeen.has(`${r.kind}|${r.targetSlug}`) ? false : (relSeen.add(`${r.kind}|${r.targetSlug}`), true)))
    .sort((x, y) => (x.kind + (x.targetSlug ?? "") < y.kind + (y.targetSlug ?? "") ? -1 : 1));
  coverage.relationships = relationships.length ? "documented" : "not-documented";

  coverage.tokens = "not-extracted";
  coverage.responsive = "not-extracted";

  return {
    slug,
    name: api.name,
    aliases: [],
    description,
    docsUrl: primary?.url ?? apiUrl,
    sourceCodeUrl: api.filename ? githubBlob(c.pin.tag, api.filename) : null,
    lifecycle,
    canonicalType: cls?.slug ?? null,
    classification,
    frameworks,
    variants,
    states,
    sizes: sizes?.length ? sizes : null,
    properties,
    accessibility: a11y.accessibility,
    examples: exList,
    relationships,
    tokenUsages: [],
    responsiveGuidance: null,
    coverage,
    evidence: evidenceList,
  };
}

/* ---------------------------------- facts ---------------------------------- */

function buildFacts(c: Ctx, pkg: FragOf<"pkg"> | null): NormalizedSystemFacts {
  const ev: EvidenceInput[] = [c.npmEv("latestVersion", `dist-tags.latest = ${c.pin.version}${c.pin.publishedAt ? `, published ${c.pin.publishedAt}` : ""}; source tag ${c.pin.tag} (${c.pin.tagMethod})`)];
  if (c.pin.publishedAt) ev.push(c.npmEv("latestReleaseAt", `time[${c.pin.version}] = ${c.pin.publishedAt}`));
  const parts: string[] = [];
  const ov = c.overview;
  if (c.profile.system === "mui") {
    if (ov?.statements.implements) {
      parts.push("Material UI is MUI's open-source React component library implementing Google's Material Design.");
      ev.push(evidence(ov.prov, "philosophy", PARSERS.md, { location: `${ov.prov.file} <p class="description">`, excerpt: ov.statements.implements }));
    }
    if (ov?.statements.md2) {
      parts.push("Its overview states that it supports Material Design 2.");
      ev.push(evidence(ov.prov, "philosophy", PARSERS.md, { location: `${ov.prov.file}#introduction`, excerpt: ov.statements.md2 }));
    }
    if (ov?.statements.customization) {
      parts.push("It pairs prebuilt components with customization options for building a custom design system on top.");
      ev.push(evidence(ov.prov, "philosophy", PARSERS.md, { location: `${ov.prov.file}#introduction`, excerpt: ov.statements.customization }));
    }
  } else {
    if (ov?.statements.principles) {
      parts.push("Joy UI is MUI's open-source React component library that follows MUI's own design direction (Joy Design) rather than Material Design.");
      ev.push(evidence(ov.prov, "philosophy", PARSERS.md, { location: `${ov.prov.file} <p class="description">`, excerpt: ov.statements.principles }));
    }
    if (ov?.statements.alternative) {
      parts.push("MUI positions it as an alternative to Material UI for projects that do not follow Material Design.");
      ev.push(evidence(ov.prov, "philosophy", PARSERS.md, { location: `${ov.prov.file}#why-use-joy-ui`, excerpt: ov.statements.alternative }));
    }
    if (ov?.statements.onHold) {
      parts.push("Its docs state that development is temporarily on hold.");
      ev.push(evidence(ov.prov, "philosophy", PARSERS.md, { location: `${ov.prov.file} :::warning`, excerpt: ov.statements.onHold }));
    }
  }
  if (pkg?.peerReact) ev.push(evidence(pkg.prov, "frameworks", PARSERS.pkgJson, { location: `${pkg.prov.file}#/peerDependencies/react`, excerpt: `${c.pin.pkg} peerDependencies.react: ${pkg.peerReact}` }));
  return {
    latestVersion: c.pin.version,
    latestReleaseAt: c.pin.publishedAt,
    philosophy: parts.length ? parts.join(" ") : null,
    principles: null,
    frameworks: pkg?.peerReact ? [{ slug: "react", packageName: c.pin.pkg }] : null,
    evidence: ev,
  };
}

/* -------------------------------- normalize -------------------------------- */

export function normalizeCore(system: "mui" | "joy-ui", frags: MuiFragment[], opts: { limit?: number; runStartedAt: string; log?: (m: string) => void }): NormalizedBundle {
  const log = opts.log ?? (() => {});
  const profile = CORE_PROFILES[system];
  const pin = frags[0]?.meta.pin;
  if (!pin) return { systemSlug: system, components: [], tokenSets: [], patterns: [], facts: null };
  const nav = byKind(frags, "nav")[0] ?? null;
  const pagesApi = byKind(frags, "pages-api")[0] ?? null;
  const apiBySlug = new Map(byKind(frags, "api").map((f) => [f.slug, f]));
  const trBySlug = new Map(byKind(frags, "api-tr").map((f) => [f.slug, f]));
  const texts = byKind(frags, "text");
  const slugByName = new Map<string, string>();
  for (const [slug, f] of [...apiBySlug.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) if (f.api.name && !slugByName.has(f.api.name)) slugByName.set(f.api.name, slug);

  const navOrder = new Map((nav?.pages ?? []).map((p) => [p.pathname, p]));
  const pages: PageInfo[] = byKind(frags, "md")
    .map((f) => {
      const np = navOrder.get(f.pathname);
      const demosOf = [...apiBySlug.values()].filter((a) => a.api.demos.some((d) => d.pathname === f.pathname)).map((a) => a.api.name);
      const members = uniq([...f.doc.frontmatter.components.filter((n) => slugByName.has(n)), ...demosOf]);
      const title = np?.title ?? f.doc.h1 ?? f.pathname;
      return {
        frag: f,
        pathname: f.pathname,
        url: f.pageUrl,
        title,
        navOrder: np?.order ?? 9999,
        section: np?.section ?? null,
        members,
        primaries: primaryComponents({ h1: f.doc.h1, navTitle: np?.title ?? null, githubSource: f.doc.frontmatter.githubSource }, members),
      };
    })
    .sort((a, b) => a.navOrder - b.navOrder || (a.pathname < b.pathname ? -1 : 1));

  const ctx: Ctx = {
    profile,
    pin,
    pages,
    apiBySlug,
    trBySlug,
    slugByName,
    lab: texts.find((t) => t.role === "lab") ?? null,
    overview: texts.find((t) => t.role === "overview") ?? null,
    npmEv: npmEvidence(pin, opts.runStartedAt),
  };

  const allSlugs = pagesApi?.slugs ?? [...apiBySlug.keys()];
  const chosen = prioritize(allSlugs.filter((s) => apiBySlug.has(s)), system, opts.limit);
  const missing = allSlugs.filter((s) => !apiBySlug.has(s));
  if (missing.length && !opts.limit) log(`${missing.length} API pages listed in pagesApi.js were not fetched/parsed: ${missing.slice(0, 8).join(", ")}`);
  let components = chosen.map((s) => buildComponent(ctx, s)).filter((x): x is NormalizedComponent => !!x);
  const inBundle = new Set(components.map((x) => x.slug));
  components = components.map((x) => ({ ...x, relationships: x.relationships.filter((r) => !r.targetSlug || inBundle.has(r.targetSlug)) }));
  // Targets outside a --limit run were dropped: documented links exist but are not in this bundle.
  for (const x of components) if (!x.relationships.length && x.coverage.relationships === "documented") x.coverage.relationships = "not-extracted";

  // Tokens
  const licenseFrag = byKind(frags, "license")[0] ?? null;
  const license = mitLicense(licenseFrag?.prov.sourceUrl ?? null, licenseFrag?.copyright ?? null);
  const tokenFiles = byKind(frags, "tokens").map((f) => ({ data: f.data, prov: f.prov, npmUrl: f.npmUrl }));
  const cssVarText = texts.find((t) => t.role === "css-vars");
  let tokenSets: NormalizedTokenSet[] = [];
  if (tokenFiles.length) {
    const inp = {
      pkg: pin.pkg,
      version: pin.version,
      files: tokenFiles,
      license,
      cssVarDoc: cssVarText?.statements.convention ? { prov: cssVarText.prov, excerpt: cssVarText.statements.convention } : null,
    };
    const r = system === "mui" ? buildMuiTokenSets(inp) : buildJoyTokenSets(inp);
    if (r.warnings.length) log(`token notes: ${r.warnings.slice(0, 6).join("; ")}`);
    tokenSets = r.sets;
  }

  const facts = buildFacts(ctx, byKind(frags, "pkg")[0] ?? null);
  return { systemSlug: system, components: sortBy(components, (x) => x.slug), tokenSets: sortBy(tokenSets, (s) => s.slug), patterns: [], facts };
}

/** Statements read from overview / lab / css-variables pages (exact sentences, bounded). */
export function coreStatements(role: string, md: string): Record<string, string | null> {
  const desc = /<p class="description">([\s\S]*?)<\/p>/.exec(md)?.[1]?.replace(/<[^>]+>/g, "") ?? null;
  const blocks = [...(desc ? [desc] : []), ...plainBlocks(md)];
  const find = (re: RegExp) => {
    for (const b of blocks) for (const s of b.split(/(?<=[.!?])\s+(?=[A-Z])/)) if (re.test(s)) return clip(s, 280);
    return null;
  };
  switch (role) {
    case "overview":
      return {
        implements: find(/open-source React component library that implements Google's Material Design/i),
        md2: find(/supports Material Design 2/i),
        customization: find(/customization options/i),
        principles: find(/implements MUI's own design principles/i),
        alternative: find(/alternative to Material UI/i),
        onHold: find(/development is temporarily on hold/i),
      };
    case "css-vars": {
      const m = /\/\/ Outputs '(var\(--joy-[a-z0-9-]+\))'/i.exec(md);
      return { convention: m ? `theme.vars.palette.primary[500] outputs '${m[1]}' (documented CSS variable naming)` : null };
    }
    default:
      return {};
  }
}
