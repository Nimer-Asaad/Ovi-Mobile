import { notFound } from "next/navigation";
import Link from "next/link";
import { requireEffectiveRepresentative } from "@/lib/auth/impersonation";
import { prisma } from "@/lib/prisma";
import { AccountStatementView } from "@/components/admin/accounts/AccountStatementView";
import { PrintMerchantStatementButton } from "@/components/reps/PrintMerchantStatementButton";

interface RepMerchantStatementPageProps {
  params: Promise<{ id: string }>;
}

/** Full, printable A4 statement for one of the rep's own assigned merchants
 * — reuses AccountStatementView as-is (the exact same component admin's
 * print-statement page uses), so a rep sees exactly the same chronological
 * ledger/print layout admin does. Scoped to assignedRepId so a rep can
 * never open another rep's merchant statement by guessing an id. */
export default async function RepMerchantStatementPage({ params }: RepMerchantStatementPageProps) {
  const effectiveRep = await requireEffectiveRepresentative();
  const { id } = await params;

  const merchant = await prisma.merchant.findFirst({
    where: { id, assignedRepId: effectiveRep.repId },
    select: {
      businessName: true,
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
  });

  if (!merchant) {
    notFound();
  }

  const orders = (merchant.account?.orders ?? []).map((order) => ({ ...order, repName: order.createdByRep?.user.name ?? null }));
  const payments = (merchant.account?.payments ?? []).map((payment) => ({ ...payment, collectedByName: payment.createdBy.name }));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href={`/rep/merchants/${id}`} className="text-sm text-gold-champagne hover:underline">
          العودة إلى تفاصيل التاجر
        </Link>
        <PrintMerchantStatementButton />
      </div>

      <AccountStatementView
        account={{
          displayName: merchant.businessName,
          phone: merchant.contactPhone ?? merchant.user?.phone ?? null,
          kindLabel: "تاجر جملة",
          openingBalanceCents: merchant.account?.openingBalanceCents ?? 0,
          openingBalanceSetAt: merchant.account?.openingBalanceSetAt ?? null,
          orders,
          payments,
        }}
      />
    </div>
  );
}
