import "server-only";
import { redirect } from "next/navigation";
import { getSession, type SessionUser } from "@/lib/auth/session";
import { MERCHANT_STATUSES, ROLES } from "@/lib/constants";
import type { Role } from "@/types";

/** Require any authenticated user. Redirects to /login if not signed in. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSession();
  if (!user) {
    redirect("/login");
  }
  return user;
}

/** Require an authenticated user with one of the given roles. An
 * authenticated-but-wrong-role user is sent to /dashboard, not /login. */
export async function requireRole(roles: readonly Role[]): Promise<SessionUser> {
  const user = await requireUser();
  if (!roles.includes(user.role)) {
    redirect("/dashboard");
  }
  return user;
}

/** Require an APPROVED wholesale merchant. Pending/rejected merchants are
 * redirected to /merchant/pending, not treated as unauthorized. */
export async function requireApprovedMerchant(): Promise<SessionUser> {
  const user = await requireRole([ROLES.WHOLESALE_MERCHANT]);
  if (user.merchantStatus !== MERCHANT_STATUSES.APPROVED) {
    redirect("/merchant/pending");
  }
  return user;
}
