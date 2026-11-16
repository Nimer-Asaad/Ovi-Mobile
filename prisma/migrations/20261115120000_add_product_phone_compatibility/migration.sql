-- Purely additive migration for browse-by-device compatibility metadata
-- ("this accessory fits this phone model"): ONE new table, no change to any
-- existing table/column/row, no DROP, no backfill, no data written. It is NOT
-- a variant: it has no quantity and does not touch Product.variantMode,
-- variantAllocationStatus, inventoryTrackingMode, InventoryItem, StockMovement
-- or any ProductVariant row.

-- CreateTable
CREATE TABLE "product_phone_compatibilities" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "phoneModelId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_phone_compatibilities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_phone_compatibilities_phoneModelId_idx" ON "product_phone_compatibilities"("phoneModelId");

-- CreateIndex
CREATE UNIQUE INDEX "product_phone_compatibilities_productId_phoneModelId_key" ON "product_phone_compatibilities"("productId", "phoneModelId");

-- AddForeignKey
ALTER TABLE "product_phone_compatibilities" ADD CONSTRAINT "product_phone_compatibilities_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_phone_compatibilities" ADD CONSTRAINT "product_phone_compatibilities_phoneModelId_fkey" FOREIGN KEY ("phoneModelId") REFERENCES "phone_models"("id") ON DELETE CASCADE ON UPDATE CASCADE;
