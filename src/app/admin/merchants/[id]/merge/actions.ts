"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth/guards";
import { ROLES } from "@/lib/constants";
import { mergeMerchants, MerchantMergeError } from "@/lib/merchant-merge";
import { confirmMerchantMergeSchema } from "@/lib/validation/merchantMerge";

export interface ConfirmMerchantMergeState {
  error?: string;
}

function revalidateMergeAffectedPaths(sourceMerchantId: string, targetMerchantId: string): void {
  revalidatePath("/admin/merchants");
  revalidatePath(`/admin/merchants/${sourceMerchantId}`);
  revalidatePath(`/admin/merchants/${targetMerchantId}`);
  revalidatePath(`/admin/merchants/${targetMerchantId}/merge`);
  revalidatePath("/admin/accounts");
  revalidatePath("/admin/reports");
  revalidatePath("/rep/merchants");
  revalidatePath(`/rep/merchants/${sourceMerchantId}`);
  revalidatePath(`/rep/merchants/${targetMerchantId}`);
}

/** The one entry point that actually performs a merchant merge — ADMIN-only,
 * independently re-checked here (never trusts the page/layout guard alone,
 * matching every other sensitive admin action in this app). The entire
 * merge (reads, moves, archival, audit log, invariant checks) happens
 * inside ONE prisma.$transaction wrapping mergeMerchants
 * (src/lib/merchant-merge.ts) — if anything fails, including a failed
 * invariant, the transaction rolls back and nothing is left partially
 * merged. */
export async function confirmMerchantMergeAction(
  targetMerchantId: string,
  _prevState: ConfirmMerchantMergeState,
  formData: FormData,
): Promise<ConfirmMerchantMergeState> {
  const admin = await requireRole([ROLES.ADMIN]);

  const parsed = confirmMerchantMergeSchema.safeParse({
    sourceMerchantId: formData.get("sourceMerchantId")?.toString() ?? "",
    targetMerchantId,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة" };
  }

  try {
    await prisma.$transaction((tx) =>
      mergeMerchants(tx, {
        sourceMerchantId: parsed.data.sourceMerchantId,
        targetMerchantId: parsed.data.targetMerchantId,
        adminId: admin.id,
      }),
    );
  } catch (error) {
    if (error instanceof MerchantMergeError) {
      const message =
        error.code === "SAME_MERCHANT"
          ? "لا يمكن دمج التاجر مع نفسه."
          : error.code === "NOT_FOUND"
            ? "تعذر العثور على أحد سجلي التاجر."
            : error.code === "CONFLICTING_LOGINS"
              ? "لا يمكن دمج التاجرين تلقائياً لأن كلا السجلين مرتبطان بحساب دخول مختلف."
              : "تعذر دمج التاجرين لأن بيانات الحساب غير متوافقة.";
      return { error: message };
    }
    throw error;
  }

  revalidateMergeAffectedPaths(parsed.data.sourceMerchantId, parsed.data.targetMerchantId);
  redirect(`/admin/merchants/${parsed.data.targetMerchantId}?merged=1`);
}
