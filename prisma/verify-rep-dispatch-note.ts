/**
 * Real-database verification for the printable "إرسالية مخزون سيارة المندوب"
 * (src/lib/rep-dispatch-note.ts + src/lib/rep-dispatch-groups.ts,
 * /admin/reps/[id]/dispatch-note).
 *
 * The note is a SUMMARY: the rep's current REP_CAR stock (InventoryItem rows,
 * quantity > 0, that rep's own car — never warehouse, never another rep, never
 * Product.stock) is folded into six business groups, one printed row each, and
 * the group quantities must add up to exactly the car's total. Read-only.
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
  const [{ PrismaClient }, constants, dispatch, groupsLib, reps] = await Promise.all([
    import("@prisma/client"),
    import("../src/lib/constants"),
    import("../src/lib/rep-dispatch-note"),
    import("../src/lib/rep-dispatch-groups"),
    import("../src/lib/reps"),
  ]);
  const prisma = new PrismaClient();
  const { ROLES, STOCK_LOCATION_TYPES } = constants;
  const { loadRepDispatchNote, buildDispatchNoteRows, summarizeDispatchNote, formatDispatchReference, formatDispatchDate, formatDispatchTime } = dispatch;
  const { DISPATCH_GROUPS, classifyDispatchProduct, groupDispatchQuantities, assertGroupsReconcile } = groupsLib;
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

  const categoryIds = new Map<string, string>();
  async function categoryId(name: string | null): Promise<string | null> {
    if (name === null) return null;
    if (!categoryIds.has(name)) {
      const created = await prisma.category.create({ data: { name: `${runId}-${name}`, nameAr: `${runId}-${name}`, slug: `${runId}-c${categoryIds.size}` } });
      categoryIds.set(name, created.id);
    }
    return categoryIds.get(name)!;
  }
  let skuSeq = 0;
  const productIds: string[] = [];
  /** A product named exactly `name` (Arabic as typed by the business) in the given category. */
  async function product(name: string, category: string | null) {
    skuSeq += 1;
    const created = await prisma.product.create({
      data: { sku: `${runId}-${skuSeq}`, name, nameAr: name, retailPriceCents: 1000, wholesalePriceCents: 800, isActive: true, categoryId: await categoryId(category) },
    });
    productIds.push(created.id);
    return created;
  }
  const inCar = (rep: { car: { id: string } | null }, productId: string, quantity: number) => prisma.inventoryItem.create({ data: { productId, locationId: rep.car!.id, quantity } });

  // --- the Mahmoud-style car: 49 products / 2811 pieces ---
  const CABLES: [string, string, number][] = [
    ["كيبل USB-Type-C", "كابلات", 55], ["كوابل وسماعات مشكل", "كابلات", 30], ["كيبل آيفون", "كابلات", 23], ["كيبل مايكرو", "كابلات", 25],
    ["كيبل Lightning 2م", "كابلات", 20], ["مرتبان MEIDOU", "كابلات", 3], ["كيبل بيانات", "كابلات", 10], ["كيبل USB", "كابلات", 85],
  ];
  const CHARGERS: [string, string, number][] = [
    ["شاحن سريع 30W", "شواحن", 30], ["شاحن لاسلكي", "شواحن", 5], ["شاحن 18W", "شواحن", 10], ["شاحن منزلي", "شواحن", 18],
    ["عظمة شحن 20W", "عظمات شحن", 27], ["عظمة شحن 12W", "عظمات شحن", 5], ["عظمة شحن 33W", "عظمات شحن", 13], ["Adapter iPhone 20W", "عظمات شحن", 83],
    ["شاحن سيارة", "شواحن", 62], ["شاحن سيارة سريع", "شواحن", 76],
  ];
  const STICKERS: [string, string, number][] = [["ستكرات OVI74", "ستكرات", 480]];
  const PROTECTORS: [string, string, number][] = [
    ["لزقة شاشة عادية", "حماية الشاشة والعدسات", 25], ["لزقة خصوصية", "حماية الشاشة والعدسات", 5],
    ["لزقة فل كفر", "حماية الشاشة والعدسات", 281], ["حماية عدسة الكاميرا", "حماية الشاشة والعدسات", 10],
  ];
  const MAINTENANCE: [string, string, number][] = [["صيانه", "صيانه", 100]];
  const OTHER_CATEGORIES = ["كفرات", "سماعات", "محولات", "إكسسوارات السيارة", null];
  const OTHER_NAMES = ["كفر آيفون", "سماعة بلوتوث", "محول OTG", "حامل سيارة", "إكسسوار متنوع"];
  const OTHER: [string, string | null, number][] = [["جفر شفاف", "كفرات", 128]];
  for (let i = 0; i < 24; i++) OTHER.push([`${OTHER_NAMES[i % 5]} ${i + 1}`, OTHER_CATEGORIES[i % 5] ?? null, i === 23 ? 52 : 50]);

  const mahmoud = await makeRep("mahmoud");
  for (const [name, category, quantity] of [...CABLES, ...CHARGERS, ...STICKERS, ...PROTECTORS, ...MAINTENANCE, ...OTHER]) {
    const created = await product(name, category);
    await inCar(mahmoud, created.id, quantity);
    await prisma.inventoryItem.create({ data: { productId: created.id, locationId: warehouse.id, quantity: 999 } }); // must be ignored
  }
  const zeroProduct = await product("كيبل صفر", "كابلات");
  await inCar(mahmoud, zeroProduct.id, 0);

  // another rep's car: must never leak into Mahmoud's note, and vice-versa
  const otherRep = await makeRep("other");
  const otherShared = await product("ستكر آخر", "ستكرات");
  await inCar(otherRep, otherShared.id, 7);
  await inCar(otherRep, (await product("شاحن آخر", "شواحن")).id, 9);

  // a car with no stickers / no maintenance: those groups must not be printed
  const lean = await makeRep("lean");
  await inCar(lean, (await product("كيبل بسيط", "كابلات")).id, 12);
  await inCar(lean, (await product("كفر بسيط", "كفرات")).id, 8);

  // the original small reference car: A26 B42 C65 D23 E35 = 191
  const small = await makeRep("small");
  await inCar(small, (await product("منتج A", "كفرات")).id, 26);
  await inCar(small, (await product("منتج B", "كفرات")).id, 42);
  await inCar(small, (await product("شاحن C", "شواحن")).id, 65);
  await inCar(small, (await product("منتج D", null)).id, 23);
  await inCar(small, (await product("منتج E", null)).id, 35);

  const emptyRep = await makeRep("empty");
  const noCarRep = await makeRep("nocar", false);

  async function snapshot() {
    const [items, qty, movements, batches, orders, products] = await Promise.all([
      prisma.inventoryItem.count(),
      prisma.inventoryItem.aggregate({ _sum: { quantity: true } }),
      prisma.stockMovement.count(),
      prisma.repStockTransferBatch.count(),
      prisma.order.count(),
      prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, updatedAt: true, categoryId: true, isActive: true }, orderBy: { id: "asc" } }),
    ]);
    return JSON.stringify({ items, qty: qty._sum.quantity, movements, batches, orders, products });
  }
  const byKey = (groups: { key: string; quantity: number }[]) => Object.fromEntries(groups.map((group) => [group.key, group.quantity]));

  try {
    await check("A. the Mahmoud car: 49 products / 2811 pieces -> 6 printed groups with the exact subtotals", async () => {
      const note = await loadRepDispatchNote(mahmoud.rep.id);
      assert(note, "note loaded");
      assert(note.productCount === 49 && note.rows.length === 49, `49 underlying products, got ${note.productCount}`);
      assert(note.groupCount === 6 && note.groups.length === 6, `6 printed group rows, got ${note.groupCount}`);
      assert(JSON.stringify(note.groups.map((group) => group.label)) === JSON.stringify(["كوابل", "شواحن وعضمات شحن", "ستكرات", "لزقات وحماية", "صيانة", "باقي الإكسسوارات"]), "fixed business order and labels");
      assert(
        JSON.stringify(note.groups.map((group) => group.quantity)) === JSON.stringify([251, 329, 480, 321, 100, 1330]),
        `كوابل 251 / شواحن 329 / ستكرات 480 / لزقات 321 / صيانة 100 / باقي 1330, got ${JSON.stringify(note.groups.map((group) => group.quantity))}`,
      );
      assert(JSON.stringify(note.groups.map((group) => group.productCount)) === JSON.stringify([8, 10, 1, 4, 1, 25]), "products per group 8 / 10 / 1 / 4 / 1 / 25");
      const printedSum = note.groups.reduce((sum, group) => sum + group.quantity, 0);
      assert(printedSum === 2811 && note.totalPieces === 2811, `251 + 329 + 480 + 321 + 100 + 1330 = ${printedSum}`);
      assert(note.totalPieces === note.rows.reduce((sum, row) => sum + row.quantity, 0), "the grouped total equals the sum of every product's quantity");
      const stats = await getRepStockStats(mahmoud.car!.id);
      assert(stats.totalUnits === 2811 && stats.distinctProducts === 49, `the canonical rep-car stats agree (${stats.distinctProducts} / ${stats.totalUnits})`);
    });

    await check("B. no duplicate membership: every product is in EXACTLY ONE group, none lost", async () => {
      const note = (await loadRepDispatchNote(mahmoud.rep.id))!;
      const keys = new Set(DISPATCH_GROUPS.map((group) => group.key));
      assert(note.rows.every((row) => keys.has(row.groupKey)), "every product has exactly one valid group key");
      assert(note.groups.reduce((sum, group) => sum + group.productCount, 0) === note.rows.length, "group memberships add up to the product count (nothing counted twice or lost)");
      assert(new Set(note.rows.map((row) => row.productId)).size === note.rows.length, "no product appears twice");
      const sample = [
        ["مرتبان MEIDOU", "CABLES"], ["كوابل وسماعات مشكل", "CABLES"], ["Adapter iPhone 20W", "CHARGERS"], ["شاحن سيارة", "CHARGERS"], ["عظمة شحن 20W", "CHARGERS"],
        ["ستكرات OVI74", "STICKERS"], ["لزقة فل كفر", "PROTECTORS"], ["حماية عدسة الكاميرا", "PROTECTORS"], ["صيانه", "MAINTENANCE"], ["جفر شفاف", "OTHER_ACCESSORIES"],
      ] as const;
      for (const [name, expected] of sample) {
        const row = note.rows.find((candidate) => candidate.name === name);
        assert(row && row.groupKey === expected, `"${name}" -> ${expected}, got ${row?.groupKey}`);
      }
      assert(byKey(note.groups).OTHER_ACCESSORIES === 1330, "everything not in groups 1-5 landed in the fallback group");
    });

    await check("C. classification rules: category is authoritative, name is only a fallback, explicit exceptions, unknown -> باقي الإكسسوارات", async () => {
      const cls = (name: string, category: string | null = null) => classifyDispatchProduct({ name, nameAr: null, category: category ? { name: category, nameAr: null } : null });
      assert(cls("شيء غريب لا يطابق شيئاً") === "OTHER_ACCESSORIES" && cls("zzz", "فئة مجهولة") === "OTHER_ACCESSORIES", "an unknown / unclassified product goes to the fallback group");
      assert(cls("مرتبان MEIDOU", "إكسسوارات") === "CABLES" && cls("مرتبان", "شواحن") === "CABLES", "مرتبان is always a cable (explicit business rule), whatever its category");
      assert(cls("كيبل Type-C") === "CABLES" && cls("Type-C Cable") === "CABLES", "uncategorised cable products are found by name");
      assert(cls("شاحن", "كابلات") === "CABLES", "an explicit category wins over the product name");
      assert(cls("Adapter 20W") === "CHARGERS" && cls("شاحن سيارة") === "CHARGERS" && cls("رأس", "عظمات شحن") === "CHARGERS" && cls("x", "عضمات شحن") === "CHARGERS", "charger spellings by name and category (ظ/ض)");
      assert(cls("ستكر OVI") === "STICKERS" && cls("x", "ستكرات") === "STICKERS", "stickers");
      assert(cls("لزقة") === "PROTECTORS" && cls("x", "حماية الشاشة والعدسات") === "PROTECTORS" && cls("privacy protector") === "PROTECTORS", "screen/lens protection family");
      assert(cls("كفر حماية قوي") === "OTHER_ACCESSORIES", "a phone cover that merely says 'protection' is NOT a protector");
      assert(cls("صيانة") === "MAINTENANCE" && cls("صيانه") === "MAINTENANCE" && cls("x", "صيانه") === "MAINTENANCE", "maintenance, both spellings");
      assert(cls("ستكر كيبل") === "CABLES", "a product matching two groups lands in exactly one — the higher priority");
      assert(classifyDispatchProduct({ name: "x", nameAr: "كيبل", category: null }) === "CABLES", "the Arabic name is read too");
    });

    await check("D-E. zero-stock rows, warehouse stock and another rep's car never reach the note", async () => {
      const note = (await loadRepDispatchNote(mahmoud.rep.id))!;
      assert(!note.rows.some((row) => row.name === "كيبل صفر"), "the zero-quantity product is excluded before grouping");
      assert(note.totalPieces === 2811, "warehouse (999 each) and the other rep's 16 pieces are not in Mahmoud's total");
      assert(!note.rows.some((row) => row.name === "ستكر آخر" || row.name === "شاحن آخر"), "no product of another rep's car");
      const other = (await loadRepDispatchNote(otherRep.rep.id))!;
      assert(other.totalPieces === 16 && JSON.stringify(byKey(other.groups)) === JSON.stringify({ CHARGERS: 9, STICKERS: 7 }), "the other rep's note holds only their own car");
      const raw = (productId: string, quantity: number) => ({ productId, quantity, product: { sku: productId, name: "كيبل", nameAr: null, category: null } });
      assert(buildDispatchNoteRows([raw("a", -3), raw("b", 0), raw("c", 2.5), raw("d", Number.NaN), raw("e", 4)]).length === 1, "negative / zero / fractional / NaN quantities are dropped before grouping");
      assert(buildDispatchNoteRows([raw("p", 3), raw("p", 4)])[0]!.quantity === 7, "legacy per-variant rows of one product fold into one product");
    });

    await check("F. a group with a zero total is not printed", async () => {
      const leanNote = (await loadRepDispatchNote(lean.rep.id))!;
      assert(JSON.stringify(leanNote.groups.map((group) => group.label)) === JSON.stringify(["كوابل", "باقي الإكسسوارات"]) && leanNote.groupCount === 2, "only the two non-empty groups are printed (no ستكرات | 0, no صيانة | 0)");
      assert(leanNote.totalPieces === 20 && leanNote.groups.reduce((sum, group) => sum + group.quantity, 0) === 20, "the totals still reconcile");
      const none = groupDispatchQuantities([{ groupKey: "STICKERS", quantity: 0 }, { groupKey: "CABLES", quantity: 5 }]);
      assert(none.length === 1 && none[0]!.key === "CABLES", "a group whose total is 0 is dropped");
    });

    await check("G. empty car / no car / unknown rep: no error, 0 groups, 0 pieces", async () => {
      const empty = (await loadRepDispatchNote(emptyRep.rep.id))!;
      assert(empty.groups.length === 0 && empty.groupCount === 0 && empty.productCount === 0 && empty.totalPieces === 0 && empty.carLocationName === `${runId}-car-empty`, "empty car");
      const noCar = (await loadRepDispatchNote(noCarRep.rep.id))!;
      assert(noCar.groups.length === 0 && noCar.totalPieces === 0 && noCar.carLocationName === null, "no car location");
      assert((await loadRepDispatchNote(`${runId}-missing`)) === null, "unknown rep id -> null (the page 404s)");
    });

    await check("I. integrity: the printed group quantities reconcile to the canonical car total — and the hard guard fires on any mismatch", async () => {
      for (const rep of [mahmoud, small, otherRep, emptyRep]) {
        const note = (await loadRepDispatchNote(rep.rep.id))!;
        const stats = await getRepStockStats(rep.car!.id);
        assert(note.groups.reduce((sum, group) => sum + group.quantity, 0) === stats.totalUnits && note.totalPieces === stats.totalUnits, `${rep.user.name}: groups == canonical total (${stats.totalUnits})`);
      }
      const small191 = (await loadRepDispatchNote(small.rep.id))!;
      assert(small191.totalPieces === 191 && small191.productCount === 5 && JSON.stringify(byKey(small191.groups)) === JSON.stringify({ CHARGERS: 65, OTHER_ACCESSORIES: 126 }), "the 26+42+65+23+35 = 191 car groups to 65 + 126");
      const rows = [{ groupKey: "CABLES" as const, quantity: 5 }, { groupKey: "OTHER_ACCESSORIES" as const, quantity: 6 }];
      const groups = groupDispatchQuantities(rows);
      assertGroupsReconcile(rows, groups);
      let lost = false;
      try {
        assertGroupsReconcile(rows, [{ ...groups[0]!, quantity: groups[0]!.quantity - 1 }, groups[1]!]);
      } catch {
        lost = true;
      }
      let duplicated = false;
      try {
        assertGroupsReconcile(rows, [groups[0]!, groups[1]!, { ...groups[0]!, key: "STICKERS" }]);
      } catch {
        duplicated = true;
      }
      assert(lost && duplicated, "a lost piece or a double-counted product throws DISPATCH_GROUP_MISMATCH");
      assert(summarizeDispatchNote(rows.map((row, index) => ({ productId: String(index), sku: "", name: "", categoryName: null, quantity: row.quantity, groupKey: row.groupKey })), groups).totalPieces === 11, "summarize derives the total from the printed groups");
    });

    await check("J. natural product order underneath (OVI 4 before OVI 10) and the display-only reference", async () => {
      const numbered = buildDispatchNoteRows(["صنف 10", "صنف 2", "صنف 1", "صنف 11", "OVI 4", "OVI 10"].map((name, index) => ({ productId: `n${index}`, quantity: 1, product: { sku: name, name, nameAr: null, category: null } })));
      assert(numbered.map((row) => row.name).join("|") === "صنف 1|صنف 2|صنف 10|صنف 11|OVI 4|OVI 10", "names with numbers sort naturally");
      assert(formatDispatchReference("EMP-7", new Date("2026-01-15T10:30:00Z")) === "DISP-EMP-7-20260115-1230", "winter (+02)");
      assert(formatDispatchReference("EMP-7", new Date("2026-07-15T10:30:00Z")) === "DISP-EMP-7-20260715-1330", "summer (+03)");
      assert(formatDispatchReference("EMP-7", new Date("2026-07-15T21:30:00Z")) === "DISP-EMP-7-20260716-0030", "business midnight rollover");
      assert(formatDispatchDate(new Date("2026-07-15T21:30:00Z")) === "16/07/2026" && formatDispatchTime(new Date("2026-07-15T21:30:00Z")) === "00:30", "date/time on the same clock");
    });

    await check("K. read-only: loading every note changes no inventory, movement, transfer, order, product or category; no write calls, no Product.stock", async () => {
      const before = await snapshot();
      for (const rep of [mahmoud, small, otherRep, lean, emptyRep, noCarRep]) await loadRepDispatchNote(rep.rep.id);
      const after = await snapshot();
      assert(before === after, `the database changed:\n${before}\n${after}`);
      const sources = [read("../src/lib/rep-dispatch-note.ts"), read("../src/lib/rep-dispatch-groups.ts"), read("../src/app/admin/reps/[id]/dispatch-note/page.tsx"), read("../src/components/reps/RepDispatchNoteView.tsx")].map(codeOnly).join("\n");
      assert(!/\.(create|createMany|update|updateMany|delete|deleteMany|upsert)\(|\$executeRaw|\$queryRawUnsafe|[sS]tockMovement|recordStockMovement|increment|decrement/.test(sources), "no write call, no StockMovement, no stock change");
      assert(!/Product\.stock|\.stock\b|costCents|retailPriceCents|wholesalePriceCents|STOCK_LOCATION_TYPES\.WAREHOUSE|REP_ASSIGNMENT/.test(sources), "no Product.stock, no prices, no warehouse, no transfer history");
      assert(codeOnly(read("../src/lib/rep-dispatch-note.ts")).includes("type: STOCK_LOCATION_TYPES.REP_CAR, salesRepId: rep.id"), "the query is pinned to this rep's own REP_CAR location");
      assert(!/import /.test(codeOnly(read("../src/lib/rep-dispatch-groups.ts"))), "the grouping module is pure: no imports, no database, no React");
      const viewSource = codeOnly(read("../src/components/reps/RepDispatchNoteView.tsx"));
      assert(!viewSource.includes("rep-dispatch-groups") && !/classify|DISPATCH_GROUPS|\.includes\(|\.test\(|RegExp/.test(viewSource), "the component holds no grouping or string-matching logic — it only prints data.groups");
    });

    await check("L. ADMIN-only, linked from the admin rep page next to the inventory sheet, inventory sheet untouched", async () => {
      const page = read("../src/app/admin/reps/[id]/dispatch-note/page.tsx");
      assert(page.includes("requireRole([ROLES.ADMIN])") && page.indexOf("requireRole([ROLES.ADMIN])") < page.indexOf("loadRepDispatchNote("), "ADMIN gate runs before the data is loaded");
      assert(page.includes("notFound()") && page.includes("PrintInventorySheetButton") && page.includes("print:hidden"), "404 for an unknown rep; print button hidden when printing");
      const repPage = read("../src/app/admin/reps/[id]/page.tsx");
      const sheetAt = repPage.indexOf("/inventory-sheet");
      const noteAt = repPage.indexOf("/dispatch-note");
      assert(sheetAt > 0 && noteAt > sheetAt && noteAt - sheetAt < 600 && repPage.includes("إرسالية السيارة"), "the 'إرسالية السيارة' button sits right after 'طباعة كشف الجرد'");
      assert(read("../src/app/admin/reps/[id]/inventory-sheet/page.tsx").includes("requireRole([ROLES.ADMIN])"), "the existing detailed inventory sheet is still there");
    });

    console.log("ALL PASS");
  } finally {
    await prisma.inventoryItem.deleteMany({ where: { OR: [{ productId: { in: productIds } }, { location: { name: { startsWith: runId } } }] } });
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
