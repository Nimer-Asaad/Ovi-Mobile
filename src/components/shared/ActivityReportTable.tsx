import Link from "next/link";
import { AdminTable, AdminTableHead, AdminTableBody, AdminEmptyRow } from "@/components/admin/AdminTable";
import { Badge } from "@/components/ui/Badge";
import { CorrectionDialog, type CorrectionActionState } from "@/components/shared/CorrectionDialog";
import { formatCurrencyFromCents, formatBusinessDateTime } from "@/lib/utils";
import { getOrderStatusLabel, getOrderStatusBadgeVariant, getPaymentStatusLabel, getPaymentStatusBadgeVariant } from "@/lib/order-labels";
import { getAccountPaymentMethodLabel } from "@/lib/account-labels";
import { ACCOUNT_PAYMENT_ORIGINS } from "@/lib/constants";
import type { ReportActivityRow } from "@/lib/reporting";

type CorrectionAction = (state: CorrectionActionState, formData: FormData) => Promise<CorrectionActionState>;

export interface ActivityReportCorrectionActions {
  correctSale: CorrectionAction;
  cancelPayment: CorrectionAction;
  /** Where "إنشاء مبيعة صحيحة" sends the user after a successful sale
   * correction — REP's own /rep/sales/new, or ADMIN's /admin/orders/new.
   * Never auto-navigated to and never prefilled from the cancelled sale —
   * the user explicitly starts a fresh, correct sale. */
  newSaleHref: string;
}

interface ActivityReportTableProps {
  rows: ReportActivityRow[];
  /** Shown when `rows` is empty — the caller picks the exact wording since
   * it depends on which tab/filter produced the empty result (e.g. "لا توجد
   * مبيعات ضمن الفترة المحددة" vs "...دفعات..." vs "...حركات..."). */
  emptyMessage: string;
  /** When provided, renders the "تصحيح / إلغاء" controls next to the
   * existing عرض الفاتورة/عرض سند القبض links — REP's own scoped actions
   * on /rep/sales, ADMIN/ADMIN_ASSISTANT's company-wide ones on
   * /admin/reports. Omitted entirely renders a purely read-only table
   * (never done by either current caller, but keeps this component usable
   * for a future read-only surface without carrying dead props). */
  correctionActions?: ActivityReportCorrectionActions;
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
 * pattern.
 *
 * Correction controls are UI hints only (row.isCorrectable / row.isCancelled
 * / row.origin) — the real eligibility/ownership checks happen server-side
 * inside correctSale/cancelManualPayment (src/lib/sale-correction.ts,
 * src/lib/payment-correction.ts) every time, regardless of what this table
 * shows. */
export function ActivityReportTable({ rows, emptyMessage, correctionActions }: ActivityReportTableProps) {
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
                <div className="flex flex-col items-start gap-2">
                  <Link href={row.href} className="text-sm text-gold-champagne hover:underline">
                    عرض الفاتورة
                  </Link>
                  {correctionActions && row.isCorrectable && (
                    <CorrectionDialog
                      action={correctionActions.correctSale}
                      hiddenFields={{ orderNumber: row.documentNumber }}
                      triggerLabel="تصحيح / إلغاء المبيعة"
                      title="تصحيح المبيعة"
                      description="سيتم إلغاء المبيعة الحالية وعكس آثارها (استرجاع المخزون وإلغاء أي دفعة مرتبطة بها)، وبعدها يمكنك إنشاء مبيعة صحيحة."
                      confirmLabel="تأكيد الإلغاء"
                      replacementHref={correctionActions.newSaleHref}
                      replacementLabel="إنشاء مبيعة صحيحة"
                    />
                  )}
                </div>
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
                  {row.isCancelled && <Badge variant="danger">ملغاة</Badge>}
                </div>
              </td>
              <td className="px-4 py-3">
                <div className="flex flex-col items-start gap-2">
                  <Link href={row.href} className="text-sm text-gold-champagne hover:underline">
                    عرض سند القبض
                  </Link>
                  {row.isCancelled ? null : row.origin === ACCOUNT_PAYMENT_ORIGINS.MANUAL ? (
                    correctionActions && (
                      <CorrectionDialog
                        action={correctionActions.cancelPayment}
                        hiddenFields={{ paymentId: row.id }}
                        triggerLabel="تصحيح / إلغاء الدفعة"
                        title="إلغاء الدفعة"
                        description="سيتم إلغاء هذه الدفعة وإعادة المبلغ إلى رصيد الحساب، دون حذف السند الأصلي. بعدها يمكنك تسجيل دفعة صحيحة."
                        confirmLabel="تأكيد الإلغاء"
                        replacementHref={row.replacementHref}
                        replacementLabel="تسجيل دفعة صحيحة"
                      />
                    )
                  ) : row.origin === ACCOUNT_PAYMENT_ORIGINS.SALE_INITIAL ? (
                    row.sourceOrderCorrectionHref ? (
                      <Link href={row.sourceOrderCorrectionHref} className="text-sm text-gold-champagne hover:underline">
                        صحّح المبيعة الأصلية
                      </Link>
                    ) : (
                      // origin is SALE_INITIAL but the persisted sourceOrder
                      // relation is unexpectedly missing — a data-integrity
                      // anomaly, never guessed at. cancelManualPayment itself
                      // still rejects any direct-cancel attempt on this
                      // payment server-side regardless of this UI state.
                      <span className="text-xs text-amber-500">تعذّر تحديد المبيعة المرتبطة — راجع البيانات يدويًا</span>
                    )
                  ) : (
                    <span className="text-xs text-neutral-bg/40">غير قابل للتصحيح التلقائي</span>
                  )}
                </div>
              </td>
            </tr>
          ),
        )}
        {rows.length === 0 && <AdminEmptyRow colSpan={8} message={emptyMessage} />}
      </AdminTableBody>
    </AdminTable>
  );
}
