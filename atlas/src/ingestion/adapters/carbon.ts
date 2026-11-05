/**
 * IBM Carbon Design System adapter.
 *
 * Sources (first-party, static parsing only):
 *  - carbon-website (Apache-2.0) via raw.githubusercontent.com: src/data/nav-items.yaml (page list),
 *    src/data/components.json (component index incl. parent/child), component MDX tabs
 *    (usage/style/code/accessibility), pattern MDX, "What is Carbon?".
 *  - www.carbondesignsystem.com: building-blocks sitemap (current docs URLs) and per-component page
 *    header metadata (status label, GitHub source folder, Storybook links) embedded in the HTML.
 *  - npm packages via jsDelivr, pinned to npm `latest` at run time: @carbon/react (compiled
 *    propTypes), @carbon/web-components (custom-elements.json), @carbon/colors / themes / layout /
 *    motion (DTCG *.tokens.json), @carbon/type (SCSS maps + published scale), @carbon/styles
 *    (compiled CSS, used only to verify --cds-* custom property names).
 */
import type { NormalizedBundle, ValidationIssue } from "@/lib/contracts";
import { listFiles, npmFileUrl, npmLatest, npmListingUrl, type FetchResult } from "../http";
import type { AdapterContext, DiscoveredDocument, FetchedDocument, ParsedFragment, SourceAdapter } from "../types";
import {
  ADAPTER_ID,
  BUILDING_BLOCKS_SITEMAP,
  LEGACY_ORIGIN,
  LIVE_ORIGIN,
  MONOREPO_URL,
  PKG,
  THEMES,
  THEME_FILES,
  WEBSITE_REPO_URL,
  legacyComponentUrl,
  liveComponentUrl,
  websiteBlob,
  websiteRaw,
  type PkgKey,
} from "./carbon/constants";
import { parseA11y, parseAbout, parseCode, parseComponentIndex, parseNav, parsePattern, parseSitemapLocs, parseStyle, parseUsage } from "./carbon/docs";
import { parseLiveMeta } from "./carbon/live";
import { normalizeCarbon, type CarbonFragment, type Ev } from "./carbon/normalize";
import { planComponents, planPatterns, type PatternPlan, type PlanItem } from "./carbon/plan";
import { extractPropTypes, localRequires } from "./carbon/proptypes";
import { declaredCssVars, layoutCategory, parseDtcgFile, parseFontFamilies, parseTypeScale, parseTypeStyles } from "./carbon/tokens";
import { parseWcaManifest } from "./carbon/wca";

const SYSTEMS = ["carbon"];

/* ------------------------------ run-scoped cache ------------------------------ */
// Documents fetched during discover() (nav, component index) are reused by fetch() in the same run.
const prefetched = new Map<string, { run: string; result: FetchResult }>();
function remember(ctx: AdapterContext, url: string, result: FetchResult) {
  for (const [k, v] of prefetched) if (v.run !== ctx.runStartedAt) prefetched.delete(k);
  prefetched.set(url, { run: ctx.runStartedAt, result });
}

async function getText(ctx: AdapterContext, url: string): Promise<{ text: string | null; res: FetchResult }> {
  const res = await ctx.http.get(url, { signal: ctx.signal });
  if (res.ok && res.body !== null) remember(ctx, url, res);
  return { text: res.ok ? res.body : null, res };
}

/* --------------------------------- discover --------------------------------- */

type Versions = Partial<Record<PkgKey, { version: string; publishedAt: string | null; license: string | null }>>;

async function resolveVersions(ctx: AdapterContext): Promise<Versions> {
  const out: Versions = {};
  const keys = Object.keys(PKG) as PkgKey[];
  await Promise.all(
    keys.map(async (k) => {
      const r = await npmLatest(ctx.http, PKG[k]);
      if (r.ok && r.latest) out[k] = { version: r.latest, publishedAt: r.publishedAt, license: r.license };
      else ctx.log.warn(`npm latest unavailable for ${PKG[k]}`, { status: r.status });
    }),
  );
  return out;
}

const pkgFile = (k: PkgKey, v: Versions, file: string) => npmFileUrl(PKG[k], v[k]!.version, file);
/** Human-facing pinned file view on jsDelivr (renders source in a browser). */
const pkgEvidence = (k: PkgKey, v: Versions, file: string) => npmFileUrl(PKG[k], v[k]!.version, file);

async function discover(ctx: AdapterContext): Promise<DiscoveredDocument[]> {
  const docs: DiscoveredDocument[] = [];
  const repoSource = { kind: "repository", url: WEBSITE_REPO_URL, label: "carbon-website (docs content)" };
  const liveSource = { kind: "docs-site", url: LIVE_ORIGIN, label: "carbondesignsystem.com" };
  const versions = await resolveVersions(ctx);

  // npm version manifests (evidence for latestVersion / pinned package versions).
  for (const k of Object.keys(PKG) as PkgKey[]) {
    const v = versions[k];
    if (!v) continue;
    docs.push({
      url: `https://registry.npmjs.org/${PKG[k].replace("/", "%2F")}/${v.version}`,
      docKind: "carbon-npm-version",
      source: { kind: "package", url: `https://www.npmjs.com/package/${PKG[k]}`, label: PKG[k] },
      evidenceUrl: `https://www.npmjs.com/package/${PKG[k]}/v/${v.version}`,
      meta: { pkg: PKG[k], version: v.version, publishedAt: v.publishedAt, license: v.license },
      priority: 1,
    });
  }

  // Navigation + component index + current docs URL scheme.
  const navFile = "src/data/nav-items.yaml";
  const indexFile = "src/data/components.json";
  const [navRes, indexRes, siteRes, listing] = await Promise.all([
    getText(ctx, websiteRaw(navFile)),
    getText(ctx, websiteRaw(indexFile)),
    ctx.http.get(BUILDING_BLOCKS_SITEMAP, { signal: ctx.signal }),
    versions.react ? listFiles(ctx.http, npmListingUrl(PKG.react, versions.react.version)) : Promise.resolve({ files: [] as string[], status: 0 }),
  ]);
  const sitemap = new Set(siteRes.ok && siteRes.body ? parseSitemapLocs(siteRes.body).map((u) => u.toLowerCase()) : []);
  if (!sitemap.size) ctx.log.warn("building-blocks sitemap unavailable; docs URLs fall back to legacy (redirecting) URLs");
  if (!listing.files.length) ctx.log.warn("@carbon/react file listing unavailable; React props will not be extracted");

  let plan: PlanItem[] = [];
  let patterns: PatternPlan[] = [];
  let aboutPath: string | null = null;
  if (navRes.text) {
    const nav = parseNav(navRes.text);
    const index = indexRes.text ? parseComponentIndex(indexRes.text) : [];
    aboutPath = nav.aboutPath;
    plan = planComponents({
      nav,
      index,
      reactFiles: listing.files,
      sitemap,
      liveUrl: (d, tab) => liveComponentUrl(d, tab),
      legacyUrl: (d, tab) => legacyComponentUrl(d, tab),
      limit: ctx.limit,
    });
    patterns = planPatterns(nav, sitemap, LIVE_ORIGIN, LEGACY_ORIGIN, ctx.limit);
    docs.push({
      url: websiteRaw(navFile),
      docKind: "carbon-nav",
      source: repoSource,
      evidenceUrl: websiteBlob(navFile),
      title: "carbon-website navigation",
      meta: { file: navFile, plan, patterns },
      priority: 0,
    });
    if (indexRes.text)
      docs.push({ url: websiteRaw(indexFile), docKind: "carbon-component-index", source: repoSource, evidenceUrl: websiteBlob(indexFile), meta: { file: indexFile }, priority: 0 });
  } else {
    ctx.log.error("carbon-website nav-items.yaml unavailable; no components or patterns can be discovered", { status: navRes.res.status });
  }

  // Per-component documents. Priorities interleave hosts so fetch workers stay busy.
  for (const item of plan) {
    const pr = 10 + item.order;
    if (item.kind === "page" && item.docSlug) {
      const tabs: [string, string][] = [
        ["usage", "carbon-mdx-usage"],
        ["style", "carbon-mdx-style"],
        ["code", "carbon-mdx-code"],
        ["accessibility", "carbon-mdx-a11y"],
      ];
      for (const [tab, kind] of tabs) {
        const file = `src/pages/components/${item.docSlug}/${tab}.mdx`;
        docs.push({
          url: websiteRaw(file),
          docKind: kind,
          source: repoSource,
          evidenceUrl: websiteBlob(file),
          title: `${item.name} — ${tab}`,
          meta: { slug: item.slug, file },
          priority: pr,
        });
      }
      if (item.docsUrl?.startsWith(LIVE_ORIGIN))
        docs.push({ url: item.docsUrl, docKind: "carbon-live-page", source: liveSource, title: `${item.name} (live docs)`, meta: { slug: item.slug }, priority: pr });
    }
    if (versions.react) {
      item.react.forEach((r, i) => {
        docs.push({
          url: pkgFile("react", versions, r.file),
          docKind: "carbon-react-js",
          source: { kind: "package", url: `https://www.npmjs.com/package/${PKG.react}`, label: PKG.react },
          evidenceUrl: pkgEvidence("react", versions, r.file),
          title: `${PKG.react} ${r.file}`,
          meta: {
            slug: item.slug,
            file: r.file,
            exports: r.exports,
            multi: item.react.reduce((n, x) => n + x.exports.length, 0) > 1,
            version: versions.react!.version,
            order: i,
          },
          priority: pr,
        });
      });
    }
  }

  if (versions.webComponents) {
    const file = "custom-elements.json";
    docs.push({
      url: pkgFile("webComponents", versions, file),
      docKind: "carbon-wca",
      source: { kind: "package", url: `https://www.npmjs.com/package/${PKG.webComponents}`, label: PKG.webComponents },
      evidenceUrl: pkgEvidence("webComponents", versions, file),
      meta: { file, version: versions.webComponents.version },
      priority: 2,
    });
  }

  for (const p of patterns) {
    docs.push({
      url: websiteRaw(p.file),
      docKind: "carbon-pattern",
      source: repoSource,
      evidenceUrl: websiteBlob(p.file),
      title: `Pattern: ${p.name}`,
      meta: { plan: p, file: p.file, fallbacks: [p.file.replace(/\/index\.mdx$/, ".mdx")] },
      priority: 10 + p.order,
    });
  }

  if (aboutPath) {
    const base = `src/pages${aboutPath.replace(/\/$/, "")}`;
    const legacy = `${LEGACY_ORIGIN}${aboutPath}`;
    const head = await ctx.http.get(legacy, { method: "HEAD", signal: ctx.signal });
    const docsUrl = head.ok && head.finalUrl.startsWith(LIVE_ORIGIN) ? head.finalUrl : legacy;
    docs.push({
      url: websiteRaw(`${base}.mdx`),
      docKind: "carbon-about",
      source: repoSource,
      evidenceUrl: websiteBlob(`${base}.mdx`),
      meta: { file: `${base}.mdx`, docsUrl, fallbacks: [`${base}/index.mdx`] },
      priority: 3,
    });
  }

  // Tokens
  const tok = (k: PkgKey, file: string, kind: string, meta: Record<string, unknown>, priority = 4) => {
    if (!versions[k]) return;
    docs.push({
      url: pkgFile(k, versions, file),
      docKind: kind,
      source: { kind: "package", url: `https://www.npmjs.com/package/${PKG[k]}`, label: PKG[k] },
      evidenceUrl: pkgEvidence(k, versions, file),
      title: `${PKG[k]} ${file}`,
      meta: { pkg: PKG[k], version: versions[k]!.version, file, ...meta },
      priority,
    });
  };
  tok("colors", "tokens/colors.tokens.json", "carbon-tokens-dtcg", { setKey: "palette", part: "colors", order: 0, nameMode: "path", tier: "primitive" });
  THEMES.forEach((th, ti) => {
    THEME_FILES.forEach((f, fi) => {
      tok("themes", `tokens/themes/${th.id}/${f}.tokens.json`, "carbon-tokens-dtcg", {
        setKey: `theme-${th.id}`,
        part: f,
        order: fi,
        nameMode: "path",
        tier: f === "theme" ? "semantic" : "component",
        cssVar: true,
      }, 5 + ti);
    });
  });
  tok("layout", "tokens/layout.tokens.json", "carbon-tokens-dtcg", { setKey: "layout", part: "layout", order: 0, nameMode: "leaf", cssVar: true, category: "layout" });
  tok("motion", "tokens/motion.tokens.json", "carbon-tokens-dtcg", { setKey: "motion", part: "motion", order: 0, nameMode: "path" });
  tok("motion", "tokens/surfaces.tokens.json", "carbon-tokens-dtcg", { setKey: "motion", part: "surfaces", order: 1, nameMode: "path" });
  tok("type", "scss/_styles.scss", "carbon-type-styles", { setKey: "typography", part: "styles", order: 0 });
  tok("type", "scss/_font-family.scss", "carbon-type-fonts", { setKey: "typography", part: "font-family", order: 1 });
  tok("type", "es/index.js", "carbon-type-scale", { setKey: "typography", part: "scale", order: 2 });
  tok("styles", "css/styles.css", "carbon-css-vars", {}, 3);

  return docs;
}

/* ---------------------------------- fetch ----------------------------------- */

async function fetchDoc(
  ctx: AdapterContext,
  doc: DiscoveredDocument,
  prev: { etag?: string | null; lastModified?: string | null; lastHash?: string | null },
): Promise<FetchResult> {
  const cached = prefetched.get(doc.url);
  if (cached && cached.run === ctx.runStartedAt) return cached.result;
  const res = await ctx.http.get(doc.url, { etag: prev.etag, lastModified: prev.lastModified, lastHash: prev.lastHash, signal: ctx.signal });
  const fallbacks = (doc.meta?.fallbacks as string[] | undefined) ?? [];
  if (res.status === 404 && fallbacks.length) {
    for (const f of fallbacks) {
      const alt = await ctx.http.get(websiteRaw(f), { signal: ctx.signal });
      if (alt.ok) {
        // Record which file actually served the content.
        doc.meta = { ...doc.meta, file: f, servedUrl: websiteRaw(f) };
        doc.evidenceUrl = websiteBlob(f);
        return alt;
      }
    }
  }
  return res;
}

/* ---------------------------------- parse ----------------------------------- */

function ev(fetched: FetchedDocument, location?: string): Ev {
  const { doc, result } = fetched;
  return {
    sourceUrl: doc.evidenceUrl ?? result.finalUrl ?? doc.url,
    retrievedAt: result.fetchedAt,
    contentHash: result.hash,
    location: location ?? (doc.meta?.file as string | undefined) ?? new URL(doc.url).pathname,
  };
}

const frag = (fetched: FetchedDocument, data: CarbonFragment, warnings?: string[]): ParsedFragment => ({
  docUrl: fetched.doc.url,
  docKind: fetched.doc.docKind,
  data,
  warnings: warnings?.length ? warnings : undefined,
});

async function parseReact(ctx: AdapterContext, fetched: FetchedDocument): Promise<ParsedFragment[]> {
  const { doc, result } = fetched;
  const meta = doc.meta as { slug: string; file: string; exports: string[]; multi: boolean; version: string };
  const out: ParsedFragment[] = [];
  const dir = meta.file.replace(/\/[^/]+$/, "");
  for (const exportName of meta.exports) {
    let found = extractPropTypes(result.body ?? "", exportName);
    let foundIn: FetchedDocument = fetched;
    let file = meta.file;
    // Follow local re-exports (index.js -> ./X.js), bounded.
    if (!found) {
      for (const rel of localRequires(result.body ?? "").slice(0, 4)) {
        const linkedFile = `${dir}/${rel.replace(/^\.\//, "")}`;
        if (!/^lib\/components\/[A-Za-z0-9]+\/[A-Za-z0-9.]+\.js$/.test(linkedFile)) continue;
        const url = npmFileUrl(PKG.react, meta.version, linkedFile);
        const res = await ctx.http.get(url, { signal: ctx.signal });
        if (!res.ok || !res.body) continue;
        const r = extractPropTypes(res.body, exportName);
        if (r) {
          found = r;
          file = linkedFile;
          foundIn = { doc: { ...doc, url, evidenceUrl: url, meta: { ...doc.meta, file: linkedFile } }, result: res };
          break;
        }
      }
    }
    out.push(
      frag(fetched, {
        t: "react",
        slug: meta.slug,
        exportName,
        implementation: meta.multi ? `react:${exportName}` : "react",
        found: !!found,
        props: found?.props ?? [],
        sourcePath: found?.sourcePath ?? null,
        version: meta.version,
        ev: ev(foundIn, file),
      }, found ? undefined : [`${exportName}.propTypes not found in ${meta.file}`]),
    );
  }
  return out;
}

async function parse(ctx: AdapterContext, fetched: FetchedDocument): Promise<ParsedFragment | ParsedFragment[] | null> {
  const { doc, result } = fetched;
  const body = result.body ?? "";
  const meta = (doc.meta ?? {}) as Record<string, unknown>;
  const file = (meta.file as string | undefined) ?? "";
  const slug = meta.slug as string;
  switch (doc.docKind) {
    case "carbon-nav":
      return frag(fetched, { t: "nav", plan: meta.plan as PlanItem[], patterns: meta.patterns as PatternPlan[], ev: ev(fetched) });
    case "carbon-component-index":
      return frag(fetched, { t: "index", entries: parseComponentIndex(body), ev: ev(fetched) });
    case "carbon-mdx-usage":
      return frag(fetched, { t: "usage", slug, data: parseUsage(body, file), ev: ev(fetched) });
    case "carbon-mdx-style":
      return frag(fetched, { t: "style", slug, data: parseStyle(body, file), ev: ev(fetched) });
    case "carbon-mdx-code":
      return frag(fetched, { t: "code", slug, data: parseCode(body), ev: ev(fetched) });
    case "carbon-mdx-a11y":
      return frag(fetched, { t: "a11y", slug, data: parseA11y(body), ev: ev(fetched) });
    case "carbon-live-page": {
      const m = parseLiveMeta(body);
      if (!m) return null;
      return frag(fetched, { t: "live", slug, meta: m, ev: ev(fetched, `${new URL(doc.url).pathname} (embedded page header metadata)`) }, m.rejected.map((r) => `rejected malformed ${r}`));
    }
    case "carbon-react-js":
      return parseReact(ctx, fetched);
    case "carbon-wca": {
      const { tags, format } = parseWcaManifest(body);
      return frag(fetched, { t: "wca", tags, version: meta.version as string, ev: ev(fetched) }, tags.length ? undefined : [`no tags parsed (format ${format})`]);
    }
    case "carbon-pattern": {
      const plan = meta.plan as PatternPlan;
      return frag(fetched, { t: "pattern", slug: plan.slug, plan, data: parsePattern(body), ev: ev(fetched) });
    }
    case "carbon-about":
      return frag(fetched, { t: "about", docsUrl: meta.docsUrl as string, data: parseAbout(body), ev: ev(fetched) });
    case "carbon-tokens-dtcg": {
      const tierName = meta.tier as string | undefined;
      const r = parseDtcgFile(body, {
        file,
        nameMode: (meta.nameMode as "path" | "leaf") ?? "path",
        cssVar: meta.cssVar ? (name) => `--cds-${name.replace(/\./g, "-")}` : undefined,
        category: meta.category === "layout" ? (p) => layoutCategory(p) : undefined,
        // Palette / component files are declared as such by @carbon/themes' resolver and file descriptions.
        tier: tierName === "primitive" || tierName === "component" ? { tier: tierName, state: "verified" } : tierName === "semantic" ? { tier: "semantic", state: "inferred" } : null,
      });
      return frag(fetched, {
        t: "tokens",
        setKey: meta.setKey as string,
        part: meta.part as string,
        order: meta.order as number,
        tokens: r.tokens,
        fileDescription: r.description,
        colorScheme: r.colorScheme,
        pkg: meta.pkg as string,
        version: meta.version as string,
        ev: ev(fetched),
      });
    }
    case "carbon-type-styles":
    case "carbon-type-fonts":
    case "carbon-type-scale": {
      const tokens =
        doc.docKind === "carbon-type-styles" ? parseTypeStyles(body, file) : doc.docKind === "carbon-type-fonts" ? parseFontFamilies(body, file) : parseTypeScale(body, file);
      return frag(fetched, {
        t: "tokens",
        setKey: meta.setKey as string,
        part: meta.part as string,
        order: meta.order as number,
        tokens,
        fileDescription: null,
        colorScheme: null,
        pkg: meta.pkg as string,
        version: meta.version as string,
        ev: ev(fetched),
      });
    }
    case "carbon-css-vars":
      return frag(fetched, { t: "cssvars", names: declaredCssVars(body), pkg: meta.pkg as string, version: meta.version as string, ev: ev(fetched) });
    case "carbon-npm-version": {
      let license: string | null = (meta.license as string | null) ?? null;
      try {
        const j = JSON.parse(body) as { license?: string; version?: string };
        if (typeof j.license === "string") license = j.license;
      } catch {
        /* keep packument license */
      }
      return frag(fetched, {
        t: "pkg",
        name: meta.pkg as string,
        version: meta.version as string,
        license,
        publishedAt: (meta.publishedAt as string | null) ?? null,
        ev: ev(fetched, `${meta.pkg as string}@${meta.version as string}`),
      });
    }
    default:
      return null;
  }
}

/* -------------------------------- validate ---------------------------------- */

function validate(ctx: AdapterContext, bundle: NormalizedBundle): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const push = (i: ValidationIssue) => issues.push(i);
  const slugs = new Map<string, number>();
  for (const c of bundle.components) {
    slugs.set(c.slug, (slugs.get(c.slug) ?? 0) + 1);
    if (!c.name.trim()) push({ entityKind: "component", entityKey: c.slug, code: "REQUIRED_FIELD", message: "empty component name", severity: "error" });
    const seen = new Set<string>();
    for (const p of c.properties) {
      const k = `${p.implementation}|${p.name}`;
      if (seen.has(k)) push({ entityKind: "component", entityKey: c.slug, code: "DUPLICATE", message: `duplicate property ${k}`, severity: "error" });
      seen.add(k);
    }
    const ex = new Set<string>();
    for (const e of c.examples) {
      if (ex.has(e.slug)) push({ entityKind: "component", entityKey: c.slug, code: "DUPLICATE", message: `duplicate example slug ${e.slug}`, severity: "error" });
      ex.add(e.slug);
    }
    if (c.docsUrl && !/^https:\/\/(www\.)?carbondesignsystem\.com\//.test(c.docsUrl))
      push({ entityKind: "component", entityKey: c.slug, code: "SUSPICIOUS", message: `docsUrl outside carbondesignsystem.com: ${c.docsUrl}`, severity: "warning" });
    if (c.sourceCodeUrl && !c.sourceCodeUrl.startsWith(MONOREPO_URL))
      push({ entityKind: "component", entityKey: c.slug, code: "SUSPICIOUS", message: `sourceCodeUrl outside carbon monorepo: ${c.sourceCodeUrl}`, severity: "warning" });
  }
  for (const [s, n] of slugs) if (n > 1) push({ entityKind: "component", entityKey: s, code: "DUPLICATE", message: `duplicate component slug (${n})`, severity: "error" });
  const full = !ctx.limit;
  if (full) {
    for (const must of ["button", "text-input", "modal", "data-table", "dropdown", "tabs"]) {
      if (!slugs.has(must)) push({ entityKind: "bundle", entityKey: ADAPTER_ID, code: "REQUIRED_FIELD", message: `well-known component missing: ${must}`, severity: "error" });
    }
    if (bundle.components.length < 40)
      push({ entityKind: "bundle", entityKey: ADAPTER_ID, code: "SUSPICIOUS", message: `only ${bundle.components.length} components (nav lists ~42 pages)`, severity: "warning" });
    if (bundle.patterns.length < 10) push({ entityKind: "bundle", entityKey: ADAPTER_ID, code: "SUSPICIOUS", message: `only ${bundle.patterns.length} patterns`, severity: "warning" });
  } else if (bundle.components.length && !slugs.has("button") && (ctx.limit ?? 0) >= 4) {
    push({ entityKind: "bundle", entityKey: ADAPTER_ID, code: "SUSPICIOUS", message: "Button not in limited run", severity: "warning" });
  }
  const setSlugs = new Set<string>();
  const tokenNames = new Set<string>();
  for (const s of bundle.tokenSets) {
    if (setSlugs.has(s.slug)) push({ entityKind: "token-set", entityKey: s.slug, code: "DUPLICATE", message: "duplicate token set slug", severity: "error" });
    setSlugs.add(s.slug);
    const min = s.slug.startsWith("theme-") ? 200 : s.slug === "palette" ? 150 : 5;
    if (s.tokens.length < min) push({ entityKind: "token-set", entityKey: s.slug, code: "SUSPICIOUS", message: `${s.tokens.length} tokens (< ${min})`, severity: "warning" });
    const names = new Set<string>();
    for (const t of s.tokens) {
      if (!t.name.trim()) push({ entityKind: "token", entityKey: `${s.slug}:?`, code: "REQUIRED_FIELD", message: "empty token name", severity: "error" });
      if (names.has(t.name)) push({ entityKind: "token", entityKey: `${s.slug}:${t.name}`, code: "DUPLICATE", message: "duplicate token name in set", severity: "error" });
      names.add(t.name);
      tokenNames.add(t.name);
      if (t.rawValue === undefined || t.rawValue === null || t.rawValue === "")
        push({ entityKind: "token", entityKey: `${s.slug}:${t.name}`, code: "INVALID_TOKEN_VALUE", message: "empty raw value", severity: "error" });
    }
  }
  if (full) for (const req of ["palette", "theme-white", "theme-g10", "theme-g90", "theme-g100"]) if (!setSlugs.has(req)) push({ entityKind: "bundle", entityKey: ADAPTER_ID, code: "REQUIRED_FIELD", message: `token set missing: ${req}`, severity: "error" });
  // Unresolvable references / token usages (warnings: may point at tokens from packages not ingested).
  let unresolved = 0;
  for (const s of bundle.tokenSets) for (const t of s.tokens) for (const r of t.references) if (!tokenNames.has(r)) unresolved++;
  if (unresolved) push({ entityKind: "bundle", entityKey: ADAPTER_ID, code: "SUSPICIOUS", message: `${unresolved} token references do not match a token name in this bundle`, severity: "warning" });
  let unknownUsages = 0;
  for (const c of bundle.components) for (const u of c.tokenUsages) if (!tokenNames.has(u.tokenName)) unknownUsages++;
  if (unknownUsages && tokenNames.size) push({ entityKind: "bundle", entityKey: ADAPTER_ID, code: "SUSPICIOUS", message: `${unknownUsages} component token usages name tokens not in the bundle`, severity: "warning" });
  const pslugs = new Set<string>();
  for (const p of bundle.patterns) {
    if (pslugs.has(p.slug)) push({ entityKind: "pattern", entityKey: p.slug, code: "DUPLICATE", message: "duplicate pattern slug", severity: "error" });
    pslugs.add(p.slug);
  }
  return issues;
}

/* --------------------------------- adapter ---------------------------------- */

export const adapter: SourceAdapter = {
  id: ADAPTER_ID,
  version: "1.0.0",
  systems: SYSTEMS,
  description:
    "IBM Carbon: carbon-website MDX docs + nav/component index (raw GitHub), live docs page metadata and sitemap, @carbon/react propTypes, @carbon/web-components manifest, DTCG tokens from @carbon/colors/themes/layout/motion, @carbon/type SCSS (npm via jsDelivr, pinned to latest).",
  discover,
  fetch: fetchDoc,
  parse,
  async normalize(ctx, fragments) {
    const bundle = normalizeCarbon(ctx.systemSlug, fragments);
    ctx.log.info(
      `carbon normalized: ${bundle.components.length} components, ${bundle.tokenSets.reduce((n, s) => n + s.tokens.length, 0)} tokens, ${bundle.patterns.length} patterns`,
    );
    return bundle;
  },
  validate,
};

