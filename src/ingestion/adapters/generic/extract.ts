/**
 * Pure, static extraction helpers for the generic metadata-level adapter: sitemap XML, nav-page
 * links, jsDelivr file listings and component page metadata (<title>, <h1>, meta description).
 * cheerio only; fetched scripts are never executed (and are removed before text extraction).
 */
import * as cheerio from "cheerio";
import type { GenericTarget } from "./types";

/* -------------------------------------------------------------------------- */
/* Text helpers                                                                */
/* -------------------------------------------------------------------------- */

export const clean = (s: string | null | undefined): string => (s ?? "").replace(/[\s ​]+/g, " ").trim();

const decodeEntities = (s: string): string =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&");

/** "date-picker" | "date_picker" | "DatePicker" | "forms/date-picker" -> "Date Picker" (last path part). */
export function humanizeSegment(segment: string): string {
  const last = segment.split("/").filter(Boolean).pop() ?? segment;
  // PascalCase identifiers (component directory names such as "AutoComplete") are already names.
  if (/^[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]*)*$/.test(last) && /[a-z]/.test(last)) return last;
  return clean(
    decodeURIComponent(last)
      .replace(/\.[a-z0-9]+$/i, "")
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
      .replace(/[-_.+]+/g, " "),
  )
    .split(" ")
    .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(" ");
}

const compact = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
const stem = (w: string) => w.replace(/(ches|shes|xes)$/, (m) => m.slice(0, -2)).replace(/ies$/, "y").replace(/(?<!s)s$/, "");

/** Does a candidate display name plausibly name the component behind this URL/path segment? */
export function relatesToSegment(name: string, segment: string): boolean {
  const n = compact(name);
  const s = compact(humanizeSegment(segment));
  if (!n || !s) return false;
  if (n.includes(s) || s.includes(n) || n.includes(stem(s)) || stem(n).includes(stem(s))) return true;
  const segWords = humanizeSegment(segment).toLowerCase().split(" ").filter((w) => w.length >= 3).map(stem);
  const nameWords = new Set(name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).map(stem));
  return segWords.some((w) => nameWords.has(w));
}

/* -------------------------------------------------------------------------- */
/* Sitemaps                                                                    */
/* -------------------------------------------------------------------------- */

export interface ParsedSitemap {
  kind: "index" | "urlset" | "unknown";
  locs: string[];
}

/** Parse a sitemap or sitemap index (XML). Unknown documents yield no locations. */
export function parseSitemapXml(xml: string): ParsedSitemap {
  const head = xml.slice(0, 4000);
  const kind: ParsedSitemap["kind"] = /<(?:[a-z0-9]+:)?sitemapindex[\s>]/i.test(head) ? "index" : /<(?:[a-z0-9]+:)?urlset[\s>]/i.test(head) ? "urlset" : "unknown";
  if (kind === "unknown") return { kind, locs: [] };
  const locs: string[] = [];
  const re = /<(?:[a-z0-9]+:)?loc>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/(?:[a-z0-9]+:)?loc>/gi;
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    const v = decodeEntities(m[1]!.trim());
    if (/^https?:\/\//i.test(v)) locs.push(v);
  }
  return { kind, locs };
}

/**
 * Storybook index (index.json v4/v5 "entries", stories.json v3 "stories"): a machine-readable
 * listing of every docs/story entry of a Storybook, used like a sitemap. Values are Storybook URLs
 * (`<base>/?path=/docs/<id>` or `/story/<id>`); text is the entry title ("Components/Button").
 */
export function parseStorybookIndex(json: string, indexUrl: string): { value: string; text: string }[] | null {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return null;
  }
  const d = data as { entries?: unknown; stories?: unknown };
  const map = (d && typeof d === "object" ? (d.entries ?? d.stories) : null) as Record<string, unknown> | null;
  if (!map || typeof map !== "object") return null;
  const base = indexUrl.replace(/(index|stories)\.json(\?.*)?$/, "");
  const out: { value: string; text: string }[] = [];
  for (const raw of Object.values(map)) {
    const e = raw as { id?: unknown; title?: unknown; kind?: unknown; type?: unknown };
    if (!e || typeof e.id !== "string") continue;
    const title = typeof e.title === "string" ? e.title : typeof e.kind === "string" ? e.kind : "";
    const kind = e.type === "docs" ? "docs" : "story";
    out.push({ value: `${base}?path=/${kind}/${e.id}`, text: title });
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Matching (include/exclude, dedupe, caps)                                    */
/* -------------------------------------------------------------------------- */

export interface Candidate {
  /** Stable component key (slug): segmentKey(segment), disambiguated by the parent path part on collisions. */
  key: string;
  /** Captured component segment (raw, as in the URL/path). */
  segment: string;
  /** Matched absolute URL (sitemap/nav) or file path (repo-listing). */
  matched: string;
  /** Link text (nav strategy only). */
  text?: string | null;
}

export interface CompiledTarget {
  include: RegExp;
  exclude: RegExp[];
  titleSuffix: RegExp | null;
}

const compiled = new WeakMap<GenericTarget, CompiledTarget>();

export function compileTarget(t: GenericTarget): CompiledTarget {
  const hit = compiled.get(t);
  if (hit) return hit;
  const c: CompiledTarget = {
    include: new RegExp(t.include),
    exclude: (t.exclude ?? []).map((x) => new RegExp(x)),
    titleSuffix: t.titleSuffix ? new RegExp(t.titleSuffix, "g") : null,
  };
  compiled.set(t, c);
  return c;
}

/** Normalize a URL for matching: absolute, no hash, no query. */
export function normalizeUrl(href: string, base?: string): string | null {
  try {
    const u = new URL(href, base);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    u.hash = "";
    u.search = "";
    return u.toString();
  } catch {
    return null;
  }
}

/** Apply include (first capture group = segment) and exclude rules to one URL or path. */
export function matchOne(value: string, c: CompiledTarget): string | null {
  if (c.exclude.some((re) => re.test(value))) return null;
  const m = c.include.exec(value);
  const seg = m ? m.slice(1).find((g) => !!g) : undefined; // first participating group (alternations)
  if (!seg) return null;
  const s = seg.replace(/^\/+|\/+$/g, "");
  return s || null;
}

/** Stable component key for a captured segment. */
export const segmentKey = (segment: string) =>
  segment
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

/** Identity of a document for dedupe: host + path without trailing slash / .html, lowercased. */
export function docIdentity(value: string): string {
  try {
    const u = new URL(value);
    return `${u.host}${u.pathname.replace(/\/+$/, "").replace(/\.html?$/, "")}`.toLowerCase();
  } catch {
    return value;
  }
}

/** Path component right before the captured segment (for disambiguating colliding keys). */
function parentPart(value: string, segment: string): string | null {
  let path = value;
  try {
    path = new URL(value).pathname;
  } catch {
    /* repo path */
  }
  const parts = path.split("/").filter(Boolean);
  const segParts = segment.split("/").filter(Boolean);
  const first = segParts[0];
  const idx = first ? parts.lastIndexOf(first) : -1;
  return idx > 0 ? parts[idx - 1]! : null;
}

const better = (a: { value: string }, b: { value: string }) => a.value.length < b.value.length || (a.value.length === b.value.length && a.value < b.value);

/**
 * Filter raw values (URLs or paths) through the target rules, dedupe by segment key and sort
 * deterministically by key. For one key the shortest, then lexicographically first value wins.
 * With `distinctPages` (sitemap/nav), different documents capturing the same segment (e.g.
 * /forms/text/ and /display/text/) are kept as separate components keyed "<parent>-<segment>";
 * URL variants of one document (trailing slash, .html) still collapse.
 */
export function selectCandidates(values: { value: string; text?: string | null }[], c: CompiledTarget, opts: { distinctPages?: boolean } = {}): Candidate[] {
  type Hit = { segment: string; value: string; text: string | null };
  const groups = new Map<string, Hit[]>();
  for (const { value, text } of values) {
    const seg = matchOne(value, c);
    if (!seg) continue;
    const key = segmentKey(seg);
    if (!key) continue;
    const g = groups.get(key) ?? [];
    g.push({ segment: seg, value, text: text ? clean(text) || null : null });
    groups.set(key, g);
  }
  const pick = (hits: Hit[]): Hit => {
    let best = hits[0]!;
    for (const h of hits.slice(1)) if (better(h, best)) best = h;
    const texts = hits.filter((h) => h.value === best.value && h.text).map((h) => h.text!);
    const text = texts.sort((a, b) => a.length - b.length || (a < b ? -1 : 1))[0] ?? hits.find((h) => h.text)?.text ?? null;
    return { ...best, text };
  };
  const out = new Map<string, Candidate>();
  const put = (key: string, h: Hit) => {
    const prev = out.get(key);
    if (!prev || better(h, { value: prev.matched })) out.set(key, { key, segment: h.segment, matched: h.value, text: h.text ?? prev?.text ?? null });
  };
  for (const [key, hits] of groups) {
    if (!opts.distinctPages) {
      put(key, pick(hits));
      continue;
    }
    const docs = new Map<string, Hit[]>();
    for (const h of hits) {
      const id = docIdentity(h.value);
      const g = docs.get(id) ?? [];
      g.push(h);
      docs.set(id, g);
    }
    if (docs.size === 1) {
      put(key, pick(hits));
      continue;
    }
    for (const g of docs.values()) {
      const h = pick(g);
      const parent = parentPart(h.value, h.segment);
      put(parent ? segmentKey(`${parent}-${h.segment}`) || key : key, h);
    }
  }
  return [...out.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/* -------------------------------------------------------------------------- */
/* Nav pages                                                                   */
/* -------------------------------------------------------------------------- */

/** Links (absolute, no hash/query) with their text, scoped to `selector` (default: whole document). */
export function extractNavLinks(html: string, baseUrl: string, selector?: string): { value: string; text: string }[] {
  const $ = cheerio.load(html);
  $("script, style, noscript, template, svg").remove();
  const scope = selector ? $(selector) : $.root();
  const out: { value: string; text: string }[] = [];
  scope.find("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href || /^(javascript|mailto|tel):/i.test(href)) return;
    const abs = normalizeUrl(href, baseUrl);
    if (!abs) return;
    out.push({ value: abs, text: clean($(el).text()) });
  });
  return out;
}

/* -------------------------------------------------------------------------- */
/* jsDelivr listings                                                           */
/* -------------------------------------------------------------------------- */

/** Paths from a jsDelivr flat listing ({ files: [{ name: "/src/x.ts" }] }) without leading slash. */
export function parseListing(json: string): string[] {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return [];
  }
  const files = (data as { files?: unknown })?.files;
  if (!Array.isArray(files)) return [];
  return files
    .map((f) => (f && typeof f === "object" && typeof (f as { name?: unknown }).name === "string" ? (f as { name: string }).name : null))
    .filter((n): n is string => !!n)
    .map((n) => n.replace(/^\/+/, ""));
}

/* -------------------------------------------------------------------------- */
/* Component pages                                                             */
/* -------------------------------------------------------------------------- */

export interface PageMeta {
  title: string | null;
  h1: string | null;
  /** h1 own text (without child element text such as badges), when different from h1. */
  h1Own: string | null;
  metaDescription: string | null;
  canonical: string | null;
  lang: string | null;
  /** Page looks like a "not found" page served with HTTP 200. */
  soft404: boolean;
}

const SOFT_404 = /\b(404|page not found|not found|page doesn['’]t exist|page does not exist)\b/i;

export function parsePageMeta(html: string, pageUrl: string): PageMeta {
  const $ = cheerio.load(html);
  $("script, style, noscript, template, svg").remove();
  const title = clean($("head > title").first().text() || $("title").first().text()) || null;
  const scope = $("main h1, article h1, [role=main] h1").first().length ? $("main h1, article h1, [role=main] h1").first() : $("h1").first();
  const h1 = clean(scope.text()) || null;
  const h1Own =
    clean(
      scope
        .contents()
        .toArray()
        .filter((n) => n.type === "text")
        .map((n) => $(n).text())
        .join(" "),
    ) || null;
  const desc =
    clean($('meta[name="description"]').attr("content")) ||
    clean($('meta[property="og:description"]').attr("content")) ||
    clean($('meta[name="twitter:description"]').attr("content")) ||
    null;
  const canonicalHref = $('link[rel="canonical"]').attr("href");
  const canonical = canonicalHref ? normalizeUrl(canonicalHref, pageUrl) : null;
  const lang = clean($("html").attr("lang")) || null;
  const soft404 = !!((title && SOFT_404.test(title) && title.length < 80) || (h1 && SOFT_404.test(h1) && h1.length < 60));
  return { title, h1, h1Own: h1Own && h1Own !== h1 ? h1Own : null, metaDescription: desc, canonical, lang, soft404 };
}

const stripMdInline = (s: string) =>
  clean(
    s
      .replace(/<[^>]+>/g, " ")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/[`*_~]+/g, "")
      .replace(/\{#[^}]*\}\s*$/, ""),
  );

/** Unquote a simple YAML scalar ("Button", 'Button', Button). */
const yamlScalar = (v: string) => clean(v.replace(/^(["'])(.*)\1$/, "$2"));

/**
 * Static metadata from a Markdown/MDX docs source file: frontmatter title/description, the first
 * level-1 heading, and the first prose paragraph directly under it (before any sub-heading,
 * skipping lists, tables, admonitions (:::), HTML/JSX, imports and code fences).
 */
export function parseMarkdownMeta(md: string): PageMeta {
  let body = md.replace(/^\uFEFF/, "");
  let fmTitle: string | null = null;
  let fmDesc: string | null = null;
  const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(body);
  if (fm) {
    for (const line of fm[1]!.split(/\r?\n/)) {
      const m = /^(title|description)\s*:\s*(.+)$/.exec(line);
      if (m && m[1] === "title") fmTitle = yamlScalar(m[2]!) || null;
      if (m && m[1] === "description") fmDesc = yamlScalar(m[2]!) || null;
    }
    body = body.slice(fm[0].length);
  }
  const lines = body.split(/\r?\n/);
  let h1: string | null = null;
  let h1Line = -1;
  let fence = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    if (/^\s*```/.test(l) && !/^\s*`{4,}/.test(l)) fence = !fence; // 4+ backtick wrappers (e.g. Arco headers) are transparent
    if (fence) continue;
    const m = /^#\s+(.+?)\s*#*\s*$/.exec(l);
    if (m) {
      h1 = stripMdInline(m[1]!) || null;
      h1Line = i;
      break;
    }
  }
  let para: string | null = null;
  if (h1Line >= 0) {
    let inAdmonition = false;
    let inFence = false;
    const buf: string[] = [];
    for (let i = h1Line + 1; i < lines.length && i < h1Line + 40; i++) {
      const l = lines[i]!.trim();
      if (/^`{3}/.test(l)) {
        inFence = !inFence;
        if (buf.length) break;
        continue;
      }
      if (inFence) continue;
      if (/^`{4,}/.test(l)) {
        if (buf.length) break;
        continue;
      }
      if (/^:::/.test(l)) {
        inAdmonition = !inAdmonition && l !== ":::";
        if (buf.length) break;
        continue;
      }
      if (inAdmonition) continue;
      if (/^#{1,6}\s/.test(l)) break;
      if (!l) {
        if (buf.length) break;
        continue;
      }
      if (/^([-*+]\s|\d+\.\s|\||<|>|!|\[|import\s|export\s|\{|%%|---|===)/.test(l)) {
        if (buf.length) break;
        continue;
      }
      buf.push(l);
    }
    para = buf.length ? stripMdInline(buf.join(" ")) : null;
  }
  return { title: fmTitle, h1, h1Own: null, metaDescription: fmDesc ?? para, canonical: null, lang: null, soft404: false };
}

/** Markdown/MDX by URL extension or content type. */
export const isMarkdownDoc = (url: string, contentType: string | null) => /\.mdx?$/i.test(new URL(url).pathname) || /markdown/i.test(contentType ?? "");

const MAX_NAME_CHARS = 60;
const MAX_NAME_WORDS = 6;

const plausibleName = (s: string | null | undefined): s is string => {
  if (!s) return false;
  const n = clean(s);
  return !!n && n.length <= MAX_NAME_CHARS && n.split(" ").length <= MAX_NAME_WORDS && !/[<>{}]/.test(n);
};

/**
 * Strip the configured site decoration (titleSuffix), then split on title separators.
 * Returns the part that names the segment (best) and the first part (first).
 */
export function cleanTitle(title: string, segment: string, suffix: RegExp | null): { best: string | null; first: string | null } {
  let t = clean(title);
  if (suffix) t = clean(t.replace(suffix, ""));
  if (!t) return { best: null, first: null };
  const parts = t.split(/\s+[|–—·•]\s+|\s+-\s+/).map(clean).filter(Boolean);
  if (parts.length > 1) return { best: parts.find((p) => relatesToSegment(p, segment)) ?? null, first: parts[0] ?? null };
  return { best: t, first: t };
}

const GENERIC_PART = /^(overview|basic|basics|default|usage|examples?|docs|documentation|introduction|components?)$/i;

const stripComponentWord = (s: string) => clean(s.replace(/\s+(component|components|element|web component)$/i, ""));
const strip = (s: string | null | undefined, suffix: RegExp | null): string | null => {
  if (!s) return null;
  const v = stripComponentWord(suffix ? clean(clean(s).replace(suffix, "")) : clean(s));
  return v || null;
};
const sameText = (a: string | null, b: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

export type NameSource = "h1" | "title" | "link" | "segment";

/**
 * Choose the component display name. Order:
 *  1. the heading that agrees with the page title (h1 own text first: drops status badges like "Button Ready"),
 *  2. h1 / title / h1 own text that plausibly names the URL segment,
 *  3. nav link text that names the segment, 4. the humanized segment.
 * `suffix` (target.titleSuffix) strips site decoration from both <title> and <h1>.
 */
export function chooseName(
  segment: string,
  page: Pick<PageMeta, "title" | "h1" | "h1Own"> | null,
  linkText: string | null | undefined,
  suffix: RegExp | null,
): { name: string; from: NameSource } {
  const ok = (s: string | null | undefined): s is string => plausibleName(s);
  const rel = (s: string | null | undefined): s is string => ok(s) && relatesToSegment(s, segment);
  if (page) {
    const h1 = strip(page.h1, suffix);
    const h1Own = strip(page.h1Own, suffix);
    const t = page.title ? cleanTitle(page.title, segment, suffix) : { best: null, first: null };
    const title = strip(t.best, null);
    const titleFirst = strip(t.first, null);
    for (const h of [h1Own, h1]) if (ok(h) && (sameText(h, title) || sameText(h, titleFirst))) return { name: h, from: "h1" };
    if (rel(h1)) return { name: h1, from: "h1" };
    if (rel(title)) return { name: title, from: "title" };
    if (rel(h1Own)) return { name: h1Own, from: "h1" };
  }
  // Link texts may be breadcrumbs ("Components/DataTable/Basic"): use the deepest specific part that
  // names the end of the segment, else the deepest part that names it at all.
  const linkParts = (linkText ?? "").split(/\s*[/›»>]\s*/).map((x) => strip(x, null)).filter((x): x is string => !!x).reverse();
  if (linkParts.length > 1) {
    const segC = compact(humanizeSegment(segment));
    const specific = linkParts.filter((x) => !GENERIC_PART.test(x));
    const tail = specific.find((x) => ok(x) && compact(x).length >= 3 && segC.endsWith(compact(x)));
    if (tail) return { name: tail, from: "link" };
    const any = specific.find((x) => rel(x));
    if (any) return { name: any, from: "link" };
  }
  const link = strip(linkText, null);
  if (rel(link)) return { name: link, from: "link" };
  return { name: humanizeSegment(segment), from: "segment" };
}

/** Bounded, whitespace-normalized description (first sentences up to `max` chars). */
export function shortDescription(s: string | null | undefined, max = 300): string | null {
  const t = clean(s);
  // Too short to be a description ("Text field", "Not in SB", "Building block only").
  if (t.length < 20 || t.split(" ").length < 3) return null;
  if (t.length <= max) return t;
  const sentences = t.match(/[^.!?。]+[.!?。]+(\s|$)/g) ?? [];
  let out = "";
  for (const sen of sentences) {
    if ((out + sen).trim().length > max) break;
    out += sen;
  }
  out = out.trim();
  return out.length >= 12 ? out : `${t.slice(0, max - 1).trimEnd()}…`;
}
