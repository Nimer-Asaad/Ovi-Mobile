-- Adds an OPTIONAL stable Merchant identity to RepCustomerOrder, so the
-- admin /admin/reps/[id] page can safely group multiple OPEN customer-order
-- templates for the SAME real trader into one parent row. Before this,
-- RepCustomerOrder only ever stored free-text customerName with no
-- relational identity at all — two rows both typed "بيع" could not be
-- proven to be the same trader, so they were never merged (see the "طلبات
-- الزبائن" grouping investigation). merchantId lets a rep's pending
-- customer-order template and their eventual completed sale
-- (Order.merchantId, resolved by createRepSale) share one real trader
-- identity end to end.
--
-- Purely additive, NO backfill, NO data loss:
--   - rep_customer_orders.merchantId is a new NULLABLE column — every
--     existing row gets NULL ("no known merchant identity yet"), which is
--     literally true for all of them: nothing here infers or guesses a
--     Merchant from customerName text (that would risk silently merging two
--     different real customers who happened to type the same generic
--     placeholder, e.g. "بيع"). A legacy row stays fully valid and keeps
--     displaying its existing customerName exactly as before; only newly
--     created rows, or ones an admin explicitly links afterward (see
--     linkRepCustomerOrderMerchant in src/app/admin/reps/actions.ts), will
--     ever have this set.
--   - No existing row's customerName, status, items, or any other column is
--     read, updated, or otherwise touched by this migration.
--   - ON DELETE SET NULL matches the existing orders.merchantId FK
--     convention (see the init migration) exactly: if a Merchant is ever
--     deleted, the customer-order template loses its identity link rather
--     than being destroyed or blocked.

BEGIN;

ALTER TABLE "rep_customer_orders" ADD COLUMN "merchantId" TEXT;
CREATE INDEX "rep_customer_orders_merchantId_idx" ON "rep_customer_orders"("merchantId");
ALTER TABLE "rep_customer_orders" ADD CONSTRAINT "rep_customer_orders_merchantId_fkey"
  FOREIGN KEY ("merchantId") REFERENCES "merchants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

COMMIT;
