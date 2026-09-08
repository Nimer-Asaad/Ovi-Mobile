import "server-only";
import { prisma } from "@/lib/prisma";
import { STOCK_LOCATION_TYPES } from "@/lib/constants";
import { isLowStock } from "@/lib/inventory";
import { buildInventoryOverviewData, type InventoryOverviewLocation } from "@/lib/inventory-overview";
import type { CatalogTargetType } from "@/lib/ai/tools/catalog";

/** One breakdown row inside an InventoryTargetSummary — either a single
 * dimension of a resolved PRODUCT (a brand+model, or a brand+model+color
 * combination — see buildInventoryOverviewData), or one COMPATIBLE PRODUCT
 * of a resolved PHONE_MODEL (Ovi's real "جفرات A26" shape: several distinct
 * case/cover products all compatible with the same device, each optionally
 * broken down further by material/color — see `breakdown` below). Never a
 * synthetic "Range 10"/"material" field — those aren't real schema
 * concepts; a group's own `label` is always a real Product or PhoneModel
 * name, and `breakdown` entries are always real Color names (see the schema
 * audit in the feature report). */
export interface InventoryGroupRow {
  label: string;
  subLabel: string | null;
  total: number;
  warehouseQuantity: number;
  repCarQuantity: number;
  /** Material/color split within this group — empty when not applicable
   * (a TOTAL_STOCK or PHONE_COMPATIBILITY-only group has none). */
  breakdown: { label: string; quantity: number }[];
}

export interface InventoryLocationRow {
  locationId: string;
  locationType: "WAREHOUSE" | "REP_CAR";
  locationName: string;
  repId: string | null;
  repName: string | null;
  quantity: number;
}

export interface InventoryTargetSummary {
  targetType: CatalogTargetType;
  targetId: string;
  label: string;
  subLabel: string | null;
  sku: string | null;
  totalQuantity: number;
  warehouseQuantity: number;
  repCarQuantity: number;
  groups: InventoryGroupRow[];
  byLocation: InventoryLocationRow[];
}

const OVERVIEW_PRODUCT_SELECT = {
  id: true,
  sku: true,
  name: true,
  nameAr: true,
  isActive: true,
  categoryId: true,
  category: { select: { name: true, nameAr: true } },
  // buildInventoryOverviewData's RawProduct type requires this field (used
  // for the overview page's own thumbnail) — unused by Ovi AI's response,
  // but a real, cheap (take: 1) select rather than faking the shape.
  images: { select: { url: true, altText: true }, take: 1 },
  variantMode: true,
  inventoryTrackingMode: true,
} as const;

async function getActiveLocations(): Promise<InventoryOverviewLocation[]> {
  const rows = await prisma.stockLocation.findMany({
    where: { type: { in: [STOCK_LOCATION_TYPES.WAREHOUSE, STOCK_LOCATION_TYPES.REP_CAR] } },
    select: {
      id: true,
      type: true,
      name: true,
      salesRep: { select: { id: true, isActive: true, user: { select: { name: true } } } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    type: row.type as "WAREHOUSE" | "REP_CAR",
    name: row.name,
    repId: row.salesRep?.id ?? null,
    repName: row.salesRep?.user.name ?? null,
    repIsActive: row.salesRep?.isActive ?? null,
  }));
}

function buildByLocationRows(byLocation: Record<string, number>, locations: InventoryOverviewLocation[]): InventoryLocationRow[] {
  const locationById = new Map(locations.map((location) => [location.id, location]));
  const rows: InventoryLocationRow[] = [];
  for (const [locationId, quantity] of Object.entries(byLocation)) {
    if (quantity <= 0) continue;
    const location = locationById.get(locationId);
    if (!location) continue;
    rows.push({
      locationId,
      locationType: location.type,
      locationName: location.name,
      repId: location.repId,
      repName: location.repName,
      quantity,
    });
  }
  return rows.sort((a, b) => b.quantity - a.quantity);
}

function splitWarehouseVsRepCar(rows: InventoryLocationRow[]): { warehouseQuantity: number; repCarQuantity: number } {
  let warehouseQuantity = 0;
  let repCarQuantity = 0;
  for (const row of rows) {
    if (row.locationType === "WAREHOUSE") warehouseQuantity += row.quantity;
    else repCarQuantity += row.quantity;
  }
  return { warehouseQuantity, repCarQuantity };
}

/** Resolves the full inventory picture for a single, already-resolved
 * PRODUCT target — reuses buildInventoryOverviewData (the SAME canonical
 * aggregation the /admin/inventory/overview page renders — never a second,
 * competing stock calculation), scoped to just this one product. Never
 * reads Product.stock or any other obsolete aggregate field — every number
 * comes from live InventoryItem rows, exactly like the overview page. */
async function resolveProductSummary(productId: string): Promise<InventoryTargetSummary | null> {
  const [product, locations] = await Promise.all([
    prisma.product.findUnique({
      where: { id: productId },
      select: {
        ...OVERVIEW_PRODUCT_SELECT,
        variants: {
          where: { isActive: true },
          select: {
            id: true,
            phoneModel: { select: { id: true, name: true, nameAr: true, phoneBrandId: true, phoneBrand: { select: { id: true, name: true, nameAr: true } } } },
          },
        },
        deviceColorVariants: {
          where: { isActive: true },
          select: {
            id: true,
            phoneModel: { select: { id: true, name: true, nameAr: true, phoneBrandId: true, phoneBrand: { select: { id: true, name: true, nameAr: true } } } },
            color: { select: { id: true, name: true, nameAr: true, hexCode: true } },
          },
        },
      },
    }),
    getActiveLocations(),
  ]);
  if (!product) return null;

  const items = await prisma.inventoryItem.findMany({
    where: { productId, quantity: { gt: 0 }, location: { type: { in: [STOCK_LOCATION_TYPES.WAREHOUSE, STOCK_LOCATION_TYPES.REP_CAR] } } },
    select: { productId: true, locationId: true, variantId: true, deviceColorVariantId: true, quantity: true },
  });

  const overview = buildInventoryOverviewData([product], items)[0];
  if (!overview) return null;
  const byLocation = buildByLocationRows(overview.byLocation, locations);
  const { warehouseQuantity, repCarQuantity } = splitWarehouseVsRepCar(byLocation);

  const groups: InventoryGroupRow[] = overview.dimensionGroups.map((group) => {
    const groupByLocation = buildByLocationRows(group.byLocation, locations);
    const split = splitWarehouseVsRepCar(groupByLocation);
    return {
      label: group.colorLabel ? `${group.brandLabel} ${group.modelLabel}` : `${group.brandLabel} ${group.modelLabel}`,
      subLabel: group.colorLabel,
      total: group.total,
      warehouseQuantity: split.warehouseQuantity,
      repCarQuantity: split.repCarQuantity,
      breakdown: group.colorLabel ? [{ label: group.colorLabel, quantity: group.total }] : [],
    };
  });

  return {
    targetType: "PRODUCT",
    targetId: product.id,
    label: product.nameAr ?? product.name,
    subLabel: product.category?.nameAr ?? product.category?.name ?? null,
    sku: product.sku,
    totalQuantity: overview.total,
    warehouseQuantity,
    repCarQuantity,
    groups,
    byLocation,
  };
}

/** Resolves the full inventory picture for a PHONE_MODEL target — Ovi's
 * real "جفرات A26" shape: every product compatible with this device model
 * (a case in leather, one in clear, a MagSafe range, etc.), each grouped by
 * its own material/color breakdown. Products' variants/deviceColorVariants
 * are queried FILTERED to this exact phoneModelId so a product compatible
 * with multiple models never leaks another model's stock into this
 * summary. Reuses buildInventoryOverviewData per matching product — never a
 * second, hand-rolled aggregation. */
async function resolvePhoneModelSummary(phoneModelId: string): Promise<InventoryTargetSummary | null> {
  const [phoneModel, locations] = await Promise.all([
    prisma.phoneModel.findUnique({
      where: { id: phoneModelId },
      select: { id: true, name: true, nameAr: true, phoneBrand: { select: { name: true, nameAr: true } } },
    }),
    getActiveLocations(),
  ]);
  if (!phoneModel) return null;

  const products = await prisma.product.findMany({
    where: {
      isActive: true,
      OR: [{ variants: { some: { phoneModelId, isActive: true } } }, { deviceColorVariants: { some: { phoneModelId, isActive: true } } }],
    },
    select: {
      ...OVERVIEW_PRODUCT_SELECT,
      variants: {
        where: { phoneModelId, isActive: true },
        select: {
          id: true,
          phoneModel: { select: { id: true, name: true, nameAr: true, phoneBrandId: true, phoneBrand: { select: { id: true, name: true, nameAr: true } } } },
        },
      },
      deviceColorVariants: {
        where: { phoneModelId, isActive: true },
        select: {
          id: true,
          phoneModel: { select: { id: true, name: true, nameAr: true, phoneBrandId: true, phoneBrand: { select: { id: true, name: true, nameAr: true } } } },
          color: { select: { id: true, name: true, nameAr: true, hexCode: true } },
        },
      },
    },
    take: 40,
  });
  if (products.length === 0) {
    const modelLabel = `${phoneModel.phoneBrand.nameAr ?? phoneModel.phoneBrand.name} ${phoneModel.nameAr ?? phoneModel.name}`;
    return {
      targetType: "PHONE_MODEL",
      targetId: phoneModel.id,
      label: modelLabel,
      subLabel: null,
      sku: null,
      totalQuantity: 0,
      warehouseQuantity: 0,
      repCarQuantity: 0,
      groups: [],
      byLocation: [],
    };
  }

  const variantIds = products.flatMap((product) => product.variants.map((variant) => variant.id));
  const comboIds = products.flatMap((product) => product.deviceColorVariants.map((combo) => combo.id));

  const items = await prisma.inventoryItem.findMany({
    where: {
      quantity: { gt: 0 },
      location: { type: { in: [STOCK_LOCATION_TYPES.WAREHOUSE, STOCK_LOCATION_TYPES.REP_CAR] } },
      OR: [{ variantId: { in: variantIds } }, { deviceColorVariantId: { in: comboIds } }],
    },
    select: { productId: true, locationId: true, variantId: true, deviceColorVariantId: true, quantity: true },
  });

  const overviewProducts = buildInventoryOverviewData(products, items);

  let totalQuantity = 0;
  const aggregateByLocation: Record<string, number> = {};
  const groups: InventoryGroupRow[] = [];

  for (const overview of overviewProducts) {
    if (overview.total <= 0) continue;
    totalQuantity += overview.total;
    for (const [locationId, quantity] of Object.entries(overview.byLocation)) {
      aggregateByLocation[locationId] = (aggregateByLocation[locationId] ?? 0) + quantity;
    }

    const groupByLocation = buildByLocationRows(overview.byLocation, locations);
    const split = splitWarehouseVsRepCar(groupByLocation);
    const breakdown = overview.dimensionGroups
      .filter((group) => group.colorLabel && group.total > 0)
      .map((group) => ({ label: group.colorLabel as string, quantity: group.total }));

    groups.push({
      label: overview.nameAr ?? overview.name,
      subLabel: overview.categoryLabel,
      total: overview.total,
      warehouseQuantity: split.warehouseQuantity,
      repCarQuantity: split.repCarQuantity,
      breakdown,
    });
  }

  groups.sort((a, b) => b.total - a.total);
  const byLocation = buildByLocationRows(aggregateByLocation, locations);
  const { warehouseQuantity, repCarQuantity } = splitWarehouseVsRepCar(byLocation);

  return {
    targetType: "PHONE_MODEL",
    targetId: phoneModel.id,
    label: `${phoneModel.phoneBrand.nameAr ?? phoneModel.phoneBrand.name} ${phoneModel.nameAr ?? phoneModel.name}`,
    subLabel: null,
    sku: null,
    totalQuantity,
    warehouseQuantity,
    repCarQuantity,
    groups,
    byLocation,
  };
}

/** Given an already-resolved target (a real Product.id or PhoneModel.id —
 * NEVER a client/model-invented id), returns the full inventory picture:
 * total quantity, warehouse vs. REP_CAR split, and a dimensional breakdown
 * (material/color/model as applicable) — the canonical, single source of
 * truth every other Ovi AI inventory tool below reuses. Returns null when
 * the id doesn't resolve to a real row. */
export async function getInventorySummary(targetType: CatalogTargetType, targetId: string): Promise<InventoryTargetSummary | null> {
  return targetType === "PRODUCT" ? resolveProductSummary(targetId) : resolvePhoneModelSummary(targetId);
}

export interface RepInventoryRow {
  repId: string;
  repName: string;
  quantity: number;
}

/** "مين معه A26 بالسيارات؟" — stock by representative for an already-
 * resolved target, reusing getInventorySummary's own byLocation breakdown
 * (never a second inventory query). warehouseQuantity is returned
 * separately since a rep-by-rep breakdown should never silently include the
 * warehouse as if it were a rep's own car. */
export async function getRepInventoryBreakdown(
  targetType: CatalogTargetType,
  targetId: string,
): Promise<{ label: string; warehouseQuantity: number; reps: RepInventoryRow[] } | null> {
  const summary = await getInventorySummary(targetType, targetId);
  if (!summary) return null;

  const reps: RepInventoryRow[] = summary.byLocation
    .filter((row) => row.locationType === "REP_CAR" && row.repId && row.repName)
    .map((row) => ({ repId: row.repId as string, repName: row.repName as string, quantity: row.quantity }))
    .sort((a, b) => b.quantity - a.quantity);

  return { label: summary.label, warehouseQuantity: summary.warehouseQuantity, reps };
}

export interface LowStockItem {
  productId: string;
  label: string;
  subLabel: string | null;
  totalQuantity: number;
}

const LOW_STOCK_RESULT_LIMIT_DEFAULT = 15;
const LOW_STOCK_RESULT_LIMIT_MAX = 20;

/** "شو قرب يخلص؟" — bounded list of active products whose COMPANY-WIDE
 * total (warehouse + every rep car — the same isLowStock/LOW_STOCK_THRESHOLD
 * threshold already used on the admin dashboard, never a new invented
 * number) is above zero but below the low-stock threshold. Excludes
 * inactive products and fully out-of-stock (0) products by default — those
 * are a different question ("شو خلص فعليًا؟"), not asked here. */
export async function getLowStockItems(limit = LOW_STOCK_RESULT_LIMIT_DEFAULT): Promise<LowStockItem[]> {
  const boundedLimit = Math.max(1, Math.min(limit, LOW_STOCK_RESULT_LIMIT_MAX));

  const products = await prisma.product.findMany({
    where: { isActive: true },
    select: {
      id: true,
      name: true,
      nameAr: true,
      category: { select: { name: true, nameAr: true } },
      inventoryItems: {
        where: { location: { type: { in: [STOCK_LOCATION_TYPES.WAREHOUSE, STOCK_LOCATION_TYPES.REP_CAR] } } },
        select: { quantity: true },
      },
    },
  });

  const rows: LowStockItem[] = [];
  for (const product of products) {
    const total = product.inventoryItems.reduce((sum, item) => sum + item.quantity, 0);
    if (total > 0 && isLowStock(total)) {
      rows.push({
        productId: product.id,
        label: product.nameAr ?? product.name,
        subLabel: product.category?.nameAr ?? product.category?.name ?? null,
        totalQuantity: total,
      });
    }
  }

  return rows.sort((a, b) => a.totalQuantity - b.totalQuantity).slice(0, boundedLimit);
}

export interface StockLocationsResult {
  label: string;
  warehouseQuantity: number;
  locations: InventoryLocationRow[];
}

/** "وين موجود A26؟" — thin, explicitly location-shaped view over
 * getInventorySummary's own byLocation breakdown (never a second query). */
export async function getStockLocationsForItem(targetType: CatalogTargetType, targetId: string): Promise<StockLocationsResult | null> {
  const summary = await getInventorySummary(targetType, targetId);
  if (!summary) return null;
  return { label: summary.label, warehouseQuantity: summary.warehouseQuantity, locations: summary.byLocation };
}
