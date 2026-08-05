import { Prisma } from "@prisma/client";
import { requireRole } from "@/lib/auth/guards";
import { ROLES } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/ui/PageHeader";
import { getRepStockStats } from "@/lib/reps";
import { RepCarHero } from "@/components/reps/RepCarHero";
import { RepCarStockSummary } from "@/components/reps/RepCarStockSummary";
import { RepCarProductGrid } from "@/components/reps/RepCarProductGrid";

/** Rep-only, read-only stock select — deliberately never fetches any price
 * field (retail, wholesale, or cost). */
const REP_STOCK_ITEM_SELECT = {
  quantity: true,
  colorId: true,
  color: { select: { name: true, nameAr: true } },
  variantId: true,
  variant: { select: { color: { select: { name: true, nameAr: true } }, phoneModel: { select: { name: true, nameAr: true, phoneBrand: { select: { name: true, nameAr: true } } } } } },
  product: {
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
    },
  },
} satisfies Prisma.InventoryItemSelect;

export default async function RepStockPage() {
  const user = await requireRole([ROLES.SALES_REPRESENTATIVE]);

  const rep = await prisma.salesRepresentative.findUnique({
    where: { userId: user.id },
    select: { carStockLocation: { select: { id: true } } },
  });

  const locationId = rep?.carStockLocation?.id ?? null;

  const [stats, items] = await Promise.all([
    getRepStockStats(locationId),
    locationId
      ? prisma.inventoryItem.findMany({
          where: { locationId, quantity: { gt: 0 } },
          orderBy: { updatedAt: "desc" },
          select: REP_STOCK_ITEM_SELECT,
        })
      : Promise.resolve([]),
  ]);

  const gridItems = items.map((item) => ({
    productId: item.product.id,
    colorId: item.colorId,
    colorLabel: item.color ? (item.color.nameAr ?? item.color.name) : null,
    variantId: item.variantId,
    variantLabel: item.variant ? `${item.variant.phoneModel.phoneBrand.nameAr ?? item.variant.phoneModel.phoneBrand.name} / ${item.variant.phoneModel.nameAr ?? item.variant.phoneModel.name}${item.variant.color ? ` / ${item.variant.color.nameAr ?? item.variant.color.name}` : ""}` : null,
    sku: item.product.sku,
    name: item.product.name,
    nameAr: item.product.nameAr,
    quantity: item.quantity,
    categoryLabel: item.product.category?.nameAr ?? item.product.category?.name ?? null,
    brandLabel: item.product.brand?.name ?? null,
    thumbnailUrl: item.product.images[0]?.url ?? null,
    thumbnailAlt: item.product.images[0]?.altText ?? null,
  }));

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <PageHeader title="مخزوني" subtitle="المنتجات المخصصة لك حالياً" />

      <RepCarHero subtitle="المنتجات المخصصة لك حالياً — لا يظهر هنا أي سعر تكلفة" />

      {/* No valueCents prop — reps must never see cost-derived stock value. */}
      <RepCarStockSummary
        totalUnits={stats.totalUnits}
        distinctProducts={stats.distinctProducts}
        lowStockCount={stats.lowStockCount}
      />

      <RepCarProductGrid items={gridItems} emptyMessage="لا يوجد مخزون مخصص لك حالياً" />
    </div>
  );
}
