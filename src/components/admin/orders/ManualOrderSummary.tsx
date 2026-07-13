"use client";

import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { formatCurrencyFromCents } from "@/lib/utils";
import { PAYMENT_STATUSES } from "@/lib/constants";
import { getPaymentStatusLabel, getPaymentStatusBadgeVariant } from "@/lib/order-labels";

export interface ManualOrderSummaryProps {
  subtotalCents: number;
  discountInput: string;
  onDiscountChange: (value: string) => void;
  paidInput: string;
  onPaidChange: (value: string) => void;
}

function toCents(input: string): number {
  const value = Number(input);
  return Number.isFinite(value) && value > 0 ? Math.round(value * 100) : 0;
}

/** Pure display + two money inputs — all totals are recomputed here from
 * props for the admin's preview only. The server recomputes everything
 * again independently and never trusts these numbers. */
export function ManualOrderSummary({
  subtotalCents,
  discountInput,
  onDiscountChange,
  paidInput,
  onPaidChange,
}: ManualOrderSummaryProps) {
  const discountCents = Math.min(toCents(discountInput), subtotalCents);
  const totalCents = Math.max(subtotalCents - discountCents, 0);
  const paidAmountCents = Math.min(toCents(paidInput), totalCents);
  const balanceCents = Math.max(totalCents - paidAmountCents, 0);

  let previewStatus: string = PAYMENT_STATUSES.PENDING;
  if (paidAmountCents >= totalCents && totalCents > 0) {
    previewStatus = PAYMENT_STATUSES.PAID;
  } else if (paidAmountCents > 0) {
    previewStatus = PAYMENT_STATUSES.PARTIAL;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input
          label="الخصم (₪)"
          name="discountDisplay"
          type="number"
          min={0}
          step="0.01"
          value={discountInput}
          onChange={(event) => onDiscountChange(event.target.value)}
        />
        <Input
          label="المبلغ المستلم (₪)"
          name="paidAmountDisplay"
          type="number"
          min={0}
          step="0.01"
          value={paidInput}
          onChange={(event) => onPaidChange(event.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1.5 rounded-card border border-navy-soft bg-navy-deep p-4 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-neutral-bg/70">المجموع الفرعي</span>
          <span className="text-neutral-bg">{formatCurrencyFromCents(subtotalCents)}</span>
        </div>
        {discountCents > 0 && (
          <div className="flex items-center justify-between">
            <span className="text-neutral-bg/70">الخصم</span>
            <span className="text-neutral-bg">-{formatCurrencyFromCents(discountCents)}</span>
          </div>
        )}
        <div className="flex items-center justify-between text-base font-semibold">
          <span className="text-neutral-bg">الإجمالي</span>
          <span className="text-gold-champagne">{formatCurrencyFromCents(totalCents)}</span>
        </div>
        <div className="mt-2 flex items-center justify-between border-t border-navy-soft pt-2">
          <span className="text-neutral-bg/70">المبلغ المستلم</span>
          <span className="text-neutral-bg">{formatCurrencyFromCents(paidAmountCents)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-neutral-bg/70">المتبقي</span>
          <span className={balanceCents > 0 ? "font-semibold text-rose-600" : "text-neutral-bg"}>
            {formatCurrencyFromCents(balanceCents)}
          </span>
        </div>
        <div className="mt-2 flex items-center justify-between">
          <span className="text-neutral-bg/70">حالة الدفع المتوقعة</span>
          <Badge variant={getPaymentStatusBadgeVariant(previewStatus)}>{getPaymentStatusLabel(previewStatus)}</Badge>
        </div>
      </div>
    </div>
  );
}
