-- Purely additive migration for the discount + bonus/free line-item feature
-- (خصم الفاتورة / بونص). One new nullable-safe column with a default, no
-- ALTER of any existing column's type or meaning, no DROP, no data
-- migration. Every existing order_items row gets bonusQuantity = 0, which
-- preserves its exact original meaning (totalCents already equalled
-- unitPriceCents * quantity for every such row — see the column's own
-- schema doc comment in prisma/schema.prisma).
--
-- Order.discountCents already existed before this migration (added when
-- the admin manual-order discount feature shipped) — this feature only
-- newly wires it into the REP sale flow in application code, so it
-- requires no schema change of its own here.

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "bonusQuantity" INTEGER NOT NULL DEFAULT 0;
