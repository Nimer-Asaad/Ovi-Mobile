"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth/guards";
import { ROLES } from "@/lib/constants";
import { createWalkInAccountSchema, recordAccountPaymentSchema } from "@/lib/validation/accounts";

export interface CreateWalkInAccountState {
  error?: string;
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
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات الحساب غير صالحة" };
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
 * in sync here beyond the insert itself. */
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

  await prisma.accountPayment.create({
    data: {
      accountId: parsed.data.accountId,
      amountCents: parsed.data.amountCents,
      method: parsed.data.method,
      note: parsed.data.note,
      createdById: admin.id,
    },
  });

  revalidateAccountPaths(parsed.data.accountId);
  return { success: "تم تسجيل الدفعة بنجاح" };
}
