/**
 * Value helpers for rendering token previews (pure; never throw). Everything rendered into inline styles
 * passes safeCss(): token values come from third-party sources and must not inject resources or rules.
 */
import { isThemeDependentValue } from "@/lib/contracts";
import { formatCubicBezier, formatDimension, formatFontFamily, formatShadow, formatTokenValue, dimensionToPx, durationToMs, parseDimension } from "@/lib/tokens/format";
import { inSrgbGamut, parseColor, toCssColor, toHex, toOklch } from "@/lib/tokens/color";
import { hasReferences } from "@/lib/tokens/refs";
import { fontWeightToNumber } from "@/lib/tokens/validate";

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Reject anything that could load a resource or break out of a declaration. */
export function safeCss(s: string | null | undefined): string | null {
  if (typeof s !== "string") return null;
  const t = s.trim();
  if (!t || t.length > 400) return null;
  if (/[;{}<>\\]|url\s*\(|image(?:-set)?\s*\(|element\s*\(|expression\s*\(|@import|javascript:/i.test(t)) return null;
  return t;
}

/** CSS color for a swatch, or null when the value is not a statically known color. */
export function swatchColor(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && hasReferences(value)) return null;
  if (!parseColor(value)) return null;
  return safeCss(toCssColor(value) ?? toHex(value));
}

export function isTranslucent(value: unknown): boolean {
  const o = toOklch(value);
  return !!o && o.alpha < 1;
}

/**
 * Display string for a color: hex (with alpha) when the color is inside sRGB, otherwise its CSS form, so
 * wide-gamut values are never shown as a clamped hex.
 */
export function colorLabel(value: unknown, fallback?: string | null): string {
  if (parseColor(value)) {
    if (inSrgbGamut(value) !== false) {
      const hex = toHex(value);
      if (hex) return hex;
    }
    const css = toCssColor(value);
    if (css) return css;
  }
  return formatTokenValue(value, "color") ?? fallback ?? "";
}

export interface ThemeValue {
  setSlug: string;
  value: unknown;
}

/** Per-themed-set values of a theme-dependent token, ordered by `setOrder` (unknown sets last, by slug). */
export function themeValues(resolved: unknown, setOrder: readonly string[] = []): ThemeValue[] {
  if (!isThemeDependentValue(resolved)) return [];
  const rank = new Map(setOrder.map((s, i) => [s, i]));
  return Object.entries(resolved.$themes)
    .map(([setSlug, value]) => ({ setSlug, value }))
    .sort((a, b) => (rank.get(a.setSlug) ?? 1e9) - (rank.get(b.setSlug) ?? 1e9) || (a.setSlug < b.setSlug ? -1 : 1));
}

/** Short label for a theme name: "light-high-contrast" -> "Light HC". */
export function themeShortLabel(theme: string | null | undefined, fallback: string): string {
  const t = (theme ?? "").trim();
  if (!t) return fallback;
  return t
    .split(/[-_\s]+/)
    .map((w, i) => {
      const l = w.toLowerCase();
      if (l === "high" || l === "medium") return l === "high" ? "H" : "M";
      if (l === "contrast") return "C";
      return i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w;
    })
    .join(" ")
    .replace(/ ([HM]) C$/, " $1C");
}

/* -------------------------------------------------------------------------- */
/* Typography                                                                  */
/* -------------------------------------------------------------------------- */

export interface TypographySpec {
  fontFamily: string | null;
  fontSize: string | null;
  fontSizePx: number | null;
  fontWeight: string | null;
  lineHeight: string | null;
  letterSpacing: string | null;
  fontStyle: string | null;
  /** Fields whose authored value could not be evaluated statically (functions, variables, references). */
  unevaluated: string[];
}

const KEYMAP: Record<string, keyof Omit<TypographySpec, "unevaluated" | "fontSizePx">> = {
  fontfamily: "fontFamily",
  font: "fontFamily",
  family: "fontFamily",
  fontsize: "fontSize",
  size: "fontSize",
  fontweight: "fontWeight",
  weight: "fontWeight",
  wght: "fontWeight",
  lineheight: "lineHeight",
  letterspacing: "letterSpacing",
  tracking: "letterSpacing",
  fontstyle: "fontStyle",
};

/** Values like "scale.type-scale(8)", "$body-01", "{text.size}", "var(--x)" are not statically known. */
export function isUnevaluated(v: unknown): boolean {
  if (typeof v !== "string") return false;
  const s = v.trim();
  if (hasReferences(s)) return true;
  if (/^\$[\w-]/.test(s)) return true;
  if (/^[\w.-]+\(.*\)$/.test(s) && !/^(cubic-bezier|steps|calc|clamp|min|max|rgb|rgba|hsl|hsla|oklch|oklab|lab|lch|color)\(/i.test(s)) return true;
  return false;
}

function cssField(field: keyof Omit<TypographySpec, "unevaluated" | "fontSizePx">, v: unknown): string | null {
  switch (field) {
    case "fontFamily":
      return safeCss(formatFontFamily(v));
    case "fontWeight": {
      const n = fontWeightToNumber(v);
      if (n !== null) return String(n);
      if (typeof v === "string" && /^'wght'\s+\d+/.test(v)) return v.replace(/^'wght'\s+/, "");
      return null;
    }
    case "lineHeight":
      if (typeof v === "number") return String(v);
      return safeCss(formatDimension(v));
    default:
      return safeCss(formatDimension(v) ?? (typeof v === "string" ? v : null));
  }
}

/** Typography composite (DTCG camelCase or kebab-case keys) -> CSS-ready fields. */
export function typographySpec(value: unknown): TypographySpec | null {
  if (!isObj(value)) return null;
  const spec: TypographySpec = { fontFamily: null, fontSize: null, fontSizePx: null, fontWeight: null, lineHeight: null, letterSpacing: null, fontStyle: null, unevaluated: [] };
  let any = false;
  for (const [k, v] of Object.entries(value)) {
    const field = KEYMAP[k.toLowerCase().replace(/[-_]/g, "")];
    if (!field) continue;
    any = true;
    if (isUnevaluated(v)) {
      spec.unevaluated.push(k);
      continue;
    }
    const css = cssField(field, v);
    if (css === null) spec.unevaluated.push(k);
    else spec[field] = css;
  }
  if (!any) return null;
  spec.fontSizePx = spec.fontSize ? dimensionToPx(spec.fontSize, { unitless: "null" }) : null;
  return spec;
}

/** Field a scalar typography token contributes to a composed specimen, from its last path segment. */
export function typographyFieldOf(lastSegment: string, type: string | null | undefined, path?: readonly string[]): keyof Omit<TypographySpec, "unevaluated" | "fontSizePx"> | null {
  const t = (type ?? "").toLowerCase().replace(/[-_]/g, "");
  if (KEYMAP[t]) return KEYMAP[t]!;
  const s = lastSegment.toLowerCase().replace(/[-_]/g, "");
  if (KEYMAP[s]) return KEYMAP[s]!;
  // "base.text.lineHeight.loose": the property is named by an ancestor segment
  for (const seg of [...(path ?? [])].reverse().slice(1)) {
    const k = seg.toLowerCase().replace(/[-_]/g, "");
    if (KEYMAP[k] && k !== "font") return KEYMAP[k]!;
  }
  return null;
}

/** First family in a font stack: "'Mona Sans VF', -apple-system, sans-serif" -> "Mona Sans VF". */
export function primaryFamily(stack: string | null | undefined): string | null {
  if (!stack) return null;
  const firstPart = stack.split(",")[0]?.trim().replace(/^['"]|['"]$/g, "");
  return firstPart || null;
}

/** Scalar value of a typography token as a CSS value for a field. */
export function typographyScalar(field: keyof Omit<TypographySpec, "unevaluated" | "fontSizePx">, value: unknown): string | null {
  if (isUnevaluated(value)) return null;
  if (typeof value === "string" && field === "fontWeight" && /^'wght'\s+\d+/.test(value)) return value.replace(/^'wght'\s+/, "");
  if (typeof value === "string" && field === "letterSpacing" && /^'?[a-z]{4}'?\s/i.test(value)) return null; // font-variation axis, not tracking
  return cssField(field, value);
}

/* -------------------------------------------------------------------------- */
/* Motion                                                                      */
/* -------------------------------------------------------------------------- */

/** CSS easing keywords as defined by CSS Easing Functions Level 1 (spec values, not invented). */
const EASING_KEYWORDS: Record<string, [number, number, number, number]> = {
  linear: [0, 0, 1, 1],
  ease: [0.25, 0.1, 0.25, 1],
  "ease-in": [0.42, 0, 1, 1],
  "ease-out": [0, 0, 0.58, 1],
  "ease-in-out": [0.42, 0, 0.58, 1],
};

export interface EasingInfo {
  css: string;
  points: [number, number, number, number] | null;
}

/** Easing value (array, object, "cubic-bezier(...)" string or keyword) -> CSS + control points when known. */
export function easingOf(value: unknown): EasingInfo | null {
  const css = formatCubicBezier(value);
  if (!css) return null;
  const kw = EASING_KEYWORDS[css.trim().toLowerCase()];
  if (kw) return { css: css.trim(), points: kw };
  const m = /^cubic-bezier\(\s*([-\d.e]+)\s*,\s*([-\d.e]+)\s*,\s*([-\d.e]+)\s*,\s*([-\d.e]+)\s*\)$/i.exec(css.trim());
  if (m) {
    const pts = [m[1], m[2], m[3], m[4]].map(Number) as [number, number, number, number];
    if (pts.every(Number.isFinite) && pts[0] >= 0 && pts[0] <= 1 && pts[2] >= 0 && pts[2] <= 1) return { css: safeCss(css) ?? "linear", points: pts };
  }
  const safe = safeCss(css);
  if (safe && /^(steps|linear)\(/i.test(safe)) return { css: safe, points: null };
  return null;
}

export interface MotionInfo {
  durationMs: number | null;
  easing: EasingInfo | null;
  delayMs: number | null;
}

/** Duration, easing or transition composite -> what the motion preview needs. */
export function motionOf(value: unknown, type: string | null | undefined): MotionInfo | null {
  const t = (type ?? "").toLowerCase();
  if (isObj(value) && ("duration" in value || "timingFunction" in value)) {
    return { durationMs: durationToMs(value.duration), easing: easingOf(value.timingFunction), delayMs: durationToMs(value.delay) };
  }
  if (t === "cubicbezier" || Array.isArray(value) || (typeof value === "string" && /cubic-bezier|^ease|^linear$|^steps\(/i.test(value.trim()))) {
    const e = easingOf(value);
    return e ? { durationMs: null, easing: e, delayMs: null } : null;
  }
  const d = durationToMs(value);
  if (d !== null && (t === "duration" || /m?s$/.test(String(value).trim()))) return { durationMs: d, easing: null, delayMs: null };
  return null;
}

/* -------------------------------------------------------------------------- */
/* Dimensions, shadows, opacity                                                */
/* -------------------------------------------------------------------------- */

export interface DimensionInfo {
  px: number | null;
  display: string;
  unit: string | null;
  /** rem/em converted with an assumed 16px base. */
  converted: boolean;
  /** Unitless number (treated as px only for display; flagged). */
  unitless: boolean;
}

export function dimensionOf(value: unknown): DimensionInfo | null {
  if (value === null || value === undefined || isUnevaluated(value)) return null;
  const d = parseDimension(value);
  const display = formatDimension(value) ?? (typeof value === "string" ? value : null);
  if (!display) return null;
  if (!d) return { px: null, display, unit: null, converted: false, unitless: false };
  const px = dimensionToPx(value, { remBase: 16 });
  return { px, display, unit: d.unit || null, converted: d.unit === "rem" || d.unit === "em", unitless: d.unit === "" && d.value !== 0 };
}

/** CSS box-shadow for a shadow token value, or null. */
export function shadowCss(value: unknown): string | null {
  if (typeof value === "string" && isUnevaluated(value)) return null;
  const s = formatShadow(value);
  if (!s || /\{|\$|var\(/.test(s)) return null;
  if (!/\d/.test(s)) return null;
  return safeCss(s);
}

/** Opacity as 0..1, from 0.38 / "38%" / "0.38". */
export function opacityOf(value: unknown): number | null {
  if (typeof value === "number") return value >= 0 && value <= 1 ? value : null;
  if (typeof value !== "string") return null;
  const s = value.trim();
  if (/%$/.test(s)) {
    const n = Number(s.slice(0, -1));
    return Number.isFinite(n) && n >= 0 && n <= 100 ? n / 100 : null;
  }
  const n = Number(s);
  return s !== "" && Number.isFinite(n) && n >= 0 && n <= 1 ? n : null;
}

/** Value to preview: resolved when present (and not theme-dependent), otherwise raw. */
export function previewValue(t: { rawValue: unknown; resolvedValue: unknown; aliasState: string | null }): unknown {
  if (t.resolvedValue !== null && t.resolvedValue !== undefined && !isThemeDependentValue(t.resolvedValue)) return t.resolvedValue;
  if (t.aliasState === "theme-dependent") return null;
  if (t.aliasState && t.aliasState !== "literal") return t.resolvedValue ?? null;
  return t.rawValue;
}

/** Compact display of an authored value. */
export function authoredLabel(raw: unknown, type?: string | null): string {
  if (typeof raw === "string") return raw;
  return formatTokenValue(raw, type ?? null, { maxLength: 200 }) ?? "";
}
