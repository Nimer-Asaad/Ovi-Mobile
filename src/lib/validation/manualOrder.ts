import { z } from "zod";

export const MANUAL_ORDER_CUSTOMER_MODES = {
  EXISTING_CUSTOMER: "EXISTING_CUSTOMER",
  EXISTING_MERCHANT: "EXISTING_MERCHANT",
  WALK_IN: "WALK_IN",
} as const;

/** Admin types a plain NIS amount (e.g. "0" or "150.50"); this converts to
 * integer agorot cents for storage, matching the Int-cents money
 * convention used everywhere else. Unlike repSale's positiveMoneyString,
 * zero is allowed here — an unpaid manual order (paidAmountCents = 0) is a
 * normal, expected case. */
const nonNegativeMoneyString = z
  .string()
  .min(1, "المبلغ مطلوب")
  .refine((v) => Number.isFinite(Number(v)) && Number(v) >= 0, {
    message: "المبلغ يجب أن يكون رقماً صفراً أو أكبر",
  })
  .transform((v) => Math.round(Number(v) * 100));

const manualOrderItemSchema = z.object({
  productId: z.string().min(1, "المنتج مطلوب"),
  quantity: z.number().int("الكمية يجب أن تكون رقماً صحيحاً").positive("الكمية يجب أن تكون أكبر من صفر"),
  unitPriceCents: z.number().int("السعر يجب أن يكون رقماً صحيحاً").nonnegative("السعر لا يمكن أن يكون سالباً"),
});

export const manualOrderSchema = z.object({
  customerMode: z.enum(
    Object.values(MANUAL_ORDER_CUSTOMER_MODES) as [string, ...string[]],
  ),
  customerId: z.string().optional(),
  merchantId: z.string().optional(),
  contactName: z.string().min(2, "اسم العميل مطلوب"),
  contactPhone: z.string().min(7, "رقم الهاتف مطلوب"),
  city: z.string().optional(),
  address: z.string().optional(),
  notes: z.string().max(500, "الملاحظات طويلة جداً").optional(),
  discountCents: nonNegativeMoneyString,
  paidAmountCents: nonNegativeMoneyString,
  items: z
    .array(manualOrderItemSchema)
    .min(1, "يجب إضافة منتج واحد على الأقل")
    .max(50, "عدد كبير جداً من المنتجات في طلب واحد")
    .refine((items) => new Set(items.map((item) => item.productId)).size === items.length, {
      message: "لا يمكن تكرار نفس المنتج أكثر من مرة — عدّل الكمية بدلاً من ذلك",
    }),
});

export type ManualOrderInput = z.infer<typeof manualOrderSchema>;
