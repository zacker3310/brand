/**
 * Source locations, identifiers and static configuration for the Atlassian Design System adapter.
 *
 * Sources (all first-party, Atlassian):
 *  - atlassian.design: Gatsby-prerendered HTML (static; robots.txt is absent -> unrestricted per RFC 9309).
 *    Side navigation (component list, categories, release-phase lozenges), per-component tabs
 *    (examples / code / usage), foundations/content guidance pages, About page (values + principles).
 *  - registry.npmjs.org: per-package `latest` manifests of @atlaskit/* (version, description, license,
 *    peerDependencies, `atlassian.website` docs metadata) and the @atlaskit/button packument (release time).
 *  - @atlaskit/tokens (npm, version pinned via its `latest` manifest) codegen artifacts via jsDelivr:
 *    dist/es2019/artifacts/{tokens-raw,palettes-raw}/*.js (JSON array literals: value, original value,
 *    attributes) and artifacts/token-names.js (token name -> CSS custom property).
 *  - atlassian.design/llms-components.txt: generated component index with explicit release status.
 *
 * LICENSE: the Atlassian Design System License Agreement (atlassian.design/license) grants use only for
 * building Atlassian add-ons and forbids modification/distribution. ATLAS therefore stores no code
 * examples, short excerpts only, and marks token sets redistribution "restricted".
 */
import type { LicenseRef } from "@/lib/contracts";

export const ADAPTER_ID = "atlassian";
export const SYSTEM_SLUG = "atlassian";

export const DOCS_ORIGIN = "https://atlassian.design";
export const COMPONENTS_INDEX_URL = `${DOCS_ORIGIN}/components`;
export const LLMS_COMPONENTS_URL = `${DOCS_ORIGIN}/llms-components.txt`;
export const LICENSE_URL = `${DOCS_ORIGIN}/license`;
export const RELEASE_PHASES_URL = `${DOCS_ORIGIN}/release-phases`;
export const ABOUT_URL = `${DOCS_ORIGIN}/get-started/about-atlassian-design-system`;
/** Page whose side navigation lists the content-guidance family (incl. the message types). */
export const MESSAGES_URL = `${DOCS_ORIGIN}/foundations/content/designing-messages`;

export const TOKENS_PKG = "@atlaskit/tokens";
/** Representative package for the system version (same convention as the ATLAS registry entry). */
export const REPRESENTATIVE_PKG = "@atlaskit/button";
export const MIRROR_REPO_URL = "https://bitbucket.org/atlassian/atlassian-frontend-mirror";

export const npmPageUrl = (pkg: string, version?: string | null) => `https://www.npmjs.com/package/${pkg}${version ? `/v/${version}` : ""}`;
export const npmManifestUrl = (pkg: string) => `https://registry.npmjs.org/${pkg.replace("/", "%2F")}/latest`;
export const npmPackumentUrl = (pkg: string) => `https://registry.npmjs.org/${pkg.replace("/", "%2F")}`;

export const DOC_KINDS = {
  index: "atl-components-index",
  componentPage: "atl-component-page",
  npmManifest: "atl-npm-manifest",
  npmPackument: "atl-npm-packument",
  llms: "atl-llms-components",
  tokensRaw: "atl-tokens-raw",
  tokenNames: "atl-token-names",
  guidancePage: "atl-guidance-page",
  systemPage: "atl-system-page",
} as const;

/** Evidence extraction methods: "adapter:atlassian:<parser>". */
export const METHOD = {
  nav: "adapter:atlassian:docs-nav",
  docsHtml: "adapter:atlassian:docs-html",
  props: "adapter:atlassian:docs-props-table",
  examples: "adapter:atlassian:docs-examples",
  usage: "adapter:atlassian:docs-usage",
  npm: "adapter:atlassian:npm-manifest",
  llms: "adapter:atlassian:llms-components",
  tokensRaw: "adapter:atlassian:tokens-raw",
  tokenNames: "adapter:atlassian:token-names",
  guidance: "adapter:atlassian:guidance-html",
} as const;

/** Component tabs ATLAS reads (changelog and asset explorers are skipped). */
export const COMPONENT_TABS = ["code", "examples", "usage", "overview", "about"] as const;
export type ComponentTab = (typeof COMPONENT_TABS)[number];

/** Side-navigation groups under Components that are libraries/tooling, not UI components. */
export const NON_COMPONENT_GROUPS = new Set(["Libraries", "Tooling"]);

/** Component-section nav entries that are not components (index pages, styling APIs). */
export const EXCLUDED_COMPONENT_PATHS: Record<string, string> = {
  "/components/primitives/overview": "index page of the primitives section",
  "/components/primitives/xcss": "xcss is a styling function (API), not a UI component",
};

/** Atlassian release phases (atlassian.design/release-phases) -> ATLAS lifecycle. */
export const RELEASE_PHASE_LIFECYCLE: Record<string, "stable" | "beta" | "experimental" | "deprecated"> = {
  "early access": "experimental",
  "early-access": "experimental",
  alpha: "experimental",
  beta: "beta",
  "open beta": "beta",
  "open-beta": "beta",
  "closed beta": "beta",
  "closed-beta": "beta",
  "release candidate": "beta",
  "release-candidate": "beta",
  "general availability": "stable",
  "general-availability": "stable",
  // "Intent to Deprecate (Caution)" is one of Atlassian's two deprecation phases: avoid in new work.
  caution: "deprecated",
  "intent to deprecate": "deprecated",
  "intent-to-deprecate": "deprecated",
  deprecated: "deprecated",
};

/** Props whose string-literal unions are documented visual variants (prop -> ATLAS variant axis). */
export const VARIANT_AXIS_PROPS: Record<string, string> = {
  appearance: "appearance",
  variant: "variant",
  spacing: "density",
  density: "density",
  shape: "shape",
  emphasis: "emphasis",
  tone: "tone",
  color: "color",
};

/** Boolean props that correspond directly to a component state (prop -> canonical state). */
export const STATE_BOOLEAN_PROPS: Record<string, string> = {
  isdisabled: "disabled",
  isloading: "loading",
  isselected: "selected",
  ischecked: "selected",
  isindeterminate: "indeterminate",
  isinvalid: "error",
  isreadonly: "readonly",
  isopen: "expanded",
  isexpanded: "expanded",
  isdefaultopen: "expanded",
};

/** WAI-ARIA 1.2 roles (filters role mentions found in accessibility guidance). */
export const ARIA_ROLES = new Set([
  "alert", "alertdialog", "application", "article", "banner", "button", "cell", "checkbox", "columnheader", "combobox",
  "complementary", "contentinfo", "dialog", "document", "feed", "figure", "form", "grid", "gridcell", "group", "heading",
  "img", "link", "list", "listbox", "listitem", "log", "main", "menu", "menubar", "menuitem", "menuitemcheckbox",
  "menuitemradio", "meter", "navigation", "note", "option", "presentation", "progressbar", "radio", "radiogroup", "region",
  "row", "rowgroup", "rowheader", "search", "searchbox", "separator", "slider", "spinbutton", "status", "switch", "tab",
  "table", "tablist", "tabpanel", "textbox", "timer", "toolbar", "tooltip", "tree", "treegrid", "treeitem",
]);

/**
 * Heuristic classification overrides (always recorded as `inferred`). Only used where the shared
 * taxonomy's name match is wrong or missing for Atlassian's documented behavior; `null` leaves the
 * component unclassified rather than mis-classified.
 */
export const CLASSIFICATION_OVERRIDES: Record<string, { slug: string | null; reason: string }> = {
  Spotlight: { slug: "onboarding", reason: "Atlassian Spotlight introduces features (onboarding); the 'spotlight' alias maps to command-palette" },
  Toggle: { slug: "switch", reason: "Atlassian Toggle switches a setting on or off" },
  "Inline dialog": { slug: "popover", reason: "non-modal dialog anchored to a trigger" },
  "Progress indicator": { slug: "stepper", reason: "Atlassian Progress indicator shows position within a sequence of steps" },
  Tile: { slug: null, reason: "Atlassian Tile is a small square container for icons/images, not a content card" },
  Object: { slug: null, reason: "Atlassian Object is an icon set for Jira/Confluence objects, not a layout primitive" },
  "Focus ring": { slug: null, reason: "focus indicator utility; no taxonomy type" },
  Blanket: { slug: null, reason: "overlay backdrop; no taxonomy type" },
  Text: { slug: "typography", reason: "Text primitive renders body text" },
  MetricText: { slug: "statistic", reason: "displays a metric value" },
  Pressable: { slug: "button", reason: "unstyled button primitive" },
  Anchor: { slug: "link", reason: "unstyled link primitive; the 'anchor' alias maps to anchor-navigation" },
  Focusable: { slug: null, reason: "focus utility primitive; no taxonomy type" },
  Responsive: { slug: null, reason: "responsive helpers (media queries, Show/Hide); no taxonomy type" },
  Bleed: { slug: null, reason: "negative-margin layout utility; no taxonomy type" },
  Inline: { slug: "stack", reason: "horizontal stack primitive" },
  Page: { slug: "grid", reason: "Atlassian Page provides the page grid layout" },
  "Date label": { slug: null, reason: "date display lozenge; the 'label' alias match to form label is wrong" },
  "Date time picker": { slug: "date-picker", reason: "DateTimePicker selects a date and a time; the name match picks time-picker only" },
  "Inline edit": { slug: null, reason: "view/edit toggle for a field; the 'inline' alias match to stack is wrong" },
  "Table tree": { slug: "tree", reason: "table with expandable hierarchical rows" },
  "Filter button": { slug: "button", reason: "button that opens filter options" },
  "Atlassian navigation": { slug: "navigation-bar", reason: "horizontal top navigation of Atlassian apps" },
  "Icon tile": { slug: null, reason: "icon on a tile background; the 'tile' alias match to card is wrong" },
  "Object tile": { slug: null, reason: "object icon on a tile background; the 'tile' alias match to card is wrong" },
  "Spotlight card": { slug: "onboarding", reason: "onboarding message card; the 'spotlight' alias maps to command-palette" },
  "Date label dropdown trigger": { slug: "menu-button", reason: "interactive date label that opens a dropdown" },
  "Lozenge dropdown trigger": { slug: "menu-button", reason: "interactive lozenge that opens a dropdown" },
  "Dropdown item": { slug: null, reason: "item inside a dropdown menu; no taxonomy type for menu items" },
  "Dropdown item checkbox": { slug: null, reason: "checkbox item inside a dropdown menu; no taxonomy type for menu items" },
  "Dropdown item radio": { slug: null, reason: "radio item inside a dropdown menu; no taxonomy type for menu items" },
  "Checkbox select": { slug: "multi-select", reason: "select allowing multiple selections with checkboxes" },
  "Grid column": { slug: "grid", reason: "column of the Page grid; the 'column' alias match to stack is wrong" },
  "Avatar tag": { slug: "tag", reason: "tag representing a person/team with an avatar" },
  Layout: { slug: null, reason: "navigation-system page structure components; no single taxonomy type" },
};

/** Patterns classification skips (alias match known wrong for the Atlassian page). */
export const PATTERN_CLASSIFICATION_OVERRIDES: Record<string, { slug: string | null; reason: string }> = {
  "feature-discovery": { slug: "onboarding", reason: "message type announcing new features" },
  "info-messages": { slug: "notifications", reason: "message type: information messages" },
  "success-messages": { slug: "notifications", reason: "message type: success messages" },
  "warning-messages": { slug: "notifications", reason: "message type: warning messages" },
  "error-messages": { slug: "error-recovery", reason: "message type: error messages" },
  "designing-messages": { slug: "notifications", reason: "choosing message types and components" },
  "date-time": { slug: "content-and-writing", reason: "content guidance for writing dates and times" },
  "inclusive-writing": { slug: "content-and-writing", reason: "content guidance (inclusive language)" },
  "language-and-grammar": { slug: "content-and-writing", reason: "content guidance (style, grammar, punctuation)" },
  "voice-tone": { slug: "content-and-writing", reason: "content guidance (voice and tone)" },
};

/** Guidance pages ATLAS records as patterns: path prefixes and fixed pages discovered via site navigation. */
export const PATTERN_PREFIXES = ["/foundations/content/"];
export const PATTERN_FIXED_PATHS = ["/foundations/content", "/foundations/accessibility", "/amp", "/rovo-ui/ai-interaction-guidelines"];

export interface TokenSetSpec {
  slug: string;
  name: string;
  theme: string | null;
  /** Package-relative artifact path. */
  file: string;
  kind: "palette" | "theme" | "foundation";
}

const ART = "dist/es2019/artifacts";
export const TOKEN_NAMES_FILE = `${ART}/token-names.js`;

/**
 * Token sets from @atlaskit/tokens. Palettes (base tokens) are theme-agnostic; the color themes
 * (light, dark and their increased-contrast variants) reference the color palette; spacing,
 * typography, shape and motion themes are theme-agnostic and reference their own palettes.
 * Legacy, brand-refresh and feature-flagged override themes are not ingested (they reuse the
 * same token names with different palettes, which would collide in alias resolution).
 */
export const TOKEN_SETS: TokenSetSpec[] = [
  { slug: "palette-color", name: "Color palette (base tokens)", theme: null, file: `${ART}/palettes-raw/palette.js`, kind: "palette" },
  { slug: "palette-spacing", name: "Spacing scale (base tokens)", theme: null, file: `${ART}/palettes-raw/spacing-scale.js`, kind: "palette" },
  { slug: "palette-typography", name: "Typography palette (base tokens)", theme: null, file: `${ART}/palettes-raw/typography-palette.js`, kind: "palette" },
  { slug: "palette-shape", name: "Shape palette (base tokens)", theme: null, file: `${ART}/palettes-raw/shape-palette.js`, kind: "palette" },
  { slug: "palette-motion", name: "Motion palette (base tokens)", theme: null, file: `${ART}/palettes-raw/motion-palette.js`, kind: "palette" },
  { slug: "theme-light", name: "Light theme (color, elevation, opacity)", theme: "light", file: `${ART}/tokens-raw/atlassian-light.js`, kind: "theme" },
  { slug: "theme-dark", name: "Dark theme (color, elevation, opacity)", theme: "dark", file: `${ART}/tokens-raw/atlassian-dark.js`, kind: "theme" },
  { slug: "theme-light-increased-contrast", name: "Light increased-contrast theme", theme: "light-increased-contrast", file: `${ART}/tokens-raw/atlassian-light-increased-contrast.js`, kind: "theme" },
  { slug: "theme-dark-increased-contrast", name: "Dark increased-contrast theme", theme: "dark-increased-contrast", file: `${ART}/tokens-raw/atlassian-dark-increased-contrast.js`, kind: "theme" },
  { slug: "spacing", name: "Spacing tokens", theme: null, file: `${ART}/tokens-raw/atlassian-spacing.js`, kind: "foundation" },
  { slug: "typography", name: "Typography tokens", theme: null, file: `${ART}/tokens-raw/atlassian-typography.js`, kind: "foundation" },
  { slug: "shape", name: "Shape tokens (radius, border width)", theme: null, file: `${ART}/tokens-raw/atlassian-shape.js`, kind: "foundation" },
  { slug: "motion", name: "Motion tokens", theme: null, file: `${ART}/tokens-raw/atlassian-motion.js`, kind: "foundation" },
];

/**
 * The Atlassian Design System License Agreement. npm metadata of @atlaskit packages says Apache-2.0,
 * but the ADS agreement (atlassian.design/license) restricts use to Atlassian add-ons and forbids
 * modification and distribution; ATLAS follows the stricter terms (same as the registry entry).
 */
export const ADS_LICENSE: LicenseRef = {
  slug: "atlassian-design-system-license",
  spdxId: null,
  name: "Atlassian Design System License Agreement",
  url: LICENSE_URL,
  isOpenSource: null,
  redistribution: "restricted",
  notes:
    "Limited licence to use ADS (incl. code packages) only to build add-ons that interoperate with Atlassian products; no modification, derivative works or distribution. npm metadata of @atlaskit packages says Apache-2.0 (conflicting signal); ATLAS applies the stricter terms.",
};
