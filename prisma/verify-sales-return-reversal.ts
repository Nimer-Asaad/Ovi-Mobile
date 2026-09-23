/**
 * Real-database verification for ADMIN sales-return reversal
 * (src/lib/sales-return-reversal.ts) — the accounting/inventory mirror
 * image of src/lib/sales-returns.ts's createSalesReturn, plus the
 * order-lifecycle/reporting/merchant-merge interactions Part 5/4/6 of the
 * incident task require to be reversal-aware.
 *
 * Safety rails via resolveVerifyDatabaseUrl (prisma/verify-guardrails.ts) —
 * same convention as every other prisma/verify-*.ts script: never runs
 * against a shared/production database.
 *
 * Run with: node --conditions=react-server --import tsx prisma/verify-sales-return-reversal.ts
 * SALES_RETURN_REVERSAL_VERIFY_DATABASE_URL must point at a disposable
 * localhost PostgreSQL database whose name contains "verify", migrated with
 * `prisma migrate deploy`.
 */

export {};

import { resolveVerifyDatabaseUrl } from "./verify-guardrails";

const resolved = resolveVerifyDatabaseUrl("SALES_RETURN_REVERSAL_VERIFY_DATABASE_URL");
console.log(`[verify-sales-return-reversal] target: ${resolved.masked}`);

process.env.DATABASE_URL = resolved.url;
process.env.DIRECT_URL = resolved.url;

async function main() {
  const [{ PrismaClient }, constants, repSales, accounts, saleCorrection, salesReturns, salesReturnReversal, reporting, merge, statement] = await Promise.all([
    import("@prisma/client"),
    import("../src/lib/constants"),
    import("../src/lib/rep-sales"),
    import("../src/lib/accounts"),
    import("../src/lib/sale-correction"),
    import("../src/lib/sales-returns"),
    import("../src/lib/sales-return-reversal"),
    import("../src/lib/reporting"),
    import("../src/lib/merchant-merge"),
    import("../src/lib/account-statement"),
  ]);

  const prisma = new PrismaClient();
  const { ROLES, STOCK_LOCATION_TYPES, ACCOUNT_PAYMENT_METHODS, ORDER_STATUSES } = constants;
  const { createRepSaleCore } = repSales;
  const { getAccountBalanceCents, SALES_RETURN_STATEMENT_SELECT } = accounts;
  const { correctSale } = saleCorrection;
  const { createSalesReturn, getOrderReturnSummary } = salesReturns;
  const { reverseSalesReturn } = salesReturnReversal;
  const { fetchSalesReturnTotals, getBusinessDateIso } = reporting;
  const { mergeMerchants } = merge;
  const { buildAccountStatementRows } = statement;
  const runId = `verify-revert-${Date.now()}`;

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
  const warehouse = await prisma.stockLocation.create({ data: { type: STOCK_LOCATION_TYPES.WAREHOUSE, name: `${runId}-warehouse`, isDefault: true } });
  const product = await prisma.product.create({ data: { sku: `${runId}-p1`, name: `${runId}-p1`, retailPriceCents: 1000, wholesalePriceCents: 800, isActive: true } });
  await prisma.inventoryItem.create({ data: { productId: product.id, locationId: repCar.id, quantity: 100_000 } });
  await prisma.inventoryItem.create({ data: { productId: product.id, locationId: warehouse.id, quantity: 500 } });
  // Separate low-stock product, isolated to CASE 8 only, so the
  // insufficient-stock reversal test has a deterministic, small car
  // quantity to drain rather than depending on the shared high-stock
  // product's ever-changing absolute level.
  const scarceProduct = await prisma.product.create({ data: { sku: `${runId}-scarce`, name: `${runId}-scarce`, retailPriceCents: 1000, wholesalePriceCents: 800, isActive: true } });
  await prisma.inventoryItem.create({ data: { productId: scarceProduct.id, locationId: repCar.id, quantity: 5 } });

  interface SellItem {
    quantity: number;
    unitPriceCents: number;
    bonusQuantity?: number;
    productId?: string;
  }

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

  async function doReturn(orderNumber: string, lines: { orderItemId: string; quantity: number; bonusQuantity?: number }[]) {
    return createSalesReturn({ orderNumber, salesRepId: rep.id, carStockLocationId: repCar.id, actorUserId: repUser.id, lines });
  }

  async function doReverse(salesReturnId: string, reason = "verify reversal") {
    return reverseSalesReturn({ salesReturnId, actorUserId: admin.id, reason });
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

  async function carStock(productId = product.id): Promise<number> {
    return (await prisma.inventoryItem.findFirstOrThrow({ where: { productId, locationId: repCar.id, variantId: null, deviceColorVariantId: null }, select: { quantity: true } })).quantity;
  }

  try {
    await check("CASE 1: normal paid return, reversed — balance and REP_CAR restored", async () => {
      const order = await sellAndRead("c1", [{ quantity: 5, unitPriceCents: nis(10) }], 0, 0);
      const stockBefore = await carStock();
      const balanceBefore = await balanceOf("c1");
      const ret = await doReturn(order.orderNumber, [{ orderItemId: order.items[0]!.id, quantity: 2 }]);
      assert(ret.ok, "return must succeed");
      assert((await carStock()) === stockBefore + 2 && (await balanceOf("c1")) === balanceBefore - nis(20), "return applied");
      const rev = await doReverse(ret.ok ? ret.salesReturnId : "");
      assert(rev.ok, `reversal must succeed: ${!rev.ok && rev.error}`);
      assert((await carStock()) === stockBefore, "REP_CAR back to pre-return level");
      assert((await balanceOf("c1")) === balanceBefore, "balance back to pre-return level");
    });

    await check("CASE 2: partial return reversed leaves remaining returnable unchanged from before the reversed return", async () => {
      const order = await sellAndRead("c2", [{ quantity: 5, unitPriceCents: nis(10) }], 0, 0);
      const item = order.items[0]!;
      const first = await doReturn(order.orderNumber, [{ orderItemId: item.id, quantity: 2 }]);
      assert(first.ok, "first return ok");
      const rev = await doReverse(first.ok ? first.salesReturnId : "");
      assert(rev.ok, "reversal ok");
      const summary = await getOrderReturnSummary(order.id);
      assert(summary.lines.get(item.id)!.remainingQuantity === 5, `remaining must be back to 5, got ${summary.lines.get(item.id)!.remainingQuantity}`);
      assert(summary.status === "NONE", "status NONE — the reversed return no longer counts as returned");
    });

    await check("CASE 3: full return reversed — order becomes fully returnable again", async () => {
      const order = await sellAndRead("c3", [{ quantity: 4, unitPriceCents: nis(10) }], 0, 0);
      const item = order.items[0]!;
      const full = await doReturn(order.orderNumber, [{ orderItemId: item.id, quantity: 4 }]);
      assert(full.ok, "full return ok");
      assert((await getOrderReturnSummary(order.id)).status === "FULL", "status FULL before reversal");
      const rev = await doReverse(full.ok ? full.salesReturnId : "");
      assert(rev.ok, "reversal ok");
      assert((await getOrderReturnSummary(order.id)).status === "NONE", "status NONE after reversal");
      assert((await getOrderReturnSummary(order.id)).remainingUnits === 4, "all 4 units returnable again");
    });

    await check("CASE 4: all-bonus return reversed — REP_CAR restored, credit stays 0 throughout", async () => {
      const order = await sellAndRead("c4", [{ quantity: 3, unitPriceCents: nis(10), bonusQuantity: 3 }], 0, 0);
      const item = order.items[0]!;
      const stockBefore = await carStock();
      const balanceBefore = await balanceOf("c4");
      const ret = await doReturn(order.orderNumber, [{ orderItemId: item.id, quantity: 3, bonusQuantity: 3 }]);
      assert(ret.ok && ret.totalCreditCents === 0, "all-bonus return credits 0");
      const rev = await doReverse(ret.ok ? ret.salesReturnId : "");
      assert(rev.ok, "reversal ok");
      assert((await carStock()) === stockBefore && (await balanceOf("c4")) === balanceBefore, "stock and balance both back to baseline");
    });

    await check("CASE 5: mixed paid+bonus return reversed — exact restoration", async () => {
      const order = await sellAndRead("c5", [{ quantity: 6, unitPriceCents: nis(10), bonusQuantity: 2 }], 0, 0);
      const item = order.items[0]!;
      const stockBefore = await carStock();
      const balanceBefore = await balanceOf("c5");
      const ret = await doReturn(order.orderNumber, [{ orderItemId: item.id, quantity: 6, bonusQuantity: 2 }]);
      assert(ret.ok, "mixed return ok");
      const rev = await doReverse(ret.ok ? ret.salesReturnId : "");
      assert(rev.ok, "reversal ok");
      assert((await carStock()) === stockBefore, "REP_CAR restored exactly (paid + bonus units both removed again)");
      assert((await balanceOf("c5")) === balanceBefore, "balance restored exactly");
    });

    await check("CASE 6+7: merchant balance and REP_CAR quantity exactly restored across two returns", async () => {
      const order = await sellAndRead("c6", [{ quantity: 8, unitPriceCents: nis(10) }], 0, nis(10));
      const item = order.items[0]!;
      const stockBefore = await carStock();
      const balanceBefore = await balanceOf("c6");
      const r1 = await doReturn(order.orderNumber, [{ orderItemId: item.id, quantity: 3 }]);
      const r2 = await doReturn(order.orderNumber, [{ orderItemId: item.id, quantity: 2 }]);
      assert(r1.ok && r2.ok, "both returns ok");
      assert((await doReverse(r1.ok ? r1.salesReturnId : "")).ok, "reverse r1");
      assert((await doReverse(r2.ok ? r2.salesReturnId : "")).ok, "reverse r2");
      assert((await carStock()) === stockBefore, "REP_CAR exactly restored after both reversals");
      assert((await balanceOf("c6")) === balanceBefore, "balance exactly restored after both reversals");
    });

    await check("CASE 8: reversal blocked when REP_CAR stock is no longer sufficient (sold onward)", async () => {
      // scarceProduct's car stock starts at exactly 5.
      const order = await sellAndRead("c8", [{ quantity: 5, unitPriceCents: nis(10), productId: scarceProduct.id }], 0, 0);
      assert((await carStock(scarceProduct.id)) === 0, "car fully sold out after this sale");
      const item = order.items[0]!;
      const ret = await doReturn(order.orderNumber, [{ orderItemId: item.id, quantity: 5 }]);
      assert(ret.ok, "return ok");
      assert((await carStock(scarceProduct.id)) === 5, "the 5 units are back in the car after the return");
      // A real subsequent sale of the SAME returned units, to a different
      // merchant — exactly "returned units already sold/transferred onward".
      await sellAndRead("c8-drain", [{ quantity: 5, unitPriceCents: nis(10), productId: scarceProduct.id }], 0, 0);
      assert((await carStock(scarceProduct.id)) === 0, "car drained again by the second sale");
      const rev = await doReverse(ret.ok ? ret.salesReturnId : "");
      assert(!rev.ok && rev.code === "INSUFFICIENT_STOCK", `reversal must be blocked with INSUFFICIENT_STOCK, got ${JSON.stringify(rev)}`);
      assert((await carStock(scarceProduct.id)) === 0, "stock unchanged by the rejected reversal (never goes negative)");
      assert((await prisma.salesReturn.findUniqueOrThrow({ where: { id: ret.ok ? ret.salesReturnId : "" }, select: { reversal: { select: { id: true } } } })).reversal === null, "no reversal row created");
    });

    await check("CASE 9: double reversal rejected", async () => {
      const order = await sellAndRead("c9", [{ quantity: 4, unitPriceCents: nis(10) }], 0, 0);
      const item = order.items[0]!;
      const ret = await doReturn(order.orderNumber, [{ orderItemId: item.id, quantity: 4 }]);
      assert(ret.ok, "return ok");
      const first = await doReverse(ret.ok ? ret.salesReturnId : "");
      assert(first.ok, "first reversal ok");
      const second = await doReverse(ret.ok ? ret.salesReturnId : "");
      assert(!second.ok && second.code === "ALREADY_REVERSED", `second reversal must be rejected, got ${JSON.stringify(second)}`);
    });

    await check("CASE 10: concurrent double reversal — only one succeeds", async () => {
      const order = await sellAndRead("c10", [{ quantity: 4, unitPriceCents: nis(10) }], 0, 0);
      const item = order.items[0]!;
      const ret = await doReturn(order.orderNumber, [{ orderItemId: item.id, quantity: 4 }]);
      assert(ret.ok, "return ok");
      const salesReturnId = ret.ok ? ret.salesReturnId : "";
      const [a, b] = await Promise.all([doReverse(salesReturnId), doReverse(salesReturnId)]);
      const successes = [a, b].filter((r) => r.ok).length;
      assert(successes === 1, `exactly one concurrent reversal may win, got ${successes}`);
      const reversalCount = await prisma.salesReturnReversal.count({ where: { salesReturnId } });
      assert(reversalCount === 1, `exactly one SalesReturnReversal row may exist, got ${reversalCount}`);
    });

    await check("CASE 11: a reversed return is excluded from active cumulative bounds — its quantity can be returned again", async () => {
      const order = await sellAndRead("c11", [{ quantity: 5, unitPriceCents: nis(10) }], 0, 0);
      const item = order.items[0]!;
      const first = await doReturn(order.orderNumber, [{ orderItemId: item.id, quantity: 5 }]);
      assert(first.ok, "first full return ok");
      assert((await doReverse(first.ok ? first.salesReturnId : "")).ok, "reversal ok");
      const second = await doReturn(order.orderNumber, [{ orderItemId: item.id, quantity: 5 }]);
      assert(second.ok, `a fresh full return of the same 5 units must succeed after the first was reversed, got: ${!second.ok && second.error}`);
      assert(second.ok && second.sequence === 2, "the new return gets the NEXT sequence (2), never reusing sequence 1");
    });

    await check("CASE 12+13: order cancellation blocked while an active return exists, allowed once all returns are reversed", async () => {
      const order = await sellAndRead("c12", [{ quantity: 4, unitPriceCents: nis(10) }], 0, 0);
      const item = order.items[0]!;
      const ret = await doReturn(order.orderNumber, [{ orderItemId: item.id, quantity: 2 }]);
      assert(ret.ok, "return ok");
      const blocked = await correctSale({ orderNumber: order.orderNumber, reason: "verify", actorUserId: repUser.id });
      assert(!blocked.ok && blocked.code === "ORDER_HAS_SALES_RETURNS", `cancellation must be blocked while the return is active, got ${JSON.stringify(blocked)}`);
      assert((await doReverse(ret.ok ? ret.salesReturnId : "")).ok, "reversal ok");
      const allowed = await correctSale({ orderNumber: order.orderNumber, reason: "verify", actorUserId: repUser.id });
      assert(allowed.ok, `cancellation must now be allowed once every return is reversed, got ${JSON.stringify(allowed)}`);
      // A DELIVERED rep-sale order's correction always resolves to RETURNED
      // (never CANCELLED — see correctSale's own doc comment), and that IS
      // a terminal status, which is what actually matters here.
      const correctedOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, select: { status: true } });
      assert(correctedOrder.status === ORDER_STATUSES.RETURNED, `order must be RETURNED, got ${correctedOrder.status}`);
    });

    await check("CASE 14: reporting — a reversed return no longer reduces net sales", async () => {
      const today = getBusinessDateIso();
      const order = await sellAndRead("c14", [{ quantity: 5, unitPriceCents: nis(10) }], 0, 0);
      const item = order.items[0]!;
      const before = await fetchSalesReturnTotals({ fromIso: today, toIso: today, salesRepId: rep.id });
      const ret = await doReturn(order.orderNumber, [{ orderItemId: item.id, quantity: 3 }]);
      assert(ret.ok, "return ok");
      const afterReturn = await fetchSalesReturnTotals({ fromIso: today, toIso: today, salesRepId: rep.id });
      assert(afterReturn.returnsTotalCents === before.returnsTotalCents + nis(30), "return counted in totals");
      assert((await doReverse(ret.ok ? ret.salesReturnId : "")).ok, "reversal ok");
      const afterReversal = await fetchSalesReturnTotals({ fromIso: today, toIso: today, salesRepId: rep.id });
      assert(afterReversal.returnsTotalCents === before.returnsTotalCents, "reversed return no longer counted — net sales back to pre-return level");
      assert(afterReversal.returnsCount === before.returnsCount, "reversed return excluded from the count too");
    });

    await check("CASE 15: statement shows both the return (credit) and the reversal (debit), running balance explainable", async () => {
      const order = await sellAndRead("c15", [{ quantity: 5, unitPriceCents: nis(10) }], 0, 0);
      const item = order.items[0]!;
      const ret = await doReturn(order.orderNumber, [{ orderItemId: item.id, quantity: 2 }]);
      assert(ret.ok, "return ok");
      assert((await doReverse(ret.ok ? ret.salesReturnId : "")).ok, "reversal ok");
      const merchant = await prisma.merchant.findFirstOrThrow({
        where: { assignedRepId: rep.id, contactPhone: `${runId}-c15` },
        select: {
          account: {
            select: {
              id: true,
              openingBalanceCents: true,
              openingBalanceSetAt: true,
              orders: { select: { orderNumber: true, createdAt: true, status: true, totalCents: true } },
              payments: { select: { id: true, amountCents: true, method: true, createdAt: true, note: true, cancellation: { select: { id: true, reason: true, cancelledAt: true } } } },
              salesReturns: SALES_RETURN_STATEMENT_SELECT,
            },
          },
        },
      });
      const row = await prisma.salesReturn.findFirstOrThrow({ where: { orderId: order.id }, select: SALES_RETURN_STATEMENT_SELECT.select });
      assert(row.reversal !== null, "reversal is visible on the original return row");
      assert(row.totalCreditCents === nis(20), "original return's own credit is never rewritten");
      const stillExists = await prisma.salesReturn.findUnique({ where: { id: row.id } });
      assert(stillExists !== null, "the original SalesReturn row is never deleted");

      const rows = buildAccountStatementRows({
        openingBalanceCents: merchant.account!.openingBalanceCents,
        openingBalanceSetAt: merchant.account!.openingBalanceSetAt,
        orders: merchant.account!.orders,
        payments: merchant.account!.payments,
        salesReturns: merchant.account!.salesReturns,
      });
      const returnRow = rows.find((r) => r.type === "SALES_RETURN");
      const reversalRow = rows.find((r) => r.type === "SALES_RETURN_REVERSAL");
      assert(returnRow !== undefined && returnRow.creditCents === nis(20) && returnRow.isReversedReturn, "the original SALES_RETURN row still shows its own credit and is flagged reversed");
      assert(reversalRow !== undefined && reversalRow.debitCents === nis(20), "a separate SALES_RETURN_REVERSAL debit row exists at the reversal's own date");
      assert(rows[rows.length - 1]!.balanceCents === getAccountBalanceCents(merchant.account!), "the statement's final running balance matches the canonical formula exactly");
    });

    await check("CASE 23: merchant merge remains valid with a reversed SalesReturn on the source account", async () => {
      const sourceOrder = await sellAndRead("c23s", [{ quantity: 5, unitPriceCents: nis(10) }], 0, 0);
      const ret = await doReturn(sourceOrder.orderNumber, [{ orderItemId: sourceOrder.items[0]!.id, quantity: 2 }]);
      assert(ret.ok, "return ok");
      assert((await doReverse(ret.ok ? ret.salesReturnId : "")).ok, "reversal ok");
      await sellAndRead("c23t", [{ quantity: 1, unitPriceCents: nis(10) }], 0, 0);
      const balanceSourceBefore = await balanceOf("c23s");
      const balanceTargetBefore = await balanceOf("c23t");
      const source = await prisma.merchant.findFirstOrThrow({ where: { assignedRepId: rep.id, contactPhone: `${runId}-c23s` }, select: { id: true, account: { select: { id: true } } } });
      const target = await prisma.merchant.findFirstOrThrow({ where: { assignedRepId: rep.id, contactPhone: `${runId}-c23t` }, select: { id: true, account: { select: { id: true } } } });
      await prisma.$transaction((tx) => mergeMerchants(tx, { sourceMerchantId: source.id, targetMerchantId: target.id, adminId: admin.id }));
      assert((await prisma.salesReturn.count({ where: { accountId: source.account!.id } })) === 0, "no SalesReturn stays on the drained source account");
      const movedReturn = await prisma.salesReturn.findFirstOrThrow({ where: { accountId: target.account!.id, orderId: sourceOrder.id }, select: { id: true, reversal: { select: { id: true } } } });
      assert(movedReturn.reversal !== null, "the reversal relation survives the merge — never recreated, never lost");
      assert((await balanceOf("c23t")) === balanceTargetBefore + balanceSourceBefore, "merged balance = sum of both pre-merge balances (the reversed return still nets to 0, contributing nothing extra)");
    });

    console.log("\nAll sales-return-reversal verification checks passed");
  } finally {
    const orderFilter = { OR: [{ createdByRep: { employeeCode: { startsWith: runId } } }, { contactPhone: { startsWith: runId } }] };
    await prisma.salesReturnReversal.deleteMany({ where: { salesReturn: { salesRep: { employeeCode: { startsWith: runId } } } } });
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
