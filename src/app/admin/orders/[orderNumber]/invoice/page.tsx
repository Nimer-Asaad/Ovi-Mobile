import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth/guards";
import { ROLES } from "@/lib/constants";
import { InvoiceActions } from "@/components/admin/orders/InvoiceActions";
import type { InvoiceData } from "@/components/admin/orders/InvoiceView";
import { getOrderAccountPosition } from "@/lib/accounts";
import { getOrderBusinessCreatedAt, getOrderStatusHistoryBusinessCreatedAt } from "@/lib/business-time";
import { isTerminalOrderStatus } from "@/lib/order-lifecycle-rules";

interface AdminInvoicePageProps {
  params: Promise<{ orderNumber: string }>;
}

/** ADMIN and ADMIN_ASSISTANT — this route-local guard is deliberately its
 * own explicit line (not just relying on the outer /admin layout's ADMIN |
 * ADMIN_ASSISTANT gate) so this specific access decision stays visible on
 * its own. Originally ADMIN-only; opened to ADMIN_ASSISTANT alongside the
 * sales/payments correction feature — that role now needs to actually SEE
 * the invoice it may be offered a "تصحيح / إلغاء المبيعة" action for from
 * /admin/reports. This does not broaden anything else: /admin/accounts/**
 * (payments/debt) stays ADMIN-only via its own separate layout, unchanged.
 *
 * Reuses the exact same InvoiceView/InvoiceActions a rep's own sale invoice
 * (/rep/sales/[orderNumber]) renders — one shared component, never a
 * duplicated invoice/print/PNG/WhatsApp implementation. This also covers an
 * admin viewing a rep sale they created on the rep's behalf
 * (createRepSaleForRep, /admin/reps/[id]/sales/new): that order lands here
 * exactly like any other, already carrying its own merchant/account/rep
 * data, so no separate admin-for-rep invoice route is needed. Unlike the rep
 * page, this route is order-number-scoped only — ADMIN already has broader
 * access to every order, unchanged from before this feature. */
export default async function AdminInvoicePage({ params }: AdminInvoicePageProps) {
  await requireRole([ROLES.ADMIN, ROLES.ADMIN_ASSISTANT]);

  const { orderNumber } = await params;

  const order = await prisma.order.findUnique({
    where: { orderNumber },
    select: {
      orderNumber: true,
      createdAt: true,
      status: true,
      statusHistory: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { id: true, reason: true, changedBy: { select: { name: true } } },
      },
      source: true,
      paymentMethod: true,
      paymentStatus: true,
      subtotalCents: true,
      discountCents: true,
      totalCents: true,
      paidAmountCents: true,
      contactName: true,
      contactPhone: true,
      city: true,
      shippingAddress: true,
      notes: true,
      customer: { select: { name: true, email: true } },
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
      createdByRep: { select: { user: { select: { name: true } } } },
      account: {
        select: {
          openingBalanceCents: true,
          openingBalanceSetAt: true,
          // orderNumber/createdAt (orders) and id/createdAt/method/note
          // (payments) are all needed by getOrderAccountPosition to rebuild
          // the exact chronological ordering buildAccountStatementRows uses
          // — never just the bare totals getAccountBalanceCents alone needs.
          orders: { select: { orderNumber: true, createdAt: true, status: true, totalCents: true } },
          payments: {
            select: {
              id: true,
              createdAt: true,
              amountCents: true,
              method: true,
              note: true,
              cancellation: { select: { reason: true, cancelledAt: true, cancelledBy: { select: { name: true } } } },
            },
          },
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
          product: { select: { sku: true, name: true, nameAr: true } },
        },
      },
    },
  });

  if (!order) {
    notFound();
  }

  // Real, unambiguous UTC instant for display — never the raw (mis-tagged)
  // order.createdAt directly. Falls back to the raw value only in the
  // defensive/never-expected case the lookup returns null for an order we
  // just successfully loaded.
  const businessCreatedAt = (await getOrderBusinessCreatedAt(order.orderNumber)) ?? order.createdAt;

  const latestHistory = order.statusHistory[0] ?? null;
  const cancellation =
    isTerminalOrderStatus(order.status) && latestHistory && latestHistory.reason
      ? {
          reason: latestHistory.reason,
          changedByName: latestHistory.changedBy.name,
          businessChangedAt: (await getOrderStatusHistoryBusinessCreatedAt(latestHistory.id)) ?? businessCreatedAt,
        }
      : null;

  const invoiceData: InvoiceData = {
    orderNumber: order.orderNumber,
    businessCreatedAt,
    status: order.status,
    cancellation,
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
    customer: order.customer,
    merchant: order.merchant,
    repName: order.createdByRep?.user.name ?? null,
    account: order.account ? getOrderAccountPosition(order.account, order) : null,
    items: order.items,
  };

  const whatsappNumber = order.merchant?.whatsappPhone ?? order.merchant?.contactPhone ?? null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href={`/admin/orders/${order.orderNumber}`} className="text-sm text-gold-champagne hover:underline">
          العودة إلى تفاصيل الطلب
        </Link>
      </div>

      <InvoiceActions order={invoiceData} whatsappNumber={whatsappNumber} />
    </div>
  );
}
