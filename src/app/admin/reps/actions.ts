"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth/guards";
import { ROLES, STOCK_MOVEMENT_TYPES } from "@/lib/constants";
import { getMainWarehouse } from "@/lib/inventory";
import { getOrCreateRepLocation } from "@/lib/reps";
import { repStockTransferBatchSchema } from "@/lib/validation/reps";
import {
  decrementInventoryAtomic,
  incrementInventoryUpsert,
  recordStockMovement,
  InsufficientInventoryError,
} from "@/lib/inventory-transactions";

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

function parseTransferBatchForm(formData: FormData) {
  let items: unknown;
  try {
    items = JSON.parse(formData.get("items")?.toString() ?? "[]");
  } catch {
    return null;
  }
  return repStockTransferBatchSchema.safeParse({
    items,
    notes: formData.get("notes")?.toString().trim() || undefined,
  });
}

/** Shared product-select shape for validating every line in a transfer
 * batch — one query for all products in the batch rather than one per
 * line. */
const TRANSFER_PRODUCT_SELECT = {
  id: true,
  name: true,
  nameAr: true,
  isActive: true,
  variantMode: true,
  variantAllocationStatus: true,
  inventoryTrackingMode: true,
  variants: { where: { isActive: true }, select: { id: true } },
  deviceColorVariants: { where: { isActive: true }, select: { id: true } },
} as const;

type TransferProduct = Awaited<ReturnType<typeof prisma.product.findMany<{ where: { id: { in: string[] } }; select: typeof TRANSFER_PRODUCT_SELECT }>>>[number];

interface TransferLine {
  productId: string;
  variantId: string | null;
  deviceColorVariantId: string | null;
  quantity: number;
}

/** Validates every line against its product in one pass — shared by both
 * assign and return, since the product-side rules (active, variant/combo
 * membership) don't depend on transfer direction. */
function validateTransferLines(lines: TransferLine[], productById: Map<string, TransferProduct>): string | null {
  for (const line of lines) {
    const product = productById.get(line.productId);
    if (!product) {
      return "أحد المنتجات المحددة غير موجود";
    }
    if (!product.isActive) {
      return `المنتج "${product.nameAr ?? product.name}" غير مفعّل`;
    }
    const usesDeviceColor = product.inventoryTrackingMode === "DEVICE_MODEL_COLOR";
    if (usesDeviceColor) {
      if (!line.deviceColorVariantId || !product.deviceColorVariants.some((combo) => combo.id === line.deviceColorVariantId)) {
        return `اختر الماركة والموديل واللون للمنتج "${product.nameAr ?? product.name}"`;
      }
    } else if (line.deviceColorVariantId) {
      return `المنتج "${product.nameAr ?? product.name}" لا يستخدم تركيبات الجهاز واللون`;
    }
    if (product.variantMode === "PHONE_COMPATIBILITY" && (!line.variantId || !product.variants.some((variant) => variant.id === line.variantId))) {
      return `اختر Variant صالحاً للمنتج "${product.nameAr ?? product.name}"`;
    }
    if (product.variantMode !== "PHONE_COMPATIBILITY" && line.variantId) {
      return `Variant لا يتبع المنتج "${product.nameAr ?? product.name}"`;
    }
  }
  return null;
}

export async function assignStockToRep(
  repId: string,
  _prevState: RepStockTransferState,
  formData: FormData,
): Promise<RepStockTransferState> {
  const admin = await requireRole([ROLES.ADMIN]);

  const parsed = parseTransferBatchForm(formData);
  if (!parsed || !parsed.success) {
    return { error: PARSE_ERROR_MESSAGE };
  }
  const { notes } = parsed.data;
  const lines: TransferLine[] = parsed.data.items.map((item) => ({
    productId: item.productId,
    variantId: item.variantId ?? null,
    deviceColorVariantId: item.deviceColorVariantId ?? null,
    quantity: item.quantity,
  }));

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

  const products = await prisma.product.findMany({
    where: { id: { in: lines.map((line) => line.productId) } },
    select: TRANSFER_PRODUCT_SELECT,
  });
  const productById = new Map(products.map((product) => [product.id, product]));
  const validationError = validateTransferLines(lines, productById);
  if (validationError) {
    return { error: validationError };
  }
  if (products.some((product) => product.variantMode === "PHONE_COMPATIBILITY" && product.variantAllocationStatus !== "READY")) {
    return { error: "أحد المنتجات ينتظر تجهيز مخزون الـVariants قبل تخصيصه" };
  }

  const warehouse = await getMainWarehouse();
  const repLocation = await getOrCreateRepLocation(rep.id, rep.user.name);

  let batchId = "";
  try {
    const batch = await prisma.$transaction(async (tx) => {
      const requestedVariantIds = lines.flatMap((line) => (line.variantId ? [line.variantId] : []));
      if (requestedVariantIds.length > 0) {
        const activeVariants = await tx.productVariant.count({ where: { id: { in: requestedVariantIds }, isActive: true } });
        if (activeVariants !== new Set(requestedVariantIds).size) throw new Error("INACTIVE_VARIANT");
      }
      const requestedComboIds = lines.flatMap((line) => (line.deviceColorVariantId ? [line.deviceColorVariantId] : []));
      if (requestedComboIds.length > 0) {
        const activeCombos = await tx.deviceColorVariant.count({ where: { id: { in: requestedComboIds }, isActive: true } });
        if (activeCombos !== new Set(requestedComboIds).size) throw new Error("INACTIVE_VARIANT");
      }

      const createdBatch = await tx.repStockTransferBatch.create({
        data: {
          type: STOCK_MOVEMENT_TYPES.REP_ASSIGNMENT,
          salesRepId: rep.id,
          fromLocationId: warehouse.id,
          toLocationId: repLocation.id,
          note: notes,
          createdById: admin.id,
        },
      });

      for (const line of lines) {
        // Atomic conditional decrement on the source (warehouse) — never a
        // stale read-then-write. Insufficient stock rolls back the whole
        // batch.
        await decrementInventoryAtomic(
          tx,
          { productId: line.productId, variantId: line.variantId, deviceColorVariantId: line.deviceColorVariantId, locationId: warehouse.id },
          line.quantity,
        );

        // Atomic increment on the destination (rep car) — safe even if two
        // transfers to the same rep/product land at the same moment.
        const change = await incrementInventoryUpsert(
          tx,
          { productId: line.productId, variantId: line.variantId, deviceColorVariantId: line.deviceColorVariantId, locationId: repLocation.id },
          line.quantity,
        );

        await recordStockMovement(tx, {
          type: STOCK_MOVEMENT_TYPES.REP_ASSIGNMENT,
          productId: line.productId,
          variantId: line.variantId,
          deviceColorVariantId: line.deviceColorVariantId,
          transferBatchId: createdBatch.id,
          fromLocationId: warehouse.id,
          toLocationId: repLocation.id,
          quantity: line.quantity,
          previousQuantity: change.previousQuantity,
          newQuantity: change.newQuantity,
          note: notes,
          createdById: admin.id,
        });
      }

      return createdBatch;
    });
    batchId = batch.id;
  } catch (err) {
    if (err instanceof Error && err.message === "INACTIVE_VARIANT") {
      return { error: "أحد خيارات المنتج لم يعد فعالاً؛ أعد اختيار الخيار" };
    }
    if (err instanceof InsufficientInventoryError) {
      return { error: "الكمية المطلوبة أكبر من المخزون المتوفر في المستودع الرئيسي" };
    }
    throw err;
  }

  revalidateRepPaths(repId);
  redirect(`/admin/reps/${repId}/transfer-batches/${batchId}/invoice`);
}

export async function returnStockFromRep(
  repId: string,
  _prevState: RepStockTransferState,
  formData: FormData,
): Promise<RepStockTransferState> {
  const admin = await requireRole([ROLES.ADMIN]);

  const parsed = parseTransferBatchForm(formData);
  if (!parsed || !parsed.success) {
    return { error: PARSE_ERROR_MESSAGE };
  }
  const { notes } = parsed.data;
  const lines: TransferLine[] = parsed.data.items.map((item) => ({
    productId: item.productId,
    variantId: item.variantId ?? null,
    deviceColorVariantId: item.deviceColorVariantId ?? null,
    quantity: item.quantity,
  }));

  const rep = await prisma.salesRepresentative.findUnique({
    where: { id: repId },
    select: { id: true },
  });
  if (!rep) {
    return { error: "المندوب غير موجود" };
  }

  const products = await prisma.product.findMany({
    where: { id: { in: lines.map((line) => line.productId) } },
    select: TRANSFER_PRODUCT_SELECT,
  });
  const productById = new Map(products.map((product) => [product.id, product]));
  const validationError = validateTransferLines(lines, productById);
  if (validationError) {
    return { error: validationError };
  }

  const warehouse = await getMainWarehouse();
  const repLocation = await prisma.stockLocation.findUnique({ where: { salesRepId: rep.id } });

  if (!repLocation) {
    return { error: "المندوب لا يملك مخزوناً لإرجاعه" };
  }

  let batchId = "";
  try {
    const batch = await prisma.$transaction(async (tx) => {
      const requestedVariantIds = lines.flatMap((line) => (line.variantId ? [line.variantId] : []));
      if (requestedVariantIds.length > 0) {
        const activeVariants = await tx.productVariant.count({ where: { id: { in: requestedVariantIds }, isActive: true } });
        if (activeVariants !== new Set(requestedVariantIds).size) throw new Error("INACTIVE_VARIANT");
      }
      const requestedComboIds = lines.flatMap((line) => (line.deviceColorVariantId ? [line.deviceColorVariantId] : []));
      if (requestedComboIds.length > 0) {
        const activeCombos = await tx.deviceColorVariant.count({ where: { id: { in: requestedComboIds }, isActive: true } });
        if (activeCombos !== new Set(requestedComboIds).size) throw new Error("INACTIVE_VARIANT");
      }

      const createdBatch = await tx.repStockTransferBatch.create({
        data: {
          type: STOCK_MOVEMENT_TYPES.REP_RETURN,
          salesRepId: rep.id,
          fromLocationId: repLocation.id,
          toLocationId: warehouse.id,
          note: notes,
          createdById: admin.id,
        },
      });

      for (const line of lines) {
        // Atomic conditional decrement on the source (rep car) — never a
        // stale read-then-write. Insufficient stock rolls back the whole
        // batch.
        const change = await decrementInventoryAtomic(
          tx,
          { productId: line.productId, variantId: line.variantId, deviceColorVariantId: line.deviceColorVariantId, locationId: repLocation.id },
          line.quantity,
        );

        // Atomic increment on the destination (warehouse).
        await incrementInventoryUpsert(
          tx,
          { productId: line.productId, variantId: line.variantId, deviceColorVariantId: line.deviceColorVariantId, locationId: warehouse.id },
          line.quantity,
        );

        await recordStockMovement(tx, {
          type: STOCK_MOVEMENT_TYPES.REP_RETURN,
          productId: line.productId,
          variantId: line.variantId,
          deviceColorVariantId: line.deviceColorVariantId,
          transferBatchId: createdBatch.id,
          fromLocationId: repLocation.id,
          toLocationId: warehouse.id,
          quantity: line.quantity,
          previousQuantity: change.previousQuantity,
          newQuantity: change.newQuantity,
          note: notes,
          createdById: admin.id,
        });
      }

      return createdBatch;
    });
    batchId = batch.id;
  } catch (err) {
    if (err instanceof Error && err.message === "INACTIVE_VARIANT") {
      return { error: "أحد خيارات المنتج لم يعد فعالاً؛ أعد اختيار الخيار" };
    }
    if (err instanceof InsufficientInventoryError) {
      return { error: "الكمية المطلوبة أكبر من مخزون المندوب الحالي" };
    }
    throw err;
  }

  revalidateRepPaths(repId);
  redirect(`/admin/reps/${repId}/transfer-batches/${batchId}/invoice`);
}
