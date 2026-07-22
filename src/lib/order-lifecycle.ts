import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ORDER_STATUSES, STOCK_MOVEMENT_TYPES } from "@/lib/constants";
import type { OrderStatus } from "@/types";
import {
  getValidNextOrderStatuses,
  transitionRestoresInventory,
} from "@/lib/order-lifecycle-rules";

export {
  getValidNextOrderStatuses,
  isTerminalOrderStatus,
  transitionRestoresInventory,
} from "@/lib/order-lifecycle-rules";

export const LEGACY_PROVENANCE_ERROR =
  "لا يمكن تنفيذ الإلغاء أو الإرجاع تلقائيًا لهذا الطلب القديم لأن موقع المخزون الأصلي غير مسجل. راجع المخزون يدويًا أولًا.";

export type OrderLifecycleErrorCode =
  | "ORDER_NOT_FOUND"
  | "INVALID_TRANSITION"
  | "MISSING_REASON"
  | "MISSING_STOCK_PROVENANCE"
  | "MISSING_INVENTORY"
  | "COMPENSATION_CONFLICT"
  | "CONCURRENT_UPDATE";

export type OrderLifecycleResult =
  | { ok: true; noOp: boolean; orderNumber: string }
  | { ok: false; code: OrderLifecycleErrorCode; message: string };

class LifecycleDomainError extends Error {
  constructor(public readonly code: OrderLifecycleErrorCode, message: string) {
    super(message);
  }
}

interface TransitionOrderStatusInput {
  orderNumber: string;
  requestedStatus: OrderStatus;
  reason?: string;
  actorUserId: string;
}

const ORDER_SELECT = {
  id: true,
  orderNumber: true,
  status: true,
  source: true,
  stockLocationId: true,
  inventoryRestoredAt: true,
  items: { select: { productId: true, quantity: true } },
  inventoryCompensation: { select: { id: true, type: true } },
} satisfies Prisma.OrderSelect;

function isRetryableTransactionError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
}

function isCompensationUniqueError(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") return false;
  const target = error.meta?.target;
  return Array.isArray(target) ? target.includes("orderId") : String(target ?? "").includes("orderId");
}

async function resolveConcurrentCompensation(
  orderNumber: string,
  requestedStatus: OrderStatus,
): Promise<OrderLifecycleResult> {
  const current = await prisma.order.findUnique({
    where: { orderNumber },
    select: { status: true, inventoryCompensation: { select: { id: true } } },
  });
  if (current?.status === requestedStatus && current.inventoryCompensation) {
    return { ok: true, noOp: true, orderNumber };
  }
  return {
    ok: false,
    code: "COMPENSATION_CONFLICT",
    message: "تم تنفيذ معالجة مخزون لهذا الطلب مسبقًا بحالة مختلفة",
  };
}

export async function transitionOrderStatus(
  input: TransitionOrderStatusInput,
): Promise<OrderLifecycleResult> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const order = await tx.order.findUnique({
            where: { orderNumber: input.orderNumber },
            select: ORDER_SELECT,
          });
          if (!order) {
            throw new LifecycleDomainError("ORDER_NOT_FOUND", "الطلب غير موجود");
          }

          if (order.status === input.requestedStatus) {
            return { ok: true, noOp: true, orderNumber: order.orderNumber } as const;
          }

          const validNextStatuses = getValidNextOrderStatuses(order.status, order.source);
          if (!validNextStatuses.includes(input.requestedStatus)) {
            throw new LifecycleDomainError("INVALID_TRANSITION", "لا يمكن نقل الطلب إلى هذه الحالة من حالته الحالية");
          }

          const restoresInventory = transitionRestoresInventory(input.requestedStatus);
          if (restoresInventory && !input.reason) {
            throw new LifecycleDomainError("MISSING_REASON", "سبب الإلغاء أو الإرجاع مطلوب");
          }

          if (restoresInventory) {
            if (!order.stockLocationId) {
              throw new LifecycleDomainError("MISSING_STOCK_PROVENANCE", LEGACY_PROVENANCE_ERROR);
            }
            if (order.inventoryRestoredAt || order.inventoryCompensation) {
              throw new LifecycleDomainError(
                "COMPENSATION_CONFLICT",
                "تمت إعادة مخزون هذا الطلب مسبقًا",
              );
            }

            const movementType =
              input.requestedStatus === ORDER_STATUSES.CANCELLED
                ? STOCK_MOVEMENT_TYPES.ORDER_RELEASED
                : STOCK_MOVEMENT_TYPES.RETURN_IN;

            await tx.orderInventoryCompensation.create({
              data: {
                orderId: order.id,
                stockLocationId: order.stockLocationId,
                type: movementType,
                createdById: input.actorUserId,
              },
            });

            for (const item of order.items) {
              const incremented = await tx.inventoryItem.updateMany({
                where: { productId: item.productId, locationId: order.stockLocationId },
                data: { quantity: { increment: item.quantity } },
              });
              if (incremented.count !== 1) {
                throw new LifecycleDomainError(
                  "MISSING_INVENTORY",
                  "تعذر العثور على سجل المخزون الأصلي لأحد منتجات الطلب",
                );
              }

              const current = await tx.inventoryItem.findUniqueOrThrow({
                where: {
                  productId_locationId: {
                    productId: item.productId,
                    locationId: order.stockLocationId,
                  },
                },
                select: { quantity: true },
              });

              await tx.stockMovement.create({
                data: {
                  type: movementType,
                  productId: item.productId,
                  fromLocationId: null,
                  toLocationId: order.stockLocationId,
                  quantity: item.quantity,
                  previousQuantity: current.quantity - item.quantity,
                  newQuantity: current.quantity,
                  note: `معالجة مخزون الطلب ${order.orderNumber}`,
                  createdById: input.actorUserId,
                },
              });
            }
          }

          const updated = await tx.order.updateMany({
            where: { id: order.id, status: order.status },
            data: {
              status: input.requestedStatus,
              ...(restoresInventory ? { inventoryRestoredAt: new Date() } : {}),
            },
          });
          if (updated.count !== 1) {
            throw new LifecycleDomainError("CONCURRENT_UPDATE", "تغيرت حالة الطلب بالتزامن، حدّث الصفحة وحاول مجددًا");
          }

          await tx.orderStatusHistory.create({
            data: {
              orderId: order.id,
              fromStatus: order.status,
              toStatus: input.requestedStatus,
              reason: input.reason,
              changedById: input.actorUserId,
            },
          });

          return { ok: true, noOp: false, orderNumber: order.orderNumber } as const;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (error instanceof LifecycleDomainError) {
        return { ok: false, code: error.code, message: error.message };
      }
      if (isCompensationUniqueError(error)) {
        return resolveConcurrentCompensation(input.orderNumber, input.requestedStatus);
      }
      if (isRetryableTransactionError(error) && attempt < 2) continue;
      throw error;
    }
  }

  return { ok: false, code: "CONCURRENT_UPDATE", message: "تغيرت حالة الطلب بالتزامن، حاول مجددًا" };
}
