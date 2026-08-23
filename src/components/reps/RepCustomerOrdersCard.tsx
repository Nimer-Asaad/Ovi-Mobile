"use client";

import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { cancelRepCustomerOrder, type CancelCustomerOrderState } from "@/app/admin/reps/actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { ConfirmDialog } from "@/components/admin/ConfirmDialog";
import { REP_CUSTOMER_ORDER_STATUSES } from "@/lib/constants";
import { getRepCustomerOrderStatusLabel, getRepCustomerOrderStatusBadgeVariant } from "@/lib/rep-customer-order-labels";
import type { RepCustomerOrderSummary } from "@/lib/rep-customer-orders";

const initialState: CancelCustomerOrderState = {};

function CancelOrderButton({ repId, orderId }: { repId: string; orderId: string }) {
  const action = cancelRepCustomerOrder.bind(null, repId, orderId);
  const [state, formAction, isPending] = useActionState(action, initialState);
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (state.success) router.refresh();
  }, [state, router]);

  return (
    <form ref={formRef} action={formAction}>
      <ConfirmDialog
        title="إلغاء طلبية الزبون"
        description="سيتم إلغاء هذه الطلبية المنطقية فقط. المخزون الذي تم تحميله على السيارة سيبقى فيها كمخزون سيارة عادي — لن يُرجَع تلقائياً إلى المستودع."
        confirmLabel="تأكيد الإلغاء"
        variant="danger"
        onConfirm={() => formRef.current?.requestSubmit()}
        trigger={(open) => (
          <Button type="button" variant="ghost" size="sm" disabled={isPending} onClick={open}>
            {isPending && <Spinner />}
            إلغاء
          </Button>
        )}
      />
      {state.error && (
        <p className="mt-1 text-xs text-rose-600" role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}

export interface RepCustomerOrdersCardProps {
  repId: string;
  orders: RepCustomerOrderSummary[];
}

/** Admin-facing visibility into this rep's customer-order car-loads (see
 * RepCustomerOrder) — distinguishes them from plain car-stock transfers,
 * which never appear here. Cancellation only ever available while OPEN. */
export function RepCustomerOrdersCard({ repId, orders }: RepCustomerOrdersCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>طلبات الزبائن</CardTitle>
      </CardHeader>
      <CardContent>
        {orders.length === 0 ? (
          <p className="py-6 text-center text-sm text-neutral-bg/50">لا توجد طلبات زبائن بعد</p>
        ) : (
          <div className="flex flex-col divide-y divide-navy-soft">
            {orders.map((order) => (
              <div key={order.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-neutral-bg">{order.customerName}</p>
                  <p className="text-xs text-neutral-bg/50">
                    {new Date(order.createdAt).toLocaleDateString("ar")} — {order.itemCount} صنف
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={getRepCustomerOrderStatusBadgeVariant(order.status)}>
                    {getRepCustomerOrderStatusLabel(order.status)}
                  </Badge>
                  {order.status === REP_CUSTOMER_ORDER_STATUSES.OPEN && <CancelOrderButton repId={repId} orderId={order.id} />}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
