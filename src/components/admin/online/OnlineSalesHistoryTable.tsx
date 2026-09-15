import { AdminTable, AdminTableHead, AdminTableBody, AdminEmptyRow } from "@/components/admin/AdminTable";
import { OnlineSaleDeleteButton } from "@/components/admin/online/OnlineSaleDeleteButton";
import { formatCurrencyFromCents } from "@/lib/utils";
import { ONLINE_SALE_CATEGORY_CONFIG, formatCommissionRateLabel } from "@/lib/online-sales";
import type { OnlineSaleCategory } from "@/types";

export interface OnlineSaleHistoryRow {
  id: string;
  /** "YYYY-MM-DD" — see saleDateToIso in src/lib/online-sales.ts. */
  saleDateIso: string;
  category: OnlineSaleCategory;
  amountCents: number;
  commissionRateBps: number;
  commissionCents: number;
}

export interface OnlineSalesHistoryTableProps {
  rows: OnlineSaleHistoryRow[];
}

/** "2026-09-15" -> "15/09/2026" — saleDate is a plain calendar date (no
 * time-of-day/timezone component to reconcile, see OnlineSale's schema doc
 * comment), so a straight string reformat is exact; this deliberately
 * never goes through formatBusinessDateTime, which is for real timestamp
 * instants only. */
function formatSaleDateDisplay(saleDateIso: string): string {
  const [year, month, day] = saleDateIso.split("-");
  return `${day}/${month}/${year}`;
}

/** سجل المبيعات — every saved OnlineSale row in the selected date range,
 * newest sale date first then newest created entry first (see the
 * `orderBy` in /admin/online/page.tsx). Uses the same AdminTable/
 * overflow-x-auto shell as every other admin list (products, reports,
 * etc.) rather than inventing a mobile-card layout — this table has far
 * fewer/narrower columns than e.g. the customer invoice table, so it fits
 * comfortably within that existing convention. */
export function OnlineSalesHistoryTable({ rows }: OnlineSalesHistoryTableProps) {
  return (
    <AdminTable>
      <AdminTableHead>
        <th className="px-4 py-3 text-start">التاريخ</th>
        <th className="px-4 py-3 text-start">النوع</th>
        <th className="px-4 py-3 text-start">قيمة المبيعات</th>
        <th className="px-4 py-3 text-start">النسبة</th>
        <th className="px-4 py-3 text-start">قيمة نسبتي</th>
        <th className="px-4 py-3 text-end">الإجراء</th>
      </AdminTableHead>
      <AdminTableBody>
        {rows.map((row) => {
          const { labelAr } = ONLINE_SALE_CATEGORY_CONFIG[row.category];
          return (
            <tr key={row.id}>
              <td className="whitespace-nowrap px-4 py-3 text-neutral-bg" dir="ltr">
                {formatSaleDateDisplay(row.saleDateIso)}
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-neutral-bg">{labelAr}</td>
              <td className="whitespace-nowrap px-4 py-3 text-neutral-bg" dir="ltr">
                {formatCurrencyFromCents(row.amountCents)}
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-neutral-bg/70" dir="ltr">
                {formatCommissionRateLabel(row.commissionRateBps)}
              </td>
              <td className="whitespace-nowrap px-4 py-3 font-medium text-gold-dark" dir="ltr">
                {formatCurrencyFromCents(row.commissionCents)}
              </td>
              <td className="px-4 py-3 text-end">
                <OnlineSaleDeleteButton
                  saleId={row.id}
                  description={`${labelAr} — ${formatSaleDateDisplay(row.saleDateIso)} — ${formatCurrencyFromCents(row.amountCents)}`}
                />
              </td>
            </tr>
          );
        })}
        {rows.length === 0 && <AdminEmptyRow colSpan={6} message="لا توجد مبيعات ضمن الفترة المحددة" />}
      </AdminTableBody>
    </AdminTable>
  );
}
