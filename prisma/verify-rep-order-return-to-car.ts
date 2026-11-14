/**
 * Real-database verification for "إلغاء وإرجاع للسيارة" and "عرض كل الطلبات" on
 * the rep's "طلبات الزبائن" list (/admin/reps/[id]):
 * src/lib/rep-order-correction.ts (ownership gate over the canonical
 * correctSale), src/lib/rep-customer-orders.ts (getRepCustomerEngagementRows
 * with { all }), RepCustomerOrdersCard and the page/action wiring.
 *
 * Rules under test: cancelling a COMPLETED rep sale puts exactly the sold
 * quantities back into THAT rep's car (never the warehouse, never another
 * rep), through the one canonical lifecycle (history + compensation + payment
 * cancellation), exactly once; a reason is mandatory; another rep's / unknown
 * orders are unreachable; the default list is unchanged and "all" lists
 * everything. No schema change, no new write path.
 *
 * Safety rails via resolveVerifyDatabaseUrl (prisma/verify-guardrails.ts):
 * never runs against a shared/production database.
 *
 * Run with: node --conditions=react-server --import tsx prisma/verify-rep-order-return-to-car.ts
 * REP_ORDER_RETURN_VERIFY_DATABASE_URL must point at a disposable localhost
 * PostgreSQL database whose name contains "verify".
 */

export {};

import { resolveVerifyDatabaseUrl } from "./verify-guardrails";

const resolved = resolveVerifyDatabaseUrl("REP_ORDER_RETURN_VERIFY_DATABASE_URL");
console.log(`[verify-rep-order-return-to-car] target: ${resolved.masked}`);

process.env.DATABASE_URL = resolved.url;
process.env.DIRECT_URL = resolved.url;

async function main() {
  const fs = await import("node:fs");
  const [{ PrismaClient }, constants, ordersLib, repSales, correction] = await Promise.all([
    import("@prisma/client"),
    import("../src/lib/constants"),
    import("../src/lib/rep-customer-orders"),
    import("../src/lib/rep-sales"),
    import("../src/lib/rep-order-correction"),
  ]);
  const prisma = new PrismaClient();
  const { ROLES, STOCK_LOCATION_TYPES, REP_CUSTOMER_ORDER_STATUSES, ACCOUNT_PAYMENT_METHODS, ORDER_STATUSES } = constants;
  const { getRepCustomerEngagementRows } = ordersLib;
  const { createRepSaleCore } = repSales;
  const { correctRepOrderSaleCore } = correction;
  const runId = `verify-rtc-${Date.now()}`;

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
  const admin = await prisma.user.create({ data: { role: ROLES.ADMIN, name: `${runId}-admin`, email: `${runId}-admin@example.invalid`, isActive: true } });
  async function makeRep(label: string) {
    const user = await prisma.user.create({ data: { role: ROLES.SALES_REPRESENTATIVE, name: `${runId}-${label}`, email: `${runId}-${label}@example.invalid`, isActive: true } });
    const rep = await prisma.salesRepresentative.create({ data: { userId: user.id, employeeCode: `${runId}-${label}` } });
    const car = await prisma.stockLocation.create({ data: { type: STOCK_LOCATION_TYPES.REP_CAR, name: `${runId}-car-${label}`, salesRepId: rep.id } });
    return { user, rep, car };
  }
  const A = await makeRep("A");
  const B = await makeRep("B");
  const warehouse = await prisma.stockLocation.create({ data: { type: STOCK_LOCATION_TYPES.WAREHOUSE, name: `${runId}-wh`, isDefault: false } });

  const products: { id: string }[] = [];
  for (let i = 1; i <= 8; i++) {
    const product = await prisma.product.create({ data: { sku: `${runId}-P${i}`, name: `${runId}-P${i}`, retailPriceCents: 1000, wholesalePriceCents: 800, isActive: true } });
    products.push(product);
    await prisma.inventoryItem.create({ data: { productId: product.id, locationId: A.car.id, quantity: 100 } });
    await prisma.inventoryItem.create({ data: { productId: product.id, locationId: B.car.id, quantity: 100 } });
  }
  const P = (n: number) => products[n - 1]!.id;
  const qty = async (locationId: string, productId: string) => (await prisma.inventoryItem.findFirst({ where: { locationId, productId, variantId: null, deviceColorVariantId: null }, select: { quantity: true } }))?.quantity ?? 0;
  const warehouseTotal = async () => (await prisma.inventoryItem.aggregate({ where: { locationId: warehouse.id }, _sum: { quantity: true } }))._sum.quantity ?? 0;

  const merchant = await prisma.merchant.create({ data: { businessName: `${runId}-merchant`, contactPhone: `${runId}-m`, assignedRepId: A.rep.id, status: "APPROVED" } });
  async function template(minutes: number, lines: [number, number][], status: string = REP_CUSTOMER_ORDER_STATUSES.OPEN) {
    // every template owns its own transfer batch (RepCustomerOrder.transferBatchId is unique)
    const batch = await prisma.repStockTransferBatch.create({ data: { type: "REP_ASSIGNMENT", salesRepId: A.rep.id, fromLocationId: warehouse.id, toLocationId: A.car.id, loadType: "CUSTOMER_ORDER" } });
    return prisma.repCustomerOrder.create({
      data: {
        salesRepId: A.rep.id,
        customerName: `${runId}-cust`,
        merchantId: merchant.id,
        status,
        transferBatchId: batch.id,
        createdAt: new Date(Date.now() - 3_600_000 + minutes * 60_000),
        items: { create: lines.map(([product, quantity]) => ({ productId: P(product), quantity })) },
      },
    });
  }

  /** createRepSaleCore calls revalidatePath last; outside a Next request that
   * throws the known "static generation store missing" invariant AFTER the
   * transaction committed — outcomes are verified by re-reading real rows. */
  async function sell(args: { items: [number, number][]; sourceIds?: string[]; paidNowCents?: number; phone: string }) {
    try {
      return await createRepSaleCore(
        {
          items: args.items.map(([product, quantity]) => ({ productId: P(product), colorId: null, variantId: null, deviceColorVariantId: null, quantity, unitPriceCents: 1000, bonusQuantity: 0 })),
          customerName: `${runId}-cust`,
          customerPhone: args.phone,
          city: undefined,
          address: undefined,
          notes: undefined,
          repCustomerOrderId: null,
          repCustomerOrderIds: args.sourceIds,
          discountCents: 0,
          paidNowCents: args.paidNowCents ?? 0,
          paidNowMethod: ACCOUNT_PAYMENT_METHODS.CASH,
        },
        { salesRepId: A.rep.id, carStockLocationId: A.car.id, actorUserId: A.user.id },
      );
    } catch (error) {
      if (error instanceof Error && error.message.includes("static generation store missing")) return { ok: true as const, orderNumber: "" };
      throw error;
    }
  }
  async function latestOrderNumber(salesRepId: string) {
    return (await prisma.order.findFirst({ where: { createdByRepId: salesRepId }, orderBy: { createdAt: "desc" }, select: { orderNumber: true } }))!.orderNumber;
  }

  // Sale 1: a template-based sale (template completes, resulting order linked)
  const t1 = await template(1, [[1, 5], [2, 3]]);
  await sell({ items: [[1, 5], [2, 3]], sourceIds: [t1.id], phone: `${runId}-m` });
  const order1 = await latestOrderNumber(A.rep.id);
  // Sale 2: an ad-hoc sale with a cash payment taken now
  await sell({ items: [[3, 4]], paidNowCents: 2000, phone: `${runId}-m` });
  const order2 = await latestOrderNumber(A.rep.id);
  // Sale 3: rep B's own sale (must be unreachable through rep A's card)
  const bMerchant = await prisma.merchant.create({ data: { businessName: `${runId}-b`, contactPhone: `${runId}-b`, assignedRepId: B.rep.id, status: "APPROVED" } });
  void bMerchant;
  try {
    await createRepSaleCore(
      {
        items: [{ productId: P(4), colorId: null, variantId: null, deviceColorVariantId: null, quantity: 6, unitPriceCents: 1000, bonusQuantity: 0 }],
        customerName: `${runId}-b`,
        customerPhone: `${runId}-b`,
        city: undefined,
        address: undefined,
        notes: undefined,
        repCustomerOrderId: null,
        repCustomerOrderIds: undefined,
        discountCents: 0,
        paidNowCents: 0,
        paidNowMethod: ACCOUNT_PAYMENT_METHODS.CASH,
      },
      { salesRepId: B.rep.id, carStockLocationId: B.car.id, actorUserId: B.user.id },
    );
  } catch (error) {
    if (!(error instanceof Error && error.message.includes("static generation store missing"))) throw error;
  }
  const orderB = await latestOrderNumber(B.rep.id);

  await check("0. fixture: sales deducted the car stock (A: P1 95, P2 97, P3 96; B: P4 94); warehouse untouched", async () => {
    assert((await qty(A.car.id, P(1))) === 95 && (await qty(A.car.id, P(2))) === 97 && (await qty(A.car.id, P(3))) === 96, "rep A car after sales");
    assert((await qty(B.car.id, P(4))) === 94, "rep B car after sale");
    assert((await warehouseTotal()) === 0, "warehouse is empty");
  });

  await check("1. a COMPLETED template's sale is cancelled: exactly the sold quantities return to rep A's car, once, via the canonical lifecycle", async () => {
    const result = await correctRepOrderSaleCore({ repId: A.rep.id, orderNumber: order1, reason: "طلب خاطئ", actorUserId: admin.id });
    assert(result.ok, `correction failed: ${JSON.stringify(result)}`);
    assert((await qty(A.car.id, P(1))) === 100 && (await qty(A.car.id, P(2))) === 100, "P1 / P2 are back to 100 in the car");
    assert((await warehouseTotal()) === 0, "nothing went to the warehouse");
    const order = await prisma.order.findUnique({ where: { orderNumber: order1 }, select: { status: true, inventoryRestoredAt: true, stockLocationId: true, inventoryCompensation: { select: { id: true } }, statusHistory: { select: { toStatus: true, reason: true } } } });
    assert(order?.status === ORDER_STATUSES.RETURNED && order.inventoryRestoredAt && order.inventoryCompensation, "order is RETURNED with a compensation record");
    assert(order.stockLocationId === A.car.id, "the order's own stock location is the rep's car");
    assert(order.statusHistory.some((h) => h.toStatus === ORDER_STATUSES.RETURNED && (h.reason ?? "").includes("طلب خاطئ")), "the reason is stored in the status history");
    const movements = await prisma.stockMovement.findMany({ where: { note: { contains: order1 }, toLocationId: A.car.id }, select: { quantity: true, fromLocationId: true } });
    assert(movements.length === 2 && movements.reduce((sum, m) => sum + m.quantity, 0) === 8 && movements.every((m) => m.fromLocationId === null), `one restoring movement per line INTO the car (5 + 3), got ${JSON.stringify(movements)}`);
  });

  await check("2. cancelling the same sale again restores NOTHING more (no double return)", async () => {
    const again = await correctRepOrderSaleCore({ repId: A.rep.id, orderNumber: order1, reason: "مرة ثانية", actorUserId: admin.id });
    assert(!again.ok, "second correction is refused");
    assert((await qty(A.car.id, P(1))) === 100 && (await qty(A.car.id, P(2))) === 100, "stock did not change again");
  });

  await check("3. an ad-hoc sale with a payment: stock returns to the car and the linked payment is cancelled", async () => {
    const result = await correctRepOrderSaleCore({ repId: A.rep.id, orderNumber: order2, reason: "مبيعة خاطئة", actorUserId: admin.id });
    assert(result.ok, `correction failed: ${JSON.stringify(result)}`);
    assert((await qty(A.car.id, P(3))) === 100, "P3 back to 100");
    const order = await prisma.order.findUnique({ where: { orderNumber: order2 }, select: { status: true, initialPayment: { select: { cancellation: { select: { id: true } } } } } });
    assert(order?.status === ORDER_STATUSES.RETURNED && order.initialPayment?.cancellation, "order RETURNED and its initial payment cancelled");
  });

  await check("4. a reason is mandatory: nothing changes without one", async () => {
    const result = await correctRepOrderSaleCore({ repId: B.rep.id, orderNumber: orderB, reason: "   ", actorUserId: admin.id });
    assert(!result.ok, "blank reason refused");
    assert((await qty(B.car.id, P(4))) === 94, "rep B stock unchanged");
    assert((await prisma.order.findUnique({ where: { orderNumber: orderB }, select: { status: true } }))?.status === ORDER_STATUSES.DELIVERED, "order still DELIVERED");
  });

  await check("5. ownership: rep B's sale (or an unknown number) cannot be cancelled through rep A's card", async () => {
    const wrongRep = await correctRepOrderSaleCore({ repId: A.rep.id, orderNumber: orderB, reason: "محاولة", actorUserId: admin.id });
    assert(!wrongRep.ok && wrongRep.error === "الطلب غير موجود", "another rep's order is 'not found'");
    const unknown = await correctRepOrderSaleCore({ repId: A.rep.id, orderNumber: "NOPE-0", reason: "محاولة", actorUserId: admin.id });
    assert(!unknown.ok, "unknown order refused");
    assert((await qty(B.car.id, P(4))) === 94 && (await qty(A.car.id, P(4))) === 100, "no stock moved on either car");
    const right = await correctRepOrderSaleCore({ repId: B.rep.id, orderNumber: orderB, reason: "تصحيح", actorUserId: admin.id });
    assert(right.ok && (await qty(B.car.id, P(4))) === 100, "through the owning rep it works and returns to B's own car");
  });

  await check("6. the list: default = latest 10 templates (+ today's ad-hoc), 'all' = every template and every ad-hoc sale; a reversed sale shows its real status", async () => {
    for (let i = 0; i < 14; i++) await template(10 + i, [[5, 1]]);
    // an ad-hoc sale from "yesterday": only the full list may show it
    await sell({ items: [[6, 2]], phone: `${runId}-m` });
    const old = await latestOrderNumber(A.rep.id);
    await prisma.order.update({ where: { orderNumber: old }, data: { createdAt: new Date(Date.now() - 3 * 86_400_000) } });

    const normal = await getRepCustomerEngagementRows(A.rep.id);
    const full = await getRepCustomerEngagementRows(A.rep.id, 10, { all: true });
    const templatesNormal = normal.filter((row) => row.kind === "customerOrder" || row.kind === "merchantGroup");
    assert(!normal.some((row) => row.kind === "sale" && row.orderNumber === old), "default list hides the older ad-hoc sale (as before)");
    assert(full.some((row) => row.kind === "sale" && row.orderNumber === old), "'all' shows the older ad-hoc sale");
    const countTemplates = (rows: typeof full) => rows.reduce((n, row) => n + (row.kind === "merchantGroup" ? row.children.length : row.kind === "customerOrder" ? 1 : 0), 0);
    assert(countTemplates(normal) === 10, `default shows 10 templates, got ${countTemplates(normal)}`);
    assert(countTemplates(full) === 1 + 14 + 0, `'all' shows every template (1 + 14), got ${countTemplates(full)}`);
    assert(templatesNormal.length > 0, "default list still renders");
    const t1Row = full.flatMap((row) => (row.kind === "merchantGroup" ? row.children : [row])).find((row) => row.id === t1.id);
    assert(t1Row && t1Row.kind === "customerOrder" && t1Row.status === REP_CUSTOMER_ORDER_STATUSES.COMPLETED && t1Row.saleOrderStatus === ORDER_STATUSES.RETURNED, "the completed template carries its sale's real status (RETURNED) so the card stops saying 'مكتمل'");
    const adHocB = full.find((row) => row.kind === "sale" && row.orderNumber === order2);
    assert(adHocB && adHocB.kind === "sale" && adHocB.orderStatus === ORDER_STATUSES.RETURNED, "the cancelled ad-hoc sale shows RETURNED");
    assert(!full.some((row) => row.kind === "sale" && row.orderNumber === orderB), "another rep's sale is never in this rep's list");
  });

  await check("7. UI/page wiring: the button exists only for DELIVERED sales, ADMIN-only page + action, no Product.stock / schema change", async () => {
    const card = codeOnly(read("../src/components/reps/RepCustomerOrdersCard.tsx"));
    assert(card.includes("إلغاء وإرجاع للسيارة") && card.includes("correctRepOrderSale.bind(null, repId)"), "button wired to the new action with the repId bound");
    assert(/canReturnToCar\s*=\s*row\.status === REP_CUSTOMER_ORDER_STATUSES\.COMPLETED && row\.saleOrderStatus === ORDER_STATUSES\.DELIVERED/.test(card), "template rows: only when COMPLETED and the sale is still DELIVERED");
    assert(/row\.orderStatus === ORDER_STATUSES\.DELIVERED && <ReturnSaleToCarButton/.test(card), "ad-hoc rows: only while DELIVERED");
    assert(card.includes("عرض كل الطلبات") && card.includes("?orders=all"), "the 'show all' link");
    assert(card.includes("CancelOrderButton") && card.includes("REP_CUSTOMER_ORDER_STATUSES.OPEN && <CancelOrderButton"), "the existing OPEN-template cancel is untouched");
    const actions = codeOnly(read("../src/app/admin/reps/actions.ts"));
    const actionBody = actions.slice(actions.indexOf("export async function correctRepOrderSale("));
    assert(/requireRole\(\[ROLES\.ADMIN\]\)/.test(actionBody.slice(0, 400)), "the action is ADMIN-only");
    const page = codeOnly(read("../src/app/admin/reps/[id]/page.tsx"));
    assert(/requireRole\(\[ROLES\.ADMIN\]\)/.test(page) && page.includes("showAllOrders"), "the page stays ADMIN-only and reads ?orders=all");
    const core = codeOnly(read("../src/lib/rep-order-correction.ts"));
    assert(core.includes("correctSale(") && !/\.(create|update|updateMany|delete|upsert)\(|incrementInventory|recordStockMovement|\.stock\b/.test(core), "the new lib only gates ownership and delegates to correctSale — no stock/inventory code of its own");
    const loader = codeOnly(read("../src/lib/rep-customer-orders.ts"));
    assert(!/\.(create|update|updateMany|delete|upsert)\(|\.stock\b/.test(loader), "the list loader stays read-only");
  });

  console.log("ALL PASS");
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
