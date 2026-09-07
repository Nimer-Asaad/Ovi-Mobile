import Link from "next/link";
import { requireEffectiveRepresentative } from "@/lib/auth/impersonation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { ActivityReportTable } from "@/components/shared/ActivityReportTable";
import { formatCurrencyFromCents, cn } from "@/lib/utils";
import {
  fetchSaleActivityRows,
  fetchPaymentActivityRows,
  mergeActivityRows,
  computeActivityTotals,
  getDefaultReportRange,
} from "@/lib/reporting";
import { correctRepSaleAction, cancelRepManualPaymentAction } from "@/app/rep/sales/actions";

interface RepSalesPageProps {
  searchParams: Promise<{ type?: string; from?: string; to?: string; q?: string }>;
}

const TABS = [
  { value: "ALL", label: "الكل" },
  { value: "SALE", label: "المبيعات" },
  { value: "PAYMENT", label: "الدفعات" },
];

/** REP's own sales + payments activity report — extends what used to be a
 * sales-only list ("مبيعاتي") into a unified chronological report, per the
 * business requirement that a rep review both their sales AND the payments
 * they personally collected. Reuses the existing /rep/sales route/nav entry
 * rather than adding a second, competing report page.
 *
 * Ownership rule (payments): scoped by AccountPayment.createdById === this
 * rep's own User.id — the actual persisted collector, never inferred from
 * "merchant assigned to this rep." A payment an ADMIN recorded for one of
 * this rep's own merchants is correctly excluded here (it still shows on
 * that merchant's full account statement, just not as this rep's own
 * collected-payment activity) — see fetchPaymentActivityRows's own doc
 * comment. Sale-linked "paid now" payments ARE included when this rep is
 * the one who actually made the sale (createdById is always the acting
 * rep — see createRepSaleCore) — never hidden or merged into the sale row;
 * they appear as their own PAYMENT row, keeping sales totals and payment
 * totals separate. */
export default async function RepSalesPage({ searchParams }: RepSalesPageProps) {
  const effectiveRep = await requireEffectiveRepresentative();
  const { type, from, to, q } = await searchParams;

  const defaults = getDefaultReportRange();
  const fromIso = from?.trim() || defaults.fromIso;
  const toIso = to?.trim() || defaults.toIso;
  const activeTab = type === "SALE" || type === "PAYMENT" ? type : "ALL";

  const [sales, payments] = await Promise.all([
    fetchSaleActivityRows(
      { fromIso, toIso, search: q, salesRepId: effectiveRep.repId },
      (orderNumber) => `/rep/sales/${orderNumber}`,
    ),
    fetchPaymentActivityRows(
      { fromIso, toIso, search: q, collectorUserId: effectiveRep.actingUserId },
      (payment) => (payment.merchantId ? `/rep/merchants/${payment.merchantId}/payments/${payment.id}` : "#"),
      (orderNumber) => `/rep/sales?q=${encodeURIComponent(orderNumber)}`,
      // Correction-scoped replacement-payment entry point — NOT the
      // generic merchant page. Ownership for a correction is based on
      // AccountPayment.createdById, never current merchant assignment,
      // so this never depends on the merchant still being assigned to
      // this rep (see createRepReplacementPaymentAction's own doc
      // comment in src/app/rep/sales/actions.ts).
      (payment) => `/rep/sales/payments/new?replacementFor=${payment.id}`,
    ),
  ]);

  const totals = computeActivityTotals(sales, payments);
  const rows =
    activeTab === "SALE" ? mergeActivityRows(sales, []) : activeTab === "PAYMENT" ? mergeActivityRows([], payments) : mergeActivityRows(sales, payments);

  const emptyMessage =
    activeTab === "SALE"
      ? "لا توجد مبيعات ضمن الفترة المحددة"
      : activeTab === "PAYMENT"
        ? "لا توجد دفعات ضمن الفترة المحددة"
        : "لا توجد حركات ضمن الفترة المحددة";

  function tabHref(value: string): string {
    const params = new URLSearchParams();
    if (value !== "ALL") params.set("type", value);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (q) params.set("q", q);
    const qs = params.toString();
    return qs ? `/rep/sales?${qs}` : "/rep/sales";
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <PageHeader
        title="مبيعاتي ودفعاتي"
        subtitle="سجل المبيعات والدفعات التي قمت بتسجيلها"
        actions={
          <Link href="/rep/sales/new">
            <Button>بيع جديد</Button>
          </Link>
        }
      />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="إجمالي المبيعات" value={formatCurrencyFromCents(totals.salesTotalCents)} />
        <StatCard label="إجمالي الدفعات" value={formatCurrencyFromCents(totals.paymentsTotalCents)} />
        <StatCard label="عدد المبيعات" value={String(totals.salesCount)} />
        <StatCard label="عدد الدفعات" value={String(totals.paymentsCount)} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>الحركات</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div role="tablist" aria-label="نوع الحركة" className="flex flex-wrap gap-2">
            {TABS.map((tab) => (
              <Link
                key={tab.value}
                href={tabHref(tab.value)}
                role="tab"
                aria-selected={activeTab === tab.value}
                className={cn(
                  "rounded-card border px-4 py-2 text-sm transition-colors",
                  activeTab === tab.value
                    ? "border-gold-champagne/60 bg-gold-champagne/10 text-gold-champagne"
                    : "border-navy-soft text-neutral-bg/70 hover:border-gold-champagne/30",
                )}
              >
                {tab.label}
              </Link>
            ))}
          </div>

          <form method="GET" className="grid grid-cols-1 gap-3 rounded-card border border-navy-soft bg-navy-deep/40 p-4 sm:grid-cols-4">
            <input type="hidden" name="type" value={activeTab === "ALL" ? "" : activeTab} />
            <Input type="date" name="from" label="من تاريخ" defaultValue={fromIso} />
            <Input type="date" name="to" label="إلى تاريخ" defaultValue={toIso} />
            <div className="sm:col-span-2">
              <Input name="q" label="بحث برقم الطلب أو السند أو اسم التاجر" defaultValue={q ?? ""} />
            </div>
            <div className="flex items-end sm:col-span-4">
              <Button type="submit">تصفية</Button>
            </div>
          </form>

          <ActivityReportTable
            rows={rows}
            emptyMessage={emptyMessage}
            correctionActions={{
              correctSale: correctRepSaleAction,
              cancelPayment: cancelRepManualPaymentAction,
              newSaleHref: "/rep/sales/new",
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
