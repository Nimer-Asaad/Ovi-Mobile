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
