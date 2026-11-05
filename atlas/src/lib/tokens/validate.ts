/**
 * Token value validation (pure; never throws).
 *
 * validateTokenValue(typeOrCategory, value) -> { ok, code?, message? }
 *  - ok:false means the value is malformed for its declared type (e.g. "#ggg" color, "12pxx" dimension).
 *  - ok:true with a code is an informational note: REFERENCE (contains unresolved refs; never invalid),
 *    UNEVALUATED (calc()/color-mix()/env()... valid syntax that ATLAS does not evaluate),
 *    NON_CONCRETE (currentColor, system colors), UNITLESS, NON_STANDARD_UNIT, UNCHECKED (unknown type).
 * Composite values (shadow, typography, border, transition, gradient) validate each present field;
 * fields that are references are skipped.
 */
import { colorValueKind, isAlphaColorObject, isDtcgColorObject, parseColor } from "./color";
import { hasReferences, isWholeReference } from "./refs";
import { parseDimension } from "./format";

export interface TokenValidationResult {
  ok: boolean;
  code?: TokenValidationCode;
  message?: string;
}

export type TokenValidationCode =
  | "EMPTY_VALUE"
  | "INVALID_COLOR"
  | "INVALID_DIMENSION"
  | "INVALID_UNIT"
  | "INVALID_DURATION"
  | "INVALID_CUBIC_BEZIER"
  | "INVALID_FONT_WEIGHT"
  | "INVALID_FONT_FAMILY"
  | "INVALID_NUMBER"
  | "INVALID_OPACITY"
  | "INVALID_SHADOW"
  | "INVALID_TYPOGRAPHY"
  | "INVALID_BORDER"
  | "INVALID_STROKE_STYLE"
  | "INVALID_TRANSITION"
  | "INVALID_GRADIENT"
  | "INVALID_TYPE"
  | "REFERENCE"
  | "UNEVALUATED"
  | "NON_CONCRETE"
  | "UNITLESS"
  | "NON_STANDARD_UNIT"
  | "UNCHECKED";

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const OK: TokenValidationResult = { ok: true };
const ok = (code?: TokenValidationCode, message?: string): TokenValidationResult => (code ? { ok: true, code, message } : OK);
const bad = (code: TokenValidationCode, message: string): TokenValidationResult => ({ ok: false, code, message });

/** Length units ATLAS accepts for dimensions (CSS + common native-platform units). */
export const LENGTH_UNITS = new Set([
  "px",
  "rem",
  "em",
  "%",
  "ch",
  "ex",
  "cap",
  "ic",
  "lh",
  "rlh",
  "vw",
  "vh",
  "vi",
  "vb",
  "vmin",
  "vmax",
  "svw",
  "svh",
  "lvw",
  "lvh",
  "dvw",
  "dvh",
  "cqw",
  "cqh",
  "cqi",
  "cqb",
  "cqmin",
  "cqmax",
  "pt",
  "pc",
  "in",
  "cm",
  "mm",
  "q",
  "dp",
  "sp",
  "fr",
]);
/** Units allowed by the DTCG 2025 dimension type. */
export const DTCG_DIMENSION_UNITS = new Set(["px", "rem"]);

const CSS_MATH_FN = /^(calc|min|max|clamp|env|round|mod|rem|abs|sign|sin|cos|tan|sqrt|pow|hypot|log|exp|attr)\(/i;
const CSS_WIDE = new Set(["inherit", "initial", "unset", "revert", "revert-layer"]);

/** SCSS variable / module references ("$x", "md-sys-color.$primary", "map.get($m, k)"): never literal values. */
const SCSS_REF = /(^|[\s(,])(?:[a-zA-Z_][\w-]*\.)?\$[a-zA-Z_-][\w-]*/;
const isScssRef = (v: unknown) => typeof v === "string" && SCSS_REF.test(v);
const isRef = (v: unknown) => ((typeof v === "string" || isObj(v)) && hasReferences(v)) || isScssRef(v);

function checkDimension(v: unknown, label = "dimension"): TokenValidationResult {
  if (typeof v === "number") return Number.isFinite(v) ? ok(v === 0 ? undefined : "UNITLESS", v === 0 ? undefined : `Unitless ${label}`) : bad("INVALID_DIMENSION", `Non-finite ${label}`);
  if (typeof v === "string") {
    const t = v.trim();
    if (!t) return bad("EMPTY_VALUE", `Empty ${label}`);
    if (isRef(t)) return ok("REFERENCE", "Contains a reference");
    if (CSS_MATH_FN.test(t)) return ok("UNEVALUATED", "CSS math function is not evaluated");
    if (CSS_WIDE.has(t.toLowerCase()) || ["auto", "none", "normal"].includes(t.toLowerCase())) return ok("NON_CONCRETE", `Keyword ${t}`);
    // Multi-value shorthands such as "4px 4px 0px 0px" (corner radii) are valid dimension lists.
    const parts = t.split(/\s+/);
    if (parts.length > 1 && parts.length <= 4) {
      for (const p of parts) {
        const r = checkDimension(p, label);
        if (!r.ok) return r;
      }
      return ok();
    }
    const d = parseDimension(t);
    if (!d) return bad("INVALID_DIMENSION", `Not a valid ${label}: ${t.slice(0, 40)}`);
    if (d.unit === "") return d.value === 0 ? ok() : ok("UNITLESS", `Unitless ${label}`);
    if (!LENGTH_UNITS.has(d.unit)) return bad("INVALID_UNIT", `Unknown unit "${d.unit}"`);
    return ok();
  }
  if (isObj(v)) {
    if (isRef(v)) return ok("REFERENCE", "Contains a reference");
    if (!("value" in v) || !("unit" in v)) return bad("INVALID_DIMENSION", `${label} object needs {value, unit}`);
    if (isRef(v.value) || isRef(v.unit)) return ok("REFERENCE", "Contains a reference");
    if (typeof v.value !== "number" || !Number.isFinite(v.value)) return bad("INVALID_DIMENSION", `${label} value must be a finite number`);
    if (typeof v.unit !== "string") return bad("INVALID_UNIT", "Unit must be a string");
    const u = v.unit.toLowerCase();
    if (!LENGTH_UNITS.has(u)) return bad("INVALID_UNIT", `Unknown unit "${v.unit}"`);
    if (!DTCG_DIMENSION_UNITS.has(u)) return ok("NON_STANDARD_UNIT", `DTCG dimensions allow px/rem; got ${v.unit}`);
    return ok();
  }
  return bad("INVALID_DIMENSION", `Not a valid ${label}`);
}

function checkColor(v: unknown): TokenValidationResult {
  if (isAlphaColorObject(v)) {
    if (!Number.isFinite(v.alpha) || v.alpha < 0 || v.alpha > 1) return bad("INVALID_COLOR", "Alpha must be within [0, 1]");
    return checkColor(v.value);
  }
  if (isRef(v)) return ok("REFERENCE", "Contains a reference");
  if (typeof v === "string") {
    const t = v.trim();
    if (!t) return bad("EMPTY_VALUE", "Empty color");
    const kind = colorValueKind(t);
    if (kind === "concrete") return ok();
    if (kind === "keyword" || kind === "system") return ok("NON_CONCRETE", `${t} has no static value`);
    if (kind === "unevaluated") return ok("UNEVALUATED", "Color function is not evaluated statically");
    return bad("INVALID_COLOR", `Not a parseable color: ${t.slice(0, 40)}`);
  }
  if (isDtcgColorObject(v)) {
    if (!Array.isArray(v.components) || v.components.length !== 3) return bad("INVALID_COLOR", "DTCG color needs 3 components");
    if (v.components.some((c) => c !== "none" && (typeof c !== "number" || !Number.isFinite(c)))) return bad("INVALID_COLOR", "Color components must be numbers or \"none\"");
    if (v.alpha !== undefined && (typeof v.alpha !== "number" || v.alpha < 0 || v.alpha > 1)) return bad("INVALID_COLOR", "Alpha must be within [0, 1]");
    return parseColor(v) ? ok() : bad("INVALID_COLOR", `Unsupported colorSpace "${String(v.colorSpace)}"`);
  }
  if (isObj(v) && typeof v.hex === "string") return parseColor(v.hex) ? ok() : bad("INVALID_COLOR", "Invalid hex");
  return bad("INVALID_COLOR", "Not a color value");
}

function checkDuration(v: unknown): TokenValidationResult {
  if (isRef(v)) return ok("REFERENCE", "Contains a reference");
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? ok("UNITLESS", "Unitless duration (ms assumed)") : bad("INVALID_DURATION", "Duration must be >= 0");
  if (typeof v === "string" && CSS_MATH_FN.test(v.trim())) return ok("UNEVALUATED", "CSS math function is not evaluated");
  const d = parseDimension(v);
  if (!d) return bad("INVALID_DURATION", "Not a valid duration");
  if (d.unit !== "ms" && d.unit !== "s") return bad("INVALID_UNIT", `Duration unit must be ms or s; got "${d.unit || "none"}"`);
  if (d.value < 0) return bad("INVALID_DURATION", "Duration must be >= 0");
  return ok();
}

const EASING_KEYWORDS = new Set(["linear", "ease", "ease-in", "ease-out", "ease-in-out", "step-start", "step-end"]);

function checkCubicBezier(v: unknown): TokenValidationResult {
  if (isRef(v)) return ok("REFERENCE", "Contains a reference");
  let nums: unknown[] | null = null;
  if (Array.isArray(v)) nums = v;
  else if (typeof v === "string") {
    const t = v.trim().toLowerCase();
    if (EASING_KEYWORDS.has(t) || /^steps\(|^linear\(/.test(t)) return ok();
    const m = /^cubic-bezier\(([^)]*)\)$/.exec(t);
    if (!m) return bad("INVALID_CUBIC_BEZIER", "Expected cubic-bezier(x1, y1, x2, y2), an easing keyword or 4 numbers");
    nums = m[1]!.split(",").map((x) => (x.trim() === "" ? NaN : Number(x.trim())));
  } else if (isObj(v) && ["x1", "y1", "x2", "y2"].every((k) => k in v)) nums = [v.x1, v.y1, v.x2, v.y2];
  if (!nums || nums.length !== 4) return bad("INVALID_CUBIC_BEZIER", "cubicBezier needs exactly 4 numbers");
  if (nums.some((n) => typeof n !== "number" || !Number.isFinite(n))) return bad("INVALID_CUBIC_BEZIER", "cubicBezier values must be finite numbers");
  const [x1, , x2] = nums as number[];
  if (x1! < 0 || x1! > 1 || x2! < 0 || x2! > 1) return bad("INVALID_CUBIC_BEZIER", "x1 and x2 must be within [0, 1]");
  return ok();
}

/** DTCG font-weight aliases (2025 spec table) plus CSS keywords. */
export const FONT_WEIGHT_KEYWORDS: Record<string, number | null> = {
  thin: 100,
  hairline: 100,
  "extra-light": 200,
  "ultra-light": 200,
  light: 300,
  normal: 400,
  regular: 400,
  book: 400,
  medium: 500,
  "semi-bold": 600,
  "demi-bold": 600,
  bold: 700,
  "extra-bold": 800,
  "ultra-bold": 800,
  black: 900,
  heavy: 900,
  "extra-black": 950,
  "ultra-black": 950,
  bolder: null,
  lighter: null,
};

/** Numeric weight for a fontWeight value (number, numeric string or keyword); null if unknown/relative. */
export function fontWeightToNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const t = v.trim().toLowerCase();
  if (/^\d+(\.\d+)?$/.test(t)) return Number(t);
  const key = t.replace(/[\s_]+/g, "-").replace(/^(semi|demi|extra|ultra)(?=[a-z])/, "$1-");
  const w = FONT_WEIGHT_KEYWORDS[key];
  return typeof w === "number" ? w : null;
}

function checkFontWeight(v: unknown): TokenValidationResult {
  if (isRef(v)) return ok("REFERENCE", "Contains a reference");
  if (typeof v === "number") return Number.isFinite(v) && v >= 1 && v <= 1000 ? ok() : bad("INVALID_FONT_WEIGHT", "fontWeight must be within 1..1000");
  if (typeof v === "string") {
    const t = v.trim().toLowerCase();
    if (/^\d+(\.\d+)?$/.test(t)) {
      const n = Number(t);
      return n >= 1 && n <= 1000 ? ok() : bad("INVALID_FONT_WEIGHT", "fontWeight must be within 1..1000");
    }
    const key = t.replace(/[\s_]+/g, "-").replace(/^(semi|demi|extra|ultra)(?=[a-z])/, "$1-");
    if (key in FONT_WEIGHT_KEYWORDS) return ok();
    if (CSS_WIDE.has(t)) return ok("NON_CONCRETE", `Keyword ${t}`);
    // Font-style suffixes like "Bold Italic" occur in Tokens Studio exports.
    if (/^(thin|hairline|extra ?light|ultra ?light|light|normal|regular|book|medium|semi ?bold|demi ?bold|bold|extra ?bold|ultra ?bold|black|heavy)\s+italic$/.test(t)) return ok();
    return bad("INVALID_FONT_WEIGHT", `Unknown fontWeight "${v.slice(0, 30)}"`);
  }
  return bad("INVALID_FONT_WEIGHT", "fontWeight must be a number or keyword");
}

function checkFontFamily(v: unknown): TokenValidationResult {
  if (isRef(v)) return ok("REFERENCE", "Contains a reference");
  if (typeof v === "string") return v.trim() ? ok() : bad("EMPTY_VALUE", "Empty fontFamily");
  if (Array.isArray(v)) {
    if (!v.length) return bad("INVALID_FONT_FAMILY", "Empty fontFamily list");
    return v.every((x) => typeof x === "string" && x.trim().length > 0) ? ok() : bad("INVALID_FONT_FAMILY", "fontFamily list must contain non-empty strings");
  }
  return bad("INVALID_FONT_FAMILY", "fontFamily must be a string or list of strings");
}

function checkNumber(v: unknown): TokenValidationResult {
  if (isRef(v)) return ok("REFERENCE", "Contains a reference");
  if (typeof v === "number") return Number.isFinite(v) ? ok() : bad("INVALID_NUMBER", "Non-finite number");
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v.trim()))) return ok();
  if (typeof v === "string" && CSS_MATH_FN.test(v.trim())) return ok("UNEVALUATED", "CSS math function is not evaluated");
  return bad("INVALID_NUMBER", "Not a number");
}

function checkOpacity(v: unknown): TokenValidationResult {
  if (isRef(v)) return ok("REFERENCE", "Contains a reference");
  let n: number | null = null;
  if (typeof v === "number") n = v;
  else if (typeof v === "string") {
    const t = v.trim();
    if (/^-?\d*\.?\d+%$/.test(t)) n = Number(t.slice(0, -1)) / 100;
    else if (t !== "" && Number.isFinite(Number(t))) n = Number(t);
  }
  if (n === null || !Number.isFinite(n)) return bad("INVALID_OPACITY", "Opacity must be a number or percentage");
  return n >= 0 && n <= 1 ? ok() : bad("INVALID_OPACITY", "Opacity must be within [0, 1] (0%..100%)");
}

function checkLineHeight(v: unknown): TokenValidationResult {
  if (isRef(v)) return ok("REFERENCE", "Contains a reference");
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? ok() : bad("INVALID_NUMBER", "lineHeight must be >= 0");
  if (typeof v === "string" && v.trim().toLowerCase() === "normal") return ok();
  const r = checkDimension(v, "lineHeight");
  return r.code === "UNITLESS" ? ok() : r;
}

const SHADOW_KEYS = ["color", "offsetX", "offsetY", "blur", "spread", "inset", "x", "y", "type"];

function checkShadowLayer(v: unknown, i: number | null): TokenValidationResult {
  const where = i === null ? "shadow" : `shadow layer ${i}`;
  if (isRef(v) && isWholeReference(v)) return ok("REFERENCE", "Contains a reference");
  if (typeof v === "string") {
    const t = v.trim();
    if (!t) return bad("EMPTY_VALUE", `Empty ${where}`);
    if (t.toLowerCase() === "none") return ok();
    if (isRef(t)) return ok("REFERENCE", "Contains a reference");
    // Lightweight CSS box-shadow check: at least two lengths per layer.
    const layers = t.split(/,(?![^(]*\))/);
    for (const layer of layers) {
      const lengths = layer.trim().split(/\s+/).filter((p) => parseDimension(p) !== null);
      if (lengths.length < 2) return bad("INVALID_SHADOW", `${where}: expected at least offset-x and offset-y lengths`);
    }
    return ok();
  }
  if (!isObj(v)) return bad("INVALID_SHADOW", `${where} must be an object or CSS shadow string`);
  const hasX = "offsetX" in v || "x" in v;
  const hasY = "offsetY" in v || "y" in v;
  if (!hasX || !hasY) return bad("INVALID_SHADOW", `${where} needs offsetX and offsetY`);
  if (!Object.keys(v).some((k) => SHADOW_KEYS.includes(k))) return bad("INVALID_SHADOW", `${where} has no shadow fields`);
  for (const k of ["offsetX", "offsetY", "blur", "spread", "x", "y"]) {
    if (!(k in v)) continue;
    const r = checkDimension(v[k], `${where}.${k}`);
    if (!r.ok) return { ok: false, code: "INVALID_SHADOW", message: r.message };
  }
  if ("color" in v) {
    const r = checkColor(v.color);
    if (!r.ok) return { ok: false, code: "INVALID_SHADOW", message: `${where}.color: ${r.message}` };
  }
  if ("inset" in v && typeof v.inset !== "boolean" && !isRef(v.inset)) return bad("INVALID_SHADOW", `${where}.inset must be boolean`);
  return ok();
}

function checkShadow(v: unknown): TokenValidationResult {
  if (Array.isArray(v)) {
    if (!v.length) return bad("INVALID_SHADOW", "Empty shadow list");
    for (let i = 0; i < v.length; i++) {
      const r = checkShadowLayer(v[i], i);
      if (!r.ok) return r;
    }
    return ok();
  }
  return checkShadowLayer(v, null);
}

function checkTypography(v: unknown): TokenValidationResult {
  if (isRef(v) && isWholeReference(v)) return ok("REFERENCE", "Contains a reference");
  if (typeof v === "string") return v.trim() ? ok("UNCHECKED", "Typography shorthand string is not parsed") : bad("EMPTY_VALUE", "Empty typography");
  if (!isObj(v)) return bad("INVALID_TYPOGRAPHY", "Typography must be an object");
  const known = ["fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing", "fontStyle", "textCase", "textDecoration", "paragraphSpacing", "textTransform", "paragraphIndent"];
  if (!known.some((k) => k in v)) return bad("INVALID_TYPOGRAPHY", "Typography object has no typography fields");
  const checks: [string, (x: unknown) => TokenValidationResult][] = [
    ["fontFamily", checkFontFamily],
    ["fontSize", (x) => checkDimension(x, "fontSize")],
    ["fontWeight", checkFontWeight],
    ["lineHeight", checkLineHeight],
    ["letterSpacing", (x) => checkDimension(x, "letterSpacing")],
  ];
  for (const [k, fn] of checks) {
    if (!(k in v)) continue;
    const r = fn(v[k]);
    if (!r.ok) return { ok: false, code: "INVALID_TYPOGRAPHY", message: `${k}: ${r.message}` };
  }
  return ok();
}

const STROKE_KEYWORDS = new Set(["solid", "dashed", "dotted", "double", "groove", "ridge", "outset", "inset", "none", "hidden"]);

function checkStrokeStyle(v: unknown): TokenValidationResult {
  if (isRef(v)) return ok("REFERENCE", "Contains a reference");
  if (typeof v === "string") return STROKE_KEYWORDS.has(v.trim().toLowerCase()) ? ok() : bad("INVALID_STROKE_STYLE", `Unknown stroke style "${v.slice(0, 20)}"`);
  if (isObj(v) && Array.isArray(v.dashArray)) {
    for (const d of v.dashArray) {
      const r = checkDimension(d, "dashArray");
      if (!r.ok) return { ok: false, code: "INVALID_STROKE_STYLE", message: r.message };
    }
    if (v.lineCap !== undefined && !["round", "butt", "square"].includes(String(v.lineCap))) return bad("INVALID_STROKE_STYLE", "lineCap must be round, butt or square");
    return ok();
  }
  return bad("INVALID_STROKE_STYLE", "strokeStyle must be a keyword or {dashArray, lineCap}");
}

function checkBorder(v: unknown): TokenValidationResult {
  if (isRef(v) && isWholeReference(v)) return ok("REFERENCE", "Contains a reference");
  if (typeof v === "string") return v.trim() ? ok("UNCHECKED", "Border shorthand string is not parsed") : bad("EMPTY_VALUE", "Empty border");
  if (!isObj(v)) return bad("INVALID_BORDER", "Border must be an object");
  if (!("width" in v || "style" in v || "color" in v)) return bad("INVALID_BORDER", "Border needs color, width and style");
  if ("width" in v) {
    const r = checkDimension(v.width, "border width");
    if (!r.ok) return { ok: false, code: "INVALID_BORDER", message: r.message };
  }
  if ("color" in v) {
    const r = checkColor(v.color);
    if (!r.ok) return { ok: false, code: "INVALID_BORDER", message: `color: ${r.message}` };
  }
  if ("style" in v) {
    const r = checkStrokeStyle(v.style);
    if (!r.ok) return { ok: false, code: "INVALID_BORDER", message: r.message };
  }
  return ok();
}

function checkTransition(v: unknown): TokenValidationResult {
  if (isRef(v) && isWholeReference(v)) return ok("REFERENCE", "Contains a reference");
  if (typeof v === "string") return v.trim() ? ok("UNCHECKED", "Transition shorthand string is not parsed") : bad("EMPTY_VALUE", "Empty transition");
  if (!isObj(v)) return bad("INVALID_TRANSITION", "Transition must be an object");
  if (!("duration" in v || "timingFunction" in v)) return bad("INVALID_TRANSITION", "Transition needs duration and timingFunction");
  for (const [k, fn] of [
    ["duration", checkDuration],
    ["delay", checkDuration],
    ["timingFunction", checkCubicBezier],
  ] as const) {
    if (!(k in v)) continue;
    const r = fn(v[k]);
    if (!r.ok) return { ok: false, code: "INVALID_TRANSITION", message: `${k}: ${r.message}` };
  }
  return ok();
}

function checkGradient(v: unknown): TokenValidationResult {
  if (isRef(v) && isWholeReference(v)) return ok("REFERENCE", "Contains a reference");
  if (typeof v === "string") return /gradient\(/i.test(v) ? ok("UNCHECKED", "CSS gradient string is not parsed") : bad("INVALID_GRADIENT", "Not a gradient");
  if (!Array.isArray(v) || !v.length) return bad("INVALID_GRADIENT", "Gradient must be a non-empty list of stops");
  for (const s of v) {
    if (!isObj(s) || !("color" in s)) return bad("INVALID_GRADIENT", "Each gradient stop needs a color");
    const c = checkColor(s.color);
    if (!c.ok) return { ok: false, code: "INVALID_GRADIENT", message: `stop color: ${c.message}` };
    if ("position" in s && !isRef(s.position) && (typeof s.position !== "number" || s.position < 0 || s.position > 1)) return bad("INVALID_GRADIENT", "Stop position must be within [0, 1]");
  }
  return ok();
}

function checkByCategory(category: string, v: unknown): TokenValidationResult | null {
  switch (category) {
    case "color":
      return isObj(v) && !isDtcgColorObject(v) && !isAlphaColorObject(v) && typeof v.hex !== "string" ? ok("UNCHECKED", "Composite color-category value") : checkColor(v);
    case "spacing":
    case "layout":
      return isObj(v) && !("unit" in v) ? ok("UNCHECKED", "Composite value") : checkDimension(v);
    case "motion":
    case "typography":
    case "shape":
    case "elevation":
    case "other":
      return ok("UNCHECKED", `Category "${category}" covers several value types`);
    case "opacity":
      return checkOpacity(v);
    default:
      return null;
  }
}

/**
 * Validate a raw or resolved token value against a DTCG $type (or Tokens Studio type, or an ATLAS
 * category). Unknown types return {ok:true, code:"UNCHECKED"}. References are never invalid.
 */
export function validateTokenValue(typeOrCategory: string | null | undefined, value: unknown): TokenValidationResult {
  try {
    if (value === null || value === undefined) return bad("EMPTY_VALUE", "Token has no value");
    if (typeof value === "string" && value.trim() === "") return bad("EMPTY_VALUE", "Token value is empty");
    if (isWholeReference(value)) return ok("REFERENCE", "Alias reference (not validated until resolved)");
    if (isScssRef(value)) return ok("REFERENCE", "SCSS variable reference (not evaluated)");
    const t = (typeOrCategory ?? "").trim();
    const key = t.toLowerCase().replace(/[\s_-]+/g, "");
    switch (key) {
      case "color":
        return checkColor(value);
      case "dimension":
      case "spacing":
      case "sizing":
      case "size":
      case "borderradius":
      case "borderwidth":
      case "fontsize":
      case "fontsizes":
      case "letterspacing":
      case "paragraphspacing":
      case "paragraphindent":
        return checkDimension(value);
      case "lineheight":
      case "lineheights":
        return checkLineHeight(value);
      case "duration":
        return checkDuration(value);
      case "cubicbezier":
      case "easing":
        return checkCubicBezier(value);
      case "fontweight":
      case "fontweights":
        return checkFontWeight(value);
      case "fontfamily":
      case "fontfamilies":
        return checkFontFamily(value);
      case "number":
        return checkNumber(value);
      case "opacity":
        return checkOpacity(value);
      case "shadow":
      case "boxshadow":
        return checkShadow(value);
      case "typography":
        return checkTypography(value);
      case "border":
        return checkBorder(value);
      case "strokestyle":
        return checkStrokeStyle(value);
      case "transition":
        return checkTransition(value);
      case "gradient":
        return checkGradient(value);
      case "boolean":
        return typeof value === "boolean" ? ok() : bad("INVALID_TYPE", "Expected a boolean");
      case "string":
      case "text":
      case "fontstyle":
      case "textcase":
      case "textdecoration":
        return typeof value === "string" ? ok() : bad("INVALID_TYPE", "Expected a string");
      case "":
        return ok("UNCHECKED", "No type declared");
    }
    const byCat = checkByCategory(key, value);
    if (byCat) return byCat;
    return ok("UNCHECKED", `Type "${t}" is not validated`);
  } catch {
    return ok("UNCHECKED", "Value could not be validated");
  }
}
