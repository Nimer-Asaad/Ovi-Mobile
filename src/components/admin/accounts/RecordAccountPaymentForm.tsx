"use client";

import { useActionState } from "react";
import { recordAccountPayment, type RecordAccountPaymentState } from "@/app/admin/accounts/actions";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { ACCOUNT_PAYMENT_METHODS } from "@/lib/constants";
import { getAccountPaymentMethodLabel } from "@/lib/account-labels";

const initialState: RecordAccountPaymentState = {};

interface RecordAccountPaymentFormProps {
  accountId: string;
}

/** Routine, additive action (a new ledger row, nothing destructive) — a
 * plain useActionState form is enough, matching PaymentStatusForm's
 * directness rather than the confirm-dialog treatment reserved for
 * destructive actions like ProductRemovalControl. */
export function RecordAccountPaymentForm({ accountId }: RecordAccountPaymentFormProps) {
  const [state, formAction, isPending] = useActionState(recordAccountPayment, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="accountId" value={accountId} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Input name="amountCents" type="number" min={0.01} step="0.01" label="مبلغ الدفعة" required />
        <Select name="method" label="طريقة الدفع" defaultValue={ACCOUNT_PAYMENT_METHODS.CASH}>
          {Object.values(ACCOUNT_PAYMENT_METHODS).map((value) => (
            <option key={value} value={value}>
              {getAccountPaymentMethodLabel(value)}
            </option>
          ))}
        </Select>
      </div>
      <Textarea name="note" label="ملاحظة (اختياري)" />

      <Button type="submit" disabled={isPending} className="self-start">
        {isPending && <Spinner />}
        {isPending ? "جارٍ التسجيل..." : "تسجيل الدفعة"}
      </Button>

      {state.error && (
        <p className="text-sm text-rose-600" role="alert">
          {state.error}
        </p>
      )}
      {state.success && (
        <p className="text-sm text-emerald-600" role="status">
          {state.success}
        </p>
      )}
    </form>
  );
}
