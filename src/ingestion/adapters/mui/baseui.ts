/**
 * Static parsers for Base UI docs (github.com/mui/base-ui, docs/src/app/(docs)/react/**):
 *  - components/page.mdx: generated components index (names, slugs, one-line descriptions)
 *  - components/<slug>/page.mdx: subtitle, meta description, usage guidelines, anatomy import,
 *    example sections, in-content links to other components
 *  - components/<slug>/types.md: generated API reference (per-part props, data attributes, CSS variables)
 * MDX is read as CommonMark + GFM; JSX is opaque. Nothing is executed.
 */
import type { Nodes, Table } from "mdast";
import { keyboardFromBlocks, parseMarkdownTree, plainBlocks, sections } from "./markdown";
import { clip, decodeEntities } from "./shared";

export interface BaseIndexEntry {
  name: string;
  slug: string;
  description: string | null;
  order: number;
}

/** Components index: "- Accordion - ([Outline](#accordion), [Contents](./accordion/page.mdx))" + "## Accordion\n\n<desc>". */
export function parseBaseIndex(mdx: string): BaseIndexEntry[] {
  const out: BaseIndexEntry[] = [];
  const re = /^- (.+?) - \(\[Outline\]\(#([a-z0-9-]+)\), \[Contents\]\(\.\/([a-z0-9-]+)\/page\.mdx\)\)/gm;
  for (let m = re.exec(mdx); m; m = re.exec(mdx)) {
    const name = m[1]!.replace(/\s*\[[^\]]*\]\s*$/, "").trim();
    const slug = m[3]!;
    if (out.some((e) => e.slug === slug)) continue;
    out.push({ name, slug, description: null, order: out.length });
  }
  const { sections: secs } = sections(mdx, "github");
  for (const e of out) {
    const sec = secs.find((s) => s.heading.depth === 2 && s.heading.text === e.name);
    if (!sec) continue;
    const firstPara = plainBlocks(sec.own.split(/<details>/)[0] ?? "")[0] ?? null;
    e.description = clip(firstPara, 280);
  }
  return out;
}

export interface BasePage {
  title: string | null;
  subtitle: string | null;
  metaDescription: string | null;
  /** import { Accordion } from '@base-ui/react/accordion' */
  importName: string | null;
  importPath: string | null;
  /** Parts named in the anatomy block (Accordion.Root, Accordion.Item, ...). */
  anatomyParts: string[];
  usageGuidelines: string[];
  examples: { title: string; anchor: string }[];
  /** Sections about accessibility/keyboard/focus/labels. */
  a11y: { heading: string; anchor: string; text: string | null }[];
  keyboard: { keys: string; action: string }[];
  /** Linked component slugs (/react/components/<slug>). */
  componentLinks: string[];
  mentionsResponsive: boolean;
}

const tagText = (src: string, tag: string) => {
  const m = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(src);
  return m ? clip(decodeEntities(m[1]!.replace(/<[^>]+>/g, "")), 600) : null;
};

/** Drop MDX module syntax and self-closing demo/component JSX lines (never prose). */
export function stripMdx(mdx: string): string {
  return mdx
    .replace(/^export const metadata = \{[\s\S]*$/m, "")
    .replace(/^import [^\n]*from '[^']+';?\s*$/gm, "")
    .replace(/^\s*<[A-Z][A-Za-z.]*(?:\s[^>]*)?\/>\s*$/gm, "");
}

export function parseBasePage(mdx: string): BasePage {
  const imp = /import \{ ([A-Za-z]+) \} from '(@base-ui\/react\/[a-z0-9-]+)'/.exec(mdx);
  const body = stripMdx(mdx);
  const { headings, sections: secs } = sections(body, "github");
  const meta = /<Meta\s+name="description"\s+content="([^"]*)"/.exec(mdx);
  const importName = imp ? imp[1]! : null;
  const anatomyParts: string[] = [];
  if (importName) {
    const re = new RegExp(`<(${importName}\\.[A-Za-z]+)`, "g");
    for (let m = re.exec(mdx); m; m = re.exec(mdx)) if (!anatomyParts.includes(m[1]!)) anatomyParts.push(m[1]!);
  }
  const usage = secs.find((s) => s.heading.depth === 2 && /^usage guidelines$/i.test(s.heading.text));
  const examplesSec = secs.find((s) => s.heading.depth === 2 && /^examples$/i.test(s.heading.text));
  const examples: BasePage["examples"] = [];
  if (examplesSec) {
    const start = examplesSec.heading.line;
    const end = headings.find((h) => h.line > start && h.depth <= 2)?.line ?? Number.MAX_SAFE_INTEGER;
    for (const h of headings) if (h.depth === 3 && h.line > start && h.line < end) examples.push({ title: h.text, anchor: h.anchor });
  }
  const a11ySecs = secs.filter((s) => s.heading.depth >= 2 && /accessib|keyboard|screen reader|focus management|^focus\b/i.test(s.heading.text));
  const a11y = a11ySecs.map((s) => ({ heading: s.heading.text, anchor: s.heading.anchor, text: clip(plainBlocks(s.full).join(" "), 800) }));
  const keyboard = keyboardFromBlocks(a11ySecs.flatMap((s) => plainBlocks(s.full)));
  const links: string[] = [];
  const lre = /\]\(\/react\/components\/([a-z0-9-]+)(?:#[^)]*)?\)/g;
  for (let m = lre.exec(body); m; m = lre.exec(body)) if (!links.includes(m[1]!)) links.push(m[1]!);
  return {
    title: headings.find((h) => h.depth === 1)?.text ?? null,
    subtitle: tagText(body, "Subtitle"),
    metaDescription: meta ? clip(decodeEntities(meta[1]!), 600) : null,
    importName,
    importPath: imp ? imp[2]! : null,
    anatomyParts,
    usageGuidelines: usage ? plainBlocks(usage.own).map((b) => clip(b, 400)!).filter(Boolean) : [],
    examples,
    a11y,
    keyboard,
    componentLinks: links.sort(),
    mentionsResponsive: /\bresponsive\b|\bbreakpoints?\b|small screens|\bviewport width\b/i.test(body),
  };
}

export interface BaseProp {
  name: string;
  type: string | null;
  defaultValue: string | null;
  description: string | null;
  /** The generated table marks required props with a trailing "*" ("value\*"); null when not marked. */
  required: boolean | null;
}

export interface BaseAttr {
  name: string;
  type: string | null;
  description: string | null;
}

export interface BasePart {
  /** Part name as documented ("Root", "Trigger", or the component name for single-part components). */
  name: string;
  description: string | null;
  props: BaseProp[];
  dataAttributes: BaseAttr[];
  cssVariables: BaseAttr[];
}

function cellText(n: Nodes): string {
  switch (n.type) {
    case "text":
    case "inlineCode":
      return n.value;
    case "html":
      return /^<br\s*\/?>$/i.test(n.value) ? " " : "";
    default:
      return "children" in n && Array.isArray(n.children) ? (n.children as Nodes[]).map(cellText).join("") : "";
  }
}

function tableAfter(md: string, label: RegExp): { header: string[]; rows: string[][] } | null {
  const m = label.exec(md);
  if (!m) return null;
  const rest = md.slice(m.index + m[0].length);
  const tableMd = /^\s*\n((?:\|.*\|\s*\n?)+)/.exec(rest);
  if (!tableMd) return null;
  const tree = parseMarkdownTree(tableMd[1]!);
  const table = tree.children.find((c): c is Table => c.type === "table");
  if (!table) return null;
  const rows = table.children.map((r) => r.children.map((c) => decodeEntities(cellText(c)).replace(/\s+/g, " ").trim()));
  return { header: rows[0] ?? [], rows: rows.slice(1) };
}

const dash = (v: string | undefined) => (v && v !== "-" ? v : null);

/** Parse a generated types.md (API reference). Parts are "### <Name>" headings without a dot. */
export function parseBaseTypes(md: string): BasePart[] {
  const { sections: secs } = sections(md, "github");
  const apiIdx = secs.findIndex((s) => s.heading.depth === 2 && /^api reference$/i.test(s.heading.text));
  const parts: BasePart[] = [];
  for (const s of secs.slice(apiIdx + 1)) {
    if (s.heading.depth === 2) break;
    if (s.heading.depth !== 3 || s.heading.text.includes(".")) continue;
    const name = s.heading.text;
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const own = s.own;
    const descMd = own.split(/\n\*\*/)[0] ?? "";
    const description = clip(plainBlocks(descMd).join(" "), 400);
    const props = tableAfter(own, new RegExp(`\\*\\*${esc} Props:\\*\\*`));
    const attrs = tableAfter(own, new RegExp(`\\*\\*${esc} Data Attributes:\\*\\*`));
    const vars = tableAfter(own, new RegExp(`\\*\\*${esc} CSS Variables:\\*\\*`));
    parts.push({
      name,
      description,
      props: (props?.rows ?? [])
        .filter((r) => r[0])
        .map((r) => {
          const required = /\*$/.test(r[0]!);
          return { name: r[0]!.replace(/\s*\*$/, ""), type: dash(r[1]), defaultValue: dash(r[2]), description: clip(dash(r[3]), 600), required: required ? true : null };
        }),
      dataAttributes: (attrs?.rows ?? []).filter((r) => r[0]).map((r) => ({ name: r[0]!, type: dash(r[1]), description: clip(dash(r[2]), 300) })),
      cssVariables: (vars?.rows ?? []).filter((r) => r[0]).map((r) => ({ name: r[0]!.replace(/`/g, ""), type: dash(r[1]), description: clip(dash(r[2]), 300) })),
    });
  }
  return parts;
}

/** Simple page (about, overview, handbook): title, subtitle, h2/h3 headings, plain blocks. */
export interface BaseTextPage {
  title: string | null;
  subtitle: string | null;
  headings: { depth: number; text: string; anchor: string }[];
  blocks: string[];
  componentLinks: string[];
}

export function parseBaseTextPage(mdx: string): BaseTextPage {
  const body = stripMdx(mdx);
  const { headings } = sections(body, "github");
  const links: string[] = [];
  const lre = /\]\(\/react\/components\/([a-z0-9-]+)(?:#[^)]*)?\)/g;
  for (let m = lre.exec(body); m; m = lre.exec(body)) if (!links.includes(m[1]!)) links.push(m[1]!);
  return {
    title: headings.find((h) => h.depth === 1)?.text ?? null,
    subtitle: tagText(body, "Subtitle"),
    headings: headings.filter((h) => h.depth >= 2 && h.depth <= 3).map((h) => ({ depth: h.depth, text: h.text, anchor: h.anchor })),
    blocks: plainBlocks(body.replace(/<[A-Z][A-Za-z]*[^>]*\/>/g, "")).slice(0, 80),
    componentLinks: links.sort(),
  };
}
