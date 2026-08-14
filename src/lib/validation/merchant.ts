import { z } from "zod";
import { MERCHANT_STATUSES } from "@/lib/constants";

export const merchantStatusSchema = z.enum([
  MERCHANT_STATUSES.PENDING,
  MERCHANT_STATUSES.APPROVED,
  MERCHANT_STATUSES.REJECTED,
]);

/** Admin "add trader" form — creates a login-less Merchant (no email/
 * password), approved immediately since an admin is vouching for them
 * directly. See the Merchant model doc comment in prisma/schema.prisma. */
export const createMerchantSchema = z.object({
  businessName: z.string().min(2, "اسم التاجر مطلوب"),
  contactPhone: z.string().min(7, "رقم الهاتف مطلوب"),
  city: z.string().optional(),
  address: z.string().optional(),
  region: z.string().optional(),
  assignedRepId: z.string().optional(),
});

export type CreateMerchantInput = z.infer<typeof createMerchantSchema>;
