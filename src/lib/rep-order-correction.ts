import "server-only";
import { prisma } from "@/lib/prisma";
import { ORDER_SOURCES } from "@/lib/constants";
import { correctSale } from "@/lib/sale-correction";

export type CorrectRepOrderSaleResult = { ok: true; orderNumber: string } | { ok: false; error: string };

/** "إلغاء وإرجاع للسيارة" for one REP sale shown in a rep's "طلبات الزبائن" list
 * (/admin/reps/[id]). The ONLY logic here is the ownership gate; the
 * cancellation itself is the canonical sale correction (correctSale →
 * transitionOrderStatusInTransaction), which restores every unit to the sale's
 * own original stock location — the rep's car, never the warehouse —
 * writes the compensation + movement + status history (with the mandatory
 * reason), cancels the linked initial payment when eligible, and refuses a
 * sale that already has active sales returns, a legacy sale without stock
 * provenance, or one that is already cancelled/returned.
 *
 * Ownership: the order must be a REP_SALE created by `repId`, so a tampered
 * orderNumber can never reach another rep's (or a storefront) order through
 * this card. Authorization (ADMIN) is the caller's job. */
export async function correctRepOrderSaleCore(input: { repId: string; orderNumber: string; reason: string; actorUserId: string }): Promise<CorrectRepOrderSaleResult> {
  const order = await prisma.order.findUnique({
    where: { orderNumber: input.orderNumber },
    select: { createdByRepId: true, source: true },
  });
  if (!order || order.source !== ORDER_SOURCES.REP_SALE || order.createdByRepId !== input.repId) {
    return { ok: false, error: "الطلب غير موجود" };
  }

  const result = await correctSale({ orderNumber: input.orderNumber, reason: input.reason, actorUserId: input.actorUserId });
  if (!result.ok) return { ok: false, error: result.message };
  return { ok: true, orderNumber: result.orderNumber };
}
