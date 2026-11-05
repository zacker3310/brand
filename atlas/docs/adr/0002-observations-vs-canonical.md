# ADR 0002: Observations are separate from published records

Status: accepted (2026-11-05)

## Decision
Ingestion writes **observations** first and **promotes** them:

| Layer | Tables | Purpose |
|---|---|---|
| Source observations | `source`, `source_document`, `source_snapshot` | What we fetched, when, HTTP status, ETag, content hash, bounded excerpt. Raw bodies live only in a content-addressed disk cache, never in the DB. |
| Derived observations | `parsed_fragment`, `extraction` | Adapter parse output per (document version, adapter version); normalized entities with validation results. |
| Canonical records | `design_system`, `component*`, `token*`, `design_pattern`, ... | What the catalog shows. Only `valid`/`warning` extractions are promoted. |
| Provenance | `verification_evidence`, `change_event` | Every published claim links to source URL, retrieval time, hash, extraction method, location, state, confidence. |

Invalid or conflicting extractions are quarantined (remain in `extraction`, visible in Ops) and never overwrite
published records. Components missing from a later run are `retired`, never deleted, so history is preserved.

## Why
- Re-running ingestion must be idempotent and auditable; staging gives a diff surface (`content_hash`).
- Copyright: storing facts + hashes + short excerpts rather than pages keeps ATLAS a navigational index.
