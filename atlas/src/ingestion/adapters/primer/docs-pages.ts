/**
 * Static HTML parsers for primer.style (prerendered Next.js pages) and its sitemap.
 * cheerio only; scripts are never executed (and are removed before text extraction).
 */
import * as cheerio from "cheerio";
import type { Cheerio, CheerioAPI } from "cheerio";
import { ARIA_ROLES, DOCS_ORIGIN } from "./constants";
import { shortText, uniq } from "./text";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sel = Cheerio<any>;

export type ComponentPageType = "overview" | "guidelines" | "accessibility" | "other";

export interface PageHeading {
  level: number;
  id: string | null;
  text: string;
}

export interface Implementation {
  label: string;
  status: string | null;
  links: { text: string; href: string }[];
}

export interface KeyboardRow {
  keys: string;
  action: string;
  context: string | null;
  anchor: string | null;
}

export interface ParsedA11y {
  keyboard: KeyboardRow[];
  keyboardSectionFound: boolean;
  mentionsKeys: boolean;
  roles: string[];
  guidance: string | null;
  focusManagement: { text: string; anchor: string | null } | null;
  screenReader: { text: string; anchor: string | null } | null;
  apgPatterns: string[];
  wcag: string[];
}

export interface ParsedComponentPage {
  url: string;
  docsSlug: string;
  pageType: ComponentPageType;
  title: string | null;
  description: string | null;
  metaDescription: string | null;
  implementations: Implementation[];
  examples: { id: string; title: string }[];
  componentLinks: string[];
  headings: PageHeading[];
  a11y: ParsedA11y | null;
  responsive: { text: string; anchor: string | null; heading: string } | null;
  mentionsResponsive: boolean;
}

export interface ParsedSimplePage {
  url: string;
  title: string | null;
  description: string | null;
  metaDescription: string | null;
  headings: PageHeading[];
  componentLinks: string[];
  /** First few content paragraphs, each a short excerpt (<= 280 chars). */
  paragraphs: string[];
}

const clean = (s: string | undefined | null) => (s ?? "").replace(/\s+/g, " ").trim();

/** Canonical docs URL: absolute, trailing slash, no query/hash. */
export function canonicalDocsUrl(href: string, base = DOCS_ORIGIN): string | null {
  try {
    const u = new URL(href, base);
    if (u.origin !== DOCS_ORIGIN) return null;
    let p = u.pathname;
    if (!p.endsWith("/")) p += "/";
    return `${DOCS_ORIGIN}${p}`;
  } catch {
    return null;
  }
}

/** /product/components/<slug>/... -> slug */
export function componentSlugFromUrl(url: string): string | null {
  const m = /^\/product\/components\/([a-z0-9-]+)\/?/.exec(new URL(url, DOCS_ORIGIN).pathname);
  return m ? m[1]! : null;
}

export function parseSitemap(xml: string): string[] {
  const $ = cheerio.load(xml, { xml: true });
  const out: string[] = [];
  $("url > loc, loc").each((_, el) => {
    const t = clean($(el).text());
    if (t) out.push(t);
  });
  return uniq(out).sort();
}

function loadMain(html: string): { $: CheerioAPI; main: Sel; content: Sel; meta: string | null } {
  const $ = cheerio.load(html);
  $("script, style, noscript, template").remove();
  const meta = clean($('meta[name="description"]').attr("content")) || null;
  let main = $("main").first();
  if (!main.length) main = $("body").first();
  let content = main.find('[class*="_Markdown"]').first();
  if (!content.length) content = main;
  return { $, main, content, meta };
}

function headingText($: CheerioAPI, el: Sel): string {
  return clean(el.text()).replace(/\s*#\s*$/, "");
}

function collectHeadings($: CheerioAPI, content: Sel): PageHeading[] {
  const out: PageHeading[] = [];
  content.find("h2, h3, h4").each((_, el) => {
    const e = $(el);
    const text = headingText($, e);
    if (!text) return;
    const id = e.attr("id") ?? null;
    out.push({ level: Number(el.tagName.slice(1)), id: id && !/^_R_/.test(id) ? id : null, text });
  });
  return out;
}

function collectComponentLinks($: CheerioAPI, content: Sel, pageUrl: string, selfSlug: string | null): string[] {
  const out: string[] = [];
  content.find("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    const abs = canonicalDocsUrl(href, pageUrl);
    if (!abs) return;
    const slug = componentSlugFromUrl(abs);
    if (!slug || slug === selfSlug) return;
    out.push(`${DOCS_ORIGIN}/product/components/${slug}/`);
  });
  return uniq(out);
}

function headerDescription($: CheerioAPI, main: Sel): { title: string | null; description: string | null } {
  const h1 = main.find("h1").first();
  const title = clean(h1.text()) || null;
  const p = h1.nextAll("p").first();
  const description = clean(p.text()) || null;
  return { title, description };
}

/** Implementation cards ("React ready | Storybook | Source", "Rails", "Figma"). */
function parseImplementations($: CheerioAPI, main: Sel, pageUrl: string): Implementation[] {
  const out: Implementation[] = [];
  main.find('[class*="implementationLabel"]').each((_, el) => {
    const label = clean($(el).text());
    if (!label) return;
    // Climb to the nearest ancestor that holds this card's links footer (label -> stack -> stack -> card).
    let card = $(el).parent();
    for (let i = 0; i < 6 && card.length && !card.find('a[class*="implementationLink"]').length; i++) card = card.parent();
    const status = clean(card.find('[class*="statusLabel"]').first().text()).toLowerCase() || null;
    const links: { text: string; href: string }[] = [];
    card.find('a[class*="implementationLink"]').each((__, a) => {
      const href = $(a).attr("href");
      const text = clean($(a).text());
      if (!href || !text) return;
      try {
        links.push({ text, href: new URL(href, pageUrl).toString() });
      } catch {
        /* ignore malformed */
      }
    });
    if (!out.some((o) => o.label === label)) out.push({ label, status, links });
  });
  return out;
}

interface Block {
  kind: "h" | "p" | "li" | "table";
  level: number;
  el: Sel;
  text: string;
  id: string | null;
}

function linearize($: CheerioAPI, content: Sel): Block[] {
  const blocks: Block[] = [];
  content.find("h2, h3, h4, h5, p, li, table").each((_, el) => {
    const e = $(el);
    const tag = el.tagName.toLowerCase();
    if (tag !== "table" && e.parents("table").length) return;
    if ((tag === "p" || tag === "li") && e.parents("li").length) return;
    if (/^h\d$/.test(tag)) {
      const id = e.attr("id") ?? null;
      blocks.push({ kind: "h", level: Number(tag.slice(1)), el: e, text: headingText($, e), id: id && !/^_R_/.test(id) ? id : null });
    } else if (tag === "table") {
      blocks.push({ kind: "table", level: 0, el: e, text: "", id: null });
    } else {
      const text = clean(e.text());
      if (text) blocks.push({ kind: tag as "p" | "li", level: 0, el: e, text, id: null });
    }
  });
  return blocks;
}

const ROLE_PATTERNS = [
  // "with the required group and treeitem roles" -> group, treeitem
  /((?:\b[a-z]+\b(?:,\s*|\s+and\s+|\s+or\s+))*\b[a-z]+\b)\s+roles?\b/gi,
  /\brole\s*=\s*["“'`]?\s*([a-z]+)/gi,
  /\brole\s*\(\s*["“'`]?([a-z]+)["”'`]?\s*\)/gi,
  /\brole of\s+["“'`]?([a-z]+)/gi,
  /\brole\s+["“'`]([a-z]+)["”'`]/gi,
];

export function extractRoles(text: string): string[] {
  const out: string[] = [];
  for (const re of ROLE_PATTERNS) {
    for (const m of text.matchAll(re)) {
      for (const w of m[1]!.toLowerCase().split(/,\s*|\s+and\s+|\s+or\s+/)) if (ARIA_ROLES.has(w.trim())) out.push(w.trim());
    }
  }
  return uniq(out);
}

const KEY_WORDS = /\b(Enter|Space|Spacebar|Tab|Esc|Escape|Arrow ?(?:Up|Down|Left|Right)|Home|End|Page ?(?:Up|Down))\b/;
/** A <code>/<kbd> text that names a key or chord ("Enter", "Shift+Tab", "ArrowDown", "Esc", "→"). */
const KEY_CODE_RE =
  /^(?:(?:Shift|Ctrl|Control|Alt|Option|Cmd|Command|Meta|Mod)\s*\+\s*)*(?:Enter|Return|Space|Spacebar|Tab|Esc|Escape|Backspace|Delete|Home|End|Page ?Up|Page ?Down|PageUp|PageDown|Arrow ?(?:Up|Down|Left|Right)|Up|Down|Left|Right|[←→↑↓]|[A-Za-z0-9])$/i;
/** Prose key mentions without code formatting. */
const KEY_PHRASE_RE = /\b(arrow keys|cursor keys|Shift ?\+ ?Tab|Enter|Space(?:bar)?|Tab|Esc(?:ape)?|Backspace|Delete|Home|End|Page ?Up|Page ?Down)\b/g;
const CONDITIONAL_RE = /\b(if|should|intended|in the case|for (?:a|the) split)\b/i;

/** Keep only the sentences that mention one of the keys (falls back to the whole text). */
function sentencesMentioning(text: string, keys: string[]): string {
  const sentences = text.split(/(?<=[.!?])\s+(?=[A-Z0-9"'“(`<])/);
  const lower = keys.map((k) => k.toLowerCase().replace(/^arrow keys$/, "arrow"));
  const keep = new Set<number>();
  sentences.forEach((s, i) => {
    if (!lower.some((k) => s.toLowerCase().includes(k) || (k === "arrow" && /cursor keys/i.test(s)))) return;
    keep.add(i);
    // Keep the condition a dependent sentence refers back to ("When X ... . Instead, ...").
    if (i > 0 && /^(Instead|However|Then|Also|Otherwise|Additionally|This|It|They)\b/.test(s)) keep.add(i - 1);
  });
  return keep.size ? sentences.filter((_, i) => keep.has(i)).join(" ") : text;
}

function keysMentioned($: CheerioAPI, el: Sel, text: string): string[] {
  const coded = el
    .find("code, kbd")
    .map((_, c) => clean($(c).text()))
    .get()
    .filter((t) => t.length <= 24 && KEY_CODE_RE.test(t) && !/^[A-Za-z0-9]$/.test(t));
  if (coded.length) return uniq(coded);
  const out: string[] = [];
  for (const m of text.matchAll(KEY_PHRASE_RE)) {
    const k = m[1]!;
    // "Tab"/"Space"/"Home"/"End"/"Delete" are ordinary words too; require key context nearby.
    if (/^(tab|space|home|end|delete|enter)$/i.test(k) && !/\bkey|\bpress/i.test(text)) continue;
    out.push(/^(arrow|cursor) keys$/i.test(k) ? "Arrow keys" : k);
  }
  return uniq(out);
}

function parseA11y($: CheerioAPI, content: Sel, blocks: Block[]): ParsedA11y {
  const keyboard: KeyboardRow[] = [];
  let keyboardSectionFound = false;
  const roles: string[] = [];
  let guidance: string | null = null;
  let focusManagement: ParsedA11y["focusManagement"] = null;
  let screenReader: ParsedA11y["screenReader"] = null;
  const stack: { level: number; text: string; id: string | null; el: Sel }[] = [];
  let pendingKeyHeading: { keys: string; context: string | null; anchor: string | null } | null = null;
  /** Prose requirements in "Keyboard" sections (used only when no table / key-heading rows exist). */
  const proseKeyboard: KeyboardRow[] = [];
  let wantFocus: string | null | undefined; // anchor of focus heading awaiting first paragraph
  let wantSr: string | null | undefined;

  const anchorOf = () => {
    for (let i = stack.length - 1; i >= 0; i--) if (stack[i]!.id) return stack[i]!.id;
    return null;
  };
  const inSection = (re: RegExp) => stack.some((s) => re.test(s.text));

  for (const b of blocks) {
    if (b.kind === "h") {
      while (stack.length && stack[stack.length - 1]!.level >= b.level) stack.pop();
      stack.push({ level: b.level, text: b.text, id: b.id, el: b.el });
      pendingKeyHeading = null;
      if (/keyboard/i.test(b.text)) keyboardSectionFound = true;
      if (/focus/i.test(b.text) && !focusManagement) wantFocus = b.id;
      if (/screen ?reader/i.test(b.text) && !screenReader) wantSr = b.id;
      // Heading-style keyboard docs: "<h3><code>Enter</code> or <code>Space</code></h3>" inside a keyboard section.
      if (b.level >= 3 && inSection(/keyboard/i) && b.el.find("code, kbd").length) {
        const parent = stack.length > 1 ? stack[stack.length - 2]!.text : null;
        pendingKeyHeading = { keys: b.text, context: parent && !/keyboard/i.test(parent) ? parent : null, anchor: b.id };
      }
      continue;
    }
    if (b.kind === "table") {
      const headers = b.el.find("thead th, tr:first-child th").map((_, th) => clean($(th).text())).get();
      if (!headers.length || !/^key/i.test(headers[0]!)) continue;
      keyboardSectionFound = true;
      const ctxHeading = stack.length ? stack[stack.length - 1]!.text : null;
      const context = ctxHeading && !/keyboard/i.test(ctxHeading) ? ctxHeading : null;
      b.el.find("tbody tr").each((_, tr) => {
        const tds = $(tr).find("td");
        if (tds.length < 2) return;
        const keys = clean(tds.eq(0).text());
        const cell = tds.eq(1);
        const lis = cell.find("li").map((__, li) => clean($(li).text())).get().filter(Boolean);
        const actionRaw = lis.length ? lis.join(" ") : clean(cell.text());
        const action = shortText(actionRaw, 240);
        if (keys && action) keyboard.push({ keys: keys.slice(0, 120), action, context, anchor: anchorOf() });
      });
      continue;
    }
    // paragraph / list item
    if (pendingKeyHeading) {
      const action = shortText(b.text, 240);
      if (action) keyboard.push({ keys: pendingKeyHeading.keys.slice(0, 120), action, context: pendingKeyHeading.context, anchor: pendingKeyHeading.anchor });
      pendingKeyHeading = null;
    }
    if (!guidance && b.kind === "p" && b.text.length >= 40) guidance = shortText(b.text, 280);
    if (wantFocus !== undefined && !focusManagement && b.text.length >= 30) {
      focusManagement = { text: shortText(b.text, 280)!, anchor: wantFocus };
      wantFocus = undefined;
    }
    if (wantSr !== undefined && !screenReader && b.text.length >= 20) {
      screenReader = { text: shortText(b.text, 280)!, anchor: wantSr };
      wantSr = undefined;
    }
    if (inSection(/keyboard/i) && !pendingKeyHeading) {
      const keys = keysMentioned($, b.el, b.text);
      const action = keys.length ? shortText(sentencesMentioning(b.text, keys), 240) : null;
      if (action) proseKeyboard.push({ keys: keys.join(" / ").slice(0, 120), action, context: null, anchor: anchorOf() });
    }
    // Roles: only statements about what the component renders (skip conditional / recommendation sentences).
    if (inSection(/built-in accessibility|component tests/i) && !CONDITIONAL_RE.test(b.text)) roles.push(...extractRoles(b.text));
  }
  if (!keyboard.length) keyboard.push(...proseKeyboard);

  const apgPatterns: string[] = [];
  const wcag: string[] = [];
  content.find("a[href]").each((_, a) => {
    const href = $(a).attr("href") ?? "";
    const apg = /w3\.org\/WAI\/ARIA\/apg\/patterns\/([a-z0-9-]+)/i.exec(href);
    if (apg) apgPatterns.push(apg[1]!.toLowerCase());
    const und = /w3\.org\/WAI\/WCAG2\d\/Understanding\/([a-z0-9-]+)/i.exec(href);
    if (und) wcag.push(`understanding:${und[1]!.toLowerCase().replace(/\.html$/, "")}`);
  });
  const allText = clean(content.text());
  for (const m of allText.matchAll(/\b(?:WCAG(?:\s*2(?:\.\d)?)?|SC|Success Criterion)\s*(?:SC\s*)?(\d\.\d{1,2}\.\d{1,2})\b/g)) wcag.push(m[1]!);

  return {
    keyboard: dedupeKeyboard(keyboard),
    keyboardSectionFound,
    mentionsKeys: KEY_WORDS.test(allText),
    roles: uniq(roles),
    guidance,
    focusManagement,
    screenReader,
    apgPatterns: uniq(apgPatterns),
    wcag: uniq(wcag),
  };
}

function dedupeKeyboard(rows: KeyboardRow[]): KeyboardRow[] {
  const seen = new Set<string>();
  return rows.filter((r) => {
    const k = `${r.context ?? ""}|${r.keys}|${r.action}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

const RESPONSIVE_RE = /responsive|narrow|small screen|mobile|viewport/i;

export function parseComponentPage(html: string, url: string, pageType: ComponentPageType): ParsedComponentPage {
  const { $, main, content, meta } = loadMain(html);
  const docsSlug = componentSlugFromUrl(url) ?? "";
  const { title, description } = headerDescription($, main);
  const blocks = linearize($, content);
  const headings = collectHeadings($, content);

  const examples: { id: string; title: string }[] = [];
  if (pageType === "overview") {
    let inExamples = false;
    for (const b of blocks) {
      if (b.kind !== "h") continue;
      if (b.level === 2) {
        inExamples = /examples/i.test(b.text) && /react/i.test(b.id ?? b.text);
        continue;
      }
      if (inExamples && b.level === 3 && b.id && !/more code examples/i.test(b.text)) examples.push({ id: b.id, title: b.text });
    }
  }

  let responsive: ParsedComponentPage["responsive"] = null;
  if (pageType !== "accessibility") {
    for (let i = 0; i < blocks.length && !responsive; i++) {
      const b = blocks[i]!;
      if (b.kind !== "h" || !RESPONSIVE_RE.test(b.text)) continue;
      for (let j = i + 1; j < blocks.length; j++) {
        const n = blocks[j]!;
        if (n.kind === "h" && n.level <= b.level) break;
        if ((n.kind === "p" || n.kind === "li") && n.text.length >= 30) {
          let text = n.text;
          // "Some strategies ... include:" -> append the list items that follow.
          const wantsList = text.endsWith(":");
          for (let k = j + 1; wantsList && k < blocks.length && blocks[k]!.kind === "li"; k++) text += ` ${blocks[k]!.text};`;
          responsive = { text: shortText(text.replace(/;$/, "."), 280)!, anchor: b.id, heading: b.text };
          break;
        }
      }
    }
  }

  return {
    url,
    docsSlug,
    pageType,
    title,
    description: description ?? meta,
    metaDescription: meta,
    implementations: parseImplementations($, main, url),
    examples,
    componentLinks: collectComponentLinks($, content, url, docsSlug),
    headings,
    a11y: pageType === "accessibility" ? parseA11y($, content, blocks) : null,
    responsive,
    mentionsResponsive: RESPONSIVE_RE.test(clean(content.text())),
  };
}

export function parseSimplePage(html: string, url: string): ParsedSimplePage {
  const { $, main, content, meta } = loadMain(html);
  const { title, description } = headerDescription($, main);
  const paragraphs = linearize($, content)
    .filter((b) => b.kind === "p" && b.text.length >= 30)
    .slice(0, 3)
    .map((b) => shortText(b.text, 280)!)
    .filter(Boolean);
  return {
    url,
    title,
    description: description ?? meta,
    metaDescription: meta,
    headings: collectHeadings($, content),
    componentLinks: collectComponentLinks($, content, url, null),
    paragraphs,
  };
}
