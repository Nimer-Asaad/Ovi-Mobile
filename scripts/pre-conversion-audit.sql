-- ============================================================================
-- READ-ONLY. Run this on PRODUCTION BEFORE running
-- scripts/aggregate-rep-car-inventory.ts. Nothing in this file writes
-- anything — every statement is a plain SELECT.
--
-- Purpose: a human-readable per (REP_CAR location, product) breakdown of
-- what the conversion script is about to fold together, plus the grand
-- totals needed to sanity-check the post-conversion audit afterward.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Per (REP_CAR location, product) breakdown.
-- ---------------------------------------------------------------------------
SELECT
  sl.id AS location_id,
  sl.name AS location_name,
  p.id AS product_id,
  p.sku AS product_sku,
  COALESCE(p."nameAr", p.name) AS product_name,
  COALESCE(agg.quantity, 0) AS aggregate_before,
  COALESCE(dim.dimensional_total, 0) AS dimensional_before,
  COALESCE(agg.quantity, 0) + COALESCE(dim.dimensional_total, 0) AS expected_after
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
-- 2. Grand totals — record these three numbers. Row (C) is the single
-- number the post-conversion audit's own total must equal exactly.
-- ---------------------------------------------------------------------------
SELECT
  (
    SELECT COALESCE(SUM(quantity), 0)
    FROM inventory_items
    WHERE "locationId" IN (SELECT id FROM stock_locations WHERE type = 'REP_CAR')
      AND ("variantId" IS NOT NULL OR "deviceColorVariantId" IS NOT NULL)
  ) AS total_dimensional_rep_car_quantity_A,
  (
    SELECT COALESCE(SUM(quantity), 0)
    FROM inventory_items
    WHERE "locationId" IN (SELECT id FROM stock_locations WHERE type = 'REP_CAR')
      AND "variantId" IS NULL
      AND "deviceColorVariantId" IS NULL
  ) AS total_aggregate_rep_car_quantity_B,
  (
    SELECT COALESCE(SUM(quantity), 0)
    FROM inventory_items
    WHERE "locationId" IN (SELECT id FROM stock_locations WHERE type = 'REP_CAR')
  ) AS total_physical_rep_car_quantity_C;
