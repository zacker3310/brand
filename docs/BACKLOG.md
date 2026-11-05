# ATLAS backlog

Ordered by leverage (impact on catalog truthfulness and usefulness per unit of effort). Items come from
workstream reports, adversarial audits (`docs/audit/`) and integration findings. "Why" states the
concrete gap observed, not a hypothetical.

## 1. Data depth (highest leverage)

1. **Dedicated adapters for the most-used inventory systems.** 74 systems have a component *inventory*
   (names + docs links) from the generic adapter. Priorities by demand and source quality: Bootstrap,
   Chakra UI, Mantine, Cloudscape, Salesforce Lightning (SLDS repo `docs.mdx` is structured), Twilio Paste,
   MongoDB LeafyGreen, PatternFly (`@patternfly/*` ships docs JSON), Gestalt, shadcn/ui (registry JSON),
   USWDS, Element Plus, Vuetify (API JSON in repo), PrimeReact/PrimeVue/PrimeNG (API docs JSON).
   Each needs props, variants, a11y and tokens; the engine needs no change.
2. **Apple HIG.** Docs are a DocC app; components require walking DocC JSON two levels deep
   (`components.json` → category files). A dedicated adapter can do this statically.
3. **Client-rendered docs** (Material Design 3 pages, Base Web, HPE, Helsinki, Pluralsight): decide policy
   for rendering in an isolated sandbox (separate origin/process, no network beyond the source host,
   robots-respecting) vs. staying metadata-level. Today they are honestly marked `not-extracted`.
4. **More token themes**: Primer dark-dimmed / high-contrast / colorblind; Carbon contextual layers;
   Material Web composite typescale entries; MUI computed theme values (shadows, typography) are code-only.
5. **Figma resources.** figma.com blocks automated clients (403), so `figmaUrl` is set only when an
   official page links the exact file. Add a manual-review workflow in Ops to confirm official Figma links.

## 2. Contract & engine

1. **Lazy / isolated adapter loading.** `src/ingestion/adapters/index.ts` imports every adapter; one
   half-edited adapter breaks seeding, dry runs and ingestion for all systems (hit several times in
   parallel development). Map id → dynamic import with per-adapter error isolation.
2. **Structured web-component APIs**: `events`, `slots`, `cssParts`, `methods` on `NormalizedComponent`;
   `attribute` on `NormalizedProperty` (Fluent, Material Web, Spectrum, Polaris already parse these and
   currently fold them into descriptions/evidence).
3. **Token set modes** separate from theme (Spectrum desktop/mobile scale, Primer coarse/fine pointer):
   a `mode` column + mode-aware resolution instead of duplicating scale-dependent aliases.
4. **Token resolution**: an `unevaluated` state when a reference is substituted into an unevaluated function
   (`nhsuk-tint({x}, 78%)`, `calc()`); consult `references[]` for component-scoped CSS variables (Ant Design
   Mobile `var(--gap)`); prefer own-set targets in the cssVar index.
5. **Cross-system relationships**: `targetSystemSlug` on relationships (Material Web `md-filled-button`
   implements M3 Buttons; React Spectrum implements Spectrum).
6. **Richer states/lifecycle**: `supported: boolean` on documented states (Spectrum), an
   `intent-to-deprecate` lifecycle (Atlassian "Caution"), framework support level `community` on
   component frameworks (Carbon Angular/Vue).
7. **Extraction retention**: `extraction` rows accumulate per run; add a retention job (keep latest N runs
   per system plus quarantined rows) — the lookup index exists (`extraction_lookup_idx`).
8. **Per-host rate overrides** in `PoliteFetcher` (raw.githubusercontent.com could take a shorter gap;
   Fluent React spends most of its 3.5 min waiting on 750 ms spacing).
9. **Schema additions requested by UI**: `design_pattern.classification_method`,
   `comparison.options jsonb` (component picks, now encoded in `criteria`), `token_set.retrieved_at`,
   index `token(token_set_id, category)`.

## 3. Taxonomy & search

1. **Classifier edge cases**: "Table header" → navigation-bar (head-noun rule still matches `header`);
   "Notification banner" contained match. Consider a learned/curated override table per system with
   evidence, surfaced in Ops for review.
2. **Canonical tag vocabulary** so search tag words map to real tag slugs (today they boost guessed slugs).
3. **Pattern groups** (`PATTERN_GROUPS`) for navigation of the pattern library; a `drag-and-drop` pattern type.
4. **Semantic search**: evaluate pgvector embeddings against the current FTS + trigram baseline on a labelled
   query set; adopt only with measured gains (ADR 0006).

## 4. Product

1. **Authenticated accounts** (the `app_user` table exists): migrate anonymous collections to accounts.
2. **Scheduled refresh + change monitoring**: a cron that enqueues `incremental` runs, plus a "What changed"
   feed from `change_event` with per-system subscriptions.
3. **Comparison**: increment `view_count` safely (not on prefetch), editorially featured comparisons.
4. **Extension surfaces** on the existing `/api/*` + OpenAPI document: MCP server, Figma plugin, VS Code
   and browser extensions.

## 5. Operations

1. Move the repository's former brand assets consumers (acker.cloud, thrivecmd.com Super.so injections) to
   the immutable jsDelivr pin `@fdace58` (the files no longer exist on `main`).
2. CI: run typecheck, lint, unit/integration and e2e (against a seeded fixture DB) on every push.
3. Container images for web + worker (Dockerfile exists; add a worker entrypoint and healthchecks).
