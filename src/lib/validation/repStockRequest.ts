import { z } from "zod";

const requestItemSchema = z.object({
  productId: z.string().min(1, "المنتج مطلوب"),
  /** Null for a colorless product/line. */
  colorId: z.string().nullable().optional(),
  variantId: z.string().nullable().optional(),
  requestedQuantity: z
    .number()
    .int("الكمية يجب أن تكون رقماً صحيحاً")
    .positive("الكمية يجب أن تكون أكبر من صفر"),
});

export const repStockRequestCreateSchema = z.object({
  repNote: z.string().max(500, "الملاحظة طويلة جداً").optional(),
  items: z
    .array(requestItemSchema)
    .min(1, "يجب إضافة منتج واحد على الأقل")
    .max(50, "عدد كبير جداً من المنتجات في طلب واحد")
    .refine(
      (items) => new Set(items.map((item) => `${item.productId}:${item.variantId ?? `legacy:${item.colorId ?? ""}`}`)).size === items.length,
      { message: "لا يمكن تكرار نفس المنتج/اللون أكثر من مرة — عدّل الكمية بدلاً من ذلك" },
    ),
});

export type RepStockRequestCreateInput = z.infer<typeof repStockRequestCreateSchema>;

const reviewItemSchema = z.object({
  itemId: z.string().min(1),
  approvedQuantity: z
    .number()
    .int("الكمية يجب أن تكون رقماً صحيحاً")
    .nonnegative("الكمية لا يمكن أن تكون سالبة"),
});

export const repStockRequestReviewSchema = z.object({
  adminNote: z.string().max(500, "الملاحظة طويلة جداً").optional(),
  items: z.array(reviewItemSchema).min(1),
});

export type RepStockRequestReviewInput = z.infer<typeof repStockRequestReviewSchema>;
