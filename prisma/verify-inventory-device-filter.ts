/**
 * Real-database verification for the "حسب نوع الجهاز" filter on the company
 * inventory overview (/admin/inventory/overview):
 * src/lib/inventory-overview-load.ts (the page's bounded queries),
 * src/lib/inventory-device-filter.ts (the shared filter pipeline) and
 * src/components/admin/inventory/CompanyInventoryOverview.tsx.
 *
 * The filter only SELECTS products through the canonical structured relation
 * (active ProductVariant → PhoneModel of a PHONE_COMPATIBILITY product — never
 * name text). Card quantities stay the existing InventoryItem-based scope
 * totals. Read-only.
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

  const [constants, loader, filterLib] = await Promise.all([
    import("../src/lib/constants"),
    import("../src/lib/inventory-overview-load"),
    import("../src/lib/inventory-device-filter"),
  ]);
  const { STOCK_LOCATION_TYPES, ROLES } = constants;
  const { loadInventoryOverviewPageData } = loader;
  const { filterOverviewProducts, productMatchesDeviceModel, deviceModelQuantity, brandIdForModel } = filterLib;
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
  const emptyBrand = await prisma.phoneBrand.create({ data: { name: `${runId}-EmptyBrand`, slug: `${runId}-empty`, sortOrder: 4 } });
  const m16 = await prisma.phoneModel.create({ data: { phoneBrandId: apple.id, name: "iPhone 16 Pro Max", slug: `${runId}-16pm`, sortOrder: 1 } });
  const m15 = await prisma.phoneModel.create({ data: { phoneBrandId: apple.id, name: "iPhone 15", slug: `${runId}-15`, sortOrder: 2 } });
  const mOld = await prisma.phoneModel.create({ data: { phoneBrandId: apple.id, name: "iPhone Retired", slug: `${runId}-old`, isActive: false, sortOrder: 3 } });
  const s24 = await prisma.phoneModel.create({ data: { phoneBrandId: samsung.id, name: "Galaxy S24", slug: `${runId}-s24`, sortOrder: 1 } });
  await prisma.phoneModel.create({ data: { phoneBrandId: deadBrand.id, name: "Ghost", slug: `${runId}-ghost` } });
  await prisma.phoneModel.create({ data: { phoneBrandId: emptyBrand.id, name: "Dormant", slug: `${runId}-dormant`, isActive: false } });

  const catCases = await prisma.category.create({ data: { name: `${runId}-cases`, nameAr: `${runId}-كفرات`, slug: `${runId}-c1` } });
  const catProtectors = await prisma.category.create({ data: { name: `${runId}-prot`, nameAr: `${runId}-لزقات`, slug: `${runId}-c2` } });
  const catChargers = await prisma.category.create({ data: { name: `${runId}-chg`, nameAr: `${runId}-شواحن`, slug: `${runId}-c3` } });

  let seq = 0;
  async function makeProduct(name: string, categoryId: string, mode: "NONE" | "PHONE_COMPATIBILITY" = "PHONE_COMPATIBILITY") {
    seq += 1;
    return prisma.product.create({
      data: { sku: `${runId}-${seq}`, name: `${runId}-${name}`, nameAr: `${runId}-${name}`, retailPriceCents: 1000, wholesalePriceCents: 800, isActive: true, categoryId, variantMode: mode },
    });
  }
  async function variant(productId: string, phoneModelId: string, isActive = true) {
    return prisma.productVariant.create({ data: { productId, phoneModelId, isActive } });
  }
  async function stock(productId: string, locationId: string, quantity: number, variantId: string | null = null) {
    return prisma.inventoryItem.create({ data: { productId, locationId, quantity, variantId } });
  }

  // The business fixture: iPhone 16 Pro Max
  const caseA = await makeProduct("جفر شفاف", catCases.id);
  const caseAv = await variant(caseA.id, m16.id);
  await stock(caseA.id, warehouse.id, 20, caseAv.id);
  await stock(caseA.id, car.id, 5); // live REP_CAR stock is one plain product-level balance (variantId null): 25 company-wide, 20 warehouse, 5 car
  const caseB = await makeProduct("كفر سيليكون", catCases.id);
  const caseBv = await variant(caseB.id, m16.id);
  await stock(caseB.id, warehouse.id, 10, caseBv.id);
  const privacy = await makeProduct("لزقة Privacy", catProtectors.id);
  const privacyV = await variant(privacy.id, m16.id);
  await stock(privacy.id, warehouse.id, 40, privacyV.id);
  const lens = await makeProduct("حماية عدسة الكاميرا", catProtectors.id);
  const lensV = await variant(lens.id, m16.id);
  await stock(lens.id, warehouse.id, 7, lensV.id);
  const case15 = await makeProduct("كفر آيفون 15", catCases.id);
  const case15v = await variant(case15.id, m15.id);
  await stock(case15.id, warehouse.id, 50, case15v.id);
  const charger = await makeProduct("شاحن 16 Pro Max سريع", catChargers.id, "NONE"); // name mentions the model; NOT compatible
  await stock(charger.id, warehouse.id, 100);
  // extra edge products
  const multi = await makeProduct("كفر متعدد الموديلات", catCases.id);
  const multiV16 = await variant(multi.id, m16.id);
  const multiV15 = await variant(multi.id, m15.id);
  await stock(multi.id, warehouse.id, 12, multiV16.id);
  await stock(multi.id, warehouse.id, 30, multiV15.id); // card total 42, for this device 12
  // legacy per-model REP_CAR row (pre aggregate conversion): counted by the overview, but never attributable to a model
  const legacyCar = await makeProduct("كفر قديم تفصيل سيارة", catCases.id);
  const legacyCarV = await variant(legacyCar.id, m15.id);
  await stock(legacyCar.id, car.id, 4, legacyCarV.id);
  const nameTrap = await makeProduct("كفر iPhone 16 Pro Max مزيف", catCases.id); // name says 16 Pro Max, variant says 15
  const nameTrapV = await variant(nameTrap.id, m15.id);
  await stock(nameTrap.id, warehouse.id, 9, nameTrapV.id);
  const zeroCompat = await makeProduct("كفر بدون مخزون", catCases.id);
  await variant(zeroCompat.id, m16.id);
  const retiredVariant = await makeProduct("كفر موديل متوقف", catCases.id);
  const retiredV = await variant(retiredVariant.id, m16.id, false);
  await stock(retiredVariant.id, warehouse.id, 5, retiredV.id);
  const legacyFlat = await makeProduct("كفر قديم بدون موديلات", catCases.id); // PHONE_COMPATIBILITY but no variants yet
  await stock(legacyFlat.id, warehouse.id, 3);
  const phoneItself = await prisma.product.create({
    data: { sku: `${runId}-phone`, name: `${runId}-iPhone 16 Pro Max جهاز`, nameAr: `${runId}-iPhone 16 Pro Max جهاز`, retailPriceCents: 1, wholesalePriceCents: 1, isActive: true, inventoryTrackingMode: "DEVICE_MODEL_COLOR" },
  });
  const color = await prisma.color.create({ data: { name: `${runId}-black`, nameAr: `${runId}-أسود` } });
  const dcv = await prisma.deviceColorVariant.create({ data: { productId: phoneItself.id, phoneModelId: m16.id, colorId: color.id } });
  await prisma.inventoryItem.create({ data: { productId: phoneItself.id, locationId: warehouse.id, quantity: 4, deviceColorVariantId: dcv.id } });

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

  // ---------- snapshot for the read-only check ----------
  async function snapshot() {
    const [items, qtySum, movements, variants, products, models] = await Promise.all([
      prisma.inventoryItem.count(),
      prisma.inventoryItem.aggregate({ _sum: { quantity: true } }),
      prisma.stockMovement.count(),
      prisma.productVariant.count(),
      prisma.product.count(),
      prisma.phoneModel.count(),
    ]);
    return JSON.stringify([items, qtySum._sum.quantity, movements, variants, products, models]);
  }
  const before = await snapshot();

  queryLog.length = 0;
  const data = await loadInventoryOverviewPageData();
  const loadQueryCount = queryLog.length;
  const overview = data.products;
  const run = (options: Partial<typeof base>) => fixtureProducts(filterOverviewProducts(overview, { ...base, ...options }));

  // ---------- A. the business scenario ----------
  await check("A. iPhone 16 Pro Max: cases + protectors + lens with their canonical quantities; the iPhone 15 case and the charger are absent", async () => {
    const rows = run({ deviceModelId: m16.id });
    assert(JSON.stringify(pairs(rows)) === JSON.stringify(["جفر شفاف=25", "كفر سيليكون=10", "كفر متعدد الموديلات=42", "لزقة Privacy=40", "حماية عدسة الكاميرا=7"].sort()), `unexpected result: ${pairs(rows).join(" | ")}`);
    const hidden = names(rows);
    for (const absent of ["كفر آيفون 15", "شاحن 16 Pro Max سريع", "كفر iPhone 16 Pro Max مزيف", "كفر بدون مخزون", "كفر موديل متوقف", "كفر قديم بدون موديلات", "iPhone 16 Pro Max جهاز"]) {
      assert(!hidden.includes(absent), `${absent} must not be listed for iPhone 16 Pro Max`);
    }
  });

  await check("B. compatibility comes from the structured variant relation, never from product-name text; a retired variant, a legacy flat product and a DEVICE_MODEL_COLOR phone do not match", async () => {
    const byId = new Map(overview.map((p) => [p.id, p]));
    assert(productMatchesDeviceModel(byId.get(caseA.id)!, m16.id), "case A matches its variant model");
    assert(!productMatchesDeviceModel(byId.get(nameTrap.id)!, m16.id), "a name that says '16 Pro Max' with only an iPhone 15 variant does NOT match");
    assert(productMatchesDeviceModel(byId.get(nameTrap.id)!, m15.id), "...but matches the model its variant really is");
    assert(!productMatchesDeviceModel(byId.get(charger.id)!, m16.id), "a TOTAL_STOCK charger never matches");
    assert(!productMatchesDeviceModel(byId.get(retiredVariant.id)!, m16.id), "an inactive variant is not compatibility");
    assert(!productMatchesDeviceModel(byId.get(legacyFlat.id)!, m16.id), "legacy flat stock (UNCLASSIFIED group) matches no model");
    assert(!productMatchesDeviceModel(byId.get(phoneItself.id)!, m16.id), "a DEVICE_MODEL_COLOR phone is not an accessory");
    assert(!productMatchesDeviceModel(byId.get(caseA.id)!, ""), "no model id → no match");
  });

  // ---------- quantities ----------
  await check("C. quantities equal the existing overview exactly (same scope totals), unchanged by the device filter; Product.stock is never read", async () => {
    const unfiltered = new Map(fixtureProducts(filterOverviewProducts(overview, { ...base, showZeroStock: true })).map((r) => [r.product.id, r.scopeTotal]));
    for (const row of run({ deviceModelId: m16.id })) {
      assert(unfiltered.get(row.product.id) === row.scopeTotal, `${row.product.name}: device-filtered quantity differs from the overview quantity`);
    }
    assert(unfiltered.get(caseA.id) === 25 && unfiltered.get(multi.id) === 42, "overview quantities are the InventoryItem sums");
    const source = codeOnly(read("../src/lib/inventory-device-filter.ts") + read("../src/lib/inventory-overview-load.ts") + read("../src/components/admin/inventory/CompanyInventoryOverview.tsx") + read("../src/app/admin/inventory/overview/page.tsx"));
    assert(!/\.stock\b|stock\s*:\s*true|product\.stock|\bProduct\.stock\b/.test(source.replace(/StockLocation|stockMovement|inventoryItem/gi, "")), "no Product.stock access in the overview files");
  });

  await check("D. the location filter still changes quantities: warehouse 20, rep car 5, company 25 — and a product with 0 in the chosen scope is hidden", async () => {
    const wh = run({ deviceModelId: m16.id, scopeLocationIds: [warehouse.id] });
    assert(pairs(wh).includes("جفر شفاف=20") && pairs(wh).includes("كفر متعدد الموديلات=42"), "warehouse quantities");
    const inCar = run({ deviceModelId: m16.id, scopeLocationIds: [car.id] });
    assert(JSON.stringify(pairs(inCar)) === JSON.stringify(["جفر شفاف=5"]), `rep car scope: ${pairs(inCar).join(" | ")}`);
    const noRep = run({ deviceModelId: m16.id, scopeLocationIds: [] });
    assert(noRep.length === 0, "an unselected rep (empty scope) shows nothing, as before");
    const carZero = run({ deviceModelId: m16.id, scopeLocationIds: [car.id], showZeroStock: true });
    assert(carZero.length === 6 && carZero.every((r) => r.scopeTotal === (r.product.name.endsWith("جفر شفاف") ? 5 : 0)), "show-zero lists every compatible product with its car quantity");
  });

  await check("E. category + device: only compatible cases / only compatible protectors / all compatible when category is all", async () => {
    assert(JSON.stringify(names(run({ deviceModelId: m16.id, categoryId: catCases.id }))) === JSON.stringify(["جفر شفاف", "كفر سيليكون", "كفر متعدد الموديلات"]), "cases only");
    assert(names(run({ deviceModelId: m16.id, categoryId: catProtectors.id })).length === 2, "protectors only");
    assert(run({ deviceModelId: m16.id, categoryId: catChargers.id }).length === 0, "no compatible charger");
    assert(run({ deviceModelId: m16.id }).length === 5, "all categories");
  });

  await check("F. search narrows the compatible results; it never widens them (and name text is not a compatibility source)", async () => {
    assert(JSON.stringify(names(run({ deviceModelId: m16.id, search: "privacy" }))) === JSON.stringify(["لزقة Privacy"]), "search within device");
    assert(run({ deviceModelId: m16.id, search: "16 Pro Max" }).length === 0, "the model name in the search box matches no compatible product name");
    const withoutDevice = names(run({ search: "16 Pro Max" }));
    assert(withoutDevice.includes("شاحن 16 Pro Max سريع") && withoutDevice.includes("كفر iPhone 16 Pro Max مزيف"), "without the device filter that same search still finds by name, as before");
    assert(run({ deviceModelId: m16.id, search: caseA.sku }).length === 1, "SKU search works inside the device filter");
  });

  await check("G. zero-stock checkbox behaves exactly as today (device ON or OFF)", async () => {
    assert(!names(run({ deviceModelId: m16.id })).includes("كفر بدون مخزون"), "hidden by default");
    const shown = run({ deviceModelId: m16.id, showZeroStock: true });
    assert(names(shown).includes("كفر بدون مخزون") && shown.find((r) => r.product.name.endsWith("كفر بدون مخزون"))!.scopeTotal === 0, "shown with quantity 0 when ON");
    assert(!names(shown).includes("كفر موديل متوقف"), "a retired variant stays non-compatible even with zero-stock ON");
  });

  await check("H. clearing the device filter restores the pre-existing behaviour — identical to the old inline pipeline for many option combinations", async () => {
    // Reference: the exact pre-change logic of CompanyInventoryOverview.visibleProducts.
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
            }
          }
        }
      }
    }
    assert(names(run({})).includes("شاحن 16 Pro Max سريع") && names(run({})).includes("كفر آيفون 15"), "with no device selected every normal product is back");
  });

  await check("I. 'لهذا الجهاز' = the model's own WAREHOUSE stock only; REP_CAR stock (plain aggregate or legacy per-model rows) is never attributed to a model; the main quantity is untouched", async () => {
    const byId = new Map(overview.map((p) => [p.id, p]));
    const whIds = [warehouse.id];
    const q = (id: string, model: string, scope: string[]) => deviceModelQuantity(byId.get(id)!, model, scope, whIds);
    // warehouse-only scope: the real per-model figure
    assert(q(caseA.id, m16.id, [warehouse.id]).modelQuantity === 20 && q(caseA.id, m16.id, [warehouse.id]).unattributedQuantity === 0 && q(caseA.id, m16.id, [warehouse.id]).hasModelScope, "warehouse scope: 20, nothing unattributed");
    // company scope: 20 attributable to the model + 5 aggregate car pieces that are NOT guessed into the model
    const company = q(caseA.id, m16.id, companyIds);
    assert(company.modelQuantity === 20 && company.unattributedQuantity === 5 && company.hasModelScope, `company scope: ${JSON.stringify(company)}`);
    assert(run({ deviceModelId: m16.id }).find((r) => r.product.id === caseA.id)!.scopeTotal === 25, "...while the card's main quantity stays 20 + 5 = 25");
    // car-only scope: model-specific quantity is unknowable
    const carOnly = q(caseA.id, m16.id, [car.id]);
    assert(carOnly.modelQuantity === 0 && !carOnly.hasModelScope && carOnly.unattributedQuantity === 5, `car scope: ${JSON.stringify(carOnly)}`);
    // multi-model case splits by model in the warehouse
    assert(q(multi.id, m16.id, companyIds).modelQuantity === 12 && q(multi.id, m15.id, companyIds).modelQuantity === 30, "multi-model case splits 12 / 30");
    // a legacy per-model REP_CAR row is still not attributed to the model
    const legacy = q(legacyCar.id, m15.id, companyIds);
    assert(legacy.modelQuantity === 0 && legacy.unattributedQuantity === 4, `legacy dimensional car row must not count for the model: ${JSON.stringify(legacy)}`);
    assert(run({ deviceModelId: m15.id }).find((r) => r.product.id === legacyCar.id)!.scopeTotal === 4, "...yet it still counts in the existing main quantity (4), exactly as the overview did before");
    assert(q(charger.id, m16.id, companyIds).modelQuantity === 0, "non-compatible → 0");
    assert(run({ deviceModelId: m16.id }).find((r) => r.product.id === multi.id)!.scopeTotal === 42, "the card quantity stays the product's scope total (42), not 12");
  });

  await check("J. selector data = the canonical active brand → active model lists; stale / unknown ids degrade to 'all'", async () => {
    const ours = data.deviceBrands.filter((b) => b.label.startsWith(runId));
    assert(JSON.stringify(ours.map((b) => b.label.replace(`${runId}-`, ""))) === JSON.stringify(["Apple", "Samsung"]), `brands: ${ours.map((b) => b.label).join(",")} (inactive and model-less brands are excluded)`);
    assert(JSON.stringify(ours[0]!.models.map((m) => m.label)) === JSON.stringify(["iPhone 16 Pro Max", "iPhone 15"]), "Apple models in sortOrder, retired model excluded");
    assert(brandIdForModel(data.deviceBrands, m16.id) === apple.id && brandIdForModel(data.deviceBrands, s24.id) === samsung.id, "brand of a model");
    assert(brandIdForModel(data.deviceBrands, mOld.id) === "" && brandIdForModel(data.deviceBrands, "nope") === "" && brandIdForModel(data.deviceBrands, "") === "", "inactive / unknown / empty model id → '' (page falls back to all products)");
  });

  await check("K. a model with no compatible stock → empty list (the component prints the Arabic empty message), no error", async () => {
    assert(run({ deviceModelId: s24.id }).length === 0, "Galaxy S24 has nothing");
    assert(run({ deviceModelId: "does-not-exist" }).length === 0, "an unknown id selects nothing rather than throwing");
  });

  await check("L. no N+1: a fixed number of bounded queries, independent of how many products / variants exist", async () => {
    // Prisma issues one query per relation level (products, images, variants, phone models, ...), never one per row: the 5 findMany calls expand to a fixed set. The new brand list adds exactly 2 (phone_brands + its models).
    assert(loadQueryCount <= 17, `loader issued ${loadQueryCount} queries`);
    for (let i = 0; i < 25; i++) {
      const p = await makeProduct(`إضافي ${i}`, catCases.id);
      const v = await variant(p.id, i % 2 ? m16.id : m15.id);
      await stock(p.id, warehouse.id, 1, v.id);
    }
    queryLog.length = 0;
    const bigger = await loadInventoryOverviewPageData();
    assert(queryLog.length === loadQueryCount, `query count changed with data size: ${loadQueryCount} → ${queryLog.length}`);
    queryLog.length = 0;
    filterOverviewProducts(bigger.products, { ...base, deviceModelId: m16.id });
    assert(queryLog.length === 0, "filtering is pure in-memory: zero queries");
  });

  await check("M. READ-ONLY: loading + filtering changed no inventory, movement, variant, product or model row; no write calls in the new code", async () => {
    // (the 25 extra rows of check L are fixture inserts — compare around a fresh read-only round instead)
    const mid = await snapshot();
    await loadInventoryOverviewPageData();
    for (const modelId of [m16.id, m15.id, s24.id, ""]) filterOverviewProducts((await loadInventoryOverviewPageData()).products, { ...base, deviceModelId: modelId });
    assert((await snapshot()) === mid, "database state changed during read-only calls");
    assert(before !== undefined, "baseline taken");
    const files = ["../src/lib/inventory-device-filter.ts", "../src/lib/inventory-overview-load.ts", "../src/components/admin/inventory/CompanyInventoryOverview.tsx", "../src/app/admin/inventory/overview/page.tsx"];
    for (const file of files) {
      // URL query-string edits (searchParams.set/delete) are not database writes
      const source = codeOnly(read(file)).replace(/searchParams\.(set|delete)\(/g, "urlParams(");
      assert(!/\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(|\$transaction|\$executeRaw|\$queryRaw|"use server"|useFormState|action=\{/.test(source), `${file} contains a write / server action`);
    }
    assert(!/stockMovement/.test(codeOnly(read("../src/lib/inventory-device-filter.ts") + read("../src/lib/inventory-overview-load.ts"))), "no StockMovement access in the new lib code");
  });

  await check("N. access unchanged: the page is still ADMIN + ADMIN_ASSISTANT only; the filter lives inside that page, no new route", async () => {
    const page = codeOnly(read("../src/app/admin/inventory/overview/page.tsx"));
    const guard = page.match(/requireRole\(\[([^\]]*)\]\)/);
    assert(guard && guard[1]!.replace(/\s/g, "") === "ROLES.ADMIN,ROLES.ADMIN_ASSISTANT", `guard is ${guard?.[1]}`);
    assert(page.indexOf("requireRole") < page.indexOf("loadInventoryOverviewPageData()"), "role check runs before any data is loaded");
    for (const role of ["SALES_REPRESENTATIVE", "RETAIL_CUSTOMER", "WHOLESALE_MERCHANT"]) assert(!page.includes(role), `${role} is not mentioned/allowed`);
    const component = codeOnly(read("../src/components/admin/inventory/CompanyInventoryOverview.tsx"));
    assert(component.includes("حسب نوع الجهاز") && component.includes("الماركة") && component.includes("نوع الجهاز") && component.includes("كل الأصناف"), "toggle + brand + model labels");
    assert(component.includes("لا توجد أصناف متوافقة مع هذا الجهاز ضمن الفلاتر الحالية."), "Arabic empty message");
    assert(component.includes("deviceModelId") && /searchParams\.(set|delete)\("deviceModelId"/.test(component), "state is kept in ?deviceModelId");
  });

  await check("O. the real component renders: toggle, brand/model selectors, the existing cards, secondary figure, and an unknown id degrades to all products", async () => {
    // react-dom/server cannot load under --conditions=react-server, so a plain
    // Node child renders the real component from the data this script loaded.
    const { execFileSync } = await import("node:child_process");
    const os = await import("node:os");
    const path = await import("node:path");
    const dataFile = path.join(os.tmpdir(), `${runId}-overview.json`);
    fs.writeFileSync(dataFile, JSON.stringify(data));
    const stdout = execFileSync(process.execPath, ["--import", "tsx", "prisma/verify-inventory-device-filter-render.ts", dataFile, m16.id, s24.id], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    fs.rmSync(dataFile, { force: true });
    const rendered = JSON.parse(stdout.trim().split("\n").pop()!) as { on: string; off: string; empty: string; noBrands: string };
    const on = rendered.on;
    for (const text of ["حسب نوع الجهاز", "كل الأصناف", "الماركة", "نوع الجهاز", "مسح فلتر الجهاز", `${runId}-جفر شفاف`, "المتوفر: 25 قطعة", "لهذا الجهاز: 20 في المخزن", "+ 5 في السيارات بدون تفصيل موديل", "المتوفر: 42 قطعة", "لهذا الجهاز: 12"]) assert(on.includes(text), `device ON markup lacks "${text}"`);
    for (const text of [`${runId}-كفر آيفون 15`, `${runId}-شاحن 16 Pro Max سريع`]) assert(!on.includes(text), `device ON markup must not list "${text}"`);
    const off = rendered.off;
    assert(off.includes(`${runId}-شاحن 16 Pro Max سريع`) && !off.includes("لهذا الجهاز") && !off.includes("مسح فلتر الجهاز"), "device OFF renders the normal grid without device UI state");
    const empty = rendered.empty;
    assert(empty.includes("لا توجد أصناف متوافقة مع هذا الجهاز ضمن الفلاتر الحالية."), "empty message");
    const noBrands = rendered.noBrands;
    assert(!noBrands.includes("حسب نوع الجهاز"), "no phone brands defined → no device control (page unchanged)");
  });

  console.log("ALL PASS");
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
