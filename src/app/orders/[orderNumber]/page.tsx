import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { OrderStatusTimeline } from "@/components/customer/OrderStatusTimeline";
import { OrderItemsList } from "@/components/customer/OrderItemsList";
import { OrderSummaryCard } from "@/components/customer/OrderSummaryCard";
import { formatCurrencyFromCents } from "@/lib/utils";
import {
  getOrderStatusLabel,
  getOrderStatusBadgeVariant,
  getPaymentMethodLabel,
  getPaymentStatusLabel,
  getPaymentStatusBadgeVariant,
} from "@/lib/order-labels";
import { ORDER_SOURCES } from "@/lib/constants";

interface OrderDetailPageProps {
  params: Promise<{ orderNumber: string }>;
}

// Queries live DB/session data behind an auth guard, and has no shared
// layout to hang this on — force dynamic explicitly (see
// admin/layout.tsx for the full rationale).
export const dynamic = "force-dynamic";

export default async function OrderDetailPage({ params }: OrderDetailPageProps) {
  const { orderNumber } = await params;
  const user = await requireUser();

  const order = await prisma.order.findUnique({
    where: { orderNumber },
    select: {
      orderNumber: true,
      status: true,
      source: true,
      customerId: true,
      subtotalCents: true,
      discountCents: true,
      totalCents: true,
      contactName: true,
      contactPhone: true,
      city: true,
      shippingAddress: true,
      notes: true,
      paymentMethod: true,
      paymentStatus: true,
      createdAt: true,
      items: {
        select: {
          id: true,
          quantity: true,
          unitPriceCents: true,
          totalCents: true,
          product: {
            select: {
              sku: true,
              name: true,
              nameAr: true,
              images: {
                select: { url: true, altText: true },
                orderBy: [{ isMain: "desc" }, { sortOrder: "asc" }],
                take: 1,
              },
            },
          },
        },
      },
    },
  });

  if (!order || order.customerId !== user.id) {
    notFound();
  }

  const isWholesaleOrder = order.source === ORDER_SOURCES.WHOLESALE;

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10">
        <div className="animate-fade-in flex flex-wrap items-start justify-between gap-4 rounded-card border border-navy-soft bg-navy-surface p-6 shadow-card">
          <div>
            <h1 className="text-xl font-semibold text-neutral-bg">طلب {order.orderNumber}</h1>
            <p className="mt-1 text-sm text-neutral-bg/60">
              {new Date(order.createdAt).toLocaleDateString("ar")}
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <div className="flex flex-wrap items-center justify-end gap-2">
              {isWholesaleOrder && <Badge variant="gold">جملة</Badge>}
              <Badge variant={getOrderStatusBadgeVariant(order.status)}>
                {getOrderStatusLabel(order.status)}
              </Badge>
              <Badge variant={getPaymentStatusBadgeVariant(order.paymentStatus)}>
                {getPaymentStatusLabel(order.paymentStatus)}
              </Badge>
            </div>
            <span className="text-lg font-semibold text-gold-champagne">
              {formatCurrencyFromCents(order.totalCents)}
            </span>
          </div>
        </div>

        <Card className="animate-fade-in">
          <CardHeader>
            <CardTitle>حالة الطلب</CardTitle>
          </CardHeader>
          <CardContent>
            <OrderStatusTimeline status={order.status} />
          </CardContent>
        </Card>

        <Card className="animate-fade-in">
          <CardHeader>
            <CardTitle>المنتجات</CardTitle>
          </CardHeader>
          <CardContent>
            <OrderItemsList items={order.items} isWholesaleOrder={isWholesaleOrder} />
            <div className="mt-4 border-t border-navy-soft pt-4">
              <OrderSummaryCard
                subtotalCents={order.subtotalCents}
                discountCents={order.discountCents}
                totalCents={order.totalCents}
              />
            </div>
          </CardContent>
        </Card>

        <Card className="animate-fade-in">
          <CardHeader>
            <CardTitle>بيانات التوصيل والدفع</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-neutral-bg/50">الاسم</dt>
                <dd className="text-neutral-bg">{order.contactName ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-neutral-bg/50">الهاتف</dt>
                <dd className="text-neutral-bg">{order.contactPhone ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-neutral-bg/50">المدينة / المنطقة</dt>
                <dd className="text-neutral-bg">{order.city ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-neutral-bg/50">العنوان</dt>
                <dd className="text-neutral-bg">{order.shippingAddress ?? "—"}</dd>
              </div>
              {order.notes && (
                <div className="sm:col-span-2">
                  <dt className="text-neutral-bg/50">ملاحظات</dt>
                  <dd className="text-neutral-bg">{order.notes}</dd>
                </div>
              )}
              <div>
                <dt className="text-neutral-bg/50">طريقة الدفع</dt>
                <dd className="text-neutral-bg">{getPaymentMethodLabel(order.paymentMethod)}</dd>
              </div>
              <div>
                <dt className="text-neutral-bg/50">حالة الدفع</dt>
                <dd className="text-neutral-bg">{getPaymentStatusLabel(order.paymentStatus)}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        <div className="flex flex-wrap items-center gap-3">
          <Link href="/orders">
            <Button variant="secondary">العودة إلى طلباتي</Button>
          </Link>
          <Link href="/products">
            <Button variant="outline">متابعة التسوق</Button>
          </Link>
        </div>
      </main>
      <Footer />
    </div>
  );
}
