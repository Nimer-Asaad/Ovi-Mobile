import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth/guards";
import { ROLES } from "@/lib/constants";
import { PrintInventorySheetButton } from "@/components/reps/PrintInventorySheetButton";
import { RepInventorySheetView, type RepInventorySheetProduct } from "@/components/reps/RepInventorySheetView";

interface AdminRepInventorySheetPageProps {
  params: Promise<{ id: string }>;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Printable physical inventory-count / handover sheet for one rep's car —
 * ADMIN-only, matching /admin/reps/[id] (the only page this is linked from;
 * ADMIN_ASSISTANT has no access to that page either, so this isn't a
 * widening). Read-only: a single InventoryItem query for this rep's
 * REP_CAR location, quantity > 0 only — never WAREHOUSE, never another
 * rep's location, no prices/cost/supplier/customer/account data anywhere in
 * the query or the view. No write of any kind happens here. */
export default async function AdminRepInventorySheetPage({ params }: AdminRepInventorySheetPageProps) {
  const admin = await requireRole([ROLES.ADMIN]);
  const { id } = await params;

  const rep = await prisma.salesRepresentative.findUnique({
    where: { id },
    select: {
      id: true,
      employeeCode: true,
      user: { select: { name: true, phone: true } },
      carStockLocation: { select: { id: true, name: true } },
    },
  });
  if (!rep) {
    notFound();
  }

  const locationId = rep.carStockLocation?.id ?? null;

  // One bounded query for the whole sheet — every relation the view needs
  // (product, variant+phoneModel+brand, deviceColorVariant+phoneModel+
  // brand+color) is fetched via nested select in this single findMany, never
  // a per-row follow-up query. No isActive filter anywhere here: this is a
  // physical count, so an inactive product/variant/combo with real positive
  // stock must still appear (marked, not hidden) — see the view's "غير نشط"
  // badge, driven by the isActive flags selected below.
  const inventoryItems = locationId
    ? await prisma.inventoryItem.findMany({
        where: { locationId, quantity: { gt: 0 } },
        orderBy: [{ product: { name: "asc" } }],
        select: {
          quantity: true,
          productId: true,
          variantId: true,
          deviceColorVariantId: true,
          product: { select: { sku: true, name: true, nameAr: true, isActive: true } },
          variant: {
            select: {
              isActive: true,
              phoneModel: { select: { name: true, nameAr: true, phoneBrand: { select: { name: true, nameAr: true } } } },
            },
          },
          deviceColorVariant: {
            select: {
              isActive: true,
              phoneModel: { select: { name: true, nameAr: true, phoneBrand: { select: { name: true, nameAr: true } } } },
              color: { select: { name: true, nameAr: true } },
            },
          },
        },
      })
    : [];

  const byProduct = new Map<string, RepInventorySheetProduct>();
  for (const item of inventoryItems) {
    let group = byProduct.get(item.productId);
    if (!group) {
      group = {
        productId: item.productId,
        sku: item.product.sku,
        name: item.product.name,
        nameAr: item.product.nameAr,
        isActive: item.product.isActive,
        lines: [],
        totalQuantity: 0,
      };
      byProduct.set(item.productId, group);
    }

    let label: string | null = null;
    let isInactive = false;
    if (item.deviceColorVariantId && item.deviceColorVariant) {
      const combo = item.deviceColorVariant;
      label = `${combo.phoneModel.phoneBrand.nameAr ?? combo.phoneModel.phoneBrand.name} / ${combo.phoneModel.nameAr ?? combo.phoneModel.name} / ${combo.color.nameAr ?? combo.color.name}`;
      isInactive = !combo.isActive;
    } else if (item.variantId && item.variant) {
      const variant = item.variant;
      label = `${variant.phoneModel.phoneBrand.nameAr ?? variant.phoneModel.phoneBrand.name} / ${variant.phoneModel.nameAr ?? variant.phoneModel.name}`;
      isInactive = !variant.isActive;
    } else if (item.variantId || item.deviceColorVariantId) {
      // Defensive only — the FK (RESTRICT) guarantees a non-null
      // variantId/deviceColorVariantId always resolves its relation, so this
      // branch is not reachable in practice. Kept so a positive quantity is
      // never silently dropped if that invariant were ever violated.
      label = "غير مصنّف";
    }

    group.lines.push({
      key: `${item.variantId ?? ""}:${item.deviceColorVariantId ?? ""}`,
      label,
      quantity: item.quantity,
      isInactive,
    });
    group.totalQuantity += item.quantity;
  }

  for (const group of byProduct.values()) {
    group.lines.sort((a, b) => (a.label ?? "").localeCompare(b.label ?? ""));
  }

  const products = [...byProduct.values()];
  const now = new Date();
  const reference = `INV-${rep.employeeCode}-${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}-${pad2(now.getHours())}${pad2(now.getMinutes())}`;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href={`/admin/reps/${rep.id}`} className="text-sm text-gold-champagne hover:underline">
          العودة إلى تفاصيل المندوب
        </Link>
        <PrintInventorySheetButton />
      </div>

      <RepInventorySheetView
        data={{
          reference,
          generatedAt: now,
          generatedByName: admin.name,
          repName: rep.user.name,
          repPhone: rep.user.phone,
          carLocationName: rep.carStockLocation?.name ?? "لم يُخصص مخزون سيارة بعد",
          products,
          distinctProductCount: products.length,
          lineCount: inventoryItems.length,
          totalUnits: inventoryItems.reduce((sum, item) => sum + item.quantity, 0),
        }}
      />
    </div>
  );
}
