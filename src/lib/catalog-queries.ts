import { Prisma } from "@prisma/client";

/**
 * Explicit `select` shapes for every PUBLIC-facing product query. These
 * deliberately never include `wholesalePriceCents` or `costCents` — public
 * pages must not even fetch those fields, not just avoid rendering them.
 * Admin queries are unaffected and keep using `include` elsewhere.
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
  category: { select: { name: true, nameAr: true } },
  brand: { select: { name: true } },
  images: {
    select: { url: true, altText: true },
    orderBy: [{ isMain: "desc" }, { sortOrder: "asc" }],
    take: 1,
  },
} satisfies Prisma.ProductSelect;

export type PublicProductCard = Prisma.ProductGetPayload<{ select: typeof PUBLIC_PRODUCT_CARD_SELECT }>;

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
  images: {
    select: { url: true, altText: true, isMain: true, sortOrder: true },
    orderBy: [{ isMain: "desc" }, { sortOrder: "asc" }],
  },
  inventoryItems: { select: { quantity: true } },
} satisfies Prisma.ProductSelect;

export type PublicProductDetail = Prisma.ProductGetPayload<{ select: typeof PUBLIC_PRODUCT_DETAIL_SELECT }>;
