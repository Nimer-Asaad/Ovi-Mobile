"use server";

import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireCartEligibleUser } from "@/lib/auth/guards";
import { getCurrentUserCart, getAvailableStock } from "@/lib/cart";
import { getPriceModeForUser, readCatalogPriceCents } from "@/lib/catalog-queries";
import { getMainWarehouse } from "@/lib/inventory";
import { checkoutSchema } from "@/lib/validation/checkout";
import { ORDER_SOURCES, ORDER_STATUSES, PAYMENT_METHODS, PAYMENT_STATUSES, STOCK_MOVEMENT_TYPES } from "@/lib/constants";
import type { z } from "zod";

export interface CheckoutState {
  error?: string;
  fieldErrors?: Record<string, string>;
}

/** Thrown inside the checkout transaction when a line's Main Warehouse
 * stock is no longer sufficient at commit time — caught outside to return
 * a clean Arabic message instead of a raw transaction rollback error. */
class InsufficientStockError extends Error {
  constructor(public readonly productName: string) {
    super("INSUFFICIENT_STOCK");
  }
}

function fieldErrorsFrom(error: z.ZodError) {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path[0];
    if (typeof key === "string" && !fieldErrors[key]) fieldErrors[key] = issue.message;
  }
  return fieldErrors;
}

function generateOrderNumber(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const random = Math.floor(1000 + Math.random() * 9000);
  return `OVI-${y}${m}${d}-${random}`;
}

export async function placeOrder(_prevState: CheckoutState, formData: FormData): Promise<CheckoutState> {
  const user = await requireCartEligibleUser();

  const parsed = checkoutSchema.safeParse({
    contactName: formData.get("contactName")?.toString().trim() ?? "",
    contactPhone: formData.get("contactPhone")?.toString().trim() ?? "",
    city: formData.get("city")?.toString().trim() ?? "",
    address: formData.get("address")?.toString().trim() ?? "",
    notes: formData.get("notes")?.toString().trim() || undefined,
  });

  if (!parsed.success) {
    return { fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  const cart = await getCurrentUserCart(user);
  if (!cart || cart.items.length === 0) {
    return { error: "سلتك فارغة" };
  }

  // Re-check stock/active-ness at submit time — never trust what the cart
  // page last rendered.
  for (const item of cart.items) {
    if (!item.product.isActive) {
      return { error: `المنتج "${item.product.name}" لم يعد متوفراً` };
    }
    const availableStock = getAvailableStock(item.product);
    if (item.quantity > availableStock) {
      return {
        error: `الكمية المطلوبة من "${item.product.name}" تتجاوز المخزون المتوفر (${availableStock})`,
      };
    }
  }

  // Main Warehouse only — rep car stock is never part of storefront
  // checkout availability (matches getAvailableStock/STOCK_CHECK_PRODUCT_SELECT).
  const warehouse = await getMainWarehouse();

  const isWholesaleOrder = getPriceModeForUser(user) === "wholesale";

  const orderItemsData = cart.items.map((item) => {
    const unitPriceCents = readCatalogPriceCents(item.product);
    return {
      productId: item.product.id,
      quantity: item.quantity,
      unitPriceCents,
      totalCents: unitPriceCents * item.quantity,
    };
  });

  const subtotalCents = orderItemsData.reduce((sum, item) => sum + item.totalCents, 0);

  let merchantId: string | undefined;
  if (isWholesaleOrder) {
    const merchant = await prisma.merchant.findUnique({ where: { userId: user.id } });
    merchantId = merchant?.id;
  }

  const orderData = {
    source: isWholesaleOrder ? ORDER_SOURCES.WHOLESALE : ORDER_SOURCES.RETAIL,
    status: ORDER_STATUSES.PENDING,
    customerId: user.id,
    merchantId,
    stockLocationId: warehouse.id,
    subtotalCents,
    totalCents: subtotalCents,
    contactName: parsed.data.contactName,
    contactPhone: parsed.data.contactPhone,
    city: parsed.data.city,
    shippingAddress: parsed.data.address,
    notes: parsed.data.notes,
    paymentMethod: PAYMENT_METHODS.CASH_ON_DELIVERY,
    paymentStatus: PAYMENT_STATUSES.PENDING,
    items: { create: orderItemsData },
  };

  let orderNumber = "";
  let createdOrderId = "";

  for (let attempt = 0; attempt < 3; attempt += 1) {
    orderNumber = generateOrderNumber();
    try {
      const order = await prisma.$transaction(async (tx) => {
        const created = await tx.order.create({ data: { ...orderData, orderNumber } });

        // Decrement Main Warehouse stock atomically, one line at a time —
        // `quantity: { gte: item.quantity }` in the `where` makes this a
        // single conditional UPDATE, not a stale read-then-write, so a
        // concurrent checkout on the same product can never both succeed
        // and drive stock negative. If the row no longer has enough stock
        // (or no longer exists), `count` is 0 and the whole order rolls
        // back — nothing is oversold.
        for (const item of cart.items) {
          const decremented = await tx.inventoryItem.updateMany({
            where: {
              productId: item.product.id,
              locationId: warehouse.id,
              quantity: { gte: item.quantity },
            },
            data: { quantity: { decrement: item.quantity } },
          });

          if (decremented.count !== 1) {
            throw new InsufficientStockError(item.product.name);
          }

          const current = await tx.inventoryItem.findUniqueOrThrow({
            where: { productId_locationId: { productId: item.product.id, locationId: warehouse.id } },
            select: { quantity: true },
          });

          await tx.stockMovement.create({
            data: {
              type: STOCK_MOVEMENT_TYPES.SALE_OUT,
              productId: item.product.id,
              fromLocationId: warehouse.id,
              toLocationId: null,
              quantity: item.quantity,
              previousQuantity: current.quantity + item.quantity,
              newQuantity: current.quantity,
              note: `طلب ${orderNumber}`,
              createdById: user.id,
            },
          });
        }

        await tx.cartItem.deleteMany({ where: { cartId: cart.id } });

        return created;
      });

      createdOrderId = order.id;
      break;
    } catch (err) {
      if (err instanceof InsufficientStockError) {
        return {
          error: `الكمية المطلوبة من "${err.productName}" لم تعد متوفرة، يرجى تحديث السلة`,
        };
      }
      const isDuplicateOrderNumber =
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002" &&
        (err.meta?.target as string[] | undefined)?.includes("orderNumber");
      if (!isDuplicateOrderNumber) throw err;
    }
  }

  if (!createdOrderId) {
    return { error: "تعذّر إنشاء رقم الطلب، حاول مرة أخرى" };
  }

  redirect(`/orders/${orderNumber}`);
}
