import "server-only";
import { prisma } from "@/lib/prisma";
import { getMainWarehouse } from "@/lib/inventory";
import type { AdjustStockProductOption } from "./adjustCascades";

// Brand → model[ → color] order, so the cascading selects in
// BulkStockMovementForm/AdjustStockForm (and the picker's implicit ordering)
// present options in the same stable sequence as the device-inventory
// grouped UI and the storefront picker.
const BRAND_MODEL_ORDER = [
  { phoneModel: { phoneBrand: { sortOrder: "asc" as const } } },
  { phoneModel: { phoneBrand: { name: "asc" as const } } },
  { phoneModel: { sortOrder: "asc" as const } },
  { phoneModel: { name: "asc" as const } },
  { sortOrder: "asc" as const },
];

/** Every product's WAREHOUSE stock, in the exact shape BulkStockMovementForm/
 * AdjustStockForm need — one query, reused by every warehouse stock-movement
 * screen (/admin/inventory/adjust, /admin/inventory/receive,
 * /admin/inventory/issue) instead of three copies of the same ~90-line
 * product+stock query. Never filters to isActive: true on variants/device-
 * color combinations — a disabled one is still a valid admin stock-movement
 * target (see actions.ts). Never touches REP_CAR: stock here is always read
 * at `warehouse.id` (getMainWarehouse), the single WAREHOUSE-type
 * StockLocation — a rep's car is a completely separate StockLocation this
 * function never queries. */
export async function getWarehouseStockProductOptions(): Promise<AdjustStockProductOption[]> {
  const warehouse = await getMainWarehouse();

  const products = await prisma.product.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      sku: true,
      name: true,
      nameAr: true,
      isActive: true,
      variantMode: true,
      inventoryTrackingMode: true,
      variantAllocationStatus: true,
      images: {
        select: { url: true, altText: true },
        orderBy: [{ isMain: "desc" }, { sortOrder: "asc" }],
        take: 1,
      },
      inventoryItems: {
        where: { locationId: warehouse.id },
        select: { quantity: true, variantId: true, deviceColorVariantId: true },
      },
      variants: {
        orderBy: BRAND_MODEL_ORDER,
        select: {
          id: true,
          isActive: true,
          phoneModel: {
            select: { id: true, name: true, nameAr: true, phoneBrandId: true, phoneBrand: { select: { id: true, name: true, nameAr: true } } },
          },
        },
      },
      deviceColorVariants: {
        orderBy: BRAND_MODEL_ORDER,
        select: {
          id: true,
          isActive: true,
          phoneModel: {
            select: { id: true, name: true, nameAr: true, phoneBrandId: true, phoneBrand: { select: { id: true, name: true, nameAr: true } } },
          },
          color: { select: { id: true, name: true, nameAr: true, hexCode: true } },
        },
      },
    },
  });

  return products.map((product) => {
    const stockByVariantId = new Map(
      product.inventoryItems.filter((item) => item.variantId).map((item) => [item.variantId as string, item.quantity]),
    );
    const stockByComboId = new Map(
      product.inventoryItems.filter((item) => item.deviceColorVariantId).map((item) => [item.deviceColorVariantId as string, item.quantity]),
    );
    const plainStock = product.inventoryItems
      .filter((item) => !item.variantId && !item.deviceColorVariantId)
      .reduce((sum, item) => sum + item.quantity, 0);

    return {
      id: product.id,
      sku: product.sku,
      name: product.name,
      nameAr: product.nameAr,
      isActive: product.isActive,
      thumbnailUrl: product.images[0]?.url ?? null,
      thumbnailAlt: product.images[0]?.altText ?? null,
      stock: plainStock,
      variantMode: product.variantMode,
      inventoryTrackingMode: product.inventoryTrackingMode,
      variantAllocationStatus: product.variantAllocationStatus,
      variantChoices: product.variants.map((variant) => ({
        id: variant.id,
        isActive: variant.isActive,
        phoneBrandId: variant.phoneModel.phoneBrandId,
        brandLabel: variant.phoneModel.phoneBrand.nameAr ?? variant.phoneModel.phoneBrand.name,
        phoneModelId: variant.phoneModel.id,
        modelLabel: variant.phoneModel.nameAr ?? variant.phoneModel.name,
        stock: stockByVariantId.get(variant.id) ?? 0,
      })),
      deviceComboChoices: product.deviceColorVariants.map((combo) => ({
        id: combo.id,
        isActive: combo.isActive,
        phoneBrandId: combo.phoneModel.phoneBrandId,
        brandLabel: combo.phoneModel.phoneBrand.nameAr ?? combo.phoneModel.phoneBrand.name,
        phoneModelId: combo.phoneModel.id,
        modelLabel: combo.phoneModel.nameAr ?? combo.phoneModel.name,
        colorId: combo.color.id,
        colorLabel: combo.color.nameAr ?? combo.color.name,
        colorHex: combo.color.hexCode,
        stock: stockByComboId.get(combo.id) ?? 0,
      })),
    };
  });
}
