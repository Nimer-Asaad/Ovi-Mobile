/**
 * Edge-safe route list — no Prisma import here. Used by `middleware.ts` for
 * a coarse "does this path need a session cookie at all" check. The real,
 * DB-backed role/status checks live in each area's layout/page via
 * `src/lib/auth/guards.ts`, never in middleware.
 */
export const PROTECTED_PATH_PREFIXES = [
  "/admin",
  "/merchant",
  "/rep",
  "/dashboard",
  "/cart",
  "/checkout",
  "/orders",
] as const;

export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
