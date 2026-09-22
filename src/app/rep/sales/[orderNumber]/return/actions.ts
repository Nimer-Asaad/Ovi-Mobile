"use server";

import { redirect } from "next/navigation";
import { requireEffectiveRepresentative } from "@/lib/auth/impersonation";
import { ADMIN_AUDIT_ACTIONS } from "@/lib/constants";
import { createSalesReturn, revalidateSalesReturnPaths } from "@/lib/sales-returns";

export interface SalesReturnFormState {
  error?: string;
}

const PARSE_ERROR = "بيانات المردود غير صالحة";

/** Thin REP wrapper around createSalesReturn (src/lib/sales-returns.ts):
 * resolves the effective rep scope server-side — the rep id, REP_CAR
 * location and acting user ALWAYS come from the session
 * (requireEffectiveRepresentative), never from form fields — so a
 * manipulated orderNumber/orderItemId for another rep's invoice is rejected
 * by the core's ownership check (Order.createdByRepId === this rep). */
export async function createSalesReturnAction(_prev: SalesReturnFormState, formData: FormData): Promise<SalesReturnFormState> {
  const effectiveRep = await requireEffectiveRepresentative();

  const orderNumber = formData.get("orderNumber")?.toString();
  if (!orderNumber) return { error: PARSE_ERROR };

  let rawLines: unknown;
  try {
    rawLines = JSON.parse(formData.get("lines")?.toString() ?? "[]");
  } catch {
    return { error: PARSE_ERROR };
  }
  if (!Array.isArray(rawLines)) return { error: PARSE_ERROR };
  const lines: { orderItemId: string; quantity: number; bonusQuantity: number }[] = [];
  for (const raw of rawLines) {
    if (!raw || typeof raw !== "object") return { error: PARSE_ERROR };
    const { orderItemId, quantity, bonusQuantity } = raw as { orderItemId?: unknown; quantity?: unknown; bonusQuantity?: unknown };
    if (typeof orderItemId !== "string" || typeof quantity !== "number" || !Number.isInteger(quantity)) return { error: PARSE_ERROR };
    const bonus = bonusQuantity ?? 0;
    if (typeof bonus !== "number" || !Number.isInteger(bonus)) return { error: PARSE_ERROR };
    // Zero-quantity rows are simply "not returned" — the form sends every
    // row; only positive quantities are part of the return.
    if (quantity === 0) continue;
    lines.push({ orderItemId, quantity, bonusQuantity: bonus });
  }

  const locationId = effectiveRep.carStockLocationId;
  if (!locationId) return { error: "لم يتم العثور على موقع مخزون المندوب" };

  const note = formData.get("note")?.toString().trim() || null;

  const result = await createSalesReturn({
    orderNumber,
    salesRepId: effectiveRep.repId,
    carStockLocationId: locationId,
    actorUserId: effectiveRep.actingUserId,
    lines,
    note,
    // Same-transaction impersonation audit trail, only when an admin is
    // acting as this rep — never for a genuine REP session.
    onCreated: effectiveRep.isImpersonating
      ? async (tx, created) => {
          await tx.adminAuditLog.create({
            data: {
              adminUserId: effectiveRep.realUser.id,
              targetUserId: effectiveRep.actingUserId,
              action: ADMIN_AUDIT_ACTIONS.IMPERSONATED_REP_SALES_RETURN_CREATED,
              newValue: { salesRepId: effectiveRep.repId, orderId: created.orderId, orderNumber: created.orderNumber, salesReturnSequence: created.sequence, totalCreditCents: created.totalCreditCents },
            },
          });
        }
      : undefined,
  });

  if (!result.ok) return { error: result.error };

  revalidateSalesReturnPaths(result.orderNumber);
  redirect(`/rep/sales/${result.orderNumber}`);
}
