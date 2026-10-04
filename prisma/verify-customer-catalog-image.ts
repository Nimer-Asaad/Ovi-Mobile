/**
 * Real-database verification for the customer-facing catalog IMAGE ("صورة
 * للزبون", src/lib/inventory-customer-catalog.ts + inventory-customer-image.ts,
 * GET /admin/inventory/overview/product/[productId]/customer-image).
 *
 * The image is ONE fixed A4 sheet (1240x1754) in the style of a wholesaler's
 * catalog table, built from the existing warehouse-only availability sheet
 * (>= 5 in WAREHOUSE locations, REP_CAR never read). It shows only brand +
 * model (+ real colors for DEVICE_MODEL_COLOR), never a quantity, and is a
 * pure read: nothing is written anywhere.
 *
 * Safety rails via resolveVerifyDatabaseUrl (prisma/verify-guardrails.ts):
 * never runs against a shared/production database. Temporary product photos
 * are written under the gitignored public/uploads/products and removed again.
 *
 * Run with: node --conditions=react-server --import tsx prisma/verify-customer-catalog-image.ts
 * CUSTOMER_CATALOG_VERIFY_DATABASE_URL must point at a disposable localhost
 * PostgreSQL database whose name contains "verify".
 */

export {};

import { resolveVerifyDatabaseUrl } from "./verify-guardrails";

const resolved = resolveVerifyDatabaseUrl("CUSTOMER_CATALOG_VERIFY_DATABASE_URL");
console.log(`[verify-customer-catalog-image] target: ${resolved.masked}`);

process.env.DATABASE_URL = resolved.url;
process.env.DIRECT_URL = resolved.url;

async function main() {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const [{ PrismaClient }, constants, sheetLib, catalog, imageLib, sharpModule] = await Promise.all([
    import("@prisma/client"),
    import("../src/lib/constants"),
    import("../src/lib/inventory-availability-sheet"),
    import("../src/lib/inventory-customer-catalog"),
    import("../src/lib/inventory-customer-image"),
    import("sharp"),
  ]);
  const sharp = sharpModule.default;
  const prisma = new PrismaClient();
  const { ROLES, STOCK_LOCATION_TYPES } = constants;
  const { loadProductAvailabilitySheet } = sheetLib;
  const {
    buildCustomerCatalogLayout,
    planCustomerCatalog,
    selectCustomerImageUrls,
    isGenericCustomerLabel,
    normalizeCustomerLabel,
    splitBidiItems,
    hasArabic,
    fitSingleLine,
    estimateTextWidth,
    customerImageFilename,
    chooseImageFit,
    CATALOG_PAGE,
    CATALOG_FRAME,
  } = catalog;
  const { generateCustomerCatalogPng } = imageLib;
  const runId = `verify-cat-${Date.now()}`;
  const publicDir = path.join(process.cwd(), "public", "uploads", "products");
  const tempFiles: string[] = [];

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
  const labelOf = (name: string) => name.replace(`${runId}-`, "").replace(`${runId} `, "");

  // ---------- fixtures ----------
  const repUser = await prisma.user.create({ data: { role: ROLES.SALES_REPRESENTATIVE, name: `${runId}-rep`, email: `${runId}-rep@example.invalid`, isActive: true } });
  const rep = await prisma.salesRepresentative.create({ data: { userId: repUser.id, employeeCode: `${runId}-rep` } });
  const wh = await prisma.stockLocation.create({ data: { type: STOCK_LOCATION_TYPES.WAREHOUSE, name: `${runId}-wh`, isDefault: false } });
  const car = await prisma.stockLocation.create({ data: { type: STOCK_LOCATION_TYPES.REP_CAR, name: `${runId}-car`, salesRepId: rep.id } });

  const brandNames = ["APPLE", "TECNO", "SAMSUNG", "XIAOMI"];
  const brands: Record<string, { id: string }> = {};
  for (const [index, name] of brandNames.entries()) {
    brands[name] = await prisma.phoneBrand.create({ data: { name: `${runId}-${name}`, slug: `${runId}-${name.toLowerCase()}`, sortOrder: index + 1 } });
  }
  let modelOrder = 0;
  async function model(brand: string, name: string) {
    modelOrder += 1;
    return prisma.phoneModel.create({ data: { phoneBrandId: brands[brand]!.id, name: `${runId} ${name}`, slug: `${runId}-m${modelOrder}`, sortOrder: modelOrder } });
  }
  const createdColorIds: string[] = [];
  async function color(name: string) {
    const existing = await prisma.color.findFirst({ where: { name } });
    if (existing) return existing;
    const created = await prisma.color.create({ data: { name, hexCode: "#cccccc" } });
    createdColorIds.push(created.id);
    return created;
  }
  const clear = await color("شفاف");
  const mixed = await color("مشكل");
  const mixedShadda = await color("مشكّل");
  const black = await color(`${runId}-Black`);
  const blue = await color(`${runId}-Blue`);

  async function photo(name: string, bg: string, width = 640, height = 800): Promise<string> {
    fs.mkdirSync(publicDir, { recursive: true });
    const file = `_verify-${runId}-${name}.png`;
    await sharp({ create: { width, height, channels: 3, background: bg } }).png().toFile(path.join(publicDir, file));
    tempFiles.push(path.join(publicDir, file));
    return `/uploads/products/${file}`;
  }
  async function product(label: string, mode: "COMPAT" | "DEVICE" | "SIMPLE", nameAr: string | null = null) {
    return prisma.product.create({
      data: {
        sku: `${runId}-${label}`,
        name: `${runId}-${label}`,
        nameAr,
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
  async function compatModel(productId: string, brand: string, name: string, whQty: number, carQty = 0) {
    const row = await model(brand, name);
    const variant = await prisma.productVariant.create({ data: { productId, phoneModelId: row.id } });
    if (whQty) await stock(productId, wh.id, whQty, { variantId: variant.id });
    if (carQty) await stock(productId, car.id, carQty, { variantId: variant.id });
  }

  // A) the reference shape: Apple 16, Tecno 13, Samsung 30, Xiaomi 50 + 3 photos (+ video, duplicate URL, 4th photo)
  const photoA = await photo("a", "#18B7D3", 900, 1100);
  const photoB = await photo("b", "#E85D75", 1200, 800);
  const photoC = await photo("c", "#F59E0B", 800, 800);
  const photoD = await photo("d", "#10B981");
  const catalogProduct = await product("catalog", "COMPAT", "كفر شفاف مشكل للهواتف");
  for (let i = 1; i <= 14; i++) await compatModel(catalogProduct.id, "APPLE", `iPhone ${i}`, 12, 800);
  await compatModel(catalogProduct.id, "APPLE", "iPhone 4Q", 4, 1000); //    wh 4  + REP_CAR 1000 -> absent
  await compatModel(catalogProduct.id, "APPLE", "iPhone 5Q", 5, 0); //       wh 5                 -> present
  await compatModel(catalogProduct.id, "APPLE", "iPhone CarOnly", 0, 900); // REP_CAR only         -> absent
  await compatModel(catalogProduct.id, "APPLE", "iPhone Big4321", 4321, 0); // exposes no quantity
  for (let i = 1; i <= 13; i++) await compatModel(catalogProduct.id, "TECNO", `Spark ${i}`, 7);
  for (let i = 1; i <= 30; i++) await compatModel(catalogProduct.id, "SAMSUNG", `A${String(i).padStart(2, "0")}`, 15);
  for (let i = 1; i <= 50; i++) await compatModel(catalogProduct.id, "XIAOMI", `Redmi ${String(i).padStart(2, "0")}`, 9);
  await prisma.productImage.createMany({
    data: [
      { productId: catalogProduct.id, url: photoC, mediaType: "IMAGE", isMain: false, sortOrder: 7 },
      { productId: catalogProduct.id, url: photoB, mediaType: "IMAGE", isMain: false, sortOrder: 2 },
      { productId: catalogProduct.id, url: photoA, mediaType: "IMAGE", isMain: true, sortOrder: 9 },
      { productId: catalogProduct.id, url: `${photoB}`, mediaType: "IMAGE", isMain: false, sortOrder: 3 }, // duplicate URL
      { productId: catalogProduct.id, url: photoD, mediaType: "IMAGE", isMain: false, sortOrder: 20 }, //      4th image -> beyond the cap
      { productId: catalogProduct.id, url: `/uploads/products/_verify-${runId}-video.mp4`, mediaType: "VIDEO", isMain: true, sortOrder: 0 },
    ],
  });

  // B) DEVICE_MODEL_COLOR with generic + real colors
  const deviceProduct = await product("device", "DEVICE", "غطاء سمارت");
  const m1 = await model("APPLE", "DM1 Black+Clear");
  const m2 = await model("APPLE", "DM2 OnlyClear");
  const m3 = await model("SAMSUNG", "DM3 OnlyMixed");
  const m4 = await model("SAMSUNG", "DM4 Blue wh3");
  const m5 = await model("SAMSUNG", "DM5 BlueBlack");
  async function deviceCombo(modelId: string, colorId: string, qty: number) {
    const variant = await prisma.deviceColorVariant.create({ data: { productId: deviceProduct.id, phoneModelId: modelId, colorId } });
    await stock(deviceProduct.id, wh.id, qty, { deviceColorVariantId: variant.id });
  }
  await deviceCombo(m1.id, black.id, 9);
  await deviceCombo(m1.id, clear.id, 9);
  await deviceCombo(m2.id, clear.id, 9);
  await deviceCombo(m3.id, mixed.id, 9);
  await deviceCombo(m3.id, mixedShadda.id, 9);
  await deviceCombo(m4.id, blue.id, 3); // wh 3 -> excluded entirely
  await deviceCombo(m5.id, blue.id, 8);
  await deviceCombo(m5.id, black.id, 8);
  await deviceCombo(m5.id, clear.id, 8);

  // C) no image
  const noImage = await product("noimage", "COMPAT", "بدون صورة");
  await compatModel(noImage.id, "APPLE", "iPhone 11", 6);
  await compatModel(noImage.id, "SAMSUNG", "S21", 6);

  // D) long lists: 2 x 45 (one A4) and 2 x 95 (documented multi-A4 fallback)
  const longProduct = await product("long", "COMPAT", "قائمة طويلة");
  for (let i = 1; i <= 45; i++) await compatModel(longProduct.id, "APPLE", `iPhone ${i} Pro Max`, 10);
  for (let i = 1; i <= 45; i++) await compatModel(longProduct.id, "SAMSUNG", `Galaxy S${i} Ultra`, 10);
  await prisma.productImage.create({ data: { productId: longProduct.id, url: photoA, mediaType: "IMAGE", isMain: true, sortOrder: 0 } });
  const denseProduct = await product("dense", "COMPAT", "قائمة كثيفة");
  for (let i = 1; i <= 75; i++) await compatModel(denseProduct.id, "APPLE", `iPhone ${i} Pro Max`, 10);
  for (let i = 1; i <= 75; i++) await compatModel(denseProduct.id, "SAMSUNG", `Galaxy S${i} Ultra`, 10);
  await prisma.productImage.create({ data: { productId: denseProduct.id, url: photoA, mediaType: "IMAGE", isMain: true, sortOrder: 0 } });
  const hugeProduct = await product("huge", "COMPAT", "قائمة ضخمة");
  for (let i = 1; i <= 95; i++) await compatModel(hugeProduct.id, "APPLE", `iPhone ${i} Pro Max`, 10);
  for (let i = 1; i <= 95; i++) await compatModel(hugeProduct.id, "SAMSUNG", `Galaxy S${i} Ultra`, 10);

  // E) short two-brand product with two photos: the sheet must still be filled
  const shortProduct = await product("short", "COMPAT", "زجاج ماركتين");
  for (let i = 1; i <= 5; i++) await compatModel(shortProduct.id, "APPLE", `iPhone ${i + 10}`, 6);
  for (let i = 1; i <= 13; i++) await compatModel(shortProduct.id, "SAMSUNG", `S${i}`, 6);
  await prisma.productImage.createMany({
    data: [
      { productId: shortProduct.id, url: photoA, mediaType: "IMAGE", isMain: true, sortOrder: 0 },
      { productId: shortProduct.id, url: photoB, mediaType: "IMAGE", isMain: false, sortOrder: 1 },
    ],
  });

  // F) simple product + nothing >= 5
  const simple = await product("simple", "SIMPLE", "منتج بسيط");
  await stock(simple.id, wh.id, 20);
  const lowStock = await product("low", "COMPAT", "مخزون منخفض");
  await compatModel(lowStock.id, "APPLE", "iPhone 11", 4, 900);

  const allProductIds = [catalogProduct, deviceProduct, noImage, longProduct, denseProduct, hugeProduct, shortProduct, simple, lowStock].map((p) => p.id);

  type Layout = NonNullable<ReturnType<typeof buildCustomerCatalogLayout>>;
  async function layoutFor(productId: string, imageCount = 0) {
    const sheet = await loadProductAvailabilitySheet(productId);
    assert(sheet, "sheet exists");
    return { sheet, layout: buildCustomerCatalogLayout({ sheet, imageCount }) };
  }
  const cellsOf = (layout: Layout) => layout.tables.flatMap((table) => table.columns.flatMap((column) => column.cells));
  const modelText = (cell: { text: string }) => labelOf(cell.text);
  const png = (buffer: Buffer) => ({ signature: buffer.subarray(1, 4).toString("latin1"), width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) });
  /** top-left of a table's inner area on the page (tables are centred) */
  const tableOrigin = (layout: Layout, tableIndex: number) => {
    let y = layout.marginTop;
    for (let i = 0; i < tableIndex; i++) y += layout.tables[i]!.height + layout.tableGap;
    const table = layout.tables[tableIndex]!;
    return { x: Math.round((layout.width - (table.width + CATALOG_FRAME * 2)) / 2) + CATALOG_FRAME, y: y + CATALOG_FRAME };
  };

  async function snapshot() {
    const [items, qty, movements, products, images, variants, activeVariants, products2] = await Promise.all([
      prisma.inventoryItem.count(),
      prisma.inventoryItem.aggregate({ _sum: { quantity: true } }),
      prisma.stockMovement.count(),
      prisma.product.count(),
      prisma.productImage.count(),
      prisma.productVariant.count(),
      prisma.productVariant.count({ where: { isActive: true } }),
      prisma.product.findMany({ where: { id: { in: allProductIds } }, select: { id: true, updatedAt: true }, orderBy: { id: "asc" } }),
    ]);
    return JSON.stringify({ items, qty: qty._sum.quantity, movements, products, images, variants, activeVariants, updated: products2.map((p) => p.updatedAt.toISOString()) });
  }

  try {
    await check("1-3. warehouse >= 5 rule reused: wh 4 absent, wh 5 present, REP_CAR 1000 + wh 4 absent, REP_CAR-only absent", async () => {
      const { layout } = await layoutFor(catalogProduct.id);
      assert(layout, "layout built");
      const models = cellsOf(layout).map(modelText);
      assert(!models.includes("iPhone 4Q"), "wh 4 (REP_CAR 1000) is absent");
      assert(models.includes("iPhone 5Q"), "wh exactly 5 is present");
      assert(!models.includes("iPhone CarOnly"), "REP_CAR-only stock never appears");
      assert(models.includes("iPhone 11") && models.includes("Redmi 09") && models.includes("A12"), "qualifying models appear");
    });

    await check("A4. the sheet is a fixed 1240x1754 A4 portrait PNG (ratio 1.414), never a tall strip", async () => {
      const result = await generateCustomerCatalogPng(catalogProduct.id);
      assert(result.ok, "generated");
      const info = png(result.png);
      assert(info.signature === "PNG" && info.width === 1240 && info.height === 1754, `fixed A4 size, got ${JSON.stringify(info)}`);
      assert(Math.abs(info.height / info.width - Math.SQRT2) < 0.002, "A4 proportions");
      assert(CATALOG_PAGE.width === 1240 && CATALOG_PAGE.height === 1754, "documented page constants");
      const { layout } = await layoutFor(catalogProduct.id, 3);
      assert(layout && layout.density === "NORMAL" && layout.height === 1754 && layout.width === 1240, "normal products use normal chrome on the A4 canvas");
      assert(layout.rowHeight >= 28 && layout.rowHeight <= 34, `compact rows (28-34px) for the reference shape, got ${layout.rowHeight}`);
      assert(layout.rowFontSize >= 18 && layout.rowFontSize <= 24, `readable row font, got ${layout.rowFontSize}`);
    });

    await check("4. four brands -> ONE table, 4 equal columns, configured order; 5 -> 3+2, 6 -> 3+3, 7 -> 4+3; a single brand is a centred narrower table", async () => {
      const { sheet, layout } = await layoutFor(catalogProduct.id);
      assert(layout && layout.tables.length === 1 && layout.tables[0]!.columns.length === 4, "4 brands share one 4-column table");
      assert(layout.tables[0]!.columnWidth * 4 === layout.tables[0]!.width, "columns are equal width");
      assert(layout.tables[0]!.columns.map((column) => labelOf(column.brand.text)).join(",") === "APPLE,TECNO,SAMSUNG,XIAOMI", "configured brand order kept (not hardcoded, not re-sorted)");
      const fakeSheet = (n: number) => ({
        ...sheet,
        brands: Array.from({ length: n }, (_, i) => ({ brandId: `b${i}`, label: `B${i}`, models: [{ modelId: `m${i}`, label: `M${i}`, colors: [] }] })),
      });
      const widths = (n: number) => buildCustomerCatalogLayout({ sheet: fakeSheet(n), imageCount: 0 })!.tables.map((table) => table.columns.length).join("+");
      assert(widths(1) === "1" && widths(2) === "2" && widths(3) === "3" && widths(4) === "4", "1-4 brands: a single table");
      assert(widths(5) === "3+2" && widths(6) === "3+3" && widths(7) === "4+3", "5+ brands: balanced sections on the same page");
      assert(buildCustomerCatalogLayout({ sheet: fakeSheet(6), imageCount: 0 })!.height === 1754, "even 6 brands stay on one A4 sheet");
      assert(buildCustomerCatalogLayout({ sheet: fakeSheet(1), imageCount: 0 })!.tables[0]!.width < 1100, "a single brand is a narrower table");
    });

    await check("ZONE. short adjacent columns become ONE merged photo area; the long columns continue beside it; no blank grid", async () => {
      const { layout } = await layoutFor(catalogProduct.id, 3);
      assert(layout, "layout built");
      const table = layout.tables[0]!;
      const zone = table.zone;
      assert(zone && zone.kind === "COLUMNS", "a merged photo zone exists");
      assert(zone.firstColumn === 0 && zone.columnCount === 2, `the zone spans APPLE + TECNO (2 columns), got ${zone.firstColumn}+${zone.columnCount}`);
      assert(zone.topRows === 16 && zone.rows === table.rowCount - 16 && zone.rows >= 30, `it starts under the taller of the two (APPLE: 16 models) and runs to the table end, got ${zone.topRows}/${zone.rows}`);
      assert(table.columns[2]!.cells.length === 30 && table.columns[3]!.cells.length === 50, "SAMSUNG (30) and XIAOMI (50) keep listing models beside the zone");
      assert(table.columns[3]!.tailRows === 0 && table.columns[2]!.tailRows === table.rowCount - 30, "the shorter long column ends in ONE merged blank cell");
      assert(table.columns[0]!.tailRows + table.columns[0]!.cells.length === zone.topRows && table.columns[1]!.tailRows + table.columns[1]!.cells.length === zone.topRows, "spanned columns have no blank cells under the zone start except one merged tail");
      assert(cellsOf(layout).every((cell) => cell.text.trim() !== ""), "no empty model cells exist");
      assert(zone.height === table.rowHeights.slice(zone.topRows).reduce((sum, value) => sum + value, 0) + table.extraHeight, "zone height is the sum of the rows it covers (+ any large leftover page height)");
      assert(table.extraHeight === 0 && table.columns[3]!.tailRows === 0, "the leftover pixels are spread over the rows: no blank strip under the longest column");
      assert(table.rowHeights.length === 50 && table.rowHeights.every((value) => value === layout.rowHeight || value === layout.rowHeight + 1), "rows differ by at most 1px");
      // the three photos are stacked vertically, edge to edge inside the zone
      assert(zone.boxes.length === 3, "three photos placed");
      assert(zone.boxes.every((box) => box.x === zone.boxes[0]!.x && box.width === zone.boxes[0]!.width), "photos share one left edge and width (stacked)");
      assert(zone.boxes.every((box, index) => index === 0 || box.y > zone.boxes[index - 1]!.y + zone.boxes[index - 1]!.height - 1), "photos are stacked top to bottom without overlap");
      assert(zone.boxes[0]!.width > 500 && zone.boxes[0]!.height > zone.boxes[1]!.height && zone.boxes[1]!.height > zone.boxes[2]!.height, "main photo is the largest");
      assert(zone.boxes[0]!.width === zone.width - 12 - 1, "photos fill the merged width (6px inner gap, 1px grid line)");
      assert(table.height + layout.marginTop * 2 === 1754, "the table fills the sheet down to the bottom margin");

      // pixel check on the real PNG: the zone is filled with photo content, not a grid of empty bordered cells
      const result = await generateCustomerCatalogPng(catalogProduct.id);
      assert(result.ok, "generated");
      const raw = await sharp(result.png).raw().toBuffer({ resolveWithObject: true });
      const origin = tableOrigin(layout, 0);
      const x0 = origin.x + zone.firstColumn * table.columnWidth;
      const y0 = origin.y + table.titleHeight + layout.headHeight + table.rowHeights.slice(0, zone.topRows).reduce((sum, value) => sum + value, 0);
      const at = (x: number, y: number): [number, number, number] => {
        const offset = (y * raw.info.width + x) * raw.info.channels;
        return [raw.data[offset]!, raw.data[offset + 1]!, raw.data[offset + 2]!];
      };
      let nonWhite = 0;
      let samples = 0;
      let worstBlackRow = 0;
      for (let y = y0 + 8; y < y0 + zone.height - 8; y += 2) {
        let blackInRow = 0;
        for (let x = x0 + 8; x < x0 + zone.width - 8; x += 2) {
          const [r, g, b] = at(x, y);
          samples += 1;
          if (r < 245 || g < 245 || b < 245) nonWhite += 1;
          if (r < 70 && g < 70 && b < 70) blackInRow += 1;
        }
        worstBlackRow = Math.max(worstBlackRow, blackInRow / ((zone.width - 16) / 2));
      }
      assert(nonWhite / samples > 0.5, `the zone is covered by photos (${Math.round((nonWhite / samples) * 100)}% non-white)`);
      assert(worstBlackRow < 0.5, `no full-width grid line runs through the photo zone (worst row ${Math.round(worstBlackRow * 100)}% black)`);
    });

    await check("5,6. generic labels (شفاف / مشكل / مشكّل / assorted) never reach the customer layout", async () => {
      const { layout } = await layoutFor(deviceProduct.id);
      assert(layout, "device layout built");
      const text = JSON.stringify(layout);
      for (const word of ["شفاف", "مشكل", "مشكّل", "assorted", "generic"]) assert(!text.includes(word), `"${word}" is not in the layout`);
      assert(normalizeCustomerLabel("مشكّل") === "مشكل", "tashkeel is normalised");
      for (const label of ["شفاف", "مشكل", "مشكّل", " Assorted ", "GENERIC", "mixed", ""]) assert(isGenericCustomerLabel(label), `"${label}" is generic`);
      for (const label of ["Black", "أسود", "Blue", "شفاف أسود"]) assert(!isGenericCustomerLabel(label), `"${label}" is a real color`);
    });

    await check("7. title band shows the REAL product name (even with شفاف / مشكل in it) and nothing else: no brand line, SKU, date or quantities", async () => {
      const { layout, sheet } = await layoutFor(catalogProduct.id, 3);
      assert(layout, "layout built");
      const title = layout.tables[0]!.title;
      assert(title && title.lines.join(" ") === "كفر شفاف مشكل للهواتف", `title is the real product name, got "${title?.lines.join(" ")}"`);
      assert(layout.tables.slice(1).every((table) => table.title === null), "only the first table has the title band");
      const json = JSON.stringify(layout);
      assert(!json.includes(sheet.product.sku) && !/OVI MOBILE/i.test(json) && !/جرد الصنف/.test(json), "no SKU, no Ovi Mobile header, no admin wording");
      const source = fs.readFileSync(new URL("../src/lib/inventory-customer-image.ts", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      assert(!/OVI MOBILE|toLocale|new Date\(|\.sku/.test(source.replace("sku: sheet.product.sku", "")), "the renderer draws no brand line, date or SKU");
    });

    await check("8. DEVICE_MODEL_COLOR: real colors kept, generic ones dropped, color-less models stay as models, wh 3 excluded", async () => {
      const { layout } = await layoutFor(deviceProduct.id);
      assert(layout, "layout built");
      const byModel = new Map(cellsOf(layout).map((cell) => [modelText(cell), cell.colors ? labelOf(cell.colors) : null]));
      assert(byModel.get("DM1 Black+Clear") === "Black", `DM1 keeps only Black, got ${byModel.get("DM1 Black+Clear")}`);
      assert(byModel.has("DM2 OnlyClear") && byModel.get("DM2 OnlyClear") === null, "a model whose only color is شفاف is listed with no color");
      assert(byModel.has("DM3 OnlyMixed") && byModel.get("DM3 OnlyMixed") === null, "a model whose only colors are مشكل / مشكّل is listed with no color");
      assert(!byModel.has("DM4 Blue wh3"), "warehouse 3 still excluded");
      const dm5 = byModel.get("DM5 BlueBlack");
      assert(dm5 !== null && dm5 !== undefined && dm5.includes("Blue") && dm5.includes("Black") && !dm5.includes("شفاف"), `DM5 shows its two real colors, got ${dm5}`);
      const { layout: compatLayout } = await layoutFor(catalogProduct.id);
      assert(compatLayout && cellsOf(compatLayout).every((cell) => cell.colors === null), "compatibility products show model only");
    });

    await check("9,10. photos: IMAGE rows only, main first then sortOrder, no duplicates, max 3; the primary photo is the largest and first", async () => {
      const rows = await prisma.productImage.findMany({ where: { productId: catalogProduct.id }, select: { url: true, mediaType: true, isMain: true, sortOrder: true } });
      const picked = selectCustomerImageUrls(rows);
      assert(JSON.stringify(picked) === JSON.stringify([photoA, photoB, photoC]), `expected main, then sortOrder, no video/duplicate/4th; got ${JSON.stringify(picked)}`);
      assert(JSON.stringify(selectCustomerImageUrls([...rows].reverse())) === JSON.stringify(picked), "selection does not depend on row order");
      assert(selectCustomerImageUrls([{ url: "x", mediaType: "VIDEO", isMain: true, sortOrder: 0 }]).length === 0, "videos are never used");
      const { layout } = await layoutFor(catalogProduct.id, 3);
      assert(layout && layout.tables[0]!.zone!.boxes[0]!.imageIndex === 0 && layout.imageBoxes.length === 3, "image 0 (the main photo) takes the first, largest box");
      const full = await generateCustomerCatalogPng(catalogProduct.id);
      assert(full.ok && full.imageCount === 3, `3 photos used end to end, got ${full.ok ? full.imageCount : full.reason}`);
      assert(chooseImageFit(900, 1100, 540, 600) === "cover" && chooseImageFit(800, 800, 540, 200) === "contain", "photos are cropped only when close to the box shape, otherwise contained (never stretched)");
      const one = buildCustomerCatalogLayout({ sheet: (await layoutFor(catalogProduct.id)).sheet, imageCount: 1 });
      assert(one && one.tables[0]!.zone!.boxes.length === 1 && one.imageBoxes.length === 1, "a single photo is used once, never duplicated");
    });

    await check("11. no image -> a valid A4 PNG, no photo zone, no placeholder, no blank grid", async () => {
      const result = await generateCustomerCatalogPng(noImage.id);
      assert(result.ok && result.imageCount === 0, "generated without images");
      const info = png(result.png);
      assert(info.signature === "PNG" && info.width === 1240 && info.height === 1754, `A4 PNG, got ${JSON.stringify(info)}`);
      const { layout } = await layoutFor(noImage.id, 0);
      assert(layout && layout.tables.every((table) => table.zone === null) && layout.imageBoxes.length === 0, "no zone without photos");
      assert(layout.tables[0]!.columns.every((column) => column.tailRows <= layout.tables[0]!.rowCount), "unused rows are merged blank tails, not cells");
    });

    await check("12. the canvas NEVER grows: 45 rows fit normally, 75 rows fit only by tightening (COMPACT), 95 rows return the controlled TOO_LARGE state", async () => {
      const result = await generateCustomerCatalogPng(longProduct.id);
      assert(result.ok, "generated");
      const info = png(result.png);
      const { layout } = await layoutFor(longProduct.id, 1);
      assert(layout, "layout built");
      assert(info.width === 1240 && info.height === 1754 && layout.density === "NORMAL", `one A4 sheet, got ${JSON.stringify(info)}`);
      assert(cellsOf(layout).length === 90 && layout.tables.length === 1 && layout.tables[0]!.rowCount === 45, "all 90 models in one 45-row table (no pagination)");
      assert(layout.rowHeight >= 30 && layout.rowFontSize >= 19, `rows stay comfortable at 45 rows, got ${layout.rowHeight}px / ${layout.rowFontSize}px font`);
      const raw = await sharp(result.png).raw().toBuffer({ resolveWithObject: true });
      const bottom = (y: number) => [raw.data[(y * raw.info.width + 5) * raw.info.channels]!, raw.data[(y * raw.info.width + 5) * raw.info.channels + 1]!, raw.data[(y * raw.info.width + 5) * raw.info.channels + 2]!];
      assert(bottom(info.height - 5).every((value) => value === 255), "white bottom margin (nothing clipped, no footer)");

      // 75 rows: too many for NORMAL chrome, still legible in COMPACT — and still exactly A4
      const dense = await generateCustomerCatalogPng(denseProduct.id);
      const { layout: denseLayout } = await layoutFor(denseProduct.id, 1);
      assert(dense.ok && denseLayout, "dense generated");
      const denseInfo = png(dense.png);
      assert(denseLayout.density === "COMPACT" && denseLayout.rowHeight >= 20 && denseLayout.rowFontSize >= 13, `75 rows tighten to COMPACT with readable rows, got ${denseLayout.density} ${denseLayout.rowHeight}px/${denseLayout.rowFontSize}px`);
      assert(denseInfo.width === 1240 && denseInfo.height === 1754, `still exactly A4, got ${JSON.stringify(denseInfo)}`);

      // 95 rows: cannot fit legibly -> controlled failure, NO image, NEVER a taller canvas
      const sheet = (await layoutFor(hugeProduct.id)).sheet;
      const plan = planCustomerCatalog({ sheet, imageCount: 1 });
      assert(plan.status === "TOO_LARGE" && plan.longestColumn === 95 && plan.capacity < 95, `95 rows -> TOO_LARGE, got ${JSON.stringify(plan)}`);
      assert(buildCustomerCatalogLayout({ sheet, imageCount: 1 }) === null, "no layout is produced for a product that cannot fit");
      const huge = await generateCustomerCatalogPng(hugeProduct.id);
      assert(!huge.ok && huge.reason === "TOO_LARGE", "the generator reports TOO_LARGE and returns no PNG at all");
      const route = fs.readFileSync(new URL("../src/app/admin/inventory/overview/product/[productId]/customer-image/route.ts", import.meta.url), "utf8");
      assert(route.includes('"TOO_LARGE"') && route.includes("422"), "the route answers 422 for TOO_LARGE");
      // no code path can produce another size
      const catalogSource = fs.readFileSync(new URL("../src/lib/inventory-customer-catalog.ts", import.meta.url), "utf8");
      const imageSource = fs.readFileSync(new URL("../src/lib/inventory-customer-image.ts", import.meta.url), "utf8");
      assert(!/MULTI_PAGE|fallback:|pageHeight|pages \*|3508/.test(catalogSource + imageSource), "no multi-page / growing-canvas code path exists");
      assert(/readUInt32BE\(20\) !== CATALOG_PAGE\.height/.test(imageSource) && imageSource.includes("height: CATALOG_PAGE.height"), "the renderer hard-codes the A4 size and verifies the PNG header");
    });

    await check("A4-ALL. EVERY rendered customer PNG is exactly 1240x1754 — and a failed fit renders nothing", async () => {
      let rendered = 0;
      for (const id of allProductIds) {
        const result = await generateCustomerCatalogPng(id);
        if (!result.ok) {
          assert(result.reason === "NO_MODELS" || result.reason === "TOO_LARGE", "only the controlled failure states exist");
          continue;
        }
        const info = png(result.png);
        assert(info.signature === "PNG" && info.width === 1240 && info.height === 1754, `product ${id} rendered ${info.width}x${info.height}`);
        assert(result.width === 1240 && result.height === 1754, "the result metadata says A4 too");
        rendered += 1;
      }
      assert(rendered === 6, `6 supported products rendered, got ${rendered}`);
    });

    await check("13. short products still fill the sheet; very long lists keep readable rows instead of squeezing in a photo", async () => {
      const { layout } = await layoutFor(shortProduct.id, 2);
      assert(layout && layout.height === 1754, "A4");
      const table = layout.tables[0]!;
      assert(table.zone && table.zone.kind === "COLUMNS" && table.zone.columnCount === 1 && table.zone.firstColumn === 0, "the photo zone sits under the short APPLE column");
      assert(table.height + layout.marginTop * 2 === 1754 && table.extraHeight > 0, "leftover page height goes to the photo zone (no blank footer)");
      assert(table.zone.boxes.length === 2, "both photos fit the tall zone");
      const dense = await layoutFor(longProduct.id, 1);
      assert(dense.layout && dense.layout.rowHeight >= 30, "45 rows + a photo keep 30px+ rows (photo area only when rows stay comfortable)");
      const crowded = buildCustomerCatalogLayout({ sheet: (await layoutFor(longProduct.id)).sheet, imageCount: 0 });
      assert(crowded, "layout without photo");
      const sixty = { ...(await layoutFor(longProduct.id)).sheet };
      sixty.brands = sixty.brands.map((brand) => ({ ...brand, models: [...brand.models, ...Array.from({ length: 15 }, (_, i) => ({ modelId: `x${brand.brandId}${i}`, label: `Extra ${i}`, colors: [] }))] }));
      const withPhoto = buildCustomerCatalogLayout({ sheet: sixty, imageCount: 2 });
      assert(withPhoto && withPhoto.height === 1754 && withPhoto.rowHeight >= 22 && withPhoto.tables.every((table) => table.zone === null), "60 rows: no photo area is squeezed in, rows stay readable on one A4");
    });

    await check("14. no quantities: nothing numeric from stock reaches the layout; simple / empty products produce no catalog", async () => {
      const { layout } = await layoutFor(catalogProduct.id, 3);
      assert(layout, "layout built");
      const json = JSON.stringify(layout);
      assert(!json.split("iPhone Big4321").join("").includes("4321"), "the stock figure 4321 appears nowhere except inside that model's own name");
      assert(cellsOf(layout).map(modelText).includes("iPhone Big4321"), "the model with 4321 in stock is listed by name only");
      assert(!/quantity|simpleWarehouseQuantity|byLocation/i.test(json), "layout has no quantity fields");
      assert((await layoutFor(simple.id)).layout === null, "a simple stock product has no model choices");
      assert((await layoutFor(lowStock.id)).layout === null, "nothing >= 5 -> no catalog");
      const none = await generateCustomerCatalogPng(lowStock.id);
      assert(!none.ok && none.reason === "NO_MODELS", "route-level result is NO_MODELS (HTTP 409)");
      const missing = await generateCustomerCatalogPng(`${runId}-missing`);
      assert(!missing.ok && missing.reason === "NOT_FOUND", "unknown id is NOT_FOUND (HTTP 404)");
    });

    await check("15. ADMIN-only route (401 without a session, 403 for any non-ADMIN role) and a modal action that never prefetches", async () => {
      const route = fs.readFileSync(new URL("../src/app/admin/inventory/overview/product/[productId]/customer-image/route.ts", import.meta.url), "utf8");
      assert(route.includes("getSession()") && route.includes('"Unauthorized", 401') && route.includes("user.role !== ROLES.ADMIN") && route.includes('"Forbidden", 403'), "session + ADMIN gate with 401/403");
      assert(route.indexOf("user.role !== ROLES.ADMIN") < route.indexOf("generateCustomerCatalogPng("), "the gate runs before anything is generated");
      assert(!route.includes("export const runtime = \"edge\""), "node runtime");
      const modal = fs.readFileSync(new URL("../src/components/admin/inventory/CompanyInventoryOverview.tsx", import.meta.url), "utf8");
      assert(modal.includes("/customer-image?download=1") && modal.includes("صورة للزبون") && modal.includes("/availability") && modal.includes("/print"), "third action present next to the two existing ones");
      const anchorAt = modal.lastIndexOf("<a", modal.indexOf("customer-image?download=1"));
      assert(anchorAt > modal.lastIndexOf("<Link", modal.indexOf("customer-image?download=1")), "plain <a>, not next/link (a PNG endpoint must never be prefetched)");
    });

    await check("16. read-only: generating every catalog changes no inventory, movement, variant or product row; no write calls in the new code", async () => {
      const before = await snapshot();
      for (const id of allProductIds) await generateCustomerCatalogPng(id);
      const after = await snapshot();
      assert(before === after, `database changed:\n${before}\n${after}`);
      const sources = [
        fs.readFileSync(new URL("../src/lib/inventory-customer-catalog.ts", import.meta.url), "utf8"),
        fs.readFileSync(new URL("../src/lib/inventory-customer-image.ts", import.meta.url), "utf8"),
        fs.readFileSync(new URL("../src/app/admin/inventory/overview/product/[productId]/customer-image/route.ts", import.meta.url), "utf8"),
      ]
        .join("\n")
        // code only: comments legitimately explain what is NOT read
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      assert(!/\.(create|createMany|update|updateMany|delete|deleteMany|upsert)\(|\$executeRaw|\$queryRawUnsafe|[sS]tockMovement/.test(sources), "no Prisma write calls and no StockMovement in the new code");
      assert(!/Product\.stock|\.stock\b/.test(sources) && !/REP_CAR/.test(sources), "no Product.stock and REP_CAR is never referenced in code");
    });

    await check("17. PNG response: image/png + attachment filename, non-empty A4 image, safe file names", async () => {
      const route = fs.readFileSync(new URL("../src/app/admin/inventory/overview/product/[productId]/customer-image/route.ts", import.meta.url), "utf8");
      assert(route.includes('"Content-Type": "image/png"') && route.includes("attachment") && route.includes("customerImageFilename"), "route sets content type and a download name");
      const result = await generateCustomerCatalogPng(catalogProduct.id);
      assert(result.ok && result.png.byteLength > 20_000, "non-empty PNG bytes");
      const info = png(result.png);
      assert(info.signature === "PNG" && info.width === 1240 && info.height === 1754, "PNG signature, A4");
      assert(customerImageFilename("OVI177") === "OVI177-models.png", "plain SKU");
      assert(customerImageFilename('../we ird"/SKU:1') === "we_ird_SKU_1-models.png", "unsafe characters are neutralised");
      assert(customerImageFilename("") === "product-models.png", "empty SKU falls back");
    });

    await check("18. right-to-left + single-line fitting: Arabic words are separate items, an exceptional long name shrinks ALONE and never wraps", async () => {
      assert(JSON.stringify(splitBidiItems("كفر iPhone 12 Pro مجسيف")) === JSON.stringify(["كفر", "iPhone 12 Pro", "مجسيف"]), "mixed run order");
      assert(JSON.stringify(splitBidiItems("جير فور")) === JSON.stringify(["جير", "فور"]), "arabic words are separate items");
      assert(JSON.stringify(splitBidiItems("iPhone 12 Pro Max")) === JSON.stringify(["iPhone 12 Pro Max"]), "latin text is one item");
      assert(hasArabic("ايفون") && hasArabic("ﻣﺮﺣﺒﺎ") && !hasArabic("Redmi"), "arabic detection (incl. presentation forms)");
      assert(fitSingleLine("A03", 265, 20) === 20, "a short model keeps the full row font");
      for (const text of ["iPhone 14 Pro Max Plus Limited Edition", "Redmi-Note-12-Pro-Plus-5G-Global"]) {
        const size = fitSingleLine(text, 265, 20);
        assert(size < 20 && size >= 12 && estimateTextWidth(text, size) <= 265 + 0.5, `"${text}" shrinks to fit ONE line (${size}px)`);
      }
      const { sheet } = await layoutFor(catalogProduct.id);
      const odd = { ...sheet, brands: [{ brandId: "b", label: "B", models: [{ modelId: "1", label: "A03", colors: [] }, { modelId: "2", label: "Redmi-Note-12-Pro-Plus-5G-Global", colors: [] }] }, { brandId: "c", label: "C", models: [{ modelId: "3", label: "S24", colors: [] }] }, { brandId: "d", label: "D", models: [{ modelId: "4", label: "P40", colors: [] }] }, { brandId: "e", label: "E", models: [{ modelId: "5", label: "X1", colors: [] }] }] };
      const oddLayout = buildCustomerCatalogLayout({ sheet: odd, imageCount: 0 });
      assert(oddLayout, "odd layout");
      const [short, long] = oddLayout.tables[0]!.columns[0]!.cells;
      assert(short!.fontSize === oddLayout.rowFontSize && long!.fontSize < oddLayout.rowFontSize, "only the exceptional name is smaller; the others keep the table font");
    });

    console.log("ALL PASS");
  } finally {
    for (const file of tempFiles) fs.rmSync(file, { force: true });
    await prisma.inventoryItem.deleteMany({ where: { productId: { in: allProductIds } } });
    await prisma.productImage.deleteMany({ where: { productId: { in: allProductIds } } });
    await prisma.deviceColorVariant.deleteMany({ where: { productId: { in: allProductIds } } });
    await prisma.productVariant.deleteMany({ where: { productId: { in: allProductIds } } });
    await prisma.product.deleteMany({ where: { id: { in: allProductIds } } });
    await prisma.color.deleteMany({ where: { OR: [{ name: { startsWith: runId } }, { id: { in: createdColorIds } }] } });
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
