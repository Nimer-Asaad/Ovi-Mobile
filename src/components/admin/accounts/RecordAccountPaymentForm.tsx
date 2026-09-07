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
  /** Trusted only by the original ADMIN-only recordAccountPayment
   * (/admin/accounts/[id]) — that action reads this hidden field directly.
   * Omit when passing `replacementFor` instead: createReplacementPaymentAction
   * never reads/trusts an accountId form field at all — it re-derives the
   * account server-side from the original payment being corrected. */
  accountId?: string;
  /** The cancelled payment this new one corrects — renders a
   * `replacementFor` hidden field instead of `accountId`. Only meaningful
   * together with createReplacementPaymentAction as `action` below. */
  replacementFor?: string;
  /** Defaults to the original ADMIN-only recordAccountPayment
   * (/admin/accounts/[id]) — unchanged behavior for that existing call
   * site. The report-scoped replacement-payment page
   * (/admin/reports/payments/new) passes createReplacementPaymentAction
   * instead (ADMIN + ADMIN_ASSISTANT), so ADMIN_ASSISTANT gets a working
   * "تسجيل دفعة صحيحة" route without this form's markup/inputs ever being
   * duplicated. Both actions call the same recordManualAccountPayment core
   * (src/lib/accounts.ts) — only the role guard, accountId derivation, and
   * redirect target differ. */
  action?: (state: RecordAccountPaymentState, formData: FormData) => Promise<RecordAccountPaymentState>;
}

/** Routine, additive action (a new ledger row, nothing destructive) — a
 * plain useActionState form is enough, matching PaymentStatusForm's
 * directness rather than the confirm-dialog treatment reserved for
 * destructive actions like ProductRemovalControl. */
export function RecordAccountPaymentForm({ accountId, replacementFor, action = recordAccountPayment }: RecordAccountPaymentFormProps) {
  const [state, formAction, isPending] = useActionState(action, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      {accountId && <input type="hidden" name="accountId" value={accountId} />}
      {replacementFor && <input type="hidden" name="replacementFor" value={replacementFor} />}
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
