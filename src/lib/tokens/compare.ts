/**
 * Scale extraction and cross-system comparison (pure; never throws).
 *
 *  - extractScale(tokens, category): numeric steps of one category/subcategory sorted by value
 *    (px for lengths, ms for durations, raw numbers for weights/z-index/ratios), keeping original names.
 *  - compareScales(a, b): aligns two scales BY VALUE ONLY. Names are never compared; an aligned row
 *    means "both systems define this numeric value", not that the tokens are semantically equivalent.
 *  - contrastPairs(tokens): WCAG 2.x contrast for semantic foreground/background pairs that exist in
 *    the same theme. Pairing is a name heuristic (pairing: "inferred") unless pairs are supplied.
 */
import { TOKEN_CATEGORIES, type TokenCategory } from "@/lib/contracts";
import { categorizeToken, normalizeTokenName, type TokenSubcategory } from "./categorize";
import { checkContrast, parseColor } from "./color";
import { dimensionToPx, durationToMs, formatTokenValue, parseDimension } from "./format";
import { hasReferences } from "./refs";
import { fontWeightToNumber } from "./validate";

export interface ScaleInputToken {
  name: string;
  rawValue?: unknown;
  /** Preferred over rawValue when present (output of resolveTokenGraph). */
  resolvedValue?: unknown;
  /** Alternative to resolvedValue/rawValue. */
  value?: unknown;
  type?: string | null;
  /** Category if already known (e.g. stored token.category); otherwise categorizeToken() decides. */
  category?: string | null;
  theme?: string | null;
}

export type ScaleUnit = "px" | "ms" | "number" | "weight" | "ratio";

export interface ScaleStep {
  name: string;
  value: number;
  unit: ScaleUnit;
  /** Display string of the source value ("1rem", "16px", "200ms"). */
  display: string;
  /** Unitless number treated as px (common in native-platform token sets) - an assumption. */
  unitAssumed: boolean;
  /** rem/em converted with an assumed base font size. */
  converted: boolean;
}

export interface ExtractScaleOptions {
  /** rem base in px (default 16). */
  remBase?: number;
}

const firstDefined = (...xs: unknown[]) => xs.find((x) => x !== undefined && x !== null);

function tokenValue(t: ScaleInputToken): unknown {
  const v = firstDefined(t.resolvedValue, t.value, t.rawValue);
  return v;
}

/** Unit family for a subcategory. */
function unitFamily(sub: TokenSubcategory | null, cat: string): ScaleUnit {
  if (sub === "fontWeight") return "weight";
  if (sub === "zIndex") return "number";
  if (sub === "opacity" || cat === "opacity") return "ratio";
  if (sub === "duration" || sub === "transition" || sub === "easing" || cat === "motion") return "ms";
  return "px";
}

/** Extract numeric steps for a category ("spacing", "shape", ...) or subcategory ("radius", "fontSize", "zIndex", "duration", ...). */
export function extractScale(tokens: readonly ScaleInputToken[], category: TokenCategory | TokenSubcategory | string, opts: ExtractScaleOptions = {}): ScaleStep[] {
  const out: ScaleStep[] = [];
  if (!Array.isArray(tokens)) return out;
  const isTopLevel = (TOKEN_CATEGORIES as readonly string[]).includes(category);
  for (const t of tokens) {
    try {
      if (!t || typeof t.name !== "string") continue;
      const value = tokenValue(t);
      if (value === undefined || value === null || hasReferences(value)) continue;
      const c = categorizeToken(t.name, t.type ?? null, value);
      const cat = t.category ?? c.category;
      if (isTopLevel ? cat !== category : c.subcategory !== category) continue;
      const fam = unitFamily(c.subcategory, cat);
      let num: number | null = null;
      let unitAssumed = false;
      let converted = false;
      let unit: ScaleUnit = fam;
      if (fam === "weight") num = fontWeightToNumber(value);
      else if (fam === "ms") num = durationToMs(value);
      else if (fam === "ratio") {
        if (typeof value === "number") num = value;
        else if (typeof value === "string" && /%$/.test(value.trim())) num = Number(value.trim().slice(0, -1)) / 100;
        else if (typeof value === "string" && value.trim() !== "") num = Number(value);
      } else if (fam === "number") {
        num = typeof value === "number" ? value : typeof value === "string" && /^-?\d+$/.test(value.trim()) ? Number(value) : null;
      } else {
        const d = parseDimension(value);
        if (!d) continue;
        if (d.unit === "" && c.subcategory === "lineHeight") {
          num = d.value;
          unit = "number";
        } else {
          num = dimensionToPx(value, { remBase: opts.remBase ?? 16 });
          unitAssumed = d.unit === "" && d.value !== 0;
          converted = d.unit === "rem" || d.unit === "em";
        }
      }
      if (num === null || !Number.isFinite(num)) continue;
      out.push({ name: t.name, value: Math.round(num * 10_000) / 10_000, unit, display: formatTokenValue(value, t.type ?? null) ?? String(value), unitAssumed, converted });
    } catch {
      /* skip */
    }
  }
  const unitOrder: ScaleUnit[] = ["px", "ms", "number", "weight", "ratio"];
  return out.sort((a, b) => unitOrder.indexOf(a.unit) - unitOrder.indexOf(b.unit) || a.value - b.value || a.name.localeCompare(b.name));
}

export interface ScaleComparisonRow {
  /** Value of the row (side A's value for near matches). */
  value: number;
  unit: ScaleUnit;
  a: ScaleStep[];
  b: ScaleStep[];
  match: "exact" | "near" | "a-only" | "b-only";
  /** b.value - a.value for exact/near rows; null otherwise. */
  delta: number | null;
}

export interface ScaleComparison {
  rows: ScaleComparisonRow[];
  summary: {
    aSteps: number;
    bSteps: number;
    aValues: number;
    bValues: number;
    exact: number;
    near: number;
    aOnly: number;
    bOnly: number;
    /** shared values / union of values (exact + near count as shared), 3 decimals. */
    overlap: number;
  };
  alignment: "value";
  note: string;
}

export interface CompareScalesOptions {
  /** Absolute tolerance for "near" matches in the scale's unit (default 0 = exact only). */
  tolerance?: number;
  /** Relative tolerance (fraction of the larger value), e.g. 0.05 (default 0). */
  relativeTolerance?: number;
}

export const SCALE_COMPARISON_NOTE =
  "Aligned by numeric value only. Token names are not compared, and an aligned row does not imply the tokens are semantically equivalent.";

/** Align two scales by value (never by name). */
export function compareScales(a: readonly ScaleStep[], b: readonly ScaleStep[], opts: CompareScalesOptions = {}): ScaleComparison {
  const tolAbs = Math.max(0, opts.tolerance ?? 0);
  const tolRel = Math.max(0, opts.relativeTolerance ?? 0);
  const group = (steps: readonly ScaleStep[]) => {
    const m = new Map<string, { value: number; unit: ScaleUnit; steps: ScaleStep[] }>();
    const list: readonly ScaleStep[] = Array.isArray(steps) ? steps : [];
    for (const s of list) {
      if (!s || typeof s.value !== "number" || !Number.isFinite(s.value)) continue;
      const k = `${s.unit}\u0000${s.value}`;
      const g = m.get(k) ?? { value: s.value, unit: s.unit, steps: [] as ScaleStep[] };
      g.steps.push(s);
      m.set(k, g);
    }
    return [...m.values()];
  };
  const ga = group(a);
  const gb = group(b);
  const units = [...new Set([...ga.map((g) => g.unit), ...gb.map((g) => g.unit)])];
  const rows: ScaleComparisonRow[] = [];
  for (const unit of units) {
    const xa = ga.filter((g) => g.unit === unit).sort((p, q) => p.value - q.value);
    const xb = gb.filter((g) => g.unit === unit).sort((p, q) => p.value - q.value);
    let i = 0;
    let j = 0;
    while (i < xa.length || j < xb.length) {
      const pa = xa[i];
      const pb = xb[j];
      if (pa && pb) {
        const diff = pb.value - pa.value;
        const tol = Math.max(tolAbs, tolRel * Math.max(Math.abs(pa.value), Math.abs(pb.value)));
        if (diff === 0 || Math.abs(diff) <= tol) {
          rows.push({ value: pa.value, unit, a: pa.steps, b: pb.steps, match: diff === 0 ? "exact" : "near", delta: Math.round(diff * 10_000) / 10_000 });
          i++;
          j++;
        } else if (pa.value < pb.value) {
          rows.push({ value: pa.value, unit, a: pa.steps, b: [], match: "a-only", delta: null });
          i++;
        } else {
          rows.push({ value: pb.value, unit, a: [], b: pb.steps, match: "b-only", delta: null });
          j++;
        }
      } else if (pa) {
        rows.push({ value: pa.value, unit, a: pa.steps, b: [], match: "a-only", delta: null });
        i++;
      } else if (pb) {
        rows.push({ value: pb.value, unit, a: [], b: pb.steps, match: "b-only", delta: null });
        j++;
      }
    }
  }
  const count = (m: ScaleComparisonRow["match"]) => rows.filter((r) => r.match === m).length;
  const exact = count("exact");
  const near = count("near");
  const aOnly = count("a-only");
  const bOnly = count("b-only");
  const union = exact + near + aOnly + bOnly;
  return {
    rows,
    summary: {
      aSteps: (Array.isArray(a) ? a : []).length,
      bSteps: (Array.isArray(b) ? b : []).length,
      aValues: ga.length,
      bValues: gb.length,
      exact,
      near,
      aOnly,
      bOnly,
      overlap: union ? Math.round(((exact + near) / union) * 1000) / 1000 : 0,
    },
    alignment: "value",
    note: SCALE_COMPARISON_NOTE,
  };
}

/* -------------------------------------------------------------------------- */
/* Contrast pairs                                                              */
/* -------------------------------------------------------------------------- */

export interface ContrastPair {
  theme: string | null;
  fg: string;
  bg: string;
  fgValue: string;
  bgValue: string;
  ratio: number;
  aa: { normal: boolean; large: boolean };
  aaa: { normal: boolean; large: boolean };
  nonText: boolean;
  /** Translucent color(s) were composited; the ratio depends on what is actually behind them. */
  approximate: boolean;
  /** "declared" for caller-supplied pairs; "inferred" for name-heuristic pairs. */
  pairing: "declared" | "inferred";
  /** Heuristic used: "on-x" | "x-foreground" | "role-swap" | "declared". */
  rule: string;
}

export interface ContrastPairOptions {
  /** Explicit [fg, bg] name pairs (pairing "declared"); evaluated in every theme where both exist. */
  pairs?: [string, string][];
  /** Disable heuristic pairing (only `pairs`). */
  heuristics?: boolean;
  /** Safety cap (default 2000). */
  maxPairs?: number;
}

const FG_ROLES = ["foreground-color", "fg-color", "text-color", "foreground", "fg", "text", "content", "on-color"];
const BG_ROLES = ["background-color", "bg-color", "background", "bg", "surface", "canvas"];
const BOUND = "(^|[.\\-_/])";
const END = "(?=$|[.\\-_/])";

function displayColor(v: unknown): string | null {
  if (typeof v === "string") return v.trim();
  return formatTokenValue(v, "color");
}

/** Semantic fg/bg contrast pairs present within the same theme. */
export function contrastPairs(tokens: readonly ScaleInputToken[], opts: ContrastPairOptions = {}): ContrastPair[] {
  const out: ContrastPair[] = [];
  if (!Array.isArray(tokens)) return out;
  const max = opts.maxPairs ?? 2000;
  const byTheme = new Map<string | null, Map<string, { name: string; value: unknown }>>();
  for (const t of tokens) {
    if (!t || typeof t.name !== "string") continue;
    const v = tokenValue(t);
    if (v === undefined || v === null || hasReferences(v) || !parseColor(v)) continue;
    const theme = t.theme ?? null;
    const m = byTheme.get(theme) ?? new Map();
    m.set(t.name, { name: t.name, value: v });
    byTheme.set(theme, m);
  }
  const seen = new Set<string>();
  const push = (theme: string | null, fg: { name: string; value: unknown }, bg: { name: string; value: unknown }, pairing: ContrastPair["pairing"], rule: string) => {
    if (out.length >= max || fg.name === bg.name) return;
    const key = `${theme}\u0000${fg.name}\u0000${bg.name}`;
    if (seen.has(key)) return;
    const c = checkContrast(fg.value, bg.value);
    if (!c) return;
    seen.add(key);
    out.push({
      theme,
      fg: fg.name,
      bg: bg.name,
      fgValue: displayColor(fg.value) ?? "",
      bgValue: displayColor(bg.value) ?? "",
      ratio: c.ratio,
      aa: c.aa,
      aaa: c.aaa,
      nonText: c.nonText,
      approximate: c.fgComposited || c.bgComposited,
      pairing,
      rule,
    });
  };
  for (const [theme, colors] of byTheme) {
    for (const [fgName, bgName] of opts.pairs ?? []) {
      const fg = colors.get(fgName);
      const bg = colors.get(bgName);
      if (fg && bg) push(theme, fg, bg, "declared", "declared");
    }
    if (opts.heuristics === false) continue;
    const norm = new Map<string, { name: string; value: unknown }>();
    for (const c of colors.values()) {
      const n = normalizeTokenName(c.name);
      if (!norm.has(n)) norm.set(n, c);
    }
    for (const [n, fg] of norm) {
      // 1) Material-style "on-x" -> "x"
      const on = new RegExp(`${BOUND}on-`).exec(n);
      if (on) {
        const base = n.slice(0, on.index + on[1]!.length) + n.slice(on.index + on[0].length);
        const bg = norm.get(base);
        if (bg) push(theme, fg, bg, "inferred", "on-x");
      }
      // 2) shadcn-style "x-foreground" -> "x"
      const suf = /(?:[.\-_/])(foreground|fg)$/.exec(n);
      if (suf) {
        const base = n.slice(0, suf.index);
        const bg = norm.get(base);
        if (bg) push(theme, fg, bg, "inferred", "x-foreground");
      }
      // 3) role swap: fg role segment -> bg role segment ("fg-color.default" -> "bg-color.default")
      for (const role of FG_ROLES) {
        const re = new RegExp(`${BOUND}${role.replace(/-/g, "\\-")}${END}`, "g");
        for (const m of n.matchAll(re)) {
          const at = m.index! + m[1]!.length;
          for (const bgRole of BG_ROLES) {
            const cand = n.slice(0, at) + bgRole + n.slice(at + role.length);
            const bg = norm.get(cand);
            if (bg) push(theme, fg, bg, "inferred", "role-swap");
          }
        }
      }
    }
  }
  return out;
}
