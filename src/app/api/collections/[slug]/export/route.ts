/** GET /api/collections/{slug}/export?format=json|csv. Documented in src/server/api/registry.ts. */
import { API } from "@/server/api/registry";
import { serve } from "@/server/api/serve";

export const GET = serve(API.collectionExport);
