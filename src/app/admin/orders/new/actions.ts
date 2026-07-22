"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth/guards";
import { getMainWarehouse } from "@/lib/inventory";
import {
  ROLES,
  MERCHANT_STATUSES,
  ORDER_SOURCES,
  ORDER_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  STOCK_MOVEMENT_TYPES,
} from "@/lib/constants";
import { manualOrderSchema, MANUAL_ORDER_CUSTOMER_MODES } from "@/lib/validation/manualOrder";

export interface ManualOrderState {
  error?: string;
}

/** Thrown inside the order transaction when a line's Main Warehouse stock
 * is no longer sufficient at commit time — caught outside to return a
 * clean Arabic message instead of a raw transaction rollback error. */
class InsufficientStockError extends Error {
  constructor(public readonly productName: string) {
    super("INSUFFICIENT_STOCK");
  }
}

const PARSE_ERROR_MESSAGE = "بيانات الطلب غير صالحة";

function generateOrderNumber(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const random = Math.floor(1000 + Math.random() * 9000);
  return `OVI-${y}${m}${d}-${random}`;
}

function revalidateManualOrderPaths(orderNumber: string): void {
  revalidatePath("/admin/orders");
  revalidatePath(`/admin/orders/${orderNumber}`);
  revalidatePath(`/admin/orders/${orderNumber}/invoice`);
  revalidatePath("/admin/inventory");
  revalidatePath("/admin/inventory/movements");
  revalidatePath("/admin");
}

export async function createManualOrder(
  _prevState: ManualOrderState,
  formData: FormData,
): Promise<ManualOrderState> {
  const admin = await requireRole([ROLES.ADMIN]);

  let items: unknown;
  try {
    items = JSON.parse(formData.get("items")?.toString() ?? "[]");
  } catch {
    return { error: PARSE_ERROR_MESSAGE };
  }

  const parsed = manualOrderSchema.safeParse({
    customerMode: formData.get("customerMode")?.toString() ?? "",
    customerId: formData.get("customerId")?.toString() || undefined,
    merchantId: formData.get("merchantId")?.toString() || undefined,
    contactName: formData.get("contactName")?.toString().trim() ?? "",
    contactPhone: formData.get("contactPhone")?.toString().trim() ?? "",
    city: formData.get("city")?.toString().trim() || undefined,
    address: formData.get("address")?.toString().trim() || undefined,
    notes: formData.get("notes")?.toString().trim() || undefined,
    discountCents: formData.get("discountCents")?.toString() || "0",
    paidAmountCents: formData.get("paidAmountCents")?.toString() ?? "0",
    items,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? PARSE_ERROR_MESSAGE };
  }

  const { customerMode, contactName, contactPhone, city, address, notes, discountCents, paidAmountCents } =
    parsed.data;

  // ---------------------------------------------------------------------
  // Resolve customer/merchant identity server-side — the client only
  // *suggests* a mode/id, every reference is re-verified against the DB.
  // ---------------------------------------------------------------------
  let resolvedCustomerId: string | null = null;
  let resolvedMerchantId: string | null = null;

  if (customerMode === MANUAL_ORDER_CUSTOMER_MODES.EXISTING_CUSTOMER) {
    if (!parsed.data.customerId) {
      return { error: "اختر عميلاً موجوداً" };
    }
    const customer = await prisma.user.findUnique({
      where: { id: parsed.data.customerId },
      select: { id: true, role: true, isActive: true },
    });
    if (!customer || customer.role !== ROLES.RETAIL_CUSTOMER || !customer.isActive) {
      return { error: "العميل المحدد غير صالح" };
    }
    resolvedCustomerId = customer.id;
  } else if (customerMode === MANUAL_ORDER_CUSTOMER_MODES.EXISTING_MERCHANT) {
    if (!parsed.data.merchantId) {
      return { error: "اختر تاجراً معتمداً" };
    }
    const merchant = await prisma.merchant.findUnique({
      where: { id: parsed.data.merchantId },
      select: { id: true, status: true, userId: true, user: { select: { isActive: true } } },
    });
    if (!merchant || merchant.status !== MERCHANT_STATUSES.APPROVED || !merchant.user.isActive) {
      return { error: "التاجر المحدد غير معتمد أو غير صالح" };
    }
    resolvedMerchantId = merchant.id;
    resolvedCustomerId = merchant.userId;
  }
  // WALK_IN: both stay null — matches the existing rep-sale pattern.

  // ---------------------------------------------------------------------
  // Resolve + validate every product line against the DB, not the client.
  // ---------------------------------------------------------------------
  const productIds = parsed.data.items.map((item) => item.productId);
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, isActive: true, name: true, nameAr: true },
  });
  const productById = new Map(products.map((product) => [product.id, product]));

  for (const item of parsed.data.items) {
    const product = productById.get(item.productId);
    if (!product) {
      return { error: "أحد المنتجات المحددة غير موجود" };
    }
    if (!product.isActive) {
      return { error: `المنتج "${product.nameAr ?? product.name}" غير مفعّل ولا يمكن بيعه` };
    }
  }

  const warehouse = await getMainWarehouse();
  const inventoryItems = await prisma.inventoryItem.findMany({
    where: { productId: { in: productIds }, locationId: warehouse.id },
    select: { productId: true, quantity: true },
  });
  const stockByProductId = new Map(inventoryItems.map((row) => [row.productId, row.quantity]));

  for (const item of parsed.data.items) {
    const product = productById.get(item.productId)!;
    const available = stockByProductId.get(item.productId) ?? 0;
    if (item.quantity > available) {
      return {
        error: `الكمية المطلوبة من "${product.nameAr ?? product.name}" تتجاوز المخزون المتوفر (${available})`,
      };
    }
  }

  // ---------------------------------------------------------------------
  // Server-computed totals — never trust anything the client summed.
  // ---------------------------------------------------------------------
  const orderItemsData = parsed.data.items.map((item) => ({
    productId: item.productId,
    quantity: item.quantity,
    unitPriceCents: item.unitPriceCents,
    totalCents: item.unitPriceCents * item.quantity,
  }));
  const subtotalCents = orderItemsData.reduce((sum, item) => sum + item.totalCents, 0);

  if (discountCents > subtotalCents) {
    return { error: "الخصم أكبر من المجموع الفرعي" };
  }

  const totalCents = subtotalCents - discountCents;

  if (paidAmountCents > totalCents) {
    return { error: "المبلغ المستلم أكبر من إجمالي الطلب" };
  }

  let paymentStatus: string = PAYMENT_STATUSES.PENDING;
  if (paidAmountCents >= totalCents && totalCents > 0) {
    paymentStatus = PAYMENT_STATUSES.PAID;
  } else if (paidAmountCents > 0) {
    paymentStatus = PAYMENT_STATUSES.PARTIAL;
  }

  let orderNumber = "";
  let succeeded = false;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    orderNumber = generateOrderNumber();
    try {
      await prisma.$transaction(async (tx) => {
        await tx.order.create({
          data: {
            orderNumber,
            source: ORDER_SOURCES.ADMIN_MANUAL,
            status: ORDER_STATUSES.CONFIRMED,
            stockLocationId: warehouse.id,
            customerId: resolvedCustomerId,
            merchantId: resolvedMerchantId,
            subtotalCents,
            discountCents,
            totalCents,
            contactName,
            contactPhone,
            city,
            shippingAddress: address,
            notes,
            paymentMethod: PAYMENT_METHODS.CASH,
            paymentStatus,
            paidAmountCents,
            items: { create: orderItemsData },
          },
        });

        // Atomic conditional decrement per line — never writes an absolute
        // quantity computed from a stale pre-transaction read. `count !==
        // 1` means a concurrent order already consumed the stock, so this
        // whole order (and any lines already decremented in this loop)
        // rolls back — nothing is oversold.
        for (const item of parsed.data.items) {
          const decremented = await tx.inventoryItem.updateMany({
            where: {
              productId: item.productId,
              locationId: warehouse.id,
              quantity: { gte: item.quantity },
            },
            data: { quantity: { decrement: item.quantity } },
          });

          if (decremented.count !== 1) {
            const product = productById.get(item.productId);
            throw new InsufficientStockError(product?.nameAr ?? product?.name ?? item.productId);
          }

          const current = await tx.inventoryItem.findUniqueOrThrow({
            where: { productId_locationId: { productId: item.productId, locationId: warehouse.id } },
            select: { quantity: true },
          });

          await tx.stockMovement.create({
            data: {
              type: STOCK_MOVEMENT_TYPES.SALE_OUT,
              productId: item.productId,
              fromLocationId: warehouse.id,
              toLocationId: null,
              quantity: item.quantity,
              previousQuantity: current.quantity + item.quantity,
              newQuantity: current.quantity,
              note: `طلب يدوي — طلب ${orderNumber}`,
              createdById: admin.id,
            },
          });
        }
      });
      succeeded = true;
      break;
    } catch (err) {
      if (err instanceof InsufficientStockError) {
        return {
          error: `الكمية المطلوبة من "${err.productName}" لم تعد متوفرة، يرجى تحديث الطلب`,
        };
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

  revalidateManualOrderPaths(orderNumber);
  redirect(`/admin/orders/${orderNumber}/invoice`);
}
