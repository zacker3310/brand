/**
 * POST /api/comparisons  Save a shareable comparison.
 *   JSON body: { type?: string|null, systems: string[2..5], title?: string, criteria?: CriterionId[], picks?: {system: componentSlug} }
 *   Form body (no-JS "Save & share"): type, systems (repeated or comma list), title, criteria, pick=system:component
 *   -> 201 { data: { slug, url, title } }   (form posts: 303 redirect to /compare/s/<slug>)
 *   ownerId comes from the `atlas_owner` cookie when present, else null. Same-origin only.
 *
 * GET /api/comparisons  Featured comparisons, plus the caller's own when the owner cookie is present.
 *   -> 200 { data: { featured: SavedComparison[], mine: SavedComparison[] } }
 */
import type { NextRequest } from "next/server";
import { apiError, handle, invalid, issuesOf, ok, sameOrigin } from "@/server/api/http";
import { getOwnerId } from "@/server/identity";
import { createComparison, getFeaturedComparisons, getOwnerComparisons, getTypeRef, resolveSystems } from "@/server/queries/compare";
import { defaultComparisonTitle, encodeSavedPicks } from "@/lib/scoring/params";
import { CreateComparisonInput, formToComparisonInput } from "@/lib/scoring/share";

const MAX_BODY = 8 * 1024;

const strip = (c: Awaited<ReturnType<typeof getFeaturedComparisons>>[number]) => {
  const { ownerId: _owner, ...rest } = c;
  return { ...rest, url: `/compare/s/${c.slug}` };
};

export const GET = handle("comparisons", async () => {
  const ownerId = await getOwnerId();
  const [featured, mine] = await Promise.all([getFeaturedComparisons(12), ownerId ? getOwnerComparisons(ownerId, 24) : Promise.resolve([])]);
  return ok({ featured: featured.map(strip), mine: mine.map(strip) }, ownerId ? "owner" : "catalog");
});

export const POST = handle("comparisons", async (request: NextRequest) => {
  if (!sameOrigin(request)) return apiError(403, "forbidden", "Cross-origin requests cannot save comparisons.");
  const len = Number(request.headers.get("content-length") ?? 0);
  if (len > MAX_BODY) return apiError(413, "payload_too_large", "The request body is too large.");

  const contentType = request.headers.get("content-type") ?? "";
  const isForm = contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data");
  let raw: unknown;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY) return apiError(413, "payload_too_large", "The request body is too large.");
    raw = isForm ? formToComparisonInput(new URLSearchParams(text)) : JSON.parse(text || "null");
  } catch {
    return invalid([{ path: "(root)", message: isForm ? "unreadable form body" : "body must be valid JSON" }]);
  }

  const parsed = CreateComparisonInput.safeParse(raw);
  if (!parsed.success) return invalid(issuesOf(parsed.error));
  const input = parsed.data;

  const [type, systems] = await Promise.all([input.type ? getTypeRef(input.type) : Promise.resolve(null), resolveSystems(input.systems)]);
  const issues = [];
  if (input.type && !type) issues.push({ path: "type", message: `"${input.type}" is not an ATLAS component type` });
  if (systems.unknown.length) issues.push({ path: "systems", message: `not in the ATLAS registry: ${systems.unknown.join(", ")}` });
  if (issues.length) return invalid(issues);

  const picks = Object.fromEntries(Object.entries(input.picks ?? {}).filter(([s]) => input.systems.includes(s)));
  const criteria = type ? [...(input.criteria ?? []), ...encodeSavedPicks(picks)] : (input.criteria ?? []);
  const title = input.title || defaultComparisonTitle(type?.name ?? null, systems.found.map((s) => s.name));
  const ownerId = await getOwnerId();

  const { slug } = await createComparison({
    title,
    ownerId,
    componentTypeId: type?.id ?? null,
    systemSlugs: systems.found.map((s) => s.slug),
    criteria: criteria.length ? criteria : null,
  });
  const url = `/compare/s/${slug}`;
  if (isForm && !(request.headers.get("accept") ?? "").includes("application/json")) {
    return new Response(null, { status: 303, headers: { Location: url, "Cache-Control": "no-store" } });
  }
  return ok({ slug, url, title }, "none", { status: 201, headers: { Location: url } });
});
