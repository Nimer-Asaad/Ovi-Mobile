"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth/guards";
import { ROLES } from "@/lib/constants";
import { orderLifecycleTransitionSchema, paymentStatusSchema } from "@/lib/validation/order";
import { transitionOrderStatus } from "@/lib/order-lifecycle";
import { reverseSalesReturn, revalidateSalesReturnReversalPaths } from "@/lib/sales-return-reversal";
import type { OrderStatus } from "@/types";

export interface OrderActionState {
  error?: string;
  success?: boolean;
}

function revalidateOrderPaths(orderNumber: string): void {
  revalidatePath("/admin/orders");
  revalidatePath(`/admin/orders/${orderNumber}`);
  revalidatePath("/orders");
  revalidatePath(`/orders/${orderNumber}`);
  revalidatePath("/admin");
}

export async function updateOrderStatus(
  orderNumber: string,
  _prevState: OrderActionState,
  formData: FormData,
): Promise<OrderActionState> {
  const admin = await requireRole([ROLES.ADMIN]);

  const parsed = orderLifecycleTransitionSchema.safeParse({
    ...Object.fromEntries(formData.entries()),
    orderNumber,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات تحديث حالة الطلب غير صالحة" };
  }

  try {
    const result = await transitionOrderStatus({
      orderNumber: parsed.data.orderNumber,
      requestedStatus: parsed.data.status as OrderStatus,
      reason: parsed.data.reason,
      actorUserId: admin.id,
    });
    if (!result.ok) return { error: result.message };
  } catch (error) {
    console.error("[admin/orders] lifecycle transition failed", {
      route: "/admin/orders/[orderNumber]",
      operation: "transition-status",
      error,
    });
    return { error: "تعذر تحديث حالة الطلب، حاول مرة أخرى" };
  }

  revalidateOrderPaths(orderNumber);
  return { success: true };
}

export async function updatePaymentStatus(
  orderNumber: string,
  _prevState: OrderActionState,
  formData: FormData,
): Promise<OrderActionState> {
  await requireRole([ROLES.ADMIN]);

  const parsed = paymentStatusSchema.safeParse(formData.get("paymentStatus")?.toString());
  if (!parsed.success) {
    return { error: "حالة الدفع غير صالحة" };
  }

  const existing = await prisma.order.findUnique({ where: { orderNumber }, select: { id: true } });
  if (!existing) {
    return { error: "الطلب غير موجود" };
  }

  await prisma.order.update({ where: { orderNumber }, data: { paymentStatus: parsed.data } });

  revalidateOrderPaths(orderNumber);
  return { success: true };
}

export interface SalesReturnReversalState {
  error?: string;
  success?: boolean;
}

/** ADMIN-only "إلغاء مردود المبيعات" — never ADMIN_ASSISTANT (this reverses
 * a financial + inventory correction, not a warehouse-prep action), and
 * never reachable by a REP: unlike the return itself (owned by the rep who
 * created it), a REP must not be able to reverse their own historical
 * return — see reverseSalesReturn's own doc comment (src/lib/
 * sales-return-reversal.ts) for the full atomic transaction this runs. */
export async function reverseSalesReturnAction(_prevState: SalesReturnReversalState, formData: FormData): Promise<SalesReturnReversalState> {
  const actor = await requireRole([ROLES.ADMIN]);

  const salesReturnId = formData.get("salesReturnId")?.toString();
  const orderNumber = formData.get("orderNumber")?.toString();
  const reason = formData.get("reason")?.toString() ?? "";
  if (!salesReturnId || !orderNumber) {
    return { error: "مردود المبيعات غير موجود" };
  }

  const result = await reverseSalesReturn({ salesReturnId, actorUserId: actor.id, reason });
  if (!result.ok) {
    return { error: result.error };
  }

  revalidateOrderPaths(orderNumber);
  revalidatePath(`/admin/orders/${orderNumber}/invoice`);
  revalidateSalesReturnReversalPaths(orderNumber);
  return { success: true };
}
