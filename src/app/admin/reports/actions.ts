"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth/guards";
import { ROLES, ACCOUNT_PAYMENT_ORIGINS } from "@/lib/constants";
import { correctSale } from "@/lib/sale-correction";
import { cancelManualPayment } from "@/lib/payment-correction";
import { recordManualAccountPayment } from "@/lib/accounts";
import { recordReplacementPaymentSchema } from "@/lib/validation/accounts";

export interface AdminCorrectionState {
  error?: string;
  success?: string;
}

/** Company-wide sale correction — ADMIN and ADMIN_ASSISTANT both eligible
 * (explicitly approved), company-wide (no ownership check needed the way
 * REP's own wrapper — correctRepSaleAction in src/app/rep/sales/actions.ts
 * — needs one). Deliberately lives here, NOT in src/app/admin/orders/actions.ts
 * or anywhere under /admin/accounts/**, so granting ADMIN_ASSISTANT this one
 * correction action never touches — and never risks weakening —
 * /admin/accounts/layout.tsx's own ADMIN-only gate or the general
 * updateOrderStatus admin screen, which both stay exactly as they were. */
export async function correctSaleAction(_prevState: AdminCorrectionState, formData: FormData): Promise<AdminCorrectionState> {
  const actor = await requireRole([ROLES.ADMIN, ROLES.ADMIN_ASSISTANT]);
  const orderNumber = formData.get("orderNumber")?.toString();
  const reason = formData.get("reason")?.toString() ?? "";
  if (!orderNumber) {
    return { error: "الطلب غير موجود" };
  }

  const result = await correctSale({ orderNumber, reason, actorUserId: actor.id });
  if (!result.ok) {
    return { error: result.message };
  }

  revalidatePath("/admin/reports");
  return { success: "تم تصحيح المبيعة بنجاح" };
}

/** Company-wide MANUAL payment cancellation — ADMIN and ADMIN_ASSISTANT
 * both eligible (explicitly approved), no ownership check (unlike REP's
 * own cancelRepManualPaymentAction). SALE_INITIAL and legacy
 * (origin === null) payments are still rejected — cancelManualPayment
 * itself enforces that, not this wrapper — see its own doc comment in
 * src/lib/payment-correction.ts. */
export async function cancelManualPaymentAction(_prevState: AdminCorrectionState, formData: FormData): Promise<AdminCorrectionState> {
  const actor = await requireRole([ROLES.ADMIN, ROLES.ADMIN_ASSISTANT]);
  const paymentId = formData.get("paymentId")?.toString();
  const reason = formData.get("reason")?.toString() ?? "";
  if (!paymentId) {
    return { error: "الدفعة غير موجودة" };
  }

  const result = await cancelManualPayment({ paymentId, reason, actorUserId: actor.id });
  if (!result.ok) {
    return { error: result.message };
  }

  revalidatePath("/admin/reports");
  return { success: "تم إلغاء الدفعة بنجاح" };
}

export interface AdminReportPaymentCreateState {
  error?: string;
}

/** The ADMIN_ASSISTANT-eligible replacement-payment entry point — reached
 * only via "تسجيل دفعة صحيحة" after successfully cancelling a MANUAL
 * payment. Deliberately narrow and correction-scoped, NOT a general
 * "record any payment for any account" surface: `replacementFor` (the
 * cancelled payment's own id) is the only thing this action trusts from
 * the client — `accountId` is never read from form data at all, it is
 * always re-derived here, server-side, from that original payment's own
 * `accountId`, so ADMIN_ASSISTANT can never redirect the payment to a
 * different account by tampering the form.
 *
 * Full eligibility re-check at submission time, independent of whatever
 * the page already showed:
 *   1. the original payment exists
 *   2. origin === MANUAL (never SALE_INITIAL, never legacy/null)
 *   3. it has actually been cancelled (cancellation !== null)
 *   4. it does not already have a replacement (correctedBy === null —
 *      correctsPaymentId is @unique, the DB-level backstop for this same
 *      guarantee against a concurrent double-submit)
 *
 * Reuses the exact same canonical recordManualAccountPayment core
 * (src/lib/accounts.ts) that recordAccountPayment (ADMIN, /admin/accounts)
 * and recordMerchantPaymentAsRep (REP) both call — receipt numbering /
 * origin tagging / account balance semantics can never drift between the
 * three entry points. Does NOT open /admin/accounts/** (that stays
 * ADMIN-only via its own layout.tsx, unchanged) — ADMIN keeps using that
 * route for ordinary standalone payments; this route is deliberately
 * correction-specific for BOTH roles, the smallest architecture that still
 * fully protects ADMIN_ASSISTANT. */
export async function createReplacementPaymentAction(
  _prevState: AdminReportPaymentCreateState,
  formData: FormData,
): Promise<AdminReportPaymentCreateState> {
  const actor = await requireRole([ROLES.ADMIN, ROLES.ADMIN_ASSISTANT]);

  const replacementFor = formData.get("replacementFor")?.toString();
  if (!replacementFor) {
    return { error: "لا يمكن تسجيل دفعة بدون سياق تصحيح صالح" };
  }

  const original = await prisma.accountPayment.findUnique({
    where: { id: replacementFor },
    select: {
      id: true,
      accountId: true,
      origin: true,
      cancellation: { select: { id: true } },
      correctedBy: { select: { id: true } },
    },
  });
  if (!original) {
    return { error: "الدفعة الأصلية غير موجودة" };
  }
  if (original.origin !== ACCOUNT_PAYMENT_ORIGINS.MANUAL) {
    return { error: "لا يمكن تسجيل دفعة تصحيحية لهذا النوع من الدفعات" };
  }
  if (!original.cancellation) {
    return { error: "يجب إلغاء الدفعة الأصلية أولاً قبل تسجيل دفعة تصحيحية" };
  }
  if (original.correctedBy) {
    return { error: "تم بالفعل تسجيل دفعة تصحيحية لهذه الدفعة" };
  }

  const parsed = recordReplacementPaymentSchema.safeParse({
    amountCents: formData.get("amountCents")?.toString() ?? "",
    method: formData.get("method")?.toString() ?? "",
    note: formData.get("note")?.toString().trim() || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات الدفعة غير صالحة" };
  }

  let paymentId: string;
  try {
    const payment = await prisma.$transaction((tx) =>
      recordManualAccountPayment(tx, original.accountId, parsed.data.amountCents, actor.id, {
        method: parsed.data.method,
        note: parsed.data.note,
        correctsPaymentId: original.id,
      }),
    );
    paymentId = payment.id;
  } catch (error) {
    if (isCorrectsPaymentUniqueError(error)) {
      return { error: "تم بالفعل تسجيل دفعة تصحيحية لهذه الدفعة" };
    }
    throw error;
  }

  revalidatePath("/admin/reports");
  redirect(`/admin/reports/payments/${paymentId}`);
}

function isCorrectsPaymentUniqueError(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") return false;
  const target = error.meta?.target;
  return Array.isArray(target) ? target.includes("correctsPaymentId") : String(target ?? "").includes("correctsPaymentId");
}
