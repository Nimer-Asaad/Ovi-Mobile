"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth/guards";
import { ROLES, MERCHANT_STATUSES, ADMIN_AUDIT_ACTIONS } from "@/lib/constants";
import { merchantStatusSchema, createMerchantSchema } from "@/lib/validation/merchant";
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
  [MERCHANT_STATUSES.APPROVED]: "تم اعتماد التاجر بنجاح",
  [MERCHANT_STATUSES.REJECTED]: "تم رفض التاجر",
  [MERCHANT_STATUSES.PENDING]: "تمت إعادة التاجر إلى قيد المراجعة",
};

function revalidateMerchantPaths(merchantId: string): void {
  revalidatePath("/admin/merchants");
  revalidatePath(`/admin/merchants/${merchantId}`);
  revalidatePath("/admin");
  revalidatePath("/merchant");
  revalidatePath("/merchant/pending");
}

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
  revalidatePath("/rep/merchants");

  return { success: "تم حفظ المنطقة والمندوب المسؤول" };
}

export interface CreateMerchantState {
  error?: string;
}

/** Admin "add trader" form — creates a login-less Merchant (no email/
 * password) approved immediately, since an admin is vouching for them
 * directly rather than this going through /register/merchant self-signup +
 * review. Mirrors updateMerchantStatus's "every approved merchant gets a
 * debt-ledger account up front" behavior. */
export async function createMerchant(
  _prevState: CreateMerchantState,
  formData: FormData,
): Promise<CreateMerchantState> {
  await requireRole([ROLES.ADMIN]);

  const parsed = createMerchantSchema.safeParse({
    businessName: formData.get("businessName")?.toString().trim() ?? "",
    contactPhone: formData.get("contactPhone")?.toString().trim() ?? "",
    city: formData.get("city")?.toString().trim() || undefined,
    address: formData.get("address")?.toString().trim() || undefined,
    region: formData.get("region")?.toString().trim() || undefined,
    assignedRepId: formData.get("assignedRepId")?.toString().trim() || undefined,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات التاجر غير صالحة" };
  }
  const { businessName, contactPhone, city, address, region, assignedRepId } = parsed.data;

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
        contactPhone,
        city,
        address,
        region,
        assignedRepId,
        status: MERCHANT_STATUSES.APPROVED,
        approvedAt: new Date(),
      },
      select: { id: true },
    });
    await getOrCreateMerchantAccount(tx, created.id);
    return created;
  });

  revalidatePath("/admin/merchants");
  revalidatePath("/admin");
  revalidatePath("/rep/merchants");

  redirect(`/admin/merchants/${merchant.id}`);
}
