/**
 * Real-database verification for REP payment ATTRIBUTION
 * (src/lib/payment-attribution.ts) — which REP gets commercial credit for a
 * payment in REP reports, separate from AccountPayment.createdById (audit /
 * permission identity, never touched here).
 *
 * Covers the precedence LINKED (sourceOrderId -> order's rep) > LEGACY
 * (strict symmetric 1:1 match for pre-2026-09-07 rows) > CREATOR (entering
 * rep) > unattributed, every ambiguity guard, cancellation, merchant
 * reassignment, no-duplicate guarantee, the admin REP print report and both
 * AI rep tools — all read-only reporting; balances/payments never change.
 *
 * Safety rails via resolveVerifyDatabaseUrl (prisma/verify-guardrails.ts) —
 * same convention as every other prisma/verify-*.ts script: never runs
 * against a shared/production database.
 *
 * Run with: node --conditions=react-server --import tsx prisma/verify-rep-payment-attribution.ts
 * REP_PAYMENT_ATTRIBUTION_VERIFY_DATABASE_URL must point at a disposable
 * localhost PostgreSQL database whose name contains "verify", migrated with
 * `prisma migrate deploy`.
 */

export {};

import { resolveVerifyDatabaseUrl } from "./verify-guardrails";

const resolved = resolveVerifyDatabaseUrl("REP_PAYMENT_ATTRIBUTION_VERIFY_DATABASE_URL");
console.log(`[verify-rep-payment-attribution] target: ${resolved.masked}`);

process.env.DATABASE_URL = resolved.url;
process.env.DIRECT_URL = resolved.url;

async function main() {
  const [{ PrismaClient }, constants, repSales, accounts, attribution, reporting, printLoader, aiReps] = await Promise.all([
    import("@prisma/client"),
    import("../src/lib/constants"),
    import("../src/lib/rep-sales"),
    import("../src/lib/accounts"),
    import("../src/lib/payment-attribution"),
    import("../src/lib/reporting"),
    import("../src/lib/rep-transactions-print"),
    import("../src/lib/ai/tools/reps"),
  ]);

  const prisma = new PrismaClient();
  const { ROLES, STOCK_LOCATION_TYPES, ACCOUNT_PAYMENT_METHODS, ACCOUNT_PAYMENT_ORIGINS, ORDER_SOURCES, ORDER_STATUSES } = constants;
  const { createRepSaleCore } = repSales;
  const { getAccountBalanceCents } = accounts;
  const { getPaymentsAttributedToRep, dayRange, LEGACY_SALE_PAYMENT_MAX_GAP_SECONDS } = attribution;
  const { fetchPaymentActivityRows, computeActivityTotals } = reporting;
  const { loadRepTransactions } = printLoader;
  const { getRepSummary, getRepPaymentsSummary } = aiReps;
  const runId = `verify-attr-${Date.now()}`;

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

  assert(LEGACY_SALE_PAYMENT_MAX_GAP_SECONDS === 5, "documented legacy gap is 5 seconds");

  const admin = await prisma.user.create({ data: { role: ROLES.ADMIN, name: `${runId}-admin`, email: `${runId}-admin@example.invalid`, isActive: true } });
  const repUser = await prisma.user.create({ data: { role: ROLES.SALES_REPRESENTATIVE, name: `${runId}-repA`, email: `${runId}-repA@example.invalid`, isActive: true } });
  const repUserB = await prisma.user.create({ data: { role: ROLES.SALES_REPRESENTATIVE, name: `${runId}-repB`, email: `${runId}-repB@example.invalid`, isActive: true } });
  const rep = await prisma.salesRepresentative.create({ data: { userId: repUser.id, employeeCode: `${runId}-repA` } });
  const repB = await prisma.salesRepresentative.create({ data: { userId: repUserB.id, employeeCode: `${runId}-repB` } });
  const repCar = await prisma.stockLocation.create({ data: { type: STOCK_LOCATION_TYPES.REP_CAR, name: `${runId}-car`, salesRepId: rep.id } });
  const product = await prisma.product.create({ data: { sku: `${runId}-p1`, name: `${runId}-p1`, retailPriceCents: 1000, wholesalePriceCents: 800, isActive: true } });
  await prisma.inventoryItem.create({ data: { productId: product.id, locationId: repCar.id, quantity: 100_000 } });

  // Mid-day timestamps + multi-day ranges keep every assertion independent of
  // the database session time zone.
  const BASE = new Date("2026-03-10T12:00:00.000Z");
  const at = (offsetMs: number) => new Date(BASE.getTime() + offsetMs);
  const SEED_RANGE = dayRange("2026-03-09", "2026-03-11");
  const SEED_FROM = "2026-03-09";
  const SEED_TO = "2026-03-11";
  let seq = 0;

  async function makeAccount(label: string, assignedRepId: string | null = rep.id) {
    const merchant = await prisma.merchant.create({ data: { businessName: `${runId}-${label}`, assignedRepId, status: "APPROVED", contactPhone: `${runId}-${label}` } });
    const account = await prisma.customerAccount.create({ data: { displayName: `${runId}-${label}`, merchantId: merchant.id } });
    return { merchant, account };
  }
  async function makeOrder(acc: { merchant: { id: string }; account: { id: string } }, opts: { paidCents: number; createdAt: Date; repId?: string | null; source?: string }) {
    return prisma.order.create({
      data: {
        orderNumber: `${runId}-O${++seq}`,
        source: opts.source ?? ORDER_SOURCES.REP_SALE,
        status: ORDER_STATUSES.DELIVERED,
        subtotalCents: Math.max(opts.paidCents, 100),
        totalCents: Math.max(opts.paidCents, 100),
        paymentMethod: "CASH",
        paymentStatus: "PAID",
        paidAmountCents: opts.paidCents,
        merchantId: acc.merchant.id,
        accountId: acc.account.id,
        createdByRepId: opts.repId === undefined ? rep.id : opts.repId,
        createdAt: opts.createdAt,
      },
    });
  }
  async function makePayment(acc: { account: { id: string } }, opts: { cents: number; createdAt: Date; by: { id: string }; origin?: string | null; sourceOrderId?: string | null }) {
    return prisma.accountPayment.create({
      data: {
        accountId: acc.account.id,
        amountCents: opts.cents,
        method: ACCOUNT_PAYMENT_METHODS.CASH,
        createdById: opts.by.id,
        createdAt: opts.createdAt,
        origin: opts.origin ?? null,
        sourceOrderId: opts.sourceOrderId ?? null,
      },
    });
  }
  async function attributed(repId: string, range = SEED_RANGE) {
    const rows = await getPaymentsAttributedToRep(repId, range);
    return new Map(rows.map((row) => [row.id, row]));
  }

  // ---- real sale flow (createRepSaleCore): REP-entered and ADMIN-on-behalf ----
  async function realSale(label: string, actorUserId: string, paidNowCents: number) {
    const args = {
      items: [{ productId: product.id, colorId: null, variantId: null, deviceColorVariantId: null, quantity: 2, unitPriceCents: 1000, bonusQuantity: 0 }],
      customerName: `${runId}-${label}`,
      customerPhone: `${runId}-${label}`,
      city: undefined,
      address: undefined,
      notes: undefined,
      repCustomerOrderId: null,
      discountCents: 0,
      paidNowCents,
      paidNowMethod: ACCOUNT_PAYMENT_METHODS.CASH,
    };
    try {
      const result = await createRepSaleCore(args, { salesRepId: rep.id, carStockLocationId: repCar.id, actorUserId });
      assert(result.ok, `sale must be accepted: ${!result.ok && result.error}`);
    } catch (error) {
      if (!(error instanceof Error && error.message.includes("static generation store missing"))) throw error;
    }
    const merchant = await prisma.merchant.findFirstOrThrow({ where: { contactPhone: `${runId}-${label}` }, select: { id: true } });
    const order = await prisma.order.findFirstOrThrow({ where: { merchantId: merchant.id }, include: { initialPayment: true } });
    return { merchantId: merchant.id, order, payment: order.initialPayment! };
  }
  const WIDE = dayRange(new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10), new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10));

  try {
    let repEntered: Awaited<ReturnType<typeof realSale>>;
    let adminOnBehalf: Awaited<ReturnType<typeof realSale>>;

    await check("1. SALE_INITIAL created by the REP -> attributed to the order's rep (LINKED)", async () => {
      repEntered = await realSale("sale-by-rep", repUser.id, 1500);
      assert(repEntered.payment.origin === ACCOUNT_PAYMENT_ORIGINS.SALE_INITIAL && repEntered.payment.sourceOrderId === repEntered.order.id, "payment is a real linked SALE_INITIAL");
      assert(repEntered.payment.createdById === repUser.id, "entered by the rep");
      const map = await attributed(rep.id, WIDE);
      const row = map.get(repEntered.payment.id);
      assert(row && row.via === "LINKED" && row.orderId === repEntered.order.id, "attributed LINKED to the sale");
    });

    await check("2. SALE_INITIAL created by ADMIN for a REP order -> attributed to the order's rep; createdById stays ADMIN", async () => {
      adminOnBehalf = await realSale("sale-by-admin", admin.id, 1200);
      assert(adminOnBehalf.payment.createdById === admin.id, "audit identity stays the admin");
      const map = await attributed(rep.id, WIDE);
      const row = map.get(adminOnBehalf.payment.id);
      assert(row && row.via === "LINKED" && row.orderId === adminOnBehalf.order.id, "credited to the order's rep despite admin entry");
      const other = await attributed(repB.id, WIDE);
      assert(!other.has(adminOnBehalf.payment.id), "no other rep is credited");
      const reread = await prisma.accountPayment.findUniqueOrThrow({ where: { id: adminOnBehalf.payment.id } });
      assert(reread.createdById === admin.id, "createdById untouched by reporting");
    });

    await check("3. ADMIN_MANUAL order/payment with no REP order owner -> not attributed through the sale rule", async () => {
      const acc = await makeAccount("admin-manual-order");
      const order = await makeOrder(acc, { paidCents: 7000, createdAt: at(0), repId: null, source: ORDER_SOURCES.ADMIN_MANUAL });
      const payment = await makePayment(acc, { cents: 7000, createdAt: at(30), by: admin, origin: ACCOUNT_PAYMENT_ORIGINS.SALE_INITIAL, sourceOrderId: order.id });
      assert(!(await attributed(rep.id)).has(payment.id) && !(await attributed(repB.id)).has(payment.id), "no rep credited");
    });

    await check("4. REP-created MANUAL payment -> attributed to the creator rep (CREATOR)", async () => {
      const acc = await makeAccount("rep-manual");
      const payment = await makePayment(acc, { cents: 2500, createdAt: at(1000), by: repUser, origin: ACCOUNT_PAYMENT_ORIGINS.MANUAL });
      const row = (await attributed(rep.id)).get(payment.id);
      assert(row && row.via === "CREATOR" && row.orderId === null, "creator rule");
    });

    await check("5. ADMIN-created MANUAL payment (merchant assigned to the rep) -> NO rep attribution", async () => {
      const acc = await makeAccount("admin-manual");
      const payment = await makePayment(acc, { cents: 3300, createdAt: at(2000), by: admin, origin: ACCOUNT_PAYMENT_ORIGINS.MANUAL });
      assert(!(await attributed(rep.id)).has(payment.id), "not credited to the merchant's current rep");
      assert(!(await attributed(repB.id)).has(payment.id), "not credited to any rep");
    });

    await check("6. legacy NULL origin/sourceOrderId, same account+amount, unique near-simultaneous REP order -> attributed LEGACY", async () => {
      const acc = await makeAccount("legacy-ok");
      const order = await makeOrder(acc, { paidCents: 18000, createdAt: at(10_000) });
      const payment = await makePayment(acc, { cents: 18000, createdAt: at(10_040), by: admin });
      const row = (await attributed(rep.id)).get(payment.id);
      assert(row && row.via === "LEGACY" && row.orderId === order.id, "legacy strict match");
    });

    await check("7. legacy match with TWO possible orders -> no legacy attribution", async () => {
      const acc = await makeAccount("legacy-two-orders");
      await makeOrder(acc, { paidCents: 4100, createdAt: at(20_000) });
      await makeOrder(acc, { paidCents: 4100, createdAt: at(21_000) });
      const payment = await makePayment(acc, { cents: 4100, createdAt: at(21_200), by: admin });
      assert(!(await attributed(rep.id)).has(payment.id), "ambiguous -> unattributed");
    });

    await check("8. legacy match with TWO possible payments -> no legacy attribution for either", async () => {
      const acc = await makeAccount("legacy-two-payments");
      await makeOrder(acc, { paidCents: 5200, createdAt: at(30_000) });
      const p1 = await makePayment(acc, { cents: 5200, createdAt: at(30_050), by: admin });
      const p2 = await makePayment(acc, { cents: 5200, createdAt: at(30_900), by: admin });
      const map = await attributed(rep.id);
      assert(!map.has(p1.id) && !map.has(p2.id), "ambiguous -> neither attributed");
    });

    await check("9. wrong amount -> no legacy attribution", async () => {
      const acc = await makeAccount("legacy-amount");
      await makeOrder(acc, { paidCents: 6100, createdAt: at(40_000) });
      const payment = await makePayment(acc, { cents: 6000, createdAt: at(40_020), by: admin });
      assert(!(await attributed(rep.id)).has(payment.id), "amount mismatch");
    });

    await check("10. wrong account -> no legacy attribution", async () => {
      const accOrder = await makeAccount("legacy-acc-a");
      const accOther = await makeAccount("legacy-acc-b");
      await makeOrder(accOrder, { paidCents: 6200, createdAt: at(50_000) });
      const payment = await makePayment(accOther, { cents: 6200, createdAt: at(50_020), by: admin });
      assert(!(await attributed(rep.id)).has(payment.id), "account mismatch");
    });

    await check("11. timestamp outside the 5s threshold (and payment BEFORE its order) -> no legacy attribution; inside -> attributed", async () => {
      const inside = await makeAccount("legacy-gap-in");
      await makeOrder(inside, { paidCents: 6300, createdAt: at(60_000) });
      const pIn = await makePayment(inside, { cents: 6300, createdAt: at(60_000 + 4_900), by: admin });
      const outside = await makeAccount("legacy-gap-out");
      await makeOrder(outside, { paidCents: 6400, createdAt: at(70_000) });
      const pOut = await makePayment(outside, { cents: 6400, createdAt: at(70_000 + 5_100), by: admin });
      const before = await makeAccount("legacy-before");
      await makeOrder(before, { paidCents: 6500, createdAt: at(80_000) });
      const pBefore = await makePayment(before, { cents: 6500, createdAt: at(80_000 - 1_000), by: admin });
      const map = await attributed(rep.id);
      assert(map.get(pIn.id)?.via === "LEGACY", "4.9s is inside");
      assert(!map.has(pOut.id), "5.1s is outside");
      assert(!map.has(pBefore.id), "a payment never precedes its own order");
    });

    await check("12. cancelled payment stays excluded from ACTIVE totals (fetchPaymentActivityRows / computeActivityTotals) and the print totals", async () => {
      const acc = await makeAccount("cancelled");
      const order = await makeOrder(acc, { paidCents: 9100, createdAt: at(90_000) });
      const live = await makePayment(acc, { cents: 9100, createdAt: at(90_030), by: admin, origin: ACCOUNT_PAYMENT_ORIGINS.SALE_INITIAL, sourceOrderId: order.id });
      const rows = await fetchPaymentActivityRows({ fromIso: SEED_FROM, toIso: SEED_TO, attributedRepId: rep.id }, () => "#", () => "#", () => "#");
      const totalsBefore = computeActivityTotals([], rows);
      assert(rows.some((row) => row.id === live.id && !row.isCancelled), "active before cancellation");
      const printRange = { fromIso: SEED_FROM, toIso: SEED_TO, fromTime: "00:00", toTime: "23:59" };
      const printBefore = await loadRepTransactions({ id: rep.id, userId: repUser.id }, printRange);
      await prisma.accountPaymentCancellation.create({ data: { paymentId: live.id, reason: "verify", cancelledById: admin.id } });
      const rowsAfter = await fetchPaymentActivityRows({ fromIso: SEED_FROM, toIso: SEED_TO, attributedRepId: rep.id }, () => "#", () => "#", () => "#");
      const totalsAfter = computeActivityTotals([], rowsAfter);
      assert(rowsAfter.some((row) => row.id === live.id && row.isCancelled), "still attributed, flagged cancelled");
      assert(totalsBefore.paymentsTotalCents - totalsAfter.paymentsTotalCents === 9100, "cancelled amount leaves the active total");
      const printAfter = await loadRepTransactions({ id: rep.id, userId: repUser.id }, printRange);
      assert(printBefore.totals.paymentsTotalCents - printAfter.totals.paymentsTotalCents === 9100, "cancelled amount leaves the print total");
      const cancelledReceipt = printAfter.transactions.find((tx) => tx.type === "PAYMENT" && tx.receipt.id === live.id);
      assert(cancelledReceipt && cancelledReceipt.type === "PAYMENT" && cancelledReceipt.receipt.cancellation, "cancelled payment still prints, as a cancelled receipt");
    });

    await check("13. merchant reassignment does NOT change historical attribution", async () => {
      const before = await attributed(rep.id, WIDE);
      assert(before.has(adminOnBehalf.payment.id), "credited before");
      await prisma.merchant.update({ where: { id: adminOnBehalf.merchantId }, data: { assignedRepId: repB.id } });
      const afterA = await attributed(rep.id, WIDE);
      const afterB = await attributed(repB.id, WIDE);
      assert(afterA.has(adminOnBehalf.payment.id), "still credited to the sale's rep");
      assert(!afterB.has(adminOnBehalf.payment.id), "NOT moved to the new rep");
      const accManual = await makeAccount("reassign-manual");
      const manual = await makePayment(accManual, { cents: 1111, createdAt: at(100_000), by: admin, origin: ACCOUNT_PAYMENT_ORIGINS.MANUAL });
      await prisma.merchant.update({ where: { id: accManual.merchant.id }, data: { assignedRepId: repB.id } });
      assert(!(await attributed(repB.id)).has(manual.id) && !(await attributed(rep.id)).has(manual.id), "admin manual payment never follows the assignment");
    });

    await check("14. a payment can never appear twice (LINKED+CREATOR overlap, cross-rep precedence)", async () => {
      const rows = await getPaymentsAttributedToRep(rep.id, WIDE);
      const ids = rows.map((row) => row.id);
      assert(new Set(ids).size === ids.length, "unique ids");
      assert(rows.filter((row) => row.id === repEntered.payment.id).length === 1, "rep-entered linked payment counted once (also matches CREATOR)");
      // Entered by rep B's user but linked to rep A's order -> credited to A only.
      const acc = await makeAccount("cross-rep");
      const order = await makeOrder(acc, { paidCents: 8800, createdAt: at(110_000) });
      const crossed = await makePayment(acc, { cents: 8800, createdAt: at(110_030), by: repUserB, origin: ACCOUNT_PAYMENT_ORIGINS.SALE_INITIAL, sourceOrderId: order.id });
      assert((await attributed(rep.id)).get(crossed.id)?.via === "LINKED", "order's rep wins");
      assert(!(await attributed(repB.id)).has(crossed.id), "the entering rep is not double-credited");
    });

    await check("15. six-production-case pattern: admin-created legacy payment ms after a REP sale -> REP total + print embedded, data untouched", async () => {
      const acc = await makeAccount("six-case");
      const order = await makeOrder(acc, { paidCents: 18000, createdAt: at(120_000) });
      const payment = await makePayment(acc, { cents: 18000, createdAt: at(120_017), by: admin });
      const balanceBefore = getAccountBalanceCents(
        await prisma.customerAccount.findUniqueOrThrow({
          where: { id: acc.account.id },
          select: {
            openingBalanceCents: true,
            orders: { select: { status: true, totalCents: true } },
            payments: { select: { amountCents: true, cancellation: { select: { id: true } } } },
            salesReturns: { select: { totalCreditCents: true, reversal: { select: { id: true } } } },
          },
        }),
      );
      const { transactions, totals } = await loadRepTransactions({ id: rep.id, userId: repUser.id }, { fromIso: SEED_FROM, toIso: SEED_TO, fromTime: "00:00", toTime: "23:59" });
      assert(transactions.some((tx) => tx.type === "SALE" && tx.invoice.orderNumber === order.orderNumber), "invoice printed");
      assert(!transactions.some((tx) => tx.type === "PAYMENT" && tx.receipt.id === payment.id), "NOT also printed as a standalone receipt");
      assert(totals.embeddedPaymentsCount >= 1, "counted as embedded in its invoice");
      const rows = await fetchPaymentActivityRows({ fromIso: SEED_FROM, toIso: SEED_TO, attributedRepId: rep.id }, () => "#", () => "#", () => "#");
      assert(rows.some((row) => row.id === payment.id), "included in the REP's payment activity/total");
      const reread = await prisma.accountPayment.findUniqueOrThrow({ where: { id: payment.id } });
      assert(reread.origin === null && reread.sourceOrderId === null && reread.createdById === admin.id && reread.amountCents === 18000, "legacy row not modified (no backfill)");
      const balanceAfter = getAccountBalanceCents(
        await prisma.customerAccount.findUniqueOrThrow({
          where: { id: acc.account.id },
          select: {
            openingBalanceCents: true,
            orders: { select: { status: true, totalCents: true } },
            payments: { select: { amountCents: true, cancellation: { select: { id: true } } } },
            salesReturns: { select: { totalCreditCents: true, reversal: { select: { id: true } } } },
          },
        }),
      );
      assert(balanceBefore === balanceAfter, "balance is unchanged by reporting");
    });

    await check("16. AI tools use the same attribution (getRepSummary + getRepPaymentsSummary)", async () => {
      const period = { type: "CUSTOM" as const, fromIso: SEED_FROM, toIso: SEED_TO };
      const attributedRows = await getPaymentsAttributedToRep(rep.id, SEED_RANGE);
      const cancelled = await prisma.accountPaymentCancellation.count({ where: { paymentId: { in: attributedRows.map((row) => row.id) } } });
      const expectedActive = attributedRows.length - cancelled;
      assert(cancelled >= 1, "the cancelled payment from case 12 is among the attributed rows");
      const summary = await getRepSummary(rep.id, period);
      assert(summary, "summary exists");
      assert(summary.paymentsCollected.count === expectedActive, `rep summary count ${summary.paymentsCollected.count} matches attributed active ${expectedActive}`);
      const grouped = await getRepPaymentsSummary(period);
      const mine = grouped.reps.find((row) => row.repId === rep.id);
      assert(mine && mine.paymentsCount === summary.paymentsCollected.count && mine.amountCents === summary.paymentsCollected.totalCents, "grouped summary agrees with the single-rep summary");
      const forB = grouped.reps.find((row) => row.repId === repB.id);
      const attributedToB = (await getPaymentsAttributedToRep(repB.id, SEED_RANGE)).length;
      assert(attributedToB === 0 ? !forB : forB !== undefined, "rep B is reported independently");
    });

    await check("17. sourceOrderId set but origin is NOT SALE_INITIAL -> the order's rep is NOT credited through the sale rule", async () => {
      const acc = await makeAccount("odd-origin");
      const order = await makeOrder(acc, { paidCents: 2400, createdAt: at(130_000) });
      const odd = await makePayment(acc, { cents: 2400, createdAt: at(130_030), by: admin, origin: ACCOUNT_PAYMENT_ORIGINS.MANUAL, sourceOrderId: order.id });
      assert(!(await attributed(rep.id)).has(odd.id), "admin-entered non-SALE_INITIAL payment is not attributed via the order");
      const nullOrigin = await makePayment((await makeAccount("odd-origin-null")), { cents: 2500, createdAt: at(131_000), by: admin, origin: null, sourceOrderId: null });
      assert(!(await attributed(rep.id)).has(nullOrigin.id), "control: unlinked admin payment with no matching order stays unattributed");
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
