/**
 * Real-database verification for the invoice discount (خصم الفاتورة) +
 * bonus/free line-item (بونص) feature — src/lib/sale-pricing.ts,
 * src/lib/rep-sales.ts (createRepSaleCore) and
 * src/app/admin/orders/new/actions.ts (createManualOrder). Safety rails via
 * resolveVerifyDatabaseUrl (prisma/verify-guardrails.ts) — same convention
 * as every other prisma/verify-*.ts script: never runs against a
 * shared/production database, requires the target database's name to
 * contain "verify" and its host to be localhost.
 *
 * REP-flow cases (the great majority below) call createRepSaleCore
 * directly — the exact same shared core both /rep/sales/new and
 * /admin/reps/[id]/sales/new call, matching the pattern already established
 * by prisma/verify-rep-sale-debt-allocation.ts.
 *
 * The one WAREHOUSE/admin-manual-order case (CASE 14) cannot call
 * createManualOrder directly: that function is a "use server" action
 * coupled to FormData, an authenticated session (requireRole) and
 * redirect() — none of which exist in a bare script. Instead it runs a
 * direct prisma.$transaction using the EXACT SAME canonical helpers
 * (calculateChargeableSubtotalCents/calculateLineChargeCents/
 * validateInvoiceDiscount/calculateInvoiceTotalCents/derivePaymentStatus
 * from sale-pricing.ts, decrementInventoryAtomic/recordStockMovement from
 * inventory-transactions.ts) that createManualOrder itself calls — this
 * verifies the identical WAREHOUSE decrement mechanism and pricing formulas
 * without needing a real HTTP/session context, the same "thin wrapper vs.
 * shared core" reasoning already used throughout this codebase (see
 * createRepSale vs. createRepSaleCore).
 *
 * Run with: node --conditions=react-server --import tsx prisma/verify-sale-discount-bonus.ts
 * SALE_BONUS_VERIFY_DATABASE_URL must be set to a disposable localhost
 * PostgreSQL database whose name contains "verify" before running this.
 */

export {};

import { resolveVerifyDatabaseUrl } from "./verify-guardrails";

const resolved = resolveVerifyDatabaseUrl("SALE_BONUS_VERIFY_DATABASE_URL");
console.log(`[verify-sale-discount-bonus] target: ${resolved.masked}`);

process.env.DATABASE_URL = resolved.url;
process.env.DIRECT_URL = resolved.url;

async function main() {
  const [{ PrismaClient }, constants, repSales, accounts, saleCorrection, salePricing, inventoryTx, orderNumberLib] = await Promise.all([
    import("@prisma/client"),
    import("../src/lib/constants"),
    import("../src/lib/rep-sales"),
    import("../src/lib/accounts"),
    import("../src/lib/sale-correction"),
    import("../src/lib/sale-pricing"),
    import("../src/lib/inventory-transactions"),
    import("../src/lib/order-number"),
  ]);

  const prisma = new PrismaClient();
  const { ROLES, STOCK_LOCATION_TYPES, ACCOUNT_PAYMENT_METHODS, ORDER_SOURCES, ORDER_STATUSES, PAYMENT_METHODS, STOCK_MOVEMENT_TYPES } = constants;
  const { createRepSaleCore } = repSales;
  const { getAccountBalanceCents } = accounts;
  const { correctSale } = saleCorrection;
  const { calculateChargeableSubtotalCents, calculateLineChargeCents, validateInvoiceDiscount, calculateInvoiceTotalCents, derivePaymentStatus } = salePricing;
  const { decrementInventoryAtomic, recordStockMovement } = inventoryTx;
  const { generateDailyOrderNumber } = orderNumberLib;
  const runId = `verify-salebonus-${Date.now()}`;

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

  /** ₪X.XX -> integer agorot cents, same convention as every money field. */
  function nis(amount: number): number {
    return Math.round(amount * 100);
  }

  const admin = await prisma.user.create({
    data: { role: ROLES.ADMIN, name: `${runId}-admin`, email: `${runId}-admin@example.invalid`, isActive: true },
  });
  const repUser = await prisma.user.create({
    data: { role: ROLES.SALES_REPRESENTATIVE, name: `${runId}-rep`, email: `${runId}-rep@example.invalid`, isActive: true },
  });
  const rep = await prisma.salesRepresentative.create({
    data: { userId: repUser.id, employeeCode: `${runId}-rep` },
  });
  const repCar = await prisma.stockLocation.create({
    data: { type: STOCK_LOCATION_TYPES.REP_CAR, name: `${runId}-car`, salesRepId: rep.id },
  });
  const warehouse = await prisma.stockLocation.create({
    data: { type: STOCK_LOCATION_TYPES.WAREHOUSE, name: `${runId}-warehouse`, isDefault: true },
  });
  const product = await prisma.product.create({
    data: { sku: `${runId}-product`, name: `${runId}-product`, retailPriceCents: 1000, wholesalePriceCents: 800, isActive: true },
  });
  await prisma.inventoryItem.create({ data: { productId: product.id, locationId: repCar.id, quantity: 100_000 } });
  await prisma.inventoryItem.create({ data: { productId: product.id, locationId: warehouse.id, quantity: 100_000 } });

  // Separate low-stock product, isolated to CASE 20 only, so the
  // oversell/concurrency test never interferes with every other case's
  // shared high-stock product.
  const scarceProduct = await prisma.product.create({
    data: { sku: `${runId}-scarce`, name: `${runId}-scarce`, retailPriceCents: 1000, wholesalePriceCents: 800, isActive: true },
  });
  await prisma.inventoryItem.create({ data: { productId: scarceProduct.id, locationId: repCar.id, quantity: 5 } });

  interface SellItem {
    quantity: number;
    unitPriceCents: number;
    bonusQuantity?: number;
    productId?: string;
  }

  /** One rep-car sale — the exact same createRepSaleCore every real rep
   * sale (or admin-on-behalf sale) eventually calls, never a
   * re-implementation of the sale/pricing/bonus logic under test.
   *
   * createRepSaleCore calls Next.js's revalidatePath(...) as its very LAST
   * step, strictly AFTER its own prisma.$transaction(...) has already
   * committed (see rep-sales.ts) — outside a real Next.js request (as here,
   * a bare script), revalidatePath throws "Invariant: static generation
   * store missing", a Next.js runtime-context limitation, not a
   * data-correctness one: by the time it fires, the order/payment/inventory
   * effects under test have already committed. This narrowly catches ONLY
   * that specific error and reports the sale as accepted (with an empty
   * orderNumber, since the real one is never read back this way) — every
   * actual assertion below re-reads real rows via readOrders()/readAccount()
   * instead of trusting this return value's orderNumber. Any OTHER error
   * still propagates and fails the test. */
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
      if (error instanceof Error && error.message.includes("static generation store missing")) {
        return { ok: true as const, orderNumber: "" };
      }
      throw error;
    }
  }

  /** WAREHOUSE-side equivalent of `sell` above — see the file header
   * comment for why this runs a direct transaction (mirroring
   * createManualOrder's own transaction body exactly, using the same
   * canonical helpers) instead of calling createManualOrder itself. */
  async function sellWarehouse(phone: string, items: SellItem[], discountCents: number, paidAmountCents: number) {
    const chargeLines = items.map((item) => ({ quantity: item.quantity, bonusQuantity: item.bonusQuantity ?? 0, unitPriceCents: item.unitPriceCents }));
    const subtotalCents = calculateChargeableSubtotalCents(chargeLines);
    const discountError = validateInvoiceDiscount(discountCents, subtotalCents);
    if (discountError) return { ok: false as const, error: discountError };
    const totalCents = calculateInvoiceTotalCents(subtotalCents, discountCents);
    const paymentStatus = derivePaymentStatus(totalCents, paidAmountCents);

    const order = await prisma.$transaction(async (tx) => {
      const orderNumber = await generateDailyOrderNumber(tx);
      const created = await tx.order.create({
        data: {
          orderNumber,
          source: ORDER_SOURCES.ADMIN_MANUAL,
          status: ORDER_STATUSES.CONFIRMED,
          stockLocationId: warehouse.id,
          subtotalCents,
          discountCents,
          totalCents,
          contactName: `${runId}-${phone}`,
          contactPhone: `${runId}-${phone}`,
          paymentMethod: PAYMENT_METHODS.CASH,
          paymentStatus,
          paidAmountCents,
          items: {
            create: items.map((item) => ({
              productId: item.productId ?? product.id,
              quantity: item.quantity,
              unitPriceCents: item.unitPriceCents,
              bonusQuantity: item.bonusQuantity ?? 0,
              totalCents: calculateLineChargeCents({ quantity: item.quantity, bonusQuantity: item.bonusQuantity ?? 0, unitPriceCents: item.unitPriceCents }),
            })),
          },
        },
        include: { items: true },
      });
      for (const item of items) {
        const change = await decrementInventoryAtomic(tx, { productId: item.productId ?? product.id, locationId: warehouse.id }, item.quantity);
        await recordStockMovement(tx, {
          type: STOCK_MOVEMENT_TYPES.SALE_OUT,
          productId: item.productId ?? product.id,
          fromLocationId: warehouse.id,
          toLocationId: null,
          quantity: item.quantity,
          previousQuantity: change.previousQuantity,
          newQuantity: change.newQuantity,
          note: `verify warehouse sale ${orderNumber}`,
          createdById: admin.id,
        });
      }
      return created;
    });
    return { ok: true as const, order };
  }

  async function findMerchantByPhone(phone: string) {
    return prisma.merchant.findFirst({
      where: { assignedRepId: rep.id, contactPhone: `${runId}-${phone}` },
      select: { id: true, account: { select: { id: true } } },
    });
  }

  async function readOrders(phone: string) {
    const merchant = await findMerchantByPhone(phone);
    if (!merchant) return [];
    return prisma.order.findMany({
      where: { merchantId: merchant.id },
      orderBy: { createdAt: "asc" },
      include: { items: true },
    });
  }

  async function readLatestOrder(phone: string) {
    const orders = await readOrders(phone);
    return orders[orders.length - 1] ?? null;
  }

  interface AccountSnapshot {
    balanceCents: number;
    orders: { status: string; totalCents: number }[];
    payments: { amountCents: number; method: string; origin: string | null; cancellation: { id: string } | null }[];
  }

  async function readAccount(phone: string): Promise<AccountSnapshot | null> {
    const merchant = await prisma.merchant.findFirst({
      where: { assignedRepId: rep.id, contactPhone: `${runId}-${phone}` },
      select: {
        account: {
          select: {
            openingBalanceCents: true,
            orders: { select: { status: true, totalCents: true } },
            payments: { select: { amountCents: true, method: true, origin: true, cancellation: { select: { id: true } } } },
            salesReturns: { select: { totalCreditCents: true } },
          },
        },
      },
    });
    if (!merchant?.account) return null;
    return {
      balanceCents: getAccountBalanceCents(merchant.account),
      orders: merchant.account.orders,
      payments: merchant.account.payments,
    };
  }

  async function readRepCarStock(): Promise<number> {
    const row = await prisma.inventoryItem.findFirstOrThrow({ where: { productId: product.id, locationId: repCar.id }, select: { quantity: true } });
    return row.quantity;
  }

  async function readWarehouseStock(productId: string): Promise<number> {
    const row = await prisma.inventoryItem.findFirstOrThrow({ where: { productId, locationId: warehouse.id }, select: { quantity: true } });
    return row.quantity;
  }

  try {
    // =================================================================
    // CASE 1 — normal sale, no discount/bonus
    // =================================================================
    await check("CASE 1: normal sale (no discount, no bonus) behaves as a plain qty*price sale", async () => {
      const result = await sell("c1", [{ quantity: 3, unitPriceCents: nis(10), bonusQuantity: 0 }], 0, nis(30));
      assert(result.ok, `expected acceptance, got: ${!result.ok && result.error}`);
      const order = await readLatestOrder("c1");
      assert(order !== null, "expected an order to exist");
      assert(order!.subtotalCents === nis(30), `expected subtotal 30, got ${order!.subtotalCents / 100}`);
      assert(order!.discountCents === 0, `expected discount 0, got ${order!.discountCents / 100}`);
      assert(order!.totalCents === nis(30), `expected total 30, got ${order!.totalCents / 100}`);
      assert(order!.items[0]!.bonusQuantity === 0, "expected bonusQuantity 0");
      assert(order!.items[0]!.totalCents === nis(30), `expected item total 30, got ${order!.items[0]!.totalCents / 100}`);
    });

    // =================================================================
    // CASE 2 — discount only
    // =================================================================
    await check("CASE 2: discount only (no bonus) reduces the total, not the subtotal", async () => {
      const result = await sell("c2", [{ quantity: 5, unitPriceCents: nis(10) }], nis(10), nis(40));
      assert(result.ok, `expected acceptance, got: ${!result.ok && result.error}`);
      const order = await readLatestOrder("c2");
      assert(order!.subtotalCents === nis(50), `expected subtotal 50, got ${order!.subtotalCents / 100}`);
      assert(order!.discountCents === nis(10), `expected discount 10, got ${order!.discountCents / 100}`);
      assert(order!.totalCents === nis(40), `expected total 40, got ${order!.totalCents / 100}`);
    });

    // =================================================================
    // CASE 3 — whole-line bonus
    // =================================================================
    await check("CASE 3: whole-line bonus charges 0 for the line, keeps quantity intact", async () => {
      const result = await sell("c3", [{ quantity: 4, unitPriceCents: nis(10), bonusQuantity: 4 }], 0, 0);
      assert(result.ok, `expected acceptance, got: ${!result.ok && result.error}`);
      const order = await readLatestOrder("c3");
      assert(order!.items[0]!.quantity === 4, "quantity must stay the full physical count, never reduced for a bonus line");
      assert(order!.items[0]!.bonusQuantity === 4, "expected bonusQuantity 4");
      assert(order!.items[0]!.totalCents === 0, `expected charged total 0, got ${order!.items[0]!.totalCents / 100}`);
      assert(order!.totalCents === 0, `expected invoice total 0, got ${order!.totalCents / 100}`);
    });

    // =================================================================
    // CASE 4 — partial bonus
    // =================================================================
    await check("CASE 4: partial bonus charges only the non-bonus portion", async () => {
      const result = await sell("c4", [{ quantity: 5, unitPriceCents: nis(10), bonusQuantity: 1 }], 0, nis(40));
      assert(result.ok, `expected acceptance, got: ${!result.ok && result.error}`);
      const order = await readLatestOrder("c4");
      assert(order!.items[0]!.quantity === 5, "quantity must stay 5");
      assert(order!.items[0]!.bonusQuantity === 1, "expected bonusQuantity 1");
      assert(order!.items[0]!.totalCents === nis(40), `expected charged total 40 (4 paid units), got ${order!.items[0]!.totalCents / 100}`);
      assert(order!.totalCents === nis(40), `expected invoice total 40, got ${order!.totalCents / 100}`);
    });

    // =================================================================
    // CASE 5 — discount + bonus combo
    // =================================================================
    await check("CASE 5: discount applies on top of the bonus-adjusted (chargeable) subtotal", async () => {
      // 10 units @ ₪10, 3 bonus -> chargeable subtotal = 7 * 10 = 70; discount 20 -> total 50.
      const result = await sell("c5", [{ quantity: 10, unitPriceCents: nis(10), bonusQuantity: 3 }], nis(20), nis(50));
      assert(result.ok, `expected acceptance, got: ${!result.ok && result.error}`);
      const order = await readLatestOrder("c5");
      assert(order!.subtotalCents === nis(70), `expected chargeable subtotal 70, got ${order!.subtotalCents / 100}`);
      assert(order!.discountCents === nis(20), `expected discount 20, got ${order!.discountCents / 100}`);
      assert(order!.totalCents === nis(50), `expected total 50, got ${order!.totalCents / 100}`);
    });

    // =================================================================
    // CASE 6 — discount > subtotal rejected
    // =================================================================
    await check("CASE 6: discount greater than the chargeable subtotal is rejected, nothing created", async () => {
      const result = await sell("c6", [{ quantity: 2, unitPriceCents: nis(10) }], nis(21), 0);
      assert(!result.ok, "expected rejection");
      const merchant = await findMerchantByPhone("c6");
      assert(merchant === null, "rejected sale must not create a merchant/account (validation happens before the transaction)");
    });

    // =================================================================
    // CASE 7 — negative discount rejected
    // =================================================================
    await check("CASE 7: negative discountCents is rejected by the authoritative server check", async () => {
      const result = await sell("c7", [{ quantity: 2, unitPriceCents: nis(10) }], -100, 0);
      assert(!result.ok, "expected rejection");
      const merchant = await findMerchantByPhone("c7");
      assert(merchant === null, "rejected sale must not create a merchant/account");
    });

    // =================================================================
    // CASE 8 — bonus > quantity rejected
    // =================================================================
    await check("CASE 8: bonusQuantity greater than quantity is rejected", async () => {
      const result = await sell("c8", [{ quantity: 2, unitPriceCents: nis(10), bonusQuantity: 3 }], 0, 0);
      assert(!result.ok, "expected rejection");
      const merchant = await findMerchantByPhone("c8");
      assert(merchant === null, "rejected sale must not create a merchant/account");
    });

    // =================================================================
    // CASE 9 — negative bonus rejected
    // =================================================================
    await check("CASE 9: negative bonusQuantity is rejected by the authoritative server check", async () => {
      const result = await sell("c9", [{ quantity: 2, unitPriceCents: nis(10), bonusQuantity: -1 }], 0, 0);
      assert(!result.ok, "expected rejection");
      const merchant = await findMerchantByPhone("c9");
      assert(merchant === null, "rejected sale must not create a merchant/account");
    });

    // =================================================================
    // CASE 10 — zero-total all-bonus invoice accepted (stock available)
    // =================================================================
    await check("CASE 10: a fully-bonus (zero-total) invoice is a VALID sale when stock is available", async () => {
      const result = await sell("c10", [{ quantity: 6, unitPriceCents: nis(10), bonusQuantity: 6 }], 0, 0);
      assert(result.ok, `expected acceptance, got: ${!result.ok && result.error}`);
      const order = await readLatestOrder("c10");
      assert(order!.totalCents === 0, "expected a zero-total invoice");
      assert(order!.paymentStatus === constants.PAYMENT_STATUSES.PAID, `expected paymentStatus PAID for a zero-total invoice, got ${order!.paymentStatus}`);
      const account = await readAccount("c10");
      assert(account!.balanceCents === 0, `expected balance 0 (no previous debt, zero-total invoice), got ${account!.balanceCents / 100}`);
    });

    // =================================================================
    // CASE 11 — zero-total invoice + previous-debt payment accepted
    // =================================================================
    await check("CASE 11: a zero-total (all-bonus) invoice still allows paying down previous debt", async () => {
      const seed = await sell("c11", [{ quantity: 2, unitPriceCents: nis(50) }], 0, 0);
      assert(seed.ok, `seed debt setup failed: ${!seed.ok && seed.error}`);
      // previous debt = 100 NIS. This invoice: 3 units, all bonus -> total 0.
      // Trader pays 50 toward the OLD debt even though this invoice itself is free.
      const result = await sell("c11", [{ quantity: 3, unitPriceCents: nis(10), bonusQuantity: 3 }], 0, nis(50));
      assert(result.ok, `expected acceptance, got: ${!result.ok && result.error}`);
      const account = await readAccount("c11");
      assert(account!.balanceCents === nis(50), `expected debt 50 (100 previous + 0 new - 50 paid), got ${account!.balanceCents / 100}`);
    });

    // =================================================================
    // CASE 12 — previous debt + discount + payment combo
    // =================================================================
    await check("CASE 12: previous debt + a discounted new invoice + a combined payment all interact correctly", async () => {
      const seed = await sell("c12", [{ quantity: 2, unitPriceCents: nis(100) }], 0, 0);
      assert(seed.ok, `seed debt setup failed: ${!seed.ok && seed.error}`);
      // previous debt = 200 NIS. New invoice: 5 * 20 = 100 subtotal, discount 20 -> total 80.
      // Payment 90 = 80 (this invoice) + 10 (toward old debt).
      const result = await sell("c12", [{ quantity: 5, unitPriceCents: nis(20) }], nis(20), nis(90));
      assert(result.ok, `expected acceptance, got: ${!result.ok && result.error}`);
      const account = await readAccount("c12");
      // 200 (previous) + 80 (new invoice total) - 90 (paid) = 190.
      assert(account!.balanceCents === nis(190), `expected debt 190, got ${account!.balanceCents / 100}`);
    });

    // =================================================================
    // CASE 13 — REP_CAR decrements by the FULL physical quantity
    // =================================================================
    await check("CASE 13: REP_CAR inventory decrements by full quantity (paid + bonus), never just the paid portion", async () => {
      const before = await readRepCarStock();
      const result = await sell("c13", [{ quantity: 5, unitPriceCents: nis(10), bonusQuantity: 2 }], 0, nis(30));
      assert(result.ok, `expected acceptance, got: ${!result.ok && result.error}`);
      const after = await readRepCarStock();
      assert(before - after === 5, `expected stock to drop by exactly 5 (full physical quantity), dropped by ${before - after}`);
    });

    // =================================================================
    // CASE 14 — WAREHOUSE equivalent (admin manual-order style flow)
    // =================================================================
    await check("CASE 14: WAREHOUSE inventory decrements by full quantity too, via the same canonical pricing helpers", async () => {
      const before = await readWarehouseStock(product.id);
      const result = await sellWarehouse("c14", [{ quantity: 4, unitPriceCents: nis(10), bonusQuantity: 1 }], 0, nis(30));
      assert(result.ok, `expected acceptance, got: ${!result.ok && (result as { error?: string }).error}`);
      const after = await readWarehouseStock(product.id);
      assert(before - after === 4, `expected WAREHOUSE stock to drop by exactly 4 (full physical quantity), dropped by ${before - after}`);
      assert(result.order.totalCents === nis(30), `expected total 30 (3 paid units), got ${result.order.totalCents / 100}`);
      assert(result.order.items[0]!.bonusQuantity === 1, "expected bonusQuantity 1 on the WAREHOUSE-sourced order item");
    });

    // =================================================================
    // CASE 15 — cancellation restores the FULL physical quantity, no money "appears"
    // =================================================================
    await check("CASE 15: cancelling a sale with bonus units restores ALL physical units and reverses payment with no leftover balance", async () => {
      const before = await readRepCarStock();
      const result = await sell("c15", [{ quantity: 3, unitPriceCents: nis(20), bonusQuantity: 1 }], 0, nis(40));
      assert(result.ok, `expected acceptance, got: ${!result.ok && result.error}`);
      const afterSale = await readRepCarStock();
      assert(before - afterSale === 3, `expected stock to drop by 3 (full physical quantity), dropped by ${before - afterSale}`);

      const order = await readLatestOrder("c15");
      const correction = await correctSale({ orderNumber: order!.orderNumber, reason: "verify: bonus cancellation test", actorUserId: repUser.id });
      assert(correction.ok, `expected cancellation to succeed, got: ${!correction.ok && correction.message}`);

      const afterCancel = await readRepCarStock();
      assert(afterCancel === before, `expected stock fully restored to ${before} (all 3 physical units, bonus included), got ${afterCancel}`);

      const account = await readAccount("c15");
      assert(account!.balanceCents === 0, `expected balance back to 0 after cancellation (no money should 'appear' for the bonus unit), got ${account!.balanceCents / 100}`);
    });

    // =================================================================
    // CASE 16 — invoice snapshot integrity: a later product price change never rewrites history
    // =================================================================
    await check("CASE 16: OrderItem price/total snapshot is immune to a later Product price change", async () => {
      const result = await sell("c16", [{ quantity: 2, unitPriceCents: nis(15) }], 0, nis(30));
      assert(result.ok, `expected acceptance, got: ${!result.ok && result.error}`);
      await prisma.product.update({ where: { id: product.id }, data: { retailPriceCents: nis(999) } });
      const order = await readLatestOrder("c16");
      assert(order!.items[0]!.unitPriceCents === nis(15), `expected the snapshotted unit price 15 to survive the later product price change, got ${order!.items[0]!.unitPriceCents / 100}`);
      assert(order!.items[0]!.totalCents === nis(30), `expected the snapshotted line total 30 to survive, got ${order!.items[0]!.totalCents / 100}`);
      // Restore for subsequent cases that share `product`.
      await prisma.product.update({ where: { id: product.id }, data: { retailPriceCents: 1000 } });
    });

    // =================================================================
    // CASE 17 — reports use the persisted FINAL (discounted, bonus-excluded) total
    // =================================================================
    await check("CASE 17: the persisted Order.totalCents (what reports sum) is the discounted, bonus-excluded value", async () => {
      // 4 units @ ₪25, 1 bonus -> chargeable subtotal 75; discount 10 -> total 65.
      const result = await sell("c17", [{ quantity: 4, unitPriceCents: nis(25), bonusQuantity: 1 }], nis(10), nis(65));
      assert(result.ok, `expected acceptance, got: ${!result.ok && result.error}`);
      const order = await readLatestOrder("c17");
      assert(order!.totalCents === nis(65), `expected persisted total 65 (the value every sales report sums directly), got ${order!.totalCents / 100}`);
      assert(order!.totalCents !== nis(100), "must never equal the pre-bonus gross value (4 * 25 = 100)");
      assert(order!.totalCents !== nis(75), "must never equal the pre-discount chargeable subtotal (75)");
    });

    // =================================================================
    // CASE 18 — collection counted exactly once
    // =================================================================
    await check("CASE 18: the initial payment is recorded exactly once, matching paidNowCents exactly", async () => {
      const account = await readAccount("c17");
      assert(account!.payments.length === 1, `expected exactly one payment row, got ${account!.payments.length}`);
      assert(account!.payments[0]!.amountCents === nis(65), `expected the one payment to be 65, got ${account!.payments[0]!.amountCents / 100}`);
    });

    // =================================================================
    // CASE 19 — receipt/payment fields unaffected by discount/bonus internals
    // =================================================================
    await check("CASE 19: the payment row's method/origin are recorded normally, untouched by discount/bonus math", async () => {
      const account = await readAccount("c17");
      const payment = account!.payments[0]!;
      assert(payment.method === ACCOUNT_PAYMENT_METHODS.CASH, `expected CASH method, got ${payment.method}`);
      assert(payment.origin === constants.ACCOUNT_PAYMENT_ORIGINS.SALE_INITIAL, `expected SALE_INITIAL origin, got ${payment.origin}`);
      assert(payment.cancellation === null, "expected an uncancelled payment");
    });

    // =================================================================
    // CASE 20 — concurrency: bonus quantities cannot bypass the oversell guard
    // =================================================================
    await check("CASE 20: two concurrent sales requesting more than available stock cannot both succeed, even with bonus lines", async () => {
      // Stock = 5. Two concurrent sales each request quantity 3 (with 1
      // bonus each) -> combined demand 6 > 5 available. Exactly one must
      // succeed; the decrement check must use the FULL quantity (3), never
      // the bonus-reduced charge amount.
      const [first, second] = await Promise.all([
        sell("c20a", [{ quantity: 3, unitPriceCents: nis(10), bonusQuantity: 1, productId: scarceProduct.id }], 0, nis(20)),
        sell("c20b", [{ quantity: 3, unitPriceCents: nis(10), bonusQuantity: 1, productId: scarceProduct.id }], 0, nis(20)),
      ]);
      const results = [first, second];
      const succeeded = results.filter((result) => result.ok);
      const rejected = results.filter((result) => !result.ok);
      assert(succeeded.length === 1, `expected exactly one concurrent sale to succeed, got ${succeeded.length} of 2`);
      assert(rejected.length === 1, `expected exactly one concurrent sale to be rejected, got ${rejected.length} of 2`);
      const finalStock = await prisma.inventoryItem.findFirstOrThrow({ where: { productId: scarceProduct.id, locationId: repCar.id }, select: { quantity: true } });
      assert(finalStock.quantity === 2, `expected stock to end at 2 (5 - 3 for the one accepted sale), got ${finalStock.quantity}`);
    });

    // =================================================================
    // CASE 21 — existing (no discount/no bonus) multi-line sale behaves exactly as before
    // =================================================================
    await check("CASE 21: a multi-line sale with no discount/bonus regresses to the exact pre-feature formula", async () => {
      const result = await sell(
        "c21",
        [
          { quantity: 2, unitPriceCents: nis(10) },
          { quantity: 3, unitPriceCents: nis(5) },
        ],
        0,
        nis(35),
      );
      assert(result.ok, `expected acceptance, got: ${!result.ok && result.error}`);
      const order = await readLatestOrder("c21");
      // Pre-feature formula: sum(quantity * unitPriceCents) = 2*10 + 3*5 = 35.
      assert(order!.totalCents === nis(35), `expected total 35 (unchanged pre-feature formula), got ${order!.totalCents / 100}`);
      assert(order!.items.every((item) => item.bonusQuantity === 0), "expected every item's bonusQuantity to default to 0");
      assert(order!.items.find((item) => item.quantity === 2)!.totalCents === nis(20), "expected first line total 20");
      assert(order!.items.find((item) => item.quantity === 3)!.totalCents === nis(15), "expected second line total 15");
    });

    console.log("\nAll sale discount/bonus verification checks passed");
  } finally {
    const runFilter = { OR: [{ createdByRep: { employeeCode: { startsWith: runId } } }, { contactPhone: { startsWith: runId } }] };
    await prisma.accountPaymentCancellation.deleteMany({ where: { payment: { createdBy: { email: { startsWith: runId } } } } });
    await prisma.accountPayment.deleteMany({ where: { createdBy: { email: { startsWith: runId } } } });
    await prisma.stockMovement.deleteMany({ where: { OR: [{ product: { sku: { startsWith: runId } } }] } });
    await prisma.orderItem.deleteMany({ where: { order: runFilter } });
    await prisma.order.deleteMany({ where: runFilter });
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
