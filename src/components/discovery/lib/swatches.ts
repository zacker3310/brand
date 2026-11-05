/**
 * Pick a small, representative set of REAL color tokens for a system's token summary.
 * Pure (unit-tested). Candidates arrive pre-ordered by the query (light/agnostic themes first,
 * semantic tier first, short names first); this keeps that priority while spreading across hues
 * so the strip is not twelve grays. Values that cannot be parsed to a concrete color are skipped.
 */
import { toHex, toOklch } from "@/lib/tokens/color";

export interface SwatchCandidate {
  name: string;
  setSlug: string;
  theme: string | null;
  resolved: unknown;
  valueText: string | null;
}

export interface PickedSwatch {
  name: string;
  setSlug: string;
  theme: string | null;
  hex: string;
  /** Raw display value as stored (value_text), for the label. */
  display: string;
  translucent: boolean;
  lightness: number;
}

export function pickSwatches(cands: SwatchCandidate[], n = 16): PickedSwatch[] {
  const seen = new Set<string>();
  const names = new Set<string>();
  const buckets = new Map<string, (PickedSwatch & { hue: number })[]>();
  for (const c of cands) {
    const hex = toHex(c.resolved) ?? (typeof c.valueText === "string" ? toHex(c.valueText) : null);
    if (!hex) continue;
    const key = hex.toLowerCase();
    // one swatch per distinct value and per token name (the same role across themes is shown once)
    if (seen.has(key) || names.has(c.name)) continue;
    seen.add(key);
    names.add(c.name);
    const o = toOklch(hex);
    if (!o) continue;
    const bucket = o.c < 0.03 || o.h === null ? "neutral" : `h${Math.floor(o.h / 30)}`;
    const entry = {
      name: c.name,
      setSlug: c.setSlug,
      theme: c.theme,
      hex: key,
      display: c.valueText ?? key,
      translucent: o.alpha < 1,
      lightness: o.l,
      hue: bucket === "neutral" ? -1 : (o.h ?? -1),
    };
    buckets.set(bucket, [...(buckets.get(bucket) ?? []), entry]);
  }
  const lists = [...buckets.values()];
  const out: (PickedSwatch & { hue: number })[] = [];
  for (let i = 0; out.length < n; i++) {
    let any = false;
    for (const l of lists) {
      const e = l[i];
      if (!e) continue;
      any = true;
      out.push(e);
      if (out.length >= n) break;
    }
    if (!any) break;
  }
  return out
    .sort((a, b) => {
      const an = a.hue < 0 ? 0 : 1;
      const bn = b.hue < 0 ? 0 : 1;
      if (an !== bn) return an - bn;
      if (an === 0) return b.lightness - a.lightness;
      return a.hue - b.hue || b.lightness - a.lightness;
    })
    .map(({ hue: _hue, ...rest }) => rest);
}
