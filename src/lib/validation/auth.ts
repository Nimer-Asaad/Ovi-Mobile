import { z } from "zod";

/** Emails are always normalized to lowercase before being saved or looked up
 * — this schema is the single place that happens. */
const emailSchema = z
  .string()
  .min(1, "البريد الإلكتروني مطلوب")
  .email("صيغة البريد الإلكتروني غير صحيحة")
  .transform((value) => value.trim().toLowerCase());

const passwordSchema = z.string().min(8, "كلمة المرور يجب أن تكون 8 أحرف على الأقل");

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "كلمة المرور مطلوبة"),
});

export const registerCustomerSchema = z
  .object({
    name: z.string().min(2, "الاسم يجب أن يكون حرفين على الأقل"),
    email: emailSchema,
    phone: z.string().optional(),
    password: passwordSchema,
    confirmPassword: z.string().min(1, "تأكيد كلمة المرور مطلوب"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "كلمتا المرور غير متطابقتين",
    path: ["confirmPassword"],
  });

export const registerMerchantSchema = z
  .object({
    name: z.string().min(2, "الاسم يجب أن يكون حرفين على الأقل"),
    email: emailSchema,
    phone: z.string().optional(),
    businessName: z.string().min(2, "اسم النشاط التجاري مطلوب"),
    taxId: z.string().optional(),
    password: passwordSchema,
    confirmPassword: z.string().min(1, "تأكيد كلمة المرور مطلوب"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "كلمتا المرور غير متطابقتين",
    path: ["confirmPassword"],
  });

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterCustomerInput = z.infer<typeof registerCustomerSchema>;
export type RegisterMerchantInput = z.infer<typeof registerMerchantSchema>;
