import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getMainWarehouse } from "@/lib/inventory";
import { RepCarHero } from "@/components/reps/RepCarHero";
import { AssignStockForm } from "../../AssignStockForm";

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
      inventoryItems: { where: { locationId: warehouse.id }, select: { quantity: true } },
    },
  });

  const options = products.map((product) => ({
    id: product.id,
    sku: product.sku,
    name: product.name,
    nameAr: product.nameAr,
    warehouseStock: product.inventoryItems[0]?.quantity ?? 0,
  }));

  return (
    <div className="flex flex-col gap-6">
      <RepCarHero
        title="تحميل مخزون إلى السيارة"
        subtitle={`نقل منتج واحد في كل مرة من ${warehouse.name} إلى سيارة ${rep.user.name} — ينشئ سجل حركة يمكن طباعته كإشعار تحويل`}
      />
      <AssignStockForm repId={rep.id} products={options} />
    </div>
  );
}
