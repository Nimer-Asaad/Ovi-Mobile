"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth/guards";
import { ROLES, STOCK_MOVEMENT_TYPES } from "@/lib/constants";
import { getMainWarehouse } from "@/lib/inventory";
import { colorInventoryBulkAdjustSchema } from "@/lib/validation/colorInventory";
import { setInventoryAbsolute, recordStockMovement } from "@/lib/inventory-transactions";

export interface ColorInventoryBulkAdjustState {
  error?: string;
  success?: string;
}

const PARSE_ERROR_MESSAGE = "بيانات الجرد غير صالحة";

/** Bulk stocktaking — one absolute quantity per (productId, colorId) cell,
 * applied in a single transaction so a partial submit never leaves the
 * count half-applied. Each changed cell writes one ADJUSTMENT StockMovement,
 * same as the single-product AdjustStockForm. */
export async function bulkAdjustColorInventory(
  _prevState: ColorInventoryBulkAdjustState,
  formData: FormData,
): Promise<ColorInventoryBulkAdjustState> {
  const admin = await requireRole([ROLES.ADMIN]);

  let cells: unknown;
  try {
    cells = JSON.parse(formData.get("cells")?.toString() ?? "[]");
  } catch {
    return { error: PARSE_ERROR_MESSAGE };
  }

  const parsed = colorInventoryBulkAdjustSchema.safeParse({ cells });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? PARSE_ERROR_MESSAGE };
  }

  const productIds = [...new Set(parsed.data.cells.map((cell) => cell.productId))];
  const colorIds = [...new Set(parsed.data.cells.map((cell) => cell.colorId))];

  const [validProductColorPairs, warehouse] = await Promise.all([
    prisma.productColorOption.findMany({
      where: { productId: { in: productIds }, colorId: { in: colorIds }, product: { variantMode: "NONE" } },
      select: { productId: true, colorId: true },
    }),
    getMainWarehouse(),
  ]);
  const validPairKeys = new Set(validProductColorPairs.map((pair) => `${pair.productId}:${pair.colorId}`));

  for (const cell of parsed.data.cells) {
    if (!validPairKeys.has(`${cell.productId}:${cell.colorId}`)) {
      return { error: "أحد عناصر الجرد لا يطابق لون منتج صالح" };
    }
  }

  await prisma.$transaction(async (tx) => {
    for (const cell of parsed.data.cells) {
      const key = { productId: cell.productId, colorId: cell.colorId, locationId: warehouse.id };
      const change = await setInventoryAbsolute(tx, key, cell.quantity);
      if (change.previousQuantity === change.newQuantity) continue;

      await recordStockMovement(tx, {
        type: STOCK_MOVEMENT_TYPES.ADJUSTMENT,
        productId: cell.productId,
        colorId: cell.colorId,
        toLocationId: warehouse.id,
        quantity: Math.abs(change.newQuantity - change.previousQuantity),
        previousQuantity: change.previousQuantity,
        newQuantity: change.newQuantity,
        note: "جرد جماعي بالألوان",
        createdById: admin.id,
      });
    }
  });

  revalidatePath("/admin/inventory/colors");
  revalidatePath("/admin/inventory");
  revalidatePath("/admin/inventory/movements");
  revalidatePath("/admin");
  revalidatePath("/admin/products");
  revalidatePath("/products");

  return { success: "تم حفظ الجرد بنجاح" };
}
