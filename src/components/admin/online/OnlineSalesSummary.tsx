import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { formatCurrencyFromCents } from "@/lib/utils";
import {
  ONLINE_SALE_CATEGORY_CONFIG,
  ONLINE_SALE_CATEGORY_ORDER,
  formatCommissionRateLabel,
  type OnlineSalesCategoryTotal,
} from "@/lib/online-sales";
import type { OnlineSaleCategory } from "@/types";

export interface OnlineSalesSummaryProps {
  categoryTotals: Record<OnlineSaleCategory, OnlineSalesCategoryTotal>;
  totalSalesCents: number;
  totalCommissionCents: number;
}

/** Totals computed from SAVED database records only (the selected
 * history's date range — see /admin/online/page.tsx) — never mixed with
 * the entry form's own unsaved live preview ("النسبة المتوقعة"), which is
 * a separate, clearly-labeled concept in OnlineSaleEntryForm. */
export function OnlineSalesSummary({ categoryTotals, totalSalesCents, totalCommissionCents }: OnlineSalesSummaryProps) {
  return (
    <Card className="border-gold-champagne/40 bg-gold-champagne/5">
      <CardHeader>
        <CardTitle>الملخص</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex items-center justify-between rounded-card border border-navy-soft bg-navy-surface p-4">
            <span className="text-sm text-neutral-bg/60">إجمالي المبيعات</span>
            <span className="text-xl font-bold text-neutral-bg" dir="ltr">
              {formatCurrencyFromCents(totalSalesCents)}
            </span>
          </div>
          <div className="flex items-center justify-between rounded-card border border-gold-champagne/50 bg-navy-surface p-4">
            <span className="text-sm text-neutral-bg/60">إجمالي نسبتي</span>
            <span className="text-xl font-bold text-gold-dark" dir="ltr">
              {formatCurrencyFromCents(totalCommissionCents)}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {ONLINE_SALE_CATEGORY_ORDER.map((category) => {
            const { labelAr, rateBps } = ONLINE_SALE_CATEGORY_CONFIG[category];
            const totals = categoryTotals[category];
            return (
              <div key={category} className="rounded-card border border-navy-soft bg-navy-surface p-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-neutral-bg">{labelAr}</span>
                  <span className="text-xs text-neutral-bg/50" dir="ltr">
                    {formatCommissionRateLabel(rateBps)}
                  </span>
                </div>
                <div className="mt-3 flex flex-col gap-1.5 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-neutral-bg/60">إجمالي المبيعات</span>
                    <span className="text-neutral-bg" dir="ltr">
                      {formatCurrencyFromCents(totals.salesCents)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-neutral-bg/60">إجمالي النسبة</span>
                    <span className="font-medium text-gold-dark" dir="ltr">
                      {formatCurrencyFromCents(totals.commissionCents)}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
