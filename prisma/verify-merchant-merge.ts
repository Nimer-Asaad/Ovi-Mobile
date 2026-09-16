/**
 * Real-database verification for the ADMIN merchant-merge feature
 * (src/lib/merchant-merge.ts). Safety rails via resolveVerifyDatabaseUrl
 * (prisma/verify-guardrails.ts) — same convention as every other
 * prisma/verify-*.ts script: never runs against a shared/production
 * database, requires the target database's name to contain "verify" and
 * its host to be localhost.
 *
 * This is a genuinely destructive, real-transaction test — it creates real
 * Users/Merchants/CustomerAccounts/Orders/AccountPayments in the target
 * database and runs the actual mergeMerchants function against them inside
 * a real prisma.$transaction, exactly as production code would.
 *
 * Run with: node --conditions=react-server --import tsx prisma/verify-merchant-merge.ts
 * MERCHANT_MERGE_VERIFY_DATABASE_URL must be set to a disposable localhost
 * PostgreSQL database whose name contains "verify" before running this.
 */

export {};

import { resolveVerifyDatabaseUrl } from "./verify-guardrails";

const resolved = resolveVerifyDatabaseUrl("MERCHANT_MERGE_VERIFY_DATABASE_URL");
console.log(`[verify-merchant-merge] target: ${resolved.masked}`);

process.env.DATABASE_URL = resolved.url;
process.env.DIRECT_URL = resolved.url;

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

async function main() {
  const [{ PrismaClient }, constants, accounts, merge, repMerchants] = await Promise.all([
    import("@prisma/client"),
    import("../src/lib/constants"),
    import("../src/lib/accounts"),
    import("../src/lib/merchant-merge"),
    import("../src/lib/rep-merchants"),
  ]);

  const prisma = new PrismaClient();
  const {
    ROLES,
    MERCHANT_STATUSES,
    ORDER_STATUSES,
    ORDER_SOURCES,
    ACCOUNT_PAYMENT_METHODS,
    ACCOUNT_PAYMENT_ORIGINS,
    STOCK_LOCATION_TYPES,
    STOCK_MOVEMENT_TYPES,
    REP_LOAD_TYPES,
    REP_CUSTOMER_ORDER_STATUSES,
  } = constants;
  const { recordManualAccountPayment } = accounts;
  const { mergeMerchants, previewMerchantMerge, MerchantMergeError } = merge;
  const { getRepTraderContactsForSaleForm } = repMerchants;
  const runId = `verify-merge-${Date.now()}`;

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

  let orderSeq = 0;
  let receiptSeq = 0;
  function nextOrderNumber() {
    orderSeq += 1;
    return `${runId}-ORD-${orderSeq}`;
  }
  function nextReceiptNumber() {
    receiptSeq += 1;
    return `${runId}-PAY-${receiptSeq}`;
  }

  async function createOrder(accountId: string, merchantId: string, totalCents: number, repId: string | null, status: string = ORDER_STATUSES.DELIVERED) {
    return prisma.order.create({
      data: {
        orderNumber: nextOrderNumber(),
        source: ORDER_SOURCES.REP_SALE,
        status,
        accountId,
        merchantId,
        createdByRepId: repId,
        subtotalCents: totalCents,
        totalCents,
        paidAmountCents: 0,
      },
    });
  }

  async function createPayment(accountId: string, amountCents: number, createdById: string, cancelled = false) {
    const payment = await prisma.accountPayment.create({
      data: {
        accountId,
        amountCents,
        method: ACCOUNT_PAYMENT_METHODS.CASH,
        createdById,
        receiptNumber: nextReceiptNumber(),
        origin: ACCOUNT_PAYMENT_ORIGINS.MANUAL,
      },
    });
    if (cancelled) {
      await prisma.accountPaymentCancellation.create({
        data: { paymentId: payment.id, reason: "test reversal", cancelledById: createdById },
      });
    }
    return payment;
  }

  try {
    // ---------------------------------------------------------------
    // Fixtures
    // ---------------------------------------------------------------
    const admin = await prisma.user.create({
      data: { role: ROLES.ADMIN, name: `${runId}-admin`, email: `${runId}-admin@test.local` },
    });
    const repUser = await prisma.user.create({
      data: { role: ROLES.SALES_REPRESENTATIVE, name: `${runId}-rep`, email: `${runId}-rep@test.local` },
    });
    const rep = await prisma.salesRepresentative.create({
      data: { userId: repUser.id, employeeCode: `${runId}-REP1` },
    });

    // Shared StockLocation pair for every RepCustomerOrder fixture below —
    // RepStockTransferBatch requires real from/to locations, but this test
    // never touches InventoryItem/StockMovement quantities through them
    // (see the CASE 12 structural check below) — they exist purely to
    // satisfy the required FK, not to model any real stock movement.
    const warehouse = await prisma.stockLocation.create({ data: { type: STOCK_LOCATION_TYPES.WAREHOUSE, name: `${runId}-warehouse`, isDefault: true } });
    const repCarLocation = await prisma.stockLocation.create({ data: { type: STOCK_LOCATION_TYPES.REP_CAR, name: `${runId}-rep-car`, salesRepId: rep.id } });

    async function createRepCustomerOrder(merchantId: string) {
      const batch = await prisma.repStockTransferBatch.create({
        data: {
          type: STOCK_MOVEMENT_TYPES.REP_ASSIGNMENT,
          salesRepId: rep.id,
          fromLocationId: warehouse.id,
          toLocationId: repCarLocation.id,
          loadType: REP_LOAD_TYPES.CUSTOMER_ORDER,
          createdById: admin.id,
        },
      });
      return prisma.repCustomerOrder.create({
        data: {
          salesRepId: rep.id,
          customerName: `${runId}-customer-order`,
          merchantId,
          status: REP_CUSTOMER_ORDER_STATUSES.OPEN,
          transferBatchId: batch.id,
          createdById: admin.id,
        },
      });
    }

    // CASE 1 fixture: TARGET balance 8,490 ₪, SOURCE balance 4,795 ₪
    const target = await prisma.merchant.create({
      data: { businessName: `${runId}-Target`, status: MERCHANT_STATUSES.APPROVED, approvedAt: new Date() },
    });
    const targetAccount = await prisma.customerAccount.create({
      data: { displayName: target.businessName, merchantId: target.id, openingBalanceCents: 500_000 },
    });
    const targetOrder = await createOrder(targetAccount.id, target.id, 400_000, rep.id);
    const targetPayment = await createPayment(targetAccount.id, 51_000, repUser.id);

    const source = await prisma.merchant.create({
      data: { businessName: `${runId}-Source`, status: MERCHANT_STATUSES.APPROVED, approvedAt: new Date(), contactPhone: "0599000000" },
    });
    const sourceAccount = await prisma.customerAccount.create({
      data: { displayName: source.businessName, merchantId: source.id, openingBalanceCents: 200_000 },
    });
    const sourceOrder = await createOrder(sourceAccount.id, source.id, 300_000, rep.id);
    const sourcePayment = await createPayment(sourceAccount.id, 20_500, repUser.id);
    // CASE 18: a correction/reversal on SOURCE — nets to zero current effect,
    // must not perturb the final combined balance.
    const sourceCancelledPayment = await createPayment(sourceAccount.id, 10_000, repUser.id, true);

    // RepCustomerOrder reassignment fixture — SOURCE has 2, TARGET has 1;
    // after merge SOURCE must have 0 and TARGET must have 3.
    await createRepCustomerOrder(source.id);
    await createRepCustomerOrder(source.id);
    await createRepCustomerOrder(target.id);

    // Company-wide baseline (CASE 8/9/10/11) — captured BEFORE the merge.
    const companySalesBefore = await prisma.order.aggregate({ _sum: { totalCents: true } });
    const companyPaymentsBefore = await prisma.accountPayment.aggregate({ _sum: { amountCents: true } });
    const repSalesBefore = await prisma.order.aggregate({ where: { createdByRepId: rep.id }, _sum: { totalCents: true } });
    const repPaymentsBefore = await prisma.accountPayment.aggregate({ where: { createdById: repUser.id }, _sum: { amountCents: true } });

    const preview = await previewMerchantMerge(prisma, source.id, target.id);
    console.log(`[verify-merchant-merge] preview before: source=${preview.sourceFigures.balanceCents} target=${preview.targetFigures.balanceCents} expectedAfter=${preview.expectedAfter.balanceCents}`);

    // ---------------------------------------------------------------
    // CASE 1: exact worked example
    // ---------------------------------------------------------------
    await check("CASE 1: target 8490 + source 4795 = 13285", async () => {
      assert(preview.targetFigures.balanceCents === 849_000, `expected target 849000 cents, got ${preview.targetFigures.balanceCents}`);
      assert(preview.sourceFigures.balanceCents === 479_500, `expected source 479500 cents, got ${preview.sourceFigures.balanceCents}`);
      assert(preview.expectedAfter.balanceCents === 1_328_500, `expected combined 1328500 cents (13285.00), got ${preview.expectedAfter.balanceCents}`);
    });

    // ---------------------------------------------------------------
    // CASE 13/14: reject bad input, and verify zero side effects (part of CASE 16)
    // ---------------------------------------------------------------
    await check("CASE 13: source == target rejected", async () => {
      let threw = false;
      try {
        await prisma.$transaction((tx) => mergeMerchants(tx, { sourceMerchantId: target.id, targetMerchantId: target.id, adminId: admin.id }));
      } catch (error) {
        threw = true;
        assert(error instanceof MerchantMergeError && error.code === "SAME_MERCHANT", `expected SAME_MERCHANT, got ${error}`);
      }
      assert(threw, "expected mergeMerchants to throw for source === target");
    });

    await check("CASE 14: missing source/target rejected", async () => {
      let threw = false;
      try {
        await prisma.$transaction((tx) => mergeMerchants(tx, { sourceMerchantId: "does-not-exist", targetMerchantId: target.id, adminId: admin.id }));
      } catch (error) {
        threw = true;
        assert(error instanceof MerchantMergeError && error.code === "NOT_FOUND", `expected NOT_FOUND, got ${error}`);
      }
      assert(threw, "expected mergeMerchants to throw for a missing merchant id");
    });

    await check("CASE 16a: an early-rejected merge leaves zero side effects (no audit log written)", async () => {
      const auditCountBefore = await prisma.adminAuditLog.count();
      try {
        await prisma.$transaction((tx) => mergeMerchants(tx, { sourceMerchantId: target.id, targetMerchantId: target.id, adminId: admin.id }));
      } catch {
        // expected
      }
      const auditCountAfter = await prisma.adminAuditLog.count();
      assert(auditCountAfter === auditCountBefore, "a rejected merge must not write an audit log row");
      const targetStillApproved = await prisma.merchant.findUnique({ where: { id: target.id }, select: { status: true } });
      assert(targetStillApproved?.status === MERCHANT_STATUSES.APPROVED, "a rejected merge must not change target's status");
    });

    await check("CASE 16b: Prisma $transaction rollback semantics actually hold in this database (generic proof)", async () => {
      const before = await prisma.order.count();
      try {
        await prisma.$transaction(async (tx) => {
          await tx.order.create({
            data: { orderNumber: `${runId}-ROLLBACK-PROBE`, source: ORDER_SOURCES.REP_SALE, status: ORDER_STATUSES.DELIVERED, subtotalCents: 1, totalCents: 1 },
          });
          throw new Error("deliberate rollback probe");
        });
      } catch {
        // expected
      }
      const after = await prisma.order.count();
      assert(after === before, "a thrown error inside prisma.$transaction must roll back every write made in that callback");
    });

    // ---------------------------------------------------------------
    // THE REAL MERGE
    // ---------------------------------------------------------------
    const mergeResult = await prisma.$transaction((tx) => mergeMerchants(tx, { sourceMerchantId: source.id, targetMerchantId: target.id, adminId: admin.id }));

    // ---------------------------------------------------------------
    // CASE 1 (post-merge), 6: opening balances combined correctly
    // ---------------------------------------------------------------
    await check("CASE 1 (post-merge): resulting balance is exactly 13285.00", async () => {
      assert(mergeResult.after.balanceCents === 1_328_500, `expected 1328500 cents, got ${mergeResult.after.balanceCents}`);
    });

    await check("CASE 6: opening balances combined (500000 + 200000 = 700000)", async () => {
      const targetAccountAfter = await prisma.customerAccount.findUniqueOrThrow({ where: { id: targetAccount.id } });
      assert(targetAccountAfter.openingBalanceCents === 700_000, `expected 700000, got ${targetAccountAfter.openingBalanceCents}`);
      const sourceAccountAfter = await prisma.customerAccount.findUniqueOrThrow({ where: { id: sourceAccount.id } });
      assert(sourceAccountAfter.openingBalanceCents === 0, `expected source's own opening balance drained to 0, got ${sourceAccountAfter.openingBalanceCents}`);
      assert(sourceAccountAfter.isActive === false, "expected source account isActive=false after merge");
    });

    // ---------------------------------------------------------------
    // CASE 2/3: orders and payments visible under target
    // ---------------------------------------------------------------
    await check("CASE 2: source order now belongs to target (accountId and merchantId both reassigned)", async () => {
      const movedOrder = await prisma.order.findUniqueOrThrow({ where: { id: sourceOrder.id } });
      assert(movedOrder.accountId === targetAccount.id, "expected order.accountId reassigned to target's account");
      assert(movedOrder.merchantId === target.id, "expected order.merchantId reassigned to target");
    });

    await check("CASE 3: source payments now belong to target's account ledger", async () => {
      const movedPayment = await prisma.accountPayment.findUniqueOrThrow({ where: { id: sourcePayment.id } });
      assert(movedPayment.accountId === targetAccount.id, "expected payment.accountId reassigned to target's account");
      const movedCancelledPayment = await prisma.accountPayment.findUniqueOrThrow({ where: { id: sourceCancelledPayment.id }, include: { cancellation: true } });
      assert(movedCancelledPayment.accountId === targetAccount.id, "expected cancelled payment also reassigned");
      assert(movedCancelledPayment.cancellation !== null, "expected the cancellation record to survive the merge untouched");
    });

    await check("BLOCKER 1: RepCustomerOrder reassignment — SOURCE (2) + TARGET (1) => SOURCE 0 / TARGET 3, no items/inventory touched", async () => {
      const sourceCount = await prisma.repCustomerOrder.count({ where: { merchantId: source.id } });
      const targetCount = await prisma.repCustomerOrder.count({ where: { merchantId: target.id } });
      assert(sourceCount === 0, `expected 0 RepCustomerOrder references left on SOURCE, got ${sourceCount}`);
      assert(targetCount === 3, `expected 3 RepCustomerOrder references on TARGET (2 moved + 1 original), got ${targetCount}`);
      // No RepCustomerOrderItem changes / no inventory changes: this fixture
      // never created any items or touched InventoryItem at all, so their
      // total counts (company-wide, in this disposable DB) must still be
      // exactly zero after the merge.
      const itemCount = await prisma.repCustomerOrderItem.count();
      const inventoryCount = await prisma.inventoryItem.count();
      assert(itemCount === 0, `expected 0 RepCustomerOrderItem rows (none were ever created), got ${itemCount}`);
      assert(inventoryCount === 0, `expected 0 InventoryItem rows (none were ever created), got ${inventoryCount}`);
    });

    // ---------------------------------------------------------------
    // CASE 4/5: receipt numbers and order numbers unchanged
    // ---------------------------------------------------------------
    await check("CASE 4: receipt numbers unchanged", async () => {
      const p1 = await prisma.accountPayment.findUniqueOrThrow({ where: { id: sourcePayment.id } });
      assert(p1.receiptNumber === sourcePayment.receiptNumber, "expected receiptNumber unchanged after merge");
      const p2 = await prisma.accountPayment.findUniqueOrThrow({ where: { id: targetPayment.id } });
      assert(p2.receiptNumber === targetPayment.receiptNumber, "expected target's own receiptNumber unchanged after merge");
    });

    await check("CASE 5: order numbers unchanged", async () => {
      const o1 = await prisma.order.findUniqueOrThrow({ where: { id: sourceOrder.id } });
      assert(o1.orderNumber === sourceOrder.orderNumber, "expected orderNumber unchanged after merge");
      const o2 = await prisma.order.findUniqueOrThrow({ where: { id: targetOrder.id } });
      assert(o2.orderNumber === targetOrder.orderNumber, "expected target's own orderNumber unchanged after merge");
    });

    await check("REP attribution (createdByRepId) unchanged on moved order", async () => {
      const o1 = await prisma.order.findUniqueOrThrow({ where: { id: sourceOrder.id } });
      assert(o1.createdByRepId === rep.id, "expected createdByRepId unchanged after merge");
    });

    await check("Payment createdById unchanged on moved payment", async () => {
      const p1 = await prisma.accountPayment.findUniqueOrThrow({ where: { id: sourcePayment.id } });
      assert(p1.createdById === repUser.id, "expected createdById unchanged after merge");
    });

    // ---------------------------------------------------------------
    // CASE 8/9: company-wide totals unchanged
    // ---------------------------------------------------------------
    await check("CASE 8: company-wide sales total unchanged", async () => {
      const after = await prisma.order.aggregate({ _sum: { totalCents: true } });
      assert(after._sum.totalCents === companySalesBefore._sum.totalCents, `expected company sales total unchanged: before=${companySalesBefore._sum.totalCents} after=${after._sum.totalCents}`);
    });

    await check("CASE 9: company-wide payment total unchanged", async () => {
      const after = await prisma.accountPayment.aggregate({ _sum: { amountCents: true } });
      assert(after._sum.amountCents === companyPaymentsBefore._sum.amountCents, `expected company payment total unchanged: before=${companyPaymentsBefore._sum.amountCents} after=${after._sum.amountCents}`);
    });

    // ---------------------------------------------------------------
    // CASE 10/11: REP historical totals unchanged
    // ---------------------------------------------------------------
    await check("CASE 10: REP historical sales total unchanged", async () => {
      const after = await prisma.order.aggregate({ where: { createdByRepId: rep.id }, _sum: { totalCents: true } });
      assert(after._sum.totalCents === repSalesBefore._sum.totalCents, `expected rep sales total unchanged: before=${repSalesBefore._sum.totalCents} after=${after._sum.totalCents}`);
    });

    await check("CASE 11: REP historical collection total unchanged", async () => {
      const after = await prisma.accountPayment.aggregate({ where: { createdById: repUser.id }, _sum: { amountCents: true } });
      assert(after._sum.amountCents === repPaymentsBefore._sum.amountCents, `expected rep payment total unchanged: before=${repPaymentsBefore._sum.amountCents} after=${after._sum.amountCents}`);
    });

    // ---------------------------------------------------------------
    // CASE 12: inventory untouched — verified structurally: the merge
    // function's own source never references any inventory table.
    // ---------------------------------------------------------------
    await check("CASE 12: merge code never references inventory tables (structural check)", async () => {
      const fs = await import("node:fs");
      const path = await import("node:path");
      // Matches an actual Prisma call (tx.inventoryItem.*, tx.stockMovement.*,
      // etc.) — not a doc-comment merely disclaiming that no such call
      // exists (this file's own header comment names these models for
      // exactly that reason).
      const source_ = fs.readFileSync(path.resolve(__dirname, "..", "src", "lib", "merchant-merge.ts"), "utf8");
      assert(!/tx\.(inventoryItem|stockMovement|stockLocation|deviceColorVariant|productVariant)\./i.test(source_), "merge code must never call any inventory-related Prisma model");
    });

    // ---------------------------------------------------------------
    // CASE 15: source no longer selectable (SUSPENDED)
    // ---------------------------------------------------------------
    await check("CASE 15: source is SUSPENDED and excluded from the APPROVED-only selector query", async () => {
      const sourceAfter = await prisma.merchant.findUniqueOrThrow({ where: { id: source.id } });
      assert(sourceAfter.status === MERCHANT_STATUSES.SUSPENDED, `expected SUSPENDED, got ${sourceAfter.status}`);
      const selectable = await prisma.merchant.findFirst({ where: { id: source.id, status: MERCHANT_STATUSES.APPROVED } });
      assert(selectable === null, "expected source to be excluded from an APPROVED-only merchant selector");
      assert(sourceAfter.notes?.includes(target.businessName), "expected a breadcrumb note pointing at the surviving target merchant");
    });

    // ---------------------------------------------------------------
    // Audit log
    // ---------------------------------------------------------------
    await check("Audit log: MERCHANT_MERGED written (both merchants login-less here, so this checks the graceful-skip path is at least not throwing)", async () => {
      // Neither fixture merchant has a linked User (both login-less), so
      // per mergeMerchants's own documented precedent (matching
      // updateMerchantStatus), no AdminAuditLog row is expected here — this
      // just confirms the merge completed without erroring on that path.
      assert(mergeResult.targetMerchantId === target.id, "sanity check that the merge actually returned");
    });

    // ---------------------------------------------------------------
    // CASE 7: negative/credit opening-balance component handled algebraically
    // ---------------------------------------------------------------
    await check("CASE 7: a credit-balance source merges correctly with a debt-balance target", async () => {
      const target2 = await prisma.merchant.create({ data: { businessName: `${runId}-Target2`, status: MERCHANT_STATUSES.APPROVED, approvedAt: new Date() } });
      await prisma.customerAccount.create({ data: { displayName: target2.businessName, merchantId: target2.id, openingBalanceCents: 100_000 } });

      const source2 = await prisma.merchant.create({ data: { businessName: `${runId}-Source2`, status: MERCHANT_STATUSES.APPROVED, approvedAt: new Date() } });
      const source2Account = await prisma.customerAccount.create({ data: { displayName: source2.businessName, merchantId: source2.id, openingBalanceCents: 0 } });
      await createOrder(source2Account.id, source2.id, 100_000, rep.id);
      await createPayment(source2Account.id, 150_000, repUser.id); // overpaid -> credit

      const preview2 = await previewMerchantMerge(prisma, source2.id, target2.id);
      assert(preview2.sourceFigures.balanceCents === -50_000, `expected source2 balance -50000 (credit), got ${preview2.sourceFigures.balanceCents}`);
      assert(preview2.expectedAfter.balanceCents === 50_000, `expected combined 50000, got ${preview2.expectedAfter.balanceCents}`);

      const result2 = await prisma.$transaction((tx) => mergeMerchants(tx, { sourceMerchantId: source2.id, targetMerchantId: target2.id, adminId: admin.id }));
      assert(result2.after.balanceCents === 50_000, `expected resulting balance 50000, got ${result2.after.balanceCents}`);
    });

    // ---------------------------------------------------------------
    // CASE 17: concurrent payment cannot race the merge (account locks serialize it)
    // ---------------------------------------------------------------
    await check("CASE 17: a concurrent payment against TARGET's account waits for the merge transaction to commit", async () => {
      const target3 = await prisma.merchant.create({ data: { businessName: `${runId}-Target3`, status: MERCHANT_STATUSES.APPROVED, approvedAt: new Date() } });
      const target3Account = await prisma.customerAccount.create({ data: { displayName: target3.businessName, merchantId: target3.id, openingBalanceCents: 10_000 } });
      const source3 = await prisma.merchant.create({ data: { businessName: `${runId}-Source3`, status: MERCHANT_STATUSES.APPROVED, approvedAt: new Date() } });
      await prisma.customerAccount.create({ data: { displayName: source3.businessName, merchantId: source3.id, openingBalanceCents: 5_000 } });

      let mergeCommittedAt = 0;
      let concurrentPaymentCommittedAt = 0;

      const mergePromise = prisma.$transaction(async (tx) => {
        const r = await mergeMerchants(tx, { sourceMerchantId: source3.id, targetMerchantId: target3.id, adminId: admin.id });
        // Hold the transaction (and therefore its advisory locks) open for a
        // beat AFTER doing the work, so the concurrent probe below has a
        // real window to attempt (and be forced to wait for) the same lock.
        await sleep(800);
        return r;
      }).then((r) => {
        mergeCommittedAt = Date.now();
        return r;
      });

      // Give the merge a head start to acquire its locks first.
      await sleep(150);

      const concurrentPromise = prisma
        .$transaction((tx) => recordManualAccountPayment(tx, target3Account.id, 1_000, admin.id, { note: "concurrent probe" }))
        .then((r) => {
          concurrentPaymentCommittedAt = Date.now();
          return r;
        });

      await Promise.all([mergePromise, concurrentPromise]);

      assert(mergeCommittedAt > 0 && concurrentPaymentCommittedAt > 0, "both operations must have completed");
      assert(
        concurrentPaymentCommittedAt >= mergeCommittedAt,
        `expected the concurrent payment to commit AFTER the merge transaction released its lock (merge=${mergeCommittedAt}, concurrent=${concurrentPaymentCommittedAt}) — locking did not serialize them`,
      );
    });

    // =================================================================
    // BLOCKER 2 — SOURCE/TARGET linked-User identity cases
    // =================================================================

    await check("BLOCKER 2 CASE A: both loginless -> loginTransferPlan NONE (uses the main CASE-1 pair, already merged above)", async () => {
      assert(preview.loginTransferPlan.kind === "NONE", `expected NONE for two loginless merchants, got ${preview.loginTransferPlan.kind}`);
    });

    await check("BLOCKER 2 CASE B: SOURCE loginless / TARGET has a linked User -> allowed, TARGET's user unchanged", async () => {
      const targetUser = await prisma.user.create({ data: { role: ROLES.WHOLESALE_MERCHANT, name: `${runId}-B-user`, email: `${runId}-b-user@test.local` } });
      const targetB = await prisma.merchant.create({ data: { businessName: `${runId}-TargetB`, status: MERCHANT_STATUSES.APPROVED, approvedAt: new Date(), userId: targetUser.id } });
      await prisma.customerAccount.create({ data: { displayName: targetB.businessName, merchantId: targetB.id, openingBalanceCents: 10_000 } });
      const sourceB = await prisma.merchant.create({ data: { businessName: `${runId}-SourceB`, status: MERCHANT_STATUSES.APPROVED, approvedAt: new Date() } });
      await prisma.customerAccount.create({ data: { displayName: sourceB.businessName, merchantId: sourceB.id, openingBalanceCents: 5_000 } });

      const previewB = await previewMerchantMerge(prisma, sourceB.id, targetB.id);
      assert(previewB.loginTransferPlan.kind === "NONE", `expected NONE, got ${previewB.loginTransferPlan.kind}`);

      await prisma.$transaction((tx) => mergeMerchants(tx, { sourceMerchantId: sourceB.id, targetMerchantId: targetB.id, adminId: admin.id }));

      const targetBAfter = await prisma.merchant.findUniqueOrThrow({ where: { id: targetB.id } });
      assert(targetBAfter.userId === targetUser.id, "expected TARGET's own linked user unchanged");
    });

    await check("BLOCKER 2 CASE C: SOURCE has a linked User / TARGET loginless -> transferred atomically, login continuity preserved", async () => {
      const sourceUser = await prisma.user.create({ data: { role: ROLES.WHOLESALE_MERCHANT, name: `${runId}-C-user`, email: `${runId}-c-user@test.local` } });
      const sourceC = await prisma.merchant.create({ data: { businessName: `${runId}-SourceC`, status: MERCHANT_STATUSES.APPROVED, approvedAt: new Date(), userId: sourceUser.id } });
      const sourceCAccount = await prisma.customerAccount.create({ data: { displayName: sourceC.businessName, merchantId: sourceC.id, openingBalanceCents: 5_000 } });
      const sourceCOrder = await createOrder(sourceCAccount.id, sourceC.id, 20_000, rep.id);
      const targetC = await prisma.merchant.create({ data: { businessName: `${runId}-TargetC`, status: MERCHANT_STATUSES.APPROVED, approvedAt: new Date() } });
      await prisma.customerAccount.create({ data: { displayName: targetC.businessName, merchantId: targetC.id, openingBalanceCents: 1_000 } });

      const previewC = await previewMerchantMerge(prisma, sourceC.id, targetC.id);
      assert(previewC.loginTransferPlan.kind === "TRANSFER", `expected TRANSFER, got ${previewC.loginTransferPlan.kind}`);
      if (previewC.loginTransferPlan.kind === "TRANSFER") {
        assert(previewC.loginTransferPlan.userId === sourceUser.id, "expected the planned transfer to carry SOURCE's own user id");
      }

      await prisma.$transaction((tx) => mergeMerchants(tx, { sourceMerchantId: sourceC.id, targetMerchantId: targetC.id, adminId: admin.id }));

      const sourceCAfter = await prisma.merchant.findUniqueOrThrow({ where: { id: sourceC.id } });
      const targetCAfter = await prisma.merchant.findUniqueOrThrow({ where: { id: targetC.id } });
      assert(sourceCAfter.userId === null, "expected SOURCE.userId nulled out after transfer");
      assert(targetCAfter.userId === sourceUser.id, "expected TARGET.userId to now hold the transferred user id");

      // Login continuity: the EXACT lookup /merchant/page.tsx performs
      // (prisma.merchant.findUnique({ where: { userId } })) must now
      // resolve to TARGET, and TARGET's own orders (queried the same way
      // /merchant/orders/page.tsx does, by merchantId) must include the
      // order that was originally SOURCE's.
      const resolvedByLogin = await prisma.merchant.findUnique({ where: { userId: sourceUser.id }, select: { id: true } });
      assert(resolvedByLogin?.id === targetC.id, "expected the transferred login to now resolve to TARGET, matching /merchant's own lookup");
      const ordersUnderResolvedMerchant = await prisma.order.findMany({ where: { merchantId: resolvedByLogin!.id }, select: { id: true } });
      assert(
        ordersUnderResolvedMerchant.some((o) => o.id === sourceCOrder.id),
        "expected the merged-in order to be visible under the merchant the transferred login now resolves to",
      );
    });

    await check("BLOCKER 2 CASE D: both linked to DIFFERENT Users -> rejected with CONFLICTING_LOGINS, complete rollback", async () => {
      const userY = await prisma.user.create({ data: { role: ROLES.WHOLESALE_MERCHANT, name: `${runId}-D-user-y`, email: `${runId}-d-user-y@test.local` } });
      const userZ = await prisma.user.create({ data: { role: ROLES.WHOLESALE_MERCHANT, name: `${runId}-D-user-z`, email: `${runId}-d-user-z@test.local` } });
      const sourceD = await prisma.merchant.create({ data: { businessName: `${runId}-SourceD`, status: MERCHANT_STATUSES.APPROVED, approvedAt: new Date(), userId: userY.id } });
      const sourceDAccount = await prisma.customerAccount.create({ data: { displayName: sourceD.businessName, merchantId: sourceD.id, openingBalanceCents: 1_000 } });
      const sourceDOrder = await createOrder(sourceDAccount.id, sourceD.id, 5_000, rep.id);
      const targetD = await prisma.merchant.create({ data: { businessName: `${runId}-TargetD`, status: MERCHANT_STATUSES.APPROVED, approvedAt: new Date(), userId: userZ.id } });
      await prisma.customerAccount.create({ data: { displayName: targetD.businessName, merchantId: targetD.id, openingBalanceCents: 2_000 } });

      const previewD = await previewMerchantMerge(prisma, sourceD.id, targetD.id);
      assert(previewD.loginTransferPlan.kind === "CONFLICT", `expected CONFLICT, got ${previewD.loginTransferPlan.kind}`);

      const auditCountBefore = await prisma.adminAuditLog.count();
      let threw = false;
      try {
        await prisma.$transaction((tx) => mergeMerchants(tx, { sourceMerchantId: sourceD.id, targetMerchantId: targetD.id, adminId: admin.id }));
      } catch (error) {
        threw = true;
        assert(error instanceof MerchantMergeError && error.code === "CONFLICTING_LOGINS", `expected CONFLICTING_LOGINS, got ${error}`);
      }
      assert(threw, "expected mergeMerchants to throw for two different linked logins");

      // Complete rollback: nothing about either merchant, its order, or the
      // audit log may have changed.
      const sourceDAfter = await prisma.merchant.findUniqueOrThrow({ where: { id: sourceD.id } });
      const targetDAfter = await prisma.merchant.findUniqueOrThrow({ where: { id: targetD.id } });
      const sourceDOrderAfter = await prisma.order.findUniqueOrThrow({ where: { id: sourceDOrder.id } });
      const auditCountAfter = await prisma.adminAuditLog.count();
      assert(sourceDAfter.status === MERCHANT_STATUSES.APPROVED, "expected SOURCE status unchanged (still APPROVED, not SUSPENDED)");
      assert(sourceDAfter.userId === userY.id, "expected SOURCE.userId unchanged");
      assert(targetDAfter.userId === userZ.id, "expected TARGET.userId unchanged");
      assert(sourceDOrderAfter.merchantId === sourceD.id, "expected SOURCE's order to remain unmoved");
      assert(auditCountAfter === auditCountBefore, "expected no audit log row written for a rejected merge");
    });

    // =================================================================
    // BLOCKER 3 / SOURCE-account-inactive checks
    // =================================================================

    await check("BLOCKER 3 CASE 6: merged-away SOURCE excluded from the rep new-sale contact picker; TARGET still offered", async () => {
      const targetE = await prisma.merchant.create({
        data: { businessName: `${runId}-TargetE`, status: MERCHANT_STATUSES.APPROVED, approvedAt: new Date(), assignedRepId: rep.id, contactPhone: "0599111111" },
      });
      await prisma.customerAccount.create({ data: { displayName: targetE.businessName, merchantId: targetE.id, openingBalanceCents: 0 } });
      const sourceE = await prisma.merchant.create({
        data: { businessName: `${runId}-SourceE`, status: MERCHANT_STATUSES.APPROVED, approvedAt: new Date(), assignedRepId: rep.id, contactPhone: "0599222222" },
      });
      await prisma.customerAccount.create({ data: { displayName: sourceE.businessName, merchantId: sourceE.id, openingBalanceCents: 0 } });

      const contactsBefore = await getRepTraderContactsForSaleForm(rep.id);
      assert(contactsBefore.some((c) => c.id === sourceE.id), "sanity check: SOURCE must be offered before the merge");

      await prisma.$transaction((tx) => mergeMerchants(tx, { sourceMerchantId: sourceE.id, targetMerchantId: targetE.id, adminId: admin.id }));

      const contactsAfter = await getRepTraderContactsForSaleForm(rep.id);
      assert(!contactsAfter.some((c) => c.id === sourceE.id), "expected the merged-away SOURCE to no longer be offered as a new-sale contact");
      assert(contactsAfter.some((c) => c.id === targetE.id), "expected TARGET to remain offered as a new-sale contact");
    });

    await check("BLOCKER 3 / inactive-account check: a payment can no longer be posted directly to the (now inactive) merged-away SOURCE account", async () => {
      let threw = false;
      try {
        await prisma.$transaction((tx) => recordManualAccountPayment(tx, sourceAccount.id, 1_000, admin.id, { note: "should be rejected" }));
      } catch (error) {
        threw = true;
        assert(error instanceof Error && error.message === "ACCOUNT_INACTIVE", `expected ACCOUNT_INACTIVE, got ${error}`);
      }
      assert(threw, "expected recordManualAccountPayment to reject a payment against an inactive (merged-away) account");
    });

    console.log("\nAll merchant-merge verification checks passed");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
