/**
 * Polite HTTP client for ingestion. Every outbound ingestion request goes through here.
 *
 *  - Identifies itself with ATLAS_USER_AGENT.
 *  - Honors robots.txt per RFC 9309 (4xx => unrestricted, 5xx/unreachable => fully disallowed),
 *    including Crawl-delay (bounded).
 *  - Per-host concurrency limit and minimum inter-request delay.
 *  - Conditional requests (If-None-Match / If-Modified-Since) with a content-addressed disk cache
 *    so 304 responses still yield a body for re-parsing.
 *  - Timeouts, bounded retries with exponential backoff + jitter, Retry-After support.
 *  - Never executes fetched content. Bodies are treated as data.
 *
 * OWNERSHIP: foundational (integrator). Adapters consume it via AdapterContext.http.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import robotsParser from "robots-parser";

export const DEFAULT_USER_AGENT =
  process.env.ATLAS_USER_AGENT ?? "ATLAS-DesignSystemIndexer/0.1 (+https://github.com/zacker3310/brand/tree/main/atlas)";
const UA_TOKEN = "ATLAS-DesignSystemIndexer";

export interface FetchOptions {
  etag?: string | null;
  lastModified?: string | null;
  accept?: string;
  timeoutMs?: number;
  maxRetries?: number;
  maxBytes?: number;
  /** Skip robots check. Only for robots.txt itself. */
  skipRobots?: boolean;
  /** Use HEAD (link checks). */
  method?: "GET" | "HEAD";
  signal?: AbortSignal;
}

export interface FetchResult {
  url: string;
  finalUrl: string;
  status: number;
  ok: boolean;
  notModified: boolean;
  fromCache: boolean;
  contentType: string | null;
  etag: string | null;
  lastModified: string | null;
  body: string | null; // null for HEAD, blocked or failed
  hash: string | null; // sha256 hex of body
  byteSize: number;
  fetchedAt: string;
  attempts: number;
  blockedByRobots: boolean;
  error: string | null; // network/timeout/size error message
}

export class RobotsDisallowedError extends Error {
  constructor(public url: string) {
    super(`robots.txt disallows ${url}`);
    this.name = "RobotsDisallowedError";
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const sha256 = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");

interface HostState {
  active: number;
  lastStart: number;
  queue: (() => void)[];
  crawlDelayMs: number;
}

interface RobotsEntry {
  fetchedAt: number;
  allowAll: boolean;
  disallowAll: boolean;
  parser: ReturnType<typeof robotsParser> | null;
  crawlDelayMs: number;
}

export interface PoliteFetcherOptions {
  userAgent?: string;
  hostDelayMs?: number;
  hostConcurrency?: number;
  cacheDir?: string | null;
  robotsTtlMs?: number;
  maxCrawlDelayMs?: number;
  /** Injected fetch for tests. */
  fetchImpl?: typeof fetch;
  log?: (msg: string) => void;
}

export class PoliteFetcher {
  readonly userAgent: string;
  private hostDelayMs: number;
  private hostConcurrency: number;
  private cacheDir: string | null;
  private robotsTtlMs: number;
  private maxCrawlDelayMs: number;
  private fetchImpl: typeof fetch;
  private hosts = new Map<string, HostState>();
  private robots = new Map<string, Promise<RobotsEntry>>();
  private log: (msg: string) => void;
  /** Counters for run stats. */
  stats = { requests: 0, notModified: 0, cacheHits: 0, errors: 0, robotsBlocked: 0, retries: 0 };

  constructor(opts: PoliteFetcherOptions = {}) {
    this.userAgent = opts.userAgent ?? DEFAULT_USER_AGENT;
    this.hostDelayMs = opts.hostDelayMs ?? Number(process.env.ATLAS_HOST_DELAY_MS ?? 750);
    this.hostConcurrency = opts.hostConcurrency ?? Number(process.env.ATLAS_HOST_CONCURRENCY ?? 2);
    this.cacheDir = opts.cacheDir === undefined ? (process.env.ATLAS_CACHE_DIR ?? ".cache/sources") : opts.cacheDir;
    this.robotsTtlMs = opts.robotsTtlMs ?? 6 * 60 * 60 * 1000;
    this.maxCrawlDelayMs = opts.maxCrawlDelayMs ?? 10_000;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.log = opts.log ?? (() => {});
  }

  /* ------------------------------ robots.txt ------------------------------ */

  private async loadRobots(origin: string): Promise<RobotsEntry> {
    const robotsUrl = `${origin}/robots.txt`;
    const res = await this.rawFetch(robotsUrl, { skipRobots: true, maxRetries: 1, timeoutMs: 10_000, accept: "text/plain,*/*" });
    const now = Date.now();
    if (res.error || res.status >= 500) {
      // RFC 9309 2.3.1.4: unreachable => assume complete disallow.
      return { fetchedAt: now, allowAll: false, disallowAll: true, parser: null, crawlDelayMs: 0 };
    }
    if (res.status >= 400) return { fetchedAt: now, allowAll: true, disallowAll: false, parser: null, crawlDelayMs: 0 };
    const ct = res.contentType ?? "";
    const body = res.body ?? "";
    // Some hosts return HTML/JSON for /robots.txt (SPA fallbacks). Treat non-robots content as no rules.
    const looksLikeRobots = /user-agent\s*:/i.test(body) || /^\s*(sitemap|disallow|allow)\s*:/im.test(body);
    if (!looksLikeRobots || /html|json/.test(ct) && !looksLikeRobots) {
      return { fetchedAt: now, allowAll: true, disallowAll: false, parser: null, crawlDelayMs: 0 };
    }
    const parser = robotsParser(robotsUrl, body);
    const delay = parser.getCrawlDelay(UA_TOKEN) ?? parser.getCrawlDelay("*") ?? 0;
    return {
      fetchedAt: now,
      allowAll: false,
      disallowAll: false,
      parser,
      crawlDelayMs: Math.min(this.maxCrawlDelayMs, Math.max(0, delay * 1000)),
    };
  }

  private robotsFor(origin: string): Promise<RobotsEntry> {
    const cached = this.robots.get(origin);
    if (cached) {
      return cached.then((e) => {
        if (Date.now() - e.fetchedAt < this.robotsTtlMs) return e;
        this.robots.delete(origin);
        return this.robotsFor(origin);
      });
    }
    const p = this.loadRobots(origin);
    this.robots.set(origin, p);
    return p;
  }

  async isAllowed(url: string): Promise<boolean> {
    const u = new URL(url);
    const entry = await this.robotsFor(u.origin);
    if (entry.allowAll) return true;
    if (entry.disallowAll) return false;
    const allowed = entry.parser?.isAllowed(url, UA_TOKEN);
    return allowed !== false;
  }

  async sitemapsFor(origin: string): Promise<string[]> {
    const entry = await this.robotsFor(origin);
    return entry.parser?.getSitemaps() ?? [];
  }

  /* --------------------------- host scheduling ---------------------------- */

  private host(hostname: string): HostState {
    let h = this.hosts.get(hostname);
    if (!h) {
      h = { active: 0, lastStart: 0, queue: [], crawlDelayMs: 0 };
      this.hosts.set(hostname, h);
    }
    return h;
  }

  private async acquire(hostname: string, crawlDelayMs: number): Promise<() => void> {
    const h = this.host(hostname);
    h.crawlDelayMs = Math.max(h.crawlDelayMs, crawlDelayMs);
    if (h.active >= this.hostConcurrency) {
      await new Promise<void>((resolve) => h.queue.push(resolve));
    }
    h.active++;
    const minGap = Math.max(this.hostDelayMs, h.crawlDelayMs);
    const wait = h.lastStart + minGap - Date.now();
    h.lastStart = Math.max(Date.now(), h.lastStart + minGap);
    if (wait > 0) await sleep(wait);
    return () => {
      h.active--;
      const next = h.queue.shift();
      if (next) next();
    };
  }

  /* -------------------------------- cache --------------------------------- */

  private cachePath(hash: string) {
    return this.cacheDir ? path.join(this.cacheDir, hash.slice(0, 2), hash) : null;
  }

  async readCache(hash: string): Promise<string | null> {
    const p = this.cachePath(hash);
    if (!p) return null;
    try {
      return await readFile(p, "utf8");
    } catch {
      return null;
    }
  }

  private async writeCache(hash: string, body: string) {
    const p = this.cachePath(hash);
    if (!p) return;
    try {
      await mkdir(path.dirname(p), { recursive: true });
      await writeFile(p, body, "utf8");
    } catch (e) {
      this.log(`cache write failed: ${(e as Error).message}`);
    }
  }

  /* -------------------------------- fetch --------------------------------- */

  /**
   * Fetch a URL politely. Never throws for HTTP errors; inspect `status`/`error`.
   * Pass `lastHash` + etag/lastModified to enable conditional GET with cache fallback.
   */
  async get(url: string, opts: FetchOptions & { lastHash?: string | null } = {}): Promise<FetchResult> {
    const u = new URL(url);
    const fetchedAt = new Date().toISOString();
    if (!opts.skipRobots) {
      const allowed = await this.isAllowed(url);
      if (!allowed) {
        this.stats.robotsBlocked++;
        return {
          url,
          finalUrl: url,
          status: 0,
          ok: false,
          notModified: false,
          fromCache: false,
          contentType: null,
          etag: null,
          lastModified: null,
          body: null,
          hash: null,
          byteSize: 0,
          fetchedAt,
          attempts: 0,
          blockedByRobots: true,
          error: "ROBOTS_DISALLOWED",
        };
      }
    }
    const robots = opts.skipRobots ? null : await this.robotsFor(u.origin);
    const release = await this.acquire(u.hostname, robots?.crawlDelayMs ?? 0);
    try {
      const res = await this.rawFetch(url, opts);
      if (res.notModified && opts.lastHash) {
        const cached = await this.readCache(opts.lastHash);
        if (cached !== null) {
          this.stats.cacheHits++;
          return { ...res, body: cached, hash: opts.lastHash, byteSize: Buffer.byteLength(cached), fromCache: true };
        }
        // Cache miss on 304: refetch unconditionally so callers always get a body.
        const full = await this.rawFetch(url, { ...opts, etag: null, lastModified: null });
        if (full.body && full.hash) await this.writeCache(full.hash, full.body);
        return full;
      }
      if (res.body && res.hash) await this.writeCache(res.hash, res.body);
      return res;
    } finally {
      release();
    }
  }

  /** JSON convenience. Returns null data on non-2xx or parse failure (with result for diagnostics). */
  async getJson<T = unknown>(url: string, opts: FetchOptions & { lastHash?: string | null } = {}): Promise<{ data: T | null; res: FetchResult }> {
    const res = await this.get(url, { accept: "application/json,*/*;q=0.5", ...opts });
    if (!res.ok || res.body === null) return { data: null, res };
    try {
      return { data: JSON.parse(res.body) as T, res };
    } catch {
      return { data: null, res: { ...res, error: "INVALID_JSON" } };
    }
  }

  private async rawFetch(url: string, opts: FetchOptions): Promise<FetchResult> {
    const maxRetries = opts.maxRetries ?? 3;
    const timeoutMs = opts.timeoutMs ?? 20_000;
    const maxBytes = opts.maxBytes ?? 15 * 1024 * 1024;
    const fetchedAt = new Date().toISOString();
    let attempt = 0;
    let lastError: string | null = null;
    let lastStatus = 0;
    while (attempt <= maxRetries) {
      attempt++;
      this.stats.requests++;
      const headers: Record<string, string> = {
        "user-agent": this.userAgent,
        accept: opts.accept ?? "text/html,application/json,text/plain,*/*;q=0.8",
      };
      if (opts.etag) headers["if-none-match"] = opts.etag;
      if (opts.lastModified) headers["if-modified-since"] = opts.lastModified;
      try {
        const signal = opts.signal ? AbortSignal.any([opts.signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
        const res = await this.fetchImpl(url, { method: opts.method ?? "GET", headers, redirect: "follow", signal });
        lastStatus = res.status;
        const base = {
          url,
          finalUrl: res.url || url,
          status: res.status,
          contentType: res.headers.get("content-type"),
          etag: res.headers.get("etag"),
          lastModified: res.headers.get("last-modified"),
          fetchedAt,
          attempts: attempt,
          blockedByRobots: false,
        };
        if (res.status === 304) {
          this.stats.notModified++;
          return { ...base, ok: true, notModified: true, fromCache: false, body: null, hash: null, byteSize: 0, error: null };
        }
        if ((res.status === 429 || res.status >= 500) && attempt <= maxRetries) {
          const ra = res.headers.get("retry-after");
          const raMs = ra ? (Number.isFinite(Number(ra)) ? Number(ra) * 1000 : Math.max(0, Date.parse(ra) - Date.now())) : 0;
          const backoff = Math.min(30_000, Math.max(raMs, 500 * 2 ** (attempt - 1) + Math.floor(Math.random() * 250)));
          this.stats.retries++;
          await res.body?.cancel().catch(() => {});
          await sleep(backoff);
          continue;
        }
        if (opts.method === "HEAD") {
          return { ...base, ok: res.ok, notModified: false, fromCache: false, body: null, hash: null, byteSize: 0, error: null };
        }
        const len = Number(res.headers.get("content-length") ?? 0);
        if (len > maxBytes) {
          await res.body?.cancel().catch(() => {});
          return { ...base, ok: false, notModified: false, fromCache: false, body: null, hash: null, byteSize: len, error: "BODY_TOO_LARGE" };
        }
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.byteLength > maxBytes) {
          return { ...base, ok: false, notModified: false, fromCache: false, body: null, hash: null, byteSize: buf.byteLength, error: "BODY_TOO_LARGE" };
        }
        const body = buf.toString("utf8");
        if (!res.ok) this.stats.errors++;
        return { ...base, ok: res.ok, notModified: false, fromCache: false, body, hash: sha256(buf), byteSize: buf.byteLength, error: null };
      } catch (e) {
        const err = e as Error & { cause?: { code?: string } };
        lastError = err.name === "TimeoutError" ? "TIMEOUT" : (err.cause?.code ?? err.message);
        if (attempt <= maxRetries) {
          this.stats.retries++;
          await sleep(Math.min(20_000, 500 * 2 ** (attempt - 1) + Math.floor(Math.random() * 250)));
          continue;
        }
      }
    }
    this.stats.errors++;
    return {
      url,
      finalUrl: url,
      status: lastStatus,
      ok: false,
      notModified: false,
      fromCache: false,
      contentType: null,
      etag: null,
      lastModified: null,
      body: null,
      hash: null,
      byteSize: 0,
      fetchedAt,
      attempts: attempt,
      blockedByRobots: false,
      error: lastError ?? `HTTP_${lastStatus}`,
    };
  }
}

/* ------------------------------ source helpers ------------------------------ */

/** jsDelivr npm file URL (immutable when version pinned). */
export const npmFileUrl = (pkg: string, version: string, file: string) =>
  `https://cdn.jsdelivr.net/npm/${pkg}@${version}/${file.replace(/^\//, "")}`;

/** jsDelivr flat file listing for an npm package version. */
export const npmListingUrl = (pkg: string, version: string) => `https://data.jsdelivr.com/v1/packages/npm/${pkg}@${version}?structure=flat`;

/** Raw GitHub file URL (repository content; api.github.com is not used). */
export const githubRawUrl = (owner: string, repo: string, ref: string, file: string) =>
  `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${file.replace(/^\//, "")}`;

/** jsDelivr flat listing for a GitHub repo at a ref (works when api.github.com is unavailable). */
export const githubListingUrl = (owner: string, repo: string, ref: string) =>
  `https://data.jsdelivr.com/v1/packages/gh/${owner}/${repo}@${ref}?structure=flat`;

/** Human-facing GitHub blob URL for evidence links. */
export const githubBlobUrl = (owner: string, repo: string, ref: string, file: string) =>
  `https://github.com/${owner}/${repo}/blob/${ref}/${file.replace(/^\//, "")}`;

export interface NpmPackument {
  name: string;
  "dist-tags": Record<string, string>;
  time?: Record<string, string>;
  license?: string;
  repository?: { url?: string } | string;
  homepage?: string;
  deprecated?: string;
  versions?: Record<string, { license?: string; deprecated?: string; repository?: { url?: string } | string; homepage?: string }>;
}

/** Abbreviated npm metadata: latest version, publish time, license, deprecation. */
export async function npmLatest(http: PoliteFetcher, pkg: string) {
  // Full packuments can be large (tens of MB) for very active packages; that's acceptable for metadata checks.
  const { data, res } = await http.getJson<NpmPackument>(`https://registry.npmjs.org/${pkg.replace("/", "%2F")}`, { maxBytes: 150 * 1024 * 1024, timeoutMs: 60_000 });
  if (!data) return { ok: false as const, status: res.status, error: res.error };
  const latest = data["dist-tags"]?.latest ?? null;
  const v = latest ? data.versions?.[latest] : undefined;
  const repo = v?.repository ?? data.repository;
  return {
    ok: true as const,
    status: res.status,
    name: data.name,
    latest,
    publishedAt: latest ? (data.time?.[latest] ?? null) : null,
    modifiedAt: data.time?.modified ?? null,
    license: v?.license ?? data.license ?? null,
    deprecated: v?.deprecated ?? null,
    repository: typeof repo === "string" ? repo : (repo?.url ?? null),
    homepage: v?.homepage ?? data.homepage ?? null,
    url: `https://www.npmjs.com/package/${pkg}`,
  };
}

/** Lightweight jsDelivr listing (flat). */
export async function listFiles(http: PoliteFetcher, listingUrl: string): Promise<{ files: string[]; status: number }> {
  const { data, res } = await http.getJson<{ files?: { name: string }[] }>(listingUrl);
  return { files: (data?.files ?? []).map((f) => f.name.replace(/^\//, "")), status: res.status };
}

/** Bounded excerpt for evidence display (never store whole documents). */
export function excerpt(text: string | null | undefined, max = 280): string | null {
  if (!text) return null;
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}
