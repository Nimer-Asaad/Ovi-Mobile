import { z } from "zod";
import { MERCHANT_STATUSES } from "@/lib/constants";
import { openingBalanceMoneyString } from "@/lib/validation/accounts";

/** Includes SUSPENDED — reused as the merchant-archival state (see the
 * Merchant.status doc comment in prisma/schema.prisma), settable the same
 * way as every other status transition via updateMerchantStatus. */
export const merchantStatusSchema = z.enum([
  MERCHANT_STATUSES.PENDING,
  MERCHANT_STATUSES.APPROVED,
  MERCHANT_STATUSES.REJECTED,
  MERCHANT_STATUSES.SUSPENDED,
]);

/** Shared profile fields between creating a new merchant and editing an
 * existing one — deliberately the SAME shape so createMerchant/updateMerchant
 * can never drift into accepting different data for the same fields. Phone
 * fields are plain trimmed strings with only a length check (no format
 * regex) — matching every other phone field in this app (see
 * createWalkInAccountSchema in validation/accounts.ts) — so a local
 * Palestinian number (059.../056...) is never rejected by an invented
 * international-format assumption. */
const merchantProfileFields = {
  businessName: z.string().trim().min(2, "اسم المحل مطلوب").max(200, "اسم المحل طويل جداً"),
  contactName: z.string().trim().max(200, "اسم صاحب المحل طويل جداً").optional(),
  contactPhone: z.string().trim().min(7, "رقم الجوال مطلوب").max(30, "رقم الجوال طويل جداً"),
  /** Left null when not supplied — never silently defaulted to
   * contactPhone (see the schema doc comment on Merchant.whatsappPhone). */
  whatsappPhone: z.string().trim().max(30, "رقم واتساب طويل جداً").optional(),
  city: z.string().trim().max(100, "اسم المدينة طويل جداً").optional(),
  address: z.string().trim().max(300, "العنوان طويل جداً").optional(),
  region: z.string().trim().max(100, "اسم المنطقة طويل جداً").optional(),
  notes: z.string().trim().max(1000, "الملاحظات طويلة جداً").optional(),
  assignedRepId: z.string().trim().optional(),
};

/** Admin "add trader" form — creates a login-less Merchant (no email/
 * password), approved immediately since an admin is vouching for them
 * directly. See the Merchant model doc comment in prisma/schema.prisma.
 * openingBalanceCents is optional — omitted/blank/"0" all mean "no
 * pre-existing debt", the normal case; a nonzero value is only ever set
 * here by an ADMIN filling in this exact form (never by an online
 * merchant's own self-approval flow — see createMerchant in
 * src/app/admin/merchants/actions.ts). */
export const createMerchantSchema = z.object({
  ...merchantProfileFields,
  openingBalanceCents: openingBalanceMoneyString,
});

export type CreateMerchantInput = z.infer<typeof createMerchantSchema>;

/** Editing an existing merchant's profile — deliberately excludes status
 * (handled by updateMerchantStatus/MerchantStatusActions) and
 * openingBalanceCents (handled by setAccountOpeningBalance/
 * SetOpeningBalanceForm, with its own confirm-before-changing rule) — a
 * profile edit must never silently change either. See updateMerchant in
 * src/app/admin/merchants/actions.ts for the Merchant<->CustomerAccount
 * displayName/phone sync this triggers. */
export const updateMerchantSchema = z.object(merchantProfileFields);

export type UpdateMerchantInput = z.infer<typeof updateMerchantSchema>;
