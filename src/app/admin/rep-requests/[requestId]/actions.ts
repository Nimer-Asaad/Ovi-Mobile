"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth/guards";
import { ROLES, STOCK_REQUEST_STATUSES, STOCK_MOVEMENT_TYPES } from "@/lib/constants";
import { getMainWarehouse } from "@/lib/inventory";
import { getOrCreateRepLocation } from "@/lib/reps";
import { repStockRequestReviewSchema } from "@/lib/validation/repStockRequest";

export interface RepStockRequestActionState {
  error?: string;
}

const PARSE_ERROR_MESSAGE = "بيانات المراجعة غير صالحة";

function revalidateRequestPaths(requestId: string, salesRepId: string): void {
  revalidatePath("/admin/rep-requests");
  revalidatePath(`/admin/rep-requests/${requestId}`);
  revalidatePath(`/admin/rep-requests/${requestId}/print`);
  revalidatePath(`/admin/reps/${salesRepId}`);
  revalidatePath("/admin/inventory");
  revalidatePath("/admin/inventory/movements");
  revalidatePath("/admin");
  revalidatePath("/rep");
  revalidatePath("/rep/requests");
  revalidatePath(`/rep/requests/${requestId}`);
  revalidatePath("/rep/stock");
  revalidatePath("/rep/movements");
}

/** Admin sets/edits approved quantities per line + an admin note. Allowed
 * from PENDING or REVIEWED (re-review before preparing is fine) — never
 * touches InventoryItem/StockMovement. */
export async function reviewStockRequest(
  requestId: string,
  _prevState: RepStockRequestActionState,
  formData: FormData,
): Promise<RepStockRequestActionState> {
  await requireRole([ROLES.ADMIN]);

  const request = await prisma.stockRequest.findUnique({
    where: { id: requestId },
    select: {
      id: true,
      salesRepId: true,
      status: true,
      items: { select: { id: true, requestedQuantity: true } },
    },
  });
  if (!request) {
    return { error: "الطلب غير موجود" };
  }
  const reviewableStatuses: string[] = [STOCK_REQUEST_STATUSES.PENDING, STOCK_REQUEST_STATUSES.REVIEWED];
  if (!reviewableStatuses.includes(request.status)) {
    return { error: "لا يمكن مراجعة هذا الطلب في حالته الحالية" };
  }

  let items: unknown;
  try {
    items = JSON.parse(formData.get("items")?.toString() ?? "[]");
  } catch {
    return { error: PARSE_ERROR_MESSAGE };
  }

  const parsed = repStockRequestReviewSchema.safeParse({
    adminNote: formData.get("adminNote")?.toString().trim() || undefined,
    items,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? PARSE_ERROR_MESSAGE };
  }

  const requestedById = new Map(request.items.map((item) => [item.id, item.requestedQuantity]));

  for (const line of parsed.data.items) {
    const requestedQuantity = requestedById.get(line.itemId);
    if (requestedQuantity === undefined) {
      return { error: "أحد عناصر الطلب غير معروف" };
    }
    if (line.approvedQuantity > requestedQuantity) {
      return { error: "لا يمكن الموافقة على كمية أكبر من الكمية المطلوبة — استخدم صفحة تخصيص المخزون المباشر" };
    }
  }

  await prisma.$transaction([
    ...parsed.data.items.map((line) =>
      prisma.stockRequestItem.update({
        where: { id: line.itemId },
        data: { approvedQuantity: line.approvedQuantity },
      }),
    ),
    prisma.stockRequest.update({
      where: { id: requestId },
      data: {
        status: STOCK_REQUEST_STATUSES.REVIEWED,
        adminNote: parsed.data.adminNote,
        reviewedAt: new Date(),
      },
    }),
  ]);

  revalidateRequestPaths(requestId, request.salesRepId);
  return {};
}

/** Terminal — rejects the whole request, no stock ever touched. */
export async function rejectStockRequest(
  requestId: string,
  _prevState: RepStockRequestActionState,
  formData: FormData,
): Promise<RepStockRequestActionState> {
  await requireRole([ROLES.ADMIN]);

  const request = await prisma.stockRequest.findUnique({
    where: { id: requestId },
    select: { id: true, salesRepId: true, status: true },
  });
  if (!request) {
    return { error: "الطلب غير موجود" };
  }
  const reviewableStatuses: string[] = [STOCK_REQUEST_STATUSES.PENDING, STOCK_REQUEST_STATUSES.REVIEWED];
  if (!reviewableStatuses.includes(request.status)) {
    return { error: "لا يمكن رفض هذا الطلب في حالته الحالية" };
  }

  const adminNote = formData.get("adminNote")?.toString().trim() || undefined;

  await prisma.stockRequest.update({
    where: { id: requestId },
    data: { status: STOCK_REQUEST_STATUSES.REJECTED, adminNote, rejectedAt: new Date() },
  });

  revalidateRequestPaths(requestId, request.salesRepId);
  return {};
}

/** Status-only flip — goods are physically staged, still no stock
 * transfer. Only reachable from REVIEWED. */
export async function markStockRequestPrepared(
  requestId: string,
  _prevState: RepStockRequestActionState,
): Promise<RepStockRequestActionState> {
  void _prevState;
  await requireRole([ROLES.ADMIN]);

  const request = await prisma.stockRequest.findUnique({
    where: { id: requestId },
    select: { id: true, salesRepId: true, status: true },
  });
  if (!request) {
    return { error: "الطلب غير موجود" };
  }
  if (request.status !== STOCK_REQUEST_STATUSES.REVIEWED) {
    return { error: "يجب مراجعة الطلب أولاً قبل تجهيزه" };
  }

  await prisma.stockRequest.update({
    where: { id: requestId },
    data: { status: STOCK_REQUEST_STATUSES.PREPARED, preparedAt: new Date() },
  });

  revalidateRequestPaths(requestId, request.salesRepId);
  return {};
}

/** The only action that ever mutates stock for this workflow. Only
 * reachable from PREPARED; locks the request as COMPLETED afterward. */
export async function completeStockRequest(
  requestId: string,
  _prevState: RepStockRequestActionState,
): Promise<RepStockRequestActionState> {
  void _prevState;
  const admin = await requireRole([ROLES.ADMIN]);

  const request = await prisma.stockRequest.findUnique({
    where: { id: requestId },
    select: {
      id: true,
      requestNumber: true,
      salesRepId: true,
      status: true,
      salesRep: { select: { id: true, user: { select: { name: true } } } },
      items: {
        select: { id: true, productId: true, requestedQuantity: true, approvedQuantity: true },
      },
    },
  });
  if (!request) {
    return { error: "الطلب غير موجود" };
  }
  if (request.status !== STOCK_REQUEST_STATUSES.PREPARED) {
    return { error: "لا يمكن استلام هذا الطلب في حالته الحالية" };
  }

  const linesToTransfer = request.items.filter(
    (item): item is typeof item & { approvedQuantity: number } =>
      item.approvedQuantity !== null && item.approvedQuantity > 0,
  );
  if (linesToTransfer.length === 0) {
    return { error: "لا توجد كميات موافق عليها لتحويلها" };
  }

  const warehouse = await getMainWarehouse();
  const repLocation = await getOrCreateRepLocation(request.salesRep.id, request.salesRep.user.name);

  const productIds = linesToTransfer.map((line) => line.productId);
  const [warehouseItems, repItems] = await Promise.all([
    prisma.inventoryItem.findMany({
      where: { productId: { in: productIds }, locationId: warehouse.id },
      select: { productId: true, quantity: true },
    }),
    prisma.inventoryItem.findMany({
      where: { productId: { in: productIds }, locationId: repLocation.id },
      select: { productId: true, quantity: true },
    }),
  ]);
  const warehouseQtyByProduct = new Map(warehouseItems.map((item) => [item.productId, item.quantity]));
  const repQtyByProduct = new Map(repItems.map((item) => [item.productId, item.quantity]));

  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, name: true, nameAr: true },
  });
  const productById = new Map(products.map((product) => [product.id, product]));

  for (const line of linesToTransfer) {
    const available = warehouseQtyByProduct.get(line.productId) ?? 0;
    if (line.approvedQuantity > available) {
      const product = productById.get(line.productId);
      return {
        error: `الكمية المتوفرة من "${product?.nameAr ?? product?.name ?? line.productId}" في المستودع الرئيسي غير كافية (${available})`,
      };
    }
  }

  const noteSuffix = request.requestNumber ?? request.id;
  const ALREADY_PROCESSED = "STOCK_REQUEST_ALREADY_PROCESSED";

  try {
    await prisma.$transaction(async (tx) => {
      // Re-verify inside the transaction that this request hasn't already
      // been completed by a concurrent submission before mutating anything.
      const current = await tx.stockRequest.findUnique({ where: { id: requestId }, select: { status: true } });
      if (current?.status !== STOCK_REQUEST_STATUSES.PREPARED) {
        throw new Error(ALREADY_PROCESSED);
      }

      for (const line of linesToTransfer) {
        const previousWarehouseQuantity = warehouseQtyByProduct.get(line.productId) ?? 0;
        const previousRepQuantity = repQtyByProduct.get(line.productId) ?? 0;
        const newWarehouseQuantity = previousWarehouseQuantity - line.approvedQuantity;
        const newRepQuantity = previousRepQuantity + line.approvedQuantity;

        await tx.inventoryItem.upsert({
          where: { productId_locationId: { productId: line.productId, locationId: warehouse.id } },
          update: { quantity: newWarehouseQuantity },
          create: { productId: line.productId, locationId: warehouse.id, quantity: newWarehouseQuantity },
        });
        await tx.inventoryItem.upsert({
          where: { productId_locationId: { productId: line.productId, locationId: repLocation.id } },
          update: { quantity: newRepQuantity },
          create: { productId: line.productId, locationId: repLocation.id, quantity: newRepQuantity },
        });
        await tx.stockMovement.create({
          data: {
            type: STOCK_MOVEMENT_TYPES.REP_ASSIGNMENT,
            productId: line.productId,
            fromLocationId: warehouse.id,
            toLocationId: repLocation.id,
            quantity: line.approvedQuantity,
            previousQuantity: previousRepQuantity,
            newQuantity: newRepQuantity,
            note: `استلام طلب مخزون سيارة — طلب ${noteSuffix}`,
            createdById: admin.id,
          },
        });
      }

      await tx.stockRequest.update({
        where: { id: requestId },
        data: { status: STOCK_REQUEST_STATUSES.COMPLETED, completedAt: new Date() },
      });
    });
  } catch (err) {
    if (err instanceof Error && err.message === ALREADY_PROCESSED) {
      return { error: "تم استلام هذا الطلب بالفعل" };
    }
    throw err;
  }

  revalidateRequestPaths(requestId, request.salesRepId);
  return {};
}
