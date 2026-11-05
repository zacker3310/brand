# ADR 0006: Search abstraction on PostgreSQL

Status: accepted (2026-11-05)

A denormalized `search_document` table (one row per searchable entity) with a generated weighted
`tsvector` and a trigram index on titles. Query understanding (framework words, taxonomy aliases,
synonym expansion, entity intent, state words) happens in application code and is returned to the UI
so users can see how a query was interpreted.

The `SearchProvider` interface isolates storage: a Typesense/Meilisearch provider can index the same
documents without changing callers. pgvector/embeddings are deferred until a measurable gain is shown
and an embedding provider is configured; core search never depends on a paid AI service.
