import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth/guards";
import { ROLES } from "@/lib/constants";
import { InvoiceView } from "@/components/admin/orders/InvoiceView";
import { PrintInvoiceButton } from "@/components/admin/orders/PrintInvoiceButton";

interface AdminInvoicePageProps {
  params: Promise<{ orderNumber: string }>;
}

/** Admin-only — deliberately narrower than the rest of /admin/orders, which
 * ADMIN_ASSISTANT (مساعد الأدمن, warehouse picker/preparer staff) can read
 * for order preparation. The order detail page already carries everything
 * needed to prepare an order (items, quantities, model/color/variant); this
 * printable customer invoice (full financial breakdown, formatted for
 * handing to a customer) isn't part of that need, so it stays ADMIN-only
 * rather than being pulled along by the outer /admin layout's
 * ADMIN | ADMIN_ASSISTANT gate. */
export default async function AdminInvoicePage({ params }: AdminInvoicePageProps) {
  await requireRole([ROLES.ADMIN]);

  const { orderNumber } = await params;

  const order = await prisma.order.findUnique({
    where: { orderNumber },
    select: {
      orderNumber: true,
      createdAt: true,
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
      merchant: { select: { businessName: true } },
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

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href={`/admin/orders/${order.orderNumber}`} className="text-sm text-gold-champagne hover:underline">
          العودة إلى تفاصيل الطلب
        </Link>
        <PrintInvoiceButton />
      </div>

      <InvoiceView order={order} />
    </div>
  );
}
