"use server";

/**
 * "Enqueue run" (admin). Only inserts an ingestion_run + run-system job via the engine; the worker
 * (npm run worker) processes it. Separate module because it loads the adapter registry.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { adapterIdFor, enqueueRun } from "@/server/api/engine-bridge";
import { AdminAuthError, requireAdmin, safeNext } from "@/server/admin";

const Input = z.object({ system: z.string().regex(/^[a-z0-9][a-z0-9-]{0,99}$/), kind: z.enum(["incremental", "full"]).default("incremental") });

export async function enqueueRunAction(fd: FormData): Promise<void> {
  const returnTo = safeNext(typeof fd.get("returnTo") === "string" ? (fd.get("returnTo") as string) : "/ops/systems");
  try {
    await requireAdmin();
  } catch (e) {
    if (e instanceof AdminAuthError) redirect(`/ops/login?next=${encodeURIComponent(returnTo)}&reason=${e.reason}`);
    throw e;
  }
  const u = new URL(returnTo, "http://x");
  const parsed = Input.safeParse({ system: fd.get("system"), kind: fd.get("kind") ?? undefined });
  if (!parsed.success) u.searchParams.set("notice", "invalid");
  else if (!adapterIdFor(parsed.data.system)) {
    u.searchParams.set("notice", "no-adapter");
    u.searchParams.set("system", parsed.data.system);
  } else {
    const r = await enqueueRun(parsed.data.system, parsed.data.kind, "ops-ui");
    u.searchParams.set("notice", r.deduped ? "enqueue-deduped" : "enqueued");
    u.searchParams.set("run", r.runId);
    u.searchParams.set("system", parsed.data.system);
    revalidatePath("/ops", "layout");
  }
  redirect(`${u.pathname}${u.search}`);
}
