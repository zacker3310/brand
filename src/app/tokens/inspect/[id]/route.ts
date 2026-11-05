import { isUuid } from "@/components/tokens/lib/params";
import { getTokenInspector } from "@/server/queries/tokens";

/** JSON detail for the Token Explorer's inspector panel (progressive enhancement of ?token=<id>). */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!isUuid(id)) return Response.json({ error: "invalid-id" }, { status: 400 });
  const data = await getTokenInspector(id.toLowerCase());
  if (!data) return Response.json({ error: "not-found" }, { status: 404 });
  return Response.json(data, { headers: { "cache-control": "private, max-age=30" } });
}
