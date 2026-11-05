import { buildExportCss, buildExportJson, exportDecision, exportFileName, EXPORT_FORMATS, type ExportFormat, type ExportSetMeta } from "@/components/tokens/lib/export";
import { getExportSet, getExportTokens } from "@/server/queries/tokens";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function toIso(pgText: string): string {
  const d = new Date(pgText.trim().replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00"));
  return Number.isNaN(d.getTime()) ? pgText : d.toISOString();
}

/**
 * Download a token set as JSON or CSS. Only sets whose license permits redistribution are served; every
 * other set answers 403 with the reason and the official source to use instead.
 */
export async function GET(req: Request, ctx: { params: Promise<{ system: string; set: string }> }) {
  const { system, set } = await ctx.params;
  const format = (new URL(req.url).searchParams.get("format") ?? "json") as ExportFormat;
  if (!EXPORT_FORMATS.includes(format)) return Response.json({ error: "invalid-format", allowed: EXPORT_FORMATS }, { status: 400 });
  if (!SLUG.test(system) || !SLUG.test(set)) return Response.json({ error: "not-found" }, { status: 404 });
  const found = await getExportSet(system, set);
  if (!found) return Response.json({ error: "not-found", message: "No published token set with this system and set slug." }, { status: 404 });
  const s = found.set;
  const decision = exportDecision(s.redistribution);
  if (!decision.allowed) {
    return Response.json(
      {
        error: "redistribution-not-permitted",
        redistribution: s.redistribution,
        reason: decision.reason,
        sourceUrl: s.sourceUrl,
        license: s.license,
      },
      { status: 403 },
    );
  }
  const meta: ExportSetMeta = {
    systemSlug: found.system.slug,
    systemName: found.system.name,
    setSlug: s.slug,
    setName: s.name,
    theme: s.theme,
    format: s.format,
    sourceUrl: s.sourceUrl,
    packageName: s.packageName,
    packageVersion: s.packageVersion,
    redistribution: s.redistribution,
    license: s.license ? { slug: s.license.slug, name: s.license.name, spdxId: s.license.spdxId, url: s.license.url } : null,
    retrievedAt: s.retrievedAt ? toIso(s.retrievedAt) : null,
  };
  const tokens = await getExportTokens(s.id);
  const now = new Date().toISOString();
  const body = format === "json" ? buildExportJson(meta, tokens, now) : buildExportCss(meta, tokens, now);
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": format === "json" ? "application/json; charset=utf-8" : "text/css; charset=utf-8",
      "content-disposition": `attachment; filename="${exportFileName(meta, format)}"`,
      "cache-control": "private, max-age=60",
    },
  });
}
