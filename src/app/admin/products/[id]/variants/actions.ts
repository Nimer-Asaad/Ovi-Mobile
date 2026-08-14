"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth/guards";
import { PRODUCT_INVENTORY_TRACKING_MODES, PRODUCT_VARIANT_MODES, ROLES, STOCK_MOVEMENT_TYPES, VARIANT_ALLOCATION_STATUSES } from "@/lib/constants";
import { allocationSchema, productVariantsSchema } from "@/lib/validation/productVariants";
import { incrementInventoryUpsert, recordStockMovement, setInventoryAbsolute } from "@/lib/inventory-transactions";
import { getMainWarehouse } from "@/lib/inventory";

export interface VariantActionState { error?: string; success?: string }

function parseJson(formData: FormData, key: string): unknown {
  try { return JSON.parse(formData.get(key)?.toString() ?? "null"); } catch { return null; }
}

function isRetryableTransactionError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
}

export async function saveProductVariants(productId: string, _state: VariantActionState, formData: FormData): Promise<VariantActionState> {
  await requireRole([ROLES.ADMIN]);
  const parsed = productVariantsSchema.safeParse({ variants: parseJson(formData, "variants") });
  if (!parsed.success) return { error: "بيانات الـVariants غير صالحة" };

  const product = await prisma.product.findUnique({ where: { id: productId }, select: { inventoryTrackingMode: true } });
  if (!product) return { error: "المنتج غير موجود" };
  // A product uses at most one variant system at a time (DB CHECK
  // constraint on products) — this legacy phone-model-only system and
  // DEVICE_MODEL_COLOR are mutually exclusive. Without this check, saving a
  // variant here would set variantMode to PHONE_COMPATIBILITY on a
  // DEVICE_MODEL_COLOR product and hit a raw CHECK-constraint failure
  // instead of a clean message.
  if (product.inventoryTrackingMode === PRODUCT_INVENTORY_TRACKING_MODES.DEVICE_MODEL_COLOR) {
    return { error: "هذا المنتج يستخدم وضع مخزون الجهاز واللون؛ لا يمكن استخدام نظام الـVariants القديم عليه" };
  }

  const modelIds = [...new Set(parsed.data.variants.map((row) => row.phoneModelId))];
  const [models, existing] = await Promise.all([
    prisma.phoneModel.findMany({ where: { id: { in: modelIds } }, select: { id: true } }),
    prisma.productVariant.findMany({
      where: { productId },
      select: {
        id: true, phoneModelId: true, variantCode: true,
        _count: { select: { inventoryItems: true, cartItems: true, orderItems: true, stockMovements: true, stockRequestItems: true, stockReturnItems: true } },
      },
    }),
  ]);
  if (models.length !== modelIds.length) return { error: "أحد الموديلات غير موجود" };
  if (new Set(modelIds).size !== parsed.data.variants.length) return { error: "لا يمكن تكرار نفس الموديل" };
  const codes = parsed.data.variants.flatMap((row) => row.variantCode ? [row.variantCode] : []);
  if (new Set(codes).size !== codes.length) return { error: "كود الـVariant مكرر" };
  const existingIds = new Set(existing.map((row) => row.id));
  if (parsed.data.variants.some((row) => row.id && !existingIds.has(row.id))) return { error: "Variant لا يتبع هذا المنتج" };

  const submittedById = new Map(parsed.data.variants.flatMap((row) => row.id ? [[row.id, row] as const] : []));
  for (const current of existing) {
    const submitted = submittedById.get(current.id);
    if (!submitted) continue;
    const used = Object.values(current._count).some((count) => count > 0);
    const identityChanged = current.phoneModelId !== submitted.phoneModelId
      || current.variantCode !== (submitted.variantCode || null);
    if (used && identityChanged) return { error: "لا يمكن تعديل موديل أو كود Variant بعد استخدامه؛ عطّله وأنشئ Variant جديداً" };
  }

  try {
    await prisma.$transaction(async (tx) => {
      const product = await tx.product.findUniqueOrThrow({ where: { id: productId }, select: { variantAllocationBatch: { select: { status: true } } } });
      let batchStatus = product.variantAllocationBatch?.status;
      if (!batchStatus) {
        const [legacy, negativeLegacy] = await Promise.all([
          tx.inventoryItem.aggregate({ where: { productId, variantId: null }, _sum: { quantity: true } }),
          tx.inventoryItem.count({ where: { productId, variantId: null, quantity: { lt: 0 } } }),
        ]);
        if (negativeLegacy > 0) throw new Error("NEGATIVE_LEGACY");
        await tx.productVariantAllocationBatch.create({ data: {
          productId, originalLegacyQuantity: legacy._sum.quantity ?? 0, allocatedQuantity: 0, status: "PENDING",
        } });
        batchStatus = "PENDING";
      }

      const submittedIds = parsed.data.variants.flatMap((row) => row.id ? [row.id] : []);
      await tx.productVariant.updateMany({ where: { productId, id: { notIn: submittedIds } }, data: { isActive: false } });
      for (const [sortOrder, row] of parsed.data.variants.entries()) {
        const data = { phoneModelId: row.phoneModelId, variantCode: row.variantCode || null, isActive: row.isActive, sortOrder };
        if (row.id) await tx.productVariant.update({ where: { id: row.id }, data });
        else await tx.productVariant.create({ data: { productId, ...data } });
      }
      await tx.product.update({ where: { id: productId }, data: {
        variantMode: PRODUCT_VARIANT_MODES.PHONE_COMPATIBILITY,
        variantAllocationStatus: batchStatus === "COMPLETED" ? VARIANT_ALLOCATION_STATUSES.READY : VARIANT_ALLOCATION_STATUSES.PENDING,
      } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return { error: "يوجد Variant بنفس الموديل أو الكود" };
    if (isRetryableTransactionError(error)) return { error: "حدث تعديل متزامن؛ لم تُحفظ التغييرات، أعد المحاولة" };
    if (error instanceof Error && error.message === "NEGATIVE_LEGACY") return { error: "لا يمكن تثبيت الرصيد الأصلي مع وجود كمية سالبة؛ راجع المخزون أولاً" };
    throw error;
  }
  revalidatePath(`/admin/products/${productId}/variants`);
  revalidatePath(`/admin/products/${productId}/edit`);
  return { success: "تم حفظ تعريفات الـVariants دون تغيير المخزون." };
}

export async function allocateLegacyInventory(productId: string, _state: VariantActionState, formData: FormData): Promise<VariantActionState> {
  const admin = await requireRole([ROLES.ADMIN]);
  const parsed = allocationSchema.safeParse({ sourceInventoryItemId: formData.get("sourceInventoryItemId")?.toString(), allocations: parseJson(formData, "allocations") });
  if (!parsed.success) return { error: "بيانات التوزيع غير صالحة" };
  const total = parsed.data.allocations.reduce((sum, row) => sum + row.quantity, 0);
  try {
    await prisma.$transaction(async (tx) => {
      const batch = await tx.productVariantAllocationBatch.findUnique({ where: { productId } });
      if (!batch) throw new Error("MISSING_BATCH");
      if (batch.status !== "PENDING") throw new Error("BATCH_COMPLETED");
      if (batch.allocatedQuantity + total > batch.originalLegacyQuantity) throw new Error("BASELINE_EXCEEDED");

      const source = await tx.inventoryItem.findFirst({ where: { id: parsed.data.sourceInventoryItemId, productId, variantId: null }, select: { id: true, locationId: true, quantity: true } });
      if (!source || source.quantity < total || source.quantity < 0) throw new Error("INSUFFICIENT_UNALLOCATED");
      const variants = await tx.productVariant.findMany({ where: { id: { in: parsed.data.allocations.map((row) => row.variantId) }, productId, isActive: true }, select: { id: true } });
      if (variants.length !== new Set(parsed.data.allocations.map((row) => row.variantId)).size) throw new Error("INVALID_VARIANT");

      const decremented = await tx.inventoryItem.updateMany({ where: { id: source.id, quantity: { gte: total } }, data: { quantity: { decrement: total } } });
      if (decremented.count !== 1) throw new Error("INSUFFICIENT_UNALLOCATED");
      const newSourceQuantity = source.quantity - total;
      await recordStockMovement(tx, {
        type: STOCK_MOVEMENT_TYPES.VARIANT_ALLOCATION_SOURCE, productId, variantId: null,
        allocationBatchId: batch.id, fromLocationId: source.locationId, toLocationId: null, quantity: total,
        previousQuantity: source.quantity, newQuantity: newSourceQuantity, note: "خصم من الرصيد القديم للتوزيع على Variants", createdById: admin.id,
      });
      for (const row of parsed.data.allocations) {
        const change = await incrementInventoryUpsert(tx, { productId, variantId: row.variantId, locationId: source.locationId }, row.quantity);
        await recordStockMovement(tx, {
          type: STOCK_MOVEMENT_TYPES.VARIANT_ALLOCATION, productId, variantId: row.variantId,
          allocationBatchId: batch.id, fromLocationId: null, toLocationId: source.locationId, quantity: row.quantity,
          previousQuantity: change.previousQuantity, newQuantity: change.newQuantity, note: "إضافة إلى Variant من الرصيد القديم", createdById: admin.id,
        });
      }
      const updated = await tx.productVariantAllocationBatch.updateMany({
        where: { id: batch.id, status: "PENDING", allocatedQuantity: batch.allocatedQuantity },
        data: { allocatedQuantity: { increment: total } },
      });
      if (updated.count !== 1) throw new Error("CONCURRENT_ALLOCATION");
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (isRetryableTransactionError(error) || (error instanceof Error && error.message === "CONCURRENT_ALLOCATION")) return { error: "تم رفض توزيع متزامن أو مكرر؛ حدّث الصفحة وحاول من الرصيد الحالي" };
    if (error instanceof Error && ["INSUFFICIENT_UNALLOCATED", "BASELINE_EXCEEDED"].includes(error.message)) return { error: "الكمية الموزعة تتجاوز الرصيد القديم المثبت" };
    if (error instanceof Error && error.message === "INVALID_VARIANT") return { error: "أحد الـVariants غير صالح أو غير نشط" };
    if (error instanceof Error && error.message === "MISSING_BATCH") return { error: "ابدأ إعداد الـVariants أولاً لتثبيت الرصيد الأصلي" };
    if (error instanceof Error && error.message === "BATCH_COMPLETED") return { error: "تم اعتماد هذا التوزيع ولا يمكن إعادة فتحه" };
    throw error;
  }
  revalidatePath(`/admin/products/${productId}/variants`);
  revalidatePath("/admin/inventory");
  return { success: `تم توزيع ${total} حبة مع تحديث سجل التوزيع الدائم.` };
}

export async function markVariantInventoryReady(productId: string): Promise<void> {
  const admin = await requireRole([ROLES.ADMIN]);
  await prisma.$transaction(async (tx) => {
    const [batch, activeVariants, legacy, negativeInventory] = await Promise.all([
      tx.productVariantAllocationBatch.findUnique({ where: { productId } }),
      tx.productVariant.count({ where: { productId, isActive: true } }),
      tx.inventoryItem.aggregate({ where: { productId, variantId: null }, _sum: { quantity: true } }),
      tx.inventoryItem.count({ where: { productId, quantity: { lt: 0 } } }),
    ]);
    if (!batch || batch.status !== "PENDING") throw new Error("INVALID_BATCH");
    const legacyRemaining = legacy._sum.quantity ?? 0;
    if (activeVariants === 0 || negativeInventory > 0 || legacyRemaining !== 0 || batch.allocatedQuantity !== batch.originalLegacyQuantity) throw new Error("INCOMPLETE_ALLOCATION");
    const completed = await tx.productVariantAllocationBatch.updateMany({
      where: { id: batch.id, status: "PENDING", allocatedQuantity: batch.originalLegacyQuantity },
      data: { status: "COMPLETED", completedAt: new Date(), completedById: admin.id },
    });
    if (completed.count !== 1) throw new Error("CONCURRENT_ALLOCATION");
    await tx.product.update({ where: { id: productId }, data: { variantAllocationStatus: VARIANT_ALLOCATION_STATUSES.READY } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  revalidatePath(`/admin/products/${productId}/variants`);
  revalidatePath("/products");
}

export async function adjustVariantInventory(productId: string, _state: VariantActionState, formData: FormData): Promise<VariantActionState> {
  const admin = await requireRole([ROLES.ADMIN]);
  const raw = parseJson(formData, "adjustments");
  if (!Array.isArray(raw)) return { error: "بيانات الجرد غير صالحة" };
  const adjustments = raw.filter((row): row is { variantId: string; quantity: number } => Boolean(row && typeof row === "object" && typeof row.variantId === "string" && Number.isInteger(row.quantity) && row.quantity >= 0));
  if (adjustments.length !== raw.length || new Set(adjustments.map((row) => row.variantId)).size !== adjustments.length) return { error: "بيانات الجرد غير صالحة" };
  const product = await prisma.product.findUnique({ where: { id: productId }, select: { variantAllocationStatus: true, variants: { where: { id: { in: adjustments.map((row) => row.variantId) }, isActive: true }, select: { id: true } } } });
  if (!product || product.variantAllocationStatus !== VARIANT_ALLOCATION_STATUSES.READY) return { error: "اعتمد توزيع المخزون القديم قبل إجراء جرد مباشر للـVariants" };
  if (product.variants.length !== adjustments.length) return { error: "أحد الـVariants غير صالح" };
  const warehouse = await getMainWarehouse();
  await prisma.$transaction(async (tx) => {
    for (const row of adjustments) {
      const change = await setInventoryAbsolute(tx, { productId, variantId: row.variantId, locationId: warehouse.id }, row.quantity);
      if (change.previousQuantity === change.newQuantity) continue;
      await recordStockMovement(tx, { type: STOCK_MOVEMENT_TYPES.ADJUSTMENT, productId, variantId: row.variantId, toLocationId: warehouse.id, quantity: Math.abs(change.newQuantity - change.previousQuantity), previousQuantity: change.previousQuantity, newQuantity: change.newQuantity, note: "جرد مباشر لمخزون Variant", createdById: admin.id });
    }
  });
  revalidatePath(`/admin/products/${productId}/variants`);
  revalidatePath("/admin/inventory");
  revalidatePath("/products");
  return { success: "تم حفظ جرد الـVariants" };
}
