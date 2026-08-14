import { z } from "zod";

const transferLineSchema = z.object({
  productId: z.string().min(1, "المنتج مطلوب"),
  variantId: z.string().nullable().optional(),
  deviceColorVariantId: z.string().nullable().optional(),
  quantity: z.number().int("الكمية يجب أن تكون رقماً صحيحاً").positive("الكمية يجب أن تكون أكبر من صفر"),
});

/** A pure warehouse<->rep-car stock movement — no customer/order context, so
 * a line has no colorId at all: color is only ever recorded on an order
 * line, never on a stock transfer, and never affects which InventoryItem
 * bucket moves (see the InventoryItem doc comment in prisma/schema.prisma).
 * Multiple lines in one submission become one RepStockTransferBatch with one
 * StockMovement per line — see assignStockToRep/returnStockFromRep in
 * src/app/admin/reps/actions.ts. */
export const repStockTransferBatchSchema = z.object({
  items: z
    .array(transferLineSchema)
    .min(1, "يجب إضافة منتج واحد على الأقل")
    .max(50, "عدد كبير جداً من المنتجات في عملية نقل واحدة")
    .refine(
      (items) => new Set(items.map((item) => `${item.productId}:${item.variantId ?? ""}:${item.deviceColorVariantId ?? ""}`)).size === items.length,
      { message: "لا يمكن تكرار نفس المنتج بنفس الخيارات أكثر من مرة — عدّل الكمية بدلاً من ذلك" },
    ),
  notes: z.string().max(500, "الملاحظات طويلة جداً").optional(),
});

export type RepStockTransferBatchInput = z.infer<typeof repStockTransferBatchSchema>;
