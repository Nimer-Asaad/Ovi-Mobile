-- Allows a Merchant row to exist without a linked User (login) account, for
-- a trader contact quick-added directly by an admin or a sales rep instead
-- of via the /register/merchant self-signup flow. Purely additive/relaxing:
--
--   - merchants.userId drops its NOT NULL constraint. Its unique index
--     already treats every NULL as distinct (standard Postgres unique-index
--     behavior), so multiple login-less merchants coexist fine. Every
--     existing row already has a non-null userId, so this changes nothing
--     for any current merchant.
--   - Three new nullable columns (contactPhone/city/address) carry a
--     login-less trader's contact info; they stay NULL for every existing
--     (login-based) merchant, which keeps reading its contact info from the
--     linked User row exactly as before.

BEGIN;

ALTER TABLE "merchants" ALTER COLUMN "userId" DROP NOT NULL;

ALTER TABLE "merchants" ADD COLUMN "contactPhone" TEXT;
ALTER TABLE "merchants" ADD COLUMN "city" TEXT;
ALTER TABLE "merchants" ADD COLUMN "address" TEXT;

COMMIT;
