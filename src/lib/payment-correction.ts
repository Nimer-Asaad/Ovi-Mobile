import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ACCOUNT_PAYMENT_ORIGINS } from "@/lib/constants";

export type PaymentCorrectionErrorCode =
  | "PAYMENT_NOT_FOUND"
  | "MISSING_REASON"
  | "SALE_INITIAL_ORIGIN"
  | "LEGACY_UNKNOWN_ORIGIN"
  | "ALREADY_CANCELLED"
  | "FORBIDDEN";

export type PaymentCorrectionResult =
  | { ok: true; paymentId: string }
  | { ok: false; code: PaymentCorrectionErrorCode; message: string };

function isCancellationUniqueError(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") return false;
  const target = error.meta?.target;
  return Array.isArray(target) ? target.includes("paymentId") : String(target ?? "").includes("paymentId");
}

interface CancelManualPaymentInput {
  paymentId: string;
  reason: string;
  actorUserId: string;
  /** Server-side REP ownership scope — when set, the payment's own
   * createdById must equal this id or the cancellation is rejected. Used
   * by the REP-facing wrapper action only; omitted (undefined) for
   * ADMIN/ADMIN_ASSISTANT's already-approved company-wide scope. Never
   * trust a client-provided id for this — always the authenticated actor's
   * own id, resolved server-side by the caller before this is invoked. */
  requireCreatedById?: string;
}

/** Safely cancels/reverses a wrong MANUAL payment — "تصحيح / إلغاء الدفعة"
 * in the UI, but never an in-place edit. The original AccountPayment row
 * (amountCents/method/note/receiptNumber/createdAt) is NEVER mutated; this
 * only ever inserts one AccountPaymentCancellation row, whose @unique
 * paymentId is both the eligibility check's data source (a second attempt
 * sees `cancellation` already set) and the DB-level "at most once"
 * concurrency backstop for two simultaneous clicks (the loser's insert
 * fails with P2002, caught below and reported as ALREADY_CANCELLED — never
 * relying on button-disabling alone).
 *
 * Eligibility is origin-gated, never inferred from note text:
 *   - origin === MANUAL: the only case this ever proceeds.
 *   - origin === SALE_INITIAL: rejected — correcting it means correcting
 *     the sale itself (see src/lib/sale-correction.ts's correctSale, which
 *     cancels the linked payment as part of that one atomic transaction).
 *   - origin === null (legacy, predates the origin column): rejected — its
 *     true origin is genuinely unknown and must never be guessed.
 *
 * Reversing a MANUAL payment's debt effect requires no separate write here
 * beyond the AccountPaymentCancellation insert itself — getAccountBalanceCents
 * (src/lib/accounts.ts) already excludes a cancelled payment's amount from
 * the CURRENT balance by construction, and buildAccountStatementRows
 * (src/lib/account-statement.ts) renders the original payment at its
 * original createdAt (unchanged) plus a new reversal row at
 * cancellation.cancelledAt — never rewriting the original payment's
 * historical previous/after position. */
export async function cancelManualPayment(input: CancelManualPaymentInput): Promise<PaymentCorrectionResult> {
  const reason = input.reason.trim();
  if (!reason) {
    return { ok: false, code: "MISSING_REASON", message: "سبب الإلغاء مطلوب" };
  }

  return prisma.$transaction(async (tx) => {
    const payment = await tx.accountPayment.findUnique({
      where: { id: input.paymentId },
      select: { id: true, createdById: true, origin: true, cancellation: { select: { id: true } } },
    });
    if (!payment) {
      return { ok: false, code: "PAYMENT_NOT_FOUND", message: "الدفعة غير موجودة" } as const;
    }
    if (input.requireCreatedById && payment.createdById !== input.requireCreatedById) {
      return { ok: false, code: "FORBIDDEN", message: "لا يمكنك إلغاء هذه الدفعة" } as const;
    }
    if (payment.cancellation) {
      return { ok: false, code: "ALREADY_CANCELLED", message: "تم إلغاء هذه الدفعة مسبقًا" } as const;
    }
    if (payment.origin === ACCOUNT_PAYMENT_ORIGINS.SALE_INITIAL) {
      return {
        ok: false,
        code: "SALE_INITIAL_ORIGIN",
        message: "هذه الدفعة مرتبطة بمبيعة. يجب تصحيح المبيعة الأصلية.",
      } as const;
    }
    if (payment.origin !== ACCOUNT_PAYMENT_ORIGINS.MANUAL) {
      return {
        ok: false,
        code: "LEGACY_UNKNOWN_ORIGIN",
        message: "دفعة قديمة غير مصنفة المصدر — لا يمكن إلغاؤها تلقائياً بأمان.",
      } as const;
    }

    try {
      await tx.accountPaymentCancellation.create({
        data: { paymentId: payment.id, reason, cancelledById: input.actorUserId },
      });
    } catch (err) {
      if (isCancellationUniqueError(err)) {
        return { ok: false, code: "ALREADY_CANCELLED", message: "تم إلغاء هذه الدفعة مسبقًا" } as const;
      }
      throw err;
    }

    return { ok: true, paymentId: payment.id } as const;
  });
}
