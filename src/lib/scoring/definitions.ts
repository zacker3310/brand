/**
 * User-facing rubric definitions, rendered inline (expandable) on /compare/systems and included in
 * exports. Keep in sync with rubrics.ts: every weight and threshold stated here is the one used.
 */
import { CORE_COMPONENT_TYPES } from "./rubrics";
import { CONFIDENCE_THRESHOLDS } from "./signals";
import type { CriterionId, InputSource } from "./types";

export interface RubricDefinition {
  id: CriterionId;
  label: string;
  /** One line for checkboxes and table headers. */
  short: string;
  /** The question the rubric answers. */
  question: string;
  method: string[];
  caveats: string[];
  sources: InputSource[];
}

export const RUBRIC_DEFINITIONS: Record<CriterionId, RubricDefinition> = {
  "component-coverage": {
    id: "component-coverage",
    label: "Component coverage",
    short: "Canonical component types implemented",
    question: "How much of a common component vocabulary does the system implement?",
    method: [
      `Score = share of the ${CORE_COMPONENT_TYPES.length} ATLAS core component types implemented by at least one indexed component.`,
      `Core set: ${CORE_COMPONENT_TYPES.join(", ")}.`,
      "Evidence coverage = share of indexed components ATLAS could classify into the taxonomy (unclassified components may cover more types).",
      "Confidence is capped at medium when most classifications are inferred by taxonomy matching.",
    ],
    caveats: ["The core set is an editorial baseline, not a quality standard: specialised systems deliberately omit types."],
    sources: ["components"],
  },
  "accessibility-docs": {
    id: "accessibility-docs",
    label: "Accessibility documentation",
    short: "Components documenting a11y and keyboard use",
    question: "How consistently does the official documentation cover accessibility?",
    method: [
      "Accessibility guidance (weight 0.6): documented components / components whose accessibility field ATLAS checked. Inferred counts half.",
      "Keyboard interaction (weight 0.4): same, for the keyboard field.",
      "Components whose field was not extracted are excluded from the score and lower evidence coverage.",
    ],
    caveats: ["Measures documentation in the official source, not whether the components are accessible."],
    sources: ["components"],
  },
  "framework-compatibility": {
    id: "framework-compatibility",
    label: "Framework compatibility",
    short: "Verified framework implementations",
    question: "How many code frameworks can teams use the system with, verified against official sources?",
    method: [
      "Score = verified code frameworks / 4, capped at 100 (design tools such as Figma are excluded).",
      "Evidence coverage = verified framework claims / all recorded framework claims.",
    ],
    caveats: ["Breadth of choice, not implementation quality; a single-framework system can be excellent."],
    sources: ["registry"],
  },
  "token-architecture": {
    id: "token-architecture",
    label: "Token architecture",
    short: "Tiers, alias layering, theming sets",
    question: "Is the token system layered (primitive → semantic → component) and internally consistent?",
    method: [
      "Tiers present (weight 0.4): primitive, semantic and component tiers found, of 3. Coverage = share of tokens with a tier.",
      "Alias layering (weight 0.3): share of tokens that reference other tokens; full credit at 50%.",
      "Alias integrity (weight 0.15): share of aliases that are not unresolved or cyclic (external references are not broken).",
      "Themed sets (weight 0.15): at least one theme-specific token set.",
      "Confidence is capped at medium when tiers are inferred from names rather than declared by the source.",
    ],
    caveats: ["Only token sets ATLAS ingests are assessed."],
    sources: ["tokens"],
  },
  theming: {
    id: "theming",
    label: "Theming capability",
    short: "Themes incl. dark and high contrast",
    question: "Which themes does the system ship as tokens?",
    method: [
      "Dark theme present (weight 0.45), high-contrast theme present (weight 0.3), distinct themes / 4 (weight 0.25), from token set theme labels.",
      "A theme not found in ingested sets counts as a weak negative (evidence coverage 0.5), never as proof of absence.",
    ],
    caveats: ["Themes that ship outside the ingested token packages are not counted."],
    sources: ["tokens"],
  },
  responsive: {
    id: "responsive",
    label: "Responsive conventions",
    short: "Layout/breakpoint tokens, responsive guidance",
    question: "Does the system define layout conventions and document responsive behaviour?",
    method: [
      "Layout or breakpoint tokens present (weight 0.4). Breakpoint detection by token name is an ATLAS heuristic.",
      "Responsive guidance (weight 0.6): documented components / components whose responsive field ATLAS checked.",
    ],
    caveats: ["Responsive guidance is often written at page level rather than per component."],
    sources: ["tokens", "components"],
  },
  "documentation-depth": {
    id: "documentation-depth",
    label: "Documentation depth",
    short: "Documented fields per component",
    question: "How much of each component does the official documentation describe?",
    method: [
      "For each component: documented fields / fields ATLAS checked, over 12 fields (description, variants, states, sizes, properties, accessibility, keyboard, responsive, tokens, examples, frameworks, relationships). Documented-none counts as documented; inferred counts half.",
      "Score = mean over components. Evidence coverage = mean share of fields checked.",
    ],
    caveats: ["Not-extracted fields are unknown and excluded; they never count against the system."],
    sources: ["components"],
  },
  "source-availability": {
    id: "source-availability",
    label: "Source availability",
    short: "Public repo, OSI license, packages",
    question: "Can teams inspect, adopt and redistribute the source?",
    method: [
      "Public repository recorded (weight 0.35), OSI-approved open-source license (weight 0.4), published packages (weight 0.25), from verified registry facts.",
      "A missing repository or package record is a weak negative (evidence coverage 0.5); an unknown license is excluded.",
    ],
    caveats: ["Availability of source, not quality. Proprietary systems can be well maintained and documented."],
    sources: ["registry"],
  },
  maintenance: {
    id: "maintenance",
    label: "Maintenance evidence",
    short: "Release recency and status",
    question: "Is there recent evidence that the system is maintained?",
    method: [
      "Maintenance status (weight 0.5): active 100%, maintenance 60%, deprecated 15%, archived 0%, unknown excluded.",
      "Release recency (weight 0.5): within 90 days 100%, 180 days 85%, one year 65%, two years 35%, older 10%.",
    ],
    caveats: ["Guideline-only systems often have no versioned releases; that lowers evidence coverage, not the score."],
    sources: ["registry"],
  },
};

export const CONFIDENCE_NOTE = `Confidence follows evidence coverage: high ≥ ${Math.round(CONFIDENCE_THRESHOLDS.high * 100)}%, medium ≥ ${Math.round(
  CONFIDENCE_THRESHOLDS.medium * 100,
)}%, low ≥ ${Math.round(CONFIDENCE_THRESHOLDS.low * 100)}%. Below that ATLAS shows "Insufficient data" instead of a score.`;
