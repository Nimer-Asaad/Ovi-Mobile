import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { AdminTable, AdminTableHead, AdminTableBody, AdminEmptyRow } from "@/components/admin/AdminTable";
import { AdminStatusBadge } from "@/components/admin/AdminStatusBadge";
import { UserAvatar } from "@/components/admin/users/UserAvatar";
import { formatCurrencyFromCents } from "@/lib/utils";
import {
  getRoleLabel,
  getRoleBadgeVariant,
  getRegistrationMethodLabel,
  getRegistrationMethod,
  getActivityEventLabel,
} from "@/lib/user-labels";
import { getMerchantStatusLabel, getMerchantStatusBadgeVariant } from "@/lib/merchant-labels";
import { getOrderStatusLabel, getOrderStatusBadgeVariant, getPaymentStatusLabel, getPaymentStatusBadgeVariant } from "@/lib/order-labels";
import { RoleChangeForm } from "./RoleChangeForm";
import { AccountStatusToggle } from "./AccountStatusToggle";

interface AdminUserDetailPageProps {
  params: Promise<{ id: string }>;
}

interface DerivedAddress {
  key: string;
  contactName: string | null;
  contactPhone: string | null;
  city: string | null;
  shippingAddress: string | null;
  lastUsedAt: Date;
}

export default async function AdminUserDetailPage({ params }: AdminUserDetailPageProps) {
  const { id } = await params;

  const [user, activityEvents] = await Promise.all([
    prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        avatarUrl: true,
        role: true,
        passwordHash: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        lastLoginAt: true,
        lastActiveAt: true,
        merchantProfile: { select: { status: true, businessName: true } },
        cart: {
          select: {
            updatedAt: true,
            items: {
              select: {
                quantity: true,
                product: { select: { id: true, name: true, nameAr: true, sku: true, retailPriceCents: true } },
              },
            },
          },
        },
        ordersPlaced: {
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            orderNumber: true,
            status: true,
            paymentStatus: true,
            totalCents: true,
            createdAt: true,
            contactName: true,
            contactPhone: true,
            city: true,
            shippingAddress: true,
            items: {
              select: {
                quantity: true,
                product: {
                  select: {
                    name: true,
                    nameAr: true,
                    brand: { select: { name: true } },
                    category: { select: { name: true, nameAr: true } },
                  },
                },
              },
            },
          },
        },
      },
    }),
    prisma.userActivityEvent.findMany({
      where: { userId: id },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, type: true, createdAt: true, ipAddress: true, device: true, browser: true, os: true },
    }),
  ]);

  if (!user) {
    notFound();
  }

  const orders = user.ordersPlaced;
  const ordersCount = orders.length;
  const lifetimeSpendingCents = orders.reduce((sum, order) => sum + order.totalCents, 0);
  const averageOrderCents = ordersCount > 0 ? Math.round(lifetimeSpendingCents / ordersCount) : 0;
  const lastPurchaseAt = orders[0]?.createdAt ?? null;

  const brandTally = new Map<string, number>();
  const categoryTally = new Map<string, number>();
  for (const order of orders) {
    for (const item of order.items) {
      const brandName = item.product.brand?.name;
      if (brandName) brandTally.set(brandName, (brandTally.get(brandName) ?? 0) + item.quantity);
      const categoryName = item.product.category?.nameAr ?? item.product.category?.name;
      if (categoryName) categoryTally.set(categoryName, (categoryTally.get(categoryName) ?? 0) + item.quantity);
    }
  }
  const mostPurchasedBrand = [...brandTally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—";
  const mostPurchasedCategory = [...categoryTally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—";

  // Addresses aren't a standalone saved entity in this schema — derived from
  // distinct shipping details used across past orders (see report).
  const addressMap = new Map<string, DerivedAddress>();
  for (const order of orders) {
    if (!order.shippingAddress && !order.city) continue;
    const key = `${order.contactPhone ?? ""}|${order.city ?? ""}|${order.shippingAddress ?? ""}`;
    const existing = addressMap.get(key);
    if (!existing || existing.lastUsedAt < order.createdAt) {
      addressMap.set(key, {
        key,
        contactName: order.contactName,
        contactPhone: order.contactPhone,
        city: order.city,
        shippingAddress: order.shippingAddress,
        lastUsedAt: order.createdAt,
      });
    }
  }
  const addresses = [...addressMap.values()].sort((a, b) => b.lastUsedAt.getTime() - a.lastUsedAt.getTime());

  const cartItems = user.cart?.items ?? [];
  const cartTotalCents = cartItems.reduce((sum, item) => sum + item.quantity * item.product.retailPriceCents, 0);

  const registrationMethod = getRegistrationMethod(user.passwordHash);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={user.name}
        subtitle={`سجّل في ${new Date(user.createdAt).toLocaleDateString("ar")}`}
        actions={
          <>
            <Badge variant={getRoleBadgeVariant(user.role)}>{getRoleLabel(user.role)}</Badge>
            <AdminStatusBadge isActive={user.isActive} />
          </>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>الملف الشخصي</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="mb-4 flex items-center gap-4">
              <UserAvatar name={user.name} avatarUrl={user.avatarUrl} size="md" />
              <div>
                <p className="text-neutral-bg">{user.name}</p>
                <p className="text-xs text-neutral-bg/50">{user.email}</p>
              </div>
            </div>
            <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-neutral-bg/50">البريد الإلكتروني</dt>
                <dd className="text-neutral-bg">{user.email}</dd>
              </div>
              <div>
                <dt className="text-neutral-bg/50">الهاتف</dt>
                <dd className="text-neutral-bg">{user.phone ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-neutral-bg/50">طريقة التسجيل</dt>
                <dd className="text-neutral-bg">{getRegistrationMethodLabel(registrationMethod)}</dd>
              </div>
              <div>
                <dt className="text-neutral-bg/50">تاريخ التسجيل</dt>
                <dd className="text-neutral-bg">{new Date(user.createdAt).toLocaleString("ar")}</dd>
              </div>
              <div>
                <dt className="text-neutral-bg/50">آخر تحديث للبيانات</dt>
                <dd className="text-neutral-bg">{new Date(user.updatedAt).toLocaleString("ar")}</dd>
              </div>
              <div>
                <dt className="text-neutral-bg/50">آخر تسجيل دخول</dt>
                <dd className="text-neutral-bg">
                  {user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString("ar") : "لم يسجل الدخول بعد"}
                </dd>
              </div>
              <div>
                <dt className="text-neutral-bg/50">آخر نشاط</dt>
                <dd className="text-neutral-bg">
                  {user.lastActiveAt ? new Date(user.lastActiveAt).toLocaleString("ar") : "—"}
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>إدارة الدور والحساب</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-bg/50">الدور</p>
              <RoleChangeForm userId={user.id} currentRole={user.role} />
            </div>
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-bg/50">حالة الحساب</p>
              <AccountStatusToggle userId={user.id} isActive={user.isActive} />
            </div>
            {user.merchantProfile && (
              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-bg/50">حالة التاجر</p>
                <Badge variant={getMerchantStatusBadgeVariant(user.merchantProfile.status)}>
                  {getMerchantStatusLabel(user.merchantProfile.status)}
                </Badge>
                <Link href="/admin/merchants" className="ms-3 text-xs text-gold-champagne hover:underline">
                  إدارة حالة التاجر من صفحة التجار
                </Link>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard label="عدد الطلبات" value={String(ordersCount)} />
        <StatCard label="إجمالي الإنفاق" value={formatCurrencyFromCents(lifetimeSpendingCents)} />
        <StatCard label="آخر عملية شراء" value={lastPurchaseAt ? new Date(lastPurchaseAt).toLocaleDateString("ar") : "لا يوجد"} />
        <StatCard label="متوسط قيمة الطلب" value={formatCurrencyFromCents(averageOrderCents)} />
        <StatCard label="العلامة الأكثر شراءً" value={mostPurchasedBrand} />
        <StatCard label="القسم الأكثر شراءً" value={mostPurchasedCategory} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>الطلبات</CardTitle>
        </CardHeader>
        <CardContent>
          <AdminTable>
            <AdminTableHead>
              <th className="px-4 py-3 text-start">رقم الطلب</th>
              <th className="px-4 py-3 text-start">التاريخ</th>
              <th className="px-4 py-3 text-start">حالة الطلب</th>
              <th className="px-4 py-3 text-start">حالة الدفع</th>
              <th className="px-4 py-3 text-start">الإجمالي</th>
              <th className="px-4 py-3 text-start">المنتجات</th>
              <th className="px-4 py-3 text-start"></th>
            </AdminTableHead>
            <AdminTableBody>
              {orders.map((order) => (
                <tr key={order.id}>
                  <td className="px-4 py-3 text-neutral-bg/70">{order.orderNumber}</td>
                  <td className="px-4 py-3 text-neutral-bg/70">{new Date(order.createdAt).toLocaleDateString("ar")}</td>
                  <td className="px-4 py-3">
                    <Badge variant={getOrderStatusBadgeVariant(order.status)}>{getOrderStatusLabel(order.status)}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={getPaymentStatusBadgeVariant(order.paymentStatus)}>
                      {getPaymentStatusLabel(order.paymentStatus)}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-neutral-bg/70">{formatCurrencyFromCents(order.totalCents)}</td>
                  <td className="max-w-xs px-4 py-3 text-neutral-bg/70">
                    {order.items.map((item) => item.product.nameAr ?? item.product.name).join("، ")}
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/admin/orders/${order.orderNumber}`} className="text-sm text-gold-champagne hover:underline">
                      التفاصيل
                    </Link>
                  </td>
                </tr>
              ))}
              {orders.length === 0 && <AdminEmptyRow colSpan={7} message="لا توجد طلبات لهذا المستخدم بعد" />}
            </AdminTableBody>
          </AdminTable>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>السلة الحالية</CardTitle>
          </CardHeader>
          <CardContent>
            {cartItems.length === 0 ? (
              <EmptyState title="السلة فارغة" message="لا توجد منتجات في سلة هذا المستخدم حالياً" />
            ) : (
              <div className="flex flex-col gap-3">
                {cartItems.map((item) => (
                  <div key={item.product.id} className="flex items-center justify-between text-sm">
                    <span className="text-neutral-bg">
                      {item.product.nameAr ?? item.product.name}
                      <span className="text-neutral-bg/50"> × {item.quantity}</span>
                    </span>
                    <span className="text-neutral-bg/70">
                      {formatCurrencyFromCents(item.product.retailPriceCents * item.quantity)}
                    </span>
                  </div>
                ))}
                <div className="mt-2 flex items-center justify-between border-t border-navy-soft pt-3 text-sm font-semibold">
                  <span className="text-neutral-bg">الإجمالي</span>
                  <span className="text-neutral-bg">{formatCurrencyFromCents(cartTotalCents)}</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>العناوين</CardTitle>
          </CardHeader>
          <CardContent>
            {addresses.length === 0 ? (
              <EmptyState title="لا توجد عناوين محفوظة" message="لم يتم تسجيل عنوان توصيل بعد لهذا المستخدم" />
            ) : (
              <>
                <p className="mb-3 text-xs text-neutral-bg/50">مستخرجة من سجل الطلبات السابقة — لا يوجد دفتر عناوين منفصل حالياً</p>
                <div className="flex flex-col gap-3">
                  {addresses.map((address) => (
                    <div key={address.key} className="rounded-card border border-navy-soft p-3 text-sm">
                      <p className="text-neutral-bg">{address.contactName ?? user.name}</p>
                      <p className="text-neutral-bg/70">{address.contactPhone ?? user.phone ?? "—"}</p>
                      <p className="text-neutral-bg/70">
                        {[address.city, address.shippingAddress].filter(Boolean).join(" — ") || "—"}
                      </p>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>النشاط الأخير</CardTitle>
        </CardHeader>
        <CardContent>
          {activityEvents.length === 0 ? (
            <EmptyState title="لا يوجد نشاط مسجّل" message="لم يتم تسجيل دخول أو خروج لهذا المستخدم بعد" />
          ) : (
            <AdminTable>
              <AdminTableHead>
                <th className="px-4 py-3 text-start">الحدث</th>
                <th className="px-4 py-3 text-start">التاريخ</th>
                <th className="px-4 py-3 text-start">الجهاز</th>
                <th className="px-4 py-3 text-start">المتصفح</th>
                <th className="px-4 py-3 text-start">نظام التشغيل</th>
                <th className="px-4 py-3 text-start">IP</th>
              </AdminTableHead>
              <AdminTableBody>
                {activityEvents.map((event) => (
                  <tr key={event.id}>
                    <td className="px-4 py-3 text-neutral-bg">{getActivityEventLabel(event.type)}</td>
                    <td className="px-4 py-3 text-neutral-bg/70">{new Date(event.createdAt).toLocaleString("ar")}</td>
                    <td className="px-4 py-3 text-neutral-bg/70">{event.device ?? "—"}</td>
                    <td className="px-4 py-3 text-neutral-bg/70">{event.browser ?? "—"}</td>
                    <td className="px-4 py-3 text-neutral-bg/70">{event.os ?? "—"}</td>
                    <td className="px-4 py-3 text-neutral-bg/70" dir="ltr">
                      {event.ipAddress ?? "—"}
                    </td>
                  </tr>
                ))}
              </AdminTableBody>
            </AdminTable>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
