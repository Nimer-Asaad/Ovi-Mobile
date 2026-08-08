import { requireRole } from "@/lib/auth/guards";
import { ROLES, ORDER_SOURCES } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/ui/PageHeader";
import { NewSaleForm } from "../NewSaleForm";

export default async function RepNewSalePage() {
  const user = await requireRole([ROLES.SALES_REPRESENTATIVE]);

  const rep = await prisma.salesRepresentative.findUnique({
    where: { userId: user.id },
    select: { id: true, carStockLocation: { select: { id: true } } },
  });

  const locationId = rep?.carStockLocation?.id ?? null;

  const [items, pastOrders] = await Promise.all([
    locationId
      ? prisma.inventoryItem.findMany({
          where: { locationId, quantity: { gt: 0 } },
          orderBy: { updatedAt: "desc" },
          select: {
            quantity: true,
            variantId: true,
            variant: { select: { id: true, phoneModel: { select: { name: true, nameAr: true, phoneBrand: { select: { name: true, nameAr: true } } } } } },
            product: {
              select: {
                id: true,
                sku: true,
                name: true,
                nameAr: true,
                retailPriceCents: true,
                isActive: true,
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
            },
          },
        })
      : Promise.resolve([]),
    // Most recent contact details per phone number this rep has sold to
    // before, used to auto-fill the customer fields instead of re-typing
    // them (and re-registering the "same" customer under slightly different
    // details) on every repeat sale.
    rep
      ? prisma.order.findMany({
          where: { createdByRepId: rep.id, source: ORDER_SOURCES.REP_SALE, contactPhone: { not: null } },
          distinct: ["contactPhone"],
          orderBy: { createdAt: "desc" },
          select: { contactName: true, contactPhone: true, city: true, shippingAddress: true },
          take: 100,
        })
      : Promise.resolve([]),
  ]);

  // Group rep-car InventoryItem rows into one option per product — a
  // non-variant product's stock lands in `repStock`, a phone-variant
  // product's per model in `variantOptions[].stock`. Only in-stock rows
  // exist here (the query filters quantity > 0), unlike the stock-request
  // page, since a rep can only sell what's physically in the car right now.
  // `colorOptions` is independent of stock — it's the product's descriptive
  // color pick-list (ProductColorOption), never a stock dimension.
  interface SaleColorOption {
    id: string;
    name: string;
    nameAr: string | null;
    hexCode: string | null;
  }
  interface SaleProductAccumulator {
    id: string;
    sku: string;
    name: string;
    nameAr: string | null;
    retailPriceCents: number;
    thumbnailUrl: string | null;
    thumbnailAlt: string | null;
    repStock: number;
    colorOptions: SaleColorOption[];
    variantOptions: { id: string; label: string; stock: number }[];
  }

  const byProductId = new Map<string, SaleProductAccumulator>();
  for (const item of items) {
    if (!item.product.isActive) continue;
    const existing = byProductId.get(item.product.id) ?? {
      id: item.product.id,
      sku: item.product.sku,
      name: item.product.name,
      nameAr: item.product.nameAr,
      retailPriceCents: item.product.retailPriceCents,
      thumbnailUrl: item.product.images[0]?.url ?? null,
      thumbnailAlt: item.product.images[0]?.altText ?? null,
      repStock: 0,
      colorOptions: item.product.colorOptions.map((option) => ({
        id: option.color.id,
        name: option.color.name,
        nameAr: option.color.nameAr,
        hexCode: option.color.hexCode,
      })),
      variantOptions: [],
    };
    if (item.variantId && item.variant) {
      existing.variantOptions.push({ id: item.variant.id, label: `${item.variant.phoneModel.phoneBrand.nameAr ?? item.variant.phoneModel.phoneBrand.name} / ${item.variant.phoneModel.nameAr ?? item.variant.phoneModel.name}`, stock: item.quantity });
    } else {
      existing.repStock = item.quantity;
    }
    byProductId.set(item.product.id, existing);
  }
  const options = [...byProductId.values()];

  const customers = pastOrders
    .filter((order) => order.contactName && order.contactPhone)
    .map((order) => ({
      name: order.contactName as string,
      phone: order.contactPhone as string,
      city: order.city,
      address: order.shippingAddress,
    }));

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <PageHeader title="بيع مباشر جديد" subtitle="تسجيل عملية بيع من مخزونك الحالي" />
      <NewSaleForm products={options} customers={customers} />
    </div>
  );
}
