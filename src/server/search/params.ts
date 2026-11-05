/**
 * API input parsing for /api/search and /api/search/suggest. Pure (unit-tested).
 * Arrays are comma-separated (`types=component,token`) and/or repeated (`types=a&types=b`).
 */
import { z } from "zod";
import { SearchQuery } from "@/lib/contracts";

export interface InputIssue {
  path: string;
  message: string;
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; issues: InputIssue[] };

const SLUG = /^[a-z0-9][a-z0-9-]{0,79}$/;
const MAX_LIST = 25;
const LIST_PARAMS = ["types", "systems", "frameworks", "platforms", "categories"] as const;

function list(sp: URLSearchParams, name: string): string[] | undefined {
  const vals = sp
    .getAll(name)
    .flatMap((v) => v.split(","))
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return vals.length ? [...new Set(vals)] : undefined;
}

const issuesOf = (e: z.ZodError): InputIssue[] => e.issues.map((i) => ({ path: i.path.join(".") || "(root)", message: i.message }));

export function parseSearchParams(sp: URLSearchParams): Parsed<SearchQuery> {
  const issues: InputIssue[] = [];
  const raw: Record<string, unknown> = { q: sp.get("q") ?? "" };
  for (const name of LIST_PARAMS) {
    const v = list(sp, name);
    if (!v) continue;
    if (v.length > MAX_LIST) issues.push({ path: name, message: `at most ${MAX_LIST} values` });
    if (name !== "types") {
      const bad = v.filter((x) => !SLUG.test(x));
      if (bad.length) issues.push({ path: name, message: `invalid slug(s): ${bad.slice(0, 5).join(", ")}` });
    }
    raw[name] = v;
  }
  for (const n of ["limit", "offset"] as const) {
    const v = sp.get(n);
    if (v !== null && v.trim() !== "") {
      if (!/^\d+$/.test(v.trim())) issues.push({ path: n, message: "must be a non-negative integer" });
      raw[n] = v.trim();
    }
  }
  const r = SearchQuery.safeParse(raw);
  if (!r.success) issues.push(...issuesOf(r.error));
  if (issues.length || !r.success) return { ok: false, issues };
  return { ok: true, value: r.data };
}

export const SuggestQuery = z.object({
  q: z.string().trim().max(100).default(""),
  limit: z.coerce.number().int().min(1).max(20).default(8),
});
export type SuggestQuery = z.infer<typeof SuggestQuery>;

export function parseSuggestParams(sp: URLSearchParams): Parsed<SuggestQuery> {
  const raw: Record<string, unknown> = { q: sp.get("q") ?? "" };
  const limit = sp.get("limit");
  if (limit !== null && limit.trim() !== "") {
    if (!/^\d+$/.test(limit.trim())) return { ok: false, issues: [{ path: "limit", message: "must be a positive integer" }] };
    raw.limit = limit.trim();
  }
  const r = SuggestQuery.safeParse(raw);
  return r.success ? { ok: true, value: r.data } : { ok: false, issues: issuesOf(r.error) };
}

export const SEARCH_CACHE_CONTROL = "public, max-age=30, s-maxage=60, stale-while-revalidate=300";
export const SUGGEST_CACHE_CONTROL = "public, max-age=60, s-maxage=120, stale-while-revalidate=600";
export const NO_STORE = "no-store";
