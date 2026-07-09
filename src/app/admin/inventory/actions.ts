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

  const warehouse = await getMainWarehouse();

  const existingItem = await prisma.inventoryItem.findUnique({
    where: { productId_locationId: { productId, locationId: warehouse.id } },
    select: { quantity: true },
  });
  const previousQuantity = existingItem?.quantity ?? 0;

  let newQuantity: number;
  let movementQuantity: number;

  if (movementType === MANUAL_STOCK_MOVEMENT_TYPES.STOCK_IN) {
    if (quantity <= 0) return { error: POSITIVE_QUANTITY_MESSAGE };
    newQuantity = previousQuantity + quantity;
    movementQuantity = quantity;
  } else if (movementType === MANUAL_STOCK_MOVEMENT_TYPES.STOCK_OUT) {
    if (quantity <= 0) return { error: POSITIVE_QUANTITY_MESSAGE };
    if (quantity > previousQuantity) {
      return { error: "الكمية المطلوب إخراجها أكبر من المخزون الحالي" };
    }
    newQuantity = previousQuantity - quantity;
    movementQuantity = quantity;
  } else {
    // ADJUSTMENT: quantity entered is the exact final stock level.
    if (quantity === previousQuantity) {
      return { error: NO_OP_MESSAGE };
    }
    newQuantity = quantity;
    movementQuantity = Math.abs(newQuantity - previousQuantity);
  }

  if (newQuantity < 0) {
    return { error: "لا يمكن أن يكون المخزون أقل من صفر" };
  }

  await prisma.$transaction([
    prisma.inventoryItem.upsert({
      where: { productId_locationId: { productId, locationId: warehouse.id } },
      update: { quantity: newQuantity },
      create: { productId, locationId: warehouse.id, quantity: newQuantity },
    }),
    prisma.stockMovement.create({
      data: {
        type: movementType,
        productId,
        quantity: movementQuantity,
        previousQuantity,
        newQuantity,
        note: notes,
        createdById: admin.id,
        toLocationId: movementType === MANUAL_STOCK_MOVEMENT_TYPES.STOCK_OUT ? undefined : warehouse.id,
        fromLocationId: movementType === MANUAL_STOCK_MOVEMENT_TYPES.STOCK_OUT ? warehouse.id : undefined,
      },
    }),
  ]);

  revalidateInventoryPaths();
  redirect("/admin/inventory");
}
