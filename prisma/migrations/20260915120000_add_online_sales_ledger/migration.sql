-- Purely additive migration for the ADMIN-only "أون لاين" online-sales
-- commission ledger (/admin/online). One brand-new table, no ALTER on any
-- existing table, no backfill, no data migration, no change to any
-- existing column's type or meaning. Independent from Order/AccountPayment/
-- Merchant/Inventory/RepStockTransferBatch — see OnlineSale's own schema
-- doc comment in prisma/schema.prisma.

-- CreateTable
-- saleDate is a native DATE (not TIMESTAMP) — a pure calendar day with no
-- time-of-day/timezone component, deliberately different from every other
-- table's naive-timestamp createdAt columns (see business-time.ts). No
-- unique constraint on (saleDate, category): this is an append-only
-- ledger, and more than one entry per day/category is expected and valid.
CREATE TABLE "online_sales" (
    "id" TEXT NOT NULL,
    "saleDate" DATE NOT NULL,
    "category" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "commissionRateBps" INTEGER NOT NULL,
    "commissionCents" INTEGER NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "online_sales_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "online_sales_saleDate_idx" ON "online_sales"("saleDate");

-- CreateIndex
CREATE INDEX "online_sales_category_idx" ON "online_sales"("category");

-- AddForeignKey
ALTER TABLE "online_sales" ADD CONSTRAINT "online_sales_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
