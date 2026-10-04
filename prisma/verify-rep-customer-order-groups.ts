/**
 * Real-database verification for the grouped "طلبات الزبائن" panel on the REP
 * direct-sale page (src/lib/rep-customer-order-groups.ts, the loader
 * getOpenCustomerOrdersForRep, NewSaleForm and createRepSaleCore).
 *
 * Rules under test: one card per REAL customer (same merchantId — never the
 * display name); only OPEN orders are grouped; identical lines are summed on
 * the full line identity; clicking a card imports every included order; the
 * sale completes ALL source orders in its own transaction or none; stock
 * changes only through the sale transaction.
 *
 * Safety rails via resolveVerifyDatabaseUrl (prisma/verify-guardrails.ts):
 * never runs against a shared/production database.
 *
 * Run with: node --conditions=react-server --import tsx prisma/verify-rep-customer-order-groups.ts
 * REP_CUSTOMER_ORDER_GROUPS_VERIFY_DATABASE_URL must point at a disposable
 * localhost PostgreSQL database whose name contains "verify".
 */

export {};

import { resolveVerifyDatabaseUrl } from "./verify-guardrails";

const resolved = resolveVerifyDatabaseUrl("REP_CUSTOMER_ORDER_GROUPS_VERIFY_DATABASE_URL");
console.log(`[verify-rep-customer-order-groups] target: ${resolved.masked}`);

process.env.DATABASE_URL = resolved.url;
process.env.DIRECT_URL = resolved.url;

async function main() {
  const fs = await import("node:fs");
  const [{ PrismaClient }, constants, groupsLib, ordersLib, repSales] = await Promise.all([
    import("@prisma/client"),
    import("../src/lib/constants"),
    import("../src/lib/rep-customer-order-groups"),
    import("../src/lib/rep-customer-orders"),
    import("../src/lib/rep-sales"),
  ]);
  const prisma = new PrismaClient();
  const { ROLES, STOCK_LOCATION_TYPES, REP_CUSTOMER_ORDER_STATUSES, ACCOUNT_PAYMENT_METHODS } = constants;
  const { groupCustomerOrders, requestedQuantityByProduct, aggregateCustomerOrderLines, customerLineKey, normalizeSourceOrderIds, parseSourceOrderIdsField } = groupsLib;
  const { getOpenCustomerOrdersForRep } = ordersLib;
  const { createRepSaleCore } = repSales;
  const runId = `verify-grp-${Date.now()}`;

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

  // ---------- fixtures ----------
  const repUser = await prisma.user.create({ data: { role: ROLES.SALES_REPRESENTATIVE, name: `${runId}-rep`, email: `${runId}-rep@example.invalid`, isActive: true } });
  const rep = await prisma.salesRepresentative.create({ data: { userId: repUser.id, employeeCode: `${runId}-rep` } });
  const otherUser = await prisma.user.create({ data: { role: ROLES.SALES_REPRESENTATIVE, name: `${runId}-rep2`, email: `${runId}-rep2@example.invalid`, isActive: true } });
  const otherRep = await prisma.salesRepresentative.create({ data: { userId: otherUser.id, employeeCode: `${runId}-rep2` } });
  const warehouse = await prisma.stockLocation.create({ data: { type: STOCK_LOCATION_TYPES.WAREHOUSE, name: `${runId}-wh`, isDefault: false } });
  const car = await prisma.stockLocation.create({ data: { type: STOCK_LOCATION_TYPES.REP_CAR, name: `${runId}-car`, salesRepId: rep.id } });
  const otherCar = await prisma.stockLocation.create({ data: { type: STOCK_LOCATION_TYPES.REP_CAR, name: `${runId}-car2`, salesRepId: otherRep.id } });

  const PRODUCTS = 40;
  const products: { id: string }[] = [];
  for (let i = 1; i <= PRODUCTS; i++) {
    const product = await prisma.product.create({ data: { sku: `${runId}-P${String(i).padStart(2, "0")}`, name: `${runId}-P${i}`, retailPriceCents: 1000, wholesalePriceCents: 800, isActive: true } });
    products.push(product);
    await prisma.inventoryItem.create({ data: { productId: product.id, locationId: car.id, quantity: 500 } });
  }
  const P = (n: number) => products[n - 1]!.id;

  const DISPLAY_NAME = "معاذ بشير";
  async function merchant(label: string, assignedRepId: string = rep.id) {
    return prisma.merchant.create({ data: { businessName: DISPLAY_NAME, contactPhone: `${runId}-${label}`, assignedRepId, status: "APPROVED" } });
  }
  const merchantA = await merchant("A"); // the customer with 3 pending orders
  const merchantB = await merchant("B"); // DIFFERENT customer, SAME display name
  const merchantC = await merchant("C"); // 1 completed + 2 pending (+ 1 cancelled)
  const merchantE = await merchant("E"); // failure / rollback customer
  const merchantF = await merchant("F"); // partial-quantity customer
  const merchantG = await merchant("G"); // legacy single-order field

  const base = Date.now() - 3_600_000;
  async function customerOrder(args: { merchantId: string | null; salesRepId?: string; status?: string; minutes: number; lines: [number, number][] }) {
    const salesRepId = args.salesRepId ?? rep.id;
    const batch = await prisma.repStockTransferBatch.create({
      data: { type: "REP_ASSIGNMENT", salesRepId, fromLocationId: warehouse.id, toLocationId: salesRepId === rep.id ? car.id : otherCar.id, loadType: "CUSTOMER_ORDER" },
    });
    return prisma.repCustomerOrder.create({
      data: {
        salesRepId,
        customerName: DISPLAY_NAME,
        merchantId: args.merchantId,
        status: args.status ?? REP_CUSTOMER_ORDER_STATUSES.OPEN,
        transferBatchId: batch.id,
        createdAt: new Date(base + args.minutes * 60_000),
        items: { create: args.lines.map(([product, quantity]) => ({ productId: P(product), quantity })) },
      },
      select: { id: true, createdAt: true },
    });
  }
  const range = (from: number, to: number, quantity: (index: number) => number): [number, number][] =>
    Array.from({ length: to - from + 1 }, (_, i) => [from + i, quantity(i)] as [number, number]);

  // Customer A — the real scenario: 12 lines / 67 pieces, 13 / 17, 13 / 22 = 38 lines / 106 pieces,
  // with duplicate lines across orders (P9-P12 in orders 1+2, P20-P21 in orders 2+3).
  const a1 = await customerOrder({ merchantId: merchantA.id, minutes: 1, lines: [...range(1, 11, () => 5), [12, 12]] });
  const a2 = await customerOrder({ merchantId: merchantA.id, minutes: 2, lines: [...range(9, 17, () => 1), ...range(18, 21, () => 2)] });
  const a3 = await customerOrder({ merchantId: merchantA.id, minutes: 3, lines: [...range(20, 28, () => 2), ...range(29, 32, () => 1)] });
  // Customer B — same display name, different merchant
  const b1 = await customerOrder({ merchantId: merchantB.id, minutes: 4, lines: [[33, 3]] });
  // a legacy order with NO merchant link, also the same display name
  const legacy = await customerOrder({ merchantId: null, minutes: 5, lines: [[34, 2]] });
  // Customer C — completed + cancelled + two pending
  const c1 = await customerOrder({ merchantId: merchantC.id, status: REP_CUSTOMER_ORDER_STATUSES.COMPLETED, minutes: 6, lines: [[35, 4]] });
  await customerOrder({ merchantId: merchantC.id, status: REP_CUSTOMER_ORDER_STATUSES.CANCELLED, minutes: 7, lines: [[35, 4]] });
  const c3 = await customerOrder({ merchantId: merchantC.id, minutes: 8, lines: [[35, 2], [36, 3]] });
  const c4 = await customerOrder({ merchantId: merchantC.id, minutes: 9, lines: [[35, 1], [37, 5]] });
  // Customer E — three orders for the failure / rollback checks
  const e1 = await customerOrder({ merchantId: merchantE.id, minutes: 10, lines: [[1, 2]] });
  const e2 = await customerOrder({ merchantId: merchantE.id, minutes: 11, lines: [[2, 2]] });
  const e3 = await customerOrder({ merchantId: merchantE.id, minutes: 12, lines: [[3, 2]] });
  // Customer F — partial quantities
  const f1 = await customerOrder({ merchantId: merchantF.id, minutes: 13, lines: [[4, 10]] });
  const f2 = await customerOrder({ merchantId: merchantF.id, minutes: 14, lines: [[5, 10]] });
  // Customer G — the legacy single-order submission field
  const g1 = await customerOrder({ merchantId: merchantG.id, minutes: 15, lines: [[6, 3]] });
  // another rep's order (never reachable from this rep)
  const merchantOther = await merchant("OTHER", otherRep.id);
  const foreign = await customerOrder({ merchantId: merchantOther.id, salesRepId: otherRep.id, minutes: 16, lines: [[7, 1]] });

  async function carStock(): Promise<Map<string, number>> {
    const rows = await prisma.inventoryItem.findMany({ where: { locationId: car.id, product: { sku: { startsWith: runId } } }, select: { productId: true, quantity: true } });
    return new Map(rows.map((row) => [row.productId, row.quantity]));
  }
  async function orderStatuses(ids: string[]) {
    const rows = await prisma.repCustomerOrder.findMany({ where: { id: { in: ids } }, select: { id: true, status: true, completedAt: true, saleOrder: { select: { orderNumber: true } } } });
    return new Map(rows.map((row) => [row.id, row]));
  }
  async function repSaleCount() {
    return prisma.order.count({ where: { createdByRepId: rep.id } });
  }

  /** createRepSaleCore calls revalidatePath as its very last step, after the
   * transaction has committed; outside a Next request that throws the known
   * "static generation store missing" invariant — everything below verifies
   * outcomes by re-reading real rows, never by trusting this translation. */
  async function sell(args: { merchantLabel: string; items: [number, number][]; sourceIds?: string[]; legacyId?: string | null; paidNowCents?: number; salesRepId?: string }) {
    try {
      return await createRepSaleCore(
        {
          items: args.items.map(([product, quantity]) => ({ productId: P(product), colorId: null, variantId: null, deviceColorVariantId: null, quantity, unitPriceCents: 1000, bonusQuantity: 0 })),
          customerName: DISPLAY_NAME,
          customerPhone: `${runId}-${args.merchantLabel}`,
          city: undefined,
          address: undefined,
          notes: undefined,
          repCustomerOrderId: args.legacyId ?? null,
          repCustomerOrderIds: args.sourceIds,
          discountCents: 0,
          paidNowCents: args.paidNowCents ?? 0,
          paidNowMethod: ACCOUNT_PAYMENT_METHODS.CASH,
        },
        { salesRepId: args.salesRepId ?? rep.id, carStockLocationId: car.id, actorUserId: repUser.id },
      );
    } catch (error) {
      if (error instanceof Error && error.message.includes("static generation store missing")) return { ok: true as const, orderNumber: "" };
      throw error;
    }
  }

  try {
    await check("1. ONE card for a customer with 3 pending orders: 3 orders, 106 pieces, de-duplicated lines, every source id kept", async () => {
      const open = await getOpenCustomerOrdersForRep(rep.id);
      const groups = groupCustomerOrders(open);
      const groupA = groups.find((group) => group.merchantId === merchantA.id);
      assert(groupA, "customer A has a card");
      assert(groups.filter((group) => group.merchantId === merchantA.id).length === 1, "exactly ONE card for customer A");
      assert(groupA.orderCount === 3, `orderCount 3, got ${groupA.orderCount}`);
      assert(groupA.totalQuantity === 106, `106 pieces (67 + 17 + 22), got ${groupA.totalQuantity}`);
      const rawLines = a1.id && open.filter((order) => [a1.id, a2.id, a3.id].includes(order.id)).reduce((sum, order) => sum + order.items.length, 0);
      assert(rawLines === 38, `38 raw lines across the three orders (12 + 13 + 13), got ${rawLines}`);
      assert(groupA.itemCount === 32 && groupA.lines.length === 32, `32 DISTINCT lines (38 minus 6 exact duplicates), got ${groupA.itemCount}`);
      assert(JSON.stringify([...groupA.orderIds].sort()) === JSON.stringify([a1.id, a2.id, a3.id].sort()), "all three source order ids are kept");
      assert(groupA.orderIds[0] === a3.id && groupA.createdAt.toString() === a3.createdAt.toString(), "ordered/dated by the NEWEST included order (the panel's newest-first order is preserved)");
      const byProduct = new Map(groupA.lines.map((line) => [line.productId, line]));
      assert(byProduct.get(P(9))!.quantity === 5 + 1 && byProduct.get(P(12))!.quantity === 12 + 1, "duplicate lines across orders 1+2 are summed (P9 5+1, P12 12+1)");
      assert(byProduct.get(P(20))!.quantity === 2 + 2 && byProduct.get(P(21))!.quantity === 2 + 2, "duplicate lines across orders 2+3 are summed (P20, P21)");
      assert(JSON.stringify([...byProduct.get(P(9))!.sourceOrderIds].sort()) === JSON.stringify([a1.id, a2.id].sort()), "each merged line remembers which orders it came from");
      assert(byProduct.get(P(1))!.quantity === 5 && byProduct.get(P(1))!.sourceOrderIds.length === 1, "non-duplicate lines are untouched");
      // clicking the card imports every line of every order (product-level draft, as before)
      const draft = requestedQuantityByProduct(groupA.lines);
      assert(draft.size === 32 && [...draft.values()].reduce((sum, quantity) => sum + quantity, 0) === 106, "the draft receives all 32 products / 106 pieces from all 3 orders");
    });

    await check("2. two DIFFERENT customers with the same display name stay two cards; a legacy unlinked order never merges", async () => {
      const groups = groupCustomerOrders(await getOpenCustomerOrdersForRep(rep.id));
      const named = groups.filter((group) => group.customerName === DISPLAY_NAME);
      assert(named.length >= 4, `several cards carry the same display name, got ${named.length}`);
      assert(groups.filter((group) => group.merchantId === merchantB.id).length === 1 && groups.find((group) => group.merchantId === merchantB.id)!.orderCount === 1, "customer B (same name, different merchant) is its own single-order card");
      assert(groups.find((group) => group.merchantId === merchantB.id)!.orderIds[0] === b1.id, "B's card holds only B's order");
      const legacyCard = groups.find((group) => group.orderIds.includes(legacy.id));
      assert(legacyCard && legacyCard.merchantId === null && legacyCard.orderCount === 1 && legacyCard.key === `order:${legacy.id}`, "an order with no merchantId is never grouped (no proof of identity)");
      assert(!groups.find((group) => group.merchantId === merchantA.id)!.orderIds.includes(b1.id), "A's card never contains B's order");
      const source = fs.readFileSync(new URL("../src/lib/rep-customer-order-groups.ts", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      const keyLine = source.split("\n").find((line) => line.includes("const key = order.merchantId")) ?? "";
      assert(keyLine.includes("`merchant:${order.merchantId}`") && keyLine.includes("`order:${order.id}`") && !/customerName|merchantName/.test(keyLine), "the group key is built from merchantId (or the order id), never the name");
    });

    await check("3. only currently eligible orders are grouped: 1 completed + 1 cancelled + 2 pending -> a group of the 2 pending", async () => {
      const open = await getOpenCustomerOrdersForRep(rep.id);
      assert(!open.some((order) => order.id === c1.id), "the completed order is not even loaded");
      const groupC = groupCustomerOrders(open).find((group) => group.merchantId === merchantC.id);
      assert(groupC && groupC.orderCount === 2 && JSON.stringify([...groupC.orderIds].sort()) === JSON.stringify([c3.id, c4.id].sort()), "only the two pending orders are grouped");
      assert(groupC.totalQuantity === 2 + 3 + 1 + 5 && groupC.itemCount === 3, "P35 (2+1) is summed; 3 distinct lines (P35, P36, P37)");
    });

    await check("4-5. full line identity: a different compatibility model or color combination is a SEPARATE line; an exact duplicate sums", async () => {
      const lines = (items: { p: string; v?: string; d?: string; q: number }[]) => items.map((item) => ({ productId: item.p, variantId: item.v ?? null, deviceColorVariantId: item.d ?? null, quantity: item.q }));
      const order = (id: string, items: { p: string; v?: string; d?: string; q: number }[]) => ({ id, customerName: "x", merchantId: "m", createdAt: new Date(), items: lines(items) });
      const aggregated = aggregateCustomerOrderLines([
        order("o1", [{ p: "case", v: "iphone11", q: 5 }, { p: "case", v: "iphone12", q: 2 }, { p: "glass", d: "black", q: 1 }]),
        order("o2", [{ p: "case", v: "iphone11", q: 3 }, { p: "glass", d: "blue", q: 4 }, { p: "glass", d: "black", q: 6 }]),
      ]);
      const quantity = (key: string) => aggregated.find((line) => customerLineKey(line) === key)?.quantity;
      assert(aggregated.length === 4, `4 distinct lines, got ${aggregated.length}`);
      assert(quantity("case:iphone11:") === 8, "exact duplicate (same product + same model) sums 5 + 3");
      assert(quantity("case:iphone12:") === 2, "same product, different compatibility model stays separate");
      assert(quantity("glass::black") === 7 && quantity("glass::blue") === 4, "same product, different color combination stays separate; identical color sums");
      // the sale DRAFT is product-level (a rep sale never chooses a model — REP_CAR keeps one balance per
      // product), exactly as handleSelectOrder always folded a single order:
      const draft = requestedQuantityByProduct(aggregated);
      assert(draft.get("case") === 10 && draft.get("glass") === 11, "the draft folds per product, unchanged from the single-order behaviour");
    });

    await check("6. selecting a card changes NO stock; the grouped sale then completes ALL source orders and decrements stock once", async () => {
      const before = await carStock();
      const groupA = groupCustomerOrders(await getOpenCustomerOrdersForRep(rep.id)).find((group) => group.merchantId === merchantA.id)!;
      const draft = requestedQuantityByProduct(groupA.lines);
      assert(JSON.stringify([...(await carStock())]) === JSON.stringify([...before]), "building the card + draft wrote nothing (stock untouched)");
      const items = [...draft].map(([productId, quantity]) => [products.findIndex((product) => product.id === productId) + 1, quantity] as [number, number]);
      const salesBefore = await repSaleCount();
      const result = await sell({ merchantLabel: "A", items, sourceIds: groupA.orderIds });
      assert(result.ok, `grouped sale accepted: ${!result.ok && result.error}`);
      assert((await repSaleCount()) === salesBefore + 1, "exactly ONE sale was created for the whole group");
      const statuses = await orderStatuses([a1.id, a2.id, a3.id]);
      assert([a1.id, a2.id, a3.id].every((id) => statuses.get(id)!.status === REP_CUSTOMER_ORDER_STATUSES.COMPLETED), "all three source orders are COMPLETED");
      const completedAt = new Set([a1.id, a2.id, a3.id].map((id) => statuses.get(id)!.completedAt!.getTime()));
      assert(completedAt.size === 1, "all three share one completedAt instant (traceable siblings)");
      const sale = await prisma.order.findFirst({ where: { createdByRepId: rep.id, repCustomerOrderId: a1.id }, select: { orderNumber: true, repCustomerOrderId: true, merchantId: true, items: { select: { quantity: true } } } });
      assert(sale && sale.repCustomerOrderId === a1.id, "the sale is linked to the OLDEST source order (Order.repCustomerOrderId is a single unique link)");
      assert(sale.merchantId === merchantA.id && sale.items.length === 32 && sale.items.reduce((sum, item) => sum + item.quantity, 0) === 106, "the sale belongs to customer A with 32 lines / 106 pieces");
      assert(statuses.get(a1.id)!.saleOrder?.orderNumber === sale.orderNumber && statuses.get(a2.id)!.saleOrder === null && statuses.get(a3.id)!.saleOrder === null, "only the primary carries the link; siblings are identified by the shared completedAt");
      const after = await carStock();
      for (const [productId, quantity] of draft) assert(after.get(productId) === 500 - quantity, `stock decremented exactly once for ${productId}`);
      assert(after.get(P(40)) === 500, "an uninvolved product is untouched");
      const gone = groupCustomerOrders(await getOpenCustomerOrdersForRep(rep.id)).find((group) => group.merchantId === merchantA.id);
      assert(!gone, "customer A's card disappears once the sale is done");
    });

    await check("7. a failed grouped sale completes NOTHING: late failure rolls the whole transaction back; a stale order rejects before anything is touched", async () => {
      const before = await carStock();
      const salesBefore = await repSaleCount();
      // (a) failure INSIDE the transaction, after the source orders were flipped: payment above the balance
      const failed = await sell({ merchantLabel: "E", items: [[1, 2], [2, 2], [3, 2]], sourceIds: [e1.id, e2.id, e3.id], paidNowCents: 99_999_999 });
      assert(!failed.ok, "the over-payment is rejected");
      let statuses = await orderStatuses([e1.id, e2.id, e3.id]);
      assert([e1.id, e2.id, e3.id].every((id) => statuses.get(id)!.status === REP_CUSTOMER_ORDER_STATUSES.OPEN && statuses.get(id)!.completedAt === null), "all three source orders are still OPEN (no partial completion)");
      assert((await repSaleCount()) === salesBefore, "no order was created");
      assert(JSON.stringify([...(await carStock())]) === JSON.stringify([...before]), "no stock was decremented");
      // (b) one source is cancelled meanwhile -> the whole grouped sale is refused
      await prisma.repCustomerOrder.update({ where: { id: e3.id }, data: { status: REP_CUSTOMER_ORDER_STATUSES.CANCELLED, cancelledAt: new Date() } });
      const stale = await sell({ merchantLabel: "E", items: [[1, 2], [2, 2], [3, 2]], sourceIds: [e1.id, e2.id, e3.id] });
      assert(!stale.ok, "a source that is no longer OPEN rejects the whole sale");
      statuses = await orderStatuses([e1.id, e2.id]);
      assert([e1.id, e2.id].every((id) => statuses.get(id)!.status === REP_CUSTOMER_ORDER_STATUSES.OPEN), "the other two stay OPEN — never falsely completed");
      assert((await repSaleCount()) === salesBefore && JSON.stringify([...(await carStock())]) === JSON.stringify([...before]), "still no order and no stock change");
    });

    await check("8. a crafted submission cannot sweep other customers' (or another rep's) orders into a sale", async () => {
      const salesBefore = await repSaleCount();
      const before = await carStock();
      const mixed = await sell({ merchantLabel: "B", items: [[33, 1], [1, 1]], sourceIds: [b1.id, e1.id] });
      assert(!mixed.ok && mixed.error.includes("نفس الزبون"), `two different customers are refused, got ${JSON.stringify(mixed)}`);
      const withLegacy = await sell({ merchantLabel: "B", items: [[33, 1], [34, 1]], sourceIds: [b1.id, legacy.id] });
      assert(!withLegacy.ok, "an unlinked (no merchantId) order can never be combined with another");
      const foreignSale = await sell({ merchantLabel: "OTHER", items: [[7, 1]], sourceIds: [foreign.id] });
      assert(!foreignSale.ok, "another rep's order is refused");
      const statuses = await orderStatuses([b1.id, e1.id, legacy.id, foreign.id]);
      assert([b1.id, e1.id, legacy.id, foreign.id].every((id) => statuses.get(id)!.status === REP_CUSTOMER_ORDER_STATUSES.OPEN), "every involved order is still OPEN");
      assert((await repSaleCount()) === salesBefore && JSON.stringify([...(await carStock())]) === JSON.stringify([...before]), "nothing was sold");
    });

    await check("9. partial quantities: the existing rule is kept — a completed template does not depend on the sold quantity", async () => {
      // F1 asked 10 x P4, F2 asked 10 x P5; the rep edits the draft and sells 1 + 1
      const stockBefore = await carStock();
      const result = await sell({ merchantLabel: "F", items: [[4, 1], [5, 1]], sourceIds: [f1.id, f2.id] });
      assert(result.ok, "the edited grouped sale is accepted");
      const statuses = await orderStatuses([f1.id, f2.id]);
      assert([f1.id, f2.id].every((id) => statuses.get(id)!.status === REP_CUSTOMER_ORDER_STATUSES.COMPLETED), "both source orders complete (a customer order is a single-use template, never a running tab)");
      const after = await carStock();
      assert(stockBefore.get(P(4))! - after.get(P(4))! === 1 && stockBefore.get(P(5))! - after.get(P(5))! === 1, "only the 1 + 1 actually sold left the car (not the 10 + 10 requested)");
    });

    await check("10. the legacy single-order submission still works unchanged (one card, one order)", async () => {
      const group = groupCustomerOrders(await getOpenCustomerOrdersForRep(rep.id)).find((candidate) => candidate.merchantId === merchantG.id);
      assert(group && group.orderCount === 1 && group.itemCount === 1 && group.totalQuantity === 3, "single order card: 1 line / 3 pieces");
      const result = await sell({ merchantLabel: "G", items: [[6, 3]], legacyId: g1.id });
      assert(result.ok, "accepted");
      const statuses = await orderStatuses([g1.id]);
      assert(statuses.get(g1.id)!.status === REP_CUSTOMER_ORDER_STATUSES.COMPLETED && statuses.get(g1.id)!.saleOrder !== null, "completed and linked exactly as before");
      assert(JSON.stringify(normalizeSourceOrderIds({ repCustomerOrderId: "x" })) === JSON.stringify(["x"]) && JSON.stringify(normalizeSourceOrderIds({ repCustomerOrderIds: ["a", "b", "a"], repCustomerOrderId: "b" })) === JSON.stringify(["a", "b"]), "ids are de-duplicated");
      assert(parseSourceOrderIdsField(null).length === 0 && parseSourceOrderIdsField("not json").length === 0 && parseSourceOrderIdsField('{"a":1}').length === 0 && JSON.stringify(parseSourceOrderIdsField('["a",1,"b"]')) === JSON.stringify(["a", "b"]), "a malformed field can only ever mean no source");
    });

    await check("11. wiring: the panel renders groups and submits every id; both sale actions read the new field; no schema/migration", async () => {
      const form = fs.readFileSync(new URL("../src/components/reps/NewSaleForm.tsx", import.meta.url), "utf8");
      assert(form.includes("groupCustomerOrders(customerOrders)") && form.includes("orderGroups.map") && form.includes('name="repCustomerOrderIds"') && form.includes("handleSelectGroup"), "NewSaleForm renders one card per group and submits all source ids");
      assert(form.includes("group.orderCount > 1") && form.includes("طلبيات"), "the card shows the order count");
      for (const file of ["../src/app/rep/sales/actions.ts", "../src/app/admin/reps/actions.ts"]) {
        assert(fs.readFileSync(new URL(file, import.meta.url), "utf8").includes('parseSourceOrderIdsField(formData.get("repCustomerOrderIds"))'), `${file} reads repCustomerOrderIds`);
      }
      const core = fs.readFileSync(new URL("../src/lib/rep-sales.ts", import.meta.url), "utf8");
      assert(core.includes("id: { in: sourceOrderIds }, salesRepId, status: REP_CUSTOMER_ORDER_STATUSES.OPEN") && core.includes("transitioned.count !== sourceOrderIds.length"), "the core completes all sources or throws (rollback)");
      const loader = fs.readFileSync(new URL("../src/lib/rep-customer-orders.ts", import.meta.url), "utf8");
      assert(loader.includes("status: REP_CUSTOMER_ORDER_STATUSES.OPEN"), "the existing OPEN-only eligibility filter is reused");
    });

    console.log("ALL PASS");
  } finally {
    await prisma.stockMovement.deleteMany({ where: { product: { sku: { startsWith: runId } } } });
    await prisma.orderItem.deleteMany({ where: { order: { createdByRep: { employeeCode: { startsWith: runId } } } } });
    await prisma.order.deleteMany({ where: { createdByRep: { employeeCode: { startsWith: runId } } } });
    await prisma.customerAccount.deleteMany({ where: { merchant: { assignedRep: { employeeCode: { startsWith: runId } } } } });
    await prisma.repCustomerOrder.deleteMany({ where: { salesRep: { employeeCode: { startsWith: runId } } } });
    await prisma.repStockTransferBatch.deleteMany({ where: { salesRep: { employeeCode: { startsWith: runId } } } });
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
