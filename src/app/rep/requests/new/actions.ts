"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth/guards";
import { ROLES, STOCK_REQUEST_STATUSES, STOCK_REQUEST_TYPES } from "@/lib/constants";
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
 * StockMovement. salesRepId is always resolved from the session user, never
 * trusted from the client. */
export async function createStockRequest(
  _prevState: RepStockRequestState,
  formData: FormData,
): Promise<RepStockRequestState> {
  const user = await requireRole([ROLES.SALES_REPRESENTATIVE]);

  const rep = await prisma.salesRepresentative.findUnique({
    where: { userId: user.id },
    select: { id: true, isActive: true },
  });
  if (!rep) {
    return { error: "لم يتم العثور على ملف المندوب" };
  }
  if (!rep.isActive) {
    return { error: "لا يمكن إنشاء طلب لمندوب غير مفعل" };
  }

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
    select: { id: true, isActive: true, name: true, nameAr: true },
  });
  const productById = new Map(products.map((product) => [product.id, product]));

  for (const item of parsed.data.items) {
    const product = productById.get(item.productId);
    if (!product) {
      return { error: "أحد المنتجات المحددة غير موجود" };
    }
    if (!product.isActive) {
      return { error: `المنتج "${product.nameAr ?? product.name}" غير مفعّل ولا يمكن طلبه` };
    }
  }

  let requestId = "";
  let succeeded = false;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const requestNumber = generateRequestNumber();
    try {
      const created = await prisma.stockRequest.create({
        data: {
          requestNumber,
          salesRepId: rep.id,
          status: STOCK_REQUEST_STATUSES.PENDING,
          type: STOCK_REQUEST_TYPES.RESTOCK,
          repNote: parsed.data.repNote,
          items: {
            create: parsed.data.items.map((item) => ({
              productId: item.productId,
              requestedQuantity: item.requestedQuantity,
            })),
          },
        },
        select: { id: true },
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
