"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireEffectiveRepresentative } from "@/lib/auth/impersonation";
import { ACCOUNT_PAYMENT_ORIGINS, ADMIN_AUDIT_ACTIONS } from "@/lib/constants";
import { repSaleSchema } from "@/lib/validation/repSale";
import { recordReplacementPaymentSchema } from "@/lib/validation/accounts";
import { createRepSaleCore } from "@/lib/rep-sales";
import { correctSale } from "@/lib/sale-correction";
import { cancelManualPayment } from "@/lib/payment-correction";
import { recordManualAccountPayment } from "@/lib/accounts";

export interface RepSaleState {
  error?: string;
}

const PARSE_ERROR_MESSAGE = "بيانات البيع غير صالحة";

/** Thin wrapper around the shared sale transaction (createRepSaleCore in
 * src/lib/rep-sales.ts) for a rep selling their own car stock: resolves the
 * effective REP scope (the real rep, or the rep an admin is impersonating)
 * via requireEffectiveRepresentative, parses the form, then hands off to
 * the core using that scope's own rep id / car location / acting user id —
 * so a sale created while impersonating is stamped exactly as if the
 * impersonated rep made it themselves. An admin recording a sale on a rep's
 * behalf (createRepSaleForRep in src/app/admin/reps/actions.ts) is a
 * separate, openly-ADMIN-attributed feature and the only other caller of
 * that same core — there is exactly one sale transaction in this
 * codebase. */
export async function createRepSale(_prevState: RepSaleState, formData: FormData): Promise<RepSaleState> {
  const effectiveRep = await requireEffectiveRepresentative();

  let items: unknown;
  try {
    items = JSON.parse(formData.get("items")?.toString() ?? "[]");
  } catch {
    return { error: PARSE_ERROR_MESSAGE };
  }

  const parsed = repSaleSchema.safeParse({
    items,
    customerName: formData.get("customerName")?.toString().trim() ?? "",
    customerPhone: formData.get("customerPhone")?.toString().trim() ?? "",
    city: formData.get("city")?.toString().trim() || undefined,
    address: formData.get("address")?.toString().trim() || undefined,
    notes: formData.get("notes")?.toString().trim() || undefined,
    repCustomerOrderId: formData.get("repCustomerOrderId")?.toString().trim() || null,
    paidNowCents: formData.get("paidNowCents")?.toString() ?? "0",
    paidNowMethod: formData.get("paidNowMethod")?.toString() || undefined,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? PARSE_ERROR_MESSAGE };
  }

  const locationId = effectiveRep.carStockLocationId;
  if (!locationId) {
    return { error: "لم يتم العثور على موقع مخزون المندوب" };
  }

  const result = await createRepSaleCore(parsed.data, {
    salesRepId: effectiveRep.repId,
    carStockLocationId: locationId,
    actorUserId: effectiveRep.actingUserId,
    // Written INSIDE createRepSaleCore's own transaction — the sale and its
    // impersonation audit trail either both commit or both roll back. Never
    // invoked for a genuine REP session (isImpersonating === false), so a
    // real rep's own sale never creates an AdminAuditLog row.
    onOrderCreated: effectiveRep.isImpersonating
      ? async (tx, order) => {
          await tx.adminAuditLog.create({
            data: {
              adminUserId: effectiveRep.realUser.id,
              targetUserId: effectiveRep.actingUserId,
              action: ADMIN_AUDIT_ACTIONS.IMPERSONATED_REP_SALE_CREATED,
              newValue: { salesRepId: effectiveRep.repId, orderId: order.id, orderNumber: order.orderNumber },
            },
          });
        }
      : undefined,
  });

  if (!result.ok) {
    return { error: result.error };
  }

  redirect(`/rep/sales/${result.orderNumber}`);
}

export interface RepCorrectionState {
  error?: string;
  success?: string;
}

/** REP-facing wrapper around correctSale (src/lib/sale-correction.ts) —
 * server-side ownership is verified HERE before ever calling the shared
 * lib function: Order.createdByRepId must equal the effective rep's own id
 * (the real rep, or the rep an admin is impersonating), resolved via
 * requireEffectiveRepresentative, never trusted from the client (a
 * manipulated orderNumber for another rep's sale simply 404s at this
 * check — including when impersonating, since the effective scope is
 * always the impersonated rep's own id, never the real admin's).
 * createdByRepId never changes after a sale is created, so this pre-check
 * (outside correctSale's own transaction) can never race the transition
 * itself. */
export async function correctRepSaleAction(_prevState: RepCorrectionState, formData: FormData): Promise<RepCorrectionState> {
  const effectiveRep = await requireEffectiveRepresentative();
  const orderNumber = formData.get("orderNumber")?.toString();
  const reason = formData.get("reason")?.toString() ?? "";
  if (!orderNumber) {
    return { error: "الطلب غير موجود" };
  }

  const order = await prisma.order.findUnique({ where: { orderNumber }, select: { createdByRepId: true } });
  if (!order || order.createdByRepId !== effectiveRep.repId) {
    return { error: "لا يمكنك تصحيح هذه المبيعة" };
  }

  const result = await correctSale({
    orderNumber,
    reason,
    actorUserId: effectiveRep.actingUserId,
    // Written INSIDE correctSale's own transaction — the correction and its
    // impersonation audit trail either both commit or both roll back. Never
    // invoked for a genuine REP session.
    onCorrected: effectiveRep.isImpersonating
      ? async (tx, correctedOrder) => {
          await tx.adminAuditLog.create({
            data: {
              adminUserId: effectiveRep.realUser.id,
              targetUserId: effectiveRep.actingUserId,
              action: ADMIN_AUDIT_ACTIONS.IMPERSONATED_REP_SALE_CORRECTED,
              newValue: { salesRepId: effectiveRep.repId, orderId: correctedOrder.id, orderNumber: correctedOrder.orderNumber, reason },
            },
          });
        }
      : undefined,
  });
  if (!result.ok) {
    return { error: result.message };
  }

  revalidatePath("/rep/sales");
  return { success: "تم تصحيح المبيعة بنجاح" };
}

/** REP-facing wrapper around cancelManualPayment (src/lib/payment-correction.ts)
 * — passes requireCreatedById: effectiveRep.actingUserId so ownership
 * (AccountPayment.createdById === the effective rep's own user id, never
 * inferred from merchant assignment, and — under impersonation — never the
 * real admin's id) is enforced server-side INSIDE that function's own
 * transaction, not just here. Never authorizes based on a client-supplied
 * id. */
export async function cancelRepManualPaymentAction(_prevState: RepCorrectionState, formData: FormData): Promise<RepCorrectionState> {
  const effectiveRep = await requireEffectiveRepresentative();
  const paymentId = formData.get("paymentId")?.toString();
  const reason = formData.get("reason")?.toString() ?? "";
  if (!paymentId) {
    return { error: "الدفعة غير موجودة" };
  }

  const result = await cancelManualPayment({
    paymentId,
    reason,
    actorUserId: effectiveRep.actingUserId,
    requireCreatedById: effectiveRep.actingUserId,
    // Written INSIDE cancelManualPayment's own transaction — the
    // cancellation and its impersonation audit trail either both commit or
    // both roll back. Never invoked for a genuine REP session.
    onCancelled: effectiveRep.isImpersonating
      ? async (tx, cancelledPayment) => {
          await tx.adminAuditLog.create({
            data: {
              adminUserId: effectiveRep.realUser.id,
              targetUserId: effectiveRep.actingUserId,
              action: ADMIN_AUDIT_ACTIONS.IMPERSONATED_REP_PAYMENT_CANCELLED,
              newValue: {
                salesRepId: effectiveRep.repId,
                paymentId: cancelledPayment.id,
                receiptNumber: cancelledPayment.receiptNumber,
                reason,
              },
            },
          });
        }
      : undefined,
  });
  if (!result.ok) {
    return { error: result.message };
  }

  revalidatePath("/rep/sales");
  return { success: "تم إلغاء الدفعة بنجاح" };
}

export interface RepReplacementPaymentState {
  error?: string;
}

function isCorrectsPaymentUniqueError(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") return false;
  const target = error.meta?.target;
  return Array.isArray(target) ? target.includes("correctsPaymentId") : String(target ?? "").includes("correctsPaymentId");
}

/** The REP-facing replacement-payment entry point — reached only via
 * "تسجيل دفعة صحيحة" after successfully cancelling one of THIS rep's own
 * MANUAL payments (/rep/sales/payments/new?replacementFor=<id>). Never a
 * general "record any payment for any merchant" surface — `accountId` is
 * never read from form data at all; it is always re-derived here,
 * server-side, from the original payment's own `accountId`.
 *
 * Ownership is based on AccountPayment.createdById — the persisted actual
 * collector — NEVER on whether the merchant is still currently assigned to
 * this rep (assignment can change after the fact; the historical-owner
 * rule stays fixed). This is deliberately a different, narrower check than
 * recordMerchantPaymentAsRep's own assignedRepId check, and is why this
 * lives as its own action rather than reusing that one.
 *
 * Full eligibility re-check at submission time, independent of whatever
 * the page already showed:
 *   1. the original payment exists
 *   2. original.createdById === this authenticated rep's own user id
 *   3. origin === MANUAL (never SALE_INITIAL, never legacy/null)
 *   4. it has actually been cancelled (cancellation !== null)
 *   5. it does not already have a replacement (correctedBy === null —
 *      correctsPaymentId is @unique, the DB-level backstop for this same
 *      guarantee against a concurrent double-submit, from either this
 *      action or the ADMIN/ADMIN_ASSISTANT one)
 *
 * Reuses the exact same canonical recordManualAccountPayment core
 * (src/lib/accounts.ts) that recordAccountPayment (ADMIN),
 * recordMerchantPaymentAsRep (REP's own ordinary payment form), and
 * createReplacementPaymentAction (ADMIN/ADMIN_ASSISTANT's own replacement
 * flow) all call — receipt numbering / origin tagging / account balance
 * semantics can never drift between any of them. */
export async function createRepReplacementPaymentAction(
  _prevState: RepReplacementPaymentState,
  formData: FormData,
): Promise<RepReplacementPaymentState> {
  const effectiveRep = await requireEffectiveRepresentative();

  const replacementFor = formData.get("replacementFor")?.toString();
  if (!replacementFor) {
    return { error: "لا يمكن تسجيل دفعة بدون سياق تصحيح صالح" };
  }

  const original = await prisma.accountPayment.findUnique({
    where: { id: replacementFor },
    select: {
      id: true,
      accountId: true,
      createdById: true,
      origin: true,
      cancellation: { select: { id: true } },
      correctedBy: { select: { id: true } },
    },
  });
  if (!original) {
    return { error: "الدفعة الأصلية غير موجودة" };
  }
  if (original.createdById !== effectiveRep.actingUserId) {
    return { error: "لا يمكنك تصحيح هذه الدفعة" };
  }
  if (original.origin === ACCOUNT_PAYMENT_ORIGINS.SALE_INITIAL) {
    return { error: "هذه الدفعة مرتبطة بمبيعة. يجب تصحيح المبيعة الأصلية." };
  }
  if (original.origin !== ACCOUNT_PAYMENT_ORIGINS.MANUAL) {
    return { error: "دفعة قديمة غير مصنفة المصدر — لا يمكن إلغاؤها أو تصحيحها تلقائياً بأمان." };
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
    const payment = await prisma.$transaction(async (tx) => {
      const created = await recordManualAccountPayment(tx, original.accountId, parsed.data.amountCents, effectiveRep.actingUserId, {
        method: parsed.data.method,
        note: parsed.data.note,
        correctsPaymentId: original.id,
      });

      // Written INSIDE the same transaction as the replacement payment
      // itself — either both commit or both roll back. Never written for a
      // genuine REP session.
      if (effectiveRep.isImpersonating) {
        await tx.adminAuditLog.create({
          data: {
            adminUserId: effectiveRep.realUser.id,
            targetUserId: effectiveRep.actingUserId,
            action: ADMIN_AUDIT_ACTIONS.IMPERSONATED_REP_PAYMENT_REPLACED,
            newValue: {
              salesRepId: effectiveRep.repId,
              originalPaymentId: original.id,
              replacementPaymentId: created.id,
              receiptNumber: created.receiptNumber,
            },
          },
        });
      }

      return created;
    });
    paymentId = payment.id;
  } catch (error) {
    if (isCorrectsPaymentUniqueError(error)) {
      return { error: "تم بالفعل تسجيل دفعة تصحيحية لهذه الدفعة" };
    }
    throw error;
  }

  revalidatePath("/rep/sales");
  redirect(`/rep/sales/payments/${paymentId}`);
}
