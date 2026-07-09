import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { ReturnStockForm } from "../../ReturnStockForm";

interface AdminRepReturnStockPageProps {
  params: Promise<{ id: string }>;
}

export default async function AdminRepReturnStockPage({ params }: AdminRepReturnStockPageProps) {
  const { id } = await params;

  const rep = await prisma.salesRepresentative.findUnique({
    where: { id },
    select: { id: true, user: { select: { name: true } }, carStockLocation: { select: { id: true } } },
  });

  if (!rep) {
    notFound();
  }

  const locationId = rep.carStockLocation?.id ?? null;

  const items = locationId
    ? await prisma.inventoryItem.findMany({
        where: { locationId, quantity: { gt: 0 } },
        orderBy: { updatedAt: "desc" },
        select: {
          quantity: true,
          product: { select: { id: true, sku: true, name: true, nameAr: true } },
        },
      })
    : [];

  const options = items.map((item) => ({
    id: item.product.id,
    sku: item.product.sku,
    name: item.product.name,
    nameAr: item.product.nameAr,
    repStock: item.quantity,
  }));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-xl font-semibold text-neutral-bg">إرجاع مخزون — {rep.user.name}</h2>
        <p className="mt-1 text-sm text-neutral-bg/60">إرجاع مخزون من المندوب إلى المستودع الرئيسي</p>
      </div>
      <ReturnStockForm repId={rep.id} products={options} />
    </div>
  );
}
