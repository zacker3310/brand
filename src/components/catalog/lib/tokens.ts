import { isThemeDependentValue } from "@/lib/contracts";

export interface TokenValueEntry {
  /** Theme / set label for display ("light", "dark-high-contrast"), null for a single theme-agnostic value. */
  label: string | null;
  /** Display text, as stored (value_text) or the raw themed value. */
  text: string | null;
  /** Raw value to try as a CSS color for a swatch. */
  value: unknown;
  aliasState: string | null;
}

/** Strips the longest shared dash-delimited prefix from labels ("m3-sys-color-light", "m3-sys-color-dark" -> "light", "dark"). */
export function shortenLabels(labels: string[]): string[] {
  if (labels.length < 2) return labels;
  const parts = labels.map((l) => l.split("-"));
  let common = 0;
  const min = Math.min(...parts.map((p) => p.length));
  while (common < min - 1 && parts.every((p) => p[common] === parts[0]![common])) common++;
  return parts.map((p) => p.slice(common).join("-"));
}

interface UsageValue {
  set: string;
  theme: string | null;
  valueText: string | null;
  aliasState: string | null;
  resolvedValue: unknown;
}

function display(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return null;
  }
}

/**
 * Flattens the per-set values of one token name into display entries:
 *  - a theme-dependent token expands to one entry per themed set (from resolved_value.$themes);
 *  - a token defined in several themed sets gets one entry per set, labelled by theme (or set slug);
 *  - otherwise a single unlabelled entry.
 */
export function tokenValueEntries(values: UsageValue[]): TokenValueEntry[] {
  const out: { rawLabel: string | null; text: string | null; value: unknown; aliasState: string | null }[] = [];
  for (const v of values) {
    if (v.aliasState === "theme-dependent" && isThemeDependentValue(v.resolvedValue)) {
      for (const [set, val] of Object.entries(v.resolvedValue.$themes)) {
        out.push({ rawLabel: set, text: display(val), value: val, aliasState: "resolved" });
      }
      continue;
    }
    const resolved = v.resolvedValue ?? null;
    out.push({
      rawLabel: values.length > 1 ? (v.theme ?? v.set) : null,
      text: v.valueText ?? display(resolved),
      value: resolved ?? v.valueText,
      aliasState: v.aliasState,
    });
  }
  const labelled = out.filter((o) => o.rawLabel !== null);
  const short = shortenLabels(labelled.map((o) => o.rawLabel!));
  let i = 0;
  const entries = out.map((o) => ({
    label: o.rawLabel !== null ? (short[i++] ?? o.rawLabel) : null,
    text: o.text,
    value: o.value,
    aliasState: o.aliasState,
  }));
  // Light before dark, then alphabetical: matches how systems usually present themes.
  return entries.sort((a, b) => {
    if (a.label === null || b.label === null) return 0;
    const rank = (l: string) => (l.startsWith("light") ? 0 : l.startsWith("dark") ? 1 : 2);
    return rank(a.label) - rank(b.label) || a.label.localeCompare(b.label);
  });
}
