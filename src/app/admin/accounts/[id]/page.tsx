import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { AdminTable, AdminTableHead, AdminTableBody, AdminEmptyRow } from "@/components/admin/AdminTable";
import { formatCurrencyFromCents } from "@/lib/utils";
import { getOrderStatusLabel, getOrderStatusBadgeVariant, getOrderSourceLabel } from "@/lib/order-labels";
import { getAccountPaymentMethodLabel } from "@/lib/account-labels";
import { getAccountBalanceCents } from "@/lib/accounts";
import { RecordAccountPaymentForm } from "@/components/admin/accounts/RecordAccountPaymentForm";

interface AdminAccountDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function AdminAccountDetailPage({ params }: AdminAccountDetailPageProps) {
  const { id } = await params;

  const account = await prisma.customerAccount.findUnique({
    where: { id },
    select: {
      id: true,
      displayName: true,
      phone: true,
      notes: true,
      createdAt: true,
      merchant: { select: { id: true, businessName: true, status: true } },
      customer: { select: { id: true, name: true, email: true } },
      orders: {
        orderBy: { createdAt: "desc" },
        select: { orderNumber: true, source: true, status: true, totalCents: true, createdAt: true },
      },
      payments: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          amountCents: true,
          method: true,
          note: true,
          createdAt: true,
          createdBy: { select: { name: true } },
        },
      },
    },
  });

  if (!account) {
    notFound();
  }

  const balanceCents = getAccountBalanceCents(account);
  const totalPaidCents = account.payments.reduce((sum, payment) => sum + payment.amountCents, 0);
  const kindLabel = account.merchant ? "تاجر جملة" : account.customer ? "عميل مسجّل" : "عميل مباشر";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={account.displayName}
        subtitle={`حساب منذ ${new Date(account.createdAt).toLocaleDateString("ar")}`}
        actions={
          <div className="flex items-center gap-2">
            <Badge variant="neutral">{kindLabel}</Badge>
            <Link href={`/admin/accounts/${account.id}/statement`}>
              <Button variant="outline" size="sm">
                طباعة كشف حساب
              </Button>
            </Link>
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          label="الرصيد المستحق"
          value={formatCurrencyFromCents(Math.max(balanceCents, 0))}
          badge={balanceCents > 0 ? { text: "دين قائم", variant: "danger" } : { text: "لا يوجد دين", variant: "success" }}
        />
        <StatCard label="إجمالي الطلبات" value={String(account.orders.length)} />
        <StatCard label="إجمالي المدفوع" value={formatCurrencyFromCents(totalPaidCents)} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>معلومات الحساب</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-neutral-bg/50">الهاتف</dt>
              <dd className="text-neutral-bg">{account.phone ?? "—"}</dd>
            </div>
            {account.merchant && (
              <div>
                <dt className="text-neutral-bg/50">التاجر</dt>
                <dd className="text-neutral-bg">
                  <Link href={`/admin/merchants/${account.merchant.id}`} className="text-gold-champagne hover:underline">
                    {account.merchant.businessName}
                  </Link>
                </dd>
              </div>
            )}
            {account.customer && (
              <div>
                <dt className="text-neutral-bg/50">العميل المسجّل</dt>
                <dd className="text-neutral-bg">
                  {account.customer.name} ({account.customer.email})
                </dd>
              </div>
            )}
            {account.notes && (
              <div className="sm:col-span-2">
                <dt className="text-neutral-bg/50">ملاحظات</dt>
                <dd className="text-neutral-bg">{account.notes}</dd>
              </div>
            )}
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>تسجيل دفعة جديدة</CardTitle>
        </CardHeader>
        <CardContent>
          <RecordAccountPaymentForm accountId={account.id} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>الطلبات</CardTitle>
        </CardHeader>
        <CardContent>
          <AdminTable>
            <AdminTableHead>
              <th className="px-4 py-3 text-start">رقم الطلب</th>
              <th className="px-4 py-3 text-start">المصدر</th>
              <th className="px-4 py-3 text-start">الحالة</th>
              <th className="px-4 py-3 text-start">الإجمالي</th>
              <th className="px-4 py-3 text-start">التاريخ</th>
              <th className="px-4 py-3 text-start"></th>
            </AdminTableHead>
            <AdminTableBody>
              {account.orders.map((order) => (
                <tr key={order.orderNumber}>
                  <td className="px-4 py-3 text-neutral-bg/70">{order.orderNumber}</td>
                  <td className="px-4 py-3 text-neutral-bg/70">{getOrderSourceLabel(order.source)}</td>
                  <td className="px-4 py-3">
                    <Badge variant={getOrderStatusBadgeVariant(order.status)}>
                      {getOrderStatusLabel(order.status)}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-neutral-bg/70">{formatCurrencyFromCents(order.totalCents)}</td>
                  <td className="px-4 py-3 text-neutral-bg/70">
                    {new Date(order.createdAt).toLocaleDateString("ar")}
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/admin/orders/${order.orderNumber}`} className="text-sm text-gold-champagne hover:underline">
                      التفاصيل
                    </Link>
                  </td>
                </tr>
              ))}
              {account.orders.length === 0 && (
                <AdminEmptyRow colSpan={6} message="لا توجد طلبات مرتبطة بهذا الحساب بعد" />
              )}
            </AdminTableBody>
          </AdminTable>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>سجل الدفعات</CardTitle>
        </CardHeader>
        <CardContent>
          <AdminTable>
            <AdminTableHead>
              <th className="px-4 py-3 text-start">المبلغ</th>
              <th className="px-4 py-3 text-start">الطريقة</th>
              <th className="px-4 py-3 text-start">بواسطة</th>
              <th className="px-4 py-3 text-start">التاريخ</th>
              <th className="px-4 py-3 text-start">ملاحظة</th>
            </AdminTableHead>
            <AdminTableBody>
              {account.payments.map((payment) => (
                <tr key={payment.id}>
                  <td className="px-4 py-3 font-medium text-emerald-700">
                    {formatCurrencyFromCents(payment.amountCents)}
                  </td>
                  <td className="px-4 py-3 text-neutral-bg/70">{getAccountPaymentMethodLabel(payment.method)}</td>
                  <td className="px-4 py-3 text-neutral-bg/70">{payment.createdBy.name}</td>
                  <td className="px-4 py-3 text-neutral-bg/70">
                    {new Date(payment.createdAt).toLocaleString("ar")}
                  </td>
                  <td className="px-4 py-3 text-neutral-bg/70">{payment.note ?? "—"}</td>
                </tr>
              ))}
              {account.payments.length === 0 && (
                <AdminEmptyRow colSpan={5} message="لم تُسجَّل أي دفعات بعد" />
              )}
            </AdminTableBody>
          </AdminTable>
        </CardContent>
      </Card>
    </div>
  );
}
