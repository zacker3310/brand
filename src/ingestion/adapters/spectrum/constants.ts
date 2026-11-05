/**
 * Spectrum adapter constants: system slugs, origins, packages, URL builders, license.
 *
 * One adapter ("spectrum") covers three registry systems that share Adobe's sources:
 *  - adobe-spectrum: the Spectrum 2 design system (spectrum.adobe.com guidelines, design data, tokens).
 *  - react-spectrum: React Spectrum S2 (@react-spectrum/s2), Adobe's styled React implementation.
 *  - react-aria:     React Aria Components (react-aria-components) + hooks, the headless layer.
 */
import { githubBlobUrl, githubRawUrl } from "../../http";

export const ADAPTER_ID = "spectrum";
export const SYSTEMS = ["adobe-spectrum", "react-spectrum", "react-aria"] as const;
export type SpectrumSystem = (typeof SYSTEMS)[number];

/* ------------------------------- packages -------------------------------- */

export const PKG = {
  tokens: "@adobe/spectrum-tokens",
  designData: "@adobe/spectrum-design-data",
  cssTokens: "@spectrum-css/tokens",
  s2: "@react-spectrum/s2",
  rac: "react-aria-components",
} as const;
export type PkgKey = keyof typeof PKG;

/* -------------------------------- origins -------------------------------- */

/** Spectrum 2 guidelines site (AEM Edge Delivery: statically served .plain.html + query-index.json). */
export const SITE_ORIGIN = "https://spectrum.adobe.com";
export const SITE_INDEX_URL = `${SITE_ORIGIN}/query-index.json?limit=1000`;
export const SITE_PRINCIPLES_PATH = "/getting-started/principles";
/** React Spectrum S2 docs (llms.txt + per-page markdown). */
export const RSP_ORIGIN = "https://react-spectrum.adobe.com";
/** React Aria docs (llms.txt + per-page markdown). */
export const RAC_ORIGIN = "https://react-aria.adobe.com";

export const MONOREPO = { owner: "adobe", repo: "react-spectrum" } as const;
export const MONOREPO_URL = "https://github.com/adobe/react-spectrum";
export const DESIGN_DATA_REPO_URL = "https://github.com/adobe/spectrum-design-data";

/** Git tag of a published monorepo package version, e.g. "@react-spectrum/s2@1.8.2". */
export const releaseTag = (pkg: string, version: string) => `${pkg}@${version}`;
/** Tags contain "@" and "/", which must be percent-encoded in raw/blob URLs. */
const encRef = (ref: string) => encodeURIComponent(ref);

export const monorepoRaw = (ref: string, file: string) => githubRawUrl(MONOREPO.owner, MONOREPO.repo, encRef(ref), file.split("/").map(encodeURIComponent).join("/"));
export const monorepoBlob = (ref: string, file: string) => githubBlobUrl(MONOREPO.owner, MONOREPO.repo, encRef(ref), file.split("/").map(encodeURIComponent).join("/"));

/** Docs MDX directory per react system inside the monorepo (s2-docs site sources). */
export const DOCS_MDX_DIR: Record<"react-spectrum" | "react-aria", string> = {
  "react-spectrum": "packages/dev/s2-docs/pages/s2",
  "react-aria": "packages/dev/s2-docs/pages/react-aria",
};
/** Component source directory per react system inside the monorepo. */
export const SRC_DIR: Record<"react-spectrum" | "react-aria", string> = {
  "react-spectrum": "packages/@react-spectrum/s2/src",
  "react-aria": "packages/react-aria-components/src",
};

export const siteUrl = (path: string) => `${SITE_ORIGIN}${path.startsWith("/") ? path : `/${path}`}`;
export const sitePlainUrl = (path: string) => `${siteUrl(path).replace(/\/$/, "")}.plain.html`;

/* -------------------------------- license -------------------------------- */

export const LICENSE_APACHE = {
  slug: "apache-2.0",
  spdxId: "Apache-2.0",
  name: "Apache License 2.0",
  url: "https://www.apache.org/licenses/LICENSE-2.0",
  isOpenSource: true,
  redistribution: "permitted" as const,
  notes: "Adobe publishes @adobe/spectrum-tokens, @adobe/spectrum-design-data, @react-spectrum/s2, react-aria-components and the adobe/react-spectrum docs under Apache-2.0 (retain NOTICE/attribution).",
};

export const CODE_ATTRIBUTION: Record<"react-spectrum" | "react-aria", string> = {
  "react-spectrum": "Example from the React Spectrum documentation, Copyright Adobe, Apache-2.0",
  "react-aria": "Example from the React Aria documentation, Copyright Adobe, Apache-2.0",
};

/* ------------------------------- doc kinds ------------------------------- */

export const DOC = {
  npm: "spectrum-npm-version",
  tokensManifest: "spectrum-tokens-manifest",
  tokens: "spectrum-tokens-json",
  cssVars: "spectrum-css-vars",
  schemaListing: "spectrum-design-data-listing",
  schema: "spectrum-component-schema",
  siteIndex: "spectrum-site-index",
  sitePage: "spectrum-site-page",
  siteFragment: "spectrum-site-fragment",
  sitePrinciples: "spectrum-site-principles",
  llms: "spectrum-llms-index",
  pkgListing: "spectrum-package-listing",
  mdPage: "spectrum-docs-md",
  mdx: "spectrum-docs-mdx",
  hookPage: "spectrum-hook-md",
  guide: "spectrum-guide-md",
  quality: "spectrum-quality-md",
} as const;

/** Normalize a name for loose identity comparison ("Action button" == "ActionButton" == "action-button"). */
export const normKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
