/**
 * Display formatting for token values (pure; never throws).
 *
 * formatTokenValue(value, type) produces a concise, CSS-like display string for:
 *  colors (strings and DTCG 2025 color objects), dimensions ("16px" or DTCG {value, unit}),
 *  durations, cubicBezier arrays, shadows (single and layered), typography composites, borders,
 *  strokeStyle objects, transitions, gradients (stop arrays), fontFamily arrays, fontWeight, numbers.
 * Unknown objects fall back to compact JSON (truncated). References are shown as authored.
 *
 * dimensionToPx(value, {remBase}) converts px/rem/em/pt (and DTCG dimension objects) to px numbers.
 */
import { isDtcgColorObject, toCssColor, toHex, toOklchString } from "./color";

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

export interface FormatOptions {
  /** "as-authored" (default) keeps color strings unchanged; "hex"/"oklch" convert parseable colors. */
  colorFormat?: "as-authored" | "hex" | "oklch";
  /** Max output length (default 240). Longer output is truncated with "…". */
  maxLength?: number;
}

/** Format a number without float noise (0.30000000000000004 -> "0.3"). */
export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  if (Number.isInteger(n)) return String(n);
  return String(parseFloat(n.toPrecision(10)));
}

const GENERIC_FAMILIES = new Set([
  "serif",
  "sans-serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-serif",
  "ui-sans-serif",
  "ui-monospace",
  "ui-rounded",
  "math",
  "emoji",
  "fangsong",
  "-apple-system",
  "blinkmacsystemfont",
  "inherit",
  "initial",
]);

/** ["Helvetica Neue", "Arial", "sans-serif"] -> "\"Helvetica Neue\", Arial, sans-serif". */
export function formatFontFamily(v: unknown): string | null {
  if (typeof v === "string") return v.trim();
  if (!Array.isArray(v)) return null;
  const parts = v
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    .map((f) => {
      const t = f.trim();
      if (/^["']/.test(t) || GENERIC_FAMILIES.has(t.toLowerCase()) || /^var\(|^\{/.test(t)) return t;
      return /\s/.test(t) ? `"${t}"` : t;
    });
  return parts.length ? parts.join(", ") : null;
}

/** Dimension / duration display: "16px", {value:16, unit:"px"} -> "16px", 16 -> "16". */
export function formatDimension(v: unknown): string | null {
  if (typeof v === "number") return formatNumber(v);
  if (typeof v === "string") return v.trim();
  if (isObj(v) && (typeof v.value === "number" || typeof v.value === "string") && typeof v.unit === "string") {
    return `${typeof v.value === "number" ? formatNumber(v.value) : v.value}${v.unit}`;
  }
  return null;
}

function formatColor(v: unknown, opts: FormatOptions): string | null {
  if (typeof v === "string") {
    const t = v.trim();
    if (opts.colorFormat === "hex") return toHex(t) ?? t;
    if (opts.colorFormat === "oklch") return toOklchString(t) ?? t;
    return t;
  }
  if (isDtcgColorObject(v) || (isObj(v) && typeof v.hex === "string")) {
    if (opts.colorFormat === "oklch") return toOklchString(v);
    if (opts.colorFormat === "hex") return toHex(v);
    const o = v as Record<string, unknown>;
    // Prefer authored hex fallback for sRGB; otherwise CSS serialization of the declared space.
    if (typeof o.hex === "string" && (o.colorSpace === undefined || o.colorSpace === "srgb")) {
      const alpha = typeof o.alpha === "number" ? o.alpha : 1;
      return alpha < 1 ? (toHex(v) ?? o.hex) : o.hex;
    }
    return toCssColor(v) ?? (typeof o.hex === "string" ? o.hex : null);
  }
  return null;
}

/** "cubic-bezier(0.4, 0, 0.2, 1)" from [0.4, 0, 0.2, 1]; strings returned as-is. */
export function formatCubicBezier(v: unknown): string | null {
  if (typeof v === "string") return v.trim();
  if (Array.isArray(v) && v.length === 4 && v.every((x) => typeof x === "number" || typeof x === "string")) {
    return `cubic-bezier(${v.map((x) => (typeof x === "number" ? formatNumber(x) : String(x))).join(", ")})`;
  }
  if (isObj(v) && ["x1", "y1", "x2", "y2"].every((k) => typeof v[k] === "number")) {
    return `cubic-bezier(${[v.x1, v.y1, v.x2, v.y2].map((x) => formatNumber(x as number)).join(", ")})`;
  }
  return null;
}

const isShadowObject = (v: unknown): v is Record<string, unknown> =>
  isObj(v) && ("offsetX" in v || "offsetY" in v || "x" in v || "y" in v || "blur" in v || ("color" in v && "spread" in v));

function formatOneShadow(v: unknown, opts: FormatOptions): string | null {
  if (typeof v === "string") return v.trim();
  if (!isShadowObject(v)) return null;
  const dim = (x: unknown) => (x === undefined || x === null ? "0" : (formatDimension(x) ?? fallbackString(x, opts)));
  const inset = v.inset === true || v.type === "innerShadow" || v.type === "inset";
  const parts = [dim(v.offsetX ?? v.x), dim(v.offsetY ?? v.y), dim(v.blur), dim(v.spread)];
  const color = v.color !== undefined ? (formatColor(v.color, opts) ?? fallbackString(v.color, opts)) : null;
  return `${inset ? "inset " : ""}${parts.join(" ")}${color ? ` ${color}` : ""}`;
}

/** Shadow composite(s): single object or layered array -> CSS box-shadow-like string. */
export function formatShadow(v: unknown, opts: FormatOptions = {}): string | null {
  if (Array.isArray(v)) {
    const parts = v.map((x) => formatOneShadow(x, opts));
    return parts.every((p) => p !== null) && parts.length ? parts.join(", ") : null;
  }
  return formatOneShadow(v, opts);
}

const TYPO_KEYS = ["fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing", "fontStyle", "textCase", "textDecoration", "paragraphSpacing", "textTransform"];
const isTypographyObject = (v: unknown): v is Record<string, unknown> =>
  isObj(v) && ["fontFamily", "fontSize", "fontWeight", "lineHeight"].filter((k) => k in v).length >= 1 && Object.keys(v).every((k) => TYPO_KEYS.includes(k) || k.startsWith("$"));

/** Typography composite -> "italic 600 16px/1.5 Inter, sans-serif; letter-spacing 0.01em". */
export function formatTypography(v: unknown, opts: FormatOptions = {}): string | null {
  if (typeof v === "string") return v.trim();
  if (!isObj(v)) return null;
  const s = (x: unknown) => (x === undefined || x === null ? null : (formatDimension(x) ?? fallbackString(x, opts)));
  const family = v.fontFamily !== undefined ? (formatFontFamily(v.fontFamily) ?? fallbackString(v.fontFamily, opts)) : null;
  const size = s(v.fontSize);
  const lh = s(v.lineHeight);
  const head = [typeof v.fontStyle === "string" && v.fontStyle !== "normal" ? v.fontStyle : null, s(v.fontWeight), size ? (lh ? `${size}/${lh}` : size) : lh ? `line-height ${lh}` : null, family]
    .filter(Boolean)
    .join(" ");
  const extras: string[] = [];
  if (v.letterSpacing !== undefined) extras.push(`letter-spacing ${s(v.letterSpacing)}`);
  const tc = v.textCase ?? v.textTransform;
  if (typeof tc === "string" && tc !== "none") extras.push(`text-transform ${tc}`);
  if (typeof v.textDecoration === "string" && v.textDecoration !== "none") extras.push(`text-decoration ${v.textDecoration}`);
  if (v.paragraphSpacing !== undefined) extras.push(`paragraph-spacing ${s(v.paragraphSpacing)}`);
  const out = [head, ...extras].filter(Boolean).join("; ");
  return out || null;
}

/** strokeStyle: "dashed" or {dashArray:[..], lineCap} -> "dashed (4px 2px, round)". */
export function formatStrokeStyle(v: unknown, opts: FormatOptions = {}): string | null {
  if (typeof v === "string") return v.trim();
  if (isObj(v) && Array.isArray(v.dashArray)) {
    const dashes = v.dashArray.map((d) => formatDimension(d) ?? fallbackString(d, opts)).join(" ");
    return `dashed (${dashes}${typeof v.lineCap === "string" ? `, ${v.lineCap}` : ""})`;
  }
  return null;
}

/** Border composite {color, width, style} -> "1px solid #d0d7de". */
export function formatBorder(v: unknown, opts: FormatOptions = {}): string | null {
  if (typeof v === "string") return v.trim();
  if (!isObj(v) || !("width" in v || "style" in v || "color" in v)) return null;
  const parts = [
    v.width !== undefined ? (formatDimension(v.width) ?? fallbackString(v.width, opts)) : null,
    v.style !== undefined ? (formatStrokeStyle(v.style, opts) ?? fallbackString(v.style, opts)) : null,
    v.color !== undefined ? (formatColor(v.color, opts) ?? fallbackString(v.color, opts)) : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" ") : null;
}

/** Transition composite {duration, delay, timingFunction} -> "200ms cubic-bezier(...) 0ms". */
export function formatTransition(v: unknown, opts: FormatOptions = {}): string | null {
  if (typeof v === "string") return v.trim();
  if (!isObj(v) || !("duration" in v || "timingFunction" in v)) return null;
  const parts = [
    v.duration !== undefined ? (formatDimension(v.duration) ?? fallbackString(v.duration, opts)) : null,
    v.timingFunction !== undefined ? (formatCubicBezier(v.timingFunction) ?? fallbackString(v.timingFunction, opts)) : null,
    v.delay !== undefined ? (formatDimension(v.delay) ?? fallbackString(v.delay, opts)) : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" ") : null;
}

/** Gradient stops [{color, position}] -> "#fff 0%, #000 100%" (direction is not part of DTCG gradients). */
export function formatGradient(v: unknown, opts: FormatOptions = {}): string | null {
  if (typeof v === "string") return v.trim();
  if (!Array.isArray(v) || !v.length) return null;
  const stops = v.map((s) => {
    if (!isObj(s)) return null;
    const c = formatColor(s.color, opts) ?? fallbackString(s.color, opts);
    const p = typeof s.position === "number" ? `${formatNumber(s.position * 100)}%` : s.position !== undefined ? fallbackString(s.position, opts) : "";
    return `${c}${p ? ` ${p}` : ""}`;
  });
  return stops.every((s) => s !== null) ? stops.join(", ") : null;
}

function fallbackString(v: unknown, opts: FormatOptions): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") return formatNumber(v);
  if (typeof v === "boolean") return String(v);
  try {
    const s = JSON.stringify(v);
    const max = opts.maxLength ?? 240;
    return s.length > max ? `${s.slice(0, max - 1)}…` : s;
  } catch {
    return String(v);
  }
}

const truncate = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/**
 * Display string for a token value. `type` is a DTCG $type (or category) when known; when absent the
 * value shape decides. Returns null only for null/undefined values.
 */
export function formatTokenValue(value: unknown, type?: string | null, opts: FormatOptions = {}): string | null {
  if (value === null || value === undefined) return null;
  const max = opts.maxLength ?? 240;
  try {
    const t = (type ?? "").trim();
    const tl = t.toLowerCase();
    let out: string | null = null;
    switch (tl) {
      case "color":
        out = formatColor(value, opts);
        break;
      case "dimension":
      case "spacing":
      case "sizing":
      case "borderradius":
      case "borderwidth":
      case "fontsize":
      case "fontsizes":
      case "letterspacing":
      case "lineheight":
      case "lineheights":
      case "duration":
      case "paragraphspacing":
        out = formatDimension(value);
        break;
      case "cubicbezier":
        out = formatCubicBezier(value);
        break;
      case "shadow":
      case "boxshadow":
        out = formatShadow(value, opts);
        break;
      case "typography":
        out = formatTypography(value, opts);
        break;
      case "border":
        out = formatBorder(value, opts);
        break;
      case "strokestyle":
        out = formatStrokeStyle(value, opts);
        break;
      case "transition":
        out = formatTransition(value, opts);
        break;
      case "gradient":
        out = formatGradient(value, opts);
        break;
      case "fontfamily":
      case "fontfamilies":
        out = formatFontFamily(value);
        break;
      case "fontweight":
      case "fontweights":
      case "number":
      case "opacity":
        out = typeof value === "number" ? formatNumber(value) : formatDimension(value);
        break;
    }
    if (out === null) out = formatByShape(value, opts);
    return truncate(out, max);
  } catch {
    return truncate(fallbackString(value, opts), max);
  }
}

function formatByShape(value: unknown, opts: FormatOptions): string {
  if (typeof value === "string") {
    const color = opts.colorFormat && opts.colorFormat !== "as-authored" ? formatColor(value, opts) : null;
    return color ?? value;
  }
  if (typeof value === "number") return formatNumber(value);
  if (typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    if (value.length === 4 && value.every((x) => typeof x === "number")) return formatCubicBezier(value)!;
    if (value.length && value.every(isShadowObject)) return formatShadow(value, opts) ?? fallbackString(value, opts);
    if (value.length && value.every((s) => isObj(s) && "color" in s && "position" in s)) return formatGradient(value, opts) ?? fallbackString(value, opts);
    if (value.length && value.every((x) => typeof x === "string")) return formatFontFamily(value) ?? fallbackString(value, opts);
    return fallbackString(value, opts);
  }
  if (isObj(value)) {
    if (isDtcgColorObject(value)) return formatColor(value, opts) ?? fallbackString(value, opts);
    if ((typeof value.value === "number" || typeof value.value === "string") && typeof value.unit === "string") return formatDimension(value)!;
    if (isShadowObject(value)) return formatShadow(value, opts) ?? fallbackString(value, opts);
    if (isTypographyObject(value)) return formatTypography(value, opts) ?? fallbackString(value, opts);
    if ("duration" in value && ("timingFunction" in value || "delay" in value)) return formatTransition(value, opts) ?? fallbackString(value, opts);
    if ("width" in value && "style" in value) return formatBorder(value, opts) ?? fallbackString(value, opts);
    if (Array.isArray(value.dashArray)) return formatStrokeStyle(value, opts) ?? fallbackString(value, opts);
  }
  return fallbackString(value, opts);
}

/* -------------------------------------------------------------------------- */
/* Units                                                                       */
/* -------------------------------------------------------------------------- */

export interface ParsedDimension {
  value: number;
  /** "" for unitless numbers. Lower-cased. */
  unit: string;
}

const DIM_RE = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*([a-z%]*)$/i;

/** Parse "16px", "-0.5rem", "1.5", 16, {value:16, unit:"px"} -> {value, unit}; null otherwise (calc(), var(), lists). */
export function parseDimension(v: unknown): ParsedDimension | null {
  if (typeof v === "number") return Number.isFinite(v) ? { value: v, unit: "" } : null;
  if (typeof v === "string") {
    const m = DIM_RE.exec(v.trim());
    if (!m) return null;
    const n = Number(m[1]);
    return Number.isFinite(n) ? { value: n, unit: (m[2] ?? "").toLowerCase() } : null;
  }
  if (isObj(v) && typeof v.unit === "string") {
    const n = typeof v.value === "number" ? v.value : typeof v.value === "string" ? Number(v.value) : NaN;
    return Number.isFinite(n) ? { value: n, unit: v.unit.toLowerCase() } : null;
  }
  return null;
}

export interface DimensionToPxOptions {
  /** Root font size for rem (default 16). */
  remBase?: number;
  /** Font size for em (default remBase). em conversion is an assumption: it depends on context. */
  emBase?: number;
  /** How to treat unitless numbers: "px" (default) or "null". */
  unitless?: "px" | "null";
}

/** Convert a dimension to px. Supports px, rem, em, pt, pc, in, cm, mm, q; returns null for %, viewport units, calc(), etc. */
export function dimensionToPx(value: unknown, opts: DimensionToPxOptions = {}): number | null {
  const d = parseDimension(value);
  if (!d) return null;
  const rem = opts.remBase ?? 16;
  const em = opts.emBase ?? rem;
  switch (d.unit) {
    case "":
      return opts.unitless === "null" ? (d.value === 0 ? 0 : null) : d.value;
    case "px":
      return d.value;
    case "rem":
      return d.value * rem;
    case "em":
      return d.value * em;
    case "pt":
      return (d.value * 4) / 3;
    case "pc":
      return d.value * 16;
    case "in":
      return d.value * 96;
    case "cm":
      return (d.value * 96) / 2.54;
    case "mm":
      return (d.value * 96) / 25.4;
    case "q":
      return (d.value * 96) / 101.6;
    default:
      return null;
  }
}

/** Convert a duration to milliseconds ("200ms", "0.2s", {value:200, unit:"ms"}; unitless numbers are treated as ms). */
export function durationToMs(value: unknown): number | null {
  const d = parseDimension(value);
  if (!d) return null;
  if (d.unit === "ms" || d.unit === "") return d.value;
  if (d.unit === "s") return d.value * 1000;
  return null;
}
