"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { cancelRepCustomerOrder, linkRepCustomerOrderMerchant, type CancelCustomerOrderState, type LinkCustomerOrderMerchantState } from "@/app/admin/reps/actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { ConfirmDialog } from "@/components/admin/ConfirmDialog";
import { REP_CUSTOMER_ORDER_STATUSES } from "@/lib/constants";
import { getRepCustomerOrderStatusLabel, getRepCustomerOrderStatusBadgeVariant } from "@/lib/rep-customer-order-labels";
import { getOrderStatusLabel, getOrderStatusBadgeVariant } from "@/lib/order-labels";
import type { RepCustomerEngagementRow, RepCustomerOrderEngagementRow } from "@/lib/rep-customer-orders";
import type { RepMerchantSummary } from "@/lib/rep-merchants";

const cancelInitialState: CancelCustomerOrderState = {};
const linkInitialState: LinkCustomerOrderMerchantState = {};

function CancelOrderButton({ repId, orderId }: { repId: string; orderId: string }) {
  const action = cancelRepCustomerOrder.bind(null, repId, orderId);
  const [state, formAction, isPending] = useActionState(action, cancelInitialState);
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

/** ADMIN-only inline linker for a legacy/unlinked OPEN row — picks a real
 * Merchant already assigned to this rep (never types a name/creates one
 * here) so the row can join that trader's grouped parent row from now on.
 * Only ever renders when this rep actually has assigned merchants to pick
 * from; otherwise there is nothing useful to link to yet. */
function LinkMerchantControl({ repId, orderId, merchants }: { repId: string; orderId: string; merchants: RepMerchantSummary[] }) {
  const [isOpen, setIsOpen] = useState(false);
  const action = linkRepCustomerOrderMerchant.bind(null, repId, orderId);
  const [state, formAction, isPending] = useActionState(action, linkInitialState);
  const router = useRouter();

  useEffect(() => {
    if (state.success) {
      setIsOpen(false);
      router.refresh();
    }
  }, [state, router]);

  if (!isOpen) {
    return (
      <Button type="button" variant="ghost" size="sm" onClick={() => setIsOpen(true)}>
        ربط بالتاجر
      </Button>
    );
  }

  return (
    <form action={formAction} className="flex items-center gap-2">
      <select
        name="merchantId"
        required
        defaultValue=""
        className="rounded-card border border-navy-soft bg-navy-deep px-2 py-1 text-xs text-neutral-bg"
      >
        <option value="" disabled>
          اختر التاجر...
        </option>
        {merchants.map((merchant) => (
          <option key={merchant.id} value={merchant.id}>
            {merchant.businessName}
            {merchant.phone ? ` — ${merchant.phone}` : ""}
          </option>
        ))}
      </select>
      <Button type="submit" variant="ghost" size="sm" disabled={isPending}>
        {isPending && <Spinner />}
        ربط
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={() => setIsOpen(false)}>
        إلغاء
      </Button>
      {state.error && (
        <p className="text-xs text-rose-600" role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}

function CustomerOrderRowActions({ repId, row, merchants }: { repId: string; row: RepCustomerOrderEngagementRow; merchants: RepMerchantSummary[] }) {
  return (
    <>
      <Badge variant={getRepCustomerOrderStatusBadgeVariant(row.status)}>{getRepCustomerOrderStatusLabel(row.status)}</Badge>
      {row.status === REP_CUSTOMER_ORDER_STATUSES.OPEN && <CancelOrderButton repId={repId} orderId={row.id} />}
      {row.status === REP_CUSTOMER_ORDER_STATUSES.OPEN && !row.merchantId && merchants.length > 0 && (
        <LinkMerchantControl repId={repId} orderId={row.id} merchants={merchants} />
      )}
      {row.saleOrderNumber && (
        <Link href={`/admin/orders/${row.saleOrderNumber}`} className="text-xs text-gold-champagne hover:underline">
          فتح الطلب
        </Link>
      )}
    </>
  );
}

/** One trader's combined OPEN row (e.g. "أحمد — 18 صنف — نشط" from a 1-صنف
 * and a 17-صنف template) — expandable to each underlying RepCustomerOrder,
 * which keeps its own date/item count/status/cancel action untouched.
 * Deliberately no group-level cancel: cancelling only ever targets one real
 * row at a time (see CancelOrderButton above). */
function MerchantGroupRow({ repId, row, merchants }: { repId: string; row: Extract<RepCustomerEngagementRow, { kind: "merchantGroup" }>; merchants: RepMerchantSummary[] }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button type="button" onClick={() => setExpanded((value) => !value)} className="min-w-0 flex-1 text-start">
          <p className="text-sm text-neutral-bg">{row.customerName}</p>
          <p className="text-xs text-neutral-bg/50">
            {new Date(row.createdAt).toLocaleDateString("ar")} — {row.itemCount} صنف — {row.children.length} طلبيات {expanded ? "▲" : "▼"}
          </p>
        </button>
        <div className="flex items-center gap-2">
          <Badge variant={getRepCustomerOrderStatusBadgeVariant(REP_CUSTOMER_ORDER_STATUSES.OPEN)}>
            {getRepCustomerOrderStatusLabel(REP_CUSTOMER_ORDER_STATUSES.OPEN)}
          </Badge>
        </div>
      </div>
      {expanded && (
        <div className="mt-2 flex flex-col divide-y divide-navy-soft rounded-card border border-navy-soft bg-navy-deep px-3">
          {row.children.map((child) => (
            <div key={child.id} className="flex flex-wrap items-center justify-between gap-3 py-2 first:pt-2 last:pb-2">
              <div className="min-w-0 flex-1">
                <p className="text-xs text-neutral-bg/70">
                  {new Date(child.createdAt).toLocaleDateString("ar")} — {child.itemCount} صنف
                </p>
              </div>
              <div className="flex items-center gap-2">
                <CustomerOrderRowActions repId={repId} row={child} merchants={merchants} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export interface RepCustomerOrdersCardProps {
  repId: string;
  rows: RepCustomerEngagementRow[];
  /** This rep's assigned merchants, for the "ربط بالتاجر" picker on a
   * legacy/unlinked OPEN row — see getMerchantsForRep. Empty for a rep with
   * no merchants yet, in which case the link control simply never renders
   * (nothing to link to). */
  merchants: RepMerchantSummary[];
}

/** Admin-facing visibility into this rep's customer engagement — merges two
 * genuinely different underlying entities into one chronological display:
 * RepCustomerOrder car-load templates (kind: "customerOrder" — OPEN/
 * COMPLETED/CANCELLED, cancellable only while OPEN), ad-hoc rep sales that
 * never went through a template (kind: "sale" — always a completed Order,
 * opens straight to its admin order-detail page), and — new — a
 * "merchantGroup" parent row combining multiple OPEN templates that share
 * the SAME real trader identity (RepCustomerOrder.merchantId) into one row,
 * expandable to each underlying template (see getRepCustomerEngagementRows
 * for exactly how grouping/dedup is decided). A completed template's own
 * resulting sale is never listed a second time here, and no two rows here
 * ever represent the same real event twice. */
export function RepCustomerOrdersCard({ repId, rows, merchants }: RepCustomerOrdersCardProps) {
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
            {rows.map((row) => {
              if (row.kind === "merchantGroup") {
                return <MerchantGroupRow key={row.id} repId={repId} row={row} merchants={merchants} />;
              }
              return (
                <div key={row.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-neutral-bg">{row.customerName}</p>
                    <p className="text-xs text-neutral-bg/50">
                      {new Date(row.createdAt).toLocaleDateString("ar")} — {row.itemCount} صنف
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {row.kind === "customerOrder" ? (
                      <CustomerOrderRowActions repId={repId} row={row} merchants={merchants} />
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
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
