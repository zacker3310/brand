/**
 * Generic route-handler adapter for registry endpoints: auth -> Zod parsing (path, query, body) ->
 * resolve -> JSON envelope. Route files are one-liners (`export const GET = serve(API.systemsList)`)
 * so handler behaviour and /api-docs can never drift apart.
 */
import type { z } from "zod";
import { requireAdminRequest } from "@/server/admin";
import { CACHE, apiError, handle, invalid, issuesOf, list, notFound, ok, parseParams, parseQuery, sameOrigin, type CacheProfile, type InputIssue } from "./http";

export type ResolveResult =
  | { kind: "list"; data: unknown[]; page: number; pageSize: number; total: number }
  | { kind: "item"; data: unknown; status?: number }
  | { kind: "not-found"; what: string }
  | { kind: "error"; status: number; code: string; message: string; issues?: InputIssue[] }
  | { kind: "response"; response: Response };

export interface ResolveInput<P, Q, B> {
  path: P;
  query: Q;
  body: B;
  request: Request;
  origin: string;
}

export type Auth = "public" | "owner" | "admin";

export interface ApiEndpoint<P extends z.ZodObject = z.ZodObject, Q extends z.ZodObject = z.ZodObject, B extends z.ZodObject = z.ZodObject> {
  id: string;
  method: "GET" | "POST";
  /** Path template with {param} placeholders. */
  path: string;
  group: "Catalog" | "Tokens & patterns" | "Collections & bookmarks" | "Ingestion" | "Exports" | "Operations" | "Meta";
  summary: string;
  description: string;
  auth: Auth;
  cache: CacheProfile;
  pathParams?: P;
  query?: Q;
  body?: B;
  /** Name of the TypeScript DTO (src/server/api/catalog.ts or queries/collections.ts) the data conforms to. */
  returns: string;
  responseKind: "list" | "item" | "file" | "action";
  errors: number[];
  resolve: (input: ResolveInput<z.infer<P>, z.infer<Q>, z.infer<B>>) => Promise<ResolveResult>;
  /** Live example for /api-docs. Omitted for state-changing endpoints (never executed by the docs). */
  example?: { request: string; path?: Record<string, string>; query?: Record<string, string>; note?: string; load?: () => Promise<ResolveResult> };
}

export function defineEndpoint<P extends z.ZodObject, Q extends z.ZodObject, B extends z.ZodObject>(e: ApiEndpoint<P, Q, B>): ApiEndpoint<P, Q, B> {
  return e;
}

export function toResponse(r: ResolveResult, cache: CacheProfile): Response {
  switch (r.kind) {
    case "list":
      return list(r.data, r, cache);
    case "item":
      return ok(r.data, cache, { status: r.status });
    case "not-found":
      return notFound(r.what);
    case "error":
      return apiError(r.status, r.code, r.message, r.issues);
    case "response":
      return r.response;
  }
}

type Ctx = { params?: Promise<Record<string, string | string[] | undefined>> };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function serve(ep: ApiEndpoint<any, any, any>) {
  return handle(ep.id, async (request: Request, ctx?: Ctx) => {
    if (ep.auth === "admin") {
      const denied = requireAdminRequest(request);
      if (denied) return denied;
    }
    if (ep.method === "POST" && ep.auth === "owner" && !sameOrigin(request)) {
      return apiError(403, "forbidden", "Cross-origin writes are not allowed.");
    }
    const rawParams = ctx?.params ? await ctx.params : {};
    let path: Record<string, unknown> = {};
    if (ep.pathParams) {
      const p = parseParams(ep.pathParams, rawParams);
      if (!p.ok) return invalid(p.issues);
      path = p.value;
    }
    const url = new URL(request.url);
    let query: Record<string, unknown> = {};
    if (ep.query) {
      const q = parseQuery(ep.query, url.searchParams);
      if (!q.ok) return invalid(q.issues);
      query = q.value;
    } else if ([...url.searchParams.keys()].length && ep.method === "GET") {
      return invalid([...url.searchParams.keys()].map((k) => ({ path: k, message: "unknown parameter" })));
    }
    let body: Record<string, unknown> = {};
    if (ep.body) {
      const ct = request.headers.get("content-type") ?? "";
      if (!ct.includes("application/json")) return apiError(415, "unsupported_media_type", "Send a JSON body with Content-Type: application/json.");
      let json: unknown;
      try {
        json = await request.json();
      } catch {
        return apiError(400, "invalid_json", "The request body is not valid JSON.");
      }
      const b = ep.body.safeParse(json ?? {});
      if (!b.success) return invalid(issuesOf(b.error));
      body = b.data;
    }
    const result = await ep.resolve({ path, query, body, request, origin: url.origin });
    return toResponse(result, ep.cache);
  });
}

export { CACHE };
