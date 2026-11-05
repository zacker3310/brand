/**
 * Static Markdown parsing for Ant Design (components/<dir>/index.en-US.md, docs/spec/*.en-US.md) and
 * Ant Design Mobile (src/components/<dir>/*.en.md) documentation. CommonMark + GFM tables via mdast;
 * HTML/JSX blocks (<code src>, <ComponentTokenTable>, <ImagePreview>) are read as text with regexes,
 * never executed.
 */
import matter from "gray-matter";
import type { Nodes, PhrasingContent, Root, RootContent, Table, TableCell } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";

export const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

export function parseMarkdown(md: string): Root {
  return fromMarkdown(md, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
}

export function splitFrontmatter(text: string): { frontmatter: Record<string, unknown>; body: string; bodyOffsetLines: number } {
  if (!/^---\r?\n/.test(text)) return { frontmatter: {}, body: text, bodyOffsetLines: 0 };
  const offsetOf = (body: string) => (text.endsWith(body) ? text.slice(0, text.length - body.length).split("\n").length - 1 : 0);
  try {
    const m = matter(text);
    return { frontmatter: (m.data ?? {}) as Record<string, unknown>, body: m.content, bodyOffsetLines: offsetOf(m.content) };
  } catch {
    const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
    return { frontmatter: {}, body, bodyOffsetLines: offsetOf(body) };
  }
}

/** Plain text of a node. html/jsx and images are dropped; inline code keeps its value. */
export function textOf(node: Nodes | Nodes[] | undefined | null): string {
  if (!node) return "";
  if (Array.isArray(node)) return node.map((n) => textOf(n)).join("");
  switch (node.type) {
    case "text":
      return node.value;
    case "inlineCode":
      return node.value;
    case "code":
    case "html":
    case "image":
    case "imageReference":
    case "footnoteReference":
    case "definition":
      return "";
    case "break":
      return " ";
    default:
      if ("children" in node && Array.isArray(node.children)) {
        const block = node.type === "list" || node.type === "listItem" || node.type === "blockquote" || node.type === "root";
        return (node.children as Nodes[]).map((c) => textOf(c)).join(block ? " " : "");
      }
      return "";
  }
}

/** First sentence(s) within `max` chars, cut on a sentence boundary when possible. */
export function firstSentences(text: string | null | undefined, max = 280): string | null {
  if (!text) return null;
  const clean = collapse(text);
  if (!clean) return null;
  if (clean.length <= max) return clean;
  const parts = clean.split(/(?<=[.!?])\s+(?=[A-Z`"'(\[])/);
  let out = "";
  for (const s of parts) {
    if ((out ? out.length + 1 : 0) + s.length > max) break;
    out = out ? `${out} ${s}` : s;
  }
  if (out) return out;
  return `${clean.slice(0, max - 1).replace(/\s+\S*$/, "")}…`;
}

/* ---------------------------------- tables ---------------------------------- */

export interface CellInfo {
  /** Plain text, inline code values inlined, whitespace collapsed. */
  text: string;
  /** Inline code values in order. */
  codes: string[];
  /** Whole cell wrapped in ~~strikethrough~~ (deprecated marker in Ant Design API tables). */
  struck: boolean;
  /** Link targets inside the cell. */
  links: string[];
  /** Top-level union segments split on "|" (for type cells). */
  segments: { text: string; code: string | null }[];
}

function cellInfo(cell: TableCell): CellInfo {
  const codes: string[] = [];
  const links: string[] = [];
  const visit = (n: Nodes) => {
    if (n.type === "inlineCode") codes.push(n.value);
    if (n.type === "link") links.push(n.url);
    if ("children" in n && Array.isArray(n.children)) (n.children as Nodes[]).forEach(visit);
  };
  cell.children.forEach((c) => visit(c as Nodes));
  const kids = cell.children as PhrasingContent[];
  const nonEmpty = kids.filter((k) => !(k.type === "text" && !k.value.trim()));
  const struck = nonEmpty.length > 0 && nonEmpty.every((k) => k.type === "delete");
  // Union segments: walk top-level phrasing nodes, split text nodes on "|".
  const segments: { text: string; code: string | null; parts: number }[] = [];
  let cur = { text: "", code: null as string | null, parts: 0 };
  const flush = () => {
    segments.push(cur);
    cur = { text: "", code: null, parts: 0 };
  };
  for (const k of kids) {
    if (k.type === "text") {
      const pieces = k.value.split("|");
      pieces.forEach((p, i) => {
        if (i > 0) flush();
        if (p.trim()) {
          cur.text += p;
          cur.parts++;
        } else cur.text += p;
      });
    } else if (k.type === "inlineCode") {
      cur.text += k.value;
      cur.code = cur.parts === 0 ? k.value : null;
      cur.parts++;
    } else {
      cur.text += textOf(k as Nodes);
      cur.code = null;
      cur.parts++;
    }
  }
  flush();
  return {
    text: collapse(textOf(cell as unknown as Nodes)),
    codes,
    struck,
    links,
    segments: segments.map((s) => ({ text: collapse(s.text), code: s.parts === 1 ? s.code : null })).filter((s) => s.text),
  };
}

export interface MdTable {
  headers: string[];
  rows: CellInfo[][];
  /** Enclosing headings (outermost first), e.g. ["API", "Checkbox.Group"]. */
  headings: { depth: number; text: string }[];
  /** 1-based line of the table start in the original file. */
  line: number;
  /** Repository file the table came from when it was merged from an <embed src> include. */
  file?: string;
}

/* --------------------------------- document --------------------------------- */

export interface Heading {
  depth: number;
  text: string;
  /** Explicit {#id} anchor when present. */
  anchor: string | null;
  line: number;
}

export interface DemoRef {
  src: string;
  title: string | null;
  debug: boolean;
  version: string | null;
}

export interface ParsedDoc {
  frontmatter: Record<string, unknown>;
  /** First H1 text (Ant Design Mobile pages have no frontmatter title). */
  h1: string | null;
  headings: Heading[];
  /** First paragraph before the first H2 (lead text). */
  lead: string | null;
  /** Section text keyed by H2 title (first 2 paragraphs, plain text). */
  sectionText: Record<string, string>;
  tables: MdTable[];
  demos: DemoRef[];
  links: string[];
  /** Components named by <ComponentTokenTable component="..."> (Ant Design). */
  tokenTableComponents: string[];
  /** Short accessibility-related statements found in prose (not tables). */
  a11yNotes: string[];
  mentionsResponsive: boolean;
  mentionsDeprecated: boolean;
  /** Packages named in install instructions ("npm install @ant-design/icons"). */
  installs: string[];
  /** <embed src="./shared/x.md"></embed> includes with their enclosing headings. */
  embeds: { src: string; headings: { depth: number; text: string }[]; line: number }[];
}

const A11Y_RE = /\b(accessib\w*|screen[- ]readers?|aria-[a-z]+|a11y|wai-aria|assistive technolog\w+|keyboard (?:navigation|users?|focus|interaction|operation)s?|focus (?:trap|management|order|ring))\b/i;

function headingText(n: Nodes): { text: string; anchor: string | null } {
  let t = collapse(textOf(n));
  let anchor: string | null = null;
  const m = /\s*\{#([A-Za-z0-9_-]+)\}\s*$/.exec(t);
  if (m) {
    anchor = m[1]!;
    t = t.slice(0, m.index).trim();
  }
  return { text: t, anchor };
}

export function parseDoc(text: string): ParsedDoc {
  const { frontmatter, body, bodyOffsetLines } = splitFrontmatter(text);
  const tree = parseMarkdown(body);
  const headings: Heading[] = [];
  const tables: MdTable[] = [];
  const stack: { depth: number; text: string }[] = [];
  const sectionText: Record<string, string> = {};
  const embeds: ParsedDoc["embeds"] = [];
  const a11y: string[] = [];
  let lead: string | null = null;
  let h1: string | null = null;
  let currentH2: string | null = null;
  let sawH2 = false;
  const lineOf = (n: RootContent) => (n.position?.start.line ?? 0) + bodyOffsetLines;

  const proseText = (n: RootContent): string | null => {
    if (n.type !== "paragraph" && n.type !== "blockquote" && n.type !== "list") return null;
    const t = collapse(textOf(n as Nodes));
    if (!t || /^<|^import\s|^export\s/.test(t)) return null;
    return t;
  };

  for (const node of tree.children) {
    if (node.type === "heading") {
      const { text: ht, anchor } = headingText(node as Nodes);
      headings.push({ depth: node.depth, text: ht, anchor, line: lineOf(node) });
      while (stack.length && stack[stack.length - 1]!.depth >= node.depth) stack.pop();
      stack.push({ depth: node.depth, text: ht });
      if (node.depth === 1 && !h1) h1 = ht;
      if (node.depth === 2) {
        currentH2 = ht;
        sawH2 = true;
      }
      continue;
    }
    // <embed src="x.md"></embed> is block HTML or (not being a CommonMark block tag) inline HTML in a paragraph.
    const htmlText = node.type === "html" ? node.value : node.type === "paragraph" ? node.children.filter((c) => c.type === "html").map((c) => (c as { value: string }).value).join("") : "";
    if (htmlText.includes("<embed")) {
      for (const m of htmlText.matchAll(/<embed\s+[^>]*src=["']([^"']+\.md)["']/g)) embeds.push({ src: m[1]!, headings: stack.map((x) => ({ ...x })), line: lineOf(node) });
      continue;
    }
    if (node.type === "html") continue;
    if (node.type === "table") {
      const t = node as Table;
      const [head, ...rest] = t.children;
      if (!head) continue;
      tables.push({
        headers: head.children.map((c) => collapse(textOf(c as unknown as Nodes))),
        rows: rest.map((r) => r.children.map((c) => cellInfo(c))),
        headings: stack.map((s) => ({ ...s })),
        line: lineOf(node),
      });
      continue;
    }
    const prose = proseText(node);
    if (prose) {
      if (!sawH2 && !lead && node.type === "paragraph") lead = prose;
      if (currentH2) {
        const prev = sectionText[currentH2];
        const count = prev ? prev.split("\u0000").length : 0;
        if (count < 2) sectionText[currentH2] = prev ? `${prev}\u0000${prose}` : prose;
      }
      if (A11Y_RE.test(prose) && a11y.length < 4) {
        const sentence = prose.split(/(?<=[.!?。])\s+/).find((s) => A11Y_RE.test(s)) ?? prose;
        const short = firstSentences(sentence, 400);
        if (short && !a11y.includes(short)) a11y.push(short);
      }
    }
  }
  for (const k of Object.keys(sectionText)) sectionText[k] = sectionText[k]!.split("\u0000").join(" ");

  // Links anywhere (mdast link nodes + raw <a href> in HTML blocks).
  const links: string[] = [];
  const visit = (n: Nodes) => {
    if (n.type === "link") links.push(n.url);
    if (n.type === "definition") links.push(n.url);
    if ("children" in n && Array.isArray(n.children)) (n.children as Nodes[]).forEach(visit);
  };
  visit(tree as unknown as Nodes);

  // <code src="./demo/x.tsx" debug version="5.21.0">Title</code>
  const demos: DemoRef[] = [];
  for (const m of body.matchAll(/<code\s+([^>]*?)\/?>(?:([^<]*)<\/code>)?/g)) {
    const attrs = m[1] ?? "";
    const src = /\bsrc=["']([^"']+)["']/.exec(attrs)?.[1];
    if (!src || !/\.(tsx|jsx|ts|js)$/.test(src) && !/\/demo\//.test(src)) continue;
    const title = collapse(m[2] ?? "") || null;
    demos.push({ src, title, debug: /(^|\s)debug(\s|=|$)/.test(attrs), version: /\bversion=["']([^"']+)["']/.exec(attrs)?.[1] ?? null });
  }
  const tokenTableComponents = [...body.matchAll(/<ComponentTokenTable\s+component=["']([^"']+)["']/g)].flatMap((m) => m[1]!.split(",").map((s) => s.trim()).filter(Boolean));

  const plain = collapse(textOf(tree as unknown as Nodes));
  return {
    frontmatter,
    h1,
    headings,
    lead,
    sectionText,
    tables,
    demos,
    links,
    tokenTableComponents,
    a11yNotes: a11y,
    mentionsResponsive: /\bresponsive\b|\bbreakpoints?\b/i.test(plain),
    mentionsDeprecated: /\bdeprecated\b/i.test(plain),
    embeds,
    installs: [...new Set([...body.matchAll(/\b(?:npm (?:install|i)|yarn add|pnpm (?:add|install)|bun add)\s+(?:--save\s+)?((?:@[a-z0-9-]+\/)?[a-z0-9][a-z0-9.-]*)/g)].map((m) => m[1]!))],
  };
}

/** Frontmatter field as string (Ant Design `group` may be a string or { title, order }). */
export function fmString(fm: Record<string, unknown>, key: string): string | null {
  const v = fm[key];
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number") return String(v);
  if (v && typeof v === "object" && typeof (v as { title?: unknown }).title === "string") return ((v as { title: string }).title).trim() || null;
  return null;
}

/** Component docs slug referenced by an internal docs link ("/components/input/", "https://ant.design/components/input#api"). */
export function componentSlugFromLink(href: string, origin: string): string | null {
  let path = href;
  if (/^https?:\/\//.test(href)) {
    try {
      const u = new URL(href);
      if (u.origin !== origin) return null;
      path = u.pathname;
    } catch {
      return null;
    }
  }
  const m = /^\/(?:zh\/)?components\/([a-z0-9-]+)(?:-cn)?\/?(?:[#?].*)?$/.exec(path);
  return m ? m[1]! : null;
}

export function specSlugFromLink(href: string, origin: string): string | null {
  let path = href;
  if (/^https?:\/\//.test(href)) {
    try {
      const u = new URL(href);
      if (u.origin !== origin) return null;
      path = u.pathname;
    } catch {
      return null;
    }
  }
  const m = /^\/docs\/spec\/([a-z0-9-]+?)(?:-cn)?\/?(?:[#?].*)?$/.exec(path);
  return m ? m[1]! : null;
}
