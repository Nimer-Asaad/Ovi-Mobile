import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { PageHeader } from "@/components/ui/PageHeader";
import { AdminTable, AdminTableHead, AdminTableBody, AdminEmptyRow } from "@/components/admin/AdminTable";
import { formatCurrencyFromCents } from "@/lib/utils";
import { MERCHANT_STATUSES } from "@/lib/constants";
import { getMerchantStatusLabel, getMerchantStatusBadgeVariant } from "@/lib/merchant-labels";

interface AdminMerchantsPageProps {
  searchParams: Promise<{ q?: string; status?: string }>;
}

export default async function AdminMerchantsPage({ searchParams }: AdminMerchantsPageProps) {
  const { q, status } = await searchParams;
  const trimmedQuery = q?.trim();

  const merchants = await prisma.merchant.findMany({
    where: {
      ...(status ? { status } : {}),
      ...(trimmedQuery
        ? {
            OR: [
              { businessName: { contains: trimmedQuery } },
              { user: { name: { contains: trimmedQuery } } },
              { user: { email: { contains: trimmedQuery } } },
              { user: { phone: { contains: trimmedQuery } } },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      businessName: true,
      status: true,
      createdAt: true,
      user: { select: { name: true, email: true, phone: true } },
      orders: { select: { totalCents: true } },
    },
  });

  const rows = merchants.map((merchant) => ({
    ...merchant,
    totalOrders: merchant.orders.length,
    totalValueCents: merchant.orders.reduce((sum, order) => sum + order.totalCents, 0),
  }));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="التجار" subtitle="إدارة طلبات انضمام تجار الجملة واعتمادهم" />

      <form
        method="GET"
        className="grid grid-cols-1 gap-4 rounded-card border border-navy-soft bg-navy-surface p-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        <div className="lg:col-span-2">
          <Input name="q" label="بحث بالاسم التجاري أو المالك أو البريد أو الهاتف" defaultValue={trimmedQuery ?? ""} />
        </div>

        <Select name="status" label="الحالة" defaultValue={status ?? ""}>
          <option value="">كل الحالات</option>
          <option value={MERCHANT_STATUSES.PENDING}>{getMerchantStatusLabel(MERCHANT_STATUSES.PENDING)}</option>
          <option value={MERCHANT_STATUSES.APPROVED}>{getMerchantStatusLabel(MERCHANT_STATUSES.APPROVED)}</option>
          <option value={MERCHANT_STATUSES.REJECTED}>{getMerchantStatusLabel(MERCHANT_STATUSES.REJECTED)}</option>
        </Select>

        <div className="flex items-end lg:col-span-4">
          <Button type="submit">تصفية</Button>
        </div>
      </form>

      <AdminTable>
        <AdminTableHead>
          <th className="px-4 py-3 text-start">الاسم التجاري</th>
          <th className="px-4 py-3 text-start">المالك</th>
          <th className="px-4 py-3 text-start">البريد الإلكتروني</th>
          <th className="px-4 py-3 text-start">الهاتف</th>
          <th className="px-4 py-3 text-start">الحالة</th>
          <th className="px-4 py-3 text-start">إجمالي الطلبات</th>
          <th className="px-4 py-3 text-start">إجمالي قيمة الطلبات</th>
          <th className="px-4 py-3 text-start">تاريخ التسجيل</th>
          <th className="px-4 py-3 text-start"></th>
        </AdminTableHead>
        <AdminTableBody>
          {rows.map((merchant) => (
            <tr key={merchant.id}>
              <td className="px-4 py-3 text-neutral-bg">{merchant.businessName}</td>
              <td className="px-4 py-3 text-neutral-bg/70">{merchant.user.name}</td>
              <td className="px-4 py-3 text-neutral-bg/70">{merchant.user.email}</td>
              <td className="px-4 py-3 text-neutral-bg/70">{merchant.user.phone ?? "—"}</td>
              <td className="px-4 py-3">
                <Badge variant={getMerchantStatusBadgeVariant(merchant.status)}>
                  {getMerchantStatusLabel(merchant.status)}
                </Badge>
              </td>
              <td className="px-4 py-3 text-neutral-bg/70">{merchant.totalOrders}</td>
              <td className="px-4 py-3 text-neutral-bg/70">{formatCurrencyFromCents(merchant.totalValueCents)}</td>
              <td className="px-4 py-3 text-neutral-bg/70">
                {new Date(merchant.createdAt).toLocaleDateString("ar")}
              </td>
              <td className="px-4 py-3">
                <Link
                  href={`/admin/merchants/${merchant.id}`}
                  className="text-sm text-gold-champagne hover:underline"
                >
                  التفاصيل
                </Link>
              </td>
            </tr>
          ))}
          {rows.length === 0 && <AdminEmptyRow colSpan={9} message="لا يوجد تجار مطابقون" />}
        </AdminTableBody>
      </AdminTable>
    </div>
  );
}
