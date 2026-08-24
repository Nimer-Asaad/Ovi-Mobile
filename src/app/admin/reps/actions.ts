"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth/guards";
import { ROLES, STOCK_MOVEMENT_TYPES, REP_LOAD_TYPES, REP_CUSTOMER_ORDER_STATUSES } from "@/lib/constants";
import { getMainWarehouse } from "@/lib/inventory";
import { getOrCreateRepLocation } from "@/lib/reps";
import { repStockTransferBatchSchema, type RepStockTransferBatchInput } from "@/lib/validation/reps";
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
const ITEMS_PARSE_ERROR_MESSAGE = "بيانات الأصناف غير صالحة، حاول إعادة إضافة الأصناف";
const AGGREGATED_QUANTITY_ERROR_MESSAGE = "الكمية غير صالحة لأحد الأصناف بعد دمج التكرارات، حاول إعادة إدخال الكمية";

/** Postgres INTEGER's max value — the actual column type behind
 * StockMovement.quantity/InventoryItem.quantity (see schema.prisma).
 * aggregateTransferLines below sums a duplicate exact target's quantities;
 * this re-verifies the resulting total is still a safe, storable positive
 * integer — the same defense-in-depth already applied to bulk warehouse IN/
 * OUT in src/app/admin/inventory/actions.ts. */
const MAX_TRANSFER_LINE_QUANTITY = 2_147_483_647;

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
  // loadType/customerName were previously never read here at all — every
  // submission silently fell back to loadType=CAR_STOCK regardless of what
  // AssignStockForm's radio selection actually sent, and customerName was
  // always discarded. returnStockFromRep never sends either field, so
  // reading them here is harmless there (both simply come back undefined).
  return repStockTransferBatchSchema.safeParse({
    items,
    notes: formData.get("notes")?.toString().trim() || undefined,
    loadType: formData.get("loadType")?.toString() || undefined,
    customerName: formData.get("customerName")?.toString().trim() || undefined,
  });
}

/** Aggregates duplicate exact inventory targets (productId + variantId +
 * deviceColorVariantId) from a parsed transfer batch into one effective
 * line per target, summing quantities — see repStockTransferBatchSchema's
 * doc comment for why this replaced an outright-reject uniqueness check.
 * Shared by assignStockToRep and returnStockFromRep. Callers must run the
 * result through findAggregatedQuantityError before using it — a summed
 * quantity was never itself re-checked against the schema's per-line
 * positive-integer rule. */
function aggregateTransferLines(items: RepStockTransferBatchInput["items"]): TransferLine[] {
  const aggregatedByKey = new Map<string, TransferLine>();
  for (const item of items) {
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
  return [...aggregatedByKey.values()];
}

/** Re-verifies every aggregated line's summed quantity is still finite,
 * an integer, positive, and within Postgres INTEGER range — a manipulated
 * payload with many duplicate lines for the same exact target could
 * otherwise sum past what the column can store, surfacing as a raw,
 * unhandled database error later instead of a clean message here. */
function findAggregatedQuantityError(lines: TransferLine[]): string | null {
  for (const line of lines) {
    if (!Number.isSafeInteger(line.quantity) || line.quantity <= 0 || line.quantity > MAX_TRANSFER_LINE_QUANTITY) {
      return AGGREGATED_QUANTITY_ERROR_MESSAGE;
    }
  }
  return null;
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
  if (!parsed) {
    return { error: ITEMS_PARSE_ERROR_MESSAGE };
  }
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? PARSE_ERROR_MESSAGE };
  }
  const { notes } = parsed.data;
  const lines = aggregateTransferLines(parsed.data.items);
  const quantityError = findAggregatedQuantityError(lines);
  if (quantityError) {
    return { error: quantityError };
  }

  const loadType = parsed.data.loadType ?? REP_LOAD_TYPES.CAR_STOCK;
  const customerName = parsed.data.customerName?.trim() ?? "";
  if (loadType === REP_LOAD_TYPES.CUSTOMER_ORDER && customerName.length < 2) {
    return { error: "اسم الزبون مطلوب لتحميل من نوع طلبية زبون" };
  }

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
          loadType,
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

      // Layered on top of the exact same physical transfer above — never a
      // second inventory bucket, purely a label + intended-quantity record
      // (see the RepCustomerOrder doc comment in prisma/schema.prisma).
      // Created in the same transaction so the batch, its movements, and
      // this template either all commit together or none do.
      if (loadType === REP_LOAD_TYPES.CUSTOMER_ORDER) {
        await tx.repCustomerOrder.create({
          data: {
            salesRepId: rep.id,
            customerName,
            status: REP_CUSTOMER_ORDER_STATUSES.OPEN,
            transferBatchId: createdBatch.id,
            createdById: admin.id,
            items: {
              create: lines.map((line) => ({
                productId: line.productId,
                variantId: line.variantId,
                deviceColorVariantId: line.deviceColorVariantId,
                quantity: line.quantity,
              })),
            },
          },
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
  if (loadType === REP_LOAD_TYPES.CUSTOMER_ORDER) {
    revalidatePath("/rep/sales/new");
  }
  redirect(`/admin/reps/${repId}/transfer-batches/${batchId}/invoice`);
}

export async function returnStockFromRep(
  repId: string,
  _prevState: RepStockTransferState,
  formData: FormData,
): Promise<RepStockTransferState> {
  const admin = await requireRole([ROLES.ADMIN]);

  const parsed = parseTransferBatchForm(formData);
  if (!parsed) {
    return { error: ITEMS_PARSE_ERROR_MESSAGE };
  }
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? PARSE_ERROR_MESSAGE };
  }
  const { notes } = parsed.data;
  const lines = aggregateTransferLines(parsed.data.items);
  const quantityError = findAggregatedQuantityError(lines);
  if (quantityError) {
    return { error: quantityError };
  }

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

export interface CancelCustomerOrderState {
  error?: string;
  success?: string;
}

/** Cancels an OPEN customer-order template — never touches physical
 * inventory (see the RepCustomerOrder doc comment: stock already loaded
 * into the car simply becomes general car stock; send it back to the
 * warehouse through the existing Return Stock workflow if needed). Atomic
 * conditional update (status: OPEN in the where clause) so a concurrent
 * sale-completion and cancellation on the same order can never both land —
 * whichever transitions it first wins, the other fails cleanly. */
export async function cancelRepCustomerOrder(
  repId: string,
  customerOrderId: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- useActionState requires this signature
  _prevState: CancelCustomerOrderState,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- no form fields needed, target comes from the bound args
  _formData: FormData,
): Promise<CancelCustomerOrderState> {
  await requireRole([ROLES.ADMIN]);

  const order = await prisma.repCustomerOrder.findUnique({
    where: { id: customerOrderId },
    select: { id: true, salesRepId: true },
  });
  if (!order || order.salesRepId !== repId) {
    return { error: "طلبية الزبون غير موجودة" };
  }

  const result = await prisma.repCustomerOrder.updateMany({
    where: { id: customerOrderId, status: REP_CUSTOMER_ORDER_STATUSES.OPEN },
    data: { status: REP_CUSTOMER_ORDER_STATUSES.CANCELLED, cancelledAt: new Date() },
  });
  if (result.count === 0) {
    return { error: "لم يعد بالإمكان إلغاء هذه الطلبية (ربما تم استخدامها أو إلغاؤها بالفعل)" };
  }

  revalidatePath(`/admin/reps/${repId}`);
  revalidatePath("/rep/sales/new");
  return { success: "تم إلغاء طلبية الزبون" };
}
