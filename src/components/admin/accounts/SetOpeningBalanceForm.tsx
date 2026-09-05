"use client";

import { useActionState, useState } from "react";
import { setAccountOpeningBalance, type SetOpeningBalanceState } from "@/app/admin/accounts/actions";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { formatCurrencyFromCents } from "@/lib/utils";

const initialState: SetOpeningBalanceState = {};

export interface SetOpeningBalanceFormProps {
  accountId: string;
  currentOpeningBalanceCents: number;
  setByName: string | null;
  setAt: Date | null;
}

/** ADMIN-only opening-balance editor — src/app/admin/accounts/actions.ts's
 * setAccountOpeningBalance independently re-enforces the ADMIN role and the
 * confirm-before-changing rule server-side; this component only mirrors
 * that rule in the UI (disabling the submit button until the checkbox is
 * checked) so a correction can never be submitted by mistake with one
 * click. Once set, the current value/who/when are always shown above the
 * form — never a silently-editable naked number. */
export function SetOpeningBalanceForm({ accountId, currentOpeningBalanceCents, setByName, setAt }: SetOpeningBalanceFormProps) {
  const action = setAccountOpeningBalance.bind(null, accountId);
  const [state, formAction, isPending] = useActionState(action, initialState);
  const alreadySet = setAt !== null;
  const [confirmChecked, setConfirmChecked] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      {alreadySet ? (
        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-neutral-bg/50">الرصيد الافتتاحي الحالي</dt>
            <dd className="font-semibold text-neutral-bg">{formatCurrencyFromCents(currentOpeningBalanceCents)}</dd>
          </div>
          <div>
            <dt className="text-neutral-bg/50">من قام بإدخاله</dt>
            <dd className="text-neutral-bg">{setByName ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-neutral-bg/50">تاريخ الإدخال</dt>
            <dd className="text-neutral-bg">{setAt ? new Date(setAt).toLocaleDateString("ar") : "—"}</dd>
          </div>
        </dl>
      ) : (
        <p className="text-sm text-neutral-bg/60">لم يتم تحديد رصيد افتتاحي لهذا الحساب بعد — القيمة الافتراضية 0.</p>
      )}

      <form action={formAction} className="flex flex-col gap-3">
        <Input
          name="openingBalanceCents"
          type="number"
          min={0}
          step="0.01"
          label={alreadySet ? "تعديل الرصيد الافتتاحي" : "الرصيد الافتتاحي"}
          placeholder="0"
          className="max-w-xs"
        />
        {alreadySet && (
          <label className="flex items-start gap-2 text-sm text-amber-300">
            <input
              type="checkbox"
              name="confirmChange"
              checked={confirmChecked}
              onChange={(event) => setConfirmChecked(event.target.checked)}
              className="mt-0.5 h-4 w-4"
            />
            <span>تعديل الرصيد الافتتاحي سيغيّر مديونية التاجر الحالية.</span>
          </label>
        )}

        <Button type="submit" disabled={isPending || (alreadySet && !confirmChecked)} className="self-start">
          {isPending && <Spinner />}
          {isPending ? "جارٍ الحفظ..." : alreadySet ? "حفظ التعديل" : "حفظ الرصيد الافتتاحي"}
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
    </div>
  );
}
