"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth/guards";
import { ROLES, ORDER_SOURCES, ORDER_STATUSES, PAYMENT_METHODS, PAYMENT_STATUSES, STOCK_MOVEMENT_TYPES } from "@/lib/constants";
import { repSaleSchema } from "@/lib/validation/repSale";
import { decrementInventoryAtomic, recordStockMovement, InsufficientInventoryError } from "@/lib/inventory-transactions";

export interface RepSaleState {
  error?: string;
}

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
    select: { id: true, sku: true, isActive: true, name: true, nameAr: true, variantMode: true, colorOptions: { select: { colorId: true } }, variants: { where: { isActive: true }, select: { id: true, variantCode: true, color: { select: { name: true, nameAr: true } }, phoneModel: { select: { name: true, nameAr: true, phoneBrand: { select: { name: true, nameAr: true } } } } } } },
  });
  const productById = new Map(products.map((product) => [product.id, product]));

  const inventoryItems = await prisma.inventoryItem.findMany({
    where: { locationId, productId: { in: productIds } },
    select: { productId: true, colorId: true, variantId: true, quantity: true },
  });
  const stockByLineKey = new Map(
    inventoryItems.map((item) => [`${item.productId}:${item.variantId ?? `legacy:${item.colorId ?? ""}`}`, item.quantity]),
  );

  const lines = saleItems.map((item) => ({ ...item, colorId: item.colorId ?? null, variantId: item.variantId ?? null }));

  for (const item of lines) {
    const product = productById.get(item.productId);
    if (!product) {
      return { error: "أحد المنتجات المحددة غير موجود" };
    }
    if (!product.isActive) {
      return { error: `المنتج "${product.nameAr ?? product.name}" غير مفعّل ولا يمكن بيعه` };
    }
    if (item.colorId && !product.colorOptions.some((option) => option.colorId === item.colorId)) {
      return { error: `اللون المحدد لا ينتمي للمنتج "${product.nameAr ?? product.name}"` };
    }
    if (product.variantMode === "PHONE_COMPATIBILITY" && (!item.variantId || !product.variants.some((variant) => variant.id === item.variantId))) return { error: `اختر Variant صالحاً للمنتج "${product.nameAr ?? product.name}"` };
    if (product.variantMode !== "PHONE_COMPATIBILITY" && item.variantId) return { error: "Variant لا يتبع المنتج المحدد" };
    const available = stockByLineKey.get(`${item.productId}:${item.variantId ?? `legacy:${item.colorId ?? ""}`}`) ?? 0;
    if (available <= 0) {
      return { error: `المنتج "${product.nameAr ?? product.name}" غير موجود في مخزونك` };
    }
    if (item.quantity > available) {
      return { error: `الكمية المطلوبة لـ "${product.nameAr ?? product.name}" أكبر من مخزونك الحالي` };
    }
  }

  const totalCents = lines.reduce((sum, item) => sum + item.unitPriceCents * item.quantity, 0);

  let orderNumber = "";
  let succeeded = false;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    orderNumber = generateOrderNumber();
    try {
      await prisma.$transaction(async (tx) => {
        const requestedVariantIds = lines.flatMap((item) => item.variantId ? [item.variantId] : []);
        if (requestedVariantIds.length > 0) {
          const activeVariants = await tx.productVariant.count({ where: { id: { in: requestedVariantIds }, isActive: true } });
          if (activeVariants !== new Set(requestedVariantIds).size) throw new Error("INACTIVE_VARIANT");
        }
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
              create: lines.map((item) => ({
                productId: item.productId,
                colorId: item.colorId,
                variantId: item.variantId,
                productNameSnapshot: productById.get(item.productId)?.nameAr ?? productById.get(item.productId)?.name,
                productSkuSnapshot: productById.get(item.productId)?.sku,
                variantCodeSnapshot: productById.get(item.productId)?.variants.find((variant) => variant.id === item.variantId)?.variantCode ?? null,
                phoneBrandSnapshot: (() => { const variant = productById.get(item.productId)?.variants.find((row) => row.id === item.variantId); return variant ? (variant.phoneModel.phoneBrand.nameAr ?? variant.phoneModel.phoneBrand.name) : null; })(),
                phoneModelSnapshot: (() => { const variant = productById.get(item.productId)?.variants.find((row) => row.id === item.variantId); return variant ? (variant.phoneModel.nameAr ?? variant.phoneModel.name) : null; })(),
                colorNameSnapshot: (() => { const variant = productById.get(item.productId)?.variants.find((row) => row.id === item.variantId); return variant?.color ? (variant.color.nameAr ?? variant.color.name) : null; })(),
                quantity: item.quantity,
                unitPriceCents: item.unitPriceCents,
                totalCents: item.unitPriceCents * item.quantity,
              })),
            },
          },
        });

        // Per line: atomic conditional decrement — never a stale
        // read-then-write. If the rep's car stock is no longer sufficient
        // (e.g. a concurrent sale of the same item), the whole sale rolls
        // back instead of driving stock negative.
        for (const item of lines) {
          const change = await decrementInventoryAtomic(
            tx,
            { productId: item.productId, colorId: item.colorId, variantId: item.variantId, locationId },
            item.quantity,
          );

          await recordStockMovement(tx, {
            type: STOCK_MOVEMENT_TYPES.SALE_OUT,
            productId: item.productId,
            colorId: item.colorId,
            variantId: item.variantId,
            fromLocationId: locationId,
            toLocationId: null,
            quantity: item.quantity,
            previousQuantity: change.previousQuantity,
            newQuantity: change.newQuantity,
            note: `بيع مباشر — طلب ${orderNumber}`,
            createdById: user.id,
          });
        }
      });
      succeeded = true;
      break;
    } catch (err) {
      if (err instanceof Error && err.message === "INACTIVE_VARIANT") return { error: "أحد خيارات المنتج لم يعد فعالاً؛ أعد اختيار الـVariant" };
      if (err instanceof InsufficientInventoryError) {
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
