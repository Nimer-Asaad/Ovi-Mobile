import "server-only";
import { prisma } from "@/lib/prisma";
import { STOCK_LOCATION_TYPES } from "@/lib/constants";

export interface CompanyInventoryReportRow {
  id: string;
  sku: string;
  name: string;
  nameAr: string | null;
  isActive: boolean;
  thumbnailUrl: string | null;
  thumbnailAlt: string | null;
  /** Sum of every WAREHOUSE InventoryItem row for this product, regardless
   * of dimension (plain / ProductVariant / DeviceColorVariant) — WAREHOUSE
   * stays fully dimensional, so this is the only correct way to get one
   * product-level number for it. */
  warehouseStock: number;
  /** Sum of ONLY the plain aggregate REP_CAR row(s) for this product
   * (variantId AND deviceColorVariantId both null) — see the doc comment on
   * getCompanyInventoryReport below for why this must never include the
   * old, zeroed-out dimensional REP_CAR rows. */
  repStock: number;
  /** warehouseStock + repStock. */
  companyTotal: number;
}

export interface CompanyInventoryReportCategory {
  categoryId: string | null;
  categoryLabel: string;
  rows: CompanyInventoryReportRow[];
}

export interface CompanyInventoryReportData {
  generatedAt: Date;
  categories: CompanyInventoryReportCategory[];
  itemCount: number;
  totalWarehouseStock: number;
  totalRepStock: number;
  totalCompanyStock: number;
}

const UNCATEGORIZED_KEY = "__UNCATEGORIZED__";
const UNCATEGORIZED_LABEL = "بدون قسم";

/** Builds the full, read-only company inventory report (WAREHOUSE + every
 * rep's REP_CAR, one row per Product) — printed and handed to the company
 * owner, so every number here must be exactly right, never estimated.
 *
 * WAREHOUSE total: sums ALL InventoryItem rows at a WAREHOUSE location for
 * the product, regardless of variantId/deviceColorVariantId — warehouse
 * stock is still fully dimensional (see the InventoryItem doc comment in
 * schema.prisma), so "the product's warehouse stock" is only meaningful as
 * that sum across every model/color leaf.
 *
 * REP_CAR total: sums ONLY the rows where variantId AND deviceColorVariantId
 * are BOTH null — the live plain aggregate balance every rep-car write path
 * uses today (assignStockToRep, completeStockRequest, createRepSaleCore,
 * returnStockFromRep — see src/app/admin/reps/actions.ts and
 * src/lib/rep-sales.ts). This is a hard filter, not an assumption that old
 * dimensional REP_CAR rows happen to be zero: the one-time conversion
 * (scripts/aggregate-rep-car-inventory.ts) zeroed every old per-model REP_CAR
 * row rather than deleting it, so they still physically exist in the table —
 * explicitly excluding anything with a non-null variantId/deviceColorVariantId
 * at a REP_CAR location is what keeps this report correct regardless of
 * whether those old rows are already zero or (in an unexpected data state)
 * somehow still positive; either way they must never count twice or count at
 * all toward "مع المندوبين".
 *
 * Three bounded queries total (one product list, two Prisma groupBy sums) —
 * no per-product follow-up query, so this scales with rep/product count
 * without an N+1 pattern. */
export async function getCompanyInventoryReport(): Promise<CompanyInventoryReportData> {
  const [products, warehouseSums, repSums] = await Promise.all([
    prisma.product.findMany({
      // No isActive filter — this is a physical stock-control report, not
      // the sale-facing catalog (same convention as /admin/inventory and
      // /admin/inventory/overview): an inactive product with real stock
      // must still be counted and printed, just visually marked.
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
      },
    }),
    prisma.inventoryItem.groupBy({
      by: ["productId"],
      where: { location: { type: STOCK_LOCATION_TYPES.WAREHOUSE } },
      _sum: { quantity: true },
    }),
    prisma.inventoryItem.groupBy({
      by: ["productId"],
      where: {
        location: { type: STOCK_LOCATION_TYPES.REP_CAR },
        variantId: null,
        deviceColorVariantId: null,
      },
      _sum: { quantity: true },
    }),
  ]);

  const warehouseByProduct = new Map(warehouseSums.map((row) => [row.productId, row._sum.quantity ?? 0]));
  const repByProduct = new Map(repSums.map((row) => [row.productId, row._sum.quantity ?? 0]));

  const categoryBuckets = new Map<string, CompanyInventoryReportCategory>();
  let totalWarehouseStock = 0;
  let totalRepStock = 0;

  for (const product of products) {
    const warehouseStock = warehouseByProduct.get(product.id) ?? 0;
    const repStock = repByProduct.get(product.id) ?? 0;
    totalWarehouseStock += warehouseStock;
    totalRepStock += repStock;

    const categoryLabel = product.category?.nameAr ?? product.category?.name ?? UNCATEGORIZED_LABEL;
    const categoryKey = product.categoryId ?? UNCATEGORIZED_KEY;
    let bucket = categoryBuckets.get(categoryKey);
    if (!bucket) {
      bucket = { categoryId: product.categoryId, categoryLabel, rows: [] };
      categoryBuckets.set(categoryKey, bucket);
    }

    bucket.rows.push({
      id: product.id,
      sku: product.sku,
      name: product.name,
      nameAr: product.nameAr,
      isActive: product.isActive,
      thumbnailUrl: product.images[0]?.url ?? null,
      thumbnailAlt: product.images[0]?.altText ?? null,
      warehouseStock,
      repStock,
      companyTotal: warehouseStock + repStock,
    });
  }

  // Category, then product name/SKU — a stable, print-friendly order.
  // "بدون قسم" always sorts last regardless of where it'd otherwise land
  // alphabetically, so the report reads as "real categories, then leftovers".
  const categories = [...categoryBuckets.values()]
    .map((category) => ({
      ...category,
      rows: category.rows.sort((a, b) => (a.nameAr ?? a.name).localeCompare(b.nameAr ?? b.name, "ar") || a.sku.localeCompare(b.sku)),
    }))
    .sort((a, b) => {
      if (a.categoryId === null && b.categoryId !== null) return 1;
      if (a.categoryId !== null && b.categoryId === null) return -1;
      return a.categoryLabel.localeCompare(b.categoryLabel, "ar");
    });

  return {
    generatedAt: new Date(),
    categories,
    itemCount: products.length,
    totalWarehouseStock,
    totalRepStock,
    totalCompanyStock: totalWarehouseStock + totalRepStock,
  };
}
