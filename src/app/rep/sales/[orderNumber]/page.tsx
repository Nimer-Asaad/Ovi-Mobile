import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/guards";
import { ROLES } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { ProductImagePlaceholder } from "@/components/catalog/ProductImagePlaceholder";
import { formatCurrencyFromCents } from "@/lib/utils";
import {
  getOrderStatusLabel,
  getOrderStatusBadgeVariant,
  getPaymentMethodLabel,
  getPaymentStatusLabel,
  getPaymentStatusBadgeVariant,
} from "@/lib/order-labels";
import { getMovementTypeLabel, getMovementTypeBadgeVariant } from "@/lib/inventory-labels";

interface RepSaleDetailPageProps {
  params: Promise<{ orderNumber: string }>;
}

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
      status: true,
      createdByRepId: true,
      subtotalCents: true,
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

  if (!order || !rep || order.createdByRepId !== rep.id) {
    notFound();
  }

  const movement = await prisma.stockMovement.findFirst({
    where: { note: { contains: orderNumber } },
    select: { type: true, quantity: true, previousQuantity: true, newQuantity: true, createdAt: true },
  });

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-neutral-bg">طلب {order.orderNumber}</h1>
          <p className="mt-1 text-sm text-neutral-bg/60">
            أُنشئ في {new Date(order.createdAt).toLocaleDateString("ar")}
          </p>
        </div>
        <Badge variant={getOrderStatusBadgeVariant(order.status)}>{getOrderStatusLabel(order.status)}</Badge>
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
                      {formatCurrencyFromCents(item.unitPriceCents)} × {item.quantity}
                    </p>
                  </div>
                  <span className="font-semibold text-neutral-bg">
                    {formatCurrencyFromCents(item.totalCents)}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="mt-4 flex items-center justify-between border-t border-navy-soft pt-4 text-base font-semibold">
            <span className="text-neutral-bg">الإجمالي</span>
            <span className="text-gold-champagne">{formatCurrencyFromCents(order.totalCents)}</span>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>معلومات العميل</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-1 gap-2 text-sm">
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
                <div>
                  <dt className="text-neutral-bg/50">ملاحظات</dt>
                  <dd className="text-neutral-bg">{order.notes}</dd>
                </div>
              )}
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>الدفع</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-1 gap-2 text-sm">
              <div>
                <dt className="text-neutral-bg/50">طريقة الدفع</dt>
                <dd className="text-neutral-bg">{getPaymentMethodLabel(order.paymentMethod)}</dd>
              </div>
              <div>
                <dt className="text-neutral-bg/50">حالة الدفع</dt>
                <dd>
                  <Badge variant={getPaymentStatusBadgeVariant(order.paymentStatus)}>
                    {getPaymentStatusLabel(order.paymentStatus)}
                  </Badge>
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      </div>

      {movement && (
        <Card>
          <CardHeader>
            <CardTitle>حركة المخزون المرتبطة</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-center gap-4 text-sm">
              <Badge variant={getMovementTypeBadgeVariant(movement.type)}>
                {getMovementTypeLabel(movement.type)}
              </Badge>
              <span className="text-neutral-bg/70">الكمية: {movement.quantity}</span>
              <span className="text-neutral-bg/70">
                السابق: {movement.previousQuantity ?? "—"} ← الجديد: {movement.newQuantity ?? "—"}
              </span>
              <span className="text-neutral-bg/70">{new Date(movement.createdAt).toLocaleString("ar")}</span>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
