/**
 * Page-scoped contrast correction for the kit's light-mode "inferred" text (--inferred on
 * --inferred-soft measures 3.89:1, below WCAG AA for 11px text). Darkens it to ~6:1 inside catalog
 * pages only. Remove once the integrator adjusts --inferred in globals.css (see requestedChanges).
 */
export const CATALOG_SCOPE = "[&_.text-inferred]:text-[oklch(0.47_0.105_65)] dark:[&_.text-inferred]:text-inferred";
