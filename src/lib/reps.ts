import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { STOCK_LOCATION_TYPES } from "@/lib/constants";
import { isLowStock } from "@/lib/inventory";

type Tx = Prisma.TransactionClient;

/** Next sequential employee code (REP-001, REP-002, ...). Reads the highest
 * existing numeric suffix rather than counting rows, so a deactivated/
 * removed rep never causes a code to be reused. Must run inside the same
 * transaction as the create it feeds, or two concurrent promotions could
 * generate the same code. */
export async function generateNextEmployeeCode(tx: Tx): Promise<string> {
  const reps = await tx.salesRepresentative.findMany({ select: { employeeCode: true } });
  const maxNumber = reps.reduce((max, rep) => {
    const match = rep.employeeCode.match(/^REP-(\d+)$/);
    return match ? Math.max(max, parseInt(match[1], 10)) : max;
  }, 0);
  return `REP-${String(maxNumber + 1).padStart(3, "0")}`;
}

/** Ensures a user promoted to SALES_REPRESENTATIVE has a linked
 * SalesRepresentative row — the Reps admin page and every rep-facing feature
 * (car stock, employee code, assigned merchants) read from that table, not
 * from User.role, so without this the promotion is cosmetic only. Reactivates
 * a previously-demoted rep's existing row instead of creating a duplicate,
 * since employeeCode/stock/order history should survive a role round-trip. */
export async function ensureRepProfile(tx: Tx, userId: string): Promise<{ created: boolean }> {
  const existing = await tx.salesRepresentative.findUnique({ where: { userId } });
  if (existing) {
    if (!existing.isActive) {
      await tx.salesRepresentative.update({ where: { id: existing.id }, data: { isActive: true } });
    }
    return { created: false };
  }

  const employeeCode = await generateNextEmployeeCode(tx);
  await tx.salesRepresentative.create({ data: { userId, employeeCode } });
  return { created: true };
}

/** Deactivates a demoted user's SalesRepresentative row so they stop
 * appearing as an active rep. Never deletes it — orders, stock movements,
 * and assigned merchants hold a real FK to this row. */
export async function deactivateRepProfile(tx: Tx, userId: string): Promise<void> {
  await tx.salesRepresentative.updateMany({ where: { userId, isActive: true }, data: { isActive: false } });
}

/** Lazily creates a rep's stock location if one doesn't exist yet. Only
 * call from write actions (e.g. assigning stock) — read-only GET pages must
 * show an empty state instead of mutating on load. */
export async function getOrCreateRepLocation(salesRepId: string, repName: string) {
  const existing = await prisma.stockLocation.findUnique({ where: { salesRepId } });
  if (existing) return existing;

  return prisma.stockLocation.create({
    data: {
      type: STOCK_LOCATION_TYPES.REP_CAR,
      name: `مخزون المندوب — ${repName}`,
      salesRepId,
    },
  });
}

export interface RepStockStats {
  totalUnits: number;
  distinctProducts: number;
  lowStockCount: number;
}

/** Stats for a rep's stock location. Pass `null` when the rep has no
 * location yet — returns all-zero stats without querying. */
export async function getRepStockStats(locationId: string | null): Promise<RepStockStats> {
  if (!locationId) {
    return { totalUnits: 0, distinctProducts: 0, lowStockCount: 0 };
  }

  const items = await prisma.inventoryItem.findMany({
    where: { locationId, quantity: { gt: 0 } },
    select: { productId: true, quantity: true },
  });

  let totalUnits = 0;
  let lowStockCount = 0;
  const distinctProductIds = new Set<string>();
  for (const item of items) {
    totalUnits += item.quantity;
    if (isLowStock(item.quantity)) lowStockCount += 1;
    // Rows, not products, once a product's colors are separate InventoryItem
    // rows — count distinct productId so a 3-color product still counts as
    // one product, not three.
    distinctProductIds.add(item.productId);
  }

  return { totalUnits, distinctProducts: distinctProductIds.size, lowStockCount };
}

/** Admin-only: total stock value at a rep location using Product.costCents.
 * Never call this from a rep-facing page — reps must never see cost price. */
export async function getRepStockValueCents(locationId: string | null): Promise<number> {
  if (!locationId) return 0;

  const items = await prisma.inventoryItem.findMany({
    where: { locationId, quantity: { gt: 0 } },
    select: { quantity: true, product: { select: { costCents: true } } },
  });

  return items.reduce((sum, item) => sum + item.quantity * (item.product.costCents ?? 0), 0);
}

export interface RepFleetStats {
  totalReps: number;
  repsWithStock: number;
  totalUnitsAssigned: number;
}

/** Admin dashboard summary across all sales reps. */
export async function getRepFleetStats(): Promise<RepFleetStats> {
  const reps = await prisma.salesRepresentative.findMany({
    select: { carStockLocation: { select: { id: true } } },
  });

  const locationIds = reps
    .map((rep) => rep.carStockLocation?.id)
    .filter((id): id is string => Boolean(id));

  if (locationIds.length === 0) {
    return { totalReps: reps.length, repsWithStock: 0, totalUnitsAssigned: 0 };
  }

  const items = await prisma.inventoryItem.findMany({
    where: { locationId: { in: locationIds }, quantity: { gt: 0 } },
    select: { locationId: true, quantity: true },
  });

  const totalUnitsAssigned = items.reduce((sum, item) => sum + item.quantity, 0);
  const repsWithStock = new Set(items.map((item) => item.locationId)).size;

  return { totalReps: reps.length, repsWithStock, totalUnitsAssigned };
}
