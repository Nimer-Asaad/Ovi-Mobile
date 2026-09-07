import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/ui/PageHeader";
import { PaymentReceiptActions } from "@/components/shared/PaymentReceiptActions";
import type { PaymentReceiptData } from "@/components/shared/PaymentReceiptView";
import { getPaymentAccountPosition } from "@/lib/accounts";
import { getPaymentBusinessCreatedAt } from "@/lib/business-time";

interface AdminPaymentReceiptPageProps {
  params: Promise<{ id: string; paymentId: string }>;
}

/** Admin's own payment receipt — "سند قبض" — reachable for ANY CustomerAccount
 * type (merchant, registered-customer, or walk-in), since recordAccountPayment
 * (src/app/admin/accounts/actions.ts) works generically for all of them, not
 * only merchants. Reuses the exact same PaymentReceiptView/PaymentReceiptActions
 * a rep's own receipt renders — one shared component, never a duplicated
 * receipt/print/PNG/WhatsApp implementation.
 *
 * ADMIN-only via the inherited src/app/admin/accounts/layout.tsx guard
 * (narrows the outer ADMIN | ADMIN_ASSISTANT gate down to ADMIN alone,
 * matching every other page under /admin/accounts/**) — no separate
 * requireRole call here, exactly like the sibling [id]/page.tsx and
 * [id]/statement/page.tsx. Still scoped by both `accountId` and `paymentId`
 * together (the payment must belong to THAT account) as defense-in-depth
 * against a manipulated URL pairing mismatched ids, even though ADMIN
 * already has broad access to every account. */
export default async function AdminPaymentReceiptPage({ params }: AdminPaymentReceiptPageProps) {
  const { id: accountId, paymentId } = await params;

  const account = await prisma.customerAccount.findUnique({
    where: { id: accountId },
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
      payments: { select: { id: true, amountCents: true, method: true, createdAt: true, note: true } },
    },
  });

  if (!account) {
    notFound();
  }

  const payment = await prisma.accountPayment.findFirst({
    where: { id: paymentId, accountId },
    select: {
      id: true,
      receiptNumber: true,
      amountCents: true,
      method: true,
      note: true,
      createdAt: true,
      createdBy: { select: { name: true } },
    },
  });

  if (!payment) {
    notFound();
  }

  // Real, unambiguous UTC instant for display — never the raw
  // payment.createdAt directly (that stays reserved for
  // resolvePaymentReceiptReference's legacy fallback, unchanged below).
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
  };

  const whatsappNumber = account.merchant?.whatsappPhone ?? account.merchant?.contactPhone ?? account.phone ?? null;

  return (
    <div className="flex flex-col gap-6">
      <div className="print:hidden">
        <PageHeader
          title="سند قبض"
          subtitle={account.displayName}
          actions={
            <Link href={`/admin/accounts/${accountId}`} className="text-sm text-gold-champagne hover:underline">
              العودة إلى الحساب
            </Link>
          }
        />
      </div>

      <PaymentReceiptActions payment={receiptData} whatsappNumber={whatsappNumber} />
    </div>
  );
}
