import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import { AdminTable, AdminTableHead, AdminTableBody, AdminEmptyRow } from "@/components/admin/AdminTable";
import { AdminStatusBadge } from "@/components/admin/AdminStatusBadge";
import { ActiveToggleForm } from "@/components/admin/ActiveToggleForm";
import { toggleColorActive } from "./actions";

export default async function AdminColorsPage() {
  const colors = await prisma.color.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { productOptions: true } } },
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="الألوان"
        subtitle="القائمة الرئيسية للألوان — أضِف لوناً هنا ثم اربطه بالمنتجات التي تتوفر به"
        actions={
          <Link href="/admin/colors/new">
            <Button>إضافة لون</Button>
          </Link>
        }
      />

      <AdminTable>
        <AdminTableHead>
          <th className="px-4 py-3 text-start">اللون</th>
          <th className="px-4 py-3 text-start">الاسم</th>
          <th className="px-4 py-3 text-start">عدد المنتجات</th>
          <th className="px-4 py-3 text-start">الحالة</th>
          <th className="px-4 py-3 text-start"></th>
        </AdminTableHead>
        <AdminTableBody>
          {colors.map((color) => (
            <tr key={color.id}>
              <td className="px-4 py-3">
                <span
                  aria-hidden="true"
                  className="inline-block h-6 w-6 rounded-full border border-navy-soft align-middle"
                  style={{ backgroundColor: color.hexCode ?? "transparent" }}
                />
              </td>
              <td className="px-4 py-3 text-neutral-bg">{color.nameAr ?? color.name}</td>
              <td className="px-4 py-3 text-neutral-bg/70">{color._count.productOptions}</td>
              <td className="px-4 py-3">
                <AdminStatusBadge isActive={color.isActive} />
              </td>
              <td className="px-4 py-3">
                <div className="flex items-center justify-end gap-3">
                  <Link
                    href={`/admin/colors/${color.id}/edit`}
                    className="text-sm text-gold-champagne hover:underline"
                  >
                    تعديل
                  </Link>
                  <ActiveToggleForm isActive={color.isActive} action={toggleColorActive.bind(null, color.id)} />
                </div>
              </td>
            </tr>
          ))}
          {colors.length === 0 && <AdminEmptyRow colSpan={5} message="لا توجد ألوان حتى الآن" />}
        </AdminTableBody>
      </AdminTable>
    </div>
  );
}
