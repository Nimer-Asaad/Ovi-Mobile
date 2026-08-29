import "server-only";
import { prisma } from "@/lib/prisma";
import { REP_CUSTOMER_ORDER_STATUSES, ORDER_SOURCES } from "@/lib/constants";

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

interface RepCustomerEngagementRowBase {
  id: string;
  customerName: string;
  createdAt: Date;
  itemCount: number;
}

/** One row in the unified "طلبات الزبائن" list on /admin/reps/[id] — either
 * a customer-order car-load template (RepCustomerOrder — a rep may still be
 * OPEN/planned, already COMPLETED once sold, or CANCELLED) or a completed
 * ad-hoc sale the rep made with no such template. These are genuinely two
 * different underlying tables with different lifecycles, not duplicates of
 * each other: a "customerOrder" row that's COMPLETED and a "sale" row are
 * never the same event shown twice (see getRepCustomerEngagementRows for
 * exactly how that's prevented) — the discriminated `kind` lets the card
 * render each with its own real status/action instead of pretending they're
 * identical. */
export type RepCustomerEngagementRow =
  | (RepCustomerEngagementRowBase & {
      kind: "customerOrder";
      /** REP_CUSTOMER_ORDER_STATUSES value. */
      status: string;
      /** Set once this template's status is COMPLETED — the real Order it
       * produced (via Order.repCustomerOrderId), so the row can link
       * straight to it instead of just showing a static "مكتمل" badge. */
      saleOrderNumber: string | null;
    })
  | (RepCustomerEngagementRowBase & {
      kind: "sale";
      orderNumber: string;
      /** ORDER_STATUSES value. */
      orderStatus: string;
    });

/** Recent customer-order car-loads (any status, newest `customerOrderLimit`)
 * PLUS every ad-hoc rep sale made TODAY that never went through a
 * customer-order template, merged into one chronological list — admin
 * visibility on /admin/reps/[id] (the "طلبات الزبائن" card there).
 *
 * The two halves deliberately keep their own pre-existing, independent
 * bounding rules instead of sharing one merged-list cap — this replaces two
 * previously separate cards (a bounded "طلبات الزبائن" list and an unbounded
 * "مبيعات اليوم" list), and every row either of those two cards used to show
 * must still be visible here:
 * - customer-order templates: bounded by COUNT (`customerOrderLimit`,
 *   unchanged from the original getRecentCustomerOrdersForRep default of
 *   10) — this side was never date-scoped, so it isn't here either.
 * - ad-hoc sales: bounded by DATE only (today), never by count — matching
 *   the original "مبيعات اليوم" card's own `prisma.order.findMany` exactly,
 *   which had no `take` at all. Slicing this list to a fixed count would
 *   silently hide a today's sale the old UI would have shown; it is
 *   intentionally never truncated here.
 *
 * A sale that DOES have a customer-order template (Order.repCustomerOrderId
 * set) is excluded from the ad-hoc half — that same event is already
 * represented by its template's own row (with saleOrderNumber pointing at
 * it), so it's never shown twice.
 *
 * Worst case size: unchanged from before this list was unified — a rep with
 * an unusually large number of sales in one day already produced an
 * unbounded "مبيعات اليوم" card; this list is exactly as large as that card
 * plus the customer-order card would have been combined, never larger. */
export async function getRepCustomerEngagementRows(salesRepId: string, customerOrderLimit = 10): Promise<RepCustomerEngagementRow[]> {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const [customerOrders, adHocSalesToday] = await Promise.all([
    prisma.repCustomerOrder.findMany({
      where: { salesRepId },
      orderBy: { createdAt: "desc" },
      take: customerOrderLimit,
      select: {
        id: true,
        customerName: true,
        status: true,
        createdAt: true,
        items: { select: { id: true } },
        saleOrder: { select: { orderNumber: true } },
      },
    }),
    prisma.order.findMany({
      where: { createdByRepId: salesRepId, source: ORDER_SOURCES.REP_SALE, repCustomerOrderId: null, createdAt: { gte: startOfToday } },
      orderBy: { createdAt: "desc" },
      select: {
        orderNumber: true,
        contactName: true,
        status: true,
        createdAt: true,
        items: { select: { id: true } },
      },
    }),
  ]);

  const rows: RepCustomerEngagementRow[] = [
    ...customerOrders.map(
      (order): RepCustomerEngagementRow => ({
        kind: "customerOrder",
        id: order.id,
        customerName: order.customerName,
        createdAt: order.createdAt,
        itemCount: order.items.length,
        status: order.status,
        saleOrderNumber: order.saleOrder?.orderNumber ?? null,
      }),
    ),
    ...adHocSalesToday.map(
      (order): RepCustomerEngagementRow => ({
        kind: "sale",
        id: order.orderNumber,
        // contactName is a required field on the rep-sale form (min 2
        // chars) — never actually null in practice for a REP_SALE order,
        // but the column itself is nullable, so this mirrors the same "—"
        // fallback the old "مبيعات اليوم" card used, never a fabricated name.
        customerName: order.contactName ?? "—",
        createdAt: order.createdAt,
        itemCount: order.items.length,
        orderNumber: order.orderNumber,
        orderStatus: order.status,
      }),
    ),
  ];

  // No slice here — every row already survived one of the two sources' own
  // pre-existing visibility rule above (count-bounded for templates,
  // date-bounded for ad-hoc sales); truncating the merged list further would
  // hide a row either original card would have shown.
  return rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}
