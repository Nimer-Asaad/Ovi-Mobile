import { z } from "zod";

/** Parses a quantity from a raw FormData string. Rejects non-numeric input
 * via the `.refine` (rather than relying on `z.coerce.number()`'s own error
 * message, whose constructor-option API varies across Zod versions). */
export const quantitySchema = z
  .string()
  .refine((v) => Number.isFinite(Number(v)), { message: "الكمية يجب أن تكون رقماً" })
  .transform((v) => Number(v))
  .refine((v) => Number.isInteger(v), { message: "الكمية يجب أن تكون رقماً صحيحاً" })
  .refine((v) => v >= 1, { message: "الكمية يجب أن تكون على الأقل 1" });

export type QuantityInput = z.infer<typeof quantitySchema>;
