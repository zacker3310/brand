/**
 * Parsers for GOV.UK Design System docs sources (alphagov/govuk-design-system Markdown pages,
 * data/colours.json, the homepage template, sitemap.xml) and the GOV.UK Content API page for the
 * Government Design Principles. Pure functions: text in, JSON-serializable data out.
 */
import type { Nodes, RootContent } from "mdast";
import {
  clip,
  collapse,
  firstSentences,
  fm,
  inlineCodes,
  introNodes,
  linksIn,
  ownNodes,
  parsePage,
  proseBlocks,
  sections,
  splitSentences,
  textOf,
  type Section,
} from "./markdown";

/* ------------------------------- shared types ------------------------------ */

export interface DocExample {
  example: string;
  item: string | null;
  group: string | null;
  titleSuffix: string | null;
  heading: string | null;
}

export interface DocSectionSummary {
  title: string;
  depth: number;
  parents: string[];
  firstParagraph: string | null;
  /** Inline code values in the section's own nodes (e.g. "govuk-button--secondary"). */
  codes: string[];
}

export interface DocLink {
  slug: string;
  section: string | null;
  /** The link's paragraph suggests using the target instead ("use ... instead", "consider ..."). */
  alternative?: boolean;
}

export interface DocKeyboard {
  keys: string;
  action: string;
  section: string | null;
}

export interface ComponentDoc {
  title: string | null;
  description: string | null;
  descriptionFrom: "frontmatter" | "intro" | null;
  aliases: string[];
  /** Frontmatter `status.type` (e.g. "Trial"); null when the page has no status tag. */
  status: string | null;
  statusDate: string | null;
  archived: boolean;
  whenToUse: string | null;
  whenNotToUse: string | null;
  howItWorks: string | null;
  research: string | null;
  errorMessages: string | null;
  /** Page says it can be used as HTML or as a Nunjucks macro. */
  htmlAndNunjucks: boolean;
  sections: DocSectionSummary[];
  examples: DocExample[];
  componentLinks: DocLink[];
  patternLinks: DocLink[];
  a11y: { guidance: string[]; screenReader: string[]; focus: string[]; wcag: string[]; sections: string[] };
  keyboard: DocKeyboard[];
  responsive: string[];
}

export interface PatternDoc {
  title: string | null;
  description: string | null;
  theme: string | null;
  aliases: string[];
  archived: boolean;
  whenToUse: string | null;
  whenNotToUse: string | null;
  howItWorks: string | null;
  research: string | null;
  headings: string[];
  examples: DocExample[];
  componentLinks: DocLink[];
  patternLinks: DocLink[];
}

/* ---------------------------------- links ---------------------------------- */

const ALTERNATIVE_RE = /\binstead\b|\bconsider (using )?(a|an|the)\b|\buse (a|an|the) \[?[a-z]/i;
const DOCS_HOST_RE = /^https?:\/\/design-system\.service\.gov\.uk/;

/** "/components/text-input/#hint" -> { section: "components", slug: "text-input" } */
export function docsLinkTarget(url: string): { section: string; slug: string } | null {
  const u = url.replace(DOCS_HOST_RE, "");
  const m = /^\/(components|patterns|styles)\/([a-z0-9-]+)\/?(?:[#?].*)?$/.exec(u);
  return m ? { section: m[1]!, slug: m[2]! } : null;
}

function collectLinks(secs: Section[], intro: RootContent[]): { components: DocLink[]; patterns: DocLink[] } {
  const components: DocLink[] = [];
  const patterns: DocLink[] = [];
  const add = (nodes: RootContent[], section: string | null) => {
    const notToUse = !!section && /^when not to use\b/i.test(section);
    const visit = (block: Nodes) => {
      if (block.type === "paragraph" || block.type === "listItem") {
        const text = collapse(textOf(block));
        for (const l of linksIn([block])) {
          const t = docsLinkTarget(l.url);
          if (!t) continue;
          const list = t.section === "components" ? components : t.section === "patterns" ? patterns : null;
          if (!list || list.some((x) => x.slug === t.slug && x.section === section)) continue;
          const alternative = notToUse && ALTERNATIVE_RE.test(text);
          list.push(alternative ? { slug: t.slug, section, alternative } : { slug: t.slug, section });
        }
        return;
      }
      if ("children" in block && Array.isArray(block.children)) (block.children as Nodes[]).forEach(visit);
    };
    (nodes as Nodes[]).forEach(visit);
  };
  add(intro, null);
  for (const s of secs) add(ownNodes(s), s.title);
  return { components, patterns };
}

/* ------------------------------ text selections ----------------------------- */

const A11Y_RE = /\b(accessib\w*|assistive technolog\w*|screen readers?|keyboard|wcag|colour contrast|contrast ratio|voice control|speech recognition|screen magnif\w*|zoom)\b/i;
const SR_RE = /\bscreen readers?\b/i;
const FOCUS_RE = /\b(focus|focused)\b.*\b(move|moves|moved|receive|receives|set|sets|put|puts|shift|shifts|return|returns|goes|go|lands)\b|\b(move|moves|moved|set|sets|put|puts|return|returns)\b.*\bfocus\b/i;
const RESPONSIVE_RE = /\b(small(er)? screens?|screen sizes?|narrow screens?|mobile devices?|on mobile|breakpoints?|desktop|tablet|zoom(ed)? in|responsive)\b/i;
const WCAG_RE = /\b(?:success criteri(?:on|a)|\bSC)\s+(\d\.\d{1,2}\.\d{1,2})/gi;

const CALL_FOR_RESEARCH_RE = /\b(share (your|the|any) (findings|research|insight)|we need (to find out|more)|tell us|help improve|if your service has tested|let us know)\b/i;
const NON_GUIDANCE_SECTION_RE = /^(research\b|next steps|services using|help improve)/i;

function sentencesMatching(blocks: string[], re: RegExp, max: number): string[] {
  const out: string[] = [];
  for (const b of blocks) {
    for (const s of splitSentences(b)) {
      if (!re.test(s) || CALL_FOR_RESEARCH_RE.test(s)) continue;
      const c = clip(s, 400)!;
      if (!out.some((x) => x.toLowerCase() === c.toLowerCase())) out.push(c);
      if (out.length >= max) return out;
    }
  }
  return out;
}

const KEY_WORDS: [RegExp, string][] = [
  [/\bshift\b/i, "Shift"],
  [/\btab key\b|\bpress(?:es|ing)? (?:the )?tab\b/i, "Tab"],
  [/\benter key\b|\bpress(?:es|ing)? (?:the )?enter\b/i, "Enter"],
  [/\bspace ?bar\b|\bspace key\b/i, "Space"],
  [/\bescape key\b|\besc key\b|\bpress(?:es|ing)? (?:the )?(?:esc|escape)\b/i, "Escape"],
  [/\barrow keys?\b/i, "Arrow keys"],
];
const KEY_CONTEXT_RE = /\b(press(?:es|ed|ing)?|key presses|keyboard|key)\b/i;

/**
 * Documented keyboard interactions: sentences that name a key and describe pressing it. At most two
 * sentences per key set, preferring present-tense instructions ("press shift 3 times").
 */
export function keyboardSentences(blocksBySection: { section: string | null; blocks: string[] }[]): DocKeyboard[] {
  const found: (DocKeyboard & { score: number; order: number })[] = [];
  let order = 0;
  for (const { section, blocks } of blocksBySection) {
    for (const b of blocks) {
      for (const s of splitSentences(b)) {
        if (!KEY_CONTEXT_RE.test(s)) continue;
        const keys = KEY_WORDS.filter(([re]) => re.test(s)).map(([, k]) => k);
        if (!keys.length) continue;
        // "We considered ... the 'esc' key" style sentences describe rejected options, not behaviour.
        if (/\bconsidered\b|\bwe could not\b|\binstead of\b/i.test(s) && !/\bpress(?:es|ing)? shift\b/i.test(s)) continue;
        const action = firstSentences(s, 220)!;
        if (found.some((k) => k.action.toLowerCase() === action.toLowerCase())) continue;
        const score = /\bpress(es)?\b/i.test(s) ? 2 : /\buse (the )?\w+ key\b/i.test(s) ? 1.5 : 1;
        found.push({ keys: keys.join(" / "), action, section, score, order: order++ });
      }
    }
  }
  const byKeys = new Map<string, typeof found>();
  for (const f of found) byKeys.set(f.keys, [...(byKeys.get(f.keys) ?? []), f]);
  const kept = [...byKeys.values()].flatMap((g) => [...g].sort((a, b) => b.score - a.score || a.order - b.order).slice(0, 2));
  return kept
    .sort((a, b) => a.order - b.order)
    .slice(0, 10)
    .map(({ keys, action, section }) => ({ keys, action, section }));
}

/* ---------------------------- component doc pages --------------------------- */

const sectionText = (secs: Section[], re: RegExp, max = 400): { text: string | null; title: string | null } => {
  const s = secs.find((x) => x.depth === 2 && re.test(x.title));
  if (!s) return { text: null, title: null };
  const blocks = proseBlocks(ownNodes(s));
  return { text: blocks.length ? firstSentences(blocks.join(" "), max) : null, title: s.title };
};

function statusOf(frontmatter: Record<string, unknown>): { type: string | null; date: string | null } {
  const st = frontmatter.status;
  if (st && typeof st === "object" && !Array.isArray(st)) {
    const o = st as Record<string, unknown>;
    return { type: typeof o.type === "string" && o.type.trim() ? o.type.trim() : null, date: typeof o.date === "string" ? o.date : null };
  }
  if (typeof st === "string" && st.trim()) return { type: st.trim(), date: null };
  return { type: null, date: null };
}

export function parseComponentDoc(text: string): ComponentDoc {
  const page = parsePage(text);
  const secs = sections(page.tree);
  const intro = introNodes(page.tree);
  const introText = proseBlocks(intro)[0] ?? null;
  const fmDesc = fm.str(page, "description");
  const description = fmDesc ? firstSentences(fmDesc, 280) : introText ? firstSentences(introText, 280) : null;
  const status = statusOf(page.frontmatter);
  const layout = fm.str(page, "layout") ?? "";
  const links = collectLinks(secs, intro);
  const allBlocks: { section: string | null; blocks: string[] }[] = [
    { section: null, blocks: proseBlocks(intro, { ticks: false }) },
    ...secs.map((s) => ({ section: s.title, blocks: proseBlocks(ownNodes(s)) })),
  ];
  const flat = allBlocks.flatMap((x) => x.blocks);
  const guidanceBlocks = allBlocks.filter((x) => !x.section || !NON_GUIDANCE_SECTION_RE.test(x.section) && !secs.find((sec) => sec.title === x.section)?.parents.some((p) => NON_GUIDANCE_SECTION_RE.test(p)));
  const gflat = guidanceBlocks.flatMap((x) => x.blocks);
  const a11ySections = guidanceBlocks.filter((x) => x.blocks.some((b) => A11Y_RE.test(b))).map((x) => x.section ?? "(intro)");
  const wcag = new Set<string>();
  for (const b of flat) for (const m of b.matchAll(WCAG_RE)) wcag.add(m[1]!);
  const errorSec = sectionText(secs, /^error messages?$/i, 280);
  return {
    title: fm.str(page, "title"),
    description,
    descriptionFrom: fmDesc ? "frontmatter" : introText ? "intro" : null,
    aliases: fm.list(page, "aliases"),
    status: status.type,
    statusDate: status.date,
    archived: /archived/i.test(layout) || page.frontmatter.ignoreInSitemap === true,
    whenToUse: sectionText(secs, /^when to use\b/i).text,
    whenNotToUse: sectionText(secs, /^when not to use\b/i).text,
    howItWorks: sectionText(secs, /^how (it|they) works?\b/i).text,
    research: sectionText(secs, /^research\b/i).text,
    errorMessages: errorSec.text,
    htmlAndNunjucks: /\byou can use HTML or\b[^.]*\bNunjucks\b/i.test(collapse(flat.join(" "))),
    sections: secs.map((s) => ({
      title: s.title,
      depth: s.depth,
      parents: s.parents,
      firstParagraph: firstSentences(proseBlocks(ownNodes(s))[0] ?? null, 280),
      codes: [...new Set(inlineCodes(ownNodes(s)))],
    })),
    examples: dedupeExamples(page.examples),
    componentLinks: links.components,
    patternLinks: links.patterns,
    a11y: {
      guidance: sentencesMatching(gflat, A11Y_RE, 6),
      screenReader: sentencesMatching(gflat, SR_RE, 3),
      focus: sentencesMatching(gflat, FOCUS_RE, 3),
      wcag: [...wcag].sort(),
      sections: a11ySections,
    },
    keyboard: keyboardSentences(allBlocks),
    responsive: sentencesMatching(gflat, RESPONSIVE_RE, 3),
  };
}

function dedupeExamples(list: { example: string; item: string | null; group: string | null; titleSuffix: string | null; heading: string | null }[]): DocExample[] {
  const seen = new Set<string>();
  const out: DocExample[] = [];
  for (const e of list) {
    const k = `${e.group}|${e.item}|${e.example}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ example: e.example, item: e.item, group: e.group, titleSuffix: e.titleSuffix, heading: e.heading });
  }
  return out;
}

/* ------------------------------ pattern doc pages ---------------------------- */

export function parsePatternDoc(text: string): PatternDoc {
  const page = parsePage(text);
  const secs = sections(page.tree);
  const intro = introNodes(page.tree);
  const fmDesc = fm.str(page, "description");
  const introText = proseBlocks(intro)[0] ?? null;
  const layout = fm.str(page, "layout") ?? "";
  const links = collectLinks(secs, intro);
  const firstOf = (re: RegExp) => {
    const s = secs.find((x) => re.test(x.title));
    if (!s) return null;
    const blocks = proseBlocks(ownNodes(s));
    return blocks.length ? firstSentences(blocks.join(" "), 400) : null;
  };
  return {
    title: fm.str(page, "title"),
    description: fmDesc ? firstSentences(fmDesc, 280) : introText ? firstSentences(introText, 280) : null,
    theme: fm.str(page, "theme"),
    aliases: fm.list(page, "aliases"),
    archived: /archived/i.test(layout) || page.frontmatter.ignoreInSitemap === true,
    whenToUse: firstOf(/^when to use\b/i),
    whenNotToUse: firstOf(/^when not to use\b/i),
    howItWorks: firstOf(/^how (it|this pattern|they) works?\b|^how to use\b/i),
    research: firstOf(/^research\b/i),
    headings: secs.filter((s) => s.depth === 2).map((s) => s.title),
    examples: dedupeExamples(page.examples),
    componentLinks: links.components,
    patternLinks: links.patterns,
  };
}

/* ------------------------------ lifecycle page ------------------------------- */

export interface LifecycleRules {
  /** Statuses listed on the page, e.g. ["Trial", "Stable"]. */
  statuses: string[];
  /** The page states that stable components carry no tag. */
  stableHasNoTag: boolean;
  stableExcerpt: string | null;
}

export function parseLifecyclePage(text: string): LifecycleRules {
  const page = parsePage(text);
  const blocks = proseBlocks(page.tree.children);
  const statuses: string[] = [];
  let stableHasNoTag = false;
  let stableExcerpt: string | null = null;
  for (const b of blocks) {
    const m = /^([A-Z][a-z]+)\s+[-–]\s+these components\b(.*)$/.exec(b);
    if (!m) continue;
    statuses.push(m[1]!);
    if (/^stable$/i.test(m[1]!) && /\bdo not have a tag\b/i.test(m[2]!)) {
      stableHasNoTag = true;
      stableExcerpt = clip(b, 200);
    }
  }
  return { statuses, stableHasNoTag, stableExcerpt };
}

/** GOV.UK lifecycle label -> ATLAS lifecycle. "Trial" components may change substantially or be deprecated. */
export function lifecycleFromStatus(status: string | null): "stable" | "beta" | "experimental" | "deprecated" | "unknown" {
  if (!status) return "unknown";
  const s = status.toLowerCase();
  if (/deprecat|retired|archived/.test(s)) return "deprecated";
  if (/trial|beta/.test(s)) return "beta";
  if (/experimental|alpha/.test(s)) return "experimental";
  if (/stable/.test(s)) return "stable";
  return "unknown";
}

/* ---------------------------------- sitemap ---------------------------------- */

export function parseSitemapLocs(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]!.replace(/&amp;/g, "&"));
}

/** Docs slugs per section from sitemap URLs ("/components/<slug>/"), excluding sub-pages. */
export function sitemapSlugs(locs: string[], origin: string): Record<"components" | "patterns" | "styles", string[]> {
  const out = { components: [] as string[], patterns: [] as string[], styles: [] as string[] };
  for (const loc of locs) {
    if (!loc.startsWith(origin)) continue;
    const m = /^\/(components|patterns|styles)\/([a-z0-9-]+)\/$/.exec(loc.slice(origin.length));
    if (!m) continue;
    const list = out[m[1] as keyof typeof out];
    if (!list.includes(m[2]!)) list.push(m[2]!);
  }
  for (const k of Object.keys(out) as (keyof typeof out)[]) out[k].sort();
  return out;
}

/* ------------------------------- colours.json -------------------------------- */

export interface DocColour {
  name: string;
  group: string;
  colour: string | null;
  notes: string | null;
}

/** docs repo data/colours.json: { functional: { "<Group>": [{ name, colour, notes? }] }, ... } */
export function parseDocsColours(text: string): DocColour[] {
  const out: DocColour[] = [];
  try {
    const j = JSON.parse(text) as Record<string, unknown>;
    const fn = j.functional;
    if (!fn || typeof fn !== "object") return out;
    for (const [group, list] of Object.entries(fn as Record<string, unknown>)) {
      if (!Array.isArray(list)) continue;
      for (const c of list) {
        if (!c || typeof c !== "object") continue;
        const o = c as Record<string, unknown>;
        if (typeof o.name !== "string") continue;
        out.push({ name: o.name, group, colour: typeof o.colour === "string" ? o.colour.toLowerCase() : null, notes: typeof o.notes === "string" ? collapse(o.notes) : null });
      }
    }
  } catch {
    /* not JSON */
  }
  return out;
}

/* ---------------------------------- homepage --------------------------------- */

export interface HomeData {
  principlesText: string | null;
  principleLinks: { text: string; url: string }[];
}

const stripTags = (html: string) =>
  collapse(html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&rsquo;/g, "’")).replace(/\s+([.,;:!?])/g, "$1");

/** src/index.njk: the "Principles we follow" block (static HTML inside the Nunjucks template). */
export function parseHome(text: string): HomeData {
  const m = /<h2[^>]*>\s*Principles we follow\s*<\/h2>([\s\S]*?)(?:<hr\b|<h2\b)/i.exec(text);
  if (!m) return { principlesText: null, principleLinks: [] };
  const block = m[1]!;
  const firstP = /<p[^>]*>([\s\S]*?)<\/p>/i.exec(block);
  const links = [...block.matchAll(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)]
    .map((x) => ({ url: x[1]!, text: stripTags(x[2]!) }))
    .filter((l) => /^https:\/\//.test(l.url));
  return { principlesText: firstP ? clip(stripTags(firstP[1]!), 300) : null, principleLinks: links };
}

/* ------------------------------ GOV.UK principles ----------------------------- */

export interface Principle {
  name: string;
  anchor: string | null;
}

/** GOV.UK Content API JSON for /guidance/government-design-principles: numbered <h2 id> headings. */
export function parsePrinciplesApi(text: string): { title: string | null; updatedAt: string | null; principles: Principle[] } {
  try {
    const j = JSON.parse(text) as { title?: string; public_updated_at?: string; details?: { body?: string } };
    const body = j.details?.body ?? "";
    const principles: Principle[] = [];
    for (const m of body.matchAll(/<h2(?:\s+id="([^"]+)")?[^>]*>([\s\S]*?)<\/h2>/gi)) {
      const raw = stripTags(m[2]!);
      const n = /^(\d{1,2})\.\s+(.+)$/.exec(raw);
      if (!n) continue;
      principles.push({ name: n[2]!.trim(), anchor: m[1] ?? null });
    }
    return { title: typeof j.title === "string" ? j.title : null, updatedAt: typeof j.public_updated_at === "string" ? j.public_updated_at : null, principles };
  } catch {
    return { title: null, updatedAt: null, principles: [] };
  }
}

/* ---------------------------------- README ----------------------------------- */

/** govuk-frontend component README.md: title and the "Guidance and Examples" sentence. */
export function parseReadme(text: string): { title: string | null; guidance: string | null } {
  const title = /^#\s+(.+)$/m.exec(text)?.[1]?.trim() ?? null;
  const g = /##\s+Guidance and Examples\s*\n+([\s\S]*?)(?:\n##\s|$)/.exec(text)?.[1] ?? null;
  const guidance = g ? (splitSentences(collapse(g.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")))[0] ?? null) : null;
  return { title, guidance };
}
