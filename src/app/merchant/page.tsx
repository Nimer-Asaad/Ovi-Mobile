import Link from "next/link";
import { requireApprovedMerchant } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { StatCard } from "@/components/ui/StatCard";
import { LogoutButton } from "@/components/auth/LogoutButton";
import { formatCurrencyFromCents } from "@/lib/utils";
import { getOrderStatusLabel, getOrderStatusBadgeVariant } from "@/lib/order-labels";

export default async function MerchantDashboardPage() {
  const user = await requireApprovedMerchant();

  const merchant = await prisma.merchant.findUnique({
    where: { userId: user.id },
    select: { id: true },
  });

  const orders = merchant
    ? await prisma.order.findMany({
        where: { merchantId: merchant.id },
        orderBy: { createdAt: "desc" },
        select: { orderNumber: true, status: true, totalCents: true, createdAt: true },
      })
    : [];

  const totalOrders = orders.length;
  const totalValueCents = orders.reduce((sum, order) => sum + order.totalCents, 0);
  const recentOrders = orders.slice(0, 5);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-neutral-bg">لوحة تحكم التاجر</h1>
          <p className="mt-1 text-sm text-neutral-bg/60">مرحباً، {user.name}</p>
        </div>
        <LogoutButton />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>حالة الحساب</CardTitle>
          <Badge variant="success">معتمد</Badge>
        </CardHeader>
        <CardContent>
          حسابك معتمد ويمكنك الشراء بأسعار الجملة وتصفح سجل طلباتك.
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <StatCard label="إجمالي الطلبات" value={String(totalOrders)} />
        <StatCard label="إجمالي قيمة الطلبات" value={formatCurrencyFromCents(totalValueCents)} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>آخر الطلبات</CardTitle>
        </CardHeader>
        <CardContent>
          {recentOrders.length === 0 ? (
            <p className="text-sm text-neutral-bg/60">لا توجد طلبات بعد.</p>
          ) : (
            <div className="flex flex-col divide-y divide-navy-soft">
              {recentOrders.map((order) => (
                <div key={order.orderNumber} className="flex items-center justify-between py-2 first:pt-0 last:pb-0">
                  <div>
                    <p className="text-sm text-neutral-bg">{order.orderNumber}</p>
                    <p className="text-xs text-neutral-bg/50">
                      {new Date(order.createdAt).toLocaleDateString("ar")}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={getOrderStatusBadgeVariant(order.status)}>
                      {getOrderStatusLabel(order.status)}
                    </Badge>
                    <span className="text-sm text-neutral-bg/70">
                      {formatCurrencyFromCents(order.totalCents)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-3">
        <Link href="/merchant/orders">
          <Button>طلباتي</Button>
        </Link>
        <Link href="/products">
          <Button variant="outline">تصفح المنتجات</Button>
        </Link>
      </div>
    </div>
  );
}
