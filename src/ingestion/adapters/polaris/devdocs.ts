/**
 * shopify.dev Markdown alternates (`<page>.md`) for the Polaris web components reference, App Home
 * patterns and system pages. Parsed statically (gray-matter + mdast); code blocks are never stored.
 */
import type { Nodes, RootContent } from "mdast";
import { cleanText, linksOf, listItems, paragraphs, parseMd, sectionsAt } from "./md";
import { collapse, stripZw } from "./text";

/* -------------------------------------------------------------------------- */
/* Index pages (web components / patterns)                                     */
/* -------------------------------------------------------------------------- */

export interface IndexItem {
  title: string;
  /** Human docs URL (html). */
  url: string;
  summary: string | null;
  section: string;
}

export interface IndexPage {
  title: string | null;
  description: string | null;
  apiVersion: string | null;
  sections: { name: string; description: string | null }[];
  items: IndexItem[];
}

const LINK_LINE = /^\[([^\]]+)\]\((https:\/\/shopify\.dev\/[^)\s]+)\)$/;

/** Card grids on shopify.dev index pages: an image link, then a title link, then a summary link (same URL). */
export function parseIndexPage(md: string, prefix: string): IndexPage {
  const { frontmatter } = parseMd(md);
  const body = md.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "");
  const sections: IndexPage["sections"] = [];
  const items: IndexItem[] = [];
  let section = "";
  let expectSectionDesc = false;
  let cur: IndexItem | null = null;
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const h = /^##\s+(.+)$/.exec(line);
    if (h) {
      section = collapse(h[1]!);
      sections.push({ name: section, description: null });
      expectSectionDesc = true;
      cur = null;
      continue;
    }
    if (line.startsWith("#")) continue;
    const m = LINK_LINE.exec(line);
    if (m) {
      expectSectionDesc = false;
      const url = m[2]!.split("#")[0]!;
      if (!url.startsWith(prefix)) continue;
      const text = collapse(m[1]!);
      if (cur && cur.url === url) {
        if (!cur.summary) cur.summary = text;
        continue;
      }
      cur = { title: text, url, summary: null, section };
      items.push(cur);
      continue;
    }
    if (expectSectionDesc && !line.startsWith("[") && !line.startsWith("*")) {
      sections[sections.length - 1]!.description = collapse(line);
      expectSectionDesc = false;
    }
  }
  const dedup = new Map<string, IndexItem>();
  for (const it of items) if (!dedup.has(it.url)) dedup.set(it.url, it);
  return {
    title: str(frontmatter.title),
    description: str(frontmatter.description),
    apiVersion: str(frontmatter.api_version),
    sections,
    items: [...dedup.values()],
  };
}

/* -------------------------------------------------------------------------- */
/* Component reference pages                                                   */
/* -------------------------------------------------------------------------- */

export interface DocProp {
  name: string;
  type: string | null;
  defaultValue: string | null;
  deprecated: boolean;
  deprecationNote: string | null;
  description: string | null;
}

export interface DocApiSection {
  /** "" for the page's own component; otherwise the subcomponent heading ("Table row", "Option group"). */
  heading: string;
  main: boolean;
  props: DocProp[];
  events: DocProp[];
  slots: DocProp[];
  line: number | null;
}

export interface WcPage {
  title: string;
  description: string | null;
  apiVersion: string | null;
  htmlUrl: string | null;
  intro: string[];
  useCases: string[];
  api: DocApiSection[];
  examples: { title: string; description: string | null }[];
  bestPractices: string[];
  limitations: string[];
  /** Prose of other guidance sections ("Content guidelines", "Useful for"): one joined string per section. */
  guidelines: string[];
  /** Links in the intro prose (e.g. "use [link](…/actions/link)"). */
  introLinks: { url: string; text: string }[];
}

const NON_STRUCTURAL_H2 = /^(html|jsx|tsx|js|ts|css|preact|react|remix|liquid|json)$/i;
const norm = (s: string) => stripZw(s).toLowerCase().replace(/[^a-z0-9]/g, "");

/** Parse one property/event/slot list item: **name**, **type**, **Default: x**, **deprecated**, text… */
function parseDocProp(li: Nodes): DocProp | null {
  if (li.type !== "listItem") return null;
  const kids = li.children;
  const first = kids[0];
  if (!first || first.type !== "paragraph") return null;
  const name = stripZw(cleanText(first)).replace(/\s+/g, "");
  if (!name || !/^[A-Za-z_$][\w$-]*$/.test(name)) return null;
  let type: string | null = null;
  let defaultValue: string | null = null;
  let deprecated = false;
  let deprecationNote: string | null = null;
  const desc: string[] = [];
  let afterDeprecatedLabel = false;
  for (let i = 1; i < kids.length; i++) {
    const k = kids[i]!;
    if (k.type !== "paragraph") continue;
    const onlyStrong = k.children.length === 1 && k.children[0]!.type === "strong";
    const t = collapse(cleanText(k));
    if (!t) continue;
    if (onlyStrong && /^default:\s*/i.test(t)) {
      defaultValue = t.replace(/^default:\s*/i, "");
      continue;
    }
    if (onlyStrong && /^deprecated$/i.test(t)) {
      deprecated = true;
      continue;
    }
    if (onlyStrong && /^deprecated:$/i.test(t)) {
      deprecated = true;
      afterDeprecatedLabel = true;
      continue;
    }
    if (onlyStrong && type === null && i === 1) {
      type = t;
      continue;
    }
    if (afterDeprecatedLabel) {
      deprecationNote = deprecationNote ?? t;
      continue;
    }
    desc.push(t);
  }
  return { name, type, defaultValue, deprecated, deprecationNote, description: desc.length ? desc.join(" ") : null };
}

function propsIn(nodes: RootContent[]): DocProp[] {
  const out: DocProp[] = [];
  for (const n of nodes) {
    if (n.type !== "list") continue;
    for (const li of n.children) {
      const p = parseDocProp(li);
      if (p) out.push(p);
    }
  }
  return out;
}

function apiSection(heading: string, main: boolean, nodes: RootContent[], line: number | null): DocApiSection {
  const subs = sectionsAt(nodes, 3);
  const sec: DocApiSection = { heading, main, props: propsIn(subs[0]!.nodes), events: [], slots: [], line };
  for (const s of subs.slice(1)) {
    const h = norm(s.heading);
    if (h === "events") sec.events.push(...propsIn(s.nodes));
    else if (h === "slots") sec.slots.push(...propsIn(s.nodes));
    else if (h === "properties") sec.props.push(...propsIn(s.nodes));
    // other h3s are helper type definitions (AnyString, CallbackEvent, …)
  }
  return sec;
}

export function parseWcPage(md: string): WcPage {
  const { frontmatter, tree } = parseMd(md);
  const sourceUrl = frontmatter.source_url as { html?: unknown } | undefined;
  const h1 = tree.children.find((n) => n.type === "heading" && n.depth === 1);
  const nodes = tree.children.filter((n) => n !== h1);
  const title = str(frontmatter.title) ?? (h1 ? cleanText(h1) : "");
  const h2s = sectionsAt(nodes, 2, (h) => !NON_STRUCTURAL_H2.test(h));
  const page: WcPage = {
    title,
    description: str(frontmatter.description),
    apiVersion: str(frontmatter.api_version),
    htmlUrl: str(sourceUrl?.html),
    intro: [],
    useCases: [],
    api: [],
    examples: [],
    bestPractices: [],
    limitations: [],
    guidelines: [],
    introLinks: [],
  };
  const titleKey = norm(title);
  for (const s of h2s) {
    const h = norm(s.heading);
    if (s.heading === "") {
      // Intro: paragraphs before the first h4 ("Use cases"), then possibly main-component API h3s (e.g. "Slots").
      const body = s.nodes;
      const firstH3 = body.findIndex((n) => n.type === "heading" && n.depth === 3);
      const leadNodes = firstH3 >= 0 ? body.slice(0, firstH3) : body;
      const lead = sectionsAt(leadNodes, 4);
      page.intro = paragraphs(lead[0]!.nodes);
      page.introLinks = linksOf(lead[0]!.nodes as Nodes[]);
      for (const sub of lead.slice(1)) if (norm(sub.heading) === "usecases") page.useCases = listItems(sub.nodes).map((x) => x.text);
      if (firstH3 >= 0) {
        const sec = apiSection("", true, body.slice(firstH3), null);
        if (sec.props.length || sec.events.length || sec.slots.length) page.api.push(sec);
      }
      continue;
    }
    if (h === "examples") {
      for (const ex of sectionsAt(s.nodes, 3, (h) => !NON_STRUCTURAL_H2.test(h)).slice(1)) {
        const p = paragraphs(ex.nodes)[0] ?? null;
        page.examples.push({ title: collapse(ex.heading), description: p });
      }
      continue;
    }
    if (h === "bestpractices") {
      page.bestPractices = listItems(s.nodes).map((x) => x.text);
      if (!page.bestPractices.length) page.bestPractices = paragraphs(s.nodes);
      continue;
    }
    if (h === "limitations") {
      page.limitations = listItems(s.nodes).map((x) => x.text);
      continue;
    }
    const main = h === "properties" || h === titleKey;
    const sec = apiSection(main ? "" : collapse(stripZw(s.heading)), main, s.nodes, s.line);
    if (!main && !sec.props.length && !sec.events.length && !sec.slots.length) {
      // Not an API section: keep its prose as guidance (bounded) instead of a phantom subcomponent.
      const text = [...paragraphs(s.nodes), ...listItems(s.nodes).map((x) => x.text)].slice(0, 12).join(" ");
      if (text) page.guidelines.push(text);
      continue;
    }
    const existing = main ? page.api.find((a) => a.main) : undefined;
    if (existing) {
      existing.props.push(...sec.props);
      existing.events.push(...sec.events);
      existing.slots.push(...sec.slots);
    } else page.api.push(sec);
  }
  if (!page.intro.length && page.description) page.intro = [collapse(page.description)];
  return page;
}

/* -------------------------------------------------------------------------- */
/* Pattern pages                                                               */
/* -------------------------------------------------------------------------- */

export interface PatternPage {
  title: string;
  description: string | null;
  htmlUrl: string | null;
  intro: string[];
  /** "Supported components" links (web component reference URLs). */
  components: { title: string; url: string }[];
  useCases: string[];
  examples: string[];
}

export function parsePatternPage(md: string): PatternPage {
  const { frontmatter, tree } = parseMd(md);
  const sourceUrl = frontmatter.source_url as { html?: unknown } | undefined;
  const nodes = tree.children.filter((n) => !(n.type === "heading" && n.depth === 1));
  const out: PatternPage = {
    title: str(frontmatter.title) ?? "",
    description: str(frontmatter.description),
    htmlUrl: str(sourceUrl?.html),
    intro: [],
    components: [],
    useCases: [],
    examples: [],
  };
  // Headings of any depth delimit blocks on these pages.
  let block = "";
  let h2 = "";
  let seenHeading = false;
  for (const n of nodes) {
    if (n.type === "heading") {
      const h = norm(cleanText(n));
      seenHeading = true;
      if (n.depth <= 2) h2 = h;
      else if (n.depth === 3 && h2 === "examples") out.examples.push(collapse(cleanText(n)));
      block = h;
      continue;
    }
    if (!seenHeading && n.type === "paragraph") {
      const t = cleanText(n);
      if (t) out.intro.push(t);
      continue;
    }
    if (block === "supportedcomponents" && n.type === "list") {
      for (const l of linksOf(n)) out.components.push({ title: l.text, url: l.url.split("#")[0]! });
    }
    if (block === "usecases" && n.type === "list") out.useCases.push(...listItems([n]).map((x) => x.text));
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* System pages                                                                */
/* -------------------------------------------------------------------------- */

export interface SystemPage {
  title: string | null;
  description: string | null;
  htmlUrl: string | null;
  apiVersion: string | null;
  paragraphs: string[];
  /** "This reference documents Polaris 2.0." */
  documentedVersion: string | null;
}

export function parseSystemPage(md: string): SystemPage {
  const { frontmatter, tree } = parseMd(md);
  const sourceUrl = frontmatter.source_url as { html?: unknown } | undefined;
  const paras = paragraphs(tree.children).slice(0, 12);
  const all = [str(frontmatter.description) ?? "", ...paras].join(" ");
  const v = /\bdocuments Polaris (\d+(?:\.\d+)*)\b/.exec(all);
  return {
    title: str(frontmatter.title),
    description: str(frontmatter.description),
    htmlUrl: str(sourceUrl?.html),
    apiVersion: str(frontmatter.api_version),
    paragraphs: paras,
    documentedVersion: v ? v[1]! : null,
  };
}

function str(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = collapse(v);
  return t || null;
}
