-- Adds an admin-chosen loading type ("مخزون سيارة" / "طلبية زبون") to a rep
-- car-load transfer batch, plus a lightweight logical RepCustomerOrder
-- template (+ RepCustomerOrderItem lines) recording who a customer-order
-- load was intended for. Physical inventory for a customer-order load moves
-- through the exact same WAREHOUSE -> REP_CAR path as a normal car load
-- (rep_stock_transfer_batches / stock_movements / inventory_items,
-- unchanged) — this migration adds no new inventory bucket and does not
-- touch inventory_items or stock_movements at all.
--
-- Purely additive:
--   - rep_stock_transfer_batches.loadType is NOT NULL with DEFAULT
--     'CAR_STOCK' — every existing row (all of which are today's only kind
--     of car load) receives 'CAR_STOCK' automatically via the column
--     default, identical to today's only behavior. No backfill needed.
--   - orders.repCustomerOrderId is a new nullable column — every existing
--     order row gets NULL, meaning "not started from a customer order",
--     which is true for all of them (this feature didn't exist before this
--     migration). No backfill needed.
--   - rep_customer_orders / rep_customer_order_items are brand-new tables
--     with no existing rows to migrate.
--
-- orders.repCustomerOrderId is UNIQUE (nullable-unique — Postgres allows
-- unlimited NULLs under a plain unique index, same convention already used
-- by stock_locations.salesRepId): a deliberate DB-level backstop for "one
-- customer order is consumed by at most one resulting sale", on top of the
-- atomic OPEN -> COMPLETED transition already enforced in application code
-- (createRepSale).

BEGIN;

-- ---------------------------------------------------------------------------
-- rep_stock_transfer_batches.loadType
-- ---------------------------------------------------------------------------

ALTER TABLE "rep_stock_transfer_batches" ADD COLUMN "loadType" TEXT NOT NULL DEFAULT 'CAR_STOCK';

-- ---------------------------------------------------------------------------
-- rep_customer_orders
-- ---------------------------------------------------------------------------

CREATE TABLE "rep_customer_orders" (
    "id" TEXT NOT NULL,
    "salesRepId" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "transferBatchId" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    CONSTRAINT "rep_customer_orders_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "rep_customer_orders_transferBatchId_key" ON "rep_customer_orders"("transferBatchId");
CREATE INDEX "rep_customer_orders_salesRepId_status_idx" ON "rep_customer_orders"("salesRepId", "status");

ALTER TABLE "rep_customer_orders" ADD CONSTRAINT "rep_customer_orders_salesRepId_fkey"
  FOREIGN KEY ("salesRepId") REFERENCES "sales_representatives"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "rep_customer_orders" ADD CONSTRAINT "rep_customer_orders_transferBatchId_fkey"
  FOREIGN KEY ("transferBatchId") REFERENCES "rep_stock_transfer_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "rep_customer_orders" ADD CONSTRAINT "rep_customer_orders_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- rep_customer_order_items
-- ---------------------------------------------------------------------------
-- Snapshot lines only — never a physical stock bucket. variantId/
-- deviceColorVariantId mirror the exact InventoryKey shape
-- decrementInventoryAtomic/incrementInventoryUpsert use elsewhere (see
-- src/lib/inventory-transactions.ts), so the mutual-exclusion CHECK below
-- matches the same invariant already enforced on
-- inventory_items/stock_movements.

CREATE TABLE "rep_customer_order_items" (
    "id" TEXT NOT NULL,
    "repCustomerOrderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "deviceColorVariantId" TEXT,
    "quantity" INTEGER NOT NULL,
    CONSTRAINT "rep_customer_order_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "rep_customer_order_items_quantity_positive_check" CHECK ("quantity" > 0),
    CONSTRAINT "rep_customer_order_items_variant_xor_device_color_variant_check"
      CHECK (NOT ("variantId" IS NOT NULL AND "deviceColorVariantId" IS NOT NULL))
);

CREATE INDEX "rep_customer_order_items_repCustomerOrderId_idx" ON "rep_customer_order_items"("repCustomerOrderId");
CREATE INDEX "rep_customer_order_items_variantId_idx" ON "rep_customer_order_items"("variantId");
CREATE INDEX "rep_customer_order_items_deviceColorVariantId_idx" ON "rep_customer_order_items"("deviceColorVariantId");

ALTER TABLE "rep_customer_order_items" ADD CONSTRAINT "rep_customer_order_items_repCustomerOrderId_fkey"
  FOREIGN KEY ("repCustomerOrderId") REFERENCES "rep_customer_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "rep_customer_order_items" ADD CONSTRAINT "rep_customer_order_items_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "rep_customer_order_items" ADD CONSTRAINT "rep_customer_order_items_variantId_productId_fkey"
  FOREIGN KEY ("variantId", "productId") REFERENCES "product_variants"("id", "productId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "rep_customer_order_items" ADD CONSTRAINT "rep_customer_order_items_deviceColorVariantId_productId_fkey"
  FOREIGN KEY ("deviceColorVariantId", "productId") REFERENCES "device_color_variants"("id", "productId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- orders.repCustomerOrderId
-- ---------------------------------------------------------------------------

ALTER TABLE "orders" ADD COLUMN "repCustomerOrderId" TEXT;
CREATE UNIQUE INDEX "orders_repCustomerOrderId_key" ON "orders"("repCustomerOrderId");
ALTER TABLE "orders" ADD CONSTRAINT "orders_repCustomerOrderId_fkey"
  FOREIGN KEY ("repCustomerOrderId") REFERENCES "rep_customer_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

COMMIT;
