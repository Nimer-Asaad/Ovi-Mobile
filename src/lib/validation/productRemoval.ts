import { z } from "zod";

export const productRemovalSchema = z
  .object({
    productId: z.string().trim().min(1).max(40),
  })
  .strict();
