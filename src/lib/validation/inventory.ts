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

export const stockAdjustmentSchema = z.object({
  productId: z.string().min(1, "المنتج مطلوب"),
  movementType: manualMovementTypeSchema,
  quantity: nonNegativeIntString,
  notes: z.string().max(500, "الملاحظات طويلة جداً").optional(),
});

export type StockAdjustmentInput = z.infer<typeof stockAdjustmentSchema>;
