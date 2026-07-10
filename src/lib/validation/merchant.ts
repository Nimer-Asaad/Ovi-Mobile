import { z } from "zod";
import { MERCHANT_STATUSES } from "@/lib/constants";

export const merchantStatusSchema = z.enum([
  MERCHANT_STATUSES.PENDING,
  MERCHANT_STATUSES.APPROVED,
  MERCHANT_STATUSES.REJECTED,
]);
