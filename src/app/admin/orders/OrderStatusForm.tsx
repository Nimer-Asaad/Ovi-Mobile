"use client";

import { useActionState } from "react";
import { updateOrderStatus, type OrderActionState } from "./actions";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { ORDER_STATUSES } from "@/lib/constants";
import { getOrderStatusLabel } from "@/lib/order-labels";

const initialState: OrderActionState = {};

interface OrderStatusFormProps {
  orderNumber: string;
  currentStatus: string;
}

export function OrderStatusForm({ orderNumber, currentStatus }: OrderStatusFormProps) {
  const action = updateOrderStatus.bind(null, orderNumber);
  const [state, formAction, isPending] = useActionState(action, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-3">
        <Select key={currentStatus} name="status" label="حالة الطلب" defaultValue={currentStatus}>
          {Object.values(ORDER_STATUSES).map((value) => (
            <option key={value} value={value}>
              {getOrderStatusLabel(value)}
            </option>
          ))}
        </Select>
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? "جارٍ التحديث..." : "تحديث الحالة"}
        </Button>
      </div>
      {state.error && (
        <p className="text-xs text-rose-600" role="alert">
          {state.error}
        </p>
      )}
      {state.success && <p className="text-xs text-emerald-600">تم تحديث حالة الطلب</p>}
    </form>
  );
}
