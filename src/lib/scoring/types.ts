/**
 * Types for ATLAS comparison analytics: system metrics fed to the scoring rubrics, rubric results,
 * and the component comparison model. Pure data, JSON-serializable, shared by server and client.
 */
import type { CoverageMap, CoverageState, MaintenanceStatus, VerificationState } from "@/lib/contracts";

/* -------------------------------------------------------------------------- */
/* Rubrics                                                                     */
/* -------------------------------------------------------------------------- */

export const CRITERIA = [
  "component-coverage",
  "accessibility-docs",
  "framework-compatibility",
  "token-architecture",
  "theming",
  "responsive",
  "documentation-depth",
  "source-availability",
  "maintenance",
] as const;
export type CriterionId = (typeof CRITERIA)[number];

export type Confidence = "high" | "medium" | "low" | "insufficient";

/** Where a rubric input comes from. Component/token inputs only exist for indexed systems. */
export type InputSource = "registry" | "components" | "tokens";

export interface RubricInput {
  key: string;
  label: string;
  /** Human-readable value ("22 of 30", "Active", "Not extracted"). */
  display: string;
  /** Normalized contribution 0..1, or null when unknown (excluded from the score). */
  value: number | null;
  /** How much of this input's evidence ATLAS holds, 0..1 (1 = fully observed). */
  coverage: number;
  /** Relative weight inside the rubric. 0 = informational only. */
  weight: number;
  source: InputSource;
  note?: string;
}

export interface RubricResult {
  criterion: CriterionId;
  /** 0..100, or null when not scored (insufficient evidence or not applicable). */
  score: number | null;
  /** Weighted share of the rubric's evidence ATLAS holds, 0..1. */
  evidenceCoverage: number;
  confidence: Confidence;
  status: "scored" | "insufficient" | "not-indexed";
  inputs: RubricInput[];
  explanation: string;
  /** Reasons the confidence was capped below what coverage alone would give. */
  caps: string[];
}

/** Aggregates for one design system, computed in SQL (src/server/queries/compare.ts). */
export interface SystemMetrics {
  slug: string;
  name: string;
  ingestionStatus: string;
  frameworks: { slug: string; name: string; kind: string; state: VerificationState }[];
  repositoryUrl: string | null;
  license: { slug: string; name: string; spdxId: string | null; isOpenSource: boolean | null } | null;
  packageCount: number;
  maintenanceStatus: MaintenanceStatus;
  latestReleaseAt: string | null;
  latestVersion: string | null;
  components: {
    total: number;
    classified: number;
    classifiedVerified: number;
    types: string[];
    /** field -> coverage state -> number of components. Missing entries are "not-extracted". */
    coverage: Record<string, Partial<Record<CoverageState, number>>>;
    /** Mean over components of documented fields (documented + documented-none + 0.5 inferred). */
    avgDocumentedFields: number | null;
    /** Mean over components of fields ATLAS knows the state of (anything but not-extracted). */
    avgKnownFields: number | null;
    /** Mean over components with >= 1 known field of documented / known. */
    avgDepthRatio: number | null;
    fieldCount: number;
  };
  tokens: {
    total: number;
    primitive: number;
    semantic: number;
    component: number;
    untiered: number;
    tierVerified: number;
    aliases: number;
    aliasResolved: number;
    aliasExternal: number;
    aliasBroken: number;
    layout: number;
    breakpointNamed: number;
    sets: number;
    themedSets: number;
    themes: string[];
  };
  evidence: number;
}

export interface ScoringContext {
  /** Reference date for recency (pass the request time; never read the clock inside rubrics). */
  asOf: Date;
  /** Total canonical component types in the ATLAS taxonomy (from the DB). */
  taxonomySize: number;
}

/* -------------------------------------------------------------------------- */
/* Component comparison model                                                  */
/* -------------------------------------------------------------------------- */

export interface CompareSystemInfo {
  slug: string;
  name: string;
  organization: string | null;
  category: string;
  ingestionStatus: string;
  docsUrl: string | null;
  homepageUrl: string | null;
  lastIngestedAt: string | null;
}

export interface ComponentCandidate {
  id: string;
  slug: string;
  name: string;
  lifecycle: string;
  classificationState: VerificationState;
  classificationMethod: string | null;
  confidence: number;
}

export interface TokenValueView {
  set: string;
  theme: string | null;
  valueText: string | null;
  resolved: unknown;
  aliasState: string | null;
}

export interface ComponentTokenView {
  name: string;
  category: string;
  type: string | null;
  properties: string[];
  values: TokenValueView[];
}

export interface ComponentDetail {
  id: string;
  slug: string;
  name: string;
  aliases: string[];
  description: string | null;
  docsUrl: string | null;
  sourceCodeUrl: string | null;
  lifecycle: string;
  classification: { state: VerificationState; method: string | null; confidence: number };
  sizes: string[] | null;
  responsiveGuidance: string | null;
  coverage: CoverageMap;
  variants: { axis: string; name: string; description: string | null }[];
  states: { name: string; canonical: string | null; description: string | null }[];
  properties: {
    implementation: string;
    name: string;
    type: string | null;
    defaultValue: string | null;
    required: boolean | null;
    deprecated: boolean;
  }[];
  accessibility: {
    ariaPattern: string | null;
    roles: string[] | null;
    keyboard: { keys: string; action: string }[] | null;
    guidance: string | null;
    screenReader: string | null;
    focusManagement: string | null;
    wcagCriteria: string[] | null;
    docsUrl: string | null;
    coverage: CoverageMap;
  } | null;
  frameworks: { slug: string; name: string; packageName: string | null; importName: string | null }[];
  /** First few linked examples per kind (docs-link, storybook-link, code-snippet…). */
  examples: { kind: string; title: string; url: string | null }[];
  /** Total examples per kind. */
  exampleCounts: Record<string, number>;
  tokens: ComponentTokenView[];
  evidence: { count: number; sources: number; lastRetrievedAt: string | null; methods: string[]; hosts: string[] };
}

export type MissingReason = "not-indexed" | "no-component";

export interface ComparisonColumn {
  system: CompareSystemInfo;
  candidates: ComponentCandidate[];
  component: ComponentDetail | null;
  /** Why `component` is null. */
  missing: MissingReason | null;
}

export interface CompareTypeInfo {
  id: string;
  slug: string;
  name: string;
  description: string;
  ariaPattern: string | null;
  group: string | null;
  aliases: string[];
  nearSynonyms: string[];
}

export interface Swatch {
  css: string;
  label: string;
}

export type CellValue =
  | { kind: "coverage"; state: CoverageState; note?: string }
  | { kind: "text"; text: string; mono?: boolean; clamp?: boolean; inferred?: boolean; meta?: string }
  | { kind: "description"; text: string; href: string | null; inferred?: boolean }
  | { kind: "link"; label: string; href: string; meta?: string }
  | { kind: "chips"; items: { label: string; hint?: string }[]; mono?: boolean; inferred?: boolean; meta?: string }
  | { kind: "classification"; state: VerificationState; method: string | null; confidence: number; typeName: string }
  | { kind: "props"; entries: { implementation: string; name: string; type: string | null; defaultValue: string | null; required: boolean | null; deprecated: boolean }[] }
  | { kind: "keyboard"; entries: { keys: string; action: string }[] }
  | {
      kind: "tokens";
      total: number;
      shown: { name: string; valueText: string | null; swatches: Swatch[]; aliasState: string | null; properties: string[] }[];
      moreHref: string | null;
    }
  | { kind: "links"; links: { label: string; href: string }[]; meta?: string }
  | { kind: "count"; value: number; detail?: string };

export interface MatrixCell {
  value: CellValue;
  /** Normalized comparison key: equal keys across all columns mark a row as "same". */
  cmp: string;
}

export interface MatrixRow {
  id: string;
  label: string;
  /** Short hint under the label (e.g. the canonical state name, alignment method). */
  hint?: string;
  /** Marks rows whose cross-system alignment is an ATLAS inference. */
  alignment?: { method: "exact" | "normalized"; names: string[] };
  /** One value that applies to every column (ATLAS reference rows). Cells are then ignored. */
  span?: CellValue;
  cells: Record<string, MatrixCell>;
  same: boolean;
  /** Collapsed behind "Show all" (long prop lists). */
  overflow?: boolean;
}

export interface MatrixGroup {
  id: string;
  title: string;
  description?: string;
  note?: string;
  rows: MatrixRow[];
  allSame: boolean;
  overflowCount: number;
}

export interface ComponentMatrix {
  columns: string[];
  groups: MatrixGroup[];
  rowCount: number;
  differingRowCount: number;
}
