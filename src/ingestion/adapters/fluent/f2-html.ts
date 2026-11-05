/**
 * Static readers for fluent2.microsoft.design (Astro, server-rendered HTML; robots.txt allows all).
 * cheerio only; scripts are removed and never executed. The site navigation is embedded as the
 * serialized `props` attribute of the Nav island; it is decoded as JSON data (Astro's
 * [type, value] encoding), not evaluated.
 */
import * as cheerio from "cheerio";
import type { CheerioAPI } from "cheerio";
import { F2_ORIGIN, decodeEntities } from "./shared";

/* ---------------------------------- nav props ---------------------------------- */

export interface F2NavPage {
  title: string;
  href: string;
  desc: string | null;
  inPreview: boolean;
  libraries: string[];
  folder: string | null;
  subPages: { title: string; href: string }[];
}

export interface F2NavGroup {
  title: string;
  library: string | null;
  pages: F2NavPage[];
}

/** Decode Astro's serialized island props: [0, value] plain, [1, array], [5, set]. */
export function deserializeAstro(v: unknown, depth = 0): unknown {
  if (depth > 40) return null;
  if (Array.isArray(v) && v.length === 2 && typeof v[0] === "number") {
    const [t, x] = v as [number, unknown];
    if (t === 0) {
      if (x && typeof x === "object" && !Array.isArray(x)) return Object.fromEntries(Object.entries(x as Record<string, unknown>).map(([k, val]) => [k, deserializeAstro(val, depth + 1)]));
      return x;
    }
    if ((t === 1 || t === 5) && Array.isArray(x)) return x.map((e) => deserializeAstro(e, depth + 1));
    return x;
  }
  if (v && typeof v === "object" && !Array.isArray(v)) return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, val]) => [k, deserializeAstro(val, depth + 1)]));
  return v;
}

const str = (v: unknown) => (typeof v === "string" ? v : null);

/** Navigation groups from the Nav island of any page. */
export function parseNav(html: string): F2NavGroup[] {
  const m = /<astro-island\b[^>]*component-url="[^"]*\/Nav\.[^"]*"[^>]*>/.exec(html);
  if (!m) return [];
  const props = /\sprops="([^"]*)"/.exec(m[0]);
  if (!props) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(decodeEntities(props[1]!));
  } catch {
    return [];
  }
  const d = deserializeAstro(raw) as { groups?: unknown };
  const groups = Array.isArray(d?.groups) ? (d.groups as Record<string, unknown>[]) : [];
  return groups.map((g) => ({
    title: str(g.title) ?? "",
    library: str(g.library),
    pages: (Array.isArray(g.pages) ? (g.pages as Record<string, unknown>[]) : [])
      .filter((p) => str(p.title) && str(p.href))
      .map((p) => ({
        title: str(p.title)!.trim(),
        href: str(p.href)!,
        desc: str(p.desc)?.replace(/\s+/g, " ").trim() || null,
        inPreview: p.inPreview === true,
        libraries: Array.isArray(p.libraries) ? (p.libraries as unknown[]).filter((x): x is string => typeof x === "string") : [],
        folder: str(p.folder),
        subPages: (Array.isArray(p.subFolders) ? (p.subFolders as Record<string, unknown>[]) : [])
          .filter((s) => str(s.title) && str(s.href))
          .map((s) => ({ title: str(s.title)!, href: str(s.href)! })),
      })),
  }));
}

/** Canonical absolute page URL with trailing slash (the sitemap form). */
export function f2Url(href: string): string {
  const u = new URL(href, F2_ORIGIN);
  u.hash = "";
  u.search = "";
  if (!u.pathname.endsWith("/")) u.pathname += "/";
  return u.toString();
}

export interface F2ComponentEntry {
  /** Platform library from the nav ("web/react", "ios", "android"). */
  library: string;
  title: string;
  url: string;
  desc: string | null;
  inPreview: boolean;
  libraries: string[];
  folder: string | null;
}

/** Component pages from the "Components" nav groups (overview pages excluded). */
export function componentEntries(groups: F2NavGroup[]): F2ComponentEntry[] {
  const out: F2ComponentEntry[] = [];
  for (const g of groups) {
    if (g.title !== "Components" || !g.library) continue;
    for (const p of g.pages) {
      if (!/\/usage\/?$/.test(p.href)) continue;
      out.push({ library: g.library, title: p.title, url: f2Url(p.href), desc: p.desc, inPreview: p.inPreview, libraries: p.libraries, folder: p.folder });
    }
  }
  return out;
}

/* ---------------------------------- page body ---------------------------------- */

export interface F2Resource {
  href: string;
  title: string;
  subtitle: string;
}

export interface F2Card {
  name: string;
  description: string | null;
}

export interface F2Section {
  id: string | null;
  title: string;
  /** Prose (paragraphs / list items) in document order; h3 titles are prefixed as "Title: ". */
  prose: string[];
  h3: { id: string | null; title: string }[];
  /** Title/description pairs (Types and Behavior galleries). */
  cards: F2Card[];
  hasTable: boolean;
  /** Keyboard tables (columns Key + Action/Result/Behavior). */
  keyboard: { keys: string; action: string }[];
}

export interface F2Page {
  title: string | null;
  metaDescription: string | null;
  h1: string | null;
  intro: string[];
  resources: F2Resource[];
  sections: F2Section[];
  /** Internal component pages linked from the body (absolute URLs). */
  componentLinks: string[];
  /** Platform icon alt in the table of contents ("web/react", "ios"). */
  platform: string | null;
}

const clean = (s: string) => decodeEntities(s).replace(/\s+/g, " ").trim();

/** Gallery cards of a Types section: a short <p> title right after an image block, then a <p> description. */
function cardsOf($: CheerioAPI, el: ReturnType<CheerioAPI>): F2Card[] {
  const cards: F2Card[] = [];
  el.find("p").each((_, node) => {
    const n = $(node);
    const t = clean(n.text());
    const next = n.next();
    if (!t || t.length > 60 || /[.:!?]$/.test(t) || !next.is("p")) return;
    const prev = n.prevAll("div").first();
    if (!prev.length) return;
    if (!prev.find("picture, img").length && !prev.prevAll("div").first().find("picture, img").length) return;
    cards.push({ name: t, description: clean(next.text()) || null });
  });
  return cards;
}

export function parseF2Page(html: string, pageUrl: string): F2Page {
  const $ = cheerio.load(html);
  $("script, style, noscript, svg, template").remove();
  const title = clean($("title").first().text()) || null;
  const metaDescription = clean($('meta[name="description"]').attr("content") ?? "") || null;
  const main = $("main").first();
  const h1el = main.find("h1").first();
  const h1Clone = h1el.clone();
  h1Clone.find("astro-island, span").remove();
  const h1 = clean(h1Clone.text()) || null;
  const intro: string[] = [];
  for (let el = h1el.next(); el.length && el.is("p"); el = el.next()) {
    const t = clean(el.text());
    if (t) intro.push(t);
  }
  const resources: F2Resource[] = [];
  main.find("a[data-title]").each((_, a) => {
    const n = $(a);
    const href = n.attr("href");
    if (!href) return;
    resources.push({ href, title: clean(n.attr("data-title") ?? ""), subtitle: clean(n.attr("data-subtitle") ?? "") });
  });
  const platform = $('nav[aria-label="Table of contents"] img[alt]').first().attr("alt") ?? null;
  main.find("nav").remove();
  const sections: F2Section[] = [];
  let cur: F2Section | null = null;
  let pendingH3: string | null = null;
  main.find("h2, h3, p, li, table").each((_, node) => {
    const n = $(node);
    const tag = (node as { tagName?: string }).tagName?.toLowerCase();
    if (tag === "h2") {
      cur = { id: n.attr("id") ?? null, title: clean(n.text()), prose: [], h3: [], cards: [], hasTable: false, keyboard: [] };
      sections.push(cur);
      pendingH3 = null;
      const container = n.parent().is("section") ? n.parent() : null;
      if (container && /^types$/i.test(cur.title)) cur.cards = cardsOf($, container);
      return;
    }
    if (!cur) return;
    const sec: F2Section = cur;
    if (tag === "h3") {
      const t = clean(n.text());
      sec.h3.push({ id: n.attr("id") ?? null, title: t });
      pendingH3 = t;
      return;
    }
    if (tag === "table") {
      sec.hasTable = true;
      const rows = n.find("tr").toArray().map((tr) => $(tr).find("th, td").toArray().map((c) => clean($(c).text())));
      const head = (rows[0] ?? []).map((h) => h.toLowerCase());
      const k = head.findIndex((h) => /^key/.test(h));
      const a = head.findIndex((h) => /(action|result|behavior|description|interaction)/.test(h));
      if (k >= 0 && a >= 0) for (const r of rows.slice(1)) if (r[k] && r[a]) sec.keyboard.push({ keys: r[k]!, action: r[a]! });
      return;
    }
    if (n.parents("li, table").length) return;
    const t = clean(n.text());
    if (!t) return;
    sec.prose.push(pendingH3 ? `${pendingH3}: ${t}` : t);
    pendingH3 = null;
  });
  const links = new Set<string>();
  const self = f2Url(pageUrl);
  main.find("a[href]").each((_, a) => {
    const href = $(a).attr("href")!;
    if (!/^\/components\/[^?#]+\/usage\/?/.test(href) && !href.startsWith(`${F2_ORIGIN}/components/`)) return;
    const u = f2Url(href);
    if (u !== self && /\/usage\/$/.test(u)) links.add(u);
  });
  return { title, metaDescription, h1, intro, resources, sections, componentLinks: [...links].sort(), platform };
}

/** Generic content page (principles, patterns, foundations): h2 sections with ids and prose. */
export function sectionById(page: F2Page, re: RegExp): F2Section | undefined {
  return page.sections.find((s) => re.test(s.id ?? "") || re.test(s.title));
}
