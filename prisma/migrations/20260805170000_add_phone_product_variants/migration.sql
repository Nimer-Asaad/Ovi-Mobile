-- Adds phone-compatible product variants without distributing, deleting, or
-- zeroing any inventory. Existing inventory, carts, and orders remain legacy
-- rows with variantId NULL until an administrator performs manual allocation.
--
-- The DROP INDEX statements below are intentional metadata-only replacements:
-- they replace the old color/plain uniqueness namespaces with variant-aware
-- partial indexes. They do not delete table rows or inventory. Preflight checks
-- immediately before the drops prove that every replacement index can be
-- created without duplicate-key conflicts.

BEGIN;

CREATE TABLE "phone_brands" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameAr" TEXT,
    "slug" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "phone_brands_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "phone_brands_name_key" ON "phone_brands"("name");
CREATE UNIQUE INDEX "phone_brands_slug_key" ON "phone_brands"("slug");

CREATE TABLE "phone_models" (
    "id" TEXT NOT NULL,
    "phoneBrandId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameAr" TEXT,
    "slug" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "phone_models_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "phone_models_phoneBrandId_slug_key" ON "phone_models"("phoneBrandId", "slug");
CREATE INDEX "phone_models_phoneBrandId_idx" ON "phone_models"("phoneBrandId");
ALTER TABLE "phone_models" ADD CONSTRAINT "phone_models_phoneBrandId_fkey"
  FOREIGN KEY ("phoneBrandId") REFERENCES "phone_brands"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "products"
  ADD COLUMN "variantMode" TEXT NOT NULL DEFAULT 'NONE',
  ADD COLUMN "variantAllocationStatus" TEXT NOT NULL DEFAULT 'NOT_REQUIRED';
ALTER TABLE "products" ADD CONSTRAINT "products_variantMode_check"
  CHECK ("variantMode" IN ('NONE', 'PHONE_COMPATIBILITY'));
ALTER TABLE "products" ADD CONSTRAINT "products_variantAllocationStatus_check"
  CHECK ("variantAllocationStatus" IN ('NOT_REQUIRED', 'PENDING', 'READY'));

-- product_variants identity is product + phone model ONLY. Color is
-- deliberately not part of a variant: it never determines the stock
-- bucket, it's purely descriptive on cart/order/request/return lines.
CREATE TABLE "product_variants" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "phoneModelId" TEXT NOT NULL,
    "variantCode" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "product_variants_variantCode_key" ON "product_variants"("variantCode");
CREATE UNIQUE INDEX "product_variants_productId_phoneModelId_key"
  ON "product_variants"("productId", "phoneModelId");
CREATE UNIQUE INDEX "product_variants_id_productId_key" ON "product_variants"("id", "productId");
CREATE INDEX "product_variants_productId_isActive_idx" ON "product_variants"("productId", "isActive");
CREATE INDEX "product_variants_phoneModelId_idx" ON "product_variants"("phoneModelId");
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_phoneModelId_fkey"
  FOREIGN KEY ("phoneModelId") REFERENCES "phone_models"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "product_variant_allocation_batches" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "originalLegacyQuantity" INTEGER NOT NULL,
    "allocatedQuantity" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "completedById" TEXT,
    CONSTRAINT "product_variant_allocation_batches_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "variant_allocation_nonnegative_check" CHECK ("originalLegacyQuantity" >= 0 AND "allocatedQuantity" >= 0),
    CONSTRAINT "variant_allocation_not_over_baseline_check" CHECK ("allocatedQuantity" <= "originalLegacyQuantity"),
    CONSTRAINT "variant_allocation_status_check" CHECK ("status" IN ('PENDING', 'COMPLETED')),
    CONSTRAINT "variant_allocation_completion_check" CHECK (
      ("status" = 'PENDING' AND "completedAt" IS NULL AND "completedById" IS NULL)
      OR ("status" = 'COMPLETED' AND "completedAt" IS NOT NULL AND "completedById" IS NOT NULL AND "allocatedQuantity" = "originalLegacyQuantity")
    )
);
CREATE UNIQUE INDEX "product_variant_allocation_batches_productId_key" ON "product_variant_allocation_batches"("productId");
CREATE INDEX "product_variant_allocation_batches_status_idx" ON "product_variant_allocation_batches"("status");
ALTER TABLE "product_variant_allocation_batches" ADD CONSTRAINT "product_variant_allocation_batches_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "product_variant_allocation_batches" ADD CONSTRAINT "product_variant_allocation_batches_completedById_fkey"
  FOREIGN KEY ("completedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "cart_items" ADD COLUMN "variantId" TEXT;
ALTER TABLE "inventory_items" ADD COLUMN "variantId" TEXT;
ALTER TABLE "stock_movements" ADD COLUMN "variantId" TEXT, ADD COLUMN "allocationBatchId" TEXT;
ALTER TABLE "order_items" ADD COLUMN "variantId" TEXT;
ALTER TABLE "stock_request_items" ADD COLUMN "variantId" TEXT;
ALTER TABLE "stock_return_items" ADD COLUMN "variantId" TEXT;

ALTER TABLE "order_items"
  ADD COLUMN "productNameSnapshot" TEXT,
  ADD COLUMN "productSkuSnapshot" TEXT,
  ADD COLUMN "variantCodeSnapshot" TEXT,
  ADD COLUMN "phoneBrandSnapshot" TEXT,
  ADD COLUMN "phoneModelSnapshot" TEXT,
  ADD COLUMN "colorNameSnapshot" TEXT;

ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_variantId_productId_fkey"
  FOREIGN KEY ("variantId", "productId") REFERENCES "product_variants"("id", "productId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_variantId_productId_fkey"
  FOREIGN KEY ("variantId", "productId") REFERENCES "product_variants"("id", "productId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_variantId_productId_fkey"
  FOREIGN KEY ("variantId", "productId") REFERENCES "product_variants"("id", "productId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_variantId_productId_fkey"
  FOREIGN KEY ("variantId", "productId") REFERENCES "product_variants"("id", "productId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_request_items" ADD CONSTRAINT "stock_request_items_variantId_productId_fkey"
  FOREIGN KEY ("variantId", "productId") REFERENCES "product_variants"("id", "productId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_return_items" ADD CONSTRAINT "stock_return_items_variantId_productId_fkey"
  FOREIGN KEY ("variantId", "productId") REFERENCES "product_variants"("id", "productId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_allocationBatchId_fkey"
  FOREIGN KEY ("allocationBatchId") REFERENCES "product_variant_allocation_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Preflight: fail before replacing the old indexes if any target uniqueness
-- namespace already contains duplicates. No rows are changed by this block.
-- cart_items: colorId and variantId are independent, non-exclusive
-- attributes now, so uniqueness must cover all four null/non-null
-- combinations of the two columns separately.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "cart_items" WHERE "variantId" IS NOT NULL AND "colorId" IS NOT NULL
    GROUP BY "cartId", "productId", "variantId", "colorId" HAVING COUNT(*) > 1
  ) OR EXISTS (
    SELECT 1 FROM "cart_items" WHERE "variantId" IS NOT NULL AND "colorId" IS NULL
    GROUP BY "cartId", "productId", "variantId" HAVING COUNT(*) > 1
  ) OR EXISTS (
    SELECT 1 FROM "cart_items" WHERE "variantId" IS NULL AND "colorId" IS NOT NULL
    GROUP BY "cartId", "productId", "colorId" HAVING COUNT(*) > 1
  ) OR EXISTS (
    SELECT 1 FROM "cart_items" WHERE "variantId" IS NULL AND "colorId" IS NULL
    GROUP BY "cartId", "productId" HAVING COUNT(*) > 1
  ) THEN RAISE EXCEPTION 'cart_items contains duplicates for variant/color-aware uniqueness'; END IF;

  IF EXISTS (
    SELECT 1 FROM "inventory_items" WHERE "variantId" IS NOT NULL
    GROUP BY "variantId", "locationId" HAVING COUNT(*) > 1
  ) OR EXISTS (
    SELECT 1 FROM "inventory_items" WHERE "variantId" IS NULL
    GROUP BY "productId", "locationId" HAVING COUNT(*) > 1
  ) THEN RAISE EXCEPTION 'inventory_items contains duplicates for variant-aware uniqueness'; END IF;
END $$;

DROP INDEX "cart_items_cartId_productId_colorId_key";
DROP INDEX "cart_items_cartId_productId_null_color_key";
-- Four partial indexes cover every combination of the two independent
-- nullable columns — see the CartItem doc comment in schema.prisma.
CREATE UNIQUE INDEX "cart_items_cart_product_variant_color_key"
  ON "cart_items"("cartId", "productId", "variantId", "colorId") WHERE "variantId" IS NOT NULL AND "colorId" IS NOT NULL;
CREATE UNIQUE INDEX "cart_items_cart_product_variant_key"
  ON "cart_items"("cartId", "productId", "variantId") WHERE "variantId" IS NOT NULL AND "colorId" IS NULL;
CREATE UNIQUE INDEX "cart_items_cart_product_color_key"
  ON "cart_items"("cartId", "productId", "colorId") WHERE "variantId" IS NULL AND "colorId" IS NOT NULL;
CREATE UNIQUE INDEX "cart_items_cart_product_plain_key"
  ON "cart_items"("cartId", "productId") WHERE "variantId" IS NULL AND "colorId" IS NULL;

-- inventory_items never had a colorId column (see migration
-- 20260805130000) — the stock bucket is variant-or-plain only, a simple
-- two-tier partial-unique scheme.
DROP INDEX "inventory_items_productId_locationId_key";
CREATE UNIQUE INDEX "inventory_items_variant_location_key"
  ON "inventory_items"("variantId", "locationId") WHERE "variantId" IS NOT NULL;
CREATE UNIQUE INDEX "inventory_items_product_location_plain_key"
  ON "inventory_items"("productId", "locationId") WHERE "variantId" IS NULL;

CREATE INDEX "order_items_variantId_idx" ON "order_items"("variantId");
CREATE INDEX "stock_movements_variantId_idx" ON "stock_movements"("variantId");
CREATE INDEX "stock_movements_allocationBatchId_idx" ON "stock_movements"("allocationBatchId");
CREATE INDEX "stock_request_items_variantId_idx" ON "stock_request_items"("variantId");
CREATE INDEX "stock_return_items_variantId_idx" ON "stock_return_items"("variantId");

-- No "variant excludes color" CHECK constraints: colorId and variantId are
-- independent, non-exclusive attributes on every operational table — a line
-- can legitimately carry both (e.g. a specific phone model in a specific
-- color) or either alone. inventory_items/stock_movements have no colorId
-- column at all, so the question doesn't even arise there.

-- Preflight for non-negative/positive quantity constraints. This aborts the
-- whole transaction and reports the affected table without changing data.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "inventory_items" WHERE "quantity" < 0) THEN RAISE EXCEPTION 'preflight failed: negative inventory_items.quantity'; END IF;
  IF EXISTS (SELECT 1 FROM "cart_items" WHERE "quantity" <= 0) THEN RAISE EXCEPTION 'preflight failed: non-positive cart_items.quantity'; END IF;
  IF EXISTS (SELECT 1 FROM "order_items" WHERE "quantity" <= 0) THEN RAISE EXCEPTION 'preflight failed: non-positive order_items.quantity'; END IF;
  IF EXISTS (SELECT 1 FROM "stock_movements" WHERE "quantity" <= 0) THEN RAISE EXCEPTION 'preflight failed: non-positive stock_movements.quantity'; END IF;
  IF EXISTS (SELECT 1 FROM "stock_request_items" WHERE "requestedQuantity" <= 0 OR "approvedQuantity" < 0) THEN RAISE EXCEPTION 'preflight failed: invalid stock_request_items quantity'; END IF;
  IF EXISTS (SELECT 1 FROM "stock_return_items" WHERE "quantity" <= 0) THEN RAISE EXCEPTION 'preflight failed: non-positive stock_return_items.quantity'; END IF;
END $$;

ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_quantity_nonnegative_check" CHECK ("quantity" >= 0);
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_quantity_positive_check" CHECK ("quantity" > 0);
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_quantity_positive_check" CHECK ("quantity" > 0);
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_quantity_positive_check" CHECK ("quantity" > 0);
ALTER TABLE "stock_request_items" ADD CONSTRAINT "stock_request_items_quantity_check" CHECK ("requestedQuantity" > 0 AND ("approvedQuantity" IS NULL OR "approvedQuantity" >= 0));
ALTER TABLE "stock_return_items" ADD CONSTRAINT "stock_return_items_quantity_positive_check" CHECK ("quantity" > 0);

-- Database-level identity lock: after any operational table references a
-- Variant, its product/model/code identity is immutable. isActive and
-- sortOrder remain editable so the Variant can be archived safely.
CREATE FUNCTION prevent_used_product_variant_identity_change() RETURNS trigger AS $$
BEGIN
  IF NEW."productId" IS DISTINCT FROM OLD."productId"
     OR NEW."phoneModelId" IS DISTINCT FROM OLD."phoneModelId"
     OR NEW."variantCode" IS DISTINCT FROM OLD."variantCode" THEN
    IF EXISTS (SELECT 1 FROM "inventory_items" WHERE "variantId" = OLD."id")
       OR EXISTS (SELECT 1 FROM "cart_items" WHERE "variantId" = OLD."id")
       OR EXISTS (SELECT 1 FROM "order_items" WHERE "variantId" = OLD."id")
       OR EXISTS (SELECT 1 FROM "stock_movements" WHERE "variantId" = OLD."id")
       OR EXISTS (SELECT 1 FROM "stock_request_items" WHERE "variantId" = OLD."id")
       OR EXISTS (SELECT 1 FROM "stock_return_items" WHERE "variantId" = OLD."id") THEN
      RAISE EXCEPTION 'used ProductVariant identity is immutable';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "product_variants_identity_immutable_when_used"
  BEFORE UPDATE OF "productId", "phoneModelId", "variantCode" ON "product_variants"
  FOR EACH ROW EXECUTE FUNCTION prevent_used_product_variant_identity_change();

CREATE FUNCTION prevent_completed_variant_allocation_batch_reopen() RETURNS trigger AS $$
BEGIN
  IF NEW."productId" IS DISTINCT FROM OLD."productId" OR NEW."originalLegacyQuantity" IS DISTINCT FROM OLD."originalLegacyQuantity" THEN
    RAISE EXCEPTION 'variant allocation baseline is immutable';
  END IF;
  IF OLD."status" = 'COMPLETED' AND (
    NEW."status" IS DISTINCT FROM OLD."status"
    OR NEW."allocatedQuantity" IS DISTINCT FROM OLD."allocatedQuantity"
    OR NEW."completedAt" IS DISTINCT FROM OLD."completedAt"
    OR NEW."completedById" IS DISTINCT FROM OLD."completedById"
  ) THEN RAISE EXCEPTION 'completed variant allocation batch is immutable'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "variant_allocation_batch_immutable"
  BEFORE UPDATE ON "product_variant_allocation_batches"
  FOR EACH ROW EXECUTE FUNCTION prevent_completed_variant_allocation_batch_reopen();

COMMIT;
