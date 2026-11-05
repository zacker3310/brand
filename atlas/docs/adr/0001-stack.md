# ADR 0001: Stack and repository placement

Status: accepted (2026-11-05)

## Context
The host repository (`zacker3310/brand`) is a static brand-asset repo with no build system. ATLAS needs a
server-rendered web app, a relational store with full-text search, and background workers.

## Decision
- ATLAS lives in a self-contained `atlas/` workspace with its own `package.json`. Nothing outside `atlas/` is touched,
  so the jsDelivr-served brand assets are unaffected. (Recommendation: move to a dedicated repository before production.)
- Next.js 16 App Router + React 19 + TypeScript strict (`noUncheckedIndexedAccess`).
- PostgreSQL 16 with `pg_trgm` (fuzzy) and native full-text search. No search engine dependency for v1.
- Drizzle ORM over Prisma: SQL-first, supports generated `tsvector` columns, partial unique indexes and
  `FOR UPDATE SKIP LOCKED` without escape hatches; schema is TypeScript the whole team can read.
- Tailwind CSS 4 + shadcn/ui (Radix primitives) for accessible application UI.
- Zod 4 at every trust boundary (registry files, adapter output, API input).
- Vitest (unit/integration) + Playwright + axe-core (e2e, accessibility).

## Consequences
- One runtime (Node 22+) for web, worker and CLI. Workers share adapters and contracts with the web app.
- Docker Compose is provided for Postgres/worker/web, but local development also works against any Postgres 16.
