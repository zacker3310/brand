/**
 * spectrum.adobe.com parsers. The Spectrum 2 guidelines site is an AEM Edge Delivery site: every
 * page and fragment is served statically as semantic HTML (`<path>.plain.html`), and the site
 * publishes a machine-readable page index (`/query-index.json`). robots.txt allows all agents.
 * Static parsing only (cheerio); scripts are never executed.
 *
 * Component pages live at /web/{rsp|swc|design-only}/components/<slug>: the same design component
 * documented for the React Spectrum (rsp) and Spectrum Web Components (swc) implementations, or as
 * design-only. Pages embed shared fragments (/fragments/components/<slug>/<section>) and link a
 * per-implementation "component options" JSON (/deps/rsp/data/<Name>.json, /deps/swc/data/<file>.json).
 */
import * as cheerio from "cheerio";
import type { CheerioAPI } from "cheerio";
import { collapse, cmp } from "./shared";

/* ------------------------------ query index ------------------------------ */

export interface SiteRow {
  path: string;
  title: string;
  description: string | null;
  implementation: string | null;
  platform: string | null;
  fragments: string[];
  tags: string[];
}

export function parseSiteIndex(text: string): { rows: SiteRow[]; total: number | null } {
  let d: unknown;
  try {
    d = JSON.parse(text);
  } catch {
    return { rows: [], total: null };
  }
  const o = (d ?? {}) as { data?: unknown; total?: unknown };
  const data = Array.isArray(o.data) ? o.data : [];
  const rows: SiteRow[] = [];
  for (const r of data) {
    if (!r || typeof r !== "object") continue;
    const x = r as Record<string, unknown>;
    if (typeof x.path !== "string" || !x.path.startsWith("/")) continue;
    const str = (v: unknown) => (typeof v === "string" && v.trim() ? collapse(v) : null);
    const list = (v: unknown) => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string" && !!s.trim()).map((s) => s.trim()) : []);
    rows.push({
      path: x.path,
      title: str(x.title) ?? "",
      description: str(x.description),
      implementation: str(x.implementation),
      platform: str(x.platform),
      fragments: list(x.fragments).filter((f) => f.startsWith("/fragments/")),
      tags: list(x.tags),
    });
  }
  rows.sort((a, b) => cmp(a.path, b.path));
  return { rows, total: typeof o.total === "number" ? o.total : null };
}

export type SiteImpl = "rsp" | "swc" | "design-only";
export const COMPONENT_PATH_RE = /^\/web\/(rsp|swc|design-only)\/components\/([a-z0-9-]+)\/?$/;

export interface SiteComponent {
  slug: string;
  title: string;
  description: string | null;
  pages: { impl: SiteImpl; path: string; title: string; description: string | null }[];
  fragments: string[];
  tags: string[];
}

/** Group component pages by component slug (one design component, one or more implementation pages). */
export function siteComponents(rows: SiteRow[]): SiteComponent[] {
  const by = new Map<string, SiteComponent>();
  const order: Record<SiteImpl, number> = { rsp: 0, swc: 1, "design-only": 2 };
  for (const r of rows) {
    const m = COMPONENT_PATH_RE.exec(r.path);
    if (!m || !r.title) continue;
    const impl = m[1] as SiteImpl;
    const slug = m[2]!;
    const c = by.get(slug) ?? { slug, title: r.title, description: r.description, pages: [], fragments: [], tags: [] };
    c.pages.push({ impl, path: r.path.replace(/\/$/, ""), title: r.title, description: r.description });
    for (const f of r.fragments) if (!c.fragments.includes(f)) c.fragments.push(f);
    for (const t of r.tags) if (!c.tags.includes(t)) c.tags.push(t);
    by.set(slug, c);
  }
  const out = [...by.values()];
  for (const c of out) {
    c.pages.sort((a, b) => order[a.impl] - order[b.impl]);
    const primary = c.pages[0]!;
    c.title = primary.title;
    c.description = c.pages.find((p) => p.description)?.description ?? null;
    c.fragments.sort();
  }
  return out.sort((a, b) => cmp(a.slug, b.slug));
}

/** Site sections used as ATLAS patterns: content design guidance and app-frame composition. */
export const PATTERN_PATH_RE = /^\/(content\/.+|foundations\/app-frame\/.+)$/;
export function sitePatternRows(rows: SiteRow[]): SiteRow[] {
  return rows.filter((r) => PATTERN_PATH_RE.test(r.path) && r.title).sort((a, b) => cmp(a.path, b.path));
}

/* ------------------------------- HTML blocks ------------------------------ */

const load = (html: string): CheerioAPI => cheerio.load(html);
const text = ($: CheerioAPI, el: Parameters<CheerioAPI>[0]) => collapse($(el).text());

export interface BlockTable {
  heading: string | null;
  header: string[];
  rows: string[][];
}

/** EDS "table" blocks: <div class="table ..."><div><div>cell</div>...</div>...</div>; first row is the header. */
export function blockTables(html: string): BlockTable[] {
  const $ = load(html);
  const out: BlockTable[] = [];
  $("div.table").each((_, t) => {
    const rows: string[][] = [];
    $(t)
      .children("div")
      .each((__, r) => {
        rows.push(
          $(r)
            .children("div")
            .toArray()
            .map((c) => text($, c)),
        );
      });
    if (!rows.length) return;
    // Nearest preceding heading in document order.
    let heading: string | null = null;
    const prev = $(t).prevAll("h1,h2,h3,h4").first();
    if (prev.length) heading = text($, prev);
    else {
      const up = $(t).parent().prevAll("h1,h2,h3,h4").first();
      if (up.length) heading = text($, up);
    }
    const [header, ...body] = rows;
    out.push({ heading, header: header ?? [], rows: body.filter((r) => r.some((c) => c)) });
  });
  return out;
}

export function headings(html: string): { depth: number; text: string; id: string | null }[] {
  const $ = load(html);
  return $("h1,h2,h3,h4")
    .toArray()
    .map((h) => ({ depth: Number(h.tagName.slice(1)), text: text($, h), id: $(h).attr("id") ?? null }))
    .filter((h) => h.text);
}

/** Links to other component pages on the site, as component slugs (sorted, unique). */
export function componentLinks(html: string): string[] {
  const $ = load(html);
  const out = new Set<string>();
  $("a[href]").each((_, a) => {
    const href = ($(a).attr("href") ?? "").replace(/^https:\/\/spectrum\.adobe\.com/, "").split("#")[0]!;
    const m = COMPONENT_PATH_RE.exec(href);
    if (m) out.add(m[2]!);
  });
  return [...out].sort();
}

/* --------------------------------- pages ---------------------------------- */

export interface SitePage {
  title: string | null;
  /** Linked component options JSON path, e.g. "/deps/rsp/data/Button.json". */
  dataPath: string | null;
  /** Data file basename without extension ("Button", "swc-button"). */
  dataName: string | null;
  headings: string[];
  links: string[];
}

export function parseSitePage(html: string): SitePage {
  const $ = load(html);
  let dataPath: string | null = null;
  $("a[href]").each((_, a) => {
    if (dataPath) return;
    const href = ($(a).attr("href") ?? "").replace(/^https:\/\/[^/]+/, "");
    if (/^\/deps\/(rsp|swc)\/data\/[A-Za-z0-9._-]+\.json$/.test(href)) dataPath = href;
  });
  const h1 = $("h1").first();
  const dp = dataPath as string | null;
  return {
    title: h1.length ? text($, h1) : null,
    dataPath: dp,
    dataName: dp ? dp.split("/").pop()!.replace(/\.json$/, "") : null,
    headings: headings(html)
      .filter((h) => h.depth === 2)
      .map((h) => h.text),
    links: componentLinks(html),
  };
}

/* ------------------------------- fragments -------------------------------- */

export interface StateSupport {
  name: string;
  supported: boolean | null;
  note: string | null;
}

/** "States" fragment: table with "State" | "Support status" (Supported / Not supported). */
export function parseStatesFragment(html: string): StateSupport[] {
  const out: StateSupport[] = [];
  for (const t of blockTables(html)) {
    const h = t.header.map((x) => x.toLowerCase());
    if (h[0] !== "state" || !h[1]?.includes("support")) continue;
    for (const r of t.rows) {
      const name = r[0]?.trim();
      if (!name) continue;
      const s = (r[1] ?? "").toLowerCase();
      const supported = /not supported|unsupported/.test(s) ? false : /supported/.test(s) ? true : null;
      out.push({ name, supported, note: r[1] && supported === null ? r[1] : null });
    }
  }
  return out;
}

export interface WcagRow {
  requirement: string;
  criteria: string[];
  level: string | null;
  compliance: string | null;
}

export interface A11yFragment {
  keyboard: { keys: string; action: string }[];
  keyboardSection: boolean;
  wcag: WcagRow[];
  sections: string[];
  links: string[];
}

/** "Accessibility" fragment: Keyboard interactions (Key | Interaction) and WCAG 2.2 compliance tables. */
export function parseA11yFragment(html: string): A11yFragment {
  const keyboard: { keys: string; action: string }[] = [];
  const wcag: WcagRow[] = [];
  const hs = headings(html).map((h) => h.text);
  for (const t of blockTables(html)) {
    const h = t.header.map((x) => x.toLowerCase());
    if ((h[0] === "key" || h[0] === "keys") && h.length >= 2) {
      for (const r of t.rows) if (r[0] && r[1]) keyboard.push({ keys: r[0], action: r[1] });
    } else if (h[0] === "requirement" && h.some((x) => x.startsWith("criteri"))) {
      const ci = h.findIndex((x) => x.startsWith("criteri"));
      const li = h.indexOf("level");
      const co = h.indexOf("compliance");
      for (const r of t.rows) {
        const criteria = [...(r[ci] ?? "").matchAll(/\b(\d\.\d{1,2}\.\d{1,2})\b/g)].map((m) => m[1]!);
        if (!r[0] || !criteria.length) continue;
        wcag.push({ requirement: r[0], criteria, level: li >= 0 ? (r[li] ?? null) : null, compliance: co >= 0 ? (r[co] ?? null) : null });
      }
    }
  }
  return {
    keyboard,
    keyboardSection: hs.some((x) => /keyboard/i.test(x)),
    wcag,
    sections: hs,
    links: componentLinks(html),
  };
}

/* --------------------------- component options JSON ---------------------------- */

export interface SiteProp {
  name: string;
  attribute: string | null;
  type: string | null;
  kind: string | null;
  values: string[];
  defaultValue: string | null;
  required: boolean | null;
  description: string | null;
  inheritedFrom: string | null;
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const unquote = (v: string | null) => (v ? v.replace(/^'(.*)'$/, "$1").replace(/^"(.*)"$/, "$1") : v);

function readProp(p: Record<string, unknown>): SiteProp | null {
  const name = str(p.property) ?? str(p.attribute);
  if (!name) return null;
  const values = Array.isArray(p.values) ? p.values.filter((x): x is string => typeof x === "string") : [];
  const required = typeof p.required === "boolean" ? p.required : typeof p.optional === "boolean" ? !p.optional : null;
  return {
    name,
    attribute: str(p.attribute),
    type: str(p.type),
    kind: str(p.kind),
    values,
    defaultValue: unquote(str(p.default)),
    required,
    description: str(p.description) ? collapse(p.description as string) : null,
    inheritedFrom: str(p.inheritedFrom),
  };
}

/** rsp data: { props: [...], status: "stable" }; swc data: [ { attribute, property, ... } ]. */
export function parseSiteData(text: string): { props: SiteProp[]; status: string | null } | null {
  let d: unknown;
  try {
    d = JSON.parse(text);
  } catch {
    return null;
  }
  const list = Array.isArray(d) ? d : d && typeof d === "object" && Array.isArray((d as { props?: unknown }).props) ? (d as { props: unknown[] }).props : null;
  if (!list) return null;
  const props = list
    .filter((p): p is Record<string, unknown> => !!p && typeof p === "object")
    .map(readProp)
    .filter((p): p is SiteProp => !!p);
  const status = !Array.isArray(d) && d && typeof d === "object" ? str((d as { status?: unknown }).status) : null;
  return { props, status };
}

/* ------------------------------- principles -------------------------------- */

export interface Principles {
  intro: string | null;
  principles: { name: string; text: string | null }[];
}

export function parsePrinciples(html: string): Principles {
  const $ = load(html);
  const principles: { name: string; text: string | null }[] = [];
  $("h2").each((_, h) => {
    const name = text($, h);
    if (!name) return;
    const p = $(h).nextAll("p").first();
    principles.push({ name, text: p.length ? text($, p) : null });
  });
  const intro = $("h1").first().nextAll("p").first();
  const introText = intro.length ? text($, intro) : ($("p").first().length ? text($, $("p").first()) : null);
  return { intro: introText || null, principles };
}
