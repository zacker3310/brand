/**
 * m3.material.io helpers. The site is an Angular single-page app: component pages are
 * client-rendered and the server HTML only carries <title>, meta description and og:url.
 * We read exactly those (cheerio, no script execution) plus the public sitemap.
 */
import * as cheerio from "cheerio";

export interface M3PageMeta {
  title: string | null;
  /** Title with the " – Material Design 3" site suffix removed. */
  name: string | null;
  description: string | null;
  ogUrl: string | null;
  /** True when the body only contains the "requires JavaScript" shell. */
  clientRendered: boolean;
}

const SUFFIX = /\s*[–—-]\s*Material Design 3\s*$/;

export function parseM3Page(html: string): M3PageMeta {
  const $ = cheerio.load(html);
  const title = $("title").first().text().replace(/\s+/g, " ").trim() || null;
  const description = ($('meta[name="description"]').attr("content") ?? "").replace(/\s+/g, " ").trim() || null;
  const ogUrl = $('meta[property="og:url"]').attr("content") ?? $('meta[name="twitter:url"]').attr("content") ?? null;
  $("script, style, noscript").remove();
  const bodyText = $("body").text().replace(/\s+/g, " ").trim();
  return {
    title,
    name: title ? title.replace(SUFFIX, "").trim() || null : null,
    description,
    ogUrl,
    clientRendered: bodyText.length < 200 && /requires JavaScript/i.test(bodyText),
  };
}

export interface SitemapEntry {
  loc: string;
  lastmod: string | null;
}

export function parseSitemap(xml: string): SitemapEntry[] {
  const out: SitemapEntry[] = [];
  for (const m of xml.matchAll(/<url>\s*<loc>([^<]+)<\/loc>(?:\s*<lastmod>([^<]+)<\/lastmod>)?/g)) {
    out.push({ loc: m[1]!.trim(), lastmod: m[2]?.trim() ?? null });
  }
  return out;
}

/** M3 component slugs from sitemap entries (…/components/<slug>/<tab>). */
export function m3ComponentPages(entries: SitemapEntry[], origin = "https://m3.material.io") {
  const bySlug = new Map<string, { slug: string; tabs: Record<string, SitemapEntry> }>();
  for (const e of entries) {
    const m = new RegExp(`^${origin.replace(/\./g, "\\.")}/components/([a-z0-9-]+)/([a-z0-9-]+)$`).exec(e.loc);
    if (!m) continue;
    const slug = m[1]!;
    let rec = bySlug.get(slug);
    if (!rec) bySlug.set(slug, (rec = { slug, tabs: {} }));
    rec.tabs[m[2]!] = e;
  }
  return [...bySlug.values()].filter((r) => r.tabs.overview).sort((a, b) => (a.slug < b.slug ? -1 : 1));
}

/** Loose check that a page title belongs to the requested slug ("Buttons" ~ "buttons"). */
export function titleMatchesSlug(name: string, slug: string): boolean {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/\(.*?\)/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .split(" ")
      .map((w) => w.replace(/(es|s)$/, ""))
      .join(" ");
  const a = norm(name);
  const b = norm(slug.replace(/-/g, " "));
  return a === b || a.startsWith(b) || b.startsWith(a);
}
