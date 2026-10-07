import "server-only";
import { prisma } from "@/lib/prisma";
import { STOCK_LOCATION_TYPES } from "@/lib/constants";
import { buildInventoryOverviewData, type InventoryOverviewLocation, type InventoryOverviewProduct } from "@/lib/inventory-overview";
import type { DeviceFilterBrand } from "@/lib/inventory-device-filter";

// Brand → model[ → color] order, matching the same stable sequence used by
// the device-inventory grouped UI, admin/inventory/adjust, and the
// assign-stock/manual-order product pickers.
const BRAND_MODEL_ORDER = [
  { phoneModel: { phoneBrand: { sortOrder: "asc" as const } } },
  { phoneModel: { phoneBrand: { name: "asc" as const } } },
  { phoneModel: { sortOrder: "asc" as const } },
  { phoneModel: { name: "asc" as const } },
  { sortOrder: "asc" as const },
];

export interface InventoryOverviewPageData {
  locations: InventoryOverviewLocation[];
  categories: { id: string; label: string }[];
  products: InventoryOverviewProduct[];
  /** Active phone brands → active models: the exact list the other
   * brand/model pickers use (admin/products/[id]/device-inventory,
   * admin/products/[id]/variants) — feeds the "حسب نوع الجهاز" selector. */
  deviceBrands: DeviceFilterBrand[];
}

/** READ-ONLY loader behind /admin/inventory/overview: five bounded, parallel
 * queries — locations, categories, products, inventory rows, phone brands —
 * and no per-product or per-location follow-up query. Everything else
 * (stock aggregation, device compatibility) is computed in memory from these
 * rows, so adding the device filter costs one extra query, not one per card. */
export async function loadInventoryOverviewPageData(): Promise<InventoryOverviewPageData> {
  const [locationRows, categories, products, inventoryItems, phoneBrands] = await Promise.all([
    prisma.stockLocation.findMany({
      where: { type: { in: [STOCK_LOCATION_TYPES.WAREHOUSE, STOCK_LOCATION_TYPES.REP_CAR] } },
      select: {
        id: true,
        type: true,
        name: true,
        salesRep: { select: { id: true, isActive: true, user: { select: { name: true } } } },
      },
      orderBy: { name: "asc" },
    }),
    prisma.category.findMany({ orderBy: { name: "asc" } }),
    // No isActive filter — this is a physical stock-control screen, not the
    // sale-facing catalog: a discontinued/hidden product that still has real
    // InventoryItem rows in the warehouse or a rep car must stay visible to
    // ADMIN/ADMIN_ASSISTANT (see the isActive doc comment below and
    // CompanyInventoryOverview's zero-stock filter, which already hides an
    // inactive product with 0 scope-quantity by default — no extra filter
    // needed here to get that "inactive + zero stock stays hidden" behavior).
    prisma.product.findMany({
      select: {
        id: true,
        sku: true,
        name: true,
        nameAr: true,
        isActive: true,
        categoryId: true,
        category: { select: { name: true, nameAr: true } },
        images: {
          where: { mediaType: "IMAGE" },
          select: { url: true, altText: true },
          orderBy: [{ isMain: "desc" }, { sortOrder: "asc" }],
          take: 1,
        },
        variantMode: true,
        inventoryTrackingMode: true,
        variants: {
          where: { isActive: true },
          orderBy: BRAND_MODEL_ORDER,
          select: {
            id: true,
            phoneModel: { select: { id: true, name: true, nameAr: true, phoneBrandId: true, phoneBrand: { select: { id: true, name: true, nameAr: true } } } },
          },
        },
        deviceColorVariants: {
          where: { isActive: true },
          orderBy: BRAND_MODEL_ORDER,
          select: {
            id: true,
            phoneModel: { select: { id: true, name: true, nameAr: true, phoneBrandId: true, phoneBrand: { select: { id: true, name: true, nameAr: true } } } },
            color: { select: { id: true, name: true, nameAr: true, hexCode: true } },
          },
        },
      },
      orderBy: { name: "asc" },
    }),
    // quantity > 0 only — a location/dimension with no row here simply
    // contributes 0 wherever buildInventoryOverviewData looks it up, so
    // omitting zero rows loses no information and keeps the payload small.
    // No product.isActive filter — an inactive product's real physical
    // stock must still be counted (see the product query above).
    prisma.inventoryItem.findMany({
      where: {
        quantity: { gt: 0 },
        location: { type: { in: [STOCK_LOCATION_TYPES.WAREHOUSE, STOCK_LOCATION_TYPES.REP_CAR] } },
      },
      select: { productId: true, locationId: true, variantId: true, deviceColorVariantId: true, quantity: true },
    }),
    prisma.phoneBrand.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        nameAr: true,
        models: { where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true, nameAr: true } },
      },
    }),
  ]);

  const locations: InventoryOverviewLocation[] = locationRows.map((location) => ({
    id: location.id,
    type: location.type as "WAREHOUSE" | "REP_CAR",
    name: location.name,
    repId: location.salesRep?.id ?? null,
    repName: location.salesRep?.user.name ?? null,
    repIsActive: location.salesRep?.isActive ?? null,
  }));

  return {
    locations,
    categories: categories.map((category) => ({ id: category.id, label: category.nameAr ?? category.name })),
    products: buildInventoryOverviewData(products, inventoryItems),
    deviceBrands: phoneBrands
      .filter((brand) => brand.models.length > 0)
      .map((brand) => ({
        id: brand.id,
        label: brand.nameAr ?? brand.name,
        models: brand.models.map((model) => ({ id: model.id, label: model.nameAr ?? model.name })),
      })),
  };
}
