/** POST /api/ops/runs (admin): enqueue an ingestion run. Documented in src/server/api/registry.ts. */
import { API } from "@/server/api/registry";
import { serve } from "@/server/api/serve";

export const POST = serve(API.opsEnqueueRun);
