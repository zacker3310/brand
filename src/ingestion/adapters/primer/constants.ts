/** Source locations and identifiers for the Primer adapter. */

export const ADAPTER_ID = "primer";
export const SYSTEM_SLUG = "github-primer";

export const REACT_PKG = "@primer/react";
export const PRIMITIVES_PKG = "@primer/primitives";

export const REACT_REPO = { owner: "primer", repo: "react" } as const;
export const PRIMITIVES_REPO = { owner: "primer", repo: "primitives" } as const;

export const DOCS_ORIGIN = "https://primer.style";
export const SITEMAP_URL = `${DOCS_ORIGIN}/sitemap.xml`;
/** Storybook URL pattern as linked from primer.style component pages ("Storybook" link). */
export const STORYBOOK_STORY_URL = (storyId: string) => `${DOCS_ORIGIN}/react/storybook/?path=/story/${encodeURIComponent(storyId)}`;

export const DOC_KINDS = {
  sitemap: "primer-sitemap",
  componentsJson: "primer-components-json",
  license: "primer-license",
  componentCss: "primer-react-css",
  tokenDocsJson: "primer-primitives-docs-json",
  tokenJson5: "primer-primitives-json5",
  componentPage: "primer-docs-component-page",
  patternPage: "primer-docs-pattern-page",
  systemPage: "primer-docs-system-page",
} as const;

/** Evidence extraction methods: "adapter:primer:<parser>". */
export const METHOD = {
  componentsJson: "adapter:primer:components-json",
  docsHtml: "adapter:primer:docs-html",
  cssVars: "adapter:primer:css-vars",
  tokenDocsJson: "adapter:primer:primitives-docs-json",
  tokenJson5: "adapter:primer:primitives-json5",
  npm: "adapter:primer:npm-metadata",
  license: "adapter:primer:license-file",
} as const;

export interface TokenSetSpec {
  slug: string;
  name: string;
  theme: string | null;
  /** Files (package-relative) merged into the set, in order. */
  files: string[];
  kind: "docs-json" | "json5";
  /** Human-facing source URL; a jsDelivr directory or file listing for the pinned version. */
  sourcePath: string;
}

/**
 * Token sets emitted from @primer/primitives. Base (primitive) color scales come from the DTCG
 * JSON5 sources (they are not part of the built docs output); everything else comes from the
 * package's built `dist/docs` JSON, which keeps each token's authored `$value` (with references)
 * per theme in `original`.
 */
export const TOKEN_SETS: TokenSetSpec[] = [
  { slug: "primitives-base-color-light", name: "Base color scale (light)", theme: "light", kind: "json5", files: ["src/tokens/base/color/light/light.json5", "src/tokens/base/color/light/display-light.json5"], sourcePath: "src/tokens/base/color/light/" },
  { slug: "primitives-base-color-dark", name: "Base color scale (dark)", theme: "dark", kind: "json5", files: ["src/tokens/base/color/dark/dark.json5", "src/tokens/base/color/dark/display-dark.json5"], sourcePath: "src/tokens/base/color/dark/" },
  { slug: "primitives-base-size", name: "Base size", theme: null, kind: "docs-json", files: ["dist/docs/base/size/size.json", "dist/docs/base/size/z-index.json"], sourcePath: "dist/docs/base/size/" },
  { slug: "primitives-base-typography", name: "Base typography", theme: null, kind: "docs-json", files: ["dist/docs/base/typography/typography.json"], sourcePath: "dist/docs/base/typography/typography.json" },
  { slug: "primitives-base-motion", name: "Base motion", theme: null, kind: "docs-json", files: ["dist/docs/base/motion/motion.json"], sourcePath: "dist/docs/base/motion/motion.json" },
  {
    slug: "primitives-functional-size",
    name: "Functional size & spacing",
    theme: null,
    kind: "docs-json",
    files: [
      "dist/docs/functional/size/size.json",
      "dist/docs/functional/size/border.json",
      "dist/docs/functional/size/radius.json",
      "dist/docs/functional/size/breakpoints.json",
      "dist/docs/functional/size/viewport.json",
      "dist/docs/functional/size/z-index.json",
      "dist/docs/functional/spacing/space.json",
    ],
    sourcePath: "dist/docs/functional/",
  },
  { slug: "primitives-functional-size-coarse", name: "Functional size (coarse pointer)", theme: null, kind: "docs-json", files: ["dist/docs/functional/size/size-coarse.json"], sourcePath: "dist/docs/functional/size/size-coarse.json" },
  { slug: "primitives-functional-size-fine", name: "Functional size (fine pointer)", theme: null, kind: "docs-json", files: ["dist/docs/functional/size/size-fine.json"], sourcePath: "dist/docs/functional/size/size-fine.json" },
  { slug: "primitives-functional-typography", name: "Functional typography", theme: null, kind: "docs-json", files: ["dist/docs/functional/typography/typography.json"], sourcePath: "dist/docs/functional/typography/typography.json" },
  { slug: "primitives-functional-motion", name: "Functional motion", theme: null, kind: "docs-json", files: ["dist/docs/functional/motion/motion.json"], sourcePath: "dist/docs/functional/motion/motion.json" },
  { slug: "primitives-theme-light", name: "Functional color & component tokens (light)", theme: "light", kind: "docs-json", files: ["dist/docs/functional/themes/light.json"], sourcePath: "dist/docs/functional/themes/light.json" },
  { slug: "primitives-theme-dark", name: "Functional color & component tokens (dark)", theme: "dark", kind: "docs-json", files: ["dist/docs/functional/themes/dark.json"], sourcePath: "dist/docs/functional/themes/dark.json" },
];

/** Prop names whose string-literal unions are documented visual variants (axis = prop name). */
export const VARIANT_AXIS_PROPS: Record<string, string> = {
  variant: "variant",
  scheme: "scheme",
  shape: "shape",
  status: "status",
  appearance: "appearance",
  emphasis: "emphasis",
  tone: "tone",
};

/** Boolean props that correspond directly to a component state. */
export const STATE_BOOLEAN_PROPS: Record<string, string> = {
  disabled: "disabled",
  loading: "loading",
  inactive: "inactive",
  selected: "selected",
  checked: "checked",
  indeterminate: "indeterminate",
  readonly: "readonly",
  expanded: "expanded",
  open: "open",
  busy: "busy",
  current: "current",
};

/** WAI-ARIA 1.2 roles (for filtering role mentions extracted from accessibility pages). */
export const ARIA_ROLES = new Set([
  "alert", "alertdialog", "application", "article", "banner", "blockquote", "button", "caption", "cell", "checkbox", "code",
  "columnheader", "combobox", "complementary", "contentinfo", "definition", "deletion", "dialog", "directory", "document",
  "emphasis", "feed", "figure", "form", "generic", "grid", "gridcell", "group", "heading", "img", "insertion", "link", "list",
  "listbox", "listitem", "log", "main", "marquee", "math", "menu", "menubar", "menuitem", "menuitemcheckbox", "menuitemradio",
  "meter", "navigation", "none", "note", "option", "paragraph", "presentation", "progressbar", "radio", "radiogroup", "region",
  "row", "rowgroup", "rowheader", "scrollbar", "search", "searchbox", "separator", "slider", "spinbutton", "status", "strong",
  "subscript", "superscript", "switch", "tab", "table", "tablist", "tabpanel", "term", "textbox", "time", "timer", "toolbar",
  "tooltip", "tree", "treegrid", "treeitem",
]);

/** Sitemap sections treated as documented patterns. */
export const PATTERN_SECTIONS: { prefix: string; label: string; short: string }[] = [
  { prefix: "/product/ui-patterns/", label: "UI pattern", short: "ui" },
  { prefix: "/product/scenario-patterns/", label: "Scenario pattern", short: "scenario" },
  { prefix: "/accessibility/patterns/", label: "Accessibility pattern", short: "a11y" },
];

export const SYSTEM_PAGES = {
  gettingStarted: "/product/getting-started/",
  reactPhilosophy: "/product/getting-started/react/philosophy/",
  figma: "/product/getting-started/figma/",
} as const;
