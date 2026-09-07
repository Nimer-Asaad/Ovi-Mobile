import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { MANUAL_STOCK_MOVEMENT_TYPES } from "@/lib/constants";
import {
  decrementInventoryAtomic,
  incrementInventoryUpsert,
  recordStockMovement,
  InsufficientInventoryError,
} from "@/lib/inventory-transactions";

export type ManualInventoryCorrectionErrorCode =
  | "BATCH_NOT_FOUND"
  | "MISSING_REASON"
  | "ALREADY_REVERSED"
  | "IS_REVERSAL_BATCH"
  | "NOT_REVERSIBLE"
  | "INSUFFICIENT_STOCK";

export type ManualInventoryCorrectionResult =
  | { ok: true; reversalBatchId: string }
  | { ok: false; code: ManualInventoryCorrectionErrorCode; message: string };

class ManualInventoryCorrectionError extends Error {
  constructor(public readonly code: ManualInventoryCorrectionErrorCode, message: string) {
    super(message);
  }
}

function isReversalUniqueError(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") return false;
  const target = error.meta?.target;
  return Array.isArray(target) ? target.includes("reversalOfId") : String(target ?? "").includes("reversalOfId");
}

interface CancelManualInventoryBatchInput {
  batchId: string;
  reason: string;
  actorUserId: string;
}

/** Safely cancels/reverses one manual STOCK_IN or STOCK_OUT batch —
 * "إلغاء العملية" in the UI, but never an in-place edit. The original
 * ManualInventoryBatch and its StockMovement rows are NEVER edited or
 * deleted (StockMovement stays a strictly append-only ledger); this
 * creates a brand-new REVERSAL batch containing brand-new StockMovement
 * rows with the exact opposite effect, at the EXACT original persisted
 * dimensions (productId/variantId/deviceColorVariantId/location) of each
 * original line — never a guessed or different location, never moving
 * stock between WAREHOUSE and REP_CAR (this feature is manual warehouse
 * inventory only).
 *
 * Original STOCK_IN (incremented `toLocationId`) reverses via a STOCK_OUT-
 * shaped effect (decrement that same location) — BLOCKED with
 * INSUFFICIENT_STOCK, rolling back everything, if any line's current
 * quantity is less than what it originally added (some of it was used or
 * moved since). Original STOCK_OUT (decremented `fromLocationId`) reverses
 * via a STOCK_IN-shaped effect (increment that same location) — this
 * direction can never fail on insufficient stock.
 *
 * Multi-line atomicity: every line in the batch is reversed inside ONE
 * transaction — all succeed or none do, never a partial reversal.
 *
 * Double-cancel protection: ManualInventoryBatch.reversalOfId is @unique —
 * the DB-level "a batch may be reversed at most once" guarantee for two
 * concurrent clicks, backed up by a pre-check (`reversedBy`) for the common
 * (non-race) case. A batch predating this table (StockMovement.manualBatchId
 * = null, no ManualInventoryBatch row to look up) simply cannot reach this
 * function — the report UI never renders a cancel button for one — never
 * auto-grouped or guessed after the fact. */
export async function cancelManualInventoryBatch(input: CancelManualInventoryBatchInput): Promise<ManualInventoryCorrectionResult> {
  const reason = input.reason.trim();
  if (!reason) {
    return { ok: false, code: "MISSING_REASON", message: "سبب الإلغاء مطلوب" };
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const batch = await tx.manualInventoryBatch.findUnique({
        where: { id: input.batchId },
        select: {
          id: true,
          movementType: true,
          reversalOfId: true,
          reversedBy: { select: { id: true } },
          movements: {
            select: {
              productId: true,
              variantId: true,
              deviceColorVariantId: true,
              quantity: true,
              fromLocationId: true,
              toLocationId: true,
            },
          },
        },
      });
      if (!batch) {
        throw new ManualInventoryCorrectionError("BATCH_NOT_FOUND", "العملية غير موجودة");
      }
      // A reversal batch is itself never a valid cancellation target — only
      // an ORIGINAL batch (reversalOfId === null) may be reversed. This is
      // the real server-side enforcement; the UI never even renders a
      // cancel control for a reversal line, but this check is what actually
      // stops a crafted/replayed request.
      if (batch.reversalOfId) {
        throw new ManualInventoryCorrectionError("IS_REVERSAL_BATCH", "لا يمكن إلغاء عملية عكس.");
      }
      if (batch.reversedBy) {
        throw new ManualInventoryCorrectionError("ALREADY_REVERSED", "تم إلغاء هذه العملية مسبقًا");
      }

      const isStockIn = batch.movementType === MANUAL_STOCK_MOVEMENT_TYPES.STOCK_IN;
      const isStockOut = batch.movementType === MANUAL_STOCK_MOVEMENT_TYPES.STOCK_OUT;
      if ((!isStockIn && !isStockOut) || batch.movements.length === 0) {
        throw new ManualInventoryCorrectionError("NOT_REVERSIBLE", "لا يمكن إلغاء هذا النوع من العمليات تلقائياً");
      }
      for (const movement of batch.movements) {
        const targetLocationId = isStockIn ? movement.toLocationId : movement.fromLocationId;
        if (!targetLocationId) {
          throw new ManualInventoryCorrectionError("NOT_REVERSIBLE", "لا يمكن إلغاء هذه العملية تلقائياً لعدم وجود موقع مخزون موثّق");
        }
      }

      // The reversal batch row is created first — its id is what every
      // reversal StockMovement line below points its own manualBatchId at.
      const reversalBatch = await tx.manualInventoryBatch.create({
        data: {
          movementType: isStockIn ? MANUAL_STOCK_MOVEMENT_TYPES.STOCK_OUT : MANUAL_STOCK_MOVEMENT_TYPES.STOCK_IN,
          createdById: input.actorUserId,
          reversalOfId: batch.id,
          correctionReason: reason,
        },
      });

      for (const movement of batch.movements) {
        const locationId = (isStockIn ? movement.toLocationId : movement.fromLocationId)!;
        const key = { productId: movement.productId, variantId: movement.variantId, deviceColorVariantId: movement.deviceColorVariantId, locationId };

        let change;
        if (isStockIn) {
          try {
            change = await decrementInventoryAtomic(tx, key, movement.quantity);
          } catch (err) {
            if (err instanceof InsufficientInventoryError) {
              throw new ManualInventoryCorrectionError(
                "INSUFFICIENT_STOCK",
                "لا يمكن إلغاء عملية الإدخال لأن جزءاً من الكمية تم استخدامه أو إخراجه لاحقاً.",
              );
            }
            throw err;
          }
        } else {
          change = await incrementInventoryUpsert(tx, key, movement.quantity);
        }

        await recordStockMovement(tx, {
          type: isStockIn ? MANUAL_STOCK_MOVEMENT_TYPES.STOCK_OUT : MANUAL_STOCK_MOVEMENT_TYPES.STOCK_IN,
          productId: movement.productId,
          variantId: movement.variantId,
          deviceColorVariantId: movement.deviceColorVariantId,
          fromLocationId: isStockIn ? locationId : null,
          toLocationId: isStockIn ? null : locationId,
          quantity: movement.quantity,
          previousQuantity: change.previousQuantity,
          newQuantity: change.newQuantity,
          note: "إلغاء/عكس عملية مخزون يدوية",
          createdById: input.actorUserId,
          manualBatchId: reversalBatch.id,
        });
      }

      return { ok: true, reversalBatchId: reversalBatch.id } as const;
    });
  } catch (error) {
    if (error instanceof ManualInventoryCorrectionError) {
      return { ok: false, code: error.code, message: error.message };
    }
    if (isReversalUniqueError(error)) {
      return { ok: false, code: "ALREADY_REVERSED", message: "تم إلغاء هذه العملية مسبقًا" };
    }
    throw error;
  }
}
