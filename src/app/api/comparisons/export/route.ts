/**
 * GET /api/comparisons/export  Download a comparison as JSON or CSV.
 *   kind=component&type=<slug>&systems=a,b[,c..]&pick=a:<component>&format=json|csv
 *   kind=system&systems=a,b[,c..]&criteria=<id,...>&format=json|csv
 * Includes ATLAS metadata, source URLs and the ownership disclaimer. Values are the same projection
 * the UI renders; coverage states are kept separate from values in JSON.
 */
import type { NextRequest } from "next/server";
import { CACHE, apiError, handle, invalid, notFound } from "@/server/api/http";
import { csvResponse, toCsv } from "@/server/api/csv";
import { exportMeta, exportMetaLines } from "@/server/api/meta";
import { getComponentComparison, getSystemComparison } from "@/server/queries/compare";
import {
  COMPARISON_DISCLAIMER,
  componentComparisonJson,
  componentComparisonRows,
  systemComparisonJson,
  systemComparisonRows,
} from "@/lib/scoring/export";
import { buildComponentMatrix } from "@/lib/scoring/matrix";
import {
  MIN_SYSTEMS,
  componentCompareHref,
  parseComponentCompareParams,
  parseSystemCompareParams,
  systemCompareHref,
  type SearchParamsRecord,
} from "@/lib/scoring/params";
import { scoreSystem } from "@/lib/scoring/rubrics";

function toRecord(sp: URLSearchParams): SearchParamsRecord {
  const out: SearchParamsRecord = {};
  for (const k of new Set(sp.keys())) {
    const all = sp.getAll(k);
    out[k] = all.length > 1 ? all : all[0];
  }
  return out;
}

function jsonDownload(body: unknown, filename: string) {
  return new Response(JSON.stringify(body, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename.replace(/[^A-Za-z0-9._-]/g, "_")}"`,
      "Cache-Control": CACHE.export,
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export const GET = handle("comparisons/export", async (request: NextRequest) => {
  const sp = request.nextUrl.searchParams;
  const kind = sp.get("kind") ?? "component";
  const format = sp.get("format") ?? "json";
  if (kind !== "component" && kind !== "system") return invalid([{ path: "kind", message: "must be component or system" }]);
  if (format !== "json" && format !== "csv") return invalid([{ path: "format", message: "must be json or csv" }]);
  const rec = toRecord(sp);
  const generatedAt = new Date().toISOString();
  const origin = request.nextUrl.origin;

  if (kind === "component") {
    const p = parseComponentCompareParams(rec);
    if (!p.type) return invalid([{ path: "type", message: "required" }]);
    if (p.systems.length < MIN_SYSTEMS) return invalid([{ path: "systems", message: `select at least ${MIN_SYSTEMS} systems` }]);
    const data = await getComponentComparison({ type: p.type, systems: p.systems, picks: p.picks });
    if (!data) return notFound("This component type");
    if (data.columns.length < MIN_SYSTEMS) return invalid([{ path: "systems", message: `fewer than ${MIN_SYSTEMS} systems are in the ATLAS registry` }]);
    const matrix = buildComponentMatrix(data.type, data.columns);
    const systems = data.columns.map((c) => c.system.slug);
    const url = `${origin}${componentCompareHref({ type: data.type.slug, systems, picks: p.picks })}`;
    const filename = `atlas-compare-${data.type.slug}-${systems.join("-")}`.slice(0, 120);
    if (format === "json") return jsonDownload(componentComparisonJson(data.type, data.columns, matrix, { url, generatedAt }), `${filename}.json`);
    const rows = componentComparisonRows(data.columns, matrix);
    const headers = ["group", "attribute", "alignment", ...data.columns.map((c) => `${c.system.name}${c.component ? ` (${c.component.name})` : ""}`)];
    const meta = exportMeta(`component comparison: ${data.type.name}`, rows.length, [url, COMPARISON_DISCLAIMER, "Cells in [brackets] are coverage states, not values."], new Date(generatedAt));
    const body = toCsv(
      rows,
      headers.map((h, i) => ({ header: h, value: (r: string[]) => r[i] ?? "" })),
      exportMetaLines(meta),
    );
    return csvResponse(body, `${filename}.csv`, CACHE.export);
  }

  const p = parseSystemCompareParams(rec);
  if (p.systems.length < MIN_SYSTEMS) return invalid([{ path: "systems", message: `select at least ${MIN_SYSTEMS} systems` }]);
  const { entries, unknown, taxonomySize } = await getSystemComparison(p.systems);
  if (entries.length < MIN_SYSTEMS) return apiError(400, "invalid_request", `Not in the ATLAS registry: ${unknown.join(", ") || "n/a"}.`);
  const ctx = { asOf: new Date(generatedAt), taxonomySize };
  const results = Object.fromEntries(entries.map((e) => [e.info.slug, scoreSystem(e.metrics, p.criteria, ctx)]));
  const systems = entries.map((e) => ({ slug: e.info.slug, name: e.info.name, docsUrl: e.info.docsUrl, homepageUrl: e.info.homepageUrl, ingestionStatus: e.info.ingestionStatus }));
  const url = `${origin}${systemCompareHref({ systems: systems.map((s) => s.slug), criteria: p.criteria })}`;
  const filename = `atlas-system-compare-${systems.map((s) => s.slug).join("-")}`.slice(0, 120);
  if (format === "json") return jsonDownload(systemComparisonJson(systems, results, p.criteria, { url, generatedAt }), `${filename}.json`);
  const rows = systemComparisonRows(systems, results, p.criteria);
  const meta = exportMeta("system comparison", rows.length, [url, COMPARISON_DISCLAIMER, "Empty scores mean ATLAS lacks the evidence to score; they are not zero."], new Date(generatedAt));
  const cols = ["criterion", "system", "score", "status", "confidence", "evidence_coverage_pct", "explanation"];
  return csvResponse(
    toCsv(
      rows,
      cols.map((h, i) => ({ header: h, value: (r: string[]) => r[i] ?? "" })),
      exportMetaLines(meta),
    ),
    `${filename}.csv`,
    CACHE.export,
  );
});
