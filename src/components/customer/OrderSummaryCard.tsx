import { formatCurrencyFromCents } from "@/lib/utils";

export interface OrderSummaryCardProps {
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
}

/** Pricing breakdown for an order — only the fields the schema actually
 * stores (subtotal/discount/total). No delivery fee or tax line, since
 * neither exists on the Order model. */
export function OrderSummaryCard({ subtotalCents, discountCents, totalCents }: OrderSummaryCardProps) {
  return (
    <div className="flex flex-col gap-1.5 text-sm">
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
      <div className="mt-1 flex items-center justify-between border-t border-navy-soft pt-2 text-base font-semibold">
        <span className="text-neutral-bg">الإجمالي</span>
        <span className="text-gold-champagne">{formatCurrencyFromCents(totalCents)}</span>
      </div>
    </div>
  );
}
