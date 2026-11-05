/**
 * Page-scoped contrast correction for two kit tokens in light mode: "inferred" text on
 * --inferred-soft measures 3.89:1 and "conflicting" text on --conflicting-soft 4.48:1, both below
 * WCAG AA for 10-11px text. Darkened to >= 6:1 inside catalog pages only. Remove once the integrator
 * adjusts the tokens in globals.css (see requestedChanges).
 */
export const CATALOG_SCOPE =
  "[&_.text-inferred]:text-[oklch(0.47_0.105_65)] dark:[&_.text-inferred]:text-inferred [&_.text-conflicting]:text-[oklch(0.49_0.18_25)] dark:[&_.text-conflicting]:text-conflicting";
