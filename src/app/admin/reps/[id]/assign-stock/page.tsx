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
      inventoryItems: { where: { locationId: warehouse.id }, select: { quantity: true, variantId: true, deviceColorVariantId: true } },
      images: {
        select: { url: true, altText: true },
        orderBy: [{ isMain: "desc" }, { sortOrder: "asc" }],
        take: 1,
      },
      variants: { where: { isActive: true }, select: { id: true, phoneModel: { select: { name: true, nameAr: true, phoneBrand: { select: { name: true, nameAr: true } } } } } },
      variantMode: true,
      variantAllocationStatus: true,
      inventoryTrackingMode: true,
      // Brand → model → color order, so the picker's grouped model list
      // (see ProductQuickPicker's dcModelGroups) renders in a stable
      // sequence instead of insertion order.
      deviceColorVariants: {
        where: { isActive: true },
        orderBy: [
          { phoneModel: { phoneBrand: { sortOrder: "asc" } } },
          { phoneModel: { phoneBrand: { name: "asc" } } },
          { phoneModel: { sortOrder: "asc" } },
          { phoneModel: { name: "asc" } },
          { sortOrder: "asc" },
        ],
        select: {
          id: true,
          phoneModel: { select: { id: true, name: true, nameAr: true, phoneBrandId: true, phoneBrand: { select: { id: true, name: true, nameAr: true } } } },
          color: { select: { id: true, name: true, nameAr: true, hexCode: true } },
        },
      },
    },
  });

  // No customer/order context here — a warehouse-to-rep transfer has no
  // color at all (see repStockTransferSchema for the same reasoning).
  const options: AssignStockProductOption[] = products.map((product) => ({
    id: product.id,
    sku: product.sku,
    name: product.name,
    nameAr: product.nameAr,
    thumbnailUrl: product.images[0]?.url ?? null,
    thumbnailAlt: product.images[0]?.altText ?? null,
    warehouseStock: product.inventoryItems
      .filter((item) => !item.variantId && !item.deviceColorVariantId)
      .reduce((sum, item) => sum + item.quantity, 0),
    variantOptions: product.variantMode === "PHONE_COMPATIBILITY" && product.variantAllocationStatus === "READY" ? product.variants.map((variant) => ({ id: variant.id, label: `${variant.phoneModel.phoneBrand.nameAr ?? variant.phoneModel.phoneBrand.name} / ${variant.phoneModel.nameAr ?? variant.phoneModel.name}`, stock: product.inventoryItems.find((item) => item.variantId === variant.id)?.quantity ?? 0 })) : [],
    deviceColorVariantOptions: product.inventoryTrackingMode === "DEVICE_MODEL_COLOR"
      ? product.deviceColorVariants.map((combo) => ({
          id: combo.id,
          phoneBrandId: combo.phoneModel.phoneBrandId,
          brandLabel: combo.phoneModel.phoneBrand.nameAr ?? combo.phoneModel.phoneBrand.name,
          phoneModelId: combo.phoneModel.id,
          modelLabel: combo.phoneModel.nameAr ?? combo.phoneModel.name,
          colorId: combo.color.id,
          colorLabel: combo.color.nameAr ?? combo.color.name,
          colorHex: combo.color.hexCode,
          stock: product.inventoryItems.find((item) => item.deviceColorVariantId === combo.id)?.quantity ?? 0,
        }))
      : [],
  }));

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
