/**
 * Search facade. STUB: replaced by the search workstream. Signatures are the contract.
 * The ingestion publish stage calls reindexSystem() after promoting records.
 */
import type { SearchQuery, SearchResult } from "@/lib/contracts";

export async function search(query: SearchQuery): Promise<SearchResult> {
  return { query: query.q, normalizedQuery: query.q, expansions: [], interpretedFilters: {}, total: 0, hits: [], facets: {}, tookMs: 0 };
}

export async function suggest(_prefix: string, _limit = 8): Promise<{ title: string; url: string; entityType: string }[]> {
  return [];
}

export async function reindexAll(): Promise<{ documents: number }> {
  return { documents: 0 };
}

export async function reindexSystem(_systemSlug: string): Promise<{ documents: number }> {
  return { documents: 0 };
}
