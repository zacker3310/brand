/**
 * GET /api/search/suggest?q=&limit=  -> { query, suggestions: { title, subtitle, url, entityType }[] }
 * Prefix + trigram title suggestions across entity types for the command palette. 400 on invalid input.
 */
import type { NextRequest } from "next/server";
import { suggest } from "@/server/search";
import { NO_STORE, SUGGEST_CACHE_CONTROL, parseSuggestParams } from "@/server/search/params";

export async function GET(request: NextRequest) {
  const parsed = parseSuggestParams(request.nextUrl.searchParams);
  if (!parsed.ok) {
    return Response.json({ error: "invalid_query", issues: parsed.issues }, { status: 400, headers: { "Cache-Control": NO_STORE } });
  }
  const { q, limit } = parsed.value;
  try {
    const suggestions = q ? await suggest(q, limit) : [];
    return Response.json({ query: q, suggestions }, { headers: { "Cache-Control": SUGGEST_CACHE_CONTROL } });
  } catch (err) {
    console.error("[api/search/suggest] suggest failed", err);
    return Response.json({ error: "suggest_failed" }, { status: 500, headers: { "Cache-Control": NO_STORE } });
  }
}
