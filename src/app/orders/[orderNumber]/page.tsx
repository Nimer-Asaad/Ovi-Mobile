import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { ProductImagePlaceholder } from "@/components/catalog/ProductImagePlaceholder";
import { formatCurrencyFromCents } from "@/lib/utils";

const ORDER_STATUS_LABELS: Record<string, string> = {
  PENDING: "قيد الانتظار",
  CONFIRMED: "مؤكد",
  PROCESSING: "قيد التجهيز",
  SHIPPED: "تم الشحن",
  DELIVERED: "تم التوصيل",
  CANCELLED: "ملغي",
  RETURNED: "مرتجع",
};

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  CASH_ON_DELIVERY: "الدفع عند الاستلام",
};

const PAYMENT_STATUS_LABELS: Record<string, string> = {
  PENDING: "قيد الانتظار",
  PAID: "مدفوع",
  FAILED: "فشل الدفع",
};

interface OrderDetailPageProps {
  params: Promise<{ orderNumber: string }>;
}

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

  const isWholesaleOrder = order.source === "WHOLESALE";

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-neutral-bg">طلب {order.orderNumber}</h1>
          <p className="mt-1 text-sm text-neutral-bg/60">
            {new Date(order.createdAt).toLocaleDateString("ar")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isWholesaleOrder && <Badge variant="gold">جملة</Badge>}
          <Badge variant={order.status === "PENDING" ? "warning" : "neutral"}>
            {ORDER_STATUS_LABELS[order.status] ?? order.status}
          </Badge>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>المنتجات</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col divide-y divide-navy-soft">
            {order.items.map((item) => {
              const thumbnail = item.product.images[0];
              return (
                <div key={item.id} className="flex items-center gap-4 py-3 first:pt-0 last:pb-0">
                  <div className="h-14 w-14 shrink-0 overflow-hidden rounded-card bg-navy-soft">
                    {thumbnail ? (
                      // eslint-disable-next-line @next/next/no-img-element -- arbitrary admin-entered external URLs
                      <img
                        src={thumbnail.url}
                        alt={thumbnail.altText ?? item.product.name}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <ProductImagePlaceholder className="h-full w-full" />
                    )}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-neutral-bg">
                      {item.product.nameAr ?? item.product.name}
                    </p>
                    <p className="text-xs text-neutral-bg/50">{item.product.sku}</p>
                    <p className="text-xs text-neutral-bg/60">
                      {formatCurrencyFromCents(item.unitPriceCents)}
                      {isWholesaleOrder && " (سعر الجملة)"} × {item.quantity}
                    </p>
                  </div>
                  <span className="font-semibold text-neutral-bg">
                    {formatCurrencyFromCents(item.totalCents)}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="mt-4 flex flex-col gap-1 border-t border-navy-soft pt-4 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-neutral-bg/70">المجموع الفرعي</span>
              <span className="text-neutral-bg">{formatCurrencyFromCents(order.subtotalCents)}</span>
            </div>
            {order.discountCents > 0 && (
              <div className="flex items-center justify-between">
                <span className="text-neutral-bg/70">الخصم</span>
                <span className="text-neutral-bg">-{formatCurrencyFromCents(order.discountCents)}</span>
              </div>
            )}
            <div className="flex items-center justify-between text-base font-semibold">
              <span className="text-neutral-bg">الإجمالي</span>
              <span className="text-gold-champagne">{formatCurrencyFromCents(order.totalCents)}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>بيانات التوصيل والدفع</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
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
              <dd className="text-neutral-bg">{PAYMENT_METHOD_LABELS[order.paymentMethod] ?? order.paymentMethod}</dd>
            </div>
            <div>
              <dt className="text-neutral-bg/50">حالة الدفع</dt>
              <dd className="text-neutral-bg">{PAYMENT_STATUS_LABELS[order.paymentStatus] ?? order.paymentStatus}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>
      </main>
      <Footer />
    </div>
  );
}
