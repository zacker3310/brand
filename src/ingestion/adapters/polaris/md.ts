/**
 * Markdown/MDX helpers (CommonMark + GFM). MDX/JSX blocks are treated as opaque HTML and skipped.
 * Nothing is executed.
 */
import matter from "gray-matter";
import type { Nodes, Root, RootContent } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import { collapse } from "./text";

export interface MdDoc {
  frontmatter: Record<string, unknown>;
  /** Markdown body (frontmatter removed); node positions are offsets into it. */
  body: string;
  tree: Root;
}

export function parseMd(text: string): MdDoc {
  let frontmatter: Record<string, unknown> = {};
  let body = text;
  try {
    // A fresh options object disables gray-matter's content cache.
    const m = matter(text, {});
    frontmatter = (m.data ?? {}) as Record<string, unknown>;
    body = m.content;
  } catch {
    body = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "");
  }
  return { frontmatter, body, tree: fromMarkdown(body, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] }) };
}

const PHRASING_PARENTS = new Set(["paragraph", "heading", "tableCell", "emphasis", "strong", "delete", "link", "linkReference"]);

/** Plain text of a node (html/jsx, code blocks and images dropped). */
export function textOf(node: Nodes | Nodes[] | undefined | null): string {
  if (!node) return "";
  if (Array.isArray(node)) return node.map((n) => textOf(n)).join(" ");
  switch (node.type) {
    case "text":
    case "inlineCode":
      return node.value;
    case "code":
    case "html":
    case "image":
    case "imageReference":
    case "definition":
    case "footnoteReference":
      return "";
    case "break":
      return " ";
    default:
      if ("children" in node && Array.isArray(node.children)) {
        return (node.children as Nodes[]).map((c) => textOf(c)).join(PHRASING_PARENTS.has(node.type) ? "" : " ");
      }
      return "";
  }
}

export const cleanText = (node: Nodes | Nodes[] | undefined | null) => collapse(textOf(node));

/** Every link (url + text) inside a node. */
export function linksOf(node: Nodes | Nodes[] | undefined | null, out: { url: string; text: string }[] = []): { url: string; text: string }[] {
  if (!node) return out;
  if (Array.isArray(node)) {
    for (const n of node) linksOf(n, out);
    return out;
  }
  if (node.type === "link") out.push({ url: node.url, text: cleanText(node) });
  if ("children" in node && Array.isArray(node.children)) for (const c of node.children as Nodes[]) linksOf(c, out);
  return out;
}

/** Raw HTML fragments (e.g. <kbd>) inside a node, in order. */
export function htmlOf(node: Nodes | Nodes[] | undefined | null, out: string[] = []): string[] {
  if (!node) return out;
  if (Array.isArray(node)) {
    for (const n of node) htmlOf(n, out);
    return out;
  }
  if (node.type === "html") out.push(node.value);
  if ("children" in node && Array.isArray(node.children)) for (const c of node.children as Nodes[]) htmlOf(c, out);
  return out;
}

export interface Section {
  depth: number;
  heading: string;
  /** Nodes until the next heading of the same or lower depth (nested headings included). */
  nodes: RootContent[];
  line: number | null;
}

/** Split top-level content into sections at headings of `depth` (content before the first one has heading ""). */
export function sectionsAt(nodes: RootContent[], depth: number, isBoundary: (heading: string) => boolean = () => true): Section[] {
  const out: Section[] = [{ depth, heading: "", nodes: [], line: null }];
  for (const n of nodes) {
    if (n.type === "heading" && n.depth <= depth) {
      const h = cleanText(n);
      if (!isBoundary(h)) {
        out[out.length - 1]!.nodes.push(n);
        continue;
      }
      out.push({ depth: n.depth, heading: h, nodes: [], line: n.position?.start.line ?? null });
      continue;
    }
    out[out.length - 1]!.nodes.push(n);
  }
  return out;
}

/** Text of each list item in the first-level lists of `nodes`. */
export function listItems(nodes: RootContent[]): { text: string; node: Nodes }[] {
  const out: { text: string; node: Nodes }[] = [];
  for (const n of nodes) {
    if (n.type !== "list") continue;
    for (const li of n.children) out.push({ text: cleanText(li), node: li });
  }
  return out;
}

/** Paragraph texts in `nodes` (top level only), skipping JSX-looking paragraphs. */
export function paragraphs(nodes: RootContent[]): string[] {
  const out: string[] = [];
  for (const n of nodes) {
    if (n.type !== "paragraph") continue;
    const t = cleanText(n);
    if (t && !looksLikeJsx(t)) out.push(t);
  }
  return out;
}

/** True for text that is really MDX syntax (imports, JSX tags, props, expressions). */
export function looksLikeJsx(text: string): boolean {
  const t = text.trim();
  return /^(import|export)\s/.test(t) || t.startsWith("<") || t.startsWith("{") || /^[a-zA-Z]+=\{?["'{]/.test(t) || /^[}\]),]/.test(t);
}
