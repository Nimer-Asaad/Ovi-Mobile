import Link from "next/link";
import { requireRole } from "@/lib/auth/guards";
import { ROLES } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
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
import { correctSaleAction, cancelManualPaymentAction } from "@/app/admin/reports/actions";

interface AdminReportsPageProps {
  searchParams: Promise<{ type?: string; from?: string; to?: string; q?: string; repId?: string; merchantId?: string }>;
}

const TABS = [
  { value: "ALL", label: "الكل" },
  { value: "SALE", label: "المبيعات" },
  { value: "PAYMENT", label: "الدفعات" },
];

/** Company-wide sales + payments report — ADMIN and ADMIN_ASSISTANT (no
 * suitable existing report surface covered both entity types together:
 * /admin/orders is sales-only, /admin/accounts is per-account (and stays
 * ADMIN-only via its own layout — this route grants NO access to it),
 * /admin/inventory/company-report is inventory-only — so this is the one
 * new "تقارير المبيعات والدفعات" page). ADMIN_ASSISTANT was added
 * alongside the sales/payments correction feature (explicitly approved) —
 * this route-local guard is the actual access boundary; payment receipts
 * linked from here go through /admin/reports/payments/[paymentId] (a
 * report-scoped mirror), never /admin/accounts/**, so ADMIN_ASSISTANT
 * never touches that ADMIN-only surface. */
export default async function AdminReportsPage({ searchParams }: AdminReportsPageProps) {
  await requireRole([ROLES.ADMIN, ROLES.ADMIN_ASSISTANT]);
  const { type, from, to, q, repId, merchantId } = await searchParams;

  const defaults = getDefaultReportRange();
  const fromIso = from?.trim() || defaults.fromIso;
  const toIso = to?.trim() || defaults.toIso;
  const activeTab = type === "SALE" || type === "PAYMENT" ? type : "ALL";
  const selectedRepId = repId?.trim() || undefined;
  const selectedMerchantId = merchantId?.trim() || undefined;

  const [reps, merchants, selectedRep] = await Promise.all([
    prisma.salesRepresentative.findMany({
      orderBy: { user: { name: "asc" } },
      select: { id: true, employeeCode: true, user: { select: { name: true } } },
    }),
    // Every merchant, not just currently-approved ones — a report must still
    // let admin filter to a merchant whose historical sales/payments predate
    // a later status change (see the feature's "historical data" rule).
    prisma.merchant.findMany({
      orderBy: { businessName: "asc" },
      select: { id: true, businessName: true },
    }),
    selectedRepId
      ? prisma.salesRepresentative.findUnique({ where: { id: selectedRepId }, select: { userId: true } })
      : Promise.resolve(null),
  ]);

  const [sales, payments] = await Promise.all([
    fetchSaleActivityRows(
      { fromIso, toIso, search: q, salesRepId: selectedRepId, merchantId: selectedMerchantId },
      (orderNumber) => `/admin/orders/${orderNumber}/invoice`,
    ),
    fetchPaymentActivityRows(
      { fromIso, toIso, search: q, collectorUserId: selectedRep?.userId, merchantId: selectedMerchantId },
      // Report-scoped receipt route (not /admin/accounts/**) — reachable by
      // both ADMIN and ADMIN_ASSISTANT, see this page's own doc comment.
      (payment) => `/admin/reports/payments/${payment.id}`,
      (orderNumber) => `/admin/reports?q=${encodeURIComponent(orderNumber)}`,
      // Report-scoped replacement-payment entry point — correction-scoped
      // to THIS exact cancelled payment (never a bare accountId), so the
      // destination account is always re-derived server-side from the
      // original payment, never trusted from the URL. Reachable by both
      // ADMIN and ADMIN_ASSISTANT.
      (payment) => `/admin/reports/payments/new?replacementFor=${payment.id}`,
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
    if (repId) params.set("repId", repId);
    if (merchantId) params.set("merchantId", merchantId);
    const qs = params.toString();
    return qs ? `/admin/reports?${qs}` : "/admin/reports";
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="تقارير المبيعات والدفعات" subtitle="مراجعة جميع المبيعات والدفعات عبر كل المندوبين" />

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

          <form method="GET" className="grid grid-cols-1 gap-3 rounded-card border border-navy-soft bg-navy-surface p-4 sm:grid-cols-2 lg:grid-cols-6">
            <input type="hidden" name="type" value={activeTab === "ALL" ? "" : activeTab} />
            <Input type="date" name="from" label="من تاريخ" defaultValue={fromIso} />
            <Input type="date" name="to" label="إلى تاريخ" defaultValue={toIso} />
            <Select name="repId" label="المندوب" defaultValue={repId ?? ""}>
              <option value="">كل المندوبين</option>
              {reps.map((rep) => (
                <option key={rep.id} value={rep.id}>
                  {rep.user.name} ({rep.employeeCode})
                </option>
              ))}
            </Select>
            <Select name="merchantId" label="التاجر" defaultValue={merchantId ?? ""}>
              <option value="">كل التجار</option>
              {merchants.map((merchant) => (
                <option key={merchant.id} value={merchant.id}>
                  {merchant.businessName}
                </option>
              ))}
            </Select>
            <div className="lg:col-span-2">
              <Input name="q" label="بحث برقم الطلب أو السند أو اسم التاجر" defaultValue={q ?? ""} />
            </div>
            <div className="flex items-end lg:col-span-6">
              <Button type="submit">تصفية</Button>
            </div>
          </form>

          <ActivityReportTable
            rows={rows}
            emptyMessage={emptyMessage}
            correctionActions={{
              correctSale: correctSaleAction,
              cancelPayment: cancelManualPaymentAction,
              // Shared by ADMIN and ADMIN_ASSISTANT — /admin/orders/new is
              // already open to both roles (see its own guard), isolated to
              // sale creation only. Payment replacement is now per-row (see
              // fetchPaymentActivityRows's buildReplacementHref above),
              // pointing both roles at /admin/reports/payments/new instead
              // of the ADMIN-only /admin/accounts.
              newSaleHref: "/admin/orders/new",
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
