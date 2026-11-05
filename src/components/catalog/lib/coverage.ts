import { COMPONENT_FIELDS, COVERAGE_STATES, type ComponentField, type CoverageMap, type CoverageState } from "@/lib/contracts";

export const FIELD_LABELS: Record<ComponentField, string> = {
  description: "Description",
  variants: "Variants",
  states: "States",
  sizes: "Sizes",
  properties: "Props / API",
  accessibility: "Accessibility",
  keyboard: "Keyboard",
  responsive: "Responsive",
  tokens: "Tokens",
  examples: "Examples",
  frameworks: "Frameworks",
  relationships: "Relationships",
};

const STATES = new Set<string>(COVERAGE_STATES);

/** Reads a field's coverage state. Missing or malformed entries are "not-extracted" (unknown), never "none". */
export function fieldState(coverage: CoverageMap | null | undefined, field: string): CoverageState {
  const v = coverage?.[field];
  return v && STATES.has(v) ? v : "not-extracted";
}

export type CoverageCounts = Record<CoverageState, number>;

export function coverageCounts(coverage: CoverageMap | null | undefined): CoverageCounts {
  const counts: CoverageCounts = { documented: 0, "documented-none": 0, "not-documented": 0, "not-extracted": 0, inferred: 0 };
  for (const f of COMPONENT_FIELDS) counts[fieldState(coverage, f)]++;
  return counts;
}

/**
 * Share of the 12 component fields for which the source gives an answer ("documented" or
 * "documented-none"). Inferred fields do not count: they are ATLAS heuristics, not source claims.
 */
export function documentedShare(coverage: CoverageMap | null | undefined): number {
  const c = coverageCounts(coverage);
  return (c.documented + c["documented-none"]) / COMPONENT_FIELDS.length;
}

export function coverageSummaryText(coverage: CoverageMap | null | undefined): string {
  const c = coverageCounts(coverage);
  const parts = [
    `${c.documented + c["documented-none"]} of ${COMPONENT_FIELDS.length} fields documented`,
    c.inferred ? `${c.inferred} inferred` : null,
    c["not-documented"] ? `${c["not-documented"]} not documented` : null,
    c["not-extracted"] ? `${c["not-extracted"]} not extracted` : null,
  ].filter(Boolean);
  return parts.join(", ");
}

/** Accessibility availability for a component: documented when either a11y guidance or keyboard support is documented. */
export function a11yState(coverage: CoverageMap | null | undefined): CoverageState {
  const a = fieldState(coverage, "accessibility");
  const k = fieldState(coverage, "keyboard");
  const rank: CoverageState[] = ["documented", "documented-none", "inferred", "not-documented", "not-extracted"];
  return rank.find((s) => s === a || s === k) ?? "not-extracted";
}
