"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth/guards";
import { ROLES, ACCOUNT_PAYMENT_ORIGINS } from "@/lib/constants";
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
 * src/lib/rep-sales.ts) for a rep selling their own car stock: authorizes
 * SALES_REPRESENTATIVE, resolves "my own rep row + my own car location"
 * from the session, parses the form, then hands off to the core. An admin
 * recording a sale on a rep's behalf (createRepSaleForRep in
 * src/app/admin/reps/actions.ts) is the only other caller of that same
 * core — there is exactly one sale transaction in this codebase. */
export async function createRepSale(_prevState: RepSaleState, formData: FormData): Promise<RepSaleState> {
  const user = await requireRole([ROLES.SALES_REPRESENTATIVE]);

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

  const rep = await prisma.salesRepresentative.findUnique({
    where: { userId: user.id },
    select: { id: true, carStockLocation: { select: { id: true } } },
  });
  if (!rep) {
    return { error: "لم يتم العثور على ملف المندوب" };
  }

  const locationId = rep.carStockLocation?.id ?? null;
  if (!locationId) {
    return { error: "لم يتم العثور على موقع مخزون المندوب" };
  }

  const result = await createRepSaleCore(parsed.data, {
    salesRepId: rep.id,
    carStockLocationId: locationId,
    actorUserId: user.id,
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
 * lib function: Order.createdByRepId must equal this rep's own id,
 * resolved from the authenticated session, never trusted from the client
 * (a manipulated orderNumber for another rep's sale simply 404s at this
 * check). createdByRepId never changes after a sale is created, so this
 * pre-check (outside correctSale's own transaction) can never race the
 * transition itself. */
export async function correctRepSaleAction(_prevState: RepCorrectionState, formData: FormData): Promise<RepCorrectionState> {
  const user = await requireRole([ROLES.SALES_REPRESENTATIVE]);
  const orderNumber = formData.get("orderNumber")?.toString();
  const reason = formData.get("reason")?.toString() ?? "";
  if (!orderNumber) {
    return { error: "الطلب غير موجود" };
  }

  const rep = await prisma.salesRepresentative.findUnique({ where: { userId: user.id }, select: { id: true } });
  if (!rep) {
    return { error: "لم يتم العثور على ملف المندوب" };
  }

  const order = await prisma.order.findUnique({ where: { orderNumber }, select: { createdByRepId: true } });
  if (!order || order.createdByRepId !== rep.id) {
    return { error: "لا يمكنك تصحيح هذه المبيعة" };
  }

  const result = await correctSale({ orderNumber, reason, actorUserId: user.id });
  if (!result.ok) {
    return { error: result.message };
  }

  revalidatePath("/rep/sales");
  return { success: "تم تصحيح المبيعة بنجاح" };
}

/** REP-facing wrapper around cancelManualPayment (src/lib/payment-correction.ts)
 * — passes requireCreatedById: user.id so ownership (AccountPayment.createdById
 * === this authenticated user, never inferred from merchant assignment) is
 * enforced server-side INSIDE that function's own transaction, not just
 * here. Never authorizes based on a client-supplied id. */
export async function cancelRepManualPaymentAction(_prevState: RepCorrectionState, formData: FormData): Promise<RepCorrectionState> {
  const user = await requireRole([ROLES.SALES_REPRESENTATIVE]);
  const paymentId = formData.get("paymentId")?.toString();
  const reason = formData.get("reason")?.toString() ?? "";
  if (!paymentId) {
    return { error: "الدفعة غير موجودة" };
  }

  const result = await cancelManualPayment({ paymentId, reason, actorUserId: user.id, requireCreatedById: user.id });
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
  const user = await requireRole([ROLES.SALES_REPRESENTATIVE]);

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
  if (original.createdById !== user.id) {
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
    const payment = await prisma.$transaction((tx) =>
      recordManualAccountPayment(tx, original.accountId, parsed.data.amountCents, user.id, {
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

  revalidatePath("/rep/sales");
  redirect(`/rep/sales/payments/${paymentId}`);
}
