import "server-only";
import type { Prisma, PrismaClient } from "@prisma/client";
import { STOCK_LOCATION_TYPES } from "@/lib/constants";
import type { ProductPurgeDependencyCounts, ProductPurgeRowSummary, ProductPurgePreview, ProductPurgeResult, EmptyParentCounts } from "@/lib/product-purge-shared";

export { MAX_PURGE_BATCH_SIZE, PURGE_CONFIRMATION_PHRASE, PRODUCT_DEPENDENCY_LABELS, EMPTY_PARENT_LABELS } from "@/lib/product-purge-shared";
export type { ProductPurgeDependencyCounts, ProductPurgeRowSummary, ProductPurgePreview, ProductPurgeResult, EmptyParentCounts } from "@/lib/product-purge-shared";

type Tx = Prisma.TransactionClient;
/** Every read helper below accepts either a plain PrismaClient (for the
 * read-only preview, called outside any transaction) or a TransactionClient
 * (for the same counts re-run inside the actual purge transaction) — both
 * expose the identical delegate shape for `count`/`findMany`/`groupBy`. */
type Client = Tx | PrismaClient;

/** Every table this app's schema has that holds a `productId` foreign key
 * pointing at Product — discovered by reading prisma/schema.prisma's own
 * Product.* relation list (13 relations) and cross-checked against the real
 * hand-authored ON DELETE clauses in the migration SQL (schema.prisma's own
 * relation attributes are documentation only in this repo's convention —
 * see e.g. the InventoryItem unique-index precedent). Confirmed via the
 * migrations:
 *   - product_images.productId            -> products  ON DELETE CASCADE
 *   - product_color_options.productId     -> products  ON DELETE CASCADE
 *   - every other productId FK below      -> products  ON DELETE RESTRICT
 * RESTRICT means Postgres itself would refuse to delete a Product while any
 * of these rows still reference it — this module never relies on that
 * refusal as its safety net (an explicit ordered delete plus an explicit
 * post-delete invariant check below is the real guarantee), but it is
 * exactly why every one of these tables MUST be cleared, by productId,
 * before the Product row itself can be deleted.
 *
 * ProductVariant/DeviceColorVariant are reached the SAME way: every table
 * with a variantId/deviceColorVariantId column also carries the composite
 * FK (variantId, productId) -> product_variants(id, productId) or
 * (deviceColorVariantId, productId) -> device_color_variants(id, productId)
 * — meaning a row can only reference one of THIS product's variants/combos
 * if that row's own productId also equals this product's id. Every delete
 * below is filtered purely by productId, so it clears every
 * variant/combo-referencing row too, with no separate pass needed.
 */
async function countDependencies(client: Client, productIds: string[]): Promise<ProductPurgeDependencyCounts> {
  const where = { productId: { in: productIds } };
  const [
    stockMovements,
    productVariantAllocationBatches,
    repCustomerOrderItems,
    stockReturnItems,
    stockRequestItems,
    cartItems,
    wishlistItems,
    orderItems,
    inventoryItems,
    productColorOptions,
    productImages,
    deviceColorVariants,
    productVariants,
  ] = await Promise.all([
    client.stockMovement.count({ where }),
    client.productVariantAllocationBatch.count({ where }),
    client.repCustomerOrderItem.count({ where }),
    client.stockReturnItem.count({ where }),
    client.stockRequestItem.count({ where }),
    client.cartItem.count({ where }),
    client.wishlistItem.count({ where }),
    client.orderItem.count({ where }),
    client.inventoryItem.count({ where }),
    client.productColorOption.count({ where }),
    client.productImage.count({ where }),
    client.deviceColorVariant.count({ where }),
    client.productVariant.count({ where }),
  ]);
  return {
    stockMovements,
    productVariantAllocationBatches,
    repCustomerOrderItems,
    stockReturnItems,
    stockRequestItems,
    cartItems,
    wishlistItems,
    orderItems,
    inventoryItems,
    productColorOptions,
    productImages,
    deviceColorVariants,
    productVariants,
  };
}

async function getRowSummaries(client: Client, productIds: string[]): Promise<ProductPurgeRowSummary[]> {
  const [products, warehouseSums, repSums] = await Promise.all([
    client.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, sku: true, name: true, nameAr: true, isActive: true },
    }),
    client.inventoryItem.groupBy({
      by: ["productId"],
      where: { productId: { in: productIds }, location: { type: STOCK_LOCATION_TYPES.WAREHOUSE } },
      _sum: { quantity: true },
    }),
    client.inventoryItem.groupBy({
      by: ["productId"],
      where: {
        productId: { in: productIds },
        location: { type: STOCK_LOCATION_TYPES.REP_CAR },
        variantId: null,
        deviceColorVariantId: null,
      },
      _sum: { quantity: true },
    }),
  ]);

  const warehouseByProduct = new Map(warehouseSums.map((row) => [row.productId, row._sum.quantity ?? 0]));
  const repByProduct = new Map(repSums.map((row) => [row.productId, row._sum.quantity ?? 0]));

  return products.map((product) => {
    const warehouseStock = warehouseByProduct.get(product.id) ?? 0;
    const repStock = repByProduct.get(product.id) ?? 0;
    return {
      id: product.id,
      sku: product.sku,
      name: product.name,
      nameAr: product.nameAr,
      isActive: product.isActive,
      warehouseStock,
      repStock,
      companyTotal: warehouseStock + repStock,
    };
  });
}

// ---------------------------------------------------------------------------
// EMPTY-PARENT CLEANUP
//
// Discovered parent models (from schema.prisma's own relations, re-verified
// against the real ON DELETE clauses below): Order, StockRequest,
// StockReturn, RepCustomerOrder, RepStockTransferBatch. No other model in
// the schema both (a) groups multiple products' child rows together and
// (b) has independent identity/status worth checking for emptiness — Cart
// is deliberately excluded: an empty cart is a completely normal, expected,
// permanent per-user state in this app, never a "test artifact" to clean up.
// ---------------------------------------------------------------------------

interface AffectedParentIds {
  orderIds: string[];
  stockRequestIds: string[];
  stockReturnIds: string[];
  repCustomerOrderIds: string[];
  transferBatchIds: string[];
}

/** STEP 1 of the empty-parent cleanup — identifies every parent row that has
 * at least one child referencing a to-be-purged product, BEFORE anything is
 * deleted. Reused for both the read-only preview and the real transaction
 * (the "which parents are touched at all" question never depends on
 * before/after delete state — only "which of them end up empty" does, see
 * findEmptyParents below). */
async function findAffectedParentIds(client: Client, productIds: string[]): Promise<AffectedParentIds> {
  const where = { productId: { in: productIds } };
  const [orderGroups, stockRequestGroups, stockReturnGroups, repCustomerOrderGroups, movementGroups] = await Promise.all([
    client.orderItem.groupBy({ by: ["orderId"], where }),
    client.stockRequestItem.groupBy({ by: ["stockRequestId"], where }),
    client.stockReturnItem.groupBy({ by: ["stockReturnId"], where }),
    client.repCustomerOrderItem.groupBy({ by: ["repCustomerOrderId"], where }),
    client.stockMovement.groupBy({ by: ["transferBatchId"], where: { ...where, transferBatchId: { not: null } } }),
  ]);
  return {
    orderIds: orderGroups.map((row) => row.orderId),
    stockRequestIds: stockRequestGroups.map((row) => row.stockRequestId),
    stockReturnIds: stockReturnGroups.map((row) => row.stockReturnId),
    repCustomerOrderIds: repCustomerOrderGroups.map((row) => row.repCustomerOrderId),
    // transferBatchId is nullable on StockMovement but excluded above via
    // the `not: null` filter, so this cast is safe.
    transferBatchIds: movementGroups.map((row) => row.transferBatchId as string),
  };
}

interface EmptyParentIds {
  orderIds: string[];
  stockRequestIds: string[];
  stockReturnIds: string[];
  repCustomerOrderIds: string[];
  transferBatchIds: string[];
}

/** STEP 3 (recomputed each time it's needed) — of the parents `affected`
 * touches, which ones have ZERO remaining children? Two modes, selected by
 * `excludeProductIds`:
 *   - Pre-delete (preview): pass the same `productIds` being purged — counts
 *     every child EXCEPT the ones about to be deleted, i.e. simulates "what
 *     would remain after the purge" without deleting anything.
 *   - Post-delete (real transaction): pass `null` — the purge's own deletes
 *     have already removed every purged-product child, so a plain remaining
 *     count is exactly "what's left, period". */
async function findEmptyParents(client: Client, affected: AffectedParentIds, excludeProductIds: string[] | null): Promise<EmptyParentIds> {
  const productFilter = excludeProductIds ? { productId: { notIn: excludeProductIds } } : {};

  const [orderGroups, stockRequestGroups, stockReturnGroups, repCustomerOrderGroups, movementGroups] = await Promise.all([
    affected.orderIds.length === 0
      ? []
      : client.orderItem.groupBy({ by: ["orderId"], where: { orderId: { in: affected.orderIds }, ...productFilter }, _count: { _all: true } }),
    affected.stockRequestIds.length === 0
      ? []
      : client.stockRequestItem.groupBy({ by: ["stockRequestId"], where: { stockRequestId: { in: affected.stockRequestIds }, ...productFilter }, _count: { _all: true } }),
    affected.stockReturnIds.length === 0
      ? []
      : client.stockReturnItem.groupBy({ by: ["stockReturnId"], where: { stockReturnId: { in: affected.stockReturnIds }, ...productFilter }, _count: { _all: true } }),
    affected.repCustomerOrderIds.length === 0
      ? []
      : client.repCustomerOrderItem.groupBy({ by: ["repCustomerOrderId"], where: { repCustomerOrderId: { in: affected.repCustomerOrderIds }, ...productFilter }, _count: { _all: true } }),
    affected.transferBatchIds.length === 0
      ? []
      : client.stockMovement.groupBy({ by: ["transferBatchId"], where: { transferBatchId: { in: affected.transferBatchIds }, ...productFilter }, _count: { _all: true } }),
  ]);

  const orderHasRemaining = new Set(orderGroups.filter((row) => row._count._all > 0).map((row) => row.orderId));
  const stockRequestHasRemaining = new Set(stockRequestGroups.filter((row) => row._count._all > 0).map((row) => row.stockRequestId));
  const stockReturnHasRemaining = new Set(stockReturnGroups.filter((row) => row._count._all > 0).map((row) => row.stockReturnId));
  const repCustomerOrderHasRemaining = new Set(repCustomerOrderGroups.filter((row) => row._count._all > 0).map((row) => row.repCustomerOrderId));
  const transferBatchHasRemaining = new Set(movementGroups.filter((row) => row._count._all > 0).map((row) => row.transferBatchId));

  return {
    orderIds: affected.orderIds.filter((id) => !orderHasRemaining.has(id)),
    stockRequestIds: affected.stockRequestIds.filter((id) => !stockRequestHasRemaining.has(id)),
    stockReturnIds: affected.stockReturnIds.filter((id) => !stockReturnHasRemaining.has(id)),
    repCustomerOrderIds: affected.repCustomerOrderIds.filter((id) => !repCustomerOrderHasRemaining.has(id)),
    transferBatchIds: affected.transferBatchIds.filter((id) => !transferBatchHasRemaining.has(id)),
  };
}

/** Order-specific extra guard, BEYOND "fully empty of OrderItem" — backed by
 * a full read-only accounting audit (getAccountBalanceCents in
 * src/lib/accounts.ts, and every one of its callers/writers: rep-sales.ts,
 * admin/orders/new/actions.ts, admin/accounts/actions.ts, checkout/
 * actions.ts, order-lifecycle.ts). Findings:
 *   - Balance is NEVER stored — always computed live as
 *     SUM(orders.totalCents WHERE status NOT IN (CANCELLED, RETURNED)) -
 *     SUM(payments.amountCents), for exactly the orders/payments currently
 *     attached to the account (see getAccountBalanceCents).
 *   - AccountPayment (the ledger's payment rows) has NO foreign key, and no
 *     note/reference/metadata field of any kind, back to a specific Order —
 *     payments are recorded against the account's overall running balance,
 *     never tied to one order (see the AccountPayment doc comment in
 *     schema.prisma). The only two call sites that ever auto-create a
 *     payment (rep-sales.ts's createRepSaleCore, always for the FULL
 *     totalCents; admin/orders/new/actions.ts, for whatever paidAmountCents
 *     was entered, which may be PARTIAL) both write the exact same literal,
 *     generic note text ("دفعة عند إنشاء الطلب") — zero distinguishing
 *     information. createdAt proximity is not deterministic either
 *     (concurrent sales, or an admin's manual lump-sum payment recorded at
 *     an unrelated time, can coincide or fail to coincide either way).
 *   - Conclusion: there is NO deterministic way to identify "the payment(s)
 *     that belong to this order" — not via FK, not via note/reference/
 *     metadata/timestamp, not via amount-matching (a partial-payment order
 *     may not even have one payment whose amount equals anything
 *     meaningful). Of the five purge strategies considered (delete-order-
 *     only / delete-order-plus-linked-payments / delete-order-plus-
 *     compensating-adjustment / delete-order-plus-rebuild-balance / leave
 *     protected), only "leave protected" is actually safe: deleting the
 *     order alone fabricates a false credit (Order.totalCents drops out of
 *     the "owed" side while its payment stays on the "paid" side);
 *     deleting/adjusting payments requires the very identification that
 *     doesn't exist; "rebuilding" the balance is meaningless since nothing
 *     is ever stored to rebuild — the same false-credit result appears the
 *     instant the order is gone, live, with no separate rebuild step able
 *     to fix it.
 * This function therefore NEVER deletes an accountId-linked Order —
 * regardless of whether it's otherwise fully empty. This never blocks the
 * overall purge; it only narrows which empty Orders are auto-deleted, and
 * the excluded count is always surfaced (see protectedAccountLinkedOrders)
 * rather than silently dropped. (A real, already-existing, SAFE way to
 * remove an order's effect on a balance without deleting the row at all is
 * to cancel/return it — isTerminalOrderStatus already excludes CANCELLED/
 * RETURNED orders from the balance sum above, with no AccountPayment
 * involved — but changing an order's status is a distinct action with its
 * own consequences (e.g. inventory restoration) and out of scope for this
 * purge feature to do automatically.) */
async function filterOrdersEligibleForDeletion(client: Client, emptyOrderIds: string[]): Promise<{ eligible: string[]; protectedAccountLinked: number }> {
  if (emptyOrderIds.length === 0) return { eligible: [], protectedAccountLinked: 0 };
  const orders = await client.order.findMany({ where: { id: { in: emptyOrderIds } }, select: { id: true, accountId: true } });
  const eligible = orders.filter((order) => order.accountId === null).map((order) => order.id);
  return { eligible, protectedAccountLinked: orders.length - eligible.length };
}

/** RepCustomerOrder-specific extra guard: a completed rep sale
 * (Order.repCustomerOrderId) can point at a RepCustomerOrder — every rep
 * sale sets Order.accountId (see createRepSaleCore), so any Order linked to
 * a RepCustomerOrder is, by construction, ALSO accountId-linked and
 * therefore already protected by filterOrdersEligibleForDeletion above
 * (never a candidate for deletion itself). Even though the real FK
 * (orders_repCustomerOrderId_fkey) is ON DELETE SET NULL — meaning Postgres
 * would technically ALLOW deleting the RepCustomerOrder and just null out
 * the link — this function deliberately still refuses to: silently
 * severing a real completed sale's provenance link to the customer-order
 * request it came from is exactly the kind of implicit, silent
 * relationship loss this whole feature is designed to avoid. */
async function filterRepCustomerOrdersEligibleForDeletion(client: Client, emptyRepCustomerOrderIds: string[]): Promise<string[]> {
  if (emptyRepCustomerOrderIds.length === 0) return [];
  const linkedOrders = await client.order.findMany({ where: { repCustomerOrderId: { in: emptyRepCustomerOrderIds } }, select: { repCustomerOrderId: true } });
  const linked = new Set(linkedOrders.map((order) => order.repCustomerOrderId));
  return emptyRepCustomerOrderIds.filter((id) => !linked.has(id));
}

/** RepStockTransferBatch-specific extra guard: RepCustomerOrder.transferBatchId
 * -> rep_stock_transfer_batches is ON DELETE RESTRICT (confirmed in
 * 20260823130000_add_rep_customer_orders/migration.sql) — a batch can never
 * be deleted while ANY RepCustomerOrder still references it, including one
 * that would otherwise survive this purge untouched. `repCustomerOrderIdsBeingDeleted`
 * must be the already-decided (post-filterRepCustomerOrdersEligibleForDeletion)
 * set, so a batch whose only linked RepCustomerOrder is itself being deleted
 * in this same purge is correctly treated as eligible too. */
async function filterTransferBatchesEligibleForDeletion(client: Client, emptyTransferBatchIds: string[], repCustomerOrderIdsBeingDeleted: string[]): Promise<string[]> {
  if (emptyTransferBatchIds.length === 0) return [];
  const linkedOrders = await client.repCustomerOrder.findMany({ where: { transferBatchId: { in: emptyTransferBatchIds } }, select: { id: true, transferBatchId: true } });
  const deletingSet = new Set(repCustomerOrderIdsBeingDeleted);
  const stillLinkedBatchIds = new Set(linkedOrders.filter((order) => !deletingSet.has(order.id)).map((order) => order.transferBatchId));
  return emptyTransferBatchIds.filter((id) => !stillLinkedBatchIds.has(id));
}

interface EmptyParentPlan {
  orderIdsToDelete: string[];
  stockRequestIdsToDelete: string[];
  stockReturnIdsToDelete: string[];
  repCustomerOrderIdsToDelete: string[];
  transferBatchIdsToDelete: string[];
  protectedAccountLinkedOrders: number;
}

function emptyParentPlanCounts(plan: EmptyParentPlan): EmptyParentCounts {
  return {
    orders: plan.orderIdsToDelete.length,
    stockRequests: plan.stockRequestIdsToDelete.length,
    stockReturns: plan.stockReturnIdsToDelete.length,
    repCustomerOrders: plan.repCustomerOrderIdsToDelete.length,
    repStockTransferBatches: plan.transferBatchIdsToDelete.length,
  };
}

/** Ties STEP 3 (findEmptyParents) and the per-parent-type extra guards
 * together into one final "exactly what to delete" plan — used identically
 * by the read-only preview and the real transaction, so both always agree. */
async function buildEmptyParentPlan(client: Client, affected: AffectedParentIds, excludeProductIds: string[] | null): Promise<EmptyParentPlan> {
  const empty = await findEmptyParents(client, affected, excludeProductIds);

  const { eligible: orderIdsToDelete, protectedAccountLinked: protectedAccountLinkedOrders } = await filterOrdersEligibleForDeletion(client, empty.orderIds);
  const repCustomerOrderIdsToDelete = await filterRepCustomerOrdersEligibleForDeletion(client, empty.repCustomerOrderIds);
  const transferBatchIdsToDelete = await filterTransferBatchesEligibleForDeletion(client, empty.transferBatchIds, repCustomerOrderIdsToDelete);

  return {
    orderIdsToDelete,
    // StockRequest/StockReturn have no other inward relation anywhere in
    // the schema besides their own *Item children (already confirmed empty
    // by findEmptyParents) — no extra guard needed.
    stockRequestIdsToDelete: empty.stockRequestIds,
    stockReturnIdsToDelete: empty.stockReturnIds,
    repCustomerOrderIdsToDelete,
    transferBatchIdsToDelete,
    protectedAccountLinkedOrders,
  };
}

/** STEP 4/5 — deletes each empty, eligible parent's own exclusive
 * dependents, then the parent row itself. Order matters:
 * RepCustomerOrder MUST be deleted before RepStockTransferBatch (its
 * transferBatchId FK is ON DELETE RESTRICT) — everything else here is
 * independent. OrderStatusHistory/OrderInventoryCompensation are already
 * ON DELETE CASCADE from Order (confirmed in the init migration), so
 * deleting them explicitly first is redundant safety, not a strict
 * requirement — kept for the same explicit-over-implicit style as the rest
 * of this module, and so their counts are never silently invisible. */
async function deleteEmptyParents(tx: Tx, plan: EmptyParentPlan): Promise<void> {
  if (plan.orderIdsToDelete.length > 0) {
    const orderWhere = { orderId: { in: plan.orderIdsToDelete } };
    await tx.orderStatusHistory.deleteMany({ where: orderWhere });
    await tx.orderInventoryCompensation.deleteMany({ where: orderWhere });
    await tx.order.deleteMany({ where: { id: { in: plan.orderIdsToDelete } } });
  }
  if (plan.stockRequestIdsToDelete.length > 0) {
    await tx.stockRequest.deleteMany({ where: { id: { in: plan.stockRequestIdsToDelete } } });
  }
  if (plan.stockReturnIdsToDelete.length > 0) {
    await tx.stockReturn.deleteMany({ where: { id: { in: plan.stockReturnIdsToDelete } } });
  }
  if (plan.repCustomerOrderIdsToDelete.length > 0) {
    await tx.repCustomerOrder.deleteMany({ where: { id: { in: plan.repCustomerOrderIdsToDelete } } });
  }
  if (plan.transferBatchIdsToDelete.length > 0) {
    await tx.repStockTransferBatch.deleteMany({ where: { id: { in: plan.transferBatchIdsToDelete } } });
  }
}

/** Read-only preview — safe to call as often as needed while the admin is
 * still deciding. Never opens a transaction, never writes anything. */
export async function buildProductPurgePreview(prisma: PrismaClient, productIds: string[]): Promise<ProductPurgePreview> {
  const [rows, dependencyCounts, affectedParents] = await Promise.all([
    getRowSummaries(prisma, productIds),
    countDependencies(prisma, productIds),
    findAffectedParentIds(prisma, productIds),
  ]);
  const emptyParentPlan = await buildEmptyParentPlan(prisma, affectedParents, productIds);
  return {
    rows,
    dependencyCounts,
    totalInventoryUnits: rows.reduce((sum, row) => sum + row.companyTotal, 0),
    emptyParentsToDelete: emptyParentPlanCounts(emptyParentPlan),
    protectedAccountLinkedOrders: emptyParentPlan.protectedAccountLinkedOrders,
  };
}

export class ProductPurgeInvariantError extends Error {
  constructor(details: string) {
    super(`PURGE_INVARIANT_VIOLATED: ${details}`);
  }
}

/** The actual destructive purge — MUST be called from inside an already-open
 * `prisma.$transaction(async (tx) => ...)` so every delete below either all
 * commits together or none of it does. Deliberately takes `productIds`
 * already verified (deduped, capped, existence-checked) by the caller — this
 * function does not re-validate the request shape, only the DB-level
 * post-conditions (see the invariant check at the end).
 *
 * SHARED-PARENT PROTECTION: this function NEVER deletes Order,
 * StockRequest, StockReturn, RepCustomerOrder, or RepStockTransferBatch rows
 * — only the specific child *Item rows that reference a purged product,
 * exactly as required ("Order ABC keeps OVI10/OVI30 after only OVI20 is
 * purged"). This is deliberately NOT relaxed even when a parent becomes
 * fully empty of items after this purge: Order carries its own independent
 * financial fields (totalCents/paidAmountCents/paymentStatus, which are
 * stored snapshots, never recomputed from OrderItem rows, so removing an
 * OrderItem never corrupts them) and its removal would erase real payment/
 * account history; StockRequest/StockReturn/RepCustomerOrder/
 * RepStockTransferBatch all carry independent status/date/note/identity
 * information with documentary value on their own. Every one of these
 * parent tables is therefore always left as a historical shell rather than
 * auto-deleted, regardless of how many (or how few) of its child rows
 * survive this purge.
 *
 * DELETE ORDER — derived from the real FK constraints in the migration SQL
 * (see countDependencies's doc comment), not assumed:
 *   1. Identify every parent (Order/StockRequest/StockReturn/
 *      RepCustomerOrder/RepStockTransferBatch) touched by a to-be-purged
 *      product's child rows — BEFORE anything is deleted.
 *   2. StockMovement — MUST precede ProductVariantAllocationBatch, because
 *      StockMovement.allocationBatchId -> product_variant_allocation_batches
 *      is ON DELETE RESTRICT (confirmed in
 *      20260805170000_add_phone_product_variants/migration.sql).
 *   3. ProductVariantAllocationBatch.
 *   4-12. RepCustomerOrderItem, StockReturnItem, StockRequestItem, CartItem,
 *      WishlistItem, OrderItem, InventoryItem, ProductColorOption,
 *      ProductImage — mutually independent leaves, order among themselves
 *      doesn't matter (none references another in this list).
 *   13. EMPTY-PARENT CLEANUP — of the parents identified in step 1,
 *      recompute (now that step 2-12 actually ran) which ones have zero
 *      remaining children, apply the extra per-type guards (see
 *      filterOrdersEligibleForDeletion/filterRepCustomerOrdersEligibleForDeletion/
 *      filterTransferBatchesEligibleForDeletion), then delete
 *      RepCustomerOrder BEFORE RepStockTransferBatch (its transferBatchId FK
 *      is ON DELETE RESTRICT) — see deleteEmptyParents.
 *   14. DeviceColorVariant, 15. ProductVariant — safe only once every row
 *      from steps 2-12 is gone (see the composite-FK reasoning in
 *      countDependencies).
 *   16. Product — last. */
export async function purgeProductsInTransaction(tx: Tx, productIds: string[]): Promise<ProductPurgeResult> {
  const rows = await getRowSummaries(tx, productIds);
  if (rows.length !== productIds.length) {
    throw new ProductPurgeInvariantError(`expected ${productIds.length} products to purge, found ${rows.length} — aborting before any write`);
  }
  const dependencyCounts = await countDependencies(tx, productIds);
  const totalInventoryPurged = rows.reduce((sum, row) => sum + row.companyTotal, 0);

  // STEP 1 — identify affected parents BEFORE any delete.
  const affectedParents = await findAffectedParentIds(tx, productIds);

  const where = { productId: { in: productIds } };

  // STEPS 2-12.
  await tx.stockMovement.deleteMany({ where });
  await tx.productVariantAllocationBatch.deleteMany({ where });
  await tx.repCustomerOrderItem.deleteMany({ where });
  await tx.stockReturnItem.deleteMany({ where });
  await tx.stockRequestItem.deleteMany({ where });
  await tx.cartItem.deleteMany({ where });
  await tx.wishlistItem.deleteMany({ where });
  await tx.orderItem.deleteMany({ where });
  await tx.inventoryItem.deleteMany({ where });
  await tx.productColorOption.deleteMany({ where });
  await tx.productImage.deleteMany({ where });

  // STEP 13 — empty-parent cleanup. `excludeProductIds: null` because the
  // deletes above already removed every purged-product child, so a plain
  // "how many children remain" count is exactly the post-purge truth.
  const emptyParentPlan = await buildEmptyParentPlan(tx, affectedParents, null);
  await deleteEmptyParents(tx, emptyParentPlan);

  // STEPS 14-16.
  await tx.deviceColorVariant.deleteMany({ where });
  await tx.productVariant.deleteMany({ where });
  await tx.product.deleteMany({ where: { id: { in: productIds } } });

  // POST-DELETE INVARIANTS — re-count everything from scratch rather than
  // trusting the delete calls' own reported counts. Any nonzero/mismatched
  // value here throws, which rolls back the ENTIRE transaction (including
  // every delete above) — nothing partial is ever committed.
  const [remainingProducts, remainingDependencies] = await Promise.all([
    tx.product.count({ where: { id: { in: productIds } } }),
    countDependencies(tx, productIds),
  ]);
  const remainingDependencyEntries = Object.entries(remainingDependencies).filter(([, count]) => count > 0);
  if (remainingProducts > 0 || remainingDependencyEntries.length > 0) {
    throw new ProductPurgeInvariantError(
      `remainingProducts=${remainingProducts}, remainingDependencies=${JSON.stringify(Object.fromEntries(remainingDependencyEntries))}`,
    );
  }

  // Case 1 — every parent this plan decided to delete must now be gone.
  const [remainingDeletedOrders, remainingDeletedStockRequests, remainingDeletedStockReturns, remainingDeletedRepCustomerOrders, remainingDeletedBatches] = await Promise.all([
    emptyParentPlan.orderIdsToDelete.length === 0 ? 0 : tx.order.count({ where: { id: { in: emptyParentPlan.orderIdsToDelete } } }),
    emptyParentPlan.stockRequestIdsToDelete.length === 0 ? 0 : tx.stockRequest.count({ where: { id: { in: emptyParentPlan.stockRequestIdsToDelete } } }),
    emptyParentPlan.stockReturnIdsToDelete.length === 0 ? 0 : tx.stockReturn.count({ where: { id: { in: emptyParentPlan.stockReturnIdsToDelete } } }),
    emptyParentPlan.repCustomerOrderIdsToDelete.length === 0 ? 0 : tx.repCustomerOrder.count({ where: { id: { in: emptyParentPlan.repCustomerOrderIdsToDelete } } }),
    emptyParentPlan.transferBatchIdsToDelete.length === 0 ? 0 : tx.repStockTransferBatch.count({ where: { id: { in: emptyParentPlan.transferBatchIdsToDelete } } }),
  ]);
  if (remainingDeletedOrders > 0 || remainingDeletedStockRequests > 0 || remainingDeletedStockReturns > 0 || remainingDeletedRepCustomerOrders > 0 || remainingDeletedBatches > 0) {
    throw new ProductPurgeInvariantError(
      `empty parents were not fully removed: orders=${remainingDeletedOrders}, stockRequests=${remainingDeletedStockRequests}, stockReturns=${remainingDeletedStockReturns}, repCustomerOrders=${remainingDeletedRepCustomerOrders}, transferBatches=${remainingDeletedBatches}`,
    );
  }

  // Case 2 — every affected parent this plan decided NOT to delete (because
  // it still holds a non-purged product's child, or was protected by a
  // per-type guard) must still exist, completely unchanged.
  const survivingOrderIds = affectedParents.orderIds.filter((id) => !emptyParentPlan.orderIdsToDelete.includes(id));
  const survivingStockRequestIds = affectedParents.stockRequestIds.filter((id) => !emptyParentPlan.stockRequestIdsToDelete.includes(id));
  const survivingStockReturnIds = affectedParents.stockReturnIds.filter((id) => !emptyParentPlan.stockReturnIdsToDelete.includes(id));
  const survivingRepCustomerOrderIds = affectedParents.repCustomerOrderIds.filter((id) => !emptyParentPlan.repCustomerOrderIdsToDelete.includes(id));
  const survivingTransferBatchIds = affectedParents.transferBatchIds.filter((id) => !emptyParentPlan.transferBatchIdsToDelete.includes(id));

  const [survivingOrdersCount, survivingStockRequestsCount, survivingStockReturnsCount, survivingRepCustomerOrdersCount, survivingBatchesCount] = await Promise.all([
    survivingOrderIds.length === 0 ? 0 : tx.order.count({ where: { id: { in: survivingOrderIds } } }),
    survivingStockRequestIds.length === 0 ? 0 : tx.stockRequest.count({ where: { id: { in: survivingStockRequestIds } } }),
    survivingStockReturnIds.length === 0 ? 0 : tx.stockReturn.count({ where: { id: { in: survivingStockReturnIds } } }),
    survivingRepCustomerOrderIds.length === 0 ? 0 : tx.repCustomerOrder.count({ where: { id: { in: survivingRepCustomerOrderIds } } }),
    survivingTransferBatchIds.length === 0 ? 0 : tx.repStockTransferBatch.count({ where: { id: { in: survivingTransferBatchIds } } }),
  ]);
  if (
    survivingOrdersCount !== survivingOrderIds.length ||
    survivingStockRequestsCount !== survivingStockRequestIds.length ||
    survivingStockReturnsCount !== survivingStockReturnIds.length ||
    survivingRepCustomerOrdersCount !== survivingRepCustomerOrderIds.length ||
    survivingBatchesCount !== survivingTransferBatchIds.length
  ) {
    throw new ProductPurgeInvariantError(
      `a parent expected to survive is missing: orders ${survivingOrdersCount}/${survivingOrderIds.length}, stockRequests ${survivingStockRequestsCount}/${survivingStockRequestIds.length}, stockReturns ${survivingStockReturnsCount}/${survivingStockReturnIds.length}, repCustomerOrders ${survivingRepCustomerOrdersCount}/${survivingRepCustomerOrderIds.length}, transferBatches ${survivingBatchesCount}/${survivingTransferBatchIds.length}`,
    );
  }

  return {
    deletedProducts: rows,
    dependencyCounts,
    totalInventoryPurged,
    emptyParentsDeleted: emptyParentPlanCounts(emptyParentPlan),
    protectedAccountLinkedOrders: emptyParentPlan.protectedAccountLinkedOrders,
  };
}
