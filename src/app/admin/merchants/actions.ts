"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth/guards";
import { ROLES, MERCHANT_STATUSES, ADMIN_AUDIT_ACTIONS } from "@/lib/constants";
import { merchantStatusSchema, createMerchantSchema, updateMerchantSchema } from "@/lib/validation/merchant";
import { getOrCreateMerchantAccount } from "@/lib/accounts";

const AUDIT_ACTION_BY_STATUS: Record<string, string> = {
  [MERCHANT_STATUSES.APPROVED]: ADMIN_AUDIT_ACTIONS.MERCHANT_APPROVED,
  [MERCHANT_STATUSES.REJECTED]: ADMIN_AUDIT_ACTIONS.MERCHANT_REJECTED,
  [MERCHANT_STATUSES.PENDING]: ADMIN_AUDIT_ACTIONS.MERCHANT_STATUS_RESET,
  [MERCHANT_STATUSES.SUSPENDED]: ADMIN_AUDIT_ACTIONS.MERCHANT_SUSPENDED,
};

export interface MerchantStatusState {
  error?: string;
  success?: string;
}

const STATUS_SUCCESS_MESSAGES: Record<string, string> = {
  [MERCHANT_STATUSES.APPROVED]: "تم اعتماد/تفعيل التاجر بنجاح",
  [MERCHANT_STATUSES.REJECTED]: "تم رفض التاجر",
  [MERCHANT_STATUSES.PENDING]: "تمت إعادة التاجر إلى قيد المراجعة",
  [MERCHANT_STATUSES.SUSPENDED]: "تم إيقاف التاجر",
};

function revalidateMerchantPaths(merchantId: string): void {
  revalidatePath("/admin/merchants");
  revalidatePath(`/admin/merchants/${merchantId}`);
  revalidatePath(`/admin/merchants/${merchantId}/edit`);
  revalidatePath("/admin");
  revalidatePath("/merchant");
  revalidatePath("/merchant/pending");
  revalidatePath("/rep/merchants");
  revalidatePath(`/rep/merchants/${merchantId}`);
  revalidatePath(`/rep/merchants/${merchantId}/statement`);
}

/** Sets Merchant.status — SUSPENDED (archived/paused) is now a settable
 * target here too, not just APPROVED/REJECTED/PENDING, so this one action
 * serves both the original online-signup review workflow AND the
 * "إيقاف / تفعيل" archive toggle (see MerchantStatusActions.tsx) and the
 * automatic archive fallback in deleteMerchant below — one status field,
 * one place that writes it, never a second competing state. */
export async function updateMerchantStatus(
  merchantId: string,
  targetStatus: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- useActionState requires this signature
  _prevState: MerchantStatusState,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- status comes from the bound targetStatus arg, not the form
  _formData: FormData,
): Promise<MerchantStatusState> {
  const admin = await requireRole([ROLES.ADMIN]);

  const parsed = merchantStatusSchema.safeParse(targetStatus);
  if (!parsed.success) {
    return { error: "حالة غير صالحة" };
  }

  const merchant = await prisma.merchant.findUnique({
    where: { id: merchantId },
    select: { id: true, status: true, userId: true },
  });
  if (!merchant) {
    return { error: "التاجر غير موجود" };
  }

  await prisma.$transaction([
    prisma.merchant.update({
      where: { id: merchantId },
      data: {
        status: parsed.data,
        approvedAt: parsed.data === MERCHANT_STATUSES.APPROVED ? new Date() : null,
      },
    }),
    // AdminAuditLog tracks actions against a User account — a login-less
    // trader (merchant.userId null) has none, so there's nothing meaningful
    // to log here; the status change above still applies either way.
    ...(merchant.userId
      ? [
          prisma.adminAuditLog.create({
            data: {
              adminUserId: admin.id,
              targetUserId: merchant.userId,
              action: AUDIT_ACTION_BY_STATUS[parsed.data] ?? ADMIN_AUDIT_ACTIONS.MERCHANT_STATUS_RESET,
              oldValue: { status: merchant.status },
              newValue: { status: parsed.data },
            },
          }),
        ]
      : []),
  ]);

  // Every approved merchant gets a debt-ledger account up front (not just
  // lazily on their first order), so /admin/accounts always reflects the
  // full merchant roster — getOrCreateMerchantAccount is a no-op if one
  // already exists (e.g. re-approving after a suspension).
  if (parsed.data === MERCHANT_STATUSES.APPROVED) {
    await getOrCreateMerchantAccount(prisma, merchantId);
  }

  revalidateMerchantPaths(merchantId);

  return { success: STATUS_SUCCESS_MESSAGES[parsed.data] };
}

export interface MerchantAssignmentState {
  error?: string;
  success?: string;
}

/** Sets which sales rep "owns" a merchant (Merchant.assignedRepId) and the
 * merchant's free-form territory label (Merchant.region) — both fields were
 * modeled in the schema from the start but had no UI writing them until the
 * rep-facing /rep/merchants section needed a way to know which merchants
 * belong to which rep. */
export async function updateMerchantAssignment(
  merchantId: string,
  _prevState: MerchantAssignmentState,
  formData: FormData,
): Promise<MerchantAssignmentState> {
  await requireRole([ROLES.ADMIN]);

  const regionRaw = formData.get("region");
  const region = typeof regionRaw === "string" && regionRaw.trim().length > 0 ? regionRaw.trim() : null;

  const assignedRepIdRaw = formData.get("assignedRepId");
  const assignedRepId =
    typeof assignedRepIdRaw === "string" && assignedRepIdRaw.trim().length > 0 ? assignedRepIdRaw.trim() : null;

  const merchant = await prisma.merchant.findUnique({ where: { id: merchantId }, select: { id: true } });
  if (!merchant) {
    return { error: "التاجر غير موجود" };
  }

  if (assignedRepId) {
    const rep = await prisma.salesRepresentative.findUnique({ where: { id: assignedRepId }, select: { id: true } });
    if (!rep) {
      return { error: "المندوب المحدد غير موجود" };
    }
  }

  await prisma.merchant.update({
    where: { id: merchantId },
    data: { region, assignedRepId },
  });

  revalidateMerchantPaths(merchantId);

  return { success: "تم حفظ المنطقة والمندوب المسؤول" };
}

export interface CreateMerchantState {
  error?: string;
}

/** Admin "add trader" form — creates a login-less Merchant (no email/
 * password) approved immediately, since an admin is vouching for them
 * directly rather than this going through /register/merchant self-signup +
 * review. Mirrors updateMerchantStatus's "every approved merchant gets a
 * debt-ledger account up front" behavior.
 *
 * openingBalanceCents (parsed by createMerchantSchema, defaulting to 0 when
 * left blank) is applied here — and ONLY here — never inside
 * getOrCreateMerchantAccount itself, which is also called by the online
 * self-signup approval flow (updateMerchantStatus above) and by
 * resolveOrCreateRepMerchant; neither of those must ever set a nonzero
 * opening balance. A nonzero value is recorded with openingBalanceSetAt/
 * openingBalanceSetById set to this admin/now, in the SAME transaction as
 * the Merchant+CustomerAccount creation — never a separate, later write.
 * CustomerAccount.displayName/phone are seeded from businessName/
 * contactPhone at creation time, in the same transaction — see
 * updateMerchant below for how they stay in sync afterward too. */
export async function createMerchant(
  _prevState: CreateMerchantState,
  formData: FormData,
): Promise<CreateMerchantState> {
  const admin = await requireRole([ROLES.ADMIN]);

  const parsed = createMerchantSchema.safeParse({
    businessName: formData.get("businessName")?.toString().trim() ?? "",
    contactName: formData.get("contactName")?.toString().trim() || undefined,
    contactPhone: formData.get("contactPhone")?.toString().trim() ?? "",
    whatsappPhone: formData.get("whatsappPhone")?.toString().trim() || undefined,
    city: formData.get("city")?.toString().trim() || undefined,
    address: formData.get("address")?.toString().trim() || undefined,
    region: formData.get("region")?.toString().trim() || undefined,
    notes: formData.get("notes")?.toString().trim() || undefined,
    assignedRepId: formData.get("assignedRepId")?.toString().trim() || undefined,
    openingBalanceCents: formData.get("openingBalanceCents")?.toString(),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات التاجر غير صالحة" };
  }
  const { businessName, contactName, contactPhone, whatsappPhone, city, address, region, notes, assignedRepId, openingBalanceCents } =
    parsed.data;

  if (assignedRepId) {
    const rep = await prisma.salesRepresentative.findUnique({ where: { id: assignedRepId }, select: { id: true } });
    if (!rep) {
      return { error: "المندوب المحدد غير موجود" };
    }
  }

  const merchant = await prisma.$transaction(async (tx) => {
    const created = await tx.merchant.create({
      data: {
        businessName,
        contactName,
        contactPhone,
        whatsappPhone,
        city,
        address,
        region,
        notes,
        assignedRepId,
        status: MERCHANT_STATUSES.APPROVED,
        approvedAt: new Date(),
      },
      select: { id: true },
    });
    // getOrCreateMerchantAccount reads businessName/contactPhone straight
    // from the row just created above (same transaction) to seed the new
    // account's displayName/phone — nothing further needed here to keep
    // them in sync at creation time; see updateMerchant for how they stay
    // in sync on every later edit too.
    const accountId = await getOrCreateMerchantAccount(tx, created.id);
    if (openingBalanceCents > 0) {
      await tx.customerAccount.update({
        where: { id: accountId },
        data: { openingBalanceCents, openingBalanceSetAt: new Date(), openingBalanceSetById: admin.id },
      });
    }
    return created;
  });

  revalidatePath("/admin/merchants");
  revalidatePath("/admin");
  revalidatePath("/rep/merchants");

  redirect(`/admin/merchants/${merchant.id}`);
}

export interface UpdateMerchantState {
  error?: string;
  success?: string;
}

/** Edits an existing merchant's profile fields — deliberately never touches
 * status (updateMerchantStatus) or openingBalanceCents
 * (setAccountOpeningBalance in src/app/admin/accounts/actions.ts), each of
 * which has its own dedicated action and safety rule.
 *
 * MERCHANT <-> CUSTOMERACCOUNT SYNC RULE: Merchant is the master profile —
 * whenever businessName/contactPhone change here, the linked
 * CustomerAccount's displayName/phone are updated to match, in the SAME
 * transaction, so the two never drift into showing different names/numbers
 * for the same trader. phone is only overwritten when a non-empty
 * contactPhone was submitted (contactPhone is required by
 * updateMerchantSchema, so in practice this is always true) — never
 * silently nulled. This never changes any financial total: displayName/
 * phone are pure display fields on CustomerAccount, completely independent
 * of openingBalanceCents/orders/payments. */
export async function updateMerchant(
  merchantId: string,
  _prevState: UpdateMerchantState,
  formData: FormData,
): Promise<UpdateMerchantState> {
  await requireRole([ROLES.ADMIN]);

  const existing = await prisma.merchant.findUnique({
    where: { id: merchantId },
    select: { id: true, account: { select: { id: true } } },
  });
  if (!existing) {
    return { error: "التاجر غير موجود" };
  }

  const parsed = updateMerchantSchema.safeParse({
    businessName: formData.get("businessName")?.toString().trim() ?? "",
    contactName: formData.get("contactName")?.toString().trim() || undefined,
    contactPhone: formData.get("contactPhone")?.toString().trim() ?? "",
    whatsappPhone: formData.get("whatsappPhone")?.toString().trim() || undefined,
    city: formData.get("city")?.toString().trim() || undefined,
    address: formData.get("address")?.toString().trim() || undefined,
    region: formData.get("region")?.toString().trim() || undefined,
    notes: formData.get("notes")?.toString().trim() || undefined,
    assignedRepId: formData.get("assignedRepId")?.toString().trim() || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات التاجر غير صالحة" };
  }
  const { businessName, contactName, contactPhone, whatsappPhone, city, address, region, notes, assignedRepId } = parsed.data;

  if (assignedRepId) {
    const rep = await prisma.salesRepresentative.findUnique({ where: { id: assignedRepId }, select: { id: true } });
    if (!rep) {
      return { error: "المندوب المحدد غير موجود" };
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.merchant.update({
      where: { id: merchantId },
      data: {
        businessName,
        contactName: contactName ?? null,
        contactPhone,
        whatsappPhone: whatsappPhone ?? null,
        city: city ?? null,
        address: address ?? null,
        region: region ?? null,
        notes: notes ?? null,
        assignedRepId: assignedRepId ?? null,
      },
    });
    if (existing.account) {
      await tx.customerAccount.update({
        where: { id: existing.account.id },
        data: { displayName: businessName, phone: contactPhone },
      });
    }
  });

  revalidateMerchantPaths(merchantId);
  if (existing.account) {
    revalidatePath(`/admin/accounts/${existing.account.id}`);
    revalidatePath(`/admin/accounts/${existing.account.id}/statement`);
    revalidatePath("/admin/accounts");
  }

  return { success: "تم حفظ بيانات التاجر" };
}

export interface DeleteMerchantState {
  error?: string;
  success?: string;
  /** True when the merchant had protected history and was archived
   * (SUSPENDED) instead of hard-deleted — lets the UI show the specific
   * "couldn't delete, archived instead" message rather than a generic
   * success line. */
  archivedInstead?: boolean;
  /** True when the merchant was actually, permanently removed. */
  deleted?: boolean;
}

/** Safe merchant deletion — NEVER hard-deletes a merchant with a login, or
 * with any real financial/business history. Every dependency is counted
 * explicitly here (never assumed, never relying on the DB's own ON DELETE
 * behavior — see below for why that matters) before deciding which of the
 * two cases applies:
 *
 * CASE A — hard delete — ALL of the following must hold: no linked User
 * (userId null — a login-linked merchant is NEVER hard-deleted, no matter
 * how empty its history is), zero Orders, zero RepCustomerOrders, and if a
 * CustomerAccount exists: zero of its own Orders, zero AccountPayments, and
 * no opening balance ever recorded (openingBalanceCents === 0 AND
 * openingBalanceSetAt === null AND openingBalanceSetById === null — checked
 * as three separate signals, any one of which alone means real financial
 * history exists). Permanently deletes the CustomerAccount (if any) then the
 * Merchant, in one transaction. Never touches the User row in any way (there
 * is none, by definition, in this case).
 *
 * CASE B — archive instead — any of the above doesn't hold. NEVER deletes
 * anything. Instead sets Merchant.status to SUSPENDED (the same archival
 * state the "إيقاف" toggle uses — see updateMerchantStatus), preserving
 * every User/Order/AccountPayment/RepCustomerOrder/openingBalanceCents value
 * completely untouched, and returns the exact required Arabic explanation —
 * a distinct message for "login-linked" vs. "has financial history", since
 * an admin needs to understand which one applies. Deliberately never:
 * deletes the User, unlinks userId, changes the User's role, or touches any
 * auth behavior — a suspended merchant's owner can still log in exactly as
 * before, they simply can't be sold to (see the MERCHANT_NOT_APPROVED guard
 * in createRepSaleCore) until reactivated.
 *
 * WHY THIS CAN'T RELY ON THE SCHEMA'S OWN ON DELETE BEHAVIOR: every FK that
 * points AT Merchant (orders.merchantId, rep_customer_orders.merchantId,
 * customer_accounts.merchantId) is ON DELETE SET NULL, not RESTRICT —
 * Postgres would happily let a hard DELETE proceed and just null out those
 * references, silently severing a real order/payment's link to the
 * merchant it belonged to while leaving the row itself intact. That is
 * exactly the kind of silent historical corruption this function exists to
 * prevent, which is why every dependency is counted and checked in
 * application code FIRST, before ever attempting a delete. */
export async function deleteMerchant(merchantId: string): Promise<DeleteMerchantState> {
  await requireRole([ROLES.ADMIN]);

  const merchant = await prisma.merchant.findUnique({
    where: { id: merchantId },
    select: {
      id: true,
      status: true,
      userId: true,
      account: {
        select: {
          id: true,
          openingBalanceCents: true,
          openingBalanceSetAt: true,
          openingBalanceSetById: true,
          _count: { select: { orders: true, payments: true } },
        },
      },
      _count: { select: { orders: true, repCustomerOrders: true } },
    },
  });
  if (!merchant) {
    return { error: "التاجر غير موجود" };
  }

  const isLoginLinked = merchant.userId != null;
  const hasOpeningBalanceHistory =
    (merchant.account?.openingBalanceCents ?? 0) !== 0 ||
    merchant.account?.openingBalanceSetAt != null ||
    merchant.account?.openingBalanceSetById != null;
  const hasProtectedHistory =
    isLoginLinked ||
    merchant._count.orders > 0 ||
    merchant._count.repCustomerOrders > 0 ||
    (merchant.account?._count.orders ?? 0) > 0 ||
    (merchant.account?._count.payments ?? 0) > 0 ||
    hasOpeningBalanceHistory;

  if (hasProtectedHistory) {
    if (merchant.status !== MERCHANT_STATUSES.SUSPENDED) {
      await prisma.merchant.update({ where: { id: merchantId }, data: { status: MERCHANT_STATUSES.SUSPENDED } });
    }
    revalidateMerchantPaths(merchantId);
    return {
      archivedInstead: true,
      success: isLoginLinked
        ? "لا يمكن حذف هذا التاجر نهائياً لأنه مرتبط بحساب دخول. تم إيقافه مع الاحتفاظ بالحساب والسجل."
        : "لا يمكن حذف هذا التاجر نهائياً لأنه يحتوي على فواتير أو دفعات أو سجل مالي. تم إيقافه مع الاحتفاظ بالسجل.",
    };
  }

  // userId is guaranteed null here (isLoginLinked already forced the archive
  // branch above otherwise) — this transaction never touches the User model.
  await prisma.$transaction(async (tx) => {
    if (merchant.account) {
      await tx.customerAccount.delete({ where: { id: merchant.account.id } });
    }
    await tx.merchant.delete({ where: { id: merchantId } });
  });

  revalidateMerchantPaths(merchantId);
  return { deleted: true, success: "تم حذف التاجر نهائياً" };
}
