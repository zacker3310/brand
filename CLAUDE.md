# CLAUDE.md: ATLAS

This repository is ATLAS, a design system intelligence platform: a source-attributed catalog of
real-world design systems (components, tokens, patterns, accessibility guidance) with cross-system
comparison. It replaced the former brand-asset contents of this repo.

App root: `atlas/` (moving to the repository root; paths below are relative to the app root).

## Stack

Next.js 16 App Router, React 19, TypeScript strict (`noUncheckedIndexedAccess`), Tailwind CSS 4 +
shadcn/ui (Radix), Drizzle ORM, PostgreSQL 16 (`pg_trgm`, `unaccent`), Zod 4, Vitest, Playwright + axe.

Next 16 differs from older versions: `params`/`searchParams` are Promises, `proxy.ts` replaces
middleware, `next lint` is gone (use `eslint`). Read `node_modules/next/dist/docs/` before using a
Next API you haven't verified. UI reads go through `readDb()` (`src/server/queries/db.ts`), which calls
`connection()` so DB-backed routes render at request time.

## Commands

```bash
npm run db:migrate   # extensions + schema
npm run db:seed      # taxonomy, frameworks, platforms, data/registry/*.json
npm run ingest -- --system <slug> --inline    # or --all, --resume <runId>, --status
npm run worker       # durable job worker
npm run dev | build | start
npm run typecheck && npm run lint && npm test && npm run test:e2e
npm run quality      # docs/DATA_QUALITY.md from the live DB
npx tsx scripts/adapter-dry-run.ts <adapterId> <systemSlug> [--limit N]   # adapter without DB
npx tsx scripts/registry/check.ts <url>... [--npm <pkg>]                  # verify registry facts
npx tsx scripts/registry/validate.ts                                      # registry invariants
```

## Layout

| Path | What |
|---|---|
| `src/db/schema.ts` | Canonical schema. Observations (`source*`, `parsed_fragment`, `extraction`) are separate from published records. |
| `src/lib/contracts` | Zod contracts shared by registry, adapters, engine, API, UI. |
| `src/lib/taxonomy` | ATLAS component/pattern taxonomy, canonical states, synonyms, frameworks, platforms. |
| `src/lib/tokens` | Token flattening (DTCG/Style Dictionary), CSS/SCSS static parsing, alias resolution, color/contrast, formatting, validation. |
| `src/ingestion/http` | `PoliteFetcher`: the only network path for ingestion (robots.txt, rate limits, conditional GET). |
| `src/ingestion/types.ts` | `SourceAdapter` interface. |
| `src/ingestion/adapters` | One module per source + registry (`index.ts`). Adding a system never touches the engine. |
| `src/ingestion/engine` | Postgres job queue, worker, stages, validation, publish. |
| `src/server/search` | Search provider abstraction + Postgres FTS/trigram implementation. |
| `src/server/queries` | Read models for pages. |
| `src/components/atlas` | Provenance UI kit: `VerificationBadge`, `CoverageChip`, `MissingValue`, `SourceLink`, `EvidenceList`, `PageHeader`. |
| `data/registry/*.json` | The researched registry (100 verified systems + preserved rejected/duplicate entries). |
| `docs/` | Architecture, ADRs, data quality report, backlog. |

## Non-negotiable data rules

- Never fabricate component names, variants, props, token values, URLs, Figma links, licenses or framework support.
- Unknown is not empty. Every field carries a coverage state: `documented`, `documented-none` (absent capability),
  `not-documented` (absent documentation), `not-extracted` (unknown), `inferred`. The UI must show which.
- Heuristic classification is always labelled `inferred`.
- Every published claim needs evidence: source URL, retrieval time, content hash, extraction method, location.
- Store concise facts and short excerpts, never whole pages; store code only when the license permits redistribution.
- Respect robots.txt, rate limits and access controls. Never bypass auth, paywalls or CAPTCHAs. Never execute fetched scripts.
- Counts and statistics shown in the UI are derived from records, never hard-coded.

## Conventions

- Ingestion writes are idempotent upserts on natural keys; re-runs with unchanged sources create nothing new.
- Components missing from a later run are `retired`, never deleted.
- Admin mutations (`/ops`, `/api/ops/*`) require `ATLAS_ADMIN_TOKEN` (localhost only when unset).
- Branches: `claude/{description}-{id}`. Short, descriptive commit messages.
