/** POST /api/ops/jobs/{id}/cancel (admin). Documented in src/server/api/registry.ts. */
import { API } from "@/server/api/registry";
import { serve } from "@/server/api/serve";

export const POST = serve(API.opsCancelJob);
