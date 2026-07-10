import Link from "next/link";
import { requireRole } from "@/lib/auth/guards";
import { ROLES } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { LogoutButton } from "@/components/auth/LogoutButton";
import { getRepStockStats } from "@/lib/reps";
import { getMovementTypeLabel, getMovementTypeBadgeVariant } from "@/lib/inventory-labels";
import { formatCurrencyFromCents } from "@/lib/utils";
import { ORDER_SOURCES } from "@/lib/constants";

export default async function RepDashboardPage() {
  const user = await requireRole([ROLES.SALES_REPRESENTATIVE]);

  const rep = await prisma.salesRepresentative.findUnique({
    where: { userId: user.id },
    select: { id: true, carStockLocation: { select: { id: true } } },
  });

  const locationId = rep?.carStockLocation?.id ?? null;
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const [stats, recentMovements, todaySalesCount, todaySalesAgg, totalSalesCount, totalSalesAgg] =
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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>إجمالي الوحدات المخصصة</CardTitle>
          </CardHeader>
          <CardContent>
            <span className="text-2xl font-semibold text-neutral-bg">{stats.totalUnits}</span>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>عدد المنتجات المختلفة</CardTitle>
          </CardHeader>
          <CardContent>
            <span className="text-2xl font-semibold text-neutral-bg">{stats.distinctProducts}</span>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>مخزون منخفض</CardTitle>
            <Badge variant={stats.lowStockCount > 0 ? "warning" : "success"}>
              {stats.lowStockCount > 0 ? "تنبيه" : "جيد"}
            </Badge>
          </CardHeader>
          <CardContent>
            <span className="text-2xl font-semibold text-neutral-bg">{stats.lowStockCount}</span>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader>
            <CardTitle>مبيعات اليوم</CardTitle>
          </CardHeader>
          <CardContent>
            <span className="text-2xl font-semibold text-neutral-bg">{todaySalesCount}</span>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>إجمالي مبيعات اليوم</CardTitle>
          </CardHeader>
          <CardContent>
            <span className="text-2xl font-semibold text-neutral-bg">
              {formatCurrencyFromCents(todaySalesAgg._sum.totalCents ?? 0)}
            </span>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>إجمالي عدد المبيعات</CardTitle>
          </CardHeader>
          <CardContent>
            <span className="text-2xl font-semibold text-neutral-bg">{totalSalesCount}</span>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>إجمالي قيمة المبيعات</CardTitle>
          </CardHeader>
          <CardContent>
            <span className="text-2xl font-semibold text-neutral-bg">
              {formatCurrencyFromCents(totalSalesAgg._sum.totalCents ?? 0)}
            </span>
          </CardContent>
        </Card>
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

      <div className="flex flex-wrap gap-3">
        <Link href="/rep/sales/new">
          <Button>بيع جديد</Button>
        </Link>
        <Link href="/rep/sales">
          <Button variant="outline">مبيعاتي</Button>
        </Link>
        <Link href="/rep/stock">
          <Button variant="outline">عرض مخزوني</Button>
        </Link>
        <Link href="/rep/movements">
          <Button variant="outline">سجل الحركات الكامل</Button>
        </Link>
      </div>
    </div>
  );
}
