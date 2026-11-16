/**
 * Real-database verification for the "حسب نوع الجهاز" filter on the company
 * inventory overview (/admin/inventory/overview) and the compatibility
 * metadata behind it: ProductPhoneCompatibility ("this accessory fits this
 * phone model"), src/lib/product-phone-compatibility.ts,
 * src/lib/inventory-overview-load.ts, src/lib/inventory-device-filter.ts and
 * src/components/admin/inventory/CompanyInventoryOverview.tsx.
 *
 * Rules under test: compatibility is METADATA ONLY — adding/removing a
 * mapping never changes stock, status, variantMode, tracking mode, variants or
 * movements; the filter only SELECTS products through the new table (never
 * ProductVariant, never names); card quantities stay the existing InventoryItem
 * location-scope totals (no per-model quantity exists).
 *
 * Safety rails via resolveVerifyDatabaseUrl (prisma/verify-guardrails.ts):
 * never runs against a shared/production database.
 *
 * Run with: node --conditions=react-server --import tsx prisma/verify-inventory-device-filter.ts
 * INVENTORY_DEVICE_FILTER_VERIFY_DATABASE_URL must point at a disposable
 * localhost PostgreSQL database whose name contains "verify".
 */

export {};

import { resolveVerifyDatabaseUrl } from "./verify-guardrails";

const resolved = resolveVerifyDatabaseUrl("INVENTORY_DEVICE_FILTER_VERIFY_DATABASE_URL");
console.log(`[verify-inventory-device-filter] target: ${resolved.masked}`);

process.env.DATABASE_URL = resolved.url;
process.env.DIRECT_URL = resolved.url;

async function main() {
  const fs = await import("node:fs");
  const { PrismaClient } = await import("@prisma/client");

  // The page's loader uses the globalThis prisma singleton — install a client
  // that counts every query BEFORE the loader module is imported.
  const queryLog: string[] = [];
  const prisma = new PrismaClient({ log: [{ emit: "event", level: "query" }] });
  (prisma as unknown as { $on: (event: "query", cb: (e: { query: string }) => void) => void }).$on("query", (e) => queryLog.push(e.query));
  (globalThis as unknown as { prisma: unknown }).prisma = prisma;

  const [constants, loader, filterLib, compat] = await Promise.all([
    import("../src/lib/constants"),
    import("../src/lib/inventory-overview-load"),
    import("../src/lib/inventory-device-filter"),
    import("../src/lib/product-phone-compatibility"),
  ]);
  const { STOCK_LOCATION_TYPES, ROLES } = constants;
  const { loadInventoryOverviewPageData } = loader;
  const { filterOverviewProducts, productMatchesDeviceModel, brandIdForModel } = filterLib;
  const { addProductCompatibility, removeProductCompatibility, getCompatibilityBrandOptions, MAX_COMPATIBILITY_PRODUCTS } = compat;
  const runId = `verify-dev-${Date.now()}`;

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
  const read = (path: string) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
  const codeOnly = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const names = (rows: { product: { name: string } }[]) => rows.map((r) => r.product.name.replace(`${runId}-`, ""));
  const pairs = (rows: { product: { name: string }; scopeTotal: number }[]) => rows.map((r) => `${r.product.name.replace(`${runId}-`, "")}=${r.scopeTotal}`).sort();

  // ---------- fixtures ----------
  const warehouse = await prisma.stockLocation.create({ data: { type: STOCK_LOCATION_TYPES.WAREHOUSE, name: `${runId}-wh` } });
  const repUser = await prisma.user.create({ data: { role: ROLES.SALES_REPRESENTATIVE, name: `${runId}-rep`, email: `${runId}-rep@example.invalid`, isActive: true } });
  const rep = await prisma.salesRepresentative.create({ data: { userId: repUser.id, employeeCode: `${runId}-rep` } });
  const car = await prisma.stockLocation.create({ data: { type: STOCK_LOCATION_TYPES.REP_CAR, name: `${runId}-car`, salesRepId: rep.id } });

  const apple = await prisma.phoneBrand.create({ data: { name: `${runId}-Apple`, slug: `${runId}-apple`, sortOrder: 1 } });
  const samsung = await prisma.phoneBrand.create({ data: { name: `${runId}-Samsung`, slug: `${runId}-samsung`, sortOrder: 2 } });
  const deadBrand = await prisma.phoneBrand.create({ data: { name: `${runId}-DeadBrand`, slug: `${runId}-dead`, isActive: false, sortOrder: 3 } });
  const m17 = await prisma.phoneModel.create({ data: { phoneBrandId: apple.id, name: "iPhone 17 Pro Max", slug: `${runId}-17pm`, sortOrder: 1 } });
  const m16 = await prisma.phoneModel.create({ data: { phoneBrandId: apple.id, name: "iPhone 16 Pro Max", slug: `${runId}-16pm`, sortOrder: 2 } });
  const m15 = await prisma.phoneModel.create({ data: { phoneBrandId: apple.id, name: "iPhone 15 Pro Max", slug: `${runId}-15pm`, sortOrder: 3 } });
  const m14 = await prisma.phoneModel.create({ data: { phoneBrandId: apple.id, name: "iPhone 14", slug: `${runId}-14`, sortOrder: 5 } });
  const mRetired = await prisma.phoneModel.create({ data: { phoneBrandId: apple.id, name: "iPhone Retired", slug: `${runId}-old`, isActive: false, sortOrder: 4 } });
  const s24 = await prisma.phoneModel.create({ data: { phoneBrandId: samsung.id, name: "Galaxy S24", slug: `${runId}-s24`, sortOrder: 1 } });
  const mDeadBrand = await prisma.phoneModel.create({ data: { phoneBrandId: deadBrand.id, name: "Ghost", slug: `${runId}-ghost` } });

  const catCases = await prisma.category.create({ data: { name: `${runId}-cases`, nameAr: `${runId}-كفرات`, slug: `${runId}-c1` } });
  const catProtectors = await prisma.category.create({ data: { name: `${runId}-prot`, nameAr: `${runId}-لزقات`, slug: `${runId}-c2` } });
  const catChargers = await prisma.category.create({ data: { name: `${runId}-chg`, nameAr: `${runId}-شواحن`, slug: `${runId}-c3` } });

  let seq = 0;
  async function makeProduct(name: string, categoryId: string, extra: Record<string, unknown> = {}) {
    seq += 1;
    return prisma.product.create({
      data: { sku: `${runId}-${seq}`, name: `${runId}-${name}`, nameAr: `${runId}-${name}`, retailPriceCents: 1000, wholesalePriceCents: 800, isActive: true, categoryId, ...extra },
    });
  }
  /** ONE aggregate balance per location (variantId null) — exactly how the real catalog stores stock. */
  async function stock(productId: string, locationId: string, quantity: number) {
    return prisma.inventoryItem.create({ data: { productId, locationId, quantity } });
  }

  // The business fixture: ONE aggregate balance each, mapped to several models
  const A = await makeProduct("جفر شفاف", catCases.id);
  await stock(A.id, warehouse.id, 100);
  await stock(A.id, car.id, 28); // 128 company-wide
  const B = await makeProduct("جفر ماك سيف", catCases.id);
  await stock(B.id, warehouse.id, 50);
  const C = await makeProduct("لزقة برايفسي", catProtectors.id);
  await stock(C.id, warehouse.id, 281);
  const D = await makeProduct("عدسات كاميرا", catProtectors.id);
  await stock(D.id, warehouse.id, 25);
  const E = await makeProduct("شاحن عادي", catChargers.id); // generic charger: no mapping at all
  await stock(E.id, warehouse.id, 100);
  // extras
  const H = await makeProduct("كفر آيفون 15 فقط", catCases.id); // fits ONLY the 15 Pro Max
  await stock(H.id, warehouse.id, 50);
  const zeroStock = await makeProduct("كفر بدون مخزون", catCases.id); // fits 17 Pro Max but has no stock anywhere
  // a product on the OLD variant system with a ProductVariant for the 17 Pro Max but NO compatibility row:
  // ProductVariant is NOT the source of this filter, so it must not appear
  const F = await makeProduct("منتج بنظام الموديلات القديم", catCases.id, { variantMode: "PHONE_COMPATIBILITY", variantAllocationStatus: "READY" });
  const fVariant = await prisma.productVariant.create({ data: { productId: F.id, phoneModelId: m17.id, isActive: true } });
  await prisma.inventoryItem.create({ data: { productId: F.id, locationId: warehouse.id, quantity: 9, variantId: fVariant.id } });
  // a product whose NAME says "17 Pro Max" but has no mapping: names are never a source
  const nameOnly = await makeProduct("كفر iPhone 17 Pro Max بالاسم فقط", catCases.id);
  await stock(nameOnly.id, warehouse.id, 6);
  // a DEVICE_MODEL_COLOR product (stock split per model+color combination): must behave exactly as before
  const color = await prisma.color.create({ data: { name: `${runId}-black`, nameAr: `${runId}-أسود` } });
  const dmc = await makeProduct("منتج الجهاز واللون", catCases.id, { inventoryTrackingMode: "DEVICE_MODEL_COLOR" });
  const dmcCombo = await prisma.deviceColorVariant.create({ data: { productId: dmc.id, phoneModelId: m14.id, colorId: color.id } });
  await prisma.inventoryItem.create({ data: { productId: dmc.id, locationId: warehouse.id, quantity: 4, deviceColorVariantId: dmcCombo.id } });

  const companyIds = [warehouse.id, car.id];
  const base: { scopeLocationIds: string[]; deviceModelId: string; categoryId: string; search: string; showZeroStock: boolean; sort: "name" | "highest" | "lowest" } = {
    scopeLocationIds: companyIds,
    deviceModelId: "",
    categoryId: "",
    search: "",
    showZeroStock: false,
    sort: "name",
  };
  const fixtureProducts = <T extends { product: { name: string } }>(all: T[]): T[] => all.filter((r) => r.product.name.startsWith(runId));

  // ---------- snapshots for the stock regression ----------
  async function snapshot() {
    const [items, products, movements, variants, colorVariants, batches, orders, images, transferBatches, payments, customerOrders, repCarDimensionalRows] = await Promise.all([
      prisma.inventoryItem.findMany({ orderBy: { id: "asc" }, select: { id: true, productId: true, locationId: true, variantId: true, deviceColorVariantId: true, quantity: true, updatedAt: true } }),
      prisma.product.findMany({
        orderBy: { id: "asc" },
        select: { id: true, sku: true, name: true, nameAr: true, isActive: true, isFeatured: true, isStorefrontVisible: true, variantMode: true, variantAllocationStatus: true, inventoryTrackingMode: true, categoryId: true, brandId: true, retailPriceCents: true, wholesalePriceCents: true, costCents: true, updatedAt: true },
      }),
      prisma.stockMovement.count(),
      prisma.productVariant.findMany({ orderBy: { id: "asc" }, select: { id: true, productId: true, phoneModelId: true, isActive: true, updatedAt: true } }),
      prisma.deviceColorVariant.count(),
      prisma.productVariantAllocationBatch.count(),
      prisma.order.count(),
      prisma.productImage.count(),
      prisma.repStockTransferBatch.count(),
      prisma.accountPayment.count(),
      prisma.repCustomerOrder.count(),
      // no dimensional (per-model / per-color) REP_CAR row may ever appear: car stock stays aggregate product-level
      prisma.inventoryItem.count({ where: { location: { type: "REP_CAR" }, OR: [{ variantId: { not: null } }, { deviceColorVariantId: { not: null } }] } }),
    ]);
    return JSON.stringify({ items, products, movements, variants, colorVariants, batches, orders, images, transferBatches, payments, customerOrders, repCarDimensionalRows });
  }
  // scoped to THIS run's products so a re-run on the same disposable DB is safe
  const compatRows = () => prisma.productPhoneCompatibility.count({ where: { product: { sku: { startsWith: runId } } } });

  const stockBefore = await snapshot();
  assert((await compatRows()) === 0, "no compatibility rows before the mapping");
  // the whole overview dataset BEFORE any mapping, to prove below that mapping changes nothing but compatibleModelIds
  const dataBefore = await loadInventoryOverviewPageData();

  // ---------- map exactly like the admin screens do (through the real library) ----------
  const map = async (productIds: string[], modelIds: string[]) => {
    const result = await addProductCompatibility({ productIds, phoneModelIds: modelIds });
    assert(result.ok, `mapping failed: ${JSON.stringify(result)}`);
    return result.changed;
  };
  assert((await map([A.id], [m17.id, m16.id])) === 2, "A → 17 + 16");
  assert((await map([B.id], [m17.id])) === 1, "B → 17");
  assert((await map([C.id], [m17.id, m16.id, m15.id])) === 3, "C → 17 + 16 + 15");
  assert((await map([D.id], [m17.id])) === 1, "D → 17");
  assert((await map([H.id], [m15.id])) === 1, "H → 15");
  assert((await map([zeroStock.id], [m17.id])) === 1, "zero-stock → 17");
  // an OLD-style variant product and a DEVICE_MODEL_COLOR product may be mapped too — it must change nothing for either
  assert((await map([F.id, dmc.id], [m14.id])) === 2, "old variant product + DEVICE_MODEL_COLOR product → 14");
  const stockAfter = await snapshot();

  queryLog.length = 0;
  const data = await loadInventoryOverviewPageData();
  const loadQueryCount = queryLog.length;
  const overview = data.products;
  const run = (options: Partial<typeof base>) => fixtureProducts(filterOverviewProducts(overview, { ...base, ...options }));

  // ---------- A. the business scenario ----------
  await check("A. iPhone 17 Pro Max: A=128, B=50, C=281, D=25 — and NOT the charger, the iPhone-15-only case, the variant-only product or the name-only product", async () => {
    const rows = run({ deviceModelId: m17.id });
    assert(JSON.stringify(pairs(rows)) === JSON.stringify(["جفر شفاف=128", "جفر ماك سيف=50", "لزقة برايفسي=281", "عدسات كاميرا=25"].sort()), `unexpected result: ${pairs(rows).join(" | ")}`);
    const hidden = names(rows);
    for (const absent of ["شاحن عادي", "كفر آيفون 15 فقط", "منتج بنظام الموديلات القديم", "كفر iPhone 17 Pro Max بالاسم فقط", "كفر بدون مخزون"]) {
      assert(!hidden.includes(absent), `${absent} must not be listed for iPhone 17 Pro Max`);
    }
  });

  await check("B. other models: 16 Pro Max → A, C; 15 Pro Max → C, H; a model with no mapping → nothing", async () => {
    assert(JSON.stringify(pairs(run({ deviceModelId: m16.id }))) === JSON.stringify(["جفر شفاف=128", "لزقة برايفسي=281"].sort()), "16 Pro Max");
    assert(JSON.stringify(pairs(run({ deviceModelId: m15.id }))) === JSON.stringify(["لزقة برايفسي=281", "كفر آيفون 15 فقط=50"].sort()), "15 Pro Max");
    assert(run({ deviceModelId: s24.id }).length === 0, "Galaxy S24 has no mapped product");
    assert(run({ deviceModelId: "does-not-exist" }).length === 0, "an unknown id selects nothing rather than throwing");
    assert(!productMatchesDeviceModel(overview.find((p) => p.id === A.id)!, ""), "no model id → no match");
  });

  await check("C. quantity is the existing canonical figure: ONE aggregate balance per product — never divided between models, no per-model number anywhere", async () => {
    const unfiltered = new Map(fixtureProducts(filterOverviewProducts(overview, { ...base, showZeroStock: true })).map((r) => [r.product.id, r.scopeTotal]));
    for (const model of [m17, m16, m15]) {
      for (const row of run({ deviceModelId: model.id })) assert(unfiltered.get(row.product.id) === row.scopeTotal, `${row.product.name}: filtered quantity differs from the overview quantity`);
    }
    assert(unfiltered.get(A.id) === 128 && unfiltered.get(C.id) === 281, "A and C keep their full balance however many models they fit");
    for (const file of ["../src/lib/inventory-device-filter.ts", "../src/components/admin/inventory/CompanyInventoryOverview.tsx", "../src/lib/inventory-overview-load.ts"]) {
      const source = codeOnly(read(file));
      assert(!source.includes("deviceModelQuantity") && !source.includes("DeviceModelLine") && !source.includes("لهذا الجهاز"), `${file} still has the per-model quantity ("لهذا الجهاز")`);
      assert(!/\.stock\b|product\.stock/.test(source.replace(/stockMovement|inventoryItem|StockLocation/gi, "")), `${file} reads Product.stock`);
    }
  });

  await check("D. the location filter still decides the quantity: warehouse 100, rep car 28, company 128 — and a product with 0 in the chosen scope is hidden", async () => {
    assert(pairs(run({ deviceModelId: m17.id, scopeLocationIds: [warehouse.id] })).includes("جفر شفاف=100"), "warehouse scope");
    assert(JSON.stringify(pairs(run({ deviceModelId: m17.id, scopeLocationIds: [car.id] }))) === JSON.stringify(["جفر شفاف=28"]), "rep car scope shows only A, with its car balance");
    assert(run({ deviceModelId: m17.id, scopeLocationIds: [] }).length === 0, "an unselected rep (empty scope) shows nothing, as before");
    const carZero = run({ deviceModelId: m17.id, scopeLocationIds: [car.id], showZeroStock: true });
    assert(carZero.length === 5 && carZero.every((r) => r.scopeTotal === (r.product.name.endsWith("جفر شفاف") ? 28 : 0)), "show-zero lists every mapped product with its car quantity");
  });

  await check("E. category + device combine: cases only / protectors only / all categories; search narrows inside the device (name text is never a source)", async () => {
    assert(JSON.stringify(names(run({ deviceModelId: m17.id, categoryId: catCases.id }))) === JSON.stringify(["جفر شفاف", "جفر ماك سيف"]), "cases only");
    assert(JSON.stringify(names(run({ deviceModelId: m17.id, categoryId: catProtectors.id }))) === JSON.stringify(["عدسات كاميرا", "لزقة برايفسي"].sort((a, b) => a.localeCompare(b))), "protectors only");
    assert(run({ deviceModelId: m17.id, categoryId: catChargers.id }).length === 0, "no mapped charger");
    assert(JSON.stringify(names(run({ deviceModelId: m17.id, search: "ماك" }))) === JSON.stringify(["جفر ماك سيف"]), "search inside the device");
    assert(run({ deviceModelId: m17.id, search: "17 Pro Max" }).length === 0, "typing the model name matches no mapped product name");
    assert(names(run({ search: "17 Pro Max" })).includes("كفر iPhone 17 Pro Max بالاسم فقط"), "without the device filter that same search still finds by name, as before");
    assert(run({ deviceModelId: m17.id, search: A.sku }).length === 1, "SKU search works inside the device filter");
  });

  await check("F. zero-stock checkbox behaves exactly as today (device ON or OFF)", async () => {
    assert(!names(run({ deviceModelId: m17.id })).includes("كفر بدون مخزون"), "hidden by default");
    const shown = run({ deviceModelId: m17.id, showZeroStock: true });
    assert(names(shown).includes("كفر بدون مخزون") && shown.find((r) => r.product.name.endsWith("كفر بدون مخزون"))!.scopeTotal === 0, "shown with quantity 0 when ON");
  });

  let regressionCombos = 0;
  await check("G. device filter OFF = the pre-feature behaviour, identical to the old inline pipeline for every location × category × search × zero-stock × sort combination", async () => {
    function legacy(opts: typeof base) {
      const q = opts.search.trim().toLowerCase();
      let rows = overview.map((product) => ({ product, scopeTotal: opts.scopeLocationIds.reduce((s, id) => s + (product.byLocation[id] ?? 0), 0) }));
      rows = rows.filter(({ product }) => {
        if (opts.categoryId && product.categoryId !== opts.categoryId) return false;
        if (q && !`${product.name} ${product.nameAr ?? ""} ${product.sku}`.toLowerCase().includes(q)) return false;
        return true;
      });
      if (!opts.showZeroStock) rows = rows.filter(({ scopeTotal }) => scopeTotal > 0);
      rows.sort((a, b) => (opts.sort === "highest" ? b.scopeTotal - a.scopeTotal : opts.sort === "lowest" ? a.scopeTotal - b.scopeTotal : (a.product.nameAr ?? a.product.name).localeCompare(b.product.nameAr ?? b.product.name)));
      return rows.map((r) => `${r.product.id}:${r.scopeTotal}`);
    }
    for (const scopeLocationIds of [companyIds, [warehouse.id], [car.id], []]) {
      for (const categoryId of ["", catCases.id, catProtectors.id]) {
        for (const search of ["", "كفر", "100"]) {
          for (const showZeroStock of [false, true]) {
            for (const sort of ["name", "highest", "lowest"] as const) {
              const options = { scopeLocationIds, deviceModelId: "", categoryId, search, showZeroStock, sort };
              const got = filterOverviewProducts(overview, options).map((r) => `${r.product.id}:${r.scopeTotal}`);
              assert(JSON.stringify(got) === JSON.stringify(legacy(options)), `device filter OFF differs from the old behaviour for ${JSON.stringify({ categoryId, search, showZeroStock, sort })}`);
              regressionCombos += 1;
            }
          }
        }
      }
    }
    assert(names(run({})).includes("شاحن عادي") && names(run({})).includes("كفر آيفون 15 فقط"), "with no device selected every normal product is back");
    console.log(`     (${regressionCombos} combinations compared)`);
  });

  await check("H. STOCK REGRESSION: adding mappings changed NOTHING but the compatibility table (inventory, REP_CAR, status, variantMode, tracking mode, variants, movements, orders)", async () => {
    assert(stockBefore === stockAfter, "inventory/product/variant/movement state changed when compatibility was added");
    assert((await compatRows()) === 11, `11 mappings were created (A2 + B1 + C3 + D1 + H1 + zero-stock 1 + variant-product 1 + DEVICE_MODEL_COLOR 1), got ${await compatRows()}`);
  });

  await check("I. compatibility library: idempotent, validated all-or-nothing, removal is metadata only, DB uniqueness, cascades", async () => {
    const rowsBefore = await compatRows();
    // idempotent: the same mapping again changes nothing and is not an error
    assert((await map([A.id], [m17.id, m16.id])) === 0 && (await compatRows()) === rowsBefore, "re-adding existing pairs creates nothing");
    // DB-level uniqueness (the real backstop)
    let duplicateRejected = false;
    try {
      await prisma.productPhoneCompatibility.create({ data: { productId: A.id, phoneModelId: m17.id } });
    } catch (error) {
      duplicateRejected = (error as { code?: string }).code === "P2002";
    }
    assert(duplicateRejected, "the unique (productId, phoneModelId) constraint rejects a duplicate");
    // validation is all-or-nothing
    const bad = [
      { productIds: [], phoneModelIds: [m17.id] },
      { productIds: [E.id], phoneModelIds: [] },
      { productIds: [E.id, "no-such-product"], phoneModelIds: [m17.id] },
      { productIds: [E.id], phoneModelIds: [m17.id, "no-such-model"] },
      { productIds: [E.id], phoneModelIds: [m17.id, mRetired.id] },
      { productIds: [E.id], phoneModelIds: [mDeadBrand.id] },
      { productIds: Array.from({ length: MAX_COMPATIBILITY_PRODUCTS + 1 }, (_, i) => `p${i}`), phoneModelIds: [m17.id] },
    ];
    for (const input of bad) {
      const result = await addProductCompatibility(input);
      assert(!result.ok, `invalid input accepted: ${JSON.stringify(input).slice(0, 80)}`);
    }
    assert((await compatRows()) === rowsBefore, "no partial writes after rejected inputs (the valid half of a mixed request is NOT applied)");
    // multi-product, multi-model bulk
    assert((await map([E.id, D.id], [s24.id, m15.id])) === 4, "bulk: 2 products × 2 models");
    // removal: only the pair, only metadata
    const pre = await snapshot();
    const removed = await removeProductCompatibility({ productIds: [E.id, D.id], phoneModelIds: [s24.id, m15.id] });
    assert(removed.ok && removed.changed === 4, "bulk removal deletes exactly those pairs");
    const again = await removeProductCompatibility({ productIds: [E.id], phoneModelIds: [s24.id] });
    assert(again.ok && again.changed === 0, "removing a pair that does not exist is a no-op");
    assert((await snapshot()) === pre, "removal changed nothing outside the compatibility table");
    assert((await compatRows()) === rowsBefore, "back to the original mapping");
    // cascade: the row carries no history, so deleting either side removes it (throwaway rows only)
    const throwaway = await makeProduct("مؤقت", catCases.id);
    const throwawayModel = await prisma.phoneModel.create({ data: { phoneBrandId: samsung.id, name: "Temp", slug: `${runId}-tmp` } });
    await map([throwaway.id], [throwawayModel.id]);
    await prisma.productPhoneCompatibility.create({ data: { productId: A.id, phoneModelId: throwawayModel.id } });
    await prisma.phoneModel.delete({ where: { id: throwawayModel.id } });
    assert((await prisma.productPhoneCompatibility.count({ where: { phoneModelId: throwawayModel.id } })) === 0, "deleting a phone model removes its mappings");
    const throwaway2 = await makeProduct("مؤقت2", catCases.id);
    await map([throwaway2.id], [m16.id]);
    await prisma.product.delete({ where: { id: throwaway2.id } });
    assert((await prisma.productPhoneCompatibility.count({ where: { productId: throwaway2.id } })) === 0, "deleting a product removes its mappings");
    await prisma.product.delete({ where: { id: throwaway.id } });
  });

  await check("J. independent from ProductVariant: variant-only products never match; a variant product keeps working exactly as before; mapping never creates one", async () => {
    const f = overview.find((p) => p.id === F.id)!;
    assert(f.displayMode === "PHONE_COMPATIBILITY" && f.dimensionGroups.some((g) => g.modelId === m17.id && g.total === 9) && JSON.stringify(f.compatibleModelIds) === JSON.stringify([m14.id]), "the variant product still has its per-model stock groups (old system untouched); its only mapping is the explicit one to the 14");
    assert(!productMatchesDeviceModel(f, m17.id), "…its ProductVariant for the 17 Pro Max does NOT make it match the device filter");
    assert(productMatchesDeviceModel(f, m14.id), "…while its explicit mapping to the 14 does");
    assert((await prisma.productVariant.count({ where: { product: { sku: { startsWith: runId } } } })) === 1 && (await prisma.productVariantAllocationBatch.count({ where: { product: { sku: { startsWith: runId } } } })) === 0, "no ProductVariant / allocation batch was created by any mapping");
    const aRow = await prisma.product.findUniqueOrThrow({ where: { id: A.id }, select: { variantMode: true, variantAllocationStatus: true, inventoryTrackingMode: true } });
    assert(aRow.variantMode === "NONE" && aRow.variantAllocationStatus === "NOT_REQUIRED" && aRow.inventoryTrackingMode === "TOTAL_STOCK", `a mapped product keeps NONE / NOT_REQUIRED / TOTAL_STOCK (got ${JSON.stringify(aRow)})`);
    const source = codeOnly(read("../src/lib/product-phone-compatibility.ts"));
    for (const forbidden of ["inventoryItem", "stockMovement", "productVariant", "deviceColorVariant", "variantMode", "variantAllocationStatus", "inventoryTrackingMode", "$transaction", ".stock"]) {
      assert(!source.includes(forbidden), `the compatibility library must not touch "${forbidden}"`);
    }
  });

  await check("K. selector data = active brands → active models (retired model, inactive brand excluded); stale ids degrade to 'all'", async () => {
    const ours = data.deviceBrands.filter((b) => b.label.startsWith(runId));
    assert(JSON.stringify(ours.map((b) => b.label.replace(`${runId}-`, ""))) === JSON.stringify(["Apple", "Samsung"]), `brands: ${ours.map((b) => b.label).join(",")}`);
    assert(JSON.stringify(ours[0]!.models.map((m) => m.label)) === JSON.stringify(["iPhone 17 Pro Max", "iPhone 16 Pro Max", "iPhone 15 Pro Max", "iPhone 14"]), "Apple models in sortOrder, retired excluded");
    const pickerBrands = (await getCompatibilityBrandOptions()).filter((b) => b.label.startsWith(runId));
    assert(JSON.stringify(pickerBrands.map((b) => b.models.map((m) => m.id))) === JSON.stringify(ours.map((b) => b.models.map((m) => m.id))), "the admin pickers and the overview filter offer the same brand → model lists");
    assert(brandIdForModel(data.deviceBrands, m17.id) === apple.id && brandIdForModel(data.deviceBrands, mRetired.id) === "" && brandIdForModel(data.deviceBrands, "nope") === "", "brand lookup / stale ids");
  });

  await check("L. no N+1: a fixed number of bounded queries, independent of products / mappings; filtering is pure in-memory", async () => {
    assert(loadQueryCount <= 18, `loader issued ${loadQueryCount} queries`);
    for (let i = 0; i < 25; i++) {
      const p = await makeProduct(`إضافي ${i}`, catCases.id);
      await stock(p.id, warehouse.id, 1);
      await map([p.id], [m17.id, i % 2 ? m16.id : m15.id]);
    }
    queryLog.length = 0;
    const bigger = await loadInventoryOverviewPageData();
    assert(queryLog.length === loadQueryCount, `query count changed with data size: ${loadQueryCount} → ${queryLog.length}`);
    queryLog.length = 0;
    filterOverviewProducts(bigger.products, { ...base, deviceModelId: m17.id });
    assert(queryLog.length === 0, "filtering performs zero queries");
  });

  await check("M. READ-ONLY overview: loading + filtering changes nothing; the overview files contain no write / server action", async () => {
    const mid = await snapshot();
    const midCompat = await compatRows();
    for (const modelId of [m17.id, m16.id, s24.id, ""]) filterOverviewProducts((await loadInventoryOverviewPageData()).products, { ...base, deviceModelId: modelId });
    assert((await snapshot()) === mid && (await compatRows()) === midCompat, "database state changed during read-only calls");
    for (const file of ["../src/lib/inventory-device-filter.ts", "../src/lib/inventory-overview-load.ts", "../src/components/admin/inventory/CompanyInventoryOverview.tsx", "../src/app/admin/inventory/overview/page.tsx"]) {
      // URL query-string edits (searchParams.set/delete) are not database writes
      const source = codeOnly(read(file)).replace(/searchParams\.(set|delete)\(/g, "urlParams(");
      assert(!/\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(|\$transaction|\$executeRaw|\$queryRaw|"use server"|useFormState|action=\{/.test(source), `${file} contains a write / server action`);
    }
  });

  await check("N. authorization: overview stays ADMIN + ADMIN_ASSISTANT; ALL compatibility editing is ADMIN-only (nothing widened)", async () => {
    const page = codeOnly(read("../src/app/admin/inventory/overview/page.tsx"));
    const guard = page.match(/requireRole\(\[([^\]]*)\]\)/);
    assert(guard && guard[1]!.replace(/\s/g, "") === "ROLES.ADMIN,ROLES.ADMIN_ASSISTANT", `overview guard is ${guard?.[1]}`);
    const layout = codeOnly(read("../src/app/admin/products/layout.tsx"));
    assert(/requireRole\(\[ROLES\.ADMIN\]\)/.test(layout), "/admin/products/** (incl. /admin/products/compatibility and the edit page) is ADMIN-only");
    const actions = codeOnly(read("../src/app/admin/products/compatibility/actions.ts"));
    assert(/requireRole\(\[ROLES\.ADMIN\]\)/.test(actions) && !actions.includes("ADMIN_ASSISTANT") && actions.indexOf("requireRole") < actions.indexOf("change({"), "both actions call requireRole([ADMIN]) before any write");
    for (const file of ["../src/app/admin/products/compatibility/page.tsx", "../src/components/admin/products/BulkCompatibilityManager.tsx", "../src/components/admin/products/ProductCompatibilityManager.tsx", "../src/lib/product-phone-compatibility.ts"]) {
      assert(!codeOnly(read(file)).includes("ADMIN_ASSISTANT"), `${file} must not mention ADMIN_ASSISTANT`);
    }
    assert(read("../src/app/admin/products/[id]/edit/page.tsx").includes("ProductCompatibilityManager") && read("../src/app/admin/products/page.tsx").includes("/admin/products/compatibility"), "per-product section + link to the bulk page are wired");
  });

  await check("O. the real component renders: cards with the unchanged 'المتوفر', NO 'لهذا الجهاز', selectors, empty state; an unknown id degrades to all products", async () => {
    // react-dom/server cannot load under --conditions=react-server, so a plain Node child renders the real component.
    const { execFileSync } = await import("node:child_process");
    const os = await import("node:os");
    const path = await import("node:path");
    const dataFile = path.join(os.tmpdir(), `${runId}-overview.json`);
    fs.writeFileSync(dataFile, JSON.stringify(data));
    const stdout = execFileSync(process.execPath, ["--import", "tsx", "prisma/verify-inventory-device-filter-render.ts", dataFile, m17.id, s24.id], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    fs.rmSync(dataFile, { force: true });
    const rendered = JSON.parse(stdout.trim().split("\n").pop()!) as { on: string; off: string; empty: string; noBrands: string };
    for (const text of ["حسب نوع الجهاز", "كل الأصناف", "الماركة", "نوع الجهاز", "مسح فلتر الجهاز", `${runId}-جفر شفاف`, "المتوفر: 128 قطعة", `${runId}-جفر ماك سيف`, "المتوفر: 50 قطعة", "المتوفر: 281 قطعة", "المتوفر: 25 قطعة"]) assert(rendered.on.includes(text), `device ON markup lacks "${text}"`);
    for (const text of [`${runId}-شاحن عادي`, `${runId}-كفر آيفون 15 فقط`]) assert(!rendered.on.includes(text), `device ON markup must not list "${text}"`);
    assert(!rendered.on.includes("لهذا الجهاز") && !rendered.on.includes("غير موزّعة"), "no per-model quantity line is rendered");
    assert(rendered.off.includes(`${runId}-شاحن عادي`) && !rendered.off.includes("مسح فلتر الجهاز"), "device OFF renders the normal grid");
    assert(rendered.empty.includes("لا توجد أصناف متوافقة مع هذا الجهاز ضمن الفلاتر الحالية."), "empty message");
    assert(!rendered.noBrands.includes("حسب نوع الجهاز"), "no phone brands defined → no device control");
  });

  await check("Q. NO-REGRESSION: after mapping, every overview product is identical (quantities, byLocation, dimension groups, display mode) — normal, old-variant and DEVICE_MODEL_COLOR products alike; ONLY compatibleModelIds differs", async () => {
    const strip = (product: unknown) => {
      const { compatibleModelIds, ...rest } = product as { compatibleModelIds: string[] } & Record<string, unknown>;
      void compatibleModelIds;
      return JSON.stringify(rest);
    };
    const before = new Map(dataBefore.products.map((product) => [product.id, strip(product)]));
    let compared = 0;
    let mapped = 0;
    for (const product of overview) {
      if (!product.name.startsWith(runId)) continue; // this run's fixture only (a re-run leaves other runs' rows behind)
      if (!before.has(product.id)) continue; // products created later by the N+1 check
      assert(before.get(product.id) === strip(product), `${product.name}: overview data changed after mapping`);
      compared += 1;
      if (product.compatibleModelIds.length > 0) mapped += 1;
    }
    // fixture: A B C D E H zero-stock F(old variants) nameOnly dmc = 10 products, 8 of them mapped
    assert(compared === 10 && mapped === 8, `compared ${compared} products (expected 10), ${mapped} with mappings (expected 8)`);
    assert(JSON.stringify(dataBefore.locations) === JSON.stringify(data.locations) && JSON.stringify(dataBefore.categories) === JSON.stringify(data.categories), "locations / categories unchanged");
    const dmcProduct = overview.find((product) => product.id === dmc.id)!;
    assert(dmcProduct.displayMode === "DEVICE_MODEL_COLOR" && dmcProduct.total === 4 && dmcProduct.dimensionGroups.some((group) => group.colorId === color.id && group.total === 4), "DEVICE_MODEL_COLOR product: model+color stock group intact (4)");
    const variantProduct = overview.find((product) => product.id === F.id)!;
    assert(variantProduct.displayMode === "PHONE_COMPATIBILITY" && variantProduct.total === 9, "old ProductVariant product: per-model stock intact (9)");
    const stockAfterQ = await snapshot();
    assert(stockAfterQ !== undefined, "snapshot readable");
  });

  await check("R. ISOLATION: the compatibility table is referenced ONLY by its own feature files — no sales, order, stock, rep, transfer, variant or DEVICE_MODEL_COLOR code reads it; the overview's original queries are untouched", async () => {
    const root = new URL("../src/", import.meta.url);
    const found: string[] = [];
    const walk = (dir: URL) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const child = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, dir);
        if (entry.isDirectory()) walk(child);
        else if (/\.(ts|tsx)$/.test(entry.name) && /ProductPhoneCompatibility|phoneCompatibilities|compatibleProducts|product-phone-compatibility|productPhoneCompatibility|compatibleModelIds/.test(fs.readFileSync(child, "utf8"))) found.push(child.pathname.split("/src/")[1]!);
      }
    };
    walk(root);
    const allowed = [
      "app/admin/products/[id]/edit/page.tsx",
      "app/admin/products/compatibility/actions.ts",
      "app/admin/products/compatibility/page.tsx",
      "components/admin/inventory/CompanyInventoryOverview.tsx",
      "components/admin/products/BulkCompatibilityManager.tsx",
      "components/admin/products/CompatibilityModelPicker.tsx",
      "components/admin/products/ProductCompatibilityManager.tsx",
      "lib/compatibility-limits.ts",
      "lib/inventory-device-filter.ts",
      "lib/inventory-overview-load.ts",
      "lib/inventory-overview.ts",
      "lib/product-phone-compatibility.ts",
    ].sort();
    const decoded = found.map((path) => decodeURIComponent(path)).sort();
    assert(JSON.stringify(decoded) === JSON.stringify(allowed), `unexpected files reference the compatibility table:\n  found:   ${decoded.join(", ")}\n  allowed: ${allowed.join(", ")}`);
    const loaderSource = read("../src/lib/inventory-overview-load.ts");
    const productsStart = loaderSource.indexOf("prisma.product.findMany");
    const productsQuery = loaderSource.slice(productsStart, loaderSource.indexOf('orderBy: { name: "asc" },\n    }),', productsStart));
    assert(productsQuery.length > 200 && !productsQuery.includes("phoneCompat"), "the overview's products query has no compatibility select (compat is its own isolated query)");
    const editSource = read("../src/app/admin/products/[id]/edit/page.tsx");
    const editQuery = editSource.slice(editSource.indexOf("prisma.product.findUnique"), editSource.indexOf("if (!product) notFound()"));
    assert(editQuery.length > 100 && !editQuery.includes("ompatib"), "the product edit page's original query is untouched");
  });

  await check("S. FAIL-SOFT: code deployed before the migration degrades to 'no mappings' (overview / edit page keep working); real errors still propagate", async () => {
    const { Prisma } = await import("@prisma/client");
    const { isMissingCompatibilityTableError } = compat;
    const known = (code: string) => new Prisma.PrismaClientKnownRequestError("x", { code, clientVersion: "test" });
    assert(isMissingCompatibilityTableError(known("P2021")) && isMissingCompatibilityTableError(known("P2022")), "missing table / column are recognised");
    assert(!isMissingCompatibilityTableError(known("P2002")) && !isMissingCompatibilityTableError(new Error("boom")) && !isMissingCompatibilityTableError(null), "any other error is NOT swallowed");
    const helperSource = codeOnly(read("../src/lib/product-phone-compatibility.ts"));
    assert(/getCompatibleModelIdsByProduct[\s\S]*?catch \(error\) \{\s*if \(isMissingCompatibilityTableError\(error\)\) return new Map\(\);\s*throw error;/.test(helperSource), "the overview read returns an empty map ONLY for a missing table and rethrows everything else");
    assert(/getProductCompatibilityLinks[\s\S]*?catch \(error\) \{\s*if \(isMissingCompatibilityTableError\(error\)\) return null;\s*throw error;/.test(helperSource), "the edit-page read returns null ONLY for a missing table and rethrows everything else");
  });

  await check("P. migration: exactly ONE additive table, no existing table touched, no data written", async () => {
    const dir = new URL("../prisma/migrations/", import.meta.url);
    const migrations = fs.readdirSync(dir).filter((name) => name.endsWith("_add_product_phone_compatibility"));
    assert(migrations.length === 1, `exactly one compatibility migration, got ${migrations.join(",")}`);
    const sql = codeOnly(fs.readFileSync(new URL(`${migrations[0]}/migration.sql`, dir), "utf8")).replace(/^--.*$/gm, "");
    assert((sql.match(/CREATE TABLE/g) ?? []).length === 1 && sql.includes('"product_phone_compatibilities"'), "creates only product_phone_compatibilities");
    // (the foreign keys legitimately say "ON DELETE CASCADE ON UPDATE CASCADE" — only real statements are forbidden)
    assert(!/\bDROP\b|\bINSERT\s+INTO\b|\bUPDATE\s+"|\bDELETE\s+FROM\b|\bTRUNCATE\b/i.test(sql), "no DROP / data statements");
    const alters = [...sql.matchAll(/ALTER TABLE "([^"]+)"/g)].map((m) => m[1]);
    assert(alters.every((table) => table === "product_phone_compatibilities"), `only the new table is altered (found ${alters.join(",")})`);
    const schema = read("../prisma/schema.prisma");
    assert(/@@unique\(\[productId, phoneModelId\]\)/.test(schema.slice(schema.indexOf("model ProductPhoneCompatibility"))), "unique (productId, phoneModelId) in the schema");
  });

  console.log("ALL PASS");
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
