-- Existing and new products remain visible by default.
ALTER TABLE "products" ADD COLUMN "isStorefrontVisible" BOOLEAN NOT NULL DEFAULT true;
