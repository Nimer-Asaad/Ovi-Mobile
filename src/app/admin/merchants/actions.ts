"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth/guards";
import { ROLES, MERCHANT_STATUSES } from "@/lib/constants";
import { merchantStatusSchema } from "@/lib/validation/merchant";

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
  await requireRole([ROLES.ADMIN]);

  const parsed = merchantStatusSchema.safeParse(targetStatus);
  if (!parsed.success) {
    return { error: "حالة غير صالحة" };
  }

  const merchant = await prisma.merchant.findUnique({ where: { id: merchantId }, select: { id: true } });
  if (!merchant) {
    return { error: "التاجر غير موجود" };
  }

  await prisma.merchant.update({
    where: { id: merchantId },
    data: {
      status: parsed.data,
      approvedAt: parsed.data === MERCHANT_STATUSES.APPROVED ? new Date() : null,
    },
  });

  revalidateMerchantPaths(merchantId);

  return { success: STATUS_SUCCESS_MESSAGES[parsed.data] };
}
