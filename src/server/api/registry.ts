/**
 * THE route registry for the ATLAS REST API. Single source of truth for:
 *  - route handlers (src/app/api/**: `export const GET = serve(API.x)`),
 *  - Zod validation of path / query / body,
 *  - /api-docs (parameters are derived from these Zod schemas with z.toJSONSchema; example responses
 *    are produced live by each endpoint's own resolve() against the database),
 *  - /api/openapi.json.
 * Never document an endpoint anywhere else.
 */
import { z } from "zod";
import { SYSTEM_CATEGORIES, TOKEN_CATEGORIES } from "@/lib/contracts";
import { getOwnerId, requireOwnerId } from "@/server/identity";
import {
  bookmarkStates,
  CollectionError,
  createCollection,
  entityMembership,
  getCollection,
  listBookmarks,
  listCuratedCollections,
  listOwnerCollections,
  toggleBookmark,
} from "@/server/queries/collections";
import { CollectionInput, ENTITY_TYPES, EntityRef } from "@/components/collections/schema";
import {
  exportComponents,
  exportSystems,
  getComponentDetail,
  getSystem,
  ingestionStatus,
  listComponents,
  listComponentTypes,
  listPatterns,
  listSystems,
  listTokens,
  systemExists,
} from "./catalog";
import { collectionExport, componentsExport, systemsExport } from "./exports";
import { PageQuery, SlugParam } from "./http";
import { defineEndpoint, type ApiEndpoint, type ResolveResult } from "./serve";

const slug = (d: string) => SlugParam.describe(d);
const optSlug = (d: string) => SlugParam.optional().describe(d);
const q = z.string().trim().min(1).max(100).optional().describe("Case-insensitive substring match on names (and aliases)");
const Format = z.enum(["json", "csv"]).default("json").describe("Download format");
const listOf = (r: { data: unknown[]; total: number }, p: { page: number; pageSize: number }): ResolveResult => ({ kind: "list", data: r.data, total: r.total, page: p.page, pageSize: p.pageSize });

/* -------------------------------------------------------------------------- */
/* Catalog                                                                      */
/* -------------------------------------------------------------------------- */

const systemsList = defineEndpoint({
  id: "systemsList",
  method: "GET",
  path: "/api/systems",
  group: "Catalog",
  summary: "List design systems",
  description:
    "Registry entries with organization, license, framework/platform support claims (each with its verification state), registry verification and live record counts. Defaults to the 100 verified systems; registry=all adds rejected and duplicate entries with their reasons.",
  auth: "public",
  cache: "catalog",
  query: z.object({
    category: z.enum(SYSTEM_CATEGORIES).optional().describe("System category"),
    framework: optSlug("Framework slug (e.g. react, vue, web-components). Excludes support recorded as unavailable or conflicting."),
    platform: optSlug("Platform slug (e.g. web, ios, android)"),
    q,
    registry: z.enum(["verified", "all"]).default("verified").describe("verified = the published 100; all = also rejected/duplicate entries"),
    ...PageQuery,
  }),
  returns: "ListEnvelope<ApiSystem>",
  responseKind: "list",
  errors: [400],
  resolve: async ({ query }) => listOf(await listSystems(query), query),
  example: { request: "/api/systems?framework=react&pageSize=2", query: { framework: "react", pageSize: "2" } },
});

const systemDetail = defineEndpoint({
  id: "systemDetail",
  method: "GET",
  path: "/api/systems/{slug}",
  group: "Catalog",
  summary: "Get one design system",
  description: "Everything in ApiSystem plus philosophy/principles (when documented), packages, registry notes, the coverage summary, official sources with last HTTP status, and system-level evidence.",
  auth: "public",
  cache: "catalog",
  pathParams: z.object({ slug: slug("Design system slug") }),
  returns: "ItemEnvelope<ApiSystemDetail>",
  responseKind: "item",
  errors: [400, 404],
  resolve: async ({ path }) => {
    const s = await getSystem(path.slug);
    return s ? { kind: "item", data: s } : { kind: "not-found", what: `Design system "${path.slug}"` };
  },
  example: { request: "/api/systems/github-primer", path: { slug: "github-primer" } },
});

const ComponentQuery = {
  type: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{0,79}$/)
    .optional()
    .describe('ATLAS component type slug (e.g. combobox), or "unclassified"'),
  framework: optSlug("Framework slug recorded on the component's implementation"),
  q,
  ...PageQuery,
};

const systemComponents = defineEndpoint({
  id: "systemComponents",
  method: "GET",
  path: "/api/systems/{slug}/components",
  group: "Catalog",
  summary: "List a system's components",
  description: "Published components of one system. Same item shape and filters as /api/components.",
  auth: "public",
  cache: "catalog",
  pathParams: z.object({ slug: slug("Design system slug") }),
  query: z.object(ComponentQuery),
  returns: "ListEnvelope<ApiComponent>",
  responseKind: "list",
  errors: [400, 404],
  resolve: async ({ path, query }) => {
    if (!(await systemExists(path.slug))) return { kind: "not-found", what: `Design system "${path.slug}"` };
    return listOf(await listComponents({ ...query, system: path.slug }), query);
  },
  example: { request: "/api/systems/carbon/components?pageSize=2", path: { slug: "carbon" }, query: { pageSize: "2" } },
});

const componentsList = defineEndpoint({
  id: "componentsList",
  method: "GET",
  path: "/api/components",
  group: "Catalog",
  summary: "List components across systems",
  description:
    "Published components with their ATLAS taxonomy classification (state verified or inferred, plus method), lifecycle, official docs/source URLs, framework implementations, child counts and the per-field coverage map (documented / documented-none / not-documented / not-extracted / inferred).",
  auth: "public",
  cache: "catalog",
  query: z.object({ ...ComponentQuery, system: optSlug("Design system slug") }),
  returns: "ListEnvelope<ApiComponent>",
  responseKind: "list",
  errors: [400],
  resolve: async ({ query }) => listOf(await listComponents(query), query),
  example: { request: "/api/components?type=button&pageSize=2", query: { type: "button", pageSize: "2" } },
});

const componentDetail = defineEndpoint({
  id: "componentDetail",
  method: "GET",
  path: "/api/components/{system}/{component}",
  group: "Catalog",
  summary: "Get one component in full",
  description:
    "Variants, states (with canonical state), properties per implementation, accessibility (ARIA pattern, roles, keyboard, guidance, coverage), examples (code only when the license permits redistribution), relationships, token usages (first 200) and evidence. Retired components are returned with publishState \"retired\".",
  auth: "public",
  cache: "catalog",
  pathParams: z.object({ system: slug("Design system slug"), component: slug("Component slug within the system") }),
  returns: "ItemEnvelope<ApiComponentDetail>",
  responseKind: "item",
  errors: [400, 404],
  resolve: async ({ path }) => {
    const c = await getComponentDetail(path.system, path.component);
    return c ? { kind: "item", data: c } : { kind: "not-found", what: `Component "${path.system}/${path.component}"` };
  },
  example: { request: "/api/components/github-primer/button", path: { system: "github-primer", component: "button" } },
});

const componentTypes = defineEndpoint({
  id: "componentTypes",
  method: "GET",
  path: "/api/component-types",
  group: "Catalog",
  summary: "List ATLAS component types",
  description: "The ATLAS-authored taxonomy (canonical purpose, aliases, near-synonyms that are related but not interchangeable, WAI-ARIA pattern) with live implementation counts.",
  auth: "public",
  cache: "catalog",
  query: z.object({ group: optSlug("Taxonomy group slug (e.g. inputs, overlays)"), q, ...PageQuery }),
  returns: "ListEnvelope<ApiComponentType>",
  responseKind: "list",
  errors: [400],
  resolve: async ({ query }) => listOf(await listComponentTypes(query), query),
  example: { request: "/api/component-types?group=inputs&pageSize=2", query: { group: "inputs", pageSize: "2" } },
});

/* -------------------------------------------------------------------------- */
/* Tokens & patterns                                                            */
/* -------------------------------------------------------------------------- */

const tokensList = defineEndpoint({
  id: "tokensList",
  method: "GET",
  path: "/api/tokens",
  group: "Tokens & patterns",
  summary: "List design tokens",
  description:
    "Tokens with their set's license and redistribution status. Values (raw, resolved, display text) are included only when the set's redistribution is \"permitted\"; otherwise valueWithheld is true. resolvedValue for aliasState \"theme-dependent\" is {\"$themes\": {\"<set slug>\": value}}.",
  auth: "public",
  cache: "catalog",
  query: z.object({
    system: optSlug("Design system slug"),
    set: optSlug("Token set slug"),
    category: z.enum(TOKEN_CATEGORIES).optional().describe("Token category"),
    theme: z.string().trim().max(60).optional().describe('Theme of the token set (e.g. light, dark), or "none" for theme-agnostic sets'),
    q: z.string().trim().min(1).max(100).optional().describe("Substring match on token name or CSS variable"),
    ...PageQuery,
  }),
  returns: "ListEnvelope<ApiToken>",
  responseKind: "list",
  errors: [400],
  resolve: async ({ query }) => listOf(await listTokens(query), query),
  example: { request: "/api/tokens?system=github-primer&category=color&pageSize=2", query: { system: "github-primer", category: "color", pageSize: "2" } },
});

const patternsList = defineEndpoint({
  id: "patternsList",
  method: "GET",
  path: "/api/patterns",
  group: "Tokens & patterns",
  summary: "List design patterns",
  description: "Documented patterns (guidance compositions) with their ATLAS pattern type when classified.",
  auth: "public",
  cache: "catalog",
  query: z.object({
    system: optSlug("Design system slug"),
    type: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]{0,79}$/)
      .optional()
      .describe('ATLAS pattern type slug, or "unclassified"'),
    q,
    ...PageQuery,
  }),
  returns: "ListEnvelope<ApiPattern>",
  responseKind: "list",
  errors: [400],
  resolve: async ({ query }) => listOf(await listPatterns(query), query),
  example: { request: "/api/patterns?pageSize=2", query: { pageSize: "2" } },
});

/* -------------------------------------------------------------------------- */
/* Collections & bookmarks (owner-scoped)                                       */
/* -------------------------------------------------------------------------- */

const collectionsList = defineEndpoint({
  id: "collectionsList",
  method: "GET",
  path: "/api/collections",
  group: "Collections & bookmarks",
  summary: "List collections",
  description: "Collections owned by the caller (identified by the atlas_owner cookie) and/or ATLAS curated collections, with item and per-type counts.",
  auth: "owner",
  cache: "owner",
  query: z.object({ scope: z.enum(["all", "mine", "curated"]).default("all").describe("Which collections to list") }),
  returns: "ListEnvelope<CollectionSummary>",
  responseKind: "list",
  errors: [400],
  resolve: async ({ query }) => {
    const owner = query.scope === "curated" ? null : await getOwnerId();
    const [mine, curated] = await Promise.all([query.scope === "curated" ? [] : listOwnerCollections(owner), query.scope === "mine" ? [] : listCuratedCollections()]);
    const data = [...mine, ...curated];
    return { kind: "list", data, page: 1, pageSize: Math.max(1, data.length), total: data.length };
  },
  example: {
    request: "/api/collections?scope=curated",
    query: { scope: "curated" },
    note: "Example shows curated collections only; your own collections are private to your browser.",
  },
});

const collectionsCreate = defineEndpoint({
  id: "collectionsCreate",
  method: "POST",
  path: "/api/collections",
  group: "Collections & bookmarks",
  summary: "Create a collection",
  description: "Creates a private collection for the caller. Issues the atlas_owner cookie if the caller has none. Requires Content-Type: application/json; cross-origin browser requests are refused.",
  auth: "owner",
  cache: "owner",
  body: z.object({ name: CollectionInput.shape.name.describe("Collection name (1-80 chars)"), description: z.string().max(500).optional().describe("Optional description (max 500 chars)") }),
  returns: "ItemEnvelope<{ id: string; slug: string }>",
  responseKind: "item",
  errors: [400, 403, 415],
  resolve: async ({ body }) => {
    try {
      const input = CollectionInput.parse(body);
      const owner = await requireOwnerId();
      return { kind: "item", data: await createCollection(owner, input), status: 201 };
    } catch (e) {
      if (e instanceof CollectionError) return { kind: "error", status: e.code === "limit" ? 409 : 400, code: e.code, message: e.message };
      throw e;
    }
  },
});

const MembershipQuery = z.object({ entityType: z.enum(ENTITY_TYPES).describe("Entity type"), entityId: z.uuid().describe("Entity UUID") });

const collectionMembership = defineEndpoint({
  id: "collectionMembership",
  method: "GET",
  path: "/api/collections/membership",
  group: "Collections & bookmarks",
  summary: "Bookmark and collection membership for one entity",
  description: "Whether the caller bookmarked the entity, and each of the caller's collections with whether it contains it. Backs the Add to collection dialog.",
  auth: "owner",
  cache: "owner",
  query: MembershipQuery,
  returns: "ItemEnvelope<EntityMembership>",
  responseKind: "item",
  errors: [400],
  resolve: async ({ query }) => ({ kind: "item", data: await entityMembership(await getOwnerId(), query) }),
});

const collectionDetail = defineEndpoint({
  id: "collectionDetail",
  method: "GET",
  path: "/api/collections/{slug}",
  group: "Collections & bookmarks",
  summary: "Get a collection with its items",
  description: "The caller's own collection with that slug, otherwise the ATLAS curated collection. Items are resolved to titles, systems, ATLAS URLs and official source URLs; removed records are reported with exists=false.",
  auth: "owner",
  cache: "owner",
  pathParams: z.object({ slug: slug("Collection slug") }),
  returns: "ItemEnvelope<CollectionDetail>",
  responseKind: "item",
  errors: [400, 404],
  resolve: async ({ path }) => {
    const c = await getCollection(await getOwnerId(), path.slug);
    return c ? { kind: "item", data: c } : { kind: "not-found", what: `Collection "${path.slug}"` };
  },
  example: { request: "/api/collections/headless-and-primitive-libraries", path: { slug: "headless-and-primitive-libraries" }, note: "A curated ATLAS collection." },
});

const collectionExportEp = defineEndpoint({
  id: "collectionExport",
  method: "GET",
  path: "/api/collections/{slug}/export",
  group: "Collections & bookmarks",
  summary: "Export a collection (JSON or CSV)",
  description: "Download with ATLAS metadata, item names, notes, tags, official source URLs and the ownership disclaimer. CSV metadata lines start with \"# \".",
  auth: "owner",
  cache: "owner",
  pathParams: z.object({ slug: slug("Collection slug") }),
  query: z.object({ format: Format }),
  returns: "{ meta: ExportMeta, collection, data: [...] } | text/csv",
  responseKind: "file",
  errors: [400, 404],
  resolve: async ({ path, query, origin }) => {
    const c = await getCollection(await getOwnerId(), path.slug);
    if (!c) return { kind: "not-found", what: `Collection "${path.slug}"` };
    return { kind: "response", response: collectionExport(c, query.format, origin) };
  },
});

const bookmarksList = defineEndpoint({
  id: "bookmarksList",
  method: "GET",
  path: "/api/bookmarks",
  group: "Collections & bookmarks",
  summary: "List the caller's bookmarks",
  description: "Bookmarks resolved to titles, systems and URLs, newest first.",
  auth: "owner",
  cache: "owner",
  returns: "ListEnvelope<BookmarkView>",
  responseKind: "list",
  errors: [],
  resolve: async () => {
    const data = await listBookmarks(await getOwnerId());
    return { kind: "list", data, page: 1, pageSize: Math.max(1, data.length), total: data.length };
  },
});

const REF_RE = new RegExp(`^(${ENTITY_TYPES.join("|")}):[0-9a-f-]{36}$`, "i");

const bookmarksStatus = defineEndpoint({
  id: "bookmarksStatus",
  method: "GET",
  path: "/api/bookmarks/status",
  group: "Collections & bookmarks",
  summary: "Bookmark state for many entities",
  description: "Batched lookup used by BookmarkButton. Returns { data: { \"<type>:<uuid>\": boolean } }.",
  auth: "owner",
  cache: "owner",
  query: z.object({
    refs: z
      .string()
      .max(100 * 60)
      .transform((s) => [...new Set(s.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean))])
      .pipe(z.array(z.string().regex(REF_RE, "each ref is <entityType>:<uuid>")).min(1).max(100))
      .describe("Comma-separated <entityType>:<uuid> pairs (max 100)"),
  }),
  returns: "ItemEnvelope<Record<string, boolean>>",
  responseKind: "item",
  errors: [400],
  resolve: async ({ query }) => {
    const refs = query.refs.map((r: string) => ({ entityType: r.slice(0, r.indexOf(":")), entityId: r.slice(r.indexOf(":") + 1) }));
    const states = await bookmarkStates(await getOwnerId(), refs);
    const out: Record<string, boolean> = Object.fromEntries(query.refs.map((r: string) => [r, states.has(r)]));
    return { kind: "item", data: out };
  },
});

const bookmarksSet = defineEndpoint({
  id: "bookmarksSet",
  method: "POST",
  path: "/api/bookmarks",
  group: "Collections & bookmarks",
  summary: "Bookmark or un-bookmark an entity",
  description: "Sets the bookmark state (bookmarked omitted = toggle). Issues the atlas_owner cookie if needed. JSON body; cross-origin browser requests are refused.",
  auth: "owner",
  cache: "owner",
  body: z.object({ ...EntityRef.shape, bookmarked: z.boolean().optional().describe("Desired state; omit to toggle") }),
  returns: "ItemEnvelope<{ bookmarked: boolean }>",
  responseKind: "item",
  errors: [400, 403, 415],
  resolve: async ({ body }) => {
    try {
      const owner = await requireOwnerId();
      return { kind: "item", data: await toggleBookmark(owner, { entityType: body.entityType, entityId: body.entityId }, body.bookmarked) };
    } catch (e) {
      if (e instanceof CollectionError) return { kind: "error", status: e.code === "limit" ? 409 : 400, code: e.code, message: e.message };
      throw e;
    }
  },
});

/* -------------------------------------------------------------------------- */
/* Ingestion & exports                                                          */
/* -------------------------------------------------------------------------- */

const ingestionStatusEp = defineEndpoint({
  id: "ingestionStatus",
  method: "GET",
  path: "/api/ingestion/status",
  group: "Ingestion",
  summary: "Ingestion runs and queue counts",
  description: "Public, non-sensitive crawl status: job counts by kind and status, systems by ingestion status, and the most recent runs with stage and headline stats. Error messages, payloads and worker ids are not exposed.",
  auth: "public",
  cache: "status",
  query: z.object({ limit: z.coerce.number().int().min(1).max(100).default(20).describe("Number of recent runs") }),
  returns: "ItemEnvelope<ApiIngestionStatus>",
  responseKind: "item",
  errors: [400],
  resolve: async ({ query }) => ({ kind: "item", data: await ingestionStatus(query.limit) }),
  example: { request: "/api/ingestion/status?limit=2", query: { limit: "2" } },
});

const exportSystemsEp = defineEndpoint({
  id: "exportSystems",
  method: "GET",
  path: "/api/export/systems.{format}",
  group: "Exports",
  summary: "Export all design systems",
  description: "systems.json or systems.csv: registry facts, ATLAS-authored summaries, official URLs, license and live counts, with ATLAS metadata and the ownership disclaimer.",
  auth: "public",
  cache: "export",
  pathParams: z.object({ format: z.enum(["json", "csv"]).describe("File extension") }),
  query: z.object({ registry: z.enum(["verified", "all"]).default("verified").describe("verified = the published 100; all = include rejected/duplicate entries") }),
  returns: "{ meta: ExportMeta, data: ApiSystem-like[] } | text/csv",
  responseKind: "file",
  errors: [400, 404],
  resolve: async ({ path, query, origin }) => ({ kind: "response", response: systemsExport(await exportSystems(query.registry), path.format, origin, query.registry) }),
});

const exportComponentsEp = defineEndpoint({
  id: "exportComponents",
  method: "GET",
  path: "/api/export/components.{format}",
  group: "Exports",
  summary: "Export all components",
  description: "components.json or components.csv: every published component's name, system, ATLAS type with classification state/method, lifecycle, frameworks and official URLs. No documentation text or code.",
  auth: "public",
  cache: "export",
  pathParams: z.object({ format: z.enum(["json", "csv"]).describe("File extension") }),
  returns: "{ meta: ExportMeta, data: ExportComponentRow[] } | text/csv",
  responseKind: "file",
  errors: [404],
  resolve: async ({ path, origin }) => ({ kind: "response", response: componentsExport(await exportComponents(), path.format, origin) }),
});

/* -------------------------------------------------------------------------- */
/* Operations (admin)                                                           */
/* -------------------------------------------------------------------------- */

const JobPath = z.object({ id: z.uuid().describe("ingestion_job id") });

const opsRetryJob = defineEndpoint({
  id: "opsRetryJob",
  method: "POST",
  path: "/api/ops/jobs/{id}/retry",
  group: "Operations",
  summary: "Retry a failed, dead or cancelled job",
  description: "Requeues the job with attempts reset. If another live job holds the same dedupe key, that job is returned instead. Admin only (Authorization: Bearer).",
  auth: "admin",
  cache: "none",
  pathParams: JobPath,
  returns: "ItemEnvelope<{ id: string; status: string; kind: string; deduped: boolean }>",
  responseKind: "action",
  errors: [401, 403, 404, 409],
  resolve: async ({ path }) => {
    const { retry, getJob } = await import("@/ingestion/engine/queue");
    const before = await getJob(path.id);
    if (!before) return { kind: "not-found", what: `Job ${path.id}` };
    if (!["failed", "dead", "cancelled"].includes(before.status)) return { kind: "error", status: 409, code: "not_retryable", message: `Job is ${before.status}; only failed, dead or cancelled jobs can be retried.` };
    const job = await retry(path.id);
    if (!job) return { kind: "error", status: 409, code: "not_retryable", message: "The job could not be requeued." };
    return { kind: "item", data: { id: job.id, status: job.status, kind: job.kind, deduped: job.id !== path.id } };
  },
});

const opsCancelJob = defineEndpoint({
  id: "opsCancelJob",
  method: "POST",
  path: "/api/ops/jobs/{id}/cancel",
  group: "Operations",
  summary: "Cancel a queued or running job",
  description: "A running handler notices on its next heartbeat. Published records are untouched. Admin only.",
  auth: "admin",
  cache: "none",
  pathParams: JobPath,
  returns: "ItemEnvelope<{ id: string; cancelled: boolean }>",
  responseKind: "action",
  errors: [401, 403, 404],
  resolve: async ({ path }) => {
    const { cancel, getJob } = await import("@/ingestion/engine/queue");
    if (!(await getJob(path.id))) return { kind: "not-found", what: `Job ${path.id}` };
    return { kind: "item", data: { id: path.id, cancelled: await cancel(path.id) } };
  },
});

const opsEnqueueRun = defineEndpoint({
  id: "opsEnqueueRun",
  method: "POST",
  path: "/api/ops/runs",
  group: "Operations",
  summary: "Enqueue an ingestion run",
  description: "Creates an ingestion run and its run-system job for the worker. Never ingests inside the request. Idempotent while the system already has an active run (deduped: true). Admin only.",
  auth: "admin",
  cache: "none",
  body: z.object({ system: slug("Design system slug"), kind: z.enum(["incremental", "full"]).default("incremental").describe("incremental reuses unchanged sources (304s)") }),
  returns: "ItemEnvelope<{ runId: string; jobId: string; deduped: boolean }>",
  responseKind: "action",
  errors: [400, 401, 403, 404, 422],
  resolve: async ({ body }) => {
    if (!(await systemExists(body.system))) return { kind: "not-found", what: `Design system "${body.system}"` };
    const { enqueueSystemRun } = await import("@/ingestion/engine");
    try {
      return { kind: "item", data: await enqueueSystemRun(body.system, { kind: body.kind, triggeredBy: "api:ops" }), status: 202 };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (/no adapter/i.test(message)) return { kind: "error", status: 422, code: "no_adapter", message };
      throw e;
    }
  },
});

/* -------------------------------------------------------------------------- */

const openapi = defineEndpoint({
  id: "openapi",
  method: "GET",
  path: "/api/openapi.json",
  group: "Meta",
  summary: "OpenAPI 3.1 description",
  description: "Machine-readable description generated from this same registry.",
  auth: "public",
  cache: "catalog",
  returns: "OpenAPI 3.1 document",
  responseKind: "item",
  errors: [],
  resolve: async ({ origin }) => {
    const { openApiDocument } = await import("./openapi");
    return { kind: "response", response: Response.json(openApiDocument(origin), { headers: { "Cache-Control": "public, max-age=300" } }) };
  },
});

export const API = {
  systemsList,
  systemDetail,
  systemComponents,
  componentsList,
  componentDetail,
  componentTypes,
  tokensList,
  patternsList,
  collectionsList,
  collectionsCreate,
  collectionMembership,
  collectionDetail,
  collectionExport: collectionExportEp,
  bookmarksList,
  bookmarksStatus,
  bookmarksSet,
  ingestionStatus: ingestionStatusEp,
  exportSystems: exportSystemsEp,
  exportComponents: exportComponentsEp,
  opsRetryJob,
  opsCancelJob,
  opsEnqueueRun,
  openapi,
} as const;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const API_ENDPOINTS: ApiEndpoint<any, any, any>[] = Object.values(API);

export const API_GROUPS = ["Catalog", "Tokens & patterns", "Collections & bookmarks", "Ingestion", "Exports", "Operations", "Meta"] as const;

/** Run an endpoint's example through the same parsing + resolve path a request takes. */
export async function runExample(ep: ApiEndpoint<any, any, any>): Promise<ResolveResult | null> { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!ep.example) return null;
  if (ep.example.load) return ep.example.load();
  const path = ep.pathParams ? ep.pathParams.parse(ep.example.path ?? {}) : {};
  const query = ep.query ? ep.query.parse(ep.example.query ?? {}) : {};
  return ep.resolve({ path, query, body: {}, request: new Request(`http://atlas.local${ep.example.request}`), origin: "" });
}
