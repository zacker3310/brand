/**
 * N-way scale alignment for the cross-system comparison (pure). Rows are keyed by (unit, numeric value)
 * exactly as compareScales() does pairwise: an aligned row means "these systems define this value",
 * never that the tokens mean the same thing.
 */
import type { ScaleStep, ScaleUnit } from "@/lib/tokens/compare";

export interface AlignedRow {
  unit: ScaleUnit;
  value: number;
  /** One entry per input scale (same order); empty when that system has no token with this value. */
  cells: ScaleStep[][];
  /** Number of scales that define this value. */
  sharedBy: number;
}

const UNIT_ORDER: ScaleUnit[] = ["px", "ms", "number", "weight", "ratio"];

export function alignScales(scales: readonly (readonly ScaleStep[])[]): AlignedRow[] {
  const rows = new Map<string, AlignedRow>();
  scales.forEach((scale, i) => {
    for (const s of scale) {
      if (!s || !Number.isFinite(s.value)) continue;
      const key = `${s.unit}\u0000${s.value}`;
      let row = rows.get(key);
      if (!row) {
        row = { unit: s.unit, value: s.value, cells: scales.map(() => []), sharedBy: 0 };
        rows.set(key, row);
      }
      row.cells[i]!.push(s);
    }
  });
  const out = [...rows.values()];
  for (const r of out) r.sharedBy = r.cells.filter((c) => c.length > 0).length;
  return out.sort((a, b) => UNIT_ORDER.indexOf(a.unit) - UNIT_ORDER.indexOf(b.unit) || a.value - b.value);
}

/** Deduplicate scale steps that repeat across themed sets (same name and value). */
export function dedupeSteps(steps: readonly ScaleStep[]): ScaleStep[] {
  const seen = new Set<string>();
  const out: ScaleStep[] = [];
  for (const s of steps) {
    const k = `${s.name}\u0000${s.unit}\u0000${s.value}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

export function formatScaleValue(value: number, unit: ScaleUnit): string {
  const n = Number.isInteger(value) ? String(value) : String(Math.round(value * 1000) / 1000);
  switch (unit) {
    case "px":
      return `${n}px`;
    case "ms":
      return `${n}ms`;
    case "ratio":
      return `${Math.round(value * 1000) / 10}%`;
    default:
      return n;
  }
}

/* -------------------------------------------------------------------------- */
/* Comparison model                                                            */
/* -------------------------------------------------------------------------- */

export const COMPARE_CATEGORIES = ["spacing", "shape", "typography"] as const;
export type CompareCategory = (typeof COMPARE_CATEGORIES)[number];

/** Scales shown per comparison category: [scale key passed to extractScale, label]. */
export const COMPARE_SCALES: Record<CompareCategory, { key: string; label: string; description: string }[]> = {
  spacing: [{ key: "spacing", label: "Spacing & sizing", description: "Every spacing-category dimension, converted to px." }],
  shape: [
    { key: "radius", label: "Corner radius", description: "Radius tokens, converted to px." },
    { key: "borderWidth", label: "Border width", description: "Border and stroke widths, converted to px." },
  ],
  typography: [
    { key: "fontSize", label: "Font size", description: "Font sizes, converted to px." },
    { key: "fontWeight", label: "Font weight", description: "Numeric font weights (keywords mapped to CSS weights)." },
    { key: "lineHeight", label: "Line height", description: "Unitless ratios and px line heights are listed separately." },
    { key: "letterSpacing", label: "Letter spacing", description: "Tracking, converted to px where possible." },
  ],
};

export interface SystemScale {
  steps: ScaleStep[];
  /** Distinct numeric values. */
  values: number;
}

export interface ScaleComparisonView {
  key: string;
  label: string;
  description: string;
  perSystem: SystemScale[];
  rows: AlignedRow[];
  /** Pairwise value-overlap of each system against the first (index 0 is null). */
  overlapWithFirst: ({ exact: number; overlap: number } | null)[];
}

/** Build the aligned comparison for one category from per-system scale extractors. */
export function buildScaleComparison(
  category: CompareCategory,
  extract: (systemIndex: number, scaleKey: string) => ScaleStep[],
  systems: number,
  pairwise: (a: ScaleStep[], b: ScaleStep[]) => { exact: number; overlap: number },
): ScaleComparisonView[] {
  return COMPARE_SCALES[category].map((sc) => {
    const perSystem = Array.from({ length: systems }, (_, i) => {
      const steps = dedupeSteps(extract(i, sc.key));
      return { steps, values: new Set(steps.map((s) => `${s.unit}:${s.value}`)).size };
    });
    const rows = alignScales(perSystem.map((p) => p.steps));
    const first = perSystem[0]?.steps ?? [];
    const overlapWithFirst = perSystem.map((p, i) => (i === 0 ? null : pairwise(first, p.steps)));
    return { ...sc, perSystem, rows, overlapWithFirst };
  });
}
