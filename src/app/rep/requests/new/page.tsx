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
      variants: { where: { isActive: true }, select: { id: true, phoneModel: { select: { name: true, nameAr: true, phoneBrand: { select: { name: true, nameAr: true } } } } } },
      variantMode: true,
      variantAllocationStatus: true,
    },
  });

  // No customer/order context here — a stock request has no color at all
  // (see repStockTransferBatchSchema for the same reasoning), only variantId.
  const productIds = products.map((product) => product.id);
  const warehouseInventory = await prisma.inventoryItem.findMany({
    where: { productId: { in: productIds }, locationId: warehouse.id, variantId: { not: null } },
    select: { variantId: true, quantity: true },
  });
  const warehouseVariantStock = new Map(warehouseInventory.map((item) => [item.variantId as string, item.quantity]));

  const options = products.map((product) => ({
    id: product.id,
    sku: product.sku,
    name: product.name,
    nameAr: product.nameAr,
    categoryLabel: product.category?.nameAr ?? product.category?.name ?? null,
    brandLabel: product.brand?.name ?? null,
    thumbnailUrl: product.images[0]?.url ?? null,
    thumbnailAlt: product.images[0]?.altText ?? null,
    variantOptions: product.variantMode === "PHONE_COMPATIBILITY" && product.variantAllocationStatus === "READY" ? product.variants.map((variant) => ({ id: variant.id, label: `${variant.phoneModel.phoneBrand.nameAr ?? variant.phoneModel.phoneBrand.name} / ${variant.phoneModel.nameAr ?? variant.phoneModel.name}`, stock: warehouseVariantStock.get(variant.id) ?? 0 })) : [],
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
