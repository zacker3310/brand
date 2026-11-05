/**
 * Polaris React documentation content from the archived polaris.shopify.com site
 * (Shopify/polaris-react-archive: polaris.shopify.com/content/components/<category>/<slug>.mdx).
 * Frontmatter (title, shortDescription, category, status, examples, webComponent) and prose sections
 * are read statically; JSX blocks are skipped and no example code is read or stored.
 */
import type { Nodes, RootContent } from "mdast";
import type { KeyboardInteraction } from "@/lib/contracts";
import { ARIA_ROLES, LEGACY_DOCS_ORIGIN } from "./constants";
import { cleanText, linksOf, listItems, looksLikeJsx, paragraphs, parseMd, sectionsAt } from "./md";
import { clip, collapse } from "./text";

/* -------------------------------------------------------------------------- */
/* redirects.js                                                                */
/* -------------------------------------------------------------------------- */

export interface Redirect {
  source: string;
  destination: string;
}

/** `module.exports = [{ source: '…', destination: '…', permanent: true }, …]` read as data (never evaluated). */
export function parseRedirects(js: string): Redirect[] {
  const out: Redirect[] = [];
  const re = /source:\s*(['"])([^'"]+)\1\s*,\s*destination:\s*(['"])([^'"]+)\3/g;
  for (const m of js.matchAll(re)) out.push({ source: m[2]!, destination: m[4]! });
  return out;
}

const DOC_PATH = /^\/components\/[a-z0-9-]+\/[a-z0-9-]+$/;

/** Component doc paths ("/components/actions/button") named as redirect destinations. */
export function componentPathsFromRedirects(redirects: Redirect[]): string[] {
  const out = new Set<string>();
  for (const r of redirects) if (DOC_PATH.test(r.destination)) out.add(r.destination);
  return [...out].sort();
}

/** Site path of a docs link under /components/ (absolute polaris.shopify.com URL or site-relative), redirects not applied. */
export function componentSitePath(href: string): string | null {
  let p = href.trim();
  if (p.startsWith(LEGACY_DOCS_ORIGIN)) p = p.slice(LEGACY_DOCS_ORIGIN.length);
  else if (/^https?:\/\//.test(p)) return null;
  p = p.split("#")[0]!.split("?")[0]!.replace(/\/$/, "");
  return p.startsWith("/components/") ? p : null;
}

/** Normalize a docs link to a component doc path ("/components/<category>/<slug>"), following legacy redirects. */
export function componentPathFromLink(href: string, redirects: Map<string, string>): string | null {
  let p = componentSitePath(href);
  if (!p) return null;
  for (let i = 0; i < 3; i++) {
    const r = redirects.get(p);
    if (!r) break;
    p = r;
  }
  return DOC_PATH.test(p) ? p : null;
}

export const mdxFileForPath = (docPath: string) => `polaris.shopify.com/content${docPath}.mdx`;

/* -------------------------------------------------------------------------- */
/* Component MDX                                                               */
/* -------------------------------------------------------------------------- */

export interface ReactMdxExample {
  fileName: string;
  title: string;
  description: string | null;
}

export interface ReactMdxDoc {
  docPath: string;
  title: string;
  shortDescription: string | null;
  category: string | null;
  status: string | null;
  keywords: string[];
  webComponent: { name: string; url: string | null; type: string | null } | null;
  /** `<Props componentName="…">` when it names a component other than the title. */
  propsComponent: string | null;
  examples: ReactMdxExample[];
  lede: string | null;
  bestPractices: string[];
  /** "Related components" links: site paths before legacy redirects are applied (see componentPathFromLink). */
  related: { text: string; sitePath: string | null; url: string }[];
  /** Every /components/ site path linked from the page (pre-redirect; for discovery closure). */
  linkedPaths: string[];
  accessibility: {
    guidance: string | null;
    keyboard: KeyboardInteraction[];
    keyboardText: string | null;
    roles: string[];
    /** WAI-ARIA pattern the page says the component is based on ("based on the Aria 1.2 Listbox pattern"). */
    ariaPattern: string | null;
    headings: string[];
  } | null;
  sections: string[];
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? collapse(v) : null);

export function parseReactMdx(text: string, docPath: string): ReactMdxDoc {
  const { frontmatter: fm, body, tree } = parseMd(text);
  const wc = fm.webComponent as { name?: unknown; url?: unknown; type?: unknown } | undefined;
  const examples: ReactMdxExample[] = [];
  if (Array.isArray(fm.examples)) {
    for (const e of fm.examples as { fileName?: unknown; title?: unknown; description?: unknown }[]) {
      const fileName = str(e?.fileName);
      const title = str(e?.title);
      if (fileName && title && /^[\w.-]+\.(tsx|jsx|ts|js)$/.test(fileName)) examples.push({ fileName, title, description: str(e.description) });
    }
  }
  const propsMatch = /<Props\s+componentName=(?:"([A-Za-z.]+)"|\{\s*"([A-Za-z.]+)"\s*\})/.exec(body);
  const nodes = tree.children.filter((n) => !(n.type === "heading" && n.depth === 1));
  const h2 = sectionsAt(nodes, 2);
  const lede = paragraphs(h2[0]!.nodes)[0] ?? null;
  const doc: ReactMdxDoc = {
    docPath,
    title: str(fm.title) ?? docPath.split("/").pop()!,
    shortDescription: str(fm.shortDescription),
    category: str(fm.category),
    status: str(fm.status),
    keywords: Array.isArray(fm.keywords) ? (fm.keywords as unknown[]).map(str).filter((k): k is string => !!k) : [],
    webComponent: wc && str(wc.name) ? { name: str(wc.name)!, url: str(wc.url), type: str(wc.type) } : null,
    propsComponent: propsMatch ? (propsMatch[1] ?? propsMatch[2] ?? null) : null,
    examples,
    lede: lede && !/^\{/.test(lede) ? lede : null,
    bestPractices: [],
    related: [],
    linkedPaths: [],
    accessibility: null,
    sections: h2.slice(1).map((s) => s.heading),
  };
  const linked = new Set<string>();
  for (const l of linksOf(tree.children as Nodes[])) {
    const p = componentSitePath(l.url);
    if (p && p !== docPath) linked.add(p);
  }
  doc.linkedPaths = [...linked].sort();
  for (const s of h2.slice(1)) {
    const h = s.heading.toLowerCase();
    if (h === "best practices") {
      const intro = paragraphs(sectionsAt(s.nodes, 3)[0]!.nodes);
      const items = listItems(sectionsAt(s.nodes, 3)[0]!.nodes).map((x) => x.text);
      doc.bestPractices = [...intro.slice(0, 1), ...items].slice(0, 12);
    } else if (h === "related components") {
      for (const li of listItems(s.nodes)) {
        for (const l of linksOf(li.node)) {
          const sitePath = componentSitePath(l.url);
          if (sitePath === docPath) continue;
          doc.related.push({ text: clip(li.text, 200) ?? l.text, sitePath, url: l.url });
        }
      }
    } else if (h === "accessibility") {
      doc.accessibility = parseAccessibility(s.nodes, body);
    }
  }
  return doc;
}

/* ---------------------------- accessibility ------------------------------ */

const KEY_NAMES: Record<string, string> = {
  tab: "Tab",
  shift: "Shift",
  enter: "Enter",
  return: "Return",
  space: "Space",
  spacebar: "Space",
  esc: "Escape",
  escape: "Escape",
  home: "Home",
  end: "End",
  up: "ArrowUp",
  down: "ArrowDown",
  left: "ArrowLeft",
  right: "ArrowRight",
  "up arrow": "ArrowUp",
  "down arrow": "ArrowDown",
  "left arrow": "ArrowLeft",
  "right arrow": "ArrowRight",
  "arrow up": "ArrowUp",
  "arrow down": "ArrowDown",
  "arrow left": "ArrowLeft",
  "arrow right": "ArrowRight",
  "page up": "PageUp",
  "page down": "PageDown",
  delete: "Delete",
  backspace: "Backspace",
  ctrl: "Ctrl",
  control: "Ctrl",
  cmd: "Cmd",
  command: "Cmd",
  alt: "Alt",
  option: "Option",
};

export function keyName(raw: string): string {
  const k = collapse(raw).toLowerCase();
  return KEY_NAMES[k] ?? collapse(raw).replace(/^\w/, (c) => c.toUpperCase());
}

const ARROW_PHRASE = /\b(up|down|left|right)(?:\s*(?:and|or|\/|,)\s*(up|down|left|right))?\s+arrow\s+keys?\b/i;
const KEY_PHRASES: [RegExp, string][] = [
  [/\b(?:the\s+)?(?:esc|escape)\s+key\b/i, "Escape"],
  [/\b(?:the\s+)?tab\s+key\b/i, "Tab"],
  [/\b(?:the\s+)?(?:enter|return)\s+key\b/i, "Enter"],
  [/\b(?:the\s+)?(?:space\s*bar|space\s+key)\b/i, "Space"],
  [/\b(?:the\s+)?home\s+key\b/i, "Home"],
  [/\b(?:the\s+)?end\s+key\b/i, "End"],
];

/** Keys named by <kbd> elements in a list item's source; "+"-joined chords, "/"-joined alternatives. */
export function kbdKeys(src: string): string | null {
  const re = /<kbd>([^<]+)<\/kbd>/gi;
  const groups: string[] = [];
  let lastEnd = -1;
  for (const m of src.matchAll(re)) {
    const k = keyName(m[1]!);
    const between = lastEnd >= 0 ? src.slice(lastEnd, m.index) : null;
    if (between !== null && /^\s*\+\s*$/.test(between) && groups.length) groups[groups.length - 1] += `+${k}`;
    else if (between !== null && /^\s*\/\s*$/.test(between) && groups.length) groups[groups.length - 1] += ` / ${k}`;
    else groups.push(k);
    lastEnd = (m.index ?? 0) + m[0].length;
  }
  return groups.length ? groups.join(", ") : null;
}

/** Keys named in prose ("with the up and down arrow keys", "the escape key"). */
export function phraseKeys(text: string): string | null {
  const keys: string[] = [];
  const a = ARROW_PHRASE.exec(text);
  if (a) keys.push([a[1], a[2]].filter(Boolean).map((d) => KEY_NAMES[d!.toLowerCase()]!).join(" / "));
  for (const [re, k] of KEY_PHRASES) if (re.test(text) && !keys.includes(k)) keys.push(k);
  return keys.length ? keys.join(", ") : null;
}

const ROLE_RE = /\brole(?:="|=\{?['"]|\s+of\s+[`"']?|\s+[`"'])([a-z]+)/gi;

function parseAccessibility(nodes: RootContent[], body: string): NonNullable<ReactMdxDoc["accessibility"]> {
  const subs = sectionsAt(nodes, 4);
  const lead = paragraphs(sectionsAt(subs[0]!.nodes, 3)[0]!.nodes);
  const leadItems = listItems(sectionsAt(subs[0]!.nodes, 3)[0]!.nodes).map((x) => x.text);
  const headings: string[] = [];
  const keyboard: KeyboardInteraction[] = [];
  const keyboardProse: string[] = [];
  const allText: string[] = [...lead, ...leadItems];
  const nonKeyboardText: string[] = [];
  const level3 = sectionsAt(nodes, 3);
  for (const s of level3.slice(1)) {
    headings.push(s.heading);
    const isKeyboard = /keyboard/i.test(s.heading);
    for (const n of s.nodes) {
      if (n.type === "paragraph") {
        const t = cleanText(n);
        if (!t || looksLikeJsx(t)) continue;
        allText.push(t);
        if (isKeyboard) keyboardProse.push(t);
        else nonKeyboardText.push(t);
      }
      if (n.type !== "list") continue;
      for (const li of n.children) {
        const t = cleanText(li);
        allText.push(t);
        if (!isKeyboard) nonKeyboardText.push(t);
        if (!isKeyboard) continue;
        const src = li.position ? body.slice(li.position.start.offset ?? 0, li.position.end.offset ?? 0) : t;
        const keys = kbdKeys(src) ?? phraseKeys(t);
        if (keys) keyboard.push({ keys, action: clip(t, 240)! });
      }
    }
  }
  const roles = new Set<string>();
  for (const t of allText) for (const m of t.matchAll(ROLE_RE)) if (ARIA_ROLES.has(m[1]!.toLowerCase())) roles.add(m[1]!.toLowerCase());
  let guidanceParts = [...lead, ...leadItems].filter(Boolean);
  if (!guidanceParts.length) guidanceParts = nonKeyboardText.filter(Boolean).slice(0, 4);
  let ariaPattern: string | null = null;
  for (const t of allText) {
    const m = /\bbased on the (?:WAI-)?ARIA(?:\s+\d+(?:\.\d+)*)?(?:\s+authoring practices)?\s+([a-z][a-z ]{1,30}?)\s+(?:design\s+)?pattern\b/i.exec(t);
    if (m) {
      ariaPattern = m[1]!.toLowerCase().trim().replace(/\s+/g, "-");
      break;
    }
  }
  return {
    ariaPattern,
    guidance: guidanceParts.length ? clip(guidanceParts.join(" "), 600) : null,
    keyboard,
    keyboardText: keyboardProse.length ? clip(keyboardProse.join(" "), 400) : null,
    roles: [...roles].sort(),
    headings,
  };
}
