# Generic component inventory audit

Adversarial audit of the 74 design systems ingested by the `generic` adapter
(`src/ingestion/adapters/generic/targets-1..4.ts`). Date: 2026-11-05. Auditor: generic-audit workstream.

## Method

- **DB snapshot after the background re-ingest.** The worker drained at 12:26 UTC (`ingestion_job`: 881 succeeded, 1 dead, 0 queued or running). The dead job is thumbprint's `discover`: robots.txt was unavailable at that moment and the fetcher correctly treated it as disallow-all. robots.txt now answers 404 (= allowed), so thumbprint keeps its previous run and needs a re-run.
  - The re-ingest changed only mozilla-protocol (+1: Details and Details Component split), skyscanner-backpack (69 `components-*` slugs retired, 69 plain slugs published, same components) and three names: 'Smart select', 'Form Element', 'Details Component'.
  - Published generic components: 4967.
- **Live index comparison (step 1).** For every system I opened the official human-facing component index with `curl` (one request per index page, at most 1 request per second per host, ATLAS user agent, cached) and extracted its component links with an independent regex. I matched them to the ATLAS inventory by URL segment, slug or normalized name, then reviewed both difference lists and every system's full name list by hand.
  - Client-rendered or blocked sites were compared against the closest official static equivalent, named in the table: package export lists, the docs-nav config in the repo, a Next.js build manifest, an npm folder listing or the sitemap.
- **Docs URL check (step 1).** 3 random components per system (`row_number() over (partition by system order by md5(id || 'urls'))`), 222 records, 216 with a docs URL. Each URL got a GET with redirects followed.
  - GitHub blob URLs were checked through raw.githubusercontent.com, Storybook URLs against the Storybook `index.json`, and GitHub tree URLs against the jsDelivr listing.
  - The page's `<title>`/`<h1>` (or Markdown heading) had to name the component, and any stored description had to appear on the page.
- **Random sample (step 2).** 60 components, `ORDER BY md5(id::text || 'generic') LIMIT 60` over published generic components. They were verified the same way and reviewed by hand for naming and description specificity.
- **Fixes (step 3).** Config-only changes, verified with `npx tsx scripts/adapter-dry-run.ts generic <slug>` and diffed against the DB, plus regression tests in `tests/unit/adapters/generic-audit-targets.test.ts`. Nothing was ingested into `atlas`.

Verdicts:

- **GOOD**: honest inventory, no non-component entries, recall of documented components at or above about 95%. Caveats are listed.
- **NEEDS FIX -> fixed**: the defect was fixed in the target config in this audit.
- **NEEDS FIX (open)**: the defect needs adapter work beyond target config.
- **DROP**: the inventory cannot be made honest (none).

## Results at a glance

| Measure | Result |
|---|---|
| Systems audited | 74 |
| GOOD | 66 (9 with a caveat: carbon-web-components, cloudscape, daisyui, dsfr, esri-calcite, sap-fiori, thumbprint, twilio-paste, workday-canvas) |
| NEEDS FIX -> fixed | 5: vuetify, primeng, primereact, primevue, react-bootstrap |
| NEEDS FIX (open) | 3: base-web, flutter-material, syncfusion-essential-studio |
| DROP | 0 |
| Docs URLs checked (3 per system) | 216/216 answer 200 on the right page (9 trailing-slash redirects). 116/116 stored descriptions are verbatim on the page. 6 records have no docs URL by design (base-web, reactstrap) |
| Random sample (60) | 59/59 docs URLs answer 200 and the page title/heading names the component (1 record has no URL by design). 59/60 names are written exactly as the docs write them; 1 had a casing defect, now fixed. 30/30 stored descriptions are verbatim on the page and specific to the component (1 carries an SEO wrapper) |
| Duplicate names within a system | 1 pair (cloudscape 'Pie and donut charts': current and legacy component, named identically by the site) |
| Duplicate docs URLs within a system | 0 |
| Duplicate descriptions within a system | 0 |

## Per-system results

ATLAS = published components after the re-ingest (docs URLs / descriptions). Live = component entries on the reference index (approximate; links the target deliberately excludes are counted and listed under recall).

| System | Strategy | ATLAS (URLs/desc) | Live reference | Precision | Recall | Verdict |
|---|---|---|---|---|---|---|
| alibaba-fusion | repo-listing | 62 (62/4) | 62: @alifd/next 1.27.34 export list (types/index.d.ts); fusion.design is client-rendered | Names are the English docs headings. Field (form-state helper), ConfigProvider and Animate are exported and documented. 'Paragraph (UNSAFE)' is the docs heading verbatim. | All 62 exports present. | **GOOD** |
| arco-design | repo-listing | 69 (69/67) | 71 exports: @arco-design/web-react export list (es/index.d.ts); arco.design is client-rendered | None found. | Icon is not captured: it has no components/Icon/README.en-US.md. Portal is internal. | **GOOD** |
| ark-ui | sitemap | 52 (52/50) | 52: Sidebar of /docs/components/accordion | None found. | 52/52. | **GOOD** |
| base-web | repo-listing | 78 (0/0) | 89 routes (83 component pages + 6 utility pages): Next.js build manifest of baseweb.design (/_next/static/&lt;build&gt;/_buildManifest.js, /components/* routes); the pages themselves are client-rendered | Names are npm module names, e.g. 'Button Timed', 'Tabs Motion'. 'Sheet' has no docs page (404). 'Map Marker' is documented as Fixed/Floating/Floating route marker and Location puck. No docs URLs are claimed. | 8 documented pages are missing: Empty State, Hint Dot, Notification Circle, Fixed Marker, Floating Marker, Floating Route Marker, Location Puck, and the Side Nav page (held as the module 'Side Navigation'). Recall is about 90%. | **NEEDS FIX (open: needs a new enumeration source)** |
| blueprint | repo-listing | 72 (72/70) | 72 MDX pages: blueprintjs.com/docs is a single-page app; checked against the MDX docs sources at the @blueprintjs/core release tag (the source the docs app renders) | Deprecated pages are kept and labelled by their own descriptions ('Deprecated: use Overlay2/PopoverNext'). Labs pages (Box, Flex, IconNext, PopoverNext) are kept. | None found. | **GOOD** |
| bootstrap | nav | 30 (30/30) | 33: v5.3 docs sidebar | None found. The live sidebar now links without a trailing slash; ATLAS URLs keep it and resolve with 200. | The 3 links not in ATLAS (forms Overview/Layout/Validation) are guides. | **GOOD** |
| bulma | nav | 34 (34/0) | 45: bulma.io/documentation/ | None found. | The 11 links not in ATLAS are form/columns/grid guides and the playground. | **GOOD** |
| carbon-web-components | sitemap | 77 (77/0) | 77: Storybook index.json (the same source the adapter uses) | Names copy the Storybook titles and are inconsistent: 'Notifications / Actionable', 'FluidComboBox' next to 'Fluid Date picker'. | None found. | **GOOD (naming caveat)** |
| chakra-ui | nav | 115 (115/111) | 115: /docs/components/concepts/overview | None found. Utility components (For, Show, ClientOnly...) are documented as components by Chakra. | 115/115. | **GOOD** |
| cloudscape | sitemap | 108 (108/108) | 114: cloudscape.design/components/ | Two components share the display name 'Pie and donut charts': pie-chart and pie-chart-legacy. The site names both that way; the legacy one's description says 'Legacy...'. | The 6 links not in ATLAS are group overview pages (Board components, Charts, Charts (Legacy), File uploading, GenAI, Tutorials). | **GOOD (duplicate-name caveat)** |
| daisyui | sitemap | 68 (68/68) | 68: daisyui.com/components/ | Every description carries the site's SEO wrapper: 'Tailwind &lt;Name&gt; examples: &lt;sentence&gt; component'. The quotes are faithful, but the wrapper is not part of the description. | 68/68. | **GOOD (description caveat)** |
| devextreme | sitemap | 82 (82/0) | 82: jQuery UI_Components API index | None found. | 82/82. | **GOOD** |
| dsfr | repo-listing | 46 (46/0) | 46: systeme-de-design.gouv.fr answers 403 behind a bot challenge (not bypassed); checked against the repo's component folders, each with _part/doc/index.md | Names are DSFR's own 'titleId' identifiers (Connect, Display, Follow, Content), not the French display titles ('Boutons FranceConnect et ProConnect', 'Paramètres d'affichage'...). Docs URLs point at the source folder. | None found. | **GOOD (naming caveat)** |
| duet-design-system | sitemap | 99 (99/0) | 99: duetds.com/components/ | Fine-grained sub-elements (Menu Bar Dropdown Link...) are listed as components by the index itself. | 99/99. | **GOOD** |
| elastic-ui | sitemap | 92 (92/89) | 92: Docusaurus sitemap; the category pages list only a subset | A few page titles are generic out of context: 'Editor' and 'Format' are the Markdown editor and Markdown format pages. | None found. | **GOOD** |
| element-plus | repo-listing | 79 (79/71) | 83: docs nav config docs/.vitepress/crowdin/en-US/pages/component.json | None found. 'Tree V2 virtualized tree' is the heading verbatim (the nav says 'Virtualized Tree'). | The 4 entries not in ATLAS are excluded foundations: Overview, Border, Color, Typography. | **GOOD** |
| equinor-eds | sitemap | 35 (35/29) | 35: eds.equinor.com sitemap, latest docs only | None found. | 35/35. | **GOOD** |
| esri-calcite | sitemap | 95 (95/3) | 59 top-level + 36 child elements: /components/ index (59 top-level) and the sidebar (child elements nested under their parents) | The 36 child elements (Accordion Item, Combobox Item...) each have their own docs page and are nested in the sidebar, so they are kept. | None found. | **GOOD (granularity caveat)** |
| flowbite | nav | 55 (55/55) | 65: docs sidebar | None found. | The 10 links not in ATLAS are the forms/typography overviews and the Typography section (native element styles). | **GOOD** |
| flutter-cupertino | nav | 46 (46/0) | 61: docs.flutter.dev Cupertino catalog | None found. | The 15 entries not in ATLAS are non-widgets (colors, theme data, routes, controllers, selection delegates). | **GOOD** |
| flutter-material | nav | 24 (24/0) | 27: docs.flutter.dev Material catalog | None found. | 3 catalog entries are missing: Common buttons (linked to ButtonStyle), Date picker and Time picker (linked to the showDatePicker/showTimePicker functions). None of them can be named or linked honestly from the catalog. | **NEEDS FIX (open: needs an adapter-level name/URL override)** |
| fomantic-ui | nav | 50 (50/50) | 53: fomantic-ui.com sidebar | None found. | The 3 entries not in ATLAS are behaviors (API, State, Visibility). | **GOOD** |
| foundation | nav | 32 (32/32) | 65: #docs-menu | None found. | The 33 entries not in ATLAS are guides, grids, utilities and plugins. | **GOOD** |
| framework7 | nav | 63 (63/0) | 94 docs links: Components group of the docs sidebar | None found. | The 31 entries not in ATLAS are guides and core APIs. | **GOOD** |
| gc-design-system | sitemap | 35 (35/0) | 35: /en/components/ (links are gcds-* elements, not &lt;a&gt;) | None found. | 35/35. | **GOOD** |
| gestalt | nav | 77 (77/0) | 79: /v1/web/overview | None found. | The 2 entries not in ATLAS are the overview and the Z-Index utility classes. | **GOOD** |
| gitlab-pajamas | nav | 52 (52/52) | 61: design.gitlab.com/components/ | None found. | The 9 entries not in ATLAS are the dropdown chooser, 7 utility pages and 'Socks'. | **GOOD** |
| hashicorp-helios | sitemap | 52 (52/52) | 54: /components index | None found. | The 2 entries not in ATLAS are guides (form layout, form primitives). | **GOOD** |
| headless-ui | nav | 16 (16/0) | 16: React docs sidebar | None found. | 16/16. | **GOOD** |
| heroui | sitemap | 73 (73/73) | 73: /docs/react/components | None found. | 73/73. | **GOOD** |
| ionic | nav | 89 (89/89) | 94: ionicframework.com/docs/components | None found. | The 5 entries not in ATLAS are routing elements. | **GOOD** |
| kendo-ui | nav | 117 (117/0) | 121: Kendo UI for jQuery docs sidebar | None found. | The 4 entries not in ATLAS are FX, Drag and Drop, Validator and the LLM Kit overview. | **GOOD** |
| kiwi-orbit | sitemap | 73 (73/0) | 76: @kiwicom/orbit-components lib/ component folders (orbit.kiwi is refused by the proxy) | None found. | The 5 entries not in ATLAS are internal or providers: ErrorFormTooltip, FormLabel, OrbitProvider, Portal, SmartPassIllustrations. | **GOOD** |
| mantine | sitemap | 121 (121/111) | 122: sidebar of /core/button/ | None found. | Only the @mantine/core package page is not in ATLAS. | **GOOD** |
| mongodb-leafygreen | nav | 54 (54/0) | 61: mongodb.design sidebar | None found. | The 7 entries not in ATLAS are foundations and patterns. | **GOOD** |
| mozilla-protocol | nav | 57 (57/0) | 60: Fractal component tree | Base-element styles (Headings, Paragraphs, Links) are documented as components by Protocol. Details and Details Component are now separate entries, both documented. | The 3 entries not in ATLAS are 'Example *' compositions. | **GOOD** |
| naive-ui | repo-listing | 95 (95/83) | 96: docs menu config demo/store/menu-options.js | None found. | Only 'discrete' (createDiscreteApi, an API page) is not in ATLAS. | **GOOD** |
| nl-design-system | nav | 100 (100/100) | 100 component cards: /componenten/ | None found. Heading 1-6, Root, Strong and similar entries each have a component page. | 100/100. | **GOOD** |
| nord-design-system | nav | 65 (65/65) | 65: nordhealth.design/components/ | None found. | 65/65. | **GOOD** |
| onsen-ui | sitemap | 47 (47/0) | 47: /v2/api/js/ index | None found. ATLAS also lists 'Alert Dialog Button', which is in the sitemap and its page answers 200. | Only ons-if (a utility) is not in ATLAS. | **GOOD** |
| ontario-design-system | nav | 40 (40/0) | 50: components.html | None found. Plural names are the docs' own. | The 10 entries not in ATLAS are styles, icon sets and the live validation guideline. | **GOOD** |
| oracle-redwood | nav | 59 (59/0) | 68: JET API index (oj-c.*) | None found. | The 9 entries not in ATLAS are chart, legend and tag-cloud child elements. | **GOOD** |
| park-ui | sitemap | 59 (59/59) | 59: component sidebar | None found. | 59/59. | **GOOD** |
| patternfly | sitemap | 105 (105/0) | 114: sidebar of /components/accordion/ (the 'All components' page is now 404) | None found. | The 9 entries not in ATLAS are overviews, chart guidance pages and demos. | **GOOD** |
| porsche-design-system | nav | 58 (58/0) | 58: v4 components sidebar | None found. | 58/58. | **GOOD** |
| primeng | nav | 85 (85/84) | 96: aside of a component page | 'Autocomplete' should be 'AutoComplete' (docs heading and nav). The nav page itself was not fetched as a component page, so its name came from the URL segment. Fixed. | The 11 entries not in ATLAS are guides and directives. | **NEEDS FIX -&gt; fixed** |
| primereact | nav | 75 (75/74) | 78: aside of a component page | Same 'Autocomplete' casing defect. Fixed. | The 3 entries not in ATLAS are directives. | **NEEDS FIX -&gt; fixed** |
| primevue | nav | 85 (85/84) | 93: aside of a component page | Same 'Autocomplete' casing defect. Fixed. | The entries not in ATLAS are guides, directives and the Forms library page. | **NEEDS FIX -&gt; fixed** |
| quasar | nav | 73 (73/73) | 73: quasar.dev/components/ | None found. 'QMenu' is the page's own title. | 73/73. | **GOOD** |
| radix-primitives | nav | 35 (35/33) | 35: docs sidebar | None found. | 35/35. | **GOOD** |
| radix-themes | nav | 56 (56/56) | 56: docs sidebar | None found. | 56/56. | **GOOD** |
| react-bootstrap | sitemap | 35 (35/34) | 35: Docusaurus sitemap (the sidebar only expands one section) | The Tabs page was named 'Tabbed': its heading 'Tabbed components' lost its trailing kind word. Fixed to 'Tabs'. | None found. | **NEEDS FIX -&gt; fixed** |
| reactstrap | repo-listing | 29 (0/0) | 29: repo stories/*.stories.js at the release tag (the Storybook 6 build has no index) | None found. | 29/29. No docs URLs are claimed. | **GOOD** |
| red-hat-design-system | nav | 48 (48/0) | 49: ux.redhat.com/elements/ | None found. | 'Scheme dropdown' is missing (sidebar only, no card; already documented). | **GOOD** |
| rei-cedar | sitemap | 41 (41/0) | 42: cedar.rei.com/components | None found. | Only the 'Component variables' reference page is not in ATLAS. | **GOOD** |
| salesforce-lightning | repo-listing | 85 (85/0) | 87: SLDS 1 nav on v1.lightningdesignsystem.com | None found. | The v1 'Markdown' page is not captured: there is no ui/components/markdown in the repo's main branch. | **GOOD** |
| sap-fiori | sitemap | 173 (173/84) | 81 top-level + child elements: UI5 Web Components sidebar (81 top-level) | Child and feature elements (ListItemStandard, TableGrowing, ToolbarSpacer...) each have their own API page and are kept, so the count is inflated against top-level-only systems. | None found. | **GOOD (granularity caveat)** |
| seek-braid | nav | 58 (58/0) | 68: components index | None found. | The 10 entries not in ATLAS are providers and hooks (the Logic section). | **GOOD** |
| semantic-ui | nav | 43 (43/43) | 45: docs sidebar | None found. | The 2 entries not in ATLAS are behaviors. | **GOOD** |
| semi-design | nav | 82 (82/0) | 85: en-US overview sidebar | None found. | The 3 entries not in ATLAS are guides. | **GOOD** |
| shadcn-ui | sitemap | 65 (65/63) | 66: /docs/components | None found. | Only Typography is not in ATLAS. | **GOOD** |
| shoelace | nav | 58 (58/58) | 58: docs sidebar | None found. | 58/58. | **GOOD** |
| skyscanner-backpack | sitemap | 105 (105/90) | 105 components (tabs collapsed): /latest/sitemap.xml (the Supernova site is client-rendered) | The 'Snippet' description is site boilerplate ('Due to embedded width and height limitations...'). The re-ingest moved slugs from components-* to plain names: 69 retired, 69 new. | None found. | **GOOD** |
| syncfusion-essential-studio | nav | 98 (98/0) | 98: EJ2 documentation introduction | 2 names are humanized URL slugs: 'Pivotview' (docs 'Pivot Table') and 'Maskedtextbox' (docs 'Input Mask'). | 98/98. | **NEEDS FIX (open: 2 names, needs an adapter rule or name override)** |
| thumbprint | nav | 30 (30/30) | 30: components overview sidebar | None found. | 30/30. The re-ingest run failed at discover because robots.txt was transiently unavailable; it now answers 404 (= allowed). The DB keeps the previous run. | **GOOD (re-run needed)** |
| twilio-paste | repo-listing | 80 (80/75) | ~83 docs pages: in-repo docs pages (raw MDX files checked); GitHub directory listings are not reachable from this session | None found. | 3 docs pages without a same-named @twilio-paste/core package are missing: Form Layout, Status Badge, Status Menu. | **GOOD (minor recall gap)** |
| uikit | nav | 64 (64/0) | 92: getuikit.com docs sidebar | None found. | The 28 entries not in ATLAS are guides and CSS utility modules. | **GOOD** |
| uswds | sitemap | 45 (45/19) | 51: /components/overview/ | None found. | The 6 entries not in ATLAS are overview, status, lifecycle, packages, data visualizations and typography. | **GOOD** |
| vercel-geist | nav | 75 (75/75) | 82: /geist/introduction sidebar | None found. | The 7 entries not in ATLAS are foundations and resources. | **GOOD** |
| volvo-cars-design-system | sitemap | 41 (41/41) | 41: /web/ component list | None found. | 41/41. | **GOOD** |
| vuetify | repo-listing | 105 (105/104) | 107: docs nav data/nav.json at v4.3.2 (93 Components + 14 Labs) | 'Date pickers - month' was a disabled page (frontmatter disabled: true, not in nav) that duplicated Date pickers. Fixed. | Data tables (VDataTable, a multi-page section) was missing. Fixed via data-tables/introduction.md -&gt; 'Data table'. | **NEEDS FIX -&gt; fixed** |
| web-awesome | sitemap | 91 (91/91) | 91: webawesome.com/docs/components/ | None found. | 91/91. | **GOOD** |
| workday-canvas | sitemap | 46 (46/0) | 46: Canvas Kit Storybook index.json (canvas.workday.com answers 403) | The Color Picker sub-entries keep their group prefix: 'Color Picker / Color Input'. | None found. | **GOOD (naming caveat)** |
| zendesk-garden | nav | 54 (54/54) | 61: garden.zendesk.com/components/ | None found. | The 7 entries not in ATLAS are theming, typography and the versions page. | **GOOD** |

## Random sample (60 components)

`select ... from component c join design_system ds ... where ds.adapter_id='generic' and c.publish_state='published' order by md5(c.id::text || 'generic') limit 60`. Checks: HTTP status of the docs URL, whether the page `<title>`/`<h1>`/Markdown heading (or Storybook index id) names the component, and whether the stored description appears verbatim on the page.

| # | System | Name | Docs URL | Name | Description | Notes |
|---|---|---|---|---|---|---|
| 1 | base-web | System Banner | no URL | faithful (module name) | none stored | No docs URL claimed (base-web policy). The module exists and baseweb.design has a /components/system-banner page. |
| 2 | syncfusion-essential-studio | Charts | 200 | matches | none stored | The page is the Charts getting-started guide; the name comes from the nav label. |
| 3 | devextreme | PivotGrid | 200 | matches | none stored |  |
| 4 | devextreme | Calendar | 200 | matches | none stored |  |
| 5 | vercel-geist | Note | 200 | matches | verbatim on page |  |
| 6 | kiwi-orbit | Accordion | 200 | matches | none stored | Storybook story id present in index.json. |
| 7 | framework7 | Stepper | 200 | matches | none stored |  |
| 8 | mantine | Anchor | 200 | matches | verbatim on page |  |
| 9 | rei-cedar | Layout | 200 | matches | none stored |  |
| 10 | ionic | ion-buttons | 200 | matches | verbatim on page |  |
| 11 | bootstrap | List group | 200 | matches | verbatim on page |  |
| 12 | mantine | Button | 200 | matches | verbatim on page |  |
| 13 | devextreme | Button | 200 | matches | none stored |  |
| 14 | skyscanner-backpack | Rating Bar | 200 | matches | none stored | Only the Compose tab exists for this component. |
| 15 | uswds | Range slider | 200 | matches | none stored |  |
| 16 | mantine | Cascader | 200 | matches | verbatim on page |  |
| 17 | kendo-ui | Citation | 200 | matches | none stored |  |
| 18 | radix-themes | Aspect Ratio | 200 | matches | verbatim on page |  |
| 19 | semi-design | Timeline | 200 | matches | none stored |  |
| 20 | gc-design-system | Side navigation | 200 | matches | none stored |  |
| 21 | porsche-design-system | Tag Dismissible | 200 | matches | none stored |  |
| 22 | elastic-ui | Drag and drop | 200 | matches | verbatim on page |  |
| 23 | cloudscape | Items palette | 200 | matches | verbatim on page |  |
| 24 | ark-ui | Navigation Menu | 200 | matches | verbatim on page |  |
| 25 | sap-fiori | TimelineItem | 200 | matches | none stored |  |
| 26 | daisyui | Stack | 200 | matches | verbatim on page | Description is faithful but wrapped in the site's SEO template ('Tailwind ... examples: ... component'). |
| 27 | rei-cedar | Text | 200 | matches | none stored |  |
| 28 | mantine | Timeline | 200 | matches | verbatim on page |  |
| 29 | heroui | ListBox | 200 | matches | verbatim on page |  |
| 30 | arco-design | Tabs | 200 | matches | verbatim on page |  |
| 31 | shadcn-ui | Item | 200 | matches | verbatim on page |  |
| 32 | element-plus | Descriptions | 200 | matches | verbatim on page |  |
| 33 | element-plus | Menu | 200 | matches | verbatim on page |  |
| 34 | ontario-design-system | Sorting and filtering results | 200 | matches | none stored |  |
| 35 | esri-calcite | Card Group | 200 | matches | none stored |  |
| 36 | primereact | Autocomplete | 200 | casing defect (fixed) | none stored | Casing: the docs say 'AutoComplete'. Fixed in this audit (navUrl change). |
| 37 | kendo-ui | SplitButton | 200 | matches | none stored |  |
| 38 | onsen-ui | Card | 200 | matches | none stored |  |
| 39 | seek-braid | Badge | 200 (redirect: trailing slash) | matches | none stored |  |
| 40 | twilio-paste | Radio Group | 200 | matches | verbatim on page |  |
| 41 | sap-fiori | ColorPicker | 200 | matches | verbatim on page |  |
| 42 | alibaba-fusion | Collapse | 200 | matches | none stored |  |
| 43 | gitlab-pajamas | Label | 200 | matches | verbatim on page |  |
| 44 | uswds | Checkbox | 200 | matches | verbatim on page |  |
| 45 | flowbite | Toast | 200 | matches | verbatim on page |  |
| 46 | elastic-ui | Flyout | 200 | matches | verbatim on page |  |
| 47 | dsfr | Select | 200 | matches | none stored | GitHub tree of src/dsfr/component/select at v1.15.4 (present in the jsDelivr listing). |
| 48 | sap-fiori | ListItemCustom | 200 | matches | verbatim on page |  |
| 49 | esri-calcite | Action Pad | 200 | matches | none stored |  |
| 50 | esri-calcite | Filter | 200 | matches | none stored |  |
| 51 | carbon-web-components | TreeView | 200 | matches | none stored | Storybook docs id present in index.json. |
| 52 | kendo-ui | FileManager | 200 | matches | none stored |  |
| 53 | web-awesome | Slider | 200 | matches | verbatim on page |  |
| 54 | semantic-ui | Comment | 200 | matches | verbatim on page |  |
| 55 | primereact | Listbox | 200 | matches | verbatim on page |  |
| 56 | elastic-ui | Described form groups | 200 | matches | verbatim on page |  |
| 57 | rei-cedar | Table | 200 | matches | none stored |  |
| 58 | oracle-redwood | InputSensitiveText | 200 | matches | none stored |  |
| 59 | nl-design-system | File Input | 200 | matches | verbatim on page |  |
| 60 | radix-primitives | Hover Card | 200 | matches | verbatim on page |  |


## Fixes made in this audit

All fixes are target-config changes. No parser code changed, so `ADAPTER_VERSION` is unchanged and only these systems' bundles change on their next run. Each fix was dry-run and diffed against the current DB inventory.

| System | Change (file) | Dry run | Diff vs DB |
|---|---|---|---|
| vuetify | `include` now also matches `components/data-tables/introduction.md`. `exclude` adds `date-pickers-month.md` (frontmatter `disabled: true`, not in `nav.json`). `titleSuffix` strips `" - Introduction"`. (targets-4.ts) | 106 docs, 105 components, 0 fetch errors, contract valid, 0 error issues (1 pre-existing warning: 'Grid system' matches the suspicious-name list) | + `data-tables` "Data table" (docs = GitHub blob of `data-tables/introduction.md`, description = its first paragraph). - `date-pickers-month` "Date pickers - month" |
| primeng | `navUrl` `/autocomplete` -> `/accordion` (targets-3.ts) | 85 components, valid, 0 issues | ~ `autocomplete`: "Autocomplete" -> "AutoComplete" |
| primereact | `navUrl` `.../components/autocomplete` -> `.../components/accordion` (targets-3.ts) | 75 components, valid, 0 issues | ~ `autocomplete`: "Autocomplete" -> "AutoComplete" |
| primevue | `navUrl` `/autocomplete/` -> `/accordion/` (targets-3.ts) | 85 components, valid, 0 issues | ~ `autocomplete`: "Autocomplete" -> "AutoComplete" |
| react-bootstrap | `titleSuffix` adds `^Tabbed components$`, so the Tabs page falls back to its segment (targets-3.ts) | 35 components, valid, 0 issues | ~ `tabs`: "Tabbed" -> "Tabs" |

Root causes:

- **Prime systems.** The nav page itself is not fetched as a component page, so the component it documents is named from its humanized URL segment. That is wrong for camel-cased names. The nav page is now a single-word component (Accordion), whose humanized segment is the docs name.
- **react-bootstrap.** The trailing kind-word rule (`stripComponentWord`) turned the heading "Tabbed components" into "Tabbed".

Regression tests: `tests/unit/adapters/generic-audit-targets.test.ts` (8 tests, passing). They cover the vuetify include/exclude/title rules, the React-Bootstrap Tabs name and the single-word Prime nav pages.

No target was removed: every inventory can stay honest.

## Open issues (not fixable by target config)

1. **base-web recall (~90%).** The only static enumeration of baseweb.design pages is the Next.js `_buildManifest.js`. No sitemap exists, `/components/` is a JS shell and pages carry no title or h1, so the inventory uses npm module names.
   - Missing documented pages: Empty State, Hint Dot, Notification Circle, Fixed/Floating/Floating Route Marker, Location Puck.
   - 'Sheet' has no docs page. 'Map Marker' is documented under the four marker pages above.
   - Needs a new enumeration source, for example a build-manifest strategy.
2. **flutter-material recall (24/27).** The catalog links "Common buttons" to `ButtonStyle-class.html` and "Date picker"/"Time picker" to the `showDatePicker`/`showTimePicker` functions. No widget page can be named or linked honestly without a per-entry override.
3. **syncfusion-essential-studio names.** 'Pivotview' and 'Maskedtextbox' are humanized URL slugs; the docs labels are "Pivot Table" and "Input Mask". `chooseName` only accepts link text that relates to the segment.
   - Options: an adapter rule that, for `fetchPages: false` nav targets, accepts the exact nav label when the segment is a single compound token; or a reviewed name override.
4. **daisyui descriptions.** All 68 meta descriptions are wrapped as `Tailwind <Name> examples: <sentence> component`. They are faithful but decorated.
   - Proposed: a target field `descriptionStrip` (RegExp sources, like `titleSuffix`) in `types.ts` (integrator-owned), applied in `normalize()`.
5. **twilio-paste recall.** Form Layout, Status Badge and Status Menu have docs pages (raw MDX answers 200) but no same-named `@twilio-paste/core` package, so the npm listing cannot reach them. The repo is too large for a jsDelivr listing, and GitHub directory listings are not reachable from this session.
6. **Naming caveats kept because they are faithful to the source:**
   - carbon-web-components and workday-canvas keep Storybook group prefixes ('Notifications / Actionable', 'Color Picker / Color Input').
   - dsfr uses DSFR's English `titleId` identifiers instead of the French display titles.
   - elastic-ui 'Editor'/'Format' are the Markdown editor and format pages.
   - cloudscape has two 'Pie and donut charts' (current and legacy).
   - Possible follow-up: store the French DSFR titles and group-qualified names as aliases.
7. **Granularity caveats.** sap-fiori (173) and esri-calcite (95) count child and feature custom elements that have their own docs pages: 81 and 59 top-level entries respectively. Cross-system counts for these two are not comparable with top-level-only inventories.
8. **Minor single gaps.**
   - arco-design 'Icon' (no README in components/).
   - red-hat-design-system 'Scheme dropdown' (no card, already documented in its notes).
   - salesforce-lightning v1 'Markdown' (not in the repo's main branch).
   - skyscanner-backpack 'Snippet' description is site boilerplate.
9. **thumbprint** needs a re-run: its re-ingest failed at discover because robots.txt was transiently unreachable. The fetcher correctly treated that as disallow-all; robots.txt now answers 404.

## Re-ingest requested

Targets changed (re-ingest into `atlas`): `vuetify`, `primeng`, `primereact`, `primevue`, `react-bootstrap`.
Re-run without a config change (transient failure): `thumbprint`.

## Reproduction

The working scripts live outside the repo (auditor scratchpad). The checks are reproducible with:

- `psql ... -c "select count(*) from ingestion_job where status in ('queued','running')"`: queue drained (0).
- `npx tsx scripts/adapter-dry-run.ts generic <slug>` for each changed slug.
- `npx vitest run tests/unit/adapters/generic-audit-targets.test.ts tests/unit/adapters/generic.test.ts`.
- The sample query in the "Random sample" section, then GET each docs URL and compare it with the page `<title>`/`<h1>`.
