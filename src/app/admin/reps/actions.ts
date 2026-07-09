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

  const [warehouseItem, repItem] = await Promise.all([
    prisma.inventoryItem.findUnique({
      where: { productId_locationId: { productId, locationId: warehouse.id } },
      select: { quantity: true },
    }),
    prisma.inventoryItem.findUnique({
      where: { productId_locationId: { productId, locationId: repLocation.id } },
      select: { quantity: true },
    }),
  ]);

  const previousWarehouseQuantity = warehouseItem?.quantity ?? 0;
  const previousRepQuantity = repItem?.quantity ?? 0;

  if (quantity > previousWarehouseQuantity) {
    return { error: "الكمية المطلوبة أكبر من المخزون المتوفر في المستودع الرئيسي" };
  }

  const newWarehouseQuantity = previousWarehouseQuantity - quantity;
  const newRepQuantity = previousRepQuantity + quantity;

  await prisma.$transaction([
    prisma.inventoryItem.upsert({
      where: { productId_locationId: { productId, locationId: warehouse.id } },
      update: { quantity: newWarehouseQuantity },
      create: { productId, locationId: warehouse.id, quantity: newWarehouseQuantity },
    }),
    prisma.inventoryItem.upsert({
      where: { productId_locationId: { productId, locationId: repLocation.id } },
      update: { quantity: newRepQuantity },
      create: { productId, locationId: repLocation.id, quantity: newRepQuantity },
    }),
    prisma.stockMovement.create({
      data: {
        type: STOCK_MOVEMENT_TYPES.REP_ASSIGNMENT,
        productId,
        fromLocationId: warehouse.id,
        toLocationId: repLocation.id,
        quantity,
        previousQuantity: previousRepQuantity,
        newQuantity: newRepQuantity,
        note: notes,
        createdById: admin.id,
      },
    }),
  ]);

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

  const repItem = repLocation
    ? await prisma.inventoryItem.findUnique({
        where: { productId_locationId: { productId, locationId: repLocation.id } },
        select: { quantity: true },
      })
    : null;
  const previousRepQuantity = repItem?.quantity ?? 0;

  if (quantity > previousRepQuantity) {
    return { error: "الكمية المطلوبة أكبر من مخزون المندوب الحالي" };
  }

  if (!repLocation) {
    return { error: "المندوب لا يملك مخزوناً لإرجاعه" };
  }

  const warehouseItem = await prisma.inventoryItem.findUnique({
    where: { productId_locationId: { productId, locationId: warehouse.id } },
    select: { quantity: true },
  });
  const previousWarehouseQuantity = warehouseItem?.quantity ?? 0;

  const newRepQuantity = previousRepQuantity - quantity;
  const newWarehouseQuantity = previousWarehouseQuantity + quantity;

  await prisma.$transaction([
    prisma.inventoryItem.upsert({
      where: { productId_locationId: { productId, locationId: repLocation.id } },
      update: { quantity: newRepQuantity },
      create: { productId, locationId: repLocation.id, quantity: newRepQuantity },
    }),
    prisma.inventoryItem.upsert({
      where: { productId_locationId: { productId, locationId: warehouse.id } },
      update: { quantity: newWarehouseQuantity },
      create: { productId, locationId: warehouse.id, quantity: newWarehouseQuantity },
    }),
    prisma.stockMovement.create({
      data: {
        type: STOCK_MOVEMENT_TYPES.REP_RETURN,
        productId,
        fromLocationId: repLocation.id,
        toLocationId: warehouse.id,
        quantity,
        previousQuantity: previousRepQuantity,
        newQuantity: newRepQuantity,
        note: notes,
        createdById: admin.id,
      },
    }),
  ]);

  revalidateRepPaths(repId);
  redirect(`/admin/reps/${repId}`);
}
