"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth/guards";
import { ROLES } from "@/lib/constants";
import { recordManualAccountPayment } from "@/lib/accounts";
import { recordAccountPaymentSchema } from "@/lib/validation/accounts";

export interface RecordMerchantPaymentState {
  error?: string;
  success?: string;
}

/** Rep-authorized payment recording — the rep-side counterpart to
 * recordAccountPayment in src/app/admin/accounts/actions.ts, reusing the
 * exact same AccountPayment model and recordAccountPaymentSchema (never a
 * second accounting system, per the explicit "reuse existing accounting
 * logic" requirement).
 *
 * The one thing that differs from the admin action: this one independently
 * re-verifies the target merchant is actually assigned to the calling rep
 * (Merchant.assignedRepId) BEFORE writing anything — `merchantId` is the
 * route's own bound argument (see RecordMerchantPaymentForm), never trusted
 * from arbitrary client input, but even so this re-derives the account id
 * itself from a server-side, ownership-scoped query rather than accepting
 * one from the form — a rep can never record a payment against another
 * rep's merchant, or any account with no merchant at all, no matter what a
 * manipulated request sends. createdById is always the authenticated rep's
 * own User.id — never taken from the client, matching the exact same
 * "who actually did this" convention already used by
 * createRepSale/assignStockToRep/returnStockFromRep.
 *
 * Redirects straight to that payment's printable receipt ("سند قبض" — see
 * /rep/merchants/[id]/payments/[paymentId]) on success, exactly like
 * createRepSale already redirects to its own result page — this is a
 * MANUALLY recorded payment, distinct from the "paid now" portion of a
 * sale (recordInitialAccountPayment, called from inside createRepSaleCore's
 * own transaction), which deliberately keeps redirecting to the sale's
 * invoice instead — never here.
 *
 * The receipt-number generation + the actual insert are wrapped in one
 * interactive $transaction (this create was previously a bare, untransacted
 * call) so the advisory-lock-protected "count today, then insert" critical
 * section in generateDailyPaymentReceiptNumber can never race a concurrent
 * payment. redirect() is deliberately called AFTER that transaction
 * resolves and after every revalidatePath call, never inside the
 * transaction's callback and never inside a try/catch — see
 * recordAccountPayment's identical doc comment in
 * src/app/admin/accounts/actions.ts for exactly why: Next's redirect()
 * throws a special NEXT_REDIRECT signal that must reach Next's own routing
 * layer unmolested, and this function has no try/catch of its own to
 * accidentally swallow it either way. */
export async function recordMerchantPaymentAsRep(
  merchantId: string,
  _prevState: RecordMerchantPaymentState,
  formData: FormData,
): Promise<RecordMerchantPaymentState> {
  const user = await requireRole([ROLES.SALES_REPRESENTATIVE]);

  const rep = await prisma.salesRepresentative.findUnique({
    where: { userId: user.id },
    select: { id: true },
  });
  if (!rep) {
    return { error: "لم يتم العثور على بيانات المندوب" };
  }

  const merchant = await prisma.merchant.findFirst({
    where: { id: merchantId, assignedRepId: rep.id },
    select: { account: { select: { id: true } } },
  });
  if (!merchant) {
    return { error: "هذا التاجر غير معيّن لك" };
  }
  if (!merchant.account) {
    return { error: "لا يوجد حساب دين لهذا التاجر بعد" };
  }
  const accountId = merchant.account.id;

  const parsed = recordAccountPaymentSchema.safeParse({
    accountId,
    amountCents: formData.get("amountCents")?.toString() ?? "",
    method: formData.get("method")?.toString() ?? "",
    note: formData.get("note")?.toString().trim() || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات الدفعة غير صالحة" };
  }

  const payment = await prisma.$transaction((tx) =>
    recordManualAccountPayment(tx, accountId, parsed.data.amountCents, user.id, {
      method: parsed.data.method,
      note: parsed.data.note,
    }),
  );

  revalidatePath("/rep/merchants");
  revalidatePath(`/rep/merchants/${merchantId}`);
  revalidatePath(`/rep/merchants/${merchantId}/statement`);
  revalidatePath("/rep");
  revalidatePath("/admin/accounts");
  revalidatePath(`/admin/accounts/${accountId}`);
  revalidatePath(`/admin/accounts/${accountId}/statement`);
  revalidatePath("/admin/merchants");
  revalidatePath(`/admin/merchants/${merchantId}`);

  redirect(`/rep/merchants/${merchantId}/payments/${payment.id}`);
}
