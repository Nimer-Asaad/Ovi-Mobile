import "server-only";
import { Prisma } from "@prisma/client";
import { PRODUCT_INVENTORY_TRACKING_MODES, PRODUCT_VARIANT_MODES, STOCK_MOVEMENT_TYPES } from "@/lib/constants";
import {
  decrementInventoryAtomic,
  incrementInventoryUpsert,
  recordStockMovement,
  setInventoryAbsolute,
} from "@/lib/inventory-transactions";
import type { ProductInventoryTrackingMode } from "@/types";

type Tx = Prisma.TransactionClient;

/** Thrown when a requested (productId, phoneModelId, colorId) combination
 * already exists for this product — DeviceColorVariant's unique constraint
 * is the ultimate guard, this is the same check surfaced early with a clean
 * message instead of a raw P2002. */
export class DuplicateDeviceColorComboError extends Error {
  constructor() {
    super("DUPLICATE_DEVICE_COLOR_COMBO");
  }
}

/** Thrown by changeInventoryTrackingMode whenever the requested conversion
 * could silently move or drop quantity, or would conflict with the legacy
 * phone-variant system. Never auto-resolved — the caller always surfaces a
 * clear message and leaves data untouched. */
export class InventoryTrackingModeConversionError extends Error {
  constructor(
    public readonly code: "EXISTING_TOTAL_STOCK" | "EXISTING_COMBOS" | "LEGACY_VARIANT_MODE",
    public readonly details?: { quantity?: number; comboCount?: number },
  ) {
    super(code);
  }
}

export interface CreateDeviceColorComboInput {
  productId: string;
  phoneModelId: string;
  colorId: string;
  locationId: string;
  initialQuantity: number;
  actorId: string;
}

/** Declares a new product+phoneModel+color combination and, if a positive
 * initial quantity was given, establishes its opening stock at `locationId`
 * in the same transaction — mirrors how a fresh ProductVariant's stock is
 * first set, just without the legacy allocation-batch workflow (this mode
 * has no "old balance to redistribute" concept: it's for combinations that
 * start at whatever quantity the admin types in). */
export async function createDeviceColorCombo(tx: Tx, input: CreateDeviceColorComboInput) {
  const existing = await tx.deviceColorVariant.findUnique({
    where: { productId_phoneModelId_colorId: { productId: input.productId, phoneModelId: input.phoneModelId, colorId: input.colorId } },
  });
  if (existing) throw new DuplicateDeviceColorComboError();

  let combo;
  try {
    combo = await tx.deviceColorVariant.create({
      data: { productId: input.productId, phoneModelId: input.phoneModelId, colorId: input.colorId },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") throw new DuplicateDeviceColorComboError();
    throw err;
  }

  if (input.initialQuantity > 0) {
    const key = { productId: input.productId, deviceColorVariantId: combo.id, locationId: input.locationId };
    const change = await incrementInventoryUpsert(tx, key, input.initialQuantity);
    await recordStockMovement(tx, {
      type: STOCK_MOVEMENT_TYPES.ADJUSTMENT,
      productId: input.productId,
      deviceColorVariantId: combo.id,
      toLocationId: input.locationId,
      quantity: input.initialQuantity,
      previousQuantity: change.previousQuantity,
      newQuantity: change.newQuantity,
      note: "رصيد افتتاحي عند إنشاء تركيبة جهاز/لون جديدة",
      createdById: input.actorId,
    });
  }

  return combo;
}

export interface SetDeviceColorComboQuantityInput {
  comboId: string;
  productId: string;
  locationId: string;
  quantity: number;
  actorId: string;
}

/** Sets a single combination's absolute stock quantity at one location —
 * thin wrapper over setInventoryAbsolute/recordStockMovement, same pattern
 * as adjustVariantInventory for the legacy phone-model-only system. Editing
 * one combination's quantity never touches any other combination's
 * InventoryItem row (each has its own bucket, keyed by deviceColorVariantId). */
export async function setDeviceColorComboQuantity(tx: Tx, input: SetDeviceColorComboQuantityInput): Promise<{ changed: boolean }> {
  const key = { productId: input.productId, deviceColorVariantId: input.comboId, locationId: input.locationId };
  const change = await setInventoryAbsolute(tx, key, input.quantity);
  if (change.previousQuantity === change.newQuantity) return { changed: false };
  await recordStockMovement(tx, {
    type: STOCK_MOVEMENT_TYPES.ADJUSTMENT,
    productId: input.productId,
    deviceColorVariantId: input.comboId,
    toLocationId: input.locationId,
    quantity: Math.abs(change.newQuantity - change.previousQuantity),
    previousQuantity: change.previousQuantity,
    newQuantity: change.newQuantity,
    note: "جرد مباشر لتركيبة جهاز/لون",
    createdById: input.actorId,
  });
  return { changed: true };
}

export type RemoveDeviceColorComboResult = { mode: "deleted" } | { mode: "deactivated" };

/** Safe disable/delete for a combination: hard-deletes only when it has no
 * stock anywhere and no ledger/order history at all (mirrors removeProduct's
 * archive-vs-delete rule in admin/products/actions.ts); otherwise falls back
 * to deactivating it, never silently dropping an InventoryItem/StockMovement
 * row that carries real history. */
export async function removeOrDeactivateDeviceColorCombo(tx: Tx, comboId: string): Promise<RemoveDeviceColorComboResult> {
  const combo = await tx.deviceColorVariant.findUniqueOrThrow({
    where: { id: comboId },
    select: {
      id: true,
      inventoryItems: { select: { quantity: true } },
      _count: { select: { stockMovements: true } },
    },
  });
  const totalQuantity = combo.inventoryItems.reduce((sum, item) => sum + item.quantity, 0);
  const hasHistory = combo._count.stockMovements > 0;

  if (totalQuantity === 0 && !hasHistory) {
    await tx.inventoryItem.deleteMany({ where: { deviceColorVariantId: comboId } });
    await tx.deviceColorVariant.delete({ where: { id: comboId } });
    return { mode: "deleted" };
  }

  await tx.deviceColorVariant.update({ where: { id: comboId }, data: { isActive: false } });
  return { mode: "deactivated" };
}

export interface ChangeInventoryTrackingModeInput {
  productId: string;
  newMode: ProductInventoryTrackingMode;
}

/** Guarded conversion between TOTAL_STOCK and DEVICE_MODEL_COLOR. Never
 * moves, merges, or deletes a quantity on its own — either the conversion is
 * provably lossless (see the two directions below) and applied, or it throws
 * InventoryTrackingModeConversionError with enough detail for the caller to
 * show a clear Arabic warning telling the admin what to resolve first. */
export async function changeInventoryTrackingMode(tx: Tx, input: ChangeInventoryTrackingModeInput): Promise<void> {
  const product = await tx.product.findUniqueOrThrow({
    where: { id: input.productId },
    select: { inventoryTrackingMode: true, variantMode: true },
  });
  if (product.inventoryTrackingMode === input.newMode) return;

  if (input.newMode === PRODUCT_INVENTORY_TRACKING_MODES.DEVICE_MODEL_COLOR) {
    // The legacy phone-model-only variant system and DEVICE_MODEL_COLOR are
    // mutually exclusive (DB CHECK constraint on products) — a product
    // already using ProductVariant/allocation batches must be migrated off
    // that system first, which is out of scope for this guard.
    if (product.variantMode !== PRODUCT_VARIANT_MODES.NONE) {
      throw new InventoryTrackingModeConversionError("LEGACY_VARIANT_MODE");
    }
    const plainStock = await tx.inventoryItem.aggregate({
      where: { productId: input.productId, variantId: null, deviceColorVariantId: null },
      _sum: { quantity: true },
    });
    const quantity = plainStock._sum.quantity ?? 0;
    if (quantity !== 0) {
      throw new InventoryTrackingModeConversionError("EXISTING_TOTAL_STOCK", { quantity });
    }
    // The plain bucket is confirmed zero everywhere (the CHECK on
    // inventory_items.quantity >= 0 rules out negative rows cancelling out
    // to a false zero here) — safe to remove it entirely rather than leave a
    // dormant zero-quantity row behind. This never breaks any relation or
    // audit trail: nothing in the schema has a foreign key to
    // InventoryItem.id at all — StockMovement (the permanent ledger) links
    // to a product + variantId/deviceColorVariantId + location *tuple*, not
    // to a specific InventoryItem row, so every historical movement stays
    // fully intact and reconstructible regardless of whether the current
    // aggregate row for that old tuple still exists. Deleting it is exactly
    // equivalent to "this product never had a plain bucket row yet" — the
    // same state every brand-new product starts in — which every read site
    // (getAvailableStock, the admin inventory sums, etc.) already treats as
    // zero by simply having nothing to iterate over.
    await tx.inventoryItem.deleteMany({ where: { productId: input.productId, variantId: null, deviceColorVariantId: null } });
  } else {
    const comboCount = await tx.deviceColorVariant.count({ where: { productId: input.productId } });
    if (comboCount > 0) {
      throw new InventoryTrackingModeConversionError("EXISTING_COMBOS", { comboCount });
    }
  }

  await tx.product.update({ where: { id: input.productId }, data: { inventoryTrackingMode: input.newMode } });
}

/** decrementInventoryAtomic re-exported for call sites that need to sell
 * against a device+color combination bucket (kept out of scope this phase —
 * see the checkout/cart/rep-sale guards — but the primitive exists for the
 * next phase to wire up without re-deriving it). */
export { decrementInventoryAtomic };
