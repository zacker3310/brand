/**
 * GET /api/export/systems.{json,csv} and /api/export/components.{json,csv}.
 * Documented in src/server/api/registry.ts (exportSystems, exportComponents).
 */
import { notFound } from "@/server/api/http";
import { API } from "@/server/api/registry";
import { serve } from "@/server/api/serve";

const systems = serve(API.exportSystems);
const components = serve(API.exportComponents);

export async function GET(request: Request, ctx: { params: Promise<{ file: string }> }) {
  const { file } = await ctx.params;
  const m = /^(systems|components)\.(json|csv)$/.exec(file);
  if (!m) return notFound(`Export "${file}"`);
  const params = Promise.resolve({ format: m[2]! });
  return m[1] === "systems" ? systems(request, { params }) : components(request, { params });
}
