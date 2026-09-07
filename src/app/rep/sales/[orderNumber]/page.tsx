import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/guards";
import { ROLES } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/ui/PageHeader";
import { InvoiceActions } from "@/components/admin/orders/InvoiceActions";
import type { InvoiceData } from "@/components/admin/orders/InvoiceView";
import { getOrderAccountPosition } from "@/lib/accounts";
import { getOrderBusinessCreatedAt } from "@/lib/business-time";

interface RepSaleDetailPageProps {
  params: Promise<{ orderNumber: string }>;
}

/** A rep's own sale invoice — "فاتورة البيع" (see InvoiceView/InvoiceActions:
 * one shared component for viewing, printing, downloading as PNG, and
 * sharing to WhatsApp). This is the page createRepSale/createRepSaleForRep
 * already redirect to right after a successful sale, and the same page a
 * rep reaches later from /rep/sales — never a separate, one-time-only
 * invoice route.
 *
 * Authorization: scoped to `order.createdByRepId === this rep's own id`,
 * exactly as before this page became the invoice — a rep can never view
 * another rep's sale by guessing/changing the orderNumber in the URL, since
 * the query below is filtered server-side, not just hidden in the UI. */
export default async function RepSaleDetailPage({ params }: RepSaleDetailPageProps) {
  const user = await requireRole([ROLES.SALES_REPRESENTATIVE]);
  const { orderNumber } = await params;

  const rep = await prisma.salesRepresentative.findUnique({
    where: { userId: user.id },
    select: { id: true },
  });

  const order = await prisma.order.findUnique({
    where: { orderNumber },
    select: {
      orderNumber: true,
      source: true,
      createdByRepId: true,
      createdByRep: { select: { user: { select: { name: true } } } },
      subtotalCents: true,
      discountCents: true,
      totalCents: true,
      paidAmountCents: true,
      contactName: true,
      contactPhone: true,
      city: true,
      shippingAddress: true,
      notes: true,
      paymentMethod: true,
      paymentStatus: true,
      createdAt: true,
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
      account: {
        select: {
          openingBalanceCents: true,
          openingBalanceSetAt: true,
          // orderNumber/createdAt (orders) and id/createdAt/method/note
          // (payments) are all needed by getOrderAccountPosition to rebuild
          // the exact chronological ordering buildAccountStatementRows uses
          // — never just the bare totals getAccountBalanceCents alone needs.
          orders: { select: { orderNumber: true, createdAt: true, status: true, totalCents: true } },
          payments: { select: { id: true, createdAt: true, amountCents: true, method: true, note: true } },
        },
      },
      items: {
        select: {
          id: true,
          quantity: true,
          unitPriceCents: true,
          totalCents: true,
          color: { select: { name: true, nameAr: true } },
          phoneBrandSnapshot: true,
          phoneModelSnapshot: true,
          colorNameSnapshot: true,
          variantCodeSnapshot: true,
          product: {
            select: { sku: true, name: true, nameAr: true },
          },
        },
      },
    },
  });

  if (!order || !rep || order.createdByRepId !== rep.id) {
    notFound();
  }

  // Real, unambiguous UTC instant for display — see the ADMIN invoice
  // page's identical comment for why the raw order.createdAt is never
  // formatted directly.
  const businessCreatedAt = (await getOrderBusinessCreatedAt(order.orderNumber)) ?? order.createdAt;

  const invoiceData: InvoiceData = {
    orderNumber: order.orderNumber,
    businessCreatedAt,
    source: order.source,
    paymentMethod: order.paymentMethod,
    paymentStatus: order.paymentStatus,
    subtotalCents: order.subtotalCents,
    discountCents: order.discountCents,
    totalCents: order.totalCents,
    paidAmountCents: order.paidAmountCents,
    contactName: order.contactName,
    contactPhone: order.contactPhone,
    city: order.city,
    shippingAddress: order.shippingAddress,
    notes: order.notes,
    // A rep sale always resolves a real Merchant (see resolveOrCreateRepMerchant
    // in createRepSaleCore) — customer is never used for a rep-sale invoice's
    // identity, so it's never queried above.
    customer: null,
    merchant: order.merchant,
    repName: order.createdByRep?.user.name ?? null,
    account: order.account ? getOrderAccountPosition(order.account, order) : null,
    items: order.items,
  };

  const whatsappNumber = order.merchant?.whatsappPhone ?? order.merchant?.contactPhone ?? null;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="print:hidden">
        <PageHeader
          title="فاتورة البيع"
          subtitle={`طلب ${order.orderNumber}`}
          actions={
            <Link href="/rep/sales" className="text-sm text-gold-champagne hover:underline">
              العودة إلى مبيعاتي
            </Link>
          }
        />
      </div>

      <InvoiceActions order={invoiceData} whatsappNumber={whatsappNumber} />
    </div>
  );
}
