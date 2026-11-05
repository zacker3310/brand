/**
 * Shared REST API helpers: JSON envelopes, consistent errors, cache headers, query parsing.
 *
 *   list   -> { data: T[], page, pageSize, total }
 *   single -> { data: T }
 *   error  -> { error: { code, message, issues? } }
 *
 * Pure except for Response construction; unit-tested in tests/unit/platform/api-http.test.ts.
 */
import { z } from "zod";

export interface InputIssue {
  path: string;
  message: string;
}

export interface ApiErrorBody {
  error: { code: string; message: string; issues?: InputIssue[] };
}

export interface ListEnvelope<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface ItemEnvelope<T> {
  data: T;
}

/** Short cache lifetimes: catalog data changes when ingestion publishes. */
export const CACHE = {
  catalog: "public, max-age=60, s-maxage=300, stale-while-revalidate=600",
  status: "public, max-age=15, s-maxage=15, stale-while-revalidate=60",
  export: "public, max-age=300, s-maxage=900, stale-while-revalidate=3600",
  owner: "private, no-store",
  none: "no-store",
} as const;
export type CacheProfile = keyof typeof CACHE;

export const PageQuery = {
  page: z.coerce.number().int().min(1).max(10_000).default(1).describe("1-based page number"),
  pageSize: z.coerce.number().int().min(1).max(100).default(24).describe("Items per page (max 100)"),
};

export const SlugParam = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,99}$/, "must be a lowercase slug")
  .describe("Lowercase slug");

export type Parsed<T> = { ok: true; value: T } | { ok: false; issues: InputIssue[] };

export const issuesOf = (e: z.ZodError): InputIssue[] => e.issues.map((i) => ({ path: i.path.join(".") || "(root)", message: i.message }));

/**
 * URLSearchParams -> object. Empty values are dropped (an empty filter means "no filter").
 * Unknown parameters are reported so typos do not silently return unfiltered data.
 */
export function parseQuery<S extends z.ZodObject>(schema: S, sp: URLSearchParams): Parsed<z.infer<S>> {
  const raw: Record<string, string> = {};
  const issues: InputIssue[] = [];
  const known = new Set(Object.keys(schema.shape));
  for (const [k, v] of sp) {
    if (!known.has(k)) {
      issues.push({ path: k, message: "unknown parameter" });
      continue;
    }
    const t = v.trim();
    if (t !== "") raw[k] = t;
  }
  const r = schema.safeParse(raw);
  if (!r.success) issues.push(...issuesOf(r.error));
  if (issues.length || !r.success) return { ok: false, issues };
  return { ok: true, value: r.data };
}

export function parseParams<S extends z.ZodObject>(schema: S, params: Record<string, string | string[] | undefined>): Parsed<z.infer<S>> {
  const r = schema.safeParse(params);
  return r.success ? { ok: true, value: r.data } : { ok: false, issues: issuesOf(r.error) };
}

function headersFor(cache: CacheProfile, extra?: HeadersInit): Headers {
  const h = new Headers(extra);
  h.set("Cache-Control", CACHE[cache]);
  if (!h.has("Content-Type")) h.set("Content-Type", "application/json; charset=utf-8");
  h.set("X-Content-Type-Options", "nosniff");
  return h;
}

export function ok<T>(data: T, cache: CacheProfile = "catalog", init: { status?: number; headers?: HeadersInit } = {}): Response {
  const body: ItemEnvelope<T> = { data };
  return new Response(JSON.stringify(body), { status: init.status ?? 200, headers: headersFor(cache, init.headers) });
}

export function list<T>(data: T[], p: { page: number; pageSize: number; total: number }, cache: CacheProfile = "catalog"): Response {
  const body: ListEnvelope<T> = { data, page: p.page, pageSize: p.pageSize, total: p.total };
  return new Response(JSON.stringify(body), { status: 200, headers: headersFor(cache) });
}

export function apiError(status: number, code: string, message: string, issues?: InputIssue[]): Response {
  const body: ApiErrorBody = { error: { code, message, ...(issues?.length ? { issues } : {}) } };
  return new Response(JSON.stringify(body), { status, headers: headersFor("none") });
}

export const invalid = (issues: InputIssue[]) => apiError(400, "invalid_request", "The request parameters are invalid.", issues);
export const notFound = (what: string) => apiError(404, "not_found", `${what} is not in the ATLAS index.`);

/** Wrap a handler so unexpected failures return the error envelope instead of an HTML page. */
export function handle<A extends unknown[]>(name: string, fn: (...args: A) => Promise<Response>): (...args: A) => Promise<Response> {
  return async (...args: A) => {
    try {
      return await fn(...args);
    } catch (err) {
      console.error(`[api/${name}] failed`, err);
      return apiError(500, "internal_error", "The request could not be completed. Try again later.");
    }
  };
}

/** Offset for a page. */
export const offsetOf = (p: { page: number; pageSize: number }) => (p.page - 1) * p.pageSize;

/**
 * Same-origin guard for state-changing JSON endpoints that use the owner cookie. Browsers always
 * send Origin on cross-site POSTs; requests without Origin (curl, server-to-server) are allowed.
 */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
