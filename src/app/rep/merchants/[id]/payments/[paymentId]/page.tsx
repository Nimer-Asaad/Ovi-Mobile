import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/guards";
import { ROLES } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/ui/PageHeader";
import { PaymentReceiptActions } from "@/components/shared/PaymentReceiptActions";
import type { PaymentReceiptData } from "@/components/shared/PaymentReceiptView";
import { getPaymentAccountPosition } from "@/lib/accounts";
import { getPaymentBusinessCreatedAt, getPaymentCancellationBusinessCancelledAt } from "@/lib/business-time";

interface RepPaymentReceiptPageProps {
  params: Promise<{ id: string; paymentId: string }>;
}

/** A rep's own payment receipt — "سند قبض" (see PaymentReceiptView/
 * PaymentReceiptActions: one shared component for viewing, printing,
 * downloading as PNG, and sharing to WhatsApp — the exact same pattern the
 * sale invoice already uses via InvoiceView/InvoiceActions). This is the
 * page recordMerchantPaymentAsRep redirects to right after a rep manually
 * records a payment, and the same page a rep can return to later.
 *
 * Authorization: scoped to BOTH `merchantId` (assignedRepId === this rep)
 * AND `paymentId` (must belong to THAT merchant's own account) — a rep can
 * never view another rep's merchant's payment by changing either id in the
 * URL independently, since both are re-verified together server-side, not
 * just hidden in the UI. */
export default async function RepPaymentReceiptPage({ params }: RepPaymentReceiptPageProps) {
  const user = await requireRole([ROLES.SALES_REPRESENTATIVE]);
  const { id: merchantId, paymentId } = await params;

  const rep = await prisma.salesRepresentative.findUnique({
    where: { userId: user.id },
    select: { id: true },
  });

  const merchant = rep
    ? await prisma.merchant.findFirst({
        where: { id: merchantId, assignedRepId: rep.id },
        select: {
          businessName: true,
          contactName: true,
          contactPhone: true,
          whatsappPhone: true,
          city: true,
          region: true,
          account: {
            select: {
              id: true,
              openingBalanceCents: true,
              openingBalanceSetAt: true,
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
          },
        },
      })
    : null;

  if (!merchant || !merchant.account) {
    notFound();
  }

  const payment = await prisma.accountPayment.findFirst({
    where: { id: paymentId, accountId: merchant.account.id },
    select: {
      id: true,
      receiptNumber: true,
      amountCents: true,
      method: true,
      note: true,
      createdAt: true,
      createdBy: { select: { name: true } },
      cancellation: { select: { reason: true, cancelledAt: true, cancelledBy: { select: { name: true } } } },
    },
  });

  if (!payment) {
    notFound();
  }

  // Real, unambiguous UTC instant for display — see the ADMIN receipt
  // page's identical comment for why the raw payment.createdAt is never
  // formatted directly.
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
    merchant: {
      businessName: merchant.businessName,
      contactName: merchant.contactName,
      contactPhone: merchant.contactPhone,
      whatsappPhone: merchant.whatsappPhone,
      city: merchant.city,
      region: merchant.region,
    },
    accountDisplayName: merchant.businessName,
    accountPhone: merchant.contactPhone,
    account: getPaymentAccountPosition(merchant.account, payment),
    cancellation: payment.cancellation
      ? {
          reason: payment.cancellation.reason,
          cancelledByName: payment.cancellation.cancelledBy.name,
          cancelledAt: (await getPaymentCancellationBusinessCancelledAt(payment.id)) ?? payment.cancellation.cancelledAt,
        }
      : null,
  };

  const whatsappNumber = merchant.whatsappPhone ?? merchant.contactPhone ?? null;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div className="print:hidden">
        <PageHeader
          title="سند قبض"
          subtitle={merchant.businessName}
          actions={
            <Link href={`/rep/merchants/${merchantId}`} className="text-sm text-gold-champagne hover:underline">
              العودة إلى التاجر
            </Link>
          }
        />
      </div>

      <PaymentReceiptActions payment={receiptData} whatsappNumber={whatsappNumber} />
    </div>
  );
}
