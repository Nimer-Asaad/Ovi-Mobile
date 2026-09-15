import { z } from "zod";

/** ISO calendar date, "YYYY-MM-DD" — matches the `<input type="date">`
 * value format exactly, and the plain string form OnlineSale.saleDate is
 * converted to/from (see isoToSaleDate/saleDateToIso in
 * src/lib/online-sales.ts). Whether it's in the future is checked
 * server-side in the action (against the live Palestine business date via
 * getBusinessDateIso), not here — a static schema can't know "today". */
const saleDateIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "التاريخ غير صالح");

/** Admin types a plain NIS amount for one category, or leaves it blank —
 * blank means "no sale in this category today" (transforms to 0 cents,
 * silently skipped by the caller — see saveOnlineSalesAction), never an
 * error. Unlike manualOrder's nonNegativeMoneyString (which requires a
 * value), every field here is genuinely optional. A value that IS typed
 * must still be a non-negative number. */
const optionalNonNegativeMoneyString = z
  .string()
  .optional()
  .transform((value) => value?.trim() ?? "")
  .refine((value) => value === "" || (Number.isFinite(Number(value)) && Number(value) >= 0), {
    message: "المبلغ يجب أن يكون رقماً صفراً أو أكبر",
  })
  .transform((value) => (value === "" ? 0 : Math.round(Number(value) * 100)));

export const saveOnlineSalesSchema = z.object({
  saleDate: saleDateIso,
  wholesaleAmountCents: optionalNonNegativeMoneyString,
  superWholesaleAmountCents: optionalNonNegativeMoneyString,
  retailAmountCents: optionalNonNegativeMoneyString,
});
