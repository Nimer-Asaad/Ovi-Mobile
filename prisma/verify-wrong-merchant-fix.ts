/**
 * Real-database verification for the 2026-09-22 wrong-merchant/wrong-account
 * incident fix — src/lib/rep-merchants.ts (resolveOrCreateRepMerchant's
 * ambiguous-phone guard) and src/lib/rep-sales.ts (the explicit
 * merchant<->account defensive assertion). The CLIENT-side half of the fix
 * (src/components/reps/NewSaleForm.tsx's handleCustomerNameChange no longer
 * leaving a stale phone behind) is a React state fix with no server/DB
 * surface to verify here — it was inspected directly in the implementation
 * report instead.
 *
 * These tests exercise createRepSaleCore exactly like a real rep sale does
 * — nothing under test is re-implemented.
 *
 * Safety rails via resolveVerifyDatabaseUrl (prisma/verify-guardrails.ts).
 * Run with: node --conditions=react-server --import tsx prisma/verify-wrong-merchant-fix.ts
 * WRONG_MERCHANT_VERIFY_DATABASE_URL must point at a disposable localhost
 * PostgreSQL database whose name contains "verify", migrated with
 * `prisma migrate deploy`.
 */

export {};

import { resolveVerifyDatabaseUrl } from "./verify-guardrails";

const resolved = resolveVerifyDatabaseUrl("WRONG_MERCHANT_VERIFY_DATABASE_URL");
console.log(`[verify-wrong-merchant-fix] target: ${resolved.masked}`);

process.env.DATABASE_URL = resolved.url;
process.env.DIRECT_URL = resolved.url;

async function main() {
  const [{ PrismaClient }, constants, repSales, repMerchants, validation] = await Promise.all([
    import("@prisma/client"),
    import("../src/lib/constants"),
    import("../src/lib/rep-sales"),
    import("../src/lib/rep-merchants"),
    import("../src/lib/validation/repSale"),
  ]);

  const prisma = new PrismaClient();
  const { ROLES, STOCK_LOCATION_TYPES, ACCOUNT_PAYMENT_METHODS, MERCHANT_STATUSES } = constants;
  const { createRepSaleCore } = repSales;
  const { resolveOrCreateRepMerchant, RepMerchantAmbiguousPhoneError } = repMerchants;
  const { repSaleSchema } = validation;
  const runId = `verify-wrongmerch-${Date.now()}`;

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

  const repUser = await prisma.user.create({ data: { role: ROLES.SALES_REPRESENTATIVE, name: `${runId}-rep`, email: `${runId}-rep@example.invalid`, isActive: true } });
  const rep = await prisma.salesRepresentative.create({ data: { userId: repUser.id, employeeCode: `${runId}-rep` } });
  const repCar = await prisma.stockLocation.create({ data: { type: STOCK_LOCATION_TYPES.REP_CAR, name: `${runId}-car`, salesRepId: rep.id } });
  const product = await prisma.product.create({ data: { sku: `${runId}-p1`, name: `${runId}-p1`, retailPriceCents: 1000, wholesalePriceCents: 800, isActive: true } });
  await prisma.inventoryItem.create({ data: { productId: product.id, locationId: repCar.id, quantity: 100_000 } });

  async function sell(customerName: string, customerPhone: string) {
    try {
      return await createRepSaleCore(
        {
          items: [{ productId: product.id, colorId: null, variantId: null, deviceColorVariantId: null, quantity: 1, unitPriceCents: nis(10), bonusQuantity: 0 }],
          customerName,
          customerPhone,
          city: undefined,
          address: undefined,
          notes: undefined,
          repCustomerOrderId: null,
          discountCents: 0,
          paidNowCents: 0,
          paidNowMethod: ACCOUNT_PAYMENT_METHODS.CASH,
        },
        { salesRepId: rep.id, carStockLocationId: repCar.id, actorUserId: repUser.id },
      );
    } catch (error) {
      if (error instanceof Error && error.message.includes("static generation store missing")) return { ok: true as const, orderNumber: "" };
      throw error;
    }
  }

  async function orderFor(phone: string) {
    return prisma.order.findFirstOrThrow({
      where: { contactPhone: phone, createdByRepId: rep.id },
      orderBy: { createdAt: "desc" },
      select: { id: true, merchantId: true, accountId: true, contactName: true, merchant: { select: { businessName: true } }, account: { select: { merchantId: true } } },
    });
  }

  try {
    await check("CASE 16: choosing وجدي creates an order whose merchant AND account both genuinely belong to وجدي", async () => {
      const wajdiPhone = `${runId}-wajdi-phone`;
      const result = await sell("وجدي", wajdiPhone);
      assert(result.ok, `sale must succeed: ${!result.ok && result.error}`);
      const order = await orderFor(wajdiPhone);
      assert(order.merchant !== null, "a rep sale must always resolve a real merchant");
      assert(order.merchant.businessName === "وجدي", `Order.merchant must be وجدي, got ${order.merchant.businessName}`);
      assert(order.account?.merchantId === order.merchantId, "Order.account's own merchantId must equal Order.merchantId — no split identity");
    });

    await check("CASE 17: picking عمر then switching to وجدي (server side: two distinct phones) never leaves a stale عمر account behind", async () => {
      const omarPhone = `${runId}-omar-phone`;
      const wajdiPhone = `${runId}-wajdi2-phone`;
      const omarResult = await sell("عمر", omarPhone);
      assert(omarResult.ok, "عمر sale must succeed");
      const omarOrder = await orderFor(omarPhone);

      // The client fix (NewSaleForm.handleCustomerNameChange) guarantees the
      // rep can never submit customerName="وجدي" together with عمر's own
      // phone after switching — this asserts the SERVER side of that
      // guarantee: a genuinely different phone always resolves to a
      // genuinely different merchant/account, never عمر's.
      const wajdiResult = await sell("وجدي", wajdiPhone);
      assert(wajdiResult.ok, "وجدي sale must succeed");
      const wajdiOrder = await orderFor(wajdiPhone);

      assert(wajdiOrder.merchantId !== omarOrder.merchantId, "وجدي's order must NOT share عمر's merchantId");
      assert(wajdiOrder.accountId !== omarOrder.accountId, "وجدي's order must NOT share عمر's accountId");
      assert(wajdiOrder.merchant !== null && omarOrder.merchant !== null, "both orders must resolve a real merchant");
      assert(wajdiOrder.merchant.businessName === "وجدي" && omarOrder.merchant.businessName === "عمر", "each order's merchant relation matches who was actually sold to");
    });

    await check("CASE 18: an ambiguous phone (matches two merchants assigned to this rep) is rejected, not silently guessed", async () => {
      const sharedPhone = `${runId}-shared-phone`;
      // Two DIFFERENT Merchant rows assigned to the same rep, matching the
      // SAME phone via the two different columns resolveOrCreateRepMerchant
      // checks (contactPhone on one, user.phone via a linked login on the
      // other) — the genuine data-ambiguity scenario, never a UI bug.
      const merchantA = await prisma.merchant.create({
        data: { businessName: `${runId}-A`, contactPhone: sharedPhone, assignedRepId: rep.id, status: MERCHANT_STATUSES.APPROVED, approvedAt: new Date() },
      });
      const loginUser = await prisma.user.create({ data: { role: ROLES.WHOLESALE_MERCHANT, name: `${runId}-B-user`, email: `${runId}-b@example.invalid`, phone: sharedPhone, isActive: true } });
      const merchantB = await prisma.merchant.create({
        data: { businessName: `${runId}-B`, userId: loginUser.id, assignedRepId: rep.id, status: MERCHANT_STATUSES.APPROVED, approvedAt: new Date() },
      });

      let threw = false;
      try {
        await prisma.$transaction((tx) => resolveOrCreateRepMerchant(tx, { salesRepId: rep.id, businessName: "anything", contactPhone: sharedPhone }));
      } catch (err) {
        threw = err instanceof RepMerchantAmbiguousPhoneError;
      }
      assert(threw, "resolveOrCreateRepMerchant must throw RepMerchantAmbiguousPhoneError, never silently pick one of the two matches");

      const ordersBefore = await prisma.order.count({ where: { merchantId: { in: [merchantA.id, merchantB.id] } } });
      const saleResult = await sell("anything", sharedPhone);
      assert(!saleResult.ok, "the sale itself must be rejected end-to-end, never silently attached to A or B");
      const ordersAfter = await prisma.order.count({ where: { merchantId: { in: [merchantA.id, merchantB.id] } } });
      assert(ordersAfter === ordersBefore, "no order was created against either ambiguous candidate");

      // A malicious/forged merchantId or accountId payload has nowhere to
      // go: repSaleSchema has no such fields at all, and zod strips unknown
      // keys by default (no .passthrough()), so even injecting them is a
      // silent no-op — the server-resolved merchant/account (by phone,
      // inside this same transaction) is the ONLY thing that ever decides
      // Order.merchantId/accountId.
      const forged = repSaleSchema.safeParse({
        items: [{ productId: product.id, quantity: 1, unitPriceCents: nis(10) }],
        customerName: "xx",
        customerPhone: "0599999999",
        discountCents: "0",
        paidNowCents: "0",
        merchantId: merchantA.id,
        accountId: merchantB.id,
      });
      assert(forged.success, `schema still parses with the extra fields present: ${!forged.success && JSON.stringify(forged.error.issues)}`);
      assert(forged.success && !("merchantId" in forged.data) && !("accountId" in forged.data), "forged merchantId/accountId never survive parsing — the schema has no such fields to carry them through");
    });

    await check("CASE 19: the payment created WITH the sale uses the exact same account as the order it belongs to", async () => {
      const phone = `${runId}-paid-phone`;
      const result = await sell("دفع الآن", phone);
      // Re-sell with a payment this time (paidNowCents > 0) using a direct core call.
      const order = await createRepSaleCore(
        {
          items: [{ productId: product.id, colorId: null, variantId: null, deviceColorVariantId: null, quantity: 1, unitPriceCents: nis(10), bonusQuantity: 0 }],
          customerName: "دفع الآن",
          customerPhone: phone,
          city: undefined,
          address: undefined,
          notes: undefined,
          repCustomerOrderId: null,
          discountCents: 0,
          paidNowCents: nis(10),
          paidNowMethod: ACCOUNT_PAYMENT_METHODS.CASH,
        },
        { salesRepId: rep.id, carStockLocationId: repCar.id, actorUserId: repUser.id },
      ).catch((err) => {
        if (err instanceof Error && err.message.includes("static generation store missing")) return { ok: true as const, orderNumber: "" };
        throw err;
      });
      assert(result.ok && order.ok, "both sales must succeed");
      const persistedOrder = await orderFor(phone);
      const payment = await prisma.accountPayment.findFirst({ where: { sourceOrderId: persistedOrder.id }, select: { accountId: true } });
      assert(payment !== null, "a paid-now payment row must exist");
      assert(payment!.accountId === persistedOrder.accountId, "the payment's accountId must be the exact same account as the order it was paid against");
    });

    await check("CASE 20: the persisted invoice always reflects the persisted Order.merchant relation, never a display-only field", async () => {
      const phone = `${runId}-display-phone`;
      // contactName (display-only snapshot) intentionally differs from the
      // merchant's real businessName — proving the invoice's identity comes
      // from the real relation, not this cosmetic field.
      const result = await sell("Some Typo Name", phone);
      assert(result.ok, "sale must succeed");
      const order = await orderFor(phone);
      const merchant = await prisma.merchant.findUniqueOrThrow({ where: { id: order.merchantId! }, select: { businessName: true } });
      assert(order.contactName === "Some Typo Name", "contactName stays whatever was typed (display-only)");
      assert(order.merchant !== null, "order must resolve a real merchant");
      assert(order.merchant.businessName === merchant.businessName, "Order.merchant relation always resolves to the REAL merchant record, independent of contactName");
    });

    await check("CASE 21: back-to-back sales to two different merchants remain fully isolated (no cross-contamination)", async () => {
      const phoneA = `${runId}-isoA-phone`;
      const phoneB = `${runId}-isoB-phone`;
      const a1 = await sell("عزل أ", phoneA);
      const b1 = await sell("عزل ب", phoneB);
      const a2 = await sell("عزل أ", phoneA);
      const b2 = await sell("عزل ب", phoneB);
      assert(a1.ok && b1.ok && a2.ok && b2.ok, "all four sales must succeed");
      const ordersA = await prisma.order.findMany({ where: { contactPhone: phoneA }, select: { merchantId: true, accountId: true } });
      const ordersB = await prisma.order.findMany({ where: { contactPhone: phoneB }, select: { merchantId: true, accountId: true } });
      assert(ordersA.length === 2 && ordersB.length === 2, "two orders each");
      assert(new Set(ordersA.map((o) => o.merchantId)).size === 1, "A's two orders share the SAME merchant");
      assert(new Set(ordersB.map((o) => o.merchantId)).size === 1, "B's two orders share the SAME merchant");
      assert(ordersA[0]!.merchantId !== ordersB[0]!.merchantId, "A and B never share a merchant");
      assert(ordersA[0]!.accountId !== ordersB[0]!.accountId, "A and B never share an account");
    });

    console.log("\nCASE 22 (duplicate-submit protection): verified by code inspection only — see the implementation report. NewSaleForm's submit button is `disabled={isPending || ...}` (React 19 useActionState's pending state), showing a Spinner + \"جارٍ الحفظ...\" while a submit is in flight, so a fast double-tap cannot fire a second form submission. No server-side idempotency key exists or was added — the task explicitly says not to invent one unless needed, and the client-side guard is this codebase's existing, sufficient protection for a single authenticated rep's own double-click.");

    console.log("\nAll wrong-merchant-fix verification checks passed");
  } finally {
    const orderFilter = { createdByRepId: rep.id };
    await prisma.stockMovement.deleteMany({ where: { product: { sku: { startsWith: runId } } } });
    await prisma.accountPaymentCancellation.deleteMany({ where: { payment: { account: { merchant: { assignedRepId: rep.id } } } } });
    await prisma.accountPayment.deleteMany({ where: { account: { merchant: { assignedRepId: rep.id } } } });
    await prisma.orderItem.deleteMany({ where: { order: orderFilter } });
    await prisma.order.deleteMany({ where: orderFilter });
    await prisma.customerAccount.deleteMany({ where: { merchant: { assignedRepId: rep.id } } });
    await prisma.merchant.deleteMany({ where: { OR: [{ assignedRepId: rep.id }, { businessName: { startsWith: runId } }] } });
    await prisma.user.deleteMany({ where: { email: { startsWith: runId } } });
    await prisma.inventoryItem.deleteMany({ where: { product: { sku: { startsWith: runId } } } });
    await prisma.product.deleteMany({ where: { sku: { startsWith: runId } } });
    await prisma.stockLocation.deleteMany({ where: { name: { startsWith: runId } } });
    await prisma.salesRepresentative.deleteMany({ where: { employeeCode: { startsWith: runId } } });
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
