/** GET /api/bookmarks, POST /api/bookmarks. Documented in src/server/api/registry.ts. */
import { API } from "@/server/api/registry";
import { serve } from "@/server/api/serve";

export const GET = serve(API.bookmarksList);
export const POST = serve(API.bookmarksSet);
