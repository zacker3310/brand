/** POST /api/ops/jobs/{id}/retry (admin). Documented in src/server/api/registry.ts. */
import { API } from "@/server/api/registry";
import { serve } from "@/server/api/serve";

export const POST = serve(API.opsRetryJob);
