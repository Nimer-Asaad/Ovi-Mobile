-- Extends DEVICE_MODEL_COLOR tracking to the customer-facing cart/checkout
-- path: a cart/order line can now reference a DeviceColorVariant
-- combination directly, the same nullable-dimension pattern already used
-- for inventory_items/stock_movements in migration
-- 20260814120000_add_device_color_inventory_tracking. No existing column is
-- touched, dropped, or renamed — every existing cart/order row keeps
-- exactly the uniqueness bucket it already occupied.

BEGIN;

-- ---------------------------------------------------------------------------
-- order_items.deviceColorVariantId
-- ---------------------------------------------------------------------------

ALTER TABLE "order_items" ADD COLUMN "deviceColorVariantId" TEXT;
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_deviceColorVariantId_productId_fkey"
  FOREIGN KEY ("deviceColorVariantId", "productId") REFERENCES "device_color_variants"("id", "productId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_variant_xor_device_color_variant_check"
  CHECK (NOT ("variantId" IS NOT NULL AND "deviceColorVariantId" IS NOT NULL));
CREATE INDEX "order_items_deviceColorVariantId_idx" ON "order_items"("deviceColorVariantId");

-- ---------------------------------------------------------------------------
-- cart_items.deviceColorVariantId
-- ---------------------------------------------------------------------------

ALTER TABLE "cart_items" ADD COLUMN "deviceColorVariantId" TEXT;
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_deviceColorVariantId_productId_fkey"
  FOREIGN KEY ("deviceColorVariantId", "productId") REFERENCES "device_color_variants"("id", "productId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_variant_xor_device_color_variant_check"
  CHECK (NOT ("variantId" IS NOT NULL AND "deviceColorVariantId" IS NOT NULL));

-- Replace the "plain" partial-unique tier so it also requires
-- deviceColorVariantId IS NULL, and add a new tier for device-color
-- combination lines. Safe to drop-and-recreate with no preflight:
-- deviceColorVariantId is a brand-new column, entirely NULL on every
-- existing row, so every existing plain row keeps occupying the same
-- (cartId, productId) bucket it already did.
DROP INDEX "cart_items_cart_product_plain_key";
CREATE UNIQUE INDEX "cart_items_cart_product_plain_key"
  ON "cart_items"("cartId", "productId") WHERE "variantId" IS NULL AND "colorId" IS NULL AND "deviceColorVariantId" IS NULL;
-- One cart line per (cart, product, combination) — a shopper can hold two
-- different combinations of the same product (e.g. two colors) as separate
-- lines, but not duplicate the same combination twice.
CREATE UNIQUE INDEX "cart_items_cart_product_device_color_key"
  ON "cart_items"("cartId", "productId", "deviceColorVariantId") WHERE "deviceColorVariantId" IS NOT NULL;

COMMIT;
