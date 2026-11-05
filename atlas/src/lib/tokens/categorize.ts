/**
 * Token categorisation with finer rules than tree.ts inferTokenCategory (pure; never throws).
 *
 * categorizeToken(name, type, value) -> { category, subcategory, explicit, confidence, rule }
 *  - explicit=true only when a declared $type maps unambiguously to a category (DTCG or Tokens Studio type).
 *  - Ambiguous declared types ("dimension", "number", "string", "other") are refined by name, then value.
 *  - Name rules run most-specific first: line-height and letter-spacing are typography (not spacing),
 *    z-index is elevation, breakpoints/containers are layout, border/stroke/outline widths are shape,
 *    opacity is opacity, durations/easings are motion.
 * Every non-explicit result is a heuristic: callers must store it as "inferred".
 */
import type { TokenCategory } from "@/lib/contracts";
import { isAlphaColorObject, isColorValue, isDtcgColorObject } from "./color";
import { isWholeReference } from "./refs";

export type TokenSubcategory =
  | "color"
  | "gradient"
  | "fontFamily"
  | "fontSize"
  | "fontWeight"
  | "lineHeight"
  | "letterSpacing"
  | "paragraphSpacing"
  | "fontStyle"
  | "textCase"
  | "textDecoration"
  | "typography"
  | "spacing"
  | "sizing"
  | "radius"
  | "borderWidth"
  | "border"
  | "strokeStyle"
  | "shadow"
  | "zIndex"
  | "duration"
  | "easing"
  | "transition"
  | "breakpoint"
  | "container"
  | "grid"
  | "opacity";

export interface TokenCategorization {
  category: TokenCategory;
  subcategory: TokenSubcategory | null;
  /** True only when derived from a declared, unambiguous type. */
  explicit: boolean;
  /** Heuristic confidence 0..1 (1 for explicit types). */
  confidence: number;
  /** Machine-readable rule id, e.g. "type:color", "name:line-height", "value:color". */
  rule: string;
}

type Cat = [TokenCategory, TokenSubcategory | null];

/** Declared types with an unambiguous category (DTCG 2025 + Tokens Studio + Style Dictionary legacy). */
const EXPLICIT_TYPES: Record<string, Cat> = {
  color: ["color", "color"],
  gradient: ["color", "gradient"],
  fontfamily: ["typography", "fontFamily"],
  fontfamilies: ["typography", "fontFamily"],
  fontweight: ["typography", "fontWeight"],
  fontweights: ["typography", "fontWeight"],
  fontsize: ["typography", "fontSize"],
  fontsizes: ["typography", "fontSize"],
  lineheight: ["typography", "lineHeight"],
  lineheights: ["typography", "lineHeight"],
  letterspacing: ["typography", "letterSpacing"],
  paragraphspacing: ["typography", "paragraphSpacing"],
  typography: ["typography", "typography"],
  fontstyle: ["typography", "fontStyle"],
  textcase: ["typography", "textCase"],
  textdecoration: ["typography", "textDecoration"],
  duration: ["motion", "duration"],
  cubicbezier: ["motion", "easing"],
  transition: ["motion", "transition"],
  shadow: ["elevation", "shadow"],
  boxshadow: ["elevation", "shadow"],
  borderradius: ["shape", "radius"],
  borderwidth: ["shape", "borderWidth"],
  border: ["shape", "border"],
  strokestyle: ["shape", "strokeStyle"],
  opacity: ["opacity", "opacity"],
  spacing: ["spacing", "spacing"],
  sizing: ["spacing", "sizing"],
};

/** Normalise a token name into lower-case kebab segments: "fgColor.default" -> "fg-color.default". */
export function normalizeTokenName(name: string): string {
  return String(name ?? "")
    .replace(/^--/, "")
    .replace(/^\$/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .toLowerCase();
}

const B = "(?:^|[.\\-_/ ])";
const E = "(?:$|[.\\-_/ ])";
const w = (words: string) => new RegExp(`${B}(?:${words})${E}`);

/** Ordered name rules; first match wins. Patterns run on normalizeTokenName(name). */
const NAME_RULES: [RegExp, Cat, string, number][] = [
  // typography specifics first (they contain words like "spacing"/"size")
  [w("line-height|lineheight|leading"), ["typography", "lineHeight"], "name:line-height", 0.85],
  [w("letter-spacing|letterspacing|tracking|kerning"), ["typography", "letterSpacing"], "name:letter-spacing", 0.85],
  [w("paragraph-spacing|paragraph-indent"), ["typography", "paragraphSpacing"], "name:paragraph-spacing", 0.8],
  [w("font-size|fontsize|text-size|type-size"), ["typography", "fontSize"], "name:font-size", 0.85],
  [w("font-weight|fontweight|weight"), ["typography", "fontWeight"], "name:font-weight", 0.8],
  [w("font-family|fontfamily|typeface|font-stack"), ["typography", "fontFamily"], "name:font-family", 0.85],
  [w("text-transform|text-case"), ["typography", "textCase"], "name:text-case", 0.8],
  [w("text-decoration"), ["typography", "textDecoration"], "name:text-decoration", 0.8],
  // elevation / layering
  [w("z-index|zindex|z|layer-index|stack-order"), ["elevation", "zIndex"], "name:z-index", 0.85],
  // layout
  [w("breakpoint|breakpoints|bp|screen|screens|media|viewport"), ["layout", "breakpoint"], "name:breakpoint", 0.8],
  // "container" alone is ambiguous (Material: component container); require a width-ish word (see COMPOUND_RULES)
  [w("max-width|min-width|content-width|page-width|measure|max-inline-size"), ["layout", "container"], "name:container", 0.65],
  [w("grid|column|columns|gutter-width|col"), ["layout", "grid"], "name:grid", 0.6],
  // shape
  [w("border-width|borderwidth|stroke-width|outline-width|border-size|hairline|divider-width|focus-ring-width|ring-width"), ["shape", "borderWidth"], "name:border-width", 0.85],
  [w("radius|radii|rounded|rounding|corner|corners|border-radius|borderradius"), ["shape", "radius"], "name:radius", 0.85],
  [w("border-style|stroke-style|outline-style"), ["shape", "strokeStyle"], "name:stroke-style", 0.8],
  [w("shape|shapes"), ["shape", null], "name:shape", 0.6],
  // opacity
  [w("opacity|alpha|transparency"), ["opacity", "opacity"], "name:opacity", 0.8],
  // motion
  [w("easing|ease|curve|bezier|cubic-bezier|timing-function"), ["motion", "easing"], "name:easing", 0.8],
  [w("duration|durations|delay|time|timing"), ["motion", "duration"], "name:duration", 0.75],
  [w("transition|transitions|motion|animation|animations|animate|anim|keyframes"), ["motion", "transition"], "name:motion", 0.6],
  // elevation shadow (after "shadow-color" handled by color rule below)
  [w("shadow|shadows|elevation|drop-shadow|box-shadow|depth"), ["elevation", "shadow"], "name:shadow", 0.7],
  // bare border / outline / divider (shorthand values); color values were handled before this point
  [w("border|borders|outline|divider|separator"), ["shape", "border"], "name:border", 0.5],
  // spacing / sizing
  [w("space|spacing|spacer|gap|padding|pad|margin|inset|gutter|stack|inline|offset"), ["spacing", "spacing"], "name:spacing", 0.75],
  [w("size|sizes|sizing|width|height|dimension|icon-size|min-height|min-target|target-size|tap-target"), ["spacing", "sizing"], "name:sizing", 0.6],
  // generic typography (after specific rules; "font"/"type" also appear in compound names)
  [w("font|fonts|typography|typescale|type-scale|text-style|heading|headline|body|display|caption|title|label|overline|subtitle|eyebrow"), ["typography", "typography"], "name:typography", 0.5],
];

/** Color words; checked before shadow/border/typography rules because "shadow-color" or "text-color" are colors. */
const COLOR_NAME = w(
  "color|colour|colors|colours|fg|bg|background|foreground|fill|stroke|surface|palette|accent|brand|neutral|ink|scrim|tint|hue|primary-color|on-[a-z-]+|canvas|fg-color|bg-color|border-color|text-color|icon-color|outline-color|shadow-color|focus-color|link-color",
);
const COLOR_STRICT = w("color|colour|colors|colours|fg-color|bg-color|border-color|text-color|icon-color|outline-color|shadow-color|focus-color|link-color|fill|stroke-color|palette");

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const DURATION_VALUE = /^-?\d*\.?\d+(ms|s)$/i;

function byValue(value: unknown): [Cat, string, number] | null {
  if (value === null || value === undefined || isWholeReference(value)) return null;
  if (typeof value === "string") {
    const t = value.trim();
    if (isColorValue(t, { allowNonConcrete: false }) || /^(color-mix|light-dark)\(/i.test(t)) return [["color", "color"], "value:color", 0.85];
    if (/(linear|radial|conic)-gradient\(/i.test(t)) return [["color", "gradient"], "value:gradient", 0.85];
    if (DURATION_VALUE.test(t)) return [["motion", "duration"], "value:duration", 0.8];
    if (/^cubic-bezier\(|^steps\(|^(ease|ease-in|ease-out|ease-in-out|linear)$/i.test(t)) return [["motion", "easing"], "value:easing", 0.85];
    return null;
  }
  if (Array.isArray(value)) {
    if (value.length === 4 && value.every((x) => typeof x === "number")) return [["motion", "easing"], "value:cubic-bezier", 0.6];
    if (value.length && value.every((x) => isObj(x) && ("offsetX" in x || "x" in x) && ("offsetY" in x || "y" in x))) return [["elevation", "shadow"], "value:shadow", 0.85];
    if (value.length && value.every((x) => isObj(x) && "color" in x && "position" in x)) return [["color", "gradient"], "value:gradient", 0.85];
    return null;
  }
  if (isObj(value)) {
    if (isDtcgColorObject(value)) return [["color", "color"], "value:color-object", 0.9];
    if (isAlphaColorObject(value) && (isColorValue(value.value, { allowNonConcrete: false }) || isWholeReference(value.value))) return [["color", "color"], "value:alpha-color", 0.8];
    if (("offsetX" in value || "x" in value) && ("offsetY" in value || "y" in value)) return [["elevation", "shadow"], "value:shadow", 0.85];
    if (["fontFamily", "fontSize", "fontWeight", "lineHeight"].filter((k) => k in value).length >= 2) return [["typography", "typography"], "value:typography", 0.85];
    if ("duration" in value && "timingFunction" in value) return [["motion", "transition"], "value:transition", 0.85];
    if ("width" in value && "style" in value && "color" in value) return [["shape", "border"], "value:border", 0.85];
    const unit = (value as Record<string, unknown>).unit;
    if (typeof unit === "string" && /^(ms|s)$/i.test(unit)) return [["motion", "duration"], "value:duration", 0.8];
  }
  return null;
}

const result = (cat: Cat, explicit: boolean, confidence: number, rule: string): TokenCategorization => ({ category: cat[0], subcategory: cat[1], explicit, confidence, rule });

/** Categorise a token by declared type, name and value. */
export function categorizeToken(name: string, type: string | null | undefined, value?: unknown): TokenCategorization {
  try {
    const n = normalizeTokenName(typeof name === "string" ? name : "");
    const t = typeof type === "string" ? type.trim().toLowerCase().replace(/[\s_-]+/g, "") : "";
    const explicit = t ? EXPLICIT_TYPES[t] : undefined;
    if (explicit) {
      // Refine sizing/spacing types whose names say otherwise (Tokens Studio uses "sizing" for many things).
      if ((t === "spacing" || t === "sizing") && w("line-height|lineheight|leading").test(n)) return result(["typography", "lineHeight"], false, 0.8, "type+name:line-height");
      return result(explicit, true, 1, `type:${t}`);
    }
    const ambiguous = !t || ["dimension", "number", "string", "other", "text", "size", "float", "integer"].includes(t);
    if (!ambiguous && t) {
      // Unknown declared type: still try name/value but mark the rule.
      const r = byName(n, value) ?? byValueOnly(value);
      if (r) return { ...r, rule: `unknown-type:${t}+${r.rule}` };
      return result(["other", null], false, 0.2, `unknown-type:${t}`);
    }
    // Ambiguous or missing type.
    if (t === "dimension" || t === "number" || t === "size" || t === "float" || t === "integer") {
      const r = byName(n, value, true);
      if (r) return r;
      const v = byValueOnly(value);
      if (v && v.category !== "color") return v;
      if (t === "dimension" || t === "size") return result(["spacing", null], false, 0.3, "type:dimension-default");
      return result(["other", null], false, 0.2, `type:${t}-default`);
    }
    const v = byValue(value);
    // A color value is decisive; for other value kinds, a specific name rule can be more precise.
    if (v && v[0][0] === "color") return result(v[0], false, v[2], v[1]);
    const r = byName(n, value);
    if (r) {
      if (v && r.confidence < v[2] && v[0][0] !== r.category) return result(v[0], false, v[2], v[1]);
      return r;
    }
    if (v) return result(v[0], false, v[2], v[1]);
    return result(["other", null], false, 0.1, "fallback");
  } catch {
    return result(["other", null], false, 0, "error");
  }
}

function byValueOnly(value: unknown): TokenCategorization | null {
  const v = byValue(value);
  return v ? result(v[0], false, v[2], v[1]) : null;
}

/**
 * Compound concepts whose words may be spread over path segments ("size.font.small",
 * "border.width.thin", "--text-body-size"). Evaluated on the set of name words.
 */
const COMPOUND_RULES: [(has: (...w: string[]) => boolean) => boolean, Cat, string, number][] = [
  [(h) => (h("line") && h("height")) || h("leading", "lineheight"), ["typography", "lineHeight"], "name:line-height", 0.85],
  [(h) => (h("letter") && h("spacing")) || h("tracking", "kerning", "letterspacing"), ["typography", "letterSpacing"], "name:letter-spacing", 0.85],
  [(h) => h("paragraph") && h("spacing", "indent"), ["typography", "paragraphSpacing"], "name:paragraph-spacing", 0.8],
  [(h) => (h("z") && h("index")) || h("zindex") || (h("layer", "stack") && h("index", "order")), ["elevation", "zIndex"], "name:z-index", 0.85],
  [(h) => h("border", "stroke", "outline", "divider", "ring", "hairline") && h("width", "thickness", "weight"), ["shape", "borderWidth"], "name:border-width", 0.85],
  [(h) => h("thickness"), ["shape", "borderWidth"], "name:thickness", 0.7],
  [(h) => h("container", "content", "page", "layout") && h("width", "max", "min") && !h("border", "stroke", "outline"), ["layout", "container"], "name:container-width", 0.65],
  [(h) => h("border", "stroke", "outline") && h("style"), ["shape", "strokeStyle"], "name:stroke-style", 0.8],
  [(h) => h("font", "text", "type", "typography", "typescale", "fontsize") && h("size", "sizes", "fontsize"), ["typography", "fontSize"], "name:font-size", 0.8],
  [(h) => h("font", "text", "type", "typography", "typescale") && h("weight", "weights"), ["typography", "fontWeight"], "name:font-weight", 0.8],
  [(h) => h("font", "type", "typography", "typescale") && h("family", "families", "face", "stack"), ["typography", "fontFamily"], "name:font-family", 0.85],
];

/** T-shirt / numeric scale step words: xs, sm, md, lg, xl, 2xl, 3xs, base, 100... */
const STEP_WORD = /^(?:\d*x[sl]|xs|sm|md|lg|xl|base|\d+)$/;
const isIntegerValue = (v: unknown) => (typeof v === "number" && Number.isInteger(v)) || (typeof v === "string" && /^-?\d+$/.test(v.trim()));

/** Utility-framework scale conventions (Tailwind v4 theme variables, Open Props). Exact word shapes only. */
function byScaleConvention(words: string[], value: unknown): TokenCategorization | null {
  const [head, ...rest] = words;
  if (!head || !rest.length || !rest.every((x) => STEP_WORD.test(x))) return null;
  if (head === "container") return result(["layout", "container"], false, 0.6, "name:container-step");
  if (head === "text" && !isColorish(value)) return result(["typography", "fontSize"], false, 0.6, "name:text-step");
  if (head === "layer" && isIntegerValue(value)) return result(["elevation", "zIndex"], false, 0.6, "name:layer-step");
  return null;
}

const isColorish = (v: unknown) => typeof v === "string" && isColorValue(v, { allowNonConcrete: false });

function byName(n: string, value: unknown, nonColor = false): TokenCategorization | null {
  if (!n) return null;
  const conv = byScaleConvention(n.split(/[.\-_/ ]+/).filter(Boolean), value);
  if (conv) return conv;
  // Color words first (unless the type is a dimension/number, which can't be a color).
  if (!nonColor) {
    if (COLOR_STRICT.test(n)) return result(["color", "color"], false, 0.8, "name:color");
  }
  const words = new Set(n.split(/[.\-_/ ]+/).filter(Boolean));
  const has = (...ws: string[]) => ws.some((x) => words.has(x));
  for (const [test, cat, rule, conf] of COMPOUND_RULES) {
    if (test(has)) {
      if (!nonColor && typeof value === "string" && isColorValue(value, { allowNonConcrete: false })) return result(["color", "color"], false, 0.85, "value:color");
      return result(cat, false, conf, rule);
    }
  }
  for (const [re, cat, rule, conf] of NAME_RULES) {
    // Color-role words (bg, fg, surface, on-primary...) outrank the generic typography words (body, title...).
    if (!nonColor && rule === "name:typography" && COLOR_NAME.test(n)) return result(["color", "color"], false, 0.6, "name:color-role");
    if (re.test(n)) {
      // "shadow"/"border"/"text" names with a color-ish value are colors.
      if (!nonColor && cat[0] !== "color" && typeof value === "string" && isColorValue(value, { allowNonConcrete: false })) return result(["color", "color"], false, 0.85, "value:color");
      return result(cat, false, conf, rule);
    }
  }
  if (!nonColor && COLOR_NAME.test(n)) return result(["color", "color"], false, 0.6, "name:color-role");
  return null;
}
