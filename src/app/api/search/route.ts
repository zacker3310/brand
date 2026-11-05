/**
 * GET /api/search?q=&types=&systems=&frameworks=&platforms=&categories=&limit=&offset=
 * Arrays are comma-separated. Returns SearchResult (@/lib/contracts). 400 on invalid input.
 */
import type { NextRequest } from "next/server";
import { search } from "@/server/search";
import { NO_STORE, SEARCH_CACHE_CONTROL, parseSearchParams } from "@/server/search/params";

export async function GET(request: NextRequest) {
  const parsed = parseSearchParams(request.nextUrl.searchParams);
  if (!parsed.ok) {
    return Response.json({ error: "invalid_query", issues: parsed.issues }, { status: 400, headers: { "Cache-Control": NO_STORE } });
  }
  try {
    const result = await search(parsed.value);
    return Response.json(result, { headers: { "Cache-Control": SEARCH_CACHE_CONTROL } });
  } catch (err) {
    console.error("[api/search] search failed", err);
    return Response.json({ error: "search_failed" }, { status: 500, headers: { "Cache-Control": NO_STORE } });
  }
}
