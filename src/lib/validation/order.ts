import { z } from "zod";
import { ORDER_STATUSES, PAYMENT_STATUSES } from "@/lib/constants";

/** No custom error message here on purpose — the actions treat any parse
 * failure as one fixed Arabic message, sidestepping Zod's own
 * version-specific error-customization API for enums. */
export const orderStatusSchema = z.enum(Object.values(ORDER_STATUSES) as [string, ...string[]]);
export const paymentStatusSchema = z.enum(Object.values(PAYMENT_STATUSES) as [string, ...string[]]);

export const orderLifecycleTransitionSchema = z
  .object({
    orderNumber: z.string().trim().min(1).max(50),
    status: orderStatusSchema,
    reason: z.string().trim().min(3).max(500).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const requiresReason =
      value.status === ORDER_STATUSES.CANCELLED || value.status === ORDER_STATUSES.RETURNED;
    if (requiresReason && !value.reason) {
      context.addIssue({
        code: "custom",
        path: ["reason"],
        message: "سبب الإلغاء أو الإرجاع مطلوب",
      });
    }
  });
