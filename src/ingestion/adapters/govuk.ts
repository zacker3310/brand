/**
 * GOV.UK Frontend family adapter: the GOV.UK Design System ("govuk-design-system") and the NHS digital
 * service manual design system ("nhs-design-system"), which is built on the same architecture
 * (Nunjucks macros + Sass settings + docs site). One profile per system (govuk/constants.ts).
 *
 * Sources (first-party, static parsing only; see govuk/constants.ts for details):
 *  - npm package via jsDelivr, pinned to npm `latest` at run time: component templates, macro options,
 *    stylesheets (BEM modifiers, token usage), JS modules (roles, key handlers), default HTML fixtures,
 *    settings SCSS (tokens), compiled CSS (custom property names), Nunjucks macro names.
 *  - Frontend repo at tag v<version> (raw GitHub): GOV.UK component YAML; NHS component templates.
 *  - Docs repo (raw GitHub, default branch): component and pattern pages (GOV.UK Markdown, NHS Nunjucks
 *    templates with static HTML), lifecycle/colours/home/principles pages.
 *  - Docs site sitemap.xml (current page list) and, for GOV.UK, the GOV.UK Content API.
 */
import type { NormalizedBundle, ValidationIssue } from "@/lib/contracts";
import { npmLatest, npmListingUrl, type FetchResult } from "../http";
import type { AdapterContext, DiscoveredDocument, FetchedDocument, ParsedFragment, SourceAdapter } from "../types";
import {
  ADAPTER_ID,
  GOVUK,
  PROFILES,
  componentSrcDir,
  docsBlob,
  docsRaw,
  docsRepoUrl,
  frontendBlob,
  frontendRaw,
  frontendRepoUrl,
  pkgFile,
  profileFor,
  type FrontendProfile,
  type TokenSetKey,
} from "./govuk/constants";
import {
  parseComponentDoc,
  parseDocsColours,
  parseHome,
  parseLifecyclePage,
  parseNhsComponentDoc,
  parseNhsHome,
  parseNhsPatternDoc,
  parseNhsPrinciples,
  parsePatternDoc,
  parsePrinciplesApi,
  parseReadme,
  parseSitemapLocs,
  sitemapSlugs,
} from "./govuk/docs";
import { parseComponentJs, parseMacroNjk, parsePrototypeKitConfig, parseTemplate } from "./govuk/markup";
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
  const res = await ctx.http.get(url, { signal: ctx.signal, maxBytes: 20 * 1024 * 1024 });
  if (res.ok && res.body !== null) remember(ctx, url, res);
  return res;
}

function profileOf(ctx: AdapterContext): FrontendProfile {
  const p = profileFor(ctx.systemSlug);
  if (!p) throw new Error(`govuk adapter does not handle ${ctx.systemSlug}`);
  return p;
}

/* ------------------------------- listing parse -------------------------------- */

/** jsDelivr flat listing -> component folders (with their files) and settings SCSS files. */
export function parseListing(text: string, profile: FrontendProfile = GOVUK): { components: ListingComponent[]; settingsFiles: string[] } {
  const comps = new Map<string, string[]>();
  const settings: string[] = [];
  const compRe = new RegExp(`^${profile.componentsDir.replace(/\//g, "\\/")}\\/([a-z0-9-]+)\\/([^/]+)$`);
  const setRe = new RegExp(`^${profile.settingsDir.replace(/\//g, "\\/")}\\/([^/]+\\.scss)$`);
  try {
    const j = JSON.parse(text) as { files?: { name?: unknown }[] };
    for (const f of j.files ?? []) {
      if (typeof f.name !== "string") continue;
      const n = f.name.replace(/^\//, "");
      const c = compRe.exec(n);
      if (c) {
        if (!comps.has(c[1]!)) comps.set(c[1]!, []);
        comps.get(c[1]!)!.push(c[2]!);
        continue;
      }
      const s = setRe.exec(n);
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

/** fixtures.json (NHS): HTML of the fixture named "default". */
export function defaultFixtureHtml(text: string): string | null {
  try {
    const j = JSON.parse(text) as { fixtures?: { name?: unknown; html?: unknown }[] };
    const f = (j.fixtures ?? []).find((x) => x.name === "default");
    return typeof f?.html === "string" && f.html.trim() ? f.html.trim() : null;
  } catch {
    return null;
  }
}

/* --------------------------------- discover --------------------------------- */

async function discover(ctx: AdapterContext): Promise<DiscoveredDocument[]> {
  const P = profileOf(ctx);
  const docs: DiscoveredDocument[] = [];
  const pkgSource = { kind: "package", url: `https://www.npmjs.com/package/${P.npmPkg}`, label: P.npmPkg };
  const frontendSource = { kind: "repository", url: frontendRepoUrl(P), label: `${P.frontend.owner}/${P.frontend.repo}` };
  const docsRepoSource = { kind: "repository", url: docsRepoUrl(P), label: `${P.docs.owner}/${P.docs.repo} (docs source)` };
  const docsSiteSource = { kind: "docs-site", url: P.docs.origin, label: new URL(P.docs.origin).hostname };

  const npm = await npmLatest(ctx.http, P.npmPkg);
  const version = npm.ok ? npm.latest : null;
  if (!version) ctx.log.error(`npm latest unavailable for ${P.npmPkg}; package sources skipped`, { status: npm.status });

  const [listingRes, sitemapRes] = await Promise.all([version ? getText(ctx, npmListingUrl(P.npmPkg, version)) : Promise.resolve(null), getText(ctx, P.docs.sitemapUrl)]);
  const listing = listingRes?.ok && listingRes.body ? parseListing(listingRes.body, P) : null;
  const slugs = sitemapRes.ok && sitemapRes.body ? sitemapSlugs(parseSitemapLocs(sitemapRes.body), P.docs.origin, P.docs.basePath) : null;
  if (version && !listing?.components.length) ctx.log.warn(`${P.npmPkg} file listing unavailable; implementation sources skipped`, { status: listingRes?.status });
  if (!slugs) ctx.log.warn("docs sitemap unavailable; docs pages resolved from component folder names only", { status: sitemapRes.status });

  if (version) {
    docs.push({
      url: `https://registry.npmjs.org/${P.npmPkg}/${version}`,
      docKind: "govuk-npm-version",
      source: pkgSource,
      evidenceUrl: `https://www.npmjs.com/package/${P.npmPkg}/v/${version}`,
      meta: { version, publishedAt: npm.ok ? npm.publishedAt : null, license: npm.ok ? npm.license : null },
      priority: 1,
    });
  }
  if (listing && version)
    docs.push({ url: npmListingUrl(P.npmPkg, version), docKind: "govuk-listing", source: pkgSource, evidenceUrl: `https://www.jsdelivr.com/package/npm/${P.npmPkg}?version=${version}`, meta: { version }, priority: 0 });
  if (slugs) docs.push({ url: P.docs.sitemapUrl, docKind: "govuk-sitemap", source: docsSiteSource, title: "Docs sitemap", priority: 0 });

  const plan = planComponents(
    listing && version ? { t: "listing", version, components: listing.components, settingsFiles: listing.settingsFiles, ev: null as unknown as Ev } : undefined,
    slugs ? { t: "sitemap", ...slugs, ev: null as unknown as Ev } : undefined,
    [],
    ctx.limit,
    P,
  );

  plan.forEach((item, i) => {
    const pr = 10 + i;
    const name = item.frontend;
    if (name && version) {
      const dir = `${P.componentsDir}/${name}`;
      const has = (f: string) => item.files.includes(f);
      const add = (file: string, kind: string, extra: Record<string, unknown> = {}) => {
        if (!has(file)) return;
        const url = pkgFile(P, version, `${dir}/${file}`);
        docs.push({ url, docKind: kind, source: pkgSource, evidenceUrl: url, title: `${name}/${file}`, meta: { name, version, file: `${dir}/${file}`, ...extra }, priority: pr });
      };
      if (P.paramsSource === "yaml-tag") {
        const yaml = `${componentSrcDir(P, name)}/${name}.yaml`;
        docs.push({
          url: frontendRaw(P, version, yaml),
          docKind: "govuk-params",
          source: frontendSource,
          evidenceUrl: frontendBlob(P, version, yaml),
          title: `${name}.yaml (macro options)`,
          meta: { name, version, file: yaml, fallback: has("macro-options.json") ? pkgFile(P, version, `${dir}/macro-options.json`) : null },
          priority: pr,
        });
        add("template.njk", "govuk-template");
      } else {
        add("macro-options.json", "govuk-params");
        if (has("template.njk")) {
          // Template read from the release tag (verifies the source folder linked as sourceCodeUrl).
          const tpl = `${componentSrcDir(P, name)}/template.njk`;
          docs.push({
            url: frontendRaw(P, version, tpl),
            docKind: "govuk-template",
            source: frontendSource,
            evidenceUrl: frontendBlob(P, version, tpl),
            title: `${name}/template.njk`,
            meta: { name, version, file: tpl, fallback: pkgFile(P, version, `${dir}/template.njk`) },
            priority: pr,
          });
        }
        add("macro.njk", "govuk-macro");
      }
      // GOV.UK: styles in _mixin.scss; NHS: styles in _index.scss (_<name>.scss only forwards it).
      add(has("_mixin.scss") ? "_mixin.scss" : has("_index.scss") ? "_index.scss" : `_${name}.scss`, "govuk-styles");
      add(`${name}.mjs`, "govuk-js");
      add(P.htmlExample === "template-default" ? "template-default.html" : "fixtures.json", "govuk-html-example");
      add("_settings.scss", "govuk-settings", { set: "component-settings", order: 0, settingsFile: `components/${name}/_settings.scss` });
      if (!item.docSlug) add("README.md", "govuk-readme");
    }
    if (item.docSlug) {
      const file = P.docs.componentFile(item.docSlug);
      docs.push({ url: docsRaw(P, file), docKind: "govuk-docs-component", source: docsRepoSource, evidenceUrl: docsBlob(P, file), title: `Docs: ${item.docSlug}`, meta: { docSlug: item.docSlug, file }, priority: pr });
    }
  });

  const patternSlugs = slugs?.patterns ?? [];
  (ctx.limit ? patternSlugs.slice(0, ctx.limit) : patternSlugs).forEach((slug, i) => {
    const file = P.docs.patternFile(slug);
    docs.push({ url: docsRaw(P, file), docKind: "govuk-docs-pattern", source: docsRepoSource, evidenceUrl: docsBlob(P, file), title: `Pattern: ${slug}`, meta: { docSlug: slug, file }, priority: 10 + i });
  });

  if (version) {
    const present = new Set(listing?.settingsFiles ?? P.settingsFiles.map((s) => s.file));
    for (const s of P.settingsFiles) {
      if (!present.has(s.file)) {
        ctx.log.warn(`settings file missing from ${P.npmPkg}@${version}: ${s.file}`);
        continue;
      }
      const file = `${P.settingsDir}/${s.file}`;
      docs.push({ url: pkgFile(P, version, file), docKind: "govuk-settings", source: pkgSource, evidenceUrl: pkgFile(P, version, file), title: `settings/${s.file}`, meta: { version, file, set: s.set, order: s.order, settingsFile: s.file }, priority: 2 });
    }
    if (P.macrosConfig) docs.push({ url: pkgFile(P, version, P.macrosConfig), docKind: "govuk-macros", source: pkgSource, evidenceUrl: pkgFile(P, version, P.macrosConfig), meta: { version, file: P.macrosConfig }, priority: 2 });
    docs.push({ url: pkgFile(P, version, P.cssFile), docKind: "govuk-css", source: pkgSource, evidenceUrl: pkgFile(P, version, P.cssFile), meta: { version, file: P.cssFile }, priority: 3 });
  }
  const docFile = (file: string | null, kind: string) => {
    if (file) docs.push({ url: docsRaw(P, file), docKind: kind, source: docsRepoSource, evidenceUrl: docsBlob(P, file), meta: { file }, priority: 3 });
  };
  docFile(P.coloursJson, "govuk-colours-json");
  docFile(P.lifecyclePage, "govuk-lifecycle");
  docFile(P.homePage, "govuk-home");
  if (P.principles.kind === "govuk-content-api") {
    docs.push({
      url: P.principles.apiUrl,
      docKind: "govuk-principles",
      source: { kind: "api", url: "https://www.gov.uk/api/content", label: "GOV.UK Content API" },
      evidenceUrl: P.principles.humanUrl,
      title: "Government Design Principles (Content API)",
      meta: { file: new URL(P.principles.apiUrl).pathname },
      priority: 3,
    });
  } else docFile(P.principles.file, "govuk-principles");
  return docs;
}

/* ---------------------------------- fetch ----------------------------------- */

async function fetchDoc(ctx: AdapterContext, doc: DiscoveredDocument, prev: { etag?: string | null; lastModified?: string | null; lastHash?: string | null }): Promise<FetchResult> {
  const cached = prefetched.get(doc.url);
  if (cached && cached.run === ctx.runStartedAt) return cached.result;
  const res = await ctx.http.get(doc.url, { etag: prev.etag, lastModified: prev.lastModified, lastHash: prev.lastHash, signal: ctx.signal, maxBytes: 20 * 1024 * 1024 });
  const fallback = doc.meta?.fallback as string | null | undefined;
  // File missing at the release tag: use the published package copy (same content, generated from it).
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
const RAW_GITHUB = "https://raw.githubusercontent.com/";

/** Evidence for a document served from its package fallback URL instead of the release-tag file. */
function fallbackEv(fetched: FetchedDocument): Ev {
  const fb = fetched.doc.meta?.fallback as string;
  return ev(fetched, { sourceUrl: fb, location: fb.replace(/^https:\/\/cdn\.jsdelivr\.net\/npm\/[^/]+\//, "") });
}

async function parse(ctx: AdapterContext, fetched: FetchedDocument): Promise<ParsedFragment | ParsedFragment[] | null> {
  const P = profileOf(ctx);
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
      return frag(fetched, { t: "pkg", name: P.npmPkg, version, license, publishedAt: (meta.publishedAt as string | null) ?? null, ev: ev(fetched, { location: `${P.npmPkg}@${version}` }) });
    }
    case "govuk-listing": {
      const l = parseListing(body, P);
      return frag(fetched, { t: "listing", version, components: l.components, settingsFiles: l.settingsFiles, ev: ev(fetched, { location: `${P.npmPkg}@${version} file listing (${P.componentsDir}/*)` }) });
    }
    case "govuk-sitemap": {
      const s = sitemapSlugs(parseSitemapLocs(body), P.docs.origin, P.docs.basePath);
      return frag(fetched, { t: "sitemap", ...s, ev: ev(fetched, { location: "sitemap.xml" }) });
    }
    case "govuk-docs-component":
      return frag(fetched, { t: "docs-component", docSlug: meta.docSlug as string, data: P.docs.format === "md" ? parseComponentDoc(body) : parseNhsComponentDoc(body), ev: ev(fetched) });
    case "govuk-docs-pattern":
      return frag(fetched, { t: "docs-pattern", docSlug: meta.docSlug as string, data: P.docs.format === "md" ? parsePatternDoc(body) : parseNhsPatternDoc(body), ev: ev(fetched) });
    case "govuk-readme": {
      const r = parseReadme(body);
      return frag(fetched, { t: "readme", name, title: r.title, guidance: r.guidance, ev: ev(fetched) });
    }
    case "govuk-params": {
      // Body is the YAML at the release tag, or a macro-options.json (primary for NHS, fallback for GOV.UK).
      const isJson = body.trimStart().startsWith("[");
      const data = isJson ? parseMacroOptionsJson(body) : parseParamsYaml(body);
      const servedFallback = isJson && !!meta.fallback && !result.url.startsWith(RAW_GITHUB);
      return frag(fetched, { t: "params", name, data, fromTag: !isJson, version, ev: servedFallback ? fallbackEv(fetched) : ev(fetched) }, data.format === "invalid" ? [`${name}: macro options could not be parsed`] : undefined);
    }
    case "govuk-template": {
      const fromTag = result.url.startsWith(RAW_GITHUB);
      return frag(fetched, { t: "template", name, data: parseTemplate(body), fromTag, ev: !fromTag && meta.fallback ? fallbackEv(fetched) : ev(fetched) });
    }
    case "govuk-macro":
      return frag(fetched, { t: "macro", name, macroName: parseMacroNjk(body), ev: ev(fetched) });
    case "govuk-styles":
      return frag(fetched, { t: "styles", name, file: meta.file as string, data: analyseComponentScss(body, P.prefix), ev: ev(fetched) });
    case "govuk-js":
      return frag(fetched, { t: "js", name, data: parseComponentJs(body), ev: ev(fetched) });
    case "govuk-html-example": {
      const html = P.htmlExample === "fixtures" ? defaultFixtureHtml(body) : body.trim() || null;
      return frag(fetched, { t: "html-example", name, html: html && html.length <= MAX_HTML_EXAMPLE ? html : null, version, ev: ev(fetched, P.htmlExample === "fixtures" ? { location: `${meta.file as string}#fixtures[name="default"].html` } : {}) });
    }
    case "govuk-settings": {
      const settingsFile = meta.settingsFile as string;
      const entryComments = !!P.settingsFiles.find((s) => s.file === settingsFile)?.entryComments;
      const data = parseSettingsFile(body, { entryComments, prefix: P.prefix });
      return frag(fetched, { t: "settings", file: settingsFile, set: meta.set as TokenSetKey, order: meta.order as number, data, version, ev: ev(fetched) }, data.tokens.length ? undefined : [`${settingsFile}: no tokens parsed`]);
    }
    case "govuk-css":
      return frag(fetched, { t: "css", customProperties: declaredCustomProperties(body, P.prefix), ev: ev(fetched) });
    case "govuk-macros":
      return frag(fetched, { t: "macros", macros: parsePrototypeKitConfig(body), ev: ev(fetched) });
    case "govuk-colours-json":
      return frag(fetched, { t: "colours-json", colours: parseDocsColours(body), ev: ev(fetched) });
    case "govuk-lifecycle":
      return frag(fetched, { t: "lifecycle", rules: parseLifecyclePage(body), ev: ev(fetched) });
    case "govuk-home":
      return frag(fetched, { t: "home", data: P.docs.format === "md" ? parseHome(body) : parseNhsHome(body), ev: ev(fetched) });
    case "govuk-principles": {
      const p = P.principles.kind === "govuk-content-api" ? parsePrinciplesApi(body) : parseNhsPrinciples(body);
      const location = P.principles.kind === "govuk-content-api" ? `${meta.file as string} details.body h2` : `${meta.file as string} (h2 headings)`;
      return frag(fetched, { t: "principles", ...p, ev: ev(fetched, { location }) });
    }
    default:
      return null;
  }
}

/* --------------------------------- adapter ---------------------------------- */

export const adapter: SourceAdapter = {
  id: ADAPTER_ID,
  version: "1.1.2", // deep-1 audit: guidance sentences keep the sentence(s) they depend on
  systems: PROFILES.map((p) => p.systemSlug),
  description:
    "GOV.UK Frontend family. GOV.UK Design System: alphagov/govuk-design-system Markdown docs + sitemap, govuk-frontend component YAML at the release tag, govuk-frontend npm package (templates, stylesheets, JS, HTML fixtures, settings SCSS tokens, compiled CSS, prototype-kit macros), GOV.UK Content API principles. NHS design system: nhsuk-service-manual page templates + sitemap, nhsuk-frontend npm package (macro options, macros, templates at the release tag, stylesheets, JS, fixtures, settings SCSS, compiled CSS). npm via jsDelivr, pinned to latest.",
  discover,
  fetch: fetchDoc,
  parse,
  async normalize(ctx, fragments) {
    const P = profileOf(ctx);
    const { bundle, warnings, colourMismatches } = normalizeGovuk(ctx.systemSlug, fragments, { limit: ctx.limit, profile: P });
    colourChecks.set(bundle, colourMismatches);
    for (const w of warnings.slice(0, 20)) ctx.log.warn(w);
    ctx.log.info(`${P.id} normalized: ${bundle.components.length} components, ${bundle.tokenSets.reduce((n, s) => n + s.tokens.length, 0)} tokens, ${bundle.patterns.length} patterns`);
    return bundle;
  },
  validate(ctx: AdapterContext, bundle: NormalizedBundle): ValidationIssue[] {
    return validateGovuk(bundle, { limit: ctx.limit, profile: profileOf(ctx) });
  },
};
