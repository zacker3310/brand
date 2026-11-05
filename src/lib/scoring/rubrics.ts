/**
 * ATLAS system-comparison rubrics. Pure functions of SystemMetrics (+ ScoringContext), unit-tested
 * in tests/unit/scoring/rubrics.test.ts.
 *
 * Principles (see RUBRIC_DEFINITIONS for the user-facing text):
 *  - Score only over inputs ATLAS actually observed. Unknown inputs lower evidence coverage and
 *    confidence; they never lower the score.
 *  - Missing documentation is never treated as poor quality. Systems whose components/tokens are
 *    not indexed get `not-indexed` (null score) for every criterion derived from that data.
 *  - Absence observed in partially extracted data is a weak negative (coverage 0.5), and a score
 *    resting only on weak negatives is withheld (see signals.ts).
 */
import { combine, pct } from "./signals";
import type { CriterionId, RubricInput, RubricResult, ScoringContext, SystemMetrics } from "./types";

/**
 * ATLAS core reference set for component coverage: 30 widely established component types.
 * An editorial baseline (not a quality standard), shown verbatim in the rubric definition.
 */
export const CORE_COMPONENT_TYPES = [
  "button",
  "icon-button",
  "link",
  "menu-button",
  "text-field",
  "textarea",
  "checkbox",
  "radio",
  "switch",
  "select",
  "combobox",
  "slider",
  "date-picker",
  "tabs",
  "breadcrumbs",
  "pagination",
  "menu",
  "table",
  "list",
  "card",
  "tag",
  "badge",
  "avatar",
  "tooltip",
  "accordion",
  "alert",
  "toast",
  "progress-indicator",
  "dialog",
  "popover",
] as const;

const INDEXED = new Set(["indexed", "partial"]);
const isIndexed = (m: SystemMetrics) => INDEXED.has(m.ingestionStatus);
const partialCap = (m: SystemMetrics) =>
  m.ingestionStatus === "partial" ? { max: "medium" as const, reason: "Ingestion for this system is partial." } : null;

const NOT_INDEXED_COMPONENTS = (m: SystemMetrics) =>
  `Not scored: ATLAS holds verified registry facts for ${m.name} but has not indexed its components. This says nothing about the system itself.`;
const NOT_INDEXED_TOKENS = (m: SystemMetrics) =>
  `Not scored: ATLAS has not indexed design tokens for ${m.name}. The system may publish tokens that ATLAS does not ingest yet.`;

/** Coverage-state tallies for one component field. */
export function fieldTally(m: SystemMetrics, field: string) {
  const c = m.components.coverage[field] ?? {};
  const documented = (c.documented ?? 0) + (c["documented-none"] ?? 0);
  const inferred = c.inferred ?? 0;
  const notDocumented = c["not-documented"] ?? 0;
  const known = documented + inferred + notDocumented;
  const notExtracted = Math.max(0, m.components.total - known);
  return { documented, inferred, notDocumented, known, notExtracted, total: m.components.total };
}

/** Input for "share of components that document <field>", over components ATLAS checked. */
function fieldShareInput(m: SystemMetrics, field: string, label: string, weight: number): RubricInput {
  const t = fieldTally(m, field);
  if (t.known === 0) {
    return { key: field, label, display: t.total ? `Not extracted for ${t.total} components` : "No components indexed", value: null, coverage: 0, weight, source: "components" };
  }
  const value = (t.documented + 0.5 * t.inferred) / t.known;
  const parts = [`${t.documented} of ${t.known} checked components document it`];
  if (t.inferred) parts.push(`${t.inferred} inferred (half credit)`);
  if (t.notExtracted) parts.push(`${t.notExtracted} not extracted`);
  return { key: field, label, display: parts.join("; "), value, coverage: t.total ? t.known / t.total : 0, weight, source: "components" };
}

/* -------------------------------------------------------------------------- */

export function scoreComponentCoverage(m: SystemMetrics, ctx: ScoringContext): RubricResult {
  const c = m.components;
  const core = new Set<string>(CORE_COMPONENT_TYPES);
  const covered = c.types.filter((t) => core.has(t));
  const notIndexed = c.total === 0 && !isIndexed(m);
  const inputs: RubricInput[] = [
    {
      key: "core-types",
      label: "ATLAS core types implemented",
      display: c.total ? `${covered.length} of ${core.size}` : "No components indexed",
      value: c.total ? covered.length / core.size : null,
      coverage: c.total ? c.classified / c.total : 0,
      weight: 1,
      source: "components",
      note: c.total && c.classified < c.total ? `${c.total - c.classified} of ${c.total} indexed components are unclassified and may cover further types.` : undefined,
    },
    {
      key: "all-types",
      label: "Canonical types covered (whole taxonomy)",
      display: c.total ? `${c.types.length} of ${ctx.taxonomySize}` : "n/a",
      value: null,
      coverage: 0,
      weight: 0,
      source: "components",
    },
    {
      key: "classification",
      label: "Classification method",
      display: c.classified ? `${c.classifiedVerified} source-declared, ${c.classified - c.classifiedVerified} inferred by taxonomy matching` : "n/a",
      value: null,
      coverage: 0,
      weight: 0,
      source: "components",
    },
  ];
  const mostlyInferred = c.classified > 0 && c.classifiedVerified / c.classified < 0.5;
  return combine("component-coverage", inputs, {
    notIndexed,
    caps: [mostlyInferred && { max: "medium", reason: "Most classifications are inferred by ATLAS taxonomy matching." }, partialCap(m)],
    explain: ({ status }) => {
      if (status === "not-indexed") return NOT_INDEXED_COMPONENTS(m);
      if (!c.total) return `ATLAS indexed ${m.name} but no published components were found, so coverage cannot be assessed.`;
      if (status === "insufficient") return `Insufficient data: only ${c.classified} of ${c.total} indexed components could be classified into the ATLAS taxonomy.`;
      return `Implements ${covered.length} of the ${core.size} ATLAS core component types and ${c.types.length} canonical types overall, based on ${c.total} indexed components (${pct(c.classified, c.total)} classified).`;
    },
  });
}

export function scoreAccessibilityDocs(m: SystemMetrics): RubricResult {
  const notIndexed = m.components.total === 0;
  const inputs = [
    fieldShareInput(m, "accessibility", "Components with accessibility guidance", 0.6),
    fieldShareInput(m, "keyboard", "Components with keyboard interaction docs", 0.4),
  ];
  return combine("accessibility-docs", inputs, {
    notIndexed: notIndexed && !isIndexed(m),
    caps: [partialCap(m)],
    explain: ({ status }) => {
      if (status === "not-indexed") return NOT_INDEXED_COMPONENTS(m);
      if (notIndexed) return `ATLAS indexed ${m.name} but no published components were found.`;
      const a = fieldTally(m, "accessibility");
      const k = fieldTally(m, "keyboard");
      if (status === "insufficient")
        return `Insufficient data: ATLAS checked accessibility documentation for ${a.known} of ${a.total} components and keyboard documentation for ${k.known}.`;
      return `${pct(a.documented, a.known)} of checked components document accessibility guidance and ${pct(k.documented, k.known)} document keyboard interaction. This measures documentation in the official source, not the accessibility of the implementation.`;
    },
  });
}

export function scoreFrameworkCompatibility(m: SystemMetrics): RubricResult {
  const code = m.frameworks.filter((f) => f.kind !== "design");
  const verified = code.filter((f) => f.state === "verified");
  const unverified = code.filter((f) => f.state !== "verified");
  const inputs: RubricInput[] = [
    {
      key: "verified-frameworks",
      label: "Verified framework implementations",
      display: verified.length ? verified.map((f) => f.name).join(", ") : code.length ? "None verified yet" : "No framework claims recorded",
      value: verified.length ? Math.min(verified.length, 4) / 4 : null,
      coverage: code.length ? verified.length / code.length : 0,
      weight: 1,
      source: "registry",
      note: "Breadth saturates at 4 verified frameworks.",
    },
    {
      key: "unverified-frameworks",
      label: "Claimed but not yet verified",
      display: unverified.length ? unverified.map((f) => f.name).join(", ") : "None",
      value: null,
      coverage: 0,
      weight: 0,
      source: "registry",
    },
  ];
  return combine("framework-compatibility", inputs, {
    explain: ({ status }) => {
      if (!code.length) return `Insufficient data: no framework support is recorded for ${m.name}.`;
      if (status === "insufficient")
        return `Insufficient data: ${code.length} framework claim${code.length === 1 ? "" : "s"} recorded, ${verified.length} verified against official sources.`;
      return `${verified.length} verified framework implementation${verified.length === 1 ? "" : "s"} (${verified.map((f) => f.name).join(", ")}). Scores breadth of choice, not implementation quality.`;
    },
  });
}

export function scoreTokenArchitecture(m: SystemMetrics): RubricResult {
  const t = m.tokens;
  if (t.total === 0) {
    return combine("token-architecture", [], {
      notIndexed: !isIndexed(m),
      explain: ({ status }) => (status === "not-indexed" ? NOT_INDEXED_TOKENS(m) : `Insufficient data: no design tokens are indexed for ${m.name} yet.`),
    });
  }
  const tiered = t.total - t.untiered;
  const tiersPresent = [t.primitive, t.semantic, t.component].filter((n) => n > 0).length;
  const aliasRatio = t.aliases / t.total;
  const inputs: RubricInput[] = [
    {
      key: "tiers",
      label: "Token tiers present (primitive / semantic / component)",
      display: `${tiersPresent} of 3 (${t.primitive} / ${t.semantic} / ${t.component}${t.untiered ? `, ${t.untiered} untiered` : ""})`,
      value: tiersPresent / 3,
      coverage: tiered / t.total,
      weight: 0.4,
      source: "tokens",
    },
    {
      key: "alias-ratio",
      label: "Alias layering (tokens referencing other tokens)",
      display: `${pct(t.aliases, t.total)} of ${t.total} tokens are aliases`,
      value: Math.min(1, aliasRatio / 0.5),
      coverage: 1,
      weight: 0.3,
      source: "tokens",
      note: "Full credit at 50% or more aliases.",
    },
    {
      key: "alias-integrity",
      label: "Alias integrity (no unresolved or cyclic references)",
      display: t.aliases ? `${t.aliasBroken} broken of ${t.aliases} aliases${t.aliasExternal ? ` (${t.aliasExternal} reference external packages)` : ""}` : "No aliases",
      value: t.aliases ? 1 - t.aliasBroken / t.aliases : null,
      coverage: t.aliases ? 1 : 0,
      weight: t.aliases ? 0.15 : 0,
      source: "tokens",
    },
    {
      key: "themed-sets",
      label: "Theme-specific token sets",
      display: t.themedSets ? `${t.themedSets} of ${t.sets} sets are themed` : `None found in ${t.sets} ingested sets`,
      value: t.themedSets ? 1 : 0,
      coverage: t.themedSets ? 1 : 0.5,
      weight: 0.15,
      source: "tokens",
    },
  ];
  const tierInferred = tiered > 0 && t.tierVerified / tiered < 0.5;
  return combine("token-architecture", inputs, {
    caps: [tierInferred && { max: "medium", reason: "Token tiers are inferred by ATLAS from names and alias structure." }, partialCap(m)],
    explain: ({ status }) =>
      status === "insufficient"
        ? `Insufficient data: tiers could be determined for ${pct(tiered, t.total)} of ${t.total} indexed tokens.`
        : `${t.total} tokens in ${t.sets} sets: ${tiersPresent} of 3 tiers present, ${pct(t.aliases, t.total)} aliases, ${t.themedSets} themed set${t.themedSets === 1 ? "" : "s"}.`,
  });
}

const DARK_RE = /dark|night|g90|g100|dim/i;
const HC_RE = /high[-_ ]?contrast|(^|[-_])hc($|[-_])|increased[-_ ]?contrast/i;

export function themeTraits(themes: string[]) {
  return {
    dark: themes.some((t) => DARK_RE.test(t)),
    highContrast: themes.some((t) => HC_RE.test(t)),
    count: new Set(themes.map((t) => t.toLowerCase())).size,
  };
}

export function scoreTheming(m: SystemMetrics): RubricResult {
  const t = m.tokens;
  if (t.total === 0) {
    return combine("theming", [], {
      notIndexed: !isIndexed(m),
      explain: ({ status }) => (status === "not-indexed" ? NOT_INDEXED_TOKENS(m) : `Insufficient data: no design tokens are indexed for ${m.name} yet.`),
    });
  }
  const tr = themeTraits(t.themes);
  const inputs: RubricInput[] = [
    {
      key: "dark",
      label: "Dark theme",
      display: tr.dark ? "Present" : "Not found in ingested token sets",
      value: tr.dark ? 1 : 0,
      coverage: tr.dark ? 1 : 0.5,
      weight: 0.45,
      source: "tokens",
    },
    {
      key: "high-contrast",
      label: "High-contrast theme",
      display: tr.highContrast ? "Present" : "Not found in ingested token sets",
      value: tr.highContrast ? 1 : 0,
      coverage: tr.highContrast ? 1 : 0.5,
      weight: 0.3,
      source: "tokens",
    },
    {
      key: "theme-count",
      label: "Distinct themes",
      display: tr.count ? `${tr.count}: ${t.themes.join(", ")}` : "None labelled",
      value: Math.min(tr.count, 4) / 4,
      coverage: tr.count ? 1 : 0.5,
      weight: 0.25,
      source: "tokens",
      note: "Full credit at 4 or more themes.",
    },
  ];
  return combine("theming", inputs, {
    caps: [partialCap(m)],
    explain: ({ status }) =>
      status === "insufficient"
        ? `Insufficient data: none of the ${t.sets} ingested token sets is labelled with a theme. Themes may ship in sources ATLAS does not ingest.`
        : `${tr.count} theme${tr.count === 1 ? "" : "s"} in ingested token sets (${t.themes.join(", ")}). Based on ingested token sets only; themes shipped elsewhere are not counted.`,
  });
}

export function scoreResponsive(m: SystemMetrics): RubricResult {
  const t = m.tokens;
  const hasLayout = t.layout + t.breakpointNamed > 0;
  const guidance = fieldShareInput(m, "responsive", "Components with responsive guidance", 0.6);
  const inputs: RubricInput[] = [
    {
      key: "layout-tokens",
      label: "Layout / breakpoint tokens",
      display: t.total ? (hasLayout ? `${t.layout} layout tokens, ${t.breakpointNamed} breakpoint-named` : "None found in ingested token sets") : "No tokens indexed",
      value: t.total ? (hasLayout ? 1 : 0) : null,
      coverage: t.total ? (hasLayout ? 1 : 0.5) : 0,
      weight: 0.4,
      source: "tokens",
      note: "Breakpoint detection by token name is an ATLAS heuristic.",
    },
    guidance,
  ];
  const nothing = t.total === 0 && m.components.total === 0;
  return combine("responsive", inputs, {
    notIndexed: nothing && !isIndexed(m),
    caps: [partialCap(m)],
    explain: ({ status }) => {
      if (status === "not-indexed") return NOT_INDEXED_COMPONENTS(m);
      const g = fieldTally(m, "responsive");
      if (status === "insufficient")
        return `Insufficient data: responsive guidance was checked for ${g.known} of ${g.total} components${t.total ? "" : " and no tokens are indexed"}.`;
      return `${hasLayout ? "Layout tokens present" : "No layout tokens found"}; ${g.known ? `${pct(g.documented, g.known)} of checked components document responsive behaviour` : "responsive guidance not extracted"}.`;
    },
  });
}

export function scoreDocumentationDepth(m: SystemMetrics): RubricResult {
  const c = m.components;
  const inputs: RubricInput[] = [
    {
      key: "depth",
      label: "Documented fields per component (of fields ATLAS checked)",
      display:
        c.avgDepthRatio === null
          ? "Not extracted"
          : `${(c.avgDocumentedFields ?? 0).toFixed(1)} documented of ${(c.avgKnownFields ?? 0).toFixed(1)} checked, out of ${c.fieldCount} fields`,
      value: c.avgDepthRatio,
      coverage: c.avgKnownFields === null ? 0 : c.avgKnownFields / c.fieldCount,
      weight: 1,
      source: "components",
    },
  ];
  return combine("documentation-depth", inputs, {
    notIndexed: c.total === 0 && !isIndexed(m),
    caps: [partialCap(m)],
    explain: ({ status }) => {
      if (status === "not-indexed") return NOT_INDEXED_COMPONENTS(m);
      if (!c.total) return `ATLAS indexed ${m.name} but no published components were found.`;
      if (status === "insufficient")
        return `Insufficient data: ATLAS has checked on average ${(c.avgKnownFields ?? 0).toFixed(1)} of ${c.fieldCount} documentation fields per component.`;
      return `On average ${(c.avgDocumentedFields ?? 0).toFixed(1)} of ${c.fieldCount} documentation fields per component are documented (${Math.round(100 * (c.avgDepthRatio ?? 0))}% of the fields ATLAS checked).`;
    },
  });
}

export function scoreSourceAvailability(m: SystemMetrics): RubricResult {
  const lic = m.license;
  const inputs: RubricInput[] = [
    {
      key: "repository",
      label: "Public source repository",
      display: m.repositoryUrl ? "Recorded" : "None recorded",
      value: m.repositoryUrl ? 1 : 0,
      coverage: m.repositoryUrl ? 1 : 0.5,
      weight: 0.35,
      source: "registry",
    },
    {
      key: "license",
      label: "OSI open-source license",
      display: !lic ? "License not recorded" : lic.isOpenSource === null ? `${lic.name} (open-source status unknown)` : `${lic.spdxId ?? lic.name}${lic.isOpenSource ? "" : " (not open source)"}`,
      value: !lic || lic.isOpenSource === null ? null : lic.isOpenSource ? 1 : 0,
      coverage: !lic || lic.isOpenSource === null ? 0 : 1,
      weight: 0.4,
      source: "registry",
    },
    {
      key: "packages",
      label: "Published packages",
      display: m.packageCount ? `${m.packageCount} package${m.packageCount === 1 ? "" : "s"}` : "None recorded",
      value: m.packageCount ? 1 : 0,
      coverage: m.packageCount ? 1 : 0.5,
      weight: 0.25,
      source: "registry",
    },
  ];
  return combine("source-availability", inputs, {
    explain: ({ status }) =>
      status === "insufficient"
        ? `Insufficient data: the registry entry for ${m.name} records too little about its source, license and packages.`
        : `${m.repositoryUrl ? "Public repository" : "No public repository recorded"}, ${lic ? (lic.spdxId ?? lic.name) : "license not recorded"}, ${m.packageCount} published package${m.packageCount === 1 ? "" : "s"}. Measures availability of source, not quality.`,
  });
}

const STATUS_VALUE: Record<string, number | null> = { active: 1, maintenance: 0.6, deprecated: 0.15, archived: 0, unknown: null };

/** Release recency curve: days since latest release -> 0..1. */
export function recencyValue(days: number): number {
  if (days <= 90) return 1;
  if (days <= 180) return 0.85;
  if (days <= 365) return 0.65;
  if (days <= 730) return 0.35;
  return 0.1;
}

export function daysSince(iso: string | null, asOf: Date): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((asOf.getTime() - t) / 86_400_000));
}

export function scoreMaintenance(m: SystemMetrics, ctx: ScoringContext): RubricResult {
  const days = daysSince(m.latestReleaseAt, ctx.asOf);
  const sv = STATUS_VALUE[m.maintenanceStatus] ?? null;
  const inputs: RubricInput[] = [
    {
      key: "status",
      label: "Maintenance status (registry)",
      display: m.maintenanceStatus === "unknown" ? "Unknown" : m.maintenanceStatus[0]!.toUpperCase() + m.maintenanceStatus.slice(1),
      value: sv,
      coverage: sv === null ? 0 : 1,
      weight: 0.5,
      source: "registry",
    },
    {
      key: "release-recency",
      label: "Latest release",
      display: days === null ? "No release date recorded" : `${m.latestVersion ? `v${m.latestVersion.replace(/^v/, "")}, ` : ""}${days} day${days === 1 ? "" : "s"} ago`,
      value: days === null ? null : recencyValue(days),
      coverage: days === null ? 0 : 1,
      weight: 0.5,
      source: "registry",
      note: "Full credit within 90 days; 85% within 180; 65% within a year; 35% within two years.",
    },
  ];
  return combine("maintenance", inputs, {
    explain: ({ status }) =>
      status === "insufficient"
        ? `Insufficient data: neither a maintenance status nor a release date is recorded for ${m.name}.`
        : `Status ${m.maintenanceStatus}${days === null ? "; no release date recorded (common for guideline-only systems)" : `; latest release ${days} days ago`}.`,
  });
}

/* -------------------------------------------------------------------------- */

export const RUBRIC_FUNCTIONS: Record<CriterionId, (m: SystemMetrics, ctx: ScoringContext) => RubricResult> = {
  "component-coverage": scoreComponentCoverage,
  "accessibility-docs": (m) => scoreAccessibilityDocs(m),
  "framework-compatibility": (m) => scoreFrameworkCompatibility(m),
  "token-architecture": (m) => scoreTokenArchitecture(m),
  theming: (m) => scoreTheming(m),
  responsive: (m) => scoreResponsive(m),
  "documentation-depth": (m) => scoreDocumentationDepth(m),
  "source-availability": (m) => scoreSourceAvailability(m),
  maintenance: scoreMaintenance,
};

export function scoreSystem(m: SystemMetrics, criteria: readonly CriterionId[], ctx: ScoringContext): RubricResult[] {
  return criteria.map((c) => RUBRIC_FUNCTIONS[c](m, ctx));
}
