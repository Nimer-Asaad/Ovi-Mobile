"use client";

import Link from "next/link";
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
import { getOrderStatusLabel, getOrderStatusBadgeVariant } from "@/lib/order-labels";
import type { RepCustomerEngagementRow } from "@/lib/rep-customer-orders";

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
  rows: RepCustomerEngagementRow[];
}

/** Admin-facing visibility into this rep's customer engagement — merges two
 * genuinely different underlying entities into one chronological display:
 * RepCustomerOrder car-load templates (kind: "customerOrder" — OPEN/
 * COMPLETED/CANCELLED, cancellable only while OPEN) and ad-hoc rep sales
 * that never went through a template (kind: "sale" — always a completed
 * Order, opens straight to its admin order-detail page). A completed
 * template's own resulting sale is never listed a second time here — see
 * getRepCustomerEngagementRows for exactly how that's prevented — so every
 * row still represents exactly one real event, just with each kind showing
 * its own real status/action rather than a fabricated shared one. */
export function RepCustomerOrdersCard({ repId, rows }: RepCustomerOrdersCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>طلبات الزبائن</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-neutral-bg/50">لا توجد طلبات زبائن بعد</p>
        ) : (
          <div className="flex flex-col divide-y divide-navy-soft">
            {rows.map((row) => (
              <div key={row.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-neutral-bg">{row.customerName}</p>
                  <p className="text-xs text-neutral-bg/50">
                    {new Date(row.createdAt).toLocaleDateString("ar")} — {row.itemCount} صنف
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {row.kind === "customerOrder" ? (
                    <>
                      <Badge variant={getRepCustomerOrderStatusBadgeVariant(row.status)}>
                        {getRepCustomerOrderStatusLabel(row.status)}
                      </Badge>
                      {row.status === REP_CUSTOMER_ORDER_STATUSES.OPEN && <CancelOrderButton repId={repId} orderId={row.id} />}
                      {row.saleOrderNumber && (
                        <Link href={`/admin/orders/${row.saleOrderNumber}`} className="text-xs text-gold-champagne hover:underline">
                          فتح الطلب
                        </Link>
                      )}
                    </>
                  ) : (
                    <>
                      <Badge variant={getOrderStatusBadgeVariant(row.orderStatus)}>{getOrderStatusLabel(row.orderStatus)}</Badge>
                      <Link href={`/admin/orders/${row.orderNumber}`} className="text-xs text-gold-champagne hover:underline">
                        فتح الطلب
                      </Link>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
