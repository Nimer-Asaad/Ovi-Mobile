import { z } from "zod";
import { ORDER_STATUSES, PAYMENT_STATUSES } from "@/lib/constants";

/** No custom error message here on purpose — the actions treat any parse
 * failure as one fixed Arabic message, sidestepping Zod's own
 * version-specific error-customization API for enums. */
export const orderStatusSchema = z.enum(Object.values(ORDER_STATUSES) as [string, ...string[]]);
export const paymentStatusSchema = z.enum(Object.values(PAYMENT_STATUSES) as [string, ...string[]]);
