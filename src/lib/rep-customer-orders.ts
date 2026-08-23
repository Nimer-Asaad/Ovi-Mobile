import "server-only";
import { prisma } from "@/lib/prisma";
import { REP_CUSTOMER_ORDER_STATUSES } from "@/lib/constants";

export interface RepCustomerOrderItemOption {
  productId: string;
  variantId: string | null;
  deviceColorVariantId: string | null;
  quantity: number;
}

export interface RepCustomerOrderOption {
  id: string;
  customerName: string;
  createdAt: Date;
  itemCount: number;
  totalQuantity: number;
  items: RepCustomerOrderItemOption[];
}

/** Active (OPEN) customer-order templates for one rep, for the "طلبات
 * الزبائن" panel on /rep/sales/new — never another rep's orders (filtered by
 * salesRepId, the same scoping every other rep-facing query in this app
 * uses). Items carry only the identity + originally intended quantity; the
 * sale form resolves labels/current stock/price from its own `products`
 * prop when a rep clicks one (see NewSaleForm), so this never goes stale
 * relative to what's actually sellable right now. */
export async function getOpenCustomerOrdersForRep(salesRepId: string): Promise<RepCustomerOrderOption[]> {
  const orders = await prisma.repCustomerOrder.findMany({
    where: { salesRepId, status: REP_CUSTOMER_ORDER_STATUSES.OPEN },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      customerName: true,
      createdAt: true,
      items: { select: { productId: true, variantId: true, deviceColorVariantId: true, quantity: true } },
    },
  });

  return orders.map((order) => ({
    id: order.id,
    customerName: order.customerName,
    createdAt: order.createdAt,
    itemCount: order.items.length,
    totalQuantity: order.items.reduce((sum, item) => sum + item.quantity, 0),
    items: order.items,
  }));
}

export interface RepCustomerOrderSummary {
  id: string;
  customerName: string;
  status: string;
  createdAt: Date;
  itemCount: number;
}

/** Recent customer-order car-loads for a rep, any status — admin visibility
 * on /admin/reps/[id] (see the "طلبات الزبائن" card there). */
export async function getRecentCustomerOrdersForRep(salesRepId: string, limit = 10): Promise<RepCustomerOrderSummary[]> {
  const orders = await prisma.repCustomerOrder.findMany({
    where: { salesRepId },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      customerName: true,
      status: true,
      createdAt: true,
      items: { select: { id: true } },
    },
  });

  return orders.map((order) => ({
    id: order.id,
    customerName: order.customerName,
    status: order.status,
    createdAt: order.createdAt,
    itemCount: order.items.length,
  }));
}
