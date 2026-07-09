"use client";

import { useActionState } from "react";
import { updatePaymentStatus, type OrderActionState } from "./actions";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { PAYMENT_STATUSES } from "@/lib/constants";
import { getPaymentStatusLabel } from "@/lib/order-labels";

const initialState: OrderActionState = {};

interface PaymentStatusFormProps {
  orderNumber: string;
  currentStatus: string;
}

export function PaymentStatusForm({ orderNumber, currentStatus }: PaymentStatusFormProps) {
  const action = updatePaymentStatus.bind(null, orderNumber);
  const [state, formAction, isPending] = useActionState(action, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-3">
        <Select key={currentStatus} name="paymentStatus" label="حالة الدفع" defaultValue={currentStatus}>
          {Object.values(PAYMENT_STATUSES).map((value) => (
            <option key={value} value={value}>
              {getPaymentStatusLabel(value)}
            </option>
          ))}
        </Select>
        <Button type="submit" size="sm" variant="outline" disabled={isPending}>
          {isPending ? "جارٍ التحديث..." : "تحديث حالة الدفع"}
        </Button>
      </div>
      {state.error && (
        <p className="text-xs text-rose-400" role="alert">
          {state.error}
        </p>
      )}
      {state.success && <p className="text-xs text-emerald-400">تم تحديث حالة الدفع</p>}
    </form>
  );
}
