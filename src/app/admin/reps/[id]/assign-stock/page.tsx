import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getMainWarehouse } from "@/lib/inventory";
import { RepCarHero } from "@/components/reps/RepCarHero";
import { AssignStockForm, type AssignStockProductOption } from "../../AssignStockForm";

interface AdminRepAssignStockPageProps {
  params: Promise<{ id: string }>;
}

export default async function AdminRepAssignStockPage({ params }: AdminRepAssignStockPageProps) {
  const { id } = await params;

  const rep = await prisma.salesRepresentative.findUnique({
    where: { id },
    select: { id: true, user: { select: { name: true } } },
  });

  if (!rep) {
    notFound();
  }

  const warehouse = await getMainWarehouse();

  const products = await prisma.product.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    select: {
      id: true,
      sku: true,
      name: true,
      nameAr: true,
      inventoryItems: { where: { locationId: warehouse.id }, select: { quantity: true, colorId: true, variantId: true } },
      images: {
        select: { url: true, altText: true },
        orderBy: [{ isMain: "desc" }, { sortOrder: "asc" }],
        take: 1,
      },
      colorOptions: {
        select: { color: { select: { id: true, name: true, nameAr: true, hexCode: true } } },
        orderBy: { sortOrder: "asc" },
      },
      variants: { where: { isActive: true }, select: { id: true, color: { select: { name: true, nameAr: true } }, phoneModel: { select: { name: true, nameAr: true, phoneBrand: { select: { name: true, nameAr: true } } } } } },
      variantMode: true,
      variantAllocationStatus: true,
    },
  });

  const options: AssignStockProductOption[] = products.map((product) => {
    const stockByColorId = new Map(
      product.inventoryItems.filter((item) => item.colorId).map((item) => [item.colorId as string, item.quantity]),
    );
    return {
      id: product.id,
      sku: product.sku,
      name: product.name,
      nameAr: product.nameAr,
      thumbnailUrl: product.images[0]?.url ?? null,
      thumbnailAlt: product.images[0]?.altText ?? null,
      warehouseStock: product.inventoryItems
        .filter((item) => !item.colorId)
        .reduce((sum, item) => sum + item.quantity, 0),
      colorOptions: product.colorOptions.map((option) => ({
        id: option.color.id,
        name: option.color.name,
        nameAr: option.color.nameAr,
        hexCode: option.color.hexCode,
        stock: stockByColorId.get(option.color.id) ?? 0,
      })),
      variantOptions: product.variantMode === "PHONE_COMPATIBILITY" && product.variantAllocationStatus === "READY" ? product.variants.map((variant) => ({ id: variant.id, label: `${variant.phoneModel.phoneBrand.nameAr ?? variant.phoneModel.phoneBrand.name} / ${variant.phoneModel.nameAr ?? variant.phoneModel.name}${variant.color ? ` / ${variant.color.nameAr ?? variant.color.name}` : ""}`, stock: product.inventoryItems.find((item) => item.variantId === variant.id)?.quantity ?? 0 })) : [],
    };
  });

  return (
    <div className="flex flex-col gap-6">
      <RepCarHero
        title="تحميل مخزون إلى السيارة"
        subtitle={`انقل من ${warehouse.name} إلى سيارة ${rep.user.name} — ينشئ سجل حركة يمكن طباعته كإشعار تحويل`}
      />
      <AssignStockForm repId={rep.id} products={options} />
    </div>
  );
}
