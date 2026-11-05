/** GET /api/collections (owner-scoped list), POST /api/collections (create). Documented in src/server/api/registry.ts. */
import { API } from "@/server/api/registry";
import { serve } from "@/server/api/serve";

export const GET = serve(API.collectionsList);
export const POST = serve(API.collectionsCreate);
