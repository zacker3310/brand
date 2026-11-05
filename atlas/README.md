# ATLAS

Design system intelligence: a source-attributed catalog of real-world design systems, their components,
tokens, patterns and accessibility guidance, with cross-system comparison.

ATLAS is a navigational index, not a mirror. It stores concise facts, short excerpts and hashes, and links
to official documentation. Verified, inferred and missing data are always labelled separately.

- Architecture: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- Decisions: [`docs/adr/`](docs/adr)
- Data quality report: [`docs/DATA_QUALITY.md`](docs/DATA_QUALITY.md)
- Backlog: [`docs/BACKLOG.md`](docs/BACKLOG.md)

## Requirements

- Node.js 22.12+ (npm 10)
- PostgreSQL 16 with the `pg_trgm` and `unaccent` extensions (bundled with standard Postgres packages)

## Setup

```bash
cd atlas
npm ci
cp .env.example .env            # adjust DATABASE_URL if needed

# Database: either Docker...
docker compose up -d db
# ...or any local Postgres 16:  createdb atlas

npm run db:migrate              # creates extensions + schema
npm run db:seed                 # taxonomy, frameworks, platforms + data/registry/*.json (100 verified systems)
```

## Ingest real data

```bash
npm run ingest -- --system github-primer --inline   # one system, processed in-process
npm run ingest -- --all --inline                     # every system with an adapter
npm run ingest -- --status                           # queue + recent runs

# or run the durable worker and enqueue from the CLI / Ops UI
npm run worker
npm run ingest -- --system carbon
```

Runs are resumable (`npm run ingest -- --resume <runId>`) and idempotent: unchanged sources produce no new
canonical rows, evidence or change events.

Adapter development without a database:

```bash
npx tsx scripts/adapter-dry-run.ts primer github-primer --limit 10   # writes .cache/bundles/github-primer.json
```

## Run the app

```bash
npm run dev                      # http://localhost:3000
npm run build && npm run start   # production
```

## Quality gates

```bash
npm run typecheck
npm run lint
npm test                         # unit + integration (needs DATABASE_URL; tests create their own databases)
npm run test:e2e                 # Playwright + axe (builds must exist: npm run build)
npm run quality                  # writes docs/DATA_QUALITY.md from the live database
npm run links                    # checks published source URLs
```

## Adding a design system

1. Add a verified `RegistryEntry` to `data/registry/*.json` (validate: `npx tsx scripts/registry/validate.ts`).
2. If it needs deep ingestion, add `src/ingestion/adapters/<id>.ts` implementing `SourceAdapter`, list it in
   `src/ingestion/adapters/index.ts`, and dry-run it. The engine needs no changes.
3. `npm run db:seed && npm run ingest -- --system <slug> --inline`.

## Source policy

All ingestion HTTP goes through `PoliteFetcher` (identified User-Agent, robots.txt, per-host rate limits,
conditional requests). ATLAS never bypasses authentication, paywalls or CAPTCHAs, never executes fetched
scripts, and stores code examples only when the source license permits redistribution.
