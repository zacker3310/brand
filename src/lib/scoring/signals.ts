/**
 * Evidence-weighted signal combination shared by every rubric.
 *
 *   score            = 100 * sum(w * v) / sum(w)       over KNOWN inputs only (v !== null, w > 0)
 *   evidenceCoverage = sum(w * c) / sum(w)             over ALL weighted inputs (unknown => c = 0)
 *   confidence       = high >= 0.8 > medium >= 0.55 > low >= 0.35 > insufficient
 *
 * Two honesty guards:
 *  - Below the "low" threshold the score is withheld (status "insufficient"): a low score built
 *    from thin evidence would read as poor quality.
 *  - A score built only from weak negatives (v = 0 observed in partially extracted data, c < 1)
 *    is withheld too: ATLAS never publishes a score that rests solely on not having found something.
 */
import type { Confidence, CriterionId, RubricInput, RubricResult } from "./types";

export const CONFIDENCE_THRESHOLDS = { high: 0.8, medium: 0.55, low: 0.35 } as const;

const ORDER: Confidence[] = ["insufficient", "low", "medium", "high"];

export function confidenceFor(evidenceCoverage: number): Confidence {
  if (evidenceCoverage >= CONFIDENCE_THRESHOLDS.high) return "high";
  if (evidenceCoverage >= CONFIDENCE_THRESHOLDS.medium) return "medium";
  if (evidenceCoverage >= CONFIDENCE_THRESHOLDS.low) return "low";
  return "insufficient";
}

/** The lower of two confidence levels. */
export function minConfidence(a: Confidence, b: Confidence): Confidence {
  return ORDER.indexOf(a) <= ORDER.indexOf(b) ? a : b;
}

export const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

/** Share as a percentage string ("73%"); "n/a" for an empty denominator. */
export function pct(n: number, d: number): string {
  if (!d) return "n/a";
  return `${Math.round((100 * n) / d)}%`;
}

export interface ConfidenceCap {
  max: Confidence;
  reason: string;
}

export interface CombineOptions {
  caps?: (ConfidenceCap | null | false | undefined)[];
  /** Builds the explanation once the score is known. */
  explain: (r: { score: number | null; confidence: Confidence; evidenceCoverage: number; status: RubricResult["status"] }) => string;
  /** Overrides the status/score entirely (e.g. metadata-only systems for component-derived criteria). */
  notIndexed?: boolean;
}

export function normalizeInput(i: RubricInput): RubricInput {
  const value = i.value === null || !Number.isFinite(i.value) ? null : clamp01(i.value);
  return { ...i, value, coverage: value === null ? 0 : clamp01(i.coverage), weight: Math.max(0, i.weight) };
}

export function combine(criterion: CriterionId, rawInputs: RubricInput[], opts: CombineOptions): RubricResult {
  const inputs = rawInputs.map(normalizeInput);
  const weighted = inputs.filter((i) => i.weight > 0);
  const totalWeight = weighted.reduce((s, i) => s + i.weight, 0);
  const known = weighted.filter((i) => i.value !== null);
  const knownWeight = known.reduce((s, i) => s + i.weight, 0);

  const evidenceCoverage = totalWeight > 0 ? weighted.reduce((s, i) => s + i.weight * i.coverage, 0) / totalWeight : 0;
  const rounded = Math.round(evidenceCoverage * 100) / 100;

  if (opts.notIndexed) {
    const base = { score: null, confidence: "insufficient" as const, evidenceCoverage: 0, status: "not-indexed" as const };
    return { criterion, ...base, inputs, caps: [], explanation: opts.explain(base) };
  }

  const isWeakNegative = (i: RubricInput) => i.value === 0 && i.coverage < 1;
  const onlyWeakNegatives = known.length > 0 && known.every(isWeakNegative);
  const someWeakNegative = known.some(isWeakNegative);
  let confidence = confidenceFor(evidenceCoverage);
  const caps: string[] = [];
  const allCaps: (ConfidenceCap | null | false | undefined)[] = [
    someWeakNegative && !onlyWeakNegatives && { max: "medium", reason: "Part of this score rests on something not being found in partially extracted data." },
    ...(opts.caps ?? []),
  ];
  for (const cap of allCaps) {
    if (!cap) continue;
    const next = minConfidence(confidence, cap.max);
    if (next !== confidence) caps.push(cap.reason);
    confidence = next;
  }

  if (knownWeight === 0 || confidence === "insufficient" || onlyWeakNegatives) {
    const base = { score: null, confidence: "insufficient" as const, evidenceCoverage: rounded, status: "insufficient" as const };
    if (onlyWeakNegatives) caps.push("Only absences were observed in partially extracted data; ATLAS does not score on absence alone.");
    return { criterion, ...base, inputs, caps, explanation: opts.explain(base) };
  }

  const score = Math.round((100 * known.reduce((s, i) => s + i.weight * (i.value as number), 0)) / knownWeight);
  const base = { score, confidence, evidenceCoverage: rounded, status: "scored" as const };
  return { criterion, ...base, inputs, caps, explanation: opts.explain(base) };
}
