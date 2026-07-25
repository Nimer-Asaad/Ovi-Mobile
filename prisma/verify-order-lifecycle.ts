/**
 * Destructive verification harness for Phase 19A order lifecycle integrity.
 * It is intentionally locked to a localhost database whose name contains
 * "verify" and requires ORDER_LIFECYCLE_VERIFY_DATABASE_URL explicitly.
 */

const verificationUrl = process.env.ORDER_LIFECYCLE_VERIFY_DATABASE_URL;
if (!verificationUrl) {
  throw new Error("Set ORDER_LIFECYCLE_VERIFY_DATABASE_URL to a disposable localhost PostgreSQL database");
}

const parsedUrl = new URL(verificationUrl);
if (!["localhost", "127.0.0.1", "::1"].includes(parsedUrl.hostname) || !parsedUrl.pathname.toLowerCase().includes("verify")) {
  throw new Error("Verification is restricted to a localhost database whose name contains 'verify'");
}

process.env.DATABASE_URL = verificationUrl;
process.env.DIRECT_URL = verificationUrl;

async function main() {
const [{ PrismaClient }, constants, lifecycle] = await Promise.all([
  import("@prisma/client"),
  import("../src/lib/constants"),
  import("../src/lib/order-lifecycle"),
]);

const prisma = new PrismaClient();
const { ORDER_SOURCES, ORDER_STATUSES, ROLES, STOCK_LOCATION_TYPES, STOCK_MOVEMENT_TYPES } = constants;
const { transitionOrderStatus } = lifecycle;
const runId = `verify-${Date.now()}`;

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

const admin = await prisma.user.create({
  data: { role: ROLES.ADMIN, name: `${runId}-admin`, email: `${runId}-admin@example.invalid`, isActive: true },
});
const repUser = await prisma.user.create({
  data: { role: ROLES.SALES_REPRESENTATIVE, name: `${runId}-rep`, email: `${runId}-rep@example.invalid`, isActive: true },
});
const rep = await prisma.salesRepresentative.create({
  data: { userId: repUser.id, employeeCode: `${runId}-rep` },
});
const warehouse = await prisma.stockLocation.create({
  data: { type: STOCK_LOCATION_TYPES.WAREHOUSE, name: `${runId}-warehouse`, isDefault: true },
});
const repCar = await prisma.stockLocation.create({
  data: { type: STOCK_LOCATION_TYPES.REP_CAR, name: `${runId}-car`, salesRepId: rep.id },
});

let sequence = 0;
const touchedPairs = new Set<string>();

async function createProduct(locationId: string, initialQuantity = 100) {
  sequence += 1;
  const product = await prisma.product.create({
    data: {
      sku: `${runId}-${sequence}`,
      name: `${runId}-product-${sequence}`,
      retailPriceCents: 1000,
      wholesalePriceCents: 800,
      isActive: true,
    },
  });
  await prisma.inventoryItem.create({ data: { productId: product.id, locationId, quantity: initialQuantity } });
  await prisma.stockMovement.create({
    data: {
      type: STOCK_MOVEMENT_TYPES.STOCK_IN,
      productId: product.id,
      toLocationId: locationId,
      quantity: initialQuantity,
      previousQuantity: 0,
      newQuantity: initialQuantity,
      note: `${runId} fixture opening balance`,
      createdById: admin.id,
    },
  });
  touchedPairs.add(`${product.id}:${locationId}`);
  return product;
}

async function createOrder(input: {
  source: string;
  status: string;
  locationId: string;
  lines: Array<{ productId: string; quantity: number }>;
}) {
  sequence += 1;
  const orderNumber = `${runId}-order-${sequence}`;
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.create({
      data: {
        orderNumber,
        source: input.source,
        status: input.status,
        stockLocationId: input.locationId,
        createdByRepId: input.source === ORDER_SOURCES.REP_SALE ? rep.id : null,
        subtotalCents: input.lines.reduce((sum, line) => sum + line.quantity * 1000, 0),
        totalCents: input.lines.reduce((sum, line) => sum + line.quantity * 1000, 0),
        items: {
          create: input.lines.map((line) => ({
            productId: line.productId,
            quantity: line.quantity,
            unitPriceCents: 1000,
            totalCents: line.quantity * 1000,
          })),
        },
      },
    });
    for (const line of input.lines) {
      const changed = await tx.inventoryItem.updateMany({
        where: { productId: line.productId, locationId: input.locationId, quantity: { gte: line.quantity } },
        data: { quantity: { decrement: line.quantity } },
      });
      assert(changed.count === 1, "fixture stock decrement failed");
      const inventory = await tx.inventoryItem.findUniqueOrThrow({
        where: { productId_locationId: { productId: line.productId, locationId: input.locationId } },
      });
      await tx.stockMovement.create({
        data: {
          type: STOCK_MOVEMENT_TYPES.SALE_OUT,
          productId: line.productId,
          fromLocationId: input.locationId,
          quantity: line.quantity,
          previousQuantity: inventory.quantity + line.quantity,
          newQuantity: inventory.quantity,
          note: `${runId} ${orderNumber}`,
          createdById: admin.id,
        },
      });
    }
    return order;
  });
}

async function counts(orderId: string) {
  const [history, compensation, order] = await Promise.all([
    prisma.orderStatusHistory.count({ where: { orderId } }),
    prisma.orderInventoryCompensation.count({ where: { orderId } }),
    prisma.order.findUniqueOrThrow({ where: { id: orderId }, select: { status: true, inventoryRestoredAt: true } }),
  ]);
  return { history, compensation, order };
}

try {
  await check("single cancellation and idempotent repeat", async () => {
    const product = await createProduct(warehouse.id);
    const order = await createOrder({ source: ORDER_SOURCES.RETAIL, status: ORDER_STATUSES.PENDING, locationId: warehouse.id, lines: [{ productId: product.id, quantity: 2 }] });
    const first = await transitionOrderStatus({ orderNumber: order.orderNumber, requestedStatus: ORDER_STATUSES.CANCELLED, reason: "verification cancellation", actorUserId: admin.id });
    assert(first.ok && !first.noOp, "first cancellation must apply");
    const inventory = await prisma.inventoryItem.findUniqueOrThrow({ where: { productId_locationId: { productId: product.id, locationId: warehouse.id } } });
    const afterFirst = await counts(order.id);
    assert(inventory.quantity === 100 && afterFirst.history === 1 && afterFirst.compensation === 1 && afterFirst.order.inventoryRestoredAt, "single cancellation invariant failed");
    const second = await transitionOrderStatus({ orderNumber: order.orderNumber, requestedStatus: ORDER_STATUSES.CANCELLED, actorUserId: admin.id });
    const afterSecond = await counts(order.id);
    assert(second.ok && second.noOp && afterSecond.history === 1 && afterSecond.compensation === 1, "repeat cancellation was not idempotent");
  });

  await check("concurrent cancellation restores exactly once", async () => {
    const product = await createProduct(warehouse.id);
    const order = await createOrder({ source: ORDER_SOURCES.WHOLESALE, status: ORDER_STATUSES.PENDING, locationId: warehouse.id, lines: [{ productId: product.id, quantity: 3 }] });
    const results = await Promise.all([
      transitionOrderStatus({ orderNumber: order.orderNumber, requestedStatus: ORDER_STATUSES.CANCELLED, reason: "concurrent cancellation A", actorUserId: admin.id }),
      transitionOrderStatus({ orderNumber: order.orderNumber, requestedStatus: ORDER_STATUSES.CANCELLED, reason: "concurrent cancellation B", actorUserId: admin.id }),
    ]);
    const inventory = await prisma.inventoryItem.findUniqueOrThrow({ where: { productId_locationId: { productId: product.id, locationId: warehouse.id } } });
    const state = await counts(order.id);
    assert(results.every((result) => result.ok) && inventory.quantity === 100 && state.history === 1 && state.compensation === 1, "concurrent cancellation duplicated effects");
  });

  await check("conflicting concurrent transitions remain consistent", async () => {
    const product = await createProduct(warehouse.id);
    const order = await createOrder({ source: ORDER_SOURCES.RETAIL, status: ORDER_STATUSES.PENDING, locationId: warehouse.id, lines: [{ productId: product.id, quantity: 1 }] });
    const results = await Promise.all([
      transitionOrderStatus({ orderNumber: order.orderNumber, requestedStatus: ORDER_STATUSES.CANCELLED, reason: "conflicting cancellation", actorUserId: admin.id }),
      transitionOrderStatus({ orderNumber: order.orderNumber, requestedStatus: ORDER_STATUSES.CONFIRMED, actorUserId: admin.id }),
    ]);
    const final = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, select: { status: true } });
    assert(results.filter((result) => result.ok).length === 1, "conflicting transitions both applied or both failed");
    assert([ORDER_STATUSES.CANCELLED, ORDER_STATUSES.CONFIRMED].includes(final.status as never), "invalid final status");
  });

  await check("representative return targets car stock", async () => {
    const product = await createProduct(repCar.id);
    const order = await createOrder({ source: ORDER_SOURCES.REP_SALE, status: ORDER_STATUSES.DELIVERED, locationId: repCar.id, lines: [{ productId: product.id, quantity: 4 }] });
    const result = await transitionOrderStatus({ orderNumber: order.orderNumber, requestedStatus: ORDER_STATUSES.RETURNED, reason: "verification return", actorUserId: admin.id });
    const carInventory = await prisma.inventoryItem.findUniqueOrThrow({ where: { productId_locationId: { productId: product.id, locationId: repCar.id } } });
    const warehouseInventory = await prisma.inventoryItem.findUnique({ where: { productId_locationId: { productId: product.id, locationId: warehouse.id } } });
    assert(result.ok && carInventory.quantity === 100 && warehouseInventory === null, "representative return used wrong location");
    for (const status of Object.values(ORDER_STATUSES).filter((status) => status !== ORDER_STATUSES.RETURNED)) {
      const rejected = await transitionOrderStatus({ orderNumber: order.orderNumber, requestedStatus: status, actorUserId: admin.id });
      assert(!rejected.ok && rejected.code === "INVALID_TRANSITION", `RETURNED accepted ${status}`);
    }
  });

  await check("multi-item missing inventory rolls back atomically", async () => {
    const first = await createProduct(warehouse.id);
    const second = await createProduct(warehouse.id);
    const order = await createOrder({ source: ORDER_SOURCES.ADMIN_MANUAL, status: ORDER_STATUSES.CONFIRMED, locationId: warehouse.id, lines: [{ productId: first.id, quantity: 2 }, { productId: second.id, quantity: 3 }] });
    await prisma.inventoryItem.delete({ where: { productId_locationId: { productId: second.id, locationId: warehouse.id } } });
    const before = await prisma.inventoryItem.findUniqueOrThrow({ where: { productId_locationId: { productId: first.id, locationId: warehouse.id } } });
    const result = await transitionOrderStatus({ orderNumber: order.orderNumber, requestedStatus: ORDER_STATUSES.CANCELLED, reason: "missing inventory fixture", actorUserId: admin.id });
    const after = await prisma.inventoryItem.findUniqueOrThrow({ where: { productId_locationId: { productId: first.id, locationId: warehouse.id } } });
    const state = await counts(order.id);
    assert(!result.ok && result.code === "MISSING_INVENTORY" && before.quantity === after.quantity && state.history === 0 && state.compensation === 0, "multi-item rollback was partial");
  });

  await check("legacy orders fail closed only for stock transitions", async () => {
    const product = await createProduct(warehouse.id);
    const order = await createOrder({ source: ORDER_SOURCES.RETAIL, status: ORDER_STATUSES.PENDING, locationId: warehouse.id, lines: [{ productId: product.id, quantity: 1 }] });
    await prisma.order.update({ where: { id: order.id }, data: { stockLocationId: null } });
    const cancelled = await transitionOrderStatus({ orderNumber: order.orderNumber, requestedStatus: ORDER_STATUSES.CANCELLED, reason: "legacy cancellation", actorUserId: admin.id });
    assert(!cancelled.ok && cancelled.code === "MISSING_STOCK_PROVENANCE", "legacy cancellation did not fail closed");
    const confirmed = await transitionOrderStatus({ orderNumber: order.orderNumber, requestedStatus: ORDER_STATUSES.CONFIRMED, actorUserId: admin.id });
    const preparing = await transitionOrderStatus({ orderNumber: order.orderNumber, requestedStatus: ORDER_STATUSES.PREPARING, actorUserId: admin.id });
    assert(confirmed.ok && preparing.ok, "ordinary legacy transitions failed");
  });

  await check("ledger reconciles for intact fixture pairs", async () => {
    for (const pair of touchedPairs) {
      const [productId, locationId] = pair.split(":") as [string, string];
      const inventory = await prisma.inventoryItem.findUnique({ where: { productId_locationId: { productId, locationId } } });
      if (!inventory) continue;
      const movements = await prisma.stockMovement.findMany({
        where: { productId, OR: [{ fromLocationId: locationId }, { toLocationId: locationId }], note: { contains: runId } },
        select: { type: true, quantity: true, fromLocationId: true, toLocationId: true },
      });
      const derived = movements.reduce((sum, movement) => {
        if (movement.toLocationId === locationId) sum += movement.quantity;
        if (movement.fromLocationId === locationId) sum -= movement.quantity;
        return sum;
      }, 0);
      assert(derived === inventory.quantity, `ledger mismatch for ${productId}/${locationId}: ${derived} != ${inventory.quantity}`);
    }
  });
} finally {
  await prisma.stockMovement.deleteMany({ where: { note: { contains: runId } } });
  await prisma.order.deleteMany({ where: { orderNumber: { startsWith: runId } } });
  await prisma.inventoryItem.deleteMany({ where: { product: { sku: { startsWith: runId } } } });
  await prisma.product.deleteMany({ where: { sku: { startsWith: runId } } });
  await prisma.stockLocation.deleteMany({ where: { name: { startsWith: runId } } });
  await prisma.salesRepresentative.deleteMany({ where: { employeeCode: { startsWith: runId } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: runId } } });
  await prisma.$disconnect();
}

console.log("All order lifecycle verification checks passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
