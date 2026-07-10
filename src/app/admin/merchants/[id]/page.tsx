import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { AdminTable, AdminTableHead, AdminTableBody, AdminEmptyRow } from "@/components/admin/AdminTable";
import { AdminStatusBadge } from "@/components/admin/AdminStatusBadge";
import { formatCurrencyFromCents } from "@/lib/utils";
import { getMerchantStatusLabel, getMerchantStatusBadgeVariant } from "@/lib/merchant-labels";
import { getOrderStatusLabel, getOrderStatusBadgeVariant, getPaymentStatusLabel, getPaymentStatusBadgeVariant } from "@/lib/order-labels";
import { MerchantStatusActions } from "../MerchantStatusActions";

interface AdminMerchantDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function AdminMerchantDetailPage({ params }: AdminMerchantDetailPageProps) {
  const { id } = await params;

  const merchant = await prisma.merchant.findUnique({
    where: { id },
    select: {
      id: true,
      businessName: true,
      taxId: true,
      status: true,
      approvedAt: true,
      createdAt: true,
      user: { select: { name: true, email: true, phone: true, isActive: true } },
      orders: {
        orderBy: { createdAt: "desc" },
        select: {
          orderNumber: true,
          status: true,
          paymentStatus: true,
          totalCents: true,
          createdAt: true,
        },
      },
    },
  });

  if (!merchant) {
    notFound();
  }

  const totalOrders = merchant.orders.length;
  const totalValueCents = merchant.orders.reduce((sum, order) => sum + order.totalCents, 0);
  const lastOrderDate = merchant.orders[0]?.createdAt ?? null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-neutral-bg">{merchant.businessName}</h2>
          <p className="mt-1 text-sm text-neutral-bg/60">
            سجّل في {new Date(merchant.createdAt).toLocaleDateString("ar")}
          </p>
        </div>
        <Badge variant={getMerchantStatusBadgeVariant(merchant.status)}>
          {getMerchantStatusLabel(merchant.status)}
        </Badge>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>معلومات النشاط التجاري</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-1 gap-2 text-sm">
              <div>
                <dt className="text-neutral-bg/50">الاسم التجاري</dt>
                <dd className="text-neutral-bg">{merchant.businessName}</dd>
              </div>
              {merchant.taxId && (
                <div>
                  <dt className="text-neutral-bg/50">الرقم الضريبي</dt>
                  <dd className="text-neutral-bg">{merchant.taxId}</dd>
                </div>
              )}
              {merchant.approvedAt && (
                <div>
                  <dt className="text-neutral-bg/50">تاريخ الاعتماد</dt>
                  <dd className="text-neutral-bg">{new Date(merchant.approvedAt).toLocaleDateString("ar")}</dd>
                </div>
              )}
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>معلومات المالك</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-1 gap-2 text-sm">
              <div>
                <dt className="text-neutral-bg/50">الاسم</dt>
                <dd className="text-neutral-bg">{merchant.user.name}</dd>
              </div>
              <div>
                <dt className="text-neutral-bg/50">البريد الإلكتروني</dt>
                <dd className="text-neutral-bg">{merchant.user.email}</dd>
              </div>
              <div>
                <dt className="text-neutral-bg/50">الهاتف</dt>
                <dd className="text-neutral-bg">{merchant.user.phone ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-neutral-bg/50">حالة الحساب</dt>
                <dd>
                  <AdminStatusBadge isActive={merchant.user.isActive} />
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>إجمالي الطلبات</CardTitle>
          </CardHeader>
          <CardContent>
            <span className="text-2xl font-semibold text-neutral-bg">{totalOrders}</span>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>إجمالي قيمة الطلبات</CardTitle>
          </CardHeader>
          <CardContent>
            <span className="text-2xl font-semibold text-neutral-bg">
              {formatCurrencyFromCents(totalValueCents)}
            </span>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>آخر طلب</CardTitle>
          </CardHeader>
          <CardContent>
            <span className="text-2xl font-semibold text-neutral-bg">
              {lastOrderDate ? new Date(lastOrderDate).toLocaleDateString("ar") : "لا يوجد"}
            </span>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>إدارة حالة التاجر</CardTitle>
        </CardHeader>
        <CardContent>
          <MerchantStatusActions merchantId={merchant.id} currentStatus={merchant.status} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>طلبات التاجر</CardTitle>
        </CardHeader>
        <CardContent>
          <AdminTable>
            <AdminTableHead>
              <th className="px-4 py-3 text-start">رقم الطلب</th>
              <th className="px-4 py-3 text-start">الإجمالي</th>
              <th className="px-4 py-3 text-start">حالة الطلب</th>
              <th className="px-4 py-3 text-start">حالة الدفع</th>
              <th className="px-4 py-3 text-start">التاريخ</th>
              <th className="px-4 py-3 text-start"></th>
            </AdminTableHead>
            <AdminTableBody>
              {merchant.orders.map((order) => (
                <tr key={order.orderNumber}>
                  <td className="px-4 py-3 text-neutral-bg/70">{order.orderNumber}</td>
                  <td className="px-4 py-3 text-neutral-bg/70">{formatCurrencyFromCents(order.totalCents)}</td>
                  <td className="px-4 py-3">
                    <Badge variant={getOrderStatusBadgeVariant(order.status)}>
                      {getOrderStatusLabel(order.status)}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={getPaymentStatusBadgeVariant(order.paymentStatus)}>
                      {getPaymentStatusLabel(order.paymentStatus)}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-neutral-bg/70">
                    {new Date(order.createdAt).toLocaleDateString("ar")}
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/orders/${order.orderNumber}`}
                      className="text-sm text-gold-champagne hover:underline"
                    >
                      التفاصيل
                    </Link>
                  </td>
                </tr>
              ))}
              {merchant.orders.length === 0 && (
                <AdminEmptyRow colSpan={6} message="لا توجد طلبات لهذا التاجر بعد" />
              )}
            </AdminTableBody>
          </AdminTable>
        </CardContent>
      </Card>
    </div>
  );
}
