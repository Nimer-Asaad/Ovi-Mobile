import type { Prisma } from "@prisma/client";
import { MAX_CATALOG_PRICE_CENTS, NEW_PRODUCT_DAYS } from "@/lib/constants";
import { normalizeProductSort, type ProductSort } from "@/lib/product-filter-url";

export type RawCatalogSearchParams = Record<string, string | string[] | undefined>;

export interface CatalogSearchParams {
  q?: string;
  category?: string;
  brand?: string;
  sort: ProductSort;
  page: number;
  inStock: boolean;
  isNew: boolean;
  minPrice?: string;
  maxPrice?: string;
  minPriceCents?: number;
  maxPriceCents?: number;
}

function first(raw: string | string[] | undefined): string | undefined {
  return Array.isArray(raw) ? raw[0] : raw;
}

function text(raw: string | string[] | undefined): string | undefined {
  const trimmed = first(raw)?.trim();
  return trimmed || undefined;
}

export function parsePriceCents(raw: string | string[] | undefined): number | undefined {
  const value = first(raw)?.trim();
  if (!value) return undefined;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) return undefined;
  const cents = Math.round(amount * 100);
  return Number.isSafeInteger(cents) && cents <= MAX_CATALOG_PRICE_CENTS ? cents : undefined;
}

function normalizePrice(cents: number): string {
  return (cents / 100).toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
}

export interface CatalogPriceRange {
  minPrice?: string;
  maxPrice?: string;
  minPriceCents?: number;
  maxPriceCents?: number;
}

export function parseCatalogPriceRange(
  rawMin: string | string[] | undefined,
  rawMax: string | string[] | undefined,
): CatalogPriceRange {
  const minPriceCents = parsePriceCents(rawMin);
  const maxPriceCents = parsePriceCents(rawMax);
  if (minPriceCents !== undefined && maxPriceCents !== undefined && minPriceCents > maxPriceCents) return {};
  return {
    ...(minPriceCents !== undefined ? { minPrice: normalizePrice(minPriceCents), minPriceCents } : {}),
    ...(maxPriceCents !== undefined ? { maxPrice: normalizePrice(maxPriceCents), maxPriceCents } : {}),
  };
}

export function parseCatalogSearchParams(raw: RawCatalogSearchParams): CatalogSearchParams {
  const rawPageValue = first(raw.page);
  const rawPage = rawPageValue && /^\d+$/.test(rawPageValue) ? Number(rawPageValue) : Number.NaN;
  const priceRange = parseCatalogPriceRange(raw.minPrice, raw.maxPrice);
  return {
    q: text(raw.q),
    category: text(raw.category),
    brand: text(raw.brand),
    sort: normalizeProductSort(text(raw.sort)),
    page: Number.isSafeInteger(rawPage) && rawPage > 0 ? rawPage : 1,
    inStock: first(raw.inStock) === "1",
    isNew: first(raw.isNew) === "1",
    ...priceRange,
  };
}

export function buildProductWhere(
  params: CatalogSearchParams,
  priceField: "retailPriceCents" | "wholesalePriceCents",
): Prisma.ProductWhereInput {
  const priceRange: Prisma.IntFilter = {};
  if (params.minPriceCents !== undefined) priceRange.gte = params.minPriceCents;
  if (params.maxPriceCents !== undefined) priceRange.lte = params.maxPriceCents;
  const hasPriceRange = params.minPriceCents !== undefined || params.maxPriceCents !== undefined;
  return {
    isActive: true,
    ...(params.category ? { category: { slug: params.category } } : {}),
    ...(params.brand ? { brand: { slug: params.brand } } : {}),
    ...(params.q
      ? {
          OR: [
            { name: { contains: params.q, mode: "insensitive" } },
            { nameAr: { contains: params.q, mode: "insensitive" } },
            { sku: { contains: params.q, mode: "insensitive" } },
          ],
        }
      : {}),
    ...(params.inStock
      ? { inventoryItems: { some: { location: { isDefault: true }, quantity: { gt: 0 } } } }
      : {}),
    ...(params.isNew
      ? { createdAt: { gte: new Date(Date.now() - NEW_PRODUCT_DAYS * 24 * 60 * 60 * 1000) } }
      : {}),
    ...(hasPriceRange ? { [priceField]: priceRange } : {}),
  };
}

export function buildProductOrderBy(
  sort: ProductSort,
  priceField: "retailPriceCents" | "wholesalePriceCents",
): Prisma.ProductOrderByWithRelationInput[] {
  switch (sort) {
    case "oldest":
      return [{ createdAt: "asc" }, { id: "asc" }];
    case "name":
      return [{ nameAr: "asc" }, { name: "asc" }, { id: "asc" }];
    case "price-asc":
      return [{ [priceField]: "asc" }, { id: "asc" }];
    case "price-desc":
      return [{ [priceField]: "desc" }, { id: "desc" }];
    case "featured":
      return [{ isFeatured: "desc" }, { createdAt: "desc" }, { id: "desc" }];
    default:
      return [{ createdAt: "desc" }, { id: "desc" }];
  }
}
