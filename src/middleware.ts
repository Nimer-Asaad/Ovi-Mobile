import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session-constants";
import { isProtectedPath } from "@/lib/auth/protected-routes";

/**
 * Coarse gate only: redirects to /login if a protected path has no session
 * cookie at all. This runs on the Edge runtime, which can't reach the
 * Node-only Prisma client, so it never makes the real role/status
 * decision — that happens in each area's layout/page via
 * `src/lib/auth/guards.ts` (Node runtime, real DB check).
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (!isProtectedPath(pathname) || request.cookies.has(SESSION_COOKIE_NAME)) {
    return NextResponse.next();
  }

  return NextResponse.redirect(new URL("/login", request.url));
}

export const config = {
  matcher: [
    "/admin/:path*",
    "/merchant/:path*",
    "/rep/:path*",
    "/dashboard/:path*",
    "/cart/:path*",
    "/checkout/:path*",
    "/orders/:path*",
  ],
};
