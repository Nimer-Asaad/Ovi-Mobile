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

/** Creates a single Order with one OrderItem per line — same multi-line
 * shape as createStockRequest (src/app/rep/requests/new/actions.ts), lines
 * are serialized to a hidden JSON "items" input since native FormData can't
 * carry a dynamic array of objects. */
export async function createRepSale(_prevState: RepSaleState, formData: FormData): Promise<RepSaleState> {
  const user = await requireRole([ROLES.SALES_REPRESENTATIVE]);

  let items: unknown;
  try {
    items = JSON.parse(formData.get("items")?.toString() ?? "[]");
  } catch {
    return { error: PARSE_ERROR_MESSAGE };
  }

  const parsed = repSaleSchema.safeParse({
    items,
    customerName: formData.get("customerName")?.toString().trim() ?? "",
    customerPhone: formData.get("customerPhone")?.toString().trim() ?? "",
    city: formData.get("city")?.toString().trim() || undefined,
    address: formData.get("address")?.toString().trim() || undefined,
    notes: formData.get("notes")?.toString().trim() || undefined,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? PARSE_ERROR_MESSAGE };
  }

  const { items: saleItems, customerName, customerPhone, city, address, notes } = parsed.data;

  const rep = await prisma.salesRepresentative.findUnique({
    where: { userId: user.id },
    select: { id: true, carStockLocation: { select: { id: true } } },
  });
  if (!rep) {
    return { error: "لم يتم العثور على ملف المندوب" };
  }

  const locationId = rep.carStockLocation?.id ?? null;
  if (!locationId) {
    return { error: "لم يتم العثور على موقع مخزون المندوب" };
  }

  const productIds = saleItems.map((item) => item.productId);
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, isActive: true, name: true, nameAr: true },
  });
  const productById = new Map(products.map((product) => [product.id, product]));

  const inventoryItems = await prisma.inventoryItem.findMany({
    where: { locationId, productId: { in: productIds } },
    select: { productId: true, quantity: true },
  });
  const stockByProductId = new Map(inventoryItems.map((item) => [item.productId, item.quantity]));

  for (const item of saleItems) {
    const product = productById.get(item.productId);
    if (!product) {
      return { error: "أحد المنتجات المحددة غير موجود" };
    }
    if (!product.isActive) {
      return { error: `المنتج "${product.nameAr ?? product.name}" غير مفعّل ولا يمكن بيعه` };
    }
    const available = stockByProductId.get(item.productId) ?? 0;
    if (available <= 0) {
      return { error: `المنتج "${product.nameAr ?? product.name}" غير موجود في مخزونك` };
    }
    if (item.quantity > available) {
      return { error: `الكمية المطلوبة لـ "${product.nameAr ?? product.name}" أكبر من مخزونك الحالي` };
    }
  }

  const totalCents = saleItems.reduce((sum, item) => sum + item.unitPriceCents * item.quantity, 0);

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
              create: saleItems.map((item) => ({
                productId: item.productId,
                quantity: item.quantity,
                unitPriceCents: item.unitPriceCents,
                totalCents: item.unitPriceCents * item.quantity,
              })),
            },
          },
        });

        // Per line: atomic conditional decrement — never a stale
        // read-then-write. If the rep's car stock is no longer sufficient
        // (e.g. a concurrent sale of the same item), `count !== 1` and the
        // whole sale rolls back instead of driving stock negative.
        for (const item of saleItems) {
          const decremented = await tx.inventoryItem.updateMany({
            where: { productId: item.productId, locationId, quantity: { gte: item.quantity } },
            data: { quantity: { decrement: item.quantity } },
          });
          if (decremented.count !== 1) {
            throw new InsufficientStockError("INSUFFICIENT_STOCK");
          }

          const current = await tx.inventoryItem.findUniqueOrThrow({
            where: { productId_locationId: { productId: item.productId, locationId } },
            select: { quantity: true },
          });

          await tx.stockMovement.create({
            data: {
              type: STOCK_MOVEMENT_TYPES.SALE_OUT,
              productId: item.productId,
              fromLocationId: locationId,
              toLocationId: null,
              quantity: item.quantity,
              previousQuantity: current.quantity + item.quantity,
              newQuantity: current.quantity,
              note: `بيع مباشر — طلب ${orderNumber}`,
              createdById: user.id,
            },
          });
        }
      });
      succeeded = true;
      break;
    } catch (err) {
      if (err instanceof InsufficientStockError) {
        return { error: "الكمية المطلوبة أكبر من مخزونك الحالي لأحد المنتجات، حاول مرة أخرى" };
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
