import { z } from "zod";

const saleItemSchema = z.object({
  productId: z.string().min(1, "المنتج مطلوب"),
  /** Null for a colorless product/line. */
  colorId: z.string().nullable().optional(),
  variantId: z.string().nullable().optional(),
  quantity: z.number().int("الكمية يجب أن تكون رقماً صحيحاً").positive("الكمية يجب أن تكون أكبر من صفر"),
  /** Already converted to integer agorot cents client-side, same convention
   * as every other money field. */
  unitPriceCents: z.number().int().positive("سعر البيع يجب أن يكون أكبر من صفر"),
});

export const repSaleSchema = z.object({
  items: z
    .array(saleItemSchema)
    .min(1, "يجب إضافة منتج واحد على الأقل")
    .max(50, "عدد كبير جداً من المنتجات في عملية بيع واحدة")
    .refine(
      (items) => new Set(items.map((item) => `${item.productId}:${item.variantId ?? `legacy:${item.colorId ?? ""}`}`)).size === items.length,
      { message: "لا يمكن تكرار نفس المنتج/اللون أكثر من مرة — عدّل الكمية بدلاً من ذلك" },
    ),
  customerName: z.string().min(2, "اسم العميل مطلوب"),
  customerPhone: z.string().min(7, "رقم هاتف العميل مطلوب"),
  city: z.string().optional(),
  address: z.string().optional(),
  notes: z.string().max(500, "الملاحظات طويلة جداً").optional(),
});

export type RepSaleInput = z.infer<typeof repSaleSchema>;
