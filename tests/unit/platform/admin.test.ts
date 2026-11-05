import { describe, expect, it } from "vitest";
import {
  ADMIN_SESSION_TTL_S,
  adminMode,
  checkAdmin,
  hostOf,
  isLocalRequest,
  isLoopbackAddress,
  safeNext,
  signAdminSession,
  tokensEqual,
  verifyAdminSession,
} from "@/server/admin";

const H = (h: Record<string, string>) => new Headers(h);
const TOKEN = "s3cret-token-value";

describe("adminMode", () => {
  it("token when ATLAS_ADMIN_TOKEN is set", () => expect(adminMode({ ATLAS_ADMIN_TOKEN: "x", NODE_ENV: "production" })).toBe("token"));
  it("localhost in development without token", () => expect(adminMode({ NODE_ENV: "development" })).toBe("localhost"));
  it("disabled in production without token", () => expect(adminMode({ NODE_ENV: "production" })).toBe("disabled"));
  it("explicit opt-in allows localhost in production", () => expect(adminMode({ NODE_ENV: "production", ATLAS_OPS_ALLOW_LOCALHOST: "1" })).toBe("localhost"));
  it("blank token counts as unset", () => expect(adminMode({ ATLAS_ADMIN_TOKEN: "  ", NODE_ENV: "development" })).toBe("localhost"));
});

describe("session cookie", () => {
  const now = 1_800_000_000;
  it("round-trips and never contains the token", () => {
    const v = signAdminSession(TOKEN, now);
    expect(v).not.toContain(TOKEN);
    expect(verifyAdminSession(v, TOKEN, now + 10)).toBe(true);
  });
  it("expires after the TTL and rejects future-dated sessions", () => {
    const v = signAdminSession(TOKEN, now);
    expect(verifyAdminSession(v, TOKEN, now + ADMIN_SESSION_TTL_S + 1)).toBe(false);
    expect(verifyAdminSession(signAdminSession(TOKEN, now + 3600), TOKEN, now)).toBe(false);
  });
  it("rejects tampering and other tokens", () => {
    const v = signAdminSession(TOKEN, now);
    const [ver, , sig] = v.split(".");
    expect(verifyAdminSession(`${ver}.${now + 5}.${sig}`, TOKEN, now + 10)).toBe(false);
    expect(verifyAdminSession(v, "other-token", now)).toBe(false);
    expect(verifyAdminSession("garbage", TOKEN, now)).toBe(false);
    expect(verifyAdminSession(null, TOKEN, now)).toBe(false);
  });
  it("tokensEqual is exact", () => {
    expect(tokensEqual(TOKEN, TOKEN)).toBe(true);
    expect(tokensEqual(TOKEN + " ", TOKEN)).toBe(false);
    expect(tokensEqual("", TOKEN)).toBe(false);
  });
});

describe("loopback detection", () => {
  it("parses hosts", () => {
    expect(hostOf("localhost:3105")).toBe("localhost");
    expect(hostOf("[::1]:3000")).toBe("::1");
    expect(hostOf("127.0.0.1")).toBe("127.0.0.1");
    expect(hostOf(null)).toBe(null);
  });
  it("recognises loopback addresses only", () => {
    for (const a of ["127.0.0.1", "127.1.2.3", "::1", "::ffff:127.0.0.1", "localhost"]) expect(isLoopbackAddress(a)).toBe(true);
    for (const a of ["10.0.0.1", "192.168.1.2", "localhost.evil.com", "0.0.0.0", ""]) expect(isLoopbackAddress(a)).toBe(false);
  });
  it("requires every forwarding hop to be loopback", () => {
    expect(isLocalRequest(H({ host: "localhost:3105" }))).toBe(true);
    expect(isLocalRequest(H({ host: "localhost:3105", "x-forwarded-for": "::1" }))).toBe(true);
    expect(isLocalRequest(H({ host: "localhost:3105", "x-forwarded-for": "203.0.113.9, 127.0.0.1" }))).toBe(false);
    expect(isLocalRequest(H({ host: "atlas.example.com" }))).toBe(false);
    expect(isLocalRequest(H({ host: "localhost", forwarded: 'for="203.0.113.9"' }))).toBe(false);
    expect(isLocalRequest(H({ host: "localhost", "x-real-ip": "198.51.100.1" }))).toBe(false);
  });
});

describe("checkAdmin", () => {
  const tokenEnv = { ATLAS_ADMIN_TOKEN: TOKEN, NODE_ENV: "production" };
  it("accepts a valid bearer token and rejects a wrong one", () => {
    expect(checkAdmin(H({ authorization: `Bearer ${TOKEN}` }), null, tokenEnv)).toMatchObject({ ok: true, via: "bearer" });
    expect(checkAdmin(H({ authorization: "Bearer nope" }), null, tokenEnv)).toMatchObject({ ok: false, reason: "invalid-token" });
  });
  it("accepts a valid session cookie when allowed", () => {
    const cookie = signAdminSession(TOKEN);
    expect(checkAdmin(H({}), cookie, tokenEnv)).toMatchObject({ ok: true, via: "session" });
    expect(checkAdmin(H({}), cookie, tokenEnv, { allowSession: false })).toMatchObject({ ok: false, reason: "login-required" });
  });
  it("token mode ignores localhost", () => {
    expect(checkAdmin(H({ host: "localhost" }), null, tokenEnv)).toMatchObject({ ok: false, reason: "login-required" });
  });
  it("localhost mode allows loopback only", () => {
    const env = { NODE_ENV: "development" };
    expect(checkAdmin(H({ host: "localhost:3105" }), null, env)).toMatchObject({ ok: true, via: "localhost" });
    expect(checkAdmin(H({ host: "atlas.example.com" }), null, env)).toMatchObject({ ok: false, reason: "not-localhost" });
  });
  it("disabled mode refuses everything", () => {
    expect(checkAdmin(H({ host: "localhost" }), null, { NODE_ENV: "production" })).toMatchObject({ ok: false, reason: "disabled" });
  });
});

describe("safeNext", () => {
  it("only allows /ops paths and never the login page", () => {
    expect(safeNext("/ops/queue?show=dead")).toBe("/ops/queue?show=dead");
    expect(safeNext("https://evil.example/ops")).toBe("/ops");
    expect(safeNext("//evil.example/ops")).toBe("/ops");
    expect(safeNext("/collections")).toBe("/ops");
    expect(safeNext("/ops/login?next=/ops")).toBe("/ops");
    expect(safeNext(undefined)).toBe("/ops");
  });
});
