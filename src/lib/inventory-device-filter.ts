/** Pure helpers behind the "حسب نوع الجهاز" filter on the company inventory
 * overview (/admin/inventory/overview). No database, no server-only import —
 * the client component calls these on the dataset already built by
 * buildInventoryOverviewData.
 *
 * COMPATIBILITY SOURCE: the canonical structured relation, never product-name
 * text. A product is compatible with a phone model when it is a
 * PHONE_COMPATIBILITY product with an ACTIVE ProductVariant for that PhoneModel
 * (ProductVariant.phoneModelId — the same relation the customer product page,
 * admin variants page and manual-order picker use). buildInventoryOverviewData
 * already turns those variants into dimensionGroups, so this reads them
 * instead of re-querying anything.
 *
 * The filter only SELECTS products. It never changes a quantity: the card
 * number stays product.byLocation summed over the chosen location scope. */

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

/** True when the product is compatible with this phone model (by id). The
 * synthetic "غير مصنّف" group (modelId "") never matches a real model, and a
 * DEVICE_MODEL_COLOR product is a phone itself, not an accessory. */
export function productMatchesDeviceModel(product: InventoryOverviewProduct, modelId: string): boolean {
  if (!modelId || product.displayMode !== "PHONE_COMPATIBILITY") return false;
  return product.dimensionGroups.some((group) => !group.isUnclassified && group.modelId === modelId);
}

export interface DeviceModelQuantity {
  /** Pieces held for the selected model alone — WAREHOUSE locations of the
   * chosen scope only, the only place stock is tracked per phone model. */
  modelQuantity: number;
  /** True when the scope contains at least one WAREHOUSE location, i.e.
   * modelQuantity is a real figure rather than "unknown". */
  hasModelScope: boolean;
  /** Pieces of this product in the scope's REP_CAR locations. Live rep-car
   * stock is one plain product-level balance (variantId null — see
   * company-inventory-report.ts and the InventoryItem doc in schema.prisma),
   * so it can NOT be attributed to any phone model; it is reported here
   * instead of being guessed into one. Part of the card's main quantity. */
  unattributedQuantity: number;
}

/** The "لهذا الجهاز" figure, with exactly what it can and cannot prove.
 *
 *  - modelQuantity: the selected model's own ProductVariant stock in the
 *    scope's WAREHOUSE locations (fully dimensional).
 *  - REP_CAR stock never contributes to modelQuantity — not the plain
 *    aggregate balance, and not any legacy per-model REP_CAR row either (the
 *    one-time aggregate-rep-car-inventory conversion zeroed those, and every
 *    live car write path uses the plain bucket). Whatever the product holds in
 *    the scope's cars is returned as unattributedQuantity.
 *
 * Secondary information only: the card's main quantity (the scope total) is
 * never replaced or recomputed from this. */
export function deviceModelQuantity(product: InventoryOverviewProduct, modelId: string, scopeLocationIds: string[], warehouseLocationIds: string[]): DeviceModelQuantity {
  const warehouseIds = new Set(warehouseLocationIds);
  const modelIds = scopeLocationIds.filter((id) => warehouseIds.has(id));
  const carIds = scopeLocationIds.filter((id) => !warehouseIds.has(id));
  let modelQuantity = 0;
  for (const group of product.dimensionGroups) {
    if (group.isUnclassified || group.modelId !== modelId) continue;
    modelQuantity += modelIds.reduce((sum, id) => sum + (group.byLocation[id] ?? 0), 0);
  }
  return {
    modelQuantity,
    hasModelScope: modelIds.length > 0,
    unattributedQuantity: carIds.reduce((sum, id) => sum + (product.byLocation[id] ?? 0), 0),
  };
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
