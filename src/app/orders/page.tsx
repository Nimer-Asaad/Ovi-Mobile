import Link from "next/link";
import { requireUser } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
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

export default async function OrdersPage() {
  const user = await requireUser();

  const orders = await prisma.order.findMany({
    where: { customerId: user.id },
    orderBy: { createdAt: "desc" },
    select: {
      orderNumber: true,
      status: true,
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
      <h1 className="text-xl font-semibold text-neutral-bg">طلباتي</h1>

      {orders.length === 0 ? (
        <Card>
          <CardContent>
            <p className="text-center text-neutral-bg/60">لا توجد طلبات بعد.</p>
            <div className="mt-4 flex justify-center">
              <Link href="/products" className="text-sm text-gold-champagne hover:underline">
                تصفح المنتجات
              </Link>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {orders.map((order) => (
            <Link key={order.orderNumber} href={`/orders/${order.orderNumber}`}>
              <Card className="transition-colors hover:border-gold-champagne/50">
                <CardHeader>
                  <div>
                    <CardTitle>{order.orderNumber}</CardTitle>
                    <p className="mt-1 text-xs text-neutral-bg/50">
                      {new Date(order.createdAt).toLocaleDateString("ar")} — {order._count.items} منتج
                      {order.source === "WHOLESALE" && (
                        <>
                          {" "}
                          <Badge variant="gold" className="ms-1">
                            جملة
                          </Badge>
                        </>
                      )}
                    </p>
                  </div>
                  <Badge variant={order.status === "PENDING" ? "warning" : "neutral"}>
                    {ORDER_STATUS_LABELS[order.status] ?? order.status}
                  </Badge>
                </CardHeader>
                <CardContent>
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
