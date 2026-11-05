/**
 * Source locations and identifiers for the "antd" adapter (Ant Design + Ant Design Mobile).
 */

export const ADAPTER_ID = "antd";

export const SLUG_ANTD = "ant-design";
export const SLUG_MOBILE = "ant-design-mobile";
export const SYSTEMS = [SLUG_ANTD, SLUG_MOBILE];

export interface ProfileDef {
  systemSlug: string;
  pkg: string;
  repo: { owner: string; name: string };
  docsOrigin: string;
  /** Git ref candidates derived from the npm version (first that serves package.json with that version wins; then gitHead). */
  refCandidates: (version: string) => string[];
  licenseFile: string;
}

export const PROFILES: Record<string, ProfileDef> = {
  [SLUG_ANTD]: {
    systemSlug: SLUG_ANTD,
    pkg: "antd",
    repo: { owner: "ant-design", name: "ant-design" },
    docsOrigin: "https://ant.design",
    refCandidates: (v) => [v, `v${v}`],
    licenseFile: "LICENSE",
  },
  [SLUG_MOBILE]: {
    systemSlug: SLUG_MOBILE,
    pkg: "antd-mobile",
    repo: { owner: "ant-design", name: "ant-design-mobile" },
    docsOrigin: "https://mobile.ant.design",
    refCandidates: (v) => [`v${v}`, v],
    licenseFile: "LICENSE.txt",
  },
};

export const DOC_KINDS = {
  npmVersion: "antd-npm-version",
  license: "antd-license",
  sitemap: "antd-sitemap",
  componentMd: "antd-component-md",
  specMd: "antd-spec-md",
  demo: "antd-demo",
  tokenMeta: "antd-token-meta",
  tokenJson: "antd-token-json",
  distCss: "antd-dist-css",
  seedJs: "antd-seed-js",
  aliasJs: "antd-alias-js",
  presetColorsDts: "antd-preset-colors-dts",
  indexDts: "antd-index-dts",
  styleTokenJs: "antd-style-token-js",
  mobileNav: "antdm-nav",
  mobileComponentMd: "antdm-component-md",
  mobileThemeCss: "antdm-theme-css",
  mobileGuideMd: "antdm-guide-md",
  mobileIndexDts: "antdm-index-dts",
  mobileDemo: "antdm-demo",
} as const;

/** Evidence extraction methods: "adapter:antd:<parser>". */
export const METHOD = {
  npm: "adapter:antd:npm-metadata",
  license: "adapter:antd:license-file",
  sitemap: "adapter:antd:sitemap",
  docsMd: "adapter:antd:docs-markdown",
  apiTable: "adapter:antd:api-table",
  specMd: "adapter:antd:spec-markdown",
  demo: "adapter:antd:demo-source",
  tokenMeta: "adapter:antd:token-meta-json",
  tokenJson: "adapter:antd:token-json",
  cssVars: "adapter:antd:dist-css-vars",
  seedJs: "adapter:antd:seed-js-literals",
  aliasJs: "adapter:antd:alias-js-static",
  styleRefs: "adapter:antd:component-token-refs",
  indexDts: "adapter:antd:index-dts-exports",
  mobileNav: "adapter:antd:mobile-nav-config",
  mobileCss: "adapter:antd:mobile-theme-css",
  mobileCssTable: "adapter:antd:mobile-css-variables-table",
  mobileGuide: "adapter:antd:mobile-guide-markdown",
  taxonomy: "adapter:antd:taxonomy",
} as const;

export const rawUrl = (p: ProfileDef, ref: string, file: string) =>
  `https://raw.githubusercontent.com/${p.repo.owner}/${p.repo.name}/${ref}/${file.replace(/^\//, "")}`;
export const blobUrl = (p: ProfileDef, ref: string, file: string) =>
  `https://github.com/${p.repo.owner}/${p.repo.name}/blob/${ref}/${file.replace(/^\//, "")}`;
export const treeUrl = (p: ProfileDef, ref: string, dir: string) =>
  `https://github.com/${p.repo.owner}/${p.repo.name}/tree/${ref}/${dir.replace(/^\/|\/$/g, "")}`;
/** GitHub file mirror on jsDelivr (separate host from raw.githubusercontent.com; same immutable ref). */
export const ghCdnUrl = (p: ProfileDef, ref: string, file: string) =>
  `https://cdn.jsdelivr.net/gh/${p.repo.owner}/${p.repo.name}@${ref}/${file.replace(/^\//, "")}`;
export const npmPageUrl = (pkg: string, version?: string) => `https://www.npmjs.com/package/${pkg}${version ? `/v/${version}` : ""}`;

/** Ant Design: sitemap paths under /components/ that are not component pages. */
export const ANTD_NON_COMPONENT_PAGES = new Set(["overview", "changelog", "_util"]);

/** Components listed first so `--limit N` runs exercise representative data. */
export const ANTD_PRIORITY = ["button", "select", "modal", "table", "tabs", "input", "date-picker", "form", "checkbox", "menu", "tooltip", "alert"];
export const MOBILE_PRIORITY = ["button", "tabs", "picker", "dialog", "input", "toast", "list", "popup", "form", "checkbox"];

/** Spec-page frontmatter `type` values treated as documented patterns / principles. */
export const SPEC_PATTERN_TYPES = new Set(["global rules", "template document"]);
export const SPEC_PRINCIPLE_TYPE = "principles";

/** Max code-snippet examples stored per component (demo sources, MIT-licensed). */
export const MAX_CODE_EXAMPLES = 1;
export const MAX_CODE_CHARS = 4000;
