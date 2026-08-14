-- Adds per-product inventory tracking modes (TOTAL_STOCK | DEVICE_MODEL_COLOR)
-- without moving, deleting, or zeroing any existing inventory. Every existing
-- product defaults to TOTAL_STOCK, which is byte-for-byte the stock behavior
-- it already has today (a single plain InventoryItem bucket per location,
-- variantId and the new deviceColorVariantId both null) — so no product's
-- observable stock behavior changes as a result of this migration.
--
-- New "device + color" combination tracking reuses PhoneBrand/PhoneModel and
-- Color unchanged, and reuses the existing InventoryItem/StockMovement
-- ledger engine (src/lib/inventory-transactions.ts) via a new optional
-- deviceColorVariantId column, following the exact same nullable-dimension
-- pattern already established for variantId (see migration
-- 20260805170000_add_phone_product_variants). It does NOT reuse
-- ProductVariant: that table's identity is unique per (productId,
-- phoneModelId) — one row per phone model, color deliberately excluded (see
-- its doc comment) — so it cannot represent the same model in two different
-- colors, which this mode requires. DeviceColorVariant is the new
-- product+phoneModel+color combination table this mode needs instead.
--
-- variantId and deviceColorVariantId are mutually exclusive on both
-- InventoryItem and StockMovement (CHECK constraints below) — a product uses
-- at most one of the two variant systems, matching its
-- Product.variantMode / Product.inventoryTrackingMode.

BEGIN;

-- ---------------------------------------------------------------------------
-- products.inventoryTrackingMode
-- ---------------------------------------------------------------------------

ALTER TABLE "products" ADD COLUMN "inventoryTrackingMode" TEXT NOT NULL DEFAULT 'TOTAL_STOCK';
ALTER TABLE "products" ADD CONSTRAINT "products_inventoryTrackingMode_check"
  CHECK ("inventoryTrackingMode" IN ('TOTAL_STOCK', 'DEVICE_MODEL_COLOR'));
-- A product never uses both variant systems at once: DEVICE_MODEL_COLOR
-- always keeps the legacy variantMode at its default 'NONE'.
ALTER TABLE "products" ADD CONSTRAINT "products_device_model_color_requires_variant_mode_none_check"
  CHECK (NOT ("inventoryTrackingMode" = 'DEVICE_MODEL_COLOR' AND "variantMode" <> 'NONE'));

-- ---------------------------------------------------------------------------
-- device_color_variants — the product + phone model + color combination
-- ---------------------------------------------------------------------------

CREATE TABLE "device_color_variants" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "phoneModelId" TEXT NOT NULL,
    "colorId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "device_color_variants_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "device_color_variants_productId_phoneModelId_colorId_key" ON "device_color_variants"("productId", "phoneModelId", "colorId");
CREATE UNIQUE INDEX "device_color_variants_id_productId_key" ON "device_color_variants"("id", "productId");
CREATE INDEX "device_color_variants_productId_isActive_idx" ON "device_color_variants"("productId", "isActive");
CREATE INDEX "device_color_variants_phoneModelId_idx" ON "device_color_variants"("phoneModelId");
CREATE INDEX "device_color_variants_colorId_idx" ON "device_color_variants"("colorId");

ALTER TABLE "device_color_variants" ADD CONSTRAINT "device_color_variants_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "device_color_variants" ADD CONSTRAINT "device_color_variants_phoneModelId_fkey"
  FOREIGN KEY ("phoneModelId") REFERENCES "phone_models"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "device_color_variants" ADD CONSTRAINT "device_color_variants_colorId_fkey"
  FOREIGN KEY ("colorId") REFERENCES "colors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Database-level identity lock, mirroring
-- prevent_used_product_variant_identity_change from the phone-variant
-- migration: once a combination has any InventoryItem/StockMovement row,
-- its productId/phoneModelId/colorId can never change (isActive/sortOrder
-- remain editable, so a combination can still be archived safely).
CREATE FUNCTION prevent_used_device_color_variant_identity_change() RETURNS trigger AS $$
BEGIN
  IF NEW."productId" IS DISTINCT FROM OLD."productId"
     OR NEW."phoneModelId" IS DISTINCT FROM OLD."phoneModelId"
     OR NEW."colorId" IS DISTINCT FROM OLD."colorId" THEN
    IF EXISTS (SELECT 1 FROM "inventory_items" WHERE "deviceColorVariantId" = OLD."id")
       OR EXISTS (SELECT 1 FROM "stock_movements" WHERE "deviceColorVariantId" = OLD."id") THEN
      RAISE EXCEPTION 'used DeviceColorVariant identity is immutable';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "device_color_variants_identity_immutable_when_used"
  BEFORE UPDATE OF "productId", "phoneModelId", "colorId" ON "device_color_variants"
  FOR EACH ROW EXECUTE FUNCTION prevent_used_device_color_variant_identity_change();

-- ---------------------------------------------------------------------------
-- inventory_items.deviceColorVariantId
-- ---------------------------------------------------------------------------

ALTER TABLE "inventory_items" ADD COLUMN "deviceColorVariantId" TEXT;
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_deviceColorVariantId_productId_fkey"
  FOREIGN KEY ("deviceColorVariantId", "productId") REFERENCES "device_color_variants"("id", "productId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_variant_xor_device_color_variant_check"
  CHECK (NOT ("variantId" IS NOT NULL AND "deviceColorVariantId" IS NOT NULL));

-- Replace the two-tier variant/plain partial-unique scheme from the
-- phone-variant migration with a three-tier one. Safe to drop-and-recreate
-- with no preflight: "deviceColorVariantId" is a brand-new column, entirely
-- NULL on every existing row, so every existing row keeps exactly the same
-- uniqueness bucket it already occupied (tier 1 or 2 below) — no possible
-- duplicate-key conflict from this replacement.
DROP INDEX "inventory_items_variant_location_key";
DROP INDEX "inventory_items_product_location_plain_key";
-- Tier 1: phone-model variant only (existing PHONE_COMPATIBILITY products).
CREATE UNIQUE INDEX "inventory_items_variant_location_key"
  ON "inventory_items"("variantId", "locationId") WHERE "variantId" IS NOT NULL AND "deviceColorVariantId" IS NULL;
-- Tier 2: device + color combination (new DEVICE_MODEL_COLOR products).
CREATE UNIQUE INDEX "inventory_items_device_color_variant_location_key"
  ON "inventory_items"("deviceColorVariantId", "locationId") WHERE "deviceColorVariantId" IS NOT NULL;
-- Tier 3: plain product-wide bucket (TOTAL_STOCK products — the default).
CREATE UNIQUE INDEX "inventory_items_product_location_plain_key"
  ON "inventory_items"("productId", "locationId") WHERE "variantId" IS NULL AND "deviceColorVariantId" IS NULL;

-- ---------------------------------------------------------------------------
-- stock_movements.deviceColorVariantId
-- ---------------------------------------------------------------------------

ALTER TABLE "stock_movements" ADD COLUMN "deviceColorVariantId" TEXT;
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_deviceColorVariantId_productId_fkey"
  FOREIGN KEY ("deviceColorVariantId", "productId") REFERENCES "device_color_variants"("id", "productId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_variant_xor_device_color_variant_check"
  CHECK (NOT ("variantId" IS NOT NULL AND "deviceColorVariantId" IS NOT NULL));
CREATE INDEX "stock_movements_deviceColorVariantId_idx" ON "stock_movements"("deviceColorVariantId");

COMMIT;
