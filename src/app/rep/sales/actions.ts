"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth/guards";
import { ROLES, ORDER_SOURCES, ORDER_STATUSES, PAYMENT_METHODS, PAYMENT_STATUSES, STOCK_MOVEMENT_TYPES } from "@/lib/constants";
import { repSaleSchema } from "@/lib/validation/repSale";

export interface RepSaleState {
  error?: string;
}

/** Thrown inside the sale transaction when the rep's car stock is no
 * longer sufficient at commit time — caught outside to return a clean
 * Arabic message instead of a raw transaction rollback error. */
class InsufficientStockError extends Error {}

const PARSE_ERROR_MESSAGE = "بيانات البيع غير صالحة";

function generateOrderNumber(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const random = Math.floor(1000 + Math.random() * 9000);
  return `OVI-${y}${m}${d}-${random}`;
}

function revalidateRepSalePaths(orderNumber: string): void {
  revalidatePath("/rep");
  revalidatePath("/rep/sales");
  revalidatePath(`/rep/sales/${orderNumber}`);
  revalidatePath("/rep/stock");
  revalidatePath("/rep/movements");
  revalidatePath("/admin/orders");
  revalidatePath(`/admin/orders/${orderNumber}`);
  revalidatePath("/admin");
}

export async function createRepSale(_prevState: RepSaleState, formData: FormData): Promise<RepSaleState> {
  const user = await requireRole([ROLES.SALES_REPRESENTATIVE]);

  const parsed = repSaleSchema.safeParse({
    productId: formData.get("productId")?.toString() ?? "",
    quantity: formData.get("quantity")?.toString() ?? "",
    unitPriceCents: formData.get("unitPriceCents")?.toString() ?? "",
    customerName: formData.get("customerName")?.toString().trim() ?? "",
    customerPhone: formData.get("customerPhone")?.toString().trim() ?? "",
    city: formData.get("city")?.toString().trim() || undefined,
    address: formData.get("address")?.toString().trim() || undefined,
    notes: formData.get("notes")?.toString().trim() || undefined,
  });

  if (!parsed.success) {
    return { error: PARSE_ERROR_MESSAGE };
  }

  const { productId, quantity, unitPriceCents, customerName, customerPhone, city, address, notes } = parsed.data;

  const rep = await prisma.salesRepresentative.findUnique({
    where: { userId: user.id },
    select: { id: true, carStockLocation: { select: { id: true } } },
  });
  if (!rep) {
    return { error: "لم يتم العثور على ملف المندوب" };
  }

  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, isActive: true },
  });
  if (!product) {
    return { error: "المنتج غير موجود" };
  }
  if (!product.isActive) {
    return { error: "لا يمكن بيع منتج غير مفعل" };
  }

  const locationId = rep.carStockLocation?.id ?? null;
  const repItem = locationId
    ? await prisma.inventoryItem.findUnique({
        where: { productId_locationId: { productId, locationId } },
        select: { quantity: true },
      })
    : null;
  const previousQuantity = repItem?.quantity ?? 0;

  if (previousQuantity <= 0) {
    return { error: "هذا المنتج غير موجود في مخزونك" };
  }
  if (quantity > previousQuantity) {
    return { error: "الكمية المطلوبة أكبر من مخزونك الحالي" };
  }
  if (!locationId) {
    return { error: "لم يتم العثور على موقع مخزون المندوب" };
  }

  const totalCents = unitPriceCents * quantity;

  let orderNumber = "";
  let succeeded = false;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    orderNumber = generateOrderNumber();
    try {
      await prisma.$transaction(async (tx) => {
        await tx.order.create({
          data: {
            orderNumber,
            source: ORDER_SOURCES.REP_SALE,
            status: ORDER_STATUSES.DELIVERED,
            stockLocationId: locationId,
            customerId: null,
            createdByRepId: rep.id,
            subtotalCents: totalCents,
            totalCents,
            contactName: customerName,
            contactPhone: customerPhone,
            city,
            shippingAddress: address,
            notes,
            paymentMethod: PAYMENT_METHODS.CASH,
            paymentStatus: PAYMENT_STATUSES.PAID,
            paidAmountCents: totalCents,
            items: {
              create: [{ productId, quantity, unitPriceCents, totalCents }],
            },
          },
        });

        // Atomic conditional decrement — never a stale read-then-write. If
        // the rep's car stock is no longer sufficient (e.g. a concurrent
        // sale of the same item), `count !== 1` and the whole sale rolls
        // back instead of driving stock negative.
        const decremented = await tx.inventoryItem.updateMany({
          where: { productId, locationId, quantity: { gte: quantity } },
          data: { quantity: { decrement: quantity } },
        });
        if (decremented.count !== 1) {
          throw new InsufficientStockError("INSUFFICIENT_STOCK");
        }

        const current = await tx.inventoryItem.findUniqueOrThrow({
          where: { productId_locationId: { productId, locationId } },
          select: { quantity: true },
        });

        await tx.stockMovement.create({
          data: {
            type: STOCK_MOVEMENT_TYPES.SALE_OUT,
            productId,
            fromLocationId: locationId,
            toLocationId: null,
            quantity,
            previousQuantity: current.quantity + quantity,
            newQuantity: current.quantity,
            note: `بيع مباشر — طلب ${orderNumber}`,
            createdById: user.id,
          },
        });
      });
      succeeded = true;
      break;
    } catch (err) {
      if (err instanceof InsufficientStockError) {
        return { error: "الكمية المطلوبة أكبر من مخزونك الحالي" };
      }
      const isDuplicateOrderNumber =
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002" &&
        (err.meta?.target as string[] | undefined)?.includes("orderNumber");
      if (!isDuplicateOrderNumber) throw err;
    }
  }

  if (!succeeded) {
    return { error: "تعذّر إنشاء رقم الطلب، حاول مرة أخرى" };
  }

  revalidateRepSalePaths(orderNumber);
  redirect(`/rep/sales/${orderNumber}`);
}
