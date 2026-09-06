"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth/guards";
import { ROLES } from "@/lib/constants";
import { hashPassword } from "@/lib/auth/password";
import { generateDailyPaymentReceiptNumber } from "@/lib/payment-number";
import { createWalkInAccountSchema, recordAccountPaymentSchema, setOpeningBalanceSchema } from "@/lib/validation/accounts";

export interface CreateWalkInAccountState {
  error?: string;
  /** Present only when createLogin was checked and account creation
   * succeeded — the admin must copy this now, it's never shown again and
   * never emailed automatically (the admin relays it themselves). */
  generatedCredentials?: { email: string; password: string };
  createdAccountId?: string;
}

export interface RecordAccountPaymentState {
  error?: string;
  success?: string;
}

function revalidateAccountPaths(accountId: string): void {
  revalidatePath("/admin/accounts");
  revalidatePath(`/admin/accounts/${accountId}`);
  revalidatePath(`/admin/accounts/${accountId}/statement`);
  revalidatePath("/admin/orders/new");
}

export async function createWalkInAccount(
  _prevState: CreateWalkInAccountState,
  formData: FormData,
): Promise<CreateWalkInAccountState> {
  await requireRole([ROLES.ADMIN]);

  const parsed = createWalkInAccountSchema.safeParse({
    displayName: formData.get("displayName")?.toString() ?? "",
    phone: formData.get("phone")?.toString() ?? "",
    notes: formData.get("notes")?.toString().trim() || undefined,
    createLogin: formData.get("createLogin")?.toString(),
    email: formData.get("email")?.toString().trim() || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات الحساب غير صالحة" };
  }

  if (parsed.data.createLogin && parsed.data.email) {
    const existingUser = await prisma.user.findUnique({
      where: { email: parsed.data.email },
      select: { id: true },
    });
    if (existingUser) {
      return { error: "البريد الإلكتروني مستخدم بالفعل" };
    }

    // 12 URL-safe characters — generated server-side, never chosen by the
    // admin, shown exactly once in this response and never persisted or
    // logged in plaintext (hashPassword stores only the scrypt hash).
    const generatedPassword = randomBytes(9).toString("base64url");
    const passwordHash = hashPassword(generatedPassword);
    const email = parsed.data.email;

    const account = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          role: ROLES.RETAIL_CUSTOMER,
          name: parsed.data.displayName,
          email,
          phone: parsed.data.phone,
          passwordHash,
        },
      });
      return tx.customerAccount.create({
        data: {
          displayName: parsed.data.displayName,
          phone: parsed.data.phone,
          notes: parsed.data.notes,
          customerId: user.id,
        },
      });
    });

    revalidateAccountPaths(account.id);
    return {
      createdAccountId: account.id,
      generatedCredentials: { email, password: generatedPassword },
    };
  }

  const account = await prisma.customerAccount.create({
    data: {
      displayName: parsed.data.displayName,
      phone: parsed.data.phone,
      notes: parsed.data.notes,
    },
  });

  revalidateAccountPaths(account.id);
  redirect(`/admin/accounts/${account.id}`);
}

/** Append-only — inserts one AccountPayment row and never edits/deletes an
 * existing one. Balance is always recomputed live from the full ledger
 * (src/lib/accounts.ts getAccountBalanceCents), so there's nothing to keep
 * in sync here beyond the insert itself.
 *
 * Redirects straight to that payment's printable receipt ("سند قبض" — see
 * /admin/accounts/[id]/payments/[paymentId]) on success, exactly like
 * createRepSale/createMerchant already redirect to their own result pages —
 * this is a MANUALLY recorded payment, distinct from the "paid now" portion
 * of a sale (recordInitialAccountPayment, called from inside the sale's own
 * transaction), which deliberately keeps redirecting to the sale's invoice
 * instead — never here.
 *
 * The receipt-number generation + the actual insert are wrapped in one
 * interactive $transaction (this create was previously a bare, untransacted
 * call — there was nothing else to keep atomic with it before receiptNumber
 * existed) so the advisory-lock-protected "count today, then insert" critical
 * section in generateDailyPaymentReceiptNumber can never race a concurrent
 * payment. redirect() is deliberately called AFTER that transaction
 * resolves, never inside its callback and never inside a try/catch — Next's
 * redirect() throws a special NEXT_REDIRECT signal that must reach Next's
 * own routing layer unmolested; throwing it inside a Prisma transaction
 * callback would have Prisma treat it as a failed transaction (rolling back
 * and rethrowing a Prisma-wrapped error) instead, silently turning a
 * successful payment into what looks like a crash. This function has no
 * try/catch of its own at all (matching this action's own pre-existing
 * convention — genuine errors were never caught here even before
 * receiptNumber existed), so there is nothing that could swallow it either
 * way. */
export async function recordAccountPayment(
  _prevState: RecordAccountPaymentState,
  formData: FormData,
): Promise<RecordAccountPaymentState> {
  const admin = await requireRole([ROLES.ADMIN]);

  const parsed = recordAccountPaymentSchema.safeParse({
    accountId: formData.get("accountId")?.toString() ?? "",
    amountCents: formData.get("amountCents")?.toString() ?? "",
    method: formData.get("method")?.toString() ?? "",
    note: formData.get("note")?.toString().trim() || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات الدفعة غير صالحة" };
  }

  const account = await prisma.customerAccount.findUnique({
    where: { id: parsed.data.accountId },
    select: { id: true },
  });
  if (!account) {
    return { error: "الحساب غير موجود" };
  }

  const payment = await prisma.$transaction(async (tx) => {
    const receiptNumber = await generateDailyPaymentReceiptNumber(tx);
    return tx.accountPayment.create({
      data: {
        accountId: parsed.data.accountId,
        amountCents: parsed.data.amountCents,
        method: parsed.data.method,
        note: parsed.data.note,
        createdById: admin.id,
        receiptNumber,
      },
      select: { id: true },
    });
  });

  revalidateAccountPaths(parsed.data.accountId);
  redirect(`/admin/accounts/${parsed.data.accountId}/payments/${payment.id}`);
}

export interface SetOpeningBalanceState {
  error?: string;
  success?: string;
}

/** Sets or corrects an account's opening balance — ADMIN-only, independently
 * enforced here (never trusts the page's own guard alone). If one was
 * already set (openingBalanceSetAt !== null), requires the explicit
 * "confirmChange" checkbox before overwriting it — a plain, un-confirmed
 * resubmission is rejected with a clear message, never silently applied.
 * Every set/correction records who did it and when (openingBalanceSetById/
 * openingBalanceSetAt), matching this app's existing "who did this" audit
 * convention elsewhere (StockMovement.createdById, AccountPayment.createdById,
 * etc.) — never settable by anyone but an ADMIN, and never derived from
 * anything the client sends beyond the raw amount itself. */
export async function setAccountOpeningBalance(
  accountId: string,
  _prevState: SetOpeningBalanceState,
  formData: FormData,
): Promise<SetOpeningBalanceState> {
  const admin = await requireRole([ROLES.ADMIN]);

  const account = await prisma.customerAccount.findUnique({
    where: { id: accountId },
    select: { id: true, openingBalanceSetAt: true, merchantId: true },
  });
  if (!account) {
    return { error: "الحساب غير موجود" };
  }

  const parsed = setOpeningBalanceSchema.safeParse({
    openingBalanceCents: formData.get("openingBalanceCents")?.toString(),
    confirmChange: formData.get("confirmChange")?.toString(),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "قيمة غير صالحة" };
  }

  const alreadySet = account.openingBalanceSetAt !== null;
  if (alreadySet && parsed.data.confirmChange !== "on") {
    return { error: "يجب تأكيد أنك تريد تعديل الرصيد الافتتاحي — تعديله سيغيّر مديونية التاجر الحالية" };
  }

  await prisma.customerAccount.update({
    where: { id: accountId },
    data: {
      openingBalanceCents: parsed.data.openingBalanceCents,
      openingBalanceSetAt: new Date(),
      openingBalanceSetById: admin.id,
    },
  });

  revalidateAccountPaths(accountId);
  if (account.merchantId) {
    revalidatePath("/admin/merchants");
    revalidatePath(`/admin/merchants/${account.merchantId}`);
    revalidatePath("/rep/merchants");
    revalidatePath(`/rep/merchants/${account.merchantId}`);
    revalidatePath(`/rep/merchants/${account.merchantId}/statement`);
    revalidatePath("/rep");
  }
  return { success: "تم حفظ الرصيد الافتتاحي بنجاح" };
}
