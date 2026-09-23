import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { STOCK_MOVEMENT_TYPES } from "@/lib/constants";
import { lockAccountForBalanceUpdate, getAccountBalanceCents } from "@/lib/accounts";
import { decrementInventoryAtomic, recordStockMovement, InsufficientInventoryError } from "@/lib/inventory-transactions";

/** ADMIN-only reversal ("إلغاء مردود المبيعات") of ONE previously-created
 * SalesReturn — the accounting/inventory mirror image of createSalesReturn
 * (src/lib/sales-returns.ts), following the exact same correction pattern
 * cancelManualPayment (src/lib/payment-correction.ts) already established
 * for AccountPayment: never hard-deletes or edits the original row, only
 * ever inserts ONE new SalesReturnReversal row whose @unique salesReturnId
 * is both the eligibility check's data source and the DB-level "at most
 * once" concurrency backstop (a losing concurrent reversal's insert fails
 * with P2002, caught below and reported as ALREADY_REVERSED — never
 * relying on button-disabling alone).
 *
 * Inside ONE transaction:
 *   1. load the SalesReturn (+ its items, + whether already reversed);
 *   2. take the SAME account advisory lock every other debt mutator takes
 *      (lockAccountForBalanceUpdate) — re-checked AFTER the lock so two
 *      concurrent reversal attempts always serialize;
 *   3. reject if already reversed;
 *   4. for each item, decrement the SAME REP_CAR location
 *      (SalesReturn.stockLocationId) by the SAME physical quantity the
 *      original return added, via the canonical decrementInventoryAtomic
 *      helper — throws InsufficientInventoryError (never drives stock
 *      negative, never pulls from WAREHOUSE) if those units have since
 *      been sold/transferred onward, converted below into a clear
 *      INSUFFICIENT_STOCK rejection;
 *   5. record one SALES_RETURN_REVERSAL_OUT StockMovement per item;
 *   6. insert the SalesReturnReversal row;
 *   7. verify the account balance increased by exactly the original
 *      return's totalCreditCents (never recomputed from current prices —
 *      always the persisted value).
 *
 * WHAT THIS NEVER TOUCHES: the original SalesReturn/SalesReturnItem rows
 * (immutable forever), the original Order/OrderItem, any AccountPayment,
 * Product.stock (never read or written), and no cash refund is created —
 * the only account effect is this new row, which the canonical balance
 * formula (getAccountBalanceCents) adds back. */

export type SalesReturnReversalErrorCode =
  | "NOT_FOUND"
  | "MISSING_REASON"
  | "ALREADY_REVERSED"
  | "INSUFFICIENT_STOCK";

export type SalesReturnReversalResult =
  | { ok: true; salesReturnId: string; orderNumber: string; reference: string }
  | { ok: false; code: SalesReturnReversalErrorCode; error: string };

function isReversalUniqueError(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") return false;
  const target = error.meta?.target;
  return Array.isArray(target) ? target.includes("salesReturnId") : String(target ?? "").includes("salesReturnId");
}

export interface ReverseSalesReturnInput {
  salesReturnId: string;
  actorUserId: string;
  reason: string;
}

export async function reverseSalesReturn(input: ReverseSalesReturnInput): Promise<SalesReturnReversalResult> {
  const reason = input.reason.trim();
  if (!reason) {
    return { ok: false, code: "MISSING_REASON", error: "سبب الإلغاء مطلوب" };
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const salesReturn = await tx.salesReturn.findUnique({
        where: { id: input.salesReturnId },
        select: {
          id: true,
          sequence: true,
          accountId: true,
          stockLocationId: true,
          totalCreditCents: true,
          reversal: { select: { id: true } },
          order: { select: { orderNumber: true } },
          items: { select: { orderItemId: true, quantity: true, orderItem: { select: { productId: true } } } },
        },
      });
      if (!salesReturn) throw new Error("NOT_FOUND");

      // Same lock every other balance mutator takes — re-checked AFTER
      // acquiring it, so a concurrent reversal of the SAME return can never
      // both see "not yet reversed" and both proceed.
      await lockAccountForBalanceUpdate(tx, salesReturn.accountId);

      const fresh = await tx.salesReturn.findUniqueOrThrow({
        where: { id: salesReturn.id },
        select: { reversal: { select: { id: true } } },
      });
      if (fresh.reversal) throw new Error("ALREADY_REVERSED");

      const balanceSelect = {
        openingBalanceCents: true,
        orders: { select: { status: true, totalCents: true } },
        payments: { select: { amountCents: true, cancellation: { select: { id: true } } } },
        salesReturns: { select: { totalCreditCents: true, reversal: { select: { id: true } } } },
      } as const;
      const balanceBefore = getAccountBalanceCents(await tx.customerAccount.findUniqueOrThrow({ where: { id: salesReturn.accountId }, select: balanceSelect }));

      const reference = `${salesReturn.order.orderNumber}-R${salesReturn.sequence}`;

      // Per line: atomic conditional decrement of the SAME REP_CAR the
      // return put stock into — never negative, never the warehouse. A
      // shortage here (units already sold/transferred onward) rolls back
      // the whole reversal via the thrown error below.
      for (const item of salesReturn.items) {
        let change;
        try {
          change = await decrementInventoryAtomic(
            tx,
            { productId: item.orderItem.productId, variantId: null, deviceColorVariantId: null, locationId: salesReturn.stockLocationId },
            item.quantity,
          );
        } catch (err) {
          if (err instanceof InsufficientInventoryError) throw new Error("INSUFFICIENT_STOCK");
          throw err;
        }
        await recordStockMovement(tx, {
          type: STOCK_MOVEMENT_TYPES.SALES_RETURN_REVERSAL_OUT,
          productId: item.orderItem.productId,
          variantId: null,
          deviceColorVariantId: null,
          fromLocationId: salesReturn.stockLocationId,
          toLocationId: null,
          quantity: item.quantity,
          previousQuantity: change.previousQuantity,
          newQuantity: change.newQuantity,
          note: `إلغاء مردود مبيعات ${reference}`,
          createdById: input.actorUserId,
        });
      }

      try {
        await tx.salesReturnReversal.create({
          data: { salesReturnId: salesReturn.id, createdById: input.actorUserId, reason },
        });
      } catch (err) {
        if (isReversalUniqueError(err)) throw new Error("ALREADY_REVERSED");
        throw err;
      }

      const balanceAfter = getAccountBalanceCents(await tx.customerAccount.findUniqueOrThrow({ where: { id: salesReturn.accountId }, select: balanceSelect }));
      if (balanceAfter - balanceBefore !== salesReturn.totalCreditCents) {
        throw new Error("INVARIANT_VIOLATION");
      }

      return { salesReturnId: salesReturn.id, orderNumber: salesReturn.order.orderNumber, reference };
    });

    // Deliberately NOT called from inside this function — see
    // revalidateSalesReturnReversalPaths's own doc comment (the same
    // "caller revalidates, after this function returns ok" convention
    // createSalesReturn/revalidateSalesReturnPaths already use, so this
    // stays runnable outside a Next.js request too — see verify scripts).
    return { ok: true, ...result };
  } catch (error) {
    if (error instanceof Error) {
      switch (error.message) {
        case "NOT_FOUND":
          return { ok: false, code: "NOT_FOUND", error: "مردود المبيعات غير موجود" };
        case "ALREADY_REVERSED":
          return { ok: false, code: "ALREADY_REVERSED", error: "تم إلغاء هذا المردود مسبقًا" };
        case "INSUFFICIENT_STOCK":
          return {
            ok: false,
            code: "INSUFFICIENT_STOCK",
            error: "لا يمكن إلغاء هذا المردود لأن الكمية لم تعد متوفرة بالكامل في سيارة المندوب (تم بيعها أو نقلها لاحقًا)",
          };
      }
    }
    throw error;
  }
}

/** Called by the server action AFTER reverseSalesReturn returns ok — kept
 * out of that function itself so the core stays runnable outside a Next.js
 * request (verification scripts) — the exact same split
 * revalidateSalesReturnPaths/createSalesReturn already use. */
export function revalidateSalesReturnReversalPaths(orderNumber: string): void {
  revalidatePath("/rep");
  revalidatePath("/rep/sales");
  revalidatePath(`/rep/sales/${orderNumber}`);
  revalidatePath("/rep/stock");
  revalidatePath("/rep/movements");
  revalidatePath("/rep/merchants");
  revalidatePath("/admin/orders");
  revalidatePath(`/admin/orders/${orderNumber}`);
  revalidatePath(`/admin/orders/${orderNumber}/invoice`);
  revalidatePath("/admin/merchants");
  revalidatePath("/admin/inventory/overview");
}
