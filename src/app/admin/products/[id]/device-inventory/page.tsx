import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getMainWarehouse } from "@/lib/inventory";
import { PRODUCT_INVENTORY_TRACKING_MODES } from "@/lib/constants";
import { PageHeader } from "@/components/ui/PageHeader";
import { DeviceInventoryManager } from "./DeviceInventoryManager";

export default async function DeviceInventoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [product, warehouse] = await Promise.all([
    prisma.product.findUnique({ where: { id }, select: { id: true, name: true, nameAr: true, inventoryTrackingMode: true } }),
    getMainWarehouse(),
  ]);
  if (!product) notFound();

  const [brands, combos, colors] = await Promise.all([
    prisma.phoneBrand.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: { models: { where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] } },
    }),
    prisma.deviceColorVariant.findMany({
      where: { productId: id },
      // Brand → model → color order, so the grouped UI below (one section
      // per model, colors listed underneath) renders in a stable, obvious
      // sequence instead of insertion order.
      orderBy: [
        { phoneModel: { phoneBrand: { sortOrder: "asc" } } },
        { phoneModel: { phoneBrand: { name: "asc" } } },
        { phoneModel: { sortOrder: "asc" } },
        { phoneModel: { name: "asc" } },
        { sortOrder: "asc" },
        { createdAt: "asc" },
      ],
      include: {
        phoneModel: { include: { phoneBrand: true } },
        color: true,
        inventoryItems: { where: { locationId: warehouse.id }, select: { quantity: true } },
      },
    }),
    prisma.color.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`تركيبات المخزون — ${product.nameAr ?? product.name}`}
        subtitle={`مخزون مستقل لكل تركيبة ماركة + موديل + لون في ${warehouse.name}`}
        actions={
          <Link href={`/admin/products/${product.id}/edit`} className="text-sm text-gold-champagne hover:underline">
            العودة لتعديل المنتج ←
          </Link>
        }
      />

      {product.inventoryTrackingMode !== PRODUCT_INVENTORY_TRACKING_MODES.DEVICE_MODEL_COLOR ? (
        <div className="rounded-card border border-amber-500/40 bg-navy-surface p-5 text-sm text-neutral-bg/80">
          هذا المنتج لا يستخدم وضع &quot;مخزون حسب نوع الجهاز واللون&quot; حالياً. غيّر طريقة تتبّع المخزون من صفحة
          تعديل المنتج أولاً.
        </div>
      ) : (
        // brands/colors below are the ACTIVE-only lists offered when adding a
        // *new* combination — deliberately unrelated to which existing
        // combinations are shown. combos is fetched with no isActive filter
        // on its own or on its related phoneBrand/phoneModel/color, so a
        // brand/model/color being deactivated after a combination was
        // created never hides that combination's history from this screen;
        // DeviceInventoryManager renders the combos table unconditionally
        // and only disables the "add new" form when brands/colors is empty.
        <DeviceInventoryManager
          productId={product.id}
          brands={brands.map((brand) => ({
            id: brand.id,
            name: brand.name,
            nameAr: brand.nameAr,
            models: brand.models.map((model) => ({ id: model.id, name: model.name, nameAr: model.nameAr })),
          }))}
          colors={colors.map((color) => ({ id: color.id, name: color.name, nameAr: color.nameAr, hexCode: color.hexCode }))}
          combos={combos.map((combo) => ({
            id: combo.id,
            isActive: combo.isActive,
            phoneModelId: combo.phoneModelId,
            brandLabel: combo.phoneModel.phoneBrand.nameAr ?? combo.phoneModel.phoneBrand.name,
            modelLabel: combo.phoneModel.nameAr ?? combo.phoneModel.name,
            colorLabel: combo.color.nameAr ?? combo.color.name,
            colorHex: combo.color.hexCode,
            quantity: combo.inventoryItems.reduce((sum, item) => sum + item.quantity, 0),
          }))}
        />
      )}
    </div>
  );
}
