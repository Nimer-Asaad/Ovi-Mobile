import Link from "next/link";
import { requireUser } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatCurrencyFromCents } from "@/lib/utils";
import {
  getOrderStatusLabel,
  getOrderStatusBadgeVariant,
  getPaymentStatusLabel,
  getPaymentStatusBadgeVariant,
} from "@/lib/order-labels";
import { ORDER_SOURCES } from "@/lib/constants";

export default async function OrdersPage() {
  const user = await requireUser();

  const orders = await prisma.order.findMany({
    where: { customerId: user.id },
    orderBy: { createdAt: "desc" },
    select: {
      orderNumber: true,
      status: true,
      paymentStatus: true,
      totalCents: true,
      createdAt: true,
      source: true,
      _count: { select: { items: true } },
    },
  });

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-10">
        <PageHeader as="h1" title="طلباتي" subtitle="سجل جميع طلباتك السابقة والحالية" />

        {orders.length === 0 ? (
          <EmptyState
            title="لا توجد طلبات بعد"
            message="لم تقم بأي طلب حتى الآن. تصفح كتالوج المنتجات وابدأ التسوق."
            action={
              <Link href="/products">
                <Button variant="outline">تصفح المنتجات</Button>
              </Link>
            }
          />
        ) : (
          <div className="flex animate-fade-in flex-col gap-4">
            {orders.map((order) => (
              <Link key={order.orderNumber} href={`/orders/${order.orderNumber}`}>
                <Card className="transition-all hover:-translate-y-0.5 hover:border-gold-champagne/50 hover:shadow-lg">
                  <CardHeader className="flex-wrap">
                    <div>
                      <CardTitle>{order.orderNumber}</CardTitle>
                      <p className="mt-1 flex flex-wrap items-center gap-1 text-xs text-neutral-bg/50">
                        {new Date(order.createdAt).toLocaleDateString("ar")} — {order._count.items} منتج
                        {order.source === ORDER_SOURCES.WHOLESALE && (
                          <Badge variant="gold" className="ms-1">
                            جملة
                          </Badge>
                        )}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={getOrderStatusBadgeVariant(order.status)}>
                        {getOrderStatusLabel(order.status)}
                      </Badge>
                      <Badge variant={getPaymentStatusBadgeVariant(order.paymentStatus)}>
                        {getPaymentStatusLabel(order.paymentStatus)}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="flex items-center justify-between">
                    <span className="text-sm text-neutral-bg/60">الإجمالي</span>
                    <span className="text-lg font-semibold text-gold-champagne">
                      {formatCurrencyFromCents(order.totalCents)}
                    </span>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
}
