import { z } from "zod";
import { ACCOUNT_PAYMENT_METHODS } from "@/lib/constants";
import { nonNegativeMoneyString } from "@/lib/validation/manualOrder";

const saleItemSchema = z.object({
  productId: z.string().min(1, "المنتج مطلوب"),
  /** Null for a colorless product/line. */
  colorId: z.string().nullable().optional(),
  variantId: z.string().nullable().optional(),
  deviceColorVariantId: z.string().nullable().optional(),
  quantity: z.number().int("الكمية يجب أن تكون رقماً صحيحاً").positive("الكمية يجب أن تكون أكبر من صفر"),
  /** Already converted to integer agorot cents client-side, same convention
   * as every other money field. */
  unitPriceCents: z.number().int().positive("سعر البيع يجب أن يكون أكبر من صفر"),
});

export const repSaleSchema = z
  .object({
    items: z
      .array(saleItemSchema)
      .min(1, "يجب إضافة منتج واحد على الأقل")
      .max(50, "عدد كبير جداً من المنتجات في عملية بيع واحدة")
      .refine(
        (items) => new Set(items.map((item) => `${item.productId}:${item.variantId ?? ""}:${item.deviceColorVariantId ?? ""}:${item.colorId ?? ""}`)).size === items.length,
        { message: "لا يمكن تكرار نفس المنتج بنفس الخيارات أكثر من مرة — عدّل الكمية بدلاً من ذلك" },
      ),
    customerName: z.string().min(2, "اسم العميل مطلوب"),
    customerPhone: z.string().min(7, "رقم هاتف العميل مطلوب"),
    city: z.string().optional(),
    address: z.string().optional(),
    notes: z.string().max(500, "الملاحظات طويلة جداً").optional(),
    /** Set when this sale was started from a customer-order car-load template
     * (see RepCustomerOrder) — the rep may have added/removed/changed lines
     * freely first, `items` above always wins as the actual sale content.
     * Null/omitted for a normal blank sale. */
    repCustomerOrderId: z.string().nullable().optional(),
    /** How much of this invoice the trader is paying right now — 0 is the
     * normal "fully on account" case, up to the full invoice total for a
     * fully-paid sale. Reuses manualOrder's exact zero-allowed money
     * convention rather than a fourth near-duplicate schema. The upper bound
     * (can't exceed the invoice total) is enforced just below, against the
     * SAME `items` this object also carries — never against a separate
     * client-sent total. createRepSaleCore re-derives and re-checks this
     * once more from its own authoritative totalCents before ever writing
     * anything, so this is defense-in-depth, not the only guard. */
    paidNowCents: nonNegativeMoneyString,
    /** AccountPayment.method for the immediate payment above — only
     * meaningful (and only ever used) when paidNowCents > 0; ignored
     * otherwise. Order.paymentMethod is a completely separate enum
     * (CASH/CASH_ON_DELIVERY, describing the delivery arrangement) and is
     * never touched by this field. */
    paidNowMethod: z.enum(Object.values(ACCOUNT_PAYMENT_METHODS) as [string, ...string[]]).optional(),
  })
  .superRefine((value, ctx) => {
    const totalCents = value.items.reduce((sum, item) => sum + item.unitPriceCents * item.quantity, 0);
    if (value.paidNowCents > totalCents) {
      ctx.addIssue({ code: "custom", path: ["paidNowCents"], message: "المبلغ المدفوع الآن أكبر من إجمالي الفاتورة" });
    }
  });

export type RepSaleInput = z.infer<typeof repSaleSchema>;
