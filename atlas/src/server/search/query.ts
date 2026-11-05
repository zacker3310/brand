/**
 * Query understanding. PURE: no I/O, deterministic, unit-tested (tests/unit/search/query.test.ts).
 *
 * Turns a raw SearchQuery into a ParsedQuery:
 *  - normalization (case, diacritics, punctuation, "-negation", "quoted phrases")
 *  - framework words (FRAMEWORK_QUERY_WORDS)             -> framework filter
 *  - entity intent ("tokens", "patterns", "design systems") -> entity-type filter (plural) / boost (singular)
 *  - theme words ("dark mode")                           -> theme filter on token docs
 *  - state words ("loading state", "disabled")           -> state facet boost
 *  - tag words ("government", "enterprise", "accessible") -> tag / hasA11y boosts
 *  - component / pattern type detection via taxonomy aliases -> boost (never a filter)
 *  - SEARCH_SYNONYMS expansion as lower-weight alternatives (never replaces the original words)
 *  - conservative typo correction against the taxonomy vocabulary, also only as an alternative
 *
 * Interpretive words are only *consumed* (removed from the required text) when something else
 * remains to search for; a query made only of interpretive words keeps them as text, so
 * "government" still has to match "government" and "react" still has to match "react".
 */
import type { SearchEntityType, SearchQuery } from "@/lib/contracts";
import {
  CANONICAL_STATES,
  COMPONENT_TYPES,
  FRAMEWORK_QUERY_WORDS,
  PATTERN_TYPES,
  SEARCH_SYNONYMS,
  normalizeName,
} from "@/lib/taxonomy";
import type { ParsedQuery, QueryUnit } from "./types";

/* -------------------------------------------------------------------------- */
/* Vocabulary                                                                  */
/* -------------------------------------------------------------------------- */

/** Words dropped from the required text. Deliberately small: no taxonomy alias appears here. */
export const STOPWORDS = new Set([
  "a", "an", "the", "with", "for", "of", "in", "on", "to", "and", "or", "that", "which", "using",
  "has", "have", "having", "show", "me", "all", "any", "by", "from", "is", "are", "be", "as", "at",
  "it", "its", "what", "how", "i", "my", "our", "need", "want", "looking", "some", "supports", "support",
]);

/** Framework words that are also ordinary words ("solid border", "css variables"): only
 * interpreted when the query is clearly about components or systems. */
const WEAK_FRAMEWORK_WORDS = new Set(["solid", "lit", "css", "html", "compose"]);

interface IntentDef {
  types: SearchEntityType[];
  /** Plural forms are a hard entity-type filter; singular forms only boost. */
  plural: boolean;
}
const SYSTEM_T: SearchEntityType[] = ["system"];
const TOKEN_T: SearchEntityType[] = ["token"];
const PATTERN_T: SearchEntityType[] = ["pattern", "pattern-type"];
const COMPONENT_T: SearchEntityType[] = ["component", "component-type"];

export const INTENT_WORDS: Record<string, IntentDef> = {
  "design systems": { types: SYSTEM_T, plural: true },
  systems: { types: SYSTEM_T, plural: true },
  "component libraries": { types: SYSTEM_T, plural: true },
  "ui libraries": { types: SYSTEM_T, plural: true },
  libraries: { types: SYSTEM_T, plural: true },
  "ui kits": { types: SYSTEM_T, plural: true },
  "design languages": { types: SYSTEM_T, plural: true },
  "design system": { types: SYSTEM_T, plural: false },
  system: { types: SYSTEM_T, plural: false },
  "component library": { types: SYSTEM_T, plural: false },
  "ui library": { types: SYSTEM_T, plural: false },
  library: { types: SYSTEM_T, plural: false },
  "ui kit": { types: SYSTEM_T, plural: false },
  "design language": { types: SYSTEM_T, plural: false },
  "pattern library": { types: SYSTEM_T, plural: false },
  tokens: { types: TOKEN_T, plural: true },
  "design tokens": { types: TOKEN_T, plural: true },
  token: { types: TOKEN_T, plural: false },
  "design token": { types: TOKEN_T, plural: false },
  patterns: { types: PATTERN_T, plural: true },
  "design patterns": { types: PATTERN_T, plural: true },
  "ux patterns": { types: PATTERN_T, plural: true },
  pattern: { types: PATTERN_T, plural: false },
  "design pattern": { types: PATTERN_T, plural: false },
  "ux pattern": { types: PATTERN_T, plural: false },
  components: { types: COMPONENT_T, plural: true },
  component: { types: COMPONENT_T, plural: false },
};

/** Theme phrases. `bare` entries only count when the query is about tokens. */
export const THEME_WORDS: Record<string, { theme: string; bare: boolean }> = {
  "dark mode": { theme: "dark", bare: false },
  "dark theme": { theme: "dark", bare: false },
  "dark themes": { theme: "dark", bare: false },
  darkmode: { theme: "dark", bare: false },
  "night mode": { theme: "dark", bare: false },
  "dark color scheme": { theme: "dark", bare: false },
  "light mode": { theme: "light", bare: false },
  "light theme": { theme: "light", bare: false },
  "high contrast": { theme: "high-contrast", bare: false },
  "high contrast mode": { theme: "high-contrast", bare: false },
  "high contrast theme": { theme: "high-contrast", bare: false },
  dark: { theme: "dark", bare: true },
  light: { theme: "light", bare: true },
};

/** Tag words -> candidate tag slugs to boost (never a filter). */
export const TAG_QUERY_WORDS: Record<string, { tags: string[]; a11y?: boolean }> = {
  government: { tags: ["government", "public-sector", "gov"] },
  gov: { tags: ["government", "public-sector", "gov"] },
  "public sector": { tags: ["government", "public-sector", "gov"] },
  enterprise: { tags: ["enterprise", "b2b"] },
  b2b: { tags: ["enterprise", "b2b"] },
  accessible: { tags: ["accessibility", "accessible", "a11y", "wcag"], a11y: true },
  accessibility: { tags: ["accessibility", "accessible", "a11y", "wcag"], a11y: true },
  a11y: { tags: ["accessibility", "accessible", "a11y", "wcag"], a11y: true },
};

/** State words recognised on their own. Others (e.g. "focus", "error", "active") only as "<x> state". */
const BARE_STATE_WORDS = new Set([
  "loading", "disabled", "hover", "hovered", "pressed", "readonly", "read only", "indeterminate",
  "selected", "checked", "expanded", "collapsed", "invalid", "dragging", "focused", "busy",
]);

const STATE_INDEX: Map<string, string> = (() => {
  const m = new Map<string, string>();
  for (const [canon, alts] of Object.entries(CANONICAL_STATES)) {
    m.set(normalizeWords(canon), canon);
    for (const a of alts) {
      const k = normalizeWords(a);
      if (k.length >= 2 && !m.has(k)) m.set(k, canon);
    }
  }
  return m;
})();

/** alias -> component type slugs (an alias may legitimately point at several types, e.g. "toggle"). */
const COMPONENT_ALIAS_INDEX: Map<string, Set<string>> = (() => {
  const m = new Map<string, Set<string>>();
  const add = (k: string, slug: string) => {
    const key = normalizeWords(k);
    if (!key) return;
    let s = m.get(key);
    if (!s) m.set(key, (s = new Set()));
    s.add(slug);
  };
  for (const ct of COMPONENT_TYPES) {
    add(ct.slug, ct.slug);
    add(ct.name, ct.slug);
    for (const a of ct.aliases) add(a, ct.slug);
  }
  return m;
})();

const PATTERN_ALIAS_INDEX: Map<string, Set<string>> = (() => {
  const m = new Map<string, Set<string>>();
  const add = (k: string, slug: string) => {
    const key = normalizeWords(k);
    if (!key) return;
    let s = m.get(key);
    if (!s) m.set(key, (s = new Set()));
    s.add(slug);
  };
  for (const p of PATTERN_TYPES) {
    add(p.slug, p.slug);
    add(p.name, p.slug);
    for (const a of p.aliases) add(a, p.slug);
  }
  return m;
})();

const COMPONENT_NAME_BY_SLUG = new Map(COMPONENT_TYPES.map((c) => [c.slug, normalizeWords(c.name)]));

const SYNONYM_INDEX: Map<string, string[][]> = (() => {
  const m = new Map<string, string[][]>();
  for (const [k, vs] of Object.entries(SEARCH_SYNONYMS)) {
    m.set(
      normalizeWords(k),
      vs.map((v) => splitWords(normalizeWords(v))).filter((w) => w.length > 0),
    );
  }
  return m;
})();

/** Single words known to ATLAS (taxonomy, synonyms, frameworks, states): typo-correction targets. */
const CORRECTION_VOCAB: Set<string> = (() => {
  const s = new Set<string>();
  const addAll = (phrase: string) => splitWords(normalizeWords(phrase)).forEach((w) => w.length >= 4 && s.add(w));
  for (const k of COMPONENT_ALIAS_INDEX.keys()) addAll(k);
  for (const k of PATTERN_ALIAS_INDEX.keys()) addAll(k);
  for (const [k, vs] of Object.entries(SEARCH_SYNONYMS)) [k, ...vs].forEach(addAll);
  Object.keys(FRAMEWORK_QUERY_WORDS).forEach(addAll);
  for (const [k, vs] of Object.entries(CANONICAL_STATES)) [k, ...vs].forEach(addAll);
  return s;
})();

const MAX_NGRAM = 4;
const MAX_ALTERNATIVES_PER_UNIT = 6;
const MAX_EXPANSIONS = 12;

/* -------------------------------------------------------------------------- */
/* Normalization helpers                                                       */
/* -------------------------------------------------------------------------- */

/** Lowercase, strip diacritics, turn separators into spaces, drop other punctuation. */
export function normalizeWords(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[_\-./\\:,;|+()[\]{}<>]+/g, " ")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function splitWords(s: string): string[] {
  return s ? s.split(" ").filter(Boolean) : [];
}

/** Naive English singular for matching dictionary entries ("tables" -> "table", "boxes" -> "box"). */
function singular(w: string): string {
  if (w.length > 4 && w.endsWith("ies")) return `${w.slice(0, -3)}y`;
  if (w.length > 4 && /(ses|xes|zes|ches|shes)$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}

function singularPhrase(words: string[]): string {
  if (!words.length) return "";
  return [...words.slice(0, -1), singular(words[words.length - 1]!)].join(" ");
}

/** Optimal string alignment distance (Damerau-Levenshtein with adjacent transpositions), capped. */
export function editDistance(a: string, b: string, cap = 3): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => {
    const row = new Array<number>(b.length + 1).fill(0);
    row[0] = i;
    return row;
  });
  for (let j = 0; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    let rowMin = Infinity;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2]![j - 2]! + 1);
      d[i]![j] = v;
      rowMin = Math.min(rowMin, v);
    }
    if (rowMin > cap) return cap + 1;
  }
  return d[a.length]![b.length]!;
}

/** Best typo correction for a word, or null. Conservative: long words only, distance 1 (2 if >= 9 chars). */
export function correctWord(w: string): string | null {
  if (w.length < 6 || /\d/.test(w) || CORRECTION_VOCAB.has(w) || CORRECTION_VOCAB.has(singular(w))) return null;
  const maxD = w.length >= 9 ? 2 : 1;
  let best: { word: string; d: number } | null = null;
  for (const v of CORRECTION_VOCAB) {
    if (Math.abs(v.length - w.length) > maxD) continue;
    const d = editDistance(w, v, maxD);
    if (d <= maxD && (!best || d < best.d || (d === best.d && v < best.word))) best = { word: v, d };
  }
  return best?.word ?? null;
}

/* -------------------------------------------------------------------------- */
/* Tokenization                                                                */
/* -------------------------------------------------------------------------- */

interface Word {
  w: string;
  /** Inside a "quoted phrase": never interpreted, kept verbatim as text. */
  quoted: boolean;
}

function tokenize(raw: string): { words: Word[]; negated: string[]; phrases: string[] } {
  const words: Word[] = [];
  const negated: string[] = [];
  const phrases: string[] = [];
  const re = /"([^"]*)"|(\S+)/g;
  for (const m of raw.matchAll(re)) {
    if (m[1] !== undefined) {
      const ws = splitWords(normalizeWords(m[1]));
      if (ws.length) {
        phrases.push(ws.join(" "));
        ws.forEach((w) => words.push({ w, quoted: true }));
      }
      continue;
    }
    const tok = m[2]!;
    // "-react" is a negation; "--color-fg" (a CSS custom property) is not.
    if (/^-[^-\s]/.test(tok)) {
      splitWords(normalizeWords(tok.slice(1))).forEach((w) => negated.push(w));
      continue;
    }
    splitWords(normalizeWords(tok.replace(/"/g, ""))).forEach((w) => words.push({ w, quoted: false }));
  }
  return { words, negated, phrases };
}

/* -------------------------------------------------------------------------- */
/* Interpretation                                                              */
/* -------------------------------------------------------------------------- */

type Interp =
  | { kind: "framework"; slug: string; weak: boolean }
  | { kind: "intent"; def: IntentDef }
  | { kind: "theme"; theme: string; bare: boolean }
  | { kind: "state"; state: string; textWords: string[] }
  | { kind: "tag"; key: string; tags: string[]; a11y: boolean }
  | { kind: "stop" };

interface Span {
  start: number;
  end: number; // exclusive
  words: string[];
  interp: Interp | null; // null = residual text
}

function lookupInterp(phrase: string, next: string | undefined): { interp: Interp; extra: number } | null {
  // "<state> state(s)" -> always a state
  if ((next === "state" || next === "states") && STATE_INDEX.has(phrase)) {
    return { interp: { kind: "state", state: STATE_INDEX.get(phrase)!, textWords: splitWords(phrase) }, extra: 1 };
  }
  const fw = FRAMEWORK_QUERY_WORDS[phrase];
  if (fw) return { interp: { kind: "framework", slug: fw, weak: WEAK_FRAMEWORK_WORDS.has(phrase) }, extra: 0 };
  const intent = INTENT_WORDS[phrase];
  if (intent) return { interp: { kind: "intent", def: intent }, extra: 0 };
  const theme = THEME_WORDS[phrase];
  if (theme) return { interp: { kind: "theme", theme: theme.theme, bare: theme.bare }, extra: 0 };
  const tag = TAG_QUERY_WORDS[phrase];
  if (tag) return { interp: { kind: "tag", key: phrase, tags: tag.tags, a11y: !!tag.a11y }, extra: 0 };
  if (BARE_STATE_WORDS.has(phrase) && STATE_INDEX.has(phrase))
    return { interp: { kind: "state", state: STATE_INDEX.get(phrase)!, textWords: splitWords(phrase) }, extra: 0 };
  if (STOPWORDS.has(phrase)) return { interp: { kind: "stop" }, extra: 0 };
  return null;
}

function scanSpans(words: Word[]): Span[] {
  const spans: Span[] = [];
  let i = 0;
  while (i < words.length) {
    if (words[i]!.quoted) {
      spans.push({ start: i, end: i + 1, words: [words[i]!.w], interp: null });
      i++;
      continue;
    }
    let matched: Span | null = null;
    for (let n = Math.min(MAX_NGRAM, words.length - i); n >= 1; n--) {
      const slice = words.slice(i, i + n);
      if (slice.some((x) => x.quoted)) continue;
      const phrase = slice.map((x) => x.w).join(" ");
      const next = words[i + n] && !words[i + n]!.quoted ? words[i + n]!.w : undefined;
      const hit = lookupInterp(phrase, next);
      if (hit) {
        const end = i + n + hit.extra;
        matched = { start: i, end, words: words.slice(i, end).map((x) => x.w), interp: hit.interp };
        break;
      }
    }
    if (matched) {
      spans.push(matched);
      i = matched.end;
    } else {
      spans.push({ start: i, end: i + 1, words: [words[i]!.w], interp: null });
      i++;
    }
  }
  return spans;
}

/** Greedy longest-match of dictionary phrases (with singular fallback) over a word list. */
function matchPhrases<T>(words: string[], lookup: (phrase: string) => T | undefined): { start: number; end: number; value: T }[] {
  const out: { start: number; end: number; value: T }[] = [];
  let i = 0;
  while (i < words.length) {
    let found: { start: number; end: number; value: T } | null = null;
    for (let n = Math.min(MAX_NGRAM, words.length - i); n >= 1; n--) {
      const slice = words.slice(i, i + n);
      const v = lookup(slice.join(" ")) ?? lookup(singularPhrase(slice));
      if (v !== undefined) {
        found = { start: i, end: i + n, value: v };
        break;
      }
    }
    if (found) {
      out.push(found);
      i = found.end;
    } else i++;
  }
  return out;
}

const uniq = <T>(xs: T[]): T[] => [...new Set(xs)];

/* -------------------------------------------------------------------------- */
/* parseQuery                                                                  */
/* -------------------------------------------------------------------------- */

export function parseQuery(input: Partial<SearchQuery> & { q?: string }): ParsedQuery {
  const raw = (input.q ?? "").trim();
  const { words, negated, phrases } = tokenize(raw);
  const normalized = words.map((w) => w.w).join(" ");
  const spans = scanSpans(words);

  const interps = spans.filter((s) => s.interp && s.interp.kind !== "stop");
  const hasTokenIntent = interps.some((s) => s.interp!.kind === "intent" && (s.interp as { def: IntentDef }).def.types.includes("token"));
  const hasStructuralIntent = interps.some(
    (s) => s.interp!.kind === "intent" && (s.interp as { def: IntentDef }).def.types.some((t) => t === "system" || t === "component"),
  );

  // Residual words (not interpreted, not stopwords), before deciding whether soft words are consumed.
  const residualSpans = spans.filter((s) => s.interp === null);
  const residualWordsPre = residualSpans.flatMap((s) => s.words);
  const hasComponentTypeInResidual = matchPhrases(residualWordsPre, (p) => COMPONENT_ALIAS_INDEX.get(p)).length > 0;

  // Resolve weak framework words and bare themes; unaccepted ones fall back to residual text.
  for (const s of spans) {
    const it = s.interp;
    if (!it) continue;
    if (it.kind === "framework" && it.weak && !(hasComponentTypeInResidual || hasStructuralIntent)) s.interp = null;
    else if (it.kind === "theme" && it.bare && !hasTokenIntent) s.interp = null;
  }

  const residualAfter = spans.filter((s) => s.interp === null).flatMap((s) => s.words);
  const softKinds = new Set(["framework", "tag", "state", "theme"]);
  const isSoft = (s: Span) =>
    !!s.interp &&
    (softKinds.has(s.interp.kind) || (s.interp.kind === "intent" && !s.interp.def.plural)) &&
    // Theme words are a hard filter on tokens when the query is about tokens: browse, don't re-add.
    !(s.interp.kind === "theme" && hasTokenIntent);

  // If nothing remains to search for, interpretive soft words become the text (still interpreted).
  const readded = new Set<Span>();
  if (residualAfter.length === 0) {
    for (const s of spans) if (isSoft(s)) readded.add(s);
  }

  /* ---- interpretation outputs ---- */
  const frameworks: string[] = [];
  const intentHard: SearchEntityType[] = [];
  const intentBoost: SearchEntityType[] = [];
  const themes: string[] = [];
  const states: string[] = [];
  const tags: string[] = [];
  const tagKeys: string[] = [];
  let accessibility = false;
  const softTerms: string[] = [];

  for (const s of spans) {
    const it = s.interp;
    if (!it || it.kind === "stop") continue;
    switch (it.kind) {
      case "framework":
        frameworks.push(it.slug);
        break;
      case "intent":
        intentBoost.push(...it.def.types);
        if (it.def.plural) intentHard.push(...it.def.types);
        break;
      case "theme":
        themes.push(it.theme);
        break;
      case "state":
        states.push(it.state);
        if (!readded.has(s)) softTerms.push(...it.textWords);
        break;
      case "tag":
        tags.push(...it.tags);
        tagKeys.push(it.key);
        if (it.a11y) accessibility = true;
        if (!readded.has(s)) softTerms.push(...splitWords(it.key));
        break;
    }
  }

  /* ---- text: residual + re-added soft words, in query order ---- */
  const textSpans = spans.filter((s) => s.interp === null || readded.has(s));
  const textWords: string[] = textSpans.flatMap((s) =>
    s.interp && s.interp.kind === "state" ? s.interp.textWords : s.words,
  );
  // A query of only stopwords / plural intents with no other signal: keep the words so it can't
  // silently turn into "browse everything".
  let terms = textWords;
  const hasHardInterp = intentHard.length > 0 || themes.length > 0;
  if (terms.length === 0 && words.length > 0 && !hasHardInterp && frameworks.length === 0) {
    terms = words.map((w) => w.w);
  }

  /* ---- type detection on the text ---- */
  const typeMatches = matchPhrases(terms, (p) => COMPONENT_ALIAS_INDEX.get(p));
  const componentTypes = uniq(typeMatches.flatMap((m) => [...m.value]));
  const patternTypes = uniq(matchPhrases(terms, (p) => PATTERN_ALIAS_INDEX.get(p)).flatMap((m) => [...m.value]));

  /* ---- units with synonym alternatives ---- */
  const units: QueryUnit[] = [];
  const synMatches = matchPhrases(terms, (p) => SYNONYM_INDEX.get(p));
  const relatedComponentTypes: string[] = [];
  const expansions: string[] = [];
  const addAlt = (unit: QueryUnit, alt: string[]) => {
    const key = alt.join(" ");
    if (!key || key === unit.words.join(" ") || key === singularPhrase(unit.words)) return;
    if (unit.alternatives.some((a) => a.join(" ") === key)) return;
    if (unit.alternatives.length >= MAX_ALTERNATIVES_PER_UNIT) return;
    unit.alternatives.push(alt);
    if (!expansions.includes(key) && expansions.length < MAX_EXPANSIONS) expansions.push(key);
    const ct = COMPONENT_ALIAS_INDEX.get(key);
    if (ct) for (const slug of ct) if (!componentTypes.includes(slug)) relatedComponentTypes.push(slug);
  };

  let i = 0;
  while (i < terms.length) {
    const syn = synMatches.find((m) => m.start === i);
    const typ = typeMatches.find((m) => m.start === i);
    // Prefer the longer dictionary span; both contribute alternatives when they coincide.
    const end = Math.max(syn?.end ?? i + 1, typ?.end ?? i + 1);
    const unit: QueryUnit = { words: terms.slice(i, end), alternatives: [] };
    if (syn && syn.end === end) syn.value.forEach((alt) => addAlt(unit, alt));
    if (typ && typ.end === end) {
      // canonical type name as an alternative when the user typed an alias ("lozenge" -> "tag")
      for (const slug of typ.value) {
        const name = COMPONENT_NAME_BY_SLUG.get(slug);
        if (name) addAlt(unit, splitWords(name));
      }
    }
    if (!syn && !typ && unit.words.length === 1) {
      const fixed = correctWord(unit.words[0]!);
      if (fixed) addAlt(unit, [fixed]);
    }
    units.push(unit);
    i = end;
  }
  // Soft-consumed tag words keep their synonyms as optional rank terms.
  for (const k of tagKeys) {
    if (readded.size) break;
    for (const alt of SYNONYM_INDEX.get(k) ?? []) softTerms.push(...alt);
  }

  /* ---- filters ---- */
  const explicitTypes = input.types?.length ? uniq(input.types) : null;
  const explicitFrameworks = input.frameworks?.length ? uniq(input.frameworks) : [];
  const interpretedFrameworks = uniq(frameworks);
  const allFrameworks = uniq([...explicitFrameworks, ...interpretedFrameworks]);
  const hardTypes = explicitTypes ?? (intentHard.length ? uniq(intentHard) : null);

  const interpretedFilters: Record<string, string[]> = {};
  if (interpretedFrameworks.length) interpretedFilters.frameworks = interpretedFrameworks;
  if (!explicitTypes && intentHard.length) interpretedFilters.types = uniq(intentHard);
  if (themes.length) interpretedFilters.theme = uniq(themes);
  if (componentTypes.length) interpretedFilters.componentTypes = componentTypes;
  if (patternTypes.length) interpretedFilters.patternTypes = patternTypes;
  if (states.length) interpretedFilters.states = uniq(states);
  if (tagKeys.length) interpretedFilters.tags = uniq(tagKeys.map((k) => (TAG_QUERY_WORDS[k]?.tags[0] ?? k)));
  if (accessibility) interpretedFilters.accessibility = ["documented"];
  if (phrases.length) interpretedFilters.phrases = phrases;
  if (negated.length) interpretedFilters.excluded = uniq(negated);

  const text = buildWebsearchText(terms, phrases);

  return {
    raw,
    normalized,
    text,
    units,
    terms,
    softTerms: uniq(softTerms.filter((w) => !terms.includes(w))),
    negated: uniq(negated),
    expansions,
    filters: {
      types: hardTypes,
      systems: input.systems?.length ? uniq(input.systems) : null,
      frameworks: allFrameworks.length ? allFrameworks : null,
      platforms: input.platforms?.length ? uniq(input.platforms) : null,
      categories: input.categories?.length ? uniq(input.categories) : null,
      themes: themes.length ? uniq(themes) : null,
    },
    boosts: {
      componentTypes,
      relatedComponentTypes: uniq(relatedComponentTypes),
      patternTypes,
      states: uniq(states),
      tags: uniq(tags),
      accessibility,
      themes: uniq(themes),
      entityTypes: uniq(intentBoost),
    },
    interpretedFilters,
    interpretedHard: {
      types: !explicitTypes && intentHard.length > 0,
      frameworks: interpretedFrameworks.some((f) => !explicitFrameworks.includes(f)),
      themes: themes.length > 0,
    },
    matchMode: "all",
    limit: input.limit ?? 20,
    offset: input.offset ?? 0,
  };
}

/** Text for websearch_to_tsquery: residual words, with user-quoted phrases kept quoted. */
function buildWebsearchText(terms: string[], phrases: string[]): string {
  if (!phrases.length) return terms.join(" ");
  let rest = ` ${terms.join(" ")} `;
  const quoted: string[] = [];
  for (const p of phrases) {
    if (rest.includes(` ${p} `)) {
      rest = rest.replace(` ${p} `, " ");
      quoted.push(`"${p}"`);
    }
  }
  return [...quoted, rest.trim()].filter(Boolean).join(" ");
}

/**
 * Relax interpreted hard filters (used when a query returns nothing): interpreted entity-type,
 * framework and theme filters become boosts only. Explicit filters are never relaxed.
 */
export function relaxInterpretedFilters(p: ParsedQuery, explicitFrameworks: string[] = []): ParsedQuery {
  const fw = p.filters.frameworks?.filter((f) => explicitFrameworks.includes(f)) ?? [];
  return {
    ...p,
    filters: {
      ...p.filters,
      types: p.interpretedHard.types ? null : p.filters.types,
      frameworks: p.interpretedHard.frameworks ? (fw.length ? fw : null) : p.filters.frameworks,
      themes: null,
    },
    interpretedHard: { types: false, frameworks: false, themes: false },
  };
}

export function hasInterpretedHardFilters(p: ParsedQuery): boolean {
  return p.interpretedHard.types || p.interpretedHard.frameworks || p.interpretedHard.themes;
}
