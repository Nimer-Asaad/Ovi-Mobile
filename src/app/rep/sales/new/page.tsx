import { requireRole } from "@/lib/auth/guards";
import { ROLES } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/ui/PageHeader";
import { NewSaleForm } from "../NewSaleForm";

export default async function RepNewSalePage() {
  const user = await requireRole([ROLES.SALES_REPRESENTATIVE]);

  const rep = await prisma.salesRepresentative.findUnique({
    where: { userId: user.id },
    select: { carStockLocation: { select: { id: true } } },
  });

  const locationId = rep?.carStockLocation?.id ?? null;

  const items = locationId
    ? await prisma.inventoryItem.findMany({
        where: { locationId, quantity: { gt: 0 } },
        orderBy: { updatedAt: "desc" },
        select: {
          quantity: true,
          product: {
            select: { id: true, sku: true, name: true, nameAr: true, retailPriceCents: true, isActive: true },
          },
        },
      })
    : [];

  const options = items
    .filter((item) => item.product.isActive)
    .map((item) => ({
      id: item.product.id,
      sku: item.product.sku,
      name: item.product.name,
      nameAr: item.product.nameAr,
      repStock: item.quantity,
      retailPriceCents: item.product.retailPriceCents,
    }));

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <PageHeader title="بيع مباشر جديد" subtitle="تسجيل عملية بيع من مخزونك الحالي" />
      <NewSaleForm products={options} />
    </div>
  );
}
