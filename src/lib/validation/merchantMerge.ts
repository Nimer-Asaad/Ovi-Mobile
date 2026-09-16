import { z } from "zod";

export const confirmMerchantMergeSchema = z
  .object({
    sourceMerchantId: z.string().min(1, "التاجر المكرر مطلوب"),
    targetMerchantId: z.string().min(1, "معرّف التاجر الأساسي غير صالح"),
  })
  .refine((value) => value.sourceMerchantId !== value.targetMerchantId, {
    message: "لا يمكن دمج التاجر مع نفسه.",
    path: ["sourceMerchantId"],
  });
