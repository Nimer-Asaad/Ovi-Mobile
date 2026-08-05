"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth/guards";
import { ROLES, MANUAL_STOCK_MOVEMENT_TYPES } from "@/lib/constants";
import { getMainWarehouse } from "@/lib/inventory";
import { stockAdjustmentSchema } from "@/lib/validation/inventory";
import {
  decrementInventoryAtomic,
  incrementInventoryUpsert,
  setInventoryAbsolute,
  recordStockMovement,
  InsufficientInventoryError,
} from "@/lib/inventory-transactions";

export interface StockAdjustmentState {
  error?: string;
}

/** Thrown inside the stock-movement transaction for any validation failure
 * that depends on a fresh in-transaction read (insufficient stock, no-op
 * adjustment, negative floor) — caught outside to return the same clean
 * Arabic message as before, instead of a raw rollback error. */
class StockActionError extends Error {}

const PARSE_ERROR_MESSAGE = "بيانات التعديل غير صالحة";
const POSITIVE_QUANTITY_MESSAGE = "الكمية يجب أن تكون رقماً صحيحاً أكبر من صفر";
const NO_OP_MESSAGE = "الكمية الجديدة مساوية للكمية الحالية، لم يتم تنفيذ أي تعديل";

function revalidateInventoryPaths(): void {
  revalidatePath("/admin/inventory");
  revalidatePath("/admin/inventory/movements");
  revalidatePath("/admin/inventory/adjust");
  revalidatePath("/admin");
  revalidatePath("/admin/products");
  revalidatePath("/products");
}

export async function createStockMovement(
  _prevState: StockAdjustmentState,
  formData: FormData,
): Promise<StockAdjustmentState> {
  const admin = await requireRole([ROLES.ADMIN]);

  const parsed = stockAdjustmentSchema.safeParse({
    productId: formData.get("productId")?.toString() ?? "",
    colorId: formData.get("colorId")?.toString() || undefined,
    movementType: formData.get("movementType")?.toString() ?? "",
    quantity: formData.get("quantity")?.toString() ?? "",
    notes: formData.get("notes")?.toString().trim() || undefined,
  });

  if (!parsed.success) {
    return { error: PARSE_ERROR_MESSAGE };
  }

  const { productId, movementType, quantity, notes } = parsed.data;
  const colorId = parsed.data.colorId ?? null;

  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, isActive: true, colorOptions: { select: { colorId: true } } },
  });
  if (!product) {
    return { error: "المنتج غير موجود" };
  }
  if (!product.isActive) {
    return { error: "لا يمكن تعديل مخزون منتج غير مفعل" };
  }
  if (colorId && !product.colorOptions.some((option) => option.colorId === colorId)) {
    return { error: "اللون المحدد لا ينتمي لهذا المنتج" };
  }

  if (movementType !== MANUAL_STOCK_MOVEMENT_TYPES.ADJUSTMENT && quantity <= 0) {
    return { error: POSITIVE_QUANTITY_MESSAGE };
  }

  const warehouse = await getMainWarehouse();
  const key = { productId, colorId, locationId: warehouse.id };

  try {
    await prisma.$transaction(async (tx) => {
      if (movementType === MANUAL_STOCK_MOVEMENT_TYPES.ADJUSTMENT) {
        if (quantity < 0) {
          throw new StockActionError("لا يمكن أن يكون المخزون أقل من صفر");
        }

        const change = await setInventoryAbsolute(tx, key, quantity);
        if (change.previousQuantity === change.newQuantity) {
          throw new StockActionError(NO_OP_MESSAGE);
        }

        await recordStockMovement(tx, {
          type: movementType,
          productId,
          colorId,
          quantity: Math.abs(change.newQuantity - change.previousQuantity),
          previousQuantity: change.previousQuantity,
          newQuantity: change.newQuantity,
          note: notes,
          createdById: admin.id,
          toLocationId: warehouse.id,
        });
        return;
      }

      const isStockOut = movementType === MANUAL_STOCK_MOVEMENT_TYPES.STOCK_OUT;
      let change;
      try {
        change = isStockOut
          ? await decrementInventoryAtomic(tx, key, quantity)
          : await incrementInventoryUpsert(tx, key, quantity);
      } catch (err) {
        if (err instanceof InsufficientInventoryError) {
          throw new StockActionError("الكمية المطلوب إخراجها أكبر من المخزون الحالي");
        }
        throw err;
      }

      await recordStockMovement(tx, {
        type: movementType,
        productId,
        colorId,
        quantity,
        previousQuantity: change.previousQuantity,
        newQuantity: change.newQuantity,
        note: notes,
        createdById: admin.id,
        toLocationId: isStockOut ? undefined : warehouse.id,
        fromLocationId: isStockOut ? warehouse.id : undefined,
      });
    });
  } catch (err) {
    if (err instanceof StockActionError) return { error: err.message };
    throw err;
  }

  revalidateInventoryPaths();
  redirect("/admin/inventory");
}
