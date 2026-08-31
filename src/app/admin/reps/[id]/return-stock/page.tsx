import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth/guards";
import { ROLES } from "@/lib/constants";
import { RepCarHero } from "@/components/reps/RepCarHero";
import { ReturnStockForm, type ReturnStockProductOption } from "../../ReturnStockForm";

interface AdminRepReturnStockPageProps {
  params: Promise<{ id: string }>;
}

// ADMIN-only — returning stock from a rep car is explicitly not part of
// ADMIN_ASSISTANT's permission set (matches returnStockFromRep's own
// requireRole in actions.ts).
export default async function AdminRepReturnStockPage({ params }: AdminRepReturnStockPageProps) {
  await requireRole([ROLES.ADMIN]);
  const { id } = await params;

  const rep = await prisma.salesRepresentative.findUnique({
    where: { id },
    select: { id: true, user: { select: { name: true } }, carStockLocation: { select: { id: true } } },
  });

  if (!rep) {
    notFound();
  }

  const locationId = rep.carStockLocation?.id ?? null;

  // REP_CAR InventoryItem rows are now always the plain aggregate bucket
  // (see the InventoryItem doc comment in schema.prisma) — one row per
  // product directly, no variant/device-color grouping needed on this side
  // at all. `variants`/`deviceColorVariants` below are the product's own
  // WAREHOUSE-side model catalog (active ones, regardless of current
  // warehouse quantity — a return only ever ADDS to warehouse stock, so
  // there's no "not enough stock" ceiling to respect when choosing a
  // destination, unlike assign-stock's picker) — this is what lets the
  // admin specify exactly which models the returned aggregate quantity is
  // being restored as (see ReturnStockForm's breakdown editor).
  const items = locationId
    ? await prisma.inventoryItem.findMany({
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
              variantMode: true,
              inventoryTrackingMode: true,
              images: {
                select: { url: true, altText: true },
                orderBy: [{ isMain: "desc" }, { sortOrder: "asc" }],
                take: 1,
              },
              variants: {
                where: { isActive: true },
                select: { id: true, phoneModel: { select: { name: true, nameAr: true, phoneBrand: { select: { name: true, nameAr: true } } } } },
              },
              deviceColorVariants: {
                where: { isActive: true },
                orderBy: [
                  { phoneModel: { phoneBrand: { sortOrder: "asc" } } },
                  { phoneModel: { phoneBrand: { name: "asc" } } },
                  { phoneModel: { sortOrder: "asc" } },
                  { phoneModel: { name: "asc" } },
                  { sortOrder: "asc" },
                ],
                select: {
                  id: true,
                  phoneModel: { select: { id: true, name: true, nameAr: true, phoneBrandId: true, phoneBrand: { select: { id: true, name: true, nameAr: true } } } },
                  color: { select: { id: true, name: true, nameAr: true, hexCode: true } },
                },
              },
            },
          },
        },
      })
    : [];

  const options: ReturnStockProductOption[] = items.map((item) => ({
    id: item.product.id,
    sku: item.product.sku,
    name: item.product.name,
    nameAr: item.product.nameAr,
    thumbnailUrl: item.product.images[0]?.url ?? null,
    thumbnailAlt: item.product.images[0]?.altText ?? null,
    repStock: item.quantity,
    variantOptions:
      item.product.variantMode === "PHONE_COMPATIBILITY"
        ? item.product.variants.map((variant) => ({
            id: variant.id,
            label: `${variant.phoneModel.phoneBrand.nameAr ?? variant.phoneModel.phoneBrand.name} / ${variant.phoneModel.nameAr ?? variant.phoneModel.name}`,
          }))
        : [],
    deviceColorVariantOptions:
      item.product.inventoryTrackingMode === "DEVICE_MODEL_COLOR"
        ? item.product.deviceColorVariants.map((combo) => ({
            id: combo.id,
            phoneBrandId: combo.phoneModel.phoneBrandId,
            brandLabel: combo.phoneModel.phoneBrand.nameAr ?? combo.phoneModel.phoneBrand.name,
            phoneModelId: combo.phoneModel.id,
            modelLabel: combo.phoneModel.nameAr ?? combo.phoneModel.name,
            colorId: combo.color.id,
            colorLabel: combo.color.nameAr ?? combo.color.name,
            colorHex: combo.color.hexCode,
          }))
        : [],
  }));

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
