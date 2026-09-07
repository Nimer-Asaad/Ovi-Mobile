import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ORDER_STATUSES } from "@/lib/constants";
import type { OrderStatus } from "@/types";
import {
  transitionOrderStatusInTransaction,
  isRetryableTransactionError,
  isCompensationUniqueError,
  isPaymentCancellationUniqueError,
  LifecycleDomainError,
  getValidNextOrderStatuses,
  type OrderLifecycleErrorCode,
} from "@/lib/order-lifecycle";

export type SaleCorrectionErrorCode = OrderLifecycleErrorCode | "MISSING_REASON";

export type SaleCorrectionResult =
  | { ok: true; orderNumber: string }
  | { ok: false; code: SaleCorrectionErrorCode; message: string };

/** The one error correctSale itself ever raises directly — everything else
 * (ORDER_NOT_FOUND, MISSING_REASON's underlying cause never reaches here
 * since it's checked before the loop, LEGACY_UNLINKED_PAYMENT,
 * MISSING_STOCK_PROVENANCE, MISSING_INVENTORY, COMPENSATION_CONFLICT,
 * CONCURRENT_UPDATE) is thrown by transitionOrderStatusInTransaction
 * itself and caught below via `error instanceof LifecycleDomainError`. */
class SaleCorrectionError extends Error {
  constructor(public readonly code: SaleCorrectionErrorCode, message: string) {
    super(message);
  }
}

/** The one status a sale correction should request: whichever of
 * CANCELLED/RETURNED is currently a valid next status for this order
 * (getValidNextOrderStatuses never allows both at once under the existing
 * lifecycle rules — see order-lifecycle-rules.ts). A REP sale is created
 * already DELIVERED, so this always resolves to RETURNED for one; any other
 * order source resolves to CANCELLED while still pending/preparing/etc., or
 * RETURNED once DELIVERED. Returns null when neither is a valid next status
 * (e.g. the order is already terminal, including an already-corrected
 * sale) — correctSale then reports INVALID_TRANSITION, the exact same
 * message the general order-status screen already uses for the same
 * situation. */
function resolveCorrectionTargetStatus(status: string, source: string): OrderStatus | null {
  const validNext = getValidNextOrderStatuses(status, source);
  if (validNext.includes(ORDER_STATUSES.CANCELLED)) return ORDER_STATUSES.CANCELLED;
  if (validNext.includes(ORDER_STATUSES.RETURNED)) return ORDER_STATUSES.RETURNED;
  return null;
}

interface CorrectSaleInput {
  orderNumber: string;
  reason: string;
  actorUserId: string;
  /** Optional hook invoked INSIDE the same transaction, immediately after a
   * successful (non-no-op) transition — used only by the impersonation-
   * aware REP wrapper (correctRepSaleAction) to write an AdminAuditLog row
   * (IMPERSONATED_REP_SALE_CORRECTED) atomically with the correction
   * itself, when an ADMIN is acting as this rep. Never invoked on a no-op
   * transition (nothing changed, nothing to audit) or when the transition
   * fails. The pre-existing ADMIN order-status screen (transitionOrderStatus)
   * never passes this and behaves exactly as before. */
  onCorrected?: (tx: Prisma.TransactionClient, order: { id: string; orderNumber: string }) => Promise<void>;
}

/** Safely cancels/reverses a wrong sale — "تصحيح المبيعة" in the UI, but
 * never an in-place edit. A thin wrapper: resolves which terminal status to
 * request, then delegates EVERYTHING else — inventory restoration to the
 * order's own original stockLocationId, OrderInventoryCompensation +
 * StockMovement, the conditional Order.status flip, OrderStatusHistory,
 * AND the sale's linked SALE_INITIAL AccountPayment cancellation (when
 * eligible) — to transitionOrderStatusInTransaction, the ONE canonical
 * lifecycle core. This is deliberate: transitionOrderStatus (the
 * pre-existing standalone wrapper behind the original ADMIN order-status
 * screen) and correctSale here are BOTH thin callers around that same
 * core, so the linked-payment safety (and the legacy-unlinked-payment
 * block) can never be bypassed by using the old screen instead of this new
 * button — see transitionOrderStatusInTransaction's own doc comment in
 * src/lib/order-lifecycle.ts for the full rationale and the audit
 * confirming no other path ever writes Order.status.
 *
 * One Serializable transaction with its own retry-on-serialization-
 * conflict loop, mirroring transitionOrderStatus's own — never a nested
 * transaction, never a second, competing reimplementation of the
 * transition or cancellation logic. */
export async function correctSale(input: CorrectSaleInput): Promise<SaleCorrectionResult> {
  const reason = input.reason.trim();
  if (!reason) {
    return { ok: false, code: "MISSING_REASON", message: "سبب التصحيح مطلوب" };
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          // Read status/source fresh inside this transaction (not trusting
          // any pre-transaction read) purely to pick the correct
          // requestedStatus — transitionOrderStatusInTransaction re-reads
          // the order again itself right after, which is the real
          // concurrency-safe source of truth for the transition (and the
          // linked-payment eligibility) itself.
          const preCheck = await tx.order.findUnique({
            where: { orderNumber: input.orderNumber },
            select: { status: true, source: true },
          });
          if (!preCheck) {
            throw new SaleCorrectionError("ORDER_NOT_FOUND", "الطلب غير موجود");
          }

          const targetStatus = resolveCorrectionTargetStatus(preCheck.status, preCheck.source);
          if (!targetStatus) {
            throw new SaleCorrectionError("INVALID_TRANSITION", "لا يمكن تصحيح هذه المبيعة في حالتها الحالية");
          }

          const result = await transitionOrderStatusInTransaction(tx, {
            orderNumber: input.orderNumber,
            requestedStatus: targetStatus,
            reason,
            actorUserId: input.actorUserId,
          });

          if (!result.noOp && input.onCorrected) {
            await input.onCorrected(tx, { id: result.order.id, orderNumber: result.orderNumber });
          }

          return { ok: true, orderNumber: result.orderNumber } as const;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (error instanceof SaleCorrectionError) {
        return { ok: false, code: error.code, message: error.message };
      }
      if (error instanceof LifecycleDomainError) {
        return { ok: false, code: error.code, message: error.message };
      }
      if (isCompensationUniqueError(error) || isPaymentCancellationUniqueError(error)) {
        return { ok: false, code: "COMPENSATION_CONFLICT", message: "تم تصحيح هذه المبيعة مسبقًا" };
      }
      if (isRetryableTransactionError(error) && attempt < 2) continue;
      throw error;
    }
  }

  return { ok: false, code: "CONCURRENT_UPDATE", message: "تغيرت حالة الطلب بالتزامن، حاول مجددًا" };
}
