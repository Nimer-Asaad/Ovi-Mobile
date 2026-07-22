"use client";

import { useEffect, useState } from "react";
import { ProductCard } from "@/components/catalog/ProductCard";
import { StorefrontSection } from "@/components/storefront/StorefrontSection";
import { clearRecentlyViewed, readRecentlyViewedIds } from "@/lib/recently-viewed";
import type { CartEligibility } from "@/lib/cart";
import type { MerchantProductCard, PublicProductCard } from "@/lib/catalog-queries";

type RecentProduct = PublicProductCard | MerchantProductCard;

let recentRequestCache: { key: string; promise: Promise<RecentProduct[]> } | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function isNullableString(value: unknown): boolean {
  return value === null || typeof value === "string";
}

function parseRecentProducts(payload: unknown): RecentProduct[] | null {
  if (!isRecord(payload) || !Array.isArray(payload.products)) return null;
  const products: RecentProduct[] = [];
  for (const value of payload.products.slice(0, 8)) {
    if (!isRecord(value)) return null;
    const hasRetailPrice = typeof value.retailPriceCents === "number";
    const hasWholesalePrice = typeof value.wholesalePriceCents === "number";
    const createdAt = typeof value.createdAt === "string" ? new Date(value.createdAt) : null;
    if (
      typeof value.id !== "string" || typeof value.sku !== "string" || typeof value.name !== "string" ||
      !isNullableString(value.nameAr) || !isNullableString(value.description) || !isNullableString(value.descriptionAr) ||
      typeof value.isFeatured !== "boolean" || !Array.isArray(value.images) || !Array.isArray(value.inventoryItems) ||
      !value.images.every((image) => isRecord(image) && typeof image.url === "string" && isNullableString(image.altText)) ||
      !value.inventoryItems.every((item) => isRecord(item) && typeof item.quantity === "number") ||
      !(value.category === null || (isRecord(value.category) && typeof value.category.name === "string" && isNullableString(value.category.nameAr))) ||
      !(value.brand === null || (isRecord(value.brand) && typeof value.brand.name === "string")) ||
      hasRetailPrice === hasWholesalePrice || !createdAt || Number.isNaN(createdAt.getTime())
    ) return null;
    products.push({ ...value, createdAt } as unknown as RecentProduct);
  }
  return products;
}

function loadRecentProducts(ids: string[]): Promise<RecentProduct[]> {
  const key = ids.join("\u0000");
  if (recentRequestCache?.key === key) return recentRequestCache.promise;
  const promise = fetch("/api/products/recent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
    cache: "no-store",
  })
    .then(async (response) => response.ok ? parseRecentProducts(await response.json()) ?? [] : [])
    .catch(() => []);
  recentRequestCache = { key, promise };
  void promise.finally(() => {
    if (recentRequestCache?.promise === promise) recentRequestCache = null;
  });
  return promise;
}

export function RecentlyViewedSection({ cartEligibility }: { cartEligibility: CartEligibility }) {
  const [products, setProducts] = useState<RecentProduct[]>([]);

  useEffect(() => {
    const ids = readRecentlyViewedIds();
    if (ids.length === 0) return;
    let active = true;
    void loadRecentProducts(ids).then((recentProducts) => {
      if (active && recentProducts.length > 0) setProducts(recentProducts);
    });
    return () => { active = false; };
  }, []);

  if (products.length === 0) return null;

  return (
    <StorefrontSection
      title="منتجات شاهدتها مؤخرًا"
      subtitle="ارجع بسرعة إلى المنتجات التي لفتت انتباهك"
      action={
        <button
          type="button"
          aria-label="مسح سجل المنتجات التي شاهدتها"
          onClick={() => {
            clearRecentlyViewed();
            setProducts([]);
          }}
          className="min-h-11 rounded-card border border-navy-soft px-4 py-2 text-sm font-semibold text-neutral-bg/70 transition-colors hover:border-gold-champagne/55 hover:text-gold-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-dark"
        >
          مسح السجل
        </button>
      }
    >
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4 lg:gap-6">
        {products.map((product) => <ProductCard key={product.id} product={product} cartEligibility={cartEligibility} />)}
      </div>
    </StorefrontSection>
  );
}
