import type { GenericTarget } from "./types";

/**
 * Targets researched by generic workstream 3.
 * Every source below was checked with PoliteFetcher (robots.txt allowance included) on 2026-11-05.
 *
 * Not configured (stay metadata-only; see the workstream report):
 *  - panda-css: styling engine without a component catalog (its JSX "patterns" share one docs page).
 *  - pluralsight-design-system: Pando docs are a client-rendered zeroheight site (no links in static
 *    HTML, opaque page ids); the only public package listing (@pluralsight/react 0.7.1, 2023) does not
 *    match the current docs and gives no way to build docs URLs.
 */
export const TARGETS_3: GenericTarget[] = [
  {
    slug: "mozilla-protocol",
    strategy: "nav",
    navUrl: "https://protocol.mozilla.org/docs/usage/overview",
    navSelector: "#tree-components",
    // Fractal links a component to its default variant ("button--primary"); capture the component handle.
    include: "^https://protocol\\.mozilla\\.org/components/detail/([a-z0-9]+(?:-[a-z0-9]+)*?)(?:--[a-z0-9-]+)?$",
    exclude: ["/components/detail/example-"],
    docsUrlTemplate: "https://protocol.mozilla.org/components/detail/{segment}",
    frameworks: ["html-css"],
    titleSuffix: "\\s*\\|\\s*Mozilla Protocol$|\\s+full view$",
    notes:
      "Static Fractal docs: every page carries the component tree (#tree-components) of the Protocol pattern library, one link per component (default variant). The component handle page (/components/detail/<handle>) exists for every component and is used as the docs URL; its h1 ends with a 'full view' link, stripped via titleSuffix. robots.txt returns 404 (unrestricted). Excluded: 'Example *' entries (example compositions, not components). Both the base-element style page for native <details> ('Details', /components/detail/details) and the 'Details Component' (/components/detail/details-component) are kept as separate components: the adapter keeps a trailing 'Component' when the component's own handle ends in '-component'. Some entries are base-element styles (Headings, Paragraphs, Links) that Protocol documents as components.",
  },
  {
    slug: "naive-ui",
    strategy: "repo-listing",
    repo: {
      kind: "gh",
      name: "tusen-ai/naive-ui",
      ref: "v{npm:naive-ui}",
      docsUrlTemplate: "https://github.com/tusen-ai/naive-ui/blob/{ref}/{path}",
    },
    include: "^src/([a-z0-9-]+)/demos/enUS/index\\.demo-entry\\.md$",
    exclude: ["^src/(?:config-consumer|discrete)/"],
    frameworks: ["vue"],
    notes:
      "www.naiveui.com is a client-rendered SPA whose deep links answer HTTP 404 to non-JS clients, so docs pages cannot be confirmed statically. Each documented component has an English docs source src/<name>/demos/enUS/index.demo-entry.md (the file the site renders); the jsDelivr listing of the release tag of the latest npm version (ref v{npm:naive-ui}, v2.45.3 on 2026-11-05) enumerates them, and the GitHub blob of that file is the docs URL (metadata read from the raw Markdown). A release tag is used because jsDelivr's cached listing of 'main' lagged the branch (missing input-otp, heatmap). Excluded: config-consumer (deprecated, not in the docs menu) and discrete (createDiscreteApi, an API page). Names/descriptions come from the Markdown '# Heading' and first paragraph.",
  },
  {
    slug: "nl-design-system",
    strategy: "nav",
    navUrl: "https://nldesignsystem.nl/componenten/",
    navSelector: "main",
    include: "^https://nldesignsystem\\.nl/([a-z0-9]+(?:-[a-z0-9]+)*)/?$",
    exclude: ["^https://nldesignsystem\\.nl/(?:componenten|handboek|figma|blog|events|nieuws|over-ons|community|richtlijnen|patronen|templates)/?$"],
    titleSuffix: "\\s*·\\s*NL Design System$",
    notes:
      "The official component overview (/componenten/) is server-rendered and its main content links every documented component card ('Bekijk <Name> component'); component pages live at the site root (/<name>/). robots.txt allows all (one earlier robots.txt request got a transient 403 from the host's Imunify360 bot protection; later requests returned 200 'Allow: /'). Descriptions are Dutch meta descriptions. Frameworks are not set: implementations differ per component (CSS, React, community Web Components/Angular/Vue).",
  },
  {
    slug: "nord-design-system",
    strategy: "nav",
    navUrl: "https://nordhealth.design/components/",
    include: "^https://nordhealth\\.design/components/([a-z0-9]+(?:-[a-z0-9]+)*)/?$",
    frameworks: ["web-components"],
    titleSuffix: "\\s+Component\\s+-\\s+Nord Design System$|(?:\\s+(?:New|Beta|Deprecated|Light DOM|&|Tailwind))+$",
    notes:
      "Static (Nuxt) components index lists one card per <nord-*> custom element, grouped by category; category anchors (#form...) are dropped by the include rule. sitemap.xml lists only /components, so the index page is the authoritative enumeration. robots.txt allows all. Licence restricts code use to work for Nordhealth: only names, URLs and short meta descriptions are kept. h1 headings carry status badges ('New', 'Beta', 'Light DOM & Tailwind', 'Deprecated'), stripped via titleSuffix; deprecated components (e.g. Fieldset) are still listed by the docs.",
  },
  {
    slug: "onsen-ui",
    strategy: "sitemap",
    sitemapUrl: "https://onsen.io/sitemap.xml",
    include: "^https?://onsen\\.io/v2/api/js/ons-([a-z]+(?:-[a-z]+)*)\\.html$",
    exclude: ["/ons-if\\.html$"],
    frameworks: ["web-components"],
    // Page titles are the tag name ("ons-button - Onsen UI") and there is no static h1: blank the title so
    // the display name comes from the humanized tag segment ("Alert Dialog").
    titleSuffix: "^.+$",
    notes:
      "robots.txt (allows all) declares http://onsen.io/sitemap.xml (served over https). The sitemap lists the API reference per binding (js, react, vue, vue3, angular1, angular2); the core Web Components reference (/v2/api/js/ons-*.html) is used, one page per <ons-*> element. Excluded: ons-if (conditional-rendering utility) and the ons.* JS utility objects (not matched). The meta description is site-wide boilerplate and is dropped. React/Vue/Angular bindings wrap these elements but are not recorded per component.",
  },
  {
    slug: "ontario-design-system",
    strategy: "nav",
    navUrl: "https://designsystem.ontario.ca/components/detail/components.html",
    include: "^https://designsystem\\.ontario\\.ca/components/detail/([a-z0-9]+(?:-[a-z0-9]+)*)\\.html$",
    exclude: ["/components/detail/(?:components|colours|favicon|fonts-and-typography|grid|spacing|images|icons-primary|icons-secondary|live-validation)\\.html$"],
    titleSuffix: "\\s*\\|\\s*Ontario Design System$",
    notes:
      "The official component index (/components/detail/components.html; /components/ is 404) is static HTML linking every documented page, grouped as essential styles, headers/footers, page content, forms, navigation, feedback, search, images/icons. robots.txt is 404 (unrestricted). Excluded: essential styles (colours, favicon, fonts and typography, grid, spacing), images/photography and the two icon-set pages (guidance, not components) and live validation (a form behaviour guideline). Names keep the docs' plural form (e.g. 'Buttons'). Frameworks not set: pages cover web components plus React/Angular wrappers and HTML-only patterns.",
  },
  {
    slug: "oracle-redwood",
    strategy: "nav",
    navUrl: "https://www.oracle.com/webfolder/technetwork/jet/jsdocs/index.html",
    include: "^https://www\\.oracle\\.com/webfolder/technetwork/jet/jsdocs/oj-c\\.([A-Za-z]+)\\.html$",
    exclude: ["/oj-c\\.(?:AreaChart|LineChart)(?:Group|Item|Series)\\.html$", "/oj-c\\.Legend(?:Item|Section)\\.html$", "/oj-c\\.TagCloudItem\\.html$"],
    frameworks: ["web-components"],
    notes:
      "redwood.oracle.com renders only with JavaScript. Oracle's public implementation of Redwood is the Oracle JET Core Pack: its overview (jsdocs/CorePackOverview.html) states the components are written to the Redwood Design System specification and support only the Redwood theme. The JET API reference index (static HTML; www.oracle.com robots.txt allows /webfolder/ for '*') links one page per Core Pack element (<oj-c-*>, oj-c.<Name>.html). Legacy oj-* elements are not Redwood-specific and are not included. Excluded: chart/legend/tag-cloud child elements (-group/-item/-series/-section). Pages are fetched only to confirm the docs URL: they have no meta description and their <title>/<h1> is the tag ('Element: <oj-c-button>'), so names come from the element class segment (e.g. 'ButtonsetMultiple').",
  },
  {
    slug: "park-ui",
    strategy: "sitemap",
    sitemapUrl: "https://park-ui.com/sitemap.xml",
    include: "^https://park-ui\\.com/docs/components/([a-z0-9]+(?:-[a-z0-9]+)*)/?$",
    frameworks: ["react", "solid"],
    titleSuffix: "\\s*\\|\\s*Park UI$|\\s*\\(WIP\\)",
    notes:
      "robots.txt (Allow: /) declares https://park-ui.com/sitemap.xml, which lists every /docs/components/<name> page (plus docs/blog pages that the include rule drops). Each component page documents React and Solid implementations (the two official install paths). Work-in-progress markers ('(WIP)') are stripped from names.",
  },
  {
    slug: "patternfly",
    strategy: "sitemap",
    sitemapUrl: "https://www.patternfly.org/sitemap.xml",
    include: "^https://www\\.patternfly\\.org/components/(?:(?:forms|menus|date-and-time|file-upload|charts)/)?([a-z0-9]+(?:-[a-z0-9]+)*)/?$",
    exclude: [
      "/components/overview/?$",
      "/components/compass/?$",
      "/components/menus/custom-menus/?$",
      "/components/charts/(?:overview|colors-for-charts|patterns|resize-observer|legends|tooltips|skeletons)/?$",
    ],
    titleSuffix: "^PatternFly\\s*•\\s*",
    notes:
      "https://www.patternfly.org/sitemap.xml (robots.txt is 404, unrestricted) lists every component page under /components/ (some grouped: forms, menus, date-and-time, file-upload, charts); per-component tab pages (/html, /css-variables, /design-guidelines, /accessibility, /react-demos...) are not matched. Excluded: overview pages, 'Custom menus' (examples), Compass (no static content) and chart guidance/sub-element pages (colors, patterns, resize observer, legends, tooltips, skeletons). The meta description is site-wide boilerplate and is dropped. Frameworks not set: most components have React and HTML/CSS implementations, some (charts, code editor) React only.",
  },
  {
    slug: "porsche-design-system",
    strategy: "nav",
    navUrl: "https://designsystem.porsche.com/v4/components/introduction/",
    include: "^https://designsystem\\.porsche\\.com/v4/components/([a-z0-9]+(?:-[a-z0-9]+)*)/configurator/?$",
    frameworks: ["web-components", "react", "angular", "vue"],
    titleSuffix: ":\\s*Configurator\\b.*$",
    notes:
      "The v4 docs are server-rendered; the components introduction page's sidebar links every component's default (configurator) page. robots.txt allows /v4/ (disallows /pr-, /nightly/, /v*-preview); sitemap.xml returns 403. Experimental (🧪) and deprecated (🚫) markers in nav text are not part of names (names come from page titles). Every component ships as a web component (components-js) with generated React/Angular/Vue wrappers. Meta descriptions are templated per component.",
  },
  {
    slug: "primeng",
    strategy: "nav",
    navUrl: "https://primeng.dev/autocomplete",
    navSelector: "aside",
    include: "^https://primeng\\.dev/([a-z]+)$",
    exclude: ["^https://primeng\\.dev/(?:installation|configuration|components|filterservice|animateonscroll|autofocus|bind|classnames|focustrap|keyfilter|ripple|styleclass)$"],
    frameworks: ["angular"],
    titleSuffix: "^Angular\\s+|\\s+(?:Component|Directive)$",
    notes:
      "Server-rendered docs: the sidebar (<aside>) of any component page lists the full component catalog by group (Form, Button, Data, Panel, Overlay, File, Menu, Messages, Media, Misc). robots.txt is not a robots file (HTML), so unrestricted. Excluded: guide links, the FilterService utility and directives (AnimateOnScroll, AutoFocus, Bind, ClassNames, FocusTrap, KeyFilter, Ripple, StyleClass); PRO Suite links point to another host and are not matched. Current docs are PrimeNG 22 (PrimeUI License).",
  },
  {
    slug: "primereact",
    strategy: "nav",
    navUrl: "https://primereact.dev/docs/styled/components/autocomplete",
    navSelector: "aside",
    include: "^https://primereact\\.dev/docs/styled/components/([a-z]+)$",
    exclude: ["/components/(?:animateonscroll|focustrap|keyfilter)$"],
    frameworks: ["react"],
    titleSuffix: "^React\\s+|\\s+(?:Component|Directive)$",
    notes:
      "Server-rendered docs; the sidebar (<aside>) of a Styled-track component page lists the full catalog by group. The Styled track is used (the Tailwind/Primitive/Headless tracks document the same components). 'Compound' entries are anchors into other pages (#cascade...) and are not matched. Excluded: directive-style utilities (AnimateOnScroll, FocusTrap, KeyFilter). robots.txt is 404 (unrestricted). Current docs are PrimeReact 11 (PrimeUI License).",
  },
  {
    slug: "primevue",
    strategy: "nav",
    navUrl: "https://primevue.dev/autocomplete/",
    navSelector: "aside",
    include: "^https://primevue\\.dev/([a-z]+)/?$",
    exclude: ["^https://primevue\\.dev/(?:installation|configuration|animateonscroll|focustrap|keyfilter|mask|ripple|styleclass)/?$"],
    frameworks: ["vue"],
    titleSuffix: "^Vue\\s+|\\s+(?:Component|Directive)$",
    notes:
      "Server-rendered docs; the sidebar (<aside>) of any component page lists the full catalog by group. robots.txt is 404 (unrestricted). Excluded: guide links and directives (AnimateOnScroll, FocusTrap, KeyFilter, Mask, Ripple, StyleClass). Tooltip is kept although PrimeVue implements it as a directive. Current docs are PrimeVue 5 (PrimeUI License).",
  },
  {
    slug: "quasar",
    strategy: "nav",
    navUrl: "https://quasar.dev/components/",
    include: "^https://quasar\\.dev/(?:vue-components|layout)/([a-z0-9]+(?:-[a-z0-9]+)*)/?$",
    frameworks: ["vue"],
    titleSuffix: "\\s*\\|\\s*Quasar Framework$",
    notes:
      "The official 'Quasar Components' index (/components/, server-rendered) links every Vue component page (/vue-components/<name>) plus the Layout Drawer; directives, plugins, composables and utils are linked under other paths and not matched. robots.txt is 404 (unrestricted). The other layout components (QLayout, QHeader/QFooter, QPage...) are documented in the Layout section and are not on this index.",
  },
  {
    slug: "radix-primitives",
    strategy: "nav",
    navUrl: "https://www.radix-ui.com/primitives/docs/overview/introduction",
    include: "^https://www\\.radix-ui\\.com/primitives/docs/(?:components|utilities)/([a-z0-9]+(?:-[a-z0-9]+)*)$",
    frameworks: ["react"],
    titleSuffix: "\\s*–\\s*Radix Primitives$",
    notes:
      "Server-rendered docs sidebar lists every primitive under Components and Utilities (Accessible Icon, Direction Provider, Portal, Slot, Visually Hidden are separately published primitives). robots.txt is 404 and there is no sitemap.xml. Overview/guide pages are not matched.",
  },
  {
    slug: "radix-themes",
    strategy: "nav",
    navUrl: "https://www.radix-ui.com/themes/docs/overview/getting-started",
    include: "^https://www\\.radix-ui\\.com/themes/docs/components/([a-z0-9]+(?:-[a-z0-9]+)*)$",
    frameworks: ["react"],
    titleSuffix: "\\s*–\\s*Radix Themes$",
    notes:
      "Server-rendered docs sidebar lists every Radix Themes component page under /themes/docs/components/ (layout, typography, components and utilities such as Theme, Portal, Slot). Theme/overview pages live under other paths and are not matched. robots.txt is 404 and there is no sitemap.xml.",
  },
  {
    slug: "react-bootstrap",
    strategy: "sitemap",
    sitemapUrl: "https://react-bootstrap.github.io/sitemap.xml",
    include: "^https://react-bootstrap\\.netlify\\.app/docs/(?:components|forms|layout|utilities)/([a-z0-9]+(?:-[a-z0-9]+)*)/?$",
    exclude: ["/docs/forms/(?:overview|layout|validation)/?$", "/docs/layout/breakpoints/?$", "/docs/utilities/(?:restart-ui|transitions)/?$"],
    frameworks: ["react"],
    titleSuffix: "\\s*\\|\\s*React Bootstrap$",
    notes:
      "The Docusaurus sitemap served at react-bootstrap.github.io lists URLs on react-bootstrap.netlify.app, which is also the rel=canonical of every docs page (same content as the github.io mirror). The static sidebar only expands the current section, so the sitemap is the complete source. robots.txt is 404 (unrestricted). Components = Components section + form controls + Grid/Stack layout + Ratio; excluded guides: forms overview/layout/validation, breakpoints, transitions, restart-ui.",
  },
  {
    slug: "reactstrap",
    strategy: "repo-listing",
    repo: { kind: "gh", name: "reactstrap/reactstrap", ref: "{npm:reactstrap}" },
    include: "^stories/([A-Z][A-Za-z]+)\\.stories\\.js$",
    frameworks: ["react"],
    notes:
      "The official docs (reactstrap.github.io) are a Storybook 6 build without index.json/stories.json, so its pages are not statically enumerable. Each docs page is generated from one stories/<Name>.stories.js file (title 'Components/<Name>') in the repository; the jsDelivr listing of the release tag of the latest npm version ({npm:reactstrap}; tags have no 'v' prefix, 9.2.3 on 2026-11-05) enumerates them. No docs URL is recorded: Storybook story ids are lowercase and cannot be derived from the PascalCase file names with the {segment} template, and the SPA shell cannot confirm them. Evidence links point to the stories file.",
  },
];
