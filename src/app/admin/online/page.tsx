import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { PageHeader } from "@/components/ui/PageHeader";
import { OnlineSaleEntryForm } from "@/components/admin/online/OnlineSaleEntryForm";
import { OnlineSalesSummary } from "@/components/admin/online/OnlineSalesSummary";
import { OnlineSalesHistoryTable, type OnlineSaleHistoryRow } from "@/components/admin/online/OnlineSalesHistoryTable";
import { getBusinessDateIso, getDefaultReportRange } from "@/lib/reporting";
import { computeOnlineSalesTotals, isoToSaleDate, saleDateToIso } from "@/lib/online-sales";
import type { OnlineSaleCategory } from "@/types";

interface AdminOnlinePageProps {
  searchParams: Promise<{ from?: string; to?: string }>;
}

/** أون لاين — the ADMIN-only online-sales commission ledger. ADMIN-only
 * access is enforced by this route's own layout.tsx (narrowing the outer
 * /admin ADMIN|ADMIN_ASSISTANT gate); no guard repeated here, matching
 * every other ADMIN-only section's page.tsx (e.g. /admin/products). Every
 * mutation (save/delete) independently re-checks ADMIN in its own server
 * action regardless (see ./actions.ts) — this page never relies solely on
 * the layout guard for that. */
export default async function AdminOnlinePage({ searchParams }: AdminOnlinePageProps) {
  const { from, to } = await searchParams;
  const todayIso = getBusinessDateIso();
  const defaults = getDefaultReportRange();
  const fromIso = from?.trim() || defaults.fromIso;
  const toIso = to?.trim() || defaults.toIso;

  const sales = await prisma.onlineSale.findMany({
    where: { saleDate: { gte: isoToSaleDate(fromIso), lte: isoToSaleDate(toIso) } },
    // Newest sale date first, then newest created entry first — a ledger
    // view, not a single aggregated snapshot per day (see OnlineSale's
    // schema doc comment on why (saleDate, category) is deliberately not
    // unique).
    orderBy: [{ saleDate: "desc" }, { createdAt: "desc" }],
    select: { id: true, saleDate: true, category: true, amountCents: true, commissionRateBps: true, commissionCents: true },
  });

  const rows: OnlineSaleHistoryRow[] = sales.map((sale) => ({
    id: sale.id,
    saleDateIso: saleDateToIso(sale.saleDate),
    // Trusted cast: this column only ever holds a value this app itself
    // wrote via ONLINE_SALE_CATEGORY_ORDER (see saveOnlineSalesAction) —
    // same convention as e.g. `status as OrderStatus` elsewhere.
    category: sale.category as OnlineSaleCategory,
    amountCents: sale.amountCents,
    commissionRateBps: sale.commissionRateBps,
    commissionCents: sale.commissionCents,
  }));

  const { categoryTotals, totalSalesCents, totalCommissionCents } = computeOnlineSalesTotals(rows);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="أون لاين" subtitle="حساب نسبة المبيعات" />

      <OnlineSaleEntryForm todayIso={todayIso} />

      <Card>
        <CardHeader>
          <CardTitle>سجل المبيعات</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <form method="GET" className="grid grid-cols-1 gap-3 rounded-card border border-navy-soft bg-navy-surface p-4 sm:grid-cols-3">
            <Input type="date" name="from" label="من تاريخ" defaultValue={fromIso} max={todayIso} />
            <Input type="date" name="to" label="إلى تاريخ" defaultValue={toIso} max={todayIso} />
            <div className="flex items-end">
              <Button type="submit">تصفية</Button>
            </div>
          </form>

          <OnlineSalesSummary categoryTotals={categoryTotals} totalSalesCents={totalSalesCents} totalCommissionCents={totalCommissionCents} />

          <OnlineSalesHistoryTable rows={rows} />
        </CardContent>
      </Card>
    </div>
  );
}
