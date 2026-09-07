import Link from "next/link";
import { notFound } from "next/navigation";
import { requireEffectiveRepresentative } from "@/lib/auth/impersonation";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/ui/PageHeader";
import { PaymentReceiptActions } from "@/components/shared/PaymentReceiptActions";
import type { PaymentReceiptData } from "@/components/shared/PaymentReceiptView";
import { getPaymentAccountPosition } from "@/lib/accounts";
import { getPaymentBusinessCreatedAt, getPaymentCancellationBusinessCancelledAt } from "@/lib/business-time";

interface RepSalesPaymentReceiptPageProps {
  params: Promise<{ paymentId: string }>;
}

/** A report-scoped, ownership-based mirror of
 * /rep/merchants/[id]/payments/[paymentId] — exists so a rep can always
 * open a receipt for a payment THEY personally created (createdById ===
 * this rep's own user id), even when the merchant is no longer currently
 * assigned to them. The original merchant-scoped route's own guard
 * (assignedRepId === rep.id) is deliberately left unchanged for its own
 * use case; this is a SEPARATE, additive route, not a weakening of that
 * one — reached from /rep/sales (the rep's own activity report) and from
 * the replacement-payment flow (createRepReplacementPaymentAction), never
 * from anywhere that depends on current merchant assignment.
 *
 * Reuses the exact same shared PaymentReceiptView/PaymentReceiptActions
 * every other receipt route renders — never a duplicated markup/print/PNG/
 * WhatsApp implementation. */
export default async function RepSalesPaymentReceiptPage({ params }: RepSalesPaymentReceiptPageProps) {
  const effectiveRep = await requireEffectiveRepresentative();
  const { paymentId } = await params;

  const payment = await prisma.accountPayment.findUnique({
    where: { id: paymentId },
    select: {
      id: true,
      accountId: true,
      createdById: true,
      receiptNumber: true,
      amountCents: true,
      method: true,
      note: true,
      createdAt: true,
      createdBy: { select: { name: true } },
      cancellation: { select: { reason: true, cancelledAt: true, cancelledBy: { select: { name: true } } } },
    },
  });

  // Ownership check — createdById, never merchant assignment. A payment
  // this rep did not personally create (another rep's, an admin's) 404s
  // here exactly like a mismatched merchantId/paymentId pair 404s on the
  // merchant-scoped route.
  if (!payment || payment.createdById !== effectiveRep.actingUserId) {
    notFound();
  }

  const account = await prisma.customerAccount.findUnique({
    where: { id: payment.accountId },
    select: {
      displayName: true,
      phone: true,
      openingBalanceCents: true,
      openingBalanceSetAt: true,
      merchant: {
        select: {
          businessName: true,
          contactName: true,
          contactPhone: true,
          whatsappPhone: true,
          city: true,
          region: true,
        },
      },
      orders: { select: { orderNumber: true, createdAt: true, status: true, totalCents: true } },
      payments: {
        select: {
          id: true,
          amountCents: true,
          method: true,
          createdAt: true,
          note: true,
          cancellation: { select: { reason: true, cancelledAt: true, cancelledBy: { select: { name: true } } } },
        },
      },
    },
  });

  if (!account) {
    notFound();
  }

  const businessCreatedAt = (await getPaymentBusinessCreatedAt(payment.id)) ?? payment.createdAt;

  const receiptData: PaymentReceiptData = {
    id: payment.id,
    receiptNumber: payment.receiptNumber,
    createdAt: payment.createdAt,
    businessCreatedAt,
    amountCents: payment.amountCents,
    method: payment.method,
    note: payment.note,
    collectedByName: payment.createdBy.name,
    merchant: account.merchant,
    accountDisplayName: account.displayName,
    accountPhone: account.phone,
    account: getPaymentAccountPosition(account, payment),
    cancellation: payment.cancellation
      ? {
          reason: payment.cancellation.reason,
          cancelledByName: payment.cancellation.cancelledBy.name,
          cancelledAt: (await getPaymentCancellationBusinessCancelledAt(payment.id)) ?? payment.cancellation.cancelledAt,
        }
      : null,
  };

  const whatsappNumber = account.merchant?.whatsappPhone ?? account.merchant?.contactPhone ?? account.phone ?? null;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div className="print:hidden">
        <PageHeader
          title="سند قبض"
          subtitle={account.merchant?.businessName ?? account.displayName}
          actions={
            <Link href="/rep/sales" className="text-sm text-gold-champagne hover:underline">
              العودة إلى مبيعاتي ودفعاتي
            </Link>
          }
        />
      </div>

      <PaymentReceiptActions payment={receiptData} whatsappNumber={whatsappNumber} />
    </div>
  );
}
