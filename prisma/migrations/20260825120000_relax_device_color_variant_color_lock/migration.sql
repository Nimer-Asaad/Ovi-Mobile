-- Relaxes the DeviceColorVariant identity-immutability trigger (added in
-- 20260814120000_add_device_color_inventory_tracking) so an admin can
-- correct a wrongly-assigned color on an EXISTING combination — one that
-- already has InventoryItem/StockMovement rows — without deleting and
-- recreating it. productId/phoneModelId remain permanently locked once used
-- (changing either would genuinely make this track a different device);
-- colorId no longer participates in that lock, since correcting a color
-- label doesn't move or represent different physical stock — it only
-- relabels the same tracked InventoryItem/StockMovement bucket, whose
-- id/quantity/history are untouched by this change.
--
-- Trade-off, accepted deliberately for this feature: StockMovement/order
-- history resolves DeviceColorVariant.color live at read time (see
-- src/app/admin/inventory/movements/page.tsx), not from a stored snapshot —
-- so correcting a color also changes how every past movement for that same
-- combination displays going forward, not just future ones.
--
-- See src/lib/inventory-tracking.ts (updateDeviceColorComboColor) for the
-- application-level guard that actually performs this update.

BEGIN;

DROP TRIGGER "device_color_variants_identity_immutable_when_used" ON "device_color_variants";
DROP FUNCTION prevent_used_device_color_variant_identity_change();

CREATE FUNCTION prevent_used_device_color_variant_identity_change() RETURNS trigger AS $$
BEGIN
  IF NEW."productId" IS DISTINCT FROM OLD."productId"
     OR NEW."phoneModelId" IS DISTINCT FROM OLD."phoneModelId" THEN
    IF EXISTS (SELECT 1 FROM "inventory_items" WHERE "deviceColorVariantId" = OLD."id")
       OR EXISTS (SELECT 1 FROM "stock_movements" WHERE "deviceColorVariantId" = OLD."id") THEN
      RAISE EXCEPTION 'used DeviceColorVariant identity is immutable';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "device_color_variants_identity_immutable_when_used"
  BEFORE UPDATE OF "productId", "phoneModelId" ON "device_color_variants"
  FOR EACH ROW EXECUTE FUNCTION prevent_used_device_color_variant_identity_change();

COMMIT;
