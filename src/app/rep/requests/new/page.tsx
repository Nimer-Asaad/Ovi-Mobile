import { requireRole } from "@/lib/auth/guards";
import { ROLES } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import { getMainWarehouse } from "@/lib/inventory";
import { PageHeader } from "@/components/ui/PageHeader";
import { RepStockRequestForm } from "@/components/reps/RepStockRequestForm";

export default async function NewRepStockRequestPage() {
  await requireRole([ROLES.SALES_REPRESENTATIVE]);

  const warehouse = await getMainWarehouse();

  const products = await prisma.product.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    select: {
      id: true,
      sku: true,
      name: true,
      nameAr: true,
      category: { select: { name: true, nameAr: true } },
      brand: { select: { name: true } },
      images: {
        select: { url: true, altText: true },
        orderBy: [{ isMain: "desc" }, { sortOrder: "asc" }],
        take: 1,
      },
      colorOptions: {
        select: { color: { select: { id: true, name: true, nameAr: true, hexCode: true } } },
        orderBy: { sortOrder: "asc" },
      },
    },
  });

  const productIds = products.map((product) => product.id);
  const warehouseInventory = await prisma.inventoryItem.findMany({
    where: { productId: { in: productIds }, locationId: warehouse.id, colorId: { not: null } },
    select: { productId: true, colorId: true, quantity: true },
  });
  const warehouseStockByKey = new Map(
    warehouseInventory.map((item) => [`${item.productId}:${item.colorId}`, item.quantity]),
  );

  const options = products.map((product) => ({
    id: product.id,
    sku: product.sku,
    name: product.name,
    nameAr: product.nameAr,
    categoryLabel: product.category?.nameAr ?? product.category?.name ?? null,
    brandLabel: product.brand?.name ?? null,
    thumbnailUrl: product.images[0]?.url ?? null,
    thumbnailAlt: product.images[0]?.altText ?? null,
    colorOptions: product.colorOptions.map((option) => ({
      id: option.color.id,
      name: option.color.name,
      nameAr: option.color.nameAr,
      hexCode: option.color.hexCode,
      stock: warehouseStockByKey.get(`${product.id}:${option.color.id}`) ?? 0,
    })),
  }));

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <PageHeader
        title="طلب تزويد مخزون السيارة"
        subtitle="اختر المنتجات والكميات التي تحتاجها — سيقوم المدير بمراجعة الطلب وتجهيزه"
      />

      <RepStockRequestForm products={options} />
    </div>
  );
}
