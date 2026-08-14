/**
 * Destructive verification harness for the per-product inventory tracking
 * modes feature (TOTAL_STOCK / DEVICE_MODEL_COLOR). Safety rails live in
 * prisma/verify-guardrails.ts (shared with prisma/verify-migration-upgrade.ts
 * and prisma/verify-order-lifecycle.ts's pattern) — never runs against a
 * shared/production database; see that file for the exact checks.
 *
 * This exercises the library layer directly (src/lib/inventory-transactions.ts,
 * src/lib/inventory-tracking.ts), not the "use server" admin actions —
 * requireRole()'s redirect() calls need a real Next.js request context that
 * a standalone script can't provide, matching the same scope limitation
 * verify-order-lifecycle.ts already accepts. Every new admin action in this
 * feature (src/app/admin/products/actions.ts:updateInventoryTrackingMode,
 * src/app/admin/products/[id]/device-inventory/actions.ts) begins with
 * `await requireRole([ROLES.ADMIN])` as its first statement — verified by
 * code inspection, the same way the rest of this codebase's admin actions
 * are, rather than by a runtime session simulation.
 */

export {}; // Force module scope — see the sibling collision this avoids in verify-order-lifecycle.ts.

import { resolveVerifyDatabaseUrl } from "./verify-guardrails";

const resolved = resolveVerifyDatabaseUrl("INVENTORY_TRACKING_VERIFY_DATABASE_URL");
console.log(`[verify-inventory-tracking-modes] target: ${resolved.masked}`);

process.env.DATABASE_URL = resolved.url;
process.env.DIRECT_URL = resolved.url;

async function main() {
const [{ PrismaClient }, constants, inventoryTx, inventoryTracking] = await Promise.all([
  import("@prisma/client"),
  import("../src/lib/constants"),
  import("../src/lib/inventory-transactions"),
  import("../src/lib/inventory-tracking"),
]);

const prisma = new PrismaClient();
const { STOCK_LOCATION_TYPES, PRODUCT_INVENTORY_TRACKING_MODES } = constants;
const {
  decrementInventoryAtomic,
  incrementInventoryUpsert,
  setInventoryAbsolute,
  recordStockMovement,
} = inventoryTx;
const {
  createDeviceColorCombo,
  setDeviceColorComboQuantity,
  removeOrDeactivateDeviceColorCombo,
  changeInventoryTrackingMode,
  DuplicateDeviceColorComboError,
  InventoryTrackingModeConversionError,
} = inventoryTracking;

const runId = `verify-itm-${Date.now()}`;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function check(name: string, test: () => Promise<void>) {
  try {
    await test();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

const admin = await prisma.user.create({
  data: { role: constants.ROLES.ADMIN, name: `${runId}-admin`, email: `${runId}-admin@example.invalid`, isActive: true },
});
const warehouse = await prisma.stockLocation.create({
  data: { type: STOCK_LOCATION_TYPES.WAREHOUSE, name: `${runId}-warehouse`, isDefault: true },
});
const secondLocation = await prisma.stockLocation.create({
  data: { type: STOCK_LOCATION_TYPES.WAREHOUSE, name: `${runId}-second-warehouse` },
});
const category = await prisma.category.create({ data: { name: `${runId}-category`, slug: `${runId}-category` } });

let sequence = 0;
async function createProduct(trackingMode: string = PRODUCT_INVENTORY_TRACKING_MODES.TOTAL_STOCK) {
  sequence += 1;
  return prisma.product.create({
    data: {
      sku: `${runId}-${sequence}`,
      name: `${runId}-product-${sequence}`,
      categoryId: category.id,
      retailPriceCents: 1000,
      wholesalePriceCents: 800,
      isActive: true,
      inventoryTrackingMode: trackingMode,
    },
  });
}

try {
  await check("new product defaults to TOTAL_STOCK", async () => {
    const product = await createProduct();
    assert(product.inventoryTrackingMode === PRODUCT_INVENTORY_TRACKING_MODES.TOTAL_STOCK, "default tracking mode was not TOTAL_STOCK");
    assert(product.variantMode === "NONE", "default variantMode was not NONE");
  });

  await check("TOTAL_STOCK product: single plain bucket, independent of other products", async () => {
    const product = await createProduct();
    const other = await createProduct();
    await prisma.$transaction(async (tx) => {
      const change = await incrementInventoryUpsert(tx, { productId: product.id, locationId: warehouse.id }, 20);
      await recordStockMovement(tx, { type: "STOCK_IN", productId: product.id, toLocationId: warehouse.id, quantity: 20, previousQuantity: change.previousQuantity, newQuantity: change.newQuantity, createdById: admin.id });
      await incrementInventoryUpsert(tx, { productId: other.id, locationId: warehouse.id }, 5);
    });
    const row = await prisma.inventoryItem.findFirstOrThrow({ where: { productId: product.id, locationId: warehouse.id, variantId: null, deviceColorVariantId: null } });
    const otherRow = await prisma.inventoryItem.findFirstOrThrow({ where: { productId: other.id, locationId: warehouse.id, variantId: null, deviceColorVariantId: null } });
    assert(row.quantity === 20 && otherRow.quantity === 5, "plain bucket quantities leaked between products");

    await prisma.$transaction((tx) => decrementInventoryAtomic(tx, { productId: product.id, locationId: warehouse.id }, 8));
    const after = await prisma.inventoryItem.findFirstOrThrow({ where: { productId: product.id, locationId: warehouse.id, variantId: null, deviceColorVariantId: null } });
    assert(after.quantity === 12, "decrement produced wrong quantity");
  });

  const brand = await prisma.phoneBrand.create({ data: { name: `${runId}-Apple`, slug: `${runId}-apple` } });
  const otherBrand = await prisma.phoneBrand.create({ data: { name: `${runId}-Samsung`, slug: `${runId}-samsung` } });
  const modelA = await prisma.phoneModel.create({ data: { phoneBrandId: brand.id, name: `${runId}-17ProMax`, slug: `${runId}-17-pro-max` } });
  const modelB = await prisma.phoneModel.create({ data: { phoneBrandId: brand.id, name: `${runId}-16ProMax`, slug: `${runId}-16-pro-max` } });
  const modelOtherBrand = await prisma.phoneModel.create({ data: { phoneBrandId: otherBrand.id, name: `${runId}-S25Ultra`, slug: `${runId}-s25-ultra` } });
  const colorBlack = await prisma.color.create({ data: { name: `${runId}-Black` } });
  const colorBrown = await prisma.color.create({ data: { name: `${runId}-Brown` } });

  await check("model filtering by brand returns only that brand's models", async () => {
    const models = await prisma.phoneModel.findMany({ where: { phoneBrandId: brand.id } });
    const ids = models.map((m) => m.id).sort();
    assert(ids.length === 2 && ids.includes(modelA.id) && ids.includes(modelB.id) && !ids.includes(modelOtherBrand.id), "brand filter leaked another brand's model or missed one");
  });

  await check("DEVICE_MODEL_COLOR product: independent quantities per combination", async () => {
    const product = await createProduct(PRODUCT_INVENTORY_TRACKING_MODES.DEVICE_MODEL_COLOR);
    const comboBlack = await prisma.$transaction((tx) => createDeviceColorCombo(tx, { productId: product.id, phoneModelId: modelA.id, colorId: colorBlack.id, locationId: warehouse.id, initialQuantity: 10, actorId: admin.id }));
    const comboBrown = await prisma.$transaction((tx) => createDeviceColorCombo(tx, { productId: product.id, phoneModelId: modelA.id, colorId: colorBrown.id, locationId: warehouse.id, initialQuantity: 6, actorId: admin.id }));
    const comboOtherModel = await prisma.$transaction((tx) => createDeviceColorCombo(tx, { productId: product.id, phoneModelId: modelB.id, colorId: colorBlack.id, locationId: warehouse.id, initialQuantity: 4, actorId: admin.id }));

    const qty = async (comboId: string) => (await prisma.inventoryItem.findFirstOrThrow({ where: { deviceColorVariantId: comboId, locationId: warehouse.id } })).quantity;
    assert((await qty(comboBlack.id)) === 10 && (await qty(comboBrown.id)) === 6 && (await qty(comboOtherModel.id)) === 4, "initial combo quantities wrong");

    // Editing one combination's quantity must never affect the others.
    await prisma.$transaction((tx) => setDeviceColorComboQuantity(tx, { comboId: comboBlack.id, productId: product.id, locationId: warehouse.id, quantity: 3, actorId: admin.id }));
    assert((await qty(comboBlack.id)) === 3, "combo quantity update did not apply");
    assert((await qty(comboBrown.id)) === 6 && (await qty(comboOtherModel.id)) === 4, "editing one combination affected another combination's quantity");

    // The product's plain (variant-less) bucket must never exist for a
    // DEVICE_MODEL_COLOR product — all its stock lives in per-combo rows.
    const plainRow = await prisma.inventoryItem.findFirst({ where: { productId: product.id, locationId: warehouse.id, variantId: null, deviceColorVariantId: null } });
    assert(plainRow === null, "a DEVICE_MODEL_COLOR product unexpectedly has a plain stock bucket");
  });

  await check("same combination holds independent quantities per stock location", async () => {
    const product = await createProduct(PRODUCT_INVENTORY_TRACKING_MODES.DEVICE_MODEL_COLOR);
    const combo = await prisma.$transaction((tx) => createDeviceColorCombo(tx, { productId: product.id, phoneModelId: modelA.id, colorId: colorBlack.id, locationId: warehouse.id, initialQuantity: 7, actorId: admin.id }));
    // Same DeviceColorVariant.id, a different location — this must create a
    // second, independent InventoryItem row (the partial unique index is
    // (deviceColorVariantId, locationId), not deviceColorVariantId alone).
    await prisma.$transaction((tx) => setDeviceColorComboQuantity(tx, { comboId: combo.id, productId: product.id, locationId: secondLocation.id, quantity: 5, actorId: admin.id }));

    const rows = await prisma.inventoryItem.findMany({ where: { deviceColorVariantId: combo.id }, select: { locationId: true, quantity: true } });
    assert(rows.length === 2, `expected 2 location rows for one combination, got ${rows.length}`);
    const atWarehouse = rows.find((row) => row.locationId === warehouse.id);
    const atSecond = rows.find((row) => row.locationId === secondLocation.id);
    assert(atWarehouse?.quantity === 7 && atSecond?.quantity === 5, "per-location quantities for the same combination leaked into each other");

    // Changing one location's quantity must not touch the other.
    await prisma.$transaction((tx) => setDeviceColorComboQuantity(tx, { comboId: combo.id, productId: product.id, locationId: warehouse.id, quantity: 2, actorId: admin.id }));
    const after = await prisma.inventoryItem.findMany({ where: { deviceColorVariantId: combo.id }, select: { locationId: true, quantity: true } });
    const afterWarehouse = after.find((row) => row.locationId === warehouse.id);
    const afterSecond = after.find((row) => row.locationId === secondLocation.id);
    assert(afterWarehouse?.quantity === 2 && afterSecond?.quantity === 5, "editing one location's quantity affected the other location");
  });

  await check("duplicate device+color combination is rejected", async () => {
    const product = await createProduct(PRODUCT_INVENTORY_TRACKING_MODES.DEVICE_MODEL_COLOR);
    await prisma.$transaction((tx) => createDeviceColorCombo(tx, { productId: product.id, phoneModelId: modelA.id, colorId: colorBlack.id, locationId: warehouse.id, initialQuantity: 1, actorId: admin.id }));
    let threw = false;
    try {
      await prisma.$transaction((tx) => createDeviceColorCombo(tx, { productId: product.id, phoneModelId: modelA.id, colorId: colorBlack.id, locationId: warehouse.id, initialQuantity: 1, actorId: admin.id }));
    } catch (error) {
      threw = error instanceof DuplicateDeviceColorComboError;
    }
    assert(threw, "duplicate combination was not rejected");
    const combos = await prisma.deviceColorVariant.findMany({ where: { productId: product.id, phoneModelId: modelA.id, colorId: colorBlack.id } });
    assert(combos.length === 1, "duplicate combination created a second row");
  });

  await check("DB CHECK constraint rejects a row with both variantId and deviceColorVariantId set", async () => {
    const product = await createProduct(PRODUCT_INVENTORY_TRACKING_MODES.DEVICE_MODEL_COLOR);
    const combo = await prisma.$transaction((tx) => createDeviceColorCombo(tx, { productId: product.id, phoneModelId: modelA.id, colorId: colorBlack.id, locationId: warehouse.id, initialQuantity: 0, actorId: admin.id }));
    const variantProduct = await createProduct();
    const variant = await prisma.productVariant.create({ data: { productId: variantProduct.id, phoneModelId: modelA.id } });
    let threw = false;
    try {
      await prisma.$executeRaw`INSERT INTO "inventory_items" ("id", "productId", "locationId", "variantId", "deviceColorVariantId", "quantity", "updatedAt") VALUES (${`${runId}-bad-row`}, ${product.id}, ${warehouse.id}, ${variant.id}, ${combo.id}, 1, now())`;
    } catch {
      threw = true;
    }
    assert(threw, "database allowed a row with both variantId and deviceColorVariantId set");
  });

  await check("unsafe conversion TOTAL_STOCK -> DEVICE_MODEL_COLOR is rejected when stock exists", async () => {
    const product = await createProduct();
    await prisma.$transaction((tx) => incrementInventoryUpsert(tx, { productId: product.id, locationId: warehouse.id }, 7));
    let code: string | undefined;
    try {
      await prisma.$transaction((tx) => changeInventoryTrackingMode(tx, { productId: product.id, newMode: PRODUCT_INVENTORY_TRACKING_MODES.DEVICE_MODEL_COLOR }));
    } catch (error) {
      if (error instanceof InventoryTrackingModeConversionError) code = error.code;
    }
    assert(code === "EXISTING_TOTAL_STOCK", "unsafe TOTAL_STOCK->DEVICE_MODEL_COLOR conversion was not rejected");
    const unchanged = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    assert(unchanged.inventoryTrackingMode === PRODUCT_INVENTORY_TRACKING_MODES.TOTAL_STOCK, "product mode changed despite rejected conversion");
    const stillThere = await prisma.inventoryItem.findFirstOrThrow({ where: { productId: product.id, locationId: warehouse.id, variantId: null, deviceColorVariantId: null } });
    assert(stillThere.quantity === 7, "quantity was moved or lost during a rejected conversion");
  });

  await check("safe conversion TOTAL_STOCK -> DEVICE_MODEL_COLOR succeeds at zero stock", async () => {
    const product = await createProduct();
    await prisma.$transaction((tx) => changeInventoryTrackingMode(tx, { productId: product.id, newMode: PRODUCT_INVENTORY_TRACKING_MODES.DEVICE_MODEL_COLOR }));
    const updated = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    assert(updated.inventoryTrackingMode === PRODUCT_INVENTORY_TRACKING_MODES.DEVICE_MODEL_COLOR, "safe conversion did not apply");
  });

  await check("unsafe conversion DEVICE_MODEL_COLOR -> TOTAL_STOCK is rejected while combinations exist", async () => {
    const product = await createProduct(PRODUCT_INVENTORY_TRACKING_MODES.DEVICE_MODEL_COLOR);
    await prisma.$transaction((tx) => createDeviceColorCombo(tx, { productId: product.id, phoneModelId: modelA.id, colorId: colorBlack.id, locationId: warehouse.id, initialQuantity: 0, actorId: admin.id }));
    let code: string | undefined;
    try {
      await prisma.$transaction((tx) => changeInventoryTrackingMode(tx, { productId: product.id, newMode: PRODUCT_INVENTORY_TRACKING_MODES.TOTAL_STOCK }));
    } catch (error) {
      if (error instanceof InventoryTrackingModeConversionError) code = error.code;
    }
    assert(code === "EXISTING_COMBOS", "unsafe DEVICE_MODEL_COLOR->TOTAL_STOCK conversion was not rejected");
  });

  await check("conversion to DEVICE_MODEL_COLOR is rejected for legacy PHONE_COMPATIBILITY products", async () => {
    const product = await createProduct();
    await prisma.product.update({ where: { id: product.id }, data: { variantMode: "PHONE_COMPATIBILITY" } });
    let code: string | undefined;
    try {
      await prisma.$transaction((tx) => changeInventoryTrackingMode(tx, { productId: product.id, newMode: PRODUCT_INVENTORY_TRACKING_MODES.DEVICE_MODEL_COLOR }));
    } catch (error) {
      if (error instanceof InventoryTrackingModeConversionError) code = error.code;
    }
    assert(code === "LEGACY_VARIANT_MODE", "conversion did not reject a legacy PHONE_COMPATIBILITY product");
  });

  await check("safe combo removal deletes when unused, deactivates when it has ledger history", async () => {
    const product = await createProduct(PRODUCT_INVENTORY_TRACKING_MODES.DEVICE_MODEL_COLOR);
    const unusedCombo = await prisma.$transaction((tx) => createDeviceColorCombo(tx, { productId: product.id, phoneModelId: modelA.id, colorId: colorBlack.id, locationId: warehouse.id, initialQuantity: 0, actorId: admin.id }));
    const usedCombo = await prisma.$transaction((tx) => createDeviceColorCombo(tx, { productId: product.id, phoneModelId: modelA.id, colorId: colorBrown.id, locationId: warehouse.id, initialQuantity: 5, actorId: admin.id }));
    // Bring the used combo back to zero — it still has StockMovement history, so it must not hard-delete.
    await prisma.$transaction((tx) => setDeviceColorComboQuantity(tx, { comboId: usedCombo.id, productId: product.id, locationId: warehouse.id, quantity: 0, actorId: admin.id }));

    const unusedResult = await prisma.$transaction((tx) => removeOrDeactivateDeviceColorCombo(tx, unusedCombo.id));
    assert(unusedResult.mode === "deleted", "unused zero-quantity combo was not hard-deleted");
    const goneRow = await prisma.deviceColorVariant.findUnique({ where: { id: unusedCombo.id } });
    assert(goneRow === null, "deleted combo row still exists");

    const usedResult = await prisma.$transaction((tx) => removeOrDeactivateDeviceColorCombo(tx, usedCombo.id));
    assert(usedResult.mode === "deactivated", "combo with ledger history was hard-deleted instead of deactivated");
    const stillRow = await prisma.deviceColorVariant.findUniqueOrThrow({ where: { id: usedCombo.id } });
    assert(stillRow.isActive === false, "deactivated combo still marked active");
    const movementCount = await prisma.stockMovement.count({ where: { deviceColorVariantId: usedCombo.id } });
    assert(movementCount > 0, "ledger history was lost for a deactivated combo");
  });

  await check("cart_items: one line per combination, duplicate combination rejected", async () => {
    const product = await createProduct(PRODUCT_INVENTORY_TRACKING_MODES.DEVICE_MODEL_COLOR);
    const comboBlack = await prisma.$transaction((tx) => createDeviceColorCombo(tx, { productId: product.id, phoneModelId: modelA.id, colorId: colorBlack.id, locationId: warehouse.id, initialQuantity: 5, actorId: admin.id }));
    const comboBrown = await prisma.$transaction((tx) => createDeviceColorCombo(tx, { productId: product.id, phoneModelId: modelA.id, colorId: colorBrown.id, locationId: warehouse.id, initialQuantity: 5, actorId: admin.id }));

    const customer = await prisma.user.create({ data: { role: "RETAIL_CUSTOMER", name: `${runId}-customer`, email: `${runId}-customer@example.invalid`, isActive: true } });
    const cart = await prisma.cart.create({ data: { userId: customer.id } });

    await prisma.cartItem.create({ data: { cartId: cart.id, productId: product.id, deviceColorVariantId: comboBlack.id, quantity: 1 } });
    await prisma.cartItem.create({ data: { cartId: cart.id, productId: product.id, deviceColorVariantId: comboBrown.id, quantity: 1 } });
    const lineCount = await prisma.cartItem.count({ where: { cartId: cart.id } });
    assert(lineCount === 2, "two different combinations of the same product did not coexist as separate cart lines");

    let duplicateThrew = false;
    try {
      await prisma.cartItem.create({ data: { cartId: cart.id, productId: product.id, deviceColorVariantId: comboBlack.id, quantity: 1 } });
    } catch {
      duplicateThrew = true;
    }
    assert(duplicateThrew, "a second cart line for the same combination was allowed");
  });

  await check("cart_items/order_items: variantId and deviceColorVariantId are mutually exclusive (XOR constraint)", async () => {
    const product = await createProduct(PRODUCT_INVENTORY_TRACKING_MODES.DEVICE_MODEL_COLOR);
    const combo = await prisma.$transaction((tx) => createDeviceColorCombo(tx, { productId: product.id, phoneModelId: modelA.id, colorId: colorBlack.id, locationId: warehouse.id, initialQuantity: 0, actorId: admin.id }));
    // A ProductVariant row for the same product — the app layer never lets a
    // DEVICE_MODEL_COLOR product reach saveProductVariants (see the guard in
    // src/app/admin/products/[id]/variants/actions.ts), but the DB-level
    // XOR CHECK must hold regardless of how a row was written.
    const variant = await prisma.productVariant.create({ data: { productId: product.id, phoneModelId: modelA.id } });

    const customer = await prisma.user.create({ data: { role: "RETAIL_CUSTOMER", name: `${runId}-customer2`, email: `${runId}-customer2@example.invalid`, isActive: true } });
    const cart = await prisma.cart.create({ data: { userId: customer.id } });

    let cartXorThrew = false;
    try {
      await prisma.cartItem.create({ data: { cartId: cart.id, productId: product.id, variantId: variant.id, deviceColorVariantId: combo.id, quantity: 1 } });
    } catch {
      cartXorThrew = true;
    }
    assert(cartXorThrew, "cart_items allowed a row with both variantId and deviceColorVariantId set");

    const order = await prisma.order.create({ data: { orderNumber: `${runId}-order-xor`, source: "RETAIL", subtotalCents: 1000, totalCents: 1000 } });
    let orderXorThrew = false;
    try {
      await prisma.orderItem.create({ data: { orderId: order.id, productId: product.id, variantId: variant.id, deviceColorVariantId: combo.id, quantity: 1, unitPriceCents: 1000, totalCents: 1000 } });
    } catch {
      orderXorThrew = true;
    }
    assert(orderXorThrew, "order_items allowed a row with both variantId and deviceColorVariantId set");
  });

  await check("order_items: a device+color combination line stores and links back correctly", async () => {
    const product = await createProduct(PRODUCT_INVENTORY_TRACKING_MODES.DEVICE_MODEL_COLOR);
    const combo = await prisma.$transaction((tx) => createDeviceColorCombo(tx, { productId: product.id, phoneModelId: modelA.id, colorId: colorBlack.id, locationId: warehouse.id, initialQuantity: 10, actorId: admin.id }));

    const order = await prisma.order.create({ data: { orderNumber: `${runId}-order-combo`, source: "RETAIL", subtotalCents: 2000, totalCents: 2000 } });
    const orderItem = await prisma.orderItem.create({
      data: {
        orderId: order.id,
        productId: product.id,
        deviceColorVariantId: combo.id,
        phoneBrandSnapshot: brand.nameAr ?? brand.name,
        phoneModelSnapshot: modelA.nameAr ?? modelA.name,
        colorNameSnapshot: colorBlack.nameAr ?? colorBlack.name,
        quantity: 2,
        unitPriceCents: 1000,
        totalCents: 2000,
      },
    });

    const reloaded = await prisma.orderItem.findUniqueOrThrow({ where: { id: orderItem.id }, include: { deviceColorVariant: { include: { phoneModel: true, color: true } } } });
    assert(reloaded.deviceColorVariant?.id === combo.id, "order item did not link back to the combination");
    assert(reloaded.deviceColorVariant?.phoneModel.id === modelA.id && reloaded.deviceColorVariant?.color.id === colorBlack.id, "linked combination resolved to the wrong model/color");
  });

  await check("existing plain products are unaffected by the DeviceColorVariant machinery", async () => {
    const product = await createProduct();
    await prisma.$transaction(async (tx) => {
      const change = await setInventoryAbsolute(tx, { productId: product.id, locationId: warehouse.id }, 42);
      await recordStockMovement(tx, { type: "ADJUSTMENT", productId: product.id, toLocationId: warehouse.id, quantity: 42, previousQuantity: change.previousQuantity, newQuantity: change.newQuantity, createdById: admin.id });
    });
    const row = await prisma.inventoryItem.findFirstOrThrow({ where: { productId: product.id, locationId: warehouse.id, variantId: null, deviceColorVariantId: null } });
    assert(row.quantity === 42 && row.deviceColorVariantId === null, "plain product behavior changed");
  });
} finally {
  // Orders/OrderItems and Users/Carts/CartItems first — both OrderItem and
  // CartItem have a RESTRICT foreign key to device_color_variants, which
  // the deviceColorVariant/product cleanup below would otherwise violate.
  // Order->OrderItem and User->Cart->CartItem are all ON DELETE CASCADE.
  await prisma.order.deleteMany({ where: { orderNumber: { startsWith: runId } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: runId, contains: "customer" } } });
  await prisma.stockMovement.deleteMany({ where: { product: { sku: { startsWith: runId } } } });
  await prisma.inventoryItem.deleteMany({ where: { product: { sku: { startsWith: runId } } } });
  await prisma.deviceColorVariant.deleteMany({ where: { product: { sku: { startsWith: runId } } } });
  await prisma.productVariant.deleteMany({ where: { product: { sku: { startsWith: runId } } } });
  await prisma.product.deleteMany({ where: { sku: { startsWith: runId } } });
  await prisma.phoneModel.deleteMany({ where: { slug: { startsWith: runId } } });
  await prisma.phoneBrand.deleteMany({ where: { slug: { startsWith: runId } } });
  await prisma.color.deleteMany({ where: { name: { startsWith: runId } } });
  await prisma.category.deleteMany({ where: { slug: runId + "-category" } });
  await prisma.stockLocation.deleteMany({ where: { name: { startsWith: runId } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: runId } } });
  await prisma.$disconnect();
}

console.log("All inventory tracking mode verification checks passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
