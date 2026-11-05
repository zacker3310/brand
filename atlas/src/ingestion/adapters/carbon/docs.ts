/**
 * Parsers for carbon-website MDX pages (usage / style / code / accessibility tabs, patterns,
 * "What is Carbon?") and the repo's navigation + component index data files.
 * All functions are pure: text in, JSON-serializable data out.
 */
import YAML from "yaml";
import type { Nodes, RootContent } from "mdast";
import {
  collapse,
  firstParagraph,
  firstSentences,
  inlineCodes,
  jsxBlockText,
  linksIn,
  ownNodes,
  parseMdx,
  proseBlocks,
  sections,
  splitSentences,
  strongTexts,
  tablesIn,
  textOf,
  type Section,
  type TableData,
} from "./mdx";

/* ------------------------------ shared types ------------------------------ */

export interface DocVariant {
  name: string;
  description: string | null;
  axis: string;
  location: string;
}

export interface DocState {
  name: string;
  description: string | null;
  location: string;
  method: "table" | "bold-terms";
}

export interface DocKeyboard {
  keys: string;
  action: string;
  /** Heading the sentence came from (e.g. "Keyboard interactions > Combo box"). */
  location: string;
  /** Nearest sub-heading inside the keyboard section, used to attach keys to child components. */
  context: string | null;
}

export interface DocLink {
  text: string;
  url: string;
  /** carbon-website component doc slug the link points at (as written, case preserved), if any. */
  componentDocSlug: string | null;
  patternSlug: string | null;
}

export interface DocSectionSummary {
  title: string;
  depth: number;
  firstParagraph: string | null;
}

export interface StorybookStory {
  label: string;
  storyId: string;
  url: string;
}

/* ------------------------------- key parsing ------------------------------ */

const KEY_LABELS: [RegExp, string][] = [
  [/^shift\s*\+\s*tab$/i, "Shift+Tab"],
  [/^tab$/i, "Tab"],
  [/^(enter|return)$/i, "Enter"],
  [/^(space|spacebar|space bar)$/i, "Space"],
  [/^(esc|escape)$/i, "Escape"],
  [/^(up|up arrow|arrow up|uparrow)$/i, "ArrowUp"],
  [/^(down|down arrow|arrow down|downarrow)$/i, "ArrowDown"],
  [/^(left|left arrow|arrow left|leftarrow)$/i, "ArrowLeft"],
  [/^(right|right arrow|arrow right|rightarrow)$/i, "ArrowRight"],
  [/^(arrow|arrows|arrow keys?)$/i, "Arrow keys"],
  [/^home$/i, "Home"],
  [/^end$/i, "End"],
  [/^page\s*up$/i, "PageUp"],
  [/^page\s*down$/i, "PageDown"],
  [/^(delete|del)$/i, "Delete"],
  [/^backspace$/i, "Backspace"],
  [/^shift$/i, "Shift"],
  [/^(ctrl|control)$/i, "Control"],
  [/^(cmd|command)$/i, "Meta"],
  [/^(alt|option)$/i, "Alt"],
];

export function keyLabel(raw: string): string | null {
  const t = raw.trim().replace(/\s+key$/i, "");
  for (const [re, label] of KEY_LABELS) if (re.test(t)) return label;
  // Chords like "Ctrl + C" / "Shift+F10"
  const chord = t.split(/\s*\+\s*/);
  if (chord.length > 1 && chord.every((p) => keyLabel(p) || /^[A-Za-z0-9]$|^F\d{1,2}$/.test(p))) {
    return chord.map((p) => keyLabel(p) ?? p.toUpperCase()).join("+");
  }
  return null;
}

const PLAIN_KEY_RE = /\b(arrow keys|tab key|enter key|space ?bar|escape key|esc key)\b/gi;

/** Extract documented keyboard interactions from prose under keyboard headings. */
export function keyboardFromSections(secs: Section[], rootTitle: string): DocKeyboard[] {
  const out: DocKeyboard[] = [];
  const seen = new Set<string>();
  for (const sec of secs) {
    let context: string | null = null;
    let location = `${rootTitle} > ${sec.title}`;
    const process = (nodes: RootContent[]) => {
      for (const block of proseBlocks(nodes, { ticks: true })) {
        for (const sentence of splitSentences(block)) {
          const keys = new Set<string>();
          for (const m of sentence.matchAll(/`([^`]+)`/g)) {
            const k = keyLabel(m[1]!);
            if (k) keys.add(k);
          }
          for (const m of sentence.matchAll(PLAIN_KEY_RE)) {
            const k = keyLabel(m[1]!.replace(/ key$/i, ""));
            if (k) keys.add(k);
          }
          if (!keys.size) continue;
          const plain = collapse(sentence.replace(/`/g, ""));
          const action = firstSentences(context ? `${context}: ${plain}` : plain, 220)!;
          const dedupe = action.toLowerCase();
          if (seen.has(dedupe)) continue;
          seen.add(dedupe);
          out.push({ keys: [...keys].join(" / "), action, location, context });
        }
      }
    };
    // Walk the section's nodes, tracking sub-headings as context.
    let buf: RootContent[] = [];
    for (const n of sec.nodes) {
      if (n.type === "heading") {
        process(buf);
        buf = [];
        context = collapse(textOf(n));
        location = `${rootTitle} > ${sec.title} > ${context}`;
        continue;
      }
      buf.push(n);
    }
    process(buf);
  }
  return out;
}

/* ------------------------------ link mapping ------------------------------ */

const COMPONENT_LINK_RE = /(?:^|carbondesignsystem\.com)\/components\/([A-Za-z0-9-]+)\/(?:usage|style|code|accessibility)\b/;
const COMPONENT_LINK_NEW_RE = /\/building-blocks\/core\/components\/([a-z0-9-]+)(?:\/|$)/;
const PATTERN_LINK_RE = /(?:^|carbondesignsystem\.com)\/patterns\/([a-z0-9-]+)/;
const PATTERN_LINK_NEW_RE = /\/building-blocks\/core\/patterns\/([a-z0-9-]+)/;

export function classifyLink(url: string, text: string): DocLink {
  const c = url.match(COMPONENT_LINK_RE) ?? url.match(COMPONENT_LINK_NEW_RE);
  const p = c ? null : (url.match(PATTERN_LINK_RE) ?? url.match(PATTERN_LINK_NEW_RE));
  return { text, url, componentDocSlug: c?.[1] ?? null, patternSlug: p?.[1] ?? null };
}

/* ------------------------------ table helpers ----------------------------- */

const cleanName = (s: string) =>
  collapse(s)
    .replace(/^[*_]+|[*_]+$/g, "")
    .replace(/\s*\\?\*$/, "")
    .trim();

function colIndex(headers: string[], re: RegExp): number {
  return headers.findIndex((h) => re.test(h));
}

const DIMENSION_ONLY = /^[\d\s./x×,()–-]*(px|rem|em|%)?[\d\s./x×,()–-]*(px|rem|em|%)?$/i;

/** Values of a size column across tables (e.g. "Small (sm)", "Large (productive)"). */
export function sizesFromTables(tables: TableData[]): string[] {
  const out: string[] = [];
  for (const t of tables) {
    const i = t.headers.findIndex((h) => /\bsizes?\b/i.test(h) && !/px|rem|height|width|dimension/i.test(h));
    if (i < 0) continue;
    for (const r of t.rows) {
      const v = cleanName(r[i] ?? "");
      if (!v || DIMENSION_ONLY.test(v) || v.length > 40) continue;
      if (!out.some((x) => x.toLowerCase() === v.toLowerCase())) out.push(v);
    }
  }
  return out;
}

/** State names from tables whose first header is "State". */
export function statesFromTables(tables: TableData[], location: string): DocState[] {
  const out: DocState[] = [];
  for (const t of tables) {
    if (!/^states?$/i.test(t.headers[0] ?? "")) continue;
    const di = colIndex(t.headers, /when to use|description|purpose|usage|behavior/i);
    for (const r of t.rows) {
      const name = cleanName(r[0] ?? "");
      if (!name || name.length > 40) continue;
      if (out.some((s) => s.name.toLowerCase() === name.toLowerCase())) continue;
      out.push({ name, description: di >= 0 ? firstSentences(r[di], 280) : null, location, method: "table" });
    }
  }
  return out;
}

const STATE_WORD_RE = /^[a-z][a-z -]{1,24}$/i;

/** States named in bold in a States section's intro prose ("**enabled**, **hover**, ..."). */
export function statesFromBold(nodes: RootContent[], location: string): DocState[] {
  const out: DocState[] = [];
  const intro = nodes.filter((n) => n.type === "paragraph" || n.type === "list").slice(0, 3);
  for (const s of strongTexts(intro)) {
    if (/:/.test(s)) continue;
    for (const part of s.split(/,|\band\b/)) {
      const name = collapse(part).replace(/[.,]$/, "");
      if (!name || !STATE_WORD_RE.test(name)) continue;
      if (out.some((x) => x.name.toLowerCase() === name.toLowerCase())) continue;
      out.push({ name: name.charAt(0).toUpperCase() + name.slice(1), description: null, location, method: "bold-terms" });
    }
  }
  return out;
}

export interface DocTokenUsage {
  tokenName: string;
  property: string | null;
  location: string;
}

/** Token usage rows from spec tables with a "...token" column, e.g. | Container | background-color | `$button-primary` |. */
export function tokenUsagesFromTables(tables: TableData[], location: string): DocTokenUsage[] {
  const out: DocTokenUsage[] = [];
  const seen = new Set<string>();
  for (const t of tables) {
    const ti = t.headers.findIndex((h) => /token/i.test(h));
    if (ti < 0) continue;
    const si = /^states?$/i.test(t.headers[0] ?? "") ? 0 : -1;
    const ei = colIndex(t.headers, /^element$/i);
    const pi = colIndex(t.headers, /^property$/i);
    let state = "";
    let element = "";
    t.rows.forEach((r, ri) => {
      if (si >= 0 && r[si]) state = cleanName(r[si]!);
      if (ei >= 0 && r[ei]) element = cleanName(r[ei]!);
      const prop = pi >= 0 ? cleanName(r[pi] ?? "") : "";
      const cell = t.cellNodes[ri]?.[ti];
      if (!cell) return;
      for (const code of inlineCodes(cell as Nodes)) {
        const m = code.trim().match(/^\$([a-z][a-z0-9-]*)$/);
        if (!m) continue;
        const parts = [element, prop].filter(Boolean).join(" ");
        const property = parts ? (state ? `${parts} (${state.toLowerCase()})` : parts) : state ? `(${state.toLowerCase()})` : null;
        const key = `${m[1]}|${property}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ tokenName: m[1]!, property, location });
      }
    });
  }
  return out;
}

/** <StorybookDemo url="…" variants={[{ label: '…', variant: '…' }]} /> blocks. */
export function storybookDemos(body: string): StorybookStory[] {
  const out: StorybookStory[] = [];
  for (const block of body.matchAll(/<StorybookDemo\b([\s\S]*?)\/>/g)) {
    const inner = block[1] ?? "";
    const base = inner.match(/url="(https:\/\/[a-z-]+\.carbondesignsystem\.com)\/?"/)?.[1];
    if (!base) continue;
    for (const m of inner.matchAll(/label:\s*['"]([^'"]+)['"],\s*variant:\s*['"]([a-z0-9-]+--[a-z0-9-]+)['"]/g)) {
      const storyId = m[2]!;
      if (out.some((s) => s.storyId === storyId)) continue;
      out.push({ label: m[1]!, storyId, url: `${base}/?path=/story/${storyId}` });
    }
  }
  return out;
}

/* --------------------------------- usage ---------------------------------- */

export interface UsageData {
  title: string | null;
  description: string | null;
  descriptionLocation: string | null;
  variants: DocVariant[];
  variantsSectionFound: boolean;
  states: DocState[];
  statesSectionFound: boolean;
  sizes: string[];
  sizesSectionFound: boolean;
  keyboard: DocKeyboard[];
  keyboardSectionFound: boolean;
  related: DocLink[];
  relatedSectionFound: boolean;
  sectionSummaries: DocSectionSummary[];
  storybook: StorybookStory[];
}

export function parseUsage(text: string, file: string): UsageData {
  const doc = parseMdx(text);
  const secs = sections(doc.tree);
  const fmDesc = typeof doc.frontmatter.description === "string" ? collapse(doc.frontmatter.description) : null;
  const pageDesc = jsxBlockText(doc.body, "PageDescription");
  const description = firstSentences(fmDesc || pageDesc, 280);
  const descriptionLocation = fmDesc ? `${file}#frontmatter.description` : pageDesc ? `${file}#PageDescription` : null;

  // Variants: first "Variants"/"Types" section with a table naming variants.
  let variants: DocVariant[] = [];
  const variantSecs = secs.filter((s) => s.depth <= 3 && /^(variants|types|[a-z ]+ types?)$/i.test(s.title));
  for (const sec of variantSecs) {
    const t = tablesIn(ownNodes(sec)).find((tb) => /variant|type/i.test(tb.headers[0] ?? ""));
    if (!t) continue;
    const axis = /type/i.test(t.headers[0] ?? "") && !/variant/i.test(t.headers[0] ?? "") ? "type" : "variant";
    const di = colIndex(t.headers, /purpose|usage|use case|description|when to use/i);
    for (const r of t.rows) {
      const name = cleanName(r[0] ?? "");
      if (!name || name.length > 60) continue;
      if (variants.some((v) => v.name.toLowerCase() === name.toLowerCase())) continue;
      variants.push({ name, description: firstSentences(r[di >= 0 ? di : 1], 280), axis, location: `${file}#${sec.title}` });
    }
    if (variants.length) break;
  }
  variants = variants.slice(0, 30);

  // States: all "...States"/"...state" sections (tables first, then bold terms in the intro).
  const stateSecs = secs.filter((s) => /^(states|[a-z -]+ states)$/i.test(s.title));
  const states: DocState[] = [];
  for (const sec of stateSecs) {
    const loc = `${file}#${[...sec.parents.slice(-1), sec.title].join(" > ")}`;
    const fromTable = statesFromTables(tablesIn(ownNodes(sec)), loc);
    const found = fromTable.length ? fromTable : statesFromBold(ownNodes(sec), loc);
    for (const s of found) if (!states.some((x) => x.name.toLowerCase() === s.name.toLowerCase())) states.push(s);
  }

  // Sizes: "Sizes" / "<X> sizes" sections in usage (style tab is parsed separately).
  const sizeSecs = secs.filter((s) => /^(sizes?|[a-z ]+ sizes?)$/i.test(s.title));
  const sizes = sizesFromTables(sizeSecs.flatMap((s) => tablesIn(s.nodes)));

  const kbSecs = secs.filter((s) => /keyboard/i.test(s.title) && !/shortcut/i.test(s.title));
  const keyboard = keyboardFromSections(kbSecs, "Usage");

  const relSecs = secs.filter((s) => s.depth === 2 && /^related/i.test(s.title));
  const related = relSecs.flatMap((s) => linksIn(s.nodes)).map((l) => classifyLink(l.url, l.text));

  const sectionSummaries = secs
    .filter((s) => s.depth >= 2 && s.depth <= 4)
    .map((s) => ({ title: s.title, depth: s.depth, firstParagraph: firstSentences(firstParagraph(ownNodes(s)), 280) }));

  return {
    title: typeof doc.frontmatter.title === "string" ? doc.frontmatter.title : null,
    description,
    descriptionLocation,
    variants,
    variantsSectionFound: variantSecs.length > 0,
    states,
    statesSectionFound: stateSecs.length > 0,
    sizes,
    sizesSectionFound: sizeSecs.length > 0,
    keyboard,
    keyboardSectionFound: kbSecs.length > 0,
    related,
    relatedSectionFound: relSecs.length > 0,
    sectionSummaries,
    storybook: storybookDemos(doc.body),
  };
}

/* --------------------------------- style ---------------------------------- */

export interface StyleData {
  states: DocState[];
  sizes: string[];
  sizeSectionFound: boolean;
  tokenUsages: DocTokenUsage[];
  tokenTablesFound: boolean;
}

export function parseStyle(text: string, file: string): StyleData {
  const doc = parseMdx(text);
  const secs = sections(doc.tree);
  const all = tablesIn(doc.tree.children);
  const states = statesFromTables(all, `${file}#interactive states`);
  const sizeSecs = secs.filter((s) => s.depth === 2 && /^sizes?$/i.test(s.title));
  const sizes = sizesFromTables(sizeSecs.flatMap((s) => tablesIn(s.nodes)));
  // Token usages: per top-level section so the location names the section.
  const tokenUsages: DocTokenUsage[] = [];
  const top = secs.filter((s) => s.depth === 2);
  for (const sec of top) {
    for (const u of tokenUsagesFromTables(tablesIn(sec.nodes), `${file}#${sec.title}`)) {
      if (!tokenUsages.some((x) => x.tokenName === u.tokenName && x.property === u.property)) tokenUsages.push(u);
    }
  }
  return {
    states,
    sizes,
    sizeSectionFound: sizeSecs.length > 0,
    tokenUsages,
    tokenTablesFound: all.some((t) => t.headers.some((h) => /token/i.test(h))),
  };
}

/* ---------------------------------- code ---------------------------------- */

export interface CodeFramework {
  label: string;
  href: string;
  community: boolean;
}

export interface CodeData {
  frameworks: CodeFramework[];
  storybook: StorybookStory[];
}

export function parseCode(text: string): CodeData {
  const doc = parseMdx(text);
  const frameworks: CodeFramework[] = [];
  for (const m of doc.body.matchAll(/<ResourceCard\b([^>]*)>/g)) {
    const attrs = Object.fromEntries([...(m[1] ?? "").matchAll(/(\w+)="([^"]*)"/g)].map((a) => [a[1]!, a[2]!]));
    const label = attrs.subTitle?.trim();
    const href = attrs.href?.trim();
    if (!label || !href || !/^https?:\/\//.test(href)) continue;
    if (frameworks.some((f) => f.label === label)) continue;
    frameworks.push({ label, href, community: /community/i.test(label) });
  }
  return { frameworks, storybook: storybookDemos(doc.body) };
}

/* ------------------------------ accessibility ------------------------------ */

/** WAI-ARIA 1.2 roles (non-abstract). Used to validate role mentions. */
const ARIA_ROLES = new Set(
  "alert alertdialog application article banner blockquote button caption cell checkbox code columnheader combobox complementary contentinfo definition deletion dialog directory document emphasis feed figure form generic grid gridcell group heading img insertion link list listbox listitem log main marquee math menu menubar menuitem menuitemcheckbox menuitemradio meter navigation none note option paragraph presentation progressbar radio radiogroup region row rowgroup rowheader scrollbar search searchbox separator slider spinbutton status strong subscript superscript switch tab table tablist tabpanel term textbox time timer toolbar tooltip tree treegrid treeitem".split(
    " ",
  ),
);

export interface A11yData {
  guidance: string | null;
  keyboard: DocKeyboard[];
  keyboardSectionFound: boolean;
  focusManagement: string | null;
  focusSectionFound: boolean;
  screenReader: string | null;
  screenReaderSectionFound: boolean;
  roles: string[];
  ariaPattern: string | null;
  apgUrl: string | null;
}

export function parseA11y(text: string): A11yData {
  const doc = parseMdx(text);
  const secs = sections(doc.tree);
  const guidance = firstSentences(jsxBlockText(doc.body, "PageDescription"), 400);
  const kbSecs = secs.filter((s) => s.depth <= 3 && /keyboard/i.test(s.title));
  const keyboard = keyboardFromSections(kbSecs, "Accessibility");
  const focusSec = secs.find((s) => /^focus/i.test(s.title));
  const srSec = secs.find((s) => /screen ?reader/i.test(s.title));
  const roles = new Set<string>();
  for (const m of doc.body.matchAll(/role=["']([a-z]+)["']|role of `([a-z]+)`|`([a-z]+)` role\b/g)) {
    const r = m[1] ?? m[2] ?? m[3];
    if (r && ARIA_ROLES.has(r)) roles.add(r);
  }
  let ariaPattern: string | null = null;
  let apgUrl: string | null = null;
  for (const l of linksIn(doc.tree.children)) {
    const m = l.url.match(/wai-aria-practices(?:-1\.\d)?\/#([a-z-]+)/) ?? l.url.match(/w3\.org\/WAI\/ARIA\/apg\/patterns\/([a-z-]+)\//);
    if (m) {
      ariaPattern = m[1]!;
      apgUrl = l.url;
      break;
    }
  }
  return {
    guidance,
    keyboard,
    keyboardSectionFound: kbSecs.length > 0,
    focusManagement: focusSec ? firstSentences(proseBlocks(ownNodes(focusSec)).join(" "), 400) : null,
    focusSectionFound: !!focusSec,
    screenReader: srSec ? firstSentences(proseBlocks(ownNodes(srSec)).join(" "), 400) : null,
    screenReaderSectionFound: !!srSec,
    roles: [...roles].sort(),
    ariaPattern,
    apgUrl,
  };
}

/* -------------------------------- patterns -------------------------------- */

export interface PatternData {
  title: string | null;
  description: string | null;
  componentDocSlugs: string[];
  headings: string[];
}

export function parsePattern(text: string): PatternData {
  const doc = parseMdx(text);
  const fmDesc = typeof doc.frontmatter.description === "string" ? collapse(doc.frontmatter.description) : null;
  const desc = firstSentences(jsxBlockText(doc.body, "PageDescription") || fmDesc, 280);
  const slugs: string[] = [];
  for (const l of linksIn(doc.tree.children)) {
    const c = classifyLink(l.url, l.text).componentDocSlug;
    if (c && !slugs.includes(c)) slugs.push(c);
  }
  return {
    title: typeof doc.frontmatter.title === "string" ? doc.frontmatter.title : null,
    description: desc,
    componentDocSlugs: slugs,
    headings: sections(doc.tree)
      .filter((s) => s.depth === 2)
      .map((s) => s.title),
  };
}

/* ------------------------------ about / facts ------------------------------ */

export interface AboutData {
  description: string | null;
  principles: string[];
  principlesHeading: string | null;
}

export function parseAbout(text: string): AboutData {
  const doc = parseMdx(text);
  const secs = sections(doc.tree);
  const sec = secs.find((s) => /principles/i.test(s.title));
  const principles: string[] = [];
  if (sec) {
    for (const n of ownNodes(sec)) {
      if (n.type !== "paragraph") continue;
      const first = n.children[0];
      if (first?.type !== "strong") continue;
      const name = collapse(textOf(first)).replace(/[.:]$/, "");
      if (name && name.length <= 80 && !principles.includes(name)) principles.push(name);
    }
  }
  return {
    description: firstSentences(jsxBlockText(doc.body, "PageDescription"), 280),
    principles,
    principlesHeading: sec?.title ?? null,
  };
}

/* ------------------------------ nav + indexes ------------------------------ */

export interface NavPage {
  title: string;
  path: string;
  /** Segment after /components/ or /patterns/ as written in the nav (case preserved). */
  slug: string;
}

export interface NavData {
  components: NavPage[];
  patterns: NavPage[];
  aboutPath: string | null;
}

export function parseNav(yamlText: string): NavData {
  const data = YAML.parse(yamlText) as { title?: string; pages?: { title?: string; path?: string }[] }[] | null;
  const groups = Array.isArray(data) ? data : [];
  const pick = (title: string, prefix: string): NavPage[] => {
    const g = groups.find((x) => x.title === title);
    const out: NavPage[] = [];
    for (const p of g?.pages ?? []) {
      if (!p.title || !p.path || /^overview$/i.test(p.title)) continue;
      const m = p.path.match(new RegExp(`^/${prefix}/([^/]+)/`));
      if (!m) continue;
      out.push({ title: p.title.trim(), path: p.path, slug: m[1]! });
    }
    return out;
  };
  let aboutPath: string | null = null;
  for (const g of groups) for (const p of g.pages ?? []) if (p.title && /^what is carbon/i.test(p.title) && p.path) aboutPath = p.path;
  return { components: pick("Components", "components"), patterns: pick("Patterns", "patterns"), aboutPath };
}

export interface ComponentIndexEntry {
  name: string;
  parent: string | null;
  overview: boolean;
  featureFlag: boolean;
  /** JSON pointer within components.json */
  pointer: string;
}

export function parseComponentIndex(jsonText: string): ComponentIndexEntry[] {
  const data = JSON.parse(jsonText) as { components?: Record<string, unknown>[] };
  return (data.components ?? []).flatMap((c, i) => {
    const name = typeof c.component === "string" ? c.component.trim() : "";
    if (!name) return [];
    return [
      {
        name,
        parent: typeof c.parentComponent === "string" ? c.parentComponent.trim() : null,
        overview: c.overview !== false,
        featureFlag: c.featureFlag === true,
        pointer: `/components/${i}`,
      },
    ];
  });
}

export function parseSitemapLocs(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]!.replace(/&amp;/g, "&"));
}
