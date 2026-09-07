import Link from "next/link";
import { AdminTable, AdminTableHead, AdminTableBody, AdminEmptyRow } from "@/components/admin/AdminTable";
import { Badge } from "@/components/ui/Badge";
import { formatCurrencyFromCents, formatBusinessDateTime } from "@/lib/utils";
import { getOrderStatusLabel, getOrderStatusBadgeVariant, getPaymentStatusLabel, getPaymentStatusBadgeVariant } from "@/lib/order-labels";
import { getAccountPaymentMethodLabel } from "@/lib/account-labels";
import type { ReportActivityRow } from "@/lib/reporting";

interface ActivityReportTableProps {
  rows: ReportActivityRow[];
  /** Shown when `rows` is empty — the caller picks the exact wording since
   * it depends on which tab/filter produced the empty result (e.g. "لا توجد
   * مبيعات ضمن الفترة المحددة" vs "...دفعات..." vs "...حركات..."). */
  emptyMessage: string;
}

/** The one shared sales+payments activity table — used as-is by both the
 * REP report (/rep/sales) and the ADMIN report (/admin/reports). Every row
 * only ever LINKS to the real invoice/receipt page (InvoiceView/
 * PaymentReceiptView, via their own routes) — this component never
 * duplicates invoice/receipt markup, print, PNG, or WhatsApp logic. Type is
 * shown as an explicit Arabic label (بيع/دفعة) with a distinct badge
 * variant, never relying on color alone. Mobile: relies on the same
 * horizontally-scrollable AdminTable container every other admin/rep table
 * in this app already uses, rather than inventing a second responsive
 * pattern. */
export function ActivityReportTable({ rows, emptyMessage }: ActivityReportTableProps) {
  return (
    <AdminTable>
      <AdminTableHead>
        <th className="px-4 py-3 text-start">النوع</th>
        <th className="px-4 py-3 text-start">التاريخ</th>
        <th className="px-4 py-3 text-start">رقم المستند</th>
        <th className="px-4 py-3 text-start">التاجر / العميل</th>
        <th className="px-4 py-3 text-start">المندوب / المُحصّل</th>
        <th className="px-4 py-3 text-start">المبلغ</th>
        <th className="px-4 py-3 text-start">تفاصيل</th>
        <th className="px-4 py-3 text-start"></th>
      </AdminTableHead>
      <AdminTableBody>
        {rows.map((row) =>
          row.type === "SALE" ? (
            <tr key={row.key}>
              <td className="px-4 py-3">
                <Badge variant="success">بيع</Badge>
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-neutral-bg/70">{formatBusinessDateTime(row.businessCreatedAt)}</td>
              <td className="whitespace-nowrap px-4 py-3 font-mono text-neutral-bg" dir="ltr">
                {row.documentNumber}
              </td>
              <td className="max-w-[12rem] whitespace-normal break-words px-4 py-3 text-neutral-bg">{row.merchantName}</td>
              <td className="px-4 py-3 text-neutral-bg/70">{row.repName ?? "—"}</td>
              <td className="whitespace-nowrap px-4 py-3 font-semibold text-neutral-bg">{formatCurrencyFromCents(row.totalCents)}</td>
              <td className="px-4 py-3">
                <div className="flex flex-col gap-1 text-xs text-neutral-bg/70">
                  <span>مدفوع الآن: {formatCurrencyFromCents(row.paidNowCents)}</span>
                  <span>متبقي: {formatCurrencyFromCents(row.remainingCents)}</span>
                  <div className="flex flex-wrap gap-1">
                    <Badge variant={getOrderStatusBadgeVariant(row.status)}>{getOrderStatusLabel(row.status)}</Badge>
                    <Badge variant={getPaymentStatusBadgeVariant(row.paymentStatus)}>{getPaymentStatusLabel(row.paymentStatus)}</Badge>
                  </div>
                </div>
              </td>
              <td className="px-4 py-3">
                <Link href={row.href} className="text-sm text-gold-champagne hover:underline">
                  عرض الفاتورة
                </Link>
              </td>
            </tr>
          ) : (
            <tr key={row.key}>
              <td className="px-4 py-3">
                <Badge variant="gold">دفعة</Badge>
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-neutral-bg/70">{formatBusinessDateTime(row.businessCreatedAt)}</td>
              <td className="whitespace-nowrap px-4 py-3 font-mono text-neutral-bg" dir="ltr">
                {row.documentNumber}
              </td>
              <td className="max-w-[12rem] whitespace-normal break-words px-4 py-3 text-neutral-bg">{row.merchantName}</td>
              <td className="px-4 py-3 text-neutral-bg/70">{row.collectorName ?? "—"}</td>
              <td className="whitespace-nowrap px-4 py-3 font-semibold text-emerald-400">{formatCurrencyFromCents(row.amountCents)}</td>
              <td className="px-4 py-3">
                <div className="flex flex-col gap-1 text-xs text-neutral-bg/70">
                  <span>{getAccountPaymentMethodLabel(row.method)}</span>
                  {row.note && <span className="break-words">{row.note}</span>}
                </div>
              </td>
              <td className="px-4 py-3">
                <Link href={row.href} className="text-sm text-gold-champagne hover:underline">
                  عرض سند القبض
                </Link>
              </td>
            </tr>
          ),
        )}
        {rows.length === 0 && <AdminEmptyRow colSpan={8} message={emptyMessage} />}
      </AdminTableBody>
    </AdminTable>
  );
}
