/**
 * Upgrade-path verification harness for migration
 * 20260814120000_add_device_color_inventory_tracking.
 *
 * What this proves, in order:
 *  1. A database carrying only the migrations that existed BEFORE this one
 *     (i.e. the real pre-upgrade shape of any existing installation) can be
 *     built from the project's own migration files.
 *  2. Realistic legacy data (a plain product, a PHONE_COMPATIBILITY product
 *     with a ProductVariant, InventoryItem rows both plain and
 *     variant-linked, StockMovement rows both plain and variant-linked,
 *     more than one StockLocation, and in-use PhoneBrand/PhoneModel/Color
 *     rows) can be seeded against that old shape.
 *  3. Applying the new migration through the OFFICIAL project files
 *     (`prisma migrate deploy` against the real prisma/schema.prisma, not a
 *     copy) changes not one byte of that legacy data — proven by comparing
 *     row counts and content checksums taken immediately before and after.
 *  4. Every legacy product's new `inventoryTrackingMode` column reads
 *     TOTAL_STOCK, and the PHONE_COMPATIBILITY product's variant/inventory
 *     machinery still functions post-migration (a real increment/decrement
 *     round-trip through src/lib/inventory-transactions.ts against its
 *     pre-existing InventoryItem row).
 *  5. The new DEVICE_MODEL_COLOR feature works end-to-end on the
 *     now-upgraded database — delegated to
 *     prisma/verify-inventory-tracking-modes.ts (run as a child process
 *     against the same database) rather than duplicated here, so this file
 *     only owns what's specific to the upgrade scenario.
 *
 * Safety: every check in prisma/verify-guardrails.ts applies (verify-named
 * database, localhost-or-explicitly-authorized host, independent env var,
 * refuses to match the project's real DATABASE_URL). On top of that, this
 * script additionally REQUIRES the resolved database to be empty (no
 * `_prisma_migrations` history and no `products`/`users` tables) before it
 * will touch it, so it can never be pointed at an already-populated
 * database by mistake — it always starts from a truly blank slate that it
 * builds up itself.
 *
 * This script builds a *temporary copy* of prisma/schema.prisma plus every
 * migration folder older than the target one (never the real
 * prisma/migrations directory — that is only read from, never written to)
 * to make `prisma migrate deploy` stop short of the newest migration. That
 * temp copy is deleted again at the end regardless of outcome. Applying the
 * new migration itself always goes through the real, unmodified
 * prisma/schema.prisma — "the official way" — never the temp copy.
 *
 * NEVER runs `prisma migrate reset`, never drops the database itself (see
 * the printed cleanup instructions at the end — the operator runs those by
 * hand), and never connects to anything but the database resolved by
 * INVENTORY_TRACKING_VERIFY_DATABASE_URL.
 */

export {};

import { resolveVerifyDatabaseUrl } from "./verify-guardrails";

const resolved = resolveVerifyDatabaseUrl("INVENTORY_TRACKING_VERIFY_DATABASE_URL");
console.log(`[verify-migration-upgrade] target: ${resolved.masked}`);
process.env.DATABASE_URL = resolved.url;
process.env.DIRECT_URL = resolved.url;

async function main() {
const { mkdtempSync, mkdirSync, cpSync, rmSync, readdirSync, statSync } = await import("node:fs");
const { tmpdir } = await import("node:os");
const { join, resolve: resolvePath } = await import("node:path");
const { spawnSync } = await import("node:child_process");
const { createHash } = await import("node:crypto");
const { PrismaClient } = await import("@prisma/client");
const constants = await import("../src/lib/constants");
const inventoryTx = await import("../src/lib/inventory-transactions");

const { STOCK_LOCATION_TYPES, ROLES, STOCK_MOVEMENT_TYPES } = constants;
const { incrementInventoryUpsert, decrementInventoryAtomic, recordStockMovement } = inventoryTx;

const runId = `verify-mig-${Date.now()}`;
const NEW_MIGRATION_NAME = "20260814120000_add_device_color_inventory_tracking";
const PROJECT_ROOT = process.cwd();
const REAL_MIGRATIONS_DIR = join(PROJECT_ROOT, "prisma", "migrations");
const REAL_SCHEMA_PATH = join(PROJECT_ROOT, "prisma", "schema.prisma");

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

function runPrismaMigrateDeploy(schemaPath: string, label: string): void {
  console.log(`[verify-migration-upgrade] prisma migrate deploy — ${label}`);
  const result = spawnSync("npx", ["prisma", "migrate", "deploy", "--schema", schemaPath], {
    cwd: PROJECT_ROOT,
    env: process.env,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`prisma migrate deploy (${label}) exited with code ${result.status}`);
}

/** Builds a temp prisma/ directory containing every migration OLDER than
 * NEW_MIGRATION_NAME, plus a verbatim copy of the real schema.prisma
 * (needed only for its datasource block — migrate deploy does not diff the
 * schema's models against the database). Never touches the real
 * prisma/migrations directory. Returns the temp schema.prisma path and a
 * cleanup function. */
function buildOldSchemaDir(): { schemaPath: string; cleanup: () => void } {
  const tempRoot = mkdtempSync(join(tmpdir(), "ovi-migration-test-"));
  const tempPrismaDir = join(tempRoot, "prisma");
  const tempMigrationsDir = join(tempPrismaDir, "migrations");
  mkdirSync(tempMigrationsDir, { recursive: true });

  cpSync(REAL_SCHEMA_PATH, join(tempPrismaDir, "schema.prisma"));
  cpSync(join(REAL_MIGRATIONS_DIR, "migration_lock.toml"), join(tempMigrationsDir, "migration_lock.toml"));

  const allMigrationDirs = readdirSync(REAL_MIGRATIONS_DIR)
    .filter((name) => statSync(join(REAL_MIGRATIONS_DIR, name)).isDirectory())
    .sort();
  if (!allMigrationDirs.includes(NEW_MIGRATION_NAME)) {
    throw new Error(`Expected migration "${NEW_MIGRATION_NAME}" was not found in prisma/migrations — update NEW_MIGRATION_NAME in this script.`);
  }
  const oldMigrationDirs = allMigrationDirs.filter((name) => name < NEW_MIGRATION_NAME);
  assert(oldMigrationDirs.length > 0, "No migrations found before the target migration — nothing to test an upgrade from.");

  for (const name of oldMigrationDirs) {
    cpSync(join(REAL_MIGRATIONS_DIR, name), join(tempMigrationsDir, name), { recursive: true });
  }

  console.log(`[verify-migration-upgrade] old-schema snapshot built from ${oldMigrationDirs.length} migration(s), stopping just before ${NEW_MIGRATION_NAME}`);
  return {
    schemaPath: join(tempPrismaDir, "schema.prisma"),
    cleanup: () => rmSync(tempRoot, { recursive: true, force: true }),
  };
}

const prisma = new PrismaClient();

/** Guards against ever running this against a database that already has
 * data — this script always builds its own state from a blank slate. */
async function assertDatabaseIsEmpty(): Promise<void> {
  const historyExists = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(
    `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = '_prisma_migrations') AS "exists"`,
  );
  if (historyExists[0]?.exists) {
    throw new Error(
      "Target database already has a _prisma_migrations history table — refusing to run. " +
        "This script only ever runs against a brand-new, empty database that it migrates itself.",
    );
  }
}

/** Row counts + a content checksum per table, computed with plain SQL so it
 * works identically whether the new columns exist yet or not. */
async function snapshot() {
  const productRows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT id, sku, name, "variantMode" FROM products ORDER BY id`,
  );
  const inventoryRows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT id, "productId", "locationId", "variantId", quantity FROM inventory_items ORDER BY id`,
  );
  const movementRows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT id, type, "productId", "variantId", quantity, "previousQuantity", "newQuantity" FROM stock_movements ORDER BY id`,
  );
  const variantRows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT id, "productId", "phoneModelId", "variantCode" FROM product_variants ORDER BY id`,
  );

  const checksum = (rows: Record<string, unknown>[]) =>
    createHash("sha256").update(JSON.stringify(rows, (_key, value) => (typeof value === "bigint" ? value.toString() : value))).digest("hex");

  return {
    productCount: productRows.length,
    inventoryCount: inventoryRows.length,
    inventoryQuantitySum: inventoryRows.reduce((sum, row) => sum + Number(row.quantity), 0),
    movementCount: movementRows.length,
    variantCount: variantRows.length,
    checksum: {
      products: checksum(productRows),
      inventory: checksum(inventoryRows),
      movements: checksum(movementRows),
      variants: checksum(variantRows),
    },
  };
}

let oldSchemaCleanup: (() => void) | null = null;
const fixture = {
  adminId: `${runId}-admin`,
  warehouseId: `${runId}-warehouse`,
  secondLocationId: `${runId}-second-location`,
  brandId: `${runId}-brand`,
  modelId: `${runId}-model`,
  colorId: `${runId}-color`,
  plainProductId: `${runId}-plain-product`,
  phoneCompatProductId: `${runId}-phone-compat-product`,
  variantId: `${runId}-variant`,
};

try {
  await assertDatabaseIsEmpty();

  // -------------------------------------------------------------------
  // Step 1 — build & apply the pre-upgrade schema
  // -------------------------------------------------------------------
  const old = buildOldSchemaDir();
  oldSchemaCleanup = old.cleanup;
  runPrismaMigrateDeploy(old.schemaPath, "old schema (all migrations before the target one)");

  // -------------------------------------------------------------------
  // Step 2 — seed realistic legacy data via raw SQL (the pre-upgrade
  // `products`/`inventory_items`/`stock_movements` tables do not have the
  // new columns yet, so this deliberately never references them).
  // -------------------------------------------------------------------
  await check("seed legacy fixture against the pre-upgrade schema", async () => {
    await prisma.$executeRawUnsafe(
      `INSERT INTO users (id, role, name, email, "isActive", "createdAt", "updatedAt") VALUES ($1,$2,$3,$4,true,now(),now())`,
      fixture.adminId, ROLES.ADMIN, `${runId}-admin`, `${runId}-admin@example.invalid`,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO stock_locations (id, type, name, "isDefault", "createdAt", "updatedAt") VALUES ($1,$2,$3,true,now(),now())`,
      fixture.warehouseId, STOCK_LOCATION_TYPES.WAREHOUSE, `${runId}-warehouse`,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO stock_locations (id, type, name, "isDefault", "createdAt", "updatedAt") VALUES ($1,$2,$3,false,now(),now())`,
      fixture.secondLocationId, STOCK_LOCATION_TYPES.WAREHOUSE, `${runId}-second-warehouse`,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO phone_brands (id, name, slug, "isActive", "sortOrder", "createdAt", "updatedAt") VALUES ($1,$2,$3,true,0,now(),now())`,
      fixture.brandId, `${runId}-Apple`, `${runId}-apple`,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO phone_models (id, "phoneBrandId", name, slug, "isActive", "sortOrder", "createdAt", "updatedAt") VALUES ($1,$2,$3,$4,true,0,now(),now())`,
      fixture.modelId, fixture.brandId, `${runId}-iPhone-Legacy`, `${runId}-iphone-legacy`,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO colors (id, name, "isActive", "createdAt", "updatedAt") VALUES ($1,$2,true,now(),now())`,
      fixture.colorId, `${runId}-Black`,
    );

    // Product A — plain/ordinary product, no variants.
    await prisma.$executeRawUnsafe(
      `INSERT INTO products (id, sku, name, "retailPriceCents", "wholesalePriceCents", "isActive", "isFeatured", "variantMode", "variantAllocationStatus", "createdAt", "updatedAt")
       VALUES ($1,$2,$3,1000,800,true,false,'NONE','NOT_REQUIRED',now(),now())`,
      fixture.plainProductId, `${runId}-PLAIN`, `${runId}-plain-product`,
    );
    // Product B — legacy PHONE_COMPATIBILITY product with one variant.
    await prisma.$executeRawUnsafe(
      `INSERT INTO products (id, sku, name, "retailPriceCents", "wholesalePriceCents", "isActive", "isFeatured", "variantMode", "variantAllocationStatus", "createdAt", "updatedAt")
       VALUES ($1,$2,$3,2000,1500,true,false,'PHONE_COMPATIBILITY','READY',now(),now())`,
      fixture.phoneCompatProductId, `${runId}-PHONECOMPAT`, `${runId}-phone-compat-product`,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO product_color_options (id, "productId", "colorId", "sortOrder", "createdAt") VALUES ($1,$2,$3,0,now())`,
      `${runId}-color-option`, fixture.phoneCompatProductId, fixture.colorId,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO product_variants (id, "productId", "phoneModelId", "isActive", "sortOrder", "createdAt", "updatedAt") VALUES ($1,$2,$3,true,0,now(),now())`,
      fixture.variantId, fixture.phoneCompatProductId, fixture.modelId,
    );

    // InventoryItem — plain (Product A) and variant-linked (Product B, at
    // BOTH locations — "more than one StockLocation" against a variant).
    await prisma.$executeRawUnsafe(
      `INSERT INTO inventory_items (id, "productId", "locationId", "variantId", quantity, "updatedAt") VALUES ($1,$2,$3,NULL,25,now())`,
      `${runId}-inv-plain`, fixture.plainProductId, fixture.warehouseId,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO inventory_items (id, "productId", "locationId", "variantId", quantity, "updatedAt") VALUES ($1,$2,$3,$4,10,now())`,
      `${runId}-inv-variant-wh`, fixture.phoneCompatProductId, fixture.warehouseId, fixture.variantId,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO inventory_items (id, "productId", "locationId", "variantId", quantity, "updatedAt") VALUES ($1,$2,$3,$4,4,now())`,
      `${runId}-inv-variant-2nd`, fixture.phoneCompatProductId, fixture.secondLocationId, fixture.variantId,
    );

    // StockMovement — plain and variant-linked ledger entries.
    await prisma.$executeRawUnsafe(
      `INSERT INTO stock_movements (id, type, "productId", "variantId", "toLocationId", quantity, "previousQuantity", "newQuantity", note, "createdById", "createdAt")
       VALUES ($1,'STOCK_IN',$2,NULL,$3,25,0,25,$4,$5,now())`,
      `${runId}-mv-plain`, fixture.plainProductId, fixture.warehouseId, `${runId} legacy opening balance`, fixture.adminId,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO stock_movements (id, type, "productId", "variantId", "toLocationId", quantity, "previousQuantity", "newQuantity", note, "createdById", "createdAt")
       VALUES ($1,'STOCK_IN',$2,$3,$4,10,0,10,$5,$6,now())`,
      `${runId}-mv-variant-wh`, fixture.phoneCompatProductId, fixture.variantId, fixture.warehouseId, `${runId} legacy variant opening balance`, fixture.adminId,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO stock_movements (id, type, "productId", "variantId", "toLocationId", quantity, "previousQuantity", "newQuantity", note, "createdById", "createdAt")
       VALUES ($1,'STOCK_IN',$2,$3,$4,4,0,4,$5,$6,now())`,
      `${runId}-mv-variant-2nd`, fixture.phoneCompatProductId, fixture.variantId, fixture.secondLocationId, `${runId} legacy variant second-location balance`, fixture.adminId,
    );
  });

  const before = await snapshot();
  console.log("[verify-migration-upgrade] before-upgrade snapshot:", { productCount: before.productCount, inventoryCount: before.inventoryCount, inventoryQuantitySum: before.inventoryQuantitySum, movementCount: before.movementCount, variantCount: before.variantCount });

  // -------------------------------------------------------------------
  // Step 3 — apply the new migration the OFFICIAL way: the real,
  // unmodified prisma/schema.prisma and prisma/migrations directory.
  // -------------------------------------------------------------------
  runPrismaMigrateDeploy(REAL_SCHEMA_PATH, "new migration, via the real project schema");

  const after = await snapshot();
  console.log("[verify-migration-upgrade] after-upgrade snapshot:", { productCount: after.productCount, inventoryCount: after.inventoryCount, inventoryQuantitySum: after.inventoryQuantitySum, movementCount: after.movementCount, variantCount: after.variantCount });

  await check("row counts are unchanged across the upgrade", async () => {
    assert(before.productCount === after.productCount, `product count changed: ${before.productCount} -> ${after.productCount}`);
    assert(before.inventoryCount === after.inventoryCount, `inventory_items row count changed: ${before.inventoryCount} -> ${after.inventoryCount}`);
    assert(before.movementCount === after.movementCount, `stock_movements row count changed: ${before.movementCount} -> ${after.movementCount}`);
    assert(before.variantCount === after.variantCount, `product_variants row count changed: ${before.variantCount} -> ${after.variantCount}`);
  });

  await check("total inventory quantity is unchanged across the upgrade", async () => {
    assert(before.inventoryQuantitySum === after.inventoryQuantitySum, `quantity sum changed: ${before.inventoryQuantitySum} -> ${after.inventoryQuantitySum}`);
    assert(after.inventoryQuantitySum === 39, `expected fixture total 39 (25+10+4), got ${after.inventoryQuantitySum}`);
  });

  await check("row content checksums are byte-for-byte unchanged across the upgrade", async () => {
    assert(before.checksum.products === after.checksum.products, "products content changed");
    assert(before.checksum.inventory === after.checksum.inventory, "inventory_items content changed");
    assert(before.checksum.movements === after.checksum.movements, "stock_movements content changed");
    assert(before.checksum.variants === after.checksum.variants, "product_variants content changed");
  });

  await check("every legacy product defaulted to TOTAL_STOCK", async () => {
    const rows = await prisma.$queryRawUnsafe<{ id: string; inventoryTrackingMode: string; variantMode: string }[]>(
      `SELECT id, "inventoryTrackingMode", "variantMode" FROM products WHERE id IN ($1,$2)`,
      fixture.plainProductId, fixture.phoneCompatProductId,
    );
    assert(rows.length === 2, "legacy products missing after upgrade");
    for (const row of rows) {
      assert(row.inventoryTrackingMode === "TOTAL_STOCK", `product ${row.id} inventoryTrackingMode was "${row.inventoryTrackingMode}", expected TOTAL_STOCK`);
    }
    const phoneCompat = rows.find((row) => row.id === fixture.phoneCompatProductId);
    assert(phoneCompat?.variantMode === "PHONE_COMPATIBILITY", "PHONE_COMPATIBILITY product's variantMode changed across the upgrade");
  });

  await check("PHONE_COMPATIBILITY product's inventory machinery still works post-upgrade", async () => {
    // A real functional round-trip through the same library the app uses —
    // not just a field check — against the pre-existing legacy row.
    const key = { productId: fixture.phoneCompatProductId, variantId: fixture.variantId, locationId: fixture.warehouseId };
    await prisma.$transaction(async (tx) => {
      const change = await incrementInventoryUpsert(tx, key, 5);
      await recordStockMovement(tx, { type: STOCK_MOVEMENT_TYPES.ADJUSTMENT, productId: key.productId, variantId: key.variantId, toLocationId: key.locationId, quantity: 5, previousQuantity: change.previousQuantity, newQuantity: change.newQuantity, createdById: fixture.adminId, note: `${runId} post-upgrade increment` });
    });
    const afterIncrement = await prisma.inventoryItem.findFirstOrThrow({ where: { productId: fixture.phoneCompatProductId, variantId: fixture.variantId, locationId: fixture.warehouseId } });
    assert(afterIncrement.quantity === 15, `expected 15 after increment, got ${afterIncrement.quantity}`);

    await prisma.$transaction((tx) => decrementInventoryAtomic(tx, key, 5));
    const restored = await prisma.inventoryItem.findFirstOrThrow({ where: { productId: fixture.phoneCompatProductId, variantId: fixture.variantId, locationId: fixture.warehouseId } });
    assert(restored.quantity === 10, `expected 10 after restoring decrement, got ${restored.quantity}`);
  });

  // -------------------------------------------------------------------
  // Step 4 — the new DEVICE_MODEL_COLOR feature suite, delegated to the
  // dedicated script so its ~15 assertions (including the XOR constraint,
  // tested there against fresh non-colliding rows rather than the legacy
  // fixture's already-occupied location keys) aren't duplicated here. Runs
  // against the SAME now-upgraded database.
  // -------------------------------------------------------------------
  console.log("[verify-migration-upgrade] delegating to verify-inventory-tracking-modes.ts for the DEVICE_MODEL_COLOR feature suite...");
  // Strip this process's own DATABASE_URL/DIRECT_URL (already overridden to
  // the verify URL above) before spawning — otherwise the child's own
  // resolveVerifyDatabaseUrl() would see its target equal to an inherited
  // DATABASE_URL and falsely reject itself as "same as the real database".
  // Real protection against the *actual* configured app database is
  // untouched: the child still independently re-reads .env/.env.local.
  const envWithoutInheritedUrls: NodeJS.ProcessEnv = { ...process.env, INVENTORY_TRACKING_VERIFY_DATABASE_URL: resolved.url };
  delete envWithoutInheritedUrls.DATABASE_URL;
  delete envWithoutInheritedUrls.DIRECT_URL;
  const featureSuite = spawnSync(
    "node", ["--conditions=react-server", "--import", "tsx", resolvePath(PROJECT_ROOT, "prisma", "verify-inventory-tracking-modes.ts")],
    { cwd: PROJECT_ROOT, env: envWithoutInheritedUrls, stdio: "inherit", shell: process.platform === "win32" },
  );
  if (featureSuite.status !== 0) throw new Error("verify-inventory-tracking-modes.ts failed against the upgraded database");

  console.log("\nAll migration upgrade verification checks passed.");
  console.log(
    "[verify-migration-upgrade] Note: this script deliberately does NOT delete its own legacy fixture rows " +
      `(ids prefixed "${runId}") — the whole point is to hand back an upgraded database an operator can still ` +
      "inspect. The entire database is disposable and expected to be dropped manually afterward (see the " +
      "printed cleanup instructions in prisma/MIGRATION_TEST.md); the feature-suite subprocess above cleans up " +
      "its own rows as it always does when run standalone.",
  );
} finally {
  // Only removes the local temp directory built for the old-schema deploy
  // step — never touches the test database itself.
  oldSchemaCleanup?.();
  await prisma.$disconnect();
}
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
