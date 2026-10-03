/**
 * Real-database verification for the REP "current CALENDAR month to date"
 * sales default: getBusinessMonthRange / resolveMonthToDateReportRange
 * (src/lib/reporting.ts), used by BOTH the /rep dashboard KPI and the
 * /rep/sales default date filter, over the canonical fetchSaleActivityRows /
 * computeActivityTotals — no separate sales formula. Read-only reporting;
 * nothing here changes any accounting, payment or inventory logic.
 *
 * Regression pinned here: /rep/sales used to default to
 * getDefaultReportRange (the trailing 30 days — on 2026-10-03 that is
 * 2026-09-03..2026-10-03), so September sales leaked into a "monthly" view.
 * The monthly figure must reset on the 1st of each Palestine calendar month.
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
  const fs = await import("node:fs");
  const [{ PrismaClient }, constants, repSales, reporting] = await Promise.all([
    import("@prisma/client"),
    import("../src/lib/constants"),
    import("../src/lib/rep-sales"),
    import("../src/lib/reporting"),
  ]);

  const prisma = new PrismaClient();
  const { ROLES, STOCK_LOCATION_TYPES, ACCOUNT_PAYMENT_METHODS, ORDER_SOURCES, ORDER_STATUSES } = constants;
  const { createRepSaleCore } = repSales;
  const { fetchSaleActivityRows, computeActivityTotals, getBusinessMonthRange, getDefaultReportRange, resolveMonthToDateReportRange } = reporting;
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
  const iso = (value: { fromIso: string; toIso: string }) => JSON.stringify(value);

  const admin = await prisma.user.create({ data: { role: ROLES.ADMIN, name: `${runId}-admin`, email: `${runId}-admin@example.invalid`, isActive: true } });
  const repUser = await prisma.user.create({ data: { role: ROLES.SALES_REPRESENTATIVE, name: `${runId}-repA`, email: `${runId}-repA@example.invalid`, isActive: true } });
  const otherRepUser = await prisma.user.create({ data: { role: ROLES.SALES_REPRESENTATIVE, name: `${runId}-repB`, email: `${runId}-repB@example.invalid`, isActive: true } });
  // A dedicated REP for every fixed-date case so the real-time admin-on-behalf
  // sale below can never leak into their totals.
  const fixedRepUser = await prisma.user.create({ data: { role: ROLES.SALES_REPRESENTATIVE, name: `${runId}-repFixed`, email: `${runId}-repFixed@example.invalid`, isActive: true } });
  const rep = await prisma.salesRepresentative.create({ data: { userId: repUser.id, employeeCode: `${runId}-repA` } });
  const otherRep = await prisma.salesRepresentative.create({ data: { userId: otherRepUser.id, employeeCode: `${runId}-repB` } });
  const fixedRep = await prisma.salesRepresentative.create({ data: { userId: fixedRepUser.id, employeeCode: `${runId}-repFixed` } });
  const repCar = await prisma.stockLocation.create({ data: { type: STOCK_LOCATION_TYPES.REP_CAR, name: `${runId}-car`, salesRepId: rep.id } });
  const product = await prisma.product.create({ data: { sku: `${runId}-p1`, name: `${runId}-p1`, retailPriceCents: 1000, wholesalePriceCents: 800, isActive: true } });
  await prisma.inventoryItem.create({ data: { productId: product.id, locationId: repCar.id, quantity: 100_000 } });

  // 2026-10-03 12:00 in Palestine (+03): the exact regression date.
  const NOW = new Date("2026-10-03T09:00:00Z");

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
  async function makeOrder(label: string, opts: { totalCents: number; hebronWallClock: string; repId: string; status?: string }) {
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
        createdByRepId: opts.repId,
        createdAt: await naiveCreatedAtForHebron(opts.hebronWallClock),
      },
    });
  }
  async function monthSales(repId: string, range: { fromIso: string; toIso: string }) {
    const rows = await fetchSaleActivityRows({ fromIso: range.fromIso, toIso: range.toIso, salesRepId: repId }, (n) => `/rep/sales/${n}`);
    return { rows, totals: computeActivityTotals(rows, []) };
  }
  const has = (rows: { documentNumber: string }[], order: { orderNumber: string }) => rows.some((row) => row.documentNumber === order.orderNumber);

  try {
    await check("0. calendar month to date — NOT a rolling window (pure helpers)", async () => {
      assert(iso(getBusinessMonthRange(NOW)) === iso({ fromIso: "2026-10-01", toIso: "2026-10-03" }), "2026-10-03 -> 2026-10-01..2026-10-03");
      assert(getBusinessMonthRange(NOW).fromIso !== "2026-09-03", "never the trailing-30-days start");
      assert(getDefaultReportRange(NOW).fromIso === "2026-09-03", "control: the old /rep/sales default really was the rolling window (2026-09-03)");
      assert(iso(getBusinessMonthRange(new Date("2027-01-05T09:00:00Z"))) === iso({ fromIso: "2027-01-01", toIso: "2027-01-05" }), "year rollover: 2027-01-05 -> 2027-01-01..2027-01-05");
      assert(iso(getBusinessMonthRange(new Date("2026-09-30T20:59:30Z"))) === iso({ fromIso: "2026-09-01", toIso: "2026-09-30" }), "Sep 30 23:59:30 Hebron is still September");
      assert(iso(getBusinessMonthRange(new Date("2026-09-30T21:00:30Z"))) === iso({ fromIso: "2026-10-01", toIso: "2026-10-01" }), "Oct 1 00:00:30 Hebron is October (the month resets)");
      assert(iso(getBusinessMonthRange(new Date("2026-01-31T21:59:30Z"))) === iso({ fromIso: "2026-01-01", toIso: "2026-01-31" }), "winter (+02) Jan 31 23:59:30");
      assert(iso(getBusinessMonthRange(new Date("2026-01-31T22:00:30Z"))) === iso({ fromIso: "2026-02-01", toIso: "2026-02-01" }), "winter (+02) Feb 1 00:00:30");
    });

    // Fixed-date data, all for fixedRep. Sep 3 / Sep 15 / Sep 30 23:59 sit inside a rolling 30-day window
    // ending 2026-10-03 but outside the calendar month; Oct 5 is after "now".
    const sep3 = await makeOrder("sep3", { totalCents: 1_000, hebronWallClock: "2026-09-03 12:00:00", repId: fixedRep.id });
    const sep15 = await makeOrder("sep15", { totalCents: 2_000, hebronWallClock: "2026-09-15 12:00:00", repId: fixedRep.id });
    const sep30 = await makeOrder("sep30", { totalCents: 4_000, hebronWallClock: "2026-09-30 23:59:00", repId: fixedRep.id });
    const oct1 = await makeOrder("oct1", { totalCents: 8_000, hebronWallClock: "2026-10-01 00:00:00", repId: fixedRep.id });
    const oct3 = await makeOrder("oct3", { totalCents: 16_000, hebronWallClock: "2026-10-03 10:00:00", repId: fixedRep.id });
    const oct5 = await makeOrder("oct5-future", { totalCents: 32_000, hebronWallClock: "2026-10-05 12:00:00", repId: fixedRep.id });

    await check("1-5. on 2026-10-03: Sep 30 23:59 out, Oct 1 00:00 in, Oct 3 in, a sale after today out; September never counted", async () => {
      const { rows, totals } = await monthSales(fixedRep.id, getBusinessMonthRange(NOW));
      assert(!has(rows, sep30) && !has(rows, sep15) && !has(rows, sep3), "no September sale (including those a rolling 30 days would include)");
      assert(has(rows, oct1) && has(rows, oct3), "Oct 1 00:00 and Oct 3 are included");
      assert(!has(rows, oct5), "a sale dated after today is not month-to-date");
      assert(totals.salesTotalCents === 24_000 && totals.salesCount === 2, `total = Oct 1 + Oct 3 only, got ${totals.salesTotalCents}/${totals.salesCount}`);
      const rolling = await monthSales(fixedRep.id, getDefaultReportRange(NOW));
      assert(rolling.totals.salesTotalCents === 31_000, "control: the OLD rolling range would have counted the September sales too (1000+2000+4000+8000+16000)");
    });

    await check("9. the /rep dashboard KPI and the /rep/sales default range produce the SAME totals", async () => {
      const dashboardRange = getBusinessMonthRange(NOW);
      const salesPageRange = resolveMonthToDateReportRange(undefined, undefined, NOW);
      assert(iso(dashboardRange) === iso(salesPageRange), "identical default range");
      assert(iso(resolveMonthToDateReportRange("", "  ", NOW)) === iso(salesPageRange), "blank params fall back to the default too");
      const dashboard = await monthSales(fixedRep.id, dashboardRange);
      const salesPage = await monthSales(fixedRep.id, salesPageRange);
      assert(dashboard.totals.salesTotalCents === salesPage.totals.salesTotalCents && dashboard.totals.salesCount === salesPage.totals.salesCount, "same totals");
      assert(dashboard.totals.salesTotalCents === 24_000, "and they are the October-to-date figure");
    });

    await check("10. explicit custom date filters on /rep/sales still win over the default", async () => {
      const sept = resolveMonthToDateReportRange("2026-09-01", "2026-09-30", NOW);
      assert(iso(sept) === iso({ fromIso: "2026-09-01", toIso: "2026-09-30" }), "both bounds preserved");
      const septSales = await monthSales(fixedRep.id, sept);
      assert(septSales.totals.salesTotalCents === 7_000 && septSales.totals.salesCount === 3 && !has(septSales.rows, oct1), "September custom range = September sales only");
      const fromOnly = resolveMonthToDateReportRange("2026-09-15", undefined, NOW);
      assert(iso(fromOnly) === iso({ fromIso: "2026-09-15", toIso: "2026-10-03" }), "a custom from keeps the default to");
      const fromOnlySales = await monthSales(fixedRep.id, fromOnly);
      assert(fromOnlySales.totals.salesTotalCents === 30_000 && !has(fromOnlySales.rows, oct5), "Sep 15 .. Oct 3 total, the later sale still out");
      const toOnly = resolveMonthToDateReportRange(undefined, "2026-10-01", NOW);
      assert(iso(toOnly) === iso({ fromIso: "2026-10-01", toIso: "2026-10-01" }), "a custom to keeps the month start");
    });

    await check("8. cancelled / returned sales follow the canonical rule (excluded from the total, still listed)", async () => {
      const range = getBusinessMonthRange(NOW);
      const before = await monthSales(fixedRep.id, range);
      const cancelled = await makeOrder("cancelled", { totalCents: 77_000, hebronWallClock: "2026-10-02 12:05:00", status: ORDER_STATUSES.CANCELLED, repId: fixedRep.id });
      const returned = await makeOrder("returned", { totalCents: 66_000, hebronWallClock: "2026-10-02 12:06:00", status: ORDER_STATUSES.RETURNED, repId: fixedRep.id });
      const after = await monthSales(fixedRep.id, range);
      assert(after.totals.salesTotalCents === before.totals.salesTotalCents && after.totals.salesCount === before.totals.salesCount, "terminal sales do not change the total");
      assert(has(after.rows, cancelled) && has(after.rows, returned), "they remain visible as rows");
    });

    await check("7. an ADMIN-entered sale for the REP (createRepSaleCore with the admin as actor) still counts for that REP", async () => {
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

    await check("11. wiring guard: /rep and /rep/sales both use the calendar-month default (never the rolling getDefaultReportRange); date inputs submit ISO", async () => {
      const root = new URL("..", import.meta.url);
      const read = (path: string) => fs.readFileSync(new URL(path, root), "utf8");
      const dashboard = read("src/app/rep/page.tsx");
      const salesPage = read("src/app/rep/sales/page.tsx");
      assert(dashboard.includes("getBusinessMonthRange()") && !dashboard.includes("getDefaultReportRange"), "/rep dashboard uses getBusinessMonthRange, not the rolling default");
      assert(salesPage.includes("resolveMonthToDateReportRange(from, to)") && !salesPage.includes("getDefaultReportRange"), "/rep/sales default uses resolveMonthToDateReportRange, not the rolling default");
      assert(/name="from"[^>]*defaultValue={fromIso}/.test(salesPage) && /name="to"[^>]*defaultValue={toIso}/.test(salesPage), "the date inputs are prefilled with the ISO strings (an <input type=date> always submits YYYY-MM-DD whatever the browser displays)");
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
