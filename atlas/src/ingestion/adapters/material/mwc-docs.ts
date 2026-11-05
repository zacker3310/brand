/**
 * Static parser for material-web docs/components/*.md (GitHub-flavoured Markdown with
 * catalog-only HTML comments). Uses mdast; never renders or executes embedded HTML/JS.
 *
 * Extracts: title, catalog URL, design-article/source links, intro, documented "Types",
 * section first paragraphs, Accessibility guidance (roles/keyboard only when stated),
 * Theming token tables ("Token | Default value"), auto-generated API tables
 * (Properties / Methods / Events per custom element), and short HTML code samples.
 */
import type { Root, RootContent, Table, TableCell, Heading, Paragraph, List, PhrasingContent, Code } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { toString } from "mdast-util-to-string";
import { gfm } from "micromark-extension-gfm";

export interface DocSection {
  depth: number;
  title: string;
  anchor: string;
  line: number;
  firstParagraph: string | null;
  /** Enclosing H2 title (for H3/H4). */
  parent: string | null;
}

export interface DocTableRow {
  [column: string]: string;
}

export interface ApiElement {
  className: string;
  tagName: string;
  line: number;
  properties: DocTableRow[];
  methods: DocTableRow[];
  events: DocTableRow[];
}

export interface ThemingTable {
  heading: string | null;
  line: number;
  tokens: { name: string; defaultValue: string | null }[];
  allTokensUrl: string | null;
}

export interface DocKeyboard {
  keys: string;
  action: string;
  location: string;
}

export interface DocCodeSample {
  heading: string | null;
  anchor: string | null;
  lang: string | null;
  code: string;
  line: number;
}

export interface MwcDoc {
  title: string | null;
  frontmatter: { name?: string; dirname?: string };
  catalogUrl: string | null;
  designArticleUrl: string | null;
  sourceCodeUrl: string | null;
  intro: string | null;
  introLine: number | null;
  types: string[];
  sections: DocSection[];
  accessibility: {
    line: number;
    paragraphs: { heading: string | null; text: string }[];
    roles: string[];
    keyboard: DocKeyboard[];
  } | null;
  theming: ThemingTable[];
  api: ApiElement[];
  codeSamples: DocCodeSample[];
}

/** GitHub-style heading anchor. */
export function githubAnchor(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\- _]/gu, "")
    .replace(/ /g, "-");
}

function cellText(node: TableCell | PhrasingContent | Paragraph): string {
  const parts: string[] = [];
  const walk = (n: { type: string; value?: string; children?: unknown[] }) => {
    if (n.type === "html") {
      if (/^<br\s*\/?>$/i.test(n.value ?? "")) parts.push(" ");
      return;
    }
    if (n.type === "text" || n.type === "inlineCode") {
      parts.push(n.value ?? "");
      return;
    }
    for (const c of (n.children ?? []) as { type: string; value?: string; children?: unknown[] }[]) walk(c);
  };
  walk(node as { type: string; value?: string; children?: unknown[] });
  return parts.join("").replace(/\s+/g, " ").trim();
}

function tableRows(t: Table): DocTableRow[] {
  const [head, ...body] = t.children;
  if (!head) return [];
  const cols = head.children.map((c) => cellText(c));
  return body.map((r) => {
    const row: DocTableRow = {};
    r.children.forEach((c, i) => {
      const col = cols[i] ?? `col${i}`;
      row[col] = cellText(c);
    });
    return row;
  });
}

const lineOf = (n: { position?: { start: { line: number } } }) => n.position?.start.line ?? 0;

function linksIn(node: RootContent): { text: string; url: string }[] {
  const out: { text: string; url: string }[] = [];
  const walk = (n: { type: string; url?: string; children?: unknown[] }) => {
    if (n.type === "link" && n.url) out.push({ text: toString(n as never, { includeHtml: false }).trim(), url: n.url });
    for (const c of (n.children ?? []) as { type: string; url?: string; children?: unknown[] }[]) walk(c);
  };
  walk(node as never);
  return out;
}

const KEY_RE = /\bpress(?:es|ing)?\s+(?:the\s+)?(Escape|Esc|Tab|Enter|Space(?:bar)?|Arrow ?(?:Up|Down|Left|Right)|Home|End)\b/i;

/** Pull explicitly documented key interactions out of a sentence-bearing text. */
export function keyboardFrom(text: string, location: string): DocKeyboard[] {
  const out: DocKeyboard[] = [];
  for (const sentence of text.split(/(?<=[.!?])\s+/)) {
    const m = KEY_RE.exec(sentence);
    if (!m) continue;
    const keys = m[1]!.replace(/^esc$/i, "Escape").replace(/^arrow ?/i, "Arrow").replace(/^spacebar$/i, "Space");
    const norm = keys.charAt(0).toUpperCase() + keys.slice(1);
    out.push({ keys: norm, action: sentence.trim().slice(0, 240), location });
  }
  return out;
}

export function parseMwcDoc(markdown: string, file: string): MwcDoc {
  const tree: Root = fromMarkdown(markdown, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
  const doc: MwcDoc = {
    title: null,
    frontmatter: {},
    catalogUrl: null,
    designArticleUrl: null,
    sourceCodeUrl: null,
    intro: null,
    introLine: null,
    types: [],
    sections: [],
    accessibility: null,
    theming: [],
    api: [],
    codeSamples: [],
  };
  const fm = /<!--\s*-{3}\s*\n([\s\S]*?)\n-{3,}\s*-->/.exec(markdown);
  if (fm) {
    const name = /^name:\s*(.+)$/m.exec(fm[1]!);
    const dirname = /^dirname:\s*(.+)$/m.exec(fm[1]!);
    if (name) doc.frontmatter.name = name[1]!.trim();
    if (dirname) doc.frontmatter.dirname = dirname[1]!.trim();
  }

  let h2: string | null = null;
  let h3: string | null = null;
  let h4: string | null = null;
  let lastSection: DocSection | null = null;
  let currentApi: ApiElement | null = null;
  let lastThemingTable: ThemingTable | null = null;
  const nodes = tree.children;
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]!;
    if (n.type === "heading") {
      const h = n as Heading;
      const title = toString(h, { includeHtml: false }).replace(/\s+/g, " ").trim();
      if (h.depth === 1) {
        if (!doc.title) doc.title = title;
        continue;
      }
      if (h.depth === 2) {
        h2 = title;
        h3 = null;
        h4 = null;
        currentApi = null;
      } else if (h.depth === 3) {
        h3 = title;
        h4 = null;
      } else if (h.depth === 4) h4 = title;
      lastSection = { depth: h.depth, title, anchor: githubAnchor(title), line: lineOf(h), firstParagraph: null, parent: h.depth > 2 ? h2 : null };
      doc.sections.push(lastSection);
      if (h2 === "API" && h.depth === 3) {
        const m = /^(\w+)\s+<([a-z0-9-]+)>/.exec(title);
        currentApi = m ? { className: m[1]!, tagName: m[2]!, line: lineOf(h), properties: [], methods: [], events: [] } : null;
        if (currentApi) doc.api.push(currentApi);
      }
      if (title === "Accessibility" && h.depth === 2) doc.accessibility = { line: lineOf(h), paragraphs: [], roles: [], keyboard: [] };
      continue;
    }

    if (n.type === "paragraph") {
      const text = toString(n, { includeHtml: false, includeImageAlt: false }).replace(/\s+/g, " ").trim();
      if (!text) continue;
      if (/fully rendered on the/i.test(text)) {
        const link = linksIn(n).find((l) => /material-web\.dev/.test(l.url));
        if (link) doc.catalogUrl = link.url;
        continue;
      }
      if (!h2 && doc.title && !doc.intro) {
        doc.intro = text;
        doc.introLine = lineOf(n);
      }
      if (lastSection && !lastSection.firstParagraph) lastSection.firstParagraph = text;
      if (h2 === "Accessibility" && doc.accessibility) {
        doc.accessibility.paragraphs.push({ heading: h3, text });
        for (const m of text.matchAll(/role="([a-z]+)"/g)) doc.accessibility.roles.push(m[1]!);
        doc.accessibility.keyboard.push(...keyboardFrom(text, `${file}#${githubAnchor(h3 ?? "Accessibility")}`));
      }
      continue;
    }

    if (n.type === "blockquote" && h2 === "Accessibility" && doc.accessibility) {
      const text = toString(n, { includeHtml: false }).replace(/\s+/g, " ").trim();
      if (text) doc.accessibility.paragraphs.push({ heading: h3, text });
      continue;
    }

    if (n.type === "list") {
      const list = n as List;
      const links = linksIn(list);
      if (!h2) {
        for (const l of links) {
          if (/^design article$/i.test(l.text) && !doc.designArticleUrl) doc.designArticleUrl = l.url;
          if (/^source code$/i.test(l.text) && !doc.sourceCodeUrl) doc.sourceCodeUrl = l.url;
        }
      }
      if (h2 === "Types" && !h3 && list.ordered) {
        for (const item of list.children) {
          const t = toString(item, { includeHtml: false }).replace(/\s+/g, " ").trim();
          if (t) doc.types.push(t);
        }
      }
      const all = links.find((l) => /^all tokens$/i.test(l.text));
      if (all && lastThemingTable && !lastThemingTable.allTokensUrl) lastThemingTable.allTokensUrl = all.url;
      continue;
    }

    if (n.type === "table") {
      const rows = tableRows(n as Table);
      const head = (n as Table).children[0]?.children.map((c) => cellText(c)) ?? [];
      if (head[0] === "Token" && /default/i.test(head[1] ?? "")) {
        lastThemingTable = {
          heading: h4 ?? h3,
          line: lineOf(n),
          tokens: rows
            .map((r) => ({ name: (r.Token ?? "").trim(), defaultValue: (r[head[1]!] ?? "").trim() || null }))
            .filter((t) => /^--[a-z0-9-]+$/.test(t.name)),
          allTokensUrl: null,
        };
        doc.theming.push(lastThemingTable);
        continue;
      }
      if (currentApi && h4) {
        if (/^properties$/i.test(h4) && head[0] === "Property") currentApi.properties.push(...rows);
        else if (/^methods$/i.test(h4) && head[0] === "Method") currentApi.methods.push(...rows);
        else if (/^events$/i.test(h4) && head[0] === "Event") currentApi.events.push(...rows);
      }
      continue;
    }

    if (n.type === "code") {
      const c = n as Code;
      if (h2 && h2 !== "API" && c.value.trim() && c.value.length <= 1500) {
        const heading = h3 ?? h2;
        doc.codeSamples.push({ heading, anchor: githubAnchor(heading), lang: c.lang ?? null, code: c.value, line: lineOf(c) });
      }
    }
  }
  if (doc.accessibility) {
    // keyboard interactions documented in event descriptions (e.g. "canceled by ... pressing Escape")
    for (const el of doc.api) {
      for (const row of el.events) {
        const desc = row.Description ?? "";
        doc.accessibility.keyboard.push(...keyboardFrom(desc, `${file}#${githubAnchor(`${el.className} <${el.tagName}>`)}`));
      }
    }
    doc.accessibility.roles = [...new Set(doc.accessibility.roles)];
  }
  return doc;
}
