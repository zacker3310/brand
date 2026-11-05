/**
 * Carbon adapter constants: source locations and URL builders.
 *
 * Sources (all first-party, IBM / carbon-design-system):
 *  - carbon-website repo (Apache-2.0): MDX docs + nav/data files via raw.githubusercontent.com.
 *    The repo is too large for jsDelivr gh listings (>50 MB), so the page list comes from the
 *    repo's own nav file (src/data/nav-items.yaml), not from a directory listing.
 *  - carbondesignsystem.com (live docs): sitemap + per-component page metadata (status label,
 *    GitHub source folder, Storybook link) embedded as JSON in the server-rendered page.
 *  - npm packages via jsDelivr, pinned to the npm `latest` version resolved at run time.
 */
import { githubBlobUrl, githubRawUrl } from "../../http";

export const ADAPTER_ID = "carbon";
export const WEBSITE_OWNER = "carbon-design-system";
export const WEBSITE_REPO = "carbon-website";
/** carbon-website has no release tags; content is read from the default branch. */
export const WEBSITE_REF = "main";
export const MONOREPO_URL = "https://github.com/carbon-design-system/carbon";
export const WEBSITE_REPO_URL = `https://github.com/${WEBSITE_OWNER}/${WEBSITE_REPO}`;

export const LIVE_ORIGIN = "https://www.carbondesignsystem.com";
/** Legacy docs origin (pre-2026 URL scheme, now 301-redirects to LIVE_ORIGIN). */
export const LEGACY_ORIGIN = "https://carbondesignsystem.com";
export const BUILDING_BLOCKS_SITEMAP = `${LIVE_ORIGIN}/building-blocks-sitemap.xml`;

export const PKG = {
  react: "@carbon/react",
  webComponents: "@carbon/web-components",
  styles: "@carbon/styles",
  themes: "@carbon/themes",
  colors: "@carbon/colors",
  layout: "@carbon/layout",
  type: "@carbon/type",
  motion: "@carbon/motion",
} as const;
export type PkgKey = keyof typeof PKG;

/** Carbon themes published by @carbon/themes (tokens/themes/<theme>/...). */
export const THEMES = [
  { id: "white", scheme: "light" },
  { id: "g10", scheme: "light" },
  { id: "g90", scheme: "dark" },
  { id: "g100", scheme: "dark" },
] as const;

/** Per-theme component token files listed in @carbon/themes tokens/themes.resolver.json. */
export const THEME_FILES = ["theme", "button", "tag", "notification", "status", "content-switcher"] as const;

/** Live docs tab slugs keyed by repo MDX tab file name. */
export const TAB_TO_LIVE: Record<string, string> = {
  usage: "guidelines",
  style: "specifications",
  code: "code",
  accessibility: "accessibility",
};

export const websiteRaw = (file: string) => githubRawUrl(WEBSITE_OWNER, WEBSITE_REPO, WEBSITE_REF, file);
export const websiteBlob = (file: string) => githubBlobUrl(WEBSITE_OWNER, WEBSITE_REPO, WEBSITE_REF, file);

/** Live component docs page, e.g. /building-blocks/core/components/button/guidelines */
export const liveComponentUrl = (docSlug: string, tab: keyof typeof TAB_TO_LIVE | string = "usage") =>
  `${LIVE_ORIGIN}/building-blocks/core/components/${docSlug.toLowerCase()}/${TAB_TO_LIVE[tab] ?? tab}`;

/** Legacy URL of a component tab (redirects to the live scheme). */
export const legacyComponentUrl = (docSlug: string, tab = "usage") => `${LEGACY_ORIGIN}/components/${docSlug}/${tab}/`;

export const LICENSE_APACHE = {
  slug: "apache-2.0",
  spdxId: "Apache-2.0",
  name: "Apache License 2.0",
  url: "https://www.apache.org/licenses/LICENSE-2.0",
  isOpenSource: true,
  redistribution: "permitted" as const,
  notes: "Carbon packages and carbon-website content are published under Apache-2.0 (attribution + NOTICE required).",
};

/** Accepted GitHub source folder URLs from live page metadata (validated strictly). */
export const REACT_SRC_RE = /^https:\/\/github\.com\/carbon-design-system\/carbon\/tree\/main\/packages\/react\/src\/components\/([A-Za-z0-9]+)$/;
export const WC_SRC_RE = /^https:\/\/github\.com\/carbon-design-system\/carbon\/tree\/main\/packages\/web-components\/src\/components\/([a-z0-9-]+)$/;
export const STORYBOOK_RE = /^https:\/\/(react|web-components)\.carbondesignsystem\.com\/\?path=\/(docs|story)\/[a-z0-9-]+--[a-z0-9-]+$/;

/** Normalize a name for loose identity comparison ("AI label" == "AILabel" == "ai-label"). */
export const normKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
