/**
 * Real-database verification for the printable per-product WAREHOUSE
 * availability sheet "جرد الصنف" (src/lib/inventory-availability-sheet.ts,
 * /admin/inventory/overview/product/[productId]/availability).
 *
 * Rule under test: a model / compatibility variant / brand+model+color
 * combination is listed only when its WAREHOUSE quantity (sum over every
 * StockLocation of type WAREHOUSE, the same set the company overview calls
 * "المخزن") is >= 5. REP_CAR stock is never read. Read-only: nothing is
 * written or hidden anywhere.
 *
 * Safety rails via resolveVerifyDatabaseUrl (prisma/verify-guardrails.ts) —
 * same convention as every other prisma/verify-*.ts script: never runs
 * against a shared/production database.
 *
 * Run with: node --conditions=react-server --import tsx prisma/verify-product-availability-sheet.ts
 * PRODUCT_AVAILABILITY_VERIFY_DATABASE_URL must point at a disposable
 * localhost PostgreSQL database whose name contains "verify".
 */

export {};

import { resolveVerifyDatabaseUrl } from "./verify-guardrails";

const resolved = resolveVerifyDatabaseUrl("PRODUCT_AVAILABILITY_VERIFY_DATABASE_URL");
console.log(`[verify-product-availability-sheet] target: ${resolved.masked}`);

process.env.DATABASE_URL = resolved.url;
process.env.DIRECT_URL = resolved.url;

async function main() {
  const fs = await import("node:fs");
  const [{ PrismaClient }, constants, sheetLib] = await Promise.all([
    import("@prisma/client"),
    import("../src/lib/constants"),
    import("../src/lib/inventory-availability-sheet"),
  ]);

  const prisma = new PrismaClient();
  const { ROLES, STOCK_LOCATION_TYPES } = constants;
  const { loadProductAvailabilitySheet, MIN_AVAILABLE_WAREHOUSE_QUANTITY, buildAvailabilityTables, visibleColorLabels, HIDDEN_COLOR_LABELS } = sheetLib;
  const runId = `verify-avail-${Date.now()}`;

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

  assert(MIN_AVAILABLE_WAREHOUSE_QUANTITY === 5, "the documented minimum is 5");

  const repUser = await prisma.user.create({ data: { role: ROLES.SALES_REPRESENTATIVE, name: `${runId}-rep`, email: `${runId}-rep@example.invalid`, isActive: true } });
  const rep = await prisma.salesRepresentative.create({ data: { userId: repUser.id, employeeCode: `${runId}-rep` } });
  const wh1 = await prisma.stockLocation.create({ data: { type: STOCK_LOCATION_TYPES.WAREHOUSE, name: `${runId}-wh1`, isDefault: false } });
  const wh2 = await prisma.stockLocation.create({ data: { type: STOCK_LOCATION_TYPES.WAREHOUSE, name: `${runId}-wh2`, isDefault: false } });
  const car = await prisma.stockLocation.create({ data: { type: STOCK_LOCATION_TYPES.REP_CAR, name: `${runId}-car`, salesRepId: rep.id } });

  // Brands/models are created in an order that differs from the expected print order on purpose.
  const brandSam = await prisma.phoneBrand.create({ data: { name: `${runId}-SAMSUNG`, slug: `${runId}-samsung`, sortOrder: 2 } });
  const brandIph = await prisma.phoneBrand.create({ data: { name: `${runId}-IPHONE`, slug: `${runId}-iphone`, sortOrder: 1 } });
  async function model(brandId: string, name: string, sortOrder: number) {
    return prisma.phoneModel.create({ data: { phoneBrandId: brandId, name, slug: `${runId}-${name.toLowerCase().replace(/\s+/g, "-")}`, sortOrder } });
  }
  const ip5 = await model(brandIph.id, `${runId} IP 5`, 5);
  const ip11 = await model(brandIph.id, `${runId} IP 11`, 1);
  const ip12 = await model(brandIph.id, `${runId} IP 12`, 2);
  const ip13 = await model(brandIph.id, `${runId} IP 13`, 3);
  const ip14 = await model(brandIph.id, `${runId} IP 14`, 4);
  const s22 = await model(brandSam.id, `${runId} S22`, 1);
  const s23 = await model(brandSam.id, `${runId} S23`, 2);
  const black = await prisma.color.create({ data: { name: `${runId}-Black`, hexCode: "#000000" } });
  const blue = await prisma.color.create({ data: { name: `${runId}-Blue`, hexCode: "#0000ff" } });
  const red = await prisma.color.create({ data: { name: `${runId}-Red`, hexCode: "#ff0000" } });

  async function product(label: string, mode: "COMPAT" | "DEVICE" | "SIMPLE") {
    return prisma.product.create({
      data: {
        sku: `${runId}-${label}`,
        name: `${runId}-${label}`,
        retailPriceCents: 1000,
        wholesalePriceCents: 800,
        isActive: true,
        variantMode: mode === "COMPAT" ? "PHONE_COMPATIBILITY" : "NONE",
        inventoryTrackingMode: mode === "DEVICE" ? "DEVICE_MODEL_COLOR" : "TOTAL_STOCK",
      },
    });
  }
  async function stock(productId: string, locationId: string, quantity: number, ref: { variantId?: string; deviceColorVariantId?: string } = {}) {
    return prisma.inventoryItem.create({ data: { productId, locationId, quantity, variantId: ref.variantId ?? null, deviceColorVariantId: ref.deviceColorVariantId ?? null } });
  }

  // ---- PHONE_COMPATIBILITY product ----
  const compat = await product("compat", "COMPAT");
  async function variant(modelId: string, isActive = true) {
    return prisma.productVariant.create({ data: { productId: compat.id, phoneModelId: modelId, isActive } });
  }
  const vIp11 = await variant(ip11.id); // wh 4, REP_CAR 1000  -> excluded (case 1 + 4)
  const vIp12 = await variant(ip12.id); // wh 5, REP_CAR 0     -> included (case 2 + 5)
  const vIp13 = await variant(ip13.id); // wh 9                -> included (case 3)
  const vIp5 = await variant(ip5.id); //  wh1 2 + wh2 3 = 5   -> included (sum of ALL warehouse locations)
  const vIp14 = await variant(ip14.id, false); // inactive variant holding 50 -> not a listable model (case 7)
  const vS22 = await variant(s22.id); //   wh 20, REP_CAR 0   -> included (second brand)
  const vS23 = await variant(s23.id); //   wh 0, REP_CAR 80   -> excluded
  await stock(compat.id, wh1.id, 4, { variantId: vIp11.id });
  await stock(compat.id, car.id, 1000, { variantId: vIp11.id });
  await stock(compat.id, wh1.id, 5, { variantId: vIp12.id });
  await stock(compat.id, wh1.id, 9, { variantId: vIp13.id });
  await stock(compat.id, wh1.id, 2, { variantId: vIp5.id });
  await stock(compat.id, wh2.id, 3, { variantId: vIp5.id });
  await stock(compat.id, wh1.id, 50, { variantId: vIp14.id });
  await stock(compat.id, wh1.id, 20, { variantId: vS22.id });
  await stock(compat.id, car.id, 80, { variantId: vS23.id });
  await prisma.productImage.createMany({
    data: [
      { productId: compat.id, url: `https://img.example.invalid/${runId}/secondary.jpg`, mediaType: "IMAGE", isMain: false, sortOrder: 0 },
      { productId: compat.id, url: `https://img.example.invalid/${runId}/main.jpg`, mediaType: "IMAGE", isMain: true, sortOrder: 5 },
      { productId: compat.id, url: `https://img.example.invalid/${runId}/video.mp4`, mediaType: "VIDEO", isMain: true, sortOrder: 0 },
    ],
  });

  // ---- DEVICE_MODEL_COLOR product ----
  const device = await product("device", "DEVICE");
  async function combo(modelId: string, colorId: string) {
    return prisma.deviceColorVariant.create({ data: { productId: device.id, phoneModelId: modelId, colorId } });
  }
  const dIp12Black = await combo(ip12.id, black.id); // wh 5            -> included
  const dIp12Blue = await combo(ip12.id, blue.id); //   wh 4            -> excluded
  const dIp12Red = await combo(ip12.id, red.id); //     wh 1, car 100   -> excluded
  const dS22Black = await combo(s22.id, black.id); //   wh 7            -> included
  const dS22Blue = await combo(s22.id, blue.id); //     wh 12           -> included
  await stock(device.id, wh1.id, 5, { deviceColorVariantId: dIp12Black.id });
  await stock(device.id, wh1.id, 4, { deviceColorVariantId: dIp12Blue.id });
  await stock(device.id, wh1.id, 1, { deviceColorVariantId: dIp12Red.id });
  await stock(device.id, car.id, 100, { deviceColorVariantId: dIp12Red.id });
  await stock(device.id, wh1.id, 7, { deviceColorVariantId: dS22Black.id });
  await stock(device.id, wh1.id, 12, { deviceColorVariantId: dS22Blue.id });

  // ---- SIMPLE products ----
  const simpleLow = await product("simple-low", "SIMPLE"); //  wh 4  + car 500
  await stock(simpleLow.id, wh1.id, 4);
  await stock(simpleLow.id, car.id, 500);
  const simpleEnough = await product("simple-ok", "SIMPLE"); // wh 5 + car 0
  await stock(simpleEnough.id, wh1.id, 5);
  const simpleCarOnly = await product("simple-car", "SIMPLE"); // wh 0 + car 900
  await stock(simpleCarOnly.id, car.id, 900);

  // ---- DEVICE_MODEL_COLOR product using the hidden "شفاف" color (and one real color) ----
  const clear = await prisma.color.create({ data: { name: "شفاف" } });
  const clearProduct = await product("clear", "DEVICE");
  async function clearCombo(modelId: string, colorId: string, whQty: number) {
    const combo = await prisma.deviceColorVariant.create({ data: { productId: clearProduct.id, phoneModelId: modelId, colorId } });
    await stock(clearProduct.id, wh1.id, whQty, { deviceColorVariantId: combo.id });
  }
  await clearCombo(ip12.id, clear.id, 10); //  IP 12 شفاف  -> listed, no color printed
  await clearCombo(ip13.id, clear.id, 8); //   IP 13 شفاف  -> listed ...
  await clearCombo(ip13.id, black.id, 6); //   ... plus a REAL color that must stay
  await clearCombo(s22.id, clear.id, 3); //    wh 3        -> excluded by the rule, not by the filter
  await clearCombo(s23.id, clear.id, 12); //   S23 شفاف    -> listed, no color printed

  const labelOf = (name: string) => name.replace(`${runId}-`, "").replace(`${runId} `, "");
  const shape = (sheet: NonNullable<Awaited<ReturnType<typeof loadProductAvailabilitySheet>>>) =>
    sheet.brands.map((brand) => ({ brand: labelOf(brand.label), models: brand.models.map((m) => ({ model: labelOf(m.label), colors: m.colors.map((c) => labelOf(c.label)) })) }));

  try {
    await check("1-5, 7. PHONE_COMPATIBILITY: wh 4 out; wh 5 and 9 in; REP_CAR ignored both ways; inactive variant out; warehouses summed", async () => {
      const sheet = await loadProductAvailabilitySheet(compat.id);
      assert(sheet && sheet.mode === "PHONE_COMPATIBILITY", "compat sheet");
      const names = sheet.brands.flatMap((brand) => brand.models.map((m) => labelOf(m.label)));
      assert(!names.includes("IP 11"), "warehouse 4 (REP_CAR 1000) is excluded");
      assert(names.includes("IP 12"), "warehouse exactly 5 (REP_CAR 0) is included");
      assert(names.includes("IP 13"), "warehouse 9 is included");
      assert(names.includes("IP 5"), "2 + 3 across two WAREHOUSE locations = 5 is included");
      assert(names.includes("S22"), "warehouse 20 with REP_CAR 0 is included");
      assert(!names.includes("S23"), "warehouse 0 (REP_CAR 80) is excluded");
      assert(!names.includes("IP 14"), "an inactive variant (stock 50) is not listed — follows the canonical active-variant rule");
      assert(sheet.hasAvailability, "has availability");
    });

    await check("6. two brands group correctly, in brand order then natural model order", async () => {
      const sheet = await loadProductAvailabilitySheet(compat.id);
      assert(sheet, "sheet");
      assert(
        JSON.stringify(shape(sheet)) ===
          JSON.stringify([
            { brand: "IPHONE", models: [{ model: "IP 5", colors: [] }, { model: "IP 12", colors: [] }, { model: "IP 13", colors: [] }] },
            { brand: "SAMSUNG", models: [{ model: "S22", colors: [] }] },
          ]),
        `unexpected grouping: ${JSON.stringify(shape(sheet))}`,
      );
    });

    await check("8. DEVICE_MODEL_COLOR: only warehouse combinations >= 5 appear", async () => {
      const sheet = await loadProductAvailabilitySheet(device.id);
      assert(sheet && sheet.mode === "DEVICE_MODEL_COLOR", "device sheet");
      assert(
        JSON.stringify(shape(sheet)) ===
          JSON.stringify([
            { brand: "IPHONE", models: [{ model: "IP 12", colors: ["Black"] }] },
            { brand: "SAMSUNG", models: [{ model: "S22", colors: ["Black", "Blue"] }] },
          ]),
        `unexpected combos: ${JSON.stringify(shape(sheet))}`,
      );
    });

    await check("9. simple product: >= 5 prints the warehouse quantity; < 5 (even with REP_CAR stock) prints the not-enough-stock state", async () => {
      const low = await loadProductAvailabilitySheet(simpleLow.id);
      assert(low && low.mode === "TOTAL_STOCK" && !low.hasAvailability && low.simpleWarehouseQuantity === null, "wh 4 + REP_CAR 500 -> not listed, quantity never printed");
      const ok = await loadProductAvailabilitySheet(simpleEnough.id);
      assert(ok && ok.hasAvailability && ok.simpleWarehouseQuantity === 5, "wh 5 -> shown");
      const carOnly = await loadProductAvailabilitySheet(simpleCarOnly.id);
      assert(carOnly && !carOnly.hasAvailability, "REP_CAR-only stock -> not listed");
    });

    await check("10. read-only: loading every sheet changes no inventory row, movement or variant flag", async () => {
      const ids = [compat.id, device.id, simpleLow.id, simpleEnough.id, simpleCarOnly.id];
      const snapshot = async () =>
        JSON.stringify({
          items: await prisma.inventoryItem.findMany({ where: { productId: { in: ids } }, orderBy: { id: "asc" }, select: { id: true, quantity: true, updatedAt: true } }),
          movements: await prisma.stockMovement.count({ where: { productId: { in: ids } } }),
          variants: await prisma.productVariant.findMany({ where: { productId: compat.id }, orderBy: { id: "asc" }, select: { id: true, isActive: true, updatedAt: true } }),
          products: await prisma.product.findMany({ where: { id: { in: ids } }, orderBy: { id: "asc" }, select: { id: true, isActive: true, updatedAt: true } }),
        });
      const before = await snapshot();
      for (const id of ids) await loadProductAvailabilitySheet(id);
      assert((await snapshot()) === before, "database state identical after loading");
      const source = fs.readFileSync(new URL("../src/lib/inventory-availability-sheet.ts", import.meta.url), "utf8");
      assert(!/\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(|\$executeRaw|\$transaction/.test(source), "the loader contains no write call");
    });

    await check("11. no Product.stock usage: Product has no stock column and the loader reads only InventoryItem rows", async () => {
      const schema = fs.readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
      const productModel = schema.slice(schema.indexOf("model Product {"), schema.indexOf("@@map(\"products\")"));
      assert(!/^\s+stock\s+Int/m.test(productModel), "schema: Product has no stock field");
      const lib = fs.readFileSync(new URL("../src/lib/inventory-availability-sheet.ts", import.meta.url), "utf8");
      const select = fs.readFileSync(new URL("../src/lib/inventory-product-print.ts", import.meta.url), "utf8");
      assert(!/\bstock\s*:\s*true/.test(lib) && !/\bstock\s*:\s*true/.test(select) && /prisma\.inventoryItem\.findMany/.test(lib), "no stock select; canonical InventoryItem query present");
      assert(/location:\s*\{\s*type:\s*STOCK_LOCATION_TYPES\.WAREHOUSE\s*\}/.test(lib) && !/REP_CAR/.test(lib.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")), "the inventory query is filtered to WAREHOUSE and REP_CAR is never referenced in code");
    });

    await check("12. the product's primary IMAGE is used (not a secondary image or a video); no image -> null", async () => {
      const sheet = await loadProductAvailabilitySheet(compat.id);
      assert(sheet && sheet.product.imageUrl === `https://img.example.invalid/${runId}/main.jpg`, `primary image expected, got ${sheet?.product.imageUrl}`);
      const none = await loadProductAvailabilitySheet(device.id);
      assert(none && none.product.imageUrl === null, "no image renders as null (the page then omits the <img>)");
      const page = fs.readFileSync(new URL("../src/app/admin/inventory/overview/product/[productId]/availability/page.tsx", import.meta.url), "utf8");
      assert(/product\.imageUrl\s*&&/.test(page), "the page only renders the image when one exists");
    });

    await check("13. wiring: ADMIN-only route, modal action next to the existing print link, existing /print route untouched in meaning", async () => {
      const page = fs.readFileSync(new URL("../src/app/admin/inventory/overview/product/[productId]/availability/page.tsx", import.meta.url), "utf8");
      assert(page.includes("requireRole([ROLES.ADMIN])"), "ADMIN only");
      const modal = fs.readFileSync(new URL("../src/components/admin/inventory/CompanyInventoryOverview.tsx", import.meta.url), "utf8");
      assert(modal.includes("/availability") && modal.includes("جرد الصنف") && modal.includes("/print") && modal.includes("طباعة كشف المنتج"), "both actions present");
      const none = await loadProductAvailabilitySheet(`${runId}-missing`);
      assert(none === null, "an unknown product id yields null (the page 404s)");
    });

    await check("14. table layout: brands become columns, models rows; unequal brands pad with empty cells; \"شفاف\" is never printed", async () => {
      const compatSheet = await loadProductAvailabilitySheet(compat.id);
      assert(compatSheet, "compat sheet");
      const tables = buildAvailabilityTables(compatSheet.brands, false);
      assert(tables.length === 1 && tables[0]!.brands.length === 2, "two brands share one table (two columns)");
      assert(tables[0]!.brands.map((b) => labelOf(b.label)).join(",") === "IPHONE,SAMSUNG", "brand columns in brand order");
      assert(tables[0]!.rows.length === 3 && tables[0]!.rows[0]!.length === 2, "3 rows x 2 columns");
      assert(tables[0]!.rows[1]![1] === null && tables[0]!.rows[2]![1] === null, "the shorter brand pads with empty cells");
      assert(tables[0]!.rows.flat().every((cell) => cell === null || cell.colors.length === 0), "compatibility models carry no colors");

      const clearSheet = await loadProductAvailabilitySheet(clearProduct.id);
      assert(clearSheet && clearSheet.mode === "DEVICE_MODEL_COLOR", "clear-color sheet");
      const clearTables = buildAvailabilityTables(clearSheet.brands, true);
      const cells = clearTables.flatMap((table) => table.rows.flat()).filter((cell) => cell !== null);
      const printed = JSON.stringify(clearTables);
      assert(!printed.includes("شفاف"), "the word شفاف appears nowhere in the table data");
      assert(HIDDEN_COLOR_LABELS.has("شفاف"), "the hidden label set holds it");
      assert(cells.map((c) => labelOf(c!.label)).sort().join(",") === "IP 12,IP 13,S23", "models whose only color is شفاف are still listed (S22 stays out: warehouse 3)");
      assert(cells.find((c) => labelOf(c!.label) === "IP 13")!.colors.map(labelOf).join(",") === "Black", "a real color is kept next to its model");
      assert(cells.find((c) => labelOf(c!.label) === "IP 12")!.colors.length === 0, "no color text when the only color was hidden");
      assert(visibleColorLabels([{ id: "a", label: "شفاف", hex: null }, { id: "b", label: "Red", hex: null }]).join(",") === "Red", "mixed list: only the hidden word is dropped");
      // the stock rule itself is unaffected by the filter
      const whOf = (await loadProductAvailabilitySheet(clearProduct.id))!.brands.flatMap((b) => b.models).map((m) => labelOf(m.label));
      assert(!whOf.includes("S22"), "wh 3 still excluded");
    });

    await check("15. brand distribution: 4 brands -> 2+2, 5 -> 3+2, 7 -> 3+2+2, never a lone column", async () => {
      const fake = (n: number) => Array.from({ length: n }, (_, i) => ({ brandId: `b${i}`, label: `B${i}`, models: [{ modelId: `m${i}`, label: `M${i}`, colors: [] }] }));
      const widths = (n: number) => buildAvailabilityTables(fake(n), false).map((t) => t.brands.length).join("+");
      assert(widths(1) === "1" && widths(2) === "2" && widths(3) === "3", "1-3 brands: one table");
      assert(widths(4) === "2+2" && widths(5) === "3+2" && widths(6) === "3+3" && widths(7) === "3+2+2", "4+ brands spread evenly");
      assert(buildAvailabilityTables([], false).length === 0, "no brands -> no tables");
    });

    await check("16. the page is table-based (th/td, bordered) and never prints colors outside the filter helper", async () => {
      const page = fs.readFileSync(new URL("../src/app/admin/inventory/overview/product/[productId]/availability/page.tsx", import.meta.url), "utf8");
      assert(/<table[^]*<thead>[^]*<th[^]*<tbody>[^]*<td/.test(page), "renders a real table with header and body cells");
      assert(!/<ul[ >]|<li[ >]/.test(page), "no list markup left");
      assert(page.includes("buildAvailabilityTables(brands, showColors)") && !page.includes(".colors.map"), "colors reach the page only through buildAvailabilityTables");
      assert(!page.includes("شفاف"), "the page itself hard-codes no color text");
      assert(page.includes(".avail-table thead { display: table-header-group; }") && page.includes(".avail-table tr { break-inside: avoid"), "header repeats across pages and rows never split");
    });

    console.log("ALL PASS");
  } finally {
    const productIds = (await prisma.product.findMany({ where: { sku: { startsWith: runId } }, select: { id: true } })).map((p) => p.id);
    await prisma.inventoryItem.deleteMany({ where: { productId: { in: productIds } } });
    await prisma.productImage.deleteMany({ where: { productId: { in: productIds } } });
    await prisma.deviceColorVariant.deleteMany({ where: { productId: { in: productIds } } });
    await prisma.productVariant.deleteMany({ where: { productId: { in: productIds } } });
    await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    await prisma.color.deleteMany({ where: { OR: [{ name: { startsWith: runId } }, { id: clear.id }] } });
    await prisma.phoneModel.deleteMany({ where: { name: { startsWith: runId } } });
    await prisma.phoneBrand.deleteMany({ where: { name: { startsWith: runId } } });
    await prisma.stockLocation.deleteMany({ where: { name: { startsWith: runId } } });
    await prisma.salesRepresentative.deleteMany({ where: { employeeCode: { startsWith: runId } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: runId } } });
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
