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

/** Require a user allowed to use the cart/checkout: RETAIL_CUSTOMER or an
 * APPROVED WHOLESALE_MERCHANT. Admin and sales rep are bounced to
 * /dashboard; pending/rejected merchants go to /merchant/pending, same as
 * requireApprovedMerchant(). */
export async function requireCartEligibleUser(): Promise<SessionUser> {
  const user = await requireUser();

  if (user.role === ROLES.RETAIL_CUSTOMER) {
    return user;
  }

  if (user.role === ROLES.WHOLESALE_MERCHANT) {
    if (user.merchantStatus !== MERCHANT_STATUSES.APPROVED) {
      redirect("/merchant/pending");
    }
    return user;
  }

  redirect("/dashboard");
}
