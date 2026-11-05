/**
 * Shared ATLAS contracts. Every workstream (registry, ingestion, adapters, UI, search) codes
 * against these types. Zod schemas validate data crossing trust boundaries: registry JSON
 * files, adapter output, API inputs.
 *
 * OWNERSHIP: foundational. Only the integrator edits this file. Propose changes, don't fork it.
 */
import { z } from "zod";

/* -------------------------------------------------------------------------- */
/* Shared vocabulary                                                           */
/* -------------------------------------------------------------------------- */

export const VERIFICATION_STATES = ["verified", "inferred", "unverified", "unavailable", "conflicting"] as const;
export const VerificationState = z.enum(VERIFICATION_STATES);
export type VerificationState = z.infer<typeof VerificationState>;

export const SYSTEM_CATEGORIES = [
  "design-system",
  "design-language",
  "component-library",
  "headless-library",
  "css-framework",
  "ui-framework",
  "styling-engine",
  "web-components",
  "commercial-suite",
  "pattern-library",
] as const;
export const SystemCategory = z.enum(SYSTEM_CATEGORIES);
export type SystemCategory = z.infer<typeof SystemCategory>;

export const SYSTEM_CATEGORY_LABELS: Record<SystemCategory, string> = {
  "design-system": "Design system",
  "design-language": "Design language",
  "component-library": "Component library",
  "headless-library": "Headless library",
  "css-framework": "CSS framework",
  "ui-framework": "UI framework",
  "styling-engine": "Styling engine",
  "web-components": "Web components",
  "commercial-suite": "Commercial suite",
  "pattern-library": "Pattern library",
};

export const MAINTENANCE_STATUSES = ["active", "maintenance", "deprecated", "archived", "unknown"] as const;
export const MaintenanceStatus = z.enum(MAINTENANCE_STATUSES);
export type MaintenanceStatus = z.infer<typeof MaintenanceStatus>;

export const DOC_ACCESS = ["public", "partial", "private", "unknown"] as const;
export const DocAccess = z.enum(DOC_ACCESS);
export type DocAccess = z.infer<typeof DocAccess>;

export const REGISTRY_STATUSES = ["candidate", "verified", "rejected", "duplicate", "replaced"] as const;
export const RegistryStatus = z.enum(REGISTRY_STATUSES);
export type RegistryStatus = z.infer<typeof RegistryStatus>;

export const INGESTION_STATUSES = [
  "not_started",
  "queued",
  "running",
  "metadata_only",
  "partial",
  "indexed",
  "failed",
  "blocked",
  "unsupported",
] as const;
export type IngestionStatus = (typeof INGESTION_STATUSES)[number];

export const REDISTRIBUTION = ["permitted", "conditional", "restricted", "unknown"] as const;
export const Redistribution = z.enum(REDISTRIBUTION);
export type Redistribution = z.infer<typeof Redistribution>;

export const TOKEN_CATEGORIES = [
  "color",
  "typography",
  "spacing",
  "shape",
  "elevation",
  "motion",
  "layout",
  "opacity",
  "other",
] as const;
export const TokenCategory = z.enum(TOKEN_CATEGORIES);
export type TokenCategory = z.infer<typeof TokenCategory>;

export const TOKEN_TIERS = ["primitive", "semantic", "component"] as const;
export const TokenTier = z.enum(TOKEN_TIERS);
export type TokenTier = z.infer<typeof TokenTier>;

/**
 * Per-field coverage. This is how ATLAS distinguishes "absent documentation" from
 * "absent capability" from "we haven't looked".
 *  - documented:       source documents it; values are stored
 *  - documented-none:  source explicitly documents that it does not exist / is unsupported (absent capability)
 *  - not-documented:   ATLAS checked the source and it does not document this (absent documentation)
 *  - not-extracted:    ATLAS has not parsed this field for this record (unknown)
 *  - inferred:         derived heuristically by ATLAS, not a source claim
 */
export const COVERAGE_STATES = ["documented", "documented-none", "not-documented", "not-extracted", "inferred"] as const;
export const CoverageState = z.enum(COVERAGE_STATES);
export type CoverageState = z.infer<typeof CoverageState>;

export const COMPONENT_FIELDS = [
  "description",
  "variants",
  "states",
  "sizes",
  "properties",
  "accessibility",
  "keyboard",
  "responsive",
  "tokens",
  "examples",
  "frameworks",
  "relationships",
] as const;
export type ComponentField = (typeof COMPONENT_FIELDS)[number];
export type CoverageMap = Partial<Record<string, CoverageState>>;

export const KeyboardInteraction = z.object({
  keys: z.string().min(1), // "Enter", "Space", "ArrowDown", "Shift+Tab"
  action: z.string().min(1), // concise ATLAS paraphrase of the documented behavior
});
export type KeyboardInteraction = z.infer<typeof KeyboardInteraction>;

export interface FieldChange {
  field: string;
  before?: unknown;
  after?: unknown;
  summary?: string;
}

export interface RunStats {
  discovered?: number;
  fetched?: number;
  notModified?: number;
  fetchErrors?: number;
  parsed?: number;
  parseErrors?: number;
  extracted?: number;
  valid?: number;
  warnings?: number;
  quarantined?: number;
  published?: number;
  created?: number;
  updated?: number;
  unchanged?: number;
  removed?: number;
  components?: number;
  tokens?: number;
  patterns?: number;
  durationMs?: number;
  [k: string]: number | undefined;
}

export interface SystemCoverageSummary {
  components: number;
  componentsClassified: number;
  componentsWithVariants: number;
  componentsWithProps: number;
  componentsWithA11y: number;
  tokens: number;
  tokenSets: number;
  tokenCategories: Partial<Record<TokenCategory, number>>;
  patterns: number;
  sourcesChecked: number;
  sourcesOk: number;
  evidence: number;
  computedAt: string;
}

export interface RegistryEvidenceSummary {
  checks: { field: string; url: string; status: number | null; ok: boolean; checkedAt: string; note?: string }[];
}

/* -------------------------------------------------------------------------- */
/* Evidence                                                                    */
/* -------------------------------------------------------------------------- */

export const EvidenceInput = z.object({
  field: z.string().min(1), // "*" for whole record
  sourceUrl: z.url(),
  sourceTitle: z.string().nullish(),
  retrievedAt: z.string(), // ISO timestamp
  contentHash: z.string().nullish(),
  extractionMethod: z.string().min(1), // "adapter:primer:docs-json"
  location: z.string().nullish(), // "packages/react/src/Button/Button.docs.json#/props"
  excerpt: z.string().max(300).nullish(),
  state: VerificationState,
  confidence: z.number().min(0).max(1),
});
export type EvidenceInput = z.infer<typeof EvidenceInput>;

/* -------------------------------------------------------------------------- */
/* Registry (data/registry/*.json)                                             */
/* -------------------------------------------------------------------------- */

export const PackageRef = z.object({
  name: z.string().min(1),
  registry: z.enum(["npm", "pub", "cocoapods", "maven", "nuget", "other"]),
  url: z.url(),
});
export type PackageRef = z.infer<typeof PackageRef>;

export const LicenseRef = z.object({
  slug: z.string().min(1), // "mit" | "apache-2.0" | "proprietary" | "polaris-license" ...
  spdxId: z.string().nullable(),
  name: z.string().min(1),
  url: z.url().nullable(),
  isOpenSource: z.boolean().nullable(),
  redistribution: Redistribution,
  notes: z.string().nullish(),
});
export type LicenseRef = z.infer<typeof LicenseRef>;

export const RegistryCheck = z.object({
  field: z.string(), // homepageUrl | docsUrl | repositoryUrl | figmaUrl | license | maintenance | package:<name>
  url: z.url(),
  status: z.number().int().nullable(), // final HTTP status (null if network failure)
  finalUrl: z.url().nullish(), // after redirects
  ok: z.boolean(),
  checkedAt: z.string(),
  method: z.enum(["http-check", "page-content", "package-metadata", "repo-metadata", "manual-review"]),
  note: z.string().max(400).nullish(), // what the check established, e.g. "npm latest 11.10.0 published 2026-10-21"
});
export type RegistryCheck = z.infer<typeof RegistryCheck>;

export const RegistryEntry = z.object({
  rank: z.number().int().min(1).max(100).nullable(), // position in the initial research queue; null for replacements
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  name: z.string().min(1),
  aliases: z.array(z.string()).default([]),
  organization: z.object({ slug: z.string(), name: z.string(), websiteUrl: z.url().nullable() }),
  category: SystemCategory,
  summary: z.string().min(20).max(400), // ATLAS-authored, factual, no marketing
  homepageUrl: z.url(),
  docsUrl: z.url().nullable(),
  repositoryUrl: z.url().nullable(),
  figmaUrl: z.url().nullable(), // ONLY if verified official
  storybookUrl: z.url().nullable(),
  packages: z.array(PackageRef).default([]),
  license: LicenseRef.nullable(),
  docAccess: DocAccess,
  maintenanceStatus: MaintenanceStatus,
  latestVersion: z.string().nullable(),
  latestReleaseAt: z.string().nullable(), // ISO date
  frameworks: z
    .array(z.object({ slug: z.string(), packageName: z.string().nullish(), support: z.enum(["official", "community"]).default("official") }))
    .default([]),
  platforms: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  relatedSlugs: z.array(z.string()).default([]), // e.g. react-spectrum -> adobe-spectrum
  registryStatus: RegistryStatus,
  duplicateOf: z.string().nullable().default(null),
  replacesSlug: z.string().nullable().default(null),
  replacedBy: z.string().nullable().default(null),
  notes: z.string().max(1200), // classification + dedup reasoning, honest caveats
  checks: z.array(RegistryCheck).min(1),
  confidence: z.number().min(0).max(1),
  verifiedAt: z.string(),
});
export type RegistryEntry = z.infer<typeof RegistryEntry>;

/* -------------------------------------------------------------------------- */
/* Adapter output (normalized observations)                                    */
/* -------------------------------------------------------------------------- */

export const NormalizedVariant = z.object({
  axis: z.string().default("variant"), // variant | appearance | size | emphasis | shape | density | tone
  name: z.string().min(1),
  description: z.string().nullish(),
  sourceUrl: z.url().nullish(),
  location: z.string().nullish(),
});

export const NormalizedState = z.object({
  name: z.string().min(1),
  canonical: z.string().nullish(),
  description: z.string().nullish(),
  sourceUrl: z.url().nullish(),
});

export const NormalizedProperty = z.object({
  implementation: z.string().default("default"),
  name: z.string().min(1),
  type: z.string().nullish(),
  defaultValue: z.string().nullish(),
  required: z.boolean().nullish(),
  deprecated: z.boolean().default(false),
  description: z.string().max(600).nullish(),
  allowedValues: z.array(z.string()).nullish(),
  sourceUrl: z.url().nullish(),
});

export const NormalizedAccessibility = z.object({
  ariaPattern: z.string().nullish(),
  roles: z.array(z.string()).nullish(),
  keyboard: z.array(KeyboardInteraction).nullish(),
  guidance: z.string().max(1200).nullish(),
  screenReader: z.string().max(800).nullish(),
  focusManagement: z.string().max(800).nullish(),
  wcagCriteria: z.array(z.string()).nullish(),
  docsUrl: z.url().nullish(),
  coverage: z.record(z.string(), CoverageState).default({}),
});

export const NormalizedExample = z.object({
  slug: z.string().min(1),
  title: z.string().min(1),
  kind: z.enum(["code-snippet", "docs-link", "storybook-link", "atlas-representation"]),
  language: z.string().nullish(),
  code: z.string().max(4000).nullish(), // only if license permits redistribution
  url: z.url().nullish(),
  attribution: z.string().nullish(),
});

export const NormalizedComponent = z.object({
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  name: z.string().min(1),
  aliases: z.array(z.string()).default([]),
  description: z.string().max(1200).nullish(),
  docsUrl: z.url().nullish(),
  sourceCodeUrl: z.url().nullish(),
  lifecycle: z.enum(["stable", "beta", "experimental", "deprecated", "unknown"]).default("unknown"),
  /** Canonical taxonomy slug if the adapter can classify it with certainty (e.g. source says "Combobox"). */
  canonicalType: z.string().nullish(),
  classification: z
    .object({ state: z.enum(["verified", "inferred"]), method: z.string(), confidence: z.number().min(0).max(1) })
    .nullish(),
  frameworks: z
    .array(z.object({ slug: z.string(), packageName: z.string().nullish(), importName: z.string().nullish(), sourceUrl: z.url().nullish() }))
    .default([]),
  variants: z.array(NormalizedVariant).default([]),
  states: z.array(NormalizedState).default([]),
  sizes: z.array(z.string()).nullish(),
  properties: z.array(NormalizedProperty).default([]),
  accessibility: NormalizedAccessibility.nullish(),
  examples: z.array(NormalizedExample).default([]),
  relationships: z
    .array(z.object({ kind: z.string(), targetSlug: z.string().nullish(), targetType: z.string().nullish() }))
    .default([]),
  tokenUsages: z.array(z.object({ tokenName: z.string(), property: z.string().nullish() })).default([]),
  responsiveGuidance: z.string().max(800).nullish(),
  coverage: z.record(z.string(), CoverageState).default({}),
  evidence: z.array(EvidenceInput).min(1),
});
export type NormalizedComponent = z.infer<typeof NormalizedComponent>;

export const NormalizedToken = z.object({
  name: z.string().min(1), // as authored: "fgColor.default" or "--color-fg-default"
  path: z.array(z.string()).min(1),
  cssVar: z.string().nullish(),
  type: z.string().nullish(), // DTCG $type if known
  category: TokenCategory,
  tier: TokenTier.nullish(),
  tierState: z.enum(["verified", "inferred"]).default("inferred"),
  rawValue: z.unknown(), // as authored. References as "{path.to.token}" strings (DTCG) or "var(--x)"
  /** Raw reference targets found in rawValue, normalized to token names in the same system. */
  references: z.array(z.string()).default([]),
  description: z.string().max(600).nullish(),
  deprecated: z.boolean().default(false),
  location: z.string().nullish(),
});
export type NormalizedToken = z.infer<typeof NormalizedToken>;

export const NormalizedTokenSet = z.object({
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  name: z.string().min(1),
  theme: z.string().nullish(),
  format: z.enum(["dtcg", "style-dictionary", "css-vars", "js-module", "scss", "json"]),
  sourceUrl: z.url(),
  packageName: z.string().nullish(),
  packageVersion: z.string().nullish(),
  license: LicenseRef.nullish(),
  redistribution: Redistribution.default("unknown"),
  tokens: z.array(NormalizedToken),
  evidence: z.array(EvidenceInput).min(1),
});
export type NormalizedTokenSet = z.infer<typeof NormalizedTokenSet>;

export const NormalizedPattern = z.object({
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  name: z.string().min(1),
  description: z.string().max(1200).nullish(),
  docsUrl: z.url().nullish(),
  canonicalType: z.string().nullish(),
  classification: z
    .object({ state: z.enum(["verified", "inferred"]), method: z.string(), confidence: z.number().min(0).max(1) })
    .nullish(),
  componentSlugs: z.array(z.string()).default([]),
  coverage: z.record(z.string(), CoverageState).default({}),
  evidence: z.array(EvidenceInput).min(1),
});
export type NormalizedPattern = z.infer<typeof NormalizedPattern>;

/** Facts about the system itself discovered during ingestion (version, philosophy, principles...). */
export const NormalizedSystemFacts = z.object({
  latestVersion: z.string().nullish(),
  latestReleaseAt: z.string().nullish(),
  philosophy: z.string().max(1500).nullish(), // ATLAS-authored synthesis; must have evidence
  principles: z.array(z.object({ name: z.string(), sourceUrl: z.url() })).nullish(),
  frameworks: z.array(z.object({ slug: z.string(), packageName: z.string().nullish() })).nullish(),
  evidence: z.array(EvidenceInput).default([]),
});
export type NormalizedSystemFacts = z.infer<typeof NormalizedSystemFacts>;

export const NormalizedBundle = z.object({
  systemSlug: z.string(),
  components: z.array(NormalizedComponent).default([]),
  tokenSets: z.array(NormalizedTokenSet).default([]),
  patterns: z.array(NormalizedPattern).default([]),
  facts: NormalizedSystemFacts.nullish(),
});
export type NormalizedBundle = z.infer<typeof NormalizedBundle>;

export interface ValidationIssue {
  entityKind: "component" | "token-set" | "token" | "pattern" | "system-facts" | "bundle";
  entityKey: string;
  code: string; // REQUIRED_FIELD | INVALID_URL | DUPLICATE | CONFLICT | INVALID_TOKEN_VALUE | MISSING_EVIDENCE | SUSPICIOUS | UNKNOWN_TYPE | FRAMEWORK_MISMATCH
  message: string;
  path?: string;
  severity: "error" | "warning";
}

/* -------------------------------------------------------------------------- */
/* API inputs                                                                  */
/* -------------------------------------------------------------------------- */

export const Pagination = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(24),
});

export const SearchEntityType = z.enum(["system", "component", "component-type", "pattern", "pattern-type", "token", "framework", "category"]);
export type SearchEntityType = z.infer<typeof SearchEntityType>;

export const SearchQuery = z.object({
  q: z.string().trim().max(200).default(""),
  types: z.array(SearchEntityType).optional(),
  systems: z.array(z.string()).optional(),
  frameworks: z.array(z.string()).optional(),
  platforms: z.array(z.string()).optional(),
  categories: z.array(z.string()).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});
export type SearchQuery = z.infer<typeof SearchQuery>;

export interface SearchHit {
  entityType: SearchEntityType;
  entityId: string;
  title: string;
  subtitle: string | null;
  url: string;
  systemSlug: string | null;
  score: number;
  highlight: string | null;
  facets: Record<string, unknown>;
}

export interface SearchResult {
  query: string;
  normalizedQuery: string;
  expansions: string[]; // synonyms applied
  interpretedFilters: Record<string, string[]>; // e.g. "React combobox" -> frameworks:[react]
  total: number;
  hits: SearchHit[];
  facets: Record<string, { value: string; count: number }[]>;
  tookMs: number;
}
