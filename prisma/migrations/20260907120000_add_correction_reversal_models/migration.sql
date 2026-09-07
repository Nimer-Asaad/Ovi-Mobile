-- Purely additive migration for the safe correction/reversal feature
-- (sales, manual payments, manual inventory STOCK_IN/STOCK_OUT). No UPDATE
-- or DELETE statements anywhere below, no backfill of any existing row, no
-- change to any existing column's type or meaning. Every existing
-- account_payments/stock_movements row simply gets NULL in its new
-- column(s) — legacy rows are never auto-classified/auto-grouped.

-- AlterTable
-- account_payments.origin: "MANUAL" | "SALE_INITIAL" (see
-- ACCOUNT_PAYMENT_ORIGINS in src/lib/constants.ts) — NULL for every
-- existing row (never backfilled; a legacy row's true origin is genuinely
-- unknown and must never be guessed from note text).
-- account_payments.sourceOrderId: set only on a NEW SALE_INITIAL payment,
-- pointing at the exact Order it was recorded for at creation time — the
-- one reliable, persisted way to identify a sale-linked payment. @unique
-- because a sale has at most one initial payment.
-- account_payments.correctsPaymentId: set only on a brand-new replacement
-- payment created through the report-scoped correction flow, pointing at
-- the ONE original MANUAL payment it corrects. @unique enforces "one
-- cancelled payment gets at most one replacement payment" at the DB level.
-- NULL for every ordinary standalone payment and for every existing row.
ALTER TABLE "account_payments" ADD COLUMN     "origin" TEXT,
ADD COLUMN     "sourceOrderId" TEXT,
ADD COLUMN     "correctsPaymentId" TEXT;

-- CreateIndex
-- A plain unique index allows unlimited NULLs (standard Postgres
-- semantics) while still rejecting a second payment claiming the same
-- source order.
CREATE UNIQUE INDEX "account_payments_sourceOrderId_key" ON "account_payments"("sourceOrderId");

-- CreateIndex
-- Same NULLs-allowed unique semantics, applied to the one-replacement-per-
-- cancelled-payment guarantee.
CREATE UNIQUE INDEX "account_payments_correctsPaymentId_key" ON "account_payments"("correctsPaymentId");

-- AddForeignKey
ALTER TABLE "account_payments" ADD CONSTRAINT "account_payments_sourceOrderId_fkey" FOREIGN KEY ("sourceOrderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_payments" ADD CONSTRAINT "account_payments_correctsPaymentId_fkey" FOREIGN KEY ("correctsPaymentId") REFERENCES "account_payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
-- Immutable record of a single AccountPayment's cancellation/reversal.
-- Never updated or deleted once created; the cancelled AccountPayment's own
-- amountCents/method/note/receiptNumber/createdAt are never touched — see
-- the model's own doc comment in schema.prisma. paymentId is @unique: the
-- DB-level "a payment may be cancelled at most once" guarantee.
CREATE TABLE "account_payment_cancellations" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "cancelledById" TEXT NOT NULL,
    "cancelledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_payment_cancellations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "account_payment_cancellations_paymentId_key" ON "account_payment_cancellations"("paymentId");

-- AddForeignKey
ALTER TABLE "account_payment_cancellations" ADD CONSTRAINT "account_payment_cancellations_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "account_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_payment_cancellations" ADD CONSTRAINT "account_payment_cancellations_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable
-- Groups the StockMovement row(s) created by one manual STOCK_IN/STOCK_OUT
-- submission — the batch-level unit a correction cancels/reverses as one
-- atomic operation. A reversal batch (reversalOfId set) is a brand-new
-- batch of brand-new StockMovement rows with the exact opposite effect of
-- the original batch — the original batch and its movement rows are never
-- edited or deleted. reversalOfId is @unique: the DB-level "a batch may be
-- reversed at most once" guarantee.
CREATE TABLE "manual_inventory_batches" (
    "id" TEXT NOT NULL,
    "movementType" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reversalOfId" TEXT,
    "correctionReason" TEXT,

    CONSTRAINT "manual_inventory_batches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "manual_inventory_batches_reversalOfId_key" ON "manual_inventory_batches"("reversalOfId");

-- AddForeignKey
ALTER TABLE "manual_inventory_batches" ADD CONSTRAINT "manual_inventory_batches_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manual_inventory_batches" ADD CONSTRAINT "manual_inventory_batches_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "manual_inventory_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable
-- stock_movements.manualBatchId: groups this row with the other lines of
-- the same manual submission/reversal. NULL for every existing row and for
-- every non-manual movement type going forward — never backfilled, never
-- auto-grouped by guessing from createdAt/note/user/adjacent rows.
ALTER TABLE "stock_movements" ADD COLUMN     "manualBatchId" TEXT;

-- CreateIndex
CREATE INDEX "stock_movements_manualBatchId_idx" ON "stock_movements"("manualBatchId");

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_manualBatchId_fkey" FOREIGN KEY ("manualBatchId") REFERENCES "manual_inventory_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
