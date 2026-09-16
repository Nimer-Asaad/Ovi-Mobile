import { z } from "zod";
import { ACCOUNT_PAYMENT_METHODS } from "@/lib/constants";
import { nonNegativeMoneyString } from "@/lib/validation/manualOrder";

const saleItemSchema = z
  .object({
    productId: z.string().min(1, "المنتج مطلوب"),
    /** Null for a colorless product/line. */
    colorId: z.string().nullable().optional(),
    variantId: z.string().nullable().optional(),
    deviceColorVariantId: z.string().nullable().optional(),
    quantity: z.number().int("الكمية يجب أن تكون رقماً صحيحاً").positive("الكمية يجب أن تكون أكبر من صفر"),
    /** Already converted to integer agorot cents client-side, same convention
     * as every other money field. */
    unitPriceCents: z.number().int().positive("سعر البيع يجب أن يكون أكبر من صفر"),
    /** Physical units within `quantity` given for free (بونص) — see
     * OrderItem.bonusQuantity's schema doc comment. 0 by default (the
     * normal, non-bonus case). Bounds (0 <= bonusQuantity <= quantity) are
     * re-validated authoritatively server-side via validateBonusQuantity
     * (src/lib/sale-pricing.ts) — this shape check only rejects an
     * obviously malformed number. */
    bonusQuantity: z.number().int("كمية البونص يجب أن تكون رقماً صحيحاً").nonnegative("كمية البونص لا يمكن أن تكون سالبة").default(0),
  })
  .refine((item) => item.bonusQuantity <= item.quantity, { message: "كمية البونص أكبر من الكمية الفعلية للصنف", path: ["bonusQuantity"] });

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
    /** خصم الفاتورة — a single fixed-money (agorot) discount applied to the
     * sale's chargeable subtotal (never a percentage, never per-line). 0 by
     * default. Bounds (0 <= discountCents <= chargeable subtotal) are
     * re-validated authoritatively server-side via validateInvoiceDiscount
     * (src/lib/sale-pricing.ts) once the real chargeable subtotal is known
     * from these exact items — this shape check only rejects a malformed
     * string. Reuses manualOrder's existing nonNegativeMoneyString
     * convention (the same one createManualOrder's own discountCents
     * already uses) rather than a second money-string schema. */
    discountCents: nonNegativeMoneyString,
    /** How much of this invoice the trader is paying right now — 0 is the
     * normal "fully on account" case. May exceed this invoice's own total
     * when the trader also has previous debt on their account: the extra
     * amount pays down that debt, never just the invoice. Reuses
     * manualOrder's exact zero-allowed money convention rather than a fourth
     * near-duplicate schema.
     *
     * Deliberately carries NO upper-bound check here (unlike before this
     * trader-debt-aware allocation existed) — this schema only ever sees the
     * submitted items/total, never the trader's live account balance, so it
     * cannot tell a valid "paying off old debt too" amount from a genuine
     * overpayment. createRepSaleCore is the ONE place with both: it resolves
     * the real trader identity and re-derives totalCents from these exact
     * items, then validates paidNowCents against
     * (that trader's live balance) + totalCents — the actual authoritative,
     * DB-backed check, never a client-sent total or balance. */
    paidNowCents: nonNegativeMoneyString,
    /** AccountPayment.method for the immediate payment above — only
     * meaningful (and only ever used) when paidNowCents > 0; ignored
     * otherwise. Order.paymentMethod is a completely separate enum
     * (CASH/CASH_ON_DELIVERY, describing the delivery arrangement) and is
     * never touched by this field. */
    paidNowMethod: z.enum(Object.values(ACCOUNT_PAYMENT_METHODS) as [string, ...string[]]).optional(),
  });

export type RepSaleInput = z.infer<typeof repSaleSchema>;
