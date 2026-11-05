import { describe, expect, it } from "vitest";
import { z } from "zod";
import { PageQuery, apiError, list, ok, parseQuery, sameOrigin } from "@/server/api/http";

const Q = z.object({ category: z.enum(["a", "b"]).optional(), q: z.string().max(5).optional(), ...PageQuery });

describe("parseQuery", () => {
  it("applies defaults and coercion", () => {
    const r = parseQuery(Q, new URLSearchParams("page=2"));
    expect(r).toEqual({ ok: true, value: { page: 2, pageSize: 24 } });
  });
  it("treats empty values as absent (GET forms submit empty selects)", () => {
    const r = parseQuery(Q, new URLSearchParams("category=&q=%20&pageSize="));
    expect(r.ok && r.value).toEqual({ page: 1, pageSize: 24 });
  });
  it("reports unknown parameters instead of ignoring them", () => {
    const r = parseQuery(Q, new URLSearchParams("categry=a"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues).toEqual([{ path: "categry", message: "unknown parameter" }]);
  });
  it("reports invalid values with their path", () => {
    const r = parseQuery(Q, new URLSearchParams("category=zzz&pageSize=500"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.map((i) => i.path).sort()).toEqual(["category", "pageSize"]);
  });
});

describe("envelopes", () => {
  it("list -> {data,page,pageSize,total} with cache header", async () => {
    const res = list([1, 2], { page: 1, pageSize: 2, total: 9 }, "catalog");
    expect(await res.json()).toEqual({ data: [1, 2], page: 1, pageSize: 2, total: 9 });
    expect(res.headers.get("cache-control")).toMatch(/max-age=60/);
  });
  it("item -> {data}; owner data is never cached", async () => {
    const res = ok({ a: 1 }, "owner");
    expect(await res.json()).toEqual({ data: { a: 1 } });
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });
  it("errors -> {error:{code,message,issues?}} with no-store", async () => {
    const res = apiError(400, "invalid_request", "bad", [{ path: "q", message: "too long" }]);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: { code: "invalid_request", message: "bad", issues: [{ path: "q", message: "too long" }] } });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await apiError(404, "not_found", "x").json()).toEqual({ error: { code: "not_found", message: "x" } });
  });
});

describe("sameOrigin", () => {
  const req = (h: Record<string, string>) => new Request("http://localhost:3105/api/collections", { method: "POST", headers: h });
  it("allows requests without Origin (non-browser clients)", () => expect(sameOrigin(req({ host: "localhost:3105" }))).toBe(true));
  it("allows same-origin browser requests", () => expect(sameOrigin(req({ host: "localhost:3105", origin: "http://localhost:3105" }))).toBe(true));
  it("refuses cross-origin browser requests", () => expect(sameOrigin(req({ host: "localhost:3105", origin: "https://evil.example" }))).toBe(false));
});
