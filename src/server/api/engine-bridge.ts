/**
 * The only module in the web layer that imports the ingestion engine facade (which loads the
 * adapter registry). Kept separate so catalog routes and /api-docs never compile adapter code;
 * only /api/ops/runs and the Ops "Enqueue run" action depend on it.
 *
 * Nothing here ingests: enqueueSystemRun() inserts an ingestion_run + run-system job and returns.
 */
import { enqueueSystemRun } from "@/ingestion/engine";
import { adapterForSystem } from "@/ingestion/adapters";
import type { ResolveResult } from "./serve";

export function adapterIdFor(systemSlug: string): string | null {
  return adapterForSystem(systemSlug)?.id ?? null;
}

export async function enqueueRun(systemSlug: string, kind: "incremental" | "full", triggeredBy: string) {
  return enqueueSystemRun(systemSlug, { kind, triggeredBy });
}

/** resolve() for POST /api/ops/runs (bound in the route file, see registry.opsEnqueueRun). */
export async function resolveEnqueueRun({ body }: { body: { system: string; kind: "incremental" | "full" } }): Promise<ResolveResult> {
  if (!adapterIdFor(body.system)) return { kind: "error", status: 422, code: "no_adapter", message: `No ingestion adapter handles "${body.system}"; it is indexed at metadata level only.` };
  try {
    return { kind: "item", data: await enqueueRun(body.system, body.kind, "api:ops"), status: 202 };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (/unknown design system/i.test(message)) return { kind: "not-found", what: `Design system "${body.system}"` };
    throw e;
  }
}
