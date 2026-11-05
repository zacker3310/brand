/**
 * Static MDX helpers for carbon-website pages. MDX is parsed as CommonMark + GFM (tables);
 * JSX blocks are treated as opaque HTML/paragraph text and skipped. Nothing is executed.
 */
import matter from "gray-matter";
import type { Root, RootContent, Table, PhrasingContent, Nodes } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";

export interface MdxDoc {
  frontmatter: Record<string, unknown>;
  body: string;
  tree: Root;
}

export function parseMdx(text: string): MdxDoc {
  let frontmatter: Record<string, unknown> = {};
  let body = text;
  try {
    const m = matter(text);
    frontmatter = (m.data ?? {}) as Record<string, unknown>;
    body = m.content;
  } catch {
    // Malformed front matter: strip the block manually and continue.
    body = text.replace(/^---\n[\s\S]*?\n---\n/, "");
  }
  const tree = parseMarkdown(body);
  return { frontmatter, body, tree };
}

export function parseMarkdown(md: string): Root {
  return fromMarkdown(md, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
}

/* --------------------------------- text ---------------------------------- */

export const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

/** Serialize phrasing/block content to plain text. html/jsx and images are dropped. */
export function textOf(node: Nodes | Nodes[] | undefined | null, opts: { ticks?: boolean } = {}): string {
  if (!node) return "";
  if (Array.isArray(node)) return node.map((n) => textOf(n, opts)).join(" ");
  switch (node.type) {
    case "text":
      return node.value;
    case "inlineCode":
      return opts.ticks ? `\`${node.value}\`` : node.value;
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
        const inline = node.type === "paragraph" || node.type === "heading" || node.type === "tableCell" || isPhrasingParent(node.type);
        return (node.children as Nodes[]).map((c) => textOf(c, opts)).join(inline ? "" : " ");
      }
      return "";
  }
}

const isPhrasingParent = (t: string) => ["emphasis", "strong", "delete", "link", "linkReference"].includes(t);

/** True for paragraphs that are really MDX syntax (imports, JSX tags, props) rather than prose. */
export function looksLikeJsx(text: string): boolean {
  const t = text.trim();
  return /^(import|export)\s/.test(t) || t.startsWith("<") || /^[a-zA-Z]+=\{?["'{]/.test(t) || /^[{}\]),]/.test(t);
}

/** First sentence(s) up to `max` chars, cut on a sentence boundary when possible. */
export function firstSentences(text: string | null | undefined, max = 280): string | null {
  if (!text) return null;
  const clean = collapse(text);
  if (!clean) return null;
  if (clean.length <= max) return clean;
  const sentences = splitSentences(clean);
  let out = "";
  for (const s of sentences) {
    if ((out ? out.length + 1 : 0) + s.length > max) break;
    out = out ? `${out} ${s}` : s;
  }
  if (out) return out;
  return `${clean.slice(0, max - 1).replace(/\s+\S*$/, "")}…`;
}

export function splitSentences(text: string): string[] {
  // Split after . ! ? when followed by whitespace and an uppercase letter / quote / backtick.
  return collapse(text)
    .split(/(?<=[.!?])\s+(?=[A-Z`"“'(\[])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Inner text of a JSX wrapper such as <PageDescription>…</PageDescription>, as plain text. */
export function jsxBlockText(body: string, tag: string): string | null {
  const m = body.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  if (!m || !m[1]) return null;
  const tree = parseMarkdown(m[1]);
  const text = tree.children
    .filter((n) => n.type === "paragraph")
    .map((n) => textOf(n))
    .filter((t) => !looksLikeJsx(t))
    .join(" ");
  return collapse(text) || null;
}

/* ------------------------------- sections -------------------------------- */

export interface Section {
  depth: number;
  title: string;
  /** Titles of enclosing headings, outermost first. */
  parents: string[];
  /** Index of the heading among root children (stable location). */
  index: number;
  /** Nodes after the heading until the next heading of depth <= this depth (includes subsections). */
  nodes: RootContent[];
}

export function sections(tree: Root): Section[] {
  const out: Section[] = [];
  const kids = tree.children;
  const stack: { depth: number; title: string }[] = [];
  kids.forEach((n, i) => {
    if (n.type !== "heading") return;
    const title = collapse(textOf(n));
    while (stack.length && stack[stack.length - 1]!.depth >= n.depth) stack.pop();
    const parents = stack.map((s) => s.title);
    stack.push({ depth: n.depth, title });
    const nodes: RootContent[] = [];
    for (let j = i + 1; j < kids.length; j++) {
      const k = kids[j]!;
      if (k.type === "heading" && k.depth <= n.depth) break;
      nodes.push(k);
    }
    out.push({ depth: n.depth, title, parents, index: i, nodes });
  });
  return out;
}

/** Nodes before the first nested heading of a section. */
export function ownNodes(sec: Section): RootContent[] {
  const out: RootContent[] = [];
  for (const n of sec.nodes) {
    if (n.type === "heading") break;
    out.push(n);
  }
  return out;
}

/** Prose blocks (paragraph and list-item text) of a node list, skipping JSX-looking paragraphs. */
export function proseBlocks(nodes: RootContent[], opts: { ticks?: boolean } = {}): string[] {
  const out: string[] = [];
  const visit = (n: Nodes) => {
    if (n.type === "paragraph") {
      const t = collapse(textOf(n, opts));
      if (t && !looksLikeJsx(t)) out.push(t);
    } else if (n.type === "list") {
      for (const li of n.children) for (const c of li.children) visit(c);
    } else if (n.type === "blockquote") {
      for (const c of n.children) visit(c);
    }
  };
  nodes.forEach((n) => visit(n));
  return out;
}

export function firstParagraph(nodes: RootContent[]): string | null {
  return proseBlocks(nodes)[0] ?? null;
}

/* -------------------------------- tables --------------------------------- */

export interface TableData {
  headers: string[];
  rows: string[][];
  /** Raw cell nodes (row-major, header excluded) for inline-code extraction. */
  cellNodes: Nodes[][];
}

export function tablesIn(nodes: RootContent[]): TableData[] {
  const out: TableData[] = [];
  const visit = (n: Nodes) => {
    if (n.type === "table") out.push(tableData(n));
    else if ("children" in n && Array.isArray(n.children) && n.type !== "paragraph") (n.children as Nodes[]).forEach(visit);
  };
  nodes.forEach((n) => visit(n));
  return out;
}

export function tableData(t: Table): TableData {
  const [head, ...body] = t.children;
  const headers = (head?.children ?? []).map((c) => collapse(textOf(c)));
  const rows = body.map((r) => r.children.map((c) => collapse(textOf(c))));
  const cellNodes = body.map((r) => r.children as Nodes[]);
  return { headers, rows, cellNodes };
}

/** Inline code values inside a node (e.g. "$button-primary"). */
export function inlineCodes(node: Nodes): string[] {
  const out: string[] = [];
  const visit = (n: Nodes) => {
    if (n.type === "inlineCode") out.push(n.value);
    else if ("children" in n && Array.isArray(n.children)) (n.children as Nodes[]).forEach(visit);
  };
  visit(node);
  return out;
}

/** Text of all strong (bold) spans within nodes. */
export function strongTexts(nodes: RootContent[]): string[] {
  const out: string[] = [];
  const visit = (n: Nodes) => {
    if (n.type === "strong") out.push(collapse(textOf(n)));
    else if ("children" in n && Array.isArray(n.children)) (n.children as Nodes[]).forEach(visit);
  };
  nodes.forEach((n) => visit(n));
  return out;
}

export interface LinkRef {
  url: string;
  text: string;
}

export function linksIn(nodes: RootContent[] | Nodes[]): LinkRef[] {
  const out: LinkRef[] = [];
  const visit = (n: Nodes) => {
    if (n.type === "link") out.push({ url: n.url, text: collapse(textOf(n)) });
    if ("children" in n && Array.isArray(n.children)) (n.children as Nodes[]).forEach(visit);
  };
  (nodes as Nodes[]).forEach(visit);
  return out;
}

export type { PhrasingContent };
