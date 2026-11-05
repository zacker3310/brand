/**
 * GOV.UK Design System adapter (registry slug "govuk-design-system").
 *
 * Sources (first-party, static parsing only; see govuk/constants.ts for details):
 *  - govuk-frontend npm package via jsDelivr, pinned to npm `latest` at run time: component templates,
 *    stylesheets (BEM modifiers, token usage), JS modules (roles, key handlers), default HTML fixtures,
 *    settings SCSS (tokens), compiled CSS (custom property names), prototype-kit config (macro names).
 *  - alphagov/govuk-frontend at tag v<version> (raw GitHub): component YAML (Nunjucks macro options).
 *  - alphagov/govuk-design-system (raw GitHub, default branch): component and pattern Markdown pages,
 *    colours data, component lifecycle page, homepage principles block.
 *  - design-system.service.gov.uk/sitemap.xml (current page list) and the GOV.UK Content API for the
 *    Government Design Principles.
 */
import type { NormalizedBundle, ValidationIssue } from "@/lib/contracts";
import { npmLatest, npmListingUrl, type FetchResult } from "../http";
import type { AdapterContext, DiscoveredDocument, FetchedDocument, ParsedFragment, SourceAdapter } from "../types";
import {
  ADAPTER_ID,
  DOCS_ORIGIN,
  DOCS_REPO_URL,
  FRONTEND_REPO_URL,
  NPM_PKG,
  PRINCIPLES_API_URL,
  PRINCIPLES_URL,
  SETTINGS_FILES,
  SITEMAP_URL,
  SYSTEM_SLUG,
  componentSrcDir,
  docsBlob,
  docsRaw,
  frontendBlob,
  frontendRaw,
  pkgFile,
  type TokenSetKey,
} from "./govuk/constants";
import { parseComponentDoc, parseDocsColours, parseHome, parseLifecyclePage, parsePatternDoc, parsePrinciplesApi, parseReadme, parseSitemapLocs, sitemapSlugs } from "./govuk/docs";
import { parseComponentJs, parsePrototypeKitConfig, parseTemplate } from "./govuk/markup";
import { normalizeGovuk, planComponents, type Ev, type GovukFragment, type ListingComponent } from "./govuk/normalize";
import { parseMacroOptionsJson, parseParamsYaml } from "./govuk/params";
import { analyseComponentScss, declaredCustomProperties, parseSettingsFile } from "./govuk/scss";
import { colourChecks, validateGovuk } from "./govuk/validate";

/* ------------------------------ run-scoped cache ------------------------------ */
// Documents fetched during discover() (package listing, sitemap) are reused by fetch() in the same run.
const prefetched = new Map<string, { run: string; result: FetchResult }>();
function remember(ctx: AdapterContext, url: string, result: FetchResult) {
  for (const [k, v] of prefetched) if (v.run !== ctx.runStartedAt) prefetched.delete(k);
  prefetched.set(url, { run: ctx.runStartedAt, result });
}

async function getText(ctx: AdapterContext, url: string): Promise<FetchResult> {
  const res = await ctx.http.get(url, { signal: ctx.signal });
  if (res.ok && res.body !== null) remember(ctx, url, res);
  return res;
}

/* ------------------------------- listing parse -------------------------------- */

export function parseListing(text: string): { components: ListingComponent[]; settingsFiles: string[] } {
  const comps = new Map<string, string[]>();
  const settings: string[] = [];
  try {
    const j = JSON.parse(text) as { files?: { name?: unknown }[] };
    for (const f of j.files ?? []) {
      if (typeof f.name !== "string") continue;
      const n = f.name.replace(/^\//, "");
      const c = /^dist\/govuk\/components\/([a-z0-9-]+)\/([^/]+)$/.exec(n);
      if (c) {
        if (!comps.has(c[1]!)) comps.set(c[1]!, []);
        comps.get(c[1]!)!.push(c[2]!);
        continue;
      }
      const s = /^dist\/govuk\/settings\/([^/]+\.scss)$/.exec(n);
      if (s) settings.push(s[1]!);
    }
  } catch {
    /* not JSON */
  }
  return {
    components: [...comps.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, files]) => ({ name, files: files.sort() })),
    settingsFiles: settings.sort(),
  };
}

/* --------------------------------- discover --------------------------------- */

const pkgSource = { kind: "package", url: `https://www.npmjs.com/package/${NPM_PKG}`, label: NPM_PKG };
const frontendSource = { kind: "repository", url: FRONTEND_REPO_URL, label: "alphagov/govuk-frontend" };
const docsRepoSource = { kind: "repository", url: DOCS_REPO_URL, label: "alphagov/govuk-design-system (docs source)" };
const docsSiteSource = { kind: "docs-site", url: DOCS_ORIGIN, label: "design-system.service.gov.uk" };
const contentApiSource = { kind: "api", url: "https://www.gov.uk/api/content", label: "GOV.UK Content API" };

async function discover(ctx: AdapterContext): Promise<DiscoveredDocument[]> {
  if (ctx.systemSlug !== SYSTEM_SLUG) throw new Error(`govuk adapter does not handle ${ctx.systemSlug}`);
  const docs: DiscoveredDocument[] = [];
  const npm = await npmLatest(ctx.http, NPM_PKG);
  const version = npm.ok ? npm.latest : null;
  if (!version) ctx.log.error(`npm latest unavailable for ${NPM_PKG}; package sources skipped`, { status: npm.status });

  const [listingRes, sitemapRes] = await Promise.all([version ? getText(ctx, npmListingUrl(NPM_PKG, version)) : Promise.resolve(null), getText(ctx, SITEMAP_URL)]);
  const listing = listingRes?.ok && listingRes.body ? parseListing(listingRes.body) : null;
  const slugs = sitemapRes.ok && sitemapRes.body ? sitemapSlugs(parseSitemapLocs(sitemapRes.body), DOCS_ORIGIN) : null;
  if (version && !listing?.components.length) ctx.log.warn("govuk-frontend file listing unavailable; implementation sources skipped", { status: listingRes?.status });
  if (!slugs) ctx.log.warn("docs sitemap unavailable; docs pages resolved from component folder names only", { status: sitemapRes.status });

  if (version) {
    docs.push({
      url: `https://registry.npmjs.org/${NPM_PKG}/${version}`,
      docKind: "govuk-npm-version",
      source: pkgSource,
      evidenceUrl: `https://www.npmjs.com/package/${NPM_PKG}/v/${version}`,
      meta: { version, publishedAt: npm.ok ? npm.publishedAt : null, license: npm.ok ? npm.license : null },
      priority: 1,
    });
  }
  if (listing && version)
    docs.push({ url: npmListingUrl(NPM_PKG, version), docKind: "govuk-listing", source: pkgSource, evidenceUrl: `https://www.jsdelivr.com/package/npm/${NPM_PKG}?version=${version}`, meta: { version }, priority: 0 });
  if (slugs) docs.push({ url: SITEMAP_URL, docKind: "govuk-sitemap", source: docsSiteSource, title: "GOV.UK Design System sitemap", priority: 0 });

  const plan = planComponents(
    listing && version ? { t: "listing", version, components: listing.components, settingsFiles: listing.settingsFiles, ev: null as unknown as Ev } : undefined,
    slugs ? { t: "sitemap", ...slugs, ev: null as unknown as Ev } : undefined,
    [],
    ctx.limit,
  );

  plan.forEach((item, i) => {
    const pr = 10 + i;
    const name = item.frontend;
    if (name && version) {
      const dir = `dist/govuk/components/${name}`;
      const has = (f: string) => item.files.includes(f);
      const yaml = `${componentSrcDir(name)}/${name}.yaml`;
      docs.push({
        url: frontendRaw(version, yaml),
        docKind: "govuk-params",
        source: frontendSource,
        evidenceUrl: frontendBlob(version, yaml),
        title: `${name}.yaml (macro options)`,
        meta: { name, version, file: yaml, fallback: has("macro-options.json") ? pkgFile(version, `${dir}/macro-options.json`) : null },
        priority: pr,
      });
      const add = (file: string, kind: string, extra: Record<string, unknown> = {}) => {
        if (!has(file)) return;
        docs.push({ url: pkgFile(version, `${dir}/${file}`), docKind: kind, source: pkgSource, evidenceUrl: pkgFile(version, `${dir}/${file}`), title: `${name}/${file}`, meta: { name, version, file: `${dir}/${file}`, ...extra }, priority: pr });
      };
      add("template.njk", "govuk-template");
      add(has("_mixin.scss") ? "_mixin.scss" : "_index.scss", "govuk-styles");
      add(`${name}.mjs`, "govuk-js");
      add("template-default.html", "govuk-html-example");
      add("_settings.scss", "govuk-settings", { set: "component-settings", order: 0, settingsFile: `components/${name}/_settings.scss` });
      if (!item.docSlug) add("README.md", "govuk-readme");
    }
    if (item.docSlug) {
      const file = `src/components/${item.docSlug}/index.md`;
      docs.push({ url: docsRaw(file), docKind: "govuk-docs-component", source: docsRepoSource, evidenceUrl: docsBlob(file), title: `Docs: ${item.docSlug}`, meta: { docSlug: item.docSlug, file }, priority: pr });
    }
  });

  const patternSlugs = slugs?.patterns ?? [];
  (ctx.limit ? patternSlugs.slice(0, ctx.limit) : patternSlugs).forEach((slug, i) => {
    const file = `src/patterns/${slug}/index.md`;
    docs.push({ url: docsRaw(file), docKind: "govuk-docs-pattern", source: docsRepoSource, evidenceUrl: docsBlob(file), title: `Pattern: ${slug}`, meta: { docSlug: slug, file }, priority: 10 + i });
  });

  if (version) {
    const present = new Set(listing?.settingsFiles ?? SETTINGS_FILES.map((s) => s.file));
    for (const s of SETTINGS_FILES) {
      if (!present.has(s.file)) {
        ctx.log.warn(`settings file missing from govuk-frontend@${version}: ${s.file}`);
        continue;
      }
      const file = `dist/govuk/settings/${s.file}`;
      docs.push({ url: pkgFile(version, file), docKind: "govuk-settings", source: pkgSource, evidenceUrl: pkgFile(version, file), title: `settings/${s.file}`, meta: { version, file, set: s.set, order: s.order, settingsFile: s.file }, priority: 2 });
    }
    docs.push({ url: pkgFile(version, "govuk-prototype-kit.config.json"), docKind: "govuk-macros", source: pkgSource, evidenceUrl: pkgFile(version, "govuk-prototype-kit.config.json"), meta: { version, file: "govuk-prototype-kit.config.json" }, priority: 2 });
    docs.push({ url: pkgFile(version, "dist/govuk/govuk-frontend.min.css"), docKind: "govuk-css", source: pkgSource, evidenceUrl: pkgFile(version, "dist/govuk/govuk-frontend.min.css"), meta: { version, file: "dist/govuk/govuk-frontend.min.css" }, priority: 3 });
  }
  const docFile = (file: string, kind: string, priority: number) =>
    docs.push({ url: docsRaw(file), docKind: kind, source: docsRepoSource, evidenceUrl: docsBlob(file), meta: { file }, priority });
  docFile("data/colours.json", "govuk-colours-json", 3);
  docFile("src/community/component-lifecycle-statuses/index.md", "govuk-lifecycle", 3);
  docFile("src/index.njk", "govuk-home", 3);
  docs.push({ url: PRINCIPLES_API_URL, docKind: "govuk-principles", source: contentApiSource, evidenceUrl: PRINCIPLES_URL, title: "Government Design Principles (Content API)", meta: { file: "/api/content/guidance/government-design-principles" }, priority: 3 });
  return docs;
}

/* ---------------------------------- fetch ----------------------------------- */

async function fetchDoc(ctx: AdapterContext, doc: DiscoveredDocument, prev: { etag?: string | null; lastModified?: string | null; lastHash?: string | null }): Promise<FetchResult> {
  const cached = prefetched.get(doc.url);
  if (cached && cached.run === ctx.runStartedAt) return cached.result;
  const res = await ctx.http.get(doc.url, { etag: prev.etag, lastModified: prev.lastModified, lastHash: prev.lastHash, signal: ctx.signal, maxBytes: 20 * 1024 * 1024 });
  const fallback = doc.meta?.fallback as string | null | undefined;
  // Component YAML missing at the release tag: use the package's generated macro-options.json (same params).
  if (res.status === 404 && fallback) {
    const alt = await ctx.http.get(fallback, { signal: ctx.signal });
    if (alt.ok) return alt;
  }
  return res;
}

/* ---------------------------------- parse ----------------------------------- */

function ev(fetched: FetchedDocument, override: Partial<Ev> = {}): Ev {
  const { doc, result } = fetched;
  return {
    sourceUrl: doc.evidenceUrl ?? result.finalUrl ?? doc.url,
    retrievedAt: result.fetchedAt,
    contentHash: result.hash,
    location: (doc.meta?.file as string | undefined) ?? new URL(doc.url).pathname,
    ...override,
  };
}

const frag = (fetched: FetchedDocument, data: GovukFragment, warnings?: string[]): ParsedFragment => ({
  docUrl: fetched.doc.url,
  docKind: fetched.doc.docKind,
  data,
  warnings: warnings?.length ? warnings : undefined,
});

const MAX_HTML_EXAMPLE = 4000;

async function parse(_ctx: AdapterContext, fetched: FetchedDocument): Promise<ParsedFragment | ParsedFragment[] | null> {
  const { doc, result } = fetched;
  const body = result.body ?? "";
  const meta = (doc.meta ?? {}) as Record<string, unknown>;
  const name = meta.name as string;
  const version = meta.version as string;
  switch (doc.docKind) {
    case "govuk-npm-version": {
      let license = (meta.license as string | null) ?? null;
      try {
        const j = JSON.parse(body) as { license?: string };
        if (typeof j.license === "string") license = j.license;
      } catch {
        /* keep packument license */
      }
      return frag(fetched, { t: "pkg", name: NPM_PKG, version, license, publishedAt: (meta.publishedAt as string | null) ?? null, ev: ev(fetched, { location: `${NPM_PKG}@${version}` }) });
    }
    case "govuk-listing": {
      const l = parseListing(body);
      return frag(fetched, { t: "listing", version, components: l.components, settingsFiles: l.settingsFiles, ev: ev(fetched, { location: `${NPM_PKG}@${version} file listing (dist/govuk/components/*)` }) });
    }
    case "govuk-sitemap": {
      const s = sitemapSlugs(parseSitemapLocs(body), DOCS_ORIGIN);
      return frag(fetched, { t: "sitemap", ...s, ev: ev(fetched, { location: "sitemap.xml" }) });
    }
    case "govuk-docs-component":
      return frag(fetched, { t: "docs-component", docSlug: meta.docSlug as string, data: parseComponentDoc(body), ev: ev(fetched) });
    case "govuk-docs-pattern":
      return frag(fetched, { t: "docs-pattern", docSlug: meta.docSlug as string, data: parsePatternDoc(body), ev: ev(fetched) });
    case "govuk-readme": {
      const r = parseReadme(body);
      return frag(fetched, { t: "readme", name, title: r.title, guidance: r.guidance, ev: ev(fetched) });
    }
    case "govuk-params": {
      // Body is the YAML at the release tag, or the macro-options.json fallback (detected by content).
      const isJson = body.trimStart().startsWith("[");
      const data = isJson ? parseMacroOptionsJson(body) : parseParamsYaml(body);
      const fallback = meta.fallback as string | null;
      const e = isJson && fallback ? ev(fetched, { sourceUrl: fallback, location: fallback.replace(/^https:\/\/cdn\.jsdelivr\.net\/npm\/[^/]+\//, "") }) : ev(fetched);
      return frag(fetched, { t: "params", name, data, fromTag: !isJson, version, ev: e }, data.format === "invalid" ? [`${name}: macro options could not be parsed`] : undefined);
    }
    case "govuk-template":
      return frag(fetched, { t: "template", name, data: parseTemplate(body), ev: ev(fetched) });
    case "govuk-styles":
      return frag(fetched, { t: "styles", name, file: meta.file as string, data: analyseComponentScss(body), ev: ev(fetched) });
    case "govuk-js":
      return frag(fetched, { t: "js", name, data: parseComponentJs(body), ev: ev(fetched) });
    case "govuk-html-example": {
      const html = body.trim();
      return frag(fetched, { t: "html-example", name, html: html && html.length <= MAX_HTML_EXAMPLE ? html : null, version, ev: ev(fetched) });
    }
    case "govuk-settings": {
      const settingsFile = meta.settingsFile as string;
      const data = parseSettingsFile(body, { entryComments: /colours-functional/.test(settingsFile) });
      return frag(fetched, { t: "settings", file: settingsFile, set: meta.set as TokenSetKey, order: meta.order as number, data, version, ev: ev(fetched) }, data.tokens.length ? undefined : [`${settingsFile}: no tokens parsed`]);
    }
    case "govuk-css":
      return frag(fetched, { t: "css", customProperties: declaredCustomProperties(body), ev: ev(fetched) });
    case "govuk-macros":
      return frag(fetched, { t: "macros", macros: parsePrototypeKitConfig(body), ev: ev(fetched) });
    case "govuk-colours-json":
      return frag(fetched, { t: "colours-json", colours: parseDocsColours(body), ev: ev(fetched) });
    case "govuk-lifecycle":
      return frag(fetched, { t: "lifecycle", rules: parseLifecyclePage(body), ev: ev(fetched) });
    case "govuk-home":
      return frag(fetched, { t: "home", data: parseHome(body), ev: ev(fetched) });
    case "govuk-principles": {
      const p = parsePrinciplesApi(body);
      return frag(fetched, { t: "principles", ...p, ev: ev(fetched, { location: `${meta.file as string} details.body h2` }) });
    }
    default:
      return null;
  }
}

/* --------------------------------- adapter ---------------------------------- */

export const adapter: SourceAdapter = {
  id: ADAPTER_ID,
  version: "1.0.0",
  systems: [SYSTEM_SLUG],
  description:
    "GOV.UK Design System: alphagov/govuk-design-system Markdown docs (components, patterns, lifecycle, colours) via raw GitHub + docs sitemap; govuk-frontend component YAML at the release tag; govuk-frontend npm package via jsDelivr (pinned to latest): templates, stylesheets, JS modules, HTML fixtures, settings SCSS tokens, compiled CSS; GOV.UK Content API (Government Design Principles).",
  discover,
  fetch: fetchDoc,
  parse,
  async normalize(ctx, fragments) {
    const { bundle, warnings, colourMismatches } = normalizeGovuk(ctx.systemSlug, fragments, { limit: ctx.limit });
    colourChecks.set(bundle, colourMismatches);
    for (const w of warnings.slice(0, 20)) ctx.log.warn(w);
    ctx.log.info(`govuk normalized: ${bundle.components.length} components, ${bundle.tokenSets.reduce((n, s) => n + s.tokens.length, 0)} tokens, ${bundle.patterns.length} patterns`);
    return bundle;
  },
  validate(ctx: AdapterContext, bundle: NormalizedBundle): ValidationIssue[] {
    return validateGovuk(bundle, { limit: ctx.limit });
  },
};
