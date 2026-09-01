import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/ui/PageHeader";
import { requireRole } from "@/lib/auth/guards";
import { ROLES } from "@/lib/constants";
import { ProductPurgeWorkspace } from "@/components/admin/products/ProductPurgeWorkspace";

/** Permanent bulk product purge — ADMIN ONLY (independently re-checked in
 * every server action in ./actions.ts, never relying on this page guard or
 * the parent /admin/products layout guard alone). Deliberately a completely
 * separate route/UI from the normal single-product delete
 * (removeProduct in ../actions.ts, unchanged by this feature) — this page
 * is for permanently purging test/experimental products, including all of
 * their history, on the admin's own explicit, manually-typed confirmation.
 * See src/lib/product-purge.ts for the full dependency-graph/deletion-order
 * reasoning and src/app/admin/products/purge/actions.ts for the actual
 * server actions. */
export default async function AdminProductPurgePage() {
  await requireRole([ROLES.ADMIN]);

  const categories = await prisma.category.findMany({ orderBy: { name: "asc" } });
  const categoryOptions = categories.map((category) => ({ id: category.id, label: category.nameAr ?? category.name }));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="حذف نهائي للمنتجات التجريبية"
        subtitle="عملية تدميرية لا يمكن التراجع عنها — تحذف المنتجات المختارة نهائياً مع كل سجلاتها المرتبطة"
      />
      <ProductPurgeWorkspace categories={categoryOptions} />
    </div>
  );
}
