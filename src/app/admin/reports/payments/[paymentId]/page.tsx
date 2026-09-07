import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth/guards";
import { ROLES } from "@/lib/constants";
import { PageHeader } from "@/components/ui/PageHeader";
import { PaymentReceiptActions } from "@/components/shared/PaymentReceiptActions";
import type { PaymentReceiptData } from "@/components/shared/PaymentReceiptView";
import { getPaymentAccountPosition } from "@/lib/accounts";
import { getPaymentBusinessCreatedAt, getPaymentCancellationBusinessCancelledAt } from "@/lib/business-time";

interface AdminReportPaymentReceiptPageProps {
  params: Promise<{ paymentId: string }>;
}

/** A report-scoped, read-only mirror of /admin/accounts/[id]/payments/[paymentId]
 * — exists ONLY so ADMIN_ASSISTANT (who must never gain access to
 * /admin/accounts/** — the general account/debt management surface, still
 * ADMIN-only via its own layout.tsx, deliberately unchanged by this
 * feature) can still open a payment receipt linked from /admin/reports.
 * ADMIN can reach the exact same receipt content via either route — this
 * is not a second, competing receipt: it fetches the same AccountPayment
 * row and renders the exact same shared PaymentReceiptView/
 * PaymentReceiptActions, never a duplicated markup/print/PNG/WhatsApp
 * implementation. Company-wide by id only (like the ADMIN invoice route) —
 * ADMIN and ADMIN_ASSISTANT both already have company-wide report access. */
export default async function AdminReportPaymentReceiptPage({ params }: AdminReportPaymentReceiptPageProps) {
  await requireRole([ROLES.ADMIN, ROLES.ADMIN_ASSISTANT]);
  const { paymentId } = await params;

  const payment = await prisma.accountPayment.findUnique({
    where: { id: paymentId },
    select: {
      id: true,
      accountId: true,
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
    <div className="flex flex-col gap-6">
      <div className="print:hidden">
        <PageHeader
          title="سند قبض"
          subtitle={account.displayName}
          actions={
            <Link href="/admin/reports" className="text-sm text-gold-champagne hover:underline">
              العودة إلى التقارير
            </Link>
          }
        />
      </div>

      <PaymentReceiptActions payment={receiptData} whatsappNumber={whatsappNumber} />
    </div>
  );
}
