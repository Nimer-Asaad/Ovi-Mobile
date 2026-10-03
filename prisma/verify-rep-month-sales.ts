/**
 * Real-database verification for the REP dashboard "current month sales" KPI
 * (src/app/rep/page.tsx): getBusinessMonthRange + the canonical
 * fetchSaleActivityRows / computeActivityTotals the /rep/sales report uses —
 * no separate sales formula. Read-only reporting; nothing here changes any
 * accounting, payment or inventory logic.
 *
 * Safety rails via resolveVerifyDatabaseUrl (prisma/verify-guardrails.ts) —
 * same convention as every other prisma/verify-*.ts script: never runs
 * against a shared/production database.
 *
 * Run with: node --conditions=react-server --import tsx prisma/verify-rep-month-sales.ts
 * REP_MONTH_SALES_VERIFY_DATABASE_URL must point at a disposable localhost
 * PostgreSQL database whose name contains "verify".
 */

export {};

import { resolveVerifyDatabaseUrl } from "./verify-guardrails";

const resolved = resolveVerifyDatabaseUrl("REP_MONTH_SALES_VERIFY_DATABASE_URL");
console.log(`[verify-rep-month-sales] target: ${resolved.masked}`);

process.env.DATABASE_URL = resolved.url;
process.env.DIRECT_URL = resolved.url;

async function main() {
  const [{ PrismaClient }, constants, repSales, reporting] = await Promise.all([
    import("@prisma/client"),
    import("../src/lib/constants"),
    import("../src/lib/rep-sales"),
    import("../src/lib/reporting"),
  ]);

  const prisma = new PrismaClient();
  const { ROLES, STOCK_LOCATION_TYPES, ACCOUNT_PAYMENT_METHODS, ORDER_SOURCES, ORDER_STATUSES } = constants;
  const { createRepSaleCore } = repSales;
  const { fetchSaleActivityRows, computeActivityTotals, getBusinessMonthRange } = reporting;
  const runId = `verify-month-${Date.now()}`;

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

  const admin = await prisma.user.create({ data: { role: ROLES.ADMIN, name: `${runId}-admin`, email: `${runId}-admin@example.invalid`, isActive: true } });
  const repUser = await prisma.user.create({ data: { role: ROLES.SALES_REPRESENTATIVE, name: `${runId}-repA`, email: `${runId}-repA@example.invalid`, isActive: true } });
  const otherRepUser = await prisma.user.create({ data: { role: ROLES.SALES_REPRESENTATIVE, name: `${runId}-repB`, email: `${runId}-repB@example.invalid`, isActive: true } });
  const rep = await prisma.salesRepresentative.create({ data: { userId: repUser.id, employeeCode: `${runId}-repA` } });
  const otherRep = await prisma.salesRepresentative.create({ data: { userId: otherRepUser.id, employeeCode: `${runId}-repB` } });
  const repCar = await prisma.stockLocation.create({ data: { type: STOCK_LOCATION_TYPES.REP_CAR, name: `${runId}-car`, salesRepId: rep.id } });
  const product = await prisma.product.create({ data: { sku: `${runId}-p1`, name: `${runId}-p1`, retailPriceCents: 1000, wholesalePriceCents: 800, isActive: true } });
  await prisma.inventoryItem.create({ data: { productId: product.id, locationId: repCar.id, quantity: 100_000 } });

  let seq = 0;
  async function makeMerchant(label: string) {
    const merchant = await prisma.merchant.create({ data: { businessName: `${runId}-${label}`, assignedRepId: rep.id, status: "APPROVED", contactPhone: `${runId}-${label}` } });
    const account = await prisma.customerAccount.create({ data: { displayName: `${runId}-${label}`, merchantId: merchant.id } });
    return { merchant, account };
  }
  /** Naive createdAt that the report's Palestine-business-time conversion maps back to exactly `hebronWallClock`. */
  async function naiveCreatedAtForHebron(hebronWallClock: string): Promise<Date> {
    const rows = await prisma.$queryRaw<{ ts: Date }[]>`SELECT ((${hebronWallClock}::timestamp AT TIME ZONE 'Asia/Hebron') AT TIME ZONE current_setting('TIMEZONE')) AS "ts"`;
    return rows[0]!.ts;
  }
  async function makeOrder(label: string, opts: { totalCents: number; hebronWallClock: string; repId?: string; status?: string }) {
    const acc = await makeMerchant(label);
    return prisma.order.create({
      data: {
        orderNumber: `${runId}-O${++seq}`,
        source: ORDER_SOURCES.REP_SALE,
        status: opts.status ?? ORDER_STATUSES.DELIVERED,
        subtotalCents: opts.totalCents,
        totalCents: opts.totalCents,
        paymentMethod: "CASH",
        paymentStatus: "PAID",
        paidAmountCents: 0,
        merchantId: acc.merchant.id,
        accountId: acc.account.id,
        createdByRepId: opts.repId ?? rep.id,
        createdAt: await naiveCreatedAtForHebron(opts.hebronWallClock),
      },
    });
  }
  async function monthSales(repId: string, range: { fromIso: string; toIso: string }) {
    const rows = await fetchSaleActivityRows({ fromIso: range.fromIso, toIso: range.toIso, salesRepId: repId }, (n) => `/rep/sales/${n}`);
    return { rows, totals: computeActivityTotals(rows, []) };
  }

  try {
    await check("0. getBusinessMonthRange follows the Palestine calendar (summer +03 and winter +02 month boundaries)", async () => {
      // 20:59:30Z = 23:59:30 Hebron (+03) on Sep 30; 21:00:30Z = 00:00:30 Hebron on Oct 1.
      assert(JSON.stringify(getBusinessMonthRange(new Date("2026-09-30T20:59:30Z"))) === JSON.stringify({ fromIso: "2026-09-01", toIso: "2026-09-30" }), "Sep 30 23:59:30 Hebron is still September");
      assert(JSON.stringify(getBusinessMonthRange(new Date("2026-09-30T21:00:30Z"))) === JSON.stringify({ fromIso: "2026-10-01", toIso: "2026-10-01" }), "Oct 1 00:00:30 Hebron is October");
      // 21:59:30Z = 23:59:30 Hebron (+02) on Jan 31; 22:00:30Z = 00:00:30 Hebron on Feb 1.
      assert(JSON.stringify(getBusinessMonthRange(new Date("2026-01-31T21:59:30Z"))) === JSON.stringify({ fromIso: "2026-01-01", toIso: "2026-01-31" }), "Jan 31 23:59:30 Hebron is still January");
      assert(JSON.stringify(getBusinessMonthRange(new Date("2026-01-31T22:00:30Z"))) === JSON.stringify({ fromIso: "2026-02-01", toIso: "2026-02-01" }), "Feb 1 00:00:30 Hebron is February");
      assert(getBusinessMonthRange(new Date("2026-12-31T21:30:00Z")).fromIso === "2026-12-01" && getBusinessMonthRange(new Date("2026-12-31T22:30:00Z")).fromIso === "2027-01-01", "year rollover");
    });

    await check("1+2. a current-month sale is included; a previous-month sale is excluded from the default total", async () => {
      const range = getBusinessMonthRange();
      const prevDay = new Date(`${range.fromIso}T12:00:00Z`);
      prevDay.setUTCDate(prevDay.getUTCDate() - 1);
      const prevIso = prevDay.toISOString().slice(0, 10);
      const inMonth = await makeOrder("cur", { totalCents: 12_300, hebronWallClock: `${range.toIso} 12:00:00` });
      const lastMonth = await makeOrder("prev", { totalCents: 45_600, hebronWallClock: `${prevIso} 12:00:00` });
      const { rows, totals } = await monthSales(rep.id, range);
      assert(rows.some((row) => row.documentNumber === inMonth.orderNumber), "current-month sale present");
      assert(!rows.some((row) => row.documentNumber === lastMonth.orderNumber), "previous-month sale absent");
      assert(totals.salesTotalCents === 12_300 && totals.salesCount === 1, `default total = current month only, got ${totals.salesTotalCents}/${totals.salesCount}`);
    });

    await check("3. an ADMIN-entered sale for the REP (createRepSaleCore with the admin as actor) still counts for that REP", async () => {
      const range = getBusinessMonthRange();
      const before = await monthSales(rep.id, range);
      try {
        const result = await createRepSaleCore(
          {
            items: [{ productId: product.id, colorId: null, variantId: null, deviceColorVariantId: null, quantity: 3, unitPriceCents: 1000, bonusQuantity: 0 }],
            customerName: `${runId}-admin-sale`,
            customerPhone: `${runId}-admin-sale`,
            city: undefined,
            address: undefined,
            notes: undefined,
            repCustomerOrderId: null,
            discountCents: 0,
            paidNowCents: 0,
            paidNowMethod: ACCOUNT_PAYMENT_METHODS.CASH,
          },
          { salesRepId: rep.id, carStockLocationId: repCar.id, actorUserId: admin.id },
        );
        assert(result.ok, `admin-on-behalf sale accepted: ${!result.ok && result.error}`);
      } catch (error) {
        if (!(error instanceof Error && error.message.includes("static generation store missing"))) throw error;
      }
      const after = await monthSales(rep.id, range);
      assert(after.totals.salesTotalCents - before.totals.salesTotalCents === 3000 && after.totals.salesCount - before.totals.salesCount === 1, "admin-entered sale counted for the REP");
      const other = await monthSales(otherRep.id, range);
      assert(other.totals.salesCount === 0, "and for nobody else");
    });

    await check("4. cancelled / returned sales follow the canonical rule (excluded from the total, still listed)", async () => {
      const range = getBusinessMonthRange();
      const before = await monthSales(rep.id, range);
      const cancelled = await makeOrder("cancelled", { totalCents: 77_000, hebronWallClock: `${range.toIso} 12:05:00`, status: ORDER_STATUSES.CANCELLED });
      const returned = await makeOrder("returned", { totalCents: 66_000, hebronWallClock: `${range.toIso} 12:06:00`, status: ORDER_STATUSES.RETURNED });
      const after = await monthSales(rep.id, range);
      assert(after.totals.salesTotalCents === before.totals.salesTotalCents && after.totals.salesCount === before.totals.salesCount, "terminal sales do not change the total");
      assert(after.rows.some((row) => row.documentNumber === cancelled.orderNumber) && after.rows.some((row) => row.documentNumber === returned.orderNumber), "they remain visible as rows");
    });

    await check("5. Asia/Hebron month boundary is respected (23:59:30 Sep 30 in, 00:00:30 Oct 1 out, 23:59:30 Aug 31 out)", async () => {
      const sepRange = getBusinessMonthRange(new Date("2026-09-30T20:30:00Z"));
      assert(sepRange.fromIso === "2026-09-01" && sepRange.toIso === "2026-09-30", "September range");
      const lastSecondOfSep = await makeOrder("sep-last", { totalCents: 1_100, hebronWallClock: "2026-09-30 23:59:30" });
      const firstOfOct = await makeOrder("oct-first", { totalCents: 2_200, hebronWallClock: "2026-10-01 00:00:30" });
      const lastOfAug = await makeOrder("aug-last", { totalCents: 4_400, hebronWallClock: "2026-08-31 23:59:30" });
      const { rows } = await monthSales(rep.id, sepRange);
      assert(rows.some((row) => row.documentNumber === lastSecondOfSep.orderNumber), "Sep 30 23:59:30 Hebron is in September");
      assert(!rows.some((row) => row.documentNumber === firstOfOct.orderNumber), "Oct 1 00:00:30 Hebron is not in September");
      assert(!rows.some((row) => row.documentNumber === lastOfAug.orderNumber), "Aug 31 23:59:30 Hebron is not in September");
    });

    console.log("ALL PASS");
  } finally {
    const orderFilter = { OR: [{ orderNumber: { startsWith: runId } }, { createdByRep: { employeeCode: { startsWith: runId } } }, { merchant: { businessName: { startsWith: runId } } }] };
    await prisma.accountPaymentCancellation.deleteMany({ where: { payment: { createdBy: { email: { startsWith: runId } } } } });
    await prisma.accountPayment.deleteMany({ where: { createdBy: { email: { startsWith: runId } } } });
    await prisma.stockMovement.deleteMany({ where: { product: { sku: { startsWith: runId } } } });
    await prisma.orderInventoryCompensation.deleteMany({ where: { order: orderFilter } });
    await prisma.orderStatusHistory.deleteMany({ where: { order: orderFilter } });
    await prisma.orderItem.deleteMany({ where: { order: orderFilter } });
    await prisma.order.deleteMany({ where: orderFilter });
    await prisma.customerAccount.deleteMany({ where: { merchant: { businessName: { startsWith: runId } } } });
    await prisma.merchant.deleteMany({ where: { businessName: { startsWith: runId } } });
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
