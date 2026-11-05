/**
 * Engine runtime configuration: adapter resolution, the shared PoliteFetcher, concurrency,
 * test hooks and logging. Production code uses the defaults; tests call configureEngine()
 * to inject a fake adapter and an in-memory fetch implementation (no network).
 */
import { adapterForSystem } from "../adapters";
import { PoliteFetcher, type PoliteFetcherOptions } from "../http";
import type { AdapterLogger, SourceAdapter } from "../types";

export type StageName = "discover" | "fetch" | "parse" | "publish";

export interface EngineHooks {
  /**
   * Called after each document is fully processed (and checkpointed) by the fetch/parse stage.
   * Throwing aborts the stage like a crash would. Used by resumability tests.
   */
  afterDocument?(info: { stage: "fetch" | "parse"; runId: string; documentId: string; index: number }): void | Promise<void>;
  /** Called after a stage finished and enqueued the next one. */
  afterStage?(info: { stage: StageName | "run-system"; runId: string }): void | Promise<void>;
}

export interface EngineConfig {
  resolveAdapter: (systemSlug: string) => SourceAdapter | undefined;
  fetcherOptions: PoliteFetcherOptions;
  /** Max documents in flight across all hosts (PoliteFetcher additionally limits per host). */
  fetchConcurrency: number;
  parseConcurrency: number;
  /** Max attempts for stage jobs (discover/fetch/parse/publish). */
  stageMaxAttempts: number;
  hooks: EngineHooks;
  log: AdapterLogger;
  /** Search reindex hook. Defaults to src/server/search reindexSystem (loaded lazily). */
  reindex: (systemSlug: string) => Promise<unknown>;
}

const consoleLog: AdapterLogger = {
  info: (m, e) => {
    if (process.env.ATLAS_ENGINE_QUIET) return;
    console.log(`[engine] ${m}${e && Object.keys(e).length ? ` ${JSON.stringify(e)}` : ""}`);
  },
  warn: (m, e) => console.warn(`[engine:warn] ${m}${e && Object.keys(e).length ? ` ${JSON.stringify(e)}` : ""}`),
  error: (m, e) => console.error(`[engine:error] ${m}${e && Object.keys(e).length ? ` ${JSON.stringify(e)}` : ""}`),
};

async function defaultReindex(slug: string) {
  const mod = await import("../../server/search");
  return mod.reindexSystem(slug);
}

function defaults(): EngineConfig {
  return {
    resolveAdapter: (slug) => adapterForSystem(slug),
    fetcherOptions: {},
    fetchConcurrency: Number(process.env.ATLAS_FETCH_CONCURRENCY ?? 6),
    parseConcurrency: Number(process.env.ATLAS_PARSE_CONCURRENCY ?? 4),
    stageMaxAttempts: 3,
    hooks: {},
    log: consoleLog,
    reindex: defaultReindex,
  };
}

let current: EngineConfig = defaults();
let fetcher: PoliteFetcher | null = null;

export function configureEngine(patch: Partial<EngineConfig>): EngineConfig {
  current = { ...current, ...patch };
  if (patch.fetcherOptions) fetcher = null;
  return current;
}

export function resetEngineConfig() {
  current = defaults();
  fetcher = null;
}

export function engineConfig(): EngineConfig {
  return current;
}

/** One fetcher per process so robots.txt caching and per-host politeness are shared across jobs. */
export function getFetcher(): PoliteFetcher {
  if (!fetcher) fetcher = new PoliteFetcher(current.fetcherOptions);
  return fetcher;
}

/** Directory of the content-addressed body cache, matching PoliteFetcher's layout. */
export function cacheDir(): string | null {
  const o = current.fetcherOptions;
  return o.cacheDir === undefined ? (process.env.ATLAS_CACHE_DIR ?? ".cache/sources") : o.cacheDir;
}
