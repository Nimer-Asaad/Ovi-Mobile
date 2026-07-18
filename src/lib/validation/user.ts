import { z } from "zod";
import { ROLES } from "@/lib/constants";

export const changeableRoleSchema = z.enum([
  ROLES.ADMIN,
  ROLES.SALES_REPRESENTATIVE,
  ROLES.WHOLESALE_MERCHANT,
  ROLES.RETAIL_CUSTOMER,
]);
