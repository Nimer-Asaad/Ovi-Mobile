import { prisma } from "@/lib/prisma";
import { getMainWarehouse } from "@/lib/inventory";
import { AdjustStockForm, type AdjustStockProductOption } from "../AdjustStockForm";

interface AdminInventoryAdjustPageProps {
  searchParams: Promise<{ productId?: string }>;
}

export default async function AdminInventoryAdjustPage({ searchParams }: AdminInventoryAdjustPageProps) {
  const { productId } = await searchParams;
  const warehouse = await getMainWarehouse();

  const products = await prisma.product.findMany({
    where: { variantMode: "NONE" },
    orderBy: { name: "asc" },
    select: {
      id: true,
      sku: true,
      name: true,
      nameAr: true,
      isActive: true,
      inventoryItems: { where: { locationId: warehouse.id }, select: { quantity: true } },
      images: {
        select: { url: true, altText: true },
        orderBy: [{ isMain: "desc" }, { sortOrder: "asc" }],
        take: 1,
      },
    },
  });

  const options: AdjustStockProductOption[] = products.map((product) => ({
    id: product.id,
    sku: product.sku,
    name: product.name,
    nameAr: product.nameAr,
    isActive: product.isActive,
    thumbnailUrl: product.images[0]?.url ?? null,
    thumbnailAlt: product.images[0]?.altText ?? null,
    stock: product.inventoryItems.reduce((sum, item) => sum + item.quantity, 0),
  }));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-xl font-semibold text-neutral-bg">تعديل المخزون</h2>
        <p className="mt-1 text-sm text-neutral-bg/60">تسجيل إدخال أو إخراج أو تصحيح مخزون في {warehouse.name}</p>
      </div>
      <AdjustStockForm products={options} selectedProductId={productId} />
    </div>
  );
}
