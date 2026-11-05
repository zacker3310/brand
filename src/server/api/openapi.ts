/**
 * OpenAPI 3.1 document generated from the route registry (no hand-written spec).
 */
import { z } from "zod";
import { API_ENDPOINTS } from "./registry";

type JsonSchema = { properties?: Record<string, Record<string, unknown>>; required?: string[] };

export function jsonSchemaOf(schema: z.ZodObject | undefined): JsonSchema {
  if (!schema) return {};
  return z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }) as JsonSchema;
}

export function openApiDocument(origin: string) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const ep of API_ENDPOINTS) {
    const pathSchema = jsonSchemaOf(ep.pathParams);
    const querySchema = jsonSchemaOf(ep.query);
    const bodySchema = ep.body ? jsonSchemaOf(ep.body) : null;
    const parameters = [
      ...Object.entries(pathSchema.properties ?? {}).map(([name, s]) => ({ name, in: "path", required: true, description: s.description, schema: s })),
      ...Object.entries(querySchema.properties ?? {}).map(([name, s]) => ({
        name,
        in: "query",
        required: (querySchema.required ?? []).includes(name),
        description: s.description,
        schema: s,
      })),
    ];
    const responses: Record<string, unknown> = {
      [ep.method === "POST" && ep.responseKind === "item" ? "201" : ep.responseKind === "action" && ep.id === "opsEnqueueRun" ? "202" : "200"]: {
        description: ep.returns,
      },
    };
    for (const code of ep.errors) responses[String(code)] = { description: "Error envelope { error: { code, message, issues? } }" };
    (paths[ep.path] ??= {})[ep.method.toLowerCase()] = {
      operationId: ep.id,
      tags: [ep.group],
      summary: ep.summary,
      description: ep.description,
      parameters,
      ...(bodySchema ? { requestBody: { required: true, content: { "application/json": { schema: bodySchema } } } } : {}),
      responses,
      ...(ep.auth === "admin" ? { security: [{ bearer: [] }] } : ep.auth === "owner" ? { security: [{ ownerCookie: [] }] } : {}),
      "x-atlas-cache": ep.cache,
    };
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "ATLAS REST API",
      version: "1",
      description:
        "Source-attributed design system index. Lists return { data, page, pageSize, total }; single items return { data }; errors return { error: { code, message, issues? } }. Names, trademarks and documentation belong to their owners.",
    },
    servers: origin ? [{ url: origin }] : [],
    components: {
      securitySchemes: {
        bearer: { type: "http", scheme: "bearer", description: "ATLAS_ADMIN_TOKEN" },
        ownerCookie: { type: "apiKey", in: "cookie", name: "atlas_owner", description: "Anonymous owner identity issued by ATLAS" },
      },
    },
    paths,
  };
}
