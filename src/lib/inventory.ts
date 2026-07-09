import "server-only";
import { prisma } from "@/lib/prisma";
import { LOW_STOCK_THRESHOLD, STOCK_LOCATION_TYPES } from "@/lib/constants";

/** The single company warehouse Phase 7 operates against. Falls back to the
 * first WAREHOUSE-type location if none is marked isDefault, so a
 * misconfigured seed doesn't hard-crash every inventory page. */
export async function getMainWarehouse() {
  const location =
    (await prisma.stockLocation.findFirst({ where: { isDefault: true } })) ??
    (await prisma.stockLocation.findFirst({ where: { type: STOCK_LOCATION_TYPES.WAREHOUSE } }));

  if (!location) {
    throw new Error("No warehouse stock location configured");
  }

  return location;
}

export function isLowStock(quantity: number): boolean {
  return quantity < LOW_STOCK_THRESHOLD;
}

export interface InventoryDashboardStats {
  totalStockUnits: number;
  lowStockProducts: number;
  outOfStockProducts: number;
  latestMovementAt: Date | null;
}

/** Stock stats scoped to active products only, matching the existing
 * catalog dashboard's "low stock" convention (inactive products aren't
 * expected to be restocked, so they don't count toward these totals). */
export async function getInventoryDashboardStats(): Promise<InventoryDashboardStats> {
  const [activeProducts, latestMovement] = await Promise.all([
    prisma.product.findMany({
      where: { isActive: true },
      select: { inventoryItems: { where: { location: { isDefault: true } }, select: { quantity: true } } },
    }),
    prisma.stockMovement.findFirst({ orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
  ]);

  let totalStockUnits = 0;
  let lowStockProducts = 0;
  let outOfStockProducts = 0;

  for (const product of activeProducts) {
    const stock = product.inventoryItems.reduce((sum, item) => sum + item.quantity, 0);
    totalStockUnits += stock;
    if (stock === 0) {
      outOfStockProducts += 1;
    } else if (isLowStock(stock)) {
      lowStockProducts += 1;
    }
  }

  return {
    totalStockUnits,
    lowStockProducts,
    outOfStockProducts,
    latestMovementAt: latestMovement?.createdAt ?? null,
  };
}
