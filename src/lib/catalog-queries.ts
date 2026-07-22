import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { MERCHANT_STATUSES, ROLES } from "@/lib/constants";
import type { SessionUser } from "@/lib/auth/session";

/**
 * Explicit `select` shapes for every customer/merchant-facing product query.
 * These deliberately never include `costCents`, and the retail-mode shapes
 * never include `wholesalePriceCents` — a viewer's `select` is chosen by
 * `getPriceModeForUser` before the query runs, so ineligible viewers never
 * even fetch the field, not just avoid rendering it. Admin queries are
 * unaffected and keep using `include` elsewhere.
 */
export const PUBLIC_PRODUCT_CARD_SELECT = {
  id: true,
  sku: true,
  name: true,
  nameAr: true,
  description: true,
  descriptionAr: true,
  retailPriceCents: true,
  isFeatured: true,
  createdAt: true,
  category: { select: { name: true, nameAr: true } },
  brand: { select: { name: true } },
  inventoryItems: { where: { location: { isDefault: true } }, select: { quantity: true } },
  // Main media is always enforced IMAGE on save (see admin/products/actions.ts),
  // but the thumbnail query still filters explicitly so a video can never
  // leak into a plain <img> thumbnail if that invariant is ever violated.
  images: {
    where: { mediaType: "IMAGE" },
    select: { url: true, altText: true },
    orderBy: [{ isMain: "desc" }, { sortOrder: "asc" }],
    take: 2,
  },
} satisfies Prisma.ProductSelect;

export type PublicProductCard = Prisma.ProductGetPayload<{ select: typeof PUBLIC_PRODUCT_CARD_SELECT }>;

export const MERCHANT_PRODUCT_CARD_SELECT = {
  id: true,
  sku: true,
  name: true,
  nameAr: true,
  description: true,
  descriptionAr: true,
  wholesalePriceCents: true,
  isFeatured: true,
  createdAt: true,
  category: { select: { name: true, nameAr: true } },
  brand: { select: { name: true } },
  inventoryItems: { where: { location: { isDefault: true } }, select: { quantity: true } },
  images: {
    where: { mediaType: "IMAGE" },
    select: { url: true, altText: true },
    orderBy: [{ isMain: "desc" }, { sortOrder: "asc" }],
    take: 2,
  },
} satisfies Prisma.ProductSelect;

export type MerchantProductCard = Prisma.ProductGetPayload<{ select: typeof MERCHANT_PRODUCT_CARD_SELECT }>;

export const PUBLIC_PRODUCT_DETAIL_SELECT = {
  id: true,
  sku: true,
  name: true,
  nameAr: true,
  description: true,
  descriptionAr: true,
  retailPriceCents: true,
  isFeatured: true,
  categoryId: true,
  category: { select: { name: true, nameAr: true, slug: true } },
  brand: { select: { name: true, slug: true } },
  // Full gallery — unfiltered so videos still show, unlike the card
  // thumbnail selects above.
  images: {
    select: { url: true, altText: true, mediaType: true, isMain: true, sortOrder: true },
    orderBy: [{ isMain: "desc" }, { sortOrder: "asc" }],
  },
  /* Only Main Warehouse stock is shown/purchasable here — rep-assigned
   * stock is tracked separately and isn't part of public availability. */
  inventoryItems: { where: { location: { isDefault: true } }, select: { quantity: true } },
} satisfies Prisma.ProductSelect;

export type PublicProductDetail = Prisma.ProductGetPayload<{ select: typeof PUBLIC_PRODUCT_DETAIL_SELECT }>;

export const MERCHANT_PRODUCT_DETAIL_SELECT = {
  id: true,
  sku: true,
  name: true,
  nameAr: true,
  description: true,
  descriptionAr: true,
  wholesalePriceCents: true,
  isFeatured: true,
  categoryId: true,
  category: { select: { name: true, nameAr: true, slug: true } },
  brand: { select: { name: true, slug: true } },
  images: {
    select: { url: true, altText: true, mediaType: true, isMain: true, sortOrder: true },
    orderBy: [{ isMain: "desc" }, { sortOrder: "asc" }],
  },
  /* Only Main Warehouse stock is shown/purchasable here — rep-assigned
   * stock is tracked separately and isn't part of public availability. */
  inventoryItems: { where: { location: { isDefault: true } }, select: { quantity: true } },
} satisfies Prisma.ProductSelect;

export type MerchantProductDetail = Prisma.ProductGetPayload<{ select: typeof MERCHANT_PRODUCT_DETAIL_SELECT }>;

export type PriceMode = "retail" | "wholesale";

/** Only an APPROVED wholesale merchant sees wholesale pricing anywhere.
 * Guests, retail customers, admins, sales reps, and pending/rejected
 * merchants all get "retail" mode (harmless for roles that never reach a
 * cart anyway — they just see the same price a guest would). */
export function getPriceModeForUser(user: SessionUser | null): PriceMode {
  if (user && user.role === ROLES.WHOLESALE_MERCHANT && user.merchantStatus === MERCHANT_STATUSES.APPROVED) {
    return "wholesale";
  }
  return "retail";
}

/** True if the given card/detail object came from a wholesale-mode query —
 * used to pick which price field to read and whether to show the "سعر
 * الجملة" badge, without threading `priceMode` through every component. */
export function isWholesalePriced(
  product: { wholesalePriceCents: number } | { retailPriceCents: number },
): product is { wholesalePriceCents: number } {
  return "wholesalePriceCents" in product;
}

export function readCatalogPriceCents(
  product: { wholesalePriceCents: number } | { retailPriceCents: number },
): number {
  return isWholesalePriced(product) ? product.wholesalePriceCents : product.retailPriceCents;
}

export interface StorefrontCategory {
  name: string;
  nameAr: string | null;
  slug: string;
}

/** Active categories for storefront navigation (header row, homepage quick
 * links) — name/slug only, never the admin-side parent/product relations. */
export async function getActiveCategories(): Promise<StorefrontCategory[]> {
  return prisma.category.findMany({
    where: { isActive: true },
    select: { name: true, nameAr: true, slug: true },
    orderBy: { name: "asc" },
  });
}

export interface StorefrontBrand {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
}

/** Active brands for the homepage brand showcase. */
export async function getActiveBrands(): Promise<StorefrontBrand[]> {
  return prisma.brand.findMany({
    where: { isActive: true },
    select: { id: true, name: true, slug: true, logoUrl: true },
    orderBy: { name: "asc" },
  });
}
