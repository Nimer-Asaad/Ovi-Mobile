import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { InvoiceView } from "@/components/admin/orders/InvoiceView";
import { PrintInvoiceButton } from "@/components/admin/orders/PrintInvoiceButton";

interface AdminInvoicePageProps {
  params: Promise<{ orderNumber: string }>;
}

/** Admin-only — inherited from src/app/admin/layout.tsx's requireRole
 * guard, which every route under /admin passes through. */
export default async function AdminInvoicePage({ params }: AdminInvoicePageProps) {
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
