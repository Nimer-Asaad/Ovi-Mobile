-- Purely additive migration for ADMIN-only sales-return reversal (إلغاء
-- مردود المبيعات): one new append-only table, no change to any existing
-- table/column/row, no DROP, no backfill. sales_returns/sales_return_items
-- are never mutated by this — a reversal is a separate later row, exactly
-- like AccountPaymentCancellation is to AccountPayment.

-- CreateTable
CREATE TABLE "sales_return_reversals" (
    "id" TEXT NOT NULL,
    "salesReturnId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_return_reversals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sales_return_reversals_salesReturnId_key" ON "sales_return_reversals"("salesReturnId");

-- AddForeignKey
ALTER TABLE "sales_return_reversals" ADD CONSTRAINT "sales_return_reversals_salesReturnId_fkey" FOREIGN KEY ("salesReturnId") REFERENCES "sales_returns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_return_reversals" ADD CONSTRAINT "sales_return_reversals_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Integrity backstop (hand-written; Prisma cannot express CHECK constraints)
ALTER TABLE "sales_return_reversals" ADD CONSTRAINT "sales_return_reversals_reason_not_blank" CHECK (length(btrim("reason")) > 0);
