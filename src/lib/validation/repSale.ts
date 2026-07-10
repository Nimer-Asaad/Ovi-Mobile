import { z } from "zod";

const positiveIntString = z
  .string()
  .min(1, "الكمية مطلوبة")
  .refine((v) => Number.isInteger(Number(v)) && Number(v) > 0, {
    message: "الكمية يجب أن تكون رقماً صحيحاً أكبر من صفر",
  })
  .transform((v) => Number(v));

/** Admin types a plain NIS amount (e.g. "89.90"); this converts to integer
 * agorot cents for storage, matching the Int-cents money convention. */
const positiveMoneyString = z
  .string()
  .min(1, "سعر البيع مطلوب")
  .refine((v) => Number.isFinite(Number(v)) && Number(v) > 0, {
    message: "سعر البيع يجب أن يكون رقماً أكبر من صفر",
  })
  .transform((v) => Math.round(Number(v) * 100));

export const repSaleSchema = z.object({
  productId: z.string().min(1, "المنتج مطلوب"),
  quantity: positiveIntString,
  unitPriceCents: positiveMoneyString,
  customerName: z.string().min(2, "اسم العميل مطلوب"),
  customerPhone: z.string().min(7, "رقم هاتف العميل مطلوب"),
  city: z.string().optional(),
  address: z.string().optional(),
  notes: z.string().max(500, "الملاحظات طويلة جداً").optional(),
});

export type RepSaleInput = z.infer<typeof repSaleSchema>;
