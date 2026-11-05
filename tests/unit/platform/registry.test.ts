import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { API_ENDPOINTS, API_GROUPS } from "@/server/api/registry";

const ROOT = path.resolve(import.meta.dirname, "../../..");

/** /api/systems/{slug}/components -> src/app/api/systems/[slug]/components/route.ts */
function routeFile(p: string): string {
  if (p.startsWith("/api/export/")) return "src/app/api/export/[file]/route.ts";
  return `src/app${p.replace(/\{(\w+)\}/g, "[$1]")}/route.ts`;
}

describe("API route registry", () => {
  it("has unique ids and unique method+path pairs", () => {
    expect(new Set(API_ENDPOINTS.map((e) => e.id)).size).toBe(API_ENDPOINTS.length);
    expect(new Set(API_ENDPOINTS.map((e) => `${e.method} ${e.path}`)).size).toBe(API_ENDPOINTS.length);
  });
  it("every endpoint is implemented by a route file that serves it from the registry", () => {
    for (const ep of API_ENDPOINTS) {
      const f = path.join(ROOT, routeFile(ep.path));
      expect(existsSync(f), `${ep.id}: ${f}`).toBe(true);
      const src = readFileSync(f, "utf8");
      expect(new RegExp(`export (const|async function) ${ep.method}\\b`).test(src), `${ep.id}: no ${ep.method} export`).toBe(true);
      expect(src.includes(`API.${ep.id}`) || ep.path.startsWith("/api/export/"), `${ep.id} not referenced in ${f}`).toBe(true);
    }
  });
  it("documents every endpoint: group, summary, description, returns", () => {
    for (const ep of API_ENDPOINTS) {
      expect((API_GROUPS as readonly string[]).includes(ep.group)).toBe(true);
      expect(ep.summary.length).toBeGreaterThan(5);
      expect(ep.description.length).toBeGreaterThan(20);
      expect(ep.returns.length).toBeGreaterThan(3);
    }
  });
  it("parameters are documented from their Zod schemas", () => {
    for (const ep of API_ENDPOINTS) {
      for (const s of [ep.pathParams, ep.query, ep.body]) {
        if (!s) continue;
        const js = z.toJSONSchema(s, { io: "input", unrepresentable: "any" }) as { properties?: Record<string, { description?: string }> };
        for (const [name, p] of Object.entries(js.properties ?? {})) expect(p.description, `${ep.id}.${name}`).toBeTruthy();
      }
    }
  });
  it("never runs state-changing endpoints as docs examples; admin endpoints are POST", () => {
    for (const ep of API_ENDPOINTS) {
      if (ep.method === "POST") expect(ep.example, ep.id).toBeUndefined();
      if (ep.auth === "admin") expect(ep.method).toBe("POST");
    }
  });
  it("example requests parse with the endpoint's own schemas", () => {
    for (const ep of API_ENDPOINTS.filter((e) => e.example)) {
      if (ep.pathParams) expect(ep.pathParams.safeParse(ep.example!.path ?? {}).success, ep.id).toBe(true);
      if (ep.query) expect(ep.query.safeParse(ep.example!.query ?? {}).success, ep.id).toBe(true);
      const url = new URL(`http://x${ep.example!.request}`);
      for (const [k, v] of url.searchParams) expect(ep.example!.query?.[k], `${ep.id} ${k}`).toBe(v);
    }
  });
});
