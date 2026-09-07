import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { AdminTable, AdminTableHead, AdminTableBody, AdminEmptyRow } from "@/components/admin/AdminTable";
import { AdminStatusBadge } from "@/components/admin/AdminStatusBadge";
import { formatCurrencyFromCents } from "@/lib/utils";
import { getMerchantStatusLabel, getMerchantStatusBadgeVariant } from "@/lib/merchant-labels";
import { getOrderStatusLabel, getOrderStatusBadgeVariant, getPaymentStatusLabel, getPaymentStatusBadgeVariant } from "@/lib/order-labels";
import { getAccountBalanceCents, getNewOrderHrefForAccount } from "@/lib/accounts";
import { MerchantStatusActions } from "../MerchantStatusActions";
import { MerchantAssignmentForm } from "../MerchantAssignmentForm";
import { deleteMerchant } from "../actions";
import { DeleteMerchantControl } from "@/components/admin/merchants/DeleteMerchantControl";

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
        contactName: true,
        whatsappPhone: true,
        notes: true,
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
            openingBalanceCents: true,
            openingBalanceSetAt: true,
            openingBalanceSetById: true,
            orders: { select: { status: true, totalCents: true } },
            payments: { select: { amountCents: true, cancellation: { select: { id: true } } } },
            _count: { select: { orders: true, payments: true } },
          },
        },
        _count: { select: { orders: true, repCustomerOrders: true } },
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

  const totalValueCents = merchant.orders.reduce((sum, order) => sum + order.totalCents, 0);
  const totalPaidCents = merchant.account?.payments.reduce((sum, payment) => sum + payment.amountCents, 0) ?? 0;
  const balanceCents = merchant.account ? getAccountBalanceCents(merchant.account) : null;
  const phone = merchant.contactPhone ?? merchant.user?.phone ?? null;

  // Same dependency check deleteMerchant itself re-verifies before acting —
  // computed here purely so the confirm dialog can tell the admin the real
  // outcome (archive vs. permanent delete) before they click, not just
  // after. See deleteMerchant's own doc comment for why every one of these
  // must be counted explicitly rather than assumed. merchant.user is only
  // ever non-null when Merchant.userId is set (see the select above), so
  // this is equivalent to checking userId directly.
  const isLoginLinked = merchant.user != null;
  const hasOpeningBalanceHistory =
    (merchant.account?.openingBalanceCents ?? 0) !== 0 ||
    merchant.account?.openingBalanceSetAt != null ||
    merchant.account?.openingBalanceSetById != null;
  const willArchiveInstead =
    isLoginLinked ||
    merchant._count.orders > 0 ||
    merchant._count.repCustomerOrders > 0 ||
    (merchant.account?._count.orders ?? 0) > 0 ||
    (merchant.account?._count.payments ?? 0) > 0 ||
    hasOpeningBalanceHistory;

  const newSaleHref = merchant.account ? getNewOrderHrefForAccount(merchant.account.id, { merchantId: merchant.id, customerId: null }) : null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={merchant.businessName}
        subtitle={`سجّل في ${new Date(merchant.createdAt).toLocaleDateString("ar")}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={getMerchantStatusBadgeVariant(merchant.status)}>{getMerchantStatusLabel(merchant.status)}</Badge>
            <Link href={`/admin/merchants/${merchant.id}/edit`}>
              <Button variant="outline" size="sm">
                تعديل بيانات التاجر
              </Button>
            </Link>
            <DeleteMerchantControl
              merchantName={merchant.businessName}
              willArchiveInstead={willArchiveInstead}
              isLoginLinked={isLoginLinked}
              action={deleteMerchant.bind(null, merchant.id)}
            />
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>بيانات التاجر</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-neutral-bg/50">اسم المحل</dt>
                <dd className="text-neutral-bg">{merchant.businessName}</dd>
              </div>
              <div>
                <dt className="text-neutral-bg/50">اسم صاحب المحل</dt>
                <dd className="text-neutral-bg">{merchant.contactName ?? merchant.user?.name ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-neutral-bg/50">الجوال</dt>
                <dd className="text-neutral-bg">{phone ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-neutral-bg/50">واتساب</dt>
                <dd className="text-neutral-bg">{merchant.whatsappPhone ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-neutral-bg/50">المدينة</dt>
                <dd className="text-neutral-bg">{merchant.city ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-neutral-bg/50">المنطقة</dt>
                <dd className="text-neutral-bg">{merchant.region ?? "—"}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-neutral-bg/50">العنوان</dt>
                <dd className="text-neutral-bg">{merchant.address ?? "—"}</dd>
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
              {merchant.notes && (
                <div className="sm:col-span-2">
                  <dt className="text-neutral-bg/50">ملاحظات</dt>
                  <dd className="whitespace-normal break-words text-neutral-bg">{merchant.notes}</dd>
                </div>
              )}
            </dl>
          </CardContent>
        </Card>

        {merchant.user && (
          <Card>
            <CardHeader>
              <CardTitle>حساب الدخول</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-1 gap-2 text-sm">
                <div>
                  <dt className="text-neutral-bg/50">البريد الإلكتروني</dt>
                  <dd className="text-neutral-bg">{merchant.user.email}</dd>
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
        )}
        {!merchant.user && (
          <Card>
            <CardContent>
              <p className="text-xs text-neutral-bg/50">
                تاجر بدون حساب دخول — تمت إضافته مباشرة (لا يملك بريداً إلكترونياً أو كلمة مرور).
              </p>
            </CardContent>
          </Card>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="الرصيد الافتتاحي" value={merchant.account ? formatCurrencyFromCents(merchant.account.openingBalanceCents) : "—"} />
        <StatCard label="إجمالي المشتريات" value={formatCurrencyFromCents(totalValueCents)} />
        <StatCard label="إجمالي الدفعات" value={formatCurrencyFromCents(totalPaidCents)} />
        <StatCard
          label="الرصيد الحالي"
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
        <div className="flex flex-wrap gap-3">
          {newSaleHref && (
            <Link href={newSaleHref}>
              <Button size="sm">بيع للتاجر</Button>
            </Link>
          )}
          <Link href={`/admin/accounts/${merchant.account.id}#payment`}>
            <Button size="sm" variant="outline">
              تسجيل دفعة
            </Button>
          </Link>
          <Link href={`/admin/accounts/${merchant.account.id}/statement`}>
            <Button size="sm" variant="outline">
              كشف الحساب
            </Button>
          </Link>
          <Link href={`/admin/accounts/${merchant.account.id}`} className="text-sm text-gold-champagne hover:underline self-center">
            عرض تفاصيل الحساب الكاملة
          </Link>
        </div>
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
                    <Link href={`/admin/orders/${order.orderNumber}`} className="text-sm text-gold-champagne hover:underline">
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
