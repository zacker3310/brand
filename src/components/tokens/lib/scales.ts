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
