import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { Button } from "@/components/ui/Button";
import { AdminTable, AdminTableHead, AdminTableBody, AdminEmptyRow } from "@/components/admin/AdminTable";
import { AdminStatusBadge } from "@/components/admin/AdminStatusBadge";
import { ActiveToggleForm } from "@/components/admin/ActiveToggleForm";
import { toggleCategoryActive } from "./actions";

export default async function AdminCategoriesPage() {
  const categories = await prisma.category.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { products: true } } },
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-neutral-bg">الأقسام</h2>
          <p className="mt-1 text-sm text-neutral-bg/60">إدارة أقسام المنتجات</p>
        </div>
        <Link href="/admin/categories/new">
          <Button>إضافة قسم</Button>
        </Link>
      </div>

      <AdminTable>
        <AdminTableHead>
          <th className="px-4 py-3 text-start">الاسم</th>
          <th className="px-4 py-3 text-start">الاسم بالعربية</th>
          <th className="px-4 py-3 text-start">عدد المنتجات</th>
          <th className="px-4 py-3 text-start">الحالة</th>
          <th className="px-4 py-3 text-start"></th>
        </AdminTableHead>
        <AdminTableBody>
          {categories.map((category) => (
            <tr key={category.id}>
              <td className="px-4 py-3 text-neutral-bg">{category.name}</td>
              <td className="px-4 py-3 text-neutral-bg/70">{category.nameAr ?? "—"}</td>
              <td className="px-4 py-3 text-neutral-bg/70">{category._count.products}</td>
              <td className="px-4 py-3">
                <AdminStatusBadge isActive={category.isActive} />
              </td>
              <td className="px-4 py-3">
                <div className="flex items-center justify-end gap-3">
                  <Link
                    href={`/admin/categories/${category.id}/edit`}
                    className="text-sm text-gold-champagne hover:underline"
                  >
                    تعديل
                  </Link>
                  <ActiveToggleForm
                    isActive={category.isActive}
                    action={toggleCategoryActive.bind(null, category.id)}
                  />
                </div>
              </td>
            </tr>
          ))}
          {categories.length === 0 && <AdminEmptyRow colSpan={5} message="لا توجد أقسام حتى الآن" />}
        </AdminTableBody>
      </AdminTable>
    </div>
  );
}
