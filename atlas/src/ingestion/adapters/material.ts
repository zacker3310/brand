/**
 * "material" source adapter: Google Material Design 3 ("material-design") and Material Web
 * Components ("material-web"). One adapter, two bundles (switch on ctx.systemSlug).
 *
 * Sources, in priority order (first-party, machine-readable first):
 *  - npm registry metadata for @material/web (version pin: latest dist-tag -> git tag v<version>).
 *  - github.com/material-components/material-web @ v<version> (Apache-2.0), via jsDelivr listing +
 *    raw.githubusercontent.com / cdn.jsdelivr.net/gh (identical bytes; split across two hosts):
 *      docs/components/*.md, README.md, docs/intro.md, docs/roadmap.md, labs/README.md,
 *      tokens/versions/latest/sass/*.scss  (M3 token DB export -> material-design tokens),
 *      tokens/versions/v0_192/*.scss + tokens/_md-*.scss (material-web tokens + CSS custom properties).
 *  - @material/web custom-elements.json (npm, via jsDelivr) for element summaries/import paths and
 *    for custom elements that have no docs page (labs/*, field/*).
 *  - m3.material.io: robots.txt-advertised sitemap; component/develop pages are client-rendered,
 *    so only <title> and <meta name="description"> are read (no script execution).
 */
import type { NormalizedBundle, NormalizedComponent, NormalizedSystemFacts, ValidationIssue, EvidenceInput } from "@/lib/contracts";
import { githubBlobUrl, githubListingUrl, githubRawUrl, listFiles, npmFileUrl, npmLatest } from "../http";
import type { AdapterContext, DiscoveredDocument, FetchedDocument, ParsedFragment, SourceAdapter } from "../types";
import { parseCem, type CemElement } from "./material/cem";
import { m3ComponentPages, parseM3Page, parseSitemap, type M3PageMeta } from "./material/m3-html";
import { parseMwcDoc, type MwcDoc } from "./material/mwc-docs";
import { m3ComponentForStem, normalizeM3Components, type M3PageInput } from "./material/normalize-design";
import { normalizeMwcComponents } from "./material/normalize-web";
import { parseLatestSass, parseSupportedTokens, parseV0192, type LatestSassFile, type SupportedTokensFile, type V0192File } from "./material/sass";
import { ADAPTER_ID, DOC_KINDS, M3_ORIGIN, MW_OWNER, MW_PACKAGE, MW_REPO, MW_REPO_URL, clip, evidence, sortBy, type Prov } from "./material/shared";
import { buildM3TokenSets, buildMwTokenSets } from "./material/tokens";

const SYSTEMS = ["material-design", "material-web"] as const;
type SystemSlug = (typeof SYSTEMS)[number];

interface NpmInfo {
  version: string;
  publishedAt: string | null;
  license: string | null;
  deprecated: string | null;
  url: string;
}

interface DocMeta extends Record<string, unknown> {
  file: string;
  version: string;
  ref: string;
  npm: NpmInfo;
  stem?: string;
  pageKind?: "component" | "develop" | "about";
  slug?: string;
  tabs?: string[];
}

type FragData =
  | { kind: "mwc-doc"; prov: Prov; meta: DocMeta; stem: string; doc: MwcDoc }
  | { kind: "mwc-text"; prov: Prov; meta: DocMeta; role: string; statements: Record<string, string | null> }
  | { kind: "mwc-cem"; prov: Prov; meta: DocMeta; elements: CemElement[] }
  | { kind: "v0192"; prov: Prov; meta: DocMeta; stem: string; file: V0192File }
  | { kind: "mwc-supported"; prov: Prov; meta: DocMeta; stem: string; file: SupportedTokensFile }
  | { kind: "m3-sass"; prov: Prov; meta: DocMeta; stem: string; file: LatestSassFile }
  | { kind: "m3-page"; prov: Prov; meta: DocMeta; page: M3PageMeta };

const stemOf = (file: string) => file.split("/").pop()!.replace(/^_/, "").replace(/\.(scss|md)$/, "");

/* ------------------------------- text statements ------------------------------- */

/**
 * Markdown -> plain-text blocks (paragraphs and individual list items). Links keep their text;
 * comments, images, code fences, headings and HTML tags are dropped.
 */
export function plainBlocks(md: string): string[] {
  const cleaned = md
    .replace(/```[\s\S]*?```/g, "\n\n")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/`([^`]+)`/g, (_, c: string) => c.replace(/</g, "\u0001").replace(/>/g, "\u0002"))
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<[^>\n]+>/g, " ")
    .replace(/\u0001/g, "<")
    .replace(/\u0002/g, ">");
  const blocks: string[] = [];
  for (const para of cleaned.split(/\n\s*\n/)) {
    let cur: string[] = [];
    const flush = () => {
      const t = cur.join(" ").replace(/\*\*|__/g, "").replace(/(^|\s)[*_](\S[^*_]*\S|\S)[*_](?=\s|[.,;:!?]|$)/g, "$1$2").replace(/^>\s*/, "").replace(/\s+/g, " ").trim();
      if (t) blocks.push(t);
      cur = [];
    };
    for (const line of para.split("\n")) {
      if (/^\s*#{1,6}\s/.test(line)) {
        flush();
        continue;
      }
      if (/^\s*([*+-]|\d+\.)\s+/.test(line)) {
        flush();
        cur.push(line.replace(/^\s*([*+-]|\d+\.)\s+/, ""));
        continue;
      }
      cur.push(line.replace(/^\s*>\s?/, "").trim());
    }
    flush();
  }
  return blocks;
}

export function findSentence(md: string, re: RegExp): string | null {
  for (const block of plainBlocks(md)) {
    for (const s of block.split(/(?<=[.!?])\s+(?=[A-Z])/)) if (re.test(s)) return clip(s.trim(), 280);
  }
  return null;
}

function statementsFor(role: string, md: string): Record<string, string | null> {
  const t = md;
  switch (role) {
    case "readme":
      return {
        maintenance: findSentence(t, /maintenance mode/i),
        material3: findSentence(t, /uses Material 3/i),
      };
    case "intro":
      return {
        library: findSentence(t, /is a library of web components/i),
        dropIn: findSentence(t, /drop-in replacements/i),
        tokens: findSentence(t, /tokens are CSS custom properties/i),
        material3: findSentence(t, /latest version, Material 3/i),
      };
    case "roadmap":
      return { maintenance: findSentence(t, /currently in maintenance mode/i), noWork: findSentence(t, /no current work planned/i) };
    case "labs-readme":
      return { experimental: findSentence(t, /experimental features/i) };
    default:
      return {};
  }
}

/* ----------------------------------- adapter ----------------------------------- */

export const adapter: SourceAdapter = {
  id: ADAPTER_ID,
  version: "1.0.0",
  systems: [...SYSTEMS],
  description:
    "Material Design 3 + Material Web: material-components/material-web docs/components MD, API tables, custom-elements.json, M3 token SCSS (latest token DB export and v0.192) at the npm-latest git tag; m3.material.io sitemap + page meta (client-rendered site).",

  async discover(ctx) {
    const system = ctx.systemSlug as SystemSlug;
    if (!SYSTEMS.includes(system)) throw new Error(`material adapter does not handle ${ctx.systemSlug}`);
    const npm = await npmLatest(ctx.http, MW_PACKAGE);
    if (!npm.ok || !npm.latest) throw new Error(`npm metadata for ${MW_PACKAGE} unavailable (${npm.status} ${npm.error ?? ""})`);
    const version = npm.latest;
    const ref = `v${version}`;
    const npmInfo: NpmInfo = { version, publishedAt: npm.publishedAt, license: npm.license, deprecated: npm.deprecated, url: npm.url };
    const listing = await listFiles(ctx.http, githubListingUrl(MW_OWNER, MW_REPO, ref));
    if (!listing.files.length) throw new Error(`jsDelivr listing for ${MW_OWNER}/${MW_REPO}@${ref} unavailable (HTTP ${listing.status})`);
    const files = [...listing.files].sort();
    ctx.log.info(`material: pinned ${MW_PACKAGE}@${version} -> ${MW_OWNER}/${MW_REPO}@${ref} (${files.length} files)`);
    const repoSource = { kind: "repository", url: MW_REPO_URL, label: `${MW_OWNER}/${MW_REPO}` };
    const meta = (file: string, extra: Partial<DocMeta> = {}): DocMeta => ({ file, version, ref, npm: npmInfo, ...extra });
    let hostToggle = 0;
    /** Alternate between two CDNs serving identical repository bytes at the pinned tag. */
    const repoDoc = (file: string, docKind: string, priority: number, extra: Partial<DocMeta> = {}): DiscoveredDocument => ({
      url: hostToggle++ % 2 === 0 ? githubRawUrl(MW_OWNER, MW_REPO, ref, file) : `https://cdn.jsdelivr.net/gh/${MW_OWNER}/${MW_REPO}@${ref}/${file}`,
      evidenceUrl: githubBlobUrl(MW_OWNER, MW_REPO, ref, file),
      docKind,
      source: repoSource,
      title: file,
      priority,
      meta: meta(file, extra),
    });
    const docs: DiscoveredDocument[] = [];
    const limit = ctx.limit && ctx.limit > 0 ? ctx.limit : undefined;

    if (system === "material-web") {
      const compDocs = files.filter((f) => /^docs\/components\/[a-z0-9-]+\.md$/.test(f));
      const chosen = limit ? compDocs.slice(0, limit) : compDocs;
      for (const f of chosen) docs.push(repoDoc(f, DOC_KINDS.mwcDoc, 10, { stem: stemOf(f) }));
      const texts: [string, string][] = [
        ["README.md", DOC_KINDS.mwcReadme],
        ["docs/intro.md", DOC_KINDS.mwcIntro],
        ["docs/roadmap.md", DOC_KINDS.mwcRoadmap],
        ["labs/README.md", DOC_KINDS.mwcLabsReadme],
      ];
      for (const [f, k] of texts) if (files.includes(f)) docs.push(repoDoc(f, k, 5));
      const cemUrl = npmFileUrl(MW_PACKAGE, version, "custom-elements.json");
      docs.push({
        url: cemUrl,
        evidenceUrl: cemUrl,
        docKind: DOC_KINDS.mwcCem,
        source: { kind: "package", url: `https://www.npmjs.com/package/${MW_PACKAGE}`, label: MW_PACKAGE },
        title: "custom-elements.json",
        priority: 5,
        meta: meta("custom-elements.json"),
      });
      const stemsLimited = chosen.map(stemOf);
      const keepComp = (f: string) => !limit || stemsLimited.some((s) => stemOf(f).includes(s.replace(/s$/, "")));
      for (const f of files.filter((x) => /^tokens\/versions\/v0_192\/_md-[a-z0-9-]+\.scss$/.test(x))) {
        if (/md-comp-/.test(f) && !keepComp(f)) continue;
        docs.push(repoDoc(f, DOC_KINDS.mwcV0192, 20, { stem: stemOf(f) }));
      }
      for (const f of files.filter((x) => /^tokens\/_md-[a-z0-9-]+\.scss$/.test(x))) {
        if (/md-comp-/.test(f) && !keepComp(f)) continue;
        docs.push(repoDoc(f, DOC_KINDS.mwcTopTokens, 20, { stem: stemOf(f) }));
      }
      return docs;
    }

    // material-design
    const sitemaps = await ctx.http.sitemapsFor(M3_ORIGIN);
    const sitemapUrl = sitemaps.find((s) => s.startsWith(M3_ORIGIN)) ?? `${M3_ORIGIN}/sitemap.xml`;
    const sm = await ctx.http.get(sitemapUrl, { accept: "application/xml,text/xml,*/*;q=0.5" });
    if (!sm.ok || !sm.body) throw new Error(`m3 sitemap unavailable (${sm.status} ${sm.error ?? ""})`);
    const entries = parseSitemap(sm.body);
    const pages = m3ComponentPages(entries, M3_ORIGIN);
    const chosen = limit ? pages.slice(0, limit) : pages;
    const siteSource = { kind: "docs-site", url: M3_ORIGIN, label: "m3.material.io" };
    for (const p of chosen) {
      const url = p.tabs.overview!.loc;
      docs.push({
        url,
        evidenceUrl: url,
        docKind: DOC_KINDS.m3Page,
        source: siteSource,
        title: p.slug,
        priority: 10,
        meta: meta(new URL(url).pathname, { pageKind: "component", slug: p.slug, tabs: Object.keys(p.tabs).sort() }),
      });
    }
    const about = ["/", "/develop", "/develop/android/jetpack-compose", "/develop/android/mdc-android", "/develop/flutter", "/develop/web", "/foundations/design-tokens/overview"];
    const locs = new Set(entries.map((e) => e.loc.replace(/\/$/, "") || M3_ORIGIN));
    for (const path of about) {
      const url = path === "/" ? `${M3_ORIGIN}/` : `${M3_ORIGIN}${path}`;
      if (!locs.has(url.replace(/\/$/, "")) && path !== "/") continue;
      docs.push({ url, evidenceUrl: url, docKind: DOC_KINDS.m3Page, source: siteSource, title: path, priority: 8, meta: meta(path, { pageKind: path.startsWith("/develop") ? "develop" : "about" }) });
    }
    const chosenSlugs = new Set(chosen.map((p) => p.slug));
    for (const f of files.filter((x) => /^tokens\/versions\/latest\/sass\/_md-[a-z0-9_-]+\.scss$/.test(x))) {
      const stem = stemOf(f);
      if (limit && !/^md-(ref|sys)-/.test(stem)) {
        const c = m3ComponentForStem(stem);
        if (!c || !chosenSlugs.has(c)) continue;
      }
      docs.push(repoDoc(f, DOC_KINDS.m3Sass, 20, { stem }));
    }
    return docs;
  },

  async parse(_ctx: AdapterContext, fetched: FetchedDocument): Promise<ParsedFragment | null> {
    const { doc, result } = fetched;
    const meta = doc.meta as DocMeta;
    const body = result.body ?? "";
    const prov: Prov = {
      sourceUrl: doc.evidenceUrl ?? doc.url,
      fetchedUrl: result.finalUrl || doc.url,
      retrievedAt: result.fetchedAt,
      contentHash: result.hash,
      file: meta.file,
    };
    const frag = (data: FragData, warnings: string[] = []): ParsedFragment => ({ docUrl: doc.url, docKind: doc.docKind, data, warnings });
    switch (doc.docKind) {
      case DOC_KINDS.mwcDoc:
        return frag({ kind: "mwc-doc", prov, meta, stem: meta.stem!, doc: parseMwcDoc(body, meta.file) });
      case DOC_KINDS.mwcReadme:
      case DOC_KINDS.mwcIntro:
      case DOC_KINDS.mwcRoadmap:
      case DOC_KINDS.mwcLabsReadme: {
        const role = { [DOC_KINDS.mwcReadme]: "readme", [DOC_KINDS.mwcIntro]: "intro", [DOC_KINDS.mwcRoadmap]: "roadmap", [DOC_KINDS.mwcLabsReadme]: "labs-readme" }[doc.docKind]!;
        return frag({ kind: "mwc-text", prov, meta, role, statements: statementsFor(role, body) });
      }
      case DOC_KINDS.mwcCem:
        return frag({ kind: "mwc-cem", prov, meta, elements: parseCem(body) });
      case DOC_KINDS.mwcV0192:
        return frag({ kind: "v0192", prov, meta, stem: meta.stem!, file: parseV0192(body) });
      case DOC_KINDS.mwcTopTokens:
        return frag({ kind: "mwc-supported", prov, meta, stem: meta.stem!, file: parseSupportedTokens(body) });
      case DOC_KINDS.m3Sass: {
        const file = parseLatestSass(body);
        return frag({ kind: "m3-sass", prov, meta, stem: meta.stem!, file }, file.tokens.length ? [] : [`${meta.file}: no documented tokens`]);
      }
      case DOC_KINDS.m3Page: {
        const page = parseM3Page(body);
        return frag({ kind: "m3-page", prov, meta, page }, page.title ? [] : [`${doc.url}: no <title>`]);
      }
      default:
        return null;
    }
  },

  async normalize(ctx, fragments) {
    const data = fragments.map((f) => f.data as FragData).filter((d) => d && typeof d === "object" && "kind" in d);
    const anyMeta = data[0]?.meta;
    if (!anyMeta) return { systemSlug: ctx.systemSlug, components: [], tokenSets: [], patterns: [], facts: null };
    const { version, ref, npm } = anyMeta;
    const warn = (msgs: string[]) => {
      if (msgs.length) ctx.log.warn(`material: ${msgs.length} normalization notes`, { sample: msgs.slice(0, 8) });
    };
    let components: NormalizedComponent[];
    let tokenSets: NormalizedBundle["tokenSets"];
    let facts: NormalizedSystemFacts;
    const npmEvidence = (field: string, excerpt: string): EvidenceInput => ({
      field,
      sourceUrl: npm.url,
      sourceTitle: `${MW_PACKAGE} on npm`,
      retrievedAt: ctx.runStartedAt,
      contentHash: null,
      extractionMethod: `adapter:${ADAPTER_ID}:npm-registry`,
      location: `https://registry.npmjs.org/${MW_PACKAGE.replace("/", "%2F")}#/dist-tags/latest`,
      excerpt,
      state: "verified",
      confidence: 0.95,
    });

    if (ctx.systemSlug === "material-web") {
      const v0192 = data.filter((d): d is Extract<FragData, { kind: "v0192" }> => d.kind === "v0192");
      const supported = data.filter((d): d is Extract<FragData, { kind: "mwc-supported" }> => d.kind === "mwc-supported");
      const tb = buildMwTokenSets(v0192, supported, { version });
      warn(tb.warnings);
      const texts = new Map(data.filter((d): d is Extract<FragData, { kind: "mwc-text" }> => d.kind === "mwc-text").map((d) => [d.role, d]));
      const cem = data.find((d): d is Extract<FragData, { kind: "mwc-cem" }> => d.kind === "mwc-cem") ?? null;
      const labs = texts.get("labs-readme");
      const docs = data.filter((d): d is Extract<FragData, { kind: "mwc-doc" }> => d.kind === "mwc-doc");
      const res = normalizeMwcComponents(docs, {
        version,
        ref,
        cem: cem ? { prov: cem.prov, elements: cem.elements } : null,
        labsReadme: labs ? { prov: labs.prov, excerpt: labs.statements.experimental ?? null } : null,
        tokenByCssVar: tb.byCssVar,
        limited: !!(ctx.limit && ctx.limit > 0),
      });
      warn(res.warnings);
      components = res.components;
      tokenSets = tb.sets;
      const readme = texts.get("readme");
      const intro = texts.get("intro");
      const roadmap = texts.get("roadmap");
      const ev: EvidenceInput[] = [npmEvidence("latestVersion", `dist-tags.latest = ${version}${npm.publishedAt ? `, published ${npm.publishedAt}` : ""}`)];
      if (npm.license) ev.push(npmEvidence("license", `license: ${npm.license}`));
      if (readme?.statements.maintenance) ev.push(evidence(readme.prov, "maintenanceStatus", "mwc-readme", { location: readme.prov.file, excerpt: readme.statements.maintenance }));
      if (roadmap?.statements.maintenance) ev.push(evidence(roadmap.prov, "maintenanceStatus", "mwc-readme", { location: `${roadmap.prov.file}#current`, excerpt: roadmap.statements.maintenance }));
      const philosophyParts: string[] = [];
      if (intro?.statements.library) {
        philosophyParts.push("Material Web (MWC) is Google's library of web components following Material Design (Material 3).");
        ev.push(evidence(intro.prov, "philosophy", "mwc-readme", { location: intro.prov.file, excerpt: intro.statements.library }));
      }
      if (intro?.statements.tokens) {
        philosophyParts.push("Components are themed through design tokens exposed as CSS custom properties (for example --md-sys-color-primary).");
        ev.push(evidence(intro.prov, "philosophy", "mwc-readme", { location: intro.prov.file, excerpt: intro.statements.tokens }));
      }
      if (intro?.statements.dropIn) {
        philosophyParts.push("Many components are designed as drop-in replacements for native elements such as <button> and <input>.");
        ev.push(evidence(intro.prov, "philosophy", "mwc-readme", { location: intro.prov.file, excerpt: intro.statements.dropIn }));
      }
      if (readme?.statements.maintenance) philosophyParts.push(`The README states the project is in maintenance mode pending new maintainers (v${version}).`);
      facts = {
        latestVersion: version,
        latestReleaseAt: npm.publishedAt,
        philosophy: philosophyParts.length ? philosophyParts.join(" ") : null,
        principles: null,
        frameworks: [{ slug: "web-components", packageName: MW_PACKAGE }],
        evidence: ev,
      };
    } else {
      const sass = data.filter((d): d is Extract<FragData, { kind: "m3-sass" }> => d.kind === "m3-sass");
      const tb = buildM3TokenSets(sass, { version, ref, treeUrl: `${MW_REPO_URL}/tree/${ref}/tokens/versions/latest/sass` });
      warn(tb.warnings);
      tokenSets = tb.sets;
      const pages = data.filter((d): d is Extract<FragData, { kind: "m3-page" }> => d.kind === "m3-page");
      const compPages: M3PageInput[] = pages.filter((p) => p.meta.pageKind === "component").map((p) => ({ prov: p.prov, slug: p.meta.slug!, meta: p.page, tabs: p.meta.tabs ?? [] }));
      const links = sass.map((s) => ({ stem: s.stem, prov: s.prov, names: tb.namesByStem.get(s.stem) ?? [], groups: tb.groupsByStem.get(s.stem) ?? [] }));
      const res = normalizeM3Components(compPages, links);
      warn(res.warnings);
      components = res.components;
      const byPath = new Map(pages.map((p) => [p.meta.file, p]));
      const ev: EvidenceInput[] = [];
      const parts: string[] = [];
      const home = byPath.get("/");
      if (home?.page.description && /open-source design system/i.test(home.page.description)) {
        parts.push("Material Design 3 is Google's open-source design system, providing guidelines, styles and components for building user interfaces.");
        ev.push(evidence(home.prov, "philosophy", "m3-html-meta", { location: "/ <meta name=description>", excerpt: home.page.description }));
      }
      const tokensPage = byPath.get("/foundations/design-tokens/overview");
      if (tokensPage?.page.description && /building blocks/i.test(tokensPage.page.description)) {
        parts.push("Its specifications are expressed as design tokens, which M3 describes as the building blocks of UI shared by designs, tools and code.");
        ev.push(evidence(tokensPage.prov, "philosophy", "m3-html-meta", { location: "/foundations/design-tokens/overview <meta name=description>", excerpt: tokensPage.page.description }));
      }
      // Implementation frameworks documented by M3 itself (/develop/*).
      const fw: { slug: string; packageName: string | null }[] = [];
      const devMap: [string, string, RegExp][] = [
        ["/develop/android/jetpack-compose", "jetpack-compose", /jetpack compose/i],
        ["/develop/android/mdc-android", "android-views", /mdc-android/i],
        ["/develop/flutter", "flutter", /flutter/i],
        ["/develop/web", "web-components", /web/i],
      ];
      for (const [path, slug, re] of devMap) {
        const p = byPath.get(path);
        if (!p?.page.title || !re.test(p.page.title)) continue;
        fw.push({ slug, packageName: slug === "web-components" && /material web/i.test(p.page.description ?? "") ? MW_PACKAGE : null });
        ev.push(evidence(p.prov, "frameworks", "m3-html-meta", { location: `${path} <title>`, excerpt: [p.page.title, p.page.description].filter(Boolean).join(" | ") }));
      }
      const dev = byPath.get("/develop");
      if (dev?.page.description) ev.push(evidence(dev.prov, "frameworks", "m3-html-meta", { location: "/develop <meta name=description>", excerpt: dev.page.description }));
      if (fw.length) parts.push(`Google documents implementations for ${fw.map((f) => ({ "jetpack-compose": "Jetpack Compose", "android-views": "Android Views (MDC-Android)", flutter: "Flutter", "web-components": "the web (Material Web)" })[f.slug]).join(", ")}.`);
      const tokenDbVersion = sass.find((s) => s.stem === "md-sys-color")?.file.version ?? null;
      const colorSass = sass.find((s) => s.stem === "md-sys-color");
      if (tokenDbVersion && colorSass) ev.push(evidence(colorSass.prov, "tokens", "m3-sass-vars", { location: `${colorSass.prov.file} header`, excerpt: `Design system: ${colorSass.file.designSystem}; Version: ${tokenDbVersion}` }));
      facts = {
        latestVersion: null,
        latestReleaseAt: null,
        philosophy: parts.length ? parts.join(" ") : null,
        principles: null,
        frameworks: fw.length ? fw : null,
        evidence: ev,
      };
    }

    if (ctx.limit && ctx.limit > 0 && components.length > ctx.limit) {
      components = components.slice(0, ctx.limit);
    }
    const slugs = new Set(components.map((c) => c.slug));
    components = components.map((c) => ({ ...c, relationships: c.relationships.filter((r) => !r.targetSlug || slugs.has(r.targetSlug)) }));
    return { systemSlug: ctx.systemSlug, components: sortBy(components, (c) => c.slug), tokenSets, patterns: [], facts };
  },

  validate(ctx, bundle) {
    return validateMaterialBundle(ctx.systemSlug, bundle, ctx.limit);
  },
};

/* ---------------------------------- validation ---------------------------------- */

export function validateMaterialBundle(system: string, bundle: NormalizedBundle, limit?: number): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const push = (i: Omit<ValidationIssue, "severity"> & { severity?: ValidationIssue["severity"] }) => issues.push({ severity: "error", ...i });
  const seen = new Set<string>();
  for (const c of bundle.components) {
    if (!c.name.trim()) push({ entityKind: "component", entityKey: c.slug, code: "REQUIRED_FIELD", message: "empty component name" });
    if (seen.has(c.slug)) push({ entityKind: "component", entityKey: c.slug, code: "DUPLICATE", message: `duplicate component slug ${c.slug}` });
    seen.add(c.slug);
    if (!c.evidence.length) push({ entityKind: "component", entityKey: c.slug, code: "MISSING_EVIDENCE", message: "component without evidence" });
    const propNames = new Set<string>();
    for (const p of c.properties) {
      const k = `${p.implementation}:${p.name}`;
      if (propNames.has(k)) push({ entityKind: "component", entityKey: c.slug, code: "DUPLICATE", message: `duplicate property ${k}`, severity: "warning" });
      propNames.add(k);
    }
    for (const r of c.relationships) {
      if (r.targetSlug && !bundle.components.some((x) => x.slug === r.targetSlug))
        push({ entityKind: "component", entityKey: c.slug, code: "SUSPICIOUS", message: `relationship target ${r.targetSlug} not in bundle`, severity: "warning" });
    }
  }
  const full = !limit;
  if (full) {
    const hasButton = system === "material-web" ? bundle.components.some((c) => c.slug === "button") : bundle.components.some((c) => c.slug === "buttons");
    if (!hasButton) push({ entityKind: "bundle", entityKey: system, code: "SUSPICIOUS", message: "well-known component Button missing" });
    const minComponents = system === "material-web" ? 15 : 25;
    if (bundle.components.length < minComponents)
      push({ entityKind: "bundle", entityKey: system, code: "SUSPICIOUS", message: `only ${bundle.components.length} components (expected >= ${minComponents})` });
  }
  const setSlugs = new Set<string>();
  let total = 0;
  for (const s of bundle.tokenSets) {
    if (setSlugs.has(s.slug)) push({ entityKind: "token-set", entityKey: s.slug, code: "DUPLICATE", message: "duplicate token set slug" });
    setSlugs.add(s.slug);
    const names = new Set<string>();
    for (const t of s.tokens) {
      if (!t.name) push({ entityKind: "token", entityKey: `${s.slug}:?`, code: "REQUIRED_FIELD", message: "empty token name" });
      if (names.has(t.name)) push({ entityKind: "token", entityKey: `${s.slug}:${t.name}`, code: "DUPLICATE", message: "duplicate token name in set" });
      names.add(t.name);
      if (t.rawValue === null || t.rawValue === undefined || t.rawValue === "")
        push({ entityKind: "token", entityKey: `${s.slug}:${t.name}`, code: "INVALID_TOKEN_VALUE", message: "empty raw value", severity: "warning" });
    }
    total += s.tokens.length;
  }
  const colorSet = system === "material-web" ? "mw-sys-color-light" : "m3-sys-color-light";
  const color = bundle.tokenSets.find((s) => s.slug === colorSet);
  if (!color || color.tokens.length < 40) push({ entityKind: "token-set", entityKey: colorSet, code: "SUSPICIOUS", message: `system color set has ${color?.tokens.length ?? 0} tokens (expected >= 40)` });
  const palette = bundle.tokenSets.find((s) => /ref-palette$/.test(s.slug));
  const minPalette = system === "material-web" ? 80 : 200;
  if (!palette || palette.tokens.length < minPalette)
    push({ entityKind: "token-set", entityKey: "ref-palette", code: "SUSPICIOUS", message: `reference palette has ${palette?.tokens.length ?? 0} tokens (expected >= ${minPalette})` });
  if (full && total < (system === "material-web" ? 1000 : 5000))
    push({ entityKind: "bundle", entityKey: system, code: "SUSPICIOUS", message: `only ${total} tokens`, severity: "warning" });
  // Unresolvable references (within the bundle) are reported, not fixed.
  const allNames = new Set(bundle.tokenSets.flatMap((s) => s.tokens.map((t) => t.name)));
  let dangling = 0;
  for (const s of bundle.tokenSets) for (const t of s.tokens) for (const r of t.references) if (!allNames.has(r)) dangling++;
  if (dangling) push({ entityKind: "bundle", entityKey: system, code: "SUSPICIOUS", message: `${dangling} token references do not resolve inside the bundle`, severity: "warning" });
  return issues;
}
