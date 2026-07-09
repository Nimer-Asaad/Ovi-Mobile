import { z } from "zod";

const positiveIntString = z
  .string()
  .min(1, "الكمية مطلوبة")
  .refine((v) => Number.isInteger(Number(v)) && Number(v) > 0, {
    message: "الكمية يجب أن تكون رقماً صحيحاً أكبر من صفر",
  })
  .transform((v) => Number(v));

export const repStockTransferSchema = z.object({
  productId: z.string().min(1, "المنتج مطلوب"),
  quantity: positiveIntString,
  notes: z.string().max(500, "الملاحظات طويلة جداً").optional(),
});

export type RepStockTransferInput = z.infer<typeof repStockTransferSchema>;
