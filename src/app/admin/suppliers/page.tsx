import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import { AdminTable, AdminTableHead, AdminTableBody, AdminEmptyRow } from "@/components/admin/AdminTable";
import { AdminStatusBadge } from "@/components/admin/AdminStatusBadge";
import { ActiveToggleForm } from "@/components/admin/ActiveToggleForm";
import { toggleSupplierActive } from "./actions";

export default async function AdminSuppliersPage() {
  const suppliers = await prisma.supplier.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { products: true } } },
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="الموردون"
        subtitle="إدارة الموردين"
        actions={
          <Link href="/admin/suppliers/new">
            <Button>إضافة مورد</Button>
          </Link>
        }
      />

      <AdminTable>
        <AdminTableHead>
          <th className="px-4 py-3 text-start">الاسم</th>
          <th className="px-4 py-3 text-start">الهاتف</th>
          <th className="px-4 py-3 text-start">البريد الإلكتروني</th>
          <th className="px-4 py-3 text-start">عدد المنتجات</th>
          <th className="px-4 py-3 text-start">الحالة</th>
          <th className="px-4 py-3 text-start"></th>
        </AdminTableHead>
        <AdminTableBody>
          {suppliers.map((supplier) => (
            <tr key={supplier.id}>
              <td className="px-4 py-3 text-neutral-bg">{supplier.name}</td>
              <td className="px-4 py-3 text-neutral-bg/70">{supplier.phone ?? "—"}</td>
              <td className="px-4 py-3 text-neutral-bg/70">{supplier.email ?? "—"}</td>
              <td className="px-4 py-3 text-neutral-bg/70">{supplier._count.products}</td>
              <td className="px-4 py-3">
                <AdminStatusBadge isActive={supplier.isActive} />
              </td>
              <td className="px-4 py-3">
                <div className="flex items-center justify-end gap-3">
                  <Link
                    href={`/admin/suppliers/${supplier.id}/edit`}
                    className="text-sm text-gold-champagne hover:underline"
                  >
                    تعديل
                  </Link>
                  <ActiveToggleForm
                    isActive={supplier.isActive}
                    action={toggleSupplierActive.bind(null, supplier.id)}
                  />
                </div>
              </td>
            </tr>
          ))}
          {suppliers.length === 0 && <AdminEmptyRow colSpan={6} message="لا يوجد موردون حتى الآن" />}
        </AdminTableBody>
      </AdminTable>
    </div>
  );
}
