import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { AdminTable, AdminTableHead, AdminTableBody, AdminEmptyRow } from "@/components/admin/AdminTable";
import { AdminStatusBadge } from "@/components/admin/AdminStatusBadge";
import { formatCurrencyFromCents } from "@/lib/utils";
import { getMerchantStatusLabel, getMerchantStatusBadgeVariant } from "@/lib/merchant-labels";
import { getOrderStatusLabel, getOrderStatusBadgeVariant, getPaymentStatusLabel, getPaymentStatusBadgeVariant } from "@/lib/order-labels";
import { getAccountBalanceCents } from "@/lib/accounts";
import { MerchantStatusActions } from "../MerchantStatusActions";
import { MerchantAssignmentForm } from "../MerchantAssignmentForm";

interface AdminMerchantDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function AdminMerchantDetailPage({ params }: AdminMerchantDetailPageProps) {
  const { id } = await params;

  const [merchant, reps] = await Promise.all([
    prisma.merchant.findUnique({
    where: { id },
    select: {
      id: true,
      businessName: true,
      taxId: true,
      region: true,
      assignedRepId: true,
      status: true,
      approvedAt: true,
      createdAt: true,
      contactPhone: true,
      city: true,
      address: true,
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
      account: {
        select: {
          id: true,
          orders: { select: { status: true, totalCents: true } },
          payments: { select: { amountCents: true } },
        },
      },
    },
    }),
    prisma.salesRepresentative.findMany({
      where: { isActive: true },
      orderBy: { user: { name: "asc" } },
      select: { id: true, employeeCode: true, user: { select: { name: true } } },
    }),
  ]);

  if (!merchant) {
    notFound();
  }

  const repOptions = reps.map((rep) => ({ id: rep.id, label: `${rep.user.name} (${rep.employeeCode})` }));

  const totalOrders = merchant.orders.length;
  const totalValueCents = merchant.orders.reduce((sum, order) => sum + order.totalCents, 0);
  const lastOrderDate = merchant.orders[0]?.createdAt ?? null;
  const balanceCents = merchant.account ? getAccountBalanceCents(merchant.account) : null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={merchant.businessName}
        subtitle={`سجّل في ${new Date(merchant.createdAt).toLocaleDateString("ar")}`}
        actions={
          <Badge variant={getMerchantStatusBadgeVariant(merchant.status)}>
            {getMerchantStatusLabel(merchant.status)}
          </Badge>
        }
      />

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
              <div>
                <dt className="text-neutral-bg/50">المنطقة</dt>
                <dd className="text-neutral-bg">{merchant.region ?? "—"}</dd>
              </div>
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
            <CardTitle>{merchant.user ? "معلومات المالك" : "بيانات التواصل"}</CardTitle>
          </CardHeader>
          <CardContent>
            {merchant.user ? (
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
            ) : (
              <dl className="grid grid-cols-1 gap-2 text-sm">
                <div>
                  <dt className="text-neutral-bg/50">الهاتف</dt>
                  <dd className="text-neutral-bg">{merchant.contactPhone ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-neutral-bg/50">المدينة</dt>
                  <dd className="text-neutral-bg">{merchant.city ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-neutral-bg/50">العنوان</dt>
                  <dd className="text-neutral-bg">{merchant.address ?? "—"}</dd>
                </div>
                <p className="text-xs text-neutral-bg/50">
                  تاجر بدون حساب دخول — تمت إضافته مباشرة (لا يملك بريداً إلكترونياً أو كلمة مرور).
                </p>
              </dl>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="إجمالي الطلبات" value={String(totalOrders)} />
        <StatCard label="إجمالي قيمة الطلبات" value={formatCurrencyFromCents(totalValueCents)} />
        <StatCard label="آخر طلب" value={lastOrderDate ? new Date(lastOrderDate).toLocaleDateString("ar") : "لا يوجد"} />
        <StatCard
          label="الرصيد المستحق"
          value={balanceCents !== null ? formatCurrencyFromCents(Math.max(balanceCents, 0)) : "لا يوجد حساب دين"}
          badge={
            balanceCents !== null
              ? balanceCents > 0
                ? { text: "دين قائم", variant: "danger" }
                : { text: "لا يوجد دين", variant: "success" }
              : undefined
          }
        />
      </div>

      {merchant.account && (
        <Link
          href={`/admin/accounts/${merchant.account.id}`}
          className="self-start text-sm text-gold-champagne hover:underline"
        >
          عرض كشف حساب التاجر بالكامل (الطلبات والدفعات)
        </Link>
      )}

      <Card>
        <CardHeader>
          <CardTitle>المنطقة والمندوب المسؤول</CardTitle>
        </CardHeader>
        <CardContent>
          <MerchantAssignmentForm
            merchantId={merchant.id}
            currentRegion={merchant.region}
            currentAssignedRepId={merchant.assignedRepId}
            reps={repOptions}
          />
        </CardContent>
      </Card>

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
