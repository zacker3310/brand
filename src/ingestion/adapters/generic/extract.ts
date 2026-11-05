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

/* -------------------------------------------------------------------------- */
/* Matching (include/exclude, dedupe, caps)                                    */
/* -------------------------------------------------------------------------- */

export interface Candidate {
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
    titleSuffix: t.titleSuffix ? new RegExp(t.titleSuffix) : null,
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
  const seg = m?.[1];
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

/**
 * Filter raw values (URLs or paths) through the target rules, dedupe by segment key and sort
 * deterministically (by key; for one key the shortest, then lexicographically first value wins).
 */
export function selectCandidates(values: { value: string; text?: string | null }[], c: CompiledTarget): Candidate[] {
  const byKey = new Map<string, Candidate>();
  for (const { value, text } of values) {
    const seg = matchOne(value, c);
    if (!seg) continue;
    const key = segmentKey(seg);
    if (!key) continue;
    const prev = byKey.get(key);
    const cand: Candidate = { segment: seg, matched: value, text: text ?? null };
    if (!prev || value.length < prev.matched.length || (value.length === prev.matched.length && value < prev.matched)) {
      byKey.set(key, prev?.text && !cand.text ? { ...cand, text: prev.text } : cand);
    } else if (!prev.text && cand.text) {
      prev.text = cand.text;
    }
  }
  return [...byKey.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([, v]) => v);
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

const MAX_NAME_CHARS = 60;
const MAX_NAME_WORDS = 6;

const plausibleName = (s: string | null | undefined): s is string => {
  if (!s) return false;
  const n = clean(s);
  return !!n && n.length <= MAX_NAME_CHARS && n.split(" ").length <= MAX_NAME_WORDS && !/[<>{}]/.test(n);
};

/** Strip the configured site suffix, then fall back to the separator part that names the segment. */
export function cleanTitle(title: string, segment: string, suffix: RegExp | null): string | null {
  let t = clean(title);
  if (suffix) t = clean(t.replace(suffix, ""));
  if (!t) return null;
  const parts = t.split(/\s+[|–—·•:]\s+|\s+-\s+/).map(clean).filter(Boolean);
  if (parts.length > 1) {
    const hit = parts.find((p) => relatesToSegment(p, segment));
    return hit ?? null;
  }
  return t;
}

const stripComponentWord = (s: string) => clean(s.replace(/\s+(component|components|element|web component)$/i, ""));

/**
 * Choose the component display name: h1 > title > nav link text > humanized segment.
 * A candidate must be short and plausibly name the segment; otherwise the next one is used.
 */
export function chooseName(segment: string, page: Pick<PageMeta, "title" | "h1" | "h1Own"> | null, linkText: string | null | undefined, suffix: RegExp | null): { name: string; from: "h1" | "title" | "link" | "segment" } {
  const ok = (s: string | null | undefined) => plausibleName(s) && relatesToSegment(s, segment);
  if (page) {
    for (const h of [page.h1, page.h1Own]) {
      if (!h) continue;
      const v = stripComponentWord(h);
      if (ok(v)) return { name: v, from: "h1" };
    }
    if (page.title) {
      const t = cleanTitle(page.title, segment, suffix);
      const v = t ? stripComponentWord(t) : null;
      if (ok(v)) return { name: v!, from: "title" };
    }
  }
  if (linkText) {
    const v = stripComponentWord(linkText);
    if (ok(v)) return { name: v, from: "link" };
  }
  return { name: humanizeSegment(segment), from: "segment" };
}

/** Bounded, whitespace-normalized description (first sentences up to `max` chars). */
export function shortDescription(s: string | null | undefined, max = 300): string | null {
  const t = clean(s);
  if (t.length < 12) return null;
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
