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
export type RepCustomerOrderEngagementRow = RepCustomerEngagementRowBase & {
  kind: "customerOrder";
  /** REP_CUSTOMER_ORDER_STATUSES value. */
  status: string;
  /** Set once this template's status is COMPLETED — the real Order it
   * produced (via Order.repCustomerOrderId), so the row can link
   * straight to it instead of just showing a static "مكتمل" badge. */
  saleOrderNumber: string | null;
  /** Real trader identity, when one has been resolved/linked (see the
   * RepCustomerOrder.merchantId doc comment) — null for a legacy or
   * genuinely unlinked row, which stays standalone (see
   * getRepCustomerEngagementRows' grouping step below; never guessed from
   * customerName). */
  merchantId: string | null;
};

export type RepCustomerEngagementRow =
  | RepCustomerOrderEngagementRow
  | (RepCustomerEngagementRowBase & {
      kind: "sale";
      orderNumber: string;
      /** ORDER_STATUSES value. */
      orderStatus: string;
    })
  | {
      kind: "merchantGroup";
      /** Synthetic id — never a real record's own id, so it can never be
       * confused with (or bound to a cancel/link action meant for) an
       * individual RepCustomerOrder. */
      id: string;
      merchantId: string;
      /** Merchant.businessName — the one real, non-guessed identity all of
       * this group's children share. */
      customerName: string;
      /** Latest of the group's children's own createdAt, so the group sorts
       * exactly where its most recent activity would have on its own. */
      createdAt: Date;
      /** Sum of each child's own itemCount (RepCustomerOrderItem line
       * count) — "1 صنف" + "17 صنف" reads as "18 صنف" here, never a
       * quantity-unit total (see RepCustomerOrderOption's own itemCount for
       * the same convention). */
      itemCount: number;
      /** Every underlying OPEN RepCustomerOrder this trader currently has —
       * each keeps its own date/item count/status/cancel action; there is
       * deliberately no group-level cancel. */
      children: RepCustomerOrderEngagementRow[];
    };

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
        merchantId: true,
        merchant: { select: { businessName: true } },
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

  const customerOrderRows: RepCustomerOrderEngagementRow[] = customerOrders.map((order) => ({
    kind: "customerOrder",
    id: order.id,
    customerName: order.customerName,
    createdAt: order.createdAt,
    itemCount: order.items.length,
    status: order.status,
    saleOrderNumber: order.saleOrder?.orderNumber ?? null,
    merchantId: order.merchantId,
  }));
  const merchantNameById = new Map(customerOrders.filter((order) => order.merchantId).map((order) => [order.merchantId as string, order.merchant!.businessName]));

  const saleRows: RepCustomerEngagementRow[] = adHocSalesToday.map((order) => ({
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
  }));

  // Group ONLY multiple OPEN templates sharing a real (non-null) merchantId
  // into one parent "merchantGroup" row — the whole point of merchantId
  // existing (see the RepCustomerOrder doc comment). Deliberately narrow:
  //   - COMPLETED/CANCELLED rows never join a group, even if they share a
  //     merchantId with an OPEN one — their lifecycle already reads fine as
  //     its own row (saleOrderNumber link / CANCELLED badge), and folding a
  //     finished request into an "active" parent would misrepresent it.
  //   - A merchantId with only ONE open row stays a plain "customerOrder"
  //     row, not a one-child group — grouping exists to combine multiple
  //     rows, not to wrap a single one in extra UI.
  //   - null-merchantId rows (every legacy row, and any new one an admin
  //     created without a phone) are NEVER grouped with each other either —
  //     there is no stable identity proving two null-merchantId rows are the
  //     same trader (see the "طلبات الزبائن" grouping investigation).
  const openByMerchant = new Map<string, RepCustomerOrderEngagementRow[]>();
  const ungroupedCustomerOrderRows: RepCustomerOrderEngagementRow[] = [];
  for (const row of customerOrderRows) {
    if (row.status === REP_CUSTOMER_ORDER_STATUSES.OPEN && row.merchantId) {
      const bucket = openByMerchant.get(row.merchantId) ?? [];
      bucket.push(row);
      openByMerchant.set(row.merchantId, bucket);
    } else {
      ungroupedCustomerOrderRows.push(row);
    }
  }

  const groupRows: RepCustomerEngagementRow[] = [];
  for (const [merchantId, children] of openByMerchant) {
    if (children.length < 2) {
      ungroupedCustomerOrderRows.push(...children);
      continue;
    }
    const sortedChildren = children.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    groupRows.push({
      kind: "merchantGroup",
      id: `merchant-group:${merchantId}`,
      merchantId,
      customerName: merchantNameById.get(merchantId) ?? "—",
      createdAt: sortedChildren[0]!.createdAt,
      itemCount: children.reduce((sum, child) => sum + child.itemCount, 0),
      children: sortedChildren,
    });
  }

  const rows: RepCustomerEngagementRow[] = [...ungroupedCustomerOrderRows, ...groupRows, ...saleRows];

  // No slice here — every row already survived one of the two sources' own
  // pre-existing visibility rule above (count-bounded for templates,
  // date-bounded for ad-hoc sales); truncating the merged list further would
  // hide a row either original card would have shown.
  return rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}
