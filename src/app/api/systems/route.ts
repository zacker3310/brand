/** GET /api/systems. Documented in src/server/api/registry.ts (see /api-docs). */
import { API } from "@/server/api/registry";
import { serve } from "@/server/api/serve";

export const GET = serve(API.systemsList);
