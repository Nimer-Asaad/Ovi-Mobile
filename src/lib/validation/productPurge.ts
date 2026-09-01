import { z } from "zod";
import { MAX_PURGE_BATCH_SIZE } from "@/lib/product-purge";

/** Shape of the request for BOTH the preview (read-only) and the actual
 * purge (destructive) — the preview omits confirmPhrase entirely (never
 * needed to just look), the purge action requires it and checks it against
 * PURGE_CONFIRMATION_PHRASE server-side. */
export const productPurgeIdsSchema = z.object({
  productIds: z
    .array(z.string().min(1))
    .min(1, "اختر منتجاً واحداً على الأقل")
    .max(MAX_PURGE_BATCH_SIZE, `الحد الأقصى ${MAX_PURGE_BATCH_SIZE} منتج لكل عملية حذف`),
});

export const productPurgeConfirmSchema = productPurgeIdsSchema.extend({
  confirmPhrase: z.string(),
});

export type ProductPurgeIdsInput = z.infer<typeof productPurgeIdsSchema>;
export type ProductPurgeConfirmInput = z.infer<typeof productPurgeConfirmSchema>;
