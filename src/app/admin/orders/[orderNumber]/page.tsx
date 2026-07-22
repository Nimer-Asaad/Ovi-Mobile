import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ProductImagePlaceholder } from "@/components/catalog/ProductImagePlaceholder";
import { formatCurrencyFromCents } from "@/lib/utils";
import { ORDER_SOURCES } from "@/lib/constants";
import { getOrderStatusLabel, getOrderStatusBadgeVariant, getOrderSourceLabel } from "@/lib/order-labels";
import { getValidNextOrderStatuses, isTerminalOrderStatus } from "@/lib/order-lifecycle";
import { OrderStatusForm } from "../OrderStatusForm";
import { PaymentStatusForm } from "../PaymentStatusForm";

interface AdminOrderDetailPageProps {
  params: Promise<{ orderNumber: string }>;
}

export default async function AdminOrderDetailPage({ params }: AdminOrderDetailPageProps) {
  const { orderNumber } = await params;

  const order = await prisma.order.findUnique({
    where: { orderNumber },
    select: {
      orderNumber: true,
      status: true,
      source: true,
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
      paidAmountCents: true,
      inventoryRestoredAt: true,
      createdAt: true,
      updatedAt: true,
      stockLocation: { select: { name: true } },
      inventoryCompensation: { select: { type: true, createdAt: true } },
      statusHistory: {
        select: {
          fromStatus: true,
          toStatus: true,
          reason: true,
          createdAt: true,
          changedBy: { select: { name: true } },
        },
        orderBy: { createdAt: "asc" },
      },
      customer: { select: { name: true, email: true } },
      merchant: { select: { businessName: true, taxId: true, status: true } },
      createdByRep: { select: { employeeCode: true, user: { select: { name: true, phone: true } } } },
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

  if (!order) {
    notFound();
  }

  const isWholesaleOrder = order.source === ORDER_SOURCES.WHOLESALE;
  const isRepSale = order.source === ORDER_SOURCES.REP_SALE;
  const validNextStatuses = getValidNextOrderStatuses(order.status, order.source);
  const isTerminal = isTerminalOrderStatus(order.status);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-neutral-bg">طلب {order.orderNumber}</h2>
          <p className="mt-1 text-sm text-neutral-bg/60">
            أُنشئ في {new Date(order.createdAt).toLocaleDateString("ar")}
            {order.updatedAt.getTime() !== order.createdAt.getTime() && (
              <> — آخر تحديث {new Date(order.updatedAt).toLocaleDateString("ar")}</>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={isWholesaleOrder ? "gold" : "neutral"}>{getOrderSourceLabel(order.source)}</Badge>
          <Badge variant={getOrderStatusBadgeVariant(order.status)}>{getOrderStatusLabel(order.status)}</Badge>
          <Link href={`/admin/orders/${order.orderNumber}/invoice`}>
            <Button variant="outline" size="sm">
              طباعة الفاتورة
            </Button>
          </Link>
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
                    loading="lazy"
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
            <div className="mt-2 flex items-center justify-between border-t border-navy-soft pt-2">
              <span className="text-neutral-bg/70">المبلغ المستلم</span>
              <span className="text-neutral-bg">{formatCurrencyFromCents(order.paidAmountCents)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-neutral-bg/70">المتبقي</span>
              <span
                className={
                  order.totalCents - order.paidAmountCents > 0
                    ? "font-semibold text-rose-600"
                    : "text-neutral-bg"
                }
              >
                {formatCurrencyFromCents(Math.max(order.totalCents - order.paidAmountCents, 0))}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>معلومات العميل</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-1 gap-2 text-sm">
              <div>
                <dt className="text-neutral-bg/50">اسم الحساب</dt>
                <dd className="text-neutral-bg">{order.customer?.name ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-neutral-bg/50">البريد الإلكتروني</dt>
                <dd className="text-neutral-bg">{order.customer?.email ?? "—"}</dd>
              </div>
              {isWholesaleOrder && order.merchant && (
                <>
                  <div>
                    <dt className="text-neutral-bg/50">اسم النشاط التجاري</dt>
                    <dd className="text-neutral-bg">{order.merchant.businessName}</dd>
                  </div>
                  {order.merchant.taxId && (
                    <div>
                      <dt className="text-neutral-bg/50">الرقم الضريبي</dt>
                      <dd className="text-neutral-bg">{order.merchant.taxId}</dd>
                    </div>
                  )}
                </>
              )}
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>بيانات التوصيل</CardTitle>
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
            </dl>
          </CardContent>
        </Card>
      </div>

      {isRepSale && order.createdByRep && (
        <Card>
          <CardHeader>
            <CardTitle>معلومات المندوب</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-neutral-bg/50">اسم المندوب</dt>
                <dd className="text-neutral-bg">{order.createdByRep.user.name}</dd>
              </div>
              <div>
                <dt className="text-neutral-bg/50">الرقم الوظيفي</dt>
                <dd className="text-neutral-bg">{order.createdByRep.employeeCode}</dd>
              </div>
              {order.createdByRep.user.phone && (
                <div>
                  <dt className="text-neutral-bg/50">هاتف المندوب</dt>
                  <dd className="text-neutral-bg">{order.createdByRep.user.phone}</dd>
                </div>
              )}
            </dl>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>سلامة دورة الطلب والمخزون</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-neutral-bg/50">موقع المخزون الأصلي</dt>
              <dd className="text-neutral-bg">{order.stockLocation?.name ?? "غير مسجل (طلب قديم)"}</dd>
            </div>
            <div>
              <dt className="text-neutral-bg/50">حالة المخزون</dt>
              <dd className="text-neutral-bg">
                {order.inventoryRestoredAt ? "تم استرجاع المخزون" : "لم يتم استرجاع المخزون"}
              </dd>
            </div>
            <div>
              <dt className="text-neutral-bg/50">دورة الحالة</dt>
              <dd className="text-neutral-bg">{isTerminal ? "حالة نهائية" : "نشطة"}</dd>
            </div>
          </dl>
          {!order.stockLocation && !order.inventoryRestoredAt && (
            <p className="mt-4 rounded-card border border-amber-300/50 bg-amber-50 p-3 text-sm text-amber-800">
              هذا طلب قديم لا يحتوي على موقع المخزون الأصلي. سيُمنع الإلغاء أو الإرجاع الآلي حتى تتم مراجعة المخزون يدويًا.
            </p>
          )}
          {order.inventoryRestoredAt && (
            <p className="mt-3 text-xs text-neutral-bg/60">
              تاريخ الاسترجاع: {new Date(order.inventoryRestoredAt).toLocaleString("ar")}
              {order.inventoryCompensation ? ` · نوع الحركة: ${order.inventoryCompensation.type}` : ""}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>سجل حالات الطلب</CardTitle>
        </CardHeader>
        <CardContent>
          {order.statusHistory.length === 0 ? (
            <p className="text-sm text-neutral-bg/60">لا توجد انتقالات مسجلة لهذا الطلب حتى الآن.</p>
          ) : (
            <ol className="flex flex-col gap-3">
              {order.statusHistory.map((entry, index) => (
                <li key={`${entry.createdAt.toISOString()}-${index}`} className="rounded-card border border-navy-soft p-3 text-sm">
                  <p className="font-medium text-neutral-bg">
                    {getOrderStatusLabel(entry.fromStatus)} ← {getOrderStatusLabel(entry.toStatus)}
                  </p>
                  <p className="mt-1 text-xs text-neutral-bg/60">
                    بواسطة {entry.changedBy.name} · {new Date(entry.createdAt).toLocaleString("ar")}
                  </p>
                  {entry.reason && <p className="mt-2 text-sm text-neutral-bg/80">السبب: {entry.reason}</p>}
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>إدارة الحالة</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <OrderStatusForm
              orderNumber={order.orderNumber}
              currentStatus={order.status}
              validNextStatuses={validNextStatuses}
              paymentStatus={order.paymentStatus}
            />
            <PaymentStatusForm orderNumber={order.orderNumber} currentStatus={order.paymentStatus} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
