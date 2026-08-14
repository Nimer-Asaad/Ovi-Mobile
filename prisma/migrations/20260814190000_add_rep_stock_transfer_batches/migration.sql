-- Adds a grouping table for the individual per-product StockMovement rows
-- created by one multi-product admin quick-transfer submission (assigning or
-- returning a sales rep's car stock), so the whole car-load can be printed
-- as a single combined invoice instead of one per product.
--
-- Purely additive: every existing stock_movements row keeps
-- transferBatchId NULL, which behaves exactly as it does today (no batch, no
-- combined invoice, single-movement invoice printing untouched).

BEGIN;

-- ---------------------------------------------------------------------------
-- rep_stock_transfer_batches
-- ---------------------------------------------------------------------------

CREATE TABLE "rep_stock_transfer_batches" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "salesRepId" TEXT NOT NULL,
    "fromLocationId" TEXT NOT NULL,
    "toLocationId" TEXT NOT NULL,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "rep_stock_transfer_batches_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "rep_stock_transfer_batches_salesRepId_idx" ON "rep_stock_transfer_batches"("salesRepId");

ALTER TABLE "rep_stock_transfer_batches" ADD CONSTRAINT "rep_stock_transfer_batches_salesRepId_fkey"
  FOREIGN KEY ("salesRepId") REFERENCES "sales_representatives"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "rep_stock_transfer_batches" ADD CONSTRAINT "rep_stock_transfer_batches_fromLocationId_fkey"
  FOREIGN KEY ("fromLocationId") REFERENCES "stock_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "rep_stock_transfer_batches" ADD CONSTRAINT "rep_stock_transfer_batches_toLocationId_fkey"
  FOREIGN KEY ("toLocationId") REFERENCES "stock_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "rep_stock_transfer_batches" ADD CONSTRAINT "rep_stock_transfer_batches_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- stock_movements.transferBatchId
-- ---------------------------------------------------------------------------

ALTER TABLE "stock_movements" ADD COLUMN "transferBatchId" TEXT;
CREATE INDEX "stock_movements_transferBatchId_idx" ON "stock_movements"("transferBatchId");
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_transferBatchId_fkey"
  FOREIGN KEY ("transferBatchId") REFERENCES "rep_stock_transfer_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
