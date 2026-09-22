import "server-only";
import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { STOCK_LOCATION_TYPES, STOCK_MOVEMENT_TYPES } from "@/lib/constants";
import { isTerminalOrderStatus } from "@/lib/order-lifecycle-rules";
import { getAccountBalanceCents, lockAccountForBalanceUpdate } from "@/lib/accounts";
import { getSalesReturnsBusinessCreatedAtByOrder } from "@/lib/business-time";
import { incrementInventoryUpsert, recordStockMovement } from "@/lib/inventory-transactions";
import { computeNetLineCents, deriveReturnStatus, incrementalPaidCreditCents, type SalesReturnStatus } from "@/lib/sales-return-math";

/** REP sales return (مردود مبيعات) — the ONE transaction that creates one.
 *
 * WHAT IT DOES, atomically (a single prisma.$transaction — any throw rolls
 * EVERYTHING back, no partial state):
 *   1. loads the invoice and verifies it belongs to `salesRepId`
 *      (Order.createdByRepId) — a rep can never return another rep's sale;
 *   2. takes the account's advisory balance lock (lockAccountForBalanceUpdate,
 *      the existing project convention — it is the FIRST lock taken, so it
 *      keeps the global account -> order -> payment lock ordering), then a
 *      row lock on the order itself (SELECT ... FOR UPDATE). Two concurrent
 *      returns of the same invoice therefore serialize; the second one
 *      re-reads the cumulative returned quantities AFTER the first one
 *      committed, so both can never "see 2 remaining" and each return 2;
 *   3. rejects a terminal (CANCELLED/RETURNED) invoice — a whole-order
 *      cancellation already restores the full stock, returning again would
 *      duplicate it (the reverse guard lives in order-lifecycle.ts);
 *   4. validates every line: integer quantity > 0, an explicit integer
 *      bonusQuantity with 0 <= bonusQuantity <= quantity (the REP declares
 *      exactly how many of the returned physical units are bonus — never
 *      guessed/inferred), belongs to THIS order, and THREE independent
 *      cumulative bounds against the original OrderItem: physical returned
 *      <= quantity, bonus returned <= bonusQuantity, and PAID returned
 *      (physical - bonus) <= quantity - bonusQuantity;
 *   5. computes the money credit with the canonical rule in
 *      src/lib/sales-return-math.ts (original persisted economics only,
 *      invoice discount allocated by largest remainder, ONLY the PAID
 *      portion of a return — never the bonus portion — ever earns credit,
 *      cumulative credit never exceeds Order.totalCents);
 *   6. inserts the immutable SalesReturn + SalesReturnItem rows;
 *   7. adds every returned unit to the rep's own REP_CAR aggregate bucket
 *      through incrementInventoryUpsert + a RETURN_IN StockMovement (never
 *      the warehouse, never the original location);
 *   8. verifies the invariants (balance delta == credit, cumulative quantity
 *      and credit bounds) before commit.
 *
 * WHAT IT NEVER TOUCHES: the original Order/OrderItem, any AccountPayment
 * or receipt, order/receipt numbering, and no cash refund is created. The
 * account effect is purely the new SalesReturn row, which the canonical
 * balance formula (getAccountBalanceCents) subtracts.
 *
 * Authorization is the CALLER's job for the role gate; ownership of the
 * invoice is enforced HERE, server-side, against the passed salesRepId. */

export interface SalesReturnLineInput {
  orderItemId: string;
  /** PHYSICAL units being returned (bonus units included) — all of it goes
   * back to REP_CAR. */
  quantity: number;
  /** How many of `quantity` are bonus units — explicit, never inferred.
   * Defaults to 0 (an ordinary all-paid return, the common case for a line
   * whose original OrderItem.bonusQuantity is 0). */
  bonusQuantity?: number;
}

export interface CreateSalesReturnInput {
  orderNumber: string;
  /** The effective SalesRepresentative.id — resolved by the caller from the
   * session, never from client input. */
  salesRepId: string;
  /** That rep's REP_CAR StockLocation.id — the ONLY place goods go. */
  carStockLocationId: string;
  /** The real acting user (rep, or the rep's own User id while an admin
   * impersonates) — StockMovement.createdById / SalesReturn.createdById. */
  actorUserId: string;
  lines: SalesReturnLineInput[];
  note?: string | null;
  /** Runs INSIDE the same transaction (impersonation audit trail). */
  onCreated?: (tx: Prisma.TransactionClient, created: { id: string; orderId: string; orderNumber: string; sequence: number; totalCreditCents: number }) => Promise<void>;
}

export type SalesReturnErrorCode =
  | "ORDER_NOT_FOUND"
  | "NOT_OWNER"
  | "ORDER_TERMINAL"
  | "NO_ACCOUNT"
  | "NO_LINES"
  | "INVALID_LINE"
  | "EXCEEDS_RETURNABLE"
  | "INVALID_LOCATION"
  | "PRICING_INCONSISTENT"
  | "INVARIANT_VIOLATION";

export type CreateSalesReturnResult =
  | { ok: true; salesReturnId: string; orderNumber: string; sequence: number; totalCreditCents: number }
  | { ok: false; code: SalesReturnErrorCode; error: string };

class SalesReturnDomainError extends Error {
  constructor(public readonly code: SalesReturnErrorCode, message: string) {
    super(message);
  }
}

/** Called by the server action AFTER createSalesReturn returns ok — kept out of
 * the transaction function so the core stays runnable outside a Next.js
 * request (verification scripts). */
export function revalidateSalesReturnPaths(orderNumber: string): void {
  revalidatePath("/rep");
  revalidatePath("/rep/sales");
  revalidatePath(`/rep/sales/${orderNumber}`);
  revalidatePath("/rep/stock");
  revalidatePath("/rep/movements");
  revalidatePath("/rep/merchants");
  revalidatePath("/admin/orders");
  revalidatePath(`/admin/orders/${orderNumber}`);
  revalidatePath("/admin/merchants");
  revalidatePath("/admin/inventory/overview");
}

export async function createSalesReturn(input: CreateSalesReturnInput): Promise<CreateSalesReturnResult> {
  try {
    const created = await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { orderNumber: input.orderNumber },
        select: { id: true, accountId: true, createdByRepId: true },
      });
      if (!order) throw new SalesReturnDomainError("ORDER_NOT_FOUND", "الفاتورة غير موجودة");
      // Ownership — checked before any lock or write.
      if (order.createdByRepId !== input.salesRepId) throw new SalesReturnDomainError("NOT_OWNER", "لا يمكنك إرجاع مبيعات هذه الفاتورة");
      if (!order.accountId) throw new SalesReturnDomainError("NO_ACCOUNT", "هذه الفاتورة غير مرتبطة بحساب تاجر");
      const accountId = order.accountId;

      // Lock order: account advisory lock FIRST (project convention), then
      // the order row. See the file header for why both.
      await lockAccountForBalanceUpdate(tx, accountId);
      await tx.$queryRaw`SELECT "id" FROM "orders" WHERE "id" = ${order.id} FOR UPDATE`;

      // Everything below is read AFTER the locks, so it reflects every
      // previously committed return.
      const fresh = await tx.order.findUniqueOrThrow({
        where: { id: order.id },
        select: {
          id: true,
          orderNumber: true,
          status: true,
          subtotalCents: true,
          discountCents: true,
          totalCents: true,
          items: { select: { id: true, productId: true, quantity: true, bonusQuantity: true, totalCents: true } },
        },
      });
      if (isTerminalOrderStatus(fresh.status)) throw new SalesReturnDomainError("ORDER_TERMINAL", "لا يمكن إرجاع مبيعات فاتورة ملغاة أو مرتجعة بالكامل");

      const car = await tx.stockLocation.findUnique({ where: { id: input.carStockLocationId }, select: { type: true, salesRepId: true } });
      if (!car || car.type !== STOCK_LOCATION_TYPES.REP_CAR || car.salesRepId !== input.salesRepId) {
        throw new SalesReturnDomainError("INVALID_LOCATION", "لم يتم العثور على سيارة المندوب");
      }

      // Merge duplicate lines for the same item (summing both quantity and
      // bonusQuantity independently), then validate shape. bonusQuantity is
      // always an explicit rep declaration — never inferred — and must
      // itself respect 0 <= bonusQuantity <= quantity for THIS operation
      // (the cumulative per-item bounds are checked separately below).
      const requested = new Map<string, { quantity: number; bonusQuantity: number }>();
      for (const line of input.lines) {
        if (!Number.isInteger(line.quantity) || line.quantity <= 0) throw new SalesReturnDomainError("INVALID_LINE", "الكمية المرتجعة يجب أن تكون رقماً صحيحاً أكبر من صفر");
        const bonusQuantity = line.bonusQuantity ?? 0;
        if (!Number.isInteger(bonusQuantity) || bonusQuantity < 0) throw new SalesReturnDomainError("INVALID_LINE", "كمية البونص المرتجعة يجب أن تكون رقماً صحيحاً غير سالب");
        if (bonusQuantity > line.quantity) throw new SalesReturnDomainError("INVALID_LINE", "كمية البونص المرتجعة أكبر من الكمية المرتجعة");
        const existing = requested.get(line.orderItemId) ?? { quantity: 0, bonusQuantity: 0 };
        requested.set(line.orderItemId, { quantity: existing.quantity + line.quantity, bonusQuantity: existing.bonusQuantity + bonusQuantity });
      }
      if (requested.size === 0) throw new SalesReturnDomainError("NO_LINES", "اختر كمية مرتجعة لصنف واحد على الأقل");

      const itemsById = new Map(fresh.items.map((item) => [item.id, item]));
      for (const orderItemId of requested.keys()) {
        if (!itemsById.has(orderItemId)) throw new SalesReturnDomainError("INVALID_LINE", "أحد الأصناف لا ينتمي لهذه الفاتورة");
      }

      const previous = await tx.salesReturnItem.groupBy({
        by: ["orderItemId"],
        where: { orderItem: { orderId: fresh.id } },
        _sum: { quantity: true, bonusQuantity: true, creditCents: true },
      });
      const returnedByItem = new Map(previous.map((row) => [row.orderItemId, { quantity: row._sum.quantity ?? 0, bonusQuantity: row._sum.bonusQuantity ?? 0 }]));
      const previousCreditCents = previous.reduce((sum, row) => sum + (row._sum.creditCents ?? 0), 0);

      // Canonical economics — must reconcile with the persisted order
      // BEFORE any credit is derived from it (defense against legacy or
      // inconsistent rows: never guess, refuse).
      const netByItem = computeNetLineCents(fresh.items, fresh.discountCents);
      const netSum = [...netByItem.values()].reduce((sum, value) => sum + value, 0);
      if (netSum !== fresh.totalCents) {
        throw new SalesReturnDomainError("PRICING_INCONSISTENT", "بيانات تسعير الفاتورة غير متسقة ولا يمكن حساب المردود تلقائياً");
      }

      const lineResults: { orderItemId: string; productId: string; quantity: number; bonusQuantity: number; creditCents: number }[] = [];
      for (const [orderItemId, { quantity, bonusQuantity }] of requested) {
        const item = itemsById.get(orderItemId)!;
        const already = returnedByItem.get(orderItemId) ?? { quantity: 0, bonusQuantity: 0 };
        const originalPaidQty = item.quantity - item.bonusQuantity;
        // Three INDEPENDENT cumulative bounds — physical, bonus, and paid —
        // never just one implying the others (a line can have its physical
        // bound satisfied while its bonus/paid split is still invalid).
        if (already.quantity + quantity > item.quantity) {
          throw new SalesReturnDomainError("EXCEEDS_RETURNABLE", `الكمية المرتجعة أكبر من الكمية المتبقية القابلة للإرجاع (${item.quantity - already.quantity})`);
        }
        if (already.bonusQuantity + bonusQuantity > item.bonusQuantity) {
          throw new SalesReturnDomainError("EXCEEDS_RETURNABLE", `كمية البونص المرتجعة أكبر من كمية البونص المتبقية القابلة للإرجاع (${item.bonusQuantity - already.bonusQuantity})`);
        }
        const alreadyPaid = already.quantity - already.bonusQuantity;
        const requestedPaid = quantity - bonusQuantity;
        if (alreadyPaid + requestedPaid > originalPaidQty) {
          throw new SalesReturnDomainError("EXCEEDS_RETURNABLE", `الكمية المدفوعة المرتجعة أكبر من الكمية المدفوعة المتبقية (${originalPaidQty - alreadyPaid})`);
        }
        const creditCents = incrementalPaidCreditCents(netByItem.get(orderItemId)!, originalPaidQty, alreadyPaid, requestedPaid);
        lineResults.push({ orderItemId, productId: item.productId, quantity, bonusQuantity, creditCents });
      }
      const totalCreditCents = lineResults.reduce((sum, line) => sum + line.creditCents, 0);
      if (previousCreditCents + totalCreditCents > fresh.totalCents) {
        throw new SalesReturnDomainError("INVARIANT_VIOLATION", "إجمالي المردود سيتجاوز إجمالي الفاتورة");
      }

      const balanceSelect = {
        openingBalanceCents: true,
        orders: { select: { status: true, totalCents: true } },
        payments: { select: { amountCents: true, cancellation: { select: { id: true } } } },
        salesReturns: { select: { totalCreditCents: true } },
      } as const;
      const balanceBefore = getAccountBalanceCents(await tx.customerAccount.findUniqueOrThrow({ where: { id: accountId }, select: balanceSelect }));

      const lastSequence = await tx.salesReturn.aggregate({ where: { orderId: fresh.id }, _max: { sequence: true } });
      const sequence = (lastSequence._max.sequence ?? 0) + 1;

      const salesReturn = await tx.salesReturn.create({
        data: {
          orderId: fresh.id,
          sequence,
          accountId,
          salesRepId: input.salesRepId,
          createdById: input.actorUserId,
          stockLocationId: input.carStockLocationId,
          totalCreditCents,
          note: input.note?.trim() || null,
          items: { create: lineResults.map((line) => ({ orderItemId: line.orderItemId, quantity: line.quantity, bonusQuantity: line.bonusQuantity, creditCents: line.creditCents })) },
        },
        select: { id: true },
      });

      // Physical goods back into THIS rep's REP_CAR aggregate bucket (a rep
      // car is always the plain product-level bucket — see the InventoryItem
      // doc comment in schema.prisma), one canonical helper + one ledger
      // movement per line.
      const reference = `${fresh.orderNumber}-R${sequence}`;
      for (const line of lineResults) {
        const change = await incrementInventoryUpsert(
          tx,
          { productId: line.productId, variantId: null, deviceColorVariantId: null, locationId: input.carStockLocationId },
          line.quantity,
        );
        if (change.newQuantity - change.previousQuantity !== line.quantity) {
          throw new SalesReturnDomainError("INVARIANT_VIOLATION", "خطأ في تحديث مخزون السيارة");
        }
        await recordStockMovement(tx, {
          type: STOCK_MOVEMENT_TYPES.RETURN_IN,
          productId: line.productId,
          variantId: null,
          deviceColorVariantId: null,
          fromLocationId: null,
          toLocationId: input.carStockLocationId,
          quantity: line.quantity,
          previousQuantity: change.previousQuantity,
          newQuantity: change.newQuantity,
          note: `مردود مبيعات ${reference}`,
          createdById: input.actorUserId,
        });
      }

      // Invariants — verified inside the transaction, so a violation rolls
      // everything back.
      const balanceAfter = getAccountBalanceCents(await tx.customerAccount.findUniqueOrThrow({ where: { id: accountId }, select: balanceSelect }));
      if (balanceBefore - balanceAfter !== totalCreditCents) {
        throw new SalesReturnDomainError("INVARIANT_VIOLATION", "خطأ في احتساب رصيد التاجر");
      }
      const after = await tx.salesReturnItem.groupBy({
        by: ["orderItemId"],
        where: { orderItem: { orderId: fresh.id } },
        _sum: { quantity: true, bonusQuantity: true, creditCents: true },
      });
      for (const row of after) {
        const item = itemsById.get(row.orderItemId);
        const physical = row._sum.quantity ?? 0;
        const bonus = row._sum.bonusQuantity ?? 0;
        if (!item || physical > item.quantity) throw new SalesReturnDomainError("INVARIANT_VIOLATION", "الكمية المرتجعة تجاوزت الكمية الأصلية");
        if (bonus > item.bonusQuantity) throw new SalesReturnDomainError("INVARIANT_VIOLATION", "كمية البونص المرتجعة تجاوزت كمية البونص الأصلية");
        if (physical - bonus > item.quantity - item.bonusQuantity) throw new SalesReturnDomainError("INVARIANT_VIOLATION", "الكمية المدفوعة المرتجعة تجاوزت الكمية المدفوعة الأصلية");
      }
      if (after.reduce((sum, row) => sum + (row._sum.creditCents ?? 0), 0) > fresh.totalCents) {
        throw new SalesReturnDomainError("INVARIANT_VIOLATION", "إجمالي المردود تجاوز إجمالي الفاتورة");
      }

      const result = { id: salesReturn.id, orderId: fresh.id, orderNumber: fresh.orderNumber, sequence, totalCreditCents };
      if (input.onCreated) await input.onCreated(tx, result);
      return result;
    });

    return { ok: true, salesReturnId: created.id, orderNumber: created.orderNumber, sequence: created.sequence, totalCreditCents: created.totalCreditCents };
  } catch (error) {
    if (error instanceof SalesReturnDomainError) return { ok: false, code: error.code, error: error.message };
    throw error;
  }
}

export interface OrderReturnLineSummary {
  orderItemId: string;
  quantity: number;
  bonusQuantity: number;
  returnedQuantity: number;
  remainingQuantity: number;
  /** Cumulative SalesReturnItem.bonusQuantity for this line so far. Always
   * <= bonusQuantity above. */
  returnedBonusQuantity: number;
  /** bonusQuantity - returnedBonusQuantity — how many more bonus units may
   * still be declared on a future return of this line. */
  remainingBonusQuantity: number;
  returnedCreditCents: number;
}

export interface OrderReturnSummary {
  status: SalesReturnStatus;
  totalUnits: number;
  returnedUnits: number;
  remainingUnits: number;
  totalCreditCents: number;
  lines: Map<string, OrderReturnLineSummary>;
}

/** Read-only derived summary — the invoice's return status/remaining
 * quantities always come from the SalesReturn ledger, never a persisted
 * flag. */
export async function getOrderReturnSummary(orderId: string): Promise<OrderReturnSummary> {
  const [items, returned] = await Promise.all([
    prisma.orderItem.findMany({ where: { orderId }, select: { id: true, quantity: true, bonusQuantity: true } }),
    prisma.salesReturnItem.groupBy({ by: ["orderItemId"], where: { orderItem: { orderId } }, _sum: { quantity: true, bonusQuantity: true, creditCents: true } }),
  ]);
  const returnedByItem = new Map(
    returned.map((row) => [row.orderItemId, { quantity: row._sum.quantity ?? 0, bonusQuantity: row._sum.bonusQuantity ?? 0, credit: row._sum.creditCents ?? 0 }]),
  );
  const lines = new Map<string, OrderReturnLineSummary>();
  let totalUnits = 0;
  let returnedUnits = 0;
  let totalCreditCents = 0;
  for (const item of items) {
    const done = returnedByItem.get(item.id) ?? { quantity: 0, bonusQuantity: 0, credit: 0 };
    lines.set(item.id, {
      orderItemId: item.id,
      quantity: item.quantity,
      bonusQuantity: item.bonusQuantity,
      returnedQuantity: done.quantity,
      remainingQuantity: item.quantity - done.quantity,
      returnedBonusQuantity: done.bonusQuantity,
      remainingBonusQuantity: item.bonusQuantity - done.bonusQuantity,
      returnedCreditCents: done.credit,
    });
    totalUnits += item.quantity;
    returnedUnits += done.quantity;
    totalCreditCents += done.credit;
  }
  return { status: deriveReturnStatus(totalUnits, returnedUnits), totalUnits, returnedUnits, remainingUnits: totalUnits - returnedUnits, totalCreditCents, lines };
}

/** Display label for one original OrderItem — product name plus whatever
 * color/model snapshot the sale persisted. Snapshot fields only: never a
 * live lookup that could drift from what was actually sold. */
export function describeOrderItem(item: {
  productNameSnapshot: string | null;
  product: { name: string; nameAr: string | null };
  colorNameSnapshot: string | null;
  phoneBrandSnapshot: string | null;
  phoneModelSnapshot: string | null;
}): string {
  const parts = [item.productNameSnapshot ?? item.product.nameAr ?? item.product.name];
  if (item.colorNameSnapshot) parts.push(item.colorNameSnapshot);
  if (item.phoneModelSnapshot) parts.push([item.phoneBrandSnapshot, item.phoneModelSnapshot].filter(Boolean).join(" / "));
  return parts.join(" — ");
}

export interface SalesReturnHistoryEntry {
  id: string;
  sequence: number;
  reference: string;
  totalCreditCents: number;
  note: string | null;
  repName: string;
  /** True absolute instant — feed to formatBusinessDateTime only. */
  businessCreatedAt: Date;
  items: { orderItemId: string; label: string; quantity: number; bonusQuantity: number; creditCents: number }[];
}

/** Every return recorded against one invoice, oldest first — the
 * "مردودات الفاتورة" section and the printable return receipt both read
 * from this. Read-only. */
export async function getOrderReturnHistory(orderId: string, orderNumber: string): Promise<SalesReturnHistoryEntry[]> {
  const [returns, businessDates] = await Promise.all([
    prisma.salesReturn.findMany({
      where: { orderId },
      orderBy: { sequence: "asc" },
      select: {
        id: true,
        sequence: true,
        totalCreditCents: true,
        note: true,
        createdAt: true,
        salesRep: { select: { user: { select: { name: true } } } },
        items: {
          orderBy: { id: "asc" },
          select: {
            orderItemId: true,
            quantity: true,
            bonusQuantity: true,
            creditCents: true,
            orderItem: {
              select: {
                productNameSnapshot: true,
                colorNameSnapshot: true,
                phoneBrandSnapshot: true,
                phoneModelSnapshot: true,
                product: { select: { name: true, nameAr: true } },
              },
            },
          },
        },
      },
    }),
    getSalesReturnsBusinessCreatedAtByOrder(orderId),
  ]);
  return returns.map((row) => ({
    id: row.id,
    sequence: row.sequence,
    reference: `${orderNumber}-R${row.sequence}`,
    totalCreditCents: row.totalCreditCents,
    note: row.note,
    repName: row.salesRep.user.name,
    businessCreatedAt: businessDates.get(row.id) ?? row.createdAt,
    items: row.items.map((item) => ({ orderItemId: item.orderItemId, label: describeOrderItem(item.orderItem), quantity: item.quantity, bonusQuantity: item.bonusQuantity, creditCents: item.creditCents })),
  }));
}
