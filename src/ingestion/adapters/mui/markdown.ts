/**
 * Static parser for MUI docs markdown (docs/data/<product>/components/<x>/<x>.md and similar).
 * CommonMark + GFM via mdast; MUI directives ({{"demo": ...}}, :::info) and HTML are treated as
 * opaque. Nothing is executed. Only bounded excerpts are kept.
 */
import matter from "gray-matter";
import type { Nodes, Root } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import type { KeyboardInteraction } from "@/lib/contracts";
import { clip, createSlugger, decodeEntities, splitSentences, uniq } from "./shared";

export interface MdHeading {
  depth: number;
  text: string;
  anchor: string;
  line: number;
}

export interface MdSection {
  heading: MdHeading;
  /** Raw markdown of the section's own content (until the next heading of any depth). */
  own: string;
  /** Raw markdown including nested subsections. */
  full: string;
}

export interface MuiA11y {
  heading: string;
  anchor: string;
  guidance: string | null;
  aria: string | null;
  screenReader: string | null;
  keyboard: KeyboardInteraction[];
  keyboardText: string | null;
  keyboardAnchor: string | null;
  /** The keyboard subsection states the component is not focusable / has no keyboard interaction. */
  keyboardNone: boolean;
  roles: string[];
  apgPatterns: string[];
  wcag: string[];
}

export interface MuiMdDoc {
  frontmatter: {
    title: string | null;
    components: string[];
    hooks: string[];
    waiAria: string | null;
    githubSource: string | null;
    materialDesign: string | null;
  };
  h1: string | null;
  /** Text of `<p class="description">`. */
  description: string | null;
  headings: MdHeading[];
  /** Headings (h2/h3) that contain at least one live demo. */
  demoSections: { heading: string; anchor: string; demos: string[] }[];
  a11y: MuiA11y | null;
  mentionsResponsive: boolean;
}

export const ARIA_ROLES = new Set(
  "alert alertdialog application article banner button cell checkbox columnheader combobox complementary contentinfo definition dialog directory document feed figure form grid gridcell group heading img link list listbox listitem log main marquee math menu menubar menuitem menuitemcheckbox menuitemradio meter navigation none note option presentation progressbar radio radiogroup region row rowgroup rowheader scrollbar search searchbox separator slider spinbutton status switch tab table tablist tabpanel term textbox timer toolbar tooltip tree treegrid treeitem".split(
    " ",
  ),
);

const KEY_PATTERNS: [string, RegExp][] = [
  ["Shift+Tab", /\bShift\s*\+\s*Tab\b/],
  ["Tab", /\bTab\b(?!\s*(?:s\b|component|panel|list))/],
  ["Enter", /\bEnter\b/],
  ["Space", /\bSpace(?:bar)?\b/],
  ["Escape", /\bEsc(?:ape)?\b/],
  ["Home", /\bHome\b/],
  ["End", /\bEnd\b/],
  ["PageUp", /\bPage ?Up\b/],
  ["PageDown", /\bPage ?Down\b/],
  ["ArrowUp", /\b(?:Arrow ?Up|Up ?Arrow)\b/],
  ["ArrowDown", /\b(?:Arrow ?Down|Down ?Arrow)\b/],
  ["ArrowLeft", /\b(?:Arrow ?Left|Left ?Arrow)\b/],
  ["ArrowRight", /\b(?:Arrow ?Right|Right ?Arrow)\b/],
  ["Arrow keys", /\b(?:[Aa]rrow|[Cc]ursor) keys\b/],
  ["Backspace", /\bBackspace\b/],
  ["Delete", /\bDelete\b/],
];

/** Keys documented in a sentence (case-sensitive key names; <kbd> text is already plain). */
export function keysIn(sentence: string): string[] {
  const found: string[] = [];
  let rest = sentence;
  for (const [label, re] of KEY_PATTERNS) {
    if (re.test(rest)) {
      found.push(label);
      if (label === "Shift+Tab") rest = rest.replace(new RegExp(re.source, "g"), " ");
    }
  }
  return found;
}

/** Keyboard interactions from documented prose: one entry per sentence that names keys. */
export function keyboardFromBlocks(blocks: string[]): KeyboardInteraction[] {
  const out: KeyboardInteraction[] = [];
  const seen = new Set<string>();
  for (const b of blocks) {
    for (const s of splitSentences(b)) {
      const keys = keysIn(s);
      if (!keys.length) continue;
      const action = clip(s, 280)!;
      const k = `${keys.join("/")}|${action}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ keys: keys.join(" / "), action });
    }
  }
  return out;
}

/* ------------------------------- mdast text ------------------------------- */

export function parseMarkdownTree(md: string): Root {
  return fromMarkdown(md, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
}

function textOf(node: Nodes): string {
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
      return "";
    case "break":
      return " ";
    default:
      if ("children" in node && Array.isArray(node.children)) return (node.children as Nodes[]).map(textOf).join("");
      return "";
  }
}

/** Plain-text blocks (paragraphs, list items, table rows) of a markdown fragment. */
export function plainBlocks(md: string): string[] {
  const tree = parseMarkdownTree(preprocess(md));
  const out: string[] = [];
  const visit = (n: Nodes) => {
    if (n.type === "paragraph") {
      const t = decodeEntities(textOf(n)).replace(/\s+/g, " ").trim();
      if (t) out.push(t);
      return;
    }
    if (n.type === "listItem") {
      const parts: string[] = [];
      for (const c of n.children) {
        if (c.type === "list") continue;
        const t = decodeEntities(textOf(c)).replace(/\s+/g, " ").trim();
        if (t) parts.push(t);
      }
      if (parts.length) out.push(parts.join(" "));
      for (const c of n.children) if (c.type === "list") visit(c);
      return;
    }
    if (n.type === "tableRow") {
      const t = n.children.map((c) => decodeEntities(textOf(c)).trim()).join(" | ");
      if (t.trim()) out.push(t);
      return;
    }
    if (n.type === "heading" || n.type === "code" || n.type === "html") return;
    if ("children" in n && Array.isArray(n.children)) for (const c of n.children as Nodes[]) visit(c);
  };
  visit(tree);
  return out;
}

/** Remove MUI directives and admonition fences; keep their prose. */
function preprocess(md: string): string {
  return md
    .replace(/^\s*\{\{"(?:demo|component)":[^\n]*\}\}\s*$/gm, "")
    .replace(/^:::[a-z]*\s*$/gm, "")
    .replace(/<!--[\s\S]*?-->/g, "");
}

/* --------------------------------- parse ---------------------------------- */

const fmString = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const fmList = (v: unknown): string[] =>
  typeof v === "string"
    ? v
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean)
    : Array.isArray(v)
      ? v.map(String)
      : [];

const headingText = (raw: string) =>
  decodeEntities(
    raw
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/<[^>]+>/g, "")
      .replace(/[*_]/g, ""),
  ).trim();

/** Split markdown body into heading sections (code fences aware). */
export function sections(body: string, slugStyle: "mui" | "github"): { headings: MdHeading[]; sections: MdSection[]; lines: string[] } {
  const lines = body.split("\n");
  const slug = createSlugger(slugStyle);
  const headings: MdHeading[] = [];
  let fence = false;
  lines.forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    if (fence) return;
    const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!m) return;
    const depth = m[1]!.length;
    const text = headingText(m[2]!);
    headings.push({ depth, text, anchor: depth === 1 ? "" : slug(text), line: i });
  });
  const secs: MdSection[] = headings.map((h, idx) => {
    const next = headings[idx + 1];
    const nextSameOrHigher = headings.slice(idx + 1).find((x) => x.depth <= h.depth);
    const own = lines.slice(h.line + 1, next ? next.line : lines.length).join("\n");
    const full = lines.slice(h.line + 1, nextSameOrHigher ? nextSameOrHigher.line : lines.length).join("\n");
    return { heading: h, own, full };
  });
  return { headings, sections: secs, lines };
}

export function apgSlugs(text: string): string[] {
  const out: string[] = [];
  const re = /w3\.org\/WAI\/ARIA\/apg\/patterns\/([a-z0-9-]+)/g;
  for (let m = re.exec(text); m; m = re.exec(text)) out.push(m[1]!);
  return uniq(out);
}

export function rolesIn(text: string): string[] {
  const out: string[] = [];
  const res = [/role(?:\s+of)?\s*=?\s*\\?["“']([a-z]+)\\?["”']/g, /\[role="([a-z]+)"\]/g, /a role of "([a-z]+)"/g];
  for (const re of res) for (let m = re.exec(text); m; m = re.exec(text)) if (ARIA_ROLES.has(m[1]!)) out.push(m[1]!);
  return uniq(out).sort();
}

export function wcagIn(text: string): string[] {
  const out: string[] = [];
  const re = /Success Criterion (\d\.\d{1,2}\.\d{1,2})/g;
  for (let m = re.exec(text); m; m = re.exec(text)) out.push(m[1]!);
  return uniq(out).sort();
}

function sectionText(md: string, max: number): string | null {
  const blocks = plainBlocks(md)
    .map((b) => b.replace(/^\((?:WAI-ARIA:[^)]*|WAI tutorial)\)\s*/, ""))
    .filter(Boolean);
  return clip(blocks.join(" "), max);
}

export function parseA11y(secs: MdSection[]): MuiA11y | null {
  const idx = secs.findIndex((s) => s.heading.depth <= 3 && /^accessibility$/i.test(s.heading.text));
  if (idx < 0) return null;
  const a = secs[idx]!;
  const subs = secs.slice(idx + 1).filter((s, i, arr) => s.heading.depth > a.heading.depth && arr.slice(0, i).every((x) => x.heading.depth > a.heading.depth));
  const sub = (re: RegExp) => subs.find((s) => re.test(s.heading.text));
  const kb = sub(/keyboard/i);
  const aria = sub(/^aria\b/i);
  const sr = sub(/screen reader/i);
  const kbBlocks = kb ? plainBlocks(kb.full) : [];
  const keyboard = keyboardFromBlocks(kbBlocks);
  const kbText = clip(kbBlocks.join(" "), 800);
  const raw = a.full;
  return {
    heading: a.heading.text,
    anchor: a.heading.anchor,
    guidance: sectionText(a.own, 1200) ?? sectionText(raw, 1200),
    aria: aria ? sectionText(aria.full, 800) : null,
    screenReader: sr ? sectionText(sr.full, 800) : null,
    keyboard,
    keyboardText: kbText,
    keyboardAnchor: kb?.heading.anchor ?? null,
    keyboardNone: !!kb && !keyboard.length && /\b(?:is|are) not focusable\b/i.test(kbText ?? ""),
    roles: rolesIn(raw),
    apgPatterns: apgSlugs(raw),
    wcag: wcagIn(raw),
  };
}

export function parseMuiMarkdown(text: string): MuiMdDoc {
  let data: Record<string, unknown> = {};
  let body = text;
  try {
    const m = matter(text);
    data = (m.data ?? {}) as Record<string, unknown>;
    body = m.content;
  } catch {
    body = text.replace(/^---\n[\s\S]*?\n---\n/, "");
  }
  const { headings, sections: secs, lines } = sections(body, "mui");
  const h1 = headings.find((h) => h.depth === 1)?.text ?? null;
  const descM = /<p class="description">([\s\S]*?)<\/p>/.exec(body);
  const description = descM ? clip(decodeEntities(descM[1]!.replace(/<[^>]+>/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")), 600) : null;
  // Demo sections: {{"demo": "X.js"}} under the nearest preceding h2/h3.
  const demoSections: MuiMdDoc["demoSections"] = [];
  let current: MdHeading | null = null;
  let fence = false;
  const byLine = new Map(headings.map((h) => [h.line, h]));
  lines.forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    if (fence) return;
    const h = byLine.get(i);
    if (h && h.depth >= 2 && h.depth <= 3) current = h;
    const m = /\{\{"demo":\s*"([^"]+)"/.exec(line);
    if (m && current) {
      const cur: MdHeading = current;
      const existing = demoSections.find((d) => d.anchor === cur.anchor);
      if (existing) existing.demos.push(m[1]!);
      else demoSections.push({ heading: cur.text, anchor: cur.anchor, demos: [m[1]!] });
    }
  });
  return {
    frontmatter: {
      title: fmString(data.title),
      components: fmList(data.components),
      hooks: fmList(data.hooks),
      waiAria: fmString(data.waiAria),
      githubSource: fmString(data.githubSource),
      materialDesign: fmString(data.materialDesign),
    },
    h1,
    description,
    headings,
    demoSections,
    a11y: parseA11y(secs),
    mentionsResponsive: /\bresponsive\b|\bbreakpoints?\b|useMediaQuery|small screens/i.test(body),
  };
}

/** Plain-text paragraphs of a markdown body, for statements in overview pages. */
export function findSentence(md: string, re: RegExp): string | null {
  for (const block of plainBlocks(md)) for (const s of splitSentences(block)) if (re.test(s)) return clip(s, 280);
  return null;
}
