import { requireRole } from "@/lib/auth/guards";
import { ROLES, MANUAL_STOCK_MOVEMENT_TYPES } from "@/lib/constants";
import { getMainWarehouse } from "@/lib/inventory";
import { getWarehouseStockProductOptions } from "../warehouseStockOptions";
import { BulkStockMovementForm } from "../BulkStockMovementForm";

/** إخراج منتجات — dedicated STOCK_OUT page for the WAREHOUSE, reachable by
 * both ADMIN and ADMIN_ASSISTANT. Removes/decreases warehouse stock only —
 * never REP_CAR (a rep's car stock is a separate StockLocation, moved only
 * through the existing assignStockToRep/returnStockFromRep workflow, never
 * from here).
 *
 * Reuses BulkStockMovementForm/createBulkStockMovement exactly as the
 * legacy combined /admin/inventory/adjust screen does — direction is fixed
 * to STOCK_OUT here (no mode toggle at all, unlike /adjust). Negative stock
 * is impossible: createBulkStockMovement re-reads current stock inside its
 * transaction (decrementInventoryAtomic) and rejects/rolls back the whole
 * submission if the requested quantity exceeds what's actually available at
 * that moment, regardless of what this page's stale product list shows. */
export default async function AdminInventoryIssuePage() {
  await requireRole([ROLES.ADMIN, ROLES.ADMIN_ASSISTANT]);

  const [warehouse, options] = await Promise.all([getMainWarehouse(), getWarehouseStockProductOptions()]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-xl font-semibold text-neutral-bg">إخراج منتجات</h2>
        <p className="mt-1 text-sm text-neutral-bg/60">إخراج كمية من المخزون في {warehouse.name}</p>
      </div>
      <BulkStockMovementForm products={options} direction={MANUAL_STOCK_MOVEMENT_TYPES.STOCK_OUT} />
    </div>
  );
}
