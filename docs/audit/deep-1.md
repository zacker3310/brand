# Deep-adapter data-integrity audit (deep-1)

Adversarial audit of what ATLAS publishes for ten deeply indexed systems: github-primer, carbon, material-web,
material-design, fluent-2, fluent-ui-react, fluent-ui-web-components, shopify-polaris, atlassian and
govuk-design-system (adapters `primer`, `carbon`, `material`, `fluent`, `polaris`, `atlassian`, `govuk`).
Date: 2026-11-05. Auditor: deep-1 workstream. The aim was to refute published claims against the live official
sources, not to confirm them.

## Results at a glance

| Measure | Before fixes | After fixes (re-ingested and re-verified in `atlas`) |
|---|---|---|
| Targeted sample: 612 checks over 60 components, 100 tokens, 18 patterns, 10 token-set licenses and every system fact | **27 REFUTED (4.4%)**, 2 UNVERIFIABLE | **1 REFUTED (0.2%)**: a taxonomy rule in a shared file, see requested changes |
| Random sample of absence claims (`not-documented`): 50 claims, 1 per sampled component that has one | **12 REFUTED (24%)**, 8 of them not already found by the targeted checks | 0 |
| New random sample of absence claims drawn after the fixes, with a different seed: 18 claims | **1 REFUTED (5.6%)** | 0. Fixed in the same session |
| Distinct refuted claims | 36 | 35 fixed, 1 open |
| Component, variant, property, token, pattern and system-fact values that the sources contradicted | 3 (two Fluent `required` flags, one evidence pointer) | 0 |
| Token values (raw and resolved, alias chains, themes) checked against the pinned package files | 100/100 confirmed | 100/100 |
| Published components in scope | 842 | 842. No component was lost or created; changes are updates in place |

The values ATLAS publishes held up: names, docs URLs, descriptions, props, keyboard rows, tokens, patterns and system
facts were almost all confirmed. The weak spot was **absence claims**. 21 of the 26 targeted coverage checks were
refuted, and so were 24% of randomly drawn `not-documented` values. Most adapters wrote `not-documented` whenever their
own parser found nothing: no dedicated section, no matching prop name, or a field that is simply not parsed (Fluent 2
hard-coded states, sizes and tokens as `not-documented`). The source often documents the field in prose or in a shape
the parser does not read. CLAUDE.md defines `not-documented` as "ATLAS checked the source and it does not document
this", so in each of these cases the honest value is `not-extracted`. The fixes do not invent values. They lower
unchecked absence claims to `not-extracted`, and extract a value only where the source states it in a parseable form:
Primer density, Polaris `segmented`, the Polaris `switch` role, the Atlassian examples tab, and the Fluent union props.

### Verdicts by system (targeted sample)

| System | Checks | REFUTED before | REFUTED after | UNVERIFIABLE |
|---|---|---|---|---|
| github-primer | 77 | 1 (1.3%) | 0 | 0 |
| carbon | 83 | 4 (4.8%) | 0 | 0 |
| material-web | 48 | 3 (6.2%) | 0 | 0 |
| material-design | 36 | 0 (0.0%) | 0 | 0 |
| fluent-2 | 57 | 5 (8.8%) | 0 | 0 |
| fluent-ui-react | 49 | 3 (6.1%) | 0 | 1 |
| fluent-ui-web-components | 55 | 0 (0.0%) | 0 | 0 |
| shopify-polaris | 66 | 7 (10.6%) | 0 | 0 |
| atlassian | 72 | 1 (1.4%) | 0 | 1 |
| govuk-design-system | 69 | 3 (4.3%) | 1 | 0 |

### Verdicts by kind (targeted sample)

| Kind | Checks | REFUTED before | REFUTED after | UNVERIFIABLE |
|---|---|---|---|---|
| components | 438 | 26 (5.9%) | 0 | 1 |
| tokens | 110 | 0 (0.0%) | 0 | 1 |
| patterns | 45 | 1 (2.2%) | 1 | 0 |
| system | 19 | 0 (0.0%) | 0 | 0 |

## Method

- **Sample (reproducible).** Read-only queries against the dev DB `atlas`, taken at 12:17 UTC before any change:
  - 6 published components per system, `row_number() over (partition by design_system_id order by md5(id::text || 'deep-1'))`. That gives 60 components.
  - Inside each component, up to 4 variants, 4 states and 3 properties were drawn the same way (`md5(<row id> || 'deep-1')`), plus the first 3 keyboard rows and every evidence row.
  - 10 tokens per system from published token sets, same ordering. That gives 100 tokens.
  - 3 published patterns per system that has patterns, same ordering. That gives 18 patterns.
  - All system-level facts: latest version, principles and philosophy, plus every token-set license and redistribution flag.
- **Absence samples.**
  - *Random absence sample (before fixes).* For each sampled component, one of its `not-documented` component or accessibility coverage fields was drawn by `md5(id || field || 'deep-1')`. 50 components had at least one such field.
  - *Post-fix absence sample.* After the fixes, 2 `not-documented` claims per system were drawn from the whole published catalog with seed `'deep-1-after'`. material-design has none, so the sample has 18 claims.
- **Sources.** Every claim was checked against the live official source: the evidence `source_url`, plus the `docs_url` when the two differ.
  - Pages were fetched with `curl` through a cached fetcher, at most 1 request per second per host, with a fixed audit user agent. Robots and access controls were respected.
  - GitHub `blob` evidence was read through raw.githubusercontent.com (same content).
  - Storybook docs URLs were checked against the Storybook `index.json`, because the docs pages are client-rendered.
  - npm facts were checked against registry.npmjs.org, because www.npmjs.com answers 403 to non-browser clients.
  - The checks are scripts, so every verdict can be reproduced. A failed automatic match was always re-read by hand before it was called REFUTED. Several automatic misses were confirmed by hand: markdown link syntax, multi-line TSDoc, union order in props tables, Atlassian client-side redirect stubs, and template-generated Fluent palette tokens.
- **Checks per component.** These follow the task letters:
  - (a) the component exists under that name;
  - (b) the docsUrl resolves to the right page;
  - (c) sampled variants, sizes and states appear in the source;
  - (d) sampled properties match the source API table or types: name, type, default and required;
  - (e) stored keyboard rows, roles, ARIA pattern and guidance appear in the source's accessibility docs;
  - (f) the description or guidance excerpt is faithful and at most about 280 characters;
  - (g) coverage states are honest;
  - (h) any `verified` classification is backed by the cited link.
- **Tokens.** Each sampled token was checked in the token package file at the pinned `token_set.package_version`:
  - the raw value at the stored location (file plus JSON pointer or line);
  - the resolved value, following the alias chain to the target token's own source value (through the Material reference palette and the Fluent shared-colour tables);
  - the theme;
  - the license and redistribution flag of the set, against the npm `license` field and the package LICENSE.
- **Verdicts.**
  - **CONFIRMED**: the claim matches the cited source, and the live docs page does not contradict it.
  - **REFUTED**: the cited or live source contradicts the claim. This includes a `not-documented` value where the source documents the field, an `[]` value that the UI renders as "documented none", a `required` flag the types do not support, and an excerpt that changes meaning without its context.
  - **UNVERIFIABLE**: the source cannot settle the claim, with the reason given.
- **Fixes.** Each refutation was traced to code. Adapter bugs in scope were fixed and covered by regression tests in `tests/unit/adapters/audit-deep1.test.ts` (20 tests).
  - Each fix was dry-run (`npx tsx scripts/adapter-dry-run.ts <adapter> <slug>`): every dry-run passed the contract with 0 error issues. It was then re-ingested and re-verified in `atlas`.
  - The parse stage is cached by `(document, adapter, adapter version, content hash)`, so the adapter versions were bumped for parse-stage changes: polaris 1.0.1, carbon 1.0.1, atlassian 1.0.1, govuk 1.1.2, material 1.0.1 and fluent 1.0.2.
  - Root causes in shared files (UI, engine, taxonomy, tokens lib) were not edited. They are listed under requested changes.

## Refuted claims, root causes and fixes

"Source" quotes the live official page or package file at the evidence URL. All statuses were re-verified in `atlas` after re-ingest.

| # | System, record | Claim (before) | Source says | Root cause | Status |
|---|---|---|---|---|---|
| 1 | github-primer DataTable | variants: not-documented | "Table cell density", `cellPadding: 'condensed' \| 'normal' \| 'spacious'` ([components.json](https://cdn.jsdelivr.net/npm/@primer/react@38.44.0/generated/components.json), [docs](https://primer.style/product/components/data-table/)) | `VARIANT_AXIS_PROPS` had no density axis (`primer/constants.ts`) | fixed: 3 density variants |
| 2 | github-primer ActionBar | states: not-documented | `ActionBar.IconButton.disabled` and `ActionBar.Button.disabled` (boolean), already published as ActionBar properties | `statesFrom` reads top-level props only (`primer/normalize.ts`) | fixed: not-extracted |
| 3 | carbon Radio button | a11y.screenReader: not-documented | "Carbon surfaces the labeling of radio buttons ... to screen readers", "JAWS screen reader output" ([accessibility](https://www.carbondesignsystem.com/building-blocks/core/components/radio-button/accessibility)) | Only a heading titled "Screen reader" counted (`carbon/docs.ts`, `carbon/normalize.ts`) | fixed: not-extracted |
| 4 | carbon Radio button | variants: not-documented | "The AI variant functions the same as the normal version" (AI presence section) | Only Variants tables parsed | fixed: not-extracted |
| 5 | carbon Pagination | a11y.ariaPattern: not-documented | Links the APG combobox select-only example | APG regex matched only `/apg/patterns/<x>/` | fixed: not-extracted |
| 6 | carbon Tile | a11y.ariaPattern: not-documented | Links `w3c.github.io/aria-practices/#tooltip` | same as #5 | fixed: not-extracted |
| 7-9 | carbon Radio button, Tile, Select | a11y.focusManagement: not-documented | "Pressing Tab again will move focus out of the radio button group"; "a focus indicator appears around the currently selected tile"; "The currently selected option will have focus" | Only a heading starting with "Focus" counted | fixed: not-extracted (catalog-wide 41 -> 11) |
| 10 | fluent-2 Toast | states: not-documented | "A confirmation toast's state can be success, error, warning, informational, or progress" ([usage](https://fluent2.microsoft.design/components/web/react/core/toast/usage/)) | states/sizes/tokens hard-coded `not-documented` (`fluent/normalize-f2.ts`) | fixed: not-extracted |
| 11 | fluent-2 Spin button | states: not-documented | "Disabled spin buttons ... the appropriate spin button is disabled" | same as #10 | fixed |
| 12 | fluent-2 Field | states: not-documented | Validation states Success / Warning / Error; "Disabled fields" | same as #10 | fixed |
| 13 | fluent-2 Info label | sizes: not-documented | "Info labels at a small size (20 x 20 pixels) ..." | same as #10 | fixed |
| 14 | fluent-2 Spin button | keyboard: not-documented | "using the keyboard arrows to change the value" (Behavior section) | Only the Accessibility section was scanned, with a case-sensitive key regex | fixed: not-extracted |
| 15 | fluent-2 Toast | a11y.keyboard: not-documented | "toasts that don't include actions won't receive keyboard focus for people who navigate primarily by keyboard" | same as #14 | fixed |
| 16 | fluent-2 Menu | a11y.guidance: not-documented | Submenus: "add an aria-label to the trigger component for people who use screen readers" | Guidance read only from an Accessibility section | fixed: not-extracted |
| 17 | fluent-ui-react ToolbarButton | states: not-documented | `ToolbarButtonProps = ... & Partial<Pick<ButtonProps, 'disabled' \| 'disabledFocusable'>>` (imported, unresolved) | Absence claimed despite unresolved heritage (`fluent/normalize-react.ts`) | fixed: not-extracted (heritage that cannot carry such props, such as `RefAttributes`, is ignored) |
| 18-19 | fluent-ui-react Option | `children: React_2.ReactNode` required; `text: string` required | `{ text?: string; children: string } \| { text: string; children?: ReactNode }` ([d.ts](https://cdn.jsdelivr.net/npm/@fluentui/react-combobox@9.17.8/dist/index.d.ts)) | Union branches merged with intersection semantics (`fluent/dts.ts`) | fixed: `children: string \| React_2.ReactNode` optional, `text` optional (catalog-wide required props 63 -> 59) |
| 20 | fluent-ui-web-components DropdownOption | relationships: not-documented | TSDoc: "specifically designed for use in the Dropdown element", `{@link (BaseDropdown:class)}` | Only class inheritance read (`fluent/normalize-wc.ts`) | fixed: not-extracted (post-fix sample) |
| 21 | govuk Pagination | guidance begins "This causes problems for keyboard users." | "Avoid using the 'infinite scroll' technique ... This causes problems for keyboard users." | Sentence matching dropped the sentence that names the subject (`govuk/docs.ts`) | fixed: the excerpt keeps the preceding sentence(s) |
| 22 | govuk Select | a11y.screenReader: "While screen readers will read out the link text, they usually do not tell users the text is a link." | Preceded by "Do not use links in hint text." | same as #21 | fixed (Cookie banner, a chain of two dependent sentences, also fixed; catalog-wide 7 -> 0) |
| 23 | govuk pattern Confirmation pages | inferred type `dialogs-and-confirmation` | "Let users know they've completed a transaction" (an end-of-journey page, not a dialog) | Taxonomy alias `confirmation` is too broad (`src/lib/taxonomy`, shared file) | **open**: requested change |
| 24 | material-web Chip set | description evidence at `custom-elements.json#/modules/26/declarations/0` | That declaration says "TODO(b/243982145): add docs"; the text comes from the superclass at `#/modules/34/declarations/0` | Evidence pointed at the element, not at the declaration that holds the text (`material/cem.ts`) | fixed: `docPointer` |
| 25 | material-web FAB | sizes: not-documented | "FABs may be small, medium (default), or large by setting the `size` attribute"; `size: FabSize` | Sizes read only from literal unions (`material/normalize-web.ts`) | fixed: not-extracted |
| 26 | material-web Sliders | variants: not-documented | Usage: "Sliders may be continuous or discrete, and may also represent a range" (Continuous / Discrete / Range) | Variants read only from a "## Types" section | fixed: not-extracted (catalog-wide 25 -> 13) |
| 27-32 | shopify-polaris Heading, Button group, Block stack, Button, Setting toggle, Form layout | sizes `[]`, which the UI renders as "documented none" | The sources never state that a component has no sizes | Adapter wrote `[]` for "none found" (`polaris/normalize.ts`) | fixed: `null` (catalog-wide 134 -> 0) |
| 33 | shopify-polaris Setting toggle | a11y.roles: not-documented | "implemented as an HTML `<button>` with the `switch` ARIA role" | Role regex missed the "X ARIA role" phrasing (`polaris/mdx.ts`) | fixed: roles `[switch]` |
| 34 | shopify-polaris Button group | variants: not-documented | `variant?: Variant` with `type Variant = 'segmented'` ([d.ts](https://cdn.jsdelivr.net/npm/@shopify/polaris@13.9.5/build/ts/src/components/ButtonGroup/ButtonGroup.d.ts)) | Aliases that resolve to a single literal were discarded (`polaris/dts.ts`) | fixed: variant `segmented` |
| 35 | shopify-polaris Form layout | responsive: not-documented | "Field groups will wrap automatically on smaller screens" | Responsive guidance read only from `ResponsiveProp` props | fixed: not-extracted |
| 36 | atlassian Country select | examples: not-documented | The Examples tab has one live example with code and no section heading ([examples](https://atlassian.design/components/select/country-select/examples)) | Examples listed only from h2/h3 headings (`atlassian/html.ts`, `atlassian/normalize.ts`) | fixed: docs-link example (catalog-wide 8 -> 1; the remaining one, side-nav-items, has no Examples tab, which answers 404) |

## Catalog-wide impact of the fixes (published records, `atlas`)

| Measure | Before | After |
|---|---|---|
| Polaris components with `sizes = []` (shown as "documented none") | 134 | 0 |
| Fluent 2 components with states `not-documented` | 55 | 0 |
| Fluent 2 components with keyboard `not-documented` | 50 | 36 |
| Fluent UI React components with states `not-documented` | 168 | 131 |
| Fluent UI React properties flagged `required` | 63 | 59 |
| Fluent UI Web Components with relationships `not-documented` | 39 | 29 |
| Carbon accessibility screenReader / ariaPattern / focusManagement `not-documented` | 42 / 32 / 41 | 32 / 21 / 11 |
| Carbon components with variants `not-documented` | 16 | 12 |
| Primer components with variants `not-documented` | 63 | 62 |
| Atlassian components with examples `not-documented` | 8 | 1 |
| Material Web components with sizes / variants `not-documented` | 35 / 25 | 34 / 13 |
| GOV.UK guidance or screen-reader excerpts that start with a dependent sentence ("This...", "While...") | 7 | 0 |
| Polaris accessibility roles `not-documented` | 61 | 60 |
| Published components (all ten systems) | 842 | 842 |

Every value that moved went from a claimed absence to `not-extracted`, or to a value the source states. No value was
inferred or invented. The regression diff of the 60 sampled components before and after re-ingest shows only these
intended changes: no variant, state, property, keyboard row, description or docs URL was lost.

## Re-ingestion

- The systems were re-ingested into `atlas` with `npm run ingest -- --system <slug> --inline` between 13:01 and 14:00 UTC. They were shopify-polaris, atlassian, carbon, github-primer, govuk-design-system, material-web, material-design, fluent-2, fluent-ui-react and fluent-ui-web-components.
- A background worker started at 12:15 (before these fixes) was still polling the shared default job queue, and it claimed some stages of these runs:
  - the parse and publish stages of github-primer run `ffa93f78`;
  - the whole first fluent-ui-react run.
  - It executed those stages with pre-fix adapter code. Both systems were therefore re-run with every stage executed in the ingesting process, using a scratch runner that claims only its own run's jobs, and re-verified.
- Since commit 893e655 (another workstream), `--inline` runs use a private queue. The final GOV.UK and fluent-ui-web-components runs used that path.
- Parse-stage fixes needed the adapter-version bumps above, because the engine otherwise reuses cached fragments.

## Not counted as refutations (checked, with caveats)

- **Carbon source drift (open issue).**
  - Carbon descriptions, guidance and pattern text come from the `carbon-design-system/carbon-website` MDX on GitHub (the evidence URL), and they match it.
  - The live site (`carbondesignsystem.com/building-blocks/...`, "Last updated Aug 11, 2026") has rewritten some leads. 2 of the 5 sampled Carbon component descriptions (Tile, Select) and 3 of the 3 sampled Carbon patterns read differently live, with the same meaning.
  - Keyboard rows, states, sizes and variants still matched the live pages.
  - The adapter should prefer the live page's lead or meta description when the two diverge. This is not fixed in this audit.
- **Primer lifecycle.** `components.json` says `alpha` for ActionBar, SelectPanel, Autocomplete and others, while the docs pages show "React: ready". ATLAS follows the docs pages (`stable`).
- **Fluent UI React Calendar lifecycle `experimental` (UNVERIFIABLE).**
  - The value comes from a semver rule (0.x means experimental) on `@fluentui/react-calendar-compat@0.4.8`, recorded with method `npm-version`.
  - Fluent does not label the compat Calendar experimental. Lifecycle has no inferred state in the contract (see requested changes).
- **Atlassian token license (UNVERIFIABLE).**
  - The package `LICENSE` and the npm field of `@atlaskit/tokens@20.9.0` say Apache-2.0. The ADS License Agreement claims field-of-use limits on code packages.
  - ATLAS keeps the conservative `restricted`, which the registry notes document, but `token_set.license_id` is null instead of recording the conflict.
- **Token display strings.** The token values were correct, but 267 Primer `value_text` strings carry float noise, for example `hsl(4.3 26.200000000000003% 42%)` for components `[4.3, 26.2, 42]`. The cause is in `src/lib/tokens` (requested change).
- **Fluent 2 Menu ARIA pattern `menubar`.** The page's "Menu pattern (WAI guidance)" link goes to `/WAI/ARIA/apg/patterns/menubar/`, and the UI labels it "Menu and Menubar pattern". Correct.
- **GOV.UK Feedback lifecycle `beta`.** GOV.UK says "trial status", and ATLAS has no `trial` lifecycle value.
- **fluent-2 latest version.** `9.75.1` is the `@fluentui/react-components` version; the design-language site has no version of its own.
- **Atlassian docs URLs.** URLs such as `/components/empty-state` answer 200 with a client-side redirect to `/examples`. They work in a browser.
- **GOV.UK nested `required` flags.** Flags such as `formGroup.beforeInput.text` and `rows[].text` copy the YAML (`required: true`). The descriptions carry the condition ("If `html` is set, this is not required").

## Fixes applied (files)

- `src/ingestion/adapters/primer/constants.ts`: density axis (`cellPadding`, `density`).
- `src/ingestion/adapters/primer/normalize.ts`: subcomponent state props make parent states `not-extracted`.
- `src/ingestion/adapters/carbon/docs.ts` and `normalize.ts`:
  - mentions of screen readers and focus, and APG links in any URL form, make those fields `not-extracted`;
  - an "AI presence" section makes variants `not-extracted`.
- `src/ingestion/adapters/carbon/proptypes.ts`: pre-existing lint error (`prefer-const`).
- `src/ingestion/adapters/fluent/dts.ts`: `mergeUnion`. In a union, a prop is required only when every branch requires it, and its type is the union of the branch types.
- `src/ingestion/adapters/fluent/normalize-react.ts`: unresolved heritage makes variants, sizes and states `not-extracted`. Ref and DOM attribute bags are ignored.
- `src/ingestion/adapters/fluent/normalize-f2.ts`:
  - states, sizes and tokens are `not-extracted`;
  - keyboard and accessibility mentions anywhere on the page make those fields `not-extracted`.
- `src/ingestion/adapters/fluent/normalize-wc.ts`: TSDoc that names or links other elements makes relationships `not-extracted`.
- `src/ingestion/adapters/govuk/docs.ts`: a guidance sentence that depends on the one before it ("This...", "While...") keeps up to two preceding sentences.
- `src/ingestion/adapters/atlassian/html.ts` and `normalize.ts`: an Examples tab with code examples but no headings yields one docs-link example.
- `src/ingestion/adapters/material/cem.ts` and `normalize-web.ts`:
  - `docPointer` for inherited descriptions;
  - a `size` prop with an alias type, or a "Sizes" section, gives sizes `not-extracted`;
  - no "Types" section gives variants `not-extracted`.
- `src/ingestion/adapters/polaris/normalize.ts`:
  - `sizes: null` instead of `[]`;
  - responsive prose ("smaller screens", "mobile") gives responsive `not-extracted`.
- `src/ingestion/adapters/polaris/mdx.ts`: the "`X` ARIA role" phrasing yields role X.
- `src/ingestion/adapters/polaris/dts.ts`: aliases that resolve to a single literal are enumerations.
- Adapter versions: polaris, carbon, atlassian, govuk, material and fluent (parse cache invalidation).
- `tests/unit/adapters/audit-deep1.test.ts`: 20 regression tests. They cover the parsers and normalizers changed above. Three normalize-only rules are verified in the dry-run bundles and re-ingested data rather than by unit tests: Polaris `sizes: null`, Polaris responsive prose, and Fluent React unresolved heritage.

## Requested changes (shared files, not edited)

1. **`src/components/catalog/detail/sections.tsx` (`SizesBlock`).** It renders `sizes = []` as "documented none" whatever the coverage state. It should render `documented-none` only when `coverage.sizes === "documented-none"`, and otherwise follow the coverage state.
   - Defense in depth, in `src/ingestion/engine/stages/promote-components.ts`: store `null` when `sizes` is `[]` and `coverage.sizes !== "documented-none"`.
   - The engine could also warn when an adapter reports `[]` without `documented-none`.
2. **`src/lib/tokens/color.ts` (`toCssColor`).** Round the channel values to the source precision before `formatCss`, for example 4 significant digits for hue and percentages. This affects 267 Primer `value_text` strings such as `hsl(4.3 26.200000000000003% 42%)`.
3. **`src/lib/taxonomy` (`PATTERN_TYPES`).** The `dialogs-and-confirmation` type has the alias `confirmation`, which maps GOV.UK "Confirmation pages" (end-of-transaction pages) to "interrupting a flow to confirm".
   - Replace it with `confirmation dialog`, `confirmation dialogs` and `confirm dialog`. GOV.UK Confirmation pages would then be unclassified, or would go to a completion type if one is added.
   - Consider the alias `interruption pages` for `dialogs-and-confirmation`.
4. **`src/ingestion/engine` (worker).** A long-running worker executes jobs with whatever adapter code it loaded at start.
   - It should refuse, or release, stage jobs whose run's `adapter_version` differs from the version of the adapter it has loaded.
   - Alternatively, the run could record the adapter version and the worker could skip mismatched runs.
   - The private inline queue in commit 893e655 covers `--inline` runs only.
5. **`src/lib/contracts` (lifecycle provenance).** Lifecycle values derived by rule, for example semver 0.x meaning `experimental` (Fluent compat packages), carry no `inferred` marker. Add a lifecycle coverage or verification state, so the UI can show "inferred from version".
6. **Registry, seed (`data/registry`, `scripts/seed.ts`).** Record the Atlassian token license conflict: package LICENSE Apache-2.0 against the ADS License Agreement. Use `token_set.license_id`, or a `conflicting` verification state, instead of `null`.

## Open issues (in scope, not fixed here)

- Carbon source drift (see above): prefer live page text when the carbon-website MDX is stale.
- Not every remaining `not-documented` value was re-verified. The post-fix random sample (18 claims) found 1 refutation, now fixed. Accessibility `roles` in Fluent 2 is still hard-coded `not-documented`; the sample found that correct for Nav.

## How to reproduce

- Sample query: `row_number() over (partition by design_system_id order by md5(id::text || 'deep-1'))`, with the same expression for tokens and patterns.
- Absence samples: `md5(id || field || 'deep-1')` and `md5(id::text || field || 'deep-1-after')`.
- Regression tests: `npx vitest run tests/unit/adapters/audit-deep1.test.ts`.
- Dry-runs: `npx tsx scripts/adapter-dry-run.ts <polaris|atlassian|carbon|primer|govuk|material|fluent> <slug>`.

## Per-system check tables

Every check in the targeted sample, then the random absence sample (`g-random`) and the post-fix absence sample
(`g-after`). REFUTED rows carry their status after re-ingest. Evidence is the URL that was read. GitHub blob URLs
were read through raw.githubusercontent.com.

### github-primer

| Subject | Check | Claim | Verdict | Evidence | Note |
|---|---|---|---|---|---|
| pattern Edit | pattern-exists | pattern 'Edit' exists at docsUrl | CONFIRMED | <https://primer.style/product/scenario-patterns/edit/> | title: Edit \| Primer |
| pattern Edit | pattern-description | description excerpt (25 chars) | CONFIRMED | <https://primer.style/product/scenario-patterns/edit/> |  |
| pattern Placeholders | pattern-exists | pattern 'Placeholders' exists at docsUrl | CONFIRMED | <https://primer.style/accessibility/patterns/placeholders/> | title: Placeholders \| Primer |
| pattern Placeholders | pattern-description | description excerpt (75 chars) | CONFIRMED | <https://primer.style/accessibility/patterns/placeholders/> |  |
| pattern Copy | pattern-exists | pattern 'Copy' exists at docsUrl | CONFIRMED | <https://primer.style/product/scenario-patterns/copy/> | title: Copy \| Primer |
| pattern Copy | pattern-description | description excerpt (30 chars) | CONFIRMED | <https://primer.style/product/scenario-patterns/copy/> |  |
| Autocomplete | a-exists | component named 'Autocomplete' exists | CONFIRMED | <https://primer.style/product/components/autocomplete/> |  |
| Autocomplete | b-docsUrl | docsUrl resolves to the component page | CONFIRMED | <https://primer.style/product/components/autocomplete/> |  |
| Autocomplete | f-description | description excerpt (110 chars) | CONFIRMED | <https://primer.style/product/components/autocomplete/> |  |
| Autocomplete | d-prop | Autocomplete.Menu.loading: boolean | CONFIRMED | <https://cdn.jsdelivr.net/npm/@primer/react@38.44.0/generated/components.json> |  |
| Autocomplete | d-prop | Autocomplete.Menu.onOpenChange: (open: boolean) => void | CONFIRMED | <https://cdn.jsdelivr.net/npm/@primer/react@38.44.0/generated/components.json> |  |
| Autocomplete | d-prop | id: string | CONFIRMED | <https://cdn.jsdelivr.net/npm/@primer/react@38.44.0/generated/components.json> |  |
| Autocomplete | g-coverage | accessibility/keyboard = not-documented | CONFIRMED | <https://primer.style/product/components/autocomplete/accessibility/> | no accessibility page (redirects to https://primer.style/); overview+guidelines have no a11y section |
| DataTable | a-exists | component named 'DataTable' exists | CONFIRMED | <https://primer.style/product/components/data-table/> |  |
| DataTable | b-docsUrl | docsUrl resolves to the component page | CONFIRMED | <https://primer.style/product/components/data-table/> |  |
| DataTable | f-description | description excerpt (118 chars) | CONFIRMED | <https://primer.style/product/components/data-table/> |  |
| DataTable | d-prop | Table.Body.children: React.ReactNode | CONFIRMED | <https://cdn.jsdelivr.net/npm/@primer/react@38.44.0/generated/components.json> |  |
| DataTable | d-prop | rowSelection: boolean | CONFIRMED | <https://cdn.jsdelivr.net/npm/@primer/react@38.44.0/generated/components.json> |  |
| DataTable | d-prop | onSelectionChange: ({ selectedRows }: { selectedRows: Set<DataTableRowId> }) => void | CONFIRMED | <https://cdn.jsdelivr.net/npm/@primer/react@38.44.0/generated/components.json> |  |
| DataTable | e-keyboard | Escape: dismiss row-action dropdown menus | CONFIRMED | <https://primer.style/product/components/data-table/accessibility/> |  |
| DataTable | e-keyboard | Arrow keys: scroll focused table at narrow widths | CONFIRMED | <https://primer.style/product/components/data-table/accessibility/> |  |
| DataTable | e-roles | roles table/cell/columnheader/rowgroup/row/rowheader | CONFIRMED | <https://primer.style/product/components/data-table/accessibility/> |  |
| DataTable | lifecycle | lifecycle experimental | CONFIRMED | <https://primer.style/product/components/data-table/> |  |
| ActionBar | a-exists | component named 'ActionBar' exists | CONFIRMED | <https://primer.style/product/components/action-bar/> |  |
| ActionBar | b-docsUrl | docsUrl resolves to the component page | CONFIRMED | <https://primer.style/product/components/action-bar/> |  |
| ActionBar | f-description | description excerpt (205 chars) | CONFIRMED | <https://primer.style/product/components/action-bar/> |  |
| ActionBar | c-sizes | sizes small/medium/large | CONFIRMED | <https://primer.style/product/components/action-bar/> |  |
| ActionBar | d-prop | size: 'small' \| 'large' \| 'medium' = 'medium' | CONFIRMED | <https://cdn.jsdelivr.net/npm/@primer/react@38.44.0/generated/components.json> |  |
| ActionBar | d-prop | ActionBar.Group.children: React.ReactNode | CONFIRMED | <https://cdn.jsdelivr.net/npm/@primer/react@38.44.0/generated/components.json> |  |
| ActionBar | d-prop | ActionBar.Menu.returnFocusRef: React.RefObject<HTMLElement> | CONFIRMED | <https://cdn.jsdelivr.net/npm/@primer/react@38.44.0/generated/components.json> |  |
| ActionBar | d-prop | ActionBar.IconButton.aria-label: string | CONFIRMED | <https://cdn.jsdelivr.net/npm/@primer/react@38.44.0/generated/components.json> |  |
| ActionBar | e-keyboard | Tab: one tab stop into/out of ActionBar | CONFIRMED | <https://primer.style/product/components/action-bar/accessibility/> |  |
| ActionBar | e-keyboard | Right arrow moves focus to next button | CONFIRMED | <https://primer.style/product/components/action-bar/accessibility/> |  |
| ActionBar | e-keyboard | Left arrow moves focus to previous button | CONFIRMED | <https://primer.style/product/components/action-bar/accessibility/> |  |
| ActionBar | e-guidance | guidance: role toolbar, single tab stop | CONFIRMED | <https://primer.style/product/components/action-bar/accessibility/> |  |
| Tooltip | a-exists | component named 'Tooltip' exists | CONFIRMED | <https://primer.style/product/components/tooltip/> |  |
| Tooltip | b-docsUrl | docsUrl resolves to the component page | CONFIRMED | <https://primer.style/product/components/tooltip/> |  |
| Tooltip | f-description | description excerpt (103 chars) | CONFIRMED | <https://primer.style/product/components/tooltip/> |  |
| Tooltip | d-prop | type: 'label' \| 'description' = description | CONFIRMED | <https://cdn.jsdelivr.net/npm/@primer/react@38.44.0/generated/components.json> |  |
| Tooltip | d-prop | delay: 'short' \| 'medium' \| 'long' = short | CONFIRMED | <https://cdn.jsdelivr.net/npm/@primer/react@38.44.0/generated/components.json> |  |
| Tooltip | d-prop | direction: 'n' \| 'ne' \| 'e' \| 'se' \| 's' \| 'sw' \| 'w' \| 'nw' = s | CONFIRMED | <https://cdn.jsdelivr.net/npm/@primer/react@38.44.0/generated/components.json> |  |
| Tooltip | e-keyboard | Esc closes tooltip | CONFIRMED | <https://primer.style/product/components/tooltip/accessibility/> |  |
| SplitPageLayout | a-exists | component named 'SplitPageLayout' exists | CONFIRMED | <https://primer.style/product/components/split-page-layout/> |  |
| SplitPageLayout | b-docsUrl | docsUrl resolves to the component page | CONFIRMED | <https://primer.style/product/components/split-page-layout/> |  |
| SplitPageLayout | f-description | description excerpt (123 chars) | CONFIRMED | <https://primer.style/product/components/split-page-layout/> |  |
| SplitPageLayout | d-prop | SplitPageLayout.Sidebar.responsiveVariant: \| 'default' \| 'fullscreen' = 'default' | CONFIRMED | <https://cdn.jsdelivr.net/npm/@primer/react@38.44.0/generated/components.json> |  |
| SplitPageLayout | d-prop | SplitPageLayout.Footer.divider: \| 'none' \| 'line' \| { narrow?: \| 'none' \| 'line' \| 'filled' regular?: \| | CONFIRMED | <https://cdn.jsdelivr.net/npm/@primer/react@38.44.0/generated/components.json> |  |
| SplitPageLayout | d-prop | SplitPageLayout.Header.aria-label: string | CONFIRMED | <https://cdn.jsdelivr.net/npm/@primer/react@38.44.0/generated/components.json> |  |
| SplitPageLayout | g-coverage | accessibility/keyboard = not-documented | CONFIRMED | <https://primer.style/product/components/split-page-layout/accessibility/> | no accessibility page (redirects to https://primer.style/) |
| SelectPanel | a-exists | component named 'SelectPanel' exists | CONFIRMED | <https://primer.style/product/components/select-panel/> |  |
| SelectPanel | b-docsUrl | docsUrl resolves to the component page | CONFIRMED | <https://primer.style/product/components/select-panel/> |  |
| SelectPanel | f-description | description excerpt (228 chars, prefix of docs lead) | CONFIRMED | <https://primer.style/product/components/select-panel/> |  |
| SelectPanel | d-prop | variant: 'anchored' \| 'modal' = 'anchored' | CONFIRMED | <https://cdn.jsdelivr.net/npm/@primer/react@38.44.0/generated/components.json> |  |
| SelectPanel | d-prop | virtualized: boolean = false | CONFIRMED | <https://cdn.jsdelivr.net/npm/@primer/react@38.44.0/generated/components.json> |  |
| SelectPanel | d-prop | anchorRef: RefObject<HTMLElement> | CONFIRMED | <https://cdn.jsdelivr.net/npm/@primer/react@38.44.0/generated/components.json> |  |
| SelectPanel | d-prop | actionListProps: Partial<ActionListProps> = undefined | CONFIRMED | <https://cdn.jsdelivr.net/npm/@primer/react@38.44.0/generated/components.json> |  |
| SelectPanel | d-prop | loading: boolean = false | CONFIRMED | <https://cdn.jsdelivr.net/npm/@primer/react@38.44.0/generated/components.json> |  |
| SelectPanel | d-prop | open: boolean | CONFIRMED | <https://cdn.jsdelivr.net/npm/@primer/react@38.44.0/generated/components.json> |  |
| SelectPanel | e-keyboard | Tab: move focus forward within dialog | CONFIRMED | <https://primer.style/product/components/select-panel/accessibility/> |  |
| SelectPanel | e-keyboard | Shift+Tab: move focus backward | CONFIRMED | <https://primer.style/product/components/select-panel/accessibility/> |  |
| SelectPanel | e-keyboard | Enter: select items / activate buttons | CONFIRMED | <https://primer.style/product/components/select-panel/accessibility/> |  |
| SelectPanel | e-roles | role dialog | CONFIRMED | <https://primer.style/product/components/select-panel/accessibility/> |  |
| DataTable | g-coverage | variants = not-documented | **REFUTED** -> fixed | <https://primer.style/product/components/data-table/> | source documents density variants: 'Table cell density' section + cellPadding: 'condensed' \| 'normal' \| 'spacious' in components.json; adapter only scans props named variant/scheme/shape/status/appearance/emphasis/tone |
| system | latest_version | latest_version 38.44.0 (@primer/react) | CONFIRMED | <https://registry.npmjs.org/@primer/react/latest> | npm latest=38.44.0 |
| system | principles | principles: A cohesive experience; Inclusive and accessible design; Design for efficiency; The Zen of GitHub | CONFIRMED | <https://primer.style/product/getting-started/> |  |
| system | philosophy | 'built by GitHub for GitHub' | CONFIRMED | <https://primer.style/product/getting-started/> |  |
| token label.lemon.fgColor.hover [primitives-theme-light] | token-value | raw="{base.display.color.lemon.7}" | CONFIRMED | <https://cdn.jsdelivr.net/npm/@primer/primitives@11.10.0/src/tokens/component/label.json5> | source="{base.display.color.lemon.7}" alpha=None resolved={"colorSpace": "hsl", "components": [46.8, 98, 20], "hex": "#654f01"} |
| token control.small.paddingInline.normal [primitives-functional-size] | token-value | raw="{base.size.12}" | CONFIRMED | <https://cdn.jsdelivr.net/npm/@primer/primitives@11.10.0/src/tokens/functional/size/size.json5> | source="{base.size.12}" alpha=None resolved={"value": 12, "unit": "px"} |
| token base.display.color.auburn.4 [primitives-base-color-dark] | token-value | raw={"hex": "#87534f", "colorSpace": "hsl", "components": [4.3,  | CONFIRMED | <https://cdn.jsdelivr.net/npm/@primer/primitives@11.10.0/src/tokens/base/color/dark/display-dark.json5> | source={"colorSpace": "hsl", "components": [4.3, 26.2, 42], "hex":  alpha=None resolved={"colorSpace": "hsl", "components": [4.3, 26.2, 42], "hex": "#87534f"} |
| token display.green.scale.7 [primitives-theme-light] | token-value | raw="{base.display.color.green.7}" | CONFIRMED | <https://cdn.jsdelivr.net/npm/@primer/primitives@11.10.0/src/tokens/functional/color/display.json5> | source="{base.display.color.green.7}" alpha=None resolved={"colorSpace": "hsl", "components": [141.9, 39.4, 25.9], "hex": "#285c |
| token display.red.scale.8 [primitives-theme-light] | token-value | raw="{base.display.color.red.8}" | CONFIRMED | <https://cdn.jsdelivr.net/npm/@primer/primitives@11.10.0/src/tokens/functional/color/display.json5> | source="{base.display.color.red.8}" alpha=None resolved={"colorSpace": "hsl", "components": [346.9, 83.8, 29], "hex": "#880c27 |
| token color.ansi.magenta [primitives-theme-dark] | token-value | raw="{ansi.magenta}" | CONFIRMED | <https://cdn.jsdelivr.net/npm/@primer/primitives@11.10.0/src/tokens/functional/color/syntax.json5> | source="{ansi.magenta}" alpha=None resolved={"colorSpace": "hsl", "components": [265.2, 100, 78], "hex": "#BE8FFF" |
| token borderColor.danger.muted [primitives-theme-dark] | token-value | raw={"alpha": 0.4, "value": "{base.color.red.4}"} | CONFIRMED | <https://cdn.jsdelivr.net/npm/@primer/primitives@11.10.0/src/tokens/functional/color/borderColor.json5> | source="{base.color.red.4}" alpha=0.4 resolved={"colorSpace": "hsl", "components": [2.7, 92.6, 62.9], "hex": "#f85149 |
| token borderColor.translucent [primitives-theme-light] | token-value | raw={"alpha": 0.15, "value": "{base.color.neutral.13}"} | CONFIRMED | <https://cdn.jsdelivr.net/npm/@primer/primitives@11.10.0/src/tokens/functional/color/borderColor.json5> | source="{base.color.neutral.13}" alpha=0.15 resolved={"colorSpace": "hsl", "components": [213.3, 12.7, 13.9], "hex": "#1f23 |
| token display.yellow.scale.7 [primitives-theme-light] | token-value | raw="{base.display.color.yellow.7}" | CONFIRMED | <https://cdn.jsdelivr.net/npm/@primer/primitives@11.10.0/src/tokens/functional/color/display.json5> | source="{base.display.color.yellow.7}" alpha=None resolved={"colorSpace": "hsl", "components": [41.3, 100, 22], "hex": "#704d00"} |
| token base.color.purple.7 [primitives-base-color-dark] | token-value | raw={"hex": "#553098", "colorSpace": "hsl", "components": [261.3 | CONFIRMED | <https://cdn.jsdelivr.net/npm/@primer/primitives@11.10.0/src/tokens/base/color/dark/dark.json5> | source={"colorSpace": "hsl", "components": [261.3, 52, 39.2], "hex" alpha=None resolved={"colorSpace": "hsl", "components": [261.3, 52, 39.2], "hex": "#553098 |
| token sets | license | license MIT / redistribution permitted | CONFIRMED | <https://registry.npmjs.org/@primer/primitives/11.10.0> | npm license field: MIT |
| Autocomplete | g-random | responsive = not-documented | CONFIRMED | <https://primer.style/product/components/autocomplete/> | 'Responsive' only in site navigation |
| DataTable | g-random | variants = not-documented | **REFUTED** -> fixed | <https://primer.style/product/components/data-table/> | same claim as the targeted check: cellPadding density |
| ActionBar | g-random | states = not-documented | **REFUTED** -> fixed | <https://cdn.jsdelivr.net/npm/@primer/react@38.44.0/generated/components.json> | ActionBar.IconButton.disabled and ActionBar.Button.disabled (boolean) are published as ActionBar properties |
| Tooltip | g-random | states = not-documented | CONFIRMED | <https://cdn.jsdelivr.net/npm/@primer/react@38.44.0/generated/components.json> | props direction/text/type/keybindingHint/delay |
| SplitPageLayout | g-random | accessibility = not-documented | CONFIRMED | <https://primer.style/product/components/split-page-layout/accessibility/> | no accessibility page (redirects home) |
| SelectPanel | g-random | sizes = not-documented | CONFIRMED | <https://cdn.jsdelivr.net/npm/@primer/react@38.44.0/generated/components.json> | no size/width/height prop |
| Truncate | g-after | keyboard = not-documented | CONFIRMED | <https://primer.style/product/components/truncate/accessibility/> | no key interaction; the page states there is no keyboard mechanism for the title tooltip |
| UnderlineNav | g-after | sizes = not-documented | CONFIRMED | <https://cdn.jsdelivr.net/npm/@primer/react@38.44.0/generated/components.json> | props aria-label/children/loadingCounters/hideIconsBreakpoint/variant |

### carbon

| Subject | Check | Claim | Verdict | Evidence | Note |
|---|---|---|---|---|---|
| Radio button | a-exists | component named 'Radio button' exists | CONFIRMED | <https://www.carbondesignsystem.com/building-blocks/core/components/radio-button/guidelines> |  |
| Radio button | b-docsUrl | docsUrl resolves to the component page | CONFIRMED | <https://www.carbondesignsystem.com/building-blocks/core/components/radio-button/guidelines> |  |
| Radio button | f-description | description (119 chars) | CONFIRMED | <https://www.carbondesignsystem.com/building-blocks/core/components/radio-button/guidelines> |  |
| Radio button | c-states | states Error/Selected/Unselected/Focus | CONFIRMED | <https://raw.githubusercontent.com/carbon-design-system/carbon-website/main/src/pages/components/radio-button/style.mdx> |  |
| Radio button | d-prop | React defaultChecked: bool | CONFIRMED | <https://cdn.jsdelivr.net/npm/@carbon/react@1.120.0/lib/components/RadioButton/RadioButton.js> |  |
| Radio button | d-prop | React disabled: bool = false | CONFIRMED | <https://cdn.jsdelivr.net/npm/@carbon/react@1.120.0/lib/components/RadioButton/RadioButton.js> |  |
| Radio button | d-prop | React className: string | CONFIRMED | <https://cdn.jsdelivr.net/npm/@carbon/react@1.120.0/lib/components/RadioButton/RadioButton.js> |  |
| Radio button | e-keyboard | Arrow keys change selection | CONFIRMED | <https://www.carbondesignsystem.com/building-blocks/core/components/radio-button/accessibility> |  |
| Radio button | e-keyboard | Tab moves focus out of group | CONFIRMED | <https://www.carbondesignsystem.com/building-blocks/core/components/radio-button/accessibility> |  |
| Radio button | e-keyboard | Up/Down navigate inputs (usage tab) | CONFIRMED | <https://www.carbondesignsystem.com/building-blocks/core/components/radio-button/guidelines> |  |
| Radio button | e-ariaPattern | ariaPattern radiobutton (APG link) | CONFIRMED | <https://raw.githubusercontent.com/carbon-design-system/carbon-website/main/src/pages/components/radio-button/accessibility.mdx> |  |
| Radio button | g-coverage | a11y.screenReader = not-documented | **REFUTED** -> fixed | <https://www.carbondesignsystem.com/building-blocks/core/components/radio-button/accessibility> | 'Labeling and states' section documents screen-reader output (JAWS) - adapter only recognises a section titled 'Screen reader' |
| Radio button | g-coverage | variants = not-documented | **REFUTED** -> fixed | <https://www.carbondesignsystem.com/building-blocks/core/components/radio-button/guidelines> | 'AI presence' section documents 'The AI variant'; no Variants table (minor) |
| Multiselect | a-exists | component named 'Multiselect' exists | CONFIRMED | <https://www.carbondesignsystem.com/building-blocks/core/components/dropdown/guidelines> |  |
| Multiselect | b-docsUrl | docsUrl resolves to the component page | CONFIRMED | <https://www.carbondesignsystem.com/building-blocks/core/components/dropdown/guidelines> |  |
| Multiselect | f-description | description (66 chars, variants table row) | CONFIRMED | <https://www.carbondesignsystem.com/building-blocks/core/components/dropdown/guidelines> |  |
| Multiselect | d-prop | WC cds-multi-select isFluid: boolean = false | CONFIRMED | <https://cdn.jsdelivr.net/npm/@carbon/web-components@2.67.0/custom-elements.json> |  |
| Multiselect | d-prop | WC cds-multi-select filterable: None | CONFIRMED | <https://cdn.jsdelivr.net/npm/@carbon/web-components@2.67.0/custom-elements.json> |  |
| Multiselect | d-prop | React itemToString: func | CONFIRMED | <https://cdn.jsdelivr.net/npm/@carbon/react@1.120.0/lib/components/MultiSelect/MultiSelect.js> |  |
| Multiselect | e-keyboard | Down/Enter/Space open multiselect | CONFIRMED | <https://www.carbondesignsystem.com/building-blocks/core/components/dropdown/accessibility> |  |
| Multiselect | e-keyboard | focus moves to list only if selected / opened with Down | CONFIRMED | <https://www.carbondesignsystem.com/building-blocks/core/components/dropdown/accessibility> |  |
| Multiselect | e-keyboard | Esc closes multiselect | CONFIRMED | <https://www.carbondesignsystem.com/building-blocks/core/components/dropdown/accessibility> |  |
| Pagination | a-exists | component named 'Pagination' exists | CONFIRMED | <https://www.carbondesignsystem.com/building-blocks/core/components/pagination/guidelines> |  |
| Pagination | b-docsUrl | docsUrl resolves to the component page | CONFIRMED | <https://www.carbondesignsystem.com/building-blocks/core/components/pagination/guidelines> |  |
| Pagination | f-description | description (113 chars) | CONFIRMED | <https://www.carbondesignsystem.com/building-blocks/core/components/pagination/guidelines> |  |
| Pagination | c-sizes | sizes Large (lg)/Medium (md)/Small (sm) | CONFIRMED | <https://raw.githubusercontent.com/carbon-design-system/carbon-website/main/src/pages/components/pagination/style.mdx> |  |
| Pagination | c-states | states Disabled/Selected/Focus/Hover | CONFIRMED | <https://raw.githubusercontent.com/carbon-design-system/carbon-website/main/src/pages/components/pagination/style.mdx> |  |
| Pagination | c-variants | variants Pagination / Pagination nav | CONFIRMED | <https://www.carbondesignsystem.com/building-blocks/core/components/pagination/guidelines> |  |
| Pagination | d-prop | React renderPageSelect: func | CONFIRMED | <https://cdn.jsdelivr.net/npm/@carbon/react@1.120.0/lib/components/Pagination/Pagination.js> |  |
| Pagination | d-prop | WC cds-pagination page: number = 1 | CONFIRMED | <https://cdn.jsdelivr.net/npm/@carbon/web-components@2.67.0/custom-elements.json> |  |
| Pagination | d-prop | WC cds-pagination total-items: number | CONFIRMED | <https://cdn.jsdelivr.net/npm/@carbon/web-components@2.67.0/custom-elements.json> |  |
| Pagination | e-keyboard | selects opened with Space/Up/Down | CONFIRMED | <https://www.carbondesignsystem.com/building-blocks/core/components/pagination/accessibility> |  |
| Pagination | e-keyboard | Space/Enter select value | CONFIRMED | <https://www.carbondesignsystem.com/building-blocks/core/components/pagination/accessibility> |  |
| Pagination | e-keyboard | Esc closes select | CONFIRMED | <https://www.carbondesignsystem.com/building-blocks/core/components/pagination/accessibility> |  |
| Pagination | g-coverage | a11y.ariaPattern = not-documented | **REFUTED** -> fixed | <https://www.carbondesignsystem.com/building-blocks/core/components/pagination/accessibility> | links APG combobox select-only example; adapter regex only matches /apg/patterns/<x>/ |
| Tile | a-exists | component named 'Tile' exists | CONFIRMED | <https://www.carbondesignsystem.com/building-blocks/core/components/tile/guidelines> |  |
| Tile | b-docsUrl | docsUrl resolves to the component page | CONFIRMED | <https://www.carbondesignsystem.com/building-blocks/core/components/tile/guidelines> |  |
| Tile | f-description | description (151 chars) vs evidence usage.mdx frontmatter | CONFIRMED | <https://raw.githubusercontent.com/carbon-design-system/carbon-website/main/src/pages/components/tile/usage.mdx> | live page lead was rewritten ('Tiles are flexible containers...'): source drift between carbon-website MDX and live site  |
| Tile | c-variants | variants Base/Clickable/Expandable/Selectable | CONFIRMED | <https://raw.githubusercontent.com/carbon-design-system/carbon-website/main/src/pages/components/tile/usage.mdx> |  |
| Tile | c-states | states Focus/Hover/Selected/Enabled | CONFIRMED | <https://raw.githubusercontent.com/carbon-design-system/carbon-website/main/src/pages/components/tile/style.mdx> |  |
| Tile | d-prop | React light: bool = false | CONFIRMED | <https://cdn.jsdelivr.net/npm/@carbon/react@1.120.0/lib/components/Tile/Tile.js> |  |
| Tile | d-prop | React children: node | CONFIRMED | <https://cdn.jsdelivr.net/npm/@carbon/react@1.120.0/lib/components/Tile/Tile.js> |  |
| Tile | d-prop | WC cds-tile color-scheme: FORM_ELEMENT_COLOR_SCHEME = "" | CONFIRMED | <https://cdn.jsdelivr.net/npm/@carbon/web-components@2.67.0/custom-elements.json> |  |
| Tile | e-keyboard | Tab between actionable elements (non-interactive tiles) | CONFIRMED | <https://www.carbondesignsystem.com/building-blocks/core/components/tile/accessibility> |  |
| Tile | e-keyboard | Tab between interactive tiles | CONFIRMED | <https://www.carbondesignsystem.com/building-blocks/core/components/tile/accessibility> |  |
| Tile | g-coverage | a11y.ariaPattern = not-documented | **REFUTED** -> fixed | <https://www.carbondesignsystem.com/building-blocks/core/components/tile/accessibility> | links w3c.github.io/aria-practices/#tooltip (unmatched URL form) - minor |
| Select | a-exists | component named 'Select' exists | CONFIRMED | <https://www.carbondesignsystem.com/building-blocks/core/components/select/guidelines> |  |
| Select | b-docsUrl | docsUrl resolves to the component page | CONFIRMED | <https://www.carbondesignsystem.com/building-blocks/core/components/select/guidelines> |  |
| Select | f-description | description (113 chars) vs evidence usage.mdx frontmatter | CONFIRMED | <https://raw.githubusercontent.com/carbon-design-system/carbon-website/main/src/pages/components/select/usage.mdx> | live page lead differs: source drift  |
| Select | c-sizes | sizes Small/Medium/Large/Default(fluid) | CONFIRMED | <https://raw.githubusercontent.com/carbon-design-system/carbon-website/main/src/pages/components/select/style.mdx> |  |
| Select | c-variants | variants Default / Inline select | CONFIRMED | <https://raw.githubusercontent.com/carbon-design-system/carbon-website/main/src/pages/components/select/usage.mdx> |  |
| Select | c-states | states Disabled/Warning/Selected/Focus | CONFIRMED | <https://www.carbondesignsystem.com/building-blocks/core/components/select/guidelines> |  |
| Select | d-prop | WC cds-select warn: boolean = false | CONFIRMED | <https://cdn.jsdelivr.net/npm/@carbon/web-components@2.67.0/custom-elements.json> |  |
| Select | d-prop | React warn: bool = false | CONFIRMED | <https://cdn.jsdelivr.net/npm/@carbon/react@1.120.0/lib/components/Select/Select.js> |  |
| Select | d-prop | WC cds-select hide-label: boolean = false | CONFIRMED | <https://cdn.jsdelivr.net/npm/@carbon/web-components@2.67.0/custom-elements.json> |  |
| Select | e-keyboard | reached by Tab, opened with Space/Up/Down | CONFIRMED | <https://www.carbondesignsystem.com/building-blocks/core/components/select/accessibility> |  |
| Select | e-keyboard | arrow keys navigate options | CONFIRMED | <https://www.carbondesignsystem.com/building-blocks/core/components/select/accessibility> |  |
| Select | e-keyboard | Space/Enter select & close | CONFIRMED | <https://www.carbondesignsystem.com/building-blocks/core/components/select/accessibility> |  |
| Heading | a-exists | component 'Heading' exists (components.json, overview:false) | CONFIRMED | <https://raw.githubusercontent.com/carbon-design-system/carbon-website/main/src/data/components.json> |  |
| Heading | b-docsUrl | docsUrl null (no docs page) | CONFIRMED | <https://raw.githubusercontent.com/carbon-design-system/carbon-website/main/src/data/components.json> | components.json marks overview:false; no page |
| Heading | d-prop | React className: string | CONFIRMED | <https://cdn.jsdelivr.net/npm/@carbon/react@1.120.0/lib/components/Heading/index.js> |  |
| Heading | d-prop | React children: node | CONFIRMED | <https://cdn.jsdelivr.net/npm/@carbon/react@1.120.0/lib/components/Heading/index.js> |  |
| pattern Text toolbar | pattern-exists | pattern 'Text toolbar' exists at docsUrl | CONFIRMED | <https://www.carbondesignsystem.com/building-blocks/core/patterns/text-toolbar> | title: Text toolbar \| Carbon Design System |
| pattern Text toolbar | pattern-description | description excerpt (124 chars) | CONFIRMED | <https://www.carbondesignsystem.com/building-blocks/core/patterns/text-toolbar> | matches evidence MDX frontmatter; live page lead was rewritten (source drift) |
| pattern Disclosures | pattern-exists | pattern 'Disclosures' exists at docsUrl | CONFIRMED | <https://www.carbondesignsystem.com/building-blocks/core/patterns/disclosures> | title: Disclosures \| Carbon Design System |
| pattern Disclosures | pattern-description | description excerpt (124 chars) | CONFIRMED | <https://www.carbondesignsystem.com/building-blocks/core/patterns/disclosures> | matches evidence MDX frontmatter; live page lead was rewritten (source drift) |
| pattern Forms | pattern-exists | pattern 'Forms' exists at docsUrl | CONFIRMED | <https://www.carbondesignsystem.com/building-blocks/core/patterns/forms> | title: Forms \| Carbon Design System |
| pattern Forms | pattern-description | description excerpt (241 chars) | CONFIRMED | <https://www.carbondesignsystem.com/building-blocks/core/patterns/forms> | matches evidence MDX frontmatter; live page lead was rewritten (source drift) |
| pattern Forms | pattern-classification | inferred type forms | CONFIRMED | <https://www.carbondesignsystem.com/building-blocks/core/patterns/forms> | heuristic, labelled inferred |
| system | latest_version | latest_version 1.120.0 (@carbon/react) | CONFIRMED | <https://registry.npmjs.org/@carbon/react/latest> | npm latest=1.120.0 |
| system | principles | principles: Carbon is open; Carbon is inclusive; Carbon is modular and flexible; Carbon puts the user first; C | CONFIRMED | <https://raw.githubusercontent.com/carbon-design-system/carbon-website/main/src/pages/all-about-carbon/what-is-carbon.mdx> |  |
| system | philosophy | quoted description of Carbon | CONFIRMED | <https://raw.githubusercontent.com/carbon-design-system/carbon-website/main/src/pages/all-about-carbon/what-is-carbon.mdx> |  |
| token surface.invoke [motion] | token-value | raw={"delay": {"unit": "ms", "value": 0}, "duration": "{duration resolved=240ms cubic-bezier(0.4, 0.14, 0.3, 1 | CONFIRMED | <https://cdn.jsdelivr.net/npm/@carbon/motion@11.56.0/tokens/surfaces.tokens.json> | source $value={"duration": "{duration.moderate.02}", "delay": {"value": 0, "unit": "ms"}, "timingFunction": "{easi |
| token content-switcher-background [theme-white] | token-value | raw="{gray.20}" resolved=#e0e0e0 | CONFIRMED | <https://cdn.jsdelivr.net/npm/@carbon/themes@11.85.0/tokens/themes/white/content-switcher.tokens.json> | source $value="{gray.20}"; alias gray.20 -> palette #e0e0e0 |
| token tag-border-blue [theme-g100] | token-value | raw="{blue.50}" resolved=#4589ff | CONFIRMED | <https://cdn.jsdelivr.net/npm/@carbon/themes@11.85.0/tokens/themes/g100/tag.tokens.json> | source $value="{blue.50}"; alias blue.50 -> palette #4589ff |
| token button-tertiary-active [theme-g90] | token-value | raw="{gray.30}" resolved=#c6c6c6 | CONFIRMED | <https://cdn.jsdelivr.net/npm/@carbon/themes@11.85.0/tokens/themes/g90/button.tokens.json> | source $value="{gray.30}"; alias gray.30 -> palette #c6c6c6 |
| token tag-background-cool-gray [theme-g90] | token-value | raw="{coolGray.70}" resolved=#4d5358 | CONFIRMED | <https://cdn.jsdelivr.net/npm/@carbon/themes@11.85.0/tokens/themes/g90/tag.tokens.json> | source $value="{coolGray.70}"; alias coolGray.70 -> palette #4d5358 |
| token syntax-float [theme-white] | token-value | raw="{green.60}" resolved=#198038 | CONFIRMED | <https://cdn.jsdelivr.net/npm/@carbon/themes@11.85.0/tokens/themes/white/theme.tokens.json> | source $value="{green.60}"; alias green.60 -> palette #198038 |
| token syntax-invalid [theme-g10] | token-value | raw="{red.60}" resolved=#da1e28 | CONFIRMED | <https://cdn.jsdelivr.net/npm/@carbon/themes@11.85.0/tokens/themes/g10/theme.tokens.json> | source $value="{red.60}"; alias red.60 -> palette #da1e28 |
| token border-subtle-02 [theme-g90] | token-value | raw="{gray.50}" resolved=#8d8d8d | CONFIRMED | <https://cdn.jsdelivr.net/npm/@carbon/themes@11.85.0/tokens/themes/g90/theme.tokens.json> | source $value="{gray.50}"; alias gray.50 -> palette #8d8d8d |
| token syntax-literal [theme-g100] | token-value | raw="{gray.10}" resolved=#f4f4f4 | CONFIRMED | <https://cdn.jsdelivr.net/npm/@carbon/themes@11.85.0/tokens/themes/g100/theme.tokens.json> | source $value="{gray.10}"; alias gray.10 -> palette #f4f4f4 |
| token yellow.80 [palette] | token-value | raw={"hex": "#483700", "colorSpace": "srgb", "components": [0.28 resolved=#483700 | CONFIRMED | <https://cdn.jsdelivr.net/npm/@carbon/colors@11.62.0/tokens/colors.tokens.json> | source $value={"colorSpace": "srgb", "components": [0.282353, 0.215686, 0], "hex": "#483700"} |
| token sets | license | license Apache-2.0 / redistribution permitted | CONFIRMED | <https://registry.npmjs.org/@carbon/themes/11.85.0> | npm license field: Apache-2.0 |
| Radio button | g-random | a11y.focusManagement = not-documented | **REFUTED** -> fixed | <https://www.carbondesignsystem.com/building-blocks/core/components/radio-button/accessibility> | 'A group of radio buttons takes a single tab stop ... Pressing Tab again will move focus out of the radio button group' |
| Pagination | g-random | a11y.ariaPattern = not-documented | **REFUTED** -> fixed | <https://www.carbondesignsystem.com/building-blocks/core/components/pagination/accessibility> | same claim as the targeted check: APG combobox select-only link |
| Tile | g-random | a11y.focusManagement = not-documented | **REFUTED** -> fixed | <https://www.carbondesignsystem.com/building-blocks/core/components/tile/accessibility> | 'When tabbing through these tiles, a focus indicator appears around the currently selected tile' |
| Select | g-random | a11y.focusManagement = not-documented | **REFUTED** -> fixed | <https://www.carbondesignsystem.com/building-blocks/core/components/select/accessibility> | 'The currently selected option will have focus' |
| Tooltip | g-after | variants = not-documented | CONFIRMED | <https://www.carbondesignsystem.com/building-blocks/core/components/tooltip/guidelines> | usage.mdx: 'updated the guidance to no longer call out standard and icon button tooltips as separate variants' |
| Slider | g-after | a11y.focusManagement = not-documented | CONFIRMED | <https://www.carbondesignsystem.com/building-blocks/core/components/slider/accessibility> | no focus discussion in the accessibility tab |

### material-web

| Subject | Check | Claim | Verdict | Evidence | Note |
|---|---|---|---|---|---|
| Chip set | a-exists | component named 'Chip' exists | CONFIRMED | <https://material-web.dev/components/chip/> |  |
| Chip set | b-docsUrl | docsUrl resolves to the component page | CONFIRMED | <https://material-web.dev/components/chip/> |  |
| Chip set | d-prop | chips: Chip[] = undefined | CONFIRMED | <https://github.com/material-components/material-web/blob/v2.5.0/docs/components/chip.md> |  |
| Chip set | f-description | description 'A chip set component.' | CONFIRMED | <https://cdn.jsdelivr.net/npm/@material/web@2.5.0/custom-elements.json> | text is the internal ChipSet superclass doc (chips/internal/chip-set.js) |
| Chip set | evidence-location | description evidence location custom-elements.json#/modules/26/declarations/0 | **REFUTED** -> fixed | <https://cdn.jsdelivr.net/npm/@material/web@2.5.0/custom-elements.json> | that pointer (MdChipSet) holds 'TODO(b/243982145): add docs'; the excerpt comes from the superclass declaration (chips/internal/chip-set.js) |
| Floating action buttons (FAB) | a-exists | component named 'Floating action buttons' exists | CONFIRMED | <https://material-web.dev/components/fab/> |  |
| Floating action buttons (FAB) | b-docsUrl | docsUrl resolves to the component page | CONFIRMED | <https://material-web.dev/components/fab/> |  |
| Floating action buttons (FAB) | f-description | description = first intro sentence (markdown links stripped) | CONFIRMED | <https://github.com/material-components/material-web/blob/v2.5.0/docs/components/fab.md> |  |
| Floating action buttons (FAB) | d-prop | label: string = '' | CONFIRMED | <https://github.com/material-components/material-web/blob/v2.5.0/docs/components/fab.md> |  |
| Floating action buttons (FAB) | d-prop | variant: FabVariant = 'surface' | CONFIRMED | <https://github.com/material-components/material-web/blob/v2.5.0/docs/components/fab.md> |  |
| Floating action buttons (FAB) | d-prop | size: FabSize = 'medium' | CONFIRMED | <https://github.com/material-components/material-web/blob/v2.5.0/docs/components/fab.md> |  |
| Floating action buttons (FAB) | c-variants | types FAB / Small FAB / Large FAB / Branded FAB | CONFIRMED | <https://raw.githubusercontent.com/material-components/material-web/v2.5.0/docs/components/fab.md> |  |
| Floating action buttons (FAB) | e-guidance | a11y: icon-only FABs need aria-label | CONFIRMED | <https://raw.githubusercontent.com/material-components/material-web/v2.5.0/docs/components/fab.md> |  |
| Floating action buttons (FAB) | g-coverage | sizes = not-documented | **REFUTED** -> fixed | <https://github.com/material-components/material-web/blob/v2.5.0/docs/components/fab.md#sizes> | '### Sizes: FABs may be small, medium (default), or large by setting the size attribute'; size prop type is the alias FabSize so the adapter found no literal union |
| Progress indicators | a-exists | component named 'Progress indicators' exists | CONFIRMED | <https://material-web.dev/components/progress/> |  |
| Progress indicators | b-docsUrl | docsUrl resolves to the component page | CONFIRMED | <https://material-web.dev/components/progress/> |  |
| Progress indicators | f-description | description = first intro sentence (markdown links stripped) | CONFIRMED | <https://github.com/material-components/material-web/blob/v2.5.0/docs/components/progress.md> |  |
| Progress indicators | d-prop | indeterminate: boolean = false | CONFIRMED | <https://github.com/material-components/material-web/blob/v2.5.0/docs/components/progress.md> |  |
| Progress indicators | d-prop | buffer: number = 0 | CONFIRMED | <https://github.com/material-components/material-web/blob/v2.5.0/docs/components/progress.md> |  |
| Progress indicators | d-prop | fourColor: boolean = false | CONFIRMED | <https://github.com/material-components/material-web/blob/v2.5.0/docs/components/progress.md> |  |
| Progress indicators | c-variants | types Circular / Linear progress | CONFIRMED | <https://raw.githubusercontent.com/material-components/material-web/v2.5.0/docs/components/progress.md> |  |
| Progress indicators | e-guidance | a11y: add aria-label | CONFIRMED | <https://raw.githubusercontent.com/material-components/material-web/v2.5.0/docs/components/progress.md> |  |
| Badge | a-exists | <md-badge> MdBadge in CEM (labs) | CONFIRMED | <https://cdn.jsdelivr.net/npm/@material/web@2.5.0/custom-elements.json> |  |
| Badge | lifecycle | lifecycle experimental (labs README warning) | CONFIRMED | <https://raw.githubusercontent.com/material-components/material-web/v2.5.0/labs/README.md> |  |
| Badge | g-coverage | description/docs = not-documented (no docs page) | CONFIRMED | <https://cdn.jsdelivr.net/npm/@material/web@2.5.0/custom-elements.json> | no docs/components/badge.md at v2.5.0; CEM description empty, superclass 'b/265340196 - add docs' |
| Navigation tab | a-exists | <md-navigation-tab> in CEM (labs) | CONFIRMED | <https://cdn.jsdelivr.net/npm/@material/web@2.5.0/custom-elements.json> |  |
| Navigation tab | d-prop | hideInactiveLabel: boolean = false | CONFIRMED | <https://cdn.jsdelivr.net/npm/@material/web@2.5.0/custom-elements.json> |  |
| Navigation tab | d-prop | label: string | CONFIRMED | <https://cdn.jsdelivr.net/npm/@material/web@2.5.0/custom-elements.json> | {'kind': 'field', 'name': 'label', 'privacy': 'public', 'type': {'text': 'string'}, 'attribute': 'label'} |
| Navigation tab | d-prop | buttonElement: HTMLElement | CONFIRMED | <https://cdn.jsdelivr.net/npm/@material/web@2.5.0/custom-elements.json> | {'kind': 'field', 'name': 'buttonElement', 'privacy': 'public', 'type': {'text': 'HTMLElement', 'references': [{'name':  |
| Sliders | a-exists | component named 'Sliders' exists | CONFIRMED | <https://material-web.dev/components/slider/> |  |
| Sliders | b-docsUrl | docsUrl resolves to the component page | CONFIRMED | <https://material-web.dev/components/slider/> |  |
| Sliders | f-description | description = first intro sentence (markdown links stripped) | CONFIRMED | <https://github.com/material-components/material-web/blob/v2.5.0/docs/components/slider.md> |  |
| Sliders | d-prop | ariaLabelStart: string = '' | CONFIRMED | <https://github.com/material-components/material-web/blob/v2.5.0/docs/components/slider.md> |  |
| Sliders | d-prop | max: number = 100 | CONFIRMED | <https://github.com/material-components/material-web/blob/v2.5.0/docs/components/slider.md> |  |
| Sliders | d-prop | valueLabelEnd: string = '' | CONFIRMED | <https://github.com/material-components/material-web/blob/v2.5.0/docs/components/slider.md> |  |
| Sliders | g-coverage | variants = not-documented | **REFUTED** -> fixed | <https://github.com/material-components/material-web/blob/v2.5.0/docs/components/slider.md#usage> | Usage documents Continuous / Discrete / Range sliders; adapter only reads a '## Types' section |
| system | latest_version | latest_version 2.5.0 (@material/web) | CONFIRMED | <https://registry.npmjs.org/@material/web/latest> | npm latest=2.5.0 |
| token sets | license | license Apache-2.0 / redistribution permitted | CONFIRMED | <https://registry.npmjs.org/@material/web/2.5.0> | npm license field: Apache-2.0 |
| token md.comp.fab-surface-small.container-shape [mw-component-tokens] | token-value | raw="{md.sys.shape.corner-medium}" resolved=12px | CONFIRMED | <https://raw.githubusercontent.com/material-components/material-web/v2.5.0/tokens/versions/v0_192/_md-comp-fab-surface-small.scss#L38> | L38: 'container-shape': map.get($deps, 'md-sys-shape', 'corner-medium'),     'container-width': if($exclude-hardcod |
| token md.comp.outlined-select.text-field-hover-input-text-color [mw-co | token-value | raw="{md.sys.color.on-surface}" resolved=mw-sys-color-dark: #e6e0e9 · mw-sys-color-light: #1d1b20 | CONFIRMED | <https://raw.githubusercontent.com/material-components/material-web/v2.5.0/tokens/versions/v0_192/_md-comp-outlined-select.scss#L162> | L162: 'text-field-hover-input-text-color':       map.get($deps, 'md-sys-color', 'on-surface'),; mw-sys-color-dark: on-surface -> neutral90 -> #e6e0e9; mw-sys-color-light: on-surface -> neutral10 -> #1d1b20 |
| token md.comp.icon-button.selected-pressed-state-layer-color [mw-compo | token-value | raw="{md.sys.color.primary}" resolved=mw-sys-color-dark: #d0bcff · mw-sys-color-light: #6750a4 | CONFIRMED | <https://raw.githubusercontent.com/material-components/material-web/v2.5.0/tokens/versions/v0_192/_md-comp-icon-button.scss#L46> | L46: 'selected-pressed-state-layer-color':       map.get($deps, 'md-sys-color', 'primary'),; mw-sys-color-dark: primary -> primary80 -> #d0bcff; mw-sys-color-light: primary -> primary40 -> #6750a4 |
| token md.sys.typescale.title-large-font [mw-sys-typescale] | token-value | raw="{md.ref.typeface.brand}" resolved=Roboto | CONFIRMED | <https://raw.githubusercontent.com/material-components/material-web/v2.5.0/tokens/versions/v0_192/_md-sys-typescale.scss#L246> | L246: 'title-large-font': map.get($deps, 'md-ref-typeface', 'brand'),     'title-large-line-height': if($exclude-har |
| token md.comp.assist-chip.with-icon-icon-size [mw-component-tokens] | token-value | raw="18px" resolved=18px | CONFIRMED | <https://raw.githubusercontent.com/material-components/material-web/v2.5.0/tokens/versions/v0_192/_md-comp-assist-chip.scss#L108> | L108: 'with-icon-icon-size': if($exclude-hardcoded-values, null, 18px),     'with-icon-pressed-icon-color': map.get( |
| token md.sys.color.surface [mw-sys-color-light] | token-value | raw="{md.ref.palette.neutral98}" resolved=#fef7ff | CONFIRMED | <https://raw.githubusercontent.com/material-components/material-web/v2.5.0/tokens/versions/v0_192/_md-sys-color.scss#L120> | L120: 'surface': map.get($deps, 'md-ref-palette', 'neutral98'),     'surface-bright': map.get($deps, 'md-ref-palette |
| token md.comp.suggestion-chip.pressed-label-text-color [mw-component-t | token-value | raw="{md.sys.color.on-surface-variant}" resolved=mw-sys-color-dark: #cac4d0 · mw-sys-color-light: #49454f | CONFIRMED | <https://raw.githubusercontent.com/material-components/material-web/v2.5.0/tokens/versions/v0_192/_md-comp-suggestion-chip.scss#L104> | L104: 'pressed-label-text-color':       map.get($deps, 'md-sys-color', 'on-surface-variant'),; mw-sys-color-dark: on-surface-variant -> neutral-variant80 -> #cac4d0; mw-sys-color-light: on-surface-variant -> neutral-vari |
| token md.comp.secondary-navigation-tab.inactive-label-text-color [mw-c | token-value | raw="{md.sys.color.on-surface-variant}" resolved=mw-sys-color-dark: #cac4d0 · mw-sys-color-light: #49454f | CONFIRMED | <https://raw.githubusercontent.com/material-components/material-web/v2.5.0/tokens/versions/v0_192/_md-comp-secondary-navigation-tab.scss#L53> | L53: 'inactive-label-text-color':       map.get($deps, 'md-sys-color', 'on-surface-variant'),; mw-sys-color-dark: on-surface-variant -> neutral-variant80 -> #cac4d0; mw-sys-color-light: on-surface-variant -> neutral-vari |
| token md.ref.palette.neutral12 [mw-ref-palette] | token-value | raw="#211f26" resolved=#211f26 | CONFIRMED | <https://raw.githubusercontent.com/material-components/material-web/v2.5.0/tokens/versions/v0_192/_md-ref-palette.scss#L47> | L47: 'neutral12': if($exclude-hardcoded-values, null, #211f26),     'neutral17': if($exclude-hardcoded-values, null |
| token md.comp.outlined-segmented-button.focus-state-layer-opacity [mw- | token-value | raw="{md.sys.state.focus-state-layer-opacity}" resolved=0.12 | CONFIRMED | <https://raw.githubusercontent.com/material-components/material-web/v2.5.0/tokens/versions/v0_192/_md-comp-outlined-segmented-button.scss#L41> | L41: 'focus-state-layer-opacity':       map.get($deps, 'md-sys-state', 'focus-state-layer-opacity'), |
| Chip set | g-random | states = not-documented | CONFIRMED | <https://github.com/material-components/material-web/blob/v2.5.0/docs/components/chip.md> | only the chips property |
| Floating action buttons (FAB) | g-random | keyboard = not-documented | CONFIRMED | <https://github.com/material-components/material-web/blob/v2.5.0/docs/components/fab.md> | no keyboard section |
| Progress indicators | g-random | keyboard = not-documented | CONFIRMED | <https://github.com/material-components/material-web/blob/v2.5.0/docs/components/progress.md> | no keyboard section |
| Badge | g-random | responsive = not-documented | CONFIRMED | <https://cdn.jsdelivr.net/npm/@material/web@2.5.0/custom-elements.json> | labs element without docs |
| Navigation tab | g-random | sizes = not-documented | CONFIRMED | <https://cdn.jsdelivr.net/npm/@material/web@2.5.0/custom-elements.json> | labs element without docs |
| Sliders | g-random | variants = not-documented | **REFUTED** -> fixed | <https://github.com/material-components/material-web/blob/v2.5.0/docs/components/slider.md> | same claim as the targeted check: Continuous / Discrete / Range |
| Switch | g-after | sizes = not-documented | CONFIRMED | <https://github.com/material-components/material-web/blob/v2.5.0/docs/components/switch.md> | no sizes |
| Navigation drawer | g-after | accessibility = not-documented | CONFIRMED | <https://cdn.jsdelivr.net/npm/@material/web@2.5.0/custom-elements.json> | labs element without docs |

### material-design

| Subject | Check | Claim | Verdict | Evidence | Note |
|---|---|---|---|---|---|
| Dialogs | a-exists | M3 page titled 'Dialogs' | CONFIRMED | <https://m3.material.io/components/dialogs/overview> | Dialogs – Material Design 3 |
| Dialogs | b-docsUrl | docsUrl resolves (200, M3 SPA shell with title/meta) | CONFIRMED | <https://m3.material.io/components/dialogs/overview> | body content is client-rendered; title + meta description are server-rendered |
| Dialogs | f-description | description = <meta name=description> (99 chars) | CONFIRMED | <https://m3.material.io/components/dialogs/overview> |  |
| Dialogs | c-states | states Hovered/Focused/Enabled (inferred from token group labels) | CONFIRMED | <https://raw.githubusercontent.com/material-components/material-web/v2.5.0/tokens/versions/latest/sass/_md-comp-dialog.scss> | labelled inferred in coverage |
| Extended FAB | a-exists | M3 page titled 'Extended FAB' | CONFIRMED | <https://m3.material.io/components/extended-fab/overview> | Extended FAB – Material Design 3 |
| Extended FAB | b-docsUrl | docsUrl resolves (200, M3 SPA shell with title/meta) | CONFIRMED | <https://m3.material.io/components/extended-fab/overview> | body content is client-rendered; title + meta description are server-rendered |
| Extended FAB | f-description | description = <meta name=description> (199 chars) | CONFIRMED | <https://m3.material.io/components/extended-fab/overview> |  |
| Extended FAB | c-states | states Enabled/Hovered/Focused/Pressed (inferred from token group labels) | CONFIRMED | <https://raw.githubusercontent.com/material-components/material-web/v2.5.0/tokens/versions/latest/sass/_md-comp-extended-fab-primary.scss> | labelled inferred in coverage |
| Tabs | a-exists | M3 page titled 'Tabs' | CONFIRMED | <https://m3.material.io/components/tabs/overview> | Tabs – Material Design 3 |
| Tabs | b-docsUrl | docsUrl resolves (200, M3 SPA shell with title/meta) | CONFIRMED | <https://m3.material.io/components/tabs/overview> | body content is client-rendered; title + meta description are server-rendered |
| Tabs | f-description | description = <meta name=description> (133 chars) | CONFIRMED | <https://m3.material.io/components/tabs/overview> |  |
| Tabs | c-states | states Enabled/Hovered/Focused (inferred from token group labels) | CONFIRMED | <https://raw.githubusercontent.com/material-components/material-web/v2.5.0/tokens/versions/latest/sass/_md-comp-primary-navigation-tab.scss> | labelled inferred in coverage |
| Bottom sheets | a-exists | M3 page titled 'Bottom sheets' | CONFIRMED | <https://m3.material.io/components/bottom-sheets/overview> | Bottom sheets – Material Design 3 |
| Bottom sheets | b-docsUrl | docsUrl resolves (200, M3 SPA shell with title/meta) | CONFIRMED | <https://m3.material.io/components/bottom-sheets/overview> | body content is client-rendered; title + meta description are server-rendered |
| Bottom sheets | f-description | description = <meta name=description> (132 chars) | CONFIRMED | <https://m3.material.io/components/bottom-sheets/overview> |  |
| Bottom sheets | c-states | states Enabled (inferred from token group labels) | CONFIRMED | <https://raw.githubusercontent.com/material-components/material-web/v2.5.0/tokens/versions/latest/sass/_md-comp-sheet-bottom.scss> | labelled inferred in coverage |
| Carousel | a-exists | M3 page titled 'Carousel' | CONFIRMED | <https://m3.material.io/components/carousel/overview> | Carousel – Material Design 3 |
| Carousel | b-docsUrl | docsUrl resolves (200, M3 SPA shell with title/meta) | CONFIRMED | <https://m3.material.io/components/carousel/overview> | body content is client-rendered; title + meta description are server-rendered |
| Carousel | f-description | description = <meta name=description> (155 chars) | CONFIRMED | <https://m3.material.io/components/carousel/overview> |  |
| Carousel | c-states | states Hover/Focus/Enabled/Disabled (inferred from token group labels) | CONFIRMED | <https://raw.githubusercontent.com/material-components/material-web/v2.5.0/tokens/versions/latest/sass/_md-comp-carousel-item.scss> | labelled inferred in coverage |
| Lists | a-exists | M3 page titled 'Lists' | CONFIRMED | <https://m3.material.io/components/lists/overview> | Lists – Material Design 3 |
| Lists | b-docsUrl | docsUrl resolves (200, M3 SPA shell with title/meta) | CONFIRMED | <https://m3.material.io/components/lists/overview> | body content is client-rendered; title + meta description are server-rendered |
| Lists | f-description | description = <meta name=description> (118 chars) | CONFIRMED | <https://m3.material.io/components/lists/overview> |  |
| Lists | c-states | states Pressed/Hovered/Enabled/Disabled (inferred from token group labels) | CONFIRMED | <https://raw.githubusercontent.com/material-components/material-web/v2.5.0/tokens/versions/latest/sass/_md-comp-list.scss> | labelled inferred in coverage |
| system | latest_version | latest_version null | CONFIRMED | <https://m3.material.io/> | M3 guidelines site has no package version; honest null |
| token sets | license | license Apache-2.0 / redistribution permitted | CONFIRMED | <https://registry.npmjs.org/@material/web/2.5.0> | npm license field: Apache-2.0 |
| token md.comp.fab.secondary.small.icon.size [m3-component-tokens] | token-value | raw="24px" resolved=24px | CONFIRMED | <https://raw.githubusercontent.com/material-components/material-web/v2.5.0/tokens/versions/latest/sass/_md-comp-fab-secondary-small.scss#L35> | L35: $icon-size: 24px; /// md.comp.fab.secondary.small.container.color ([Deprecated] Enabled / [Deprecated] Contain |
| token md.comp.banners.basic.body-text.bottom-space [m3-component-token | token-value | raw="14px" resolved=14px | CONFIRMED | <https://raw.githubusercontent.com/material-components/material-web/v2.5.0/tokens/versions/latest/sass/_md-comp-banners-basic.scss#L34> | L34: $body-text-bottom-space: 14px; /// md.comp.banners.basic.body-text.leading-space (Body text) |
| token md.comp.button-group.standard.xlarge.pressed.item.width.multipli | token-value | raw="15%" resolved=15% | CONFIRMED | <https://raw.githubusercontent.com/material-components/material-web/v2.5.0/tokens/versions/latest/sass/_md-comp-button-group-standard-xlarge.scss#L25> | L25: $pressed-item-width-multiplier: 15%; /// md.comp.button-group.standard.xlarge.pressed.item.width.motion.spring |
| token md.sys.typescale.emphasized.display-medium.wght [m3-sys-typescal | token-value | raw="'wght' 500" resolved='wght' 500 | CONFIRMED | <https://raw.githubusercontent.com/material-components/material-web/v2.5.0/tokens/versions/latest/sass/_md-sys-typescale-emphasized.scss#L139> | L139: $display-medium-wght: 'wght' 500; /// md.sys.typescale.emphasized.display-small.crsv (Emphasized Display style |
| token md.sys.typescale.body-small.crsv [m3-sys-typescale] | token-value | raw="'CRSV' 0" resolved='CRSV' 0 | CONFIRMED | <https://raw.githubusercontent.com/material-components/material-web/v2.5.0/tokens/versions/latest/sass/_md-sys-typescale.scss#L69> | L69: $body-small-crsv: 'CRSV' 0; /// md.sys.typescale.body-small.fill (Body styles / Body Small) |
| token md.comp.fab.surface.large.focus.indicator.color [m3-component-to | token-value | raw="{md.sys.color.secondary}" resolved=m3-sys-color-dark: #ccc2dc · m3-sys-color-dark-high-contrast | CONFIRMED | <https://raw.githubusercontent.com/material-components/material-web/v2.5.0/tokens/versions/latest/sass/_md-comp-fab-surface-large.scss#L67> | L67: $focus-indicator-color: md-sys-color.$secondary; /// md.comp.fab.surface.large.focus.indicator.outline.offset ; m3-sys-color-light: secondary -> secondary40 -> #625b71 (stored #625b71); m3-sys-color-dark: secondary  |
| token md.comp.icon-button.filled.unselected.hovered.icon.color [m3-com | token-value | raw="{md.sys.color.on-surface-variant}" resolved=m3-sys-color-dark: #cac4d0 · m3-sys-color-dark-high-contrast | CONFIRMED | <https://raw.githubusercontent.com/material-components/material-web/v2.5.0/tokens/versions/latest/sass/_md-comp-icon-button-filled.scss#L74> | L74: $unselected-hovered-icon-color: md-sys-color.$on-surface-variant; /// md.comp.icon-button.filled.unselected.ho; m3-sys-color-light: on-surface-variant -> neutral-variant30 -> #49454f (stored #49454f); m3-sys-color-d |
| token md.comp.suggestion-chip.dragged.state-layer.opacity [m3-componen | token-value | raw="{md.sys.state.dragged.state-layer-opacity}" resolved=0.16 | CONFIRMED | <https://raw.githubusercontent.com/material-components/material-web/v2.5.0/tokens/versions/latest/sass/_md-comp-suggestion-chip.scss#L54> | L54: $dragged-state-layer-opacity: md-sys-state.$dragged-state-layer-opacity; /// md.comp.suggestion-chip.elevated. |
| token md.comp.search-bar.focus.indicator.color [m3-component-tokens] | token-value | raw="{md.sys.color.secondary}" resolved=m3-sys-color-dark: #ccc2dc · m3-sys-color-dark-high-contrast | CONFIRMED | <https://raw.githubusercontent.com/material-components/material-web/v2.5.0/tokens/versions/latest/sass/_md-comp-search-bar.scss#L77> | L77: $focus-indicator-color: md-sys-color.$secondary; /// md.comp.search-bar.focus.indicator.outline.offset (Color ; m3-sys-color-light: secondary -> secondary40 -> #625b71 (stored #625b71); m3-sys-color-dark: secondary  |
| token md.comp.banners.rich.actions.leading-space [m3-component-tokens] | token-value | raw="12px" resolved=12px | CONFIRMED | <https://raw.githubusercontent.com/material-components/material-web/v2.5.0/tokens/versions/latest/sass/_md-comp-banners-rich.scss#L27> | L27: $actions-leading-space: 12px; /// md.comp.banners.rich.actions.top-space (Button action) |

### fluent-2

| Subject | Check | Claim | Verdict | Evidence | Note |
|---|---|---|---|---|---|
| Fluent provider | a-exists | component named 'Fluent provider' exists | CONFIRMED | <https://fluent2.microsoft.design/components/web/react/core/fluentprovider/usage/> |  |
| Fluent provider | b-docsUrl | docsUrl resolves to the component page | CONFIRMED | <https://fluent2.microsoft.design/components/web/react/core/fluentprovider/usage/> |  |
| Fluent provider | f-description | description (65 chars, first sentence) | CONFIRMED | <https://fluent2.microsoft.design/components/web/react/core/fluentprovider/usage/> |  |
| Fluent provider | g-coverage | accessibility = not-documented | CONFIRMED | <https://fluent2.microsoft.design/components/web/react/core/fluentprovider/usage/> | page has only lead + Resources |
| Toast | a-exists | component named 'Toast' exists | CONFIRMED | <https://fluent2.microsoft.design/components/web/react/core/toast/usage/> |  |
| Toast | b-docsUrl | docsUrl resolves to the component page | CONFIRMED | <https://fluent2.microsoft.design/components/web/react/core/toast/usage/> |  |
| Toast | f-description | description (119 chars, first sentence) | CONFIRMED | <https://fluent2.microsoft.design/components/web/react/core/toast/usage/> |  |
| Toast | c-variants | types Communication/Confirmation/Progress toast | CONFIRMED | <https://fluent2.microsoft.design/components/web/react/core/toast/usage/> |  |
| Toast | e-guidance | a11y guidance: intent prop -> aria-live | CONFIRMED | <https://fluent2.microsoft.design/components/web/react/core/toast/usage/> |  |
| Toast | g-coverage | states = not-documented | **REFUTED** -> fixed | <https://fluent2.microsoft.design/components/web/react/core/toast/usage/> | page: 'A confirmation toast's state can be success, error, warning, informational, or progress'; F2 adapter hard-codes states=not-documented without parsing |
| Info label | a-exists | component named 'Info label' exists | CONFIRMED | <https://fluent2.microsoft.design/components/web/react/core/infolabel/usage/> |  |
| Info label | b-docsUrl | docsUrl resolves to the component page | CONFIRMED | <https://fluent2.microsoft.design/components/web/react/core/infolabel/usage/> |  |
| Info label | f-description | description (109 chars) | CONFIRMED | <https://fluent2.microsoft.design/components/web/react/core/infolabel/usage/> |  |
| Info label | e-guidance | a11y guidance: aria-label combines label + 'more information' | CONFIRMED | <https://fluent2.microsoft.design/components/web/react/core/infolabel/usage/> |  |
| Spin button | a-exists | component named 'Spin button' exists | CONFIRMED | <https://fluent2.microsoft.design/components/web/react/core/spin/usage/> |  |
| Spin button | b-docsUrl | docsUrl resolves to the component page | CONFIRMED | <https://fluent2.microsoft.design/components/web/react/core/spin/usage/> |  |
| Spin button | f-description | description (133 chars) | CONFIRMED | <https://fluent2.microsoft.design/components/web/react/core/spin/usage/> |  |
| Spin button | e-guidance | a11y guidance aria-valuemin/max | CONFIRMED | <https://fluent2.microsoft.design/components/web/react/core/spin/usage/> |  |
| Spin button | e-ariaPattern | ariaPattern spinbutton (APG link) | CONFIRMED | <https://fluent2.microsoft.design/components/web/react/core/spin/usage/> |  |
| Spin button | h-classification | verified number-field via APG spinbutton link + name | CONFIRMED | <https://fluent2.microsoft.design/components/web/react/core/spin/usage/> |  |
| Spin button | g-coverage | keyboard = not-documented | **REFUTED** -> fixed | <https://fluent2.microsoft.design/components/web/react/core/spin/usage/> | Behavior section: 'using the keyboard arrows to change the value' + bulk steps with Page keys; adapter only scans the Accessibility section with a case-sensitive key regex |
| Spin button | g-coverage | states = not-documented | **REFUTED** -> fixed | <https://fluent2.microsoft.design/components/web/react/core/spin/usage/> | 'Disabled spin buttons' behavior documented; states hard-coded not-documented |
| Menu | a-exists | component named 'Menu' exists | CONFIRMED | <https://fluent2.microsoft.design/components/web/react/core/menu/usage/> |  |
| Menu | b-docsUrl | docsUrl resolves to the component page | CONFIRMED | <https://fluent2.microsoft.design/components/web/react/core/menu/usage/> |  |
| Menu | f-description | description (135 chars) | CONFIRMED | <https://fluent2.microsoft.design/components/web/react/core/menu/usage/> |  |
| Menu | c-variants | types Default/Checkbox/Radio | CONFIRMED | <https://fluent2.microsoft.design/components/web/react/core/menu/usage/> |  |
| Menu | e-ariaPattern | ariaPattern menubar ('Menu pattern' WAI link -> APG Menu and Menubar) | CONFIRMED | <https://fluent2.microsoft.design/components/web/react/core/menu/usage/> |  |
| Menu | h-classification | verified menu type (name + APG link) | CONFIRMED | <https://fluent2.microsoft.design/components/web/react/core/menu/usage/> |  |
| Menu | g-coverage | a11y.guidance = not-documented | **REFUTED** -> fixed | <https://fluent2.microsoft.design/components/web/react/core/menu/usage/> | no Accessibility section, but Submenus guidance: 'add an aria-label to the trigger component for people who use screen readers' (minor) |
| Field | a-exists | component named 'Field' exists | CONFIRMED | <https://fluent2.microsoft.design/components/web/react/core/field/usage/> |  |
| Field | b-docsUrl | docsUrl resolves to the component page | CONFIRMED | <https://fluent2.microsoft.design/components/web/react/core/field/usage/> |  |
| Field | f-description | description (86 chars) | CONFIRMED | <https://fluent2.microsoft.design/components/web/react/core/field/usage/> |  |
| Field | e-guidance | a11y guidance: avoid placeholder for essential info | CONFIRMED | <https://fluent2.microsoft.design/components/web/react/core/field/usage/> |  |
| Field | g-coverage | states = not-documented | **REFUTED** -> fixed | <https://fluent2.microsoft.design/components/web/react/core/field/usage/> | validation states Success/Warning/Error + 'Disabled fields' documented; states hard-coded not-documented |
| pattern Onboarding | pattern-exists | pattern 'Onboarding' exists at docsUrl | CONFIRMED | <https://fluent2.microsoft.design/onboarding/> | title: Onboarding - Fluent 2 Design System |
| pattern Onboarding | pattern-description | description excerpt (89 chars) | CONFIRMED | <https://fluent2.microsoft.design/onboarding/> |  |
| pattern Onboarding | pattern-classification | inferred type onboarding | CONFIRMED | <https://fluent2.microsoft.design/onboarding/> | heuristic, labelled inferred |
| pattern Content design | pattern-exists | pattern 'Content design' exists at docsUrl | CONFIRMED | <https://fluent2.microsoft.design/content-design/> | title: Content Design - Fluent 2 Design System |
| pattern Content design | pattern-description | description excerpt (103 chars) | CONFIRMED | <https://fluent2.microsoft.design/content-design/> |  |
| pattern Content design | pattern-classification | inferred type content-and-writing | CONFIRMED | <https://fluent2.microsoft.design/content-design/> | heuristic, labelled inferred |
| pattern Accessibility | pattern-exists | pattern 'Accessibility' exists at docsUrl | CONFIRMED | <https://fluent2.microsoft.design/accessibility/> | title: Accessibility - Fluent 2 Design System |
| pattern Accessibility | pattern-description | description excerpt (169 chars) | CONFIRMED | <https://fluent2.microsoft.design/accessibility/> |  |
| pattern Accessibility | pattern-classification | inferred type accessibility | CONFIRMED | <https://fluent2.microsoft.design/accessibility/> | heuristic, labelled inferred |
| system | latest_version | latest_version 9.75.1 (@fluentui/react-components) | CONFIRMED | <https://registry.npmjs.org/@fluentui/react-components/latest> | npm latest=9.75.1; fluent-2 (design language) reuses the @fluentui/react-components version |
| system | principles | principles: Natural on every platform; Built for focus; One for all, all for one; Unmistakably Microsoft | CONFIRMED | <https://fluent2.microsoft.design/design-principles/> |  |
| system | philosophy | 'move fluidly from design to development' (homepage meta description) | CONFIRMED | <https://fluent2.microsoft.design/> |  |
| token colorPaletteBrownForeground2 [fluent-theme-teams-light] | token-value | raw="{brown.shade30}" resolved=#50301a | CONFIRMED | <https://cdn.jsdelivr.net/npm/@fluentui/tokens@1.0.0-alpha.24/lib/alias/lightColorPalette.js#L28> | line: [`colorPalette${color}Foreground2`]: personaSharedColors[sharedColor].shade30,; brown.shade30='#50301a' |
| token colorNeutralForegroundInvertedSelected [fluent-theme-web-dark] | token-value | raw="{grey.14}" resolved=#242424 | CONFIRMED | <https://cdn.jsdelivr.net/npm/@fluentui/tokens@1.0.0-alpha.24/lib/alias/darkColor.js#L48> | line: colorNeutralForegroundInvertedSelected: grey[14],; grey.14='#242424' |
| token colorPaletteLightGreenForeground1 [fluent-theme-teams-dark-v21] | token-value | raw="{lightGreen.tint30}" resolved=#5ec75a | CONFIRMED | <https://cdn.jsdelivr.net/npm/@fluentui/tokens@1.0.0-alpha.24/lib/alias/darkColorPalette.js#L10> | line: [`colorPalette${color}Foreground1`]: statusSharedColors[sharedColor].tint30,; lightGreen.tint30='#5ec75a' |
| token colorCompoundBrandForeground1 [fluent-theme-teams-high-contrast] | token-value | raw="{hcHighlight}" resolved=#1aebff | CONFIRMED | <https://cdn.jsdelivr.net/npm/@fluentui/tokens@1.0.0-alpha.24/lib/alias/highContrastColor.js#L36> | line: colorCompoundBrandForeground1: hcHighlight,; hcHighlight='#1aebff' |
| token colorStatusDangerBackground2 [fluent-theme-web-light] | token-value | raw="{cranberry.tint40}" resolved=#eeacb2 | CONFIRMED | <https://cdn.jsdelivr.net/npm/@fluentui/tokens@1.0.0-alpha.24/lib/alias/lightColorPalette.js#L42> | line: [`colorStatus${color}Background2`]: mappedStatusColors[sharedColor].tint40,; cranberry.tint40='#eeacb2' |
| token colorSubtleBackgroundInverted [fluent-theme-teams-dark] | token-value | raw="transparent" resolved=transparent | CONFIRMED | <https://cdn.jsdelivr.net/npm/@fluentui/tokens@1.0.0-alpha.24/lib/alias/teamsDarkColor.js#L102> | line: colorSubtleBackgroundInverted: 'transparent', |
| token colorNeutralForeground5Hover [fluent-theme-teams-dark] | token-value | raw="{white}" resolved=#ffffff | CONFIRMED | <https://cdn.jsdelivr.net/npm/@fluentui/tokens@1.0.0-alpha.24/lib/alias/teamsDarkColor.js#L23> | line: colorNeutralForeground5Hover: white,; white='#ffffff' |
| token colorPaletteGreenBackground3 [fluent-theme-teams-dark-v21] | token-value | raw="{green.primary}" resolved=#107c10 | CONFIRMED | <https://cdn.jsdelivr.net/npm/@fluentui/tokens@1.0.0-alpha.24/lib/alias/darkColorPalette.js#L9> | line: [`colorPalette${color}Background3`]: statusSharedColors[sharedColor].primary,; green.primary='#107c10' |
| token colorNeutralForegroundInvertedLink [fluent-theme-web-dark] | token-value | raw="{white}" resolved=#ffffff | CONFIRMED | <https://cdn.jsdelivr.net/npm/@fluentui/tokens@1.0.0-alpha.24/lib/alias/darkColor.js#L51> | line: colorNeutralForegroundInvertedLink: white,; white='#ffffff' |
| token colorBrandForeground2Hover [fluent-theme-teams-high-contrast] | token-value | raw="{hcCanvasText}" resolved=#ffffff | CONFIRMED | <https://cdn.jsdelivr.net/npm/@fluentui/tokens@1.0.0-alpha.24/lib/alias/highContrastColor.js#L41> | line: colorBrandForeground2Hover: hcCanvasText,; hcCanvasText='#ffffff' |
| token sets | license | license MIT / redistribution permitted | CONFIRMED | <https://registry.npmjs.org/@fluentui/tokens/1.0.0-alpha.24> | npm license field: MIT |
| Fluent provider | g-random | relationships = not-documented | CONFIRMED | <https://fluent2.microsoft.design/components/web/react/core/fluentprovider/usage/> | page has a lead and resources only |
| Toast | g-random | a11y.keyboard = not-documented | **REFUTED** -> fixed | <https://fluent2.microsoft.design/components/web/react/core/toast/usage/> | Behavior: 'toasts that don't include actions won't receive keyboard focus for people who navigate primarily by keyboard' |
| Info label | g-random | sizes = not-documented | **REFUTED** -> fixed | <https://fluent2.microsoft.design/components/web/react/core/infolabel/usage/> | 'Info labels at a small size (20 x 20 pixels) ... Don't choose the small size' |
| Spin button | g-random | tokens = not-documented | CONFIRMED | <https://fluent2.microsoft.design/components/web/react/core/spin/usage/> | no tokens on the page |
| Menu | g-random | tokens = not-documented | CONFIRMED | <https://fluent2.microsoft.design/components/web/react/core/menu/usage/> | no tokens on the page |
| Field | g-random | variants = not-documented | CONFIRMED | <https://fluent2.microsoft.design/components/web/react/core/field/usage/> | the Types section links to other components (Checkbox, Input...), not Field variants |
| Icon | g-after | relationships = not-documented | CONFIRMED | <https://fluent2.microsoft.design/components/web/react/core/icon/usage/> | links only the iconography guidance page, no component |
| Nav | g-after | a11y.roles = not-documented | CONFIRMED | <https://fluent2.microsoft.design/components/web/react/core/nav/usage/> | no role mentioned |

### fluent-ui-react

| Subject | Check | Claim | Verdict | Evidence | Note |
|---|---|---|---|---|---|
| Calendar | a-exists | exported component Calendar | CONFIRMED | <https://cdn.jsdelivr.net/npm/@fluentui/react-calendar-compat@0.4.8/dist/index.d.ts> |  |
| Calendar | b-docsUrl | Storybook docs id compat-components-calendar--docs exists (Compat Components/Calendar) | CONFIRMED | <https://storybooks.fluentui.dev/react/index.json> |  |
| Calendar | f-description | description (CalendarDescription.md) | CONFIRMED | <https://raw.githubusercontent.com/microsoft/fluentui/%40fluentui%2Freact-components_v9.75.1/packages/react-components/react-calendar-compat/stories/src/Calendar/CalendarDescription.md> |  |
| Calendar | d-prop | minDate: Date | CONFIRMED | <https://cdn.jsdelivr.net/npm/@fluentui/react-calendar-compat@0.4.8/dist/index.d.ts> |  |
| Calendar | d-prop | highlightSelectedMonth: boolean = false | CONFIRMED | <https://cdn.jsdelivr.net/npm/@fluentui/react-calendar-compat@0.4.8/dist/index.d.ts> |  |
| Calendar | d-prop | isDayPickerVisible: boolean = true | CONFIRMED | <https://cdn.jsdelivr.net/npm/@fluentui/react-calendar-compat@0.4.8/dist/index.d.ts> |  |
| Calendar | lifecycle | lifecycle experimental | UNVERIFIABLE | <https://cdn.jsdelivr.net/npm/@fluentui/react-calendar-compat@0.4.8/dist/index.d.ts> | derived from semver 0.4.8 (0.x => experimental) by adapter rule; Fluent does not label the compat Calendar 'experimental' |
| DialogBody | a-exists | exported component DialogBody | CONFIRMED | <https://cdn.jsdelivr.net/npm/@fluentui/react-dialog@9.18.6/dist/index.d.ts> |  |
| DialogBody | b-docsUrl | Storybook docs id components-dialog--docs exists (Components/Dialog) | CONFIRMED | <https://storybooks.fluentui.dev/react/index.json> |  |
| DialogBody | f-description | description (TSDoc) | CONFIRMED | <https://cdn.jsdelivr.net/npm/@fluentui/react-dialog@9.18.6/dist/index.d.ts> |  |
| List | a-exists | exported component List | CONFIRMED | <https://cdn.jsdelivr.net/npm/@fluentui/react-list@9.7.0/dist/index.d.ts> |  |
| List | b-docsUrl | Storybook docs id components-list--docs exists (Components/List) | CONFIRMED | <https://storybooks.fluentui.dev/react/index.json> |  |
| List | f-description | description (ListDescription.md) | CONFIRMED | <https://raw.githubusercontent.com/microsoft/fluentui/%40fluentui%2Freact-components_v9.75.1/packages/react-components/react-list/stories/src/List/ListDescription.md> |  |
| List | d-prop | selectedItems: SelectionItemId[] | CONFIRMED | <https://cdn.jsdelivr.net/npm/@fluentui/react-list@9.7.0/dist/index.d.ts> |  |
| List | d-prop | selectionMode: SelectionMode_2 | CONFIRMED | <https://cdn.jsdelivr.net/npm/@fluentui/react-list@9.7.0/dist/index.d.ts> |  |
| List | d-prop | defaultSelectedItems: SelectionItemId[] | CONFIRMED | <https://cdn.jsdelivr.net/npm/@fluentui/react-list@9.7.0/dist/index.d.ts> |  |
| BreadcrumbButton | a-exists | exported component BreadcrumbButton | CONFIRMED | <https://cdn.jsdelivr.net/npm/@fluentui/react-breadcrumb@9.4.8/dist/index.d.ts> |  |
| BreadcrumbButton | b-docsUrl | Storybook docs id components-breadcrumb--docs exists (Components/Breadcrumb) | CONFIRMED | <https://storybooks.fluentui.dev/react/index.json> |  |
| BreadcrumbButton | f-description | description (TSDoc) | CONFIRMED | <https://cdn.jsdelivr.net/npm/@fluentui/react-breadcrumb@9.4.8/dist/index.d.ts> |  |
| BreadcrumbButton | d-prop | current: boolean = false | CONFIRMED | <https://cdn.jsdelivr.net/npm/@fluentui/react-breadcrumb@9.4.8/dist/index.d.ts> |  |
| BreadcrumbButton | d-prop | size via Pick<BreadcrumbProps,'size'> | CONFIRMED | <https://cdn.jsdelivr.net/npm/@fluentui/react-breadcrumb@9.4.8/dist/index.d.ts> |  |
| BreadcrumbButton | d-prop | size: 'small'\|'medium'\|'large' = medium | CONFIRMED | <https://cdn.jsdelivr.net/npm/@fluentui/react-breadcrumb@9.4.8/dist/index.d.ts> |  |
| BreadcrumbButton | c-sizes | sizes small/medium/large | CONFIRMED | <https://cdn.jsdelivr.net/npm/@fluentui/react-breadcrumb@9.4.8/dist/index.d.ts> |  |
| ToolbarButton | a-exists | exported component ToolbarButton | CONFIRMED | <https://cdn.jsdelivr.net/npm/@fluentui/react-toolbar@9.8.7/dist/index.d.ts> |  |
| ToolbarButton | b-docsUrl | Storybook docs id components-toolbar--docs exists (Components/Toolbar) | CONFIRMED | <https://storybooks.fluentui.dev/react/index.json> |  |
| ToolbarButton | f-description | description (TSDoc, 2 comment lines joined) | CONFIRMED | <https://cdn.jsdelivr.net/npm/@fluentui/react-toolbar@9.8.7/dist/index.d.ts> |  |
| ToolbarButton | d-prop | appearance: 'primary'\|'subtle'\|'transparent' | CONFIRMED | <https://cdn.jsdelivr.net/npm/@fluentui/react-toolbar@9.8.7/dist/index.d.ts> |  |
| ToolbarButton | d-prop | vertical: boolean | CONFIRMED | <https://cdn.jsdelivr.net/npm/@fluentui/react-toolbar@9.8.7/dist/index.d.ts> |  |
| ToolbarButton | c-variants | appearance primary/subtle/transparent | CONFIRMED | <https://cdn.jsdelivr.net/npm/@fluentui/react-toolbar@9.8.7/dist/index.d.ts> |  |
| ToolbarButton | g-coverage | states = not-documented | **REFUTED** -> fixed | <https://cdn.jsdelivr.net/npm/@fluentui/react-toolbar@9.8.7/dist/index.d.ts> | ToolbarButtonProps picks 'disabled' \| 'disabledFocusable' from ButtonProps (imported, unresolved); with unresolved heritage the honest state is not-extracted |
| Option | a-exists | exported component Option | CONFIRMED | <https://cdn.jsdelivr.net/npm/@fluentui/react-combobox@9.17.8/dist/index.d.ts> |  |
| Option | b-docsUrl | Storybook docs id components-combobox--docs exists (Components/Combobox) | CONFIRMED | <https://storybooks.fluentui.dev/react/index.json> |  |
| Option | f-description | description (TSDoc) | CONFIRMED | <https://cdn.jsdelivr.net/npm/@fluentui/react-combobox@9.17.8/dist/index.d.ts> |  |
| Option | d-prop | value: string (optional) | CONFIRMED | <https://cdn.jsdelivr.net/npm/@fluentui/react-combobox@9.17.8/dist/index.d.ts> |  |
| Option | d-prop | children: React_2.ReactNode (required) | **REFUTED** -> fixed | <https://cdn.jsdelivr.net/npm/@fluentui/react-combobox@9.17.8/dist/index.d.ts> | OptionProps is a union: {text?: string; children: string} \| {text: string; children?: ReactNode} - children is required only as a string; as ReactNode it is optional |
| Option | d-prop | text: string (required) | **REFUTED** -> fixed | <https://cdn.jsdelivr.net/npm/@fluentui/react-combobox@9.17.8/dist/index.d.ts> | text is optional in the first union branch (children: string) |
| Option | c-states | state disabled | CONFIRMED | <https://cdn.jsdelivr.net/npm/@fluentui/react-combobox@9.17.8/dist/index.d.ts> |  |
| system | latest_version | latest_version 9.75.1 (@fluentui/react-components) | CONFIRMED | <https://registry.npmjs.org/@fluentui/react-components/latest> | npm latest=9.75.1 |
| token pumpkin.tint10 [fluent-global-colors] | token-value | raw="#d06228" resolved=#d06228 | CONFIRMED | <https://cdn.jsdelivr.net/npm/@fluentui/tokens@1.0.0-alpha.24/lib/global/colors.js#L214> | source pumpkin.tint10='#d06228'; line: tint10: '#d06228', |
| token colorPaletteDarkGreenBorderActive [fluent-theme-teams-dark] | token-value | raw="{darkGreen.tint30}" resolved=#4da64d | CONFIRMED | <https://cdn.jsdelivr.net/npm/@fluentui/tokens@1.0.0-alpha.24/lib/alias/darkColorPalette.js#L34> | line: [`colorPalette${color}BorderActive`]: personaSharedColors[sharedColor].tint30; darkGreen.tint30='#4da64d' |
| token colorPaletteLightGreenBorder1 [fluent-theme-web-dark] | token-value | raw="{lightGreen.primary}" resolved=#13a10e | CONFIRMED | <https://cdn.jsdelivr.net/npm/@fluentui/tokens@1.0.0-alpha.24/lib/alias/darkColorPalette.js#L14> | line: [`colorPalette${color}Border1`]: statusSharedColors[sharedColor].primary,; lightGreen.primary='#13a10e' |
| token colorPaletteRedBorder1 [fluent-theme-teams-light-v21] | token-value | raw="{red.tint40}" resolved=#f1bbbc | CONFIRMED | <https://cdn.jsdelivr.net/npm/@fluentui/tokens@1.0.0-alpha.24/lib/alias/lightColorPalette.js#L14> | line: [`colorPalette${color}Border1`]: statusSharedColors[sharedColor].tint40,; red.tint40='#f1bbbc' |
| token colorPaletteBrownBackground2 [fluent-theme-teams-light] | token-value | raw="{brown.tint40}" resolved=#ddc3b0 | CONFIRMED | <https://cdn.jsdelivr.net/npm/@fluentui/tokens@1.0.0-alpha.24/lib/alias/lightColorPalette.js#L27> | line: [`colorPalette${color}Background2`]: personaSharedColors[sharedColor].tint40,; brown.tint40='#ddc3b0' |
| token colorStatusSuccessBorder2 [fluent-theme-teams-dark] | token-value | raw="{green.tint40}" resolved=#9fd89f | CONFIRMED | <https://cdn.jsdelivr.net/npm/@fluentui/tokens@1.0.0-alpha.24/lib/alias/darkColorPalette.js#L68> | line: colorStatusTokens.colorStatusSuccessBorder2 = mappedStatusColors[statusColorMapping.succes; green.tint40='#9fd89f' |
| token colorNeutralStroke4Selected [fluent-theme-teams-dark-v21] | token-value | raw="{grey.24}" resolved=#3d3d3d | CONFIRMED | <https://cdn.jsdelivr.net/npm/@fluentui/tokens@1.0.0-alpha.24/lib/alias/teamsDarkColor.js#L154> | line: colorNeutralStroke4Selected: grey[24],; grey.24='#3d3d3d' |
| token colorPaletteGreenBackground1 [fluent-theme-web-dark] | token-value | raw="{green.shade40}" resolved=#052505 | CONFIRMED | <https://cdn.jsdelivr.net/npm/@fluentui/tokens@1.0.0-alpha.24/lib/alias/darkColorPalette.js#L7> | line: [`colorPalette${color}Background1`]: statusSharedColors[sharedColor].shade40,; green.shade40='#052505' |
| token colorPaletteDarkOrangeForeground2 [fluent-theme-teams-dark-v21] | token-value | raw="{darkOrange.tint40}" resolved=#f4bfab | CONFIRMED | <https://cdn.jsdelivr.net/npm/@fluentui/tokens@1.0.0-alpha.24/lib/alias/darkColorPalette.js#L11> | line: [`colorPalette${color}Foreground2`]: statusSharedColors[sharedColor].tint40,; darkOrange.tint40='#f4bfab' |
| token colorNeutralBackground1Hover [fluent-theme-web-light] | token-value | raw="{grey.96}" resolved=#f5f5f5 | CONFIRMED | <https://cdn.jsdelivr.net/npm/@fluentui/tokens@1.0.0-alpha.24/lib/alias/lightColor.js#L63> | line: colorNeutralBackground1Hover: grey[96],; grey.96='#f5f5f5' |
| token sets | license | license MIT / redistribution permitted | CONFIRMED | <https://registry.npmjs.org/@fluentui/tokens/1.0.0-alpha.24> | npm license field: MIT |
| Calendar | g-random | sizes = not-documented | CONFIRMED | <https://cdn.jsdelivr.net/npm/@fluentui/react-calendar-compat@0.4.8/dist/index.d.ts> | no size prop |
| DialogBody | g-random | variants = not-documented | CONFIRMED | <https://cdn.jsdelivr.net/npm/@fluentui/react-dialog@9.18.6/dist/index.d.ts> | no props beyond the root slot |
| List | g-random | variants = not-documented | CONFIRMED | <https://cdn.jsdelivr.net/npm/@fluentui/react-list@9.7.0/dist/index.d.ts> | no visual variant prop |
| BreadcrumbButton | g-random | variants = not-documented | CONFIRMED | <https://cdn.jsdelivr.net/npm/@fluentui/react-breadcrumb@9.4.8/dist/index.d.ts> | props: size (Pick), disabled/disabledFocusable (Pick), current |
| ToolbarButton | g-random | sizes = not-documented | CONFIRMED | <https://cdn.jsdelivr.net/npm/@fluentui/react-toolbar@9.8.7/dist/index.d.ts> | no size prop; size is set on Toolbar |
| Option | g-random | variants = not-documented | CONFIRMED | <https://cdn.jsdelivr.net/npm/@fluentui/react-combobox@9.17.8/dist/index.d.ts> | no variant prop |
| ToastFooter | g-after | variants = not-documented | CONFIRMED | <https://cdn.jsdelivr.net/npm/@fluentui/react-toast@9.8.5/dist/index.d.ts> | ToastFooterProps = ComponentProps<ToastFooterSlots> & {} |
| NavSectionHeader | g-after | states = not-documented | CONFIRMED | <https://cdn.jsdelivr.net/npm/@fluentui/react-nav@9.4.9/dist/index.d.ts> | NavSectionHeaderProps = ComponentProps<NavSectionHeaderSlots> |

### fluent-ui-web-components

| Subject | Check | Claim | Verdict | Evidence | Note |
|---|---|---|---|---|---|
| TextInput | a-exists | class TextInput defines <fluent-text-input> | CONFIRMED | <https://cdn.jsdelivr.net/npm/@fluentui/web-components@3.1.4/dist/web-components.d.ts> |  |
| TextInput | b-docsUrl | Storybook docs id components-textinput--docs exists | CONFIRMED | <https://storybooks.fluentui.dev/web-components/index.json> |  |
| TextInput | f-description | TSDoc description | CONFIRMED | <https://cdn.jsdelivr.net/npm/@fluentui/web-components@3.1.4/dist/web-components.d.ts> |  |
| TextInput | d-prop | validity: ValidityState (getter on BaseTextInput) | CONFIRMED | <https://cdn.jsdelivr.net/npm/@fluentui/web-components@3.1.4/dist/web-components.d.ts> |  |
| TextInput | d-prop | multiple: boolean | CONFIRMED | <https://cdn.jsdelivr.net/npm/@fluentui/web-components@3.1.4/dist/web-components.d.ts> |  |
| TextInput | d-prop | list: string | CONFIRMED | <https://cdn.jsdelivr.net/npm/@fluentui/web-components@3.1.4/dist/web-components.d.ts> |  |
| TextInput | c-variants | appearance outline/underline/filled-lighter/filled-darker | CONFIRMED | <https://cdn.jsdelivr.net/npm/@fluentui/web-components@3.1.4/dist/web-components.d.ts> |  |
| TextInput | c-states | states readonly/disabled (BaseTextInput) | CONFIRMED | <https://cdn.jsdelivr.net/npm/@fluentui/web-components@3.1.4/dist/web-components.d.ts> |  |
| MenuButton | a-exists | class MenuButton defines <fluent-menu-button> | CONFIRMED | <https://cdn.jsdelivr.net/npm/@fluentui/web-components@3.1.4/dist/web-components.d.ts> |  |
| MenuButton | b-docsUrl | Storybook docs id components-button-menu-button--docs exists | CONFIRMED | <https://storybooks.fluentui.dev/web-components/index.json> |  |
| MenuButton | f-description | TSDoc description | CONFIRMED | <https://cdn.jsdelivr.net/npm/@fluentui/web-components@3.1.4/dist/web-components.d.ts> |  |
| MenuButton | d-prop | value: string (BaseButton) | CONFIRMED | <https://cdn.jsdelivr.net/npm/@fluentui/web-components@3.1.4/dist/web-components.d.ts> |  |
| MenuButton | d-prop | formTarget: ButtonFormTarget | CONFIRMED | <https://cdn.jsdelivr.net/npm/@fluentui/web-components@3.1.4/dist/web-components.d.ts> |  |
| MenuButton | d-prop | iconOnly: boolean (Button) | CONFIRMED | <https://cdn.jsdelivr.net/npm/@fluentui/web-components@3.1.4/dist/web-components.d.ts> |  |
| MenuButton | c-sizes | sizes small/medium/large (ButtonSize) | CONFIRMED | <https://cdn.jsdelivr.net/npm/@fluentui/web-components@3.1.4/dist/web-components.d.ts> |  |
| MenuButton | c-states | states disabled / disabled-focusable | CONFIRMED | <https://cdn.jsdelivr.net/npm/@fluentui/web-components@3.1.4/dist/web-components.d.ts> |  |
| ToggleButton | a-exists | class ToggleButton defines <fluent-toggle-button> | CONFIRMED | <https://cdn.jsdelivr.net/npm/@fluentui/web-components@3.1.4/dist/web-components.d.ts> |  |
| ToggleButton | b-docsUrl | Storybook docs id components-button-toggle-button--docs exists | CONFIRMED | <https://storybooks.fluentui.dev/web-components/index.json> |  |
| ToggleButton | f-description | TSDoc description | CONFIRMED | <https://cdn.jsdelivr.net/npm/@fluentui/web-components@3.1.4/dist/web-components.d.ts> |  |
| ToggleButton | d-prop | formAttribute: string | CONFIRMED | <https://cdn.jsdelivr.net/npm/@fluentui/web-components@3.1.4/dist/web-components.d.ts> |  |
| ToggleButton | d-prop | formAction: string | CONFIRMED | <https://cdn.jsdelivr.net/npm/@fluentui/web-components@3.1.4/dist/web-components.d.ts> |  |
| ToggleButton | d-prop | name: string | CONFIRMED | <https://cdn.jsdelivr.net/npm/@fluentui/web-components@3.1.4/dist/web-components.d.ts> |  |
| ToggleButton | c-variants | shape circular/rounded (ButtonShape) | CONFIRMED | <https://cdn.jsdelivr.net/npm/@fluentui/web-components@3.1.4/dist/web-components.d.ts> |  |
| MessageBar | a-exists | class MessageBar defines <fluent-message-bar> | CONFIRMED | <https://cdn.jsdelivr.net/npm/@fluentui/web-components@3.1.4/dist/web-components.d.ts> |  |
| MessageBar | b-docsUrl | Storybook docs id components-messagebar--docs exists | CONFIRMED | <https://storybooks.fluentui.dev/web-components/index.json> |  |
| MessageBar | f-description | TSDoc description (34 chars) | CONFIRMED | <https://cdn.jsdelivr.net/npm/@fluentui/web-components@3.1.4/dist/web-components.d.ts> |  |
| MessageBar | d-prop | layout: MessageBarLayout | CONFIRMED | <https://cdn.jsdelivr.net/npm/@fluentui/web-components@3.1.4/dist/web-components.d.ts> |  |
| MessageBar | d-prop | shape: MessageBarShape | CONFIRMED | <https://cdn.jsdelivr.net/npm/@fluentui/web-components@3.1.4/dist/web-components.d.ts> |  |
| MessageBar | d-prop | intent: MessageBarIntent | CONFIRMED | <https://cdn.jsdelivr.net/npm/@fluentui/web-components@3.1.4/dist/web-components.d.ts> |  |
| MessageBar | c-variants | layout multiline/singleline | CONFIRMED | <https://cdn.jsdelivr.net/npm/@fluentui/web-components@3.1.4/dist/web-components.d.ts> |  |
| MenuList | a-exists | class MenuList defines <fluent-menu-list> | CONFIRMED | <https://cdn.jsdelivr.net/npm/@fluentui/web-components@3.1.4/dist/web-components.d.ts> |  |
| MenuList | b-docsUrl | Storybook docs id components-menulist--docs exists | CONFIRMED | <https://storybooks.fluentui.dev/web-components/index.json> |  |
| MenuList | f-description | TSDoc description | CONFIRMED | <https://cdn.jsdelivr.net/npm/@fluentui/web-components@3.1.4/dist/web-components.d.ts> |  |
| MenuList | e-roles | role menu (TSDoc link to ARIA menu role) | CONFIRMED | <https://cdn.jsdelivr.net/npm/@fluentui/web-components@3.1.4/dist/web-components.d.ts> |  |
| MenuList | h-classification | verified menu via name + TSDoc ARIA role | CONFIRMED | <https://cdn.jsdelivr.net/npm/@fluentui/web-components@3.1.4/dist/web-components.d.ts> |  |
| Badge | a-exists | class Badge defines <fluent-badge> | CONFIRMED | <https://cdn.jsdelivr.net/npm/@fluentui/web-components@3.1.4/dist/web-components.d.ts> |  |
| Badge | b-docsUrl | Storybook docs id components-badge-badge--docs exists | CONFIRMED | <https://storybooks.fluentui.dev/web-components/index.json> |  |
| Badge | f-description | TSDoc description | CONFIRMED | <https://cdn.jsdelivr.net/npm/@fluentui/web-components@3.1.4/dist/web-components.d.ts> |  |
| Badge | d-prop | appearance: BadgeAppearance | CONFIRMED | <https://cdn.jsdelivr.net/npm/@fluentui/web-components@3.1.4/dist/web-components.d.ts> |  |
| Badge | d-prop | size: BadgeSize | CONFIRMED | <https://cdn.jsdelivr.net/npm/@fluentui/web-components@3.1.4/dist/web-components.d.ts> |  |
| Badge | d-prop | color: BadgeColor | CONFIRMED | <https://cdn.jsdelivr.net/npm/@fluentui/web-components@3.1.4/dist/web-components.d.ts> |  |
| Badge | c-sizes | sizes tiny..extra-large | CONFIRMED | <https://cdn.jsdelivr.net/npm/@fluentui/web-components@3.1.4/dist/web-components.d.ts> |  |
| Badge | c-variants | appearance ghost / color success | CONFIRMED | <https://cdn.jsdelivr.net/npm/@fluentui/web-components@3.1.4/dist/web-components.d.ts> |  |
| system | latest_version | latest_version 3.1.4 (@fluentui/web-components) | CONFIRMED | <https://registry.npmjs.org/@fluentui/web-components/latest> | npm latest=3.1.4 |
| token red.shade50 [fluent-global-colors] | token-value | raw="#210809" resolved=#210809 | CONFIRMED | <https://cdn.jsdelivr.net/npm/@fluentui/tokens@1.0.0-alpha.24/lib/global/colors.js#L166> | source red.shade50='#210809'; line: shade50: '#210809', |
| token colorPalettePlatinumBackground2 [fluent-theme-teams-light-v21] | token-value | raw="{platinum.tint40}" resolved=#cdd6d8 | CONFIRMED | <https://cdn.jsdelivr.net/npm/@fluentui/tokens@1.0.0-alpha.24/lib/alias/lightColorPalette.js#L27> | line: [`colorPalette${color}Background2`]: personaSharedColors[sharedColor].tint40,; platinum.tint40='#cdd6d8' |
| token shadow16 [fluent-theme-web-dark] | token-value | raw="0 0 2px {colorNeutralShadowAmbient}, 0 8px 16px {colorNeutr resolved=0 0 2px rgba(0,0,0,0.24), 0 8px 16px | CONFIRMED | <https://cdn.jsdelivr.net/npm/@fluentui/tokens@1.0.0-alpha.24/lib/utils/shadows.js#L6> | line: [`shadow16${tokenSuffix}`]: `0 0 2px ${ambientColor}, 0 8px 16px ${keyColor}`,; colorNeutralShadowAmbient='' |
| token colorBrandForegroundLinkPressed [fluent-theme-teams-light-v21] | token-value | raw="{brandTeamsV21.40}" resolved=#3b3185 | CONFIRMED | <https://cdn.jsdelivr.net/npm/@fluentui/tokens@1.0.0-alpha.24/lib/alias/lightColor.js#L30> | line: colorBrandForegroundLinkPressed: brand[40],; brandTeamsV21.40='#3b3185' |
| token colorNeutralStrokeDisabled [fluent-theme-web-light] | token-value | raw="{grey.88}" resolved=#e0e0e0 | CONFIRMED | <https://cdn.jsdelivr.net/npm/@fluentui/tokens@1.0.0-alpha.24/lib/alias/lightColor.js#L169> | line: colorNeutralStrokeDisabled: grey[88],; grey.88='#e0e0e0' |
| token colorPaletteRedBackground1 [fluent-theme-teams-high-contrast] | token-value | raw="{hcCanvas}" resolved=#000000 | CONFIRMED | <https://cdn.jsdelivr.net/npm/@fluentui/tokens@1.0.0-alpha.24/lib/alias/highContrastColorPalette.js#L7> | line: [`colorPalette${color}Background1`]: hcCanvas,; hcCanvas='#000000' |
| token colorPaletteForestBackground2 [fluent-theme-teams-high-contrast] | token-value | raw="{hcCanvas}" resolved=#000000 | CONFIRMED | <https://cdn.jsdelivr.net/npm/@fluentui/tokens@1.0.0-alpha.24/lib/alias/highContrastColorPalette.js#L26> | line: [`colorPalette${color}Background2`]: hcCanvas,; hcCanvas='#000000' |
| token seafoam.shade50 [fluent-global-colors] | token-value | raw="#002111" resolved=#002111 | CONFIRMED | <https://cdn.jsdelivr.net/npm/@fluentui/tokens@1.0.0-alpha.24/lib/global/colors.js#L362> | source seafoam.shade50='#002111'; line: shade50: '#002111', |
| token colorPaletteBlueBorderActive [fluent-theme-teams-light-v21] | token-value | raw="{blue.primary}" resolved=#0078d4 | CONFIRMED | <https://cdn.jsdelivr.net/npm/@fluentui/tokens@1.0.0-alpha.24/lib/alias/lightColorPalette.js#L29> | line: [`colorPalette${color}BorderActive`]: personaSharedColors[sharedColor].primary; blue.primary='#0078d4' |
| token colorNeutralShadowAmbientLighter [fluent-theme-web-dark] | token-value | raw="rgba(0,0,0,0.12)" resolved=rgba(0,0,0,0.12) | CONFIRMED | <https://cdn.jsdelivr.net/npm/@fluentui/tokens@1.0.0-alpha.24/lib/alias/darkColor.js#L181> | line: colorNeutralShadowAmbientLighter: 'rgba(0,0,0,0.12)', |
| token sets | license | license MIT / redistribution permitted | CONFIRMED | <https://registry.npmjs.org/@fluentui/tokens/1.0.0-alpha.24> | npm license field: MIT |
| TextInput | g-random | relationships = not-documented | CONFIRMED | <https://cdn.jsdelivr.net/npm/@fluentui/web-components@3.1.4/dist/web-components.d.ts> | no related elements named |
| MessageBar | g-random | sizes = not-documented | CONFIRMED | <https://cdn.jsdelivr.net/npm/@fluentui/web-components@3.1.4/dist/web-components.d.ts> | shape/layout/intent only |
| MenuList | g-random | variants = not-documented | CONFIRMED | <https://cdn.jsdelivr.net/npm/@fluentui/web-components@3.1.4/dist/web-components.d.ts> | no public properties |
| Badge | g-random | relationships = not-documented | CONFIRMED | <https://cdn.jsdelivr.net/npm/@fluentui/web-components@3.1.4/dist/web-components.d.ts> | no related elements named |
| DropdownOption | g-after | relationships = not-documented | **REFUTED** -> fixed | <https://cdn.jsdelivr.net/npm/@fluentui/web-components@3.1.4/dist/web-components.d.ts> | TSDoc: 'specifically designed for use in the Dropdown element', '{@link (BaseDropdown:class)}' |
| Listbox | g-after | states = not-documented | CONFIRMED | <https://cdn.jsdelivr.net/npm/@fluentui/web-components@3.1.4/dist/web-components.d.ts> | only multiple (not a state) |

### shopify-polaris

| Subject | Check | Claim | Verdict | Evidence | Note |
|---|---|---|---|---|---|
| pattern Metrics card | pattern-exists | pattern 'Metrics card' exists at docsUrl | CONFIRMED | <https://shopify.dev/docs/api/app-home/latest/patterns/compositions/metrics-card> | title: Metrics card |
| pattern Metrics card | pattern-description | description excerpt (201 chars) | CONFIRMED | <https://shopify.dev/docs/api/app-home/latest/patterns/compositions/metrics-card> |  |
| pattern Interstitial nav | pattern-exists | pattern 'Interstitial nav' exists at docsUrl | CONFIRMED | <https://shopify.dev/docs/api/app-home/latest/patterns/compositions/interstitial-nav> | title: Interstitial nav |
| pattern Interstitial nav | pattern-description | description excerpt (218 chars) | CONFIRMED | <https://shopify.dev/docs/api/app-home/latest/patterns/compositions/interstitial-nav> |  |
| pattern Setup guide | pattern-exists | pattern 'Setup guide' exists at docsUrl | CONFIRMED | <https://shopify.dev/docs/api/app-home/latest/patterns/compositions/setup-guide> | title: Setup guide |
| pattern Setup guide | pattern-description | description excerpt (215 chars) | CONFIRMED | <https://shopify.dev/docs/api/app-home/latest/patterns/compositions/setup-guide> |  |
| Heading | a-exists | archived Polaris React doc titled 'Heading' | CONFIRMED | <https://github.com/Shopify/polaris-react-archive/blob/main/polaris.shopify.com/content/components/deprecated/heading.mdx> |  |
| Heading | b-docsUrl | docsUrl = archived MDX on GitHub (polaris-react-archive) | CONFIRMED | <https://github.com/Shopify/polaris-react-archive/blob/main/polaris.shopify.com/content/components/deprecated/heading.mdx> | archive README also offers shopify.github.io/polaris-react-archive (rendered); GitHub MDX is the archived source |
| Heading | f-description | description = MDX lede | CONFIRMED | <https://raw.githubusercontent.com/Shopify/polaris-react-archive/main/polaris.shopify.com/content/components/deprecated/heading.mdx> |  |
| Heading | lifecycle | lifecycle deprecated | CONFIRMED | <https://registry.npmjs.org/@shopify/polaris> | npm @shopify/polaris@13.9.5 deprecated: 'Polaris React is deprecated and no longer maintained. For bu...' |
| Heading | lifecycle-mdx | MDX status: Deprecated | CONFIRMED | <https://raw.githubusercontent.com/Shopify/polaris-react-archive/main/polaris.shopify.com/content/components/deprecated/heading.mdx> |  |
| Heading | g-coverage | sizes stored as [] (UI renders 'documented-none') while coverage.sizes=not-documented | **REFUTED** -> fixed | <https://github.com/Shopify/polaris-react-archive/blob/main/polaris.shopify.com/content/components/> | source never states the component has no sizes; [] makes SizesBlock show documented-none |
| Button group | a-exists | archived Polaris React doc titled 'Button group' | CONFIRMED | <https://github.com/Shopify/polaris-react-archive/blob/main/polaris.shopify.com/content/components/actions/button-group.mdx> |  |
| Button group | b-docsUrl | docsUrl = archived MDX on GitHub (polaris-react-archive) | CONFIRMED | <https://github.com/Shopify/polaris-react-archive/blob/main/polaris.shopify.com/content/components/actions/button-group.mdx> | archive README also offers shopify.github.io/polaris-react-archive (rendered); GitHub MDX is the archived source |
| Button group | f-description | description = MDX lede | CONFIRMED | <https://raw.githubusercontent.com/Shopify/polaris-react-archive/main/polaris.shopify.com/content/components/actions/button-group.mdx> |  |
| Button group | lifecycle | lifecycle deprecated | CONFIRMED | <https://registry.npmjs.org/@shopify/polaris> | npm @shopify/polaris@13.9.5 deprecated: 'Polaris React is deprecated and no longer maintained. For bu...' |
| Button group | d-prop | variant: Variant | CONFIRMED | <https://cdn.jsdelivr.net/npm/@shopify/polaris@13.9.5/build/ts/src/components/ButtonGroup/ButtonGroup.d.ts> |  |
| Button group | d-prop | noWrap: boolean | CONFIRMED | <https://cdn.jsdelivr.net/npm/@shopify/polaris@13.9.5/build/ts/src/components/ButtonGroup/ButtonGroup.d.ts> |  |
| Button group | d-prop | children: React.ReactNode | CONFIRMED | <https://cdn.jsdelivr.net/npm/@shopify/polaris@13.9.5/build/ts/src/components/ButtonGroup/ButtonGroup.d.ts> |  |
| Button group | g-coverage | sizes stored as [] (UI renders 'documented-none') while coverage.sizes=not-documented | **REFUTED** -> fixed | <https://github.com/Shopify/polaris-react-archive/blob/main/polaris.shopify.com/content/components/> | source never states the component has no sizes; [] makes SizesBlock show documented-none |
| Block stack | a-exists | archived Polaris React doc titled 'Block stack' | CONFIRMED | <https://github.com/Shopify/polaris-react-archive/blob/main/polaris.shopify.com/content/components/layout-and-structure/block-stack.mdx> |  |
| Block stack | b-docsUrl | docsUrl = archived MDX on GitHub (polaris-react-archive) | CONFIRMED | <https://github.com/Shopify/polaris-react-archive/blob/main/polaris.shopify.com/content/components/layout-and-structure/block-stack.mdx> | archive README also offers shopify.github.io/polaris-react-archive (rendered); GitHub MDX is the archived source |
| Block stack | f-description | description = MDX lede | CONFIRMED | <https://raw.githubusercontent.com/Shopify/polaris-react-archive/main/polaris.shopify.com/content/components/layout-and-structure/block-stack.mdx> |  |
| Block stack | lifecycle | lifecycle deprecated | CONFIRMED | <https://registry.npmjs.org/@shopify/polaris> | npm @shopify/polaris@13.9.5 deprecated: 'Polaris React is deprecated and no longer maintained. For bu...' |
| Block stack | d-prop | gap: Gap | CONFIRMED | <https://cdn.jsdelivr.net/npm/@shopify/polaris@13.9.5/build/ts/src/components/BlockStack/BlockStack.d.ts> |  |
| Block stack | d-prop | role: Extract<...> | CONFIRMED | <https://cdn.jsdelivr.net/npm/@shopify/polaris@13.9.5/build/ts/src/components/BlockStack/BlockStack.d.ts> |  |
| Block stack | d-prop | as: Element = 'div' | CONFIRMED | <https://cdn.jsdelivr.net/npm/@shopify/polaris@13.9.5/build/ts/src/components/BlockStack/BlockStack.d.ts> |  |
| Block stack | g-coverage | sizes stored as [] (UI renders 'documented-none') while coverage.sizes=not-documented | **REFUTED** -> fixed | <https://github.com/Shopify/polaris-react-archive/blob/main/polaris.shopify.com/content/components/> | source never states the component has no sizes; [] makes SizesBlock show documented-none |
| Button | a-exists | component named 'Button' exists | CONFIRMED | <https://shopify.dev/docs/api/app-home/latest/web-components/actions/button> |  |
| Button | b-docsUrl | docsUrl resolves to the component page | CONFIRMED | <https://shopify.dev/docs/api/app-home/latest/web-components/actions/button> |  |
| Button | f-description | description (shopify.dev frontmatter, first sentence) | CONFIRMED | <https://shopify.dev/docs/api/app-home/latest/web-components/actions/button> |  |
| Button | d-prop | commandFor: string | CONFIRMED | <https://cdn.jsdelivr.net/npm/@shopify/polaris-types@2.0.0/dist/custom-elements.json> |  |
| Button | d-prop | blur: event | CONFIRMED | <https://cdn.jsdelivr.net/npm/@shopify/polaris-types@2.0.0/dist/custom-elements.json> |  |
| Button | d-prop | disabled: boolean = false | CONFIRMED | <https://cdn.jsdelivr.net/npm/@shopify/polaris-types@2.0.0/dist/custom-elements.json> |  |
| Button | c-variants | variant auto/primary/secondary; tone neutral | CONFIRMED | <https://shopify.dev/docs/api/app-home/latest/web-components/actions/button> |  |
| Button | c-states | states disabled / loading | CONFIRMED | <https://shopify.dev/docs/api/app-home/latest/web-components/actions/button> |  |
| Button | e-guidance | a11y guidance: icon-only accessibilityLabel | CONFIRMED | <https://shopify.dev/docs/api/app-home/latest/web-components/actions/button> |  |
| Button | g-coverage | sizes stored as [] (UI renders 'documented-none') while coverage.sizes=not-documented | **REFUTED** -> fixed | <https://github.com/Shopify/polaris-react-archive/blob/main/polaris.shopify.com/content/components/> | source never states the component has no sizes; [] makes SizesBlock show documented-none |
| Setting toggle | a-exists | archived Polaris React doc titled 'Setting toggle' | CONFIRMED | <https://github.com/Shopify/polaris-react-archive/blob/main/polaris.shopify.com/content/components/deprecated/setting-toggle.mdx> |  |
| Setting toggle | b-docsUrl | docsUrl = archived MDX on GitHub (polaris-react-archive) | CONFIRMED | <https://github.com/Shopify/polaris-react-archive/blob/main/polaris.shopify.com/content/components/deprecated/setting-toggle.mdx> | archive README also offers shopify.github.io/polaris-react-archive (rendered); GitHub MDX is the archived source |
| Setting toggle | f-description | description = MDX lede | CONFIRMED | <https://raw.githubusercontent.com/Shopify/polaris-react-archive/main/polaris.shopify.com/content/components/deprecated/setting-toggle.mdx> |  |
| Setting toggle | lifecycle | lifecycle deprecated | CONFIRMED | <https://registry.npmjs.org/@shopify/polaris> | npm @shopify/polaris@13.9.5 deprecated: 'Polaris React is deprecated and no longer maintained. For bu...' |
| Setting toggle | d-prop | action: ComplexAction | CONFIRMED | <https://cdn.jsdelivr.net/npm/@shopify/polaris@13.9.5/build/ts/src/components/SettingToggle/SettingToggle.d.ts> |  |
| Setting toggle | d-prop | enabled: boolean | CONFIRMED | <https://cdn.jsdelivr.net/npm/@shopify/polaris@13.9.5/build/ts/src/components/SettingToggle/SettingToggle.d.ts> |  |
| Setting toggle | d-prop | children: React.ReactNode | CONFIRMED | <https://cdn.jsdelivr.net/npm/@shopify/polaris@13.9.5/build/ts/src/components/SettingToggle/SettingToggle.d.ts> |  |
| Setting toggle | g-coverage | sizes stored as [] (UI renders 'documented-none') while coverage.sizes=not-documented | **REFUTED** -> fixed | <https://github.com/Shopify/polaris-react-archive/blob/main/polaris.shopify.com/content/components/> | source never states the component has no sizes; [] makes SizesBlock show documented-none |
| Setting toggle | e-guidance | a11y guidance: <button> with switch role | CONFIRMED | <https://raw.githubusercontent.com/Shopify/polaris-react-archive/main/polaris.shopify.com/content/components/deprecated/setting-toggle.mdx> |  |
| Setting toggle | g-coverage | a11y.roles = not-documented | **REFUTED** -> fixed | <https://github.com/Shopify/polaris-react-archive/blob/main/polaris.shopify.com/content/components/deprecated/setting-toggle.mdx> | Accessibility section: 'implemented as an HTML <button> with the switch ARIA role' -> role switch is documented |
| Form layout | a-exists | archived Polaris React doc titled 'Form layout' | CONFIRMED | <https://github.com/Shopify/polaris-react-archive/blob/main/polaris.shopify.com/content/components/layout-and-structure/form-layout.mdx> |  |
| Form layout | b-docsUrl | docsUrl = archived MDX on GitHub (polaris-react-archive) | CONFIRMED | <https://github.com/Shopify/polaris-react-archive/blob/main/polaris.shopify.com/content/components/layout-and-structure/form-layout.mdx> | archive README also offers shopify.github.io/polaris-react-archive (rendered); GitHub MDX is the archived source |
| Form layout | f-description | description = MDX lede | CONFIRMED | <https://raw.githubusercontent.com/Shopify/polaris-react-archive/main/polaris.shopify.com/content/components/layout-and-structure/form-layout.mdx> |  |
| Form layout | lifecycle | lifecycle deprecated | CONFIRMED | <https://registry.npmjs.org/@shopify/polaris> | npm @shopify/polaris@13.9.5 deprecated: 'Polaris React is deprecated and no longer maintained. For bu...' |
| Form layout | d-prop | children: React.ReactNode | CONFIRMED | <https://cdn.jsdelivr.net/npm/@shopify/polaris@13.9.5/build/ts/src/components/FormLayout/FormLayout.d.ts> |  |
| Form layout | g-coverage | sizes stored as [] (UI renders 'documented-none') while coverage.sizes=not-documented | **REFUTED** -> fixed | <https://github.com/Shopify/polaris-react-archive/blob/main/polaris.shopify.com/content/components/> | source never states the component has no sizes; [] makes SizesBlock show documented-none |
| system | latest_version | latest_version 2.0.0 (@shopify/polaris-types) | CONFIRMED | <https://registry.npmjs.org/@shopify/polaris-types/latest> | npm latest=2.0.0 |
| token sets | license | redistribution restricted (Polaris License, field-of-use) | CONFIRMED | <https://registry.npmjs.org/@shopify/polaris-tokens/9.4.2> | npm: 'SEE LICENSE IN LICENSE.md' (Polaris license with Shopify field-of-use restriction); token_set.license_id is null |
| token shadow-button-primary-critical-inset [tokens-light-high-contrast | token-value | raw="-0.0625rem 0rem 0.0625rem 0rem rgba(0, 0, 0, 0.2) inset, 0. resolved=-0.0625rem 0rem 0.0625rem 0rem rgba( | CONFIRMED | <https://cdn.jsdelivr.net/npm/@shopify/polaris-tokens@9.4.2/dist/css/styles.css> | effective :root,.p-theme-light => -0.0625rem 0rem 0.0625rem 0rem rgba(0, 0, 0, 0.2) inset, 0.0 (theme block has no override) |
| token color-radio-button-icon-disabled [tokens-light] | token-value | raw="rgba(255, 255, 255, 1)" resolved=rgba(255, 255, 255, 1) | CONFIRMED | <https://cdn.jsdelivr.net/npm/@shopify/polaris-tokens@9.4.2/dist/css/styles.css> | effective :root,.p-theme-light => rgba(255, 255, 255, 1) (theme block has no override) |
| token color-input-bg-surface-active [tokens-dark-experimental] | token-value | raw="rgba(247, 247, 247, 1)" resolved=rgba(247, 247, 247, 1) | CONFIRMED | <https://cdn.jsdelivr.net/npm/@shopify/polaris-tokens@9.4.2/dist/css/styles.css> | effective :root,.p-theme-light => rgba(247, 247, 247, 1) (theme block has no override) |
| token motion-duration-200 [tokens-light] | token-value | raw="200ms" resolved=200ms | CONFIRMED | <https://cdn.jsdelivr.net/npm/@shopify/polaris-tokens@9.4.2/dist/css/styles.css> | effective :root,.p-theme-light => 200ms (theme block has no override) |
| token text-heading-3xl-font-line-height [tokens-light-high-contrast-ex | token-value | raw="var(--p-font-line-height-1200)" resolved=3rem | CONFIRMED | <https://cdn.jsdelivr.net/npm/@shopify/polaris-tokens@9.4.2/dist/css/styles.css> | effective :root,.p-theme-light => var(--p-font-line-height-1200) (theme block has no override) |
| token height-500 [tokens-light-high-contrast-experimental] | token-value | raw="1.25rem" resolved=1.25rem | CONFIRMED | <https://cdn.jsdelivr.net/npm/@shopify/polaris-tokens@9.4.2/dist/css/styles.css> | effective :root,.p-theme-light => 1.25rem (theme block has no override) |
| token width-100 [tokens-light-high-contrast-experimental] | token-value | raw="0.25rem" resolved=0.25rem | CONFIRMED | <https://cdn.jsdelivr.net/npm/@shopify/polaris-tokens@9.4.2/dist/css/styles.css> | effective :root,.p-theme-light => 0.25rem (theme block has no override) |
| token color-bg-fill-inverse [tokens-light-high-contrast-experimental] | token-value | raw="rgba(48, 48, 48, 1)" resolved=rgba(48, 48, 48, 1) | CONFIRMED | <https://cdn.jsdelivr.net/npm/@shopify/polaris-tokens@9.4.2/dist/css/styles.css> | effective :root,.p-theme-light => rgba(48, 48, 48, 1) (theme block has no override) |
| token color-bg-fill-success-hover [tokens-light-mobile] | token-value | raw="rgba(3, 94, 76, 1)" resolved=rgba(3, 94, 76, 1) | CONFIRMED | <https://cdn.jsdelivr.net/npm/@shopify/polaris-tokens@9.4.2/dist/css/styles.css> | effective :root,.p-theme-light => rgba(3, 94, 76, 1) (theme block has no override) |
| token color-avatar-three-bg-fill [tokens-light-mobile] | token-value | raw="rgba(44, 224, 212, 1)" resolved=rgba(44, 224, 212, 1) | CONFIRMED | <https://cdn.jsdelivr.net/npm/@shopify/polaris-tokens@9.4.2/dist/css/styles.css> | effective :root,.p-theme-light => rgba(44, 224, 212, 1) (theme block has no override) |
| Heading | g-random | examples = not-documented | CONFIRMED | <https://github.com/Shopify/polaris-react-archive/blob/main/polaris.shopify.com/content/components/deprecated/heading.mdx> | no examples in the archived MDX |
| Button group | g-random | variants = not-documented | **REFUTED** -> fixed | <https://cdn.jsdelivr.net/npm/@shopify/polaris@13.9.5/build/ts/src/components/ButtonGroup/ButtonGroup.d.ts> | `variant?: Variant` with `type Variant = 'segmented'` ('Styling variant for group') |
| Block stack | g-random | sizes = not-documented | CONFIRMED | <https://cdn.jsdelivr.net/npm/@shopify/polaris@13.9.5/build/ts/src/components/BlockStack/BlockStack.d.ts> | no size prop |
| Button | g-random | keyboard = not-documented | CONFIRMED | <https://shopify.dev/docs/api/app-home/latest/web-components/actions/button> | no key interactions (only 'can't receive keyboard focus' when disabled) |
| Setting toggle | g-random | keyboard = not-documented | CONFIRMED | <https://github.com/Shopify/polaris-react-archive/blob/main/polaris.shopify.com/content/components/deprecated/setting-toggle.mdx> | none |
| Form layout | g-random | responsive = not-documented | **REFUTED** -> fixed | <https://github.com/Shopify/polaris-react-archive/blob/main/polaris.shopify.com/content/components/layout-and-structure/form-layout.mdx> | example 'Field group': 'Field groups will wrap automatically on smaller screens' (keyword 'responsive') |
| Banner | g-after | states = not-documented | CONFIRMED | <https://shopify.dev/docs/api/app-home/latest/web-components/feedback-and-status-indicators/banner> | dismissible/hidden only (visibility, not an ATLAS canonical state) |
| Setting toggle | g-after | sizes = not-documented | CONFIRMED | <https://github.com/Shopify/polaris-react-archive/blob/main/polaris.shopify.com/content/components/deprecated/setting-toggle.mdx> | no sizes |

### atlassian

| Subject | Check | Claim | Verdict | Evidence | Note |
|---|---|---|---|---|---|
| Grid | a-exists | component named 'Grid' exists | CONFIRMED | <https://atlassian.design/components/page/grid/examples> |  |
| Grid | b-docsUrl | docsUrl resolves (client-side redirect to /components/page/grid/examples) | CONFIRMED | <https://atlassian.design/components/page/grid> | 200 stub with JS redirect; works in a browser |
| Grid | f-description | description (code page lead) | CONFIRMED | <https://atlassian.design/components/page/grid/code> |  |
| Grid | d-prop | theme: { columns: number; spacing: "compact" \| "comfortable" \| "cosy"; isNestedGrid?: boolean; } | CONFIRMED | <https://atlassian.design/components/page/grid/code> |  |
| Grid | d-prop | children: string \| number \| boolean \| React.ReactElement<any, string \| React.JSXElementConstructor<any>> \ | CONFIRMED | <https://atlassian.design/components/page/grid/code> |  |
| Grid | d-prop | spacing: "compact" \| "comfortable" \| "cosy" | CONFIRMED | <https://atlassian.design/components/page/grid/code> |  |
| Grid | c-variants | density compact/comfortable/cosy (spacing prop) | CONFIRMED | <https://atlassian.design/components/page/grid/code> |  |
| Grid | g-coverage | accessibility/keyboard = not-documented | CONFIRMED | <https://atlassian.design/components/page/grid/code> | Grid has Examples/Code/Changelog tabs only (no Usage/accessibility section) |
| Empty state | a-exists | component named 'Empty state' exists | CONFIRMED | <https://atlassian.design/components/empty-state/examples> |  |
| Empty state | b-docsUrl | docsUrl resolves (client-side redirect to /components/empty-state/examples) | CONFIRMED | <https://atlassian.design/components/empty-state> | 200 stub with JS redirect; works in a browser |
| Empty state | f-description | description (code page lead) | CONFIRMED | <https://atlassian.design/components/empty-state/code> |  |
| Empty state | d-prop | imageWidth: number | CONFIRMED | <https://atlassian.design/components/empty-state/code> |  |
| Empty state | d-prop | maxImageWidth: number = 160 | CONFIRMED | <https://atlassian.design/components/empty-state/code> |  |
| Empty state | d-prop | headingSize: "xsmall" \| "medium" = "medium" | CONFIRMED | <https://atlassian.design/components/empty-state/code> |  |
| Empty state | c-states | state isLoading | CONFIRMED | <https://atlassian.design/components/empty-state/code> |  |
| Empty state | e-guidance | a11y guidance: avoid jargon / descriptive links / alt text | CONFIRMED | <https://atlassian.design/components/empty-state/usage> |  |
| Country select | a-exists | component named 'Country select' exists | CONFIRMED | <https://atlassian.design/components/select/country-select/examples> |  |
| Country select | b-docsUrl | docsUrl resolves (client-side redirect to /components/select/country-select/examples) | CONFIRMED | <https://atlassian.design/components/select/country-select> | 200 stub with JS redirect; works in a browser |
| Country select | f-description | description (code page lead) | CONFIRMED | <https://atlassian.design/components/select/country-select/code> |  |
| Country select | d-prop | menuPortalTarget: HTMLElement | CONFIRMED | <https://atlassian.design/components/select/country-select/code> |  |
| Country select | d-prop | descriptionId: string | CONFIRMED | <https://atlassian.design/components/select/country-select/code> |  |
| Country select | d-prop | formatGroupLabel: (group: GroupBase<Country>) => React.ReactNode | CONFIRMED | <https://atlassian.design/components/select/country-select/code> |  |
| Country select | c-variants | appearance default/none/subtle | CONFIRMED | <https://atlassian.design/components/select/country-select/code> |  |
| Country select | c-states | states isDisabled/isLoading/isInvalid | CONFIRMED | <https://atlassian.design/components/select/country-select/code> |  |
| Country select | g-coverage | examples = not-documented | **REFUTED** -> fixed | <https://atlassian.design/components/select/country-select/examples> | Examples tab has one live example + code (no h2/h3 heading); adapter only lists headed example sections |
| Text | a-exists | component named 'Text' exists | CONFIRMED | <https://atlassian.design/components/primitives/text/examples> |  |
| Text | b-docsUrl | docsUrl resolves (client-side redirect to /components/primitives/text/examples) | CONFIRMED | <https://atlassian.design/components/primitives/text> | 200 stub with JS redirect; works in a browser |
| Text | f-description | description (code page lead) | CONFIRMED | <https://atlassian.design/components/primitives/text/code> |  |
| Text | d-prop | size: "small" \| "medium" \| "large" | CONFIRMED | <https://atlassian.design/components/primitives/text/code> |  |
| Text | d-prop | as: "em" \| "p" \| "span" \| "strong" | CONFIRMED | <https://atlassian.design/components/primitives/text/code> |  |
| Text | d-prop | role: string | CONFIRMED | <https://atlassian.design/components/primitives/text/code> |  |
| Text | e-guidance | a11y: minimum 4.5:1 contrast | CONFIRMED | <https://atlassian.design/components/primitives/text/usage> |  |
| Time picker | a-exists | component named 'Time picker' exists | CONFIRMED | <https://atlassian.design/components/datetime-picker/time-picker/examples> |  |
| Time picker | b-docsUrl | docsUrl resolves (client-side redirect to /components/datetime-picker/time-picker/examples) | CONFIRMED | <https://atlassian.design/components/datetime-picker/time-picker> | 200 stub with JS redirect; works in a browser |
| Time picker | f-description | description (code page lead) | CONFIRMED | <https://atlassian.design/components/datetime-picker/time-picker/code> |  |
| Time picker | d-prop | shouldShowTimeButton: boolean = false | CONFIRMED | <https://atlassian.design/components/datetime-picker/time-picker/code> |  |
| Time picker | d-prop | aria-describedby: string | CONFIRMED | <https://atlassian.design/components/datetime-picker/time-picker/code> |  |
| Time picker | d-prop | timeFormat: string | CONFIRMED | <https://atlassian.design/components/datetime-picker/time-picker/code> |  |
| Time picker | c-variants | spacing compact/default | CONFIRMED | <https://atlassian.design/components/datetime-picker/time-picker/code> |  |
| Time picker | c-states | states isInvalid/isDisabled/isOpen | CONFIRMED | <https://atlassian.design/components/datetime-picker/time-picker/code> |  |
| Time picker | e-guidance | a11y guidance: label prop / shouldShowTimeButton | CONFIRMED | <https://atlassian.design/components/datetime-picker/time-picker/usage> |  |
| Spotlight | a-exists | component named 'Spotlight' exists | CONFIRMED | <https://atlassian.design/components/spotlight/examples> |  |
| Spotlight | b-docsUrl | docsUrl resolves (client-side redirect to /components/spotlight/examples) | CONFIRMED | <https://atlassian.design/components/spotlight> | 200 stub with JS redirect; works in a browser |
| Spotlight | f-description | description (code page lead) | CONFIRMED | <https://atlassian.design/components/spotlight/code> |  |
| Spotlight | d-prop | PopoverContent.shouldDismissOnClickOutside: boolean | CONFIRMED | <https://atlassian.design/components/spotlight/code> |  |
| Spotlight | d-prop | SpotlightActions.testId: string | CONFIRMED | <https://atlassian.design/components/spotlight/code> |  |
| Spotlight | d-prop | SpotlightControls.testId: string | CONFIRMED | <https://atlassian.design/components/spotlight/code> |  |
| Spotlight | e-guidance | a11y: headline is accessible name | CONFIRMED | <https://atlassian.design/components/spotlight/usage> |  |
| Spotlight | e-focus | focusManagement documented | CONFIRMED | <https://atlassian.design/components/spotlight/usage> |  |
| pattern Info messages | pattern-exists | pattern 'Info messages' exists at docsUrl | CONFIRMED | <https://atlassian.design/foundations/content/designing-messages/info-messages> | title:  |
| pattern Info messages | pattern-description | description excerpt (71 chars) | CONFIRMED | <https://atlassian.design/foundations/content/designing-messages/info-messages> |  |
| pattern Info messages | pattern-classification | inferred type notifications | CONFIRMED | <https://atlassian.design/foundations/content/designing-messages/info-messages> | heuristic, labelled inferred |
| pattern Success messages | pattern-exists | pattern 'Success messages' exists at docsUrl | CONFIRMED | <https://atlassian.design/foundations/content/designing-messages/success-messages> | title:  |
| pattern Success messages | pattern-description | description excerpt (74 chars) | CONFIRMED | <https://atlassian.design/foundations/content/designing-messages/success-messages> |  |
| pattern Success messages | pattern-classification | inferred type notifications | CONFIRMED | <https://atlassian.design/foundations/content/designing-messages/success-messages> | heuristic, labelled inferred |
| pattern Style, grammar, and punctuation | pattern-exists | pattern 'Style, grammar, and punctuation' exists at docsUrl | CONFIRMED | <https://atlassian.design/foundations/content/language-and-grammar> | title:  |
| pattern Style, grammar, and punctuation | pattern-description | description excerpt (102 chars) | CONFIRMED | <https://atlassian.design/foundations/content/language-and-grammar> |  |
| pattern Style, grammar, and punctuation | pattern-classification | inferred type content-and-writing | CONFIRMED | <https://atlassian.design/foundations/content/language-and-grammar> | heuristic, labelled inferred |
| system | latest_version | latest_version 25.7.0 (@atlaskit/button) | CONFIRMED | <https://registry.npmjs.org/@atlaskit/button/latest> | npm latest=25.7.0; representative package (no single system version) |
| system | principles | principles: Trusted fundamentals before comprehensive patterns; Meet system needs before delivering individual | CONFIRMED | <https://atlassian.design/get-started/about-atlassian-design-system> |  |
| system | philosophy | values Foundational / Harmonious / Empowering, for everyone | CONFIRMED | <https://atlassian.design/get-started/about-atlassian-design-system> |  |
| token sets | license | redistribution restricted (ADS License) | UNVERIFIABLE | <https://cdn.jsdelivr.net/npm/@atlaskit/tokens@20.9.0/LICENSE> | conflicting: package LICENSE + npm field say Apache-2.0; ADS License Agreement (atlassian.design/license) claims field-of-use limits on code packages. ATLAS keeps the conservative 'restricted' (documented in registry not |
| token color.chart.green.boldest [theme-light] | token-value | raw="{color.palette.Green800}" resolved=#216E4E | CONFIRMED | <https://cdn.jsdelivr.net/npm/@atlaskit/tokens@20.9.0/dist/es2019/artifacts/tokens-raw/atlassian-light.js> | source original=Green800 value=#216E4E; palette color.palette.Green800=#216E4E |
| token color.background.accent.orange.bolder [theme-dark-increased-cont | token-value | raw="{color.palette.Orange200}" resolved=#FCE4A6 | CONFIRMED | <https://cdn.jsdelivr.net/npm/@atlaskit/tokens@20.9.0/dist/es2019/artifacts/tokens-raw/atlassian-dark-increased-contrast.js> | source original=Orange200 value=#FCE4A6; palette color.palette.Orange200=#FCE4A6 |
| token color.chart.categorical.1 [theme-light-increased-contrast] | token-value | raw="{color.palette.Teal800}" resolved=#206A83 | CONFIRMED | <https://cdn.jsdelivr.net/npm/@atlaskit/tokens@20.9.0/dist/es2019/artifacts/tokens-raw/atlassian-light-increased-contrast.js> | source original=Teal800 value=#206A83; palette color.palette.Teal800=#206A83 |
| token color.background.danger.subtler.hovered [theme-dark] | token-value | raw="{color.palette.Red850}" resolved=#872821 | CONFIRMED | <https://cdn.jsdelivr.net/npm/@atlaskit/tokens@20.9.0/dist/es2019/artifacts/tokens-raw/atlassian-dark.js> | source original=Red850 value=#872821; palette color.palette.Red850=#872821 |
| token color.background.accent.purple.bolder [theme-light] | token-value | raw="{color.palette.Purple700}" resolved=#964AC0 | CONFIRMED | <https://cdn.jsdelivr.net/npm/@atlaskit/tokens@20.9.0/dist/es2019/artifacts/tokens-raw/atlassian-light.js> | source original=Purple700 value=#964AC0; palette color.palette.Purple700=#964AC0 |
| token color.chart.danger.bold [theme-dark] | token-value | raw="{color.palette.Red250}" resolved=#FFB8B2 | CONFIRMED | <https://cdn.jsdelivr.net/npm/@atlaskit/tokens@20.9.0/dist/es2019/artifacts/tokens-raw/atlassian-dark.js> | source original=Red250 value=#FFB8B2; palette color.palette.Red250=#FFB8B2 |
| token color.text.warning.inverse [theme-light] | token-value | raw="{color.palette.Neutral1000}" resolved=#292A2E | CONFIRMED | <https://cdn.jsdelivr.net/npm/@atlaskit/tokens@20.9.0/dist/es2019/artifacts/tokens-raw/atlassian-light.js> | source original=Neutral1000 value=#292A2E; palette color.palette.Neutral1000=#292A2E |
| token color.chart.red.bolder.hovered [theme-light-increased-contrast] | token-value | raw="{color.palette.Red1000}" resolved=#42221F | CONFIRMED | <https://cdn.jsdelivr.net/npm/@atlaskit/tokens@20.9.0/dist/es2019/artifacts/tokens-raw/atlassian-light-increased-contrast.js> | source original=Red1000 value=#42221F; palette color.palette.Red1000=#42221F |
| token color.chart.success.bold [theme-dark-increased-contrast] | token-value | raw="{color.palette.Lime300}" resolved=#B3DF72 | CONFIRMED | <https://cdn.jsdelivr.net/npm/@atlaskit/tokens@20.9.0/dist/es2019/artifacts/tokens-raw/atlassian-dark-increased-contrast.js> | source original=Lime300 value=#B3DF72; palette color.palette.Lime300=#B3DF72 |
| token color.background.discovery.subtle [theme-light-increased-contras | token-value | raw="{color.palette.Purple300}" resolved=#D8A0F7 | CONFIRMED | <https://cdn.jsdelivr.net/npm/@atlaskit/tokens@20.9.0/dist/es2019/artifacts/tokens-raw/atlassian-light-increased-contrast.js> | source original=Purple300 value=#D8A0F7; palette color.palette.Purple300=#D8A0F7 |
| Grid | g-random | accessibility = not-documented | CONFIRMED | <https://atlassian.design/components/page/grid/code> | Examples/Code/Changelog tabs only |
| Empty state | g-random | a11y.screenReader = not-documented | CONFIRMED | <https://atlassian.design/components/empty-state/usage> | no screen-reader text in the usage Accessibility section |
| Country select | g-random | examples = not-documented | **REFUTED** -> fixed | <https://atlassian.design/components/select/country-select/examples> | same claim as the targeted check: one un-headed live example |
| Text | g-random | a11y.roles = not-documented | CONFIRMED | <https://atlassian.design/components/primitives/text/usage> | no role mentioned |
| Time picker | g-random | a11y.ariaPattern = not-documented | CONFIRMED | <https://atlassian.design/components/datetime-picker/time-picker/usage> | no WAI-ARIA pattern named |
| Spotlight | g-random | responsive = not-documented | CONFIRMED | <https://atlassian.design/components/spotlight/usage> | 'Responsive' only appears in site navigation |
| Icon button | g-after | a11y.focusManagement = not-documented | CONFIRMED | <https://atlassian.design/components/button/icon-button/usage> | 'Focus ring' / 'Focusable' occur only in site navigation |
| Radio | g-after | sizes = not-documented | CONFIRMED | <https://atlassian.design/components/radio/code> | no size prop |

### govuk-design-system

| Subject | Check | Claim | Verdict | Evidence | Note |
|---|---|---|---|---|---|
| Pagination | a-exists | component named 'Pagination' exists | CONFIRMED | <https://design-system.service.gov.uk/components/pagination/> |  |
| Pagination | b-docsUrl | docsUrl resolves to the component page | CONFIRMED | <https://design-system.service.gov.uk/components/pagination/> |  |
| Pagination | f-description | description = docs frontmatter description | CONFIRMED | <https://raw.githubusercontent.com/alphagov/govuk-design-system/main/src/components/pagination/index.md> |  |
| Pagination | d-prop | previous.html: string required=False default=Previous page | CONFIRMED | <https://github.com/alphagov/govuk-frontend/blob/v6.6.0/packages/govuk-frontend/src/govuk/components/pagination/pagination.yaml> |  |
| Pagination | d-prop | items[].ellipsis: boolean required=False | CONFIRMED | <https://github.com/alphagov/govuk-frontend/blob/v6.6.0/packages/govuk-frontend/src/govuk/components/pagination/pagination.yaml> |  |
| Pagination | d-prop | items: array required=False | CONFIRMED | <https://github.com/alphagov/govuk-frontend/blob/v6.6.0/packages/govuk-frontend/src/govuk/components/pagination/pagination.yaml> |  |
| Pagination | c-variants | variant block (.govuk-pagination--block) | CONFIRMED | <https://design-system.service.gov.uk/components/pagination/> |  |
| Pagination | c-states | state Current (items[].current) | CONFIRMED | <https://raw.githubusercontent.com/alphagov/govuk-frontend/v6.6.0/packages/govuk-frontend/src/govuk/components/pagination/pagination.yaml> |  |
| Pagination | e-screenReader | screenReader: page number in <title> | CONFIRMED | <https://design-system.service.gov.uk/components/pagination/> |  |
| Pagination | f-excerpt | a11y guidance starts 'This causes problems for keyboard users.' | **REFUTED** -> fixed | <https://design-system.service.gov.uk/components/pagination/> | excerpt drops the antecedent: on the page 'This' refers to the infinite-scroll technique; stored text reads as if pagination causes keyboard problems |
| Table | a-exists | component named 'Table' exists | CONFIRMED | <https://design-system.service.gov.uk/components/table/> |  |
| Table | b-docsUrl | docsUrl resolves to the component page | CONFIRMED | <https://design-system.service.gov.uk/components/table/> |  |
| Table | f-description | description = docs frontmatter description | CONFIRMED | <https://raw.githubusercontent.com/alphagov/govuk-design-system/main/src/components/table/index.md> |  |
| Table | d-prop | rows[].rowspan: integer required=False | CONFIRMED | <https://github.com/alphagov/govuk-frontend/blob/v6.6.0/packages/govuk-frontend/src/govuk/components/table/table.yaml> |  |
| Table | d-prop | head[].classes: string required=False | CONFIRMED | <https://github.com/alphagov/govuk-frontend/blob/v6.6.0/packages/govuk-frontend/src/govuk/components/table/table.yaml> |  |
| Table | d-prop | rows[].text: string required=True | CONFIRMED | <https://github.com/alphagov/govuk-frontend/blob/v6.6.0/packages/govuk-frontend/src/govuk/components/table/table.yaml> |  |
| Table | c-variants | variant small-text-until-tablet | CONFIRMED | <https://design-system.service.gov.uk/components/table/> |  |
| Table | e-guidance | guidance: scope attribute | CONFIRMED | <https://design-system.service.gov.uk/components/table/> |  |
| Error message | a-exists | component named 'Error message' exists | CONFIRMED | <https://design-system.service.gov.uk/components/error-message/> |  |
| Error message | b-docsUrl | docsUrl resolves to the component page | CONFIRMED | <https://design-system.service.gov.uk/components/error-message/> |  |
| Error message | f-description | description = docs frontmatter description | CONFIRMED | <https://raw.githubusercontent.com/alphagov/govuk-design-system/main/src/components/error-message/index.md> |  |
| Error message | d-prop | classes: string required=False | CONFIRMED | <https://github.com/alphagov/govuk-frontend/blob/v6.6.0/packages/govuk-frontend/src/govuk/components/error-message/error-message.yaml> |  |
| Error message | d-prop | html: string required=True | CONFIRMED | <https://github.com/alphagov/govuk-frontend/blob/v6.6.0/packages/govuk-frontend/src/govuk/components/error-message/error-message.yaml> |  |
| Error message | d-prop | attributes: object required=False | CONFIRMED | <https://github.com/alphagov/govuk-frontend/blob/v6.6.0/packages/govuk-frontend/src/govuk/components/error-message/error-message.yaml> |  |
| Error message | e-guidance | guidance: hidden 'Error:' prefix | CONFIRMED | <https://design-system.service.gov.uk/components/error-message/> |  |
| Back link | a-exists | component named 'Back link' exists | CONFIRMED | <https://design-system.service.gov.uk/components/back-link/> |  |
| Back link | b-docsUrl | docsUrl resolves to the component page | CONFIRMED | <https://design-system.service.gov.uk/components/back-link/> |  |
| Back link | f-description | description = docs frontmatter description | CONFIRMED | <https://raw.githubusercontent.com/alphagov/govuk-design-system/main/src/components/back-link/index.md> |  |
| Back link | d-prop | text: string required=False default=Back | CONFIRMED | <https://github.com/alphagov/govuk-frontend/blob/v6.6.0/packages/govuk-frontend/src/govuk/components/back-link/back-link.yaml> |  |
| Back link | d-prop | attributes: object required=False | CONFIRMED | <https://github.com/alphagov/govuk-frontend/blob/v6.6.0/packages/govuk-frontend/src/govuk/components/back-link/back-link.yaml> |  |
| Back link | d-prop | html: string required=False default=Back | CONFIRMED | <https://github.com/alphagov/govuk-frontend/blob/v6.6.0/packages/govuk-frontend/src/govuk/components/back-link/back-link.yaml> |  |
| Back link | c-variants | variant inverse | CONFIRMED | <https://design-system.service.gov.uk/components/back-link/> |  |
| Back link | e-wcag | wcag 1.4.3 contrast guidance | CONFIRMED | <https://design-system.service.gov.uk/components/back-link/> |  |
| Feedback | a-exists | component named 'Feedback' exists | CONFIRMED | <https://design-system.service.gov.uk/components/feedback/> |  |
| Feedback | b-docsUrl | docsUrl resolves to the component page | CONFIRMED | <https://design-system.service.gov.uk/components/feedback/> |  |
| Feedback | f-description | description = docs frontmatter description | CONFIRMED | <https://raw.githubusercontent.com/alphagov/govuk-design-system/main/src/components/feedback/index.md> |  |
| Feedback | d-prop | text: string required=True | CONFIRMED | <https://github.com/alphagov/govuk-frontend/blob/v6.6.0/packages/govuk-frontend/src/govuk/components/feedback/feedback.yaml> |  |
| Feedback | d-prop | headingLevel: integer required=False | CONFIRMED | <https://github.com/alphagov/govuk-frontend/blob/v6.6.0/packages/govuk-frontend/src/govuk/components/feedback/feedback.yaml> |  |
| Feedback | d-prop | titleHtml: string required=True | CONFIRMED | <https://github.com/alphagov/govuk-frontend/blob/v6.6.0/packages/govuk-frontend/src/govuk/components/feedback/feedback.yaml> |  |
| Feedback | lifecycle | lifecycle beta (GOV.UK 'trial' status) | CONFIRMED | <https://design-system.service.gov.uk/components/feedback/> | ATLAS maps GOV.UK 'trial' to beta  |
| Select | a-exists | component named 'Select' exists | CONFIRMED | <https://design-system.service.gov.uk/components/select/> |  |
| Select | b-docsUrl | docsUrl resolves to the component page | CONFIRMED | <https://design-system.service.gov.uk/components/select/> |  |
| Select | f-description | description = docs frontmatter description | CONFIRMED | <https://raw.githubusercontent.com/alphagov/govuk-design-system/main/src/components/select/index.md> |  |
| Select | d-prop | describedBy: string required=False | CONFIRMED | <https://github.com/alphagov/govuk-frontend/blob/v6.6.0/packages/govuk-frontend/src/govuk/components/select/select.yaml> |  |
| Select | d-prop | formGroup.attributes: object required=False | CONFIRMED | <https://github.com/alphagov/govuk-frontend/blob/v6.6.0/packages/govuk-frontend/src/govuk/components/select/select.yaml> |  |
| Select | d-prop | formGroup.beforeInput.text: string required=True | CONFIRMED | <https://github.com/alphagov/govuk-frontend/blob/v6.6.0/packages/govuk-frontend/src/govuk/components/select/select.yaml> |  |
| Select | c-states | states Disabled/Error | CONFIRMED | <https://raw.githubusercontent.com/alphagov/govuk-frontend/v6.6.0/packages/govuk-frontend/src/govuk/components/select/select.yaml> |  |
| Select | f-excerpt | a11y.screenReader = 'While screen readers will read out the link text, they usually do not tell users the text | **REFUTED** -> fixed | <https://design-system.service.gov.uk/components/select/> | sentence is about links in hint text ('Do not use links in hint text.' precedes it); stored as the Select's screen-reader behaviour without that context |
| pattern National Insurance numbers | pattern-exists | pattern 'National Insurance numbers' exists at docsUrl | CONFIRMED | <https://design-system.service.gov.uk/patterns/national-insurance-numbers/> | title: National Insurance numbers - GOV.UK Design System |
| pattern National Insurance numbers | pattern-description | description excerpt (52 chars) | CONFIRMED | <https://design-system.service.gov.uk/patterns/national-insurance-numbers/> |  |
| pattern National Insurance numbers | pattern-classification | inferred type data-entry | CONFIRMED | <https://design-system.service.gov.uk/patterns/national-insurance-numbers/> | heuristic, labelled inferred |
| pattern Interruption pages | pattern-exists | pattern 'Interruption pages' exists at docsUrl | CONFIRMED | <https://design-system.service.gov.uk/patterns/interruption-pages/> | title: Interruption pages - GOV.UK Design System |
| pattern Interruption pages | pattern-description | description excerpt (57 chars) | CONFIRMED | <https://design-system.service.gov.uk/patterns/interruption-pages/> |  |
| pattern Confirmation pages | pattern-exists | pattern 'Confirmation pages' exists at docsUrl | CONFIRMED | <https://design-system.service.gov.uk/patterns/confirmation-pages/> | title: Confirmation pages - GOV.UK Design System |
| pattern Confirmation pages | pattern-description | description excerpt (46 chars) | CONFIRMED | <https://design-system.service.gov.uk/patterns/confirmation-pages/> |  |
| pattern Confirmation pages | pattern-classification | inferred type dialogs-and-confirmation | **REFUTED** (open) | <https://design-system.service.gov.uk/patterns/confirmation-pages/> | GOV.UK confirmation pages are end-of-transaction pages ('Let users know they've completed a transaction'), not flow interruptions; taxonomy alias 'confirmation' is too broad (label is 'inferred') |
| system | latest_version | latest_version 6.6.0 (govuk-frontend) | CONFIRMED | <https://registry.npmjs.org/govuk-frontend/latest> | npm latest=6.6.0 |
| system | principles | principles: Start with user needs; Do less; Design with data; Do the hard work to make it simple; Iterate. The | CONFIRMED | <https://www.gov.uk/guidance/government-design-principles> |  |
| token sets | license | license MIT / redistribution permitted | CONFIRMED | <https://registry.npmjs.org/govuk-frontend/6.6.0> | npm license field: MIT |
| token govuk-palette.yellow.tint-95 [colour-palette] | token-value | raw="#fffdf2" resolved=#fffdf2 | CONFIRMED | <https://cdn.jsdelivr.net/npm/govuk-frontend@6.6.0/dist/govuk/settings/_colours-palette--internal.scss#L86> | L86: "tint-95": #fffdf2, |
| token govuk-gutter-half [layout] | token-value | raw="math.div({govuk-gutter}, 2)" resolved=math.div(30px, 2) | CONFIRMED | <https://cdn.jsdelivr.net/npm/govuk-frontend@6.6.0/dist/govuk/settings/_measurements.scss#L44> | L44: $govuk-gutter-half: math.div($govuk-gutter, 2);; govuk-gutter: $govuk-gutter: 30px !default;; resolved value left as unevaluated expression 'math.div(30px, 2)' (=15px) |
| token govuk-grid-widths.one-half [layout] | token-value | raw="math.div(100%, 2)" resolved=math.div(100%, 2) | CONFIRMED | <https://cdn.jsdelivr.net/npm/govuk-frontend@6.6.0/dist/govuk/settings/_measurements.scss#L26> | L26: one-half: math.div(100%, 2), |
| token govuk-palette.black.primary [colour-palette] | token-value | raw="#0b0c0c" resolved=#0b0c0c | CONFIRMED | <https://cdn.jsdelivr.net/npm/govuk-frontend@6.6.0/dist/govuk/settings/_colours-palette--internal.scss#L97> | L97: "primary": #0b0c0c, |
| token govuk-colours-organisations.department-for-business-innovation-s | token-value | raw="#ff4328" resolved=#ff4328 | CONFIRMED | <https://cdn.jsdelivr.net/npm/govuk-frontend@6.6.0/dist/govuk/settings/_colours-organisations.scss#L33> | L33: colour: #ff4328, |
| token govuk-spacing-responsive-scale.3.null [spacing] | token-value | raw="15px" resolved=15px | CONFIRMED | <https://cdn.jsdelivr.net/npm/govuk-frontend@6.6.0/dist/govuk/settings/_spacing.scss#L50> | L50: null: 15px |
| token govuk-colours-organisations.department-for-transport.colour [org | token-value | raw="#006853" resolved=#006853 | CONFIRMED | <https://cdn.jsdelivr.net/npm/govuk-frontend@6.6.0/dist/govuk/settings/_colours-organisations.scss#L69> | L69: colour: #006853 |
| token govuk-palette.green.primary [colour-palette] | token-value | raw="#0f7a52" resolved=#0f7a52 | CONFIRMED | <https://cdn.jsdelivr.net/npm/govuk-frontend@6.6.0/dist/govuk/settings/_colours-palette--internal.scss#L27> | L27: "primary": #0f7a52, |
| token govuk-typography-scale.80.null.line-height [typography] | token-value | raw="55px" resolved=55px | CONFIRMED | <https://cdn.jsdelivr.net/npm/govuk-frontend@6.6.0/dist/govuk/settings/_typography-responsive.scss#L47> | L47: line-height: 55px |
| token govuk-palette.red.primary [colour-palette] | token-value | raw="#ca3535" resolved=#ca3535 | CONFIRMED | <https://cdn.jsdelivr.net/npm/govuk-frontend@6.6.0/dist/govuk/settings/_colours-palette--internal.scss#L64> | L64: "primary": #ca3535, |
| Pagination | g-random | keyboard = not-documented | CONFIRMED | <https://design-system.service.gov.uk/components/pagination/> | keyboard users are mentioned; no key interaction is documented |
| Table | g-random | states = not-documented | CONFIRMED | <https://design-system.service.gov.uk/components/table/> | none |
| Error message | g-random | a11y.wcagCriteria = not-documented | CONFIRMED | <https://design-system.service.gov.uk/components/error-message/> | no WCAG reference |
| Back link | g-random | a11y.roles = not-documented | CONFIRMED | <https://design-system.service.gov.uk/components/back-link/> | none |
| Feedback | g-random | sizes = not-documented | CONFIRMED | <https://design-system.service.gov.uk/components/feedback/> | none |
| Select | g-random | sizes = not-documented | CONFIRMED | <https://design-system.service.gov.uk/components/select/> | no width modifiers |
| Pagination | g-after | a11y.roles = not-documented | CONFIRMED | <https://design-system.service.gov.uk/components/pagination/> | only a changelog line about removing a redundant role |
| Warning text | g-after | keyboard = not-documented | CONFIRMED | <https://design-system.service.gov.uk/components/warning-text/> | 'focus state styles' is a navigation link |


