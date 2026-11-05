import type { GenericTarget } from "./types";

/**
 * Targets researched by generic workstream 2.
 * Every source below was checked with PoliteFetcher (robots.txt allowance included) on 2026-11-05.
 * Systems of this workstream WITHOUT a target (documented in the workstream report):
 *  - microsoft-fast: current docs (3.x, 2.x) have no component catalog (FAST Element is an authoring library).
 *  - ignite-ui: docs nav/sitemap mix ~420 feature pages; anchors are empty and h1/titles carry framework
 *    prefixes ("Angular Data Grid Component Overview"), so clean metadata-level names are not derivable.
 */
export const TARGETS_2: GenericTarget[] = [
  {
    slug: "flutter-cupertino",
    strategy: "nav",
    navUrl: "https://docs.flutter.dev/ui/widgets/cupertino",
    navSelector: "main",
    include: "^https://pub\\.dev/documentation/cupertino_ui/latest/cupertino_ui/(Cupertino[A-Za-z]+)-class\\.html$",
    exclude: [
      // Catalog entries that are not widgets: palettes/colors, theme data, localizations, routes/pages,
      // controllers, painters, scroll behaviors and text-selection control delegates.
      "/Cupertino(?:Colors|DynamicColor|ThemeData|TextThemeData|Theme|Localizations|ScrollBehavior|TabController|TextSelectionControls|DesktopTextSelectionControls|ThumbPainter|PageRoute|DialogRoute|ModalPopupRoute|Page)-class\\.html$",
    ],
    frameworks: ["flutter"],
    maxPages: 60,
    // Strips " class" from the dartdoc h1 ("CupertinoButton class") and the full title suffix.
    titleSuffix: "\\s+class(?:\\s+-\\s+cupertino_ui library\\s+-\\s+Dart API)?$",
    notes:
      "Official Flutter 'Cupertino (iOS-style) widgets' catalog on docs.flutter.dev (static HTML; robots.txt 'Disallow:' empty = allow all). Its <main> links every catalog entry to the cupertino_ui API reference on pub.dev (robots allows /documentation). Non-widget catalog entries (CupertinoColors, *ThemeData, *Localizations, routes, controllers, painters, selection-control delegates) are excluded. fetchPages=false: pub.dev dartdoc pages only carry a boilerplate meta description ('API docs for the X class...'), so names come from the class-name segment.",
  },
  {
    slug: "flutter-material",
    strategy: "nav",
    navUrl: "https://docs.flutter.dev/ui/widgets/material",
    navSelector: "main",
    include: "^https://pub\\.dev/documentation/material_ui/latest/material_ui/([A-Z][A-Za-z]+)-class\\.html$",
    // ButtonStyle is linked as the anchor for the "Common buttons" group, not a widget.
    exclude: ["/ButtonStyle-class\\.html$"],
    frameworks: ["flutter"],
    fetchPages: false,
    titleSuffix: "\\s+class\\s+-\\s+material_ui library\\s+-\\s+Dart API$",
    notes:
      "Official Flutter 'Material component widgets' catalog (Material 3 components) on docs.flutter.dev (static HTML, robots allow all), linking each component to the material_ui API reference on pub.dev. Only class pages are taken: the catalog's 'Common buttons' entry points at ButtonStyle (excluded) and the date/time pickers point at the showDatePicker/showTimePicker functions (not class pages, so not enumerated), and 'Extended FAB' is a FloatingActionButton constructor. The catalog is the curated M3 set (~24 classes), not every class of the material library. fetchPages=false (dartdoc meta descriptions are boilerplate).",
  },
  {
    slug: "fomantic-ui",
    strategy: "nav",
    navUrl: "https://fomantic-ui.com/",
    include: "^https://fomantic-ui\\.com/(?:elements|collections|views|modules)/([a-z-]+)\\.html$",
    frameworks: ["html-css"],
    titleSuffix: "\\s*\\|\\s*Fomantic-UI Docs$",
    notes:
      "Static sidebar menu of fomantic-ui.com (robots.txt allows all; no sitemap). Fomantic groups UI definitions into Elements, Collections, Views and Modules; Behaviors (API, Form validation, State, Visibility), Globals, Usage and Introduction pages are not components and are not matched. Page <title> is 'X | Fomantic-UI Docs' and meta descriptions are component-specific. Modules additionally need jQuery; only html-css is recorded as it applies to every definition.",
  },
  {
    slug: "foundation",
    strategy: "nav",
    navUrl: "https://get.foundation/sites/docs/",
    navSelector: "#docs-menu",
    include: "^https://get\\.foundation/sites/docs/([a-z-]+)\\.html$",
    exclude: [
      // Getting Started / Setup / General layout / Utilities / Typography / Plugins / Sass / Libraries sections.
      "/sites/docs/(?:index|installation|starter-projects|compatibility|accessibility|kitchen-sink|global|rtl|flexbox-mode|sass|sass-functions|sass-mixins|javascript|javascript-utilities|media-queries|xy-grid|grid|flex-grid|prototyping-utilities|flexbox-utilities|visibility|float-classes|typography-base|typography-helpers|abide|equalizer|interchange|toggler|smooth-scroll|sticky|motion-ui|panini|style-sherpa)\\.html$",
    ],
    frameworks: ["html-css"],
    titleSuffix: "\\s*\\|\\s*Foundation for Sites 6 Docs$",
    notes:
      "Static docs sidebar (#docs-menu) of Foundation for Sites 6 (robots.txt 404 = unrestricted; no sitemap). Components = the Controls, Navigation, Containers and Media sections plus Forms; Getting Started, Setup, grids, Utilities, Typography, Plugins (Abide, Equalizer, Interchange, Toggler, Smooth Scroll, Sticky), Sass and Libraries pages are excluded. v6 is in maintenance (Yeti 7 in development).",
  },
  {
    slug: "framework7",
    strategy: "nav",
    navUrl: "https://framework7.io/docs/",
    navSelector: "li:has(> .title:contains('Components')) > ul",
    include: "^https://framework7\\.io/docs/([a-z0-9-]+)\\.html$",
    // App/Core, Form Data/Storage, Icons and View/Router entries of the Components list are APIs, not UI components.
    exclude: ["/docs/(?:app|form|icons|view)\\.html$"],
    frameworks: ["html-css", "react", "vue", "svelte"],
    // Drops alias suffixes from h1/title ("Accordion / Collapsible", "List View (Table View)") and the site name.
    titleSuffix: "\\s+/\\s+.*$|\\s+\\([^)]*\\)$|\\s*\\|\\s*Framework7(?: Documentation)?$",
    notes:
      "The 'Components' group of the static framework7.io docs sidebar (robots.txt allows /docs/; only /packages/, /kitchen-sink/, /docs-demos/ are disallowed). Core docs URLs (/docs/<name>.html) are used. Framework7 ships React, Vue and Svelte versions of every component (sitemap.xml lists 78 per-component pages under each of /react/, /vue/, /svelte/), hence all four frameworks; html-css stands for the framework-agnostic core (no vanilla-JS slug in the taxonomy).",
  },
  {
    slug: "gc-design-system",
    strategy: "sitemap",
    sitemapUrl: "https://design-system.canada.ca/sitemap-index.xml",
    include: "^https://design-system\\.canada\\.ca/en/components/([a-z-]+)/$",
    // A guidance page under /components/, not a component.
    exclude: ["/components/validate-form-components/$"],
    frameworks: ["web-components"],
    titleSuffix: "\\s*(?:-\\s*Use case\\s*)?\\|\\s*GC Design System$",
    notes:
      "Astro sitemap index (sitemap-index.xml -> sitemap-0.xml) of the GC Design System site; robots.txt is served as HTML (no rules = allowed). Only current English component landing pages (/en/components/<name>/) are taken; versioned snapshots (/en/components/1.6.0/...), /code/ and /design/ tabs and French duplicates are not matched. Titles are 'Button - Use case | GC Design System'. Components are Stencil web components; React/Angular/Vue packages wrap them, but only web-components is recorded.",
  },
  {
    slug: "gestalt",
    strategy: "nav",
    navUrl: "https://gestalt.pinterest.systems/v1/web/overview",
    include: "^https://gestalt\\.pinterest\\.systems/web/([a-z]+)$",
    exclude: ["/web/overview$"],
    docsUrlTemplate: "https://gestalt.pinterest.systems/v1/web/{segment}",
    frameworks: ["react"],
    // The <title> is a broken ", Opens a new tab"; h1s carry status badges ("BannerOverlay Pilot").
    titleSuffix: "^,\\s*Opens a new tab$|\\s+(?:Pilot|Experimental|Beta|Alpha|Deprecated|Legacy|New)$",
    notes:
      "Gestalt 'Web component overview' page: static HTML card grid linking every web component (/web/<name>, which redirects to the /v1/web/<name> docs). robots.txt redirects to an Okta sign-in HTML page (no rules = allowed); docs pages themselves are public. Utilities (/web/utilities/*) and zindex_classes are not matched. Page <title> is broken (', Opens a new tab', from an SVG title), so names come from the h1 ('ButtonGroup'). Link texts concatenate name and description and are not used for names.",
  },
  {
    slug: "gitlab-pajamas",
    strategy: "nav",
    navUrl: "https://design.gitlab.com/components/",
    include: "^https://design\\.gitlab\\.com/components/([a-z-]+)/?$",
    // dropdown-overview is a chooser page; utility-* are code utilities; 'socks' is a joke page.
    exclude: ["/components/(?:dropdown-overview|socks|utility-[a-z-]+)/?$"],
    // Some titles/h1s are prefixed with a warning emoji ("⚠️ Banner").
    titleSuffix: "^⚠️\\s*|\\s*\\|\\s*Pajamas Design System$",
    notes:
      "Static sidebar of design.gitlab.com/components (robots.txt redirects to a gitlab.com sign-in page answering 403 = unrestricted per RFC 9309; docs pages are public). Excluded: the Dropdown overview chooser, GitLab UI utility pages (utility-animated-number, utility-truncate...) and the 'Socks' joke page ('Socks represent a unique way to warm your feet'). Frameworks are not recorded: Pajamas documents some components that have no GitLab UI (Vue) implementation yet.",
  },
  {
    slug: "hashicorp-helios",
    strategy: "sitemap",
    sitemapUrl: "https://helios.hashicorp.design/sitemap.xml",
    // table/table and table/advanced-table collapse to their last part; copy/, form/, link/, stepper/ keep the group.
    include: "^https://helios\\.hashicorp\\.design/components/(?:table/)?((?:copy|form|link|stepper)/[a-z-]+|[a-z-]+)$",
    exclude: ["/components/form/(?:layout|primitives)$"],
    frameworks: ["ember"],
    titleSuffix: "\\s*\\|\\s*Helios Design System$",
    notes:
      "sitemap.xml of helios.hashicorp.design (robots.txt allows all); identical to the /components index nav. Nested groups (copy/, form/, link/, stepper/, table/) are separate components. form/layout and form/primitives are composition guides, not components; /content/components/* (writing guidelines) and /testing/components/* are not matched. Ember is the single official implementation.",
  },
  {
    slug: "headless-ui",
    strategy: "nav",
    navUrl: "https://headlessui.com/react/menu",
    include: "^https://headlessui\\.com/react/([a-z-]+)$",
    frameworks: ["react"],
    titleSuffix: "\\s*-\\s*Headless UI$",
    notes:
      "Static sidebar of the Headless UI React docs (v2). robots.txt only contains content-signal comments (no rules = allowed); no sitemap. The Vue package stays on v1 (docs under /v1/vue/*), so only the React docs URLs and framework are recorded. The og:description is the same site tagline on every page and is dropped as boilerplate.",
  },
  {
    slug: "heroui",
    strategy: "sitemap",
    sitemapUrl: "https://heroui.com/sitemap.xml",
    include: "^https://heroui\\.com/en/docs/react/components/([a-z-]+)$",
    frameworks: ["react"],
    titleSuffix: "\\s*\\|\\s*HeroUI$",
    notes:
      "heroui.com/sitemap.xml (declared in robots.txt; User-agent * Allow: /). Only English React component pages are taken (HeroUI v3, /en/docs/react/components/<name>); Chinese (/cn/) duplicates and HeroUI Native (/docs/native/components/*, a separate React Native package) are not matched. Titles are 'DateRangePicker | HeroUI' with component-specific meta descriptions.",
  },
  {
    slug: "hpe-design-system",
    strategy: "repo-listing",
    repo: { kind: "gh", name: "grommet/hpe-design-system", ref: "main", docsUrlTemplate: "https://design-system.hpe.design/components/{segment}" },
    include: "^apps/docs/src/pages/components/([a-z-]+)(?:/index)?\\.mdx$",
    exclude: ["/all-components\\.mdx$"],
    frameworks: ["react"],
    fetchPages: true,
    maxPages: 60,
    notes:
      "The docs site is a client-rendered Next.js export (no sitemap, empty static HTML), so components are enumerated from the docs source in the official repo (jsDelivr listing of grommet/hpe-design-system@main: apps/docs/src/pages/components/<name>.mdx, which become /components/<name> routes). Card sub-pages (card/call-to-action-card...) are variants and not matched; all-components is the index. Each constructed docs URL is confirmed by a page fetch (HTTP 200 vs 404 for unknown routes). Caveat: routes are lowercase concatenations (dateinput, namevaluelist), and pages expose no static title, so names are humanized from the route ('Dateinput' for DateInput).",
  },
  {
    slug: "ionic",
    strategy: "nav",
    navUrl: "https://ionicframework.com/docs/components",
    include: "^https://ionicframework\\.com/docs/api/([a-z-]+)$",
    // Routing infrastructure elements listed on the components index.
    exclude: ["/docs/api/(?:router|router-link|router-outlet|route|route-redirect)$"],
    frameworks: ["web-components", "angular", "react", "vue"],
    notes:
      "Official 'UI Components' index (ionicframework.com/docs/components, static Docusaurus HTML; robots.txt Allow: /) linking every ion-* element API page. Routing elements (ion-router, ion-router-link, ion-router-outlet, ion-route, ion-route-redirect) are excluded. Names are the element tags from the h1 ('ion-button'). Ionic's Angular/React/Vue packages expose every core component, so all four frameworks are recorded.",
  },
  {
    slug: "kendo-ui",
    strategy: "nav",
    navUrl: "https://www.telerik.com/kendo-jquery-ui/documentation/introduction",
    include: "^https://www\\.telerik\\.com/kendo-jquery-ui/documentation/controls/(?:llm-kit/)?([a-z0-9-]+?)(?:/overview)?$",
    // FX (effects), Drag and Drop, Validator are utilities; llm-kit/overview is the kit's landing page.
    exclude: ["/controls/(?:fx|draganddrop|validator)/overview$", "/controls/llm-kit/overview$"],
    frameworks: ["jquery"],
    fetchPages: false,
    notes:
      "Static docs sidebar of Kendo UI for jQuery (telerik.com robots.txt only disallows search/account paths). Components = controls/<name>/overview pages plus the LLM Kit items (controls/llm-kit/<name>); deeper article pages are not matched, FX, Drag and Drop and Validator are utilities. fetchPages=false because page h1s are 'Kendo UI for jQuery DropDownList Overview'; the sidebar link text ('DropDownList') is the clean component name. Only Kendo UI for jQuery is covered here (KendoReact, Kendo UI for Angular and Kendo UI for Vue have separate docs and component sets).",
  },
  {
    slug: "kiwi-orbit",
    strategy: "sitemap",
    sitemapUrl: "https://kiwicom.github.io/orbit/index.json",
    include: "^https://kiwicom\\.github\\.io/orbit/\\?path=/story/([a-z0-9]+)--[a-z0-9-]+$",
    // Provider, umbrella 'Primitives' group, internal *Primitive components and kitchensink demos.
    exclude: ["/story/(?:orbitprovider|primitives|[a-z]+primitive|errorforms-kitchensink)--"],
    frameworks: ["react"],
    fetchPages: false,
    notes:
      "orbit.kiwi (README docs site) is refused by the network proxy and its robots.txt is unreachable (treated as disallow), so the official Storybook at kiwicom.github.io/orbit (registry docsUrl/storybookUrl) is used: its static Storybook index.json lists every story with its component title. One entry per component; the docs URL is the component's first story. Excluded: OrbitProvider, the Primitives umbrella and *Primitive internals, kitchensink demos. Story titles are the component names (ButtonLink). github.io robots.txt 404 = unrestricted.",
  },
  {
    slug: "mantine",
    strategy: "sitemap",
    sitemapUrl: "https://mantine.dev/sitemap.xml",
    include: "^https://mantine\\.dev/core/([a-z-]+)/?$",
    // /core/package is the @mantine/core getting-started page.
    exclude: ["/core/package/?$"],
    frameworks: ["react"],
    maxPages: 130,
    titleSuffix: "\\s*\\|\\s*Mantine$",
    notes:
      "mantine.dev/sitemap.xml (robots.txt Allow: /). Only @mantine/core component pages (/core/<name>) are taken; hooks, theming, styles, guides and extension packages (dates, charts, ...) are not matched. Titles are 'ActionIcon | Mantine' with short component-specific descriptions. Includes Mantine's layout/utility components (Box, Center, Portal, VisuallyHidden...) because the docs list them as core components.",
  },
  {
    slug: "mongodb-leafygreen",
    strategy: "nav",
    navUrl: "https://www.mongodb.design/",
    include: "^https://www\\.mongodb\\.design/component/([a-z-]+)/live-example$",
    // Entries of the sidebar's Foundations and Patterns sections (they share the /component/ path).
    exclude: ["/component/(?:icon|palette|typography|charts|cloud-nav-layout|empty-state|feature-walls)/live-example$"],
    frameworks: ["react"],
    fetchPages: false,
    notes:
      "The mongodb.design homepage is server-rendered and its sidebar links every entry (/component/<name>/live-example); robots.txt is a Next.js 404 page (= unrestricted). Only the 'Components' section is kept: Foundations (Icon, Palette, Typography) and Patterns (Charts, Cloud Nav Layout, Empty State, Feature Walls) live under the same path and are excluded. Component pages render client-side (no title/h1/description in static HTML), so fetchPages=false and names come from the sidebar link text.",
  },
];
