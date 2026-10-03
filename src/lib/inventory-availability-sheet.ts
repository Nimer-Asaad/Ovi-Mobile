import "server-only";
import { prisma } from "@/lib/prisma";
import { STOCK_LOCATION_TYPES } from "@/lib/constants";
import { buildInventoryOverviewData, type InventoryOverviewDisplayMode, type InventoryOverviewDimensionGroup, type InventoryOverviewProduct } from "@/lib/inventory-overview";
import { PRODUCT_INVENTORY_PRINT_SELECT, sortDimensionGroupsForPrint } from "@/lib/inventory-product-print";

/** A model / compatibility / variant (or brand+model+color combination) is
 * listed on the printable availability sheet only when its WAREHOUSE
 * quantity is at least this many units. This is a PRINT filter only — it
 * never hides, deactivates or alters anything in the inventory screens. */
export const MIN_AVAILABLE_WAREHOUSE_QUANTITY = 5;

export interface AvailabilityColor {
  id: string;
  label: string;
  hex: string | null;
}

export interface AvailabilityModel {
  modelId: string;
  label: string;
  /** Empty for a PHONE_COMPATIBILITY product (a model has no color there). */
  colors: AvailabilityColor[];
}

export interface AvailabilityBrand {
  brandId: string;
  label: string;
  models: AvailabilityModel[];
}

export interface ProductAvailabilitySheet {
  product: {
    id: string;
    sku: string;
    name: string;
    nameAr: string | null;
    categoryLabel: string | null;
    isActive: boolean;
    imageUrl: string | null;
    imageAlt: string | null;
  };
  mode: InventoryOverviewDisplayMode;
  /** PHONE_COMPATIBILITY / DEVICE_MODEL_COLOR: brands in print order, each with
   * only the models (and colors) whose warehouse quantity is >= the minimum.
   * Always empty for TOTAL_STOCK. */
  brands: AvailabilityBrand[];
  /** TOTAL_STOCK only: the product's own warehouse quantity, present ONLY when it
   * reaches the minimum (a smaller figure is deliberately never printed). */
  simpleWarehouseQuantity: number | null;
  /** False when nothing reaches the minimum — the page then prints a clear
   * "not enough stock to list" message instead of an empty or misleading list. */
  hasAvailability: boolean;
}

function sumLocations(byLocation: Record<string, number>, locationIds: ReadonlySet<string>): number {
  let total = 0;
  for (const [locationId, quantity] of Object.entries(byLocation)) {
    if (locationIds.has(locationId)) total += quantity;
  }
  return total;
}

/** Pure. `warehouseLocationIds` are the StockLocation ids of type WAREHOUSE —
 * the exact set the company inventory overview sums for its "المخزن"
 * column — so REP_CAR quantities (and any other location) can never reach the
 * threshold, even if they are present in `byLocation`. `sortedGroups` must
 * come from sortDimensionGroupsForPrint. The synthetic UNCLASSIFIED group
 * (stock under a retired/unknown variant) is not an identifiable model and is
 * never listed. */
export function buildProductAvailabilitySheet(
  product: InventoryOverviewProduct,
  sortedGroups: InventoryOverviewDimensionGroup[],
  warehouseLocationIds: ReadonlySet<string>,
  image: { url: string | null; alt: string | null },
): ProductAvailabilitySheet {
  const base = {
    id: product.id,
    sku: product.sku,
    name: product.name,
    nameAr: product.nameAr,
    categoryLabel: product.categoryLabel,
    isActive: product.isActive,
    imageUrl: image.url,
    imageAlt: image.alt,
  };

  if (product.displayMode === "TOTAL_STOCK") {
    const warehouseQuantity = sumLocations(product.byLocation, warehouseLocationIds);
    const sufficient = warehouseQuantity >= MIN_AVAILABLE_WAREHOUSE_QUANTITY;
    return { product: base, mode: product.displayMode, brands: [], simpleWarehouseQuantity: sufficient ? warehouseQuantity : null, hasAvailability: sufficient };
  }

  const brands: AvailabilityBrand[] = [];
  for (const group of sortedGroups) {
    if (group.isUnclassified) continue;
    if (sumLocations(group.byLocation, warehouseLocationIds) < MIN_AVAILABLE_WAREHOUSE_QUANTITY) continue;

    let brand = brands.find((candidate) => candidate.brandId === group.brandId);
    if (!brand) {
      brand = { brandId: group.brandId, label: group.brandLabel, models: [] };
      brands.push(brand);
    }
    let model = brand.models.find((candidate) => candidate.modelId === group.modelId);
    if (!model) {
      model = { modelId: group.modelId, label: group.modelLabel, colors: [] };
      brand.models.push(model);
    }
    if (group.colorId && group.colorLabel) model.colors.push({ id: group.colorId, label: group.colorLabel, hex: group.colorHex });
  }

  return { product: base, mode: product.displayMode, brands, simpleWarehouseQuantity: null, hasAvailability: brands.length > 0 };
}

/** Read-only. Three bounded queries, no N+1: the product (active variants/
 * combinations in brand -> model order + main image), every WAREHOUSE-type
 * location id, and this product's InventoryItem rows FILTERED TO WAREHOUSE
 * LOCATIONS ONLY — REP_CAR rows are never even loaded. Canonical InventoryItem
 * stock fed through the same buildInventoryOverviewData the company overview
 * uses; no legacy Product.stock-style field is read and nothing is written. */
export async function loadProductAvailabilitySheet(productId: string): Promise<ProductAvailabilitySheet | null> {
  const [raw, warehouseLocations, inventoryItems] = await Promise.all([
    prisma.product.findUnique({ where: { id: productId }, select: PRODUCT_INVENTORY_PRINT_SELECT }),
    prisma.stockLocation.findMany({ where: { type: STOCK_LOCATION_TYPES.WAREHOUSE }, select: { id: true } }),
    prisma.inventoryItem.findMany({
      where: { productId, quantity: { gt: 0 }, location: { type: STOCK_LOCATION_TYPES.WAREHOUSE } },
      select: { productId: true, locationId: true, variantId: true, deviceColorVariantId: true, quantity: true },
    }),
  ]);
  if (!raw) return null;

  const product = buildInventoryOverviewData([raw], inventoryItems)[0]!;
  const sortedGroups = sortDimensionGroupsForPrint(product.dimensionGroups);
  return buildProductAvailabilitySheet(product, sortedGroups, new Set(warehouseLocations.map((location) => location.id)), {
    url: product.thumbnailUrl,
    alt: product.thumbnailAlt,
  });
}
