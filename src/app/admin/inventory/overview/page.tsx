import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { requireRole } from "@/lib/auth/guards";
import { ROLES, STOCK_LOCATION_TYPES } from "@/lib/constants";
import { buildInventoryOverviewData, type InventoryOverviewLocation } from "@/lib/inventory-overview";
import { CompanyInventoryOverview } from "@/components/admin/inventory/CompanyInventoryOverview";

// Brand → model[ → color] order, matching the same stable sequence used by
// the device-inventory grouped UI, admin/inventory/adjust, and the
// assign-stock/manual-order product pickers.
const BRAND_MODEL_ORDER = [
  { phoneModel: { phoneBrand: { sortOrder: "asc" as const } } },
  { phoneModel: { phoneBrand: { name: "asc" as const } } },
  { phoneModel: { sortOrder: "asc" as const } },
  { phoneModel: { name: "asc" as const } },
  { sortOrder: "asc" as const },
];

/** Read-only visual inventory dashboard for ADMIN and ADMIN_ASSISTANT — see
 * src/lib/inventory-overview.ts for the aggregation this page feeds into a
 * client component. Deliberately separate from /admin/inventory (the
 * warehouse-only management table with STOCK_IN/OUT/ADJUSTMENT entry
 * points) — this page never renders a mutation control of any kind, and
 * covers the whole company (warehouse + every rep car), not just the
 * warehouse. */
export default async function AdminInventoryOverviewPage() {
  await requireRole([ROLES.ADMIN, ROLES.ADMIN_ASSISTANT]);

  // Four bounded, parallel queries — no per-product or per-location follow-up
  // query. locations/categories/products/inventoryItems are each fetched
  // once; buildInventoryOverviewData then aggregates entirely in memory.
  const [locationRows, categories, products, inventoryItems] = await Promise.all([
    prisma.stockLocation.findMany({
      where: { type: { in: [STOCK_LOCATION_TYPES.WAREHOUSE, STOCK_LOCATION_TYPES.REP_CAR] } },
      select: {
        id: true,
        type: true,
        name: true,
        salesRep: { select: { id: true, isActive: true, user: { select: { name: true } } } },
      },
      orderBy: { name: "asc" },
    }),
    prisma.category.findMany({ orderBy: { name: "asc" } }),
    // No isActive filter — this is a physical stock-control screen, not the
    // sale-facing catalog: a discontinued/hidden product that still has real
    // InventoryItem rows in the warehouse or a rep car must stay visible to
    // ADMIN/ADMIN_ASSISTANT (see the isActive doc comment below and
    // CompanyInventoryOverview's zero-stock filter, which already hides an
    // inactive product with 0 scope-quantity by default — no extra filter
    // needed here to get that "inactive + zero stock stays hidden" behavior).
    prisma.product.findMany({
      select: {
        id: true,
        sku: true,
        name: true,
        nameAr: true,
        isActive: true,
        categoryId: true,
        category: { select: { name: true, nameAr: true } },
        images: {
          where: { mediaType: "IMAGE" },
          select: { url: true, altText: true },
          orderBy: [{ isMain: "desc" }, { sortOrder: "asc" }],
          take: 1,
        },
        variantMode: true,
        inventoryTrackingMode: true,
        variants: {
          where: { isActive: true },
          orderBy: BRAND_MODEL_ORDER,
          select: {
            id: true,
            phoneModel: { select: { id: true, name: true, nameAr: true, phoneBrandId: true, phoneBrand: { select: { id: true, name: true, nameAr: true } } } },
          },
        },
        deviceColorVariants: {
          where: { isActive: true },
          orderBy: BRAND_MODEL_ORDER,
          select: {
            id: true,
            phoneModel: { select: { id: true, name: true, nameAr: true, phoneBrandId: true, phoneBrand: { select: { id: true, name: true, nameAr: true } } } },
            color: { select: { id: true, name: true, nameAr: true, hexCode: true } },
          },
        },
      },
      orderBy: { name: "asc" },
    }),
    // quantity > 0 only — a location/dimension with no row here simply
    // contributes 0 wherever buildInventoryOverviewData looks it up, so
    // omitting zero rows loses no information and keeps the payload small.
    // No product.isActive filter — an inactive product's real physical
    // stock must still be counted (see the product query above).
    prisma.inventoryItem.findMany({
      where: {
        quantity: { gt: 0 },
        location: { type: { in: [STOCK_LOCATION_TYPES.WAREHOUSE, STOCK_LOCATION_TYPES.REP_CAR] } },
      },
      select: { productId: true, locationId: true, variantId: true, deviceColorVariantId: true, quantity: true },
    }),
  ]);

  const locations: InventoryOverviewLocation[] = locationRows.map((location) => ({
    id: location.id,
    type: location.type as "WAREHOUSE" | "REP_CAR",
    name: location.name,
    repId: location.salesRep?.id ?? null,
    repName: location.salesRep?.user.name ?? null,
    repIsActive: location.salesRep?.isActive ?? null,
  }));

  const overviewProducts = buildInventoryOverviewData(products, inventoryItems);

  const categoryOptions = categories.map((category) => ({
    id: category.id,
    label: category.nameAr ?? category.name,
  }));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="مخزون الشركة"
        subtitle="عرض مرئي للمخزون الحالي — للقراءة فقط، لا تعديل من هذه الصفحة"
        actions={
          <Link href="/admin/inventory/company-report">
            <Button variant="outline">طباعة كشف المخزون</Button>
          </Link>
        }
      />
      <CompanyInventoryOverview locations={locations} categories={categoryOptions} products={overviewProducts} />
    </div>
  );
}
