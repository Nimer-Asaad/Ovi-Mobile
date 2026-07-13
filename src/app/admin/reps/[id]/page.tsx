import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { AdminStatusBadge } from "@/components/admin/AdminStatusBadge";
import { getRepStockStats, getRepStockValueCents } from "@/lib/reps";
import { RepCarHero } from "@/components/reps/RepCarHero";
import { RepCarStockSummary } from "@/components/reps/RepCarStockSummary";
import { RepCarProductGrid } from "@/components/reps/RepCarProductGrid";
import { RepTransferHistory } from "@/components/reps/RepTransferHistory";
import { RepStockRequestStatusBadge } from "@/components/reps/RepStockRequestStatusBadge";
import { getActiveRequestCountForRep, getLatestRequestsForRep } from "@/lib/rep-stock-requests";
import { ORDER_SOURCES } from "@/lib/constants";
import { formatCurrencyFromCents } from "@/lib/utils";

interface AdminRepDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function AdminRepDetailPage({ params }: AdminRepDetailPageProps) {
  const { id } = await params;

  const rep = await prisma.salesRepresentative.findUnique({
    where: { id },
    select: {
      id: true,
      employeeCode: true,
      isActive: true,
      user: { select: { name: true, email: true, phone: true, isActive: true } },
      carStockLocation: { select: { id: true, name: true } },
    },
  });

  if (!rep) {
    notFound();
  }

  const locationId = rep.carStockLocation?.id ?? null;
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const [
    stats,
    valueCents,
    stockItems,
    movements,
    activeRequestCount,
    latestRequests,
    todaySales,
    todaySalesAgg,
  ] = await Promise.all([
    getRepStockStats(locationId),
    getRepStockValueCents(locationId),
    locationId
      ? prisma.inventoryItem.findMany({
          where: { locationId, quantity: { gt: 0 } },
          orderBy: { updatedAt: "desc" },
          select: {
            quantity: true,
            product: {
              select: {
                id: true,
                sku: true,
                name: true,
                nameAr: true,
                category: { select: { name: true, nameAr: true } },
                brand: { select: { name: true } },
                images: {
                  select: { url: true, altText: true },
                  orderBy: [{ isMain: "desc" }, { sortOrder: "asc" }],
                  take: 1,
                },
              },
            },
          },
        })
      : Promise.resolve([]),
    locationId
      ? prisma.stockMovement.findMany({
          where: { OR: [{ fromLocationId: locationId }, { toLocationId: locationId }] },
          orderBy: { createdAt: "desc" },
          take: 20,
          select: {
            id: true,
            type: true,
            quantity: true,
            note: true,
            createdAt: true,
            product: { select: { sku: true, name: true, nameAr: true } },
          },
        })
      : Promise.resolve([]),
    getActiveRequestCountForRep(rep.id),
    getLatestRequestsForRep(rep.id, 5),
    prisma.order.findMany({
      where: { createdByRepId: rep.id, source: ORDER_SOURCES.REP_SALE, createdAt: { gte: startOfToday } },
      orderBy: { createdAt: "desc" },
      select: { orderNumber: true, totalCents: true, contactName: true, createdAt: true },
    }),
    prisma.order.aggregate({
      where: { createdByRepId: rep.id, source: ORDER_SOURCES.REP_SALE, createdAt: { gte: startOfToday } },
      _sum: { totalCents: true },
    }),
  ]);

  const gridItems = stockItems.map((item) => ({
    productId: item.product.id,
    sku: item.product.sku,
    name: item.product.name,
    nameAr: item.product.nameAr,
    quantity: item.quantity,
    categoryLabel: item.product.category?.nameAr ?? item.product.category?.name ?? null,
    brandLabel: item.product.brand?.name ?? null,
    thumbnailUrl: item.product.images[0]?.url ?? null,
    thumbnailAlt: item.product.images[0]?.altText ?? null,
  }));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={rep.user.name}
        subtitle={rep.employeeCode}
        actions={
          <>
            <AdminStatusBadge isActive={rep.isActive && rep.user.isActive} />
            <Link href={`/admin/rep-requests?salesRepId=${rep.id}`}>
              <Button variant="outline">طلبات المندوب</Button>
            </Link>
            <Link href={`/admin/reps/${rep.id}/assign-stock`}>
              <Button>تعبئة مباشرة</Button>
            </Link>
            <Link href={`/admin/reps/${rep.id}/return-stock`}>
              <Button variant="outline">إرجاع من السيارة</Button>
            </Link>
          </>
        }
      />

      <RepCarHero subtitle={`مخزون ${rep.user.name} المتنقل — كل ما تم تحميله من المستودع الرئيسي إلى سيارته`} />

      <RepCarStockSummary
        totalUnits={stats.totalUnits}
        distinctProducts={stats.distinctProducts}
        lowStockCount={stats.lowStockCount}
        valueCents={valueCents}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <StatCard label="طلبات مخزون نشطة" value={String(activeRequestCount)} />
        <StatCard label="عدد مبيعات اليوم" value={String(todaySales.length)} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>معلومات المندوب</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-neutral-bg/50">البريد الإلكتروني</dt>
              <dd className="text-neutral-bg">{rep.user.email}</dd>
            </div>
            <div>
              <dt className="text-neutral-bg/50">الهاتف</dt>
              <dd className="text-neutral-bg">{rep.user.phone ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-neutral-bg/50">موقع المخزون</dt>
              <dd className="text-neutral-bg">{rep.carStockLocation?.name ?? "لم يُخصص بعد"}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>طلبات مخزون السيارة</CardTitle>
            <Link href={`/admin/rep-requests?salesRepId=${rep.id}`} className="text-sm text-gold-champagne hover:underline">
              عرض الكل
            </Link>
          </CardHeader>
          <CardContent>
            {latestRequests.length === 0 ? (
              <p className="py-6 text-center text-sm text-neutral-bg/50">لا توجد طلبات بعد</p>
            ) : (
              <div className="flex flex-col divide-y divide-navy-soft">
                {latestRequests.map((request) => (
                  <Link
                    key={request.id}
                    href={`/admin/rep-requests/${request.id}`}
                    className="flex items-center justify-between py-2 first:pt-0 last:pb-0 hover:opacity-80"
                  >
                    <div>
                      <p className="text-sm text-neutral-bg">{request.requestNumber ?? request.id}</p>
                      <p className="text-xs text-neutral-bg/50">
                        {new Date(request.createdAt).toLocaleDateString("ar")} — {request.itemCount} منتج
                      </p>
                    </div>
                    <RepStockRequestStatusBadge status={request.status} />
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>مبيعات اليوم</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-3 text-sm text-neutral-bg/70">
              {todaySales.length} طلب — إجمالي {formatCurrencyFromCents(todaySalesAgg._sum.totalCents ?? 0)}
            </p>
            {todaySales.length === 0 ? (
              <p className="py-6 text-center text-sm text-neutral-bg/50">لا توجد مبيعات اليوم بعد</p>
            ) : (
              <div className="flex flex-col divide-y divide-navy-soft">
                {todaySales.map((order) => (
                  <Link
                    key={order.orderNumber}
                    href={`/admin/orders/${order.orderNumber}`}
                    className="flex items-center justify-between py-2 first:pt-0 last:pb-0 hover:opacity-80"
                  >
                    <div>
                      <p className="text-sm text-neutral-bg">{order.orderNumber}</p>
                      <p className="text-xs text-neutral-bg/50">{order.contactName ?? "—"}</p>
                    </div>
                    <span className="text-sm text-neutral-bg">{formatCurrencyFromCents(order.totalCents)}</span>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <RepCarProductGrid items={gridItems} />

      <RepTransferHistory movements={movements} repIdForInvoiceLinks={rep.id} />
    </div>
  );
}
