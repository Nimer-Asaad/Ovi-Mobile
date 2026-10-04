/** Pure (no server-only, no database) helpers for the REP "طلبات الزبائن"
 * panel on the direct-sale page: several OPEN customer orders of the SAME
 * customer are shown as ONE card and imported into the sale draft together.
 *
 * IDENTITY RULE — never the display name. Two orders belong to one group only
 * when they carry the SAME non-null `merchantId` (RepCustomerOrder.merchantId,
 * the real Merchant the order was created for). A legacy order with a null
 * merchantId has no proven identity, so it always stays its own card, exactly
 * like the admin /admin/reps/[id] grouping (see getRepCustomerEngagementRows).
 * Two different customers who happen to share a name are therefore never
 * merged. */

export interface CustomerOrderLine {
  productId: string;
  variantId: string | null;
  deviceColorVariantId: string | null;
  quantity: number;
}

export interface GroupableCustomerOrder {
  id: string;
  customerName: string;
  /** The real customer identity; null for a legacy/unlinked order. */
  merchantId: string | null;
  /** Merchant.businessName when merchantId is set. */
  merchantName?: string | null;
  createdAt: Date | string;
  items: CustomerOrderLine[];
}

export interface AggregatedCustomerLine extends CustomerOrderLine {
  /** Source orders this line came from (traceability). */
  sourceOrderIds: string[];
}

export interface CustomerOrderGroup<T extends GroupableCustomerOrder> {
  /** `merchant:<id>` for a real customer, `order:<id>` for an unlinked order. */
  key: string;
  merchantId: string | null;
  customerName: string;
  /** Newest first. */
  orders: T[];
  /** Every included source order, newest first — what the sale must complete. */
  orderIds: string[];
  orderCount: number;
  /** Sum of requested quantities over every included order. */
  totalQuantity: number;
  /** Distinct sellable lines after aggregation (see customerLineKey). */
  itemCount: number;
  lines: AggregatedCustomerLine[];
  /** Newest included order — keeps the panel's "newest first" ordering. */
  createdAt: Date | string;
}

/** The ONE line identity — the same `product:variant:device-combo` key
 * createRepSaleCore and the InventoryItem buckets use. Two lines merge only
 * when ALL of it matches; a different compatibility model (variantId) or a
 * different color combination (deviceColorVariantId) stays a separate line. */
export function customerLineKey(line: Pick<CustomerOrderLine, "productId" | "variantId" | "deviceColorVariantId">): string {
  return `${line.productId}:${line.variantId ?? ""}:${line.deviceColorVariantId ?? ""}`;
}

const time = (value: Date | string) => new Date(value).getTime();

/** Combines the lines of several orders: identical identities are summed. */
export function aggregateCustomerOrderLines(orders: GroupableCustomerOrder[]): AggregatedCustomerLine[] {
  const byKey = new Map<string, AggregatedCustomerLine>();
  for (const order of orders) {
    for (const item of order.items) {
      const key = customerLineKey(item);
      const existing = byKey.get(key);
      if (existing) {
        existing.quantity += item.quantity;
        if (!existing.sourceOrderIds.includes(order.id)) existing.sourceOrderIds.push(order.id);
      } else {
        byKey.set(key, { productId: item.productId, variantId: item.variantId, deviceColorVariantId: item.deviceColorVariantId, quantity: item.quantity, sourceOrderIds: [order.id] });
      }
    }
  }
  return [...byKey.values()];
}

/** Groups the rep's currently OPEN customer orders (the caller has already
 * applied the eligibility filter — only OPEN orders are ever passed in) by
 * real customer identity. Groups are ordered newest-first by their newest
 * order, which is exactly where that order sat in the old flat list. */
export function groupCustomerOrders<T extends GroupableCustomerOrder>(orders: T[]): CustomerOrderGroup<T>[] {
  const buckets = new Map<string, T[]>();
  for (const order of orders) {
    const key = order.merchantId ? `merchant:${order.merchantId}` : `order:${order.id}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(order);
    else buckets.set(key, [order]);
  }

  const groups: CustomerOrderGroup<T>[] = [];
  for (const [key, bucket] of buckets) {
    const sorted = [...bucket].sort((a, b) => time(b.createdAt) - time(a.createdAt) || a.id.localeCompare(b.id));
    const lines = aggregateCustomerOrderLines(sorted);
    const newest = sorted[0]!;
    groups.push({
      key,
      merchantId: newest.merchantId,
      customerName: (sorted.length > 1 ? newest.merchantName : null) || newest.customerName,
      orders: sorted,
      orderIds: sorted.map((order) => order.id),
      orderCount: sorted.length,
      totalQuantity: lines.reduce((sum, line) => sum + line.quantity, 0),
      itemCount: lines.length,
      lines,
      createdAt: newest.createdAt,
    });
  }
  return groups.sort((a, b) => time(b.createdAt) - time(a.createdAt) || a.key.localeCompare(b.key));
}

/** What the sale draft receives when a card is clicked: the aggregated lines
 * folded per PRODUCT, because a rep-car sale is product-level (REP_CAR keeps
 * one plain balance per product and the picker never chooses a model) — the
 * exact folding handleSelectOrder always did for a single order. */
export function requestedQuantityByProduct(lines: CustomerOrderLine[]): Map<string, number> {
  const requested = new Map<string, number>();
  for (const line of lines) requested.set(line.productId, (requested.get(line.productId) ?? 0) + line.quantity);
  return requested;
}

/** Source order ids submitted with a sale: de-duplicated, order preserved.
 * `repCustomerOrderId` is the legacy single-order field (still accepted). */
export function normalizeSourceOrderIds(input: { repCustomerOrderIds?: string[] | null; repCustomerOrderId?: string | null }): string[] {
  const ids: string[] = [];
  for (const id of [...(input.repCustomerOrderIds ?? []), ...(input.repCustomerOrderId ? [input.repCustomerOrderId] : [])]) {
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/** Parses the `repCustomerOrderIds` form field (a JSON array of ids); anything
 * malformed yields [] so a tampered value can only ever mean "no source". */
export function parseSourceOrderIdsField(raw: FormDataEntryValue | null): string[] {
  if (typeof raw !== "string" || raw.trim() === "") return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string" && value.length > 0) : [];
  } catch {
    return [];
  }
}
