/**
 * Owner identity for collections and bookmarks.
 *
 * Today every visitor is an anonymous owner: src/proxy.ts issues an `atlas_owner=<uuid>` cookie
 * (httpOnly, SameSite=Lax, Secure in production, 1 year) and owner ids are stored as `anon:<uuid>`.
 * The `app_user` table exists for a future authenticated layer: when a session is present,
 * getOwnerId() will return `user:<app_user.id>` instead and anonymous collections can be claimed
 * by rewriting `owner_id`. Callers never parse owner ids themselves.
 */
import { cookies } from "next/headers";

export const OWNER_COOKIE = "atlas_owner";
export const OWNER_COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year, seconds
/** Owner id of ATLAS editorial (curated) collections. Never issued to a visitor. */
export const CURATED_OWNER = "atlas";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isOwnerCookieValue(v: string | undefined | null): v is string {
  return !!v && UUID_RE.test(v);
}

/** `anon:<uuid>` for a valid cookie value, otherwise null. Pure. */
export function ownerIdFromCookie(v: string | undefined | null): string | null {
  return isOwnerCookieValue(v) ? `anon:${v.toLowerCase()}` : null;
}

export function ownerCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: OWNER_COOKIE_MAX_AGE,
  };
}

/** Read-only: the current owner id, or null when the visitor has no identity cookie yet. */
export async function getOwnerId(): Promise<string | null> {
  const store = await cookies();
  return ownerIdFromCookie(store.get(OWNER_COOKIE)?.value);
}

/**
 * For Server Actions and Route Handlers that write: returns the owner id, issuing the cookie
 * when the proxy did not (e.g. the request bypassed the proxy matcher).
 */
export async function requireOwnerId(): Promise<string> {
  const store = await cookies();
  const existing = ownerIdFromCookie(store.get(OWNER_COOKIE)?.value);
  if (existing) return existing;
  const id = crypto.randomUUID();
  store.set(OWNER_COOKIE, id, ownerCookieOptions());
  return `anon:${id}`;
}

/** Owner ids are opaque in the UI; this is the only label shown for them. */
export function ownerLabel(ownerId: string): string {
  if (ownerId === CURATED_OWNER) return "ATLAS editorial";
  if (ownerId.startsWith("user:")) return "Signed-in user";
  return "This browser (anonymous)";
}
