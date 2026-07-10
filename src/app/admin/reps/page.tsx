import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { Badge } from "@/components/ui/Badge";
import { PageHeader } from "@/components/ui/PageHeader";
import { AdminTable, AdminTableHead, AdminTableBody, AdminEmptyRow } from "@/components/admin/AdminTable";
import { AdminStatusBadge } from "@/components/admin/AdminStatusBadge";
import { formatCurrencyFromCents } from "@/lib/utils";
import { getRepStockStats, getRepStockValueCents } from "@/lib/reps";

export default async function AdminRepsPage() {
  const reps = await prisma.salesRepresentative.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      isActive: true,
      employeeCode: true,
      user: { select: { name: true, email: true, phone: true, isActive: true } },
      carStockLocation: { select: { id: true } },
    },
  });

  const rows = await Promise.all(
    reps.map(async (rep) => {
      const locationId = rep.carStockLocation?.id ?? null;
      const [stats, valueCents] = await Promise.all([
        getRepStockStats(locationId),
        getRepStockValueCents(locationId),
      ]);
      return { ...rep, stats, valueCents };
    }),
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="المندوبون" subtitle="مخزون المندوبين المخصص من المستودع الرئيسي" />

      <AdminTable>
        <AdminTableHead>
          <th className="px-4 py-3 text-start">الاسم</th>
          <th className="px-4 py-3 text-start">البريد الإلكتروني</th>
          <th className="px-4 py-3 text-start">الهاتف</th>
          <th className="px-4 py-3 text-start">الحالة</th>
          <th className="px-4 py-3 text-start">إجمالي الوحدات</th>
          <th className="px-4 py-3 text-start">قيمة المخزون</th>
          <th className="px-4 py-3 text-start"></th>
        </AdminTableHead>
        <AdminTableBody>
          {rows.map((rep) => (
            <tr key={rep.id}>
              <td className="px-4 py-3 text-neutral-bg">
                {rep.user.name}
                <span className="ms-2 text-xs text-neutral-bg/50">{rep.employeeCode}</span>
              </td>
              <td className="px-4 py-3 text-neutral-bg/70">{rep.user.email}</td>
              <td className="px-4 py-3 text-neutral-bg/70">{rep.user.phone ?? "—"}</td>
              <td className="px-4 py-3">
                <AdminStatusBadge isActive={rep.isActive && rep.user.isActive} />
              </td>
              <td className="px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className="text-neutral-bg">{rep.stats.totalUnits}</span>
                  {rep.stats.lowStockCount > 0 && (
                    <Badge variant="warning">{rep.stats.lowStockCount} منخفض</Badge>
                  )}
                </div>
              </td>
              <td className="px-4 py-3 text-neutral-bg/70">{formatCurrencyFromCents(rep.valueCents)}</td>
              <td className="px-4 py-3">
                <Link href={`/admin/reps/${rep.id}`} className="text-sm text-gold-champagne hover:underline">
                  التفاصيل
                </Link>
              </td>
            </tr>
          ))}
          {rows.length === 0 && <AdminEmptyRow colSpan={7} message="لا يوجد مندوبون حتى الآن" />}
        </AdminTableBody>
      </AdminTable>
    </div>
  );
}
