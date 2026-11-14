/**
 * Real-database verification for "كل الطلبات" in the rep's "طلبات الزبائن" list
 * (/admin/reps/[id]): getRepCustomerEngagementRows(repId, 10, { all: true }).
 *
 * Rules under test: the default view is unchanged (latest 10 templates +
 * today's ad-hoc sales); with { all: true } EVERY template and EVERY ad-hoc
 * sale of that rep is listed, never another rep's; a completed template carries
 * its sale's real status. Read-only — no cancel/return control exists.
 *
 * Safety rails via resolveVerifyDatabaseUrl (prisma/verify-guardrails.ts):
 * never runs against a shared/production database.
 *
 * Run with: node --conditions=react-server --import tsx prisma/verify-rep-orders-all.ts
 * REP_ORDERS_ALL_VERIFY_DATABASE_URL must point at a disposable localhost
 * PostgreSQL database whose name contains "verify".
 */

export {};

import { resolveVerifyDatabaseUrl } from "./verify-guardrails";

const resolved = resolveVerifyDatabaseUrl("REP_ORDERS_ALL_VERIFY_DATABASE_URL");
console.log(`[verify-rep-orders-all] target: ${resolved.masked}`);

process.env.DATABASE_URL = resolved.url;
process.env.DIRECT_URL = resolved.url;

async function main() {
  const fs = await import("node:fs");
  const [{ PrismaClient }, constants, ordersLib, repSales] = await Promise.all([
    import("@prisma/client"),
    import("../src/lib/constants"),
    import("../src/lib/rep-customer-orders"),
    import("../src/lib/rep-sales"),
  ]);
  const prisma = new PrismaClient();
  const { ROLES, STOCK_LOCATION_TYPES, REP_CUSTOMER_ORDER_STATUSES, ACCOUNT_PAYMENT_METHODS, ORDER_STATUSES } = constants;
  const { getRepCustomerEngagementRows } = ordersLib;
  const { createRepSaleCore } = repSales;
  const runId = `verify-all-${Date.now()}`;

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

  await check("1. default = latest 10 templates (+ today's ad-hoc); { all: true } = every template and every ad-hoc sale of THIS rep", async () => {
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
    assert(countTemplates(full) === 1 + 14, `'all' shows every template (1 + 14), got ${countTemplates(full)}`);
    assert(templatesNormal.length > 0, "default list still renders");
    const t1Row = full.flatMap((row) => (row.kind === "merchantGroup" ? row.children : [row])).find((row) => row.id === t1.id);
    assert(t1Row && t1Row.kind === "customerOrder" && t1Row.status === REP_CUSTOMER_ORDER_STATUSES.COMPLETED && t1Row.saleOrderStatus === ORDER_STATUSES.DELIVERED && t1Row.saleOrderNumber === order1, "the completed template carries its sale (number + real status)");
    const adHoc = full.find((row) => row.kind === "sale" && row.orderNumber === order2);
    assert(adHoc && adHoc.kind === "sale" && adHoc.orderStatus === ORDER_STATUSES.DELIVERED, "today's ad-hoc sale is listed with its status");
    assert(!full.some((row) => row.kind === "sale" && row.orderNumber === orderB), "another rep's sale is never in this rep's list");
  });

  await check("2. wiring: the page loads every order; the card has NO cancel/return control and no show-all toggle; loader stays read-only", async () => {
    const page = codeOnly(read("../src/app/admin/reps/[id]/page.tsx"));
    assert(/requireRole\(\[ROLES\.ADMIN\]\)/.test(page) && page.includes("getRepCustomerEngagementRows(rep.id, 10, { all: true })"), "ADMIN-only page, every order loaded");
    const card = codeOnly(read("../src/components/reps/RepCustomerOrdersCard.tsx"));
    assert(!card.includes("إلغاء وإرجاع للسيارة") && !card.includes("correctRepOrderSale") && !card.includes("CorrectionDialog") && !card.includes("orders=all"), "no sale cancel/return control, no toggle");
    assert(card.includes("REP_CUSTOMER_ORDER_STATUSES.OPEN && <CancelOrderButton"), "the pre-existing OPEN-template cancel is untouched");
    const actions = codeOnly(read("../src/app/admin/reps/actions.ts"));
    assert(!actions.includes("correctRepOrderSale"), "no new correction action");
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
