"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth/guards";
import { ROLES, STOCK_MOVEMENT_TYPES } from "@/lib/constants";
import { getMainWarehouse } from "@/lib/inventory";
import { getOrCreateRepLocation } from "@/lib/reps";
import { repStockTransferSchema } from "@/lib/validation/reps";
import {
  decrementInventoryAtomic,
  incrementInventoryUpsert,
  recordStockMovement,
  InsufficientInventoryError,
} from "@/lib/inventory-transactions";

export interface RepStockTransferState {
  error?: string;
}

const PARSE_ERROR_MESSAGE = "بيانات التحويل غير صالحة";

function revalidateRepPaths(repId: string): void {
  revalidatePath("/admin/reps");
  revalidatePath(`/admin/reps/${repId}`);
  revalidatePath(`/admin/reps/${repId}/assign-stock`);
  revalidatePath(`/admin/reps/${repId}/return-stock`);
  revalidatePath("/admin/inventory");
  revalidatePath("/admin/inventory/movements");
  revalidatePath("/admin");
  revalidatePath("/rep");
  revalidatePath("/rep/stock");
  revalidatePath("/rep/movements");
}

function parseTransferForm(formData: FormData) {
  return repStockTransferSchema.safeParse({
    productId: formData.get("productId")?.toString() ?? "",
    variantId: formData.get("variantId")?.toString() || undefined,
    quantity: formData.get("quantity")?.toString() ?? "",
    notes: formData.get("notes")?.toString().trim() || undefined,
  });
}

export async function assignStockToRep(
  repId: string,
  _prevState: RepStockTransferState,
  formData: FormData,
): Promise<RepStockTransferState> {
  const admin = await requireRole([ROLES.ADMIN]);

  const parsed = parseTransferForm(formData);
  if (!parsed.success) {
    return { error: PARSE_ERROR_MESSAGE };
  }
  const { productId, quantity, notes } = parsed.data;
  const variantId = parsed.data.variantId ?? null;

  const rep = await prisma.salesRepresentative.findUnique({
    where: { id: repId },
    select: { id: true, isActive: true, user: { select: { id: true, name: true, isActive: true } } },
  });
  if (!rep) {
    return { error: "المندوب غير موجود" };
  }
  if (!rep.isActive || !rep.user.isActive) {
    return { error: "لا يمكن تخصيص مخزون لمندوب غير مفعل" };
  }

  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, isActive: true, variantMode: true, variantAllocationStatus: true, variants: { where: { isActive: true }, select: { id: true } } },
  });
  if (!product) {
    return { error: "المنتج غير موجود" };
  }
  if (!product.isActive) {
    return { error: "لا يمكن تخصيص منتج غير مفعل" };
  }
  if (product.variantMode === "PHONE_COMPATIBILITY" && (product.variantAllocationStatus !== "READY" || !variantId || !product.variants.some((variant) => variant.id === variantId))) return { error: "اختر Variant صالحاً وجاهز المخزون" };
  if (product.variantMode !== "PHONE_COMPATIBILITY" && variantId) return { error: "Variant لا يتبع المنتج" };

  const warehouse = await getMainWarehouse();
  const repLocation = await getOrCreateRepLocation(rep.id, rep.user.name);

  try {
    await prisma.$transaction(async (tx) => {
      // Atomic conditional decrement on the source (warehouse) — never a
      // stale read-then-write. Insufficient stock rolls back the whole
      // transfer.
      await decrementInventoryAtomic(tx, { productId, variantId, locationId: warehouse.id }, quantity);

      // Atomic increment on the destination (rep car) — safe even if two
      // transfers to the same rep/product land at the same moment.
      const change = await incrementInventoryUpsert(
        tx,
        { productId, variantId, locationId: repLocation.id },
        quantity,
      );

      await recordStockMovement(tx, {
        type: STOCK_MOVEMENT_TYPES.REP_ASSIGNMENT,
        productId,
        variantId,
        fromLocationId: warehouse.id,
        toLocationId: repLocation.id,
        quantity,
        previousQuantity: change.previousQuantity,
        newQuantity: change.newQuantity,
        note: notes,
        createdById: admin.id,
      });
    });
  } catch (err) {
    if (err instanceof InsufficientInventoryError) {
      return { error: "الكمية المطلوبة أكبر من المخزون المتوفر في المستودع الرئيسي" };
    }
    throw err;
  }

  revalidateRepPaths(repId);
  redirect(`/admin/reps/${repId}`);
}

export async function returnStockFromRep(
  repId: string,
  _prevState: RepStockTransferState,
  formData: FormData,
): Promise<RepStockTransferState> {
  const admin = await requireRole([ROLES.ADMIN]);

  const parsed = parseTransferForm(formData);
  if (!parsed.success) {
    return { error: PARSE_ERROR_MESSAGE };
  }
  const { productId, quantity, notes } = parsed.data;
  const variantId = parsed.data.variantId ?? null;

  const rep = await prisma.salesRepresentative.findUnique({
    where: { id: repId },
    select: { id: true },
  });
  if (!rep) {
    return { error: "المندوب غير موجود" };
  }

  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, variantMode: true, variants: { select: { id: true } } },
  });
  if (!product) {
    return { error: "المنتج غير موجود" };
  }
  if (product.variantMode === "PHONE_COMPATIBILITY" && (!variantId || !product.variants.some((variant) => variant.id === variantId))) return { error: "اختر Variant صالحاً" };

  const warehouse = await getMainWarehouse();
  const repLocation = await prisma.stockLocation.findUnique({ where: { salesRepId: rep.id } });

  if (!repLocation) {
    return { error: "المندوب لا يملك مخزوناً لإرجاعه" };
  }

  try {
    await prisma.$transaction(async (tx) => {
      // Atomic conditional decrement on the source (rep car) — never a
      // stale read-then-write. Insufficient stock rolls back the whole
      // return.
      const change = await decrementInventoryAtomic(
        tx,
        { productId, variantId, locationId: repLocation.id },
        quantity,
      );

      // Atomic increment on the destination (warehouse).
      await incrementInventoryUpsert(tx, { productId, variantId, locationId: warehouse.id }, quantity);

      await recordStockMovement(tx, {
        type: STOCK_MOVEMENT_TYPES.REP_RETURN,
        productId,
        variantId,
        fromLocationId: repLocation.id,
        toLocationId: warehouse.id,
        quantity,
        previousQuantity: change.previousQuantity,
        newQuantity: change.newQuantity,
        note: notes,
        createdById: admin.id,
      });
    });
  } catch (err) {
    if (err instanceof InsufficientInventoryError) {
      return { error: "الكمية المطلوبة أكبر من مخزون المندوب الحالي" };
    }
    throw err;
  }

  revalidateRepPaths(repId);
  redirect(`/admin/reps/${repId}`);
}
