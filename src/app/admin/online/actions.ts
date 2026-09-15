"use server";

import { revalidatePath } from "next/cache";
import type { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth/guards";
import { ROLES } from "@/lib/constants";
import { getBusinessDateIso } from "@/lib/reporting";
import { buildOnlineSaleEntries, isoToSaleDate } from "@/lib/online-sales";
import { saveOnlineSalesSchema } from "@/lib/validation/onlineSales";
import type { OnlineSaleCategory } from "@/types";

export interface SaveOnlineSalesState {
  error?: string;
  success?: string;
  /** Set to a fresh value (Date.now()) on every successful save — lets
   * OnlineSaleEntryForm clear its amount fields via a useEffect keyed on
   * this, which fires even for two consecutive saves whose `success`
   * message text happens to be identical. */
  submissionId?: number;
}

type SaveOnlineSalesInput = z.infer<typeof saveOnlineSalesSchema>;

const CATEGORY_FORM_FIELD: Record<OnlineSaleCategory, keyof Omit<SaveOnlineSalesInput, "saleDate">> = {
  WHOLESALE: "wholesaleAmountCents",
  SUPER_WHOLESALE: "superWholesaleAmountCents",
  RETAIL: "retailAmountCents",
};

/** Records one calendar day's online sales across the three fixed
 * commission categories — one OnlineSale row per category whose amount is
 * greater than zero, a blank/zero category is silently skipped (never an
 * error on its own; only "every category is zero" is rejected). ADMIN-only,
 * independently re-checked here (never trusts the page/layout guard alone
 * — see /admin/online/layout.tsx).
 *
 * CRITICAL — server-authoritative commission: the browser sends only
 * saleDate/amounts. The rate (ONLINE_SALE_CATEGORY_CONFIG) and the
 * resulting commissionCents are both computed HERE, from the canonical
 * server-side config — never accepted as values from the client, so a
 * tampered request can never record a wrong commission. */
export async function saveOnlineSalesAction(_prevState: SaveOnlineSalesState, formData: FormData): Promise<SaveOnlineSalesState> {
  const admin = await requireRole([ROLES.ADMIN]);

  const parsed = saveOnlineSalesSchema.safeParse({
    saleDate: formData.get("saleDate")?.toString() ?? "",
    wholesaleAmountCents: formData.get("wholesaleAmountCents")?.toString(),
    superWholesaleAmountCents: formData.get("superWholesaleAmountCents")?.toString(),
    retailAmountCents: formData.get("retailAmountCents")?.toString(),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة" };
  }

  // String comparison is safe and exact for "YYYY-MM-DD" — the same
  // lexicographic-equals-chronological technique already relied on for
  // fromIso/toIso report-range comparisons elsewhere (src/lib/reporting.ts).
  if (parsed.data.saleDate > getBusinessDateIso()) {
    return { error: "لا يمكن تسجيل مبيعات بتاريخ مستقبلي." };
  }

  const amountsCentsByCategory = {
    WHOLESALE: parsed.data[CATEGORY_FORM_FIELD.WHOLESALE],
    SUPER_WHOLESALE: parsed.data[CATEGORY_FORM_FIELD.SUPER_WHOLESALE],
    RETAIL: parsed.data[CATEGORY_FORM_FIELD.RETAIL],
  } as const;

  const entries = buildOnlineSaleEntries(amountsCentsByCategory);
  if (entries.length === 0) {
    return { error: "أدخل مبلغاً واحداً على الأقل أكبر من صفر." };
  }

  const saleDate = isoToSaleDate(parsed.data.saleDate);

  await prisma.onlineSale.createMany({
    data: entries.map((entry) => ({
      saleDate,
      category: entry.category,
      amountCents: entry.amountCents,
      commissionRateBps: entry.commissionRateBps,
      commissionCents: entry.commissionCents,
      createdById: admin.id,
    })),
  });

  revalidatePath("/admin/online");
  return { success: "تم حفظ المبيعات بنجاح.", submissionId: Date.now() };
}

export interface DeleteOnlineSaleResult {
  ok: boolean;
  message: string;
}

/** Removes one ledger row — this is a "delete + re-add" correction model
 * (no soft-cancel/reversal record), deliberately simple because this
 * ledger is independent and currently has no downstream business effects
 * (unlike Order/AccountPayment, which use the richer
 * cancellation/correction infrastructure in src/lib/payment-correction.ts
 * because other data depends on them). ADMIN-only, independently
 * re-checked here. */
export async function deleteOnlineSaleAction(id: string): Promise<DeleteOnlineSaleResult> {
  await requireRole([ROLES.ADMIN]);

  const existing = await prisma.onlineSale.findUnique({ where: { id }, select: { id: true } });
  if (!existing) {
    return { ok: false, message: "لم يتم العثور على هذا القيد." };
  }

  await prisma.onlineSale.delete({ where: { id: existing.id } });

  revalidatePath("/admin/online");
  return { ok: true, message: "تم حذف القيد بنجاح." };
}
