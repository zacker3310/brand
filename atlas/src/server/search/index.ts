/**
 * ATLAS unified search facade. Signatures are the contract:
 *   search(query)        -> SearchResult (hits + facets + how the query was interpreted)
 *   suggest(prefix)      -> command-palette suggestions
 *   reindexAll()         -> rebuild every search document (idempotent)
 *   reindexSystem(slug)  -> rebuild one system's documents + taxonomy docs (called by ingestion publish)
 *
 * Storage/ranking lives behind SearchProvider (./provider.ts, ATLAS_SEARCH_PROVIDER); query
 * understanding is pure (./query.ts); documents are built from canonical tables (./documents.ts).
 */
import type { SearchQuery, SearchResult } from "@/lib/contracts";
import { getPool } from "@/db/client";
import { SYSTEM_SCOPED_TYPES, TAXONOMY_TYPES, buildSystemDocuments, buildTaxonomyDocuments } from "./documents";
import { getSearchProvider } from "./provider";
import type { Queryable } from "./providers/postgres";
import { hasInterpretedHardFilters, parseQuery, relaxInterpretedFilters } from "./query";
import type { DocKey, ParsedQuery, SearchDocument, Suggestion } from "./types";

export type { SearchProvider, SearchDocument, ParsedQuery, Suggestion } from "./types";
export { parseQuery } from "./query";
export { getSearchProvider, registerSearchProvider } from "./provider";

export async function search(query: SearchQuery): Promise<SearchResult> {
  const started = performance.now();
  const provider = getSearchProvider();
  const parsed = parseQuery(query);
  let effective: ParsedQuery = parsed;
  let res = await provider.search(effective);
  const relaxed: string[] = [];

  // Nothing matched: interpreted (never explicit) filters become boosts, then AND becomes OR.
  if (res.total === 0 && hasInterpretedHardFilters(effective)) {
    effective = relaxInterpretedFilters(effective, query.frameworks ?? []);
    res = await provider.search(effective);
    relaxed.push("filters");
  }
  if (res.total === 0 && effective.units.length > 1) {
    effective = { ...effective, matchMode: "any" };
    res = await provider.search(effective);
    relaxed.push("terms");
  }

  return {
    query: query.q ?? "",
    normalizedQuery: parsed.normalized,
    expansions: parsed.expansions,
    interpretedFilters: relaxed.length ? { ...parsed.interpretedFilters, relaxed } : parsed.interpretedFilters,
    total: res.total,
    hits: res.hits,
    facets: res.facets,
    tookMs: Math.round((performance.now() - started) * 10) / 10,
  };
}

export async function suggest(prefix: string, limit = 8): Promise<Suggestion[]> {
  const p = (prefix ?? "").trim();
  if (!p) return [];
  return getSearchProvider().suggest(p.slice(0, 100), Math.min(Math.max(Math.trunc(limit) || 8, 1), 20));
}

const keyOf = (d: SearchDocument): DocKey => ({ entityType: d.entityType, entityId: d.entityId });

export interface ReindexResult {
  documents: number;
  written: number;
  removed: number;
  tookMs: number;
}

/** Rebuild everything. Idempotent: unchanged documents are not rewritten; vanished ones are deleted. */
export async function reindexAll(): Promise<ReindexResult> {
  return withReindexLock(async (db) => {
    const started = performance.now();
    const provider = getSearchProvider();
    const [systemDocs, taxonomyDocs] = await Promise.all([buildSystemDocuments(db), buildTaxonomyDocuments(db)]);
    const all = [...systemDocs, ...taxonomyDocs];
    const written = await provider.upsert(all);
    const removed = await provider.removeStale({ entityTypes: [...SYSTEM_SCOPED_TYPES, ...TAXONOMY_TYPES] }, all.map(keyOf));
    return { documents: all.length, written, removed, tookMs: Math.round(performance.now() - started) };
  });
}

/**
 * Rebuild one system's documents (system, components, patterns, tokens) and the taxonomy docs
 * whose counts depend on it. A system that is no longer published+verified loses all its docs.
 */
export async function reindexSystem(systemSlug: string): Promise<ReindexResult> {
  return withReindexLock(async (db) => {
    const started = performance.now();
    const provider = getSearchProvider();
    const [systemDocs, taxonomyDocs] = await Promise.all([buildSystemDocuments(db, { systemSlug }), buildTaxonomyDocuments(db)]);
    const all = [...systemDocs, ...taxonomyDocs];
    const written = await provider.upsert(all);
    const removed =
      (await provider.removeStale({ entityTypes: SYSTEM_SCOPED_TYPES, systemSlug }, systemDocs.map(keyOf))) +
      (await provider.removeStale({ entityTypes: TAXONOMY_TYPES }, taxonomyDocs.map(keyOf)));
    return { documents: all.length, written, removed, tookMs: Math.round(performance.now() - started) };
  });
}

/** Serialize reindex runs across processes (web, worker, CLI) with a session advisory lock. */
const LOCK_CLASS = 41_870;
const LOCK_ID = 1;

async function withReindexLock<T>(fn: (db: Queryable) => Promise<T>): Promise<T> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("select pg_advisory_lock($1, $2)", [LOCK_CLASS, LOCK_ID]);
    try {
      return await fn(pool as unknown as Queryable);
    } finally {
      await client.query("select pg_advisory_unlock($1, $2)", [LOCK_CLASS, LOCK_ID]);
    }
  } finally {
    client.release();
  }
}
