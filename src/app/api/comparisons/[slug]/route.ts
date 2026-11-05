/**
 * GET /api/comparisons/:slug  A saved comparison's definition (selection, not a snapshot).
 *   -> 200 { data: { slug, title, typeSlug, typeName, systemSlugs, criteria, picks, isFeatured, createdAt, url, viewUrl } }
 */
import type { NextRequest } from "next/server";
import { componentCompareHref, decodeSavedCriteria, systemCompareHref } from "@/lib/scoring/params";
import { handle, notFound, ok } from "@/server/api/http";
import { getComparisonBySlug } from "@/server/queries/compare";

export const GET = handle("comparisons/slug", async (_req: NextRequest, ctx: { params: Promise<{ slug: string }> }) => {
  const { slug } = await ctx.params;
  if (!/^[A-Za-z0-9]{6,16}$/.test(slug)) return notFound("This comparison");
  const saved = await getComparisonBySlug(slug);
  if (!saved) return notFound("This comparison");
  const { criteria, picks } = decodeSavedCriteria(saved.criteria);
  const { ownerId: _owner, criteria: _raw, ...rest } = saved;
  return ok({
    ...rest,
    criteria,
    picks,
    url: `/compare/s/${saved.slug}`,
    viewUrl: saved.typeSlug
      ? componentCompareHref({ type: saved.typeSlug, systems: saved.systemSlugs, picks })
      : systemCompareHref({ systems: saved.systemSlugs, criteria }),
  });
});
