import "server-only";
import { MERCHANT_STATUSES, ROLES } from "@/lib/constants";
import type { Role } from "@/types";
import type { SessionUser } from "@/lib/auth/session";

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

/** Single source of truth for the homepage "تصفح المنتجات" CTA destination
 * — deliberately distinct from getPostLoginRedirect since a customer or
 * approved merchant clicking "browse products" should land on /products
 * (the actual shopping experience), not their generic account landing
 * page, while admin/rep/pending-merchant keep their normal role redirect. */
export function getShopCtaHref(user: SessionUser | null): string {
  if (!user) return "/login";

  switch (user.role) {
    case ROLES.RETAIL_CUSTOMER:
      return "/products";
    case ROLES.WHOLESALE_MERCHANT:
      return user.merchantStatus === MERCHANT_STATUSES.APPROVED ? "/products" : "/merchant/pending";
    case ROLES.ADMIN:
      return "/admin";
    case ROLES.SALES_REPRESENTATIVE:
      return "/rep";
    default:
      return "/products";
  }
}
