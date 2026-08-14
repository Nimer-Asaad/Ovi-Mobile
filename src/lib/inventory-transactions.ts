import "server-only";
import { Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;

export interface InventoryKey {
  productId: string;
  /** ProductVariant identity (product + phone model). Null for products with
   * no phone-variant tracking, which keep a single plain stock bucket per
   * location. Every function here deliberately uses plain `where` filters
   * (never the `productId_locationId_variantId` compound-key shorthand)
   * because Prisma's generated type for that shorthand disallows `null` on
   * a nullable compound field — SQL unique constraints treat NULL as
   * distinct from every other NULL, so uniqueness for the variant-less case
   * is instead enforced by a hand-authored partial unique index
   * (`... WHERE "variantId" IS NULL`, see the migration), which only a
   * plain filter can query against. Deliberately has no plain colorId: color
   * is a pure display attribute on cart/order/request/return lines and never
   * determines the stock bucket on its own — see the InventoryItem doc
   * comment in prisma/schema.prisma. */
  variantId?: string | null;
  /** DeviceColorVariant identity (product + phone model + color) — used only
   * by products with inventoryTrackingMode DEVICE_MODEL_COLOR. Mutually
   * exclusive with variantId (enforced by a DB CHECK constraint and by
   * assertValidKey below); same plain-filter/partial-index reasoning as
   * variantId applies here. */
  deviceColorVariantId?: string | null;
  locationId: string;
}

/** Guards the variantId/deviceColorVariantId mutual-exclusivity invariant in
 * application code too, as defense in depth alongside the DB CHECK
 * constraint — every helper below calls this before touching the database. */
function assertValidKey(key: InventoryKey): void {
  if (key.variantId && key.deviceColorVariantId) {
    throw new RangeError("INVENTORY_KEY_VARIANT_AND_DEVICE_COLOR_VARIANT_BOTH_SET");
  }
}

export interface QuantityChange {
  previousQuantity: number;
  newQuantity: number;
}

/** Thrown by decrementInventoryAtomic when the row doesn't have enough
 * stock (or doesn't exist) at commit time — callers catch this to return a
 * clean message instead of a raw transaction rollback error. */
export class InsufficientInventoryError extends Error {
  constructor(public readonly productId: string) {
    super("INSUFFICIENT_INVENTORY");
  }
}

/** Thrown by incrementInventoryExisting when there's no InventoryItem row
 * to restore into — unlike the other helpers this one never creates a row,
 * since a missing row at restore time signals a data-integrity problem
 * worth surfacing rather than silently papering over. */
export class MissingInventoryError extends Error {
  constructor(public readonly productId: string) {
    super("MISSING_INVENTORY");
  }
}

function requirePositiveQuantity(quantity: number): void {
  if (!Number.isInteger(quantity) || quantity <= 0) throw new RangeError("INVENTORY_QUANTITY_MUST_BE_POSITIVE");
}

function requireNonnegativeQuantity(quantity: number): void {
  if (!Number.isInteger(quantity) || quantity < 0) throw new RangeError("INVENTORY_QUANTITY_MUST_BE_NONNEGATIVE");
}

function keyFilter(key: InventoryKey) {
  assertValidKey(key);
  return {
    productId: key.productId,
    variantId: key.variantId ?? null,
    deviceColorVariantId: key.deviceColorVariantId ?? null,
    locationId: key.locationId,
  };
}

async function readQuantity(tx: Tx, key: InventoryKey): Promise<number> {
  const row = await tx.inventoryItem.findFirstOrThrow({
    where: keyFilter(key),
    select: { quantity: true },
  });
  return row.quantity;
}

/** Creates the row if it doesn't exist yet, race-safe against a concurrent
 * creator: relies on the DB unique index (full compound for a variant,
 * partial `WHERE variantId IS NULL` for a plain product — see the
 * migration) to reject a duplicate with P2002, then falls back to the
 * caller-supplied update. */
async function createOrElse(
  tx: Tx,
  key: InventoryKey,
  initialQuantity: number,
  onConflict: () => Promise<void>,
): Promise<void> {
  try {
    await tx.inventoryItem.create({
      data: {
        productId: key.productId,
        locationId: key.locationId,
        variantId: key.variantId ?? null,
        deviceColorVariantId: key.deviceColorVariantId ?? null,
        quantity: initialQuantity,
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      await onConflict();
      return;
    }
    throw err;
  }
}

/** Atomic conditional decrement — `quantity: { gte }` in the `where` makes
 * this a single conditional UPDATE, never a stale read-then-write, so a
 * concurrent decrement on the same product+variant+location can never both
 * succeed and drive stock negative. Throws InsufficientInventoryError if
 * the row didn't have enough stock (or didn't exist). */
export async function decrementInventoryAtomic(
  tx: Tx,
  key: InventoryKey,
  quantity: number,
): Promise<QuantityChange> {
  requirePositiveQuantity(quantity);
  const decremented = await tx.inventoryItem.updateMany({
    where: { ...keyFilter(key), quantity: { gte: quantity } },
    data: { quantity: { decrement: quantity } },
  });
  if (decremented.count !== 1) {
    throw new InsufficientInventoryError(key.productId);
  }
  const current = await readQuantity(tx, key);
  return { previousQuantity: current + quantity, newQuantity: current };
}

/** Atomic increment — safe even if two writes to the same
 * product+variant+location land at the same moment. Creates the row if it
 * doesn't exist yet (e.g. a rep's car has never held this product/variant
 * before). */
export async function incrementInventoryUpsert(
  tx: Tx,
  key: InventoryKey,
  quantity: number,
): Promise<QuantityChange> {
  requirePositiveQuantity(quantity);
  const updated = await tx.inventoryItem.updateMany({
    where: keyFilter(key),
    data: { quantity: { increment: quantity } },
  });
  if (updated.count === 0) {
    await createOrElse(tx, key, quantity, async () => {
      await tx.inventoryItem.updateMany({ where: keyFilter(key), data: { quantity: { increment: quantity } } });
    });
  }
  const current = await readQuantity(tx, key);
  return { previousQuantity: current - quantity, newQuantity: current };
}

/** Atomic increment that requires an existing row — used only by order
 * restoration (cancel/return), where a missing InventoryItem means the
 * order's original decrement site no longer has a matching row, a
 * data-integrity problem that should surface, not be silently masked by
 * creating a fresh row. Throws MissingInventoryError if no row matches. */
export async function incrementInventoryExisting(
  tx: Tx,
  key: InventoryKey,
  quantity: number,
): Promise<QuantityChange> {
  requirePositiveQuantity(quantity);
  const incremented = await tx.inventoryItem.updateMany({
    where: keyFilter(key),
    data: { quantity: { increment: quantity } },
  });
  if (incremented.count !== 1) {
    throw new MissingInventoryError(key.productId);
  }
  const current = await readQuantity(tx, key);
  return { previousQuantity: current - quantity, newQuantity: current };
}

/** Sets an absolute quantity (manual ADJUSTMENT moves) — reads the current
 * value as the very last step before writing, inside the caller's own
 * transaction, to keep the window for a concurrent change as small as
 * possible; the quantity passed in is the exact final stock level, not a
 * delta. */
export async function setInventoryAbsolute(
  tx: Tx,
  key: InventoryKey,
  quantity: number,
): Promise<QuantityChange> {
  requireNonnegativeQuantity(quantity);
  const existing = await tx.inventoryItem.findFirst({
    where: keyFilter(key),
    select: { quantity: true },
  });
  const previousQuantity = existing?.quantity ?? 0;
  if (existing) {
    await tx.inventoryItem.updateMany({ where: keyFilter(key), data: { quantity } });
  } else {
    await createOrElse(tx, key, quantity, async () => {
      await tx.inventoryItem.updateMany({ where: keyFilter(key), data: { quantity } });
    });
  }
  return { previousQuantity, newQuantity: quantity };
}

export interface StockMovementInput {
  type: string;
  productId: string;
  variantId?: string | null;
  deviceColorVariantId?: string | null;
  allocationBatchId?: string | null;
  transferBatchId?: string | null;
  fromLocationId?: string | null;
  toLocationId?: string | null;
  quantity: number;
  previousQuantity?: number | null;
  newQuantity?: number | null;
  note?: string | null;
  createdById?: string | null;
}

/** Thin wrapper over StockMovement.create — exists so every inventory
 * mutation in the app writes to the immutable ledger through the same call
 * shape as the InventoryItem helpers above. */
export async function recordStockMovement(tx: Tx, input: StockMovementInput): Promise<void> {
  requirePositiveQuantity(input.quantity);
  await tx.stockMovement.create({ data: { ...input } });
}
