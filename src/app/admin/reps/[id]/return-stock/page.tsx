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
          variantId: true,
          variant: { select: { id: true, phoneModel: { select: { name: true, nameAr: true, phoneBrand: { select: { name: true, nameAr: true } } } } } },
          deviceColorVariantId: true,
          deviceColorVariant: { select: { id: true, phoneModel: { select: { name: true, nameAr: true, phoneBrand: { select: { name: true, nameAr: true } } } }, color: { select: { name: true, nameAr: true } } } },
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

  // No customer/order context here — a rep-to-warehouse return has no
  // color at all (see repStockTransferSchema for the same reasoning).
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
      variantOptions: [],
      deviceColorVariantOptions: [],
    };
    if (item.variantId && item.variant) {
      existing.variantOptions!.push({ id: item.variant.id, label: `${item.variant.phoneModel.phoneBrand.nameAr ?? item.variant.phoneModel.phoneBrand.name} / ${item.variant.phoneModel.nameAr ?? item.variant.phoneModel.name}`, stock: item.quantity });
    } else if (item.deviceColorVariantId && item.deviceColorVariant) {
      existing.deviceColorVariantOptions!.push({ id: item.deviceColorVariant.id, label: `${item.deviceColorVariant.phoneModel.phoneBrand.nameAr ?? item.deviceColorVariant.phoneModel.phoneBrand.name} / ${item.deviceColorVariant.phoneModel.nameAr ?? item.deviceColorVariant.phoneModel.name} / ${item.deviceColorVariant.color.nameAr ?? item.deviceColorVariant.color.name}`, stock: item.quantity });
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
