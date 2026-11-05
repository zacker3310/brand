# ATLAS data quality report

Generated 2026-11-05T15:28:26.228Z from the live database by `npm run quality`. All figures are counts of stored records.

## Summary

| Metric | Value |
|---|---|
| Verified systems (registry) | 100 / 100 |
| Systems deeply indexed (indexed or partial) | 19 |
| Ingestion depth (verified systems) | inventory 74 · indexed 19 · metadata_only 7 |
| Systems with component records | 93 |
| Systems with token records | 16 |
| Published components | 6489 |
| Tokens | 34398 |
| Published patterns | 159 |
| Evidence records | 27890 |

## Registry

| Status | Count |
|---|---|
| verified | 100 |
| rejected | 7 |
| duplicate | 4 |

Entries not counted toward the 100 (discovery results preserved):

| Slug | Status | Duplicate of | Reason |
|---|---|---|---|
| airbnb-dls | rejected |  | Rejected: no public documentation. airbnb.design (former Airbnb Design site that hosted DLS articles) now redirects to the airbnb.com booking homepage, and the 'building-a-visual-language' article URL redirects to airbnb |
| tailwind-plus | rejected |  | Rebrand verified: tailwindui.com redirects to Tailwind Plus, and the official blog (2025-03-04) announced the rename. REJECTED because no public documentation remains: every tailwindcss.com/plus path checked (product pag |
| palantir-blueprint | duplicate | blueprint | Integrator decision: 'blueprint' (rank 40) is canonical; this rank-65 candidate names the same system (Palantir's Blueprint), so it is recorded as a duplicate and does not count toward the 100. Checks were still run and  |
| intuit-design-system | rejected |  | Rejected: no public documentation (internal-only). designsystem.intuit.com redirects to Intuit enterprise SSO (federation.intuit.com), indicating staff-only access. design.intuit.com is a public design blog/hub ('Intuit  |
| mailchimp-pattern-library | rejected |  | Rejected: no public documentation reachable. ux.mailchimp.com/patterns and ux.mailchimp.com returned HTTP 503 'Service Unavailable' in checks about six minutes apart. No official retirement notice and no current official |
| australian-government-design-system | rejected |  | Rejected: discontinued with docs gone. designsystem.gov.au no longer resolves (DNS failure). The component repo was archived on 2021-08-26 and its README states the system has been decommissioned; @gov.au/core is depreca |
| audi-ui | rejected |  | Rejected: no public documentation reachable. react.ui.audi (the Storybook linked from storybook.js.org's 'Audi UI React' showcase) returns 404. audi.com/ci user-interface component guide pages return 404, and audi.com/ci |
| bmw-group-design-system | rejected |  | Rejected: no public documentation found. Probed hostnames (bmwgroup.design, designsystem.bmwgroup.com, design.bmwgroup.com) do not resolve. The BMW Group GitHub org (github.com/bmwgroup) lists one repository, a C++ fork  |
| elastic-ui-framework | duplicate | elastic-ui | Integrator decision: 'elastic-ui' (rank 63) is canonical; this rank-87 queue item names the same system (same site eui.elastic.co, repo elastic/eui, package @elastic/eui). License left null here deliberately (npm declare |
| adobe-react-aria | duplicate | react-aria | Integrator decision: 'react-aria' (rank 37) is canonical; 'Adobe React Aria' is the same project. The old docs URL react-spectrum.adobe.com/react-aria/ now redirects to react-aria.adobe.com. License left null here delibe |
| material-ui-for-flutter | duplicate | flutter-material | No distinct project: the material_ui README states it 'was previously built directly into the core Flutter framework as package:flutter/material.dart' and has been decoupled into flutter/packages, with a dart fix migrati |

Replacements:

- Système de Design de l'État (`dsfr`) replaces `palantir-blueprint`
- Equinor Design System (`equinor-eds`) replaces `material-ui-for-flutter`
- Calcite Design System (`esri-calcite`) replaces `audi-ui`
- GC Design System (`gc-design-system`) replaces `bmw-group-design-system`
- Pajamas Design System (`gitlab-pajamas`) replaces `airbnb-dls`
- HPE Design System (`hpe-design-system`) replaces `mailchimp-pattern-library`
- NL Design System (`nl-design-system`) replaces `elastic-ui-framework`
- Red Hat Design System (`red-hat-design-system`) replaces `intuit-design-system`
- Backpack (`skyscanner-backpack`) replaces `tailwind-plus`
- Vercel Geist (`vercel-geist`) replaces `adobe-react-aria`
- Web Awesome (`web-awesome`) replaces `australian-government-design-system`

## Verified system coverage

| System | Category | Ingestion | Adapter | Components | Tokens | Patterns | Evidence | Confidence |
|---|---|---|---|---:|---:|---:|---:|---:|
| Fluent UI React | component-library | indexed | fluent | 209 | 3511 | 0 | 1339 | 0.96 |
| SAP Fiori | design-system | inventory | generic | 173 | 0 | 0 | 364 | 0.92 |
| Shopify Polaris | design-system | indexed | polaris | 151 | 1812 | 14 | 1528 | 0.90 |
| MUI (Material UI) | component-library | indexed | mui | 143 | 358 | 0 | 1182 | 0.97 |
| Mantine | component-library | inventory | generic | 121 | 0 | 0 | 359 | 0.97 |
| Atlassian Design System | design-system | indexed | atlassian | 119 | 2314 | 14 | 1302 | 0.90 |
| Kendo UI | commercial-suite | inventory | generic | 117 | 0 | 0 | 132 | 0.95 |
| Chakra UI | component-library | inventory | generic | 115 | 0 | 0 | 348 | 0.97 |
| Amazon Cloudscape | design-system | inventory | generic | 108 | 0 | 0 | 334 | 0.95 |
| Backpack | design-system | inventory | generic | 105 | 0 | 0 | 520 | 0.84 |
| PatternFly | design-system | inventory | generic | 105 | 0 | 0 | 223 | 0.96 |
| Vuetify | component-library | inventory | generic | 105 | 0 | 0 | 327 | 0.96 |
| NL Design System | design-system | inventory | generic | 100 | 0 | 0 | 315 | 0.90 |
| Duet Design System | design-system | inventory | generic | 99 | 0 | 0 | 216 | 0.90 |
| Adobe Spectrum | design-system | indexed | spectrum | 98 | 4524 | 14 | 1305 | 0.93 |
| Syncfusion Essential Studio | commercial-suite | inventory | generic | 98 | 0 | 0 | 120 | 0.90 |
| Calcite Design System | design-system | inventory | generic | 95 | 0 | 0 | 208 | 0.93 |
| Naive UI | component-library | inventory | generic | 95 | 0 | 0 | 284 | 0.90 |
| Elastic UI Framework | design-system | inventory | generic | 92 | 0 | 0 | 283 | 0.95 |
| Web Awesome | web-components | inventory | generic | 91 | 0 | 0 | 291 | 0.92 |
| Ionic Framework | ui-framework | inventory | generic | 89 | 0 | 0 | 279 | 0.97 |
| PrimeNG | commercial-suite | inventory | generic | 85 | 0 | 0 | 274 | 0.92 |
| PrimeVue | commercial-suite | inventory | generic | 85 | 0 | 0 | 270 | 0.92 |
| Salesforce Lightning Design System | design-system | inventory | generic | 85 | 0 | 0 | 180 | 0.93 |
| ByteDance Semi Design | design-system | inventory | generic | 82 | 0 | 0 | 172 | 0.96 |
| DevExtreme | commercial-suite | inventory | generic | 82 | 0 | 0 | 175 | 0.95 |
| GitHub Primer | design-system | indexed | primer | 80 | 2744 | 25 | 603 | 0.96 |
| Twilio Paste | design-system | inventory | generic | 80 | 0 | 0 | 247 | 0.85 |
| Joy UI | component-library | indexed | mui | 79 | 133 | 0 | 675 | 0.92 |
| Element Plus | component-library | inventory | generic | 79 | 0 | 0 | 239 | 0.92 |
| Uber Base Web | component-library | inventory | generic | 78 | 0 | 0 | 87 | 0.93 |
| Carbon Web Components | web-components | inventory | generic | 77 | 0 | 0 | 86 | 0.95 |
| Gestalt | design-system | inventory | generic | 77 | 0 | 0 | 164 | 0.95 |
| IBM Carbon Design System | design-system | indexed | carbon | 76 | 1655 | 17 | 832 | 0.97 |
| Ant Design Mobile | component-library | indexed | antd | 76 | 250 | 0 | 611 | 0.95 |
| PrimeReact | commercial-suite | inventory | generic | 75 | 0 | 0 | 240 | 0.92 |
| Vercel Geist | design-system | inventory | generic | 75 | 0 | 0 | 236 | 0.85 |
| HeroUI | component-library | inventory | generic | 73 | 0 | 0 | 237 | 0.94 |
| Orbit | design-system | inventory | generic | 73 | 0 | 0 | 86 | 0.80 |
| Quasar Framework | ui-framework | inventory | generic | 73 | 0 | 0 | 227 | 0.96 |
| Ant Design | design-system | indexed | antd | 72 | 942 | 18 | 780 | 0.97 |
| Blueprint | component-library | inventory | generic | 72 | 0 | 0 | 225 | 0.96 |
| React Spectrum | component-library | indexed | spectrum | 70 | 0 | 4 | 750 | 0.96 |
| Arco Design | design-system | inventory | generic | 69 | 0 | 0 | 216 | 0.95 |
| daisyUI | css-framework | inventory | generic | 68 | 0 | 0 | 209 | 0.96 |
| Nord Design System | design-system | inventory | generic | 65 | 0 | 0 | 207 | 0.90 |
| shadcn/ui | component-library | inventory | generic | 65 | 0 | 0 | 203 | 0.95 |
| UIkit | css-framework | inventory | generic | 64 | 0 | 0 | 72 | 0.96 |
| Framework7 | ui-framework | inventory | generic | 63 | 0 | 0 | 136 | 0.95 |
| Alibaba Fusion Design | design-system | inventory | generic | 62 | 0 | 0 | 139 | 0.85 |
| Oracle Redwood | design-system | inventory | generic | 59 | 0 | 0 | 128 | 0.75 |
| Park UI | component-library | inventory | generic | 59 | 0 | 0 | 186 | 0.90 |
| Braid Design System | design-system | inventory | generic | 58 | 0 | 0 | 68 | 0.95 |
| Porsche Design System | design-system | inventory | generic | 58 | 0 | 0 | 130 | 0.95 |
| Shoelace | web-components | inventory | generic | 58 | 0 | 0 | 189 | 0.95 |
| Protocol | design-system | inventory | generic | 57 | 0 | 0 | 121 | 0.93 |
| React Aria | headless-library | indexed | spectrum | 57 | 0 | 4 | 569 | 0.97 |
| Radix Themes | component-library | inventory | generic | 56 | 0 | 0 | 177 | 0.95 |
| Microsoft Fluent 2 | design-system | indexed | fluent | 55 | 3511 | 5 | 379 | 0.95 |
| Flowbite | component-library | inventory | generic | 55 | 0 | 0 | 182 | 0.94 |
| LeafyGreen Design System | design-system | inventory | generic | 54 | 0 | 0 | 66 | 0.92 |
| Zendesk Garden | design-system | inventory | generic | 54 | 0 | 0 | 172 | 0.95 |
| Ark UI | headless-library | inventory | generic | 52 | 0 | 0 | 164 | 0.96 |
| Helios Design System | design-system | inventory | generic | 52 | 0 | 0 | 168 | 0.95 |
| Pajamas Design System | design-system | inventory | generic | 52 | 0 | 0 | 170 | 0.93 |
| Fomantic-UI | css-framework | inventory | generic | 50 | 0 | 0 | 160 | 0.95 |
| NHS Design System | design-system | indexed | govuk | 48 | 274 | 13 | 715 | 0.94 |
| Red Hat Design System | design-system | inventory | generic | 48 | 0 | 0 | 108 | 0.93 |
| Onsen UI | ui-framework | inventory | generic | 47 | 0 | 0 | 106 | 0.93 |
| Flutter Cupertino | component-library | inventory | generic | 46 | 0 | 0 | 103 | 0.95 |
| Système de Design de l'État | design-system | inventory | generic | 46 | 0 | 0 | 57 | 0.82 |
| Workday Canvas Design System | design-system | inventory | generic | 46 | 0 | 0 | 57 | 0.82 |
| U.S. Web Design System | design-system | inventory | generic | 45 | 0 | 0 | 116 | 0.95 |
| Semantic UI | css-framework | inventory | generic | 43 | 0 | 0 | 141 | 0.93 |
| Fluent UI Web Components | web-components | indexed | fluent | 42 | 3511 | 0 | 359 | 0.95 |
| Cedar | design-system | inventory | generic | 41 | 0 | 0 | 95 | 0.95 |
| Volvo Cars Web Design System | design-system | inventory | generic | 41 | 0 | 0 | 135 | 0.88 |
| Ontario Design System | design-system | inventory | generic | 40 | 0 | 0 | 90 | 0.94 |
| GOV.UK Design System | design-system | indexed | govuk | 39 | 251 | 30 | 803 | 0.96 |
| Base UI | headless-library | indexed | mui | 37 | 0 | 1 | 334 | 0.96 |
| Google Material Design | design-system | indexed | material | 36 | 6368 | 0 | 483 | 0.92 |
| Material Web | web-components | indexed | material | 35 | 2240 | 0 | 236 | 0.95 |
| Equinor Design System | design-system | inventory | generic | 35 | 0 | 0 | 112 | 0.94 |
| GC Design System | design-system | inventory | generic | 35 | 0 | 0 | 89 | 0.94 |
| Radix Primitives | headless-library | inventory | generic | 35 | 0 | 0 | 110 | 0.97 |
| React Bootstrap | component-library | inventory | generic | 35 | 0 | 0 | 112 | 0.96 |
| Bulma | css-framework | inventory | generic | 34 | 0 | 0 | 78 | 0.94 |
| Foundation | css-framework | inventory | generic | 32 | 0 | 0 | 107 | 0.93 |
| Bootstrap | css-framework | inventory | generic | 30 | 0 | 0 | 98 | 0.97 |
| Thumbprint | design-system | inventory | generic | 30 | 0 | 0 | 105 | 0.85 |
| Reactstrap | component-library | inventory | generic | 29 | 0 | 0 | 38 | 0.93 |
| Flutter Material | component-library | inventory | generic | 24 | 0 | 0 | 37 | 0.95 |
| Headless UI | headless-library | inventory | generic | 16 | 0 | 0 | 40 | 0.96 |
| Apple Human Interface Guidelines | design-language | metadata_only | — | 0 | 0 | 0 | 5 | 0.90 |
| HPE Design System | design-system | metadata_only | — | 0 | 0 | 0 | 17 | 0.86 |
| Helsinki Design System | design-system | metadata_only | — | 0 | 0 | 0 | 12 | 0.93 |
| Ignite UI | commercial-suite | metadata_only | — | 0 | 0 | 0 | 24 | 0.95 |
| Microsoft FAST | web-components | metadata_only | — | 0 | 0 | 0 | 11 | 0.95 |
| Panda CSS | styling-engine | metadata_only | — | 0 | 0 | 0 | 7 | 0.96 |
| Pluralsight Design System | design-system | metadata_only | — | 0 | 0 | 0 | 15 | 0.75 |

## Component extraction completeness

Across 6489 published components. "Not extracted" means ATLAS has not parsed the field; it is unknown, not absent.

| Field | Documented | Documented none | Not documented | Inferred | Not extracted |
|---|---:|---:|---:|---:|---:|
| description | 4133 (63.7%) | 0 | 151 | 0 | 2205 (34.0%) |
| variants | 433 (6.7%) | 0 | 941 | 0 | 5115 (78.8%) |
| states | 294 (4.5%) | 0 | 707 | 341 | 5147 (79.3%) |
| sizes | 342 (5.3%) | 0 | 990 | 0 | 5157 (79.5%) |
| properties | 1345 (20.7%) | 1 | 88 | 0 | 5055 (77.9%) |
| accessibility | 580 (8.9%) | 0 | 554 | 0 | 5355 (82.5%) |
| keyboard | 160 (2.5%) | 1 | 818 | 1 | 5509 (84.9%) |
| responsive | 49 (0.8%) | 0 | 583 | 0 | 5857 (90.3%) |
| tokens | 337 (5.2%) | 37 | 121 | 168 | 5826 (89.8%) |
| examples | 1349 (20.8%) | 0 | 80 | 0 | 5060 (78.0%) |
| frameworks | 1443 (22.2%) | 7 | 32 | 4278 | 729 (11.2%) |
| relationships | 833 (12.8%) | 0 | 396 | 29 | 5231 (80.6%) |

Taxonomy classification:

- inferred: 4854
- unclassified: 1573
- verified: 62

## Token coverage

| Category | Tokens | Systems |
|---|---:|---:|
| color | 24124 | 16 |
| spacing | 3962 | 14 |
| typography | 2750 | 15 |
| elevation | 1097 | 13 |
| opacity | 927 | 6 |
| shape | 867 | 15 |
| motion | 460 | 12 |
| layout | 131 | 9 |
| other | 80 | 6 |

Alias resolution: resolved 17714 · literal 12921 · theme-dependent 3632 · external 131

Token set redistribution status: permitted: 121 sets / 30272 tokens · restricted: 17 sets / 4126 tokens

## Source freshness

Documents tracked: 8660. Fetched within 7 days: 8660; within 30 days: 8660; never fetched: 0; not active (gone/blocked/error): 17.

## Broken links (sources of verified systems)

Sources: 705; link-checked: 673; broken (404/410/5xx/network): 1; restricted for automated clients (401/403/429, not verifiable, not counted as broken): 339; robots-disallowed: 19.

Restricted hosts: www.npmjs.com (HTTP 403) 336 · www.figma.com (HTTP 403) 3

| System | Kind | URL | Status | Error |
|---|---|---|---|---|
| sap-fiori | docs | https://ui5.github.io/ | 404 | HTTP_404 |

## Restricted, failed and metadata-only sources

Systems without extracted components or tokens, with the registry's reason. ATLAS never bypasses robots.txt, authentication, bot challenges or client-side rendering; these stay metadata-level until a static, permitted source exists.

| System | Ingestion | Reason (registry note) |
|---|---|---|
| Apple Human Interface Guidelines (`apple-hig`) | metadata_only | Guidelines-only design language: Apple ships no separate component package; the platform UI frameworks (SwiftUI/UIKit/AppKit) implement it. Apple Design Resources page links official Figma community files (e.g. 'iOS and iPadOS 27', 'macOS 2 |
| Helsinki Design System (`helsinki-design-system`) | metadata_only | hds.hel.fi pages render client-side (no <title> in server HTML); identity confirmed via the official repo README, which links hds.hel.fi plus React and Core Storybooks (hds.hel.fi/storybook/react/ recorded; /storybook/core/ also verified).  |
| HPE Design System (`hpe-design-system`) | metadata_only | Replacement for mailchimp-pattern-library (rejected: docs unreachable). Distinct verified system: HPE's first-party design system; no registry entry matches it. Grommet (React framework, same grommet GitHub org) has no entry; HPE Design Sys |
| Ignite UI (`ignite-ui`) | metadata_only | Classified commercial-suite even though some libraries are partly MIT (the 'open-source' tag reflects those subsets). Each framework has its own repo under github.com/IgniteUI (igniteui-angular, igniteui-webcomponents, igniteui-react, ignit |
| Microsoft FAST (`microsoft-fast`) | metadata_only | Infrastructure-level library rather than a visual design system; classified web-components. Fluent UI Web Components are built on FAST Element (per Fluent 2 Develop page). Docs are versioned (1.x/2.x/3.x); recorded the 3.x introduction. @mi |
| Panda CSS (`panda-css`) | metadata_only | Classified styling-engine: it ships no component catalog; Park UI provides components on top of it. Frameworks map the official framework guides to taxonomy slugs (Next.js/Remix/React Router/Gatsby/Redwood -> react; Vue/Nuxt -> vue; plus sv |
| Pluralsight Design System (`pluralsight-design-system`) | metadata_only | design.pluralsight.com and pando.pluralsight.com both redirect to the public Pando zeroheight site (has_password:false), which lists foundations, ~50 components, tokens, 'Pando v1' migration guides and legacy 'PSDS Classic' docs. Pando npm  |

Documents not active (gone, robots-blocked or erroring): 17.
- skyscanner-backpack: gone 16
- vuetify: gone 1

Errors recorded in each system's latest run: 1 (a run still succeeds when a retried attempt does).
- thumbprint (run succeeded): discover/DISCOVER_FAILED x1

## Duplicates and conflicts

Display names shared by distinct components within a system (case-insensitive): 34. These are separate source records with distinct slugs and docs, e.g. current vs deprecated/legacy implementations (Primer, Cloudscape), web components vs the archived React package (Polaris), compat vs preview (Fluent).
- shopify-polaris: "text" x2
- shopify-polaris: "date picker" x2
- shopify-polaris: "icon" x2
- shopify-polaris: "link" x2
- shopify-polaris: "modal" x2
- atlassian: "grid" x2
- fluent-ui-react: "calendar" x2
- shopify-polaris: "heading" x2
- github-primer: "tooltip" x2
- shopify-polaris: "banner" x2
- shopify-polaris: "color picker" x2
- shopify-polaris: "button" x2
- cloudscape: "pie and donut charts" x2
- shopify-polaris: "popover" x2
- shopify-polaris: "grid" x2
- shopify-polaris: "box" x2
- atlassian: "breadcrumbs" x2
- shopify-polaris: "tooltip" x2
- shopify-polaris: "badge" x2
- github-primer: "dialog" x2

Latest-run extraction validation: valid 6676 · warning 129

Conflicting evidence records: 0.

Evidence states: verified 27076 · inferred 746 · unavailable 68

## Ingestion runs

Runs by status: succeeded 398 · failed 1

| System | Kind | Status | Stage | Started |
|---|---|---|---|---|
| thumbprint | incremental | failed | discover | 2026-11-05 12:15:18.563423+00 |

Unresolved errors by stage/code:

| Stage | Code | Count |
|---|---|---:|
| validate | SUSPICIOUS | 14 |
| discover | DISCOVER_FAILED | 4 |
| discover | STAGE_FAILED | 1 |
