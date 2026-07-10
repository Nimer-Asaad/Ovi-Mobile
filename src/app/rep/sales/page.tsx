import Link from "next/link";
import { requireRole } from "@/lib/auth/guards";
import { ROLES } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { AdminTable, AdminTableHead, AdminTableBody, AdminEmptyRow } from "@/components/admin/AdminTable";
import { LogoutButton } from "@/components/auth/LogoutButton";
import { formatCurrencyFromCents } from "@/lib/utils";
import {
  getOrderStatusLabel,
  getOrderStatusBadgeVariant,
  getPaymentStatusLabel,
  getPaymentStatusBadgeVariant,
} from "@/lib/order-labels";

export default async function RepSalesPage() {
  const user = await requireRole([ROLES.SALES_REPRESENTATIVE]);

  const rep = await prisma.salesRepresentative.findUnique({
    where: { userId: user.id },
    select: { id: true },
  });

  const sales = rep
    ? await prisma.order.findMany({
        where: { createdByRepId: rep.id },
        orderBy: { createdAt: "desc" },
        select: {
          orderNumber: true,
          contactName: true,
          contactPhone: true,
          totalCents: true,
          paymentStatus: true,
          status: true,
          createdAt: true,
        },
      })
    : [];

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-neutral-bg">مبيعاتي المباشرة</h1>
          <p className="mt-1 text-sm text-neutral-bg/60">سجل المبيعات التي قمت بها من مخزونك</p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/rep/sales/new">
            <Button>بيع جديد</Button>
          </Link>
          <LogoutButton />
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>المبيعات</CardTitle>
        </CardHeader>
        <CardContent>
          <AdminTable>
            <AdminTableHead>
              <th className="px-4 py-3 text-start">رقم الطلب</th>
              <th className="px-4 py-3 text-start">العميل</th>
              <th className="px-4 py-3 text-start">الهاتف</th>
              <th className="px-4 py-3 text-start">الإجمالي</th>
              <th className="px-4 py-3 text-start">الدفع</th>
              <th className="px-4 py-3 text-start">الحالة</th>
              <th className="px-4 py-3 text-start">التاريخ</th>
              <th className="px-4 py-3 text-start"></th>
            </AdminTableHead>
            <AdminTableBody>
              {sales.map((sale) => (
                <tr key={sale.orderNumber}>
                  <td className="px-4 py-3 text-neutral-bg/70">{sale.orderNumber}</td>
                  <td className="px-4 py-3 text-neutral-bg">{sale.contactName ?? "—"}</td>
                  <td className="px-4 py-3 text-neutral-bg/70">{sale.contactPhone ?? "—"}</td>
                  <td className="px-4 py-3 text-neutral-bg/70">{formatCurrencyFromCents(sale.totalCents)}</td>
                  <td className="px-4 py-3">
                    <Badge variant={getPaymentStatusBadgeVariant(sale.paymentStatus)}>
                      {getPaymentStatusLabel(sale.paymentStatus)}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={getOrderStatusBadgeVariant(sale.status)}>
                      {getOrderStatusLabel(sale.status)}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-neutral-bg/70">
                    {new Date(sale.createdAt).toLocaleDateString("ar")}
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/rep/sales/${sale.orderNumber}`}
                      className="text-sm text-gold-champagne hover:underline"
                    >
                      التفاصيل
                    </Link>
                  </td>
                </tr>
              ))}
              {sales.length === 0 && <AdminEmptyRow colSpan={8} message="لا توجد مبيعات بعد" />}
            </AdminTableBody>
          </AdminTable>
        </CardContent>
      </Card>
    </div>
  );
}
