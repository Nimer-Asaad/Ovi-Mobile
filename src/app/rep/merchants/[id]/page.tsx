import { notFound } from "next/navigation";
import Link from "next/link";
import { requireRole } from "@/lib/auth/guards";
import { ROLES } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { StatCard } from "@/components/ui/StatCard";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { formatCurrencyFromCents } from "@/lib/utils";
import { MERCHANT_STATUSES } from "@/lib/constants";
import { buildAccountStatementRows } from "@/lib/account-statement";
import { RecordMerchantPaymentForm } from "@/components/reps/RecordMerchantPaymentForm";
import { getMerchantStatusLabel, getMerchantStatusBadgeVariant } from "@/lib/merchant-labels";
import { Badge } from "@/components/ui/Badge";

interface RepMerchantDetailPageProps {
  params: Promise<{ id: string }>;
}

/** How many of the most recent ledger rows to preview here — the full,
 * unbounded, printable ledger lives at /rep/merchants/[id]/statement. */
const RECENT_ROW_LIMIT = 8;

/** A rep's own working page for one assigned merchant — merchant info,
 * summary cards, an inline payment-entry form, and a preview of the most
 * recent ledger activity. Scoped to assignedRepId so a rep can never open
 * another rep's merchant by guessing an id. Every number here comes from
 * buildAccountStatementRows (src/lib/account-statement.ts), the exact same
 * pure transformation the printable statement uses — never a second,
 * competing balance calculation. */
export default async function RepMerchantDetailPage({ params }: RepMerchantDetailPageProps) {
  const user = await requireRole([ROLES.SALES_REPRESENTATIVE]);
  const { id } = await params;

  const rep = await prisma.salesRepresentative.findUnique({
    where: { userId: user.id },
    select: { id: true },
  });

  const merchant = rep
    ? await prisma.merchant.findFirst({
        where: { id, assignedRepId: rep.id },
        select: {
          id: true,
          businessName: true,
          region: true,
          status: true,
          contactPhone: true,
          user: { select: { phone: true } },
          account: {
            select: {
              openingBalanceCents: true,
              openingBalanceSetAt: true,
              orders: {
                orderBy: { createdAt: "desc" },
                select: {
                  orderNumber: true,
                  createdAt: true,
                  status: true,
                  totalCents: true,
                  createdByRep: { select: { user: { select: { name: true } } } },
                },
              },
              payments: {
                orderBy: { createdAt: "desc" },
                select: {
                  id: true,
                  amountCents: true,
                  method: true,
                  createdAt: true,
                  note: true,
                  createdBy: { select: { name: true } },
                  cancellation: { select: { reason: true, cancelledAt: true, cancelledBy: { select: { name: true } } } },
                },
              },
            },
          },
        },
      })
    : null;

  if (!merchant) {
    notFound();
  }

  const orders = (merchant.account?.orders ?? []).map((order) => ({ ...order, repName: order.createdByRep?.user.name ?? null }));
  const payments = (merchant.account?.payments ?? []).map((payment) => ({ ...payment, collectedByName: payment.createdBy.name }));
  const openingBalanceCents = merchant.account?.openingBalanceCents ?? 0;
  const rows = buildAccountStatementRows({ openingBalanceCents, openingBalanceSetAt: merchant.account?.openingBalanceSetAt ?? null, orders, payments });
  const totalPurchasesCents = rows.filter((row) => row.type === "SALE").reduce((sum, row) => sum + row.debitCents, 0);
  // Net of any reversal — see AccountStatementView's identical totalPaidCents
  // comment for why.
  const totalPaymentsCents =
    rows.filter((row) => row.type === "PAYMENT").reduce((sum, row) => sum + row.creditCents, 0) -
    rows.filter((row) => row.type === "PAYMENT_REVERSAL").reduce((sum, row) => sum + row.debitCents, 0);
  const balanceCents = rows.length > 0 ? rows[rows.length - 1]!.balanceCents : openingBalanceCents;
  const recentRows = [...rows].reverse().slice(0, RECENT_ROW_LIMIT);
  const phone = merchant.contactPhone ?? merchant.user?.phone ?? null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={merchant.businessName}
        subtitle={[merchant.region, phone].filter(Boolean).join(" — ") || "كشف حساب التاجر"}
        actions={<Badge variant={getMerchantStatusBadgeVariant(merchant.status)}>{getMerchantStatusLabel(merchant.status)}</Badge>}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="إجمالي المشتريات" value={formatCurrencyFromCents(totalPurchasesCents)} />
        <StatCard label="إجمالي الدفعات" value={formatCurrencyFromCents(totalPaymentsCents)} />
        <StatCard
          label="الرصيد الحالي"
          value={formatCurrencyFromCents(Math.max(balanceCents, 0))}
          badge={balanceCents > 0 ? { text: "دين قائم", variant: "danger" } : { text: "لا يوجد دين", variant: "success" }}
        />
      </div>

      <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap">
        {merchant.status === MERCHANT_STATUSES.APPROVED ? (
          <Link href={`/rep/sales/new?merchantId=${merchant.id}`} className="w-full sm:w-auto">
            <Button className="w-full">بيع جديد</Button>
          </Link>
        ) : (
          <Button className="w-full sm:w-auto" disabled title="التاجر موقوف حالياً ولا يمكن البيع له">
            بيع جديد
          </Button>
        )}
        <Link href={`/rep/merchants/${merchant.id}/statement`} className="w-full sm:w-auto">
          <Button variant="outline" className="w-full">
            كشف الحساب الكامل
          </Button>
        </Link>
      </div>

      <Card id="payment">
        <CardHeader>
          <CardTitle>تسجيل دفعة</CardTitle>
        </CardHeader>
        <CardContent>
          <RecordMerchantPaymentForm merchantId={merchant.id} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>آخر الحركات</CardTitle>
        </CardHeader>
        <CardContent>
          {recentRows.length === 0 ? (
            <p className="text-sm text-neutral-bg/60">لا توجد حركات على هذا الحساب بعد.</p>
          ) : (
            <div className="flex flex-col divide-y divide-navy-soft">
              {recentRows.map((row) => {
                const isDebit = row.type !== "PAYMENT";
                return (
                  <div key={row.key} className="flex flex-col gap-1 py-2 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                    <div className="min-w-0">
                      <p className="whitespace-normal break-words text-sm text-neutral-bg">{row.description}</p>
                      <p className="text-xs text-neutral-bg/50">{row.date ? new Date(row.date).toLocaleDateString("ar") : "—"}</p>
                    </div>
                    <p className={`shrink-0 text-sm font-semibold ${isDebit ? "text-rose-400" : "text-emerald-400"}`}>
                      {isDebit ? "+" : "-"}
                      {formatCurrencyFromCents(isDebit ? row.debitCents : row.creditCents)}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
