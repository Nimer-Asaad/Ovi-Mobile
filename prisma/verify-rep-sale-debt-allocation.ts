/**
 * Destructive verification harness for REP-sale payment allocation against a
 * merchant's PREVIOUS debt (see createRepSaleCore in src/lib/rep-sales.ts).
 * Safety rails live in prisma/verify-guardrails.ts (shared with
 * prisma/verify-inventory-tracking-modes.ts and
 * prisma/verify-migration-upgrade.ts's pattern) — never runs against a
 * shared/production database; see that file for the exact checks.
 */

export {}; // Force module scope — see the sibling collision this avoids in verify-order-lifecycle.ts.

import { resolveVerifyDatabaseUrl } from "./verify-guardrails";

const resolved = resolveVerifyDatabaseUrl("REP_SALE_DEBT_VERIFY_DATABASE_URL");
console.log(`[verify-rep-sale-debt-allocation] target: ${resolved.masked}`);

process.env.DATABASE_URL = resolved.url;
process.env.DIRECT_URL = resolved.url;

async function main() {
const [{ PrismaClient }, constants, repSales, accounts] = await Promise.all([
  import("@prisma/client"),
  import("../src/lib/constants"),
  import("../src/lib/rep-sales"),
  import("../src/lib/accounts"),
]);

const prisma = new PrismaClient();
const { ROLES, STOCK_LOCATION_TYPES, ACCOUNT_PAYMENT_METHODS } = constants;
const { createRepSaleCore } = repSales;
const { getAccountBalanceCents } = accounts;
const runId = `verify-repdebt-${Date.now()}`;

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

/** ₪X.XX -> integer agorot cents, same convention as every money field in
 * this app. */
function nis(amount: number): number {
  return Math.round(amount * 100);
}

const repUser = await prisma.user.create({
  data: { role: ROLES.SALES_REPRESENTATIVE, name: `${runId}-rep`, email: `${runId}-rep@example.invalid`, isActive: true },
});
const rep = await prisma.salesRepresentative.create({
  data: { userId: repUser.id, employeeCode: `${runId}-rep` },
});
const repCar = await prisma.stockLocation.create({
  data: { type: STOCK_LOCATION_TYPES.REP_CAR, name: `${runId}-car`, salesRepId: rep.id },
});
const product = await prisma.product.create({
  data: {
    sku: `${runId}-product`,
    name: `${runId}-product`,
    retailPriceCents: 100,
    wholesalePriceCents: 80,
    isActive: true,
  },
});
await prisma.inventoryItem.create({ data: { productId: product.id, locationId: repCar.id, quantity: 1000 } });

/** One rep-car sale of a single line (1 unit at `amountCents`) — the exact
 * same createRepSaleCore every real rep sale (or admin-on-behalf sale)
 * eventually calls, never a re-implementation of the sale/allocation logic
 * under test.
 *
 * createRepSaleCore calls Next.js's revalidatePath(...) (revalidateRepSalePaths)
 * as its very LAST step, strictly AFTER its own `await prisma.$transaction(...)`
 * has already resolved (committed) — see rep-sales.ts: `succeeded = true;
 * break;` inside the transaction retry loop, then, once outside that loop,
 * `revalidateRepSalePaths(orderNumber); return { ok: true, orderNumber };`.
 * Outside a real Next.js request (as here, a bare script), revalidatePath
 * throws "Invariant: static generation store missing" — a Next.js
 * runtime-context limitation, not a data-correctness one: by the time it
 * fires, the order/payment/inventory effects under test have already
 * committed to the database exactly as they would in production. This
 * narrowly catches ONLY that specific, identified error and reports the
 * sale as accepted — every actual assertion in this suite still verifies
 * outcomes by re-reading real rows via readAccount() below, never by
 * trusting this translation. Any OTHER error still propagates and fails
 * the test, exactly as before. */
async function sell(phone: string, amountCents: number, paidNowCents: number) {
  try {
    return await createRepSaleCore(
      {
        items: [{ productId: product.id, colorId: null, variantId: null, deviceColorVariantId: null, quantity: 1, unitPriceCents: amountCents, bonusQuantity: 0 }],
        customerName: `${runId}-${phone}`,
        customerPhone: phone,
        city: undefined,
        address: undefined,
        notes: undefined,
        repCustomerOrderId: null,
        discountCents: 0,
        paidNowCents,
        paidNowMethod: ACCOUNT_PAYMENT_METHODS.CASH,
      },
      { salesRepId: rep.id, carStockLocationId: repCar.id, actorUserId: repUser.id },
    );
  } catch (error) {
    if (error instanceof Error && error.message.includes("static generation store missing")) {
      return { ok: true as const, orderNumber: "" };
    }
    throw error;
  }
}

interface AccountSnapshot {
  merchantId: string | null;
  balanceCents: number;
  orders: { totalCents: number; paidAmountCents: number }[];
  payments: { amountCents: number }[];
}

/** Reads back this phone's merchant + account fresh from the DB — never
 * trusts anything sell() returned — so every assertion below checks the
 * REAL persisted accounting state, the same data getAccountBalanceCents
 * (the app's one canonical balance formula) is always fed elsewhere. */
async function readAccount(phone: string): Promise<AccountSnapshot | null> {
  const merchant = await prisma.merchant.findFirst({
    where: { assignedRepId: rep.id, contactPhone: phone },
    select: {
      id: true,
      account: {
        select: {
          openingBalanceCents: true,
          orders: { select: { status: true, totalCents: true, paidAmountCents: true } },
          payments: { select: { amountCents: true, cancellation: { select: { id: true } } } },
        },
      },
    },
  });
  if (!merchant) return null;
  if (!merchant.account) return { merchantId: merchant.id, balanceCents: 0, orders: [], payments: [] };
  return {
    merchantId: merchant.id,
    balanceCents: getAccountBalanceCents(merchant.account),
    orders: merchant.account.orders.map((order) => ({ totalCents: order.totalCents, paidAmountCents: order.paidAmountCents })),
    payments: merchant.account.payments.map((payment) => ({ amountCents: payment.amountCents })),
  };
}

try {
  await check("CASE 1: no previous debt, payment == invoice -> accepted, debt 0", async () => {
    const phone = `${runId}-c1`;
    const result = await sell(phone, nis(100), nis(100));
    assert(result.ok, `expected acceptance, got: ${!result.ok && result.error}`);
    const account = await readAccount(phone);
    assert(account!.balanceCents === 0, `expected debt 0, got ${account!.balanceCents}`);
  });

  await check("CASE 2: no previous debt, payment > invoice -> rejected", async () => {
    const phone = `${runId}-c2`;
    const result = await sell(phone, nis(100), nis(101));
    assert(!result.ok, "expected rejection");
    // The whole transaction (including trader/merchant creation) rolled
    // back — nothing at all should exist for this phone.
    const account = await readAccount(phone);
    assert(account === null, "rejected sale must not create a merchant/account");
  });

  await check("CASE 3: previous debt 200, invoice 100, payment 250 -> accepted, debt 50", async () => {
    const phone = `${runId}-c3`;
    const seed = await sell(phone, nis(200), 0);
    assert(seed.ok, `seed debt setup failed: ${!seed.ok && seed.error}`);
    const result = await sell(phone, nis(100), nis(250));
    assert(result.ok, `expected acceptance, got: ${!result.ok && result.error}`);
    const account = await readAccount(phone);
    assert(account!.balanceCents === nis(50), `expected debt 50, got ${account!.balanceCents / 100}`);
  });

  await check("CASE 4: previous debt 200, invoice 100, payment 300 -> accepted, debt 0", async () => {
    const phone = `${runId}-c4`;
    const seed = await sell(phone, nis(200), 0);
    assert(seed.ok, `seed debt setup failed: ${!seed.ok && seed.error}`);
    const result = await sell(phone, nis(100), nis(300));
    assert(result.ok, `expected acceptance, got: ${!result.ok && result.error}`);
    const account = await readAccount(phone);
    assert(account!.balanceCents === 0, `expected debt 0, got ${account!.balanceCents / 100}`);
  });

  await check("CASE 5: previous debt 200, invoice 100, payment 301 -> rejected, debt stays 200", async () => {
    const phone = `${runId}-c5`;
    const seed = await sell(phone, nis(200), 0);
    assert(seed.ok, `seed debt setup failed: ${!seed.ok && seed.error}`);
    const result = await sell(phone, nis(100), nis(301));
    assert(!result.ok, "expected rejection");
    const account = await readAccount(phone);
    assert(account!.balanceCents === nis(200), `expected debt to stay 200 (rejection must not partially apply), got ${account!.balanceCents / 100}`);
    assert(account!.orders.length === 1, "rejected sale must not create a second order");
  });

  await check("CASE 6: previous debt 50, invoice 100, payment 120 -> accepted, debt 30", async () => {
    const phone = `${runId}-c6`;
    const seed = await sell(phone, nis(50), 0);
    assert(seed.ok, `seed debt setup failed: ${!seed.ok && seed.error}`);
    const result = await sell(phone, nis(100), nis(120));
    assert(result.ok, `expected acceptance, got: ${!result.ok && result.error}`);
    const account = await readAccount(phone);
    assert(account!.balanceCents === nis(30), `expected debt 30, got ${account!.balanceCents / 100}`);
  });

  await check("CASE 7: partial payment — previous debt 200, invoice 100, payment 20 -> accepted, debt 280", async () => {
    const phone = `${runId}-c7`;
    const seed = await sell(phone, nis(200), 0);
    assert(seed.ok, `seed debt setup failed: ${!seed.ok && seed.error}`);
    const result = await sell(phone, nis(100), nis(20));
    assert(result.ok, `expected acceptance, got: ${!result.ok && result.error}`);
    const account = await readAccount(phone);
    assert(account!.balanceCents === nis(280), `expected debt 280, got ${account!.balanceCents / 100}`);
  });

  await check("CASE 8: payment == 0 -> preserves existing fully-on-account behavior", async () => {
    const phone = `${runId}-c8`;
    const result = await sell(phone, nis(100), 0);
    assert(result.ok, `expected acceptance, got: ${!result.ok && result.error}`);
    const account = await readAccount(phone);
    assert(account!.balanceCents === nis(100), `expected debt 100, got ${account!.balanceCents / 100}`);
    assert(account!.payments.length === 0, "a zero paidNowCents sale must not create an AccountPayment row");
  });

  await check("CASE 9: physical REP collection is counted exactly once", async () => {
    // Reuses CASE 3's account (previous debt 200, invoice 100, payment 250).
    const phone = `${runId}-c3`;
    const account = await readAccount(phone);
    assert(account!.payments.length === 1, `expected exactly one payment row, got ${account!.payments.length}`);
    const onlyPayment = account!.payments[0];
    assert(onlyPayment !== undefined, "expected exactly one payment row");
    assert(onlyPayment.amountCents === nis(250), `expected the one payment to be 250, got ${onlyPayment.amountCents / 100}`);
  });

  await check("CASE 10: current invoice total remains 100, never becomes 250", async () => {
    const phone = `${runId}-c3`;
    const account = await readAccount(phone);
    const saleOrder = account!.orders.find((order) => order.totalCents === nis(100));
    assert(Boolean(saleOrder), "expected to find the 100 NIS invoice order");
    assert(saleOrder!.totalCents === nis(100), `invoice total must stay 100, got ${saleOrder!.totalCents / 100}`);
    assert(saleOrder!.paidAmountCents === nis(250), `paidAmountCents should record the full 250 received, got ${saleOrder!.paidAmountCents / 100}`);
  });

  await check("CASE 11: merchant account ledger reaches the correct balance", async () => {
    const phone = `${runId}-c3`;
    const account = await readAccount(phone);
    // openingBalanceCents(0) + orders(200 + 100) - payments(250) = 50
    assert(account!.balanceCents === nis(50), `expected ledger balance 50, got ${account!.balanceCents / 100}`);
  });

  await check("CASE 12: payment receipt/report totals are not double-counted", async () => {
    const phone = `${runId}-c3`;
    const account = await readAccount(phone);
    const salesTotalCents = account!.orders.reduce((sum, order) => sum + order.totalCents, 0);
    const paymentsTotalCents = account!.payments.reduce((sum, payment) => sum + payment.amountCents, 0);
    // Two orders (the 200 seed + the 100 invoice) = 300 total sales, and
    // exactly one 250 payment — never 100 + 250 (350) counted as "sales",
    // and never 250 counted twice.
    assert(salesTotalCents === nis(300), `expected sales total 300, got ${salesTotalCents / 100}`);
    assert(paymentsTotalCents === nis(250), `expected payments total 250 (received once), got ${paymentsTotalCents / 100}`);
  });

  await check("CASE 13: concurrency — two simultaneous sales cannot both consume the same debt", async () => {
    const phone = `${runId}-c13`;
    // Seed the merchant/account FIRST (awaited, not concurrent) so the two
    // concurrent calls below race only on the account BALANCE lock
    // (lockAccountForBalanceUpdate) — never on first-time merchant/account
    // creation, which is a separate, already-existing concern.
    const seed = await sell(phone, nis(100), 0);
    assert(seed.ok, `seed debt setup failed: ${!seed.ok && seed.error}`);

    // Two transactions, fired together, both trying to consume the SAME 100
    // of existing debt with a payment of 100 against a near-zero (1 agora)
    // new invoice each. Without lockAccountForBalanceUpdate serializing
    // them, both could read the same pre-write balance and both accept —
    // overpaying the account by 100 the instant both commit.
    const [first, second] = await Promise.all([
      sell(phone, 1, nis(100)),
      sell(phone, 1, nis(100)),
    ]);
    const results = [first, second];
    const succeeded = results.filter((result) => result.ok);
    const rejected = results.filter((result) => !result.ok);
    assert(succeeded.length === 1, `expected exactly one concurrent sale to succeed, got ${succeeded.length} of 2`);
    assert(rejected.length === 1, `expected exactly one concurrent sale to be rejected, got ${rejected.length} of 2`);

    const account = await readAccount(phone);
    // 100 (seed) + 1 accepted 0.01 invoice - 100 (the one accepted payment) = 0.01
    assert(account!.balanceCents === 1, `expected final debt 0.01 (no double-accept of the same debt), got ${account!.balanceCents / 100}`);
  });
} finally {
  await prisma.accountPaymentCancellation.deleteMany({ where: { payment: { createdBy: { email: { startsWith: runId } } } } });
  await prisma.accountPayment.deleteMany({ where: { createdBy: { email: { startsWith: runId } } } });
  await prisma.stockMovement.deleteMany({ where: { product: { sku: { startsWith: runId } } } });
  await prisma.orderItem.deleteMany({ where: { order: { createdByRep: { employeeCode: { startsWith: runId } } } } });
  await prisma.order.deleteMany({ where: { createdByRep: { employeeCode: { startsWith: runId } } } });
  await prisma.customerAccount.deleteMany({ where: { merchant: { assignedRep: { employeeCode: { startsWith: runId } } } } });
  await prisma.merchant.deleteMany({ where: { assignedRep: { employeeCode: { startsWith: runId } } } });
  await prisma.inventoryItem.deleteMany({ where: { product: { sku: { startsWith: runId } } } });
  await prisma.product.deleteMany({ where: { sku: { startsWith: runId } } });
  await prisma.stockLocation.deleteMany({ where: { name: { startsWith: runId } } });
  await prisma.salesRepresentative.deleteMany({ where: { employeeCode: { startsWith: runId } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: runId } } });
  await prisma.$disconnect();
}

console.log("All REP sale debt-allocation verification checks passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
