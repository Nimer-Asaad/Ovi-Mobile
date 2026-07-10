import Link from "next/link";
import { requireApprovedMerchant } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { AdminTable, AdminTableHead, AdminTableBody, AdminEmptyRow } from "@/components/admin/AdminTable";
import { LogoutButton } from "@/components/auth/LogoutButton";
import { formatCurrencyFromCents } from "@/lib/utils";
import { getOrderStatusLabel, getOrderStatusBadgeVariant, getPaymentStatusLabel, getPaymentStatusBadgeVariant } from "@/lib/order-labels";

export default async function MerchantOrdersPage() {
  const user = await requireApprovedMerchant();

  const merchant = await prisma.merchant.findUnique({
    where: { userId: user.id },
    select: { id: true },
  });

  const orders = merchant
    ? await prisma.order.findMany({
        where: { merchantId: merchant.id },
        orderBy: { createdAt: "desc" },
        select: {
          orderNumber: true,
          totalCents: true,
          status: true,
          paymentStatus: true,
          createdAt: true,
        },
      })
    : [];

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-neutral-bg">طلباتي</h1>
          <p className="mt-1 text-sm text-neutral-bg/60">سجل طلبات الجملة الخاصة بك</p>
        </div>
        <LogoutButton />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>الطلبات</CardTitle>
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
              {orders.map((order) => (
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
                      href={`/orders/${order.orderNumber}`}
                      className="text-sm text-gold-champagne hover:underline"
                    >
                      التفاصيل
                    </Link>
                  </td>
                </tr>
              ))}
              {orders.length === 0 && <AdminEmptyRow colSpan={6} message="لا توجد طلبات بعد" />}
            </AdminTableBody>
          </AdminTable>
        </CardContent>
      </Card>
    </div>
  );
}
