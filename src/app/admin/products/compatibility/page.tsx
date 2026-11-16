import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/ui/PageHeader";
import { LinkButton } from "@/components/ui/LinkButton";
import { BulkCompatibilityManager, type BulkCompatibilityProduct } from "@/components/admin/products/BulkCompatibilityManager";
import { getCompatibilityBrandOptions } from "@/lib/product-phone-compatibility";

/** Bulk "توافق الأجهزة" — ADMIN only (the /admin/products layout already
 * narrows to ADMIN, so ADMIN_ASSISTANT never reaches it). Three bounded,
 * parallel reads (products + their links, categories, brand→model options);
 * writes go through the compatibility actions, which only ever touch the
 * metadata table — never stock, variants or product status. */
export default async function ProductCompatibilityBulkPage() {
  const [products, categories, brands] = await Promise.all([
    prisma.product.findMany({
      orderBy: [{ nameAr: "asc" }, { name: "asc" }],
      select: {
        id: true,
        sku: true,
        name: true,
        nameAr: true,
        categoryId: true,
        category: { select: { name: true, nameAr: true } },
        phoneCompatibilities: { select: { phoneModelId: true } },
      },
    }),
    prisma.category.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, nameAr: true } }),
    getCompatibilityBrandOptions(),
  ]);

  const modelLabels: Record<string, string> = {};
  for (const brand of brands) for (const model of brand.models) modelLabels[model.id] = `${brand.label} — ${model.label}`;

  const rows: BulkCompatibilityProduct[] = products.map((product) => ({
    id: product.id,
    sku: product.sku,
    name: product.nameAr ?? product.name,
    categoryId: product.categoryId,
    categoryName: product.category?.nameAr ?? product.category?.name ?? null,
    modelIds: product.phoneCompatibilities.map((link) => link.phoneModelId),
  }));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="توافق الأجهزة"
        subtitle="اربط الكفرات واللزقات والعدسات بموديلات الهواتف التي تناسبها — للبحث فقط، لا يغيّر المخزون"
        actions={
          <LinkButton href="/admin/products" variant="outline">
            العودة إلى المنتجات
          </LinkButton>
        }
      />
      <BulkCompatibilityManager products={rows} categories={categories.map((category) => ({ id: category.id, label: category.nameAr ?? category.name }))} brands={brands} modelLabels={modelLabels} />
    </div>
  );
}
