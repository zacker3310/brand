/**
 * Test-only in-memory "design system site" and adapter. No network: PoliteFetcher is given
 * `fakeFetch(site)` as fetchImpl. All URLs are under https://fake.example.com (reserved domain).
 *
 * Site layout:
 *   /manifest.json                     -> { docs: [{ path, kind, title }] }
 *   /components/<slug>.json            -> FakeComponentDoc
 *   /tokens/<set>.json                 -> { set, name, theme, tokens: <DTCG tree> }
 *   /patterns/<slug>.json              -> { slug, name, components: [...] }
 *   /facts.json                        -> { latestVersion, ... }
 */
import { createHash } from "node:crypto";
import type { NormalizedBundle, NormalizedComponent, NormalizedPattern, NormalizedTokenSet } from "@/lib/contracts";
import type { DiscoveredDocument, ParsedFragment, SourceAdapter } from "@/ingestion/types";
import { flattenTokenTree, toNormalizedToken } from "@/lib/tokens/tree";

export const FAKE_ORIGIN = "https://fake.example.com";

export interface FakeSite {
  files: Map<string, string>;
  /** Paths that respond with this HTTP status instead of content. */
  failures: Map<string, number>;
  /** Every request path in order (robots.txt included). */
  requests: { path: string; conditional: boolean; status: number }[];
}

export function createFakeSite(files: Record<string, unknown>): FakeSite {
  const site: FakeSite = { files: new Map(), failures: new Map(), requests: [] };
  for (const [p, v] of Object.entries(files)) setFile(site, p, v);
  return site;
}

export function setFile(site: FakeSite, path: string, value: unknown) {
  site.files.set(path, typeof value === "string" ? value : JSON.stringify(value, null, 2));
}

const etagOf = (body: string) => `"${createHash("sha1").update(body).digest("hex").slice(0, 16)}"`;

export function fakeFetch(site: FakeSite): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const headers = new Headers(init?.headers);
    const inm = headers.get("if-none-match");
    const p = url.pathname;
    const record = (status: number) => site.requests.push({ path: p, conditional: !!inm, status });
    if (url.origin !== FAKE_ORIGIN) {
      record(404);
      return new Response("not found", { status: 404 });
    }
    if (p === "/robots.txt") {
      record(404);
      return new Response("no robots", { status: 404, headers: { "content-type": "text/plain" } });
    }
    const failure = site.failures.get(p);
    if (failure) {
      record(failure);
      return new Response(`error ${failure}`, { status: failure });
    }
    const body = site.files.get(p);
    if (body === undefined) {
      record(404);
      return new Response("not found", { status: 404 });
    }
    const etag = etagOf(body);
    if (inm && inm === etag) {
      record(304);
      return new Response(null, { status: 304, headers: { etag } });
    }
    record(200);
    return new Response(body, { status: 200, headers: { "content-type": "application/json", etag } });
  }) as typeof fetch;
}

export interface FakeComponentDoc {
  name: string;
  slug?: string;
  description?: string;
  canonicalType?: string;
  docsUrl?: string;
  variants?: string[];
  states?: string[];
  props?: { name: string; type?: string; default?: string; required?: boolean }[];
  related?: string[];
  tokens?: string[];
  frameworks?: string[];
  a11y?: { keyboard?: { keys: string; action: string }[]; guidance?: string };
  examples?: { slug: string; title: string; code?: string }[];
}

export interface FakeTokenDoc {
  set: string;
  name: string;
  theme?: string | null;
  tokens: Record<string, unknown>;
}

export interface FakePatternDoc {
  slug: string;
  name: string;
  description?: string;
  components?: string[];
}

export interface FakeSiteSpec {
  components?: FakeComponentDoc[];
  tokenSets?: FakeTokenDoc[];
  patterns?: FakePatternDoc[];
  facts?: Record<string, unknown> | null;
}

const slugOf = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Build the file map for a site from a spec (manifest generated). */
export function siteFiles(spec: FakeSiteSpec): Record<string, unknown> {
  const files: Record<string, unknown> = {};
  const docs: { path: string; kind: string; title: string }[] = [];
  for (const c of spec.components ?? []) {
    const path = `/components/${c.slug ?? slugOf(c.name)}.json`;
    files[path] = c;
    docs.push({ path, kind: "component", title: c.name });
  }
  for (const t of spec.tokenSets ?? []) {
    const path = `/tokens/${t.set}.json`;
    files[path] = t;
    docs.push({ path, kind: "tokens", title: t.name });
  }
  for (const p of spec.patterns ?? []) {
    const path = `/patterns/${p.slug}.json`;
    files[path] = p;
    docs.push({ path, kind: "pattern", title: p.name });
  }
  if (spec.facts) {
    files["/facts.json"] = spec.facts;
    docs.push({ path: "/facts.json", kind: "facts", title: "Facts" });
  }
  files["/manifest.json"] = { docs };
  return files;
}

export function applySpec(site: FakeSite, spec: FakeSiteSpec) {
  site.files.clear();
  for (const [p, v] of Object.entries(siteFiles(spec))) setFile(site, p, v);
}

export interface FakeAdapterOptions {
  systems: string[];
  version?: string;
  /** Throw from parse() for documents whose path matches. */
  failParse?: RegExp;
}

/** A small but real adapter: discovers from the manifest, parses JSON, normalizes to the contract. */
export function createFakeAdapter(opts: FakeAdapterOptions): SourceAdapter & { parseCalls: string[] } {
  const parseCalls: string[] = [];
  const adapter: SourceAdapter & { parseCalls: string[] } = {
    id: "fake",
    version: opts.version ?? "1.0.0",
    systems: opts.systems,
    description: "test-only fake adapter (in-memory site)",
    parseCalls,
    async discover(ctx) {
      const { data } = await ctx.http.getJson<{ docs: { path: string; kind: string; title: string }[] }>(`${FAKE_ORIGIN}/manifest.json`);
      if (!data) throw new Error("manifest unavailable");
      const docs = data.docs.map((d, i): DiscoveredDocument => ({
        url: `${FAKE_ORIGIN}${d.path}`,
        docKind: d.kind,
        title: d.title,
        source: { kind: "docs", url: `${FAKE_ORIGIN}/`, label: "Fake docs" },
        evidenceUrl: `${FAKE_ORIGIN}/docs${d.path.replace(/\.json$/, "")}`,
        meta: { path: d.path },
        priority: d.kind === "tokens" ? 10 : 50 + i,
      }));
      return ctx.limit ? docs.slice(0, ctx.limit) : docs;
    },
    async parse(ctx, { doc, result }) {
      parseCalls.push(doc.url);
      if (opts.failParse?.test(doc.url)) throw new Error(`synthetic parse failure for ${doc.url}`);
      const data = JSON.parse(result.body ?? "null");
      const frag: ParsedFragment = { docUrl: doc.evidenceUrl ?? doc.url, docKind: doc.docKind, data: { ...data, __hash: result.hash, __retrievedAt: result.fetchedAt ?? ctx.runStartedAt } };
      return frag;
    },
    async normalize(ctx, fragments): Promise<NormalizedBundle> {
      const ev = (f: ParsedFragment, field = "*") => {
        const d = f.data as { __hash?: string; __retrievedAt?: string };
        return { field, sourceUrl: f.docUrl, retrievedAt: d.__retrievedAt ?? ctx.runStartedAt, contentHash: d.__hash ?? null, extractionMethod: "adapter:fake:json", state: "verified" as const, confidence: 0.9 };
      };
      const components: NormalizedComponent[] = [];
      const tokenSets: NormalizedTokenSet[] = [];
      const patterns: NormalizedPattern[] = [];
      let facts: NormalizedBundle["facts"] = null;
      for (const f of fragments) {
        if (f.docKind === "component") {
          const c = f.data as FakeComponentDoc;
          components.push({
            slug: c.slug ?? slugOf(c.name),
            name: c.name,
            aliases: [],
            description: c.description ?? null,
            docsUrl: c.docsUrl ?? f.docUrl,
            sourceCodeUrl: null,
            lifecycle: "stable",
            canonicalType: c.canonicalType ?? null,
            classification: c.canonicalType ? { state: "verified", method: "adapter:fake:declared", confidence: 1 } : null,
            frameworks: (c.frameworks ?? []).map((slug) => ({ slug, packageName: "@fake/ui", importName: c.name.replace(/\s+/g, "") })),
            variants: (c.variants ?? []).map((name) => ({ axis: "variant", name })),
            states: (c.states ?? []).map((name) => ({ name })),
            sizes: null,
            properties: (c.props ?? []).map((p) => ({ implementation: "react", name: p.name, type: p.type ?? null, defaultValue: p.default ?? null, required: p.required ?? null, deprecated: false })),
            accessibility: c.a11y ? { keyboard: c.a11y.keyboard ?? null, guidance: c.a11y.guidance ?? null, coverage: { keyboard: c.a11y.keyboard ? "documented" : "not-documented" } } : null,
            examples: (c.examples ?? []).map((e) => ({ slug: e.slug, title: e.title, kind: "code-snippet" as const, language: "tsx", code: e.code ?? null, url: f.docUrl, attribution: "Fake UI (test fixture)" })),
            relationships: (c.related ?? []).map((targetSlug) => ({ kind: "related", targetSlug })),
            tokenUsages: (c.tokens ?? []).map((tokenName) => ({ tokenName, property: null })),
            responsiveGuidance: null,
            coverage: { variants: c.variants ? "documented" : "not-documented", properties: c.props ? "documented" : "not-documented" },
            evidence: [ev(f)],
          });
        } else if (f.docKind === "tokens") {
          const t = f.data as FakeTokenDoc;
          const flat = flattenTokenTree(t.tokens, { format: "dtcg", location: `tokens/${t.set}.json` });
          tokenSets.push({
            slug: t.set,
            name: t.name,
            theme: t.theme ?? null,
            format: "dtcg",
            sourceUrl: f.docUrl,
            packageName: "@fake/tokens",
            packageVersion: "1.0.0",
            license: null,
            redistribution: "unknown",
            tokens: flat.map((x) => toNormalizedToken(x)),
            evidence: [ev(f)],
          });
        } else if (f.docKind === "pattern") {
          const p = f.data as FakePatternDoc;
          patterns.push({ slug: p.slug, name: p.name, description: p.description ?? null, docsUrl: f.docUrl, canonicalType: null, classification: null, componentSlugs: p.components ?? [], coverage: {}, evidence: [ev(f)] });
        } else if (f.docKind === "facts") {
          const d = f.data as Record<string, unknown>;
          facts = { latestVersion: (d.latestVersion as string) ?? null, philosophy: (d.philosophy as string) ?? null, principles: null, frameworks: null, evidence: [ev(f, "latestVersion"), ...(d.philosophy ? [ev(f, "philosophy")] : [])] };
        }
      }
      return { systemSlug: ctx.systemSlug, components, tokenSets, patterns, facts };
    },
  };
  return adapter;
}

/** A plausible small site used by most pipeline tests. */
export function baseSpec(): FakeSiteSpec {
  return {
    components: [
      {
        name: "Button",
        description: "Triggers an action.",
        variants: ["primary", "secondary"],
        states: ["hover", "disabled"],
        props: [{ name: "variant", type: "'primary' | 'secondary'", default: "primary" }, { name: "disabled", type: "boolean" }],
        related: ["icon-button"],
        tokens: ["color.brand.primary"],
        frameworks: ["react"],
        a11y: { keyboard: [{ keys: "Enter", action: "Activates the button" }] },
        examples: [{ slug: "basic", title: "Basic button", code: "<Button>Save</Button>" }],
      },
      { name: "Icon Button", slug: "icon-button", description: "A button with only an icon.", variants: ["ghost"], related: ["button"], frameworks: ["react"] },
      { name: "Text Field", description: "Single-line input.", props: [{ name: "value", type: "string" }], frameworks: ["react"] },
      { name: "Fancy Widget", canonicalType: "combobox", description: "Adapter-declared combobox." },
    ],
    tokenSets: [
      {
        set: "base",
        name: "Base",
        theme: null,
        tokens: {
          color: { $type: "color", blue: { 500: { $value: "#0050d8" } }, gray: { 900: { $value: "#1b1b1b" } } },
          space: { $type: "dimension", 100: { $value: "4px" }, 200: { $value: "8px" } },
        },
      },
      {
        set: "light",
        name: "Light theme",
        theme: "light",
        tokens: {
          color: {
            $type: "color",
            brand: { primary: { $value: "{color.blue.500}" } },
            text: { default: { $value: "{color.gray.900}" }, link: { $value: "{color.brand.primary}" } },
          },
        },
      },
    ],
    patterns: [{ slug: "forms", name: "Forms", description: "Collecting input.", components: ["text-field", "button"] }],
    facts: { latestVersion: "1.2.3" },
  };
}
