import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { MERCHANT_STATUSES, ROLES } from "@/lib/constants";
import { getPriceModeForUser, readCatalogPriceCents } from "@/lib/catalog-queries";
import type { SessionUser } from "@/lib/auth/session";

export type CartEligibility = "guest" | "eligible" | "ineligible";

/** Only RETAIL_CUSTOMER and APPROVED WHOLESALE_MERCHANT may use the cart.
 * Admin, sales rep, and pending/rejected merchants are "ineligible" — the UI
 * shows no cart actions for them; guests get a login prompt instead. */
export function getCartEligibility(user: SessionUser | null): CartEligibility {
  if (!user) return "guest";
  if (user.role === ROLES.RETAIL_CUSTOMER) return "eligible";
  if (user.role === ROLES.WHOLESALE_MERCHANT && user.merchantStatus === MERCHANT_STATUSES.APPROVED) {
    return "eligible";
  }
  return "ineligible";
}

/** Used only to validate stock/active-ness — deliberately carries no price
 * field at all, so it's safe regardless of viewer role. */
export const STOCK_CHECK_PRODUCT_SELECT = {
  id: true,
  name: true,
  isActive: true,
  inventoryItems: { select: { quantity: true } },
} satisfies Prisma.ProductSelect;

export type StockCheckProduct = Prisma.ProductGetPayload<{ select: typeof STOCK_CHECK_PRODUCT_SELECT }>;

export function getAvailableStock(product: { inventoryItems: { quantity: number }[] }): number {
  return product.inventoryItems.reduce((sum, item) => sum + item.quantity, 0);
}

const CART_PRODUCT_RETAIL_SELECT = {
  id: true,
  sku: true,
  name: true,
  nameAr: true,
  isActive: true,
  retailPriceCents: true,
  images: {
    select: { url: true, altText: true },
    orderBy: [{ isMain: "desc" }, { sortOrder: "asc" }],
    take: 1,
  },
  inventoryItems: { select: { quantity: true } },
} satisfies Prisma.ProductSelect;

const CART_PRODUCT_WHOLESALE_SELECT = {
  id: true,
  sku: true,
  name: true,
  nameAr: true,
  isActive: true,
  wholesalePriceCents: true,
  images: {
    select: { url: true, altText: true },
    orderBy: [{ isMain: "desc" }, { sortOrder: "asc" }],
    take: 1,
  },
  inventoryItems: { select: { quantity: true } },
} satisfies Prisma.ProductSelect;

export type CartProductRetail = Prisma.ProductGetPayload<{ select: typeof CART_PRODUCT_RETAIL_SELECT }>;
export type CartProductWholesale = Prisma.ProductGetPayload<{ select: typeof CART_PRODUCT_WHOLESALE_SELECT }>;

interface CartItemWithProduct<TProduct> {
  id: string;
  quantity: number;
  product: TProduct;
}

export interface CartWithItems<TProduct = CartProductRetail | CartProductWholesale> {
  id: string;
  userId: string;
  items: CartItemWithProduct<TProduct>[];
}

/** Fetches the current user's cart with role-appropriate product pricing —
 * a retail customer's cart never fetches `wholesalePriceCents`, and no
 * cart query ever fetches `costCents`. */
export async function getCurrentUserCart(user: SessionUser): Promise<CartWithItems | null> {
  if (getPriceModeForUser(user) === "wholesale") {
    return prisma.cart.findUnique({
      where: { userId: user.id },
      include: {
        items: {
          include: { product: { select: CART_PRODUCT_WHOLESALE_SELECT } },
          orderBy: { createdAt: "asc" },
        },
      },
    });
  }

  return prisma.cart.findUnique({
    where: { userId: user.id },
    include: {
      items: {
        include: { product: { select: CART_PRODUCT_RETAIL_SELECT } },
        orderBy: { createdAt: "asc" },
      },
    },
  });
}

export function getCartTotalCents(cart: Pick<CartWithItems, "items">): number {
  return cart.items.reduce(
    (sum, item) => sum + readCatalogPriceCents(item.product) * item.quantity,
    0,
  );
}

/** Lightweight count for the Header badge — no product join, no price. */
export async function getCartItemCount(userId: string): Promise<number> {
  const cart = await prisma.cart.findUnique({
    where: { userId },
    select: { items: { select: { quantity: true } } },
  });
  return cart?.items.reduce((sum, item) => sum + item.quantity, 0) ?? 0;
}
