/**
 * Admin guard for /ops and /api/ops/*.
 *
 * Modes:
 *  - token:     ATLAS_ADMIN_TOKEN is set. Pages and Server Actions need the `atlas_admin` session
 *               cookie (issued by /ops/login, HMAC-signed with the token, 12 h). API routes need
 *               `Authorization: Bearer <token>`.
 *  - localhost: token unset outside production (or ATLAS_OPS_ALLOW_LOCALHOST=1). Only requests whose
 *               Host and forwarding headers are all loopback are allowed. Headers can be forged by a
 *               client that can reach the server directly, so this mode is a development convenience,
 *               never a production control.
 *  - disabled:  token unset in production. Every admin request is refused.
 *
 * Every admin Server Action and route handler calls requireAdmin()/requireAdminRequest() itself;
 * nothing relies on the proxy or a layout for authorization.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

export const ADMIN_COOKIE = "atlas_admin";
export const ADMIN_SESSION_TTL_S = 12 * 60 * 60;
const SESSION_VERSION = "v1";

export type AdminMode = "token" | "localhost" | "disabled";
export type AdminVia = "session" | "bearer" | "localhost";
export type AdminDenyReason = "login-required" | "invalid-token" | "not-localhost" | "disabled";
export type AdminAccess = { ok: true; mode: AdminMode; via: AdminVia } | { ok: false; mode: AdminMode; reason: AdminDenyReason };

type Env = Record<string, string | undefined>;

export function adminToken(env: Env = process.env): string | null {
  const t = env.ATLAS_ADMIN_TOKEN?.trim();
  return t ? t : null;
}

export function adminMode(env: Env = process.env): AdminMode {
  if (adminToken(env)) return "token";
  if (env.NODE_ENV !== "production" || env.ATLAS_OPS_ALLOW_LOCALHOST === "1") return "localhost";
  return "disabled";
}

const digest = (s: string) => createHash("sha256").update(s).digest();

/** Constant-time comparison of a presented token with the configured one. */
export function tokensEqual(presented: string, expected: string): boolean {
  return timingSafeEqual(digest(presented), digest(expected));
}

function sessionSignature(token: string, issuedAt: number): string {
  return createHmac("sha256", token).update(`atlas-admin:${SESSION_VERSION}:${issuedAt}`).digest("hex");
}

/** Session cookie value `v1.<issuedAtSeconds>.<hmac>`; the token itself never leaves the server. */
export function signAdminSession(token: string, nowSec = Math.floor(Date.now() / 1000)): string {
  return `${SESSION_VERSION}.${nowSec}.${sessionSignature(token, nowSec)}`;
}

export function verifyAdminSession(value: string | undefined | null, token: string, nowSec = Math.floor(Date.now() / 1000)): boolean {
  if (!value) return false;
  const [version, issued, sig] = value.split(".");
  if (version !== SESSION_VERSION || !issued || !sig || !/^\d{1,12}$/.test(issued) || !/^[0-9a-f]{64}$/.test(sig)) return false;
  const issuedAt = Number(issued);
  if (issuedAt > nowSec + 60 || nowSec - issuedAt > ADMIN_SESSION_TTL_S) return false;
  return timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(sessionSignature(token, issuedAt), "hex"));
}

/** Hostname part of a Host header ("localhost:3105", "[::1]:3000", "127.0.0.1"). */
export function hostOf(hostHeader: string | null | undefined): string | null {
  if (!hostHeader) return null;
  const h = hostHeader.trim().toLowerCase();
  if (h.startsWith("[")) {
    const end = h.indexOf("]");
    return end > 0 ? h.slice(1, end) : null;
  }
  return h.split(":")[0] || null;
}

export function isLoopbackAddress(addr: string | null | undefined): boolean {
  if (!addr) return false;
  const a = addr.trim().toLowerCase().replace(/^\[|\]$/g, "");
  return a === "localhost" || a === "::1" || a === "0:0:0:0:0:0:0:1" || /^127(?:\.\d{1,3}){3}$/.test(a) || /^::ffff:127(?:\.\d{1,3}){3}$/.test(a);
}

/** Loopback check over Host and every forwarding header present. Pure. */
export function isLocalRequest(h: Pick<Headers, "get">): boolean {
  if (!isLoopbackAddress(hostOf(h.get("host")))) return false;
  const forwarded = [
    ...(h.get("x-forwarded-for") ?? "").split(","),
    h.get("x-real-ip") ?? "",
    ...[...(h.get("forwarded") ?? "").matchAll(/for="?\[?([^\]";,]+)/gi)].map((m) => m[1] ?? ""),
  ]
    .map((s) => s.trim())
    .filter(Boolean);
  return forwarded.every(isLoopbackAddress);
}

function bearerOf(h: Pick<Headers, "get">): string | null {
  const auth = h.get("authorization");
  const m = auth?.match(/^Bearer\s+(.+)$/i);
  return m?.[1]?.trim() || null;
}

/** Decide admin access from request headers + session cookie. Pure given env. */
export function checkAdmin(h: Pick<Headers, "get">, sessionCookie: string | undefined | null, env: Env = process.env, opts: { allowSession?: boolean; allowBearer?: boolean } = {}): AdminAccess {
  const mode = adminMode(env);
  if (mode === "disabled") return { ok: false, mode, reason: "disabled" };
  if (mode === "localhost") return isLocalRequest(h) ? { ok: true, mode, via: "localhost" } : { ok: false, mode, reason: "not-localhost" };
  const token = adminToken(env)!;
  if (opts.allowBearer !== false) {
    const bearer = bearerOf(h);
    if (bearer) return tokensEqual(bearer, token) ? { ok: true, mode, via: "bearer" } : { ok: false, mode, reason: "invalid-token" };
  }
  if (opts.allowSession !== false && verifyAdminSession(sessionCookie, token)) return { ok: true, mode, via: "session" };
  return { ok: false, mode, reason: "login-required" };
}

/** Access for the current page / Server Action request (session cookie, or localhost mode). */
export async function getAdminAccess(): Promise<AdminAccess> {
  const [h, c] = await Promise.all([headers(), cookies()]);
  return checkAdmin(h, c.get(ADMIN_COOKIE)?.value, process.env, { allowBearer: false });
}

export class AdminAuthError extends Error {
  constructor(public readonly reason: AdminDenyReason) {
    super(`admin access denied: ${reason}`);
    this.name = "AdminAuthError";
  }
}

/** Server Actions: throws AdminAuthError unless the caller is an admin. */
export async function requireAdmin(): Promise<Extract<AdminAccess, { ok: true }>> {
  const access = await getAdminAccess();
  if (!access.ok) throw new AdminAuthError(access.reason);
  return access;
}

/** Pages: redirects to /ops/login (which explains the mode) unless the caller is an admin. */
export async function requireAdminPage(next = "/ops"): Promise<Extract<AdminAccess, { ok: true }>> {
  const access = await getAdminAccess();
  if (!access.ok) redirect(`/ops/login?next=${encodeURIComponent(safeNext(next))}&reason=${access.reason}`);
  return access;
}

/** Route handlers (/api/ops/*): Bearer token (or localhost mode). Returns an error Response or null. */
export function requireAdminRequest(request: Request): Response | null {
  const access = checkAdmin(request.headers, null, process.env, { allowSession: false });
  if (access.ok) return null;
  const status = access.reason === "login-required" || access.reason === "invalid-token" ? 401 : 403;
  const message = {
    "login-required": "Send Authorization: Bearer <ATLAS_ADMIN_TOKEN>.",
    "invalid-token": "The bearer token is not valid.",
    "not-localhost": "ATLAS_ADMIN_TOKEN is not set; admin endpoints only answer loopback requests.",
    disabled: "Admin endpoints are disabled: ATLAS_ADMIN_TOKEN is not set in this production deployment.",
  }[access.reason];
  return Response.json(
    { error: { code: status === 401 ? "unauthorized" : "forbidden", message } },
    { status, headers: { "Cache-Control": "no-store", ...(status === 401 ? { "WWW-Authenticate": 'Bearer realm="atlas-ops"' } : {}) } },
  );
}

/** Only same-site relative /ops paths are accepted as post-login destinations. */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith("/ops") || next.startsWith("//") || next.includes("\\")) return "/ops";
  return next.startsWith("/ops/login") ? "/ops" : next;
}

export async function startAdminSession(): Promise<void> {
  const token = adminToken();
  if (!token) return;
  (await cookies()).set(ADMIN_COOKIE, signAdminSession(token), {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/ops",
    maxAge: ADMIN_SESSION_TTL_S,
  });
}

export async function endAdminSession(): Promise<void> {
  (await cookies()).set(ADMIN_COOKIE, "", { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: "/ops", maxAge: 0 });
}
