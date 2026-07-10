import { requireRole } from "@/lib/auth/guards";
import { ROLES } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
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
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-10">
      <div>
        <h1 className="text-xl font-semibold text-neutral-bg">بيع مباشر جديد</h1>
        <p className="mt-1 text-sm text-neutral-bg/60">تسجيل عملية بيع من مخزونك الحالي</p>
      </div>
      <NewSaleForm products={options} />
    </div>
  );
}
