"use client";

import { useActionState, useState } from "react";
import { reverseSalesReturnAction, type SalesReturnReversalState } from "@/app/admin/orders/actions";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Textarea";
import { Spinner } from "@/components/ui/Spinner";

const initialState: SalesReturnReversalState = {};

/** ADMIN-only "إلغاء مردود المبيعات" control for ONE active SalesReturn —
 * collapsed to a single button until clicked, then expands to a mandatory
 * reason + confirm/cancel, matching this app's existing correction-action
 * pattern (see CorrectionDialog.tsx). Never rendered for a REP or for an
 * already-reversed return — the caller (SalesReturnHistoryCard) decides
 * that; this component only handles the confirm/submit interaction. */
export function SalesReturnReversalControl({ salesReturnId, orderNumber, reference }: { salesReturnId: string; orderNumber: string; reference: string }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, isPending] = useActionState(reverseSalesReturnAction, initialState);

  if (!open) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        إلغاء مردود المبيعات
      </Button>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-2 rounded-card border border-rose-500/30 bg-rose-500/5 p-3">
      <input type="hidden" name="salesReturnId" value={salesReturnId} />
      <input type="hidden" name="orderNumber" value={orderNumber} />
      <p className="text-sm font-medium text-rose-300">تأكيد إلغاء مردود المبيعات {reference}</p>
      <p className="text-xs text-neutral-bg/60">
        سيُعاد احتساب ذمة التاجر بإضافة قيمة المردود، وستُخصم نفس الكمية الفعلية من مخزون سيارة المندوب الحالي. لا يمكن التراجع عن هذا الإلغاء.
      </p>
      <Textarea name="reason" label="سبب الإلغاء (إلزامي)" placeholder="مثال: المندوب أنشأ المردود بالخطأ بسبب ظهور التاجر الخطأ" required rows={2} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="outline" size="sm" disabled={isPending} className="border-rose-500/50 text-rose-300 hover:bg-rose-500/10">
          {isPending && <Spinner />}
          {isPending ? "جارٍ الإلغاء..." : "تأكيد الإلغاء"}
        </Button>
        <Button type="button" variant="ghost" size="sm" disabled={isPending} onClick={() => setOpen(false)}>
          تراجع
        </Button>
      </div>
      {state.error && (
        <p className="text-sm text-rose-400" role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}
