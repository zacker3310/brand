/**
 * GOV.UK Design System adapter constants: source locations, URL builders and licences.
 *
 * Sources (first-party, static parsing only; nothing fetched is executed):
 *  - govuk-frontend npm package via jsDelivr, pinned to npm `latest` at run time
 *    (dist/govuk/components/<name>/{template.njk,_mixin.scss,template-default.html,<name>.mjs},
 *    dist/govuk/settings/*.scss, govuk-prototype-kit.config.json, dist/govuk/all.mjs, compiled CSS).
 *  - alphagov/govuk-frontend at the release tag v<version> via raw.githubusercontent.com:
 *    packages/govuk-frontend/src/govuk/components/<name>/<name>.yaml (Nunjucks macro params + examples).
 *  - alphagov/govuk-design-system (docs site source, default branch) via raw.githubusercontent.com:
 *    src/components/<slug>/index.md, src/patterns/<slug>/index.md, data/colours.json, src/index.njk,
 *    src/community/component-lifecycle-statuses/index.md.
 *  - design-system.service.gov.uk/sitemap.xml (current page list; the jsDelivr GitHub listing of the
 *    docs repo is cached and can be stale, so it is not used for discovery).
 *  - GOV.UK Content API (www.gov.uk/api/content/...) for the Government Design Principles.
 */
import { githubBlobUrl, githubRawUrl, npmFileUrl } from "../../http";
import type { LicenseRef } from "@/lib/contracts";

export const ADAPTER_ID = "govuk";
export const SYSTEM_SLUG = "govuk-design-system";

export const NPM_PKG = "govuk-frontend";
export const FRONTEND_OWNER = "alphagov";
export const FRONTEND_REPO = "govuk-frontend";
export const FRONTEND_REPO_URL = `https://github.com/${FRONTEND_OWNER}/${FRONTEND_REPO}`;
/** Package directory inside the govuk-frontend monorepo (package.json `repository.directory`). */
export const FRONTEND_PKG_DIR = "packages/govuk-frontend";

export const DOCS_OWNER = "alphagov";
export const DOCS_REPO = "govuk-design-system";
/** The docs repo has no release tags; content is read from the default branch (live site source). */
export const DOCS_REF = "main";
export const DOCS_REPO_URL = `https://github.com/${DOCS_OWNER}/${DOCS_REPO}`;

export const DOCS_ORIGIN = "https://design-system.service.gov.uk";
export const SITEMAP_URL = `${DOCS_ORIGIN}/sitemap.xml`;

export const PRINCIPLES_API_URL = "https://www.gov.uk/api/content/guidance/government-design-principles";
export const PRINCIPLES_URL = "https://www.gov.uk/guidance/government-design-principles";

/**
 * govuk-frontend component folders documented under a different docs slug. Verified at run time:
 * the docs slug must be in the sitemap, otherwise the mapping is ignored.
 * (input/README.md: "Find out when to use the input component ... /components/text-input")
 */
export const DOCS_SLUG_FOR_FRONTEND: Record<string, string> = { input: "text-input" };

/** Settings files parsed into token sets (dist/govuk/settings/<file>), in set order. */
export const SETTINGS_FILES: { file: string; set: TokenSetKey; order: number }[] = [
  { file: "_colours-palette--internal.scss", set: "colour-palette", order: 0 },
  { file: "_colours-functional.scss", set: "functional-colours", order: 0 },
  { file: "_colours-legacy-functional.scss", set: "functional-colours", order: 1 },
  { file: "_colours-organisations.scss", set: "organisation-colours", order: 0 },
  { file: "_spacing.scss", set: "spacing", order: 0 },
  { file: "_typography-font.scss", set: "typography", order: 0 },
  { file: "_typography-responsive.scss", set: "typography", order: 1 },
  { file: "_links.scss", set: "typography", order: 2 },
  { file: "_media-queries.scss", set: "layout", order: 0 },
  { file: "_measurements.scss", set: "layout", order: 1 },
];

export type TokenSetKey = "colour-palette" | "functional-colours" | "organisation-colours" | "spacing" | "typography" | "layout" | "component-settings";

export const TOKEN_SET_META: Record<TokenSetKey, { name: string; docsPath: string | null }> = {
  "colour-palette": { name: "Colour palette", docsPath: "/styles/colour/" },
  "functional-colours": { name: "Functional colours", docsPath: "/styles/colour/" },
  "organisation-colours": { name: "Organisation colours", docsPath: "/styles/colour/" },
  spacing: { name: "Spacing", docsPath: "/styles/spacing/" },
  typography: { name: "Typography", docsPath: "/styles/type-scale/" },
  layout: { name: "Layout, breakpoints and borders", docsPath: "/styles/layout/" },
  "component-settings": { name: "Component settings", docsPath: null },
};

export const docsRaw = (file: string) => githubRawUrl(DOCS_OWNER, DOCS_REPO, DOCS_REF, file);
export const docsBlob = (file: string) => githubBlobUrl(DOCS_OWNER, DOCS_REPO, DOCS_REF, file);
export const frontendTag = (version: string) => `v${version}`;
export const frontendRaw = (version: string, file: string) => githubRawUrl(FRONTEND_OWNER, FRONTEND_REPO, frontendTag(version), file);
export const frontendBlob = (version: string, file: string) => githubBlobUrl(FRONTEND_OWNER, FRONTEND_REPO, frontendTag(version), file);
export const frontendTree = (version: string, dir: string) => `${FRONTEND_REPO_URL}/tree/${frontendTag(version)}/${dir.replace(/^\//, "")}`;
export const pkgFile = (version: string, file: string) => npmFileUrl(NPM_PKG, version, file);
export const componentSrcDir = (name: string) => `${FRONTEND_PKG_DIR}/src/govuk/components/${name}`;

export const docsUrlFor = (section: "components" | "patterns" | "styles", slug: string) => `${DOCS_ORIGIN}/${section}/${slug}/`;

export function mitLicense(version: string | null): LicenseRef {
  return {
    slug: "mit",
    spdxId: "MIT",
    name: "MIT License",
    url: version ? frontendBlob(version, "LICENSE.txt") : `${FRONTEND_REPO_URL}/blob/main/LICENSE.txt`,
    isOpenSource: true,
    redistribution: "permitted",
    notes: "govuk-frontend code: MIT, © Crown copyright (Government Digital Service).",
  };
}

export const ATTRIBUTION_CODE = (version: string) => `GOV.UK Frontend v${version} (MIT License, © Crown copyright, Government Digital Service)`;
export const ATTRIBUTION_DOCS = "GOV.UK Design System (content © Crown copyright, Open Government Licence v3.0)";

/** Normalize a name for loose identity comparison. */
export const normKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
