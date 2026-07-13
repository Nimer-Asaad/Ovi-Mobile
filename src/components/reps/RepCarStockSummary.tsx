import { StatCard } from "@/components/ui/StatCard";
import { formatCurrencyFromCents } from "@/lib/utils";

export interface RepCarStockSummaryProps {
  totalUnits: number;
  distinctProducts: number;
  lowStockCount: number;
  /** Admin-only. Omit entirely on rep-facing pages — reps must never see
   * cost-derived stock value. */
  valueCents?: number;
}

export function RepCarStockSummary({
  totalUnits,
  distinctProducts,
  lowStockCount,
  valueCents,
}: RepCarStockSummaryProps) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard label="عدد المنتجات في السيارة" value={String(distinctProducts)} />
      <StatCard label="إجمالي الكمية في السيارة" value={String(totalUnits)} />
      <StatCard
        label="مخزون منخفض"
        value={String(lowStockCount)}
        badge={{
          text: lowStockCount > 0 ? "تنبيه" : "جيد",
          variant: lowStockCount > 0 ? "warning" : "success",
        }}
      />
      {valueCents !== undefined && (
        <StatCard label="قيمة مخزون السيارة" value={formatCurrencyFromCents(valueCents)} />
      )}
    </div>
  );
}
