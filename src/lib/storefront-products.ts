import type { Prisma } from "@prisma/client";

/** Customer/merchant storefront only. Never apply to internal sales or inventory. */
export const STOREFRONT_PRODUCT_WHERE = {
  isActive: true,
  isStorefrontVisible: true,
} satisfies Prisma.ProductWhereInput;

export function isStorefrontProductAvailable(product: {
  isActive: boolean;
  isStorefrontVisible: boolean;
}): boolean {
  return product.isActive && product.isStorefrontVisible;
}
