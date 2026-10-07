/**
 * Real-database verification for the printable "إرسالية مخزون سيارة المندوب"
 * (src/lib/rep-dispatch-note.ts, /admin/reps/[id]/dispatch-note).
 *
 * The note shows ONE row per product from the rep's own REP_CAR InventoryItem
 * rows with quantity > 0 and nothing else: no warehouse stock, no other rep's
 * car, no Product.stock, no movement sums. It is read-only.
 *
 * Safety rails via resolveVerifyDatabaseUrl (prisma/verify-guardrails.ts):
 * never runs against a shared/production database.
 *
 * Run with: node --conditions=react-server --import tsx prisma/verify-rep-dispatch-note.ts
 * REP_DISPATCH_NOTE_VERIFY_DATABASE_URL must point at a disposable localhost
 * PostgreSQL database whose name contains "verify".
 */

export {};

import { resolveVerifyDatabaseUrl } from "./verify-guardrails";

const resolved = resolveVerifyDatabaseUrl("REP_DISPATCH_NOTE_VERIFY_DATABASE_URL");
console.log(`[verify-rep-dispatch-note] target: ${resolved.masked}`);

process.env.DATABASE_URL = resolved.url;
process.env.DIRECT_URL = resolved.url;

async function main() {
  const fs = await import("node:fs");
  const [{ PrismaClient }, constants, dispatch, reps] = await Promise.all([
    import("@prisma/client"),
    import("../src/lib/constants"),
    import("../src/lib/rep-dispatch-note"),
    import("../src/lib/reps"),
  ]);
  const prisma = new PrismaClient();
  const { ROLES, STOCK_LOCATION_TYPES } = constants;
  const { loadRepDispatchNote, buildDispatchNoteRows, summarizeDispatchNote, formatDispatchReference, formatDispatchDate, formatDispatchTime } = dispatch;
  const { getRepStockStats } = reps;
  const runId = `verify-disp-${Date.now()}`;

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

  // ---------- fixtures ----------
  async function makeRep(label: string, withCar = true) {
    const user = await prisma.user.create({ data: { role: ROLES.SALES_REPRESENTATIVE, name: `${runId}-${label}`, email: `${runId}-${label}@example.invalid`, phone: `059${label.length}000000`, isActive: true } });
    const rep = await prisma.salesRepresentative.create({ data: { userId: user.id, employeeCode: `${runId}-${label}` } });
    const car = withCar ? await prisma.stockLocation.create({ data: { type: STOCK_LOCATION_TYPES.REP_CAR, name: `${runId}-car-${label}`, salesRepId: rep.id } }) : null;
    return { user, rep, car };
  }
  const warehouse = await prisma.stockLocation.create({ data: { type: STOCK_LOCATION_TYPES.WAREHOUSE, name: `${runId}-wh`, isDefault: false } });
  const catAccessories = await prisma.category.create({ data: { name: `${runId}-Accessories`, nameAr: `${runId}-إكسسوارات`, slug: `${runId}-acc` } });
  const catChargers = await prisma.category.create({ data: { name: `${runId}-Chargers`, nameAr: `${runId}-شواحن`, slug: `${runId}-chg` } });

  async function product(label: string, categoryId: string | null = null) {
    return prisma.product.create({ data: { sku: `${runId}-${label}`, name: `${runId}-${label}`, nameAr: `${runId}-منتج ${label}`, retailPriceCents: 1000, wholesalePriceCents: 800, isActive: true, categoryId } });
  }
  const A = await product("A", catAccessories.id);
  const B = await product("B", catAccessories.id);
  const C = await product("C", catChargers.id);
  const D = await product("D");
  const E = await product("E");
  const Z = await product("Z", catChargers.id); // zero quantity in the car
  const F = await product("F"); //                 warehouse only
  const G = await product("G"); //                 another rep's car only

  const rep1 = await makeRep("r1");
  const rep2 = await makeRep("r2");
  const emptyRep = await makeRep("empty");
  const noCarRep = await makeRep("nocar", false);

  const car = async (rep: { car: { id: string } | null }, productId: string, quantity: number) =>
    prisma.inventoryItem.create({ data: { productId, locationId: rep.car!.id, quantity } });
  await car(rep1, A.id, 26);
  await car(rep1, B.id, 42);
  await car(rep1, C.id, 65);
  await car(rep1, D.id, 23);
  await car(rep1, E.id, 35);
  await car(rep1, Z.id, 0);
  for (const p of [A, B, C, D, E, F]) await prisma.inventoryItem.create({ data: { productId: p.id, locationId: warehouse.id, quantity: 999 } });
  await car(rep2, A.id, 7);
  await car(rep2, G.id, 9);

  const fixtureProductIds = [A, B, C, D, E, Z, F, G].map((p) => p.id);
  async function snapshot() {
    const [items, qty, movements, batches, orders, products] = await Promise.all([
      prisma.inventoryItem.count(),
      prisma.inventoryItem.aggregate({ _sum: { quantity: true } }),
      prisma.stockMovement.count(),
      prisma.repStockTransferBatch.count(),
      prisma.order.count(),
      prisma.product.findMany({ where: { id: { in: fixtureProductIds } }, select: { id: true, updatedAt: true, isActive: true }, orderBy: { id: "asc" } }),
    ]);
    return JSON.stringify({ items, qty: qty._sum.quantity, movements, batches, orders, products });
  }

  try {
    await check("1-2. the reference fixture: A26 B42 C65 D23 E35 -> 5 items, 191 pieces, every quantity exact", async () => {
      const note = await loadRepDispatchNote(rep1.rep.id);
      assert(note, "note loaded");
      const bySku = new Map(note.rows.map((row) => [row.sku.replace(`${runId}-`, ""), row.quantity]));
      assert(JSON.stringify([...bySku].sort()) === JSON.stringify([["A", 26], ["B", 42], ["C", 65], ["D", 23], ["E", 35]]), `exact quantities, got ${JSON.stringify([...bySku])}`);
      assert(note.itemCount === 5, `5 distinct items, got ${note.itemCount}`);
      assert(note.totalPieces === 191, `191 pieces, got ${note.totalPieces}`);
      assert(note.totalPieces === note.rows.reduce((sum, row) => sum + row.quantity, 0), "the total is exactly the sum of the visible quantity cells");
      assert(note.itemCount === note.rows.length, "the item count is exactly the visible row count");
      assert(note.repName === `${runId}-r1` && note.employeeCode === `${runId}-r1` && note.carLocationName === `${runId}-car-r1`, "rep identity + car name come from the real records");
    });

    await check("3-4. only the rep's own REP_CAR counts: warehouse stock and another rep's car are ignored, in both directions", async () => {
      const note1 = (await loadRepDispatchNote(rep1.rep.id))!;
      const skus1 = note1.rows.map((row) => row.sku.replace(`${runId}-`, ""));
      assert(!skus1.includes("F") && !skus1.includes("G"), "no warehouse-only product and no other rep's product");
      assert(note1.rows.find((row) => row.sku.endsWith("-A"))!.quantity === 26, "A is 26 — not 26 + 999 (warehouse) and not 26 + 7 (the other rep)");
      const note2 = (await loadRepDispatchNote(rep2.rep.id))!;
      assert(JSON.stringify(note2.rows.map((row) => [row.sku.replace(`${runId}-`, ""), row.quantity]).sort()) === JSON.stringify([["A", 7], ["G", 9]]), "the other rep's note shows only their own car");
      assert(note2.itemCount === 2 && note2.totalPieces === 16, "the other rep's totals are their own");
    });

    await check("5-6. zero-quantity rows are excluded; negative / fractional / non-numeric quantities can never be displayed", async () => {
      const note = (await loadRepDispatchNote(rep1.rep.id))!;
      assert(!note.rows.some((row) => row.sku.endsWith("-Z")), "the zero row is not shown");
      assert(note.rows.every((row) => Number.isInteger(row.quantity) && row.quantity > 0), "every visible quantity is a positive integer");
      // the real schema: try to store a negative quantity
      let negativeStored = false;
      try {
        await prisma.inventoryItem.create({ data: { productId: G.id, locationId: rep1.car!.id, quantity: -5 } });
        negativeStored = true;
      } catch {
        negativeStored = false;
      }
      const afterNegative = (await loadRepDispatchNote(rep1.rep.id))!;
      assert(!afterNegative.rows.some((row) => row.sku.endsWith("-G")) && afterNegative.totalPieces === 191, `a negative row (${negativeStored ? "accepted by the DB" : "refused by the DB"}) never reaches the sheet`);
      if (negativeStored) await prisma.inventoryItem.deleteMany({ where: { productId: G.id, locationId: rep1.car!.id } });
      // the pure builder, with values the DB could never hold
      const raw = (productId: string, quantity: number, label = productId) => ({ productId, quantity, product: { sku: label, name: label, nameAr: null, category: null } });
      const rows = buildDispatchNoteRows([raw("p1", -3), raw("p2", 0), raw("p3", 2.5), raw("p4", Number.NaN), raw("p5", Number.POSITIVE_INFINITY), raw("p6", 4)]);
      assert(rows.length === 1 && rows[0]!.productId === "p6" && rows[0]!.quantity === 4, "negative, zero, fractional, NaN and Infinity are all dropped");
      const folded = buildDispatchNoteRows([raw("p1", 3, "x"), raw("p1", 4, "x"), raw("p2", 1, "y")]);
      assert(folded.length === 2 && folded.find((row) => row.productId === "p1")!.quantity === 7, "legacy per-variant rows of one product fold into ONE line (3 + 4)");
    });

    await check("7. totals match the canonical rep-car stats, and every total is derived from the visible rows", async () => {
      const note = (await loadRepDispatchNote(rep1.rep.id))!;
      const stats = await getRepStockStats(rep1.car!.id);
      assert(stats.distinctProducts === note.itemCount && stats.totalUnits === note.totalPieces, `getRepStockStats agrees (${stats.distinctProducts} / ${stats.totalUnits})`);
      const totals = summarizeDispatchNote(note.rows);
      assert(totals.itemCount === note.itemCount && totals.totalPieces === note.totalPieces, "summarize(visible rows) equals the note's own totals");
      const shuffled = [...note.rows].reverse();
      assert(summarizeDispatchNote(shuffled).totalPieces === 191, "the total does not depend on row order");
    });

    await check("8. deterministic order: category -> product name -> SKU, uncategorised last", async () => {
      const note = (await loadRepDispatchNote(rep1.rep.id))!;
      const order = note.rows.map((row) => row.sku.replace(`${runId}-`, ""));
      // الإكسسوارات (A, B) sort before شواحن (C) in Arabic collation; D, E have no category -> last
      assert(order.join(",") === "A,B,C,D,E", `expected A,B,C,D,E, got ${order.join(",")}`);
      assert(note.rows[0]!.categoryName?.endsWith("إكسسوارات") && note.rows[4]!.categoryName === null, "category names come from the data, uncategorised rows have none");
      const reversedInput = buildDispatchNoteRows(
        [E, D, C, B, A].map((p, index) => ({ productId: p.id, quantity: index + 1, product: { sku: p.sku, name: p.name, nameAr: p.nameAr, category: p === A || p === B ? { name: "Acc", nameAr: null } : p === C ? { name: "Chg", nameAr: null } : null } })),
      );
      assert(reversedInput.map((row) => row.sku.replace(`${runId}-`, "")).join(",") === "A,B,C,D,E", "input order never changes the output order");
      const numbered = buildDispatchNoteRows(["صنف 10", "صنف 2", "صنف 1", "صنف 11", "OVI 4", "OVI 10"].map((name, index) => ({ productId: `n${index}`, quantity: 1, product: { sku: name, name, nameAr: null, category: null } })));
      assert(numbered.map((row) => row.name).join("|") === "صنف 1|صنف 2|صنف 10|صنف 11|OVI 4|OVI 10", `names with numbers sort naturally (1, 2, 10, 11), got ${numbered.map((row) => row.name).join("|")}`);
    });

    await check("9-10. empty car, no car location, unknown rep: no error, 0 items / 0 pieces", async () => {
      const empty = (await loadRepDispatchNote(emptyRep.rep.id))!;
      assert(empty.rows.length === 0 && empty.itemCount === 0 && empty.totalPieces === 0 && empty.carLocationName === `${runId}-car-empty`, "empty car -> empty rows, zero totals");
      const noCar = (await loadRepDispatchNote(noCarRep.rep.id))!;
      assert(noCar.rows.length === 0 && noCar.itemCount === 0 && noCar.totalPieces === 0 && noCar.carLocationName === null, "a rep with no car location -> empty note, no car name");
      assert((await loadRepDispatchNote(`${runId}-missing`)) === null, "an unknown rep id -> null (the page 404s)");
    });

    await check("11. the display-only reference is deterministic, in Palestine business time", async () => {
      assert(formatDispatchReference("EMP-7", new Date("2026-01-15T10:30:00Z")) === "DISP-EMP-7-20260115-1230", "winter (+02)");
      assert(formatDispatchReference("EMP-7", new Date("2026-07-15T10:30:00Z")) === "DISP-EMP-7-20260715-1330", "summer (+03)");
      assert(formatDispatchReference("EMP-7", new Date("2026-07-15T21:30:00Z")) === "DISP-EMP-7-20260716-0030", "the business date rolls over at Palestine midnight, hour is 00 not 24");
      assert(formatDispatchDate(new Date("2026-07-15T21:30:00Z")) === "16/07/2026" && formatDispatchTime(new Date("2026-07-15T21:30:00Z")) === "00:30", "date/time use the same business clock");
      assert(/^DISP-/.test((await loadRepDispatchNote(rep1.rep.id, new Date("2026-03-02T08:00:00Z")))!.reference), "the loaded note carries it");
    });

    await check("12-13. read-only: loading every note changes no inventory, movement, transfer, order or product; no write calls, no Product.stock", async () => {
      const before = await snapshot();
      for (const rep of [rep1, rep2, emptyRep, noCarRep]) await loadRepDispatchNote(rep.rep.id);
      const after = await snapshot();
      assert(before === after, `the database changed:\n${before}\n${after}`);
      const sources = [read("../src/lib/rep-dispatch-note.ts"), read("../src/app/admin/reps/[id]/dispatch-note/page.tsx"), read("../src/components/reps/RepDispatchNoteView.tsx")].map(codeOnly).join("\n");
      assert(!/\.(create|createMany|update|updateMany|delete|deleteMany|upsert)\(|\$executeRaw|\$queryRawUnsafe|[sS]tockMovement|recordStockMovement|increment|decrement/.test(sources), "no write call, no StockMovement, no stock increment/decrement anywhere in the feature");
      assert(!/Product\.stock|\.stock\b|costCents|retailPriceCents|wholesalePriceCents/.test(sources), "no Product.stock and no price/cost data");
      assert(!/STOCK_LOCATION_TYPES\.WAREHOUSE|REP_ASSIGNMENT|stockMovement/.test(sources), "the warehouse and movement history are never read");
      assert(codeOnly(read("../src/lib/rep-dispatch-note.ts")).includes("type: STOCK_LOCATION_TYPES.REP_CAR, salesRepId: rep.id"), "the query is pinned to this rep's own REP_CAR location");
    });

    await check("14. ADMIN-only, linked from the admin rep page next to the inventory sheet, inventory sheet untouched", async () => {
      const page = read("../src/app/admin/reps/[id]/dispatch-note/page.tsx");
      assert(page.includes("requireRole([ROLES.ADMIN])") && page.indexOf("requireRole([ROLES.ADMIN])") < page.indexOf("loadRepDispatchNote("), "ADMIN gate runs before the data is loaded");
      assert(page.includes("notFound()") && page.includes("PrintInventorySheetButton") && page.includes("print:hidden"), "404 for an unknown rep; window.print() button hidden when printing");
      const repPage = read("../src/app/admin/reps/[id]/page.tsx");
      const sheetAt = repPage.indexOf("/inventory-sheet");
      const noteAt = repPage.indexOf("/dispatch-note");
      assert(sheetAt > 0 && noteAt > sheetAt && noteAt - sheetAt < 600 && repPage.includes("إرسالية السيارة"), "the 'إرسالية السيارة' button sits right after 'طباعة كشف الجرد'");
      assert(read("../src/app/admin/reps/[id]/inventory-sheet/page.tsx").includes("requireRole([ROLES.ADMIN])"), "the existing inventory sheet is still there, with the same gate");
    });

    console.log("ALL PASS");
  } finally {
    await prisma.inventoryItem.deleteMany({ where: { OR: [{ productId: { in: fixtureProductIds } }, { location: { name: { startsWith: runId } } }] } });
    await prisma.product.deleteMany({ where: { sku: { startsWith: runId } } });
    await prisma.category.deleteMany({ where: { slug: { startsWith: runId } } });
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
