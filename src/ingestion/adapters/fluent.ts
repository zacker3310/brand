/**
 * "fluent" source adapter: Microsoft Fluent 2 ("fluent-2", the design guidance catalog),
 * Fluent UI React v9 ("fluent-ui-react") and Fluent UI Web Components ("fluent-ui-web-components").
 * One adapter, three bundles (switch on ctx.systemSlug).
 *
 * Sources (first-party, machine-readable first, static parsing only — nothing fetched is executed):
 *  fluent-ui-react
 *   - npm @fluentui/react-components (version = npm `latest`), its package.json dependency ranges
 *     resolved to exact per-component package versions (data.jsdelivr.com resolve API), and each
 *     package's dist/index.d.ts (props, TSDoc) via cdn.jsdelivr.net.
 *   - storybooks.fluentui.dev/react/index.json (Storybook story index: docs pages, story ids).
 *   - github.com/microsoft/fluentui @ tag "@fluentui/react-components_v<version>" (raw.githubusercontent.com):
 *     story index files, ComponentDescription.md / BestPractices.md / A11y.md, AccessibilitySpec.mdx.
 *  fluent-ui-web-components
 *   - npm @fluentui/web-components dist/web-components.d.ts (custom element classes + definitions),
 *     README.md; storybooks.fluentui.dev/web-components/index.json for docs URLs.
 *  fluent-2
 *   - fluent2.microsoft.design (robots.txt: allow all; statically rendered Astro pages): navigation
 *     island props (component catalog), component usage pages, principles, develop, design tokens,
 *     UX framework pages (patterns).
 *  tokens (all three systems)
 *   - npm @fluentui/tokens lib/**.js (the package @fluentui/react-theme re-exports and
 *     @fluentui/web-components depends on), read with a whitelisted static interpreter.
 */
import type { EvidenceInput, NormalizedBundle, NormalizedSystemFacts, ValidationIssue } from "@/lib/contracts";
import { npmLatest, type FetchResult } from "../http";
import type { AdapterContext, DiscoveredDocument, FetchedDocument, ParsedFragment, SourceAdapter } from "../types";
import { customElementsOf, defaultOf, hasTag, literalValues, memberDescription, parseDts, reactComponentsOf, docTag, type DtsFile, type PropMember } from "./fluent/dts";
import { componentEntries, parseF2Page, parseNav } from "./fluent/f2-html";
import { pick, type ExtractedProp, type FluentFragment, type NpmInfo, type ReactComponentLite, type WcElementLite } from "./fluent/fragments";
import { descriptionText, parseA11ySpec, parseBestPractices } from "./fluent/markdown";
import { f2Facts, normalizeF2 } from "./fluent/normalize-f2";
import { normalizeReact, reactPhilosophy } from "./fluent/normalize-react";
import { normalizeWc } from "./fluent/normalize-wc";
import { parseStoriesFile, parseStoryIndex, reactA11ySpecPages, reactComponentPages, type A11ySpecPage, type ReactDocPage } from "./fluent/storybook";
import { buildFluentTokenSets, moduleImports, ENTRY_MODULE, type TokenModuleSource } from "./fluent/tokens";
import {
  ADAPTER_ID,
  F2_ORIGIN,
  PKG,
  REPO_URL,
  SB_REACT,
  SB_WC,
  SYSTEMS,
  clip,
  evidence,
  leadSentences,
  npmFile,
  npmPage,
  reactReleaseTag,
  repoBlob,
  repoRaw,
  sortBy,
  uniq,
  type FluentSystem,
  type Prov,
} from "./fluent/shared";

const VERSION = "1.0.1";

/* ------------------------------ run-scoped cache ------------------------------ */
// Documents fetched during discover() (story index, nav page, probe files) are reused by fetch().
const prefetched = new Map<string, { run: string; result: FetchResult }>();

async function getRemember(ctx: AdapterContext, url: string): Promise<FetchResult> {
  const hit = prefetched.get(url);
  if (hit && hit.run === ctx.runStartedAt) return hit.result;
  const res = await ctx.http.get(url, { signal: ctx.signal, maxBytes: 20 * 1024 * 1024 });
  for (const [k, v] of prefetched) if (v.run !== ctx.runStartedAt) prefetched.delete(k);
  if (res.ok && res.body !== null) prefetched.set(url, { run: ctx.runStartedAt, result: res });
  return res;
}

async function getJson<T>(ctx: AdapterContext, url: string): Promise<T | null> {
  const res = await getRemember(ctx, url);
  if (!res.ok || !res.body) return null;
  try {
    return JSON.parse(res.body) as T;
  } catch {
    return null;
  }
}

/** Exact version satisfying an npm range, via the jsDelivr resolve API (no npm packument download). */
async function resolveVersion(ctx: AdapterContext, pkg: string, specifier: string): Promise<string | null> {
  const d = await getJson<{ version?: string | null }>(ctx, `https://data.jsdelivr.com/v1/packages/npm/${pkg}/resolved?specifier=${encodeURIComponent(specifier)}`);
  return d?.version ?? null;
}

async function npmInfo(ctx: AdapterContext, pkg: string): Promise<NpmInfo> {
  const npm = await npmLatest(ctx.http, pkg);
  if (!npm.ok || !npm.latest) throw new Error(`npm metadata for ${pkg} unavailable (${npm.status} ${npm.error ?? ""})`);
  return { pkg, version: npm.latest, publishedAt: npm.publishedAt, license: npm.license, deprecated: npm.deprecated, url: npm.url };
}

/* --------------------------------- discover --------------------------------- */

interface Meta extends Record<string, unknown> {
  system: FluentSystem;
  file: string;
}

const pkgSource = (pkg: string) => ({ kind: "package", url: npmPage(pkg), label: pkg });
const repoSource = { kind: "repository", url: REPO_URL, label: "microsoft/fluentui" };

function tokensDoc(system: FluentSystem, version: string, via: string | null): DiscoveredDocument {
  const url = npmFile(PKG.tokens, version, ENTRY_MODULE);
  return { url, evidenceUrl: url, docKind: "fluent-tokens", source: pkgSource(PKG.tokens), title: `${PKG.tokens}@${version}`, priority: 3, meta: { system, file: ENTRY_MODULE, pkg: PKG.tokens, version, via } satisfies Meta };
}

async function discoverReact(ctx: AdapterContext): Promise<DiscoveredDocument[]> {
  const system: FluentSystem = "fluent-ui-react";
  const npm = await npmInfo(ctx, PKG.reactComponents);
  const V = npm.version;
  const pkgJson = await getJson<{ dependencies?: Record<string, string> }>(ctx, npmFile(PKG.reactComponents, V, "package.json"));
  const deps = pkgJson?.dependencies ?? {};
  if (!pkgJson) ctx.log.warn(`fluent: ${PKG.reactComponents}@${V} package.json unavailable; per-package versions resolve from npm latest`);
  const sbUrl = `${SB_REACT}index.json`;
  const sb = await getRemember(ctx, sbUrl);
  if (!sb.ok || !sb.body) throw new Error(`React Storybook index unavailable (${sb.status} ${sb.error ?? ""})`);
  const entries = parseStoryIndex(sb.body);
  let pages: ReactDocPage[] = reactComponentPages(entries);
  if (ctx.limit && ctx.limit > 0) pages = pages.slice(0, ctx.limit);
  const pkgDirs = new Set(pages.map((p) => p.pkgDir));
  const specs: A11ySpecPage[] = reactA11ySpecPages(entries).filter((s) => pkgDirs.has(s.file.split("/")[2] ?? ""));
  const ref = reactReleaseTag(V);
  const probe = pages[0] ? await getRemember(ctx, repoRaw(ref, pages[0].storiesFile)) : null;
  const refOk = !!probe?.ok;
  if (!refOk) ctx.log.warn(`fluent: release tag ${ref} not readable on raw.githubusercontent.com (${probe?.status ?? "-"}); repository docs skipped`);
  const pkgs = uniq(pages.map((p) => p.pkg)).sort();
  const versions = new Map<string, string>();
  await Promise.all(
    pkgs.map(async (pkg) => {
      const spec = deps[pkg] ?? "latest";
      const v = await resolveVersion(ctx, pkg, spec);
      if (v) versions.set(pkg, v);
      else ctx.log.warn(`fluent: could not resolve ${pkg}@${spec}`);
    }),
  );
  // tokens: @fluentui/react-components -> @fluentui/react-theme -> @fluentui/tokens (exact pins)
  let tokensVersion: string | null = null;
  let via: string | null = null;
  const themeVersion = deps[PKG.reactTheme] ? await resolveVersion(ctx, PKG.reactTheme, deps[PKG.reactTheme]!) : null;
  if (themeVersion) {
    const themePkg = await getJson<{ dependencies?: Record<string, string> }>(ctx, npmFile(PKG.reactTheme, themeVersion, "package.json"));
    const tokSpec = themePkg?.dependencies?.[PKG.tokens];
    if (tokSpec) tokensVersion = await resolveVersion(ctx, PKG.tokens, tokSpec);
    via = `${PKG.reactComponents}@${V} -> ${PKG.reactTheme}@${themeVersion} -> ${PKG.tokens}@${tokensVersion ?? tokSpec ?? "?"}`;
  }
  ctx.log.info(`fluent: ${PKG.reactComponents}@${V}, ${pages.length} docs pages, ${versions.size}/${pkgs.length} packages pinned, tokens ${tokensVersion ?? "?"}`);

  const docs: DiscoveredDocument[] = [];
  const base = { system } as const;
  docs.push({ url: sbUrl, evidenceUrl: SB_REACT, docKind: "fluent-sb-index", source: { kind: "docs-site", url: SB_REACT, label: "Fluent UI React Storybook" }, title: "Storybook index.json", priority: 1, meta: { ...base, file: "index.json" } });
  docs.push({ url: npmFile(PKG.reactComponents, V, "dist/index.d.ts"), evidenceUrl: npmFile(PKG.reactComponents, V, "dist/index.d.ts"), docKind: "fluent-react-index-dts", source: pkgSource(PKG.reactComponents), title: `${PKG.reactComponents}@${V} dist/index.d.ts`, priority: 2, meta: { ...base, file: "dist/index.d.ts", npm } });
  docs.push({ url: npmFile(PKG.reactComponents, V, "README.md"), evidenceUrl: npmFile(PKG.reactComponents, V, "README.md"), docKind: "fluent-readme", source: pkgSource(PKG.reactComponents), title: "README.md", priority: 2, meta: { ...base, file: "README.md", role: "react-readme" } });
  for (const pkg of pkgs) {
    const v = versions.get(pkg);
    if (!v) continue;
    const url = npmFile(pkg, v, "dist/index.d.ts");
    docs.push({ url, evidenceUrl: url, docKind: "fluent-react-dts", source: pkgSource(pkg), title: `${pkg}@${v} dist/index.d.ts`, priority: 5, meta: { ...base, file: "dist/index.d.ts", pkg, version: v } });
  }
  if (refOk) {
    pages.forEach((page, i) => {
      docs.push({ url: repoRaw(ref, page.storiesFile), evidenceUrl: repoBlob(ref, page.storiesFile), docKind: "fluent-react-stories", source: repoSource, title: page.title, priority: 10 + i, meta: { ...base, file: page.storiesFile, page, ref } });
    });
    for (const spec of specs) docs.push({ url: repoRaw(ref, spec.file), evidenceUrl: repoBlob(ref, spec.file), docKind: "fluent-react-a11y-spec", source: repoSource, title: `${spec.component} accessibility spec`, priority: 8, meta: { ...base, file: spec.file, spec, ref } });
  }
  if (tokensVersion) docs.push(tokensDoc(system, tokensVersion, via));
  else ctx.log.warn("fluent: @fluentui/tokens version for React not resolved; tokens skipped");
  return docs;
}

async function discoverWc(ctx: AdapterContext): Promise<DiscoveredDocument[]> {
  const system: FluentSystem = "fluent-ui-web-components";
  const npm = await npmInfo(ctx, PKG.webComponents);
  const V = npm.version;
  const pkgJson = await getJson<{ dependencies?: Record<string, string> }>(ctx, npmFile(PKG.webComponents, V, "package.json"));
  const tokSpec = pkgJson?.dependencies?.[PKG.tokens] ?? null;
  const tokensVersion = tokSpec ? await resolveVersion(ctx, PKG.tokens, tokSpec) : null;
  const listing = await getJson<{ files?: { name: string }[] }>(ctx, `https://data.jsdelivr.com/v1/packages/npm/${PKG.webComponents}@${V}?structure=flat`);
  const distDirs = uniq((listing?.files ?? []).map((f) => /^\/dist\/esm\/([a-z0-9-]+)\/define\.js$/.exec(f.name)?.[1]).filter((x): x is string => !!x)).sort();
  ctx.log.info(`fluent: ${PKG.webComponents}@${V}, ${distDirs.length} element directories, tokens ${tokensVersion ?? "?"}`);
  const base = { system } as const;
  const dts = npmFile(PKG.webComponents, V, "dist/web-components.d.ts");
  const docs: DiscoveredDocument[] = [
    { url: dts, evidenceUrl: dts, docKind: "fluent-wc-dts", source: pkgSource(PKG.webComponents), title: `${PKG.webComponents}@${V} dist/web-components.d.ts`, priority: 2, meta: { ...base, file: "dist/web-components.d.ts", npm, distDirs } },
    { url: npmFile(PKG.webComponents, V, "README.md"), evidenceUrl: npmFile(PKG.webComponents, V, "README.md"), docKind: "fluent-readme", source: pkgSource(PKG.webComponents), title: "README.md", priority: 2, meta: { ...base, file: "README.md", role: "wc-readme" } },
    { url: `${SB_WC}index.json`, evidenceUrl: SB_WC, docKind: "fluent-sb-index", source: { kind: "docs-site", url: SB_WC, label: "Fluent UI Web Components Storybook" }, title: "Storybook index.json", priority: 1, meta: { ...base, file: "index.json" } },
  ];
  if (tokensVersion) docs.push(tokensDoc(system, tokensVersion, `${PKG.webComponents}@${V} dependency ${PKG.tokens}@${tokSpec}`));
  return docs;
}

const F2_CONTENT: [string, string][] = [
  ["/", "home"],
  ["/design-principles/", "principles"],
  ["/get-started/develop/", "develop"],
  ["/design-tokens/", "design-tokens"],
];

async function discoverF2(ctx: AdapterContext): Promise<DiscoveredDocument[]> {
  const system: FluentSystem = "fluent-2";
  const navUrl = `${F2_ORIGIN}/components/web/react/`;
  const navRes = await getRemember(ctx, navUrl);
  if (!navRes.ok || !navRes.body) throw new Error(`Fluent 2 navigation page unavailable (${navRes.status} ${navRes.error ?? ""})`);
  const groups = parseNav(navRes.body);
  let entries = sortBy(componentEntries(groups), (e) => e.url);
  if (ctx.limit && ctx.limit > 0) {
    const keys = uniq(entries.map((e) => e.title.toLowerCase())).sort().slice(0, ctx.limit);
    entries = entries.filter((e) => keys.includes(e.title.toLowerCase()));
  }
  const tokens = await npmInfo(ctx, PKG.tokens);
  const site = { kind: "docs-site", url: `${F2_ORIGIN}/`, label: "fluent2.microsoft.design" };
  const base = { system } as const;
  const docs: DiscoveredDocument[] = [{ url: navUrl, evidenceUrl: navUrl, docKind: "fluent-f2-nav", source: site, title: "Fluent 2 navigation", priority: 1, meta: { ...base, file: "/components/web/react/" } }];
  entries.forEach((e, i) => docs.push({ url: e.url, evidenceUrl: e.url, docKind: "fluent-f2-page", source: site, title: `${e.title} (${e.library})`, priority: 10 + i, meta: { ...base, file: new URL(e.url).pathname, entry: e } }));
  for (const [path, role] of F2_CONTENT) docs.push({ url: `${F2_ORIGIN}${path}`, evidenceUrl: `${F2_ORIGIN}${path}`, docKind: "fluent-f2-content", source: site, title: path, priority: 5, meta: { ...base, file: path, role, navTitle: null } });
  const ux = groups.find((g) => /^UX frameworks/i.test(g.title));
  for (const p of ux?.pages ?? []) {
    if (/design tokens/i.test(p.title)) continue;
    const url = new URL(p.href.endsWith("/") ? p.href : `${p.href}/`, F2_ORIGIN).toString();
    docs.push({ url, evidenceUrl: url, docKind: "fluent-f2-content", source: site, title: p.title, priority: 6, meta: { ...base, file: new URL(url).pathname, role: "pattern", navTitle: p.title } });
  }
  docs.push(tokensDoc(system, tokens.version, null));
  ctx.log.info(`fluent: Fluent 2 nav ${entries.length} component pages, ${ux?.pages.length ?? 0} UX framework pages, tokens ${tokens.version}`);
  return docs;
}

/* ---------------------------------- parse ----------------------------------- */

function prov(fetched: FetchedDocument): Prov {
  const { doc, result } = fetched;
  return { sourceUrl: doc.evidenceUrl ?? result.finalUrl ?? doc.url, retrievedAt: result.fetchedAt, contentHash: result.hash, file: (doc.meta?.file as string | undefined) ?? new URL(doc.url).pathname };
}

function extractProp(m: PropMember, file: DtsFile): ExtractedProp {
  return {
    name: m.name,
    type: m.type,
    optional: m.optional,
    slot: m.slot,
    defaultValue: defaultOf(m.doc),
    deprecated: hasTag(m.doc, "deprecated"),
    description: clip(memberDescription(m.doc), 560),
    allowedValues: literalValues(m.type, file),
    origin: m.origin,
  };
}

export function reactDtsComponents(src: string): ReactComponentLite[] {
  const file = parseDts(src);
  return reactComponentsOf(file).map((c) => ({
    name: c.name,
    summary: c.doc?.summary ? c.doc.summary.replace(/\s+/g, " ").trim() : null,
    deprecated: docTag(c.doc, "deprecated") ?? (hasTag(c.doc, "deprecated") ? "deprecated" : null),
    propsType: c.propsType,
    props: c.members.map((m) => extractProp(m, file)),
    unresolved: c.unresolved,
    primarySlots: c.primarySlots,
    internal: c.internal,
    line: c.line,
  }));
}

export function wcDtsElements(src: string): WcElementLite[] {
  const file = parseDts(src);
  return customElementsOf(file).map((el) => {
    const chainDocs = el.chain.map((n) => (file.decls.get(n) ?? []).find((d) => d.kind === "class")?.doc?.raw ?? "");
    return {
      className: el.className,
      tagName: el.tagName,
      summary: el.doc?.summary ? el.doc.summary.replace(/\s+/g, " ").trim() : null,
      rawDocs: chainDocs.slice(0, 1),
      chain: el.chain,
      props: el.members.map((m) => ({
        name: m.name,
        type: m.type,
        optional: m.optional,
        slot: false,
        defaultValue: defaultOf(m.doc) ?? (m.init && /^(['"]).*\1$|^-?\d+(\.\d+)?$|^(true|false)$/.test(m.init) ? m.init.replace(/^['"]|['"]$/g, "") : null),
        deprecated: hasTag(m.doc, "deprecated"),
        description: clip(memberDescription(m.doc), 560),
        allowedValues: literalValues(m.type, file),
        origin: m.declaredIn.replace(/_\d+$/, ""),
        attribute: m.attribute,
        readonly: m.readonly,
      })),
      slots: el.slots.map((s) => (s.startsWith("-") || !s ? "(default)" : s)).filter((s, i, a) => a.indexOf(s) === i),
      events: el.events,
      cssParts: el.cssParts,
      deprecated: docTag(el.doc, "deprecated"),
      line: el.line,
    };
  });
}

/** Short source statements used for facts (each becomes an evidence excerpt). */
export function readmeStatements(role: string, md: string): Record<string, string | null> {
  const sentence = (re: RegExp) => {
    for (const block of md.replace(/```[\s\S]*?```/g, " ").split(/\n\s*\n/)) {
      const t = block.replace(/[*_`#>]/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/\s+/g, " ").trim();
      if (re.test(t)) return leadSentences(t, 280);
    }
    return null;
  };
  if (role === "react-readme") return { suite: sentence(/suite package for converged components/i), provider: sentence(/FluentProvider/) };
  if (role === "wc-readme") return { purpose: sentence(/build web apps using Web Components/i), tokens: sentence(/styled using tokens in the form of CSS variables/i), themes: sentence(/setTheme/) };
  return {};
}

async function fetchTokenModules(ctx: AdapterContext, pkg: string, version: string, entry: { text: string; prov: Prov }): Promise<{ modules: TokenModuleSource[]; warnings: string[] }> {
  const modules: TokenModuleSource[] = [{ path: ENTRY_MODULE, text: entry.text, prov: entry.prov }];
  const warnings: string[] = [];
  const seen = new Set([ENTRY_MODULE]);
  let frontier = moduleImports(ENTRY_MODULE, entry.text);
  while (frontier.length && seen.size < 120) {
    const batch = frontier.filter((p) => !seen.has(p) && p.startsWith("lib/"));
    batch.forEach((p) => seen.add(p));
    const next: string[] = [];
    await Promise.all(
      batch.map(async (path) => {
        const url = npmFile(pkg, version, path);
        const res = await ctx.http.get(url, { signal: ctx.signal });
        if (!res.ok || res.body === null) {
          warnings.push(`${path}: HTTP ${res.status} ${res.error ?? ""}`);
          return;
        }
        modules.push({ path, text: res.body, prov: { sourceUrl: url, retrievedAt: res.fetchedAt, contentHash: res.hash, file: path } });
        next.push(...moduleImports(path, res.body));
      }),
    );
    frontier = uniq(next).sort();
  }
  return { modules: sortBy(modules, (m) => m.path), warnings };
}

async function parseDoc(ctx: AdapterContext, fetched: FetchedDocument): Promise<FluentFragment | null> {
  const { doc, result } = fetched;
  const body = result.body ?? "";
  const meta = doc.meta as Meta & Record<string, unknown>;
  const p = prov(fetched);
  switch (doc.docKind) {
    case "fluent-sb-index":
      return { kind: "sb-index", prov: p, system: meta.system, entries: parseStoryIndex(body).map((e) => ({ ...e, tags: [] })) };
    case "fluent-react-index-dts": {
      const file = parseDts(body);
      const reexports: Record<string, string> = {};
      for (const [local, imp] of file.imports) if (imp.from.startsWith("@fluentui/")) reexports[local] = imp.from;
      return { kind: "react-index-dts", prov: p, npm: meta.npm as NpmInfo, reexports };
    }
    case "fluent-react-dts":
      return { kind: "react-dts", prov: p, pkg: meta.pkg as string, version: meta.version as string, components: reactDtsComponents(body) };
    case "fluent-react-stories": {
      const page = meta.page as ReactDocPage;
      const ref = meta.ref as string;
      const sm = parseStoriesFile(body);
      const dir = page.storiesFile.replace(/\/[^/]+$/, "");
      const linked = async (re: RegExp) => {
        const imp = sm.mdImports.find((m) => re.test(m.file));
        if (!imp) return null;
        const path = `${dir}/${imp.file}`;
        const res = await ctx.http.get(repoRaw(ref, path), { signal: ctx.signal });
        if (!res.ok || res.body === null) return null;
        return { prov: { sourceUrl: repoBlob(ref, path), retrievedAt: res.fetchedAt, contentHash: res.hash, file: path } satisfies Prov, text: res.body };
      };
      const [desc, bp, a11y] = await Promise.all([linked(/Description\.mdx?$/), linked(/BestPractices\.mdx?$/), linked(/(A11y|Accessibility)\.mdx?$/)]);
      const text = desc ? descriptionText(desc.text) : null;
      return {
        kind: "react-stories",
        prov: p,
        page,
        ref,
        meta: sm,
        description: desc && text ? { prov: desc.prov, text } : null,
        bestPractices: bp ? { prov: bp.prov, data: parseBestPractices(bp.text) } : null,
        a11yMd: a11y ? { prov: a11y.prov, data: parseBestPractices(a11y.text) } : null,
      };
    }
    case "fluent-react-a11y-spec":
      return { kind: "react-a11y-spec", prov: p, page: meta.spec as A11ySpecPage, spec: parseA11ySpec(body) };
    case "fluent-wc-dts":
      return { kind: "wc-dts", prov: p, npm: meta.npm as NpmInfo, elements: wcDtsElements(body), distDirs: (meta.distDirs as string[]) ?? [] };
    case "fluent-readme":
      return { kind: "readme", prov: p, system: meta.system, statements: readmeStatements(meta.role as string, body) };
    case "fluent-tokens": {
      const pkg = meta.pkg as string;
      const version = meta.version as string;
      const { modules, warnings } = await fetchTokenModules(ctx, pkg, version, { text: body, prov: p });
      const built = buildFluentTokenSets({ pkg, version, modules, via: (meta.via as string | null) ?? null });
      return { kind: "tokens", prov: p, pkg, version, sets: built.sets, warnings: [...warnings, ...built.warnings], themes: built.themes };
    }
    case "fluent-f2-nav":
      return { kind: "f2-nav", prov: p, groups: parseNav(body) };
    case "fluent-f2-page":
      return { kind: "f2-page", prov: p, entry: meta.entry as never, page: parseF2Page(body, doc.url) };
    case "fluent-f2-content":
      return { kind: "f2-content", prov: p, role: meta.role as string, navTitle: (meta.navTitle as string | null) ?? null, page: parseF2Page(body, doc.url) };
    default:
      return null;
  }
}

/* --------------------------------- normalize --------------------------------- */

function npmEvidence(npm: NpmInfo, field: string, excerpt: string, retrievedAt: string): EvidenceInput {
  return {
    field,
    sourceUrl: npm.url,
    sourceTitle: `${npm.pkg} on npm`,
    retrievedAt,
    contentHash: null,
    extractionMethod: `adapter:${ADAPTER_ID}:npm-registry`,
    location: `https://registry.npmjs.org/${npm.pkg.replace("/", "%2F")}#/dist-tags/latest`,
    excerpt,
    state: "verified",
    confidence: 0.95,
  };
}

function normalizeBundle(ctx: AdapterContext, frags: FluentFragment[]): NormalizedBundle {
  const system = ctx.systemSlug as FluentSystem;
  const tokenFrag = pick(frags, "tokens")[0] ?? null;
  const tokenSets = tokenFrag ? tokenFrag.sets : [];
  if (tokenFrag?.warnings.length) ctx.log.warn(`fluent: ${tokenFrag.warnings.length} token notes`, { sample: tokenFrag.warnings.slice(0, 6) });
  const readme = pick(frags, "readme")[0] ?? null;
  let facts: NormalizedSystemFacts;
  if (system === "fluent-ui-react") {
    const res = normalizeReact(frags, { limit: ctx.limit });
    if (res.warnings.length) ctx.log.warn(`fluent: ${res.warnings.length} React normalization notes`, { sample: res.warnings.slice(0, 8) });
    const idx = pick(frags, "react-index-dts")[0];
    const ev: EvidenceInput[] = [];
    if (idx) {
      ev.push(npmEvidence(idx.npm, "latestVersion", `dist-tags.latest = ${idx.npm.version}${idx.npm.publishedAt ? `, published ${idx.npm.publishedAt}` : ""}`, ctx.runStartedAt));
      if (idx.npm.publishedAt) ev.push(npmEvidence(idx.npm, "latestReleaseAt", `time["${idx.npm.version}"] = ${idx.npm.publishedAt}`, ctx.runStartedAt));
      ev.push(evidence(idx.prov, "frameworks", "dts-reexports", { location: "dist/index.d.ts", excerpt: `${Object.keys(idx.reexports).length} exports re-exported from ${uniq(Object.values(idx.reexports)).length} @fluentui packages` }));
    }
    const philosophy = reactPhilosophy(readme?.statements ?? null);
    if (philosophy && readme) {
      for (const k of ["suite", "provider"]) if (readme.statements[k]) ev.push(evidence(readme.prov, "philosophy", "readme", { excerpt: readme.statements[k] }));
    }
    facts = {
      latestVersion: idx?.npm.version ?? null,
      latestReleaseAt: idx?.npm.publishedAt ?? null,
      philosophy,
      principles: null,
      frameworks: idx ? [{ slug: "react", packageName: PKG.reactComponents }] : null,
      evidence: ev,
    };
    return { systemSlug: system, components: res.components, tokenSets, patterns: [], facts };
  }
  if (system === "fluent-ui-web-components") {
    const res = normalizeWc(frags, { limit: ctx.limit });
    if (res.warnings.length) ctx.log.warn(`fluent: ${res.warnings.length} web-components notes`, { sample: res.warnings.slice(0, 8) });
    const d = pick(frags, "wc-dts")[0];
    const ev: EvidenceInput[] = [];
    if (d) {
      ev.push(npmEvidence(d.npm, "latestVersion", `dist-tags.latest = ${d.npm.version}${d.npm.publishedAt ? `, published ${d.npm.publishedAt}` : ""}`, ctx.runStartedAt));
      if (d.npm.publishedAt) ev.push(npmEvidence(d.npm, "latestReleaseAt", `time["${d.npm.version}"] = ${d.npm.publishedAt}`, ctx.runStartedAt));
      ev.push(evidence(d.prov, "frameworks", "dts-custom-element", { location: "dist/web-components.d.ts", excerpt: `${d.elements.length} custom element definitions` }));
    }
    const st = readme?.statements ?? {};
    const parts: string[] = [];
    if (st.purpose) parts.push("Fluent UI Web Components (@fluentui/web-components) implements the Fluent design language as framework-agnostic Web Components.");
    if (st.tokens) parts.push("Components are styled with design tokens exposed as CSS custom properties, provided by a theme (for example webLightTheme or webDarkTheme) applied with setTheme.");
    if (readme) for (const k of ["purpose", "tokens"]) if (st[k]) ev.push(evidence(readme.prov, "philosophy", "readme", { excerpt: st[k] }));
    facts = {
      latestVersion: d?.npm.version ?? null,
      latestReleaseAt: d?.npm.publishedAt ?? null,
      philosophy: parts.length ? parts.join(" ") : null,
      principles: null,
      frameworks: d ? [{ slug: "web-components", packageName: PKG.webComponents }] : null,
      evidence: ev,
    };
    return { systemSlug: system, components: res.components, tokenSets, patterns: [], facts };
  }
  const res = normalizeF2(frags, { limit: ctx.limit });
  if (res.warnings.length) ctx.log.warn(`fluent: ${res.warnings.length} Fluent 2 notes`, { sample: res.warnings.slice(0, 8) });
  facts = f2Facts(frags);
  return { systemSlug: system, components: res.components, tokenSets, patterns: res.patterns, facts };
}

/* ---------------------------------- adapter ---------------------------------- */

export const adapter: SourceAdapter = {
  id: ADAPTER_ID,
  version: VERSION,
  systems: [...SYSTEMS],
  description:
    "Fluent 2 + Fluent UI React v9 + Fluent UI Web Components: fluent2.microsoft.design static pages (nav catalog, usage guidance, principles); @fluentui/react-* dist/index.d.ts props + Storybook index + microsoft/fluentui story docs and accessibility specs at the release tag; @fluentui/web-components declaration roll-up; @fluentui/tokens lib modules (static interpreter).",

  async discover(ctx) {
    const system = ctx.systemSlug as FluentSystem;
    if (!SYSTEMS.includes(system)) throw new Error(`fluent adapter does not handle ${ctx.systemSlug}`);
    if (system === "fluent-ui-react") return discoverReact(ctx);
    if (system === "fluent-ui-web-components") return discoverWc(ctx);
    return discoverF2(ctx);
  },

  async fetch(ctx, doc, prevState) {
    const hit = prefetched.get(doc.url);
    if (hit && hit.run === ctx.runStartedAt) return hit.result;
    return ctx.http.get(doc.url, { etag: prevState.etag, lastModified: prevState.lastModified, lastHash: prevState.lastHash, signal: ctx.signal, maxBytes: 20 * 1024 * 1024 });
  },

  async parse(ctx, fetched): Promise<ParsedFragment | null> {
    const data = await parseDoc(ctx, fetched);
    if (!data) return null;
    const warnings: string[] = [];
    if (data.kind === "react-dts" && !data.components.length) warnings.push(`${fetched.doc.url}: no component declarations`);
    if (data.kind === "wc-dts" && !data.elements.length) warnings.push(`${fetched.doc.url}: no custom element definitions`);
    if (data.kind === "f2-page" && !data.page.h1) warnings.push(`${fetched.doc.url}: no <h1>`);
    if (data.kind === "tokens") warnings.push(...data.warnings.slice(0, 20));
    return { docUrl: fetched.doc.url, docKind: fetched.doc.docKind, data, warnings };
  },

  async normalize(ctx, fragments) {
    const frags = fragments.map((f) => f.data as FluentFragment).filter((d) => d && typeof d === "object" && "kind" in d);
    if (!frags.length) return { systemSlug: ctx.systemSlug, components: [], tokenSets: [], patterns: [], facts: null };
    return normalizeBundle(ctx, frags);
  },

  validate(ctx, bundle) {
    return validateFluentBundle(ctx.systemSlug, bundle, ctx.limit);
  },
};

/* ---------------------------------- validation ---------------------------------- */

export function validateFluentBundle(system: string, bundle: NormalizedBundle, limit?: number): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const push = (i: Omit<ValidationIssue, "severity"> & { severity?: ValidationIssue["severity"] }) => issues.push({ severity: "error", ...i });
  const slugs = new Set<string>();
  for (const c of bundle.components) {
    if (slugs.has(c.slug)) push({ entityKind: "component", entityKey: c.slug, code: "DUPLICATE", message: `duplicate component slug ${c.slug}` });
    slugs.add(c.slug);
    if (!c.evidence.length) push({ entityKind: "component", entityKey: c.slug, code: "MISSING_EVIDENCE", message: "component without evidence" });
    if (c.description && c.description.length > 400) push({ entityKind: "component", entityKey: c.slug, code: "SUSPICIOUS", message: `description is ${c.description.length} chars`, severity: "warning" });
    const props = new Set<string>();
    for (const p of c.properties) {
      const k = `${p.implementation}:${p.name}`;
      if (props.has(k)) push({ entityKind: "component", entityKey: c.slug, code: "DUPLICATE", message: `duplicate property ${k}`, severity: "warning" });
      props.add(k);
    }
    for (const r of c.relationships) if (r.targetSlug && !bundle.components.some((x) => x.slug === r.targetSlug)) push({ entityKind: "component", entityKey: c.slug, code: "SUSPICIOUS", message: `relationship target ${r.targetSlug} not in bundle`, severity: "warning" });
  }
  const full = !limit;
  if (full) {
    const want = system === "fluent-ui-web-components" ? "button" : system === "fluent-ui-react" ? "button" : "button";
    if (!slugs.has(want)) push({ entityKind: "bundle", entityKey: system, code: "SUSPICIOUS", message: "well-known component Button missing" });
    const min = system === "fluent-ui-react" ? 60 : system === "fluent-ui-web-components" ? 30 : 40;
    const top = system === "fluent-ui-react" ? bundle.components.filter((c) => !c.relationships.some((r) => r.kind === "parent")).length : bundle.components.length;
    if (top < min) push({ entityKind: "bundle", entityKey: system, code: "SUSPICIOUS", message: `only ${top} documented components (expected >= ${min})` });
    if (system === "fluent-ui-react") {
      const withProps = bundle.components.filter((c) => c.properties.length).length;
      if (withProps < bundle.components.length * 0.6) push({ entityKind: "bundle", entityKey: system, code: "SUSPICIOUS", message: `only ${withProps}/${bundle.components.length} components have props`, severity: "warning" });
    }
    if (system === "fluent-2" && bundle.patterns.length < 3) push({ entityKind: "bundle", entityKey: system, code: "SUSPICIOUS", message: `only ${bundle.patterns.length} patterns`, severity: "warning" });
  }
  const setSlugs = new Set<string>();
  for (const s of bundle.tokenSets) {
    if (setSlugs.has(s.slug)) push({ entityKind: "token-set", entityKey: s.slug, code: "DUPLICATE", message: "duplicate token set slug" });
    setSlugs.add(s.slug);
    const names = new Set<string>();
    for (const t of s.tokens) {
      if (names.has(t.name)) push({ entityKind: "token", entityKey: `${s.slug}:${t.name}`, code: "DUPLICATE", message: "duplicate token name in set" });
      names.add(t.name);
      if (t.rawValue === null || t.rawValue === undefined || t.rawValue === "") push({ entityKind: "token", entityKey: `${s.slug}:${t.name}`, code: "INVALID_TOKEN_VALUE", message: "empty raw value", severity: "warning" });
      if (/^color/.test(t.name) && t.cssVar && t.cssVar !== `--${t.name}`) push({ entityKind: "token", entityKey: `${s.slug}:${t.name}`, code: "SUSPICIOUS", message: `cssVar ${t.cssVar} does not match token name`, severity: "warning" });
    }
  }
  const web = bundle.tokenSets.find((s) => s.slug === "fluent-theme-web-light");
  if (!web || web.tokens.length < 300) push({ entityKind: "token-set", entityKey: "fluent-theme-web-light", code: "SUSPICIOUS", message: `web light theme has ${web?.tokens.length ?? 0} tokens (expected >= 300)` });
  const ramp = bundle.tokenSets.find((s) => s.slug === "fluent-global-colors");
  if (!ramp || ramp.tokens.length < 500) push({ entityKind: "token-set", entityKey: "fluent-global-colors", code: "SUSPICIOUS", message: `global colors set has ${ramp?.tokens.length ?? 0} tokens (expected >= 500)` });
  const all = new Set(bundle.tokenSets.flatMap((s) => s.tokens.map((t) => t.name)));
  let dangling = 0;
  for (const s of bundle.tokenSets) for (const t of s.tokens) for (const r of t.references) if (!all.has(r)) dangling++;
  if (dangling) push({ entityKind: "bundle", entityKey: system, code: "SUSPICIOUS", message: `${dangling} token references do not resolve inside the bundle`, severity: "warning" });
  return issues;
}
