import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  MERCHANT_PRODUCT_CARD_SELECT,
  PUBLIC_PRODUCT_CARD_SELECT,
  type MerchantProductCard,
  type PriceMode,
  type PublicProductCard,
} from "@/lib/catalog-queries";

export async function isProductWishlisted(userId: string, productId: string): Promise<boolean> {
  const item = await prisma.wishlistItem.findUnique({
    where: { userId_productId: { userId, productId } },
    select: { id: true },
  });
  return Boolean(item);
}

export async function addToWishlist(
  userId: string,
  productId: string,
): Promise<{ ok: true } | { ok: false; code: "PRODUCT_UNAVAILABLE"; message: string }> {
  const product = await prisma.product.findFirst({
    where: { id: productId, isActive: true },
    select: { id: true },
  });
  if (!product) {
    return { ok: false, code: "PRODUCT_UNAVAILABLE", message: "المنتج غير متاح" };
  }

  try {
    await prisma.wishlistItem.create({ data: { userId, productId } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { ok: true };
    }
    throw error;
  }
  return { ok: true };
}

export async function removeFromWishlist(userId: string, productId: string): Promise<{ ok: true }> {
  await prisma.wishlistItem.deleteMany({ where: { userId, productId } });
  return { ok: true };
}

export async function getWishlistPage(
  userId: string,
  priceMode: PriceMode,
): Promise<Array<PublicProductCard | MerchantProductCard>> {
  try {
    if (priceMode === "wholesale") {
      const items = await prisma.wishlistItem.findMany({
        where: { userId, product: { isActive: true } },
        select: { product: { select: MERCHANT_PRODUCT_CARD_SELECT } },
        orderBy: { createdAt: "desc" },
        take: 60,
      });
      return items.map((item) => item.product);
    }

    const items = await prisma.wishlistItem.findMany({
      where: { userId, product: { isActive: true } },
      select: { product: { select: PUBLIC_PRODUCT_CARD_SELECT } },
      orderBy: { createdAt: "desc" },
      take: 60,
    });
    return items.map((item) => item.product);
  } catch {
    console.error("[wishlist] page query failed", { route: "/wishlist", operation: "list" });
    return [];
  }
}
