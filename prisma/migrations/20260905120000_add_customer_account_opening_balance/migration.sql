-- AlterTable
-- Adds opening-balance support to customer_accounts. Every column here is
-- either NOT NULL with a constant DEFAULT (openingBalanceCents) or fully
-- nullable (openingBalanceSetAt/openingBalanceSetById) — Postgres fills in
-- the default/NULL for every existing row automatically, no data backfill,
-- no table rewrite of any other column, no change to any other table.
ALTER TABLE "customer_accounts"
  ADD COLUMN "openingBalanceCents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "openingBalanceSetAt" TIMESTAMP(3),
  ADD COLUMN "openingBalanceSetById" TEXT;

-- AddForeignKey
-- Same ON DELETE RESTRICT convention already used for every other optional
-- "who performed this" User reference in this schema (e.g.
-- product_variant_allocation_batches.completedById) — protects the audit
-- trail by refusing to delete a User while still referenced here, rather
-- than silently losing who set an opening balance.
ALTER TABLE "customer_accounts" ADD CONSTRAINT "customer_accounts_openingBalanceSetById_fkey" FOREIGN KEY ("openingBalanceSetById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
