import type { GenericTarget } from "./types";

/**
 * Targets researched by generic workstream 4.
 * Every source below was checked with PoliteFetcher (robots.txt allowance included) on 2026-11-05.
 * Systems of this workstream WITHOUT a target stay metadata-only (see the workstream report):
 * none at the time of writing.
 */
export const TARGETS_4: GenericTarget[] = [
  {
    slug: "red-hat-design-system",
    strategy: "nav",
    navUrl: "https://ux.redhat.com/elements/",
    include: "^https://ux\\.redhat\\.com/elements/([a-z0-9-]+)/$",
    frameworks: ["web-components"],
    titleSuffix: "\\s+\\|\\s+Red Hat design system$",
    notes:
      "ux.redhat.com/elements/ ('All elements') is the official catalog of @rhds/elements; its static HTML has one card (h4 > a) per element. robots.txt allows all (only /_templates/ disallowed); no sitemap.xml (404). The sidebar uses rh-navigation-link elements whose anchors live in declarative shadow DOM <template>s, which the adapter strips, so only the card grid is read: 48 elements. The sidebar additionally lists 'Scheme dropdown' (no card), so that one element is missed. Page titles read 'Overview | <Element> | Red Hat design system'; the adapter picks the part naming the element.",
  },
  {
    slug: "rei-cedar",
    strategy: "sitemap",
    sitemapUrl: "https://cedar.rei.com/sitemap.xml",
    include: "^https://cedar\\.rei\\.com/components/([a-z0-9-]+)$",
    exclude: ["/components/component-variables$"],
    frameworks: ["vue"],
    fetchPages: false,
    notes:
      "cedar.rei.com/sitemap.xml (Nuxt sitemap, not referenced from robots.txt, which allows all) lists every page of the docs; /components/<slug> pages match the 'Components' sidebar of cedar.rei.com/components exactly (41 components). 'Component variables' is a reference page and excluded. Page fetches are disabled: every page carries the same site-wide meta description and a lowercase <h1> (capitalised via CSS), so names come from the URL slug (e.g. 'Form Group') and descriptions stay not-extracted.",
  },
  {
    slug: "salesforce-lightning",
    strategy: "repo-listing",
    repo: {
      kind: "gh",
      name: "salesforce-ux/design-system",
      ref: "main",
      docsUrlTemplate: "https://v1.lightningdesignsystem.com/components/{segment}/",
    },
    include: "^ui/components/([a-z0-9-]+)/docs\\.mdx$",
    exclude: ["^ui/components/lookups-mobile/"],
    frameworks: ["html-css"],
    titleSuffix: "\\s+-\\s+Lightning Design System$",
    maxPages: 100,
    notes:
      "www.lightningdesignsystem.com now serves 'Lightning Design System 2' from a client-rendered zeroheight site (no links in static HTML; its sitemap.xml is zeroheight's own), so components are enumerated from the official SLDS source repository: one ui/components/<name>/docs.mdx per documented CSS blueprint (jsDelivr gh listing of the 'main' branch, 86 dirs; the stale 'master' branch, package version 2.16.2, lists the same set). Docs URLs point at the SLDS 1 docs (v1.lightningdesignsystem.com/components/<name>/), whose static nav lists the same set; each URL is confirmed by a page fetch. lookups-mobile has docs.mdx but no v1 page (404) and is excluded. Caveats: v1.lightningdesignsystem.com has no robots.txt (404 => allowed) but its pages carry <meta name=robots content='noindex, nofollow'>; only the page <title>/<h1> are read to confirm the link (v1 pages have no meta description). Set fetchPages:false to avoid fetching them (docs URLs would then be dropped as unconfirmed). Blueprints are the html-css implementation; Lightning Web Components / design-system-react are separate.",
  },
  {
    slug: "sap-fiori",
    strategy: "sitemap",
    sitemapUrl: "https://ui5.github.io/webcomponents/sitemap.xml",
    include: "^https://ui5\\.github\\.io/webcomponents/components/(?:fiori/)?([A-Z][A-Za-z0-9]+)/$",
    frameworks: ["web-components"],
    titleSuffix: "\\s+\\|\\s+UI5 Web Components$",
    maxPages: 90,
    notes:
      "www.sap.com/robots.txt disallows all non-whitelisted crawlers, so the SAP Fiori guideline pages are NOT used. Components come from UI5 Web Components (the registry repositoryUrl, SAP's official Fiori implementation): ui5.github.io/webcomponents/sitemap.xml (Docusaurus; ui5.github.io robots.txt allows all) lists one API page per custom element under /components/ (main package) and /components/fiori/ (fiori package): 173 elements, including documented child elements (e.g. BreadcrumbsItem, TableRow). Excluded by the include rule: enums/ and interfaces/ pages, the experimental /components/ai/ package (Button, Input, TextArea would duplicate main names) and the legacy /components/compat/ Table. Page meta descriptions are element-specific; maxPages 90 keeps the run short, so roughly half the components carry a description.",
  },
  {
    slug: "seek-braid",
    strategy: "nav",
    navUrl: "https://seek-oss.github.io/braid-design-system/components/",
    include: "^https://seek-oss\\.github\\.io/braid-design-system/components/([A-Za-z]+)$",
    exclude: ["/components/(?:use[A-Z][A-Za-z]*|BraidPortal|BraidProvider|BraidTestProvider|ThemeNameConsumer|Link)$"],
    frameworks: ["react"],
    fetchPages: false,
    notes:
      "The Braid docs components index (server-rendered React, GitHub Pages; robots.txt allows all, no sitemap) links every component page in its sidebar. The 'Logic' section (BraidPortal, BraidProvider, BraidTestProvider, Link, ThemeNameConsumer and use* hooks) and the useToast hook are excluded as non-visual providers/hooks; 58 components remain. Page fetches are disabled: every page shares the site-wide meta description, and nav link texts are the exact component names (e.g. 'TextField').",
  },
  {
    slug: "semantic-ui",
    strategy: "nav",
    navUrl: "https://semantic-ui.com/introduction/getting-started.html",
    include: "^https://semantic-ui\\.com/(?:elements|collections|views|modules)/([a-z]+)\\.html$",
    titleSuffix: "\\s+\\|\\s+Semantic UI$",
    notes:
      "The static sidebar of semantic-ui.com (robots.txt allows all; no sitemap) groups the UI definitions into Elements, Collections, Views and Modules (43 components). 'Behaviors' (API, Form Validation, Visibility) are JavaScript behaviors, not components, and fall outside the include rule. Meta descriptions are component-specific. Frameworks left unset: these docs cover the CSS + jQuery distribution, while semantic-ui-react is a separate implementation.",
  },
  {
    slug: "semi-design",
    strategy: "nav",
    navUrl: "https://semi.design/en-US/start/overview",
    include: "^https://semi\\.design/en-US/(?:ai|basic|plus|input|navigation|show|feedback|other)/([A-Za-z]+)$",
    exclude: ["/ai/aiComponent$", "/basic/tokens$", "/show/chart$"],
    frameworks: ["react"],
    titleSuffix: "\\s+-\\s+Semi Design$",
    notes:
      "The English 'Overview' page of semi.design is server-rendered (Gatsby) with the full component sidebar; robots.txt allows all. semi.design/sitemap.xml exists but is stale (it misses newer components such as ColorPicker, PinCode, Chat, Cropper, AIChatInput), so the nav is used. Excluded: 'AI Ability Introduction' (ai/aiComponent), 'Tokens' (basic/tokens) and 'Data Visualization' (show/chart, a VChart guide). Pages are fetched for names because nav link texts carry 'New' badges; meta descriptions are site-wide boilerplate and are dropped.",
  },
  {
    slug: "shadcn-ui",
    strategy: "sitemap",
    sitemapUrl: "https://ui.shadcn.com/sitemap.xml",
    include: "^https://ui\\.shadcn\\.com/docs/components/base/([a-z0-9-]+)$",
    exclude: ["/typography$"],
    frameworks: ["react"],
    titleSuffix: "\\s+-\\s+shadcn/ui$",
    notes:
      "ui.shadcn.com/sitemap.xml (declared in robots.txt, which allows all) lists every component page once per primitive base (/docs/components/base|radix|aria/<name>). Base UI is the default base since July 2026 and /docs/components links to the base pages, so only those are used (65 components). 'Typography' is a page of text styles with no installable component and is excluded. The radix base additionally lists 'Sonner'; the aria base lacks menubar/navigation-menu.",
  },
  {
    slug: "shoelace",
    strategy: "nav",
    navUrl: "https://shoelace.style/getting-started/installation",
    include: "^https://shoelace\\.style/components/([a-z0-9-]+)$",
    frameworks: ["web-components"],
    notes:
      "Static sidebar of the Shoelace docs (shoelace.style; robots.txt allows all, no sitemap) links all 58 component pages; titles and meta descriptions are component-specific. Shoelace is sunset (successor: Web Awesome), but the 2.x docs remain online and are the authoritative record of its components.",
  },
  {
    slug: "skyscanner-backpack",
    strategy: "sitemap",
    sitemapUrl: "https://www.skyscanner.design/latest/sitemap.xml",
    include: "^https://www\\.skyscanner\\.design/latest/components/(?:[a-z0-9-]+/)?([a-z0-9-]+)/[a-z0-9-]+-[A-Za-z0-9]{8}$",
    exclude: ["/components/utility-components/(?:theming|z-index)/"],
    titleSuffix: "^[^|]+\\|\\s+",
    notes:
      "skyscanner.design is a client-rendered Supernova site (sidebar not in static HTML); its /latest/sitemap.xml lists every page. /robots.txt redirects to an HTML page, i.e. no rules (allowed). Component pages are /latest/components/[<group>/]<component>/<tab>-<id> with one page per tab (overview, usage, web, compose, swift-ui, ...); the include rule captures the component directory so the tabs collapse to one component, using the shortest tab URL as the docs URL. Groups (cells/, chat-ui/, compare/, utility-components/) are skipped in the capture; foundations are outside the rule. Excluded: utility-components/theming (a theming guide) and utility-components/z-index (Sass tokens); 104 components remain. Known adapter effect: components with several tab pages get keys prefixed with their parent path part (e.g. 'components-button'), see the workstream report. Titles read '<Tab> | <Component>' (the titleSuffix strips the tab). Pages carry <meta name=robots content=nofollow> (no noindex); the sitemap is the enumeration source, links are not followed. Frameworks unset: pages document web (React) and native (iOS/Android) implementations.",
  },
  {
    slug: "syncfusion-essential-studio",
    strategy: "nav",
    navUrl: "https://ej2.syncfusion.com/documentation/introduction",
    include: "^https://ej2\\.syncfusion\\.com/documentation/([a-z0-9-]+)/getting-started$",
    fetchPages: false,
    notes:
      "The Essential JS 2 (TypeScript/JavaScript) documentation introduction page statically lists every control with a link to its getting-started page (98 controls). ej2.syncfusion.com/robots.txt disallows the *-docs sitemaps, sample folders and versioned paths but allows /documentation/<control>/getting-started. Pages are not fetched: their titles/descriptions describe the getting-started guide, not the control. Names come from nav link texts where they match the URL slug, otherwise from the slug (e.g. 'Pivotview' for 'Pivot Table', 'Maskedtextbox' for 'Input Mask'). Scope caveat: Essential Studio spans 1,600+ components across platforms; this is the EJ2 web suite (each control also ships React/Angular/Vue/Blazor wrappers), so frameworks are left unset.",
  },
  {
    slug: "thumbprint",
    strategy: "nav",
    navUrl: "https://thumbprint.design/components/overview",
    include: "^https://thumbprint\\.design/components/([a-z0-9-]+)/v\\d+/[a-z-]+$",
    titleSuffix: "\\s+\\([^)]*\\)\\s+\\|\\s+Thumbprint$",
    notes:
      "The thumbprint.design components overview (Next.js, server-rendered; robots.txt 404 => allowed) has a sidebar linking each documented component's default page (/components/<name>/v<N>/<usage|react|ios|...>): 30 components. Global CSS and Mixins are excluded by the include rule. The overview's status table also names ~15 components without a docs page (e.g. Form Note, Popover, Modal Curtain); they have no URL and are not enumerated. Titles read '<Name> (<Platform>) | Thumbprint'. /internal/* pages are login-gated and never requested.",
  },
  {
    slug: "twilio-paste",
    strategy: "repo-listing",
    repo: {
      kind: "npm",
      name: "@twilio-paste/core",
      ref: "21.5.0",
      docsUrlTemplate: "https://github.com/twilio-labs/paste/blob/main/packages/paste-website/src/pages/components/{segment}/index.mdx",
    },
    include: "^([a-z0-9-]+)/package\\.json$",
    exclude: [
      "-(?:library|primitive|utils)/package\\.json$",
      "^(?:utils|customization|design-tokens|theme|style-props|types|base-radio-checkbox|box|text|sibling-box)/package\\.json$",
      "^(?:footnote|form|inline-control-group|input-box|status)/package\\.json$",
    ],
    frameworks: ["react"],
    maxPages: 100,
    notes:
      "paste.twilio.design now redirects to the GitHub repo and the docs live in-repo (packages/paste-website/src/pages); the Paste Storybook is behind a Chromatic login (401) and the repo is too large for a jsDelivr gh listing (403). Components are therefore enumerated from the latest @twilio-paste/core bundle (21.5.0, jsDelivr npm listing): one <name>/package.json entry per bundled package (116). Excluded: libraries (*-library), primitives (*-primitive, box, text, sibling-box, base-radio-checkbox), utilities and theming packages (utils, *-utils, customization, design-tokens, theme, style-props, types), and five packages without a docs page of the same name (footnote, form -> 'form-layout', inline-control-group, input-box, status -> 'status-badge'/'status-menu'). Docs URL template = GitHub blob of the in-repo MDX docs page (GitHub tree pages are robots-disallowed); the adapter confirms it by fetching the raw file. All 80 pages exist (HEAD-checked 2026-11-05), but they carry their title/description in an MDX 'export const meta = {...}' block and have no '# ' heading, so the adapter currently cannot confirm them and records no docs URL (see the workstream report's requested change). Names come from the package slug.",
  },
  {
    slug: "uikit",
    strategy: "nav",
    navUrl: "https://getuikit.com/docs/introduction",
    include: "^https://getuikit\\.com/docs/([a-z0-9-]+)$",
    exclude: [
      "/docs/(?:introduction|installation|less|sass|javascript|webpack|custom-icons|avoiding-conflicts|accessibility|rtl|migration)$",
      "/docs/(?:align|animation|background|base|column|flex|height|inverse|margin|padding|position|print|text|transition|utility|visibility|width)$",
    ],
    frameworks: ["html-css"],
    fetchPages: false,
    notes:
      "The getuikit.com docs sidebar (static HTML; robots.txt 404 => allowed, no sitemap) has a 'Getting started' list and a 'Components' list. Getting-started pages are excluded, and so are 17 entries UIkit files under 'Components' that are CSS utility/base-style modules rather than UI components (Align, Animation, Background, Base, Column, Flex, Height, Inverse, Margin, Padding, Position, Print, Text, Transition, Utility, Visibility, Width); 64 components remain. Pages are not fetched: they share one site-wide meta description and the nav texts are the component names.",
  },
  {
    slug: "uswds",
    strategy: "sitemap",
    sitemapUrl: "https://designsystem.digital.gov/sitemap.xml",
    include: "^https://designsystem\\.digital\\.gov/components/([a-z0-9-]+)/$",
    exclude: ["/components/(?:overview|status|lifecycle|packages|data-visualizations|typography)/$"],
    frameworks: ["html-css"],
    titleSuffix: "\\s+\\|\\s+U\\.S\\. Web Design System \\(USWDS\\)$",
    notes:
      "designsystem.digital.gov/sitemap.xml (declared in robots.txt, which allows all) lists each component page plus its /accessibility-tests/ subpage (outside the include rule). Excluded: the components overview, status, lifecycle and packages pages, 'Data visualizations' (guidance only, no component code) and 'Typography' (type-style guidance; tokens are documented separately): 45 components. Most pages share a site-wide meta description, which the adapter drops.",
  },
  {
    slug: "vercel-geist",
    strategy: "nav",
    navUrl: "https://vercel.com/geist/introduction",
    include: "^https://vercel\\.com/geist/([a-z0-9-]+)$",
    exclude: ["/geist/(?:introduction|colors|typography|materials|terminal|brands|geistcn-icons)$"],
    notes:
      "The Geist introduction page on vercel.com is server-rendered with the full sidebar (robots.txt allows /geist/; vercel.com/sitemap.xml also lists the pages but is ~9k URLs). Foundation and resource pages (Introduction, Colors, Typography, Materials, Terminal theme, Brand Assets, Icons) are excluded; 'Grid' is the Grid layout component and kept. Component titles and meta descriptions are page-specific. Frameworks unset: the docs describe React building blocks, but no public package or repository exists.",
  },
  {
    slug: "volvo-cars-design-system",
    strategy: "sitemap",
    sitemapUrl: "https://designsystem.volvocars.com/sitemap-index.xml",
    include: "^https://designsystem\\.volvocars\\.com/web/components/([a-z0-9-]+)/$",
    titleSuffix: "\\s+\\|\\s+Volvo Cars Web Design System$",
    notes:
      "Astro sitemap index (linked via <link rel=sitemap> on every page; robots.txt 404 => allowed). /web/components/<name>/ pages match the 'Explore the components' list on designsystem.volvocars.com/web/ (41). /preview/... example iframes are outside the include rule. Titles and meta descriptions are page-specific. Frameworks unset: components are documented for both @volvo-cars/css (HTML/CSS) and React packages.",
  },
  {
    slug: "vuetify",
    strategy: "repo-listing",
    repo: {
      kind: "gh",
      name: "vuetifyjs/vuetify",
      ref: "v{npm:vuetify}",
      docsUrlTemplate: "https://github.com/vuetifyjs/vuetify/blob/{ref}/{path}",
    },
    include: "^packages/docs/src/pages/en/components/([a-z0-9-]+)\\.md$",
    exclude: ["/components/all\\.md$"],
    frameworks: ["vue"],
    maxPages: 100,
    notes:
      "vuetifyjs.com is a client-rendered SPA (robots.txt allows all, but /sitemap.xml returns the SPA shell), so components are enumerated from the docs sources in the official repo: packages/docs/src/pages/en/components/<page>.md, which the docs router serves at /en/components/<page>/. Listed via jsDelivr at the release tag of the latest npm version (v{npm:vuetify}, v4.3.2 on 2026-11-05): jsDelivr's cached 'master' listing was stale (88 vs 106 pages, missing e.g. avatar-groups, hotkeys, split-buttons). Docs URL = GitHub blob of the page source (proven by the listing; the vuetifyjs.com route cannot be confirmed statically because the SPA answers 200 for any path); name = its '# Heading' (page titles are plural, e.g. 'Buttons'), description = first paragraph. Excluded: all.md (the 'All components' index). Not covered: the multi-page Data tables section (data-tables/*.md) and the component explorer.",
  },
  {
    slug: "web-awesome",
    strategy: "sitemap",
    sitemapUrl: "https://webawesome.com/sitemap.xml",
    include: "^https://webawesome\\.com/docs/components/([a-z0-9-]+)/$",
    frameworks: ["web-components"],
    titleSuffix: "\\s+\\|\\s+Web Awesome$",
    notes:
      "webawesome.com/sitemap.xml (declared in robots.txt, which allows all) lists every component page under /docs/components/<name>/ (91, including Pro-tier components such as charts and Data Grid; the docs pages are public). Titles and meta descriptions are component-specific.",
  },
  {
    slug: "workday-canvas",
    strategy: "sitemap",
    sitemapUrl: "https://workday.github.io/canvas-kit/index.json",
    include:
      "^https://workday\\.github\\.io/canvas-kit/\\?path=/docs/(?:components|preview)-(?:(?:buttons|containers|indicators|inputs|layout|navigation|popups|text)-)?([a-z0-9-]+)--docs$",
    exclude: ["-deprecated--docs$", "/docs/preview-tabs--docs$"],
    frameworks: ["react"],
    fetchPages: false,
    notes:
      "The design-guideline sites (canvas.workday.com, design.workday.com) return HTTP 403 to ATLAS, so the official Canvas Kit Storybook (registry docsUrl; GitHub Pages, robots.txt allows all) is used via its machine-readable index.json (Storybook 8 'entries'). Included: 'Components/*' docs entries of the main package plus 'Preview/*' components; excluded: entries marked '(deprecated)' (Radio, Switch, Status Indicator and Label Text in main are replaced by Preview versions) and Preview Tabs (duplicates main Tabs). Labs, Guides, Styling, Features, Tokens and Examples entries are out of scope. Pages are not fetched (every Storybook URL serves the same shell); names come from the entry titles (e.g. 'Components/Buttons/Action Bar').",
  },
  {
    slug: "zendesk-garden",
    strategy: "nav",
    navUrl: "https://garden.zendesk.com/components/",
    include: "^https://garden\\.zendesk\\.com/components/([a-z0-9-]+)$",
    exclude: ["/components/(?:versions|palette|theme-object|theme-provider|color-scheme-provider|utilities|typography)$"],
    frameworks: ["react"],
    titleSuffix: "\\s+/\\s+Components\\s+/\\s+Zendesk Garden$",
    notes:
      "Server-rendered (Gatsby) sidebar of garden.zendesk.com/components/ (robots.txt 404 => allowed, no sitemap) links every component page; group headers ('Forms', 'Loaders', 'Notification', 'Typography') link to their first component, so names come from page titles ('<Name> / Components / Zendesk Garden'). Excluded: the 'Theming' group (Color scheme provider, Palette, Theme object, Theme provider, Utilities), the Typography overview page and 'View previous versions'. Meta descriptions are component-specific.",
  },
];
