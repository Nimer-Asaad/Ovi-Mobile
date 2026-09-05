"use client";

import { useActionState } from "react";
import { recordMerchantPaymentAsRep, type RecordMerchantPaymentState } from "@/app/rep/merchants/actions";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { ACCOUNT_PAYMENT_METHODS } from "@/lib/constants";
import { getAccountPaymentMethodLabel } from "@/lib/account-labels";

const initialState: RecordMerchantPaymentState = {};

/** Rep-facing payment entry — same routine, additive, non-destructive
 * treatment as RecordAccountPaymentForm (admin's own version of this exact
 * form): a plain useActionState form, no confirm dialog. `merchantId` is
 * bound into the server action here (recordMerchantPaymentAsRep re-derives
 * and re-verifies the account itself server-side — this component never
 * passes an accountId at all). */
export function RecordMerchantPaymentForm({ merchantId }: { merchantId: string }) {
  const action = recordMerchantPaymentAsRep.bind(null, merchantId);
  const [state, formAction, isPending] = useActionState(action, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-3">
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
        <p className="text-sm text-rose-400" role="alert">
          {state.error}
        </p>
      )}
      {state.success && (
        <p className="text-sm text-emerald-400" role="status">
          {state.success}
        </p>
      )}
    </form>
  );
}
