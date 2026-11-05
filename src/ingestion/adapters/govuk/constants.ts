/**
 * GOV.UK Frontend family adapter constants: one profile per registry system.
 *
 * govuk-design-system (GOV.UK Design System, GDS):
 *  - govuk-frontend npm package via jsDelivr, pinned to npm `latest` at run time
 *    (dist/govuk/components/<name>/{template.njk,_mixin.scss,template-default.html,<name>.mjs},
 *    dist/govuk/settings/*.scss, govuk-prototype-kit.config.json, compiled CSS).
 *  - alphagov/govuk-frontend at the release tag v<version> via raw.githubusercontent.com:
 *    packages/govuk-frontend/src/govuk/components/<name>/<name>.yaml (Nunjucks macro params + examples).
 *  - alphagov/govuk-design-system (docs site source, default branch): src/components/<slug>/index.md,
 *    src/patterns/<slug>/index.md, data/colours.json, src/index.njk, component lifecycle page.
 *  - design-system.service.gov.uk/sitemap.xml (current page list; the jsDelivr GitHub listing of the
 *    docs repo is cached and can be stale, so it is not used for discovery).
 *  - GOV.UK Content API (www.gov.uk/api/content/...) for the Government Design Principles.
 *
 * nhs-design-system (NHS digital service manual design system, NHS England):
 *  - nhsuk-frontend npm package via jsDelivr, pinned to npm `latest`
 *    (dist/nhsuk/components/<name>/{macro-options.json,macro.njk,fixtures.json,_<name>.scss,<name>.mjs},
 *    dist/nhsuk/core/settings/*.scss, compiled CSS).
 *  - nhsuk/nhsuk-frontend at tag v<version> (raw GitHub): component template.njk (verifies the source path).
 *  - nhsuk/nhsuk-service-manual (default branch): app/views/design-system/{components,patterns}/<slug>/index.njk
 *    (static HTML inside Nunjucks page templates), design-principles.njk, design-system/index.njk.
 *  - service-manual.nhs.uk/sitemap.xml (current page list).
 */
import { githubBlobUrl, githubRawUrl, npmFileUrl } from "../../http";
import type { LicenseRef } from "@/lib/contracts";

export const ADAPTER_ID = "govuk";

export type TokenSetKey =
  | "colour-palette"
  | "functional-colours"
  | "applied-colours"
  | "organisation-colours"
  | "spacing"
  | "typography"
  | "layout"
  | "component-settings";

export interface SettingsFile {
  file: string;
  set: TokenSetKey;
  order: number;
  entryComments?: boolean;
}

export interface Repo {
  owner: string;
  repo: string;
}

export interface FrontendProfile {
  id: "govuk" | "nhs";
  systemSlug: string;
  /** Short label used in names and attributions. */
  label: string;
  npmPkg: string;
  /** CSS class / Sass variable prefix. */
  prefix: "govuk" | "nhsuk";
  /** Package-relative folder holding components (dist/<x>/components). */
  componentsDir: string;
  /** Package-relative folder holding settings SCSS. */
  settingsDir: string;
  frontend: Repo & { pkgDir: string; srcComponentsDir: string };
  /** Where Nunjucks params come from: the YAML at the release tag (GOV.UK) or the package's macro-options.json. */
  paramsSource: "yaml-tag" | "macro-options-json";
  docs: Repo & {
    ref: string;
    format: "md" | "njk";
    origin: string;
    /** Path prefix of docs sections on the live site ("" or "/design-system"). */
    basePath: string;
    trailingSlash: boolean;
    sitemapUrl: string;
    componentFile: (slug: string) => string;
    patternFile: (slug: string) => string;
    exampleUrl: (group: string, item: string, example: string) => string;
  };
  /** Package component folder -> docs slug (verified against the sitemap at run time). */
  docsSlugForFrontend: Record<string, string>;
  settingsFiles: SettingsFile[];
  setNames: Partial<Record<TokenSetKey, string>>;
  macrosConfig: string | null;
  cssFile: string;
  htmlExample: "template-default" | "fixtures";
  coloursJson: string | null;
  lifecyclePage: string | null;
  homePage: string | null;
  principles: { kind: "govuk-content-api"; apiUrl: string; humanUrl: string } | { kind: "docs-page"; file: string; humanUrl: string };
  license: (version: string | null) => LicenseRef;
  codeAttribution: (version: string) => string;
  docsAttribution: string;
}

const GOVUK_DOCS_ORIGIN = "https://design-system.service.gov.uk";
const NHS_DOCS_ORIGIN = "https://service-manual.nhs.uk";

export const GOVUK: FrontendProfile = {
  id: "govuk",
  systemSlug: "govuk-design-system",
  label: "GOV.UK Frontend",
  npmPkg: "govuk-frontend",
  prefix: "govuk",
  componentsDir: "dist/govuk/components",
  settingsDir: "dist/govuk/settings",
  frontend: { owner: "alphagov", repo: "govuk-frontend", pkgDir: "packages/govuk-frontend", srcComponentsDir: "packages/govuk-frontend/src/govuk/components" },
  paramsSource: "yaml-tag",
  docs: {
    owner: "alphagov",
    repo: "govuk-design-system",
    ref: "main",
    format: "md",
    origin: GOVUK_DOCS_ORIGIN,
    basePath: "",
    trailingSlash: true,
    sitemapUrl: `${GOVUK_DOCS_ORIGIN}/sitemap.xml`,
    componentFile: (slug) => `src/components/${slug}/index.md`,
    patternFile: (slug) => `src/patterns/${slug}/index.md`,
    exampleUrl: (group, item, example) => `${GOVUK_DOCS_ORIGIN}/${group}/${item}/${example}/index.html`,
  },
  // input/README.md: "Find out when to use the input component ... /components/text-input"
  docsSlugForFrontend: { input: "text-input" },
  settingsFiles: [
    { file: "_colours-palette--internal.scss", set: "colour-palette", order: 0 },
    { file: "_colours-functional.scss", set: "functional-colours", order: 0, entryComments: true },
    { file: "_colours-legacy-functional.scss", set: "functional-colours", order: 1 },
    { file: "_colours-organisations.scss", set: "organisation-colours", order: 0 },
    { file: "_spacing.scss", set: "spacing", order: 0 },
    { file: "_typography-font.scss", set: "typography", order: 0 },
    { file: "_typography-responsive.scss", set: "typography", order: 1 },
    { file: "_links.scss", set: "typography", order: 2 },
    { file: "_media-queries.scss", set: "layout", order: 0 },
    { file: "_measurements.scss", set: "layout", order: 1 },
  ],
  setNames: {
    "colour-palette": "Colour palette",
    "functional-colours": "Functional colours",
    "organisation-colours": "Organisation colours",
    spacing: "Spacing",
    typography: "Typography",
    layout: "Layout, breakpoints and borders",
    "component-settings": "Component settings",
  },
  macrosConfig: "govuk-prototype-kit.config.json",
  cssFile: "dist/govuk/govuk-frontend.min.css",
  htmlExample: "template-default",
  coloursJson: "data/colours.json",
  lifecyclePage: "src/community/component-lifecycle-statuses/index.md",
  homePage: "src/index.njk",
  principles: {
    kind: "govuk-content-api",
    apiUrl: "https://www.gov.uk/api/content/guidance/government-design-principles",
    humanUrl: "https://www.gov.uk/guidance/government-design-principles",
  },
  license: (version) => ({
    slug: "mit",
    spdxId: "MIT",
    name: "MIT License",
    url: version ? githubBlobUrl("alphagov", "govuk-frontend", `v${version}`, "LICENSE.txt") : "https://github.com/alphagov/govuk-frontend/blob/main/LICENSE.txt",
    isOpenSource: true,
    redistribution: "permitted",
    notes: "govuk-frontend code: MIT, © Crown copyright (Government Digital Service).",
  }),
  codeAttribution: (version) => `GOV.UK Frontend v${version} (MIT License, © Crown copyright, Government Digital Service)`,
  docsAttribution: "GOV.UK Design System (content © Crown copyright, Open Government Licence v3.0)",
};

export const NHS: FrontendProfile = {
  id: "nhs",
  systemSlug: "nhs-design-system",
  label: "NHS.UK frontend",
  npmPkg: "nhsuk-frontend",
  prefix: "nhsuk",
  componentsDir: "dist/nhsuk/components",
  settingsDir: "dist/nhsuk/core/settings",
  frontend: { owner: "nhsuk", repo: "nhsuk-frontend", pkgDir: "packages/nhsuk-frontend", srcComponentsDir: "packages/nhsuk-frontend/src/nhsuk/components" },
  paramsSource: "macro-options-json",
  docs: {
    owner: "nhsuk",
    repo: "nhsuk-service-manual",
    ref: "main",
    format: "njk",
    origin: NHS_DOCS_ORIGIN,
    basePath: "/design-system",
    trailingSlash: false,
    sitemapUrl: `${NHS_DOCS_ORIGIN}/sitemap.xml`,
    componentFile: (slug) => `app/views/design-system/components/${slug}/index.njk`,
    patternFile: (slug) => `app/views/design-system/patterns/${slug}/index.njk`,
    exampleUrl: (group, item, example) => `${NHS_DOCS_ORIGIN}/design-example/${group}/${item}/${example}`,
  },
  // Docs pages named in the plural or with a descriptive suffix; each mapping is used only when both
  // the package folder and the docs page exist in this run.
  docsSlugForFrontend: {
    button: "buttons",
    breadcrumb: "breadcrumbs",
    "do-dont-list": "do-and-dont-lists",
    hint: "hint-text",
    "notification-banner": "notification-banners",
    tables: "table",
    input: "text-input",
  },
  settingsFiles: [
    { file: "_colours-palette.scss", set: "colour-palette", order: 0 },
    { file: "_colours-applied.scss", set: "applied-colours", order: 0 },
    { file: "_spacing.scss", set: "spacing", order: 0 },
    { file: "_globals.scss", set: "typography", order: 0 },
    { file: "_typography.scss", set: "typography", order: 1 },
    { file: "_breakpoints.scss", set: "layout", order: 0 },
  ],
  setNames: {
    "colour-palette": "Colour palette",
    "applied-colours": "Applied colours",
    spacing: "Spacing",
    typography: "Typography and global settings",
    layout: "Breakpoints",
    "component-settings": "Component settings",
  },
  macrosConfig: null,
  cssFile: "dist/nhsuk/nhsuk-frontend.min.css",
  htmlExample: "fixtures",
  coloursJson: null,
  lifecyclePage: null,
  homePage: "app/views/design-system/index.njk",
  principles: { kind: "docs-page", file: "app/views/design-system/design-principles.njk", humanUrl: `${NHS_DOCS_ORIGIN}/design-system/design-principles` },
  license: (version) => ({
    slug: "mit",
    spdxId: "MIT",
    name: "MIT License",
    url: version ? githubBlobUrl("nhsuk", "nhsuk-frontend", `v${version}`, "LICENSE") : "https://github.com/nhsuk/nhsuk-frontend/blob/main/LICENSE",
    isOpenSource: true,
    redistribution: "permitted",
    notes: "nhsuk-frontend code: MIT, Copyright (c) 2019 NHS England.",
  }),
  codeAttribution: (version) => `NHS.UK frontend v${version} (MIT License, © NHS England)`,
  docsAttribution: "NHS digital service manual (© NHS England)",
};

export const PROFILES: FrontendProfile[] = [GOVUK, NHS];
export const profileFor = (slug: string) => PROFILES.find((p) => p.systemSlug === slug);

/* ------------------------------- URL builders ------------------------------- */

export const docsRaw = (p: FrontendProfile, file: string) => githubRawUrl(p.docs.owner, p.docs.repo, p.docs.ref, file);
export const docsBlob = (p: FrontendProfile, file: string) => githubBlobUrl(p.docs.owner, p.docs.repo, p.docs.ref, file);
export const frontendRaw = (p: FrontendProfile, version: string, file: string) => githubRawUrl(p.frontend.owner, p.frontend.repo, `v${version}`, file);
export const frontendBlob = (p: FrontendProfile, version: string, file: string) => githubBlobUrl(p.frontend.owner, p.frontend.repo, `v${version}`, file);
export const frontendRepoUrl = (p: FrontendProfile) => `https://github.com/${p.frontend.owner}/${p.frontend.repo}`;
export const docsRepoUrl = (p: FrontendProfile) => `https://github.com/${p.docs.owner}/${p.docs.repo}`;
export const frontendTree = (p: FrontendProfile, version: string, dir: string) => `${frontendRepoUrl(p)}/tree/v${version}/${dir.replace(/^\//, "")}`;
export const componentSrcDir = (p: FrontendProfile, name: string) => `${p.frontend.srcComponentsDir}/${name}`;
export const pkgFile = (p: FrontendProfile, version: string, file: string) => npmFileUrl(p.npmPkg, version, file);

export const docsUrlFor = (p: FrontendProfile, section: "components" | "patterns" | "styles", slug: string) =>
  `${p.docs.origin}${p.docs.basePath}/${section}/${slug}${p.docs.trailingSlash ? "/" : ""}`;

/* --------------------------- GOV.UK compatibility --------------------------- */

export const SYSTEM_SLUG = GOVUK.systemSlug;
export const NPM_PKG = GOVUK.npmPkg;
export const DOCS_ORIGIN = GOVUK.docs.origin;
export const SITEMAP_URL = GOVUK.docs.sitemapUrl;
export const FRONTEND_REPO_URL = frontendRepoUrl(GOVUK);
export const DOCS_REPO_URL = docsRepoUrl(GOVUK);
export const PRINCIPLES_URL = "https://www.gov.uk/guidance/government-design-principles";

/** Normalize a name for loose identity comparison. */
export const normKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
