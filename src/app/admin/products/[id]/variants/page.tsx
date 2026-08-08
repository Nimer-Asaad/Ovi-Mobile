import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/ui/PageHeader";
import { VariantManager } from "./VariantManager";
import { markVariantInventoryReady } from "./actions";
import { Button } from "@/components/ui/Button";

export default async function ProductVariantsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [product, brands] = await Promise.all([
    prisma.product.findUnique({ where: { id }, include: {
      variantAllocationBatch: true,
      variants: { include: { phoneModel: { include: { phoneBrand: true } }, inventoryItems: { select: { quantity: true } } }, orderBy: { sortOrder: "asc" } },
      inventoryItems: { where: { variantId: null, quantity: { gt: 0 } }, include: { location: { select: { name: true } } }, orderBy: { updatedAt: "asc" } },
    } }),
    prisma.phoneBrand.findMany({ where: { isActive: true }, include: { models: { where: { isActive: true }, orderBy: { name: "asc" } } }, orderBy: { name: "asc" } }),
  ]);
  if (!product) notFound();
  return <div className="flex flex-col gap-6"><PageHeader title={`Variants — ${product.nameAr ?? product.name}`} subtitle={`الحالة: ${product.variantAllocationStatus} — لا يصبح المخزون قابلاً للبيع كـVariant قبل اكتمال التوزيع اليدوي`} />
    {product.variantAllocationStatus !== "READY" && <form action={markVariantInventoryReady.bind(null, product.id)}><Button type="submit" variant="outline" disabled={product.inventoryItems.length > 0 || product.variants.filter((variant) => variant.isActive).length === 0}>اعتماد التوزيع وفتح البيع</Button>{product.inventoryItems.length > 0 && <p className="mt-2 text-xs text-amber-400">يجب توزيع كل الأرصدة القديمة في جميع المواقع أولاً.</p>}</form>}
    <VariantManager productId={product.id} inventoryReady={product.variantAllocationStatus === "READY"} brands={brands.map((brand) => ({ id: brand.id, name: brand.name, nameAr: brand.nameAr, models: brand.models.map((model) => ({ id: model.id, name: model.name, nameAr: model.nameAr })) }))}
      initialVariants={product.variants.map((variant) => ({ id: variant.id, phoneModelId: variant.phoneModelId, variantCode: variant.variantCode ?? "", isActive: variant.isActive }))}
      legacyRows={product.inventoryItems.map((row) => ({ id: row.id, locationName: row.location.name, quantity: row.quantity }))}
      variantStocks={product.variants.map((variant) => ({ id: variant.id, phoneModelId: variant.phoneModelId, variantCode: variant.variantCode ?? "", isActive: variant.isActive, label: `${variant.phoneModel.phoneBrand.nameAr ?? variant.phoneModel.phoneBrand.name} / ${variant.phoneModel.nameAr ?? variant.phoneModel.name}`, stock: variant.inventoryItems.reduce((sum, row) => sum + row.quantity, 0) }))} />
  </div>;
}
