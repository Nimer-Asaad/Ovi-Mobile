import "server-only";
import { prisma } from "@/lib/prisma";
import { ORDER_STATUSES, ORDER_SOURCES, MERCHANT_STATUSES } from "@/lib/constants";
import { getOrderStatusLabel, getOrderStatusBadgeVariant } from "@/lib/order-labels";
import { getMerchantStatusLabel, getMerchantStatusBadgeVariant } from "@/lib/merchant-labels";
import type { BadgeVariant } from "@/components/ui/Badge";

/** Chart colors mirror the existing Badge variant palette so donut/bar
 * segments read consistently with the status badges used elsewhere in the
 * admin UI, instead of introducing a second, unrelated color system. */
const BADGE_VARIANT_HEX: Record<BadgeVariant, string> = {
  gold: "#18B7D3",
  success: "#10b981",
  warning: "#f59e0b",
  danger: "#f43f5e",
  neutral: "#94a3b8",
};

export interface TrendPoint {
  [key: string]: string | number;
  label: string;
  orders: number;
  salesCents: number;
}

/** Orders count + sales total per day for the last 7 days (oldest to
 * newest), including today. Days with no orders are included with zero
 * values so the chart always shows a full 7-day axis. */
export async function getOrdersSalesTrend(): Promise<TrendPoint[]> {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const start = new Date(startOfToday);
  start.setDate(start.getDate() - 6);

  const orders = await prisma.order.findMany({
    where: {
      createdAt: { gte: start },
      status: { notIn: [ORDER_STATUSES.CANCELLED, ORDER_STATUSES.RETURNED] },
    },
    select: { createdAt: true, totalCents: true },
  });

  const days: (TrendPoint & { key: string })[] = [];
  for (let i = 0; i < 7; i++) {
    const day = new Date(start);
    day.setDate(start.getDate() + i);
    days.push({
      key: day.toDateString(),
      label: day.toLocaleDateString("ar", { day: "numeric", month: "numeric" }),
      orders: 0,
      salesCents: 0,
    });
  }

  const bucketByKey = new Map(days.map((day) => [day.key, day]));
  for (const order of orders) {
    const bucket = bucketByKey.get(new Date(order.createdAt).toDateString());
    if (!bucket) continue;
    bucket.orders += 1;
    bucket.salesCents += order.totalCents;
  }

  return days.map(({ label, orders: orderCount, salesCents }) => ({ label, orders: orderCount, salesCents }));
}

export interface DonutSlice {
  label: string;
  value: number;
  color: string;
}

/** Orders grouped by status, zero-filled across every known status so the
 * donut legend is always complete even when a status has no orders yet. */
export async function getOrdersByStatusBreakdown(): Promise<DonutSlice[]> {
  const counts = await prisma.order.groupBy({ by: ["status"], _count: { _all: true } });
  const countByStatus = new Map(counts.map((row) => [row.status, row._count._all]));

  return Object.values(ORDER_STATUSES).map((status) => ({
    label: getOrderStatusLabel(status),
    value: countByStatus.get(status) ?? 0,
    color: BADGE_VARIANT_HEX[getOrderStatusBadgeVariant(status)],
  }));
}

/** Merchants grouped by status, zero-filled across every known status. */
export async function getMerchantStatusBreakdown(): Promise<DonutSlice[]> {
  const counts = await prisma.merchant.groupBy({ by: ["status"], _count: { _all: true } });
  const countByStatus = new Map(counts.map((row) => [row.status, row._count._all]));

  return Object.values(MERCHANT_STATUSES).map((status) => ({
    label: getMerchantStatusLabel(status),
    value: countByStatus.get(status) ?? 0,
    color: BADGE_VARIANT_HEX[getMerchantStatusBadgeVariant(status)],
  }));
}

export interface BarPoint {
  [key: string]: string | number;
  label: string;
  value: number;
}

/** Top products by on-hand quantity at the Main Warehouse only (the
 * default stock location) — never includes rep car stock. */
export async function getTopStockProducts(limit = 6): Promise<BarPoint[]> {
  const items = await prisma.inventoryItem.findMany({
    where: { location: { isDefault: true }, quantity: { gt: 0 }, product: { isActive: true } },
    orderBy: { quantity: "desc" },
    take: limit,
    select: { quantity: true, product: { select: { name: true, nameAr: true } } },
  });

  return items.map((item) => ({
    label: item.product.nameAr ?? item.product.name,
    value: item.quantity,
  }));
}

/** Total sales amount (in cents) per rep from direct rep sales
 * (`source = REP_SALE`) only — never mixes in retail/wholesale orders.
 * Returns an empty array when no rep sales exist yet. */
export async function getRepSalesByRep(limit = 8): Promise<BarPoint[]> {
  const groups = await prisma.order.groupBy({
    by: ["createdByRepId"],
    where: { source: ORDER_SOURCES.REP_SALE, createdByRepId: { not: null } },
    _sum: { totalCents: true },
  });

  if (groups.length === 0) return [];

  const repIds = groups.map((row) => row.createdByRepId).filter((id): id is string => Boolean(id));
  const reps = await prisma.salesRepresentative.findMany({
    where: { id: { in: repIds } },
    select: { id: true, user: { select: { name: true } } },
  });
  const nameByRepId = new Map(reps.map((rep) => [rep.id, rep.user.name]));

  return groups
    .map((row) => ({
      label: nameByRepId.get(row.createdByRepId as string) ?? "—",
      value: row._sum.totalCents ?? 0,
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}
