/**
 * Markdown / MDX readers for Fluent UI React story docs (ComponentDescription.md,
 * ComponentBestPractices.md, ComponentAccessibilitySpec.mdx). Parsed as CommonMark + GFM tables;
 * MDX import lines and JSX blocks are dropped as opaque text. Nothing is executed.
 */
import type { Nodes, Root, RootContent, Table } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";

export function parseMd(md: string): Root {
  return fromMarkdown(md.replace(/\r\n?/g, "\n"), { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
}

/** Plain text of a node (inline code kept, html/jsx/images dropped; `<kbd>X</kbd>` keeps X). */
export function textOf(node: Nodes | Nodes[] | undefined | null): string {
  if (!node) return "";
  if (Array.isArray(node)) return node.map((n) => textOf(n)).join(" ");
  switch (node.type) {
    case "text":
      return node.value;
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
        const inline = ["paragraph", "heading", "tableCell", "emphasis", "strong", "delete", "link", "linkReference"].includes(node.type);
        return (node.children as Nodes[]).map((c) => textOf(c)).join(inline ? "" : " ");
      }
      return "";
  }
}

const collapse = (s: string) => s.replace(/\s+/g, " ").trim();
const isJsxish = (s: string) => /^(import|export)\s/.test(s.trim()) || s.trim().startsWith("<");

/** Strip MDX import/export lines and self-closing JSX blocks before markdown parsing. */
export function stripMdx(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/^(import|export)\s[^\n]*$/gm, "")
    .replace(/^<([A-Z][\w.]*)[^\n]*\/>\s*$/gm, "");
}

export interface MdSection {
  depth: number;
  title: string;
  /** Enclosing heading titles, outermost first. */
  parents: string[];
  nodes: RootContent[];
  line: number;
}

/** Flat list of sections (each heading with the content up to the next heading of any depth). */
export function sections(tree: Root): MdSection[] {
  const out: MdSection[] = [];
  const stack: { depth: number; title: string }[] = [];
  let cur: MdSection | null = null;
  for (const n of tree.children) {
    if (n.type === "heading") {
      const title = collapse(textOf(n));
      while (stack.length && stack[stack.length - 1]!.depth >= n.depth) stack.pop();
      cur = { depth: n.depth, title, parents: stack.map((s) => s.title), nodes: [], line: n.position?.start.line ?? 0 };
      out.push(cur);
      stack.push({ depth: n.depth, title });
    } else if (cur) cur.nodes.push(n);
    else {
      cur = { depth: 0, title: "", parents: [], nodes: [n], line: n.position?.start.line ?? 0 };
      out.push(cur);
    }
  }
  return out;
}

/** Paragraph and list-item texts of a node list (prose only). */
export function proseOf(nodes: RootContent[]): string[] {
  const out: string[] = [];
  for (const n of nodes) {
    if (n.type === "paragraph") {
      const t = collapse(textOf(n));
      if (t && !isJsxish(t)) out.push(t);
    } else if (n.type === "list") {
      for (const li of n.children) {
        const t = collapse(textOf(li));
        if (t) out.push(t);
      }
    } else if (n.type === "blockquote") out.push(...proseOf(n.children as RootContent[]));
  }
  return out;
}

export function tableRows(t: Table): string[][] {
  return t.children.map((r) => r.children.map((c) => collapse(textOf(c))));
}

/* --------------------------------- description --------------------------------- */

/** All prose of a ComponentDescription.md file, in order. */
export function descriptionText(md: string): string | null {
  const tree = parseMd(stripMdx(md));
  const text = proseOf(tree.children).join(" ");
  return collapse(text) || null;
}

export interface BestPractices {
  /** Heading -> prose items (e.g. "Layout" -> [...], "Accessibility" -> [...]). */
  groups: { heading: string; items: string[]; line: number }[];
}

export function parseBestPractices(md: string): BestPractices {
  const tree = parseMd(stripMdx(md));
  const groups: BestPractices["groups"] = [];
  for (const s of sections(tree)) {
    if (/^best practices$/i.test(s.title) && !s.nodes.length) continue;
    const items = proseOf(s.nodes);
    if (items.length) groups.push({ heading: s.title || "Best practices", items, line: s.line });
  }
  return { groups };
}

/* ----------------------------- accessibility spec ----------------------------- */

export interface A11ySpec {
  title: string | null;
  intro: string | null;
  roles: string[];
  keyboard: { keys: string; action: string; context: string | null }[];
  /** Prose under headings mentioning focus. */
  focus: string | null;
  /** Prose under headings mentioning screen readers / labels. */
  screenReader: string | null;
  wcag: string[];
  sectionTitles: string[];
}

const ROLE_WORD = /^[a-z]+$/;

/** Key cell -> "Shift+Tab", "Enter", "ArrowDown". */
export function normalizeKeys(cell: string): string {
  return collapse(cell)
    .replace(/\s*\+\s*/g, "+")
    .replace(/\bArrow\s+(Up|Down|Left|Right)\b/gi, (_, d: string) => `Arrow${d[0]!.toUpperCase()}${d.slice(1).toLowerCase()}`)
    .replace(/\bSpacebar\b/gi, "Space")
    .replace(/\bEsc\b/g, "Escape");
}

export function parseA11ySpec(mdx: string): A11ySpec {
  const tree = parseMd(stripMdx(mdx));
  const secs = sections(tree);
  const h1 = secs.find((s) => s.depth === 1);
  const introSec = h1 ?? secs[0];
  const intro = introSec ? collapse(proseOf(introSec.nodes).slice(0, 2).join(" ")) || null : null;
  const roles = new Set<string>();
  const keyboard: A11ySpec["keyboard"] = [];
  let focus: string[] = [];
  let sr: string[] = [];
  for (const s of secs) {
    const trail = [...s.parents, s.title].join(" / ");
    for (const n of s.nodes) {
      if (n.type !== "table") continue;
      const rows = tableRows(n);
      const head = (rows[0] ?? []).map((h) => h.toLowerCase());
      const roleCol = head.findIndex((h) => /role/.test(h));
      const keyCol = head.findIndex((h) => /^key/.test(h));
      const resCol = head.findIndex((h) => /(result|action|behavior|description)/.test(h));
      if (roleCol >= 0 && /semantic|role/i.test(trail)) {
        for (const r of rows.slice(1)) {
          for (const word of (r[roleCol] ?? "").toLowerCase().split(/[\s,/]+/)) if (ROLE_WORD.test(word) && word.length > 2 && word !== "none" && word !== "native") roles.add(word);
        }
      }
      if (keyCol >= 0 && resCol >= 0 && /keyboard/i.test(trail)) {
        for (const r of rows.slice(1)) {
          const keys = normalizeKeys(r[keyCol] ?? "");
          const action = collapse(r[resCol] ?? "");
          if (keys && action) keyboard.push({ keys, action, context: s.title && !/keyboard/i.test(s.title) ? s.title : null });
        }
      }
    }
    if (/focus/i.test(s.title)) focus = focus.concat(proseOf(s.nodes));
    if (/screen reader|label/i.test(s.title)) sr = sr.concat(proseOf(s.nodes));
  }
  const wcag = new Set<string>();
  for (const m of mdx.matchAll(/WCAG\s*(?:2\.[0-2]\s*)?(?:SC\s*)?(\d\.\d{1,2}\.\d{1,2})/g)) wcag.add(m[1]!);
  return {
    title: h1?.title ?? null,
    intro,
    roles: [...roles].sort(),
    keyboard,
    focus: focus.length ? collapse(focus.join(" ")) : null,
    screenReader: sr.length ? collapse(sr.join(" ")) : null,
    wcag: [...wcag].sort(),
    sectionTitles: secs.filter((s) => s.depth >= 2).map((s) => s.title),
  };
}
