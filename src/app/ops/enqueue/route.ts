/**
 * POST /ops/enqueue (form post from /ops/systems): enqueue an ingestion run, then 303 back.
 *
 * A route handler rather than a Server Action so the console pages never compile the adapter
 * registry (only this handler and /api/ops/runs load it). It only inserts a run + its job via the
 * engine; the worker (npm run worker) does the ingestion.
 * Auth: the same access as the console (admin session cookie, or loopback when no token is set),
 * plus a same-origin check because the cookie-less localhost mode is otherwise CSRF-able.
 */
import { z } from "zod";
import { getAdminAccess, safeNext } from "@/server/admin";
import { sameOrigin } from "@/server/api/http";

const Input = z.object({ system: z.string().regex(/^[a-z0-9][a-z0-9-]{0,99}$/), kind: z.enum(["incremental", "full"]).default("incremental") });

function back(request: Request, path: string, params: Record<string, string>) {
  const u = new URL(path, request.url);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return Response.redirect(u, 303);
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return new Response("Cross-origin request refused.", { status: 403 });
  const fd = await request.formData().catch(() => null);
  const returnTo = safeNext(typeof fd?.get("returnTo") === "string" ? (fd.get("returnTo") as string) : "/ops/systems");
  const access = await getAdminAccess();
  if (!access.ok) return back(request, "/ops/login", { next: returnTo, reason: access.reason });
  const parsed = Input.safeParse({ system: fd?.get("system"), kind: fd?.get("kind") || undefined });
  const target = new URL(returnTo, request.url);
  if (!parsed.success) return back(request, target.pathname + target.search, { notice: "invalid" });
  const { adapterIdFor, enqueueRun } = await import("@/server/api/engine-bridge");
  if (!adapterIdFor(parsed.data.system)) return back(request, target.pathname + target.search, { notice: "no-adapter", system: parsed.data.system });
  const r = await enqueueRun(parsed.data.system, parsed.data.kind, `ops-ui:${access.via}`);
  return back(request, target.pathname + target.search, { notice: r.deduped ? "enqueue-deduped" : "enqueued", run: r.runId, system: parsed.data.system });
}
