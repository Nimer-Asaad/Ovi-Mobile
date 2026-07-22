"use client";

import { useActionState, useState } from "react";
import { updateOrderStatus, type OrderActionState } from "./actions";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { ORDER_STATUSES, PAYMENT_STATUSES } from "@/lib/constants";
import { getOrderStatusLabel } from "@/lib/order-labels";
import type { OrderStatus } from "@/types";

const initialState: OrderActionState = {};

interface OrderStatusFormProps {
  orderNumber: string;
  currentStatus: string;
  validNextStatuses: OrderStatus[];
  paymentStatus: string;
}

export function OrderStatusForm({
  orderNumber,
  currentStatus,
  validNextStatuses,
  paymentStatus,
}: OrderStatusFormProps) {
  const action = updateOrderStatus.bind(null, orderNumber);
  const [state, formAction, isPending] = useActionState(action, initialState);
  const [selectedStatus, setSelectedStatus] = useState<OrderStatus | undefined>(validNextStatuses[0]);
  const affectsStock =
    selectedStatus === ORDER_STATUSES.CANCELLED || selectedStatus === ORDER_STATUSES.RETURNED;
  const paymentNeedsReconciliation =
    paymentStatus === PAYMENT_STATUSES.PAID || paymentStatus === PAYMENT_STATUSES.PARTIAL;

  if (validNextStatuses.length === 0) {
    return (
      <div className="rounded-card border border-navy-soft bg-navy-deep p-4 text-sm text-neutral-bg/70">
        هذه الحالة نهائية ولا توجد انتقالات أخرى متاحة.
      </div>
    );
  }

  return (
    <form
      action={formAction}
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        if (affectsStock && !window.confirm("سيتم استرجاع جميع كميات الطلب إلى موقع المخزون الأصلي. هل تريد المتابعة؟")) {
          event.preventDefault();
        }
      }}
    >
      <Select
        name="status"
        label="الحالة التالية"
        value={selectedStatus}
        onChange={(event) => setSelectedStatus(event.target.value as OrderStatus)}
      >
        {validNextStatuses.map((value) => (
          <option key={value} value={value}>{getOrderStatusLabel(value)}</option>
        ))}
      </Select>

      {affectsStock && (
        <>
          <Textarea name="reason" label="سبب الإلغاء أو الإرجاع" required minLength={3} maxLength={500} />
          <p className="text-xs text-amber-700" role="note">
            سيتم استرجاع جميع كميات الطلب إلى موقع المخزون الأصلي وتسجيل حركة مخزون لكل منتج.
          </p>
          {paymentNeedsReconciliation && (
            <p className="text-xs text-rose-700" role="note">
              لهذا الطلب دفعة مسجلة. تسوية أو استرداد الدفعة إجراء منفصل ولن يتم تلقائيًا.
            </p>
          )}
        </>
      )}

      <Button type="submit" size="sm" disabled={isPending || !selectedStatus} className="self-start">
        {isPending && <Spinner />}
        {isPending ? "جارٍ التحديث..." : "تحديث حالة الطلب"}
      </Button>
      {state.error && <p className="text-xs text-rose-600" role="alert">{state.error}</p>}
      {state.success && <p className="text-xs text-emerald-600" role="status">تم تحديث حالة الطلب</p>}
      <p className="text-xs text-neutral-bg/50">الحالة الحالية: {getOrderStatusLabel(currentStatus)}</p>
    </form>
  );
}
