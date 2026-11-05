/**
 * Proxy (Next 16 replacement for middleware): issues the anonymous owner identity cookie.
 *
 * When `atlas_owner` is missing or malformed, a new UUID is set on the response (httpOnly,
 * SameSite=Lax, Secure in production, 1 year) AND on the forwarded request, so the very first
 * render already sees the visitor's identity. /api/* is excluded so public, cacheable API
 * responses never carry Set-Cookie; owner-scoped API routes issue the cookie themselves when they
 * write (requireOwnerId). Authorization is NOT done here: every Server Action and admin route
 * checks it itself (src/server/admin.ts).
 */
import { NextResponse, type NextRequest } from "next/server";
import { OWNER_COOKIE, isOwnerCookieValue, ownerCookieOptions } from "@/server/identity";

export function proxy(request: NextRequest) {
  if (isOwnerCookieValue(request.cookies.get(OWNER_COOKIE)?.value)) return NextResponse.next();
  const id = crypto.randomUUID();
  // RequestCookies.set rewrites the forwarded Cookie header.
  request.cookies.set(OWNER_COOKIE, id);
  const response = NextResponse.next({ request: { headers: request.headers } });
  response.cookies.set(OWNER_COOKIE, id, ownerCookieOptions());
  return response;
}

export const config = {
  matcher: [
    "/((?!api/|_next/static|_next/image|_next/data|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:png|jpe?g|gif|svg|ico|webp|avif|woff2?|ttf|css|js|map|txt)$).*)",
  ],
};
