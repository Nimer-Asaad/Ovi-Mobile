/**
 * Real-database verification for REP sales returns (مردود مبيعات) —
 * src/lib/sales-returns.ts (createSalesReturn), src/lib/sales-return-math.ts,
 * the extended canonical balance formula in src/lib/accounts.ts, and the
 * order-lifecycle guard that keeps whole-order cancellation from duplicating
 * returned stock. Safety rails via resolveVerifyDatabaseUrl
 * (prisma/verify-guardrails.ts) — same convention as every other
 * prisma/verify-*.ts script: never runs against a shared/production
 * database; the target database's name must contain "verify" and its host
 * must be localhost.
 *
 * Sales are created through createRepSaleCore (the exact shared core every
 * real rep sale uses) and returns through createSalesReturn (the exact core
 * the rep UI action calls) — nothing under test is re-implemented here.
 *
 * Run with: node --conditions=react-server --import tsx prisma/verify-sales-returns.ts
 * SALES_RETURN_VERIFY_DATABASE_URL must point at a disposable localhost
 * PostgreSQL database whose name contains "verify", migrated with
 * `prisma migrate deploy`.
 */

export {};

import { resolveVerifyDatabaseUrl } from "./verify-guardrails";

const resolved = resolveVerifyDatabaseUrl("SALES_RETURN_VERIFY_DATABASE_URL");
console.log(`[verify-sales-returns] target: ${resolved.masked}`);

process.env.DATABASE_URL = resolved.url;
process.env.DIRECT_URL = resolved.url;

async function main() {
  const [{ PrismaClient }, constants, repSales, accounts, saleCorrection, salesReturns, math, statement, reporting, merge] = await Promise.all([
    import("@prisma/client"),
    import("../src/lib/constants"),
    import("../src/lib/rep-sales"),
    import("../src/lib/accounts"),
    import("../src/lib/sale-correction"),
    import("../src/lib/sales-returns"),
    import("../src/lib/sales-return-math"),
    import("../src/lib/account-statement"),
    import("../src/lib/reporting"),
    import("../src/lib/merchant-merge"),
  ]);

  const prisma = new PrismaClient();
  const { ROLES, STOCK_LOCATION_TYPES, ACCOUNT_PAYMENT_METHODS, STOCK_MOVEMENT_TYPES, ORDER_STATUSES } = constants;
  const { createRepSaleCore } = repSales;
  const { getAccountBalanceCents, getOrderAccountPosition, SALES_RETURN_STATEMENT_SELECT } = accounts;
  const { correctSale } = saleCorrection;
  const { createSalesReturn, getOrderReturnSummary } = salesReturns;
  const { computeNetLineCents, cumulativePaidCreditCents } = math;
  const { buildAccountStatementRows } = statement;
  const { fetchSalesReturnTotals, getBusinessDateIso } = reporting;
  const { mergeMerchants } = merge;
  const runId = `verify-salesret-${Date.now()}`;

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

  function nis(amount: number): number {
    return Math.round(amount * 100);
  }

  const admin = await prisma.user.create({ data: { role: ROLES.ADMIN, name: `${runId}-admin`, email: `${runId}-admin@example.invalid`, isActive: true } });
  const repUser = await prisma.user.create({ data: { role: ROLES.SALES_REPRESENTATIVE, name: `${runId}-rep`, email: `${runId}-rep@example.invalid`, isActive: true } });
  const rep = await prisma.salesRepresentative.create({ data: { userId: repUser.id, employeeCode: `${runId}-rep` } });
  const repCar = await prisma.stockLocation.create({ data: { type: STOCK_LOCATION_TYPES.REP_CAR, name: `${runId}-car`, salesRepId: rep.id } });
  const repUserB = await prisma.user.create({ data: { role: ROLES.SALES_REPRESENTATIVE, name: `${runId}-repB`, email: `${runId}-repB@example.invalid`, isActive: true } });
  const repB = await prisma.salesRepresentative.create({ data: { userId: repUserB.id, employeeCode: `${runId}-repB` } });
  const repCarB = await prisma.stockLocation.create({ data: { type: STOCK_LOCATION_TYPES.REP_CAR, name: `${runId}-carB`, salesRepId: repB.id } });
  const warehouse = await prisma.stockLocation.create({ data: { type: STOCK_LOCATION_TYPES.WAREHOUSE, name: `${runId}-warehouse`, isDefault: true } });
  const product = await prisma.product.create({ data: { sku: `${runId}-p1`, name: `${runId}-p1`, retailPriceCents: 1000, wholesalePriceCents: 800, isActive: true } });
  const product2 = await prisma.product.create({ data: { sku: `${runId}-p2`, name: `${runId}-p2`, retailPriceCents: 700, wholesalePriceCents: 500, isActive: true } });
  const product3 = await prisma.product.create({ data: { sku: `${runId}-p3`, name: `${runId}-p3`, retailPriceCents: 111, wholesalePriceCents: 100, isActive: true } });
  for (const p of [product, product2, product3]) {
    await prisma.inventoryItem.create({ data: { productId: p.id, locationId: repCar.id, quantity: 100_000 } });
    await prisma.inventoryItem.create({ data: { productId: p.id, locationId: warehouse.id, quantity: 500 } });
  }

  interface SellItem {
    quantity: number;
    unitPriceCents: number;
    bonusQuantity?: number;
    productId?: string;
  }

  /** See verify-sale-discount-bonus.ts for why the "static generation
   * store missing" error (Next.js revalidatePath outside a request, thrown
   * strictly AFTER the sale transaction committed) is tolerated here. */
  async function sell(phone: string, items: SellItem[], discountCents: number, paidNowCents: number) {
    try {
      return await createRepSaleCore(
        {
          items: items.map((item) => ({
            productId: item.productId ?? product.id,
            colorId: null,
            variantId: null,
            deviceColorVariantId: null,
            quantity: item.quantity,
            unitPriceCents: item.unitPriceCents,
            bonusQuantity: item.bonusQuantity ?? 0,
          })),
          customerName: `${runId}-${phone}`,
          customerPhone: `${runId}-${phone}`,
          city: undefined,
          address: undefined,
          notes: undefined,
          repCustomerOrderId: null,
          discountCents,
          paidNowCents,
          paidNowMethod: ACCOUNT_PAYMENT_METHODS.CASH,
        },
        { salesRepId: rep.id, carStockLocationId: repCar.id, actorUserId: repUser.id },
      );
    } catch (error) {
      if (error instanceof Error && error.message.includes("static generation store missing")) return { ok: true as const, orderNumber: "" };
      throw error;
    }
  }

  async function latestOrder(phone: string) {
    const merchant = await prisma.merchant.findFirstOrThrow({ where: { assignedRepId: rep.id, contactPhone: `${runId}-${phone}` }, select: { id: true } });
    const orders = await prisma.order.findMany({ where: { merchantId: merchant.id }, orderBy: { createdAt: "asc" }, include: { items: { orderBy: { id: "asc" } } } });
    return orders[orders.length - 1]!;
  }

  async function sellAndRead(phone: string, items: SellItem[], discountCents: number, paidNowCents: number) {
    const result = await sell(phone, items, discountCents, paidNowCents);
    assert(result.ok, `sale must be accepted, got: ${!result.ok && result.error}`);
    return latestOrder(phone);
  }

  const REP_CTX = { salesRepId: rep.id, carStockLocationId: repCar.id, actorUserId: repUser.id };
  async function doReturn(orderNumber: string, lines: { orderItemId: string; quantity: number; bonusQuantity?: number }[], ctx = REP_CTX, note?: string) {
    return createSalesReturn({ orderNumber, ...ctx, lines, note });
  }

  async function balanceOf(phone: string): Promise<number> {
    const merchant = await prisma.merchant.findFirstOrThrow({
      where: { assignedRepId: rep.id, contactPhone: `${runId}-${phone}` },
      select: {
        account: {
          select: {
            openingBalanceCents: true,
            orders: { select: { status: true, totalCents: true } },
            payments: { select: { amountCents: true, cancellation: { select: { id: true } } } },
            salesReturns: { select: { totalCreditCents: true, reversal: { select: { id: true } } } },
          },
        },
      },
    });
    return getAccountBalanceCents(merchant.account!);
  }

  async function carStock(productId = product.id, locationId = repCar.id): Promise<number> {
    return (await prisma.inventoryItem.findFirstOrThrow({ where: { productId, locationId, variantId: null, deviceColorVariantId: null }, select: { quantity: true } })).quantity;
  }

  async function warehouseStock(productId = product.id): Promise<number> {
    return carStock(productId, warehouse.id);
  }

  async function returnCount(orderId: string): Promise<number> {
    return prisma.salesReturn.count({ where: { orderId } });
  }

  try {
    await check("CASE 1: partial return 2 of 5 -> REP_CAR +2, remaining 3, debt -20, order untouched", async () => {
      const order = await sellAndRead("c1", [{ quantity: 5, unitPriceCents: nis(10) }], 0, 0);
      const item = order.items[0]!;
      const stockBefore = await carStock();
      const whBefore = await warehouseStock();
      assert((await balanceOf("c1")) === nis(50), "balance before must be 50");
      const result = await doReturn(order.orderNumber, [{ orderItemId: item.id, quantity: 2 }]);
      assert(result.ok, `return must succeed: ${!result.ok && result.error}`);
      assert(result.ok && result.totalCreditCents === nis(20), `credit must be 20, got ${result.ok && result.totalCreditCents / 100}`);
      assert((await carStock()) === stockBefore + 2, "REP_CAR must increase by exactly 2");
      assert((await warehouseStock()) === whBefore, "warehouse must be untouched");
      assert((await balanceOf("c1")) === nis(30), "balance must drop by exactly the credit (50 -> 30)");
      const summary = await getOrderReturnSummary(order.id);
      assert(summary.lines.get(item.id)!.remainingQuantity === 3, "remaining must be 3");
      assert(summary.status === "PARTIAL", "status must be PARTIAL");
      const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { items: { orderBy: { id: "asc" } } } });
      assert(after.status === order.status && after.totalCents === order.totalCents && after.items[0]!.quantity === 5 && after.items[0]!.totalCents === item.totalCents, "original order/items must be unchanged");
      const movement = await prisma.stockMovement.findFirstOrThrow({ where: { productId: product.id, toLocationId: repCar.id, type: STOCK_MOVEMENT_TYPES.RETURN_IN }, orderBy: { createdAt: "desc" } });
      assert(movement.quantity === 2 && movement.newQuantity === stockBefore + 2 && movement.previousQuantity === stockBefore, "RETURN_IN movement must record exact before/after");
    });

    await check("CASE 2: second return respects the remaining 3", async () => {
      const order = await sellAndRead("c2", [{ quantity: 5, unitPriceCents: nis(10) }], 0, 0);
      const item = order.items[0]!;
      assert((await doReturn(order.orderNumber, [{ orderItemId: item.id, quantity: 2 }])).ok, "first return must succeed");
      const tooMany = await doReturn(order.orderNumber, [{ orderItemId: item.id, quantity: 4 }]);
      assert(!tooMany.ok && tooMany.code === "EXCEEDS_RETURNABLE", "4 > remaining 3 must be rejected");
      const stockMid = await carStock();
      const ok = await doReturn(order.orderNumber, [{ orderItemId: item.id, quantity: 3 }]);
      assert(ok.ok, "returning exactly the remaining 3 must succeed");
      assert((await carStock()) === stockMid + 3, "REP_CAR +3");
      assert(ok.ok && ok.sequence === 2, "second return has sequence 2");
      assert((await getOrderReturnSummary(order.id)).status === "FULL", "status FULL after all 5 returned");
    });

    await check("CASE 3: over-return rejected atomically (no rows, no stock, no balance change)", async () => {
      const order = await sellAndRead("c3", [{ quantity: 5, unitPriceCents: nis(10) }], 0, 0);
      const item = order.items[0]!;
      const stockBefore = await carStock();
      const result = await doReturn(order.orderNumber, [{ orderItemId: item.id, quantity: 6 }]);
      assert(!result.ok && result.code === "EXCEEDS_RETURNABLE", "6 of 5 must be rejected");
      assert((await returnCount(order.id)) === 0, "no SalesReturn row may exist");
      assert((await carStock()) === stockBefore, "stock unchanged");
      assert((await balanceOf("c3")) === nis(50), "balance unchanged");
      for (const bad of [0, -1, 1.5]) {
        const r = await doReturn(order.orderNumber, [{ orderItemId: item.id, quantity: bad }]);
        assert(!r.ok && r.code === "INVALID_LINE", `quantity ${bad} must be rejected`);
      }
      const empty = await doReturn(order.orderNumber, []);
      assert(!empty.ok && empty.code === "NO_LINES", "empty return must be rejected");
    });

    await check("CASE 3b: a failing second line rolls back the whole return (atomicity)", async () => {
      const order = await sellAndRead("c3b", [{ quantity: 4, unitPriceCents: nis(10) }, { quantity: 2, unitPriceCents: nis(7), productId: product2.id }], 0, 0);
      const [a, b] = order.items;
      const stockBefore = await carStock();
      const stock2Before = await carStock(product2.id);
      const result = await doReturn(order.orderNumber, [{ orderItemId: a!.id, quantity: 2 }, { orderItemId: b!.id, quantity: 3 }]);
      assert(!result.ok, "second line exceeds -> whole return rejected");
      assert((await returnCount(order.id)) === 0 && (await carStock()) === stockBefore && (await carStock(product2.id)) === stock2Before, "nothing may be partially applied");
      const foreign = await sellAndRead("c3b-other", [{ quantity: 1, unitPriceCents: nis(10) }], 0, 0);
      const cross = await doReturn(order.orderNumber, [{ orderItemId: foreign.items[0]!.id, quantity: 1 }]);
      assert(!cross.ok && cross.code === "INVALID_LINE", "an item of another invoice must be rejected");
    });

    await check("CASE 4: full return works and blocks any further return", async () => {
      const order = await sellAndRead("c4", [{ quantity: 4, unitPriceCents: nis(10) }], 0, 0);
      const item = order.items[0]!;
      const stockBefore = await carStock();
      const result = await doReturn(order.orderNumber, [{ orderItemId: item.id, quantity: 4 }]);
      assert(result.ok && result.totalCreditCents === order.totalCents, "full return credit == Order.totalCents");
      assert((await carStock()) === stockBefore + 4, "REP_CAR +4");
      assert((await balanceOf("c4")) === 0, "debt fully cleared");
      const again = await doReturn(order.orderNumber, [{ orderItemId: item.id, quantity: 1 }]);
      assert(!again.ok && again.code === "EXCEEDS_RETURNABLE", "nothing left to return");
      assert((await getOrderReturnSummary(order.id)).remainingUnits === 0, "remaining units 0");
    });

    await check("CASE 5: concurrent double-return can never exceed the original quantity", async () => {
      const order = await sellAndRead("c5", [{ quantity: 5, unitPriceCents: nis(10) }], 0, 0);
      const item = order.items[0]!;
      const stockBefore = await carStock();
      const results = await Promise.all([
        doReturn(order.orderNumber, [{ orderItemId: item.id, quantity: 3 }]),
        doReturn(order.orderNumber, [{ orderItemId: item.id, quantity: 3 }]),
      ]);
      const successes = results.filter((r) => r.ok);
      assert(successes.length === 1, `exactly one of two concurrent 3-of-5 returns may win, got ${successes.length}`);
      assert((await carStock()) === stockBefore + 3, "REP_CAR increases by 3 only");
      assert((await balanceOf("c5")) === nis(20), "debt 50 -> 20 (credit 30 once)");
      assert((await getOrderReturnSummary(order.id)).returnedUnits === 3, "returned units 3");

      const order2 = await sellAndRead("c5b", [{ quantity: 5, unitPriceCents: nis(10) }], 0, 0);
      const stock2 = await carStock();
      const many = await Promise.all(Array.from({ length: 5 }, () => doReturn(order2.orderNumber, [{ orderItemId: order2.items[0]!.id, quantity: 2 }])));
      const wins = many.filter((r) => r.ok).length;
      assert(wins === 2, `5 concurrent 2-unit returns of a 5-unit line: exactly 2 may win, got ${wins}`);
      assert((await carStock()) === stock2 + 4, "REP_CAR +4");
      const sequences = (await prisma.salesReturn.findMany({ where: { orderId: order2.id }, select: { sequence: true }, orderBy: { sequence: "asc" } })).map((r) => r.sequence);
      assert(JSON.stringify(sequences) === JSON.stringify([1, 2]), `sequences must be 1,2 got ${sequences}`);
    });

    await check("CASE 6: return of a normal partially-paid item reduces debt by exactly the credit", async () => {
      const order = await sellAndRead("c6", [{ quantity: 5, unitPriceCents: nis(10) }], 0, nis(20));
      assert((await balanceOf("c6")) === nis(30), "debt 30 before");
      const r = await doReturn(order.orderNumber, [{ orderItemId: order.items[0]!.id, quantity: 2 }]);
      assert(r.ok && r.totalCreditCents === nis(20), "credit 20");
      assert((await balanceOf("c6")) === nis(10), "debt 30 -> 10");
    });

    await check("CASE 7: explicit paid/bonus split — bonus units return physically but earn no fake credit", async () => {
      const order = await sellAndRead("c7", [{ quantity: 5, unitPriceCents: nis(10), bonusQuantity: 1 }], 0, 0);
      assert(order.totalCents === nis(40), "charged total is 4 paid units = 40");
      const item = order.items[0]!;
      const stockBefore = await carStock();
      // The rep explicitly declares this returned unit as PAID (bonusQuantity omitted -> 0).
      const first = await doReturn(order.orderNumber, [{ orderItemId: item.id, quantity: 1 }]);
      assert(first.ok && first.totalCreditCents === nis(10), "an explicitly PAID returned unit is credited (10)");
      // The remaining 4 physical units are 3 paid + the 1 original bonus unit — declared explicitly.
      const rest = await doReturn(order.orderNumber, [{ orderItemId: item.id, quantity: 4, bonusQuantity: 1 }]);
      assert(rest.ok && rest.totalCreditCents === nis(30), "remaining 3 paid units credit 30; the explicitly-declared bonus unit earns 0");
      assert((await carStock()) === stockBefore + 5, "all 5 physical units (bonus included) return to REP_CAR");
      assert((await balanceOf("c7")) === 0, "credit total == charged total 40, debt 0");

      const freeOrder = await sellAndRead("c7b", [{ quantity: 2, unitPriceCents: nis(10), bonusQuantity: 2 }], 0, 0);
      assert(freeOrder.totalCents === 0, "fully-bonus invoice total 0");
      const stockFree = await carStock();
      // Every returned unit is explicitly declared bonus (paidQty is 0 for this line either way).
      const freeReturn = await doReturn(freeOrder.orderNumber, [{ orderItemId: freeOrder.items[0]!.id, quantity: 2, bonusQuantity: 2 }]);
      assert(freeReturn.ok && freeReturn.totalCreditCents === 0, "fully-bonus return earns 0 credit");
      assert((await carStock()) === stockFree + 2, "physical units still return");
      assert((await balanceOf("c7b")) === 0, "no fake revenue credit on the account");
      // Declaring more of the return as bonus than the line's original bonusQuantity is rejected, even
      // though the physical quantity alone would be in range.
      const overBonus = await sellAndRead("c7c", [{ quantity: 5, unitPriceCents: nis(10), bonusQuantity: 1 }], 0, 0);
      const badReturn = await doReturn(overBonus.orderNumber, [{ orderItemId: overBonus.items[0]!.id, quantity: 2, bonusQuantity: 2 }]);
      assert(!badReturn.ok && badReturn.code === "EXCEEDS_RETURNABLE", "bonusQuantity 2 > original bonusQuantity 1 must be rejected");
      const badWithinLine = await doReturn(overBonus.orderNumber, [{ orderItemId: overBonus.items[0]!.id, quantity: 1, bonusQuantity: 2 }]);
      assert(!badWithinLine.ok && badWithinLine.code === "INVALID_LINE", "bonusQuantity cannot exceed this operation's own quantity");
    });

    await check("CASE 8: discounted invoice partial return uses the original persisted economics", async () => {
      // lines: A 3 x 10.00 = 30.00, B 2 x 7.00 = 14.00, subtotal 44.00, discount 11.00, total 33.00
      const order = await sellAndRead("c8", [{ quantity: 3, unitPriceCents: nis(10) }, { quantity: 2, unitPriceCents: nis(7), productId: product2.id }], nis(11), 0);
      assert(order.totalCents === nis(33), "invoice total 33");
      const lineA = order.items.find((i) => i.productId === product.id)!;
      const lineB = order.items.find((i) => i.productId === product2.id)!;
      const net = computeNetLineCents(order.items, order.discountCents);
      assert(net.get(lineA.id)! === nis(22.5) && net.get(lineB.id)! === nis(10.5), "discount 11 split 7.50/3.50 -> net 22.50 / 10.50");
      const r = await doReturn(order.orderNumber, [{ orderItemId: lineA.id, quantity: 1 }]);
      assert(r.ok && r.totalCreditCents === nis(7.5), `returning 1 of line A credits 7.50 (net/3), NOT the undiscounted 10.00 — got ${r.ok && r.totalCreditCents / 100}`);
      assert((await balanceOf("c8")) === nis(25.5), "debt 33 -> 25.50");
      // Changing the CURRENT product price must not affect the credit.
      await prisma.product.update({ where: { id: product2.id }, data: { retailPriceCents: 99_999, wholesalePriceCents: 99_999 } });
      const r2 = await doReturn(order.orderNumber, [{ orderItemId: lineB.id, quantity: 1 }]);
      await prisma.product.update({ where: { id: product2.id }, data: { retailPriceCents: 700, wholesalePriceCents: 500 } });
      assert(r2.ok && r2.totalCreditCents === nis(5.25), `line B unit credit is 10.50/2 = 5.25 regardless of current price — got ${r2.ok && r2.totalCreditCents / 100}`);
    });

    await check("CASE 9+10: odd-rounding discounted invoice — every cumulative step <= total, full return == Order.totalCents", async () => {
      // 3 x 3.33 = 9.99, 7 x 1.11 = 7.77, 5 x 0.07 = 0.35 -> subtotal 18.11, discount 0.37, total 17.74
      const order = await sellAndRead(
        "c9",
        [
          { quantity: 3, unitPriceCents: 333, productId: product.id },
          { quantity: 7, unitPriceCents: 111, productId: product3.id },
          { quantity: 5, unitPriceCents: 7, productId: product2.id },
        ],
        37,
        0,
      );
      assert(order.subtotalCents === 1811 && order.totalCents === 1774, "subtotal 18.11 / total 17.74");
      const net = computeNetLineCents(order.items, order.discountCents);
      assert([...net.values()].reduce((a, b) => a + b, 0) === order.totalCents, "net lines sum EXACTLY to Order.totalCents");
      let cumulative = 0;
      for (const item of order.items) {
        for (let unit = 0; unit < item.quantity; unit += 1) {
          const r = await doReturn(order.orderNumber, [{ orderItemId: item.id, quantity: 1 }]);
          assert(r.ok, "single-unit return must succeed");
          cumulative += r.totalCreditCents;
          assert(cumulative <= order.totalCents, `cumulative credit ${cumulative} exceeded Order.totalCents ${order.totalCents}`);
        }
      }
      assert(cumulative === order.totalCents, `fully returned discounted invoice must credit exactly Order.totalCents (${order.totalCents}), got ${cumulative}`);
      assert((await balanceOf("c9")) === 0, "debt back to exactly 0");
      const persisted = await prisma.salesReturn.aggregate({ where: { orderId: order.id }, _sum: { totalCreditCents: true } });
      assert(persisted._sum.totalCreditCents === order.totalCents, "persisted credits sum to Order.totalCents");
      // Same credit via ONE full return on a fresh identical invoice (order-independence).
      const twin = await sellAndRead(
        "c9-twin",
        [
          { quantity: 3, unitPriceCents: 333, productId: product.id },
          { quantity: 7, unitPriceCents: 111, productId: product3.id },
          { quantity: 5, unitPriceCents: 7, productId: product2.id },
        ],
        37,
        0,
      );
      const full = await doReturn(twin.orderNumber, twin.items.map((i) => ({ orderItemId: i.id, quantity: i.quantity })));
      assert(full.ok && full.totalCreditCents === twin.totalCents, "one full return also credits exactly Order.totalCents");
      // pure-math guard: cumulative credit never decreases and never exceeds net
      // (these items all have bonusQuantity 0, so paidReturned == physical returned).
      for (const item of order.items) {
        let previous = 0;
        for (let r = 0; r <= item.quantity; r += 1) {
          const c = cumulativePaidCreditCents(net.get(item.id)!, item.quantity - item.bonusQuantity, r);
          assert(c >= previous && c <= net.get(item.id)!, "monotone and bounded");
          previous = c;
        }
      }
    });

    await check("CASE 11: original orders, items and payment rows are unchanged by a return", async () => {
      const order = await sellAndRead("c11", [{ quantity: 5, unitPriceCents: nis(10) }], nis(5), nis(20));
      const merchant = await prisma.merchant.findFirstOrThrow({ where: { assignedRep: { id: rep.id }, contactPhone: `${runId}-c11` }, select: { account: { select: { id: true } } } });
      const snapshot = async () =>
        JSON.stringify({
          order: await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { items: { orderBy: { id: "asc" } } } }),
          payments: await prisma.accountPayment.findMany({ where: { accountId: merchant.account!.id }, orderBy: { id: "asc" } }),
          cancellations: await prisma.accountPaymentCancellation.count({ where: { payment: { accountId: merchant.account!.id } } }),
        });
      const before = await snapshot();
      const r = await doReturn(order.orderNumber, [{ orderItemId: order.items[0]!.id, quantity: 2 }]);
      assert(r.ok, "return ok");
      assert((await snapshot()) === before, "Order/OrderItem/AccountPayment rows must be byte-identical after a return");
    });

    await check("CASE 12: an already-paid invoice yields merchant credit (negative balance), no auto refund", async () => {
      const order = await sellAndRead("c12", [{ quantity: 3, unitPriceCents: nis(10) }], 0, nis(30));
      assert((await balanceOf("c12")) === 0, "fully paid -> balance 0");
      const paymentsBefore = await prisma.accountPayment.count({ where: { sourceOrderId: order.id } });
      const r = await doReturn(order.orderNumber, [{ orderItemId: order.items[0]!.id, quantity: 2 }]);
      assert(r.ok, "return must be allowed on a paid invoice");
      assert((await balanceOf("c12")) === -nis(20), "balance becomes a 20 credit");
      assert((await prisma.accountPayment.count({ where: { sourceOrderId: order.id } })) === paymentsBefore, "no refund payment row is created");
    });

    await check("CASE 13: another REP cannot return this invoice", async () => {
      const order = await sellAndRead("c13", [{ quantity: 3, unitPriceCents: nis(10) }], 0, 0);
      const stockBefore = await carStock();
      await prisma.inventoryItem.create({ data: { productId: product.id, locationId: repCarB.id, quantity: 10 } });
      const stockB = await carStock(product.id, repCarB.id);
      const result = await doReturn(order.orderNumber, [{ orderItemId: order.items[0]!.id, quantity: 1 }], { salesRepId: repB.id, carStockLocationId: repCarB.id, actorUserId: repUserB.id });
      assert(!result.ok && result.code === "NOT_OWNER", "must be rejected as NOT_OWNER");
      assert((await returnCount(order.id)) === 0 && (await carStock()) === stockBefore && (await carStock(product.id, repCarB.id)) === stockB, "no side effects");
      const wrongCar = await doReturn(order.orderNumber, [{ orderItemId: order.items[0]!.id, quantity: 1 }], { salesRepId: rep.id, carStockLocationId: repCarB.id, actorUserId: repUser.id });
      assert(!wrongCar.ok && wrongCar.code === "INVALID_LOCATION", "the owner cannot send goods into another rep's car (or the warehouse)");
      const toWarehouse = await doReturn(order.orderNumber, [{ orderItemId: order.items[0]!.id, quantity: 1 }], { salesRepId: rep.id, carStockLocationId: warehouse.id, actorUserId: repUser.id });
      assert(!toWarehouse.ok && toWarehouse.code === "INVALID_LOCATION", "warehouse is never a valid destination");
      const missing = await doReturn(`${runId}-nope`, [{ orderItemId: order.items[0]!.id, quantity: 1 }]);
      assert(!missing.ok && missing.code === "ORDER_NOT_FOUND", "unknown invoice rejected");
    });

    await check("CASE 14: cancellation/correction and returns never duplicate stock", async () => {
      // (a) partial return first, then whole-order cancel -> blocked.
      const a = await sellAndRead("c14a", [{ quantity: 4, unitPriceCents: nis(10) }], 0, 0);
      assert((await doReturn(a.orderNumber, [{ orderItemId: a.items[0]!.id, quantity: 1 }])).ok, "partial return ok");
      const stockAfterReturn = await carStock();
      const cancelA = await correctSale({ orderNumber: a.orderNumber, reason: "verify", actorUserId: repUser.id });
      assert(!cancelA.ok && cancelA.code === "ORDER_HAS_SALES_RETURNS", `cancel of a partially-returned invoice must be blocked, got ${JSON.stringify(cancelA)}`);
      assert((await carStock()) === stockAfterReturn, "no stock restored twice");
      assert((await prisma.order.findUniqueOrThrow({ where: { id: a.id } })).status === ORDER_STATUSES.DELIVERED, "order status untouched");

      // (b) cancel first, then return -> blocked.
      const b = await sellAndRead("c14b", [{ quantity: 4, unitPriceCents: nis(10) }], 0, 0);
      const cancelB = await correctSale({ orderNumber: b.orderNumber, reason: "verify", actorUserId: repUser.id });
      assert(cancelB.ok, `cancel must succeed: ${!cancelB.ok && cancelB.message}`);
      const stockAfterCancel = await carStock();
      const retB = await doReturn(b.orderNumber, [{ orderItemId: b.items[0]!.id, quantity: 1 }]);
      assert(!retB.ok && retB.code === "ORDER_TERMINAL", "return of a cancelled invoice must be rejected");
      assert((await carStock()) === stockAfterCancel && (await returnCount(b.id)) === 0, "no duplicate stock");
    });

    await check("CASE 15: REP_CAR delta and ledger match the physical returned quantity exactly", async () => {
      const order = await sellAndRead("c15", [{ quantity: 6, unitPriceCents: nis(10), bonusQuantity: 2 }, { quantity: 3, unitPriceCents: nis(7), productId: product2.id }], nis(4), 0);
      const carBefore = { p1: await carStock(), p2: await carStock(product2.id) };
      const whBefore = { p1: await warehouseStock(), p2: await warehouseStock(product2.id) };
      const companyBefore = await prisma.inventoryItem.aggregate({ where: { productId: { in: [product.id, product2.id] } }, _sum: { quantity: true } });
      const [l1, l2] = [order.items.find((i) => i.productId === product.id)!, order.items.find((i) => i.productId === product2.id)!];
      assert((await doReturn(order.orderNumber, [{ orderItemId: l1.id, quantity: 2 }, { orderItemId: l2.id, quantity: 1 }])).ok, "return 1");
      // l1's original bonusQuantity is 2 (of quantity 6) — the remaining 4 physical units are 2 paid + the
      // 2 original bonus units, declared explicitly.
      assert((await doReturn(order.orderNumber, [{ orderItemId: l1.id, quantity: 4, bonusQuantity: 2 }, { orderItemId: l2.id, quantity: 2 }])).ok, "return 2");
      assert((await carStock()) === carBefore.p1 + 6 && (await carStock(product2.id)) === carBefore.p2 + 3, "REP_CAR increases by exactly the physical units (6 + 3)");
      assert((await warehouseStock()) === whBefore.p1 && (await warehouseStock(product2.id)) === whBefore.p2, "warehouse untouched");
      const companyAfter = await prisma.inventoryItem.aggregate({ where: { productId: { in: [product.id, product2.id] } }, _sum: { quantity: true } });
      assert((companyAfter._sum.quantity ?? 0) - (companyBefore._sum.quantity ?? 0) === 9, "company-wide total increases by exactly 9 returned units");
      const moved = await prisma.stockMovement.aggregate({ where: { note: { startsWith: `مردود مبيعات ${order.orderNumber}-R` }, type: STOCK_MOVEMENT_TYPES.RETURN_IN, toLocationId: repCar.id }, _sum: { quantity: true } });
      assert(moved._sum.quantity === 9, "RETURN_IN movements sum to 9");
      const persisted = await prisma.salesReturn.aggregate({ where: { orderId: order.id }, _sum: { totalCreditCents: true } });
      assert(persisted._sum.totalCreditCents === order.totalCents, "fully returned -> credits == Order.totalCents");
    });

    await check("CASE 16: statement + position use the SAME canonical balance (no second formula)", async () => {
      const order = await sellAndRead("c16", [{ quantity: 5, unitPriceCents: nis(10) }], 0, nis(10));
      assert((await doReturn(order.orderNumber, [{ orderItemId: order.items[0]!.id, quantity: 2 }])).ok, "return ok");
      const later = await sellAndRead("c16", [{ quantity: 1, unitPriceCents: nis(10) }], 0, 0);
      const merchant = await prisma.merchant.findFirstOrThrow({
        where: { assignedRepId: rep.id, contactPhone: `${runId}-c16` },
        select: {
          account: {
            select: {
              openingBalanceCents: true,
              openingBalanceSetAt: true,
              orders: { select: { orderNumber: true, createdAt: true, status: true, totalCents: true } },
              payments: { select: { id: true, createdAt: true, amountCents: true, method: true, note: true, cancellation: { select: { id: true, reason: true, cancelledAt: true } } } },
              salesReturns: SALES_RETURN_STATEMENT_SELECT,
            },
          },
        },
      });
      const account = merchant.account!;
      const rows = buildAccountStatementRows(account);
      const last = rows[rows.length - 1]!;
      assert(last.balanceCents === getAccountBalanceCents(account), "statement's final running balance == getAccountBalanceCents");
      assert(rows.some((row) => row.type === "SALES_RETURN" && row.creditCents === nis(20)), "the return appears as a 20 credit row");
      // 50 - 10 paid - 20 returned = 20 owed; then a new 10 sale -> 30
      assert(getAccountBalanceCents(account) === nis(30), "balance 30");
      const position = getOrderAccountPosition(account, later);
      assert(position.previousDebtCents === nis(20), `the later invoice's previous debt must already include the earlier return (20), got ${position.previousDebtCents / 100}`);
    });

    await check("CASE 17: reporting — returns reduce NET sales, gross untouched, scoped by rep/merchant/date", async () => {
      const today = getBusinessDateIso();
      const expected = await prisma.salesReturn.aggregate({ where: { salesRepId: rep.id }, _sum: { totalCreditCents: true }, _count: { _all: true } });
      const totals = await fetchSalesReturnTotals({ fromIso: today, toIso: today, salesRepId: rep.id });
      assert(totals.returnsTotalCents === (expected._sum.totalCreditCents ?? 0) && totals.returnsCount === expected._count._all && totals.returnsCount > 0, "today's rep-scoped returns match the ledger");
      const other = await fetchSalesReturnTotals({ fromIso: today, toIso: today, salesRepId: repB.id });
      assert(other.returnsCount === 0 && other.returnsTotalCents === 0, "another rep sees none of these returns");
      const past = await fetchSalesReturnTotals({ fromIso: "2001-01-01", toIso: "2001-01-31", salesRepId: rep.id });
      assert(past.returnsCount === 0, "a past window contains none");
      const merchant = await prisma.merchant.findFirstOrThrow({ where: { assignedRepId: rep.id, contactPhone: `${runId}-c1` }, select: { id: true } });
      const scoped = await fetchSalesReturnTotals({ fromIso: today, toIso: today, salesRepId: rep.id, merchantId: merchant.id });
      assert(scoped.returnsTotalCents === nis(20) && scoped.returnsCount === 1, "merchant c1 has exactly the one 20 return");
      const gross = await prisma.order.aggregate({ where: { createdByRepId: rep.id, status: { notIn: [ORDER_STATUSES.CANCELLED, ORDER_STATUSES.RETURNED] } }, _sum: { totalCents: true } });
      assert((gross._sum.totalCents ?? 0) - totals.returnsTotalCents < (gross._sum.totalCents ?? 0), "net = gross - returns (gross itself is never rewritten)");
    });

    await check("CASE 18: merchant merge moves SalesReturn rows with the ledger and keeps the balance exact", async () => {
      const sourceOrder = await sellAndRead("c18s", [{ quantity: 5, unitPriceCents: nis(10) }], 0, 0);
      assert((await doReturn(sourceOrder.orderNumber, [{ orderItemId: sourceOrder.items[0]!.id, quantity: 2 }])).ok, "return on the source merchant's invoice");
      await sellAndRead("c18t", [{ quantity: 1, unitPriceCents: nis(10) }], 0, 0);
      assert((await balanceOf("c18s")) === nis(30) && (await balanceOf("c18t")) === nis(10), "pre-merge balances 30 / 10");
      const source = await prisma.merchant.findFirstOrThrow({ where: { assignedRepId: rep.id, contactPhone: `${runId}-c18s` }, select: { id: true, account: { select: { id: true } } } });
      const target = await prisma.merchant.findFirstOrThrow({ where: { assignedRepId: rep.id, contactPhone: `${runId}-c18t` }, select: { id: true, account: { select: { id: true } } } });
      await prisma.$transaction((tx) => mergeMerchants(tx, { sourceMerchantId: source.id, targetMerchantId: target.id, adminId: admin.id }));
      assert((await prisma.salesReturn.count({ where: { accountId: source.account!.id } })) === 0, "no SalesReturn may stay on the drained source account");
      assert((await prisma.salesReturn.count({ where: { accountId: target.account!.id } })) === 1, "the return now belongs to the target account");
      assert((await balanceOf("c18t")) === nis(40), "merged balance = 30 + 10 = 40 (the return credit survived the merge)");
    });

    await check("CASE 19: explicit bonus-unit return (qty 1, bonus 1) credits 0 and adds 1 to REP_CAR", async () => {
      const order = await sellAndRead("c19", [{ quantity: 5, unitPriceCents: nis(10), bonusQuantity: 1 }], 0, 0);
      const stockBefore = await carStock();
      const r = await doReturn(order.orderNumber, [{ orderItemId: order.items[0]!.id, quantity: 1, bonusQuantity: 1 }]);
      assert(r.ok && r.totalCreditCents === 0, `qty1/bonus1 must credit 0, got ${!r.ok ? r.error : r.totalCreditCents}`);
      assert((await carStock()) === stockBefore + 1, "REP_CAR +1");
    });

    await check("CASE 20: same invoice — explicit paid-unit return (qty 1, bonus 0) credits the paid-unit share", async () => {
      const order = await sellAndRead("c20", [{ quantity: 5, unitPriceCents: nis(10), bonusQuantity: 1 }], 0, 0);
      const stockBefore = await carStock();
      const r = await doReturn(order.orderNumber, [{ orderItemId: order.items[0]!.id, quantity: 1, bonusQuantity: 0 }]);
      // originalPaidQty = 4, net = 4000 -> one paid unit = 1000 (nis(10)).
      assert(r.ok && r.totalCreditCents === nis(10), `qty1/bonus0 must credit the paid-unit share (10), got ${!r.ok ? r.error : r.totalCreditCents / 100}`);
      assert((await carStock()) === stockBefore + 1, "REP_CAR +1");
    });

    await check("CASE 21: returning bonus qty 2 when the original line has only 1 bonus unit is rejected", async () => {
      const order = await sellAndRead("c21b", [{ quantity: 5, unitPriceCents: nis(10), bonusQuantity: 1 }], 0, 0);
      const stockBefore = await carStock();
      const r = await doReturn(order.orderNumber, [{ orderItemId: order.items[0]!.id, quantity: 2, bonusQuantity: 2 }]);
      assert(!r.ok && r.code === "EXCEEDS_RETURNABLE", `bonusQuantity 2 > original bonusQuantity 1 must be rejected, got ${JSON.stringify(r)}`);
      assert((await carStock()) === stockBefore && (await returnCount(order.id)) === 0, "no side effects from a rejected return");
    });

    await check("CASE 22: cumulative returned bonus quantity cannot exceed the original OrderItem.bonusQuantity", async () => {
      const order = await sellAndRead("c22", [{ quantity: 4, unitPriceCents: nis(10), bonusQuantity: 1 }], 0, 0);
      const item = order.items[0]!;
      // First return uses up the line's one original bonus unit.
      const first = await doReturn(order.orderNumber, [{ orderItemId: item.id, quantity: 2, bonusQuantity: 1 }]);
      assert(first.ok, `first return must succeed: ${!first.ok && first.error}`);
      // A second return declaring another bonus unit must be rejected — cumulative bonus (1 + 1) > original (1).
      const second = await doReturn(order.orderNumber, [{ orderItemId: item.id, quantity: 2, bonusQuantity: 1 }]);
      assert(!second.ok && second.code === "EXCEEDS_RETURNABLE", `cumulative bonus 2 > original bonus 1 must be rejected, got ${JSON.stringify(second)}`);
      // The same remaining 2 physical units, declared correctly as all-paid, must succeed and complete the invoice.
      const third = await doReturn(order.orderNumber, [{ orderItemId: item.id, quantity: 2, bonusQuantity: 0 }]);
      assert(third.ok, `remaining units declared all-paid must succeed: ${!third.ok && third.error}`);
      const totals = await prisma.salesReturn.aggregate({ where: { orderId: order.id }, _sum: { totalCreditCents: true } });
      assert(totals._sum.totalCreditCents === order.totalCents, `cumulative credit must equal Order.totalCents (${order.totalCents}), got ${totals._sum.totalCreditCents}`);
      assert((await getOrderReturnSummary(order.id)).status === "FULL", "invoice fully returned");
    });

    await check("CASE 23: full physical return of a mixed paid/bonus line credits exactly the line's net value", async () => {
      const order = await sellAndRead("c23", [{ quantity: 6, unitPriceCents: nis(10), bonusQuantity: 2 }], 0, 0);
      const stockBefore = await carStock();
      const r = await doReturn(order.orderNumber, [{ orderItemId: order.items[0]!.id, quantity: 6, bonusQuantity: 2 }]);
      assert(r.ok && r.totalCreditCents === order.totalCents, `full return of all 6 units must credit exactly Order.totalCents (${order.totalCents}), got ${!r.ok ? r.error : r.totalCreditCents}`);
      assert((await carStock()) === stockBefore + 6, "REP_CAR +6 (bonus units included)");
      assert((await balanceOf("c23")) === 0, "debt fully cleared");
    });

    await check("CASE 24: discounted invoice, mixed paid/bonus returns across two lines — exact final reconciliation", async () => {
      // Line A: 5 units @ 10.00, 1 bonus -> charged 4*10 = 40.00. Line B: 3 units @ 6.00, no bonus -> charged 18.00.
      // Subtotal 58.00, discount 8.00, total 50.00.
      const order = await sellAndRead(
        "c24",
        [
          { quantity: 5, unitPriceCents: nis(10), bonusQuantity: 1, productId: product.id },
          { quantity: 3, unitPriceCents: nis(6), productId: product2.id },
        ],
        nis(8),
        0,
      );
      assert(order.totalCents === nis(50), "invoice total 50.00");
      const [lineA, lineB] = [order.items.find((i) => i.productId === product.id)!, order.items.find((i) => i.productId === product2.id)!];
      const carABefore = await carStock(product.id);
      const carBBefore = await carStock(product2.id);

      // Step 1: partial mixed return — line A: 3 physical (2 paid + 1 bonus); line B: 1 paid.
      const step1 = await doReturn(order.orderNumber, [
        { orderItemId: lineA.id, quantity: 3, bonusQuantity: 1 },
        { orderItemId: lineB.id, quantity: 1 },
      ]);
      assert(step1.ok, `step 1 must succeed: ${!step1.ok && step1.error}`);
      assert(step1.ok && step1.totalCreditCents > 0 && step1.totalCreditCents < order.totalCents, "partial credit is strictly between 0 and the invoice total");

      // Step 2: return every remaining physical unit of both lines (line A: 2 remaining paid units; line B: 2 remaining paid units).
      const step2 = await doReturn(order.orderNumber, [
        { orderItemId: lineA.id, quantity: 2 },
        { orderItemId: lineB.id, quantity: 2 },
      ]);
      assert(step2.ok, `step 2 must succeed: ${!step2.ok && step2.error}`);

      const totals = await prisma.salesReturn.aggregate({ where: { orderId: order.id }, _sum: { totalCreditCents: true } });
      assert(totals._sum.totalCreditCents === order.totalCents, `cumulative credit across both mixed steps must equal Order.totalCents (${order.totalCents}), got ${totals._sum.totalCreditCents}`);
      assert((await carStock(product.id)) === carABefore + 5, "line A REP_CAR +5 (bonus unit included)");
      assert((await carStock(product2.id)) === carBBefore + 3, "line B REP_CAR +3");
      assert((await balanceOf("c24")) === 0, "debt fully cleared by the fully-returned discounted invoice");
      const bonusReturned = await prisma.salesReturnItem.aggregate({ where: { orderItemId: lineA.id }, _sum: { bonusQuantity: true } });
      assert(bonusReturned._sum.bonusQuantity === 1, "exactly line A's one original bonus unit was ever declared as returned-bonus");
      assert((await getOrderReturnSummary(order.id)).status === "FULL", "invoice fully returned");
    });

    await check("CASE 25: all-bonus line (quantity 3, bonus 3, originalPaidQty 0) — partial then final return, no division by zero", async () => {
      const order = await sellAndRead("c25", [{ quantity: 3, unitPriceCents: nis(10), bonusQuantity: 3 }], 0, 0);
      const item = order.items[0]!;
      assert(item.totalCents === 0 && order.totalCents === 0, "a fully-bonus line/invoice charges 0");
      const stockBefore = await carStock();
      const balanceBefore = await balanceOf("c25");

      const first = await doReturn(order.orderNumber, [{ orderItemId: item.id, quantity: 2, bonusQuantity: 2 }]);
      assert(first.ok, `partial all-bonus return must be accepted: ${!first.ok && first.error}`);
      assert(first.ok && first.totalCreditCents === 0, "monetary credit is 0");
      assert((await carStock()) === stockBefore + 2, "REP_CAR +2");
      assert((await balanceOf("c25")) === balanceBefore, "merchant balance unchanged");
      assert((await prisma.accountPayment.count({ where: { sourceOrderId: order.id } })) === 0, "no fake payment/refund row");
      const midSummary = await getOrderReturnSummary(order.id);
      const midLine = midSummary.lines.get(item.id)!;
      assert(midLine.remainingQuantity === 1, `remaining physical returnable must be 1, got ${midLine.remainingQuantity}`);
      assert(midLine.remainingBonusQuantity === 1, `remaining bonus returnable must be 1, got ${midLine.remainingBonusQuantity}`);
      assert(midLine.remainingQuantity - midLine.remainingBonusQuantity === 0, "remaining paid returnable must be 0");
      assert(midSummary.status === "PARTIAL", "status PARTIAL after 2 of 3 returned");

      const second = await doReturn(order.orderNumber, [{ orderItemId: item.id, quantity: 1, bonusQuantity: 1 }]);
      assert(second.ok, `final all-bonus unit return must be accepted: ${!second.ok && second.error}`);
      assert(second.ok && second.totalCreditCents === 0, "final unit's credit is 0");
      assert((await carStock()) === stockBefore + 3, "REP_CAR +3 total (cumulative physical returned = 3)");
      assert((await balanceOf("c25")) === balanceBefore, "merchant balance still unchanged");
      const finalRow = await prisma.salesReturnItem.aggregate({ where: { orderItemId: item.id }, _sum: { quantity: true, bonusQuantity: true, creditCents: true } });
      assert(finalRow._sum.quantity === 3, "cumulative physical returned = 3");
      assert(finalRow._sum.bonusQuantity === 3, "cumulative bonus returned = 3");
      assert((finalRow._sum.quantity ?? 0) - (finalRow._sum.bonusQuantity ?? 0) === 0, "cumulative paid returned = 0");
      assert(finalRow._sum.creditCents === 0, "cumulative credit = 0");
      assert((await getOrderReturnSummary(order.id)).status === "FULL", "return state FULL after all 3 bonus units returned");
    });

    await check("CASE 26: an all-bonus line (originalPaidQty 0) rejects a return declaring ANY paid unit", async () => {
      const order = await sellAndRead("c26", [{ quantity: 3, unitPriceCents: nis(10), bonusQuantity: 3 }], 0, 0);
      const item = order.items[0]!;
      const stockBefore = await carStock();
      const r = await doReturn(order.orderNumber, [{ orderItemId: item.id, quantity: 1, bonusQuantity: 0 }]);
      assert(!r.ok && r.code === "EXCEEDS_RETURNABLE", `qty1/bonus0 against an all-bonus line (0 paid units available) must be rejected, got ${JSON.stringify(r)}`);
      assert((await carStock()) === stockBefore && (await returnCount(order.id)) === 0, "no side effects from the rejected return");
      // A subsequent, correctly-declared all-bonus return of the same unit must still work fine afterward.
      const ok = await doReturn(order.orderNumber, [{ orderItemId: item.id, quantity: 1, bonusQuantity: 1 }]);
      assert(ok.ok && ok.totalCreditCents === 0, "correctly-declared bonus return succeeds with 0 credit");
    });

    console.log("\nAll sales-return verification checks passed");
  } finally {
    const orderFilter = { OR: [{ createdByRep: { employeeCode: { startsWith: runId } } }, { contactPhone: { startsWith: runId } }] };
    await prisma.salesReturnItem.deleteMany({ where: { salesReturn: { salesRep: { employeeCode: { startsWith: runId } } } } });
    await prisma.salesReturn.deleteMany({ where: { salesRep: { employeeCode: { startsWith: runId } } } });
    await prisma.accountPaymentCancellation.deleteMany({ where: { payment: { createdBy: { email: { startsWith: runId } } } } });
    await prisma.accountPayment.deleteMany({ where: { createdBy: { email: { startsWith: runId } } } });
    await prisma.stockMovement.deleteMany({ where: { product: { sku: { startsWith: runId } } } });
    await prisma.orderInventoryCompensation.deleteMany({ where: { order: orderFilter } });
    await prisma.orderStatusHistory.deleteMany({ where: { order: orderFilter } });
    await prisma.orderItem.deleteMany({ where: { order: orderFilter } });
    await prisma.order.deleteMany({ where: orderFilter });
    await prisma.customerAccount.deleteMany({ where: { merchant: { assignedRep: { employeeCode: { startsWith: runId } } } } });
    await prisma.merchant.deleteMany({ where: { assignedRep: { employeeCode: { startsWith: runId } } } });
    await prisma.inventoryItem.deleteMany({ where: { product: { sku: { startsWith: runId } } } });
    await prisma.product.deleteMany({ where: { sku: { startsWith: runId } } });
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
