-- ============================================================================
-- READ-ONLY. Run this on PRODUCTION AFTER running
-- scripts/aggregate-rep-car-inventory.ts. Nothing in this file writes
-- anything — every statement is a plain SELECT.
--
-- Purpose: prove the conversion left the database in the expected state.
-- Row 3's total_physical_rep_car_quantity_after MUST equal
-- total_physical_rep_car_quantity_C from pre-conversion-audit.sql exactly
-- — no inventory may have been created or lost, only reshuffled into a
-- different row shape.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Per (REP_CAR location, product) result — aggregate_after and
-- positive_dimensional_after side by side, so a mismatch is obvious on
-- sight per row. Expected for EVERY row: positive_dimensional_after = 0.
-- ---------------------------------------------------------------------------
SELECT
  sl.id AS location_id,
  sl.name AS location_name,
  p.id AS product_id,
  p.sku AS product_sku,
  COALESCE(p."nameAr", p.name) AS product_name,
  COALESCE(agg.quantity, 0) AS aggregate_after,
  COALESCE(dim.dimensional_total, 0) AS positive_dimensional_after
FROM stock_locations sl
JOIN (
  SELECT DISTINCT "productId", "locationId"
  FROM inventory_items
  WHERE "locationId" IN (SELECT id FROM stock_locations WHERE type = 'REP_CAR')
    AND quantity > 0
) touched ON touched."locationId" = sl.id
JOIN products p ON p.id = touched."productId"
LEFT JOIN inventory_items agg
  ON agg."productId" = touched."productId"
  AND agg."locationId" = sl.id
  AND agg."variantId" IS NULL
  AND agg."deviceColorVariantId" IS NULL
LEFT JOIN (
  SELECT "productId", "locationId", SUM(quantity) AS dimensional_total
  FROM inventory_items
  WHERE ("variantId" IS NOT NULL OR "deviceColorVariantId" IS NOT NULL)
    AND quantity > 0
  GROUP BY "productId", "locationId"
) dim ON dim."productId" = touched."productId" AND dim."locationId" = sl.id
WHERE sl.type = 'REP_CAR'
ORDER BY sl.name, product_name;

-- ---------------------------------------------------------------------------
-- 2. Single number: how many REP_CAR dimensional rows still have positive
-- quantity anywhere. Expected: 0.
-- ---------------------------------------------------------------------------
SELECT COUNT(*) AS remaining_positive_dimensional_rows
FROM inventory_items
WHERE "locationId" IN (SELECT id FROM stock_locations WHERE type = 'REP_CAR')
  AND ("variantId" IS NOT NULL OR "deviceColorVariantId" IS NOT NULL)
  AND quantity > 0;

-- ---------------------------------------------------------------------------
-- 3. Grand total invariant check — this single number MUST equal
-- total_physical_rep_car_quantity_C from pre-conversion-audit.sql exactly.
-- ---------------------------------------------------------------------------
SELECT
  COALESCE(SUM(quantity), 0) AS total_physical_rep_car_quantity_after
FROM inventory_items
WHERE "locationId" IN (SELECT id FROM stock_locations WHERE type = 'REP_CAR');
