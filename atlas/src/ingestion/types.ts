/**
 * Source adapter contract. The engine (src/ingestion/engine) drives adapters through the
 * pipeline stages; adapters never write to the database directly.
 *
 *   discover()  -> list of documents to fetch (URLs + docKind + parser hints)
 *   fetch()     -> optional override; default is ctx.http.get with conditional headers
 *   parse()     -> per-document extraction into adapter-defined fragments (pure, no I/O except ctx.http for linked files)
 *   normalize() -> merge all fragments into a NormalizedBundle (canonical shape)
 *   validate()  -> adapter-specific rules (the engine also runs generic validation)
 *   getChanges()-> optional custom diff; default engine diff compares content hashes per entity
 *
 * OWNERSHIP: foundational (integrator).
 */
import type { NormalizedBundle, ValidationIssue } from "@/lib/contracts";
import type { FetchResult, PoliteFetcher } from "./http";

export interface DiscoveredDocument {
  url: string;
  /** Adapter-defined kind that parse() switches on, e.g. "primer-docs-json", "token-json", "mdx". */
  docKind: string;
  /** Source grouping (one row in `source`): e.g. { kind: "repository", url: "https://github.com/primer/react" } */
  source: { kind: string; url: string; label?: string };
  title?: string;
  /** Human-facing URL for evidence (e.g. GitHub blob URL instead of raw URL). */
  evidenceUrl?: string;
  /** Free-form adapter metadata carried to parse(). Must be JSON-serializable. */
  meta?: Record<string, unknown>;
  /** Lower = earlier. */
  priority?: number;
}

export interface FetchedDocument {
  doc: DiscoveredDocument;
  result: FetchResult;
}

/** Adapter-defined parse output for one document. JSON-serializable (persisted between stages). */
export interface ParsedFragment {
  docUrl: string;
  docKind: string;
  /** Free-form payload; normalize() knows how to merge these. */
  data: unknown;
  warnings?: string[];
}

export interface AdapterLogger {
  info(msg: string, extra?: Record<string, unknown>): void;
  warn(msg: string, extra?: Record<string, unknown>): void;
  error(msg: string, extra?: Record<string, unknown>): void;
}

export interface AdapterContext {
  systemSlug: string;
  http: PoliteFetcher;
  log: AdapterLogger;
  /** ISO timestamp for the run; use for evidence.retrievedAt when the doc lacks its own. */
  runStartedAt: string;
  /** Optional cap for development/testing (e.g. only first N components). */
  limit?: number;
  signal?: AbortSignal;
}

export interface ChangeSet {
  created: string[];
  updated: string[];
  removed: string[];
  unchanged: string[];
}

export interface SourceAdapter {
  /** Stable id, e.g. "primer". Stored on runs and evidence ("adapter:primer:<parser>"). */
  id: string;
  /** Bump when parse/normalize logic changes; forces re-parse of unchanged documents. */
  version: string;
  /** Registry slugs this adapter ingests. One adapter may cover several closely related systems. */
  systems: string[];
  /** Short human description of sources used (shown in Ops). */
  description: string;
  discover(ctx: AdapterContext): Promise<DiscoveredDocument[]>;
  fetch?(ctx: AdapterContext, doc: DiscoveredDocument, prev: { etag?: string | null; lastModified?: string | null; lastHash?: string | null }): Promise<FetchResult>;
  parse(ctx: AdapterContext, fetched: FetchedDocument): Promise<ParsedFragment | ParsedFragment[] | null>;
  normalize(ctx: AdapterContext, fragments: ParsedFragment[]): Promise<NormalizedBundle>;
  validate?(ctx: AdapterContext, bundle: NormalizedBundle): ValidationIssue[];
  getChanges?(prev: Map<string, string>, next: Map<string, string>): ChangeSet;
}

/** Default hash-based change detection, used when adapters don't override getChanges. */
export function defaultGetChanges(prev: Map<string, string>, next: Map<string, string>): ChangeSet {
  const cs: ChangeSet = { created: [], updated: [], removed: [], unchanged: [] };
  for (const [k, h] of next) {
    const p = prev.get(k);
    if (p === undefined) cs.created.push(k);
    else if (p !== h) cs.updated.push(k);
    else cs.unchanged.push(k);
  }
  for (const k of prev.keys()) if (!next.has(k)) cs.removed.push(k);
  return cs;
}
