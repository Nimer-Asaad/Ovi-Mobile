-- AlterTable
-- Adds three purely-optional profile columns to merchants — owner/contact
-- name, a separate WhatsApp number, and free-form admin notes. All three
-- are nullable with no default, so every existing row simply gets NULL —
-- no backfill, no rewrite of any other column, no change to any other
-- table. status/SUSPENDED (already present) is reused for merchant
-- archival rather than adding a new column — see the schema doc comment on
-- Merchant.status.
ALTER TABLE "merchants"
  ADD COLUMN "contactName" TEXT,
  ADD COLUMN "whatsappPhone" TEXT,
  ADD COLUMN "notes" TEXT;
