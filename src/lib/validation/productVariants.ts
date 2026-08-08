import { z } from "zod";

export const variantRowSchema = z.object({
  id: z.string().optional(),
  phoneModelId: z.string().min(1),
  variantCode: z.string().trim().max(80).nullable().optional(),
  isActive: z.boolean(),
});

export const productVariantsSchema = z.object({ variants: z.array(variantRowSchema).max(500) });

export const allocationSchema = z.object({
  sourceInventoryItemId: z.string().min(1),
  allocations: z.array(z.object({ variantId: z.string().min(1), quantity: z.number().int().positive() })).min(1).max(500),
});
