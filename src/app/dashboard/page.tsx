import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/guards";
import { getPostLoginRedirect } from "@/lib/auth/redirects";
import { prisma } from "@/lib/prisma";
import { ROLES } from "@/lib/constants";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatCurrencyFromCents } from "@/lib/utils";
import { getOrderStatusLabel, getOrderStatusBadgeVariant } from "@/lib/order-labels";

const QUICK_LINKS = [
  { href: "/products", title: "المنتجات", description: "تصفح كتالوج المنتجات" },
  { href: "/cart", title: "السلة", description: "مراجعة سلة التسوق" },
  { href: "/orders", title: "طلباتي", description: "عرض سجل طلباتك" },
] as const;

/** Universal post-login landing spot. Non-customer roles are bounced to
 * their real area; retail customers land on a shopping-focused hub. */
export default async function DashboardPage() {
  const user = await requireUser();

  if (user.role !== ROLES.RETAIL_CUSTOMER) {
    redirect(getPostLoginRedirect(user));
  }

  const [fullUser, recentOrders] = await Promise.all([
    prisma.user.findUnique({
      where: { id: user.id },
      select: { name: true, email: true, phone: true },
    }),
    prisma.order.findMany({
      where: { customerId: user.id },
      orderBy: { createdAt: "desc" },
      take: 3,
      select: { orderNumber: true, status: true, totalCents: true, createdAt: true },
    }),
  ]);

  return (
    <div className="flex min-h-screen flex-col">
      <Header />

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-4 py-10">
        <section className="rounded-card border border-navy-soft bg-navy-surface p-8 text-center shadow-card">
          <h1 className="text-2xl font-bold text-neutral-bg">مرحباً، {user.name}</h1>
          <p className="mx-auto mt-2 max-w-md text-sm text-neutral-bg/60">
            تصفح أحدث إكسسوارات الموبايل وأضفها إلى سلتك بسهولة.
          </p>
          <div className="mt-6">
            <Link href="/products">
              <Button variant="primary" size="lg">
                ابدأ التسوق
              </Button>
            </Link>
          </div>
        </section>

        <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {QUICK_LINKS.map((link) => (
            <Link key={link.href} href={link.href}>
              <Card className="h-full transition-all hover:-translate-y-0.5 hover:border-gold-champagne/50 hover:shadow-lg">
                <CardHeader>
                  <CardTitle>{link.title}</CardTitle>
                </CardHeader>
                <CardContent>{link.description}</CardContent>
              </Card>
            </Link>
          ))}
        </section>

        <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>معلومات الحساب</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-1 gap-2 text-sm">
                <div>
                  <dt className="text-neutral-bg/50">الاسم</dt>
                  <dd className="text-neutral-bg">{fullUser?.name ?? user.name}</dd>
                </div>
                <div>
                  <dt className="text-neutral-bg/50">البريد الإلكتروني</dt>
                  <dd className="text-neutral-bg">{fullUser?.email ?? user.email}</dd>
                </div>
                {fullUser?.phone && (
                  <div>
                    <dt className="text-neutral-bg/50">الهاتف</dt>
                    <dd className="text-neutral-bg">{fullUser.phone}</dd>
                  </div>
                )}
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>آخر الطلبات</CardTitle>
              {recentOrders.length > 0 && (
                <Link href="/orders" className="text-sm font-medium text-gold-dark hover:underline">
                  عرض الكل
                </Link>
              )}
            </CardHeader>
            <CardContent>
              {recentOrders.length === 0 ? (
                <EmptyState
                  title="لا توجد طلبات بعد"
                  message="ابدأ التسوق لترى طلباتك هنا."
                  action={
                    <Link href="/products">
                      <Button variant="outline" size="sm">
                        تصفح المنتجات
                      </Button>
                    </Link>
                  }
                />
              ) : (
                <div className="flex flex-col divide-y divide-navy-soft">
                  {recentOrders.map((order) => (
                    <Link
                      key={order.orderNumber}
                      href={`/orders/${order.orderNumber}`}
                      className="flex items-center justify-between py-3 first:pt-0 last:pb-0"
                    >
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
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </section>
      </main>

      <Footer />
    </div>
  );
}
