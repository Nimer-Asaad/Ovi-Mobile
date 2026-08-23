import { z } from "zod";
import { MANUAL_STOCK_MOVEMENT_TYPES } from "@/lib/constants";

export const manualMovementTypeSchema = z.enum(
  Object.values(MANUAL_STOCK_MOVEMENT_TYPES) as [string, ...string[]],
);

const nonNegativeIntString = z
  .string()
  .min(1, "الكمية مطلوبة")
  .refine((v) => Number.isInteger(Number(v)) && Number(v) >= 0, {
    message: "الكمية يجب أن تكون رقماً صحيحاً صفر أو أكبر",
  })
  .transform((v) => Number(v));

/** A manual product-level stock adjustment has no customer/order context, so
 * it has no colorId — see repStockTransferBatchSchema for the same reasoning.
 * variantId/deviceColorVariantId are optional here (empty string from the
 * form becomes undefined) — actions.ts resolves which one, if either, this
 * product's tracking mode actually requires and rejects a mismatch. */
export const stockAdjustmentSchema = z.object({
  productId: z.string().min(1, "المنتج مطلوب"),
  variantId: z.string().optional().transform((v) => (v ? v : undefined)),
  deviceColorVariantId: z.string().optional().transform((v) => (v ? v : undefined)),
  movementType: manualMovementTypeSchema,
  quantity: nonNegativeIntString,
  notes: z.string().max(500, "الملاحظات طويلة جداً").optional(),
});

export type StockAdjustmentInput = z.infer<typeof stockAdjustmentSchema>;

const bulkStockMovementLineSchema = z.object({
  productId: z.string().min(1, "المنتج مطلوب"),
  variantId: z.string().nullable().optional(),
  deviceColorVariantId: z.string().nullable().optional(),
  quantity: z
    .number()
    .finite("الكمية يجب أن تكون رقماً صحيحاً")
    .int("الكمية يجب أن تكون رقماً صحيحاً")
    .positive("الكمية يجب أن تكون أكبر من صفر"),
});

/** A warehouse-only bulk IN or OUT (direction is a bound server-action
 * argument, never part of this payload — see createBulkStockMovement) — no
 * customer/order context, so a line has no colorId, same reasoning as
 * repStockTransferBatchSchema. notes is entered once for the whole
 * submission and carried onto every resulting StockMovement row, rather
 * than per line.
 *
 * Deliberately no uniqueness .refine() here (unlike
 * repStockTransferBatchSchema/repSaleSchema, which reject a repeated exact
 * target) — the client UI already merges duplicate exact targets before
 * submitting, but the server never trusts that: createBulkStockMovement
 * aggregates any duplicate exact target (productId + variantId +
 * deviceColorVariantId) into one effective line, summing quantities, before
 * validation/increment-or-decrement — see the comment there. Rejecting here
 * would just produce a confusing error for a case the server can trivially
 * and safely absorb instead. */
export const bulkStockMovementSchema = z.object({
  items: z
    .array(bulkStockMovementLineSchema)
    .min(1, "يجب إضافة صنف واحد على الأقل")
    .max(50, "عدد كبير جداً من الأصناف في عملية واحدة"),
  notes: z.string().max(500, "الملاحظات طويلة جداً").optional(),
});

export type BulkStockMovementInput = z.infer<typeof bulkStockMovementSchema>;
