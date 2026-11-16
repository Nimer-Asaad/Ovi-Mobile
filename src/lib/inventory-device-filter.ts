/** Pure helpers behind the "حسب نوع الجهاز" filter on the company inventory
 * overview (/admin/inventory/overview). No database, no server-only import —
 * the client component calls these on the dataset already built by
 * buildInventoryOverviewData.
 *
 * COMPATIBILITY SOURCE: ProductPhoneCompatibility ("this accessory fits this
 * phone model") — explicit admin-chosen METADATA, carried on every overview
 * product as compatibleModelIds. It is NOT ProductVariant (no stock bucket, no
 * allocation status) and never name text. The filter only SELECTS products:
 * the card quantity stays product.byLocation summed over the chosen location
 * scope — there is no per-model quantity in this design, a case keeps ONE
 * aggregate balance however many models it fits. */

import type { InventoryOverviewProduct } from "@/lib/inventory-overview";

export interface DeviceFilterModel {
  id: string;
  label: string;
}

export interface DeviceFilterBrand {
  id: string;
  label: string;
  models: DeviceFilterModel[];
}

/** True when the product is marked compatible with this phone model (by id). */
export function productMatchesDeviceModel(product: InventoryOverviewProduct, modelId: string): boolean {
  return Boolean(modelId) && product.compatibleModelIds.includes(modelId);
}

/** Brand that owns a model id, or "" when the id is not a known active model
 * (a stale/shared URL must degrade to "all products", never to an error). */
export function brandIdForModel(brands: DeviceFilterBrand[], modelId: string): string {
  return brands.find((brand) => brand.models.some((model) => model.id === modelId))?.id ?? "";
}

export type OverviewSortOption = "name" | "highest" | "lowest";

export interface OverviewFilterOptions {
  /** Location ids the card quantity is summed over (the "الموقع" filter). */
  scopeLocationIds: string[];
  /** PhoneModel.id of the "حسب نوع الجهاز" filter, "" = off. */
  deviceModelId: string;
  categoryId: string;
  search: string;
  showZeroStock: boolean;
  sort: OverviewSortOption;
}

export function sumByLocation(record: Record<string, number>, locationIds: string[] | null): number {
  if (locationIds === null) return Object.values(record).reduce((sum, q) => sum + q, 0);
  return locationIds.reduce((sum, id) => sum + (record[id] ?? 0), 0);
}

/** The ONE pipeline behind the overview's product-card grid: location scope →
 * (device compatibility, category, search) → zero-stock → sort. With
 * deviceModelId "" it is exactly the pre-existing behaviour; the device filter
 * only removes products, and scopeTotal is always the product's own
 * byLocation summed over the location scope — never Product.stock, never a
 * device-specific figure. */
export function filterOverviewProducts(products: InventoryOverviewProduct[], options: OverviewFilterOptions): { product: InventoryOverviewProduct; scopeTotal: number }[] {
  const trimmedQuery = options.search.trim().toLowerCase();
  const withScopeTotal = products.map((product) => ({
    product,
    scopeTotal: sumByLocation(product.byLocation, options.scopeLocationIds),
  }));

  let filtered = withScopeTotal.filter(({ product }) => {
    if (options.deviceModelId && !productMatchesDeviceModel(product, options.deviceModelId)) return false;
    if (options.categoryId && product.categoryId !== options.categoryId) return false;
    if (trimmedQuery) {
      const haystack = `${product.name} ${product.nameAr ?? ""} ${product.sku}`.toLowerCase();
      if (!haystack.includes(trimmedQuery)) return false;
    }
    return true;
  });

  if (!options.showZeroStock) {
    filtered = filtered.filter(({ scopeTotal }) => scopeTotal > 0);
  }

  filtered.sort((a, b) => {
    switch (options.sort) {
      case "highest":
        return b.scopeTotal - a.scopeTotal;
      case "lowest":
        return a.scopeTotal - b.scopeTotal;
      case "name":
      default:
        return (a.product.nameAr ?? a.product.name).localeCompare(b.product.nameAr ?? b.product.name);
    }
  });

  return filtered;
}
