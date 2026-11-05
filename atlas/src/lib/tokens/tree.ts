/**
 * Core token-tree utilities shared by adapters (foundational; token workstream may extend
 * but must keep these signatures stable).
 *
 * Supports DTCG ($value/$type/$description/$deprecated with group-level $type inheritance) and
 * legacy Style Dictionary trees (value/type/comment). References use the DTCG brace syntax
 * "{group.token}"; CSS var() references are handled in css.ts.
 */
import type { NormalizedToken, TokenCategory, TokenTier } from "@/lib/contracts";

export interface FlattenOptions {
  /** "dtcg" requires $value; "style-dictionary" accepts value; "auto" accepts both. */
  format?: "dtcg" | "style-dictionary" | "auto";
  /** Path prefix to prepend (e.g. ["base"]). */
  prefix?: string[];
  /** Separator for token names. */
  separator?: string;
  /** Location prefix for evidence (file path). JSON pointer is appended. */
  location?: string;
  /** Build css var name from path (e.g. p => `--${p.join("-")}`). */
  cssVar?: (path: string[]) => string | null;
}

export interface FlatToken {
  name: string;
  path: string[];
  type: string | null;
  rawValue: unknown;
  references: string[];
  description: string | null;
  deprecated: boolean;
  location: string | null;
  cssVar: string | null;
  extensions: Record<string, unknown> | null;
}

const REF_RE = /\{([^{}]+)\}/g;

/** Extract "{a.b.c}" references from any raw value (strings, arrays, objects). */
export function extractReferences(value: unknown): string[] {
  const out = new Set<string>();
  const visit = (v: unknown) => {
    if (typeof v === "string") {
      for (const m of v.matchAll(REF_RE)) if (m[1]) out.add(m[1].trim());
    } else if (Array.isArray(v)) v.forEach(visit);
    else if (v && typeof v === "object") Object.values(v as Record<string, unknown>).forEach(visit);
  };
  visit(value);
  return [...out];
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Flatten a DTCG / Style Dictionary token tree into flat tokens. Pure; never executes content. */
export function flattenTokenTree(tree: unknown, opts: FlattenOptions = {}): FlatToken[] {
  const format = opts.format ?? "auto";
  const sep = opts.separator ?? ".";
  const out: FlatToken[] = [];
  const walk = (node: unknown, path: string[], inheritedType: string | null, pointer: string) => {
    if (!isObj(node)) return;
    const hasDtcg = "$value" in node;
    const hasSd = !hasDtcg && format !== "dtcg" && "value" in node && looksLikeSdToken(node);
    const groupType = typeof node.$type === "string" ? (node.$type as string) : inheritedType;
    if (hasDtcg || hasSd) {
      const raw = hasDtcg ? node.$value : node.value;
      const type = (typeof node.$type === "string" ? node.$type : typeof node.type === "string" ? node.type : groupType) as string | null;
      const desc = (node.$description ?? node.description ?? node.comment ?? null) as string | null;
      const dep = node.$deprecated ?? node.deprecated ?? false;
      const fullPath = [...(opts.prefix ?? []), ...path];
      out.push({
        name: fullPath.join(sep),
        path: fullPath,
        type: type ?? null,
        rawValue: raw,
        references: extractReferences(raw),
        description: typeof desc === "string" ? desc : null,
        deprecated: dep === true || typeof dep === "string",
        location: opts.location ? `${opts.location}#${pointer || "/"}` : pointer || null,
        cssVar: opts.cssVar ? opts.cssVar(fullPath) : null,
        extensions: isObj(node.$extensions) ? (node.$extensions as Record<string, unknown>) : null,
      });
      return;
    }
    for (const [k, v] of Object.entries(node)) {
      if (k.startsWith("$")) continue;
      walk(v, [...path, k], groupType, `${pointer}/${k.replace(/~/g, "~0").replace(/\//g, "~1")}`);
    }
  };
  walk(tree, [], null, "");
  return out;
}

function looksLikeSdToken(node: Record<string, unknown>): boolean {
  const v = node.value;
  if (v === undefined) return false;
  // A Style Dictionary leaf has primitive value or composite object with known keys; a group named "value" is rare.
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean" || Array.isArray(v)) return true;
  if (isObj(v)) {
    const keys = Object.keys(v);
    return keys.some((k) => ["fontFamily", "fontSize", "fontWeight", "lineHeight", "color", "offsetX", "x", "blur", "spread", "width", "style", "duration"].includes(k));
  }
  return false;
}

const NAME_HINTS: [RegExp, TokenCategory][] = [
  [/(^|[.\-_/ ])(colou?r|bg|background|foreground|fg|border-?colou?r|fill|stroke|surface|text-?colou?r|palette|accent|brand|neutral|ink|icon-?colou?r|outline-?colou?r|scrim|shadow-?colou?r|link-?colou?r|focus-?colou?r)([.\-_/ ]|$)/i, "color"],
  [/(^|[.\-_/ ])(font|type|typography|text-?style|line-?height|letter-?spacing|tracking|leading|font-?weight|font-?size|font-?family|heading|body|display|caption|label-?(small|medium|large))([.\-_/ ]|$)/i, "typography"],
  [/(^|[.\-_/ ])(space|spacing|gap|padding|margin|inset|gutter|stack|size-?\d|layout-?\d)([.\-_/ ]|$)/i, "spacing"],
  [/(^|[.\-_/ ])(radius|radii|rounded|corner|border-?width|border-?radius|stroke-?width|outline-?width|shape)([.\-_/ ]|$)/i, "shape"],
  [/(^|[.\-_/ ])(shadow|elevation|z-?index|depth|layer)([.\-_/ ]|$)/i, "elevation"],
  [/(^|[.\-_/ ])(duration|easing|ease|motion|transition|animation|timing|delay|curve)([.\-_/ ]|$)/i, "motion"],
  [/(^|[.\-_/ ])(breakpoint|container|grid|viewport|screen|max-?width|min-?width|column)([.\-_/ ]|$)/i, "layout"],
  [/(^|[.\-_/ ])(opacity|alpha|transparency)([.\-_/ ]|$)/i, "opacity"],
];

const TYPE_TO_CATEGORY: Record<string, TokenCategory> = {
  color: "color",
  fontFamily: "typography",
  fontWeight: "typography",
  fontSize: "typography",
  lineHeight: "typography",
  letterSpacing: "typography",
  typography: "typography",
  fontStyle: "typography",
  textCase: "typography",
  textDecoration: "typography",
  duration: "motion",
  cubicBezier: "motion",
  transition: "motion",
  shadow: "elevation",
  borderRadius: "shape",
  borderWidth: "shape",
  border: "shape",
  strokeStyle: "shape",
  opacity: "opacity",
  spacing: "spacing",
  sizing: "spacing",
  gradient: "color",
};

const COLOR_VALUE = /^(#[0-9a-f]{3,8}|rgba?\(|hsla?\(|oklch\(|oklab\(|lab\(|lch\(|color\()/i;
const DURATION_VALUE = /^-?\d*\.?\d+(ms|s)$/i;

/** Infer token category. Returns category and whether it came from an explicit $type. */
export function inferTokenCategory(name: string, type: string | null, value: unknown): { category: TokenCategory; explicit: boolean } {
  if (type && TYPE_TO_CATEGORY[type]) {
    const byType = TYPE_TO_CATEGORY[type]!;
    // "dimension" is ambiguous: decide by name.
    return { category: byType, explicit: true };
  }
  if (type === "dimension" || type === "number") {
    for (const [re, cat] of NAME_HINTS) if (re.test(name) && cat !== "color") return { category: cat, explicit: false };
    return { category: type === "dimension" ? "spacing" : "other", explicit: false };
  }
  if (typeof value === "string") {
    if (COLOR_VALUE.test(value.trim())) return { category: "color", explicit: false };
    if (DURATION_VALUE.test(value.trim())) return { category: "motion", explicit: false };
    if (/cubic-bezier\(/i.test(value)) return { category: "motion", explicit: false };
  }
  for (const [re, cat] of NAME_HINTS) if (re.test(name)) return { category: cat, explicit: false };
  return { category: "other", explicit: false };
}

/** Infer tier (primitive/semantic/component). Always inferred unless the source declares it. */
export function inferTokenTier(name: string, isAlias: boolean): TokenTier | null {
  const n = name.toLowerCase();
  if (/(^|[.\-_/])(base|primitive|primitives|core|palette|ref|global|scale)([.\-_/]|$)/.test(n)) return "primitive";
  if (/(^|[.\-_/])(button|input|card|tooltip|tabs?|badge|avatar|dialog|modal|toast|menu|select|checkbox|radio|switch|slider|table|chip|banner|nav|header|popover|dropdown|link|label|overlay|progress|spinner|skeleton|toggle|textarea|field|pagination|breadcrumb|accordion|alert)([.\-_/]|$)/.test(n))
    return "component";
  if (/(^|[.\-_/])(sys|semantic|fg|bg|surface|text|border|interactive|status|danger|success|warning|critical|attention|accent|emphasis|muted|subtle|default|primary|secondary|on-)/.test(n))
    return "semantic";
  return isAlias ? "semantic" : null;
}

/** Convert FlatToken -> NormalizedToken using inference for category/tier. */
export function toNormalizedToken(t: FlatToken, overrides: Partial<NormalizedToken> = {}): NormalizedToken {
  const { category } = inferTokenCategory(t.name, t.type, t.rawValue);
  const isAlias = t.references.length > 0;
  return {
    name: t.name,
    path: t.path,
    cssVar: t.cssVar,
    type: t.type,
    category,
    tier: inferTokenTier(t.name, isAlias),
    tierState: "inferred",
    rawValue: t.rawValue,
    references: t.references,
    description: t.description ? t.description.slice(0, 600) : null,
    deprecated: t.deprecated,
    location: t.location,
    ...overrides,
  };
}
