import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { requireRole } from "@/lib/auth/guards";
import { ROLES } from "@/lib/constants";
import { loadInventoryOverviewPageData } from "@/lib/inventory-overview-load";
import { brandIdForModel } from "@/lib/inventory-device-filter";
import { CompanyInventoryOverview } from "@/components/admin/inventory/CompanyInventoryOverview";

interface AdminInventoryOverviewPageProps {
  /** ?deviceModelId=<PhoneModel.id> — the "حسب نوع الجهاز" filter, so a
   * refresh or a shared admin URL keeps the selected device. */
  searchParams: Promise<{ deviceModelId?: string | string[] }>;
}

/** Read-only visual inventory dashboard for ADMIN and ADMIN_ASSISTANT — see
 * src/lib/inventory-overview.ts for the aggregation this page feeds into a
 * client component, and src/lib/inventory-overview-load.ts for the bounded,
 * parallel queries behind it. Deliberately separate from /admin/inventory (the
 * warehouse-only management table with STOCK_IN/OUT/ADJUSTMENT entry
 * points) — this page never renders a mutation control of any kind, and
 * covers the whole company (warehouse + every rep car), not just the
 * warehouse. */
export default async function AdminInventoryOverviewPage({ searchParams }: AdminInventoryOverviewPageProps) {
  const user = await requireRole([ROLES.ADMIN, ROLES.ADMIN_ASSISTANT]);
  const { locations, categories, products, deviceBrands } = await loadInventoryOverviewPageData();

  // Only a real, active phone model id is honoured — anything else (stale
  // link, typo, array) silently falls back to "كل الأصناف".
  const { deviceModelId: rawDeviceModelId } = await searchParams;
  const requestedModelId = typeof rawDeviceModelId === "string" ? rawDeviceModelId : "";
  const initialDeviceModelId = brandIdForModel(deviceBrands, requestedModelId) ? requestedModelId : "";

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
      <CompanyInventoryOverview
        locations={locations}
        categories={categories}
        products={products}
        deviceBrands={deviceBrands}
        initialDeviceModelId={initialDeviceModelId}
        canPrintProduct={user.role === ROLES.ADMIN}
      />
    </div>
  );
}
