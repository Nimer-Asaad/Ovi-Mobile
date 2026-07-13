import Link from "next/link";
import { requireRole } from "@/lib/auth/guards";
import { ROLES } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { StatCard } from "@/components/ui/StatCard";
import { LogoutButton } from "@/components/auth/LogoutButton";
import { getRepStockStats } from "@/lib/reps";
import { getMovementTypeLabel, getMovementTypeBadgeVariant } from "@/lib/inventory-labels";
import { formatCurrencyFromCents } from "@/lib/utils";
import { ORDER_SOURCES } from "@/lib/constants";
import { RepCarHero } from "@/components/reps/RepCarHero";
import { RepStockRequestStatusBadge } from "@/components/reps/RepStockRequestStatusBadge";
import { getActiveRequestCountForRep, getLatestRequestsForRep } from "@/lib/rep-stock-requests";

export default async function RepDashboardPage() {
  const user = await requireRole([ROLES.SALES_REPRESENTATIVE]);

  const rep = await prisma.salesRepresentative.findUnique({
    where: { userId: user.id },
    select: { id: true, carStockLocation: { select: { id: true } } },
  });

  const locationId = rep?.carStockLocation?.id ?? null;
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const [stats, recentMovements, todaySalesCount, todaySalesAgg, totalSalesCount, totalSalesAgg, activeRequestCount, latestRequests] =
    await Promise.all([
      getRepStockStats(locationId),
      locationId
        ? prisma.stockMovement.findMany({
            where: { OR: [{ fromLocationId: locationId }, { toLocationId: locationId }] },
            orderBy: { createdAt: "desc" },
            take: 5,
            select: {
              id: true,
              type: true,
              quantity: true,
              createdAt: true,
              product: { select: { sku: true, name: true, nameAr: true } },
            },
          })
        : Promise.resolve([]),
      rep
        ? prisma.order.count({
            where: { createdByRepId: rep.id, source: ORDER_SOURCES.REP_SALE, createdAt: { gte: startOfToday } },
          })
        : Promise.resolve(0),
      rep
        ? prisma.order.aggregate({
            where: { createdByRepId: rep.id, source: ORDER_SOURCES.REP_SALE, createdAt: { gte: startOfToday } },
            _sum: { totalCents: true },
          })
        : Promise.resolve({ _sum: { totalCents: 0 } }),
      rep
        ? prisma.order.count({ where: { createdByRepId: rep.id, source: ORDER_SOURCES.REP_SALE } })
        : Promise.resolve(0),
      rep
        ? prisma.order.aggregate({
            where: { createdByRepId: rep.id, source: ORDER_SOURCES.REP_SALE },
            _sum: { totalCents: true },
          })
        : Promise.resolve({ _sum: { totalCents: 0 } }),
      rep ? getActiveRequestCountForRep(rep.id) : Promise.resolve(0),
      rep ? getLatestRequestsForRep(rep.id, 3) : Promise.resolve([]),
    ]);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-neutral-bg">لوحة تحكم المندوب</h1>
          <p className="mt-1 text-sm text-neutral-bg/60">مرحباً، {user.name}</p>
        </div>
        <LogoutButton />
      </div>

      <RepCarHero subtitle="هذه سيارتك — كل ما تم تحميله لك من المستودع الرئيسي تجده هنا" />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="إجمالي الوحدات المخصصة" value={String(stats.totalUnits)} />
        <StatCard label="عدد المنتجات المختلفة" value={String(stats.distinctProducts)} />
        <StatCard
          label="مخزون منخفض"
          value={String(stats.lowStockCount)}
          badge={{
            text: stats.lowStockCount > 0 ? "تنبيه" : "جيد",
            variant: stats.lowStockCount > 0 ? "warning" : "success",
          }}
        />
        <StatCard label="طلبات مخزون نشطة" value={String(activeRequestCount)} />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="مبيعات اليوم" value={String(todaySalesCount)} />
        <StatCard label="إجمالي مبيعات اليوم" value={formatCurrencyFromCents(todaySalesAgg._sum.totalCents ?? 0)} />
        <StatCard label="إجمالي عدد المبيعات" value={String(totalSalesCount)} />
        <StatCard label="إجمالي قيمة المبيعات" value={formatCurrencyFromCents(totalSalesAgg._sum.totalCents ?? 0)} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>آخر الحركات</CardTitle>
        </CardHeader>
        <CardContent>
          {recentMovements.length === 0 ? (
            <p className="text-sm text-neutral-bg/60">لا توجد حركات مخزون بعد.</p>
          ) : (
            <div className="flex flex-col divide-y divide-navy-soft">
              {recentMovements.map((movement) => (
                <div key={movement.id} className="flex items-center justify-between py-2 first:pt-0 last:pb-0">
                  <div>
                    <p className="text-sm text-neutral-bg">{movement.product.nameAr ?? movement.product.name}</p>
                    <p className="text-xs text-neutral-bg/50">
                      {movement.product.sku} — {new Date(movement.createdAt).toLocaleDateString("ar")}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={getMovementTypeBadgeVariant(movement.type)}>
                      {getMovementTypeLabel(movement.type)}
                    </Badge>
                    <span className="text-sm text-neutral-bg/70">{movement.quantity}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>طلبات تزويد المخزون</CardTitle>
        </CardHeader>
        <CardContent>
          {latestRequests.length === 0 ? (
            <p className="text-sm text-neutral-bg/60">لم ترسل أي طلب تزويد مخزون بعد.</p>
          ) : (
            <div className="flex flex-col divide-y divide-navy-soft">
              {latestRequests.map((request) => (
                <Link
                  key={request.id}
                  href={`/rep/requests/${request.id}`}
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

      <div className="flex flex-wrap gap-3">
        <Link href="/rep/sales/new">
          <Button>بيع جديد</Button>
        </Link>
        <Link href="/rep/sales">
          <Button variant="outline">مبيعاتي</Button>
        </Link>
        <Link href="/rep/requests/new">
          <Button variant="outline">طلب تزويد مخزون</Button>
        </Link>
        <Link href="/rep/requests">
          <Button variant="outline">طلباتي</Button>
        </Link>
        <Link href="/rep/stock">
          <Button variant="outline">عرض مخزون السيارة</Button>
        </Link>
        <Link href="/rep/movements">
          <Button variant="outline">سجل الحركات الكامل</Button>
        </Link>
      </div>
    </div>
  );
}
