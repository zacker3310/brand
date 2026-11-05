import type { GenericTarget } from "./types";

/**
 * Targets researched by generic workstream 1. Every source below was checked on 2026-11-05 through
 * PoliteFetcher (robots.txt allowance included) and dry-run with scripts/adapter-dry-run.ts.
 *
 * Not configured (stays metadata-only): apple-hig. developer.apple.com/design/human-interface-guidelines
 * is a client-rendered DocC app with no sitemap; its component inventory is only reachable through a
 * two-level traversal of DocC render JSON (components.json -> 8 category JSON files), which none of the
 * sitemap/nav/repo-listing strategies can express.
 */
export const TARGETS_1: GenericTarget[] = [
  {
    slug: "alibaba-fusion",
    strategy: "repo-listing",
    repo: { kind: "gh", name: "alibaba-fusion/next", ref: "{latest}", docsUrlTemplate: "https://github.com/alibaba-fusion/next/blob/{ref}/{path}" },
    include: "^components/([a-z0-9-]+)/__docs__/index\\.en-us\\.md$",
    frameworks: ["react"],
    maxPages: 80,
    notes:
      "fusion.design is a client-rendered app that answers 200 with a soft-404 or generic title for every path (see registry notes), so component pages cannot be verified statically. The authoritative inventory is the per-component English docs source (components/<name>/__docs__/index.en-us.md) in alibaba-fusion/next at the latest release tag ({latest} = newest stable tag on jsDelivr; tags have no 'v' prefix), listed via jsDelivr. Docs URL = GitHub blob of that markdown (proven by the listing); name = its '# Heading'. raw.githubusercontent.com has no robots.txt (404 = allowed).",
  },
  {
    slug: "arco-design",
    strategy: "repo-listing",
    repo: { kind: "gh", name: "arco-design/arco-design", ref: "{latest}", docsUrlTemplate: "https://github.com/arco-design/arco-design/blob/{ref}/{path}" },
    include: "^components/([A-Z][A-Za-z0-9]+)/README\\.en-US\\.md$",
    frameworks: ["react"],
    maxPages: 90,
    notes:
      "arco.design docs are client-rendered (every path returns the same 2.6 KB shell, robots.txt is an HTML fallback), so docs pages cannot be confirmed statically. Inventory = components/<Name>/README.en-US.md (English docs source the site renders) in arco-design/arco-design (the React library) at the newest stable release tag known to jsDelivr ({latest}; tags have no 'v' prefix; npm can be one patch ahead because not every publish is tagged). The Vue library (arco-design/arco-design-vue) is not enumerated here; frameworks lists react only.",
  },
  {
    slug: "ark-ui",
    strategy: "sitemap",
    sitemapUrl: "https://ark-ui.com/sitemap.xml",
    include: "^https://ark-ui\\.com/docs/components/([a-z0-9-]+)$",
    frameworks: ["react", "vue", "solid", "svelte"],
    titleSuffix: "\\s+\\|\\s+Ark UI$",
    notes:
      "Official sitemap (declared in robots.txt, which allows all). /docs/components/<name> pages are server-rendered with <h1> and a component-specific meta description. One docs page covers all four framework packages (framework switcher in the UI), so frameworks lists the four official packages from the registry.",
  },
  {
    slug: "base-web",
    strategy: "repo-listing",
    repo: { kind: "npm", name: "baseui", ref: "latest" },
    include: "^([a-z0-9-]+)/index\\.js$",
    exclude: ["^(?:a11y|helper|helpers|locale|styles|themes|tokens|utils|test|layer)/"],
    frameworks: ["react"],
    notes:
      "baseweb.design is client-rendered (component pages ship no <title>/<h1> text) and the uber/baseweb repository exceeds jsDelivr's 50 MB listing limit (403), so no docs page list is statically enumerable. Inventory = top-level component modules (<module>/index.js) of the published baseui npm package (version resolved via jsDelivr), excluding non-component modules (a11y, helper, locale, styles, themes, tokens, layer). Names are humanized module names (e.g. 'checkbox-v2' -> 'Checkbox V2'); docs URLs are not claimed because baseweb.design pages cannot be confirmed statically.",
  },
  {
    slug: "blueprint",
    strategy: "repo-listing",
    repo: {
      kind: "gh",
      name: "palantir/blueprint",
      ref: "@blueprintjs/core@{npm:@blueprintjs/core}",
      docsUrlTemplate: "https://github.com/palantir/blueprint/blob/{ref}/{path}",
    },
    include: "^packages/(?:(?:core|datetime|select|labs)/src/components/(?:[a-z0-9-]+/)*|table/src/docs/)([a-z0-9-]+)\\.mdx$",
    exclude: ["/components\\.mdx$", "/html\\.mdx$", "/table-(?:api|features)\\.mdx$"],
    frameworks: ["react"],
    maxPages: 90,
    notes:
      "blueprintjs.com/docs is a client-rendered single page app (1.3 KB shell, hash routes), so its pages cannot be read statically. The docs app is generated from the per-component MDX sources in palantir/blueprint (packages/{core,datetime,select,labs}/src/components/**/<name>.mdx, table/src/docs/table.mdx). Listed via jsDelivr at the release tag of the latest @blueprintjs/core (ref resolved from npm): the jsDelivr listing for the 'develop' branch was stale (old .md names that 404 on GitHub), so a tag is used. Excludes the components index, the HTML-elements page and table API/feature sub-pages. Docs URL = GitHub blob of the MDX; name = its '# Heading'.",
  },
  {
    slug: "bootstrap",
    strategy: "nav",
    navUrl: "https://getbootstrap.com/docs/5.3/getting-started/introduction/",
    navSelector: "#bd-docs-nav",
    include: "^https://getbootstrap\\.com/docs/5\\.3/(?:components|forms)/([a-z0-9-]+)/?$",
    exclude: ["/forms/(?:overview|layout|validation)/?$"],
    frameworks: ["html-css"],
    titleSuffix: "\\s*·\\s*Bootstrap v5\\.3$",
    notes:
      "Static Hugo sidebar (#bd-docs-nav) of the v5.3 docs (the registry pins docsUrl to v5.3, the latest stable). getbootstrap.com/sitemap-0.xml only lists the 6.0 docs, so it is not used. robots.txt allows all. Components = the 'Components' section plus the form controls from 'Forms'; forms overview/layout/validation are guides and excluded.",
  },
  {
    slug: "bulma",
    strategy: "nav",
    navUrl: "https://bulma.io/documentation/",
    include: "^https://bulma\\.io/documentation/(?:elements|components|form|layout)/([a-z0-9-]+)/$",
    exclude: ["/form/general/$"],
    frameworks: ["html-css"],
    titleSuffix: "\\s+\\|\\s+Bulma: Free, open source, and modern CSS framework based on Flexbox$",
    notes:
      "Static documentation index (bulma.io/documentation/, no sitemap; robots.txt allows all). Components = the Elements, Components, Form and Layout sections; 'Form > General' is a guide, and the Columns/Grid/Helpers/Customize/Sass sections are layout systems, utilities or guides, so they are excluded. bulma.io pages share one site-wide meta description, which the adapter rejects, so descriptions stay not-extracted.",
  },
  {
    slug: "carbon-web-components",
    strategy: "sitemap",
    sitemapUrl: "https://web-components.carbondesignsystem.com/index.json",
    include: "^https://web-components\\.carbondesignsystem\\.com/\\?path=/docs/(?:components|elements|layout)-([a-z0-9-]+?)--overview$",
    exclude: ["-feature-flag--", "/docs/components-datatable-(?!basic--)", "/docs/components-section-overview--"],
    frameworks: ["web-components"],
    fetchPages: false,
    notes:
      "The docs site is a Storybook (registry docsUrl/storybookUrl); its static index.json (Storybook v5 index) lists every docs entry and is used like a sitemap. Each component's docs entry is '<group>-<component>--overview' under Components/, Elements/ or Layout/ (Preview/ experimental, Introduction/ guides and Deprecated/ entries are not matched). DataTable has one docs entry per feature: only the Basic entry is kept as the DataTable component; feature-flag entries are excluded. Names come from the Storybook titles; pages are not fetched (client-rendered Storybook shell). robots.txt allows all.",
  },
  {
    slug: "chakra-ui",
    strategy: "nav",
    navUrl: "https://chakra-ui.com/docs/components/concepts/overview",
    include: "^https://chakra-ui\\.com/docs/components/([a-z0-9-]+)$",
    frameworks: ["react"],
    titleSuffix: "\\s+\\|\\s+Chakra UI$",
    notes:
      "The components overview page is server-rendered (Next.js) and links every component page in its sidebar and card grid (no sitemap; robots.txt 404 = allowed). /docs/components/concepts/* guides do not match the single-segment include. Utility components documented in the same section (ClientOnly, For, FormatNumber, EnvironmentProvider...) are kept because Chakra documents them as components.",
  },
  {
    slug: "cloudscape",
    strategy: "sitemap",
    sitemapUrl: "https://cloudscape.design/sitemap.xml",
    include: "^https://cloudscape\\.design/components/([a-z0-9-]+)/$",
    exclude: ["/components/(?:board-components|charts|charts-legacy|file-uploading-components|genai-components|hands-on-tutorials)/$"],
    frameworks: ["react"],
    titleSuffix: "\\s+-\\s+Cloudscape Design System$",
    notes:
      "Official sitemap (declared in robots.txt; only /search is disallowed). /components/<name>/ pages are statically rendered with <h1> and component-specific meta descriptions. Excluded: overview pages that group several components (board components, charts, legacy charts, file uploading components, GenAI components) and hands-on tutorials.",
  },
  {
    slug: "daisyui",
    strategy: "sitemap",
    sitemapUrl: "https://daisyui.com/sitemap.xml",
    include: "^https://daisyui\\.com/components/([a-z0-9-]+)/$",
    frameworks: ["html-css"],
    titleSuffix: "^Tailwind\\s+|\\s+Component\\s+–\\s+daisyUI$",
    notes:
      "Official sitemap (declared in robots.txt; rules only restrict SEO bots and marketing paths). /components/<name>/ pages are static with <h1> and per-component meta descriptions (daisyUI truncates some of them mid-sentence).",
  },
  {
    slug: "devextreme",
    strategy: "sitemap",
    sitemapUrl: "https://js.devexpress.com/sitemap_site.xml",
    include: "^https://js\\.devexpress\\.com/jQuery/Documentation/ApiReference/UI_Components/(dx[A-Za-z0-9]+)/$",
    frameworks: ["jquery", "angular", "react", "vue"],
    titleSuffix: "^JavaScript/jQuery\\s+|\\s+API(?:\\s*\\|.*)?$",
    maxPages: 100,
    notes:
      "Child sitemap of js.devexpress.com/sitemap.xml (declared in robots.txt). Every UI component has one API reference root per framework (jQuery/Angular/React/Vue/...); the jQuery root (/jQuery/Documentation/ApiReference/UI_Components/dx<Name>/) is used as the docs URL and the other framework variants are not counted separately. Headings read 'JavaScript/jQuery <Name> API'; titleSuffix strips the decoration. Meta descriptions are site-wide boilerplate (rejected). Pages are large (~350 KB).",
  },
  {
    slug: "dsfr",
    strategy: "repo-listing",
    repo: { kind: "gh", name: "GouvernementFR/dsfr", ref: "v{latest}", docsUrlTemplate: "https://github.com/GouvernementFR/dsfr/tree/{ref}/{dir}" },
    include: "^src/dsfr/component/([a-z0-9-]+)/index\\.scss$",
    frameworks: ["html-css"],
    fetchPages: false,
    notes:
      "The official docs site www.systeme-de-design.gouv.fr answers 403 behind a bot challenge ('Just a moment...') for both pages and sitemap.xml, so it is not used (never bypassed). Inventory = component modules src/dsfr/component/<name>/ (each has index.scss) of GouvernementFR/dsfr at the latest release tag (v-prefixed tags), listed via jsDelivr; docs URL = that module's GitHub directory (proven by the listing; registry docsUrl is the repository README). Names are the technical module names (English, e.g. 'accordion', 'connect'), not the French display names used on the docs site.",
  },
  {
    slug: "duet-design-system",
    strategy: "sitemap",
    sitemapUrl: "https://www.duetds.com/sitemap.xml",
    include: "^https://www\\.duetds\\.com/components/([a-z0-9-]+)/$",
    frameworks: ["web-components"],
    titleSuffix: "\\s+\\|\\s+Duet Design System$",
    notes:
      "Official sitemap (robots.txt allows all). /components/<name>/ pages are static with an <h1> that carries a status badge ('Button Ready'); the name is the heading text that matches the page title. The site-wide meta description is rejected. Duet is proprietary and its terms limit use of the site: only names, URLs and no descriptions are stored. Components are Stencil web components (@duetds/components); React wrappers exist but the docs document the web components.",
  },
  {
    slug: "elastic-ui",
    strategy: "sitemap",
    sitemapUrl: "https://eui.elastic.co/sitemap.xml",
    include: "^https://eui\\.elastic\\.co/docs/components/(?:(?:containers|display|editors-and-syntax|forms|layout|navigation|tables|templates)/(?:[a-z0-9_-]+/)*?)?([a-z0-9_-]+)/$",
    exclude: [
      "/docs/components/(?:containers|display|editors-and-syntax|forms|layout|navigation|tables|templates)/$",
      "/forms/layouts/(?:usage|validation|compressed-forms)/$",
      "/forms/selection/overview/$",
      "/tables/layout-guidelines/$",
      "/guidelines/$",
      "/markdown/plugins/$",
    ],
    frameworks: ["react"],
    titleSuffix: "\\s+\\|\\s+Elastic UI Framework$",
    notes:
      "Docusaurus sitemap (eui.elastic.co/sitemap.xml; robots.txt 404 = allowed). Component pages live under /docs/components/<category>/[<group>/]<name>/; the data grid is one component (/docs/components/data-grid/) whose sub-pages are guides. Excluded: form layout usage/validation guides, selection overview, table layout guidelines, page template guidelines, markdown plugin guide. Pages sharing a final segment in different categories (e.g. display/text vs forms/text) are kept as separate components keyed <parent>-<segment>.",
  },
  {
    slug: "element-plus",
    strategy: "repo-listing",
    repo: { kind: "gh", name: "element-plus/element-plus", ref: "{latest}", docsUrlTemplate: "https://github.com/element-plus/element-plus/blob/{ref}/{path}" },
    include: "^docs/en-US/component/([a-z0-9-]+)\\.md$",
    exclude: ["/(?:overview|color|border|typography)\\.md$"],
    frameworks: ["vue"],
    maxPages: 90,
    notes:
      "element-plus.org/robots.txt answers HTTP 526 (Cloudflare origin error), which RFC 9309 treats as 'disallow all', so the website is not fetched. Inventory = the English component docs sources docs/en-US/component/<name>.md in element-plus/element-plus at the latest release tag ({latest}; tags have no 'v' prefix), listed via jsDelivr; docs URL = GitHub blob of that markdown; name = its '# Heading', description = first prose paragraph. Excluded: the components overview and the Color/Border/Typography foundation pages.",
  },
  {
    slug: "equinor-eds",
    strategy: "sitemap",
    sitemapUrl: "https://eds.equinor.com/sitemap.xml",
    include: "^https://eds\\.equinor\\.com/docs/components/[a-z-]+/([a-z0-9_]+)/?$",
    frameworks: ["react"],
    titleSuffix: "\\s+\\|\\s+Equinor Design System$",
    notes:
      "Official sitemap (declared in robots.txt, which allows all). Only the 'Latest' docs (/docs/components/<category>/<name>) are used; the 2.0.0-beta and Next versioned copies are not matched. Several pages carry placeholder meta descriptions ('Not in SB'), which the adapter rejects as too short.",
  },
  {
    slug: "esri-calcite",
    strategy: "sitemap",
    sitemapUrl: "https://developers.arcgis.com/calcite-design-system/sitemap-0.xml",
    include: "^https://developers\\.arcgis\\.com/calcite-design-system/components/([a-z0-9-]+)/$",
    frameworks: ["web-components"],
    titleSuffix: "\\s+\\|\\s+Calcite Design System\\s+\\|\\s+Esri Developer$",
    maxPages: 110,
    notes:
      "Calcite's own child sitemap of developers.arcgis.com/sitemap-index.xml (declared in robots.txt; component paths are allowed). One page per web component, including child components (accordion-item, tab-title...), which Calcite ships as separate custom elements. Meta descriptions are a per-name template ('Calcite X is one of many reusable elements...'), which the adapter rejects as boilerplate.",
  },
  {
    slug: "flowbite",
    strategy: "nav",
    navUrl: "https://flowbite.com/docs/getting-started/introduction/",
    include: "^https://flowbite\\.com/docs/(?:components|forms)/([a-z0-9-]+)/$",
    exclude: ["/docs/components/(?:forms|typography)/$"],
    frameworks: ["html-css"],
    titleSuffix: "^Tailwind CSS\\s+|\\s+-\\s+Flowbite$",
    notes:
      "Static docs sidebar on flowbite.com/docs (no sitemap: /sitemap.xml 404; robots.txt allows all). Components = the Components and Forms sections of the core (HTML + Tailwind) library; components/forms and components/typography are overview pages, and the Typography section (headings, paragraphs, lists...) styles native elements, so both are excluded. Framework ports (flowbite-react, -vue, -svelte, -angular) have separate docs sites and are not enumerated here.",
  },
];
