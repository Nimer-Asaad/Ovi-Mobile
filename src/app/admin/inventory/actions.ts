"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth/guards";
import { ROLES, MANUAL_STOCK_MOVEMENT_TYPES } from "@/lib/constants";
import { getMainWarehouse } from "@/lib/inventory";
import { stockAdjustmentSchema } from "@/lib/validation/inventory";

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
    movementType: formData.get("movementType")?.toString() ?? "",
    quantity: formData.get("quantity")?.toString() ?? "",
    notes: formData.get("notes")?.toString().trim() || undefined,
  });

  if (!parsed.success) {
    return { error: PARSE_ERROR_MESSAGE };
  }

  const { productId, movementType, quantity, notes } = parsed.data;

  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, isActive: true },
  });
  if (!product) {
    return { error: "المنتج غير موجود" };
  }
  if (!product.isActive) {
    return { error: "لا يمكن تعديل مخزون منتج غير مفعل" };
  }

  if (movementType !== MANUAL_STOCK_MOVEMENT_TYPES.ADJUSTMENT && quantity <= 0) {
    return { error: POSITIVE_QUANTITY_MESSAGE };
  }

  const warehouse = await getMainWarehouse();
  const itemWhere = { productId_locationId: { productId, locationId: warehouse.id } };

  try {
    await prisma.$transaction(async (tx) => {
      if (movementType === MANUAL_STOCK_MOVEMENT_TYPES.ADJUSTMENT) {
        // Absolute set, not a delta — read the current value as the very
        // last step before writing (inside the transaction) so the window
        // for a concurrent change to make this stale is as small as
        // possible; quantity entered is the exact final stock level.
        const existingItem = await tx.inventoryItem.findUnique({ where: itemWhere, select: { quantity: true } });
        const previousQuantity = existingItem?.quantity ?? 0;

        if (quantity === previousQuantity) {
          throw new StockActionError(NO_OP_MESSAGE);
        }
        if (quantity < 0) {
          throw new StockActionError("لا يمكن أن يكون المخزون أقل من صفر");
        }

        await tx.inventoryItem.upsert({
          where: itemWhere,
          update: { quantity },
          create: { productId, locationId: warehouse.id, quantity },
        });

        await tx.stockMovement.create({
          data: {
            type: movementType,
            productId,
            quantity: Math.abs(quantity - previousQuantity),
            previousQuantity,
            newQuantity: quantity,
            note: notes,
            createdById: admin.id,
            toLocationId: warehouse.id,
          },
        });
        return;
      }

      if (movementType === MANUAL_STOCK_MOVEMENT_TYPES.STOCK_OUT) {
        // Atomic conditional decrement — never reads a stale quantity
        // before writing. `count !== 1` means the row didn't have enough
        // stock (or didn't exist), so the whole transaction rolls back.
        const decremented = await tx.inventoryItem.updateMany({
          where: { productId, locationId: warehouse.id, quantity: { gte: quantity } },
          data: { quantity: { decrement: quantity } },
        });
        if (decremented.count !== 1) {
          throw new StockActionError("الكمية المطلوب إخراجها أكبر من المخزون الحالي");
        }
      } else {
        // STOCK_IN: atomic increment, safe even if two admins stock the
        // same product in at the same moment.
        await tx.inventoryItem.upsert({
          where: itemWhere,
          update: { quantity: { increment: quantity } },
          create: { productId, locationId: warehouse.id, quantity },
        });
      }

      const after = await tx.inventoryItem.findUniqueOrThrow({ where: itemWhere, select: { quantity: true } });
      const isStockOut = movementType === MANUAL_STOCK_MOVEMENT_TYPES.STOCK_OUT;

      await tx.stockMovement.create({
        data: {
          type: movementType,
          productId,
          quantity,
          previousQuantity: isStockOut ? after.quantity + quantity : after.quantity - quantity,
          newQuantity: after.quantity,
          note: notes,
          createdById: admin.id,
          toLocationId: isStockOut ? undefined : warehouse.id,
          fromLocationId: isStockOut ? warehouse.id : undefined,
        },
      });
    });
  } catch (err) {
    if (err instanceof StockActionError) return { error: err.message };
    throw err;
  }

  revalidateInventoryPaths();
  redirect("/admin/inventory");
}
