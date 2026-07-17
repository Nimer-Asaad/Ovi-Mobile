"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth/guards";
import { ROLES, STOCK_MOVEMENT_TYPES } from "@/lib/constants";
import { getMainWarehouse } from "@/lib/inventory";
import { getOrCreateRepLocation } from "@/lib/reps";
import { repStockTransferSchema } from "@/lib/validation/reps";

export interface RepStockTransferState {
  error?: string;
}

/** Thrown inside a transfer transaction when the source location's stock
 * is no longer sufficient at commit time — caught outside to return a
 * clean Arabic message instead of a raw transaction rollback error. */
class InsufficientStockError extends Error {}

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
    select: { id: true, isActive: true },
  });
  if (!product) {
    return { error: "المنتج غير موجود" };
  }
  if (!product.isActive) {
    return { error: "لا يمكن تخصيص منتج غير مفعل" };
  }

  const warehouse = await getMainWarehouse();
  const repLocation = await getOrCreateRepLocation(rep.id, rep.user.name);

  try {
    await prisma.$transaction(async (tx) => {
      // Atomic conditional decrement on the source (warehouse) — never a
      // stale read-then-write. `count !== 1` means the warehouse no
      // longer has enough stock, so nothing is transferred.
      const decremented = await tx.inventoryItem.updateMany({
        where: { productId, locationId: warehouse.id, quantity: { gte: quantity } },
        data: { quantity: { decrement: quantity } },
      });
      if (decremented.count !== 1) {
        throw new InsufficientStockError("الكمية المطلوبة أكبر من المخزون المتوفر في المستودع الرئيسي");
      }

      // Atomic increment on the destination (rep car) — safe even if two
      // transfers to the same rep/product land at the same moment.
      await tx.inventoryItem.upsert({
        where: { productId_locationId: { productId, locationId: repLocation.id } },
        update: { quantity: { increment: quantity } },
        create: { productId, locationId: repLocation.id, quantity },
      });

      const repItemAfter = await tx.inventoryItem.findUniqueOrThrow({
        where: { productId_locationId: { productId, locationId: repLocation.id } },
        select: { quantity: true },
      });

      await tx.stockMovement.create({
        data: {
          type: STOCK_MOVEMENT_TYPES.REP_ASSIGNMENT,
          productId,
          fromLocationId: warehouse.id,
          toLocationId: repLocation.id,
          quantity,
          previousQuantity: repItemAfter.quantity - quantity,
          newQuantity: repItemAfter.quantity,
          note: notes,
          createdById: admin.id,
        },
      });
    });
  } catch (err) {
    if (err instanceof InsufficientStockError) return { error: err.message };
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

  const rep = await prisma.salesRepresentative.findUnique({
    where: { id: repId },
    select: { id: true },
  });
  if (!rep) {
    return { error: "المندوب غير موجود" };
  }

  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true },
  });
  if (!product) {
    return { error: "المنتج غير موجود" };
  }

  const warehouse = await getMainWarehouse();
  const repLocation = await prisma.stockLocation.findUnique({ where: { salesRepId: rep.id } });

  if (!repLocation) {
    return { error: "المندوب لا يملك مخزوناً لإرجاعه" };
  }

  try {
    await prisma.$transaction(async (tx) => {
      // Atomic conditional decrement on the source (rep car) — never a
      // stale read-then-write. `count !== 1` means the rep no longer has
      // enough stock, so nothing is returned.
      const decremented = await tx.inventoryItem.updateMany({
        where: { productId, locationId: repLocation.id, quantity: { gte: quantity } },
        data: { quantity: { decrement: quantity } },
      });
      if (decremented.count !== 1) {
        throw new InsufficientStockError("الكمية المطلوبة أكبر من مخزون المندوب الحالي");
      }

      // Atomic increment on the destination (warehouse).
      await tx.inventoryItem.upsert({
        where: { productId_locationId: { productId, locationId: warehouse.id } },
        update: { quantity: { increment: quantity } },
        create: { productId, locationId: warehouse.id, quantity },
      });

      const repItemAfter = await tx.inventoryItem.findUniqueOrThrow({
        where: { productId_locationId: { productId, locationId: repLocation.id } },
        select: { quantity: true },
      });

      await tx.stockMovement.create({
        data: {
          type: STOCK_MOVEMENT_TYPES.REP_RETURN,
          productId,
          fromLocationId: repLocation.id,
          toLocationId: warehouse.id,
          quantity,
          previousQuantity: repItemAfter.quantity + quantity,
          newQuantity: repItemAfter.quantity,
          note: notes,
          createdById: admin.id,
        },
      });
    });
  } catch (err) {
    if (err instanceof InsufficientStockError) return { error: err.message };
    throw err;
  }

  revalidateRepPaths(repId);
  redirect(`/admin/reps/${repId}`);
}
