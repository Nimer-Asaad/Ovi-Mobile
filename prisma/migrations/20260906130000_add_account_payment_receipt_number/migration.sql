-- AlterTable
-- Adds one purely-optional, unique reference column to account_payments —
-- the persisted "PAY-YYYYMMDD-NNNN" سند قبض receipt number (see
-- generateDailyPaymentReceiptNumber in src/lib/payment-number.ts). Nullable
-- with no default, so every existing row simply gets NULL — no backfill, no
-- rewrite of any other column, no change to any other table. Every row
-- created going forward is assigned a value for this column inside the same
-- transaction that creates it; historical rows keep receiptNumber = NULL
-- forever and fall back to a display-only, non-persisted reference instead
-- (see buildPaymentReceiptReference in src/lib/account-labels.ts) — never
-- backfilled here or anywhere else.
ALTER TABLE "account_payments" ADD COLUMN "receiptNumber" TEXT;

-- CreateIndex
-- A plain unique index allows unlimited NULLs (standard Postgres semantics)
-- while still rejecting an actual duplicate non-null receiptNumber — the
-- same DB-level backstop Order.orderNumber already relies on.
CREATE UNIQUE INDEX "account_payments_receiptNumber_key" ON "account_payments"("receiptNumber");
