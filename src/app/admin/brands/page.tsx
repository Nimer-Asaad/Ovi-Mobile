import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import { AdminTable, AdminTableHead, AdminTableBody, AdminEmptyRow } from "@/components/admin/AdminTable";
import { AdminStatusBadge } from "@/components/admin/AdminStatusBadge";
import { ActiveToggleForm } from "@/components/admin/ActiveToggleForm";
import { toggleBrandActive } from "./actions";

export default async function AdminBrandsPage() {
  const brands = await prisma.brand.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { products: true } } },
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="العلامات التجارية"
        subtitle="إدارة العلامات التجارية"
        actions={
          <Link href="/admin/brands/new">
            <Button>إضافة علامة تجارية</Button>
          </Link>
        }
      />

      <AdminTable>
        <AdminTableHead>
          <th className="px-4 py-3 text-start">الاسم</th>
          <th className="px-4 py-3 text-start">عدد المنتجات</th>
          <th className="px-4 py-3 text-start">الحالة</th>
          <th className="px-4 py-3 text-start"></th>
        </AdminTableHead>
        <AdminTableBody>
          {brands.map((brand) => (
            <tr key={brand.id}>
              <td className="px-4 py-3 text-neutral-bg">{brand.name}</td>
              <td className="px-4 py-3 text-neutral-bg/70">{brand._count.products}</td>
              <td className="px-4 py-3">
                <AdminStatusBadge isActive={brand.isActive} />
              </td>
              <td className="px-4 py-3">
                <div className="flex items-center justify-end gap-3">
                  <Link
                    href={`/admin/brands/${brand.id}/edit`}
                    className="text-sm text-gold-champagne hover:underline"
                  >
                    تعديل
                  </Link>
                  <ActiveToggleForm
                    isActive={brand.isActive}
                    action={toggleBrandActive.bind(null, brand.id)}
                  />
                </div>
              </td>
            </tr>
          ))}
          {brands.length === 0 && <AdminEmptyRow colSpan={4} message="لا توجد علامات تجارية حتى الآن" />}
        </AdminTableBody>
      </AdminTable>
    </div>
  );
}
