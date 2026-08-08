import { z } from "zod";

const positiveIntString = z
  .string()
  .min(1, "الكمية مطلوبة")
  .refine((v) => Number.isInteger(Number(v)) && Number(v) > 0, {
    message: "الكمية يجب أن تكون رقماً صحيحاً أكبر من صفر",
  })
  .transform((v) => Number(v));

/** A pure warehouse<->rep-car stock movement — no customer/order context, so
 * it has no colorId at all: color is only ever recorded on an order line,
 * never on a stock transfer, and never affects which InventoryItem bucket
 * moves (see the InventoryItem doc comment in prisma/schema.prisma). */
export const repStockTransferSchema = z.object({
  productId: z.string().min(1, "المنتج مطلوب"),
  variantId: z.string().min(1).optional(),
  quantity: positiveIntString,
  notes: z.string().max(500, "الملاحظات طويلة جداً").optional(),
});

export type RepStockTransferInput = z.infer<typeof repStockTransferSchema>;
