/**
 * Source locations and identifiers for the Shopify Polaris adapter ("shopify-polaris").
 *
 * Polaris is mid-transition (verified from first-party sources at implementation time):
 *  - Polaris web components (current): documented on shopify.dev (App Home "web-components"
 *    reference, published as Markdown alternates `<page>.md`, robots-allowed) and described by the
 *    Custom Elements Manifest in npm `@shopify/polaris-types`.
 *  - Polaris React (deprecated): npm `@shopify/polaris` carries a deprecation message; the
 *    github.com/Shopify/polaris repository is now Shopify/polaris-react-archive ("archived and
 *    unmaintained"). Its documentation site content (polaris.shopify.com/content/**.mdx) is read
 *    from the archive via raw.githubusercontent.com.
 *  - `@shopify/polaris-tokens` (CSS custom properties per theme in dist/css/styles.css).
 */
import type { LicenseRef } from "@/lib/contracts";

export const ADAPTER_ID = "polaris";
export const SYSTEM_SLUG = "shopify-polaris";

export const REACT_PKG = "@shopify/polaris";
export const TOKENS_PKG = "@shopify/polaris-tokens";
export const TYPES_PKG = "@shopify/polaris-types";

export const ARCHIVE_REPO = { owner: "Shopify", repo: "polaris-react-archive" } as const;
export const ARCHIVE_REPO_URL = `https://github.com/${ARCHIVE_REPO.owner}/${ARCHIVE_REPO.repo}`;
/** The archive is frozen ("will not receive updates"); its default branch carries the post-deprecation docs (web component mappings). */
export const ARCHIVE_DOCS_REF = "main";
export const ARCHIVE_CONTENT_DIR = "polaris.shopify.com/content";
export const ARCHIVE_REDIRECTS_FILE = "polaris.shopify.com/redirects.js";
export const ARCHIVE_EXAMPLES_DIR = "polaris.shopify.com/pages/examples";
/** Former docs origin; links inside the MDX content use it. It now redirects to shopify.dev. */
export const LEGACY_DOCS_ORIGIN = "https://polaris.shopify.com";

export const DEV_ORIGIN = "https://shopify.dev";
/** App Home (iframe) web components: the component set described by @shopify/polaris-types. */
export const WC_INDEX_URL = `${DEV_ORIGIN}/docs/api/app-home/latest/web-components`;
export const WC_PREFIX = `${WC_INDEX_URL}/`;
export const PATTERNS_INDEX_URL = `${DEV_ORIGIN}/docs/api/app-home/latest/patterns`;
export const PATTERNS_PREFIX = `${PATTERNS_INDEX_URL}/`;
export const POLARIS_OVERVIEW_URL = `${DEV_ORIGIN}/docs/api/polaris`;
export const VERSIONING_URL = `${WC_INDEX_URL}/versioning`;
export const USING_WC_URL = `${DEV_ORIGIN}/docs/api/polaris/using-polaris-web-components`;

export const STORYBOOK_ORIGIN = "https://storybook.polaris.shopify.dev";
export const STORYBOOK_INDEX_URL = `${STORYBOOK_ORIGIN}/index.json`;
export const storybookStoryUrl = (id: string) => `${STORYBOOK_ORIGIN}/?path=/story/${encodeURIComponent(id)}`;

/** shopify.dev publishes a Markdown alternate for each docs page (`<link rel="alternate" type="text/markdown">`). */
export const mdUrl = (htmlUrl: string) => `${htmlUrl.replace(/\/$/, "")}.md`;
export const htmlUrlFromMd = (url: string) => url.replace(/\.md$/, "");

export const DOC_KINDS = {
  npmMeta: "polaris-npm-metadata",
  cem: "polaris-wc-custom-elements-manifest",
  wcIndex: "polaris-wc-index-md",
  wcPage: "polaris-wc-component-md",
  patternsIndex: "polaris-patterns-index-md",
  patternPage: "polaris-pattern-md",
  systemPage: "polaris-system-md",
  redirects: "polaris-archive-redirects",
  reactMdx: "polaris-react-mdx",
  reactDts: "polaris-react-dts",
  storybook: "polaris-storybook-index",
  tokensCss: "polaris-tokens-css",
  tokensMeta: "polaris-tokens-esm-meta",
  license: "polaris-license",
} as const;

/** Evidence extraction methods: "adapter:polaris:<parser>". */
export const METHOD = {
  npm: "adapter:polaris:npm-metadata",
  cem: "adapter:polaris:custom-elements-manifest",
  devMd: "adapter:polaris:shopify-dev-markdown",
  mdx: "adapter:polaris:archive-mdx",
  dts: "adapter:polaris:react-dts",
  storybook: "adapter:polaris:storybook-index",
  tokensCss: "adapter:polaris:tokens-css",
  tokensMeta: "adapter:polaris:tokens-esm-meta",
  license: "adapter:polaris:license-file",
  classify: "adapter:polaris:classify",
} as const;

/**
 * Polaris License: MIT text plus a field-of-use restriction (applications that integrate or
 * interoperate with Shopify; stand-alone apps must be visually distinct). Not an open-source license;
 * ATLAS stores no code from these packages. The registry row with the same slug is authoritative.
 */
export function polarisLicense(url: string): LicenseRef {
  return {
    slug: "polaris-license",
    spdxId: null,
    name: "Polaris License (MIT-style with Shopify field-of-use restriction)",
    url,
    isOpenSource: false,
    redistribution: "restricted",
    notes: "Rights may only be exercised to develop applications that integrate or interoperate with Shopify; external stand-alone apps must be dissimilar and visually distinct from Shopify products. ATLAS stores token values as facts and no code.",
  };
}

/** Theme names as authored by @shopify/polaris-tokens (`themeNames`, class `p-theme-<name>`). */
export const TOKEN_THEMES: { theme: string; name: string; experimental: boolean }[] = [
  { theme: "light", name: "Polaris tokens: light theme (default)", experimental: false },
  { theme: "light-mobile", name: "Polaris tokens: light-mobile theme", experimental: false },
  { theme: "light-high-contrast-experimental", name: "Polaris tokens: light high-contrast theme (experimental)", experimental: true },
  { theme: "dark-experimental", name: "Polaris tokens: dark theme (experimental)", experimental: true },
];

/** Token groups of @shopify/polaris-tokens (metaThemeBase keys) by token-name prefix. */
export const TOKEN_GROUPS: { prefix: string; group: string; file: string }[] = [
  { prefix: "border-", group: "border", file: "border" },
  { prefix: "breakpoints-", group: "breakpoints", file: "breakpoints" },
  { prefix: "color-", group: "color", file: "color" },
  { prefix: "font-", group: "font", file: "font" },
  { prefix: "height-", group: "height", file: "height" },
  { prefix: "motion-", group: "motion", file: "motion" },
  { prefix: "shadow-", group: "shadow", file: "shadow" },
  { prefix: "space-", group: "space", file: "space" },
  { prefix: "text-", group: "text", file: "text" },
  { prefix: "width-", group: "width", file: "width" },
  { prefix: "z-index-", group: "zIndex", file: "zIndex" },
];

/** Prop names whose string-literal unions are documented visual variants (axis = prop name). */
export const VARIANT_AXIS_PROPS = new Set(["variant", "tone", "color", "appearance", "emphasis", "shape", "status"]);

/** Boolean props that correspond to a component state (prop -> state name). */
export const STATE_PROPS: Record<string, string> = {
  disabled: "disabled",
  loading: "loading",
  readOnly: "readonly",
  readonly: "readonly",
  checked: "checked",
  selected: "selected",
  indeterminate: "indeterminate",
  pressed: "pressed",
  expanded: "expanded",
  open: "open",
  error: "error",
  required: "required",
  active: "active",
  focused: "focus",
  busy: "busy",
};

/** WAI-ARIA 1.2 roles (filters role mentions extracted from accessibility prose). */
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
