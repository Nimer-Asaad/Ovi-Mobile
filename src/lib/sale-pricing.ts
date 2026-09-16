import { PAYMENT_STATUSES } from "@/lib/constants";

/** The ONE canonical sale-line/invoice pricing calculation — shared by
 * createRepSaleCore (src/lib/rep-sales.ts) and createManualOrder
 * (src/app/admin/orders/new/actions.ts), the two places that ever construct
 * an Order+OrderItem set. Neither of those files re-derives any of this
 * math inline; both call these functions instead, so a bonus/discount rule
 * can never quietly drift between the REP and ADMIN sale flows.
 *
 * BONUS SEMANTICS (بونص): a bonus unit is a REAL physical unit — it still
 * decrements inventory/REP_CAR/WAREHOUSE exactly like a paid unit (see
 * OrderItem.quantity's own doc comment: quantity is always the TOTAL
 * physical count, never reduced for a bonus line) — only the CHARGED amount
 * for that unit becomes zero. This is deliberately never implemented by
 * setting quantity to a smaller number or to zero.
 *
 * DISCOUNT SEMANTICS: a single, sale-level, fixed-money (NIS/agorot)
 * reduction applied to the chargeable subtotal (never a percentage, and
 * never applied per-line) — Order.discountCents already existed in the
 * schema before this feature (used by the admin manual-order flow); this
 * module is what newly makes it available to rep sales too, through the
 * exact same formula. */

export interface SaleLineChargeInput {
  quantity: number;
  bonusQuantity: number;
  unitPriceCents: number;
}

/** A line's charged (billable) total — unitPriceCents × the PAID portion of
 * quantity (quantity minus whatever part of it is bonus). Always the value
 * persisted into OrderItem.totalCents at creation time; every later reader
 * of that field (invoices, statements, reports) needs no bonus-awareness of
 * its own, since a bonus unit already contributes exactly 0 to this. */
export function calculateLineChargeCents(line: SaleLineChargeInput): number {
  return line.unitPriceCents * (line.quantity - line.bonusQuantity);
}

/** Sum of calculateLineChargeCents across every line — this is the
 * "chargeable subtotal", i.e. Order.subtotalCents: gross item value MINUS
 * bonus value, already netted out per line rather than computed as two
 * separate gross/bonus totals subtracted from each other — algebraically
 * identical, but this is the one place either core actually calls. */
export function calculateChargeableSubtotalCents(lines: SaleLineChargeInput[]): number {
  return lines.reduce((sum, line) => sum + calculateLineChargeCents(line), 0);
}

/** 0 <= bonusQuantity <= quantity, and both must be whole numbers — the
 * only bonus-quantity rule this app enforces. Returns a ready-to-display
 * Arabic error message, or null when valid. Never allows an arbitrary
 * partial-price multiplier (e.g. "× 0.37") — a unit is either charged at
 * its full normal unitPriceCents, or it is bonus (charged at 0); there is
 * no representation for anything in between within a single unit. */
export function validateBonusQuantity(quantity: number, bonusQuantity: number): string | null {
  if (!Number.isInteger(bonusQuantity)) return "كمية البونص يجب أن تكون رقماً صحيحاً";
  if (bonusQuantity < 0) return "كمية البونص لا يمكن أن تكون سالبة";
  if (bonusQuantity > quantity) return "كمية البونص أكبر من الكمية الفعلية للصنف";
  return null;
}

/** 0 <= discountCents <= chargeableSubtotalCents — the only invoice-level
 * discount rule this app enforces (a fixed NIS amount, never a percentage).
 * Returns a ready-to-display Arabic error message, or null when valid. */
export function validateInvoiceDiscount(discountCents: number, chargeableSubtotalCents: number): string | null {
  if (discountCents < 0) return "الخصم لا يمكن أن يكون سالباً";
  if (discountCents > chargeableSubtotalCents) return "الخصم أكبر من المجموع الفرعي";
  return null;
}

/** subtotal - discount, floored at 0 — Order.totalCents. The floor is
 * defensive only (validateInvoiceDiscount already rejects a discount larger
 * than the subtotal before this is ever called in a real request), kept
 * here so this function can never itself produce a negative total even if
 * called directly. */
export function calculateInvoiceTotalCents(chargeableSubtotalCents: number, discountCents: number): number {
  return Math.max(chargeableSubtotalCents - discountCents, 0);
}

/** The one place Order.paymentStatus is ever derived from a total/paid
 * pair — used by both sale cores instead of each inlining its own
 * (previously slightly different) condition. A zero-total invoice (every
 * line fully bonus, and/or a 100%-discounted sale) is always PAID: there is
 * nothing left owing, so by definition nothing is "pending" — never a
 * separate zero-total status. */
export function derivePaymentStatus(totalCents: number, paidCents: number): string {
  if (totalCents <= 0) return PAYMENT_STATUSES.PAID;
  if (paidCents >= totalCents) return PAYMENT_STATUSES.PAID;
  if (paidCents > 0) return PAYMENT_STATUSES.PARTIAL;
  return PAYMENT_STATUSES.PENDING;
}
