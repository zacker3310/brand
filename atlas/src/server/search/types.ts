/**
 * Search-internal types. The public contract (SearchQuery / SearchResult / SearchHit) lives in
 * @/lib/contracts; these types describe the provider boundary so a Typesense/Meilisearch
 * provider can index the same documents without changing callers.
 */
import type { SearchEntityType, SearchHit } from "@/lib/contracts";

export type FacetValue = string[] | string | number | boolean | null;

/** One denormalized searchable record (one row of search_document in the Postgres provider). */
export interface SearchDocument {
  entityType: SearchEntityType;
  /** Primary key of the canonical record (design_system.id, component.id, token.id, ...). */
  entityId: string;
  /** Owning system slug; null for cross-system taxonomy docs (component types, frameworks...). */
  systemSlug: string | null;
  title: string;
  subtitle: string | null;
  body: string | null;
  /** Space-separated aliases / synonyms / tags. Indexed un-stemmed at title weight. */
  keywords: string | null;
  url: string;
  facets: Record<string, FacetValue>;
  /** Multiplicative relevance prior (1 = neutral). */
  boost: number;
}

export interface DocKey {
  entityType: SearchEntityType;
  entityId: string;
}

/** Which documents a removeStale() call is responsible for. */
export interface StaleScope {
  entityTypes: SearchEntityType[];
  /** Restrict to one system's documents; omit for cross-system scope. */
  systemSlug?: string | null;
}

/** One unit of the residual text: original words plus lower-weight alternatives (synonyms). */
export interface QueryUnit {
  words: string[];
  /** Alternative phrasings (each a list of words), matched as phrases with lower weight. */
  alternatives: string[][];
}

/** Output of parseQuery(): everything a provider needs, no I/O. */
export interface ParsedQuery {
  raw: string;
  normalized: string;
  /** Residual text for websearch_to_tsquery (keeps quoted phrases). Empty = browse mode. */
  text: string;
  /** Residual positive units, in query order. */
  units: QueryUnit[];
  /** Residual words, flattened (used for prefix / AND query and trigram fuzzy text). */
  terms: string[];
  /** Words consumed as interpretation (tags, states...) that still contribute as optional rank terms. */
  softTerms: string[];
  /** Words prefixed with "-" in the query. */
  negated: string[];
  /** Synonym / correction expansions applied (human-readable). */
  expansions: string[];

  /** Hard filters. */
  filters: {
    types: SearchEntityType[] | null;
    systems: string[] | null;
    frameworks: string[] | null;
    platforms: string[] | null;
    categories: string[] | null;
    /** Applies to token docs only. */
    themes: string[] | null;
  };
  /** Ranking boosts derived from interpretation. */
  boosts: {
    componentTypes: string[];
    /** Component types reached only through synonyms / typo correction (weaker boost). */
    relatedComponentTypes: string[];
    patternTypes: string[];
    states: string[];
    tags: string[];
    accessibility: boolean;
    themes: string[];
    entityTypes: SearchEntityType[];
  };
  /** What the UI should show as "interpreted as". */
  interpretedFilters: Record<string, string[]>;
  /** Which hard filters came from interpretation (and may be relaxed when nothing matches). */
  interpretedHard: { types: boolean; frameworks: boolean; themes: boolean };
  /** "all" = every unit must match; "any" = relaxed OR semantics. */
  matchMode: "all" | "any";
  /** Trigram fallback on the whole multi-word text (single-term queries always get it). */
  fuzzyAllTerms: boolean;
  limit: number;
  offset: number;
}

export interface ProviderSearchResult {
  total: number;
  hits: SearchHit[];
  facets: Record<string, { value: string; count: number }[]>;
}

export interface Suggestion {
  title: string;
  subtitle: string | null;
  url: string;
  entityType: SearchEntityType;
}

export interface SearchProvider {
  readonly name: string;
  /** Insert or update documents keyed by (entityType, entityId). Returns rows written. */
  upsert(docs: SearchDocument[]): Promise<number>;
  /** Delete documents inside `scope` whose key is not in `keep`. Returns rows deleted. */
  removeStale(scope: StaleScope, keep: DocKey[]): Promise<number>;
  search(query: ParsedQuery): Promise<ProviderSearchResult>;
  suggest(prefix: string, limit: number): Promise<Suggestion[]>;
}
