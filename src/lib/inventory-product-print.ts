import "server-only";
import { prisma } from "@/lib/prisma";
import { STOCK_LOCATION_TYPES } from "@/lib/constants";
import { buildInventoryOverviewData, type InventoryOverviewDimensionGroup, type InventoryOverviewProduct } from "@/lib/inventory-overview";
import { naturalCompare } from "@/lib/phone-model-grouping";

const BRAND_MODEL_ORDER = [
  { phoneModel: { phoneBrand: { sortOrder: "asc" as const } } },
  { phoneModel: { phoneBrand: { name: "asc" as const } } },
  { phoneModel: { sortOrder: "asc" as const } },
  { phoneModel: { name: "asc" as const } },
  { sortOrder: "asc" as const },
];

const PHONE_MODEL_SELECT = {
  id: true,
  name: true,
  nameAr: true,
  phoneBrandId: true,
  phoneBrand: { select: { id: true, name: true, nameAr: true } },
} as const;

export interface ProductInventoryPrintData {
  product: InventoryOverviewProduct;
  brandLabel: string | null;
  /** Labels by StockLocation.id — only used for the flat TOTAL_STOCK breakdown. */
  locationLabels: Record<string, string>;
  /** dimensionGroups in print order: brand (DB brand order, first
   * appearance) -> natural model order -> color; the unclassified catch-all
   * group always last. */
  sortedGroups: InventoryOverviewDimensionGroup[];
}

/** Read-only. Uses the exact canonical pipeline the company inventory
 * overview uses — the same InventoryItem rows (WAREHOUSE + REP_CAR,
 * quantity > 0) fed through buildInventoryOverviewData — scoped to one
 * product, so `product.total` equals the overview modal's company total.
 * Never reads any legacy Product.stock-style field. */
export async function loadProductInventoryPrint(productId: string): Promise<ProductInventoryPrintData | null> {
  const locationTypes = [STOCK_LOCATION_TYPES.WAREHOUSE, STOCK_LOCATION_TYPES.REP_CAR];
  const [raw, inventoryItems, locations] = await Promise.all([
    prisma.product.findUnique({
      where: { id: productId },
      select: {
        id: true,
        sku: true,
        name: true,
        nameAr: true,
        isActive: true,
        categoryId: true,
        category: { select: { name: true, nameAr: true } },
        brand: { select: { name: true } },
        images: { where: { mediaType: "IMAGE" }, select: { url: true, altText: true }, orderBy: [{ isMain: "desc" }, { sortOrder: "asc" }], take: 1 },
        variantMode: true,
        inventoryTrackingMode: true,
        variants: { where: { isActive: true }, orderBy: BRAND_MODEL_ORDER, select: { id: true, phoneModel: { select: PHONE_MODEL_SELECT } } },
        deviceColorVariants: {
          where: { isActive: true },
          orderBy: BRAND_MODEL_ORDER,
          select: { id: true, phoneModel: { select: PHONE_MODEL_SELECT }, color: { select: { id: true, name: true, nameAr: true, hexCode: true } } },
        },
      },
    }),
    prisma.inventoryItem.findMany({
      where: { productId, quantity: { gt: 0 }, location: { type: { in: locationTypes } } },
      select: { productId: true, locationId: true, variantId: true, deviceColorVariantId: true, quantity: true },
    }),
    prisma.stockLocation.findMany({
      where: { type: { in: locationTypes } },
      select: { id: true, type: true, name: true, salesRep: { select: { user: { select: { name: true } } } } },
    }),
  ]);
  if (!raw) return null;

  const product = buildInventoryOverviewData([raw], inventoryItems)[0]!;

  const brandOrder = new Map<string, number>();
  for (const group of product.dimensionGroups) {
    if (!brandOrder.has(group.brandId)) brandOrder.set(group.brandId, brandOrder.size);
  }
  const sortedGroups = [...product.dimensionGroups].sort((a, b) => {
    if (Boolean(a.isUnclassified) !== Boolean(b.isUnclassified)) return a.isUnclassified ? 1 : -1;
    return (
      (brandOrder.get(a.brandId) ?? 0) - (brandOrder.get(b.brandId) ?? 0) ||
      naturalCompare(a.modelLabel, b.modelLabel) ||
      naturalCompare(a.colorLabel ?? "", b.colorLabel ?? "")
    );
  });

  const locationLabels: Record<string, string> = {};
  for (const location of locations) {
    locationLabels[location.id] =
      location.type === STOCK_LOCATION_TYPES.WAREHOUSE ? location.name : location.salesRep ? `سيارة ${location.salesRep.user.name}` : location.name;
  }

  return { product, brandLabel: raw.brand?.name ?? null, locationLabels, sortedGroups };
}
