import "server-only";
import { MERCHANT_STATUSES, ROLES } from "@/lib/constants";
import type { Role } from "@/types";

/** Single source of truth for "where does this role land after login /
 * when it hits /dashboard directly". */
export function getPostLoginRedirect(user: { role: Role; merchantStatus: string | null }): string {
  switch (user.role) {
    case ROLES.ADMIN:
      return "/admin";
    case ROLES.SALES_REPRESENTATIVE:
      return "/rep";
    case ROLES.WHOLESALE_MERCHANT:
      return user.merchantStatus === MERCHANT_STATUSES.APPROVED ? "/merchant" : "/merchant/pending";
    case ROLES.RETAIL_CUSTOMER:
    default:
      return "/dashboard";
  }
}
