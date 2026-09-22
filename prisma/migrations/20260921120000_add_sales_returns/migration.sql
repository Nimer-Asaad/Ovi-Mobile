-- Purely additive migration for REP sales returns (مردود مبيعات): two new
-- append-only tables, no change to any existing table/column/row, no DROP,
-- no backfill. The CHECK constraints are a DB-level backstop for the
-- invariants createSalesReturn (src/lib/sales-returns.ts) already enforces.

-- CreateTable
CREATE TABLE "sales_returns" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "accountId" TEXT NOT NULL,
    "salesRepId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "stockLocationId" TEXT NOT NULL,
    "totalCreditCents" INTEGER NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_return_items" (
    "id" TEXT NOT NULL,
    "salesReturnId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "bonusQuantity" INTEGER NOT NULL DEFAULT 0,
    "creditCents" INTEGER NOT NULL,

    CONSTRAINT "sales_return_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sales_returns_accountId_idx" ON "sales_returns"("accountId");

-- CreateIndex
CREATE INDEX "sales_returns_salesRepId_idx" ON "sales_returns"("salesRepId");

-- CreateIndex
CREATE INDEX "sales_returns_createdAt_idx" ON "sales_returns"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "sales_returns_orderId_sequence_key" ON "sales_returns"("orderId", "sequence");

-- CreateIndex
CREATE INDEX "sales_return_items_orderItemId_idx" ON "sales_return_items"("orderItemId");

-- CreateIndex
CREATE INDEX "sales_return_items_salesReturnId_idx" ON "sales_return_items"("salesReturnId");

-- AddForeignKey
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "customer_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_salesRepId_fkey" FOREIGN KEY ("salesRepId") REFERENCES "sales_representatives"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_stockLocationId_fkey" FOREIGN KEY ("stockLocationId") REFERENCES "stock_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_return_items" ADD CONSTRAINT "sales_return_items_salesReturnId_fkey" FOREIGN KEY ("salesReturnId") REFERENCES "sales_returns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_return_items" ADD CONSTRAINT "sales_return_items_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Integrity backstops (hand-written; Prisma cannot express CHECK constraints)
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_sequence_positive" CHECK ("sequence" > 0);
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_credit_nonnegative" CHECK ("totalCreditCents" >= 0);
ALTER TABLE "sales_return_items" ADD CONSTRAINT "sales_return_items_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "sales_return_items" ADD CONSTRAINT "sales_return_items_credit_nonnegative" CHECK ("creditCents" >= 0);
ALTER TABLE "sales_return_items" ADD CONSTRAINT "sales_return_items_bonus_within_quantity" CHECK ("bonusQuantity" >= 0 AND "bonusQuantity" <= "quantity");
