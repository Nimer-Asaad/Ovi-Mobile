import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { RepCarHero } from "@/components/reps/RepCarHero";
import { ReturnStockForm, type ReturnStockProductOption } from "../../ReturnStockForm";

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
          colorId: true,
          color: { select: { id: true, name: true, nameAr: true, hexCode: true } },
          product: {
            select: {
              id: true,
              sku: true,
              name: true,
              nameAr: true,
              images: {
                select: { url: true, altText: true },
                orderBy: [{ isMain: "desc" }, { sortOrder: "asc" }],
                take: 1,
              },
            },
          },
        },
      })
    : [];

  const byProductId = new Map<string, ReturnStockProductOption>();
  for (const item of items) {
    const existing = byProductId.get(item.product.id) ?? {
      id: item.product.id,
      sku: item.product.sku,
      name: item.product.name,
      nameAr: item.product.nameAr,
      thumbnailUrl: item.product.images[0]?.url ?? null,
      thumbnailAlt: item.product.images[0]?.altText ?? null,
      repStock: 0,
      colorOptions: [],
    };
    if (item.colorId && item.color) {
      existing.colorOptions!.push({
        id: item.color.id,
        name: item.color.name,
        nameAr: item.color.nameAr,
        hexCode: item.color.hexCode,
        stock: item.quantity,
      });
    } else {
      existing.repStock = item.quantity;
    }
    byProductId.set(item.product.id, existing);
  }
  const options = [...byProductId.values()];

  return (
    <div className="flex flex-col gap-6">
      <RepCarHero
        title="إرجاع مخزون من السيارة"
        subtitle={`إرجاع من سيارة ${rep.user.name} إلى المستودع الرئيسي`}
      />
      <ReturnStockForm repId={rep.id} products={options} />
    </div>
  );
}
