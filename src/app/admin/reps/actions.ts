"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth/guards";
import { ROLES, STOCK_MOVEMENT_TYPES, REP_LOAD_TYPES, REP_CUSTOMER_ORDER_STATUSES } from "@/lib/constants";
import { getMainWarehouse } from "@/lib/inventory";
import { getOrCreateRepLocation } from "@/lib/reps";
import { resolveOrCreateRepMerchant } from "@/lib/rep-merchants";
import { repStockTransferBatchSchema, repCarReturnSchema, type RepStockTransferBatchInput } from "@/lib/validation/reps";
import { repSaleSchema } from "@/lib/validation/repSale";
import { createRepSaleCore } from "@/lib/rep-sales";
import type { RepSaleState } from "@/app/rep/sales/actions";
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
const SALE_PARSE_ERROR_MESSAGE = "بيانات البيع غير صالحة";

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
  // loadType/customerName/customerPhone/merchantId were previously never
  // read here at all — every submission silently fell back to
  // loadType=CAR_STOCK regardless of what AssignStockForm's radio selection
  // actually sent, and customerName was always discarded. returnStockFromRep
  // never sends any of them, so reading them here is harmless there (all
  // simply come back undefined).
  return repStockTransferBatchSchema.safeParse({
    items,
    notes: formData.get("notes")?.toString().trim() || undefined,
    loadType: formData.get("loadType")?.toString() || undefined,
    customerName: formData.get("customerName")?.toString().trim() || undefined,
    customerPhone: formData.get("customerPhone")?.toString().trim() || undefined,
    merchantId: formData.get("merchantId")?.toString().trim() || undefined,
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
  // ADMIN_ASSISTANT may load a rep's car (CAR_STOCK or CUSTOMER_ORDER) —
  // the one rep-mutation carved out for it. Every other action in this file
  // (returnStockFromRep, cancelRepCustomerOrder) stays ADMIN-only.
  const actor = await requireRole([ROLES.ADMIN, ROLES.ADMIN_ASSISTANT]);

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
  const customerPhone = parsed.data.customerPhone?.trim() ?? "";
  const selectedMerchantId = parsed.data.merchantId?.trim() || null;
  const isCustomerOrder = loadType === REP_LOAD_TYPES.CUSTOMER_ORDER;

  if (isCustomerOrder && customerName.length < 2) {
    return { error: "اسم الزبون مطلوب لتحميل من نوع طلبية زبون" };
  }
  // Every NEW CUSTOMER_ORDER must resolve to a real Merchant identity —
  // either an existing trader picked by stable merchantId (preferred, see
  // AssignStockForm's autocomplete), or enough data (customerName +
  // customerPhone) to resolve/create one below via the exact same rule
  // createRepSale already uses. A CUSTOMER_ORDER is never created with
  // merchantId left null going forward — that would recreate the exact
  // "طلبات الزبائن" duplicate-row bug this feature exists to fix. This does
  // NOT apply retroactively: legacy rows created before this rule existed
  // keep merchantId = null until an ADMIN explicitly links one (see
  // linkRepCustomerOrderMerchant) — and it never applies to CAR_STOCK at
  // all, which carries no customer/trader identity of any kind.
  if (isCustomerOrder && !selectedMerchantId && customerPhone.length < 7) {
    return { error: "يجب اختيار التاجر أو إدخال رقم هاتف صحيح للزبون" };
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

  // Verified up front (never trusting the client's word that a picked
  // trader is real or actually theirs) — an existing merchantId is used
  // directly below, with no re-resolution by phone/name at all, exactly
  // once we know it's legitimate.
  let verifiedMerchantId: string | null = null;
  if (isCustomerOrder && selectedMerchantId) {
    const selectedMerchant = await prisma.merchant.findUnique({
      where: { id: selectedMerchantId },
      select: { id: true, assignedRepId: true },
    });
    if (!selectedMerchant || selectedMerchant.assignedRepId !== rep.id) {
      return { error: "التاجر المختار غير صالح لهذا المندوب" };
    }
    verifiedMerchantId = selectedMerchant.id;
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
          createdById: actor.id,
        },
      });

      for (const line of lines) {
        // Atomic conditional decrement on the source (warehouse) — never a
        // stale read-then-write. Insufficient stock rolls back the whole
        // batch. Stays fully dimensional: the admin picked this exact
        // variant/combo so the WAREHOUSE'S own dimensional stock decrements
        // accurately (see repStockTransferBatchSchema's doc comment).
        await decrementInventoryAtomic(
          tx,
          { productId: line.productId, variantId: line.variantId, deviceColorVariantId: line.deviceColorVariantId, locationId: warehouse.id },
          line.quantity,
        );

        // Atomic increment on the destination (rep car) — safe even if two
        // transfers to the same rep/product land at the same moment.
        // Deliberately the PLAIN aggregate key (variantId/deviceColorVariantId
        // both null) regardless of what the warehouse side just decremented
        // — REP_CAR tracks one simple per-product balance now, never a
        // per-model breakdown (see the InventoryItem doc comment in
        // schema.prisma). A rep never needs to think about phone models
        // when selling; only the warehouse side needs that precision.
        const change = await incrementInventoryUpsert(
          tx,
          { productId: line.productId, variantId: null, deviceColorVariantId: null, locationId: repLocation.id },
          line.quantity,
        );

        // The movement itself still records the EXACT model/combo that left
        // the warehouse — this is the permanent audit trail proving which
        // phone models were physically loaded, independent of how the live
        // REP_CAR balance is stored (see the transfer-batch invoice, which
        // reads this ledger, never live InventoryItem rows).
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
          createdById: actor.id,
        });
      }

      // Layered on top of the exact same physical transfer above — never a
      // second inventory bucket, purely a label + intended-quantity record
      // (see the RepCustomerOrder doc comment in prisma/schema.prisma).
      // Created in the same transaction so the batch, its movements, and
      // this template either all commit together or none do.
      if (loadType === REP_LOAD_TYPES.CUSTOMER_ORDER) {
        // Every branch here ends with a real, non-null Merchant.id — the
        // validation above already rejected any submission that couldn't
        // reach one. An already-verified existing merchantId is used
        // directly (no re-resolution by phone/name — see requirement G);
        // otherwise this resolves the exact same real trader identity a
        // completed sale for this same customer would, via the same shared
        // helper createRepSale uses.
        const merchant = verifiedMerchantId
          ? { id: verifiedMerchantId }
          : await resolveOrCreateRepMerchant(tx, {
              salesRepId: rep.id,
              businessName: customerName,
              contactPhone: customerPhone,
            });

        await tx.repCustomerOrder.create({
          data: {
            salesRepId: rep.id,
            customerName,
            merchantId: merchant.id,
            status: REP_CUSTOMER_ORDER_STATUSES.OPEN,
            transferBatchId: createdBatch.id,
            createdById: actor.id,
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

function parseReturnBatchForm(formData: FormData) {
  let returns: unknown;
  try {
    returns = JSON.parse(formData.get("returns")?.toString() ?? "[]");
  } catch {
    return null;
  }
  return repCarReturnSchema.safeParse({
    returns,
    notes: formData.get("notes")?.toString().trim() || undefined,
  });
}

/** Rep-car -> warehouse return. REP_CAR now holds one plain aggregate
 * quantity per product (see the InventoryItem doc comment in
 * schema.prisma) — the app has no memory of which exact phone models make
 * up that quantity, so unlike assignStockToRep this can never be a simple
 * 1:1 dimensional mirror. The admin must supply, per product, exactly which
 * WAREHOUSE-side model(s)/combo(s) the returned units physically are (see
 * repCarReturnSchema's own doc comment) — never inferred/guessed here.
 * Every line's breakdown is re-verified server-side to sum to exactly that
 * line's own quantity before anything is written; a mismatched sum is
 * rejected outright, not silently corrected. ADMIN-only, matching this
 * action's existing permission (unchanged). */
export async function returnStockFromRep(
  repId: string,
  _prevState: RepStockTransferState,
  formData: FormData,
): Promise<RepStockTransferState> {
  const admin = await requireRole([ROLES.ADMIN]);

  const parsed = parseReturnBatchForm(formData);
  if (!parsed) {
    return { error: ITEMS_PARSE_ERROR_MESSAGE };
  }
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? PARSE_ERROR_MESSAGE };
  }
  const { returns, notes } = parsed.data;

  // Server-side arithmetic check on each submitted line, exactly as
  // submitted — never trusts the client's own sum, even though the UI is
  // built to always keep them equal. Runs BEFORE any cross-line
  // deduplication below, so it still catches a single internally
  // inconsistent line cheaply.
  for (const line of returns) {
    const breakdownSum = line.breakdown.reduce((sum, entry) => sum + entry.quantity, 0);
    if (breakdownSum !== line.quantity) {
      return { error: "مجموع توزيع أحد الأصناف على المستودع لا يساوي الكمية المرتجعة منه" };
    }
  }

  const rep = await prisma.salesRepresentative.findUnique({
    where: { id: repId },
    select: { id: true },
  });
  if (!rep) {
    return { error: "المندوب غير موجود" };
  }

  // Deduplicates any exact warehouse destination repeated across breakdown
  // entries — including across a manipulated payload's duplicate `returns`
  // lines for the same product — into one effective entry per exact
  // target, summing quantities (the same convention aggregateTransferLines
  // already applies on the assignStockToRep/load side, reused here as-is).
  // This is what the rest of this action actually validates and writes
  // from, so a duplicate/repeated pick can never produce two redundant
  // warehouse increments or two redundant movement rows for the identical
  // target. Sum-invariant: merging same-key entries only combines their
  // quantities, so the per-line arithmetic check above stays valid
  // regardless of what this collapses.
  const rawFlatEntries: RepStockTransferBatchInput["items"] = returns.flatMap((line) =>
    line.breakdown.map((entry) => ({
      productId: line.productId,
      variantId: entry.variantId ?? null,
      deviceColorVariantId: entry.deviceColorVariantId ?? null,
      quantity: entry.quantity,
    })),
  );
  const flatBreakdownLines = aggregateTransferLines(rawFlatEntries);
  const quantityError = findAggregatedQuantityError(flatBreakdownLines);
  if (quantityError) {
    return { error: quantityError };
  }

  const products = await prisma.product.findMany({
    where: { id: { in: [...new Set(flatBreakdownLines.map((line) => line.productId))] } },
    select: TRANSFER_PRODUCT_SELECT,
  });
  const productById = new Map(products.map((product) => [product.id, product]));
  const validationError = validateTransferLines(flatBreakdownLines, productById);
  if (validationError) {
    return { error: validationError };
  }

  // Regrouped back under each product — its own aggregate car-return
  // quantity is always the sum of its OWN deduplicated breakdown here,
  // never independently re-trusted against the client's original per-line
  // `quantity` a second time (a duplicate-productId payload could otherwise
  // let two different claimed totals for the same product slip through the
  // per-line check above, which only ever validated each line in
  // isolation).
  const breakdownByProduct = new Map<string, TransferLine[]>();
  for (const entry of flatBreakdownLines) {
    const bucket = breakdownByProduct.get(entry.productId) ?? [];
    bucket.push(entry);
    breakdownByProduct.set(entry.productId, bucket);
  }

  const warehouse = await getMainWarehouse();
  const repLocation = await prisma.stockLocation.findUnique({ where: { salesRepId: rep.id } });

  if (!repLocation) {
    return { error: "المندوب لا يملك مخزوناً لإرجاعه" };
  }

  let batchId = "";
  try {
    const batch = await prisma.$transaction(async (tx) => {
      const requestedVariantIds = flatBreakdownLines.flatMap((line) => (line.variantId ? [line.variantId] : []));
      if (requestedVariantIds.length > 0) {
        const activeVariants = await tx.productVariant.count({ where: { id: { in: requestedVariantIds }, isActive: true } });
        if (activeVariants !== new Set(requestedVariantIds).size) throw new Error("INACTIVE_VARIANT");
      }
      const requestedComboIds = flatBreakdownLines.flatMap((line) => (line.deviceColorVariantId ? [line.deviceColorVariantId] : []));
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

      for (const [productId, breakdown] of breakdownByProduct) {
        const quantity = breakdown.reduce((sum, entry) => sum + entry.quantity, 0);

        // ONE atomic conditional decrement of the car's PLAIN aggregate
        // balance for the whole product quantity — never a stale
        // read-then-write; insufficient stock rolls back the whole batch.
        await decrementInventoryAtomic(
          tx,
          { productId, variantId: null, deviceColorVariantId: null, locationId: repLocation.id },
          quantity,
        );

        // Then, per admin-specified destination: atomic increment of the
        // exact WAREHOUSE dimensional leaf, and a movement recording that
        // exact model/combo — this is what keeps the warehouse precise and
        // the audit trail ("iPhone 15 x3 returned") intact, even though the
        // car side it left was only ever tracked as one aggregate number.
        for (const entry of breakdown) {
          const change = await incrementInventoryUpsert(
            tx,
            { productId, variantId: entry.variantId, deviceColorVariantId: entry.deviceColorVariantId, locationId: warehouse.id },
            entry.quantity,
          );

          await recordStockMovement(tx, {
            type: STOCK_MOVEMENT_TYPES.REP_RETURN,
            productId,
            variantId: entry.variantId,
            deviceColorVariantId: entry.deviceColorVariantId,
            transferBatchId: createdBatch.id,
            fromLocationId: repLocation.id,
            toLocationId: warehouse.id,
            quantity: entry.quantity,
            previousQuantity: change.previousQuantity,
            newQuantity: change.newQuantity,
            note: notes,
            createdById: admin.id,
          });
        }
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

export interface LinkCustomerOrderMerchantState {
  error?: string;
  success?: string;
}

/** ADMIN-only: links a legacy (or otherwise unlinked) RepCustomerOrder to a
 * real Merchant so it can join that trader's grouped "طلبات الزبائن" row on
 * /admin/reps/[id] — see the RepCustomerOrder.merchantId doc comment in
 * schema.prisma. Deliberately the ONLY thing this changes: customerName,
 * status, items, inventory, and every timestamp are left exactly as they
 * were. Never infers the link from customerName/businessName text — the
 * admin explicitly picks the Merchant.
 *
 * Ownership is verified on both sides so a manipulated repId/customerOrderId/
 * merchantId combination can't cross a boundary a legitimate admin action
 * never could: the order must belong to this rep, and the target Merchant
 * must be assigned to this SAME rep (Merchant.assignedRepId — the existing
 * ownership model getMerchantsForRep already relies on), never a merchant
 * belonging to a different rep. */
export async function linkRepCustomerOrderMerchant(
  repId: string,
  customerOrderId: string,
  _prevState: LinkCustomerOrderMerchantState,
  formData: FormData,
): Promise<LinkCustomerOrderMerchantState> {
  await requireRole([ROLES.ADMIN]);

  const merchantId = formData.get("merchantId")?.toString().trim() ?? "";
  if (!merchantId) {
    return { error: "اختر التاجر أولاً" };
  }

  const order = await prisma.repCustomerOrder.findUnique({
    where: { id: customerOrderId },
    select: { id: true, salesRepId: true },
  });
  if (!order || order.salesRepId !== repId) {
    return { error: "طلبية الزبون غير موجودة" };
  }

  const merchant = await prisma.merchant.findUnique({
    where: { id: merchantId },
    select: { id: true, assignedRepId: true },
  });
  if (!merchant || merchant.assignedRepId !== repId) {
    return { error: "التاجر غير موجود ضمن تجار هذا المندوب" };
  }

  await prisma.repCustomerOrder.update({
    where: { id: customerOrderId },
    data: { merchantId: merchant.id },
  });

  revalidateRepPaths(repId);
  return { success: "تم ربط الطلبية بالتاجر" };
}

/** ADMIN-only: records a sale ON BEHALF OF the rep at /admin/reps/[id] — the
 * exact same sale a rep can register themselves at /rep/sales/new, just
 * entered by an admin instead (e.g. over the phone, or the rep can't access
 * their own account right now). Parses the SAME repSaleSchema and calls the
 * SAME core transaction (createRepSaleCore in src/lib/rep-sales.ts) the
 * rep's own createRepSale uses — there is exactly one sale transaction in
 * this codebase, never a second "admin sale" system with different
 * inventory/pricing/payment rules.
 *
 * `repId` is never taken from the client's form — it's the route's own
 * [id] segment, bound into this action at the server-rendered page/form
 * (see /admin/reps/[id]/sales/new/page.tsx), the same trusted-binding
 * pattern already used by every other rep-scoped admin action in this file
 * (assignStockToRep, cancelRepCustomerOrder, linkRepCustomerOrderMerchant).
 * The sale still always belongs to that exact SalesRepresentative
 * (createdByRepId) and still draws stock ONLY from that rep's own car
 * StockLocation — an admin acting on a rep's behalf never touches the
 * warehouse, another rep's car, or office-sale rules. The only thing that
 * differs from a rep entering their own sale is WHO the actual actor is:
 * `actor.id` (the admin), not the rep — recorded exactly where createRepSale
 * already records "who did this" (StockMovement.createdById,
 * AccountPayment.createdById), never fabricated as the rep's own action. */
export async function createRepSaleForRep(repId: string, _prevState: RepSaleState, formData: FormData): Promise<RepSaleState> {
  const actor = await requireRole([ROLES.ADMIN]);

  let items: unknown;
  try {
    items = JSON.parse(formData.get("items")?.toString() ?? "[]");
  } catch {
    return { error: SALE_PARSE_ERROR_MESSAGE };
  }

  const parsed = repSaleSchema.safeParse({
    items,
    customerName: formData.get("customerName")?.toString().trim() ?? "",
    customerPhone: formData.get("customerPhone")?.toString().trim() ?? "",
    city: formData.get("city")?.toString().trim() || undefined,
    address: formData.get("address")?.toString().trim() || undefined,
    notes: formData.get("notes")?.toString().trim() || undefined,
    repCustomerOrderId: formData.get("repCustomerOrderId")?.toString().trim() || null,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? SALE_PARSE_ERROR_MESSAGE };
  }

  const rep = await prisma.salesRepresentative.findUnique({
    where: { id: repId },
    select: { id: true, isActive: true, user: { select: { isActive: true } }, carStockLocation: { select: { id: true } } },
  });
  if (!rep) {
    return { error: "المندوب غير موجود" };
  }
  if (!rep.isActive || !rep.user.isActive) {
    return { error: "لا يمكن تسجيل بيع لمندوب غير مفعل" };
  }
  const locationId = rep.carStockLocation?.id ?? null;
  if (!locationId) {
    return { error: "لم يتم العثور على موقع مخزون المندوب" };
  }

  const result = await createRepSaleCore(parsed.data, {
    salesRepId: rep.id,
    carStockLocationId: locationId,
    actorUserId: actor.id,
  });

  if (!result.ok) {
    return { error: result.error };
  }

  // createRepSaleCore already revalidated every /rep/* and /admin/orders*
  // path a sale ever needs — this adds the admin rep-detail page itself
  // (the "طلبات الزبائن" unified activity, and the completed customer order
  // if one was used) since createRepSaleCore has no reason to know that
  // route exists.
  revalidatePath(`/admin/reps/${repId}`);
  revalidatePath(`/admin/reps/${repId}/sales/new`);
  redirect(`/admin/orders/${result.orderNumber}`);
}
