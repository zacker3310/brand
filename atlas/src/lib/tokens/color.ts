/**
 * Color utilities (culori-based). Pure; never throw.
 *
 * Accepts CSS color strings (hex, rgb/rgba, hsl/hsla, hwb, lab, lch, oklab, oklch, color(), named
 * colors, transparent) and DTCG 2025 color objects
 *   { colorSpace: "srgb" | "display-p3" | "oklch" | ..., components: [..], alpha?: number, hex?: string }.
 *
 * WCAG 2.x contrast follows the WCAG 2.2 definition of relative luminance (sRGB). Translucent
 * foregrounds are alpha-composited over the background before measuring; translucent
 * backgrounds are composited over an assumed backdrop (white unless specified) and flagged.
 */
import { converter, formatCss, formatHex, formatHex8, parse as culoriParse, wcagLuminance, type Color } from "culori";

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

const toRgb = converter("rgb");
const toOklchC = converter("oklch");

/** CSS color keywords that are valid colors but have no static value. */
export const NON_CONCRETE_COLOR_KEYWORDS = new Set(["currentcolor", "inherit", "initial", "unset", "revert", "revert-layer"]);

/** CSS system colors (valid, user-agent dependent; not statically resolvable). */
export const SYSTEM_COLORS = new Set(
  [
    "accentcolor",
    "accentcolortext",
    "activetext",
    "buttonborder",
    "buttonface",
    "buttontext",
    "canvas",
    "canvastext",
    "field",
    "fieldtext",
    "graytext",
    "highlight",
    "highlighttext",
    "linktext",
    "mark",
    "marktext",
    "selecteditem",
    "selecteditemtext",
    "visitedtext",
  ].map((s) => s.toLowerCase()),
);

/** CSS color functions culori cannot evaluate statically (valid syntax, value depends on evaluation). */
const UNEVALUATED_COLOR_FN = /^(color-mix|light-dark|contrast-color|device-cmyk)\(|^(rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\(\s*from\s/i;

/** DTCG colorSpace -> culori mode and channel mapping. */
function dtcgToCulori(obj: Record<string, unknown>): Color | undefined {
  const space = typeof obj.colorSpace === "string" ? obj.colorSpace.toLowerCase() : null;
  const comps = Array.isArray(obj.components) ? obj.components : null;
  const alphaRaw = obj.alpha;
  const alpha = typeof alphaRaw === "number" && Number.isFinite(alphaRaw) ? alphaRaw : undefined;
  if (!space || !comps || comps.length !== 3) {
    if (typeof obj.hex === "string") return parseCssColor(obj.hex) ?? undefined;
    return undefined;
  }
  const n = (x: unknown): number | undefined => (x === "none" ? 0 : typeof x === "number" && Number.isFinite(x) ? x : undefined);
  const [a, b, c] = comps.map(n);
  if (a === undefined || b === undefined || c === undefined) {
    if (typeof obj.hex === "string") return parseCssColor(obj.hex) ?? undefined;
    return undefined;
  }
  const withAlpha = <T extends Color>(col: T): T => (alpha !== undefined && alpha < 1 ? { ...col, alpha } : col);
  switch (space) {
    case "srgb":
      return withAlpha({ mode: "rgb", r: a, g: b, b: c });
    case "srgb-linear":
      return withAlpha({ mode: "lrgb", r: a, g: b, b: c });
    case "hsl": // DTCG: h 0-360, s/l 0-100
      return withAlpha({ mode: "hsl", h: a, s: b / 100, l: c / 100 });
    case "hwb":
      return withAlpha({ mode: "hwb", h: a, w: b / 100, b: c / 100 });
    case "lab":
      return withAlpha({ mode: "lab", l: a, a: b, b: c });
    case "lch":
      return withAlpha({ mode: "lch", l: a, c: b, h: c });
    case "oklab":
      return withAlpha({ mode: "oklab", l: a, a: b, b: c });
    case "oklch":
      return withAlpha({ mode: "oklch", l: a, c: b, h: c });
    case "display-p3":
      return withAlpha({ mode: "p3", r: a, g: b, b: c });
    case "a98-rgb":
      return withAlpha({ mode: "a98", r: a, g: b, b: c });
    case "prophoto-rgb":
      return withAlpha({ mode: "prophoto", r: a, g: b, b: c });
    case "rec2020":
      return withAlpha({ mode: "rec2020", r: a, g: b, b: c });
    case "xyz":
    case "xyz-d65":
      return withAlpha({ mode: "xyz65", x: a, y: b, z: c });
    case "xyz-d50":
      return withAlpha({ mode: "xyz50", x: a, y: b, z: c });
    default:
      if (typeof obj.hex === "string") return parseCssColor(obj.hex) ?? undefined;
      return undefined;
  }
}

function parseCssColor(s: string): Color | null {
  const t = s.trim();
  if (!t || t.length > 200) return null;
  try {
    return culoriParse(t) ?? null;
  } catch {
    return null;
  }
}

/** True for a DTCG 2025 color object ({colorSpace, components}) or legacy object with a hex field. */
export function isDtcgColorObject(v: unknown): v is { colorSpace: string; components: unknown[]; alpha?: number; hex?: string } {
  return isObj(v) && typeof v.colorSpace === "string" && Array.isArray(v.components);
}

/** Parse any supported color value to a culori Color; null when not statically parseable. */
export function parseColor(value: unknown): Color | null {
  try {
    if (typeof value === "string") return parseCssColor(value);
    if (isObj(value)) {
      if (isDtcgColorObject(value) || typeof value.hex === "string") return dtcgToCulori(value) ?? null;
      // culori Color object passthrough
      if (typeof value.mode === "string") return value as unknown as Color;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * True if the value is a color: parseable, or a valid-but-non-static CSS color (currentColor,
 * system colors, color-mix()/light-dark()/relative color syntax) when `allowNonConcrete` (default true).
 */
export function isColorValue(value: unknown, opts: { allowNonConcrete?: boolean } = {}): boolean {
  if (parseColor(value)) return true;
  if (opts.allowNonConcrete === false || typeof value !== "string") return false;
  const t = value.trim().toLowerCase();
  return NON_CONCRETE_COLOR_KEYWORDS.has(t) || SYSTEM_COLORS.has(t) || UNEVALUATED_COLOR_FN.test(t);
}

/** Classify why a string is (not) a concrete color. */
export function colorValueKind(value: unknown): "concrete" | "keyword" | "system" | "unevaluated" | "invalid" {
  if (parseColor(value)) return "concrete";
  if (typeof value !== "string") return "invalid";
  const t = value.trim().toLowerCase();
  if (NON_CONCRETE_COLOR_KEYWORDS.has(t)) return "keyword";
  if (SYSTEM_COLORS.has(t)) return "system";
  if (UNEVALUATED_COLOR_FN.test(t)) return "unevaluated";
  return "invalid";
}

/** True when the color is inside the sRGB gamut (with small tolerance). */
export function inSrgbGamut(value: unknown): boolean | null {
  const c = parseColor(value);
  if (!c) return null;
  const rgb = toRgb(c);
  if (!rgb) return null;
  const eps = 1e-4;
  return [rgb.r, rgb.g, rgb.b].every((x) => x >= -eps && x <= 1 + eps);
}

/**
 * Hex string: "#rrggbb", or "#rrggbbaa" when alpha < 1. Out-of-sRGB-gamut colors are clamped
 * channel-wise (check inSrgbGamut() when that matters). null when not parseable.
 */
export function toHex(value: unknown): string | null {
  const c = parseColor(value);
  if (!c) return null;
  try {
    const rgb = toRgb(c);
    if (!rgb || [rgb.r, rgb.g, rgb.b].some((x) => typeof x !== "number" || Number.isNaN(x))) return null;
    const alpha = typeof rgb.alpha === "number" ? rgb.alpha : 1;
    return (alpha < 1 ? formatHex8(rgb) : formatHex(rgb)) ?? null;
  } catch {
    return null;
  }
}

export interface Oklch {
  l: number;
  c: number;
  /** Hue in degrees; null for achromatic colors. */
  h: number | null;
  alpha: number;
}

const round = (n: number, d: number) => {
  const f = 10 ** d;
  return Math.round(n * f) / f;
};

/** OKLCH components (l 0..1, c >= 0, h degrees or null when achromatic). */
export function toOklch(value: unknown): Oklch | null {
  const c = parseColor(value);
  if (!c) return null;
  try {
    const o = toOklchC(c);
    if (!o || typeof o.l !== "number" || Number.isNaN(o.l)) return null;
    const chroma = typeof o.c === "number" && !Number.isNaN(o.c) ? o.c : 0;
    const hue = typeof o.h === "number" && !Number.isNaN(o.h) && chroma > 1e-4 ? o.h : null;
    return { l: o.l, c: chroma, h: hue, alpha: typeof o.alpha === "number" ? o.alpha : 1 };
  } catch {
    return null;
  }
}

/** "oklch(62.8% 0.258 29.23)" (+ " / 0.5" when translucent). */
export function toOklchString(value: unknown, digits = 3): string | null {
  const o = toOklch(value);
  if (!o) return null;
  const l = `${round(o.l * 100, Math.max(0, digits - 2))}%`;
  const h = o.h === null ? "none" : String(round(o.h, 2));
  const a = o.alpha < 1 ? ` / ${round(o.alpha, 3)}` : "";
  return `oklch(${l} ${round(o.c, digits)} ${h}${a})`;
}

/** CSS serialization of a color (e.g. for DTCG color objects in wide gamuts). */
export function toCssColor(value: unknown): string | null {
  const c = parseColor(value);
  if (!c) return null;
  try {
    if (c.mode === "rgb") return toHex(c);
    return formatCss(c) ?? null;
  } catch {
    return null;
  }
}

function rgbaOf(value: unknown): { r: number; g: number; b: number; alpha: number } | null {
  const c = parseColor(value);
  if (!c) return null;
  const rgb = toRgb(c);
  if (!rgb) return null;
  const clamp = (x: number) => Math.min(1, Math.max(0, Number.isNaN(x) ? 0 : x));
  return { r: clamp(rgb.r), g: clamp(rgb.g), b: clamp(rgb.b), alpha: typeof rgb.alpha === "number" ? clamp(rgb.alpha) : 1 };
}

/** Source-over composite of `top` over an opaque `bottom` (sRGB, gamma-encoded, as browsers do). */
function composite(top: { r: number; g: number; b: number; alpha: number }, bottom: { r: number; g: number; b: number }) {
  const a = top.alpha;
  return { mode: "rgb" as const, r: top.r * a + bottom.r * (1 - a), g: top.g * a + bottom.g * (1 - a), b: top.b * a + bottom.b * (1 - a) };
}

/** WCAG 2.x relative luminance (0..1), ignoring alpha. null when not parseable. */
export function relativeLuminance(value: unknown): number | null {
  const c = rgbaOf(value);
  if (!c) return null;
  try {
    return wcagLuminance({ mode: "rgb", r: c.r, g: c.g, b: c.b });
  } catch {
    return null;
  }
}

export interface ContrastResult {
  /** WCAG 2.x contrast ratio (1..21), rounded to 2 decimals. */
  ratio: number;
  /** Unrounded ratio (use for threshold checks). */
  exactRatio: number;
  aa: { normal: boolean; large: boolean };
  aaa: { normal: boolean; large: boolean };
  /** Non-text / UI component contrast (WCAG 1.4.11, >= 3:1). */
  nonText: boolean;
  /** Foreground was translucent and was composited over the background. */
  fgComposited: boolean;
  /** Background was translucent and was composited over `backdrop` (an assumption). */
  bgComposited: boolean;
  backdrop: string | null;
}

/** WCAG 2.x thresholds. */
export const WCAG_THRESHOLDS = { aaNormal: 4.5, aaLarge: 3, aaaNormal: 7, aaaLarge: 4.5, nonText: 3 } as const;

/** WCAG 2.x contrast ratio between two colors; null when either is not parseable. */
export function contrastRatio(fg: unknown, bg: unknown, opts: { backdrop?: unknown } = {}): number | null {
  return checkContrast(fg, bg, opts)?.ratio ?? null;
}

/**
 * Contrast check with AA/AAA flags for normal and large text. Translucent colors are composited
 * (fg over bg; bg over `backdrop`, default "#ffffff") and flagged so callers can mark results as approximate.
 */
export function checkContrast(fg: unknown, bg: unknown, opts: { backdrop?: unknown } = {}): ContrastResult | null {
  const f = rgbaOf(fg);
  const b0 = rgbaOf(bg);
  if (!f || !b0) return null;
  let bgComposited = false;
  let backdrop: string | null = null;
  let b: { r: number; g: number; b: number } = b0;
  if (b0.alpha < 1) {
    const bd = rgbaOf(opts.backdrop ?? "#ffffff") ?? { r: 1, g: 1, b: 1, alpha: 1 };
    b = composite(b0, bd);
    bgComposited = true;
    backdrop = toHex({ mode: "rgb", r: bd.r, g: bd.g, b: bd.b });
  }
  const fgComposited = f.alpha < 1;
  const fc = fgComposited ? composite(f, b) : f;
  const l1 = wcagLuminance({ mode: "rgb", r: fc.r, g: fc.g, b: fc.b });
  const l2 = wcagLuminance({ mode: "rgb", r: b.r, g: b.g, b: b.b });
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  const exact = (hi + 0.05) / (lo + 0.05);
  const T = WCAG_THRESHOLDS;
  return {
    ratio: round(exact, 2),
    exactRatio: exact,
    aa: { normal: exact >= T.aaNormal, large: exact >= T.aaLarge },
    aaa: { normal: exact >= T.aaaNormal, large: exact >= T.aaaLarge },
    nonText: exact >= T.nonText,
    fgComposited,
    bgComposited,
    backdrop,
  };
}
