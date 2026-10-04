/**
 * Real-database verification for the customer-facing catalog IMAGE ("صورة
 * للزبون", src/lib/inventory-customer-catalog.ts + inventory-customer-image.ts,
 * GET /admin/inventory/overview/product/[productId]/customer-image).
 *
 * The image is built from the existing warehouse-only availability sheet
 * (>= 5 in WAREHOUSE locations, REP_CAR never read), shows only brand + model
 * (+ real colors for DEVICE_MODEL_COLOR), never a quantity, and is a pure
 * read: nothing is written anywhere.
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
  const { buildCustomerCatalogLayout, selectCustomerImageUrls, isGenericCustomerLabel, normalizeCustomerLabel, splitBidiItems, hasArabic, fitText, estimateTextWidth, customerImageFilename, CUSTOMER_IMAGE_WIDTH } = catalog;
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

  const brandNames = ["IPHONE", "TECNO", "REDMI", "SAMSUNG"];
  const brands: Record<string, { id: string }> = {};
  for (const [index, name] of brandNames.entries()) {
    brands[name] = await prisma.phoneBrand.create({ data: { name: `${runId}-${name}`, slug: `${runId}-${name.toLowerCase()}`, sortOrder: index + 1 } });
  }
  let modelOrder = 0;
  async function model(brand: string, name: string) {
    modelOrder += 1;
    return prisma.phoneModel.create({ data: { phoneBrandId: brands[brand]!.id, name: `${runId} ${name}`, slug: `${runId}-m${modelOrder}`, sortOrder: modelOrder } });
  }
  async function colorNamed(name: string) {
    const existing = await prisma.color.findFirst({ where: { name } });
    return existing ? { color: existing, created: false } : { color: await prisma.color.create({ data: { name, hexCode: "#cccccc" } }), created: true };
  }
  const createdColorIds: string[] = [];
  async function color(name: string) {
    const { color: row, created } = await colorNamed(name);
    if (created) createdColorIds.push(row.id);
    return row;
  }
  const clear = await color("شفاف");
  const mixed = await color("مشكل");
  const mixedShadda = await color("مشكّل");
  const black = await color(`${runId}-Black`);
  const blue = await color(`${runId}-Blue`);

  async function photo(name: string, bg: string): Promise<string> {
    fs.mkdirSync(publicDir, { recursive: true });
    const file = `_verify-${runId}-${name}.png`;
    await sharp({ create: { width: 640, height: 800, channels: 3, background: bg } }).png().toFile(path.join(publicDir, file));
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

  // A) PHONE_COMPATIBILITY, 4 brands, product name that contains the generic words, 3 photos + 1 video + 1 duplicate URL
  const photoA = await photo("a", "#18B7D3");
  const photoB = await photo("b", "#E85D75");
  const photoC = await photo("c", "#F59E0B");
  const photoD = await photo("d", "#10B981");
  const catalogProduct = await product("catalog", "COMPAT", "كفر شفاف مشكل للهواتف");
  for (const name of ["iPhone 11", "iPhone 12", "iPhone 13", "iPhone 14"]) await compatModel(catalogProduct.id, "IPHONE", name, 12, 800);
  await compatModel(catalogProduct.id, "IPHONE", "iPhone 4Q", 4, 1000); //   wh 4  + REP_CAR 1000 -> absent
  await compatModel(catalogProduct.id, "IPHONE", "iPhone 5Q", 5, 0); //      wh 5                 -> present
  await compatModel(catalogProduct.id, "IPHONE", "iPhone CarOnly", 0, 900); // REP_CAR only        -> absent
  await compatModel(catalogProduct.id, "IPHONE", "iPhone Big4321", 4321, 0); // exposes no quantity
  for (const name of ["Spark 8", "Spark 10"]) await compatModel(catalogProduct.id, "TECNO", name, 7);
  for (let i = 1; i <= 9; i++) await compatModel(catalogProduct.id, "REDMI", `Redmi ${i}`, 9);
  for (let i = 1; i <= 12; i++) await compatModel(catalogProduct.id, "SAMSUNG", `A${String(i).padStart(2, "0")}`, 15);
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
  const m1 = await model("IPHONE", "DM1 Black+Clear");
  const m2 = await model("IPHONE", "DM2 OnlyClear");
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
  await compatModel(noImage.id, "IPHONE", "iPhone 11", 6);
  await compatModel(noImage.id, "SAMSUNG", "S21", 6);

  // D) long list: 2 brands x 45 models + one photo
  const longProduct = await product("long", "COMPAT", "قائمة طويلة");
  for (let i = 1; i <= 45; i++) await compatModel(longProduct.id, "IPHONE", `iPhone ${i} Pro Max`, 10);
  for (let i = 1; i <= 45; i++) await compatModel(longProduct.id, "SAMSUNG", `Galaxy S${i} Ultra`, 10);
  await prisma.productImage.create({ data: { productId: longProduct.id, url: photoA, mediaType: "IMAGE", isMain: true, sortOrder: 0 } });

  // E) simple product + nothing >= 5
  const simple = await product("simple", "SIMPLE", "منتج بسيط");
  await stock(simple.id, wh.id, 20);
  const lowStock = await product("low", "COMPAT", "مخزون منخفض");
  await compatModel(lowStock.id, "IPHONE", "iPhone 11", 4, 900);

  const allProductIds = [catalogProduct, deviceProduct, noImage, longProduct, simple, lowStock].map((p) => p.id);

  async function layoutFor(productId: string, imageCount = 0) {
    const sheet = await loadProductAvailabilitySheet(productId);
    assert(sheet, "sheet exists");
    return { sheet, layout: buildCustomerCatalogLayout({ sheet, imageCount }) };
  }
  const cellsOf = (layout: NonNullable<ReturnType<typeof buildCustomerCatalogLayout>>) =>
    layout.tables.flatMap((table) => table.rows.flat()).filter((cell): cell is NonNullable<typeof cell> => cell !== null);
  const modelText = (cell: { model: { lines: string[] } }) => labelOf(cell.model.lines.join(" "));
  const png = (buffer: Buffer) => ({ signature: buffer.subarray(1, 4).toString("latin1"), width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) });

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
      assert(models.includes("iPhone 11") && models.includes("Redmi 9") && models.includes("A12"), "qualifying models appear");
    });

    await check("4. brand columns: 4 brands -> ONE table with 4 equal columns; 5 -> 3+2; 6 -> 3+3; 7 -> 4+3; 9 -> 3+3+3; never a lone column", async () => {
      const { sheet, layout } = await layoutFor(catalogProduct.id);
      assert(layout && layout.tables.length === 1 && layout.tables[0]!.brands.length === 4, "4 brands share one 4-column table");
      assert(layout.tables[0]!.columnWidth * 4 === layout.tables[0]!.width, "columns are equal width");
      assert(layout.tables[0]!.brands.map((brand) => labelOf(brand.text.lines.join(" "))).join(",") === "IPHONE,TECNO,REDMI,SAMSUNG", "configured brand order kept (not hardcoded, not re-sorted)");
      const fakeSheet = (n: number) => ({
        ...sheet,
        brands: Array.from({ length: n }, (_, i) => ({ brandId: `b${i}`, label: `B${i}`, models: [{ modelId: `m${i}`, label: `M${i}`, colors: [] }] })),
      });
      const widths = (n: number) => buildCustomerCatalogLayout({ sheet: fakeSheet(n), imageCount: 0 })!.tables.map((table) => table.brands.length).join("+");
      assert(widths(1) === "1" && widths(2) === "2" && widths(3) === "3" && widths(4) === "4", "1-4 brands: a single table");
      assert(widths(5) === "3+2" && widths(6) === "3+3" && widths(7) === "4+3" && widths(9) === "3+3+3", "5+ brands: balanced sections");
      assert(buildCustomerCatalogLayout({ sheet: fakeSheet(1), imageCount: 0 })!.tables[0]!.width < CUSTOMER_IMAGE_WIDTH, "a single brand is a centered narrower table");
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

    await check("7. a product NAME containing شفاف / مشكل is kept exactly (only per-model color metadata is cleaned)", async () => {
      const { layout } = await layoutFor(catalogProduct.id);
      assert(layout, "layout built");
      assert(layout.title.lines.join(" ") === "كفر شفاف مشكل للهواتف", `title is the real product name, got "${layout.title.lines.join(" ")}"`);
    });

    await check("8. DEVICE_MODEL_COLOR: real colors kept, generic ones dropped, color-less models stay as models, wh 3 excluded", async () => {
      const { layout } = await layoutFor(deviceProduct.id);
      assert(layout, "layout built");
      const cells = cellsOf(layout);
      const byModel = new Map(cells.map((cell) => [modelText(cell), cell.colors ? labelOf(cell.colors.lines.join(" ")) : null]));
      assert(byModel.get("DM1 Black+Clear") === "Black", `DM1 keeps only Black, got ${byModel.get("DM1 Black+Clear")}`);
      assert(byModel.has("DM2 OnlyClear") && byModel.get("DM2 OnlyClear") === null, "a model whose only color is شفاف is listed with no color line");
      assert(byModel.has("DM3 OnlyMixed") && byModel.get("DM3 OnlyMixed") === null, "a model whose only colors are مشكل / مشكّل is listed with no color line");
      assert(!byModel.has("DM4 Blue wh3"), "warehouse 3 still excluded");
      const dm5 = byModel.get("DM5 BlueBlack");
      assert(dm5 !== null && dm5 !== undefined && dm5.includes("Blue") && dm5.includes("Black") && !dm5.includes("شفاف"), `DM5 shows its two real colors, got ${dm5}`);
      // PHONE_COMPATIBILITY never shows a color line
      const { layout: compatLayout } = await layoutFor(catalogProduct.id);
      assert(compatLayout && cellsOf(compatLayout).every((cell) => cell.colors === null), "compatibility products show model only");
    });

    await check("9,10. images: IMAGE rows only, main first then sortOrder, no duplicates, max 3; the primary photo is placed in the layout", async () => {
      const rows = await prisma.productImage.findMany({ where: { productId: catalogProduct.id }, select: { url: true, mediaType: true, isMain: true, sortOrder: true } });
      const picked = selectCustomerImageUrls(rows);
      assert(JSON.stringify(picked) === JSON.stringify([photoA, photoB, photoC]), `expected main, then sortOrder, no video/duplicate/4th; got ${JSON.stringify(picked)}`);
      assert(JSON.stringify(selectCustomerImageUrls([...rows].reverse())) === JSON.stringify(picked), "selection does not depend on row order");
      assert(selectCustomerImageUrls([{ url: "x", mediaType: "VIDEO", isMain: true, sortOrder: 0 }]).length === 0, "videos are never used");
      const { layout } = await layoutFor(catalogProduct.id, 3);
      assert(layout, "layout built");
      const used = [layout.slotImageIndex, ...(layout.collage?.boxes.map((box) => box.imageIndex) ?? [])].filter((index) => index !== null).sort();
      assert(JSON.stringify(used) === "[0,1,2]", `all three photos have a place, got ${JSON.stringify(used)}`);
      assert(layout.slotImageIndex === 0 || layout.collage?.boxes.some((box) => box.imageIndex === 0), "the primary photo (index 0) is placed");
      const full = await generateCustomerCatalogPng(catalogProduct.id);
      assert(full.ok && full.imageCount === 3, `3 photos used end to end, got ${full.ok ? full.imageCount : full.reason}`);
    });

    await check("11. no image -> a valid PNG with no placeholder", async () => {
      const result = await generateCustomerCatalogPng(noImage.id);
      assert(result.ok && result.imageCount === 0, "generated without images");
      const info = png(result.png);
      assert(info.signature === "PNG" && info.width === CUSTOMER_IMAGE_WIDTH && info.height > 300, `valid PNG, got ${JSON.stringify(info)}`);
      const { layout } = await layoutFor(noImage.id, 0);
      assert(layout && layout.slotImageIndex === null && layout.collage === null, "no slot and no collage without photos");
      assert(info.height === layout.height, "canvas height equals the computed layout height");
    });

    await check("12. long list -> ONE tall PNG whose height matches the layout, last row + footer intact (nothing clipped)", async () => {
      const result = await generateCustomerCatalogPng(longProduct.id);
      assert(result.ok, "generated");
      const info = png(result.png);
      const { layout } = await layoutFor(longProduct.id, 1);
      assert(layout, "layout built");
      assert(info.width === CUSTOMER_IMAGE_WIDTH && info.height === layout.height && info.height > 3000, `one tall image, got ${JSON.stringify(info)} vs layout ${layout.height}`);
      assert(cellsOf(layout).length === 90, "all 90 models are laid out");
      assert(layout.tables.length === 1 && layout.tables[0]!.rowHeights.length === 45, "45 rows in a single table (no pagination)");
      const raw = await sharp(result.png).raw().toBuffer({ resolveWithObject: true });
      const pixel = (x: number, y: number) => {
        const offset = (y * raw.info.width + x) * raw.info.channels;
        return [raw.data[offset]!, raw.data[offset + 1]!, raw.data[offset + 2]!];
      };
      const [r, g, b] = pixel(5, info.height - 5);
      assert(r === 8 && g === 24 && b === 39, `the footer bar is the last thing drawn at the bottom edge, got ${[r, g, b]}`);
      const above = pixel(5, info.height - layout.footerBarHeight - 10);
      assert(above[0] === 255 && above[1] === 255 && above[2] === 255, "white padding sits between the last table and the footer");
    });

    await check("13. no quantities: nothing numeric from stock reaches the layout; simple / empty products produce no catalog", async () => {
      const { layout } = await layoutFor(catalogProduct.id, 3);
      assert(layout, "layout built");
      const json = JSON.stringify(layout);
      assert(!json.split("iPhone Big4321").join("").includes("4321"), "the stock figure 4321 appears nowhere except inside that model's own name");
      const texts = cellsOf(layout).map(modelText);
      assert(texts.includes("iPhone Big4321"), "the model with 4321 in stock is listed by name only");
      assert(!/quantity|simpleWarehouseQuantity|byLocation/i.test(json), "layout has no quantity fields");
      assert((await layoutFor(simple.id)).layout === null, "a simple stock product has no model choices");
      assert((await layoutFor(lowStock.id)).layout === null, "nothing >= 5 -> no catalog");
      const none = await generateCustomerCatalogPng(lowStock.id);
      assert(!none.ok && none.reason === "NO_MODELS", "route-level result is NO_MODELS (HTTP 409)");
      const missing = await generateCustomerCatalogPng(`${runId}-missing`);
      assert(!missing.ok && missing.reason === "NOT_FOUND", "unknown id is NOT_FOUND (HTTP 404)");
    });

    await check("14. ADMIN-only route (401 without a session, 403 for any non-ADMIN role) and a modal action that never prefetches", async () => {
      const route = fs.readFileSync(new URL("../src/app/admin/inventory/overview/product/[productId]/customer-image/route.ts", import.meta.url), "utf8");
      assert(route.includes("getSession()") && route.includes('"Unauthorized", 401') && route.includes("user.role !== ROLES.ADMIN") && route.includes('"Forbidden", 403'), "session + ADMIN gate with 401/403");
      assert(route.indexOf("user.role !== ROLES.ADMIN") < route.indexOf("generateCustomerCatalogPng("), "the gate runs before anything is generated");
      assert(!route.includes("export const runtime = \"edge\""), "node runtime");
      const modal = fs.readFileSync(new URL("../src/components/admin/inventory/CompanyInventoryOverview.tsx", import.meta.url), "utf8");
      assert(modal.includes("/customer-image?download=1") && modal.includes("صورة للزبون") && modal.includes("/availability") && modal.includes("/print"), "third action present next to the two existing ones");
      const anchorAt = modal.lastIndexOf("<a", modal.indexOf("customer-image?download=1"));
      assert(anchorAt > modal.lastIndexOf("<Link", modal.indexOf("customer-image?download=1")), "plain <a>, not next/link (a PNG endpoint must never be prefetched)");
    });

    await check("15. read-only: generating every catalog changes no inventory, movement, variant or product row; no write calls in the new code", async () => {
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

    await check("16. PNG response: image/png + attachment filename, non-empty crisp 1080px-wide image, safe file names", async () => {
      const route = fs.readFileSync(new URL("../src/app/admin/inventory/overview/product/[productId]/customer-image/route.ts", import.meta.url), "utf8");
      assert(route.includes('"Content-Type": "image/png"') && route.includes("attachment") && route.includes("customerImageFilename"), "route sets content type and a download name");
      const result = await generateCustomerCatalogPng(catalogProduct.id);
      assert(result.ok && result.png.byteLength > 20_000, "non-empty PNG bytes");
      const info = png(result.png);
      assert(info.signature === "PNG" && info.width === 1080, "PNG signature, 1080 wide");
      assert(customerImageFilename("OVI177") === "OVI177-models.png", "plain SKU");
      assert(customerImageFilename('../we ird"/SKU:1') === "we_ird_SKU_1-models.png", "unsafe characters are neutralised");
      assert(customerImageFilename("") === "product-models.png", "empty SKU falls back");
    });

    await check("17. right-to-left + fitting helpers: Arabic words become separate display items, Latin runs stay whole, text never needs more width than the box", async () => {
      assert(JSON.stringify(splitBidiItems("كفر iPhone 12 Pro مجسيف")) === JSON.stringify(["كفر", "iPhone 12 Pro", "مجسيف"]), "mixed run order");
      assert(JSON.stringify(splitBidiItems("جير فور")) === JSON.stringify(["جير", "فور"]), "arabic words are separate items");
      assert(JSON.stringify(splitBidiItems("iPhone 12 Pro Max")) === JSON.stringify(["iPhone 12 Pro Max"]), "latin text is one item");
      assert(hasArabic("ايفون") && hasArabic("ﻣﺮﺣﺒﺎ") && !hasArabic("Redmi"), "arabic detection (incl. presentation forms)");
      for (const text of ["iPhone 14 Pro Max Plus Limited Edition", "Redmi-Note-12-Pro-Plus-5G-Global", "ايفون 12 برو ماكس", "A03"]) {
        for (const width of [222, 472]) {
          const block = fitText(text, width, { maxFontSize: 32, singleLineMinFontSize: 26, multiLineMinFontSize: 20, maxLines: 2 });
          assert(block.height === block.lines.length * block.lineHeight, "height covers every line");
          assert(block.lines.every((line) => line.split(" ").every((word) => estimateTextWidth(word, block.fontSize) <= width + 0.5)), `no word wider than the cell for "${text}" @${width}`);
        }
      }
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
