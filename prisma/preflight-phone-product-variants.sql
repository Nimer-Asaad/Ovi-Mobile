-- Read-only production preflight for the phone ProductVariant migration.
-- Run with psql configured to stop on errors. This returns counts only and
-- never changes, deletes, locks for update, or prints business row contents.

SELECT 'inventory_items.quantity < 0' AS check_name, COUNT(*) AS violation_count
FROM "inventory_items" WHERE "quantity" < 0
UNION ALL
SELECT 'cart_items.quantity <= 0', COUNT(*) FROM "cart_items" WHERE "quantity" <= 0
UNION ALL
SELECT 'order_items.quantity <= 0', COUNT(*) FROM "order_items" WHERE "quantity" <= 0
UNION ALL
SELECT 'stock_movements.quantity <= 0', COUNT(*) FROM "stock_movements" WHERE "quantity" <= 0
UNION ALL
SELECT 'stock_request_items.requestedQuantity <= 0', COUNT(*) FROM "stock_request_items" WHERE "requestedQuantity" <= 0
UNION ALL
SELECT 'stock_request_items.approvedQuantity < 0', COUNT(*) FROM "stock_request_items" WHERE "approvedQuantity" < 0
UNION ALL
SELECT 'stock_return_items.quantity <= 0', COUNT(*) FROM "stock_return_items" WHERE "quantity" <= 0;

SELECT 'duplicate plain cart lines' AS check_name, COUNT(*) AS violating_groups
FROM (
  SELECT "cartId", "productId" FROM "cart_items"
  WHERE "colorId" IS NULL
  GROUP BY "cartId", "productId" HAVING COUNT(*) > 1
) AS duplicates
UNION ALL
SELECT 'duplicate colored cart lines', COUNT(*) FROM (
  SELECT "cartId", "productId", "colorId" FROM "cart_items"
  WHERE "colorId" IS NOT NULL
  GROUP BY "cartId", "productId", "colorId" HAVING COUNT(*) > 1
) AS duplicates
UNION ALL
SELECT 'duplicate plain inventory rows', COUNT(*) FROM (
  SELECT "productId", "locationId" FROM "inventory_items"
  WHERE "colorId" IS NULL
  GROUP BY "productId", "locationId" HAVING COUNT(*) > 1
) AS duplicates
UNION ALL
SELECT 'duplicate colored inventory rows', COUNT(*) FROM (
  SELECT "productId", "locationId", "colorId" FROM "inventory_items"
  WHERE "colorId" IS NOT NULL
  GROUP BY "productId", "locationId", "colorId" HAVING COUNT(*) > 1
) AS duplicates;
