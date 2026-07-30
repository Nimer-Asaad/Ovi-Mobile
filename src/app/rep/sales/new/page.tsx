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

  const options = items
    .filter((item) => item.product.isActive)
    .map((item) => ({
      id: item.product.id,
      sku: item.product.sku,
      name: item.product.name,
      nameAr: item.product.nameAr,
      repStock: item.quantity,
      retailPriceCents: item.product.retailPriceCents,
      thumbnailUrl: item.product.images[0]?.url ?? null,
      thumbnailAlt: item.product.images[0]?.altText ?? null,
    }));

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
