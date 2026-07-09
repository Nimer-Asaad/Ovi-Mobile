import { z } from "zod";

export const checkoutSchema = z.object({
  contactName: z.string().min(2, "الاسم الكامل مطلوب"),
  contactPhone: z.string().min(7, "رقم الهاتف مطلوب"),
  city: z.string().min(2, "المدينة / المنطقة مطلوبة"),
  address: z.string().min(5, "العنوان مطلوب"),
  notes: z.string().optional(),
});

export type CheckoutInput = z.infer<typeof checkoutSchema>;
