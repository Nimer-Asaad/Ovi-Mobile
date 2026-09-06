import { requireRole } from "@/lib/auth/guards";
import { ROLES, MANUAL_STOCK_MOVEMENT_TYPES } from "@/lib/constants";
import { getMainWarehouse } from "@/lib/inventory";
import { getWarehouseStockProductOptions } from "../warehouseStockOptions";
import { BulkStockMovementForm } from "../BulkStockMovementForm";

/** إدخال منتجات — dedicated STOCK_IN page for the WAREHOUSE, reachable by
 * both ADMIN and ADMIN_ASSISTANT. This is "add quantity to an EXISTING
 * product's warehouse stock", never product creation — see إضافة منتج
 * (/admin/products/new) for that separate catalog workflow, which this page
 * never touches or links to.
 *
 * Reuses BulkStockMovementForm/createBulkStockMovement exactly as the
 * legacy combined /admin/inventory/adjust screen does — direction is fixed
 * to STOCK_IN here (no mode toggle at all, unlike /adjust), so an
 * ADMIN_ASSISTANT never depends on a combined +/- page to receive stock. The
 * real authorization boundary is createBulkStockMovement's own requireRole,
 * not this page rendering only one direction. */
export default async function AdminInventoryReceivePage() {
  await requireRole([ROLES.ADMIN, ROLES.ADMIN_ASSISTANT]);

  const [warehouse, options] = await Promise.all([getMainWarehouse(), getWarehouseStockProductOptions()]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-xl font-semibold text-neutral-bg">إدخال منتجات</h2>
        <p className="mt-1 text-sm text-neutral-bg/60">إدخال كمية للمخزون في {warehouse.name}</p>
      </div>
      <BulkStockMovementForm products={options} direction={MANUAL_STOCK_MOVEMENT_TYPES.STOCK_IN} />
    </div>
  );
}
