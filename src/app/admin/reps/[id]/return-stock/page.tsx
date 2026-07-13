import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { RepCarHero } from "@/components/reps/RepCarHero";
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
      <RepCarHero
        title="إرجاع مخزون من السيارة"
        subtitle={`إرجاع منتج واحد في كل مرة من سيارة ${rep.user.name} إلى المستودع الرئيسي`}
      />
      <ReturnStockForm repId={rep.id} products={options} />
    </div>
  );
}
