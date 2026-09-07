"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireEffectiveRepresentative } from "@/lib/auth/impersonation";
import { ADMIN_AUDIT_ACTIONS, STOCK_REQUEST_STATUSES, STOCK_REQUEST_TYPES } from "@/lib/constants";
import { generateRequestNumber } from "@/lib/rep-stock-requests";
import { repStockRequestCreateSchema } from "@/lib/validation/repStockRequest";

export interface RepStockRequestState {
  error?: string;
}

const PARSE_ERROR_MESSAGE = "بيانات الطلب غير صالحة";

function revalidateRequestPaths(requestId: string): void {
  revalidatePath("/rep");
  revalidatePath("/rep/requests");
  revalidatePath(`/rep/requests/${requestId}`);
  revalidatePath("/admin/rep-requests");
  revalidatePath(`/admin/rep-requests/${requestId}`);
}

/** Creates a PENDING restock request only — never touches InventoryItem or
 * StockMovement. salesRepId is always resolved from the effective REP scope
 * (the real rep, or the rep an admin is impersonating), never trusted from
 * the client. */
export async function createStockRequest(
  _prevState: RepStockRequestState,
  formData: FormData,
): Promise<RepStockRequestState> {
  const effectiveRep = await requireEffectiveRepresentative();

  let items: unknown;
  try {
    items = JSON.parse(formData.get("items")?.toString() ?? "[]");
  } catch {
    return { error: PARSE_ERROR_MESSAGE };
  }

  const parsed = repStockRequestCreateSchema.safeParse({
    repNote: formData.get("repNote")?.toString().trim() || undefined,
    items,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? PARSE_ERROR_MESSAGE };
  }

  const productIds = parsed.data.items.map((item) => item.productId);
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, isActive: true, name: true, nameAr: true, variantMode: true, variantAllocationStatus: true, inventoryTrackingMode: true, variants: { where: { isActive: true }, select: { id: true } } },
  });
  const productById = new Map(products.map((product) => [product.id, product]));

  const lines = parsed.data.items.map((item) => ({ ...item, variantId: item.variantId ?? null }));

  for (const item of lines) {
    const product = productById.get(item.productId);
    if (!product) {
      return { error: "أحد المنتجات المحددة غير موجود" };
    }
    if (!product.isActive) {
      return { error: `المنتج "${product.nameAr ?? product.name}" غير مفعّل ولا يمكن طلبه` };
    }
    // DEVICE_MODEL_COLOR products track stock per brand+model+color
    // combination, which car-stock requests/transfers don't decrement from
    // yet — see the same guard in src/app/cart/actions.ts.
    if (product.inventoryTrackingMode === "DEVICE_MODEL_COLOR") {
      return { error: `المنتج "${product.nameAr ?? product.name}" غير متاح لطلبات مخزون السيارة حالياً` };
    }
    if (product.variantMode === "PHONE_COMPATIBILITY" && (product.variantAllocationStatus !== "READY" || !item.variantId || !product.variants.some((variant) => variant.id === item.variantId))) return { error: `اختر Variant صالحاً للمنتج "${product.nameAr ?? product.name}"` };
    if (product.variantMode !== "PHONE_COMPATIBILITY" && item.variantId) return { error: "Variant لا يتبع المنتج المحدد" };
  }

  let requestId = "";
  let succeeded = false;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const requestNumber = generateRequestNumber();
    try {
      // Wrapped in a transaction (rather than a bare create) only so the
      // impersonation audit row below can be written atomically with the
      // stock request itself — either both commit or both roll back. A
      // genuine REP session pays the negligible cost of an extra
      // transaction wrapper around what is otherwise the exact same insert.
      const created = await prisma.$transaction(async (tx) => {
        const request = await tx.stockRequest.create({
          data: {
            requestNumber,
            salesRepId: effectiveRep.repId,
            status: STOCK_REQUEST_STATUSES.PENDING,
            type: STOCK_REQUEST_TYPES.RESTOCK,
            repNote: parsed.data.repNote,
            items: {
              create: lines.map((item) => ({
                productId: item.productId,
                variantId: item.variantId,
                requestedQuantity: item.requestedQuantity,
              })),
            },
          },
          select: { id: true },
        });

        if (effectiveRep.isImpersonating) {
          await tx.adminAuditLog.create({
            data: {
              adminUserId: effectiveRep.realUser.id,
              targetUserId: effectiveRep.actingUserId,
              action: ADMIN_AUDIT_ACTIONS.IMPERSONATED_REP_STOCK_REQUEST_CREATED,
              newValue: { salesRepId: effectiveRep.repId, requestId: request.id },
            },
          });
        }

        return request;
      });
      requestId = created.id;
      succeeded = true;
      break;
    } catch (err) {
      const isDuplicateRequestNumber =
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002" &&
        (err.meta?.target as string[] | undefined)?.includes("requestNumber");
      if (!isDuplicateRequestNumber) throw err;
    }
  }

  if (!succeeded) {
    return { error: "تعذّر إنشاء رقم الطلب، حاول مرة أخرى" };
  }

  revalidateRequestPaths(requestId);
  redirect(`/rep/requests/${requestId}`);
}
