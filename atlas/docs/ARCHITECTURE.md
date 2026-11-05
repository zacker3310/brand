# ATLAS architecture

ATLAS is a navigational and comparative index of design systems. It stores **concise, source-attributed
facts** (component names, documented variants/states/props, token values, accessibility guidance, URLs) and
links back to official documentation. It is not a mirror.

```
                ┌───────────────────────── data/registry/*.json ─────────────────────────┐
                │  100 researched candidates: URLs, license, maintenance, checks (evidence) │
                └──────────────┬──────────────────────────────────────────────────────────┘
                               │ npm run db:seed (Zod-validated, idempotent)
                               ▼
┌──────────────┐  enqueue  ┌──────────────────┐  claim (SKIP LOCKED)  ┌──────────────────────────────┐
│ CLI / Ops UI │──────────▶│  ingestion_job   │◀──────────────────────│ worker (scripts/worker.ts)    │
└──────────────┘           └──────────────────┘                       │  discover → fetch → parse →   │
                                                                       │  normalize → validate →       │
                                                                       │  publish → reindex            │
                                                                       └──────┬───────────────┬────────┘
                                         PoliteFetcher (robots, rate limits,  │               │ SourceAdapter
                                         conditional GET, disk cache) ◀───────┘               │ (per system)
                                                                                              ▼
   source / source_document / source_snapshot / parsed_fragment / extraction  (observations, quarantine)
                                                │ promote valid only
                                                ▼
   design_system · component(+variant/state/property/a11y/...) · token_set/token/token_alias · design_pattern
   verification_evidence (provenance) · change_event (history) · search_document (search index)
                                                │
                                                ▼
                         Next.js 16 App Router (server components read via Drizzle)
                         /systems  /components  /compare  /tokens  /patterns  /collections  /ops  /api/*
```

## Modules

| Path | Responsibility |
|---|---|
| `src/db/schema.ts` | Canonical schema (Drizzle). Natural unique keys make every ingestion write an idempotent upsert. |
| `src/lib/contracts` | Zod contracts shared by registry, adapters, engine, API and UI. |
| `src/lib/taxonomy` | ATLAS component/pattern taxonomy, canonical states, synonyms, frameworks, platforms, classifiers. |
| `src/lib/tokens` | Token tree flattening (DTCG / Style Dictionary), CSS/SCSS static parsing, alias graph resolution with cycle detection, color/contrast, formatting, validation, scale comparison. |
| `src/ingestion/http` | `PoliteFetcher`: the only door to the network for ingestion. |
| `src/ingestion/types.ts` | `SourceAdapter` interface: `discover / fetch / parse / normalize / validate / getChanges`. |
| `src/ingestion/adapters/*` | One module per source family + the adapter registry. New systems never require engine changes. |
| `src/ingestion/engine/*` | Queue, worker runtime, stages, generic validation, publish (promotion, retirement, evidence, change events, coverage). |
| `src/ingestion/registry/*` | Registry import + taxonomy/reference seed. |
| `src/server/search/*` | `SearchProvider` abstraction, Postgres provider, query understanding, document builders. |
| `src/server/queries/*` | Read models for UI pages (all request-time, via `readDb()`). |
| `src/app/*` | Pages, route handlers (`/api/*`), Ops. |

## Ingestion stages

1. **Discover**: adapter enumerates documents (repo files via raw.githubusercontent.com, package files via jsDelivr, sitemaps, docs pages). Upserts `source` + `source_document`; documents no longer discovered are marked `gone`.
2. **Fetch**: conditional GET (ETag / Last-Modified); new content hash ⇒ new `source_snapshot`. Errors become `ingestion_error` rows; partial failure ⇒ run status `partial`. Checkpointed per document.
3. **Parse**: static parsing only, cached in `parsed_fragment` keyed by (document, adapter version, content hash).
4. **Normalize**: fragments ⇒ `NormalizedBundle` (contract-validated).
5. **Validate**: generic rules (required fields, URL validity, duplicates, token value validity, unknown taxonomy types, framework consistency, suspicious results, missing evidence) + adapter rules ⇒ `extraction` rows with issues.
6. **Publish**: valid/warning extractions promoted in transactions; unchanged content hash ⇒ no write; changed ⇒ child rows replaced and a `change_event` recorded; absent ⇒ `retired`. Token aliases resolved across the system's sets.
7. **Enrich**: taxonomy classification (marked `inferred`), coverage summaries, search documents.
8. **Refresh**: re-running is incremental (304s, unchanged hashes skip work); change events form the history.

## Trust model

- Registry facts are verified by HTTP checks recorded as evidence (`registry-research:*`).
- Adapter facts carry evidence with source URL, retrieval time, content hash, extraction method and location.
- Heuristics are always labelled `inferred`. Missing values carry an explicit coverage state.
- Admin operations (`/ops` mutations, `/api/ops/*`) require `ATLAS_ADMIN_TOKEN` (or localhost in dev).

## Extension points (not implemented yet)

| Future capability | Seam |
|---|---|
| Figma plugin / browser / VS Code extensions, MCP server | `/api/*` JSON endpoints (typed by `src/lib/contracts`) |
| Semantic & visual similarity search | `SearchProvider` interface; `search_document` as the indexing feed; pgvector column can be added per entity |
| Design system change monitoring | `change_event` + scheduled `refresh-all` jobs |
| Private / team catalogs | `design_system.doc_access`, `collection.owner_id`, `app_user` |
| Token migration analysis, cross-framework translation | `token_alias` graph, `compare.ts` scale alignment, `component_property` per implementation |
| Compliance audits | `component_accessibility` + coverage maps + evidence |
