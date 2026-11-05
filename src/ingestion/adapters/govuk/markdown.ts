/**
 * Static Markdown helpers for GOV.UK docs pages (CommonMark + GFM, with Nunjucks tags).
 * Nunjucks `{{ ... }}` / `{% ... %}` blocks are never rendered: `example(...)` calls are read as
 * data (their object-literal arguments are matched with regexes) and every tag is then removed.
 */
import matter from "gray-matter";
import type { Nodes, Root, RootContent } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";

export const collapse = (s: string) => s.replace(/ /g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

export interface ExampleCall {
  group: string | null;
  item: string | null;
  example: string;
  titleSuffix: string | null;
  /** 1-based line of the call in the page source. */
  line: number;
}

export interface MdPage {
  frontmatter: Record<string, unknown>;
  /** Body with Nunjucks tags removed. */
  body: string;
  tree: Root;
  examples: (ExampleCall & { heading: string | null })[];
  /** Number of lines taken by the front matter block (to map body lines to file lines). */
  bodyLineOffset: number;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null);

function exampleArg(obj: string, key: string): string | null {
  const m = new RegExp(`\\b${key}\\s*:\\s*(["'])([^"']*)\\1`).exec(obj);
  return m ? m[2]! : null;
}

/** Find `example({ ... })` calls in Nunjucks output tags. */
export function findExampleCalls(text: string): ExampleCall[] {
  const out: ExampleCall[] = [];
  const re = /\{\{-?\s*example\(\s*(\{[\s\S]*?\})\s*\)\s*-?\}\}/g;
  for (const m of text.matchAll(re)) {
    const obj = m[1]!;
    const example = exampleArg(obj, "example");
    if (!example) continue;
    const line = text.slice(0, m.index).split("\n").length;
    out.push({ group: exampleArg(obj, "group"), item: exampleArg(obj, "item"), example, titleSuffix: exampleArg(obj, "titleSuffix"), line });
  }
  return out;
}

/** Replace Nunjucks tags with blank space, preserving line count. */
export function stripNunjucks(text: string): string {
  const blank = (s: string) => s.replace(/[^\n]/g, "");
  return text
    .replace(/\{#[\s\S]*?#\}/g, blank)
    .replace(/\{%-?[\s\S]*?-?%\}/g, blank)
    .replace(/\{\{-?[\s\S]*?-?\}\}/g, blank);
}

export function parseMarkdown(md: string): Root {
  return fromMarkdown(md, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
}

export function parsePage(text: string): MdPage {
  let frontmatter: Record<string, unknown> = {};
  let content = text;
  try {
    const m = matter(text);
    frontmatter = (m.data ?? {}) as Record<string, unknown>;
    content = m.content;
  } catch {
    content = text.replace(/^---\n[\s\S]*?\n---\n/, "");
  }
  const bodyLineOffset = text.length - content.length >= 0 ? text.slice(0, text.length - content.length).split("\n").length - 1 : 0;
  const calls = findExampleCalls(content);
  const body = stripNunjucks(content);
  const tree = parseMarkdown(body);
  // Attach each example call to the nearest preceding heading (by line).
  const headings: { line: number; title: string }[] = [];
  for (const n of tree.children) if (n.type === "heading" && n.position) headings.push({ line: n.position.start.line, title: collapse(textOf(n)) });
  const examples = calls.map((c) => {
    let heading: string | null = null;
    for (const h of headings) if (h.line <= c.line) heading = h.title;
    return { ...c, heading };
  });
  return { frontmatter, body, tree, examples, bodyLineOffset };
}

export const fm = {
  str: (page: MdPage, key: string) => str(page.frontmatter[key]),
  list: (page: MdPage, key: string): string[] => {
    const v = page.frontmatter[key];
    if (Array.isArray(v)) return v.map((x) => str(x)).filter((x): x is string => !!x);
    const s = str(v);
    return s ? s.split(",").map((x) => x.trim()).filter(Boolean) : [];
  },
};

/* --------------------------------- text ---------------------------------- */

/** Plain text of nodes; html, code blocks and images are dropped. */
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
        const inline = ["paragraph", "heading", "tableCell", "emphasis", "strong", "delete", "link", "linkReference"].includes(node.type);
        return (node.children as Nodes[]).map((c) => textOf(c, opts)).join(inline ? "" : " ");
      }
      return "";
  }
}

export function splitSentences(text: string): string[] {
  return collapse(text)
    .split(/(?<=[.!?])\s+(?=[A-Z0-9‘“"'(\[`])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** First sentence(s) up to `max` chars, cut on a sentence boundary when possible. */
export function firstSentences(text: string | null | undefined, max = 280): string | null {
  if (!text) return null;
  const clean = collapse(text);
  if (!clean) return null;
  if (clean.length <= max) return clean;
  let out = "";
  for (const s of splitSentences(clean)) {
    if ((out ? out.length + 1 : 0) + s.length > max) break;
    out = out ? `${out} ${s}` : s;
  }
  if (out) return out;
  return `${clean.slice(0, max - 1).replace(/\s+\S*$/, "")}…`;
}

export function clip(text: string | null | undefined, max: number): string | null {
  if (!text) return null;
  const c = collapse(text);
  return c.length > max ? `${c.slice(0, max - 1).replace(/\s+\S*$/, "")}…` : c;
}

/* ------------------------------- sections -------------------------------- */

export interface Section {
  depth: number;
  title: string;
  parents: string[];
  /** 1-based source line of the heading in the body. */
  line: number;
  /** Nodes until the next heading of depth <= this depth (includes subsections). */
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
    out.push({ depth: n.depth, title, parents, line: n.position?.start.line ?? 0, nodes });
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

/** Root nodes before the first heading (page intro). */
export function introNodes(tree: Root): RootContent[] {
  const out: RootContent[] = [];
  for (const n of tree.children) {
    if (n.type === "heading") break;
    out.push(n);
  }
  return out;
}

/** Prose blocks (paragraphs and list items) of a node list. */
export function proseBlocks(nodes: RootContent[] | Nodes[], opts: { ticks?: boolean } = {}): string[] {
  const out: string[] = [];
  const visit = (n: Nodes) => {
    if (n.type === "paragraph") {
      const t = collapse(textOf(n, opts));
      if (t) out.push(t);
    } else if (n.type === "list") {
      for (const li of n.children) for (const c of li.children) visit(c);
    } else if (n.type === "blockquote") {
      for (const c of n.children) visit(c);
    }
  };
  (nodes as Nodes[]).forEach(visit);
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

/** Inline code values inside nodes. */
export function inlineCodes(nodes: RootContent[] | Nodes[]): string[] {
  const out: string[] = [];
  const visit = (n: Nodes) => {
    if (n.type === "inlineCode") out.push(n.value);
    else if ("children" in n && Array.isArray(n.children)) (n.children as Nodes[]).forEach(visit);
  };
  (nodes as Nodes[]).forEach(visit);
  return out;
}
