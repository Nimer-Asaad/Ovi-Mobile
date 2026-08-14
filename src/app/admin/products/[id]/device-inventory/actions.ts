"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth/guards";
import { ROLES, PRODUCT_INVENTORY_TRACKING_MODES } from "@/lib/constants";
import { getMainWarehouse } from "@/lib/inventory";
import {
  createDeviceColorCombo,
  setDeviceColorComboQuantity,
  removeOrDeactivateDeviceColorCombo,
  DuplicateDeviceColorComboError,
} from "@/lib/inventory-tracking";

export interface ComboActionState {
  error?: string;
  success?: string;
}

export interface RemoveComboResult {
  ok: boolean;
  message: string;
}

const NOT_DEVICE_MODEL_COLOR_MESSAGE = "هذا المنتج لا يستخدم وضع مخزون الجهاز واللون";

function revalidateComboPaths(productId: string): void {
  revalidatePath(`/admin/products/${productId}/device-inventory`);
  revalidatePath(`/admin/products/${productId}/edit`);
  revalidatePath("/admin/inventory");
  revalidatePath("/admin/products");
}

async function requireDeviceModelColorProduct(productId: string): Promise<void> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { inventoryTrackingMode: true },
  });
  if (!product || product.inventoryTrackingMode !== PRODUCT_INVENTORY_TRACKING_MODES.DEVICE_MODEL_COLOR) {
    throw new Error(NOT_DEVICE_MODEL_COLOR_MESSAGE);
  }
}

export async function createCombo(productId: string, _prevState: ComboActionState, formData: FormData): Promise<ComboActionState> {
  const admin = await requireRole([ROLES.ADMIN]);
  await requireDeviceModelColorProduct(productId);

  const phoneModelId = formData.get("phoneModelId")?.toString() ?? "";
  const colorId = formData.get("colorId")?.toString() ?? "";
  const quantity = Number.parseInt(formData.get("quantity")?.toString() ?? "", 10);

  if (!phoneModelId || !colorId) return { error: "اختر الماركة والموديل واللون" };
  if (!Number.isInteger(quantity) || quantity < 0) {
    return { error: "الكمية يجب أن تكون رقماً صحيحاً أكبر من أو يساوي صفر" };
  }

  const [model, color] = await Promise.all([
    prisma.phoneModel.findUnique({ where: { id: phoneModelId }, select: { id: true } }),
    prisma.color.findUnique({ where: { id: colorId }, select: { id: true } }),
  ]);
  if (!model) return { error: "الموديل المحدد غير موجود" };
  if (!color) return { error: "اللون المحدد غير موجود" };

  const warehouse = await getMainWarehouse();
  try {
    await prisma.$transaction((tx) =>
      createDeviceColorCombo(tx, {
        productId,
        phoneModelId,
        colorId,
        locationId: warehouse.id,
        initialQuantity: quantity,
        actorId: admin.id,
      }),
    );
  } catch (error) {
    if (error instanceof DuplicateDeviceColorComboError) {
      return { error: "هذه التركيبة (الموديل واللون) مضافة مسبقاً لهذا المنتج" };
    }
    throw error;
  }

  revalidateComboPaths(productId);
  return { success: "تمت إضافة التركيبة" };
}

export async function updateComboQuantity(
  comboId: string,
  productId: string,
  _prevState: ComboActionState,
  formData: FormData,
): Promise<ComboActionState> {
  const admin = await requireRole([ROLES.ADMIN]);
  await requireDeviceModelColorProduct(productId);

  const quantity = Number.parseInt(formData.get("quantity")?.toString() ?? "", 10);
  if (!Number.isInteger(quantity) || quantity < 0) {
    return { error: "الكمية يجب أن تكون رقماً صحيحاً أكبر من أو يساوي صفر" };
  }

  const combo = await prisma.deviceColorVariant.findUnique({ where: { id: comboId }, select: { id: true, productId: true } });
  if (!combo || combo.productId !== productId) return { error: "التركيبة غير موجودة" };

  const warehouse = await getMainWarehouse();
  await prisma.$transaction((tx) =>
    setDeviceColorComboQuantity(tx, { comboId, productId, locationId: warehouse.id, quantity, actorId: admin.id }),
  );

  revalidateComboPaths(productId);
  return { success: "تم حفظ الكمية" };
}

export async function toggleComboActive(comboId: string, productId: string): Promise<void> {
  await requireRole([ROLES.ADMIN]);
  const combo = await prisma.deviceColorVariant.findUnique({ where: { id: comboId }, select: { productId: true, isActive: true } });
  if (!combo || combo.productId !== productId) return;
  await prisma.deviceColorVariant.update({ where: { id: comboId }, data: { isActive: !combo.isActive } });
  revalidateComboPaths(productId);
}

export async function removeCombo(comboId: string, productId: string): Promise<RemoveComboResult> {
  await requireRole([ROLES.ADMIN]);
  const combo = await prisma.deviceColorVariant.findUnique({ where: { id: comboId }, select: { productId: true } });
  if (!combo || combo.productId !== productId) return { ok: false, message: "التركيبة غير موجودة" };

  const result = await prisma.$transaction((tx) => removeOrDeactivateDeviceColorCombo(tx, comboId));
  revalidateComboPaths(productId);

  return result.mode === "deleted"
    ? { ok: true, message: "تم حذف التركيبة نهائياً" }
    : { ok: true, message: "تعذّر الحذف النهائي لوجود سجل حركات مرتبط بها؛ تم تعطيلها بدلاً من ذلك" };
}
