import "server-only";
import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ORDER_SOURCES, ORDER_STATUSES, PAYMENT_METHODS, PAYMENT_STATUSES, STOCK_MOVEMENT_TYPES, REP_CUSTOMER_ORDER_STATUSES, MERCHANT_STATUSES } from "@/lib/constants";
import type { RepSaleInput } from "@/lib/validation/repSale";
import { decrementInventoryAtomic, recordStockMovement, InsufficientInventoryError } from "@/lib/inventory-transactions";
import { getOrCreateMerchantAccount, recordInitialAccountPayment } from "@/lib/accounts";
import { resolveOrCreateRepMerchant } from "@/lib/rep-merchants";
import { generateDailyOrderNumber } from "@/lib/order-number";
import type { SaleProductOption } from "@/components/reps/ProductSalePicker";

export function revalidateRepSalePaths(orderNumber: string): void {
  revalidatePath("/rep");
  revalidatePath("/rep/sales");
  revalidatePath("/rep/sales/new");
  revalidatePath(`/rep/sales/${orderNumber}`);
  revalidatePath("/rep/stock");
  revalidatePath("/rep/movements");
  revalidatePath("/rep/merchants");
  revalidatePath("/admin/orders");
  revalidatePath(`/admin/orders/${orderNumber}`);
  revalidatePath("/admin/merchants");
  revalidatePath("/admin");
}

/** Rep-car sale catalog for a given car StockLocation — exactly the same
 * query /rep/sales/new (a rep selling their own car stock) and
 * /admin/reps/[id]/sales/new (an admin selling on that rep's behalf) both
 * need, extracted here so there is one copy instead of two. REP_CAR
 * InventoryItem rows are always the PLAIN aggregate bucket now (variantId
 * and deviceColorVariantId both null — see the InventoryItem doc comment in
 * schema.prisma: a rep never needs to think about phone models when
 * selling, only the warehouse side stays dimensional), so this is a
 * straight one-row-per-product query — no variant/device-color grouping
 * needed here at all, unlike the admin car-loading/return catalogs, which
 * still deal with the warehouse's own dimensional stock. `colorOptions` is
 * independent of stock — it's the product's descriptive color pick-list
 * (ProductColorOption), never a stock dimension, kept here purely so a
 * plain product can still optionally record which color a customer chose.
 * Only in-stock rows are ever included (quantity > 0). Returns an empty
 * catalog for a rep with no car location at all. */
export async function getRepCarSaleProducts(locationId: string | null): Promise<SaleProductOption[]> {
  if (!locationId) return [];

  const items = await prisma.inventoryItem.findMany({
    where: { locationId, quantity: { gt: 0 } },
    orderBy: { updatedAt: "desc" },
    select: {
      quantity: true,
      product: {
        select: {
          id: true,
          sku: true,
          name: true,
          nameAr: true,
          retailPriceCents: true,
          isActive: true,
          images: {
            select: { url: true, altText: true },
            orderBy: [{ isMain: "desc" }, { sortOrder: "asc" }],
            take: 1,
          },
          colorOptions: {
            select: { color: { select: { id: true, name: true, nameAr: true, hexCode: true } } },
            orderBy: { sortOrder: "asc" },
          },
        },
      },
    },
  });

  return items
    .filter((item) => item.product.isActive)
    .map((item) => ({
      id: item.product.id,
      sku: item.product.sku,
      name: item.product.name,
      nameAr: item.product.nameAr,
      retailPriceCents: item.product.retailPriceCents,
      thumbnailUrl: item.product.images[0]?.url ?? null,
      thumbnailAlt: item.product.images[0]?.altText ?? null,
      repStock: item.quantity,
      colorOptions: item.product.colorOptions.map((option) => ({
        id: option.color.id,
        name: option.color.name,
        nameAr: option.color.nameAr,
        hexCode: option.color.hexCode,
      })),
    }));
}

export interface CreateRepSaleContext {
  /** The SalesRepresentative this sale belongs to — always resolved and
   * verified by the caller (either "my own rep row" for a rep-initiated
   * sale, or the target /admin/reps/[id] rep for an admin-on-behalf sale),
   * never taken from arbitrary client input. */
  salesRepId: string;
  /** That rep's car StockLocation.id — inventory is decremented ONLY here,
   * never from the warehouse, another rep's car, or any other location. */
  carStockLocationId: string;
  /** The real person performing this action — the rep themselves for a
   * normal rep-initiated sale, or the admin acting on their behalf. Used
   * ONLY for the existing "who actually did this" audit fields
   * (StockMovement.createdById, and AccountPayment.createdById via
   * recordInitialAccountPayment) — the exact same fields an admin's own
   * assignStockToRep already populates with the acting admin's id, not the
   * rep's. Never changes whose sale this is: ownership is always
   * `salesRepId` above, resolved independently of this. */
  actorUserId: string;
}

export type CreateRepSaleResult = { ok: true; orderNumber: string } | { ok: false; error: string };

/** The one rep-sale transaction in this codebase. A rep selling their own
 * car stock (createRepSale in src/app/rep/sales/actions.ts) and an admin
 * recording a sale on a rep's behalf (createRepSaleForRep in
 * src/app/admin/reps/actions.ts) both parse the same repSaleSchema and both
 * call this exact function — there is no second, divergent sale path.
 *
 * This function deliberately does NOT: check authorization (the caller's
 * requireRole already ran), resolve which rep/location `context` refers to
 * (the caller already verified that), or redirect on success (the caller
 * decides where — /rep/sales/[orderNumber] for a rep, /admin/orders/
 * [orderNumber] for an admin) — it only runs the actual sale: validates
 * stock/product/customer-order state, resolves the trader identity, creates
 * the Order (+ atomically completes a RepCustomerOrder if one was given),
 * decrements inventory, and records the resulting movement/payment — byte-
 * for-byte the same steps createRepSale always ran inline before this was
 * extracted. */
export async function createRepSaleCore(input: RepSaleInput, context: CreateRepSaleContext): Promise<CreateRepSaleResult> {
  const { items: saleItems, customerName, customerPhone, city, address, notes, repCustomerOrderId, paidNowCents, paidNowMethod } = input;
  const { salesRepId, carStockLocationId: locationId, actorUserId } = context;

  // A customer order is only ever a starting template (see the
  // RepCustomerOrder schema doc comment) — the rep (or the admin acting on
  // their behalf) may have added, removed, or changed every line's quantity
  // before submitting, and `saleItems` above already reflects exactly that.
  // This check exists purely to authorize *which* template gets linked/
  // completed: never another rep's order (scoping bug), and never one
  // that's already been used/cancelled (stale tab, double submit, or a race
  // with an admin cancellation) — the real single-use enforcement is the
  // atomic conditional update inside the transaction below, this is just an
  // early, cheap rejection.
  if (repCustomerOrderId) {
    const customerOrder = await prisma.repCustomerOrder.findUnique({
      where: { id: repCustomerOrderId },
      select: { salesRepId: true, status: true },
    });
    if (!customerOrder || customerOrder.salesRepId !== salesRepId) {
      return { ok: false, error: "طلبية الزبون غير موجودة" };
    }
    if (customerOrder.status !== REP_CUSTOMER_ORDER_STATUSES.OPEN) {
      return { ok: false, error: "لم تعد هذه الطلبية نشطة" };
    }
  }

  const productIds = saleItems.map((item) => item.productId);
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: {
      id: true,
      sku: true,
      isActive: true,
      name: true,
      nameAr: true,
      variantMode: true,
      inventoryTrackingMode: true,
      colorOptions: { select: { colorId: true, color: { select: { name: true, nameAr: true } } } },
      variants: { where: { isActive: true }, select: { id: true, variantCode: true, phoneModel: { select: { name: true, nameAr: true, phoneBrand: { select: { name: true, nameAr: true } } } } } },
      deviceColorVariants: { where: { isActive: true }, select: { id: true, phoneModel: { select: { name: true, nameAr: true, phoneBrand: { select: { name: true, nameAr: true } } } }, color: { select: { name: true, nameAr: true } } } },
    },
  });
  const productById = new Map(products.map((product) => [product.id, product]));

  const inventoryItems = await prisma.inventoryItem.findMany({
    where: { locationId, productId: { in: productIds } },
    select: { productId: true, variantId: true, deviceColorVariantId: true, quantity: true },
  });
  const stockByLineKey = new Map(
    inventoryItems.map((item) => [`${item.productId}:${item.variantId ?? ""}:${item.deviceColorVariantId ?? ""}`, item.quantity]),
  );

  const lines = saleItems.map((item) => ({ ...item, colorId: item.colorId ?? null, variantId: item.variantId ?? null, deviceColorVariantId: item.deviceColorVariantId ?? null }));

  // Color no longer distinguishes a stock bucket, so two lines for the same
  // product+variant/combo but different colors draw from the same bucket —
  // sum requested quantity per product+variant+combo (ignoring color) before
  // comparing against available stock.
  const requestedByLineKey = new Map<string, number>();
  for (const item of lines) {
    const key = `${item.productId}:${item.variantId ?? ""}:${item.deviceColorVariantId ?? ""}`;
    requestedByLineKey.set(key, (requestedByLineKey.get(key) ?? 0) + item.quantity);
  }

  for (const item of lines) {
    const product = productById.get(item.productId);
    if (!product) {
      return { ok: false, error: "أحد المنتجات المحددة غير موجود" };
    }
    if (!product.isActive) {
      return { ok: false, error: `المنتج "${product.nameAr ?? product.name}" غير مفعّل ولا يمكن بيعه` };
    }
    // Deliberately NO "must pick a variant/combo for this product's tracking
    // mode" requirement here (unlike assignStockToRep's validateTransferLines,
    // which still enforces exactly that for a WAREHOUSE-side transfer): a
    // rep-car sale is always product-level now, regardless of whether the
    // product happens to use PHONE_COMPATIBILITY or DEVICE_MODEL_COLOR for
    // warehouse tracking — the rep only ever sees "Product + quantity +
    // price" (see ProductSalePicker.tsx), never a phone-model choice. If a
    // caller DOES supply a real variantId/deviceColorVariantId anyway (not
    // possible from the current picker, but never trusted blindly), it's
    // still checked for validity below so a stale/foreign id can't sneak
    // through — just never REQUIRED.
    if (item.deviceColorVariantId && !product.deviceColorVariants.some((combo) => combo.id === item.deviceColorVariantId)) {
      return { ok: false, error: `الخيار المحدد لا ينتمي للمنتج "${product.nameAr ?? product.name}"` };
    }
    if (item.colorId && !product.colorOptions.some((option) => option.colorId === item.colorId)) {
      return { ok: false, error: `اللون المحدد لا ينتمي للمنتج "${product.nameAr ?? product.name}"` };
    }
    if (item.variantId && !product.variants.some((variant) => variant.id === item.variantId)) {
      return { ok: false, error: `الخيار المحدد لا ينتمي للمنتج "${product.nameAr ?? product.name}"` };
    }
    const key = `${item.productId}:${item.variantId ?? ""}:${item.deviceColorVariantId ?? ""}`;
    const available = stockByLineKey.get(key) ?? 0;
    if (available <= 0) {
      return { ok: false, error: `المنتج "${product.nameAr ?? product.name}" غير موجود في مخزونك` };
    }
    if (requestedByLineKey.get(key)! > available) {
      return { ok: false, error: `الكمية المطلوبة لـ "${product.nameAr ?? product.name}" أكبر من مخزونك الحالي` };
    }
  }

  const totalCents = lines.reduce((sum, item) => sum + item.unitPriceCents * item.quantity, 0);

  // repSaleSchema already re-derives this same total from these same items
  // and rejects paidNowCents > total at parse time — this is a second,
  // independent check against the actual authoritative totalCents computed
  // right here (never a client-sent total), matching the admin manual-order
  // flow's own belt-and-suspenders check in src/app/admin/orders/new/actions.ts.
  if (paidNowCents > totalCents) {
    return { ok: false, error: "المبلغ المدفوع الآن أكبر من إجمالي الفاتورة" };
  }
  const paymentStatus =
    totalCents > 0 && paidNowCents >= totalCents
      ? PAYMENT_STATUSES.PAID
      : paidNowCents > 0
        ? PAYMENT_STATUSES.PARTIAL
        : PAYMENT_STATUSES.PENDING;

  let orderNumber = "";
  let succeeded = false;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await prisma.$transaction(async (tx) => {
        const requestedVariantIds = lines.flatMap((item) => (item.variantId ? [item.variantId] : []));
        if (requestedVariantIds.length > 0) {
          const activeVariants = await tx.productVariant.count({ where: { id: { in: requestedVariantIds }, isActive: true } });
          if (activeVariants !== new Set(requestedVariantIds).size) throw new Error("INACTIVE_VARIANT");
        }
        const requestedComboIds = lines.flatMap((item) => (item.deviceColorVariantId ? [item.deviceColorVariantId] : []));
        if (requestedComboIds.length > 0) {
          const activeCombos = await tx.deviceColorVariant.count({ where: { id: { in: requestedComboIds }, isActive: true } });
          if (activeCombos !== new Set(requestedComboIds).size) throw new Error("INACTIVE_VARIANT");
        }

        // Atomic conditional transition (status: OPEN in the where clause) —
        // never a stale read-then-write, so two concurrent submits racing to
        // complete the same customer order (or a submit racing an admin's
        // cancelRepCustomerOrder) can never both succeed. Whichever lands
        // first wins; the other's whole sale transaction rolls back via the
        // thrown error below, exactly like the INACTIVE_VARIANT checks above.
        if (repCustomerOrderId) {
          const transitioned = await tx.repCustomerOrder.updateMany({
            where: { id: repCustomerOrderId, status: REP_CUSTOMER_ORDER_STATUSES.OPEN },
            data: { status: REP_CUSTOMER_ORDER_STATUSES.COMPLETED, completedAt: new Date() },
          });
          if (transitioned.count !== 1) throw new Error("CUSTOMER_ORDER_NOT_OPEN");
        }

        // Resolve this rep's trader for the sale by phone — reuses whichever
        // Merchant already matches (self-registered, added by an admin, or
        // created by this rep on an earlier sale), regardless of whether it
        // has a login. No match creates a new login-less trader, approved
        // immediately and assigned to this rep, visible in /admin/merchants
        // right away — see the Merchant model doc comment. Shared with
        // assignStockToRep's CUSTOMER_ORDER path (src/app/admin/reps/actions.ts)
        // via resolveOrCreateRepMerchant so both flows resolve the exact same
        // trader identity by the exact same rule.
        const merchant = await resolveOrCreateRepMerchant(tx, {
          salesRepId,
          businessName: customerName,
          contactPhone: customerPhone,
          city,
          address,
        });
        // A brand-new trader created just above is always APPROVED (see
        // resolveOrCreateRepMerchant), so this only ever rejects a sale
        // against an EXISTING merchant an admin has since archived/suspended
        // (Merchant.status === SUSPENDED doubles as the archival state — see
        // the schema doc comment) — a suspended merchant must never receive
        // a new sale, even though their historical statement stays fully
        // intact and viewable.
        if (merchant.status !== MERCHANT_STATUSES.APPROVED) {
          throw new Error("MERCHANT_NOT_APPROVED");
        }
        const accountId = await getOrCreateMerchantAccount(tx, merchant.id);

        // Concurrency-safe daily sequence (OVI-YYYYMMDD-NNNN, resetting
        // every business day — see generateDailyOrderNumber) — generated
        // inside this same transaction, right before the row that actually
        // consumes it, so the advisory lock it takes covers exactly the
        // "read current max, then insert" critical section.
        orderNumber = await generateDailyOrderNumber(tx);

        const createdOrder = await tx.order.create({
          data: {
            orderNumber,
            source: ORDER_SOURCES.REP_SALE,
            status: ORDER_STATUSES.DELIVERED,
            stockLocationId: locationId,
            customerId: merchant.userId,
            merchantId: merchant.id,
            accountId,
            createdByRepId: salesRepId,
            repCustomerOrderId,
            subtotalCents: totalCents,
            totalCents,
            contactName: customerName,
            contactPhone: customerPhone,
            city,
            shippingAddress: address,
            notes,
            paymentMethod: PAYMENT_METHODS.CASH,
            paymentStatus,
            paidAmountCents: paidNowCents,
            items: {
              create: lines.map((item) => {
                const variant = productById.get(item.productId)?.variants.find((row) => row.id === item.variantId);
                const combo = productById.get(item.productId)?.deviceColorVariants.find((row) => row.id === item.deviceColorVariantId);
                const colorOption = productById.get(item.productId)?.colorOptions.find((row) => row.colorId === item.colorId);
                return {
                  productId: item.productId,
                  colorId: item.colorId,
                  variantId: item.variantId,
                  deviceColorVariantId: item.deviceColorVariantId,
                  productNameSnapshot: productById.get(item.productId)?.nameAr ?? productById.get(item.productId)?.name,
                  productSkuSnapshot: productById.get(item.productId)?.sku,
                  variantCodeSnapshot: variant?.variantCode ?? null,
                  // Same snapshot fields either way — a device+color
                  // combination and a phone-model variant both resolve to a
                  // brand/model(/color) triple (see checkout/actions.ts).
                  phoneBrandSnapshot: variant
                    ? (variant.phoneModel.phoneBrand.nameAr ?? variant.phoneModel.phoneBrand.name)
                    : combo
                      ? (combo.phoneModel.phoneBrand.nameAr ?? combo.phoneModel.phoneBrand.name)
                      : null,
                  phoneModelSnapshot: variant
                    ? (variant.phoneModel.nameAr ?? variant.phoneModel.name)
                    : combo
                      ? (combo.phoneModel.nameAr ?? combo.phoneModel.name)
                      : null,
                  colorNameSnapshot: colorOption?.color
                    ? (colorOption.color.nameAr ?? colorOption.color.name)
                    : combo
                      ? (combo.color.nameAr ?? combo.color.name)
                      : null,
                  quantity: item.quantity,
                  unitPriceCents: item.unitPriceCents,
                  totalCents: item.unitPriceCents * item.quantity,
                };
              }),
            },
          },
        });

        // Order.totalCents above is always the FULL invoice amount — a
        // wholesale trader's unpaid remainder is meant to sit on their
        // account as debt, never silently shrunk. Only the amount actually
        // received right now (paidNowCents, possibly 0, possibly the full
        // total) is mirrored into the ledger as a real payment, exactly once
        // — omitted entirely when nothing was paid, so getAccountBalanceCents
        // never has to special-case a zero-amount row. createdById here
        // records the ACTUAL actor (the rep themselves, or the admin acting
        // on their behalf) — never falsely attributed to the rep when an
        // admin entered it. The order number is already known at this point
        // (generated just above, inside this same transaction), so the note
        // can reference it for traceability without a second lookup — never
        // relied on for accounting itself (see recordInitialAccountPayment's
        // doc comment).
        if (paidNowCents > 0) {
          await recordInitialAccountPayment(tx, accountId, paidNowCents, actorUserId, createdOrder.id, {
            method: paidNowMethod,
            note: `دفعة عند إنشاء الطلب - فاتورة #${orderNumber}`,
          });
        }

        // Per line: atomic conditional decrement — never a stale
        // read-then-write. If the rep's car stock is no longer sufficient
        // (e.g. a concurrent sale of the same item), the whole sale rolls
        // back instead of driving stock negative.
        for (const item of lines) {
          const change = await decrementInventoryAtomic(
            tx,
            { productId: item.productId, variantId: item.variantId, deviceColorVariantId: item.deviceColorVariantId, locationId },
            item.quantity,
          );

          await recordStockMovement(tx, {
            type: STOCK_MOVEMENT_TYPES.SALE_OUT,
            productId: item.productId,
            variantId: item.variantId,
            deviceColorVariantId: item.deviceColorVariantId,
            fromLocationId: locationId,
            toLocationId: null,
            quantity: item.quantity,
            previousQuantity: change.previousQuantity,
            newQuantity: change.newQuantity,
            note: `بيع مباشر — طلب ${orderNumber}`,
            createdById: actorUserId,
          });
        }
      });
      succeeded = true;
      break;
    } catch (err) {
      if (err instanceof Error && err.message === "INACTIVE_VARIANT") return { ok: false, error: "أحد خيارات المنتج لم يعد فعالاً؛ أعد اختيار الـVariant" };
      if (err instanceof Error && err.message === "CUSTOMER_ORDER_NOT_OPEN") return { ok: false, error: "لم تعد طلبية الزبون هذه نشطة — حدّث الصفحة وحاول مجدداً" };
      if (err instanceof Error && err.message === "MERCHANT_NOT_APPROVED") return { ok: false, error: "هذا التاجر موقوف حالياً ولا يمكن تسجيل بيع جديد له" };
      if (err instanceof InsufficientInventoryError) {
        return { ok: false, error: "الكمية المطلوبة أكبر من مخزونك الحالي لأحد المنتجات، حاول مرة أخرى" };
      }
      const isDuplicateOrderNumber =
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002" &&
        (err.meta?.target as string[] | undefined)?.includes("orderNumber");
      if (!isDuplicateOrderNumber) throw err;
    }
  }

  if (!succeeded) {
    return { ok: false, error: "تعذّر إنشاء رقم الطلب، حاول مرة أخرى" };
  }

  revalidateRepSalePaths(orderNumber);
  return { ok: true, orderNumber };
}
