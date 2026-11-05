/**
 * Constants for the "mui" adapter: Material UI ("mui"), Joy UI ("joy-ui") and Base UI ("base-ui").
 *
 * Sources (all first-party, MUI; MIT licensed):
 *  - github.com/mui/material-ui at the release tag that published the npm latest version:
 *      docs/data/<product>/pages.ts + pagesApi.js (navigation, API page index),
 *      docs/pages/<product>/react-*.js (only to read which markdown file a page renders),
 *      docs/data/<product>/components/<x>/<x>.md (usage docs, accessibility sections),
 *      docs/pages/<product>/api/<slug>.json (generated API: props, slots, classes, imports, demos),
 *      docs/translations/api-docs[-joy]/<slug>/<slug>.json (generated prop/class/slot descriptions).
 *  - npm packages via jsDelivr (pinned): @mui/material colors/*.mjs, styles/createPalette.mjs,
 *    styles/createTransitions.mjs, styles/zIndex.mjs; @mui/joy colors/colors.js, styles/extendTheme.js.
 *  - github.com/mui/base-ui at v<@base-ui/react latest>: docs/src/app/(docs)/react/** page.mdx and
 *    generated types.md API tables.
 */
import type { LicenseRef } from "@/lib/contracts";

export const ADAPTER_ID = "mui";
export const SYSTEMS = ["mui", "joy-ui", "base-ui"] as const;
export type MuiSystem = (typeof SYSTEMS)[number];

export const MUI_OWNER = "mui";
export const CORE_REPO = "material-ui";
export const BASE_REPO = "base-ui";
export const CORE_REPO_URL = `https://github.com/${MUI_OWNER}/${CORE_REPO}`;
export const BASE_REPO_URL = `https://github.com/${MUI_OWNER}/${BASE_REPO}`;

/** Material UI and Joy UI share the mui/material-ui monorepo and its docs generator. */
export interface CoreProfile {
  system: "mui" | "joy-ui";
  /** npm package whose latest version pins the git tag. */
  pkg: "@mui/material" | "@mui/joy";
  /** Package folder in the monorepo (version check). */
  packageDir: string;
  /** URL product segment ("material-ui", "joy-ui"). */
  product: "material-ui" | "joy-ui";
  /** docs/data/<dataDir> */
  dataDir: "material" | "joy";
  /** Human docs origin. Joy UI docs for the published 5.x line live on the v5 docs host. */
  docsOrigin: string;
  /** Repository path of the generated translations JSON for an API slug. */
  translationPath: (slug: string) => string;
  label: string;
}

export const CORE_PROFILES: Record<"mui" | "joy-ui", CoreProfile> = {
  mui: {
    system: "mui",
    pkg: "@mui/material",
    packageDir: "packages/mui-material",
    product: "material-ui",
    dataDir: "material",
    docsOrigin: "https://mui.com",
    translationPath: (slug) => `docs/translations/api-docs/${slug}/${slug}.json`,
    label: "Material UI",
  },
  "joy-ui": {
    system: "joy-ui",
    pkg: "@mui/joy",
    packageDir: "packages/mui-joy",
    product: "joy-ui",
    dataDir: "joy",
    docsOrigin: "https://v5.mui.com",
    translationPath: (slug) => `docs/translations/api-docs-joy/${slug}/${slug}.json`,
    label: "Joy UI",
  },
};

export const BASE_PKG = "@base-ui/react";
export const BASE_DOCS_ORIGIN = "https://base-ui.com";
/** Base UI docs app route folder (Next.js route group). */
export const BASE_DOCS_DIR = "docs/src/app/(docs)/react";

/** Doc kinds parse() switches on. */
export const DOC_KINDS = {
  coreNav: "mui-nav-pages-ts",
  corePagesApi: "mui-pages-api-js",
  coreMd: "mui-docs-markdown",
  coreText: "mui-docs-text",
  coreApi: "mui-api-json",
  coreApiTr: "mui-api-translations-json",
  pkgJson: "mui-package-json",
  license: "mui-license",
  tokenJs: "mui-token-js",
  baseIndex: "baseui-components-index",
  basePage: "baseui-component-page",
  baseTypes: "baseui-component-types-md",
  baseText: "baseui-docs-text",
} as const;

/** Parser names used in evidence.extractionMethod ("adapter:mui:<parser>"). */
export const PARSERS = {
  npm: "npm-registry",
  pkgJson: "package-json",
  nav: "nav-pages-ts",
  apiJson: "api-json",
  apiTr: "api-translations",
  md: "docs-markdown",
  license: "license",
  jsLiteral: "js-object-literal",
  baseIndex: "baseui-index-mdx",
  basePage: "baseui-page-mdx",
  baseTypes: "baseui-types-md",
} as const;

export function mitLicense(url: string | null, copyright: string | null): LicenseRef {
  return {
    slug: "mit",
    spdxId: "MIT",
    name: "MIT License",
    url,
    isOpenSource: true,
    redistribution: "permitted",
    notes: `${copyright ? `${copyright}. ` : ""}MIT: redistribution permitted with the copyright and permission notice retained.`,
  };
}

/** Well-known components first so `--limit N` runs exercise representative data. */
export const PRIORITY_SLUGS: Record<MuiSystem, string[]> = {
  mui: ["button", "autocomplete", "dialog", "tabs", "slider", "text-field", "menu", "tooltip", "speed-dial", "rating"],
  "joy-ui": ["button", "autocomplete", "modal", "tabs", "slider", "input", "menu", "tooltip", "select", "checkbox"],
  "base-ui": ["button", "accordion", "dialog", "menu", "tabs", "slider", "select", "tooltip", "combobox", "checkbox"],
};

export function prioritize(slugs: string[], system: MuiSystem, limit?: number): string[] {
  const pr = PRIORITY_SLUGS[system];
  const sorted = [...new Set(slugs)].sort((a, b) => {
    const ra = pr.indexOf(a) < 0 ? 999 : pr.indexOf(a);
    const rb = pr.indexOf(b) < 0 ? 999 : pr.indexOf(b);
    return ra - rb || (a < b ? -1 : a > b ? 1 : 0);
  });
  return limit && limit > 0 ? sorted.slice(0, limit) : sorted;
}
