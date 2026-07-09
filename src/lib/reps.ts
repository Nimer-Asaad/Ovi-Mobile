import "server-only";
import { prisma } from "@/lib/prisma";
import { STOCK_LOCATION_TYPES } from "@/lib/constants";
import { isLowStock } from "@/lib/inventory";

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
    select: { quantity: true },
  });

  let totalUnits = 0;
  let lowStockCount = 0;
  for (const item of items) {
    totalUnits += item.quantity;
    if (isLowStock(item.quantity)) lowStockCount += 1;
  }

  return { totalUnits, distinctProducts: items.length, lowStockCount };
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
