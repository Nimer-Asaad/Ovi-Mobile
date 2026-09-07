import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ORDER_STATUSES, STOCK_MOVEMENT_TYPES } from "@/lib/constants";
import type { OrderStatus } from "@/types";
import {
  getValidNextOrderStatuses,
  transitionRestoresInventory,
} from "@/lib/order-lifecycle-rules";
import { incrementInventoryExisting, recordStockMovement, MissingInventoryError } from "@/lib/inventory-transactions";

export {
  getValidNextOrderStatuses,
  isTerminalOrderStatus,
  transitionRestoresInventory,
} from "@/lib/order-lifecycle-rules";

export const LEGACY_PROVENANCE_ERROR =
  "لا يمكن تنفيذ الإلغاء أو الإرجاع تلقائيًا لهذا الطلب القديم لأن موقع المخزون الأصلي غير مسجل. راجع المخزون يدويًا أولًا.";

export const LEGACY_UNLINKED_PAYMENT_ERROR =
  "لا يمكن تصحيح هذه المبيعة القديمة تلقائياً لأن الدفعة المرتبطة بها غير موثقة بعلاقة آمنة.";

export type OrderLifecycleErrorCode =
  | "ORDER_NOT_FOUND"
  | "INVALID_TRANSITION"
  | "MISSING_REASON"
  | "MISSING_STOCK_PROVENANCE"
  | "MISSING_INVENTORY"
  | "COMPENSATION_CONFLICT"
  | "LEGACY_UNLINKED_PAYMENT"
  | "CONCURRENT_UPDATE";

export type OrderLifecycleResult =
  | { ok: true; noOp: boolean; orderNumber: string }
  | { ok: false; code: OrderLifecycleErrorCode; message: string };

/** Thrown by transitionOrderStatusInTransaction for any domain-rule
 * violation. Exported (unlike before this refactor) so a caller running its
 * own transaction+retry loop — src/lib/sale-correction.ts's correctSale,
 * alongside this file's own transitionOrderStatus — can catch it and
 * convert it into its own typed result; anything else propagates as a real
 * error. */
export class LifecycleDomainError extends Error {
  constructor(public readonly code: OrderLifecycleErrorCode, message: string) {
    super(message);
  }
}

export function isRetryableTransactionError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
}

export function isCompensationUniqueError(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") return false;
  const target = error.meta?.target;
  return Array.isArray(target) ? target.includes("orderId") : String(target ?? "").includes("orderId");
}

/** Defense-in-depth alongside isCompensationUniqueError above — the
 * genuine DB backstop (AccountPaymentCancellation.paymentId @unique) for
 * the linked-payment cancellation transitionOrderStatusInTransaction now
 * creates. Serializable isolation + the conditional Order.status
 * updateMany already make two concurrent writers both reaching that
 * insert for the same order practically impossible, but if it ever
 * happens (or is ever hit some other way), this still converts the raw
 * P2002 into a safe, typed result instead of an unhandled 500. */
export function isPaymentCancellationUniqueError(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") return false;
  const target = error.meta?.target;
  return Array.isArray(target) ? target.includes("paymentId") : String(target ?? "").includes("paymentId");
}

async function resolveConcurrentCompensation(
  orderNumber: string,
  requestedStatus: OrderStatus,
): Promise<OrderLifecycleResult> {
  const current = await prisma.order.findUnique({
    where: { orderNumber },
    select: { status: true, inventoryCompensation: { select: { id: true } } },
  });
  if (current?.status === requestedStatus && current.inventoryCompensation) {
    return { ok: true, noOp: true, orderNumber };
  }
  return {
    ok: false,
    code: "COMPENSATION_CONFLICT",
    message: "تم تنفيذ معالجة مخزون لهذا الطلب مسبقًا بحالة مختلفة",
  };
}

const ORDER_SELECT = {
  id: true,
  orderNumber: true,
  status: true,
  source: true,
  stockLocationId: true,
  inventoryRestoredAt: true,
  paidAmountCents: true,
  items: { select: { productId: true, variantId: true, deviceColorVariantId: true, quantity: true } },
  inventoryCompensation: { select: { id: true, type: true } },
  initialPayment: { select: { id: true, cancellation: { select: { id: true } } } },
} satisfies Prisma.OrderSelect;

export type OrderWithLifecycleFields = Prisma.OrderGetPayload<{ select: typeof ORDER_SELECT }>;
export type LifecycleTx = Prisma.TransactionClient;

interface TransitionOrderStatusInput {
  orderNumber: string;
  requestedStatus: OrderStatus;
  reason?: string;
  actorUserId: string;
}

export interface TransitionCoreResult {
  noOp: boolean;
  orderNumber: string;
  /** The order row as it was immediately BEFORE this call (its `status` is
   * the FROM status) — callers that need to act on the order beyond the
   * pure status transition itself (see correctSale, which also needs
   * `paidAmountCents`/`initialPayment`) get it here instead of re-fetching
   * a second time inside the same transaction. */
  order: OrderWithLifecycleFields;
}

/** The transaction-body core of an order status transition — fetches the
 * order fresh, validates the transition via getValidNextOrderStatuses,
 * requires a reason for any inventory-restoring transition, restores
 * inventory to the order's own original stockLocationId + records
 * OrderInventoryCompensation + StockMovement when the target status is
 * terminal, flips Order.status via a conditional updateMany (the row-level
 * optimistic-concurrency check — count !== 1 means another transaction
 * already changed this row), and appends OrderStatusHistory.
 *
 * THIS is also the ONE canonical place a sale's linked SALE_INITIAL
 * AccountPayment gets cancelled when its order becomes terminal — see the
 * dedicated block below. This is deliberate: transitionOrderStatus (the
 * pre-existing standalone wrapper, reachable from the original ADMIN order
 * detail screen via updateOrderStatus/OrderStatusForm) and
 * src/lib/sale-correction.ts's correctSale (the new report "تصحيح
 * المبيعة" button) are BOTH thin callers around this exact same core —
 * there is no other path in this codebase that ever writes Order.status
 * (confirmed: grep for `.order.update`/`.order.updateMany` across src/
 * finds only this function's own updateMany below and one unrelated
 * paymentStatus-only update). Centralizing the linked-payment safety here,
 * rather than only inside correctSale, guarantees the OLD admin
 * order-status screen can never bypass it — an ADMIN cancelling/returning
 * a sale-linked-payment order through EITHER screen gets the exact same
 * safe handling, and a legacy order whose paid-now payment predates the
 * sourceOrderId relation is rejected through EITHER screen with the same
 * message, before any write.
 *
 * Does NOT open its own transaction and does NOT retry on its own — the
 * caller owns both. transitionOrderStatus below is the standalone
 * "transition only" case (its own Serializable transaction + retry loop);
 * correctSale is the "resolve which terminal status to request, then call
 * this same core" case, with its own Serializable transaction + retry loop
 * — never a second, competing reimplementation of the transition (or
 * linked-payment-cancellation) logic itself.
 *
 * Throws LifecycleDomainError for any domain-rule violation; never returns
 * an ok:false shape itself (that translation is each caller's own job). */
export async function transitionOrderStatusInTransaction(
  tx: LifecycleTx,
  input: TransitionOrderStatusInput,
): Promise<TransitionCoreResult> {
  const order = await tx.order.findUnique({
    where: { orderNumber: input.orderNumber },
    select: ORDER_SELECT,
  });
  if (!order) {
    throw new LifecycleDomainError("ORDER_NOT_FOUND", "الطلب غير موجود");
  }

  if (order.status === input.requestedStatus) {
    return { noOp: true, orderNumber: order.orderNumber, order };
  }

  const validNextStatuses = getValidNextOrderStatuses(order.status, order.source);
  if (!validNextStatuses.includes(input.requestedStatus)) {
    throw new LifecycleDomainError("INVALID_TRANSITION", "لا يمكن نقل الطلب إلى هذه الحالة من حالته الحالية");
  }

  const restoresInventory = transitionRestoresInventory(input.requestedStatus);
  if (restoresInventory && !input.reason) {
    throw new LifecycleDomainError("MISSING_REASON", "سبب الإلغاء أو الإرجاع مطلوب");
  }

  // The sale-linked-payment safety gate — BEFORE any write, and applies to
  // EVERY caller of this core (the old ADMIN status screen included, not
  // just the new correction feature). A legacy sale with a real paid-now
  // amount but no persisted sourceOrderId link cannot be corrected
  // automatically: there is no reliable way to identify (let alone
  // reverse) its paid-now payment, and note text is never parsed to guess
  // it. paidAmountCents === 0 skips this gate entirely — nothing to
  // reverse.
  if (restoresInventory && order.paidAmountCents > 0 && !order.initialPayment) {
    throw new LifecycleDomainError("LEGACY_UNLINKED_PAYMENT", LEGACY_UNLINKED_PAYMENT_ERROR);
  }

  if (restoresInventory) {
    if (!order.stockLocationId) {
      throw new LifecycleDomainError("MISSING_STOCK_PROVENANCE", LEGACY_PROVENANCE_ERROR);
    }
    if (order.inventoryRestoredAt || order.inventoryCompensation) {
      throw new LifecycleDomainError(
        "COMPENSATION_CONFLICT",
        "تمت إعادة مخزون هذا الطلب مسبقًا",
      );
    }

    const movementType =
      input.requestedStatus === ORDER_STATUSES.CANCELLED
        ? STOCK_MOVEMENT_TYPES.ORDER_RELEASED
        : STOCK_MOVEMENT_TYPES.RETURN_IN;

    await tx.orderInventoryCompensation.create({
      data: {
        orderId: order.id,
        stockLocationId: order.stockLocationId,
        type: movementType,
        createdById: input.actorUserId,
      },
    });

    for (const item of order.items) {
      let change;
      try {
        change = await incrementInventoryExisting(
          tx,
          { productId: item.productId, variantId: item.variantId, deviceColorVariantId: item.deviceColorVariantId, locationId: order.stockLocationId },
          item.quantity,
        );
      } catch (err) {
        if (err instanceof MissingInventoryError) {
          throw new LifecycleDomainError(
            "MISSING_INVENTORY",
            "تعذر العثور على سجل المخزون الأصلي لأحد منتجات الطلب",
          );
        }
        throw err;
      }

      await recordStockMovement(tx, {
        type: movementType,
        productId: item.productId,
        variantId: item.variantId,
        deviceColorVariantId: item.deviceColorVariantId,
        fromLocationId: null,
        toLocationId: order.stockLocationId,
        quantity: item.quantity,
        previousQuantity: change.previousQuantity,
        newQuantity: change.newQuantity,
        note: `معالجة مخزون الطلب ${order.orderNumber}`,
        createdById: input.actorUserId,
      });
    }
  }

  const updated = await tx.order.updateMany({
    where: { id: order.id, status: order.status },
    data: {
      status: input.requestedStatus,
      ...(restoresInventory ? { inventoryRestoredAt: new Date() } : {}),
    },
  });
  if (updated.count !== 1) {
    throw new LifecycleDomainError("CONCURRENT_UPDATE", "تغيرت حالة الطلب بالتزامن، حدّث الصفحة وحاول مجددًا");
  }

  await tx.orderStatusHistory.create({
    data: {
      orderId: order.id,
      fromStatus: order.status,
      toStatus: input.requestedStatus,
      reason: input.reason,
      changedById: input.actorUserId,
    },
  });

  // Cancel the sale's own linked SALE_INITIAL AccountPayment, in this SAME
  // transaction, whenever one genuinely exists and isn't already
  // cancelled — the ONE canonical place this ever happens (never
  // duplicated in correctSale or anywhere else). `!order.initialPayment`
  // was already rejected above (LEGACY_UNLINKED_PAYMENT) when
  // paidAmountCents > 0, so reaching here with paidAmountCents > 0 means
  // initialPayment is guaranteed non-null. The `!cancellation` check makes
  // this idempotent-safe against the (expected-impossible, since both
  // writes are atomic with the status flip above) case where it was
  // somehow already cancelled — never a duplicate insert, and
  // AccountPaymentCancellation.paymentId @unique remains the final DB
  // backstop for the genuine concurrent-request race either way.
  if (restoresInventory && order.paidAmountCents > 0 && order.initialPayment && !order.initialPayment.cancellation) {
    await tx.accountPaymentCancellation.create({
      data: {
        paymentId: order.initialPayment.id,
        reason: input.reason!,
        cancelledById: input.actorUserId,
      },
    });
  }

  return { noOp: false, orderNumber: order.orderNumber, order };
}

export async function transitionOrderStatus(
  input: TransitionOrderStatusInput,
): Promise<OrderLifecycleResult> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const result = await transitionOrderStatusInTransaction(tx, input);
          return { ok: true, noOp: result.noOp, orderNumber: result.orderNumber } as const;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (error instanceof LifecycleDomainError) {
        return { ok: false, code: error.code, message: error.message };
      }
      if (isCompensationUniqueError(error)) {
        return resolveConcurrentCompensation(input.orderNumber, input.requestedStatus);
      }
      if (isPaymentCancellationUniqueError(error)) {
        return { ok: false, code: "CONCURRENT_UPDATE", message: "تم تصحيح هذه المبيعة مسبقًا بالتزامن، حدّث الصفحة" };
      }
      if (isRetryableTransactionError(error) && attempt < 2) continue;
      throw error;
    }
  }

  return { ok: false, code: "CONCURRENT_UPDATE", message: "تغيرت حالة الطلب بالتزامن، حاول مجددًا" };
}
