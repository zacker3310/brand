/**
 * Search provider selection. ATLAS_SEARCH_PROVIDER picks the backend ("postgres" by default).
 * A future Typesense/Meilisearch provider registers a factory here; callers (the facade in
 * ./index.ts, API routes, ingestion) never change.
 */
import { getPool } from "@/db/client";
import { PostgresSearchProvider, type Queryable } from "./providers/postgres";
import type { SearchProvider } from "./types";

type Factory = () => SearchProvider;

const factories = new Map<string, Factory>([["postgres", () => new PostgresSearchProvider(getPool() as unknown as Queryable)]]);
const instances = new Map<string, SearchProvider>();
let override: SearchProvider | null = null;

export function registerSearchProvider(name: string, factory: Factory): void {
  factories.set(name, factory);
  instances.delete(name);
}

export function searchProviderName(): string {
  return (process.env.ATLAS_SEARCH_PROVIDER ?? "postgres").trim().toLowerCase() || "postgres";
}

export function getSearchProvider(): SearchProvider {
  if (override) return override;
  const name = searchProviderName();
  const existing = instances.get(name);
  if (existing) return existing;
  const factory = factories.get(name);
  if (!factory) {
    throw new Error(`Unknown ATLAS_SEARCH_PROVIDER "${name}". Registered providers: ${[...factories.keys()].join(", ")}`);
  }
  const p = factory();
  instances.set(name, p);
  return p;
}

/** Tests only: force a provider instance (null restores env-based selection). */
export function setSearchProviderOverride(p: SearchProvider | null): void {
  override = p;
}
