"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth/guards";
import { ROLES } from "@/lib/constants";
import { orderStatusSchema, paymentStatusSchema } from "@/lib/validation/order";

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
  await requireRole([ROLES.ADMIN]);

  const parsed = orderStatusSchema.safeParse(formData.get("status")?.toString());
  if (!parsed.success) {
    return { error: "حالة الطلب غير صالحة" };
  }

  const existing = await prisma.order.findUnique({ where: { orderNumber }, select: { id: true } });
  if (!existing) {
    return { error: "الطلب غير موجود" };
  }

  await prisma.order.update({ where: { orderNumber }, data: { status: parsed.data } });

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
