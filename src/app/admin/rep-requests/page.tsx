import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import { AdminTable, AdminTableHead, AdminTableBody, AdminEmptyRow } from "@/components/admin/AdminTable";
import { RepStockRequestStatusBadge } from "@/components/reps/RepStockRequestStatusBadge";
import { STOCK_REQUEST_STATUSES } from "@/lib/constants";
import { getStockRequestStatusLabel } from "@/lib/rep-stock-request-labels";

interface AdminRepRequestsPageProps {
  searchParams: Promise<{ status?: string; salesRepId?: string }>;
}

export default async function AdminRepRequestsPage({ searchParams }: AdminRepRequestsPageProps) {
  const { status, salesRepId } = await searchParams;

  const requests = await prisma.stockRequest.findMany({
    where: {
      ...(status ? { status } : {}),
      ...(salesRepId ? { salesRepId } : {}),
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      requestNumber: true,
      status: true,
      createdAt: true,
      salesRep: { select: { id: true, user: { select: { name: true } } } },
      items: { select: { requestedQuantity: true, approvedQuantity: true } },
    },
  });

  const repName = salesRepId ? requests[0]?.salesRep.user.name : null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="طلبات مخزون السيارة"
        subtitle={
          salesRepId
            ? `طلبات المندوب${repName ? ` — ${repName}` : ""}`
            : "طلبات تزويد المخزون التي أرسلها المندوبون"
        }
      />

      <form
        method="GET"
        className="grid grid-cols-1 gap-4 rounded-card border border-navy-soft bg-navy-surface p-4 sm:grid-cols-3"
      >
        {salesRepId && <input type="hidden" name="salesRepId" value={salesRepId} />}
        <Select name="status" label="الحالة" defaultValue={status ?? ""}>
          <option value="">كل الحالات</option>
          {Object.values(STOCK_REQUEST_STATUSES).map((value) => (
            <option key={value} value={value}>
              {getStockRequestStatusLabel(value)}
            </option>
          ))}
        </Select>
        <div className="flex items-end gap-3">
          <Button type="submit">تصفية</Button>
          {salesRepId && (
            <Link href="/admin/rep-requests" className="text-sm text-gold-champagne hover:underline">
              عرض كل المندوبين
            </Link>
          )}
        </div>
      </form>

      <AdminTable>
        <AdminTableHead>
          <th className="px-4 py-3 text-start">رقم الطلب</th>
          <th className="px-4 py-3 text-start">المندوب</th>
          <th className="px-4 py-3 text-start">عدد المنتجات</th>
          <th className="px-4 py-3 text-start">الحالة</th>
          <th className="px-4 py-3 text-start">التاريخ</th>
          <th className="px-4 py-3 text-start"></th>
        </AdminTableHead>
        <AdminTableBody>
          {requests.map((request) => (
            <tr key={request.id}>
              <td className="px-4 py-3 text-neutral-bg/70">{request.requestNumber ?? request.id}</td>
              <td className="px-4 py-3 text-neutral-bg">{request.salesRep.user.name}</td>
              <td className="px-4 py-3 text-neutral-bg/70">{request.items.length}</td>
              <td className="px-4 py-3">
                <RepStockRequestStatusBadge status={request.status} />
              </td>
              <td className="px-4 py-3 text-neutral-bg/70">
                {new Date(request.createdAt).toLocaleDateString("ar")}
              </td>
              <td className="px-4 py-3">
                <Link
                  href={`/admin/rep-requests/${request.id}`}
                  className="text-sm text-gold-champagne hover:underline"
                >
                  التفاصيل
                </Link>
              </td>
            </tr>
          ))}
          {requests.length === 0 && <AdminEmptyRow colSpan={6} message="لا توجد طلبات مطابقة" />}
        </AdminTableBody>
      </AdminTable>
    </div>
  );
}
