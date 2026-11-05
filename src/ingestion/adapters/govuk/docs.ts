/**
 * Parsers for docs sources of the GOV.UK Frontend family:
 *  - GOV.UK: alphagov/govuk-design-system Markdown pages, data/colours.json, the homepage template,
 *    sitemap.xml, and the GOV.UK Content API page for the Government Design Principles.
 *  - NHS: nhsuk/nhsuk-service-manual Nunjucks page templates (static HTML inside `{% block bodyContent %}`),
 *    design principles page, sitemap.xml.
 * Both page formats are reduced to one intermediate representation (DocIR) so the same extraction rules
 * apply. Pure functions: text in, JSON-serializable data out. Templates are never rendered.
 */
import * as cheerio from "cheerio";
import type { Nodes, RootContent } from "mdast";
import {
  clip,
  collapse,
  firstSentences,
  inlineCodes,
  introNodes,
  linksIn,
  ownNodes,
  parsePage,
  sections,
  splitSentences,
  stripNunjucks,
  textOf,
  type LinkRef,
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
  /** Sentence stating the component was withdrawn ("We no longer have a review date component."). */
  withdrawn: string | null;
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
const DOCS_HOST_RE = /^https?:\/\/(?:design-system\.service\.gov\.uk|service-manual\.nhs\.uk)/;

/**
 * "/components/text-input/#hint" -> { section: "components", slug: "text-input" };
 * NHS: "/design-system/components/buttons" -> { section: "components", slug: "buttons" }.
 */
export function docsLinkTarget(url: string): { section: string; slug: string } | null {
  const u = url.replace(DOCS_HOST_RE, "").replace(/^\/design-system(?=\/)/, "");
  const m = /^\/(components|patterns|styles)\/([a-z0-9-]+)\/?(?:[#?].*)?$/.exec(u);
  return m ? { section: m[1]!, slug: m[2]! } : null;
}

/* ------------------------------ intermediate form ----------------------------- */

export interface IrBlock {
  text: string;
  links: LinkRef[];
  codes: string[];
}

export interface IrSection {
  title: string;
  depth: number;
  parents: string[];
  /** Blocks before the next heading of any depth. */
  blocks: IrBlock[];
}

export interface DocIR {
  fm: Record<string, unknown>;
  intro: IrBlock[];
  sections: IrSection[];
  examples: DocExample[];
}

function mdBlocks(nodes: RootContent[]): IrBlock[] {
  const out: IrBlock[] = [];
  const visit = (n: Nodes) => {
    if (n.type === "paragraph") {
      const text = collapse(textOf(n));
      if (text) out.push({ text, links: linksIn([n]), codes: inlineCodes([n]) });
    } else if (n.type === "list") {
      for (const li of n.children) for (const c of li.children) visit(c);
    } else if (n.type === "blockquote") {
      for (const c of n.children) visit(c);
    }
  };
  (nodes as Nodes[]).forEach(visit);
  return out;
}

/** GOV.UK Markdown page -> DocIR. */
export function markdownToIR(text: string): DocIR {
  const page = parsePage(text);
  const secs = sections(page.tree);
  return {
    fm: page.frontmatter,
    intro: mdBlocks(introNodes(page.tree)),
    sections: secs.map((sec) => ({ title: sec.title, depth: sec.depth, parents: sec.parents, blocks: mdBlocks(ownNodes(sec)) })),
    examples: dedupeExamples(page.examples),
  };
}

const NJK_SET_RE = /\{%-?\s*set\s+([A-Za-z_][\w]*)\s*=\s*(["'])((?:\\.|(?!\2).)*)\2\s*-?%\}/g;

/** `designExample({ group, item, type })` calls (NHS service manual). */
function findDesignExamples(text: string): { group: string | null; item: string | null; example: string; line: number }[] {
  const out: { group: string | null; item: string | null; example: string; line: number }[] = [];
  for (const m of text.matchAll(/\{\{-?\s*designExample\(\s*(\{[\s\S]*?\})\s*\)\s*-?\}\}/g)) {
    const arg = (k: string) => new RegExp(`\\b${k}\\s*:\\s*(["'])([^"']*)\\1`).exec(m[1]!)?.[2] ?? null;
    const example = arg("type") ?? arg("example");
    if (!example) continue;
    out.push({ group: arg("group"), item: arg("item"), example, line: text.slice(0, m.index).split("\n").length });
  }
  return out;
}

/**
 * NHS service manual page template -> DocIR. `{% set k = "v" %}` string assignments become front matter;
 * the static HTML of `{% block bodyContent %}` is read with cheerio after removing every Nunjucks tag.
 */
export function njkToIR(text: string): DocIR {
  const fmv: Record<string, unknown> = {};
  for (const m of text.matchAll(NJK_SET_RE)) fmv[m[1]!] = m[3]!.replace(/\\(["'])/g, "$1");
  const body = /\{%-?\s*block\s+bodyContent\s*-?%\}([\s\S]*?)\{%-?\s*endblock\s*-?%\}/.exec(text)?.[1] ?? text;
  const calls = findDesignExamples(body);
  const html = stripNunjucks(body);
  const $ = cheerio.load(html, null, false);
  const intro: IrBlock[] = [];
  const secs: IrSection[] = [];
  const stack: { depth: number; title: string }[] = [];
  const headingsByLine: { line: number; title: string }[] = [];
  let current: IrSection | null = null;
  const block = (el: cheerio.Cheerio<never>): IrBlock | null => {
    const t = collapse(el.text());
    if (!t) return null;
    const links = el
      .find("a[href]")
      .toArray()
      .map((a) => ({ url: $(a).attr("href") ?? "", text: collapse($(a).text()) }));
    const codes = el
      .find("code")
      .toArray()
      .map((c) => collapse($(c).text()));
    return { text: t, links, codes };
  };
  const push = (b: IrBlock | null) => {
    if (!b) return;
    (current ? current.blocks : intro).push(b);
  };
  const lineOf = (needle: string) => {
    const i = html.indexOf(needle);
    return i < 0 ? 0 : html.slice(0, i).split("\n").length;
  };
  const walk = (nodes: cheerio.Cheerio<never>) => {
    nodes.each((_, n) => {
      const el = $(n as never) as cheerio.Cheerio<never>;
      const tag = ((n as { tagName?: string }).tagName ?? "").toLowerCase();
      const hm = /^h([2-4])$/.exec(tag);
      if (hm) {
        const depth = Number(hm[1]);
        const title = collapse(el.text());
        if (!title) return;
        while (stack.length && stack[stack.length - 1]!.depth >= depth) stack.pop();
        current = { title, depth, parents: stack.map((x) => x.title), blocks: [] };
        stack.push({ depth, title });
        secs.push(current);
        const id = el.attr("id");
        headingsByLine.push({ line: lineOf(id ? `id="${id}"` : title), title });
        return;
      }
      if (tag === "p") return push(block(el));
      if (tag === "ul" || tag === "ol") {
        el.children("li").each((__, li) => {
          const liEl = $(li as never) as cheerio.Cheerio<never>;
          const nested = liEl.children("ul,ol");
          if (nested.length) {
            const own = liEl.clone();
            own.children("ul,ol").remove();
            push(block(own as cheerio.Cheerio<never>));
            walk(nested as cheerio.Cheerio<never>);
          } else push(block(liEl));
        });
        return;
      }
      if (["table", "pre", "script", "style", "figure", "img", "svg", "iframe"].includes(tag)) return;
      if ((n as { type?: string }).type === "tag") walk(el.contents() as cheerio.Cheerio<never>);
    });
  };
  walk($.root().contents() as cheerio.Cheerio<never>);
  const examples = calls.map((c) => {
    let heading: string | null = null;
    // Example calls were removed from `html` with line structure preserved; compare by line.
    for (const h of headingsByLine) if (h.line && h.line <= c.line) heading = h.title;
    return { example: c.example, item: c.item, group: c.group, titleSuffix: null, heading };
  });
  return { fm: fmv, intro, sections: secs, examples: dedupeExamples(examples) };
}

const fmStr = (ir: DocIR, ...keys: string[]): string | null => {
  for (const k of keys) {
    const v = ir.fm[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
};
const fmList = (ir: DocIR, key: string): string[] => {
  const v = ir.fm[key];
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string" && !!x.trim()).map((x) => x.trim());
  return typeof v === "string" && v.trim() ? v.split(",").map((x) => x.trim()).filter(Boolean) : [];
};

function collectLinks(ir: DocIR): { components: DocLink[]; patterns: DocLink[] } {
  const components: DocLink[] = [];
  const patterns: DocLink[] = [];
  const add = (blocks: IrBlock[], section: string | null) => {
    const notToUse = !!section && /^when not to use\b/i.test(section);
    for (const b of blocks) {
      for (const l of b.links) {
        const t = docsLinkTarget(l.url);
        if (!t) continue;
        const list = t.section === "components" ? components : t.section === "patterns" ? patterns : null;
        if (!list || list.some((x) => x.slug === t.slug && x.section === section)) continue;
        const alternative = notToUse && ALTERNATIVE_RE.test(b.text);
        list.push(alternative ? { slug: t.slug, section, alternative } : { slug: t.slug, section });
      }
    }
  };
  add(ir.intro, null);
  for (const s of ir.sections) add(s.blocks, s.title);
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

/**
 * Sentences that lean on the previous one ("This causes problems for keyboard users.", "While screen
 * readers will read out the link text, ...") are kept together with it, so the excerpt keeps its
 * subject (infinite scroll, links in hint text) instead of reading as a claim about the component.
 */
const DEPENDENT_START_RE = /^(this|these|that|those|it|its|they|their|such|doing so|while|however|but|instead|otherwise|because|so|also)\b/i;

export function sentencesMatching(blocks: string[], re: RegExp, max: number): string[] {
  const out: string[] = [];
  for (const b of blocks) {
    const sentences = splitSentences(b);
    for (const [i, s] of sentences.entries()) {
      if (!re.test(s) || CALL_FOR_RESEARCH_RE.test(s)) continue;
      // Walk back over a chain of dependent sentences (at most two) to the one that names the subject.
      let start = i;
      while (start > 0 && i - start < 2 && DEPENDENT_START_RE.test(sentences[start]!)) start--;
      const prev = start < i ? sentences.slice(start, i).join(" ") : null;
      const withContext = prev && !out.some((x) => x.endsWith(prev)) ? `${prev} ${s}` : s;
      const c = clip(withContext, 400)!;
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

const texts = (blocks: IrBlock[]) => blocks.map((b) => b.text);

const sectionText = (ir: DocIR, re: RegExp, max = 400): string | null => {
  const s = ir.sections.find((x) => x.depth === 2 && re.test(x.title));
  if (!s) return null;
  return s.blocks.length ? firstSentences(texts(s.blocks).join(" "), max) : null;
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

const WHEN_TO_USE = /^when to use\b/i;
const WHEN_NOT_TO_USE = /^when not to use\b/i;
const HOW = /^how (it|they) works?\b|^how to use\b/i;
const RESEARCH = /^research\b/i;
const WITHDRAWN_RE = /\b(we )?no longer (have|recommend|support|maintain)\b[^.]*\bcomponent\b|\bthis component (has been|is) (deprecated|removed|retired)\b/i;

/** Build ComponentDoc from the intermediate representation (both page formats). */
export function componentDocFromIR(ir: DocIR): ComponentDoc {
  const introText = ir.intro[0]?.text ?? null;
  const fmDesc = fmStr(ir, "description", "pageDescription");
  const status = statusOf(ir.fm);
  const layout = fmStr(ir, "layout") ?? "";
  const links = collectLinks(ir);
  const allBlocks: { section: string | null; blocks: string[] }[] = [{ section: null, blocks: texts(ir.intro) }, ...ir.sections.map((s) => ({ section: s.title, blocks: texts(s.blocks) }))];
  const flat = allBlocks.flatMap((x) => x.blocks);
  const guidanceBlocks = allBlocks.filter((x) => !x.section || (!NON_GUIDANCE_SECTION_RE.test(x.section) && !ir.sections.find((sec) => sec.title === x.section)?.parents.some((p) => NON_GUIDANCE_SECTION_RE.test(p))));
  const gflat = guidanceBlocks.flatMap((x) => x.blocks);
  const a11ySections = guidanceBlocks.filter((x) => x.blocks.some((b) => A11Y_RE.test(b))).map((x) => x.section ?? "(intro)");
  const wcag = new Set<string>();
  for (const b of flat) for (const m of b.matchAll(WCAG_RE)) wcag.add(m[1]!);
  const joined = collapse(flat.join(" "));
  const lead = [fmDesc, introText].filter((x): x is string => !!x).flatMap((t) => splitSentences(t));
  const withdrawn = lead.find((x) => WITHDRAWN_RE.test(x)) ?? null;
  return {
    title: fmStr(ir, "title", "pageTitle"),
    description: fmDesc ? firstSentences(fmDesc, 280) : introText ? firstSentences(introText, 280) : null,
    descriptionFrom: fmDesc ? "frontmatter" : introText ? "intro" : null,
    aliases: fmList(ir, "aliases"),
    status: status.type,
    statusDate: status.date,
    archived: /archived/i.test(layout) || ir.fm.ignoreInSitemap === true,
    withdrawn: withdrawn ? clip(withdrawn, 280) : null,
    whenToUse: sectionText(ir, WHEN_TO_USE),
    whenNotToUse: sectionText(ir, WHEN_NOT_TO_USE),
    howItWorks: sectionText(ir, HOW),
    research: sectionText(ir, RESEARCH),
    errorMessages: sectionText(ir, /^error messages?$/i, 280),
    htmlAndNunjucks: /\byou can use HTML or\b[^.]*\bNunjucks\b/i.test(joined) || (/\busing Nunjucks\b/i.test(joined) && /\bFor HTML\b/i.test(joined)),
    sections: ir.sections.map((s) => ({
      title: s.title,
      depth: s.depth,
      parents: s.parents,
      firstParagraph: firstSentences(s.blocks[0]?.text ?? null, 280),
      codes: [...new Set(s.blocks.flatMap((b) => b.codes))],
    })),
    examples: ir.examples,
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

/** GOV.UK Markdown component page. */
export function parseComponentDoc(text: string): ComponentDoc {
  return componentDocFromIR(markdownToIR(text));
}

/** NHS service manual component page template. */
export function parseNhsComponentDoc(text: string): ComponentDoc {
  return componentDocFromIR(njkToIR(text));
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

export function patternDocFromIR(ir: DocIR): PatternDoc {
  const fmDesc = fmStr(ir, "description", "pageDescription");
  const introText = ir.intro[0]?.text ?? null;
  const layout = fmStr(ir, "layout") ?? "";
  const links = collectLinks(ir);
  const firstOf = (re: RegExp) => {
    const s = ir.sections.find((x) => re.test(x.title));
    if (!s) return null;
    return s.blocks.length ? firstSentences(texts(s.blocks).join(" "), 400) : null;
  };
  return {
    title: fmStr(ir, "title", "pageTitle"),
    description: fmDesc ? firstSentences(fmDesc, 280) : introText ? firstSentences(introText, 280) : null,
    theme: fmStr(ir, "theme"),
    aliases: fmList(ir, "aliases"),
    archived: /archived/i.test(layout) || ir.fm.ignoreInSitemap === true,
    whenToUse: firstOf(WHEN_TO_USE),
    whenNotToUse: firstOf(WHEN_NOT_TO_USE),
    howItWorks: firstOf(/^how (it|this pattern|they) works?\b|^how to use\b/i),
    research: firstOf(RESEARCH),
    headings: ir.sections.filter((s) => s.depth === 2).map((s) => s.title),
    examples: ir.examples,
    componentLinks: links.components,
    patternLinks: links.patterns,
  };
}

export const parsePatternDoc = (text: string): PatternDoc => patternDocFromIR(markdownToIR(text));
export const parseNhsPatternDoc = (text: string): PatternDoc => patternDocFromIR(njkToIR(text));

/* ------------------------------ lifecycle page ------------------------------- */

export interface LifecycleRules {
  /** Statuses listed on the page, e.g. ["Trial", "Stable"]. */
  statuses: string[];
  /** The page states that stable components carry no tag. */
  stableHasNoTag: boolean;
  stableExcerpt: string | null;
}

export function parseLifecyclePage(text: string): LifecycleRules {
  const ir = markdownToIR(text);
  const blocks = [...ir.intro, ...ir.sections.flatMap((x) => x.blocks)].map((b) => b.text);
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

/** Docs slugs per section from sitemap URLs ("<base>/components/<slug>/"), excluding sub-pages. */
export function sitemapSlugs(locs: string[], origin: string, basePath = ""): Record<"components" | "patterns" | "styles", string[]> {
  const out = { components: [] as string[], patterns: [] as string[], styles: [] as string[] };
  const prefix = `${origin}${basePath}`;
  for (const loc of locs) {
    if (!loc.startsWith(`${prefix}/`)) continue;
    const m = /^\/(components|patterns|styles)\/([a-z0-9-]+)\/?$/.exec(loc.slice(prefix.length));
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
  /** Page description (NHS design system landing page `pageDescription`). */
  description: string | null;
}

const stripTags = (html: string) =>
  collapse(html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&rsquo;/g, "’")).replace(/\s+([.,;:!?])/g, "$1");

/** src/index.njk: the "Principles we follow" block (static HTML inside the Nunjucks template). */
export function parseHome(text: string): HomeData {
  const m = /<h2[^>]*>\s*Principles we follow\s*<\/h2>([\s\S]*?)(?:<hr\b|<h2\b)/i.exec(text);
  if (!m) return { principlesText: null, principleLinks: [], description: null };
  const block = m[1]!;
  const firstP = /<p[^>]*>([\s\S]*?)<\/p>/i.exec(block);
  const links = [...block.matchAll(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)]
    .map((x) => ({ url: x[1]!, text: stripTags(x[2]!) }))
    .filter((l) => /^https:\/\//.test(l.url));
  return { principlesText: firstP ? clip(stripTags(firstP[1]!), 300) : null, principleLinks: links, description: null };
}

/** NHS design system landing page template: `{% set pageDescription = "..." %}`. */
export function parseNhsHome(text: string): HomeData {
  const ir = njkToIR(text);
  return { principlesText: null, principleLinks: [], description: fmStr(ir, "pageDescription") };
}

/** NHS design principles page template: `<h2 id="...">Principle</h2>` headings. */
export function parseNhsPrinciples(text: string): { title: string | null; updatedAt: string | null; principles: Principle[] } {
  const title = /\{%-?\s*set\s+pageTitle\s*=\s*"([^"]+)"/.exec(text)?.[1] ?? null;
  const body = /\{%-?\s*block\s+bodyContent\s*-?%\}([\s\S]*?)\{%-?\s*endblock\s*-?%\}/.exec(text)?.[1] ?? text;
  const principles: Principle[] = [];
  for (const m of stripNunjucks(body).matchAll(/<h2\b([^>]*)>([\s\S]*?)<\/h2>/gi)) {
    const anchor = /\sid="([^"]+)"/.exec(m[1]!)?.[1] ?? null;
    // Headings carry a visible number badge ("<span>1</span> Put people at the heart ...").
    const name = stripTags(m[2]!).replace(/^\d{1,2}\.?\s+/, "");
    if (name && !principles.some((p) => p.name === name)) principles.push({ name, anchor });
  }
  return { title, updatedAt: null, principles };
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
