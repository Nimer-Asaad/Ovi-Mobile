import { prisma } from "@/lib/prisma";
import { getMainWarehouse } from "@/lib/inventory";
import { AdjustStockForm } from "../AdjustStockForm";

interface AdminInventoryAdjustPageProps {
  searchParams: Promise<{ productId?: string }>;
}

export default async function AdminInventoryAdjustPage({ searchParams }: AdminInventoryAdjustPageProps) {
  const { productId } = await searchParams;
  const warehouse = await getMainWarehouse();

  const products = await prisma.product.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      sku: true,
      name: true,
      nameAr: true,
      isActive: true,
      inventoryItems: { where: { locationId: warehouse.id }, select: { quantity: true } },
    },
  });

  const options = products.map((product) => ({
    id: product.id,
    sku: product.sku,
    name: product.name,
    nameAr: product.nameAr,
    isActive: product.isActive,
    stock: product.inventoryItems[0]?.quantity ?? 0,
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
