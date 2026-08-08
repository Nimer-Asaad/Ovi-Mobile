-- CreateTable
CREATE TABLE "colors" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameAr" TEXT,
    "hexCode" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "colors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_color_options" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "colorId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_color_options_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "product_color_options_productId_colorId_key" ON "product_color_options"("productId", "colorId");

-- AddForeignKey
ALTER TABLE "product_color_options" ADD CONSTRAINT "product_color_options_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_color_options" ADD CONSTRAINT "product_color_options_colorId_fkey" FOREIGN KEY ("colorId") REFERENCES "colors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable: cart_items
ALTER TABLE "cart_items" ADD COLUMN "colorId" TEXT;
DROP INDEX "cart_items_cartId_productId_key";
-- Standard unique index: correctly enforces "one row per cartId+productId+colorId"
-- whenever colorId is NOT NULL (Postgres compares non-null values normally).
CREATE UNIQUE INDEX "cart_items_cartId_productId_colorId_key" ON "cart_items"("cartId", "productId", "colorId");
-- Partial unique index: SQL unique constraints treat NULL as distinct from
-- every other NULL, so the index above alone would NOT stop two colorless
-- rows for the same cartId+productId. This closes that gap for the
-- colorId IS NULL case specifically. Not representable in schema.prisma
-- (no partial-index support), so it's hand-authored here — application
-- code in src/lib/cart.ts must query/write colorless rows via plain
-- `colorId: null` filters, never the productId_locationId_colorId /
-- cartId_productId_colorId compound-key shorthand (Prisma's generated type
-- for that shorthand disallows null, by design, for exactly this reason).
CREATE UNIQUE INDEX "cart_items_cartId_productId_null_color_key" ON "cart_items"("cartId", "productId") WHERE "colorId" IS NULL;
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_colorId_fkey" FOREIGN KEY ("colorId") REFERENCES "colors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- inventory_items and stock_movements deliberately never get a colorId
-- column: the stock bucket is determined solely by product + variant
-- (phone model), never color. Color is purely descriptive on the
-- order/cart/request/return-facing tables below.

-- AlterTable: order_items
ALTER TABLE "order_items" ADD COLUMN "colorId" TEXT;
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_colorId_fkey" FOREIGN KEY ("colorId") REFERENCES "colors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable: stock_request_items
ALTER TABLE "stock_request_items" ADD COLUMN "colorId" TEXT;
ALTER TABLE "stock_request_items" ADD CONSTRAINT "stock_request_items_colorId_fkey" FOREIGN KEY ("colorId") REFERENCES "colors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable: stock_return_items
ALTER TABLE "stock_return_items" ADD COLUMN "colorId" TEXT;
ALTER TABLE "stock_return_items" ADD CONSTRAINT "stock_return_items_colorId_fkey" FOREIGN KEY ("colorId") REFERENCES "colors"("id") ON DELETE SET NULL ON UPDATE CASCADE;
