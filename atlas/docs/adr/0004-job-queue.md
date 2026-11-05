# ADR 0004: PostgreSQL-backed job queue

Status: accepted (2026-11-05)

## Decision
A durable queue on the `ingestion_job` table instead of Redis/BullMQ or pg-boss:
- claim with `UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED)`;
- idempotent enqueue via a partial unique index on `dedupe_key` for live (queued/running) jobs;
- exponential backoff, bounded attempts, dead-letter status, stale-lock reaping with heartbeats;
- per-stage checkpoints on `ingestion_run.checkpoint` so a killed worker resumes without refetching.

## Why
One fewer stateful service; jobs, runs, errors and catalog data are transactional together; Ops can
inspect and retry jobs with plain SQL. Throughput needs (hundreds of documents per system, politely
rate-limited) are far below what a SKIP LOCKED queue handles.

Ingestion never runs inside HTTP handlers; the web app only enqueues and reads.
