import { requireRole } from "@/lib/auth/guards";
import { ROLES } from "@/lib/constants";
import { getMainWarehouse } from "@/lib/inventory";
import { getWarehouseStockProductOptions } from "../warehouseStockOptions";
import { AdjustStockPanel } from "../AdjustStockPanel";

interface AdminInventoryAdjustPageProps {
  searchParams: Promise<{ productId?: string }>;
}

/** Legacy combined IN/OUT/Correction tool — ADMIN-only. ADMIN_ASSISTANT used
 * to land here for OUT-only bulk removal before /admin/inventory/receive and
 * /admin/inventory/issue existed as their own dedicated pages/sidebar links;
 * now that both directions have a real dedicated page, this route is kept
 * strictly for ADMIN as the one place Correction (setting an exact absolute
 * quantity, via AdjustStockForm) still lives — a materially different, more
 * dangerous operation than a plain IN/OUT that was never part of the
 * ADMIN_ASSISTANT stock-movement scope. An ADMIN_ASSISTANT hitting an old
 * bookmark to this URL is cleanly redirected to /dashboard by requireRole
 * below, same as any other ADMIN-only admin route — never a broken page. */
export default async function AdminInventoryAdjustPage({ searchParams }: AdminInventoryAdjustPageProps) {
  await requireRole([ROLES.ADMIN]);

  const { productId } = await searchParams;
  const [warehouse, options] = await Promise.all([getMainWarehouse(), getWarehouseStockProductOptions()]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-xl font-semibold text-neutral-bg">تصحيح المخزون</h2>
        <p className="mt-1 text-sm text-neutral-bg/60">تسجيل إدخال أو إخراج أو تصحيح مخزون في {warehouse.name}</p>
      </div>
      <AdjustStockPanel products={options} selectedProductId={productId} />
    </div>
  );
}
