"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth/guards";
import {
  ROLES,
  MANUAL_STOCK_MOVEMENT_TYPES,
  PRODUCT_VARIANT_MODES,
  PRODUCT_INVENTORY_TRACKING_MODES,
  VARIANT_ALLOCATION_STATUSES,
} from "@/lib/constants";
import { getMainWarehouse } from "@/lib/inventory";
import { stockAdjustmentSchema, bulkStockOutSchema } from "@/lib/validation/inventory";
import {
  decrementInventoryAtomic,
  incrementInventoryUpsert,
  setInventoryAbsolute,
  recordStockMovement,
  InsufficientInventoryError,
} from "@/lib/inventory-transactions";

export interface StockAdjustmentState {
  error?: string;
}

/** Thrown inside the stock-movement transaction for any validation failure
 * that depends on a fresh in-transaction read (insufficient stock, no-op
 * adjustment, negative floor) — caught outside to return the same clean
 * Arabic message as before, instead of a raw rollback error. */
class StockActionError extends Error {}

const PARSE_ERROR_MESSAGE = "بيانات التعديل غير صالحة";
const POSITIVE_QUANTITY_MESSAGE = "الكمية يجب أن تكون رقماً صحيحاً أكبر من صفر";
const NO_OP_MESSAGE = "الكمية الجديدة مساوية للكمية الحالية، لم يتم تنفيذ أي تعديل";

function revalidateInventoryPaths(productId: string): void {
  revalidatePath("/admin/inventory");
  revalidatePath("/admin/inventory/movements");
  revalidatePath("/admin/inventory/adjust");
  revalidatePath("/admin");
  revalidatePath("/admin/products");
  revalidatePath(`/admin/products/${productId}/variants`);
  revalidatePath(`/admin/products/${productId}/device-inventory`);
  revalidatePath("/products");
}

export async function createStockMovement(
  _prevState: StockAdjustmentState,
  formData: FormData,
): Promise<StockAdjustmentState> {
  const admin = await requireRole([ROLES.ADMIN]);

  const parsed = stockAdjustmentSchema.safeParse({
    productId: formData.get("productId")?.toString() ?? "",
    variantId: formData.get("variantId")?.toString() ?? "",
    deviceColorVariantId: formData.get("deviceColorVariantId")?.toString() ?? "",
    movementType: formData.get("movementType")?.toString() ?? "",
    quantity: formData.get("quantity")?.toString() ?? "",
    notes: formData.get("notes")?.toString().trim() || undefined,
  });

  if (!parsed.success) {
    return { error: PARSE_ERROR_MESSAGE };
  }

  const { productId, movementType, quantity, notes } = parsed.data;

  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: {
      id: true,
      isActive: true,
      variantMode: true,
      inventoryTrackingMode: true,
      variantAllocationStatus: true,
      // Deliberately not filtered to isActive: true — a disabled
      // variant/combination is still a valid admin stock-movement target.
      // isActive only gates customer/sale-facing flows (cart, checkout, rep
      // sale, warehouse<->rep transfers), never an admin's own count here
      // (see DeviceInventoryManager and the variants screen, which both
      // show disabled rows too).
      variants: { select: { id: true, isActive: true } },
      deviceColorVariants: { select: { id: true, isActive: true } },
    },
  });
  if (!product) {
    return { error: "المنتج غير موجود" };
  }
  if (!product.isActive) {
    return { error: "لا يمكن تعديل مخزون منتج غير مفعل" };
  }

  // Resolve the exact inventory target for this product's tracking mode —
  // mirrors the same resolution already used by addToCart/checkout/rep-sale,
  // just admin-side (no isActive requirement on the variant/combo itself).
  let resolvedVariantId: string | null = null;
  let resolvedDeviceColorVariantId: string | null = null;

  if (product.variantMode === PRODUCT_VARIANT_MODES.PHONE_COMPATIBILITY) {
    if (product.variantAllocationStatus !== VARIANT_ALLOCATION_STATUSES.READY) {
      return { error: "اعتمد توزيع المخزون القديم من صفحة الـVariants الخاصة بالمنتج قبل تعديل مخزونها من هنا" };
    }
    if (!parsed.data.variantId || !product.variants.some((variant) => variant.id === parsed.data.variantId)) {
      return { error: "اختر ماركة وموديل الهاتف بشكل صحيح" };
    }
    resolvedVariantId = parsed.data.variantId;
  } else if (parsed.data.variantId) {
    return { error: "هذا المنتج لا يستخدم Variants" };
  }

  if (product.inventoryTrackingMode === PRODUCT_INVENTORY_TRACKING_MODES.DEVICE_MODEL_COLOR) {
    if (!parsed.data.deviceColorVariantId || !product.deviceColorVariants.some((combo) => combo.id === parsed.data.deviceColorVariantId)) {
      return { error: "اختر الماركة والموديل واللون بشكل صحيح" };
    }
    resolvedDeviceColorVariantId = parsed.data.deviceColorVariantId;
  } else if (parsed.data.deviceColorVariantId) {
    return { error: "هذا المنتج لا يستخدم تركيبات الجهاز واللون" };
  }

  if (movementType !== MANUAL_STOCK_MOVEMENT_TYPES.ADJUSTMENT && quantity <= 0) {
    return { error: POSITIVE_QUANTITY_MESSAGE };
  }

  const warehouse = await getMainWarehouse();
  const key = { productId, variantId: resolvedVariantId, deviceColorVariantId: resolvedDeviceColorVariantId, locationId: warehouse.id };

  try {
    await prisma.$transaction(async (tx) => {
      if (movementType === MANUAL_STOCK_MOVEMENT_TYPES.ADJUSTMENT) {
        if (quantity < 0) {
          throw new StockActionError("لا يمكن أن يكون المخزون أقل من صفر");
        }

        const change = await setInventoryAbsolute(tx, key, quantity);
        if (change.previousQuantity === change.newQuantity) {
          throw new StockActionError(NO_OP_MESSAGE);
        }

        await recordStockMovement(tx, {
          type: movementType,
          productId,
          variantId: resolvedVariantId,
          deviceColorVariantId: resolvedDeviceColorVariantId,
          quantity: Math.abs(change.newQuantity - change.previousQuantity),
          previousQuantity: change.previousQuantity,
          newQuantity: change.newQuantity,
          note: notes,
          createdById: admin.id,
          toLocationId: warehouse.id,
        });
        return;
      }

      const isStockOut = movementType === MANUAL_STOCK_MOVEMENT_TYPES.STOCK_OUT;
      let change;
      try {
        change = isStockOut
          ? await decrementInventoryAtomic(tx, key, quantity)
          : await incrementInventoryUpsert(tx, key, quantity);
      } catch (err) {
        if (err instanceof InsufficientInventoryError) {
          throw new StockActionError("الكمية المطلوب إخراجها أكبر من المخزون الحالي");
        }
        throw err;
      }

      await recordStockMovement(tx, {
        type: movementType,
        productId,
        variantId: resolvedVariantId,
        deviceColorVariantId: resolvedDeviceColorVariantId,
        quantity,
        previousQuantity: change.previousQuantity,
        newQuantity: change.newQuantity,
        note: notes,
        createdById: admin.id,
        toLocationId: isStockOut ? undefined : warehouse.id,
        fromLocationId: isStockOut ? warehouse.id : undefined,
      });
    });
  } catch (err) {
    if (err instanceof StockActionError) return { error: err.message };
    throw err;
  }

  revalidateInventoryPaths(productId);
  redirect("/admin/inventory");
}

export interface BulkStockOutState {
  error?: string;
  success?: string;
}

interface BulkOutLine {
  productId: string;
  variantId: string | null;
  deviceColorVariantId: string | null;
  quantity: number;
}

/** Same product-select shape createStockMovement uses above — deliberately
 * not filtered to isActive: true on variants/deviceColorVariants, for the
 * same reason (a disabled variant/combination is still a valid admin
 * stock-movement target). One query covers every distinct product across
 * every line in the bulk submission. */
const BULK_OUT_PRODUCT_SELECT = {
  id: true,
  name: true,
  nameAr: true,
  isActive: true,
  variantMode: true,
  inventoryTrackingMode: true,
  variantAllocationStatus: true,
  variants: {
    select: {
      id: true,
      isActive: true,
      phoneModel: { select: { name: true, nameAr: true, phoneBrand: { select: { name: true, nameAr: true } } } },
    },
  },
  deviceColorVariants: {
    select: {
      id: true,
      isActive: true,
      phoneModel: { select: { name: true, nameAr: true, phoneBrand: { select: { name: true, nameAr: true } } } },
      color: { select: { name: true, nameAr: true } },
    },
  },
} as const;

type BulkOutProduct = Awaited<ReturnType<typeof prisma.product.findMany<{ where: { id: { in: string[] } }; select: typeof BULK_OUT_PRODUCT_SELECT }>>>[number];

/** "Product — Brand / Model[ / Color]" for an error message identifying
 * exactly which line failed — never just the bare product name once a
 * variant/combo is involved, so the admin isn't left guessing which of
 * several lines for the same product (e.g. two colors of one case) needs
 * its quantity corrected. */
function describeBulkOutLine(product: BulkOutProduct, line: BulkOutLine): string {
  const name = product.nameAr ?? product.name;
  if (line.deviceColorVariantId) {
    const combo = product.deviceColorVariants.find((candidate) => candidate.id === line.deviceColorVariantId);
    if (combo) {
      const brand = combo.phoneModel.phoneBrand.nameAr ?? combo.phoneModel.phoneBrand.name;
      const model = combo.phoneModel.nameAr ?? combo.phoneModel.name;
      const color = combo.color.nameAr ?? combo.color.name;
      return `${name} — ${brand} / ${model} / ${color}`;
    }
  }
  if (line.variantId) {
    const variant = product.variants.find((candidate) => candidate.id === line.variantId);
    if (variant) {
      const brand = variant.phoneModel.phoneBrand.nameAr ?? variant.phoneModel.phoneBrand.name;
      const model = variant.phoneModel.nameAr ?? variant.phoneModel.name;
      return `${name} — ${brand} / ${model}`;
    }
  }
  return name;
}

/** Multi-item warehouse OUT (see BulkStockOutForm) — every line in one
 * submission is validated and decremented inside a single transaction:
 * either every line's stock leaves the warehouse, or (on the first
 * insufficient-stock/invalid-line failure) none of it does. Reuses
 * decrementInventoryAtomic per line, same as the single-item form, so the
 * `quantity >= requested` concurrency guard is never weakened — a bulk
 * submission is just that guard applied N times inside one transaction
 * instead of once.
 *
 * notes is entered once for the whole submission (no per-line reason field
 * exists in the schema, and none is added — see the schema.prisma/
 * StockMovement doc comment) and carried onto every resulting StockMovement
 * row unchanged, so every line from one bulk OUT can still be identified
 * together later by matching note text, without a new batch/reference
 * column. */
export async function createBulkStockOut(_prevState: BulkStockOutState, formData: FormData): Promise<BulkStockOutState> {
  const admin = await requireRole([ROLES.ADMIN]);

  let items: unknown;
  try {
    items = JSON.parse(formData.get("items")?.toString() ?? "[]");
  } catch {
    return { error: PARSE_ERROR_MESSAGE };
  }

  const parsed = bulkStockOutSchema.safeParse({
    items,
    notes: formData.get("notes")?.toString().trim() || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? PARSE_ERROR_MESSAGE };
  }

  const { notes } = parsed.data;

  // Aggregate by exact inventory target (productId + variantId +
  // deviceColorVariantId) before any validation/decrement — the client UI
  // already merges a duplicate exact target before submitting, but the
  // server never trusts that: a payload listing the same exact target twice
  // (e.g. Black x3 + Black x4, however that happened — a stale tab, a
  // hand-crafted request) is summed into one effective line here, so it can
  // never be processed as two independent decrements/movements.
  const aggregatedByKey = new Map<string, BulkOutLine>();
  for (const item of parsed.data.items) {
    const variantId = item.variantId ?? null;
    const deviceColorVariantId = item.deviceColorVariantId ?? null;
    const key = `${item.productId}:${variantId ?? ""}:${deviceColorVariantId ?? ""}`;
    const existing = aggregatedByKey.get(key);
    if (existing) {
      existing.quantity += item.quantity;
    } else {
      aggregatedByKey.set(key, { productId: item.productId, variantId, deviceColorVariantId, quantity: item.quantity });
    }
  }
  const lines: BulkOutLine[] = [...aggregatedByKey.values()];

  const products = await prisma.product.findMany({
    where: { id: { in: lines.map((line) => line.productId) } },
    select: BULK_OUT_PRODUCT_SELECT,
  });
  const productById = new Map(products.map((product) => [product.id, product]));

  for (const line of lines) {
    const product = productById.get(line.productId);
    if (!product) {
      return { error: "أحد المنتجات المحددة غير موجود" };
    }
    if (!product.isActive) {
      return { error: `المنتج "${product.nameAr ?? product.name}" غير مفعّل ولا يمكن إخراج مخزونه` };
    }

    const usesDeviceColor = product.inventoryTrackingMode === PRODUCT_INVENTORY_TRACKING_MODES.DEVICE_MODEL_COLOR;
    if (usesDeviceColor) {
      if (!line.deviceColorVariantId || !product.deviceColorVariants.some((combo) => combo.id === line.deviceColorVariantId)) {
        return { error: `اختر الماركة والموديل واللون للمنتج "${product.nameAr ?? product.name}"` };
      }
    } else if (line.deviceColorVariantId) {
      return { error: `المنتج "${product.nameAr ?? product.name}" لا يستخدم تركيبات الجهاز واللون` };
    }

    if (product.variantMode === PRODUCT_VARIANT_MODES.PHONE_COMPATIBILITY) {
      if (product.variantAllocationStatus !== VARIANT_ALLOCATION_STATUSES.READY) {
        return { error: `اعتمد توزيع مخزون الـVariants للمنتج "${product.nameAr ?? product.name}" قبل إخراج مخزونه من هنا` };
      }
      if (!line.variantId || !product.variants.some((variant) => variant.id === line.variantId)) {
        return { error: `اختر ماركة وموديل الهاتف للمنتج "${product.nameAr ?? product.name}"` };
      }
    } else if (line.variantId) {
      return { error: `Variant لا يتبع المنتج "${product.nameAr ?? product.name}"` };
    }
  }

  const warehouse = await getMainWarehouse();

  try {
    await prisma.$transaction(async (tx) => {
      for (const line of lines) {
        const key = { productId: line.productId, variantId: line.variantId, deviceColorVariantId: line.deviceColorVariantId, locationId: warehouse.id };
        let change;
        try {
          change = await decrementInventoryAtomic(tx, key, line.quantity);
        } catch (err) {
          if (err instanceof InsufficientInventoryError) {
            const product = productById.get(line.productId)!;
            throw new StockActionError(`الكمية المتوفرة غير كافية للصنف:\n${describeBulkOutLine(product, line)}`);
          }
          throw err;
        }

        await recordStockMovement(tx, {
          type: MANUAL_STOCK_MOVEMENT_TYPES.STOCK_OUT,
          productId: line.productId,
          variantId: line.variantId,
          deviceColorVariantId: line.deviceColorVariantId,
          quantity: line.quantity,
          previousQuantity: change.previousQuantity,
          newQuantity: change.newQuantity,
          note: notes,
          createdById: admin.id,
          fromLocationId: warehouse.id,
        });
      }
    });
  } catch (err) {
    if (err instanceof StockActionError) return { error: err.message };
    throw err;
  }

  const distinctProductIds = [...new Set(lines.map((line) => line.productId))];
  for (const id of distinctProductIds) revalidateInventoryPaths(id);

  const totalQuantity = lines.reduce((sum, line) => sum + line.quantity, 0);
  return { success: `تم إخراج ${lines.length} صنفاً (${totalQuantity} قطعة) من المخزون بنجاح` };
}
