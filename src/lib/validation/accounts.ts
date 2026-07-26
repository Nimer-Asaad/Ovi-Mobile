import { z } from "zod";
import { ACCOUNT_PAYMENT_METHODS } from "@/lib/constants";

/** Admin types a plain NIS amount (e.g. "150.50"); this converts to integer
 * agorot cents for storage. Unlike manualOrder's nonNegativeMoneyString, a
 * payment of exactly 0 is meaningless here, so it's rejected. */
const positiveMoneyString = z
  .string()
  .min(1, "المبلغ مطلوب")
  .refine((v) => Number.isFinite(Number(v)) && Number(v) > 0, {
    message: "المبلغ يجب أن يكون رقماً أكبر من صفر",
  })
  .transform((v) => Math.round(Number(v) * 100));

export const createWalkInAccountSchema = z
  .object({
    displayName: z.string().trim().min(2, "الاسم مطلوب").max(120),
    phone: z.string().trim().min(7, "رقم الهاتف مطلوب").max(30),
    notes: z.string().trim().max(500, "الملاحظات طويلة جداً").optional(),
    /** Optional — creates a real User login (RETAIL_CUSTOMER) alongside the
     * ledger account, with a system-generated password shown once to the
     * admin (never emailed automatically). */
    createLogin: z
      .string()
      .optional()
      .transform((v) => v === "on" || v === "true"),
    email: z
      .string()
      .trim()
      .toLowerCase()
      .optional()
      .or(z.literal("")),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!value.createLogin) return;
    if (!value.email) {
      ctx.addIssue({ code: "custom", path: ["email"], message: "البريد الإلكتروني مطلوب لإنشاء حساب دخول" });
      return;
    }
    if (!z.string().email().safeParse(value.email).success) {
      ctx.addIssue({ code: "custom", path: ["email"], message: "صيغة البريد الإلكتروني غير صحيحة" });
    }
  });

export const recordAccountPaymentSchema = z
  .object({
    accountId: z.string().trim().min(1),
    amountCents: positiveMoneyString,
    method: z.enum(Object.values(ACCOUNT_PAYMENT_METHODS) as [string, ...string[]]),
    note: z.string().trim().max(500, "الملاحظات طويلة جداً").optional(),
  })
  .strict();
