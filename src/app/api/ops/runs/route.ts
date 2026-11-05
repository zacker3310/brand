/**
 * POST /api/ops/runs (admin): enqueue an ingestion run. Documented in src/server/api/registry.ts.
 * The resolver lives in engine-bridge so only this route loads the adapter registry.
 */
import { resolveEnqueueRun } from "@/server/api/engine-bridge";
import { API } from "@/server/api/registry";
import { serve } from "@/server/api/serve";

export const POST = serve({ ...API.opsEnqueueRun, resolve: resolveEnqueueRun });
