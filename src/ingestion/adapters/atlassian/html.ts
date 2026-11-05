/**
 * Static HTML parsers for atlassian.design (Gatsby server-rendered pages). cheerio only; scripts are
 * never executed and are removed (with styles, SVG and code blocks) before text extraction.
 *
 * Page anatomy relied on (checked on the live site, see tests/fixtures/adapters/atlassian):
 *  - side navigation: `nav [role=group][aria-labelledby]` groups; heading text is the element with that
 *    id; each item `[data-selected] > a[href]` with an optional release-phase lozenge next to the link.
 *  - `#main-content`: `h1`, a lead `<span>`, status `<section>`s (h2 + p), a `[role=tablist]` of
 *    `a[role=tab]` (Examples / Code / Usage / Changelog) and the selected `[role=tabpanel]`.
 *  - documentation headings carry a "Copy link to '<heading>'" button next to them; their wrapper
 *    `div[id]` is a sibling of the section content (flat document flow).
 *  - code tab: an "Installation" table (Install / Source / npm / Bundle) and generated props tables
 *    in `[data-testid="tsmorph-props--container"]` (one per documented export, preceded by a
 *    "<Name> props" heading on multi-export pages; "Hooks" sections are skipped).
 */
import * as cheerio from "cheerio";
import type { Cheerio, CheerioAPI } from "cheerio";
import { DOCS_ORIGIN } from "./constants";
import { cleanText, docsPath, uniq } from "./text";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sel = Cheerio<any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type El = any;

const PROPS_CONTAINER = '[data-testid="tsmorph-props--container"]';
const MAX_SECTION_TEXT = 4000;

export interface NavEntry {
  name: string;
  path: string;
  /** Nearest named navigation group ("Forms and input", "Deprecated", ...). */
  category: string | null;
  /** Release-phase lozenge shown next to the link ("Beta", "Caution", "Deprecated"), if any. */
  badge: string | null;
}

export interface PageHeading {
  level: number;
  id: string | null;
  text: string;
}

export interface StatusNote {
  heading: string;
  text: string;
  /** Icon label of the section message ("warning", "information", "error", "discovery"). */
  tone: string | null;
  links: string[];
}

export interface TabLink {
  label: string;
  path: string;
  selected: boolean;
}

export interface SectionItem {
  term: string;
  text: string;
}

export interface Section {
  id: string | null;
  level: number;
  heading: string;
  /** Text until the next documentation heading (bounded). */
  text: string;
  /** Text including nested (deeper) subsections (bounded). */
  fullText: string;
  /** Link targets (internal paths "/components/x" or absolute external URLs), in order. */
  links: string[];
  /** "<strong>Term:</strong> text" list items (anatomy parts, behavior states). */
  items: SectionItem[];
}

export interface PropRow {
  /** Export the props table documents ("Tab panel" from a "Tab panel props" heading); null = page's main export. */
  group: string | null;
  name: string;
  anchor: string | null;
  description: string | null;
  type: string | null;
  defaultValue: string | null;
  required: boolean;
  deprecated: boolean;
}

export interface CodeTab {
  packageName: string | null;
  installCommand: string | null;
  sourceUrl: string | null;
  bundleUrl: string | null;
  propsSectionFound: boolean;
  groups: { label: string | null; count: number }[];
  props: PropRow[];
}

export interface ParsedDocsPage {
  url: string;
  path: string;
  title: string | null;
  lead: string | null;
  metaDescription: string | null;
  statusNotes: StatusNote[];
  tabs: TabLink[];
  headings: PageHeading[];
  sections: Section[];
  /** Internal links in the main content (not navigation) to component docs (paths, in order). */
  componentLinks: string[];
  code: CodeTab | null;
  /** Side-navigation entries nested under `navUnder` (sub-pages that only appear in an expanded navigation). */
  navChildren: NavEntry[];
  /** True when the page is the site's 404 template. */
  notFound: boolean;
}

/* ------------------------------------------------------------------------------------------ */
/* Loading                                                                                     */
/* ------------------------------------------------------------------------------------------ */

export function loadPage(html: string): CheerioAPI {
  const $ = cheerio.load(html);
  $("style,script,noscript,svg,pre,textarea,iframe,template,img").remove();
  return $;
}

const BLOCK_TAGS = new Set([
  "p", "div", "li", "ul", "ol", "h1", "h2", "h3", "h4", "h5", "h6", "td", "th", "tr", "table", "section", "br", "dd", "dt", "dl",
  "blockquote", "caption", "figure", "figcaption", "header", "footer", "nav", "main", "article", "aside", "hr",
]);

/** Text content with whitespace between block-level elements (list items, paragraphs, cells). */
function nodeText(node: El): string {
  if (!node) return "";
  if (node.type === "text") return node.data ?? "";
  if (node.type !== "tag" && node.type !== "root") return "";
  const inner = ((node.children ?? []) as El[]).map(nodeText).join("");
  // Do / Don't captions of guidance cards read as "Do: <text>".
  if (node.type === "tag" && /^h[3-6]$/.test(node.name) && /^\s*(do|don[’']t|caution)\s*$/i.test(inner)) return ` ${inner.trim()}: `;
  return node.type === "tag" && BLOCK_TAGS.has(node.name) ? ` ${inner} ` : inner;
}

const text = ($: CheerioAPI, el: El | Sel): string => cleanText(($(el).toArray() as El[]).map(nodeText).join(" "));

/** Resolve an href to an internal docs path ("/components/x") or an absolute external URL; null for anchors/mailto. */
export function resolveHref(href: string | undefined | null): string | null {
  if (!href) return null;
  const h = href.trim();
  if (!h || h.startsWith("#") || /^(mailto|tel|javascript):/i.test(h)) return null;
  try {
    const u = new URL(h, DOCS_ORIGIN);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (u.origin === DOCS_ORIGIN) return docsPath(u.href);
    return u.href;
  } catch {
    return null;
  }
}

/** Gatsby redirect stub (`<script>window.location.href="/components/x/examples"</script>`) target. */
export function parseRedirectStub(html: string): string | null {
  if (html.length > 2000) return null;
  const m = /window\.location\.href\s*=\s*["']([^"']+)["']/.exec(html);
  return m ? docsPath(m[1]!) : null;
}

/* ------------------------------------------------------------------------------------------ */
/* Navigation                                                                                  */
/* ------------------------------------------------------------------------------------------ */

/** Side-navigation entries for component docs (deduplicated by path, document order). */
export function parseNav($: CheerioAPI): NavEntry[] {
  const out = new Map<string, NavEntry>();
  $("nav [role=group][aria-labelledby]").each((_, g) => {
    const id = $(g).attr("aria-labelledby") ?? "";
    const heading = id ? text($, $(`[id="${id.replace(/"/g, '\\"')}"]`).first()) : "";
    if (!heading) return;
    $(g)
      .find("a[href]")
      .each((__, a) => {
        const path = resolveHref($(a).attr("href"));
        if (!path || !path.startsWith("/components/")) return;
        const name = text($, $(a).find("span span").first()) || text($, a);
        if (!name) return;
        const wrap = $(a).closest("[data-selected]");
        const badge = wrap.length ? text($, wrap.clone().children("a").remove().end()) || null : null;
        const prev = out.get(path);
        // Deeper (more specific) group wins: nested groups are visited after their parents.
        if (!prev || prev.category !== heading) out.set(path, { name, path, category: heading, badge: badge ?? prev?.badge ?? null });
      });
  });
  return [...out.values()];
}

/** All internal paths linked from navigation landmarks (side and top navigation). */
export function parseNavPaths($: CheerioAPI): string[] {
  const paths: string[] = [];
  $("nav a[href], header a[href]").each((_, a) => {
    const p = resolveHref($(a).attr("href"));
    if (p && p.startsWith("/")) paths.push(p);
  });
  return uniq(paths);
}

/* ------------------------------------------------------------------------------------------ */
/* Documentation headings and sections                                                         */
/* ------------------------------------------------------------------------------------------ */

function isDocHeading($: CheerioAPI, h: El): boolean {
  if ($(h).closest(PROPS_CONTAINER).length) return false;
  return $(h).siblings("button").find('[aria-label^="Copy link to"]').length > 0;
}

interface DocHeadingEl {
  el: El;
  wrapper: El;
  level: number;
  id: string | null;
  text: string;
}

function docHeadings($: CheerioAPI, root: Sel): DocHeadingEl[] {
  const out: DocHeadingEl[] = [];
  root.find("h1,h2,h3,h4,h5").each((_, h) => {
    if (!isDocHeading($, h)) return;
    const wrapper = $(h).parent().parent();
    const id = $(h).attr("id") ?? wrapper.attr("id") ?? null;
    const t = text($, h);
    if (!t) return;
    out.push({ el: h, wrapper: wrapper.get(0), level: Number(h.tagName.slice(1)) || 2, id, text: t });
  });
  return out;
}

function sectionItems($: CheerioAPI, els: El[]): SectionItem[] {
  const items: SectionItem[] = [];
  for (const el of els) {
    $(el)
      .find("li")
      .addBack("li")
      .each((_, li) => {
        // "<strong>Term:</strong> text" (possibly wrapped in div/p); the term must lead the item.
        const strong = $(li).find("strong,b").first();
        if (!strong.length) return;
        const strongText = text($, strong);
        const term = strongText.replace(/:$/, "").trim();
        const full = text($, li);
        if (!term || term.length > 60 || !full.startsWith(strongText)) return;
        const rest = full.slice(strongText.length).replace(/^[:\s–-]+/, "").trim();
        items.push({ term, text: rest });
      });
  }
  return items;
}

function sectionLinks($: CheerioAPI, els: El[]): string[] {
  const links: string[] = [];
  for (const el of els) {
    $(el)
      .find("a[href]")
      .addBack("a[href]")
      .each((_, a) => {
        const p = resolveHref($(a).attr("href"));
        if (p) links.push(p);
      });
  }
  return uniq(links);
}

const bound = (s: string) => (s.length > MAX_SECTION_TEXT ? `${s.slice(0, MAX_SECTION_TEXT - 1).trimEnd()}…` : s);

/** Sections keyed by documentation headings; content is the flat sibling flow after each heading wrapper. */
export function parseSections($: CheerioAPI, root: Sel): { headings: PageHeading[]; sections: Section[] } {
  const hs = docHeadings($, root);
  const wrappers = new Set(hs.map((h) => h.wrapper));
  const sections: Section[] = [];
  for (let i = 0; i < hs.length; i++) {
    const h = hs[i]!;
    const own: El[] = [];
    const full: El[] = [];
    let ownDone = false;
    let sib = $(h.wrapper).next();
    // Walk siblings; stop "own" content at any heading wrapper, "full" content at one of the same or higher level.
    while (sib.length) {
      const node = sib.get(0);
      if (wrappers.has(node)) {
        const other = hs.find((x) => x.wrapper === node);
        ownDone = true;
        if (other && other.level <= h.level) break;
      } else {
        if (!ownDone) own.push(node);
        full.push(node);
      }
      sib = sib.next();
    }
    const ownText = own.map((e) => text($, e)).filter(Boolean).join(" ");
    const fullText = full.map((e) => text($, e)).filter(Boolean).join(" ");
    sections.push({
      id: h.id,
      level: h.level,
      heading: h.text,
      text: bound(ownText),
      fullText: bound(fullText),
      links: sectionLinks($, own),
      items: sectionItems($, own),
    });
  }
  return { headings: hs.map((h) => ({ level: h.level, id: h.id, text: h.text })), sections };
}

/* ------------------------------------------------------------------------------------------ */
/* Code tab                                                                                    */
/* ------------------------------------------------------------------------------------------ */

function parsePropsContainer($: CheerioAPI, container: Sel, group: string | null): PropRow[] {
  const rows: PropRow[] = [];
  container.children("div[id]").each((_, d) => {
    const caption = $(d).find("caption").first();
    const name = text($, caption.find("code").first());
    if (!name) return;
    const captionText = text($, caption);
    const badges = captionText.slice(captionText.indexOf(name) + name.length);
    const fields: Record<string, { text: string; code: string }> = {};
    $(d)
      .find("tbody > tr")
      .each((__, tr) => {
        const th = text($, $(tr).children("th").first()).toLowerCase();
        const td = $(tr).children("td").first();
        if (!th || !td.length) return;
        const code = td
          .find("code")
          .map((___, c) => text($, c))
          .get()
          .join(" ");
        fields[th] = { text: text($, td), code };
      });
    const desc = fields.description?.text ?? null;
    rows.push({
      group,
      name,
      anchor: $(d).attr("id") ?? null,
      description: desc && desc !== "No description." ? desc : null,
      type: fields.type ? fields.type.code || fields.type.text || null : null,
      defaultValue: fields.default ? fields.default.code || fields.default.text || null : null,
      required: /\bRequired\b/.test(badges),
      deprecated: /\bDeprecated\b/.test(badges),
    });
  });
  return rows;
}

export function parseCodeTab($: CheerioAPI, panel: Sel): CodeTab {
  const install: Record<string, { text: string; href: string | null }> = {};
  panel.find("tr").each((_, tr) => {
    if ($(tr).closest(PROPS_CONTAINER).length) return;
    const th = text($, $(tr).children("th").first()).toLowerCase();
    const td = $(tr).children("td").first();
    if (!th || !td.length || install[th]) return;
    install[th] = { text: text($, td), href: td.find("a[href]").first().attr("href") ?? null };
  });
  const npmText = install.npm?.text ?? "";
  const fromNpm = /(@atlaskit\/[a-z0-9._-]+)/.exec(npmText)?.[1] ?? /npmjs\.com\/package\/(@[^/?#]+\/[^/?#]+)/.exec(install.npm?.href ?? "")?.[1] ?? null;
  const fromInstall = /(@atlaskit\/[a-z0-9._-]+)/.exec(install.install?.text ?? "")?.[1] ?? null;
  const sourceHref = install.source?.href ?? null;

  const props: PropRow[] = [];
  const groups: CodeTab["groups"] = [];
  let label: string | null = null;
  let inHooks = false;
  let propsSectionFound = false;
  panel.find(`h1,h2,h3,h4,h5,${PROPS_CONTAINER}`).each((_, el) => {
    if ($(el).is(PROPS_CONTAINER)) {
      if (inHooks) return;
      propsSectionFound = true;
      const rows = parsePropsContainer($, $(el), label);
      groups.push({ label, count: rows.length });
      props.push(...rows);
      return;
    }
    if ($(el).closest(PROPS_CONTAINER).length) return;
    const t = text($, el);
    if (/^props$/i.test(t)) {
      propsSectionFound = true;
      label = null;
      inHooks = false;
    } else if (/^hooks?$/i.test(t)) inHooks = true;
    else if (/\sprops$/i.test(t)) {
      label = t.replace(/\s+props$/i, "").trim() || null;
      inHooks = false;
    }
  });
  return {
    packageName: fromNpm ?? fromInstall,
    installCommand: install.install?.text || null,
    sourceUrl: sourceHref && /^https:\/\//.test(sourceHref) ? sourceHref : null,
    bundleUrl: install.bundle?.href && /^https:\/\//.test(install.bundle.href) ? install.bundle.href : null,
    propsSectionFound,
    groups,
    props,
  };
}

/* ------------------------------------------------------------------------------------------ */
/* Pages                                                                                       */
/* ------------------------------------------------------------------------------------------ */

export function parseDocsPage(html: string, url: string, opts: { code?: boolean; navUnder?: string } = {}): ParsedDocsPage {
  const $ = loadPage(html);
  const main = $("#main-content").first();
  const root = main.length ? main : $("body");
  const titleTag = text($, $("title").first());
  const notFound = /^(page not found|404)/i.test(titleTag) || /og:url" content="https:\/\/atlassian\.design\/404"/.test(html.slice(0, 5000));
  const h1 = root.find("h1").first();
  const title = h1.length ? text($, h1) || null : null;
  let lead: string | null = null;
  if (h1.length) {
    const next = h1
      .nextAll()
      .filter((_, e) => text($, e).length > 0)
      .first();
    if (next.length && !next.is("section,div[role=tablist]")) lead = text($, next) || null;
  }
  const statusNotes: StatusNote[] = [];
  root.find("section").each((_, s) => {
    if ($(s).closest("[role=tabpanel]").length) return;
    const heading = text($, $(s).find("h2,h3").first());
    if (!heading) return;
    const body = text($, $(s).find("p"));
    const tone = $(s).find("[role=img][aria-label]").first().attr("aria-label") ?? null;
    statusNotes.push({ heading, text: body, tone, links: sectionLinks($, [s]) });
  });
  const tabs: TabLink[] = [];
  root.find("[role=tablist] a[role=tab][href]").each((_, a) => {
    const p = resolveHref($(a).attr("href"));
    if (!p || !p.startsWith("/")) return;
    tabs.push({ label: text($, a), path: p, selected: $(a).attr("aria-selected") === "true" });
  });
  const panel = root.find("[role=tabpanel]").first();
  const content = panel.length ? panel : root;
  const { headings, sections } = parseSections($, content);
  const componentLinks = uniq(
    content
      .find("a[href]")
      .map((_, a) => resolveHref($(a).attr("href")))
      .get()
      .filter((p): p is string => typeof p === "string" && p.startsWith("/components/")),
  );
  const metaDescription = $('meta[name="description"]').attr("content")?.trim() || null;
  return {
    url,
    path: docsPath(url),
    title,
    lead,
    metaDescription,
    statusNotes,
    tabs,
    headings,
    sections,
    componentLinks,
    code: opts.code ? parseCodeTab($, content) : null,
    navChildren: opts.navUnder ? parseNav($).filter((e) => e.path.startsWith(`${opts.navUnder}/`)) : [],
    notFound,
  };
}

/** Components index page: navigation entries plus every navigation path (for guidance-page discovery). */
export function parseIndexPage(html: string): { entries: NavEntry[]; navPaths: string[] } {
  const $ = loadPage(html);
  return { entries: parseNav($), navPaths: parseNavPaths($) };
}
