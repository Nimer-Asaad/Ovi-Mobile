import { prisma } from "@/lib/prisma";
import { getMainWarehouse } from "@/lib/inventory";
import { AdjustStockForm, type AdjustStockProductOption } from "../AdjustStockForm";

interface AdminInventoryAdjustPageProps {
  searchParams: Promise<{ productId?: string }>;
}

// Brand → model[ → color] order, so the cascading selects below (and the
// picker's implicit ordering) present options in the same stable sequence
// as the device-inventory grouped UI and the storefront picker.
const BRAND_MODEL_ORDER = [
  { phoneModel: { phoneBrand: { sortOrder: "asc" as const } } },
  { phoneModel: { phoneBrand: { name: "asc" as const } } },
  { phoneModel: { sortOrder: "asc" as const } },
  { phoneModel: { name: "asc" as const } },
  { sortOrder: "asc" as const },
];

export default async function AdminInventoryAdjustPage({ searchParams }: AdminInventoryAdjustPageProps) {
  const { productId } = await searchParams;
  const warehouse = await getMainWarehouse();

  // Every product, regardless of tracking mode — the form below resolves
  // which selection step(s) each product actually needs. Variants and
  // device+color combinations are fetched unfiltered by isActive: a
  // disabled one must still be visible and manageable by an admin here (see
  // actions.ts), unlike the customer-facing/sale-facing selects elsewhere in
  // the app which filter to isActive: true.
  const products = await prisma.product.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      sku: true,
      name: true,
      nameAr: true,
      isActive: true,
      variantMode: true,
      inventoryTrackingMode: true,
      variantAllocationStatus: true,
      images: {
        select: { url: true, altText: true },
        orderBy: [{ isMain: "desc" }, { sortOrder: "asc" }],
        take: 1,
      },
      inventoryItems: {
        where: { locationId: warehouse.id },
        select: { quantity: true, variantId: true, deviceColorVariantId: true },
      },
      variants: {
        orderBy: BRAND_MODEL_ORDER,
        select: {
          id: true,
          isActive: true,
          phoneModel: {
            select: { id: true, name: true, nameAr: true, phoneBrandId: true, phoneBrand: { select: { id: true, name: true, nameAr: true } } },
          },
        },
      },
      deviceColorVariants: {
        orderBy: BRAND_MODEL_ORDER,
        select: {
          id: true,
          isActive: true,
          phoneModel: {
            select: { id: true, name: true, nameAr: true, phoneBrandId: true, phoneBrand: { select: { id: true, name: true, nameAr: true } } },
          },
          color: { select: { id: true, name: true, nameAr: true, hexCode: true } },
        },
      },
    },
  });

  const options: AdjustStockProductOption[] = products.map((product) => {
    const stockByVariantId = new Map(
      product.inventoryItems.filter((item) => item.variantId).map((item) => [item.variantId as string, item.quantity]),
    );
    const stockByComboId = new Map(
      product.inventoryItems.filter((item) => item.deviceColorVariantId).map((item) => [item.deviceColorVariantId as string, item.quantity]),
    );
    const plainStock = product.inventoryItems
      .filter((item) => !item.variantId && !item.deviceColorVariantId)
      .reduce((sum, item) => sum + item.quantity, 0);

    return {
      id: product.id,
      sku: product.sku,
      name: product.name,
      nameAr: product.nameAr,
      isActive: product.isActive,
      thumbnailUrl: product.images[0]?.url ?? null,
      thumbnailAlt: product.images[0]?.altText ?? null,
      stock: plainStock,
      variantMode: product.variantMode,
      inventoryTrackingMode: product.inventoryTrackingMode,
      variantAllocationStatus: product.variantAllocationStatus,
      variantChoices: product.variants.map((variant) => ({
        id: variant.id,
        isActive: variant.isActive,
        phoneBrandId: variant.phoneModel.phoneBrandId,
        brandLabel: variant.phoneModel.phoneBrand.nameAr ?? variant.phoneModel.phoneBrand.name,
        phoneModelId: variant.phoneModel.id,
        modelLabel: variant.phoneModel.nameAr ?? variant.phoneModel.name,
        stock: stockByVariantId.get(variant.id) ?? 0,
      })),
      deviceComboChoices: product.deviceColorVariants.map((combo) => ({
        id: combo.id,
        isActive: combo.isActive,
        phoneBrandId: combo.phoneModel.phoneBrandId,
        brandLabel: combo.phoneModel.phoneBrand.nameAr ?? combo.phoneModel.phoneBrand.name,
        phoneModelId: combo.phoneModel.id,
        modelLabel: combo.phoneModel.nameAr ?? combo.phoneModel.name,
        colorId: combo.color.id,
        colorLabel: combo.color.nameAr ?? combo.color.name,
        colorHex: combo.color.hexCode,
        stock: stockByComboId.get(combo.id) ?? 0,
      })),
    };
  });

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
