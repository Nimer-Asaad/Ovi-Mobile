/** Pure, deterministic sales-return money math — integer agorot only, no
 * floating point anywhere (BigInt for the multiply-then-divide steps so a
 * large invoice can never overflow Number's 2^53 exact-integer range).
 *
 * THE ONE CANONICAL RULE for how much credit a partial return earns. It is
 * derived ONLY from the ORIGINAL persisted invoice economics — OrderItem
 * .quantity / .bonusQuantity / .totalCents and Order.discountCents — never
 * from any current product price.
 *
 * STEP 1 — allocate the invoice-level discount across lines.
 *   Each line's `totalCents` is already its CHARGED value (unitPrice x
 *   paid units — bonus units contribute 0). Order.discountCents is split
 *   across lines proportionally to that charged value using the
 *   largest-remainder method:
 *       base_i  = floor(discount x line_i / subtotal)
 *       the (discount - sum(base_i)) leftover cents go, one each, to the
 *       lines with the largest fractional remainder
 *       (discount x line_i mod subtotal); ties -> smaller line id first.
 *   netLine_i = line_i - allocatedDiscount_i. By construction
 *   sum(netLine_i) == Order.totalCents EXACTLY, and 0 <= netLine_i <= line_i.
 *
 * STEP 2 — credit for returning units of one line, EXPLICITLY split into
 *   paid vs. bonus by the rep (never inferred/guessed — see
 *   SalesReturnItem.bonusQuantity's schema doc comment). A line with
 *   quantity q and bonusQuantity b has p = q - b originally PAID units.
 *   Only the PAID portion of what's being returned ever earns credit — a
 *   returned bonus unit is physical stock (goes back to REP_CAR) but always
 *   contributes exactly 0 money. The line's CUMULATIVE credit after
 *   `paidReturned` PAID units have been returned in total is
 *       C(paidReturned) = floor(netLine x min(paidReturned, p) / p)   (0 when p == 0)
 *   and one return operation's credit is C(after) - C(before), where
 *   before/after are the cumulative PAID-returned count (never the
 *   physical count). Because C is a monotone function of that count,
 *   credits from any sequence of partial returns always add up to exactly
 *   C(total paid returned): no rounding drift, and returning every paid
 *   unit yields exactly netLine (so a fully returned invoice — every paid
 *   unit of every line — credits exactly Order.totalCents).
 *
 * Consequently cumulative credit per line <= netLine and per invoice <=
 * Order.totalCents, always. */

export interface MathOrderLine {
  id: string;
  quantity: number;
  bonusQuantity: number;
  /** OrderItem.totalCents — the charged (bonus-excluded) line value. */
  totalCents: number;
}

/** id -> allocated share of the invoice discount (integer cents). */
export function allocateDiscountAcrossLines(lines: Pick<MathOrderLine, "id" | "totalCents">[], discountCents: number): Map<string, number> {
  const allocation = new Map<string, number>(lines.map((line) => [line.id, 0]));
  const subtotal = lines.reduce((sum, line) => sum + line.totalCents, 0);
  if (discountCents <= 0 || subtotal <= 0) return allocation;
  if (discountCents > subtotal) throw new RangeError("DISCOUNT_EXCEEDS_SUBTOTAL");

  const discount = BigInt(discountCents);
  const total = BigInt(subtotal);
  const ordered = [...lines].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  let allocated = BigInt(0);
  const remainders: { id: string; remainder: bigint }[] = [];
  for (const line of ordered) {
    const numerator = discount * BigInt(line.totalCents);
    const base = numerator / total;
    allocation.set(line.id, Number(base));
    allocated += base;
    remainders.push({ id: line.id, remainder: numerator % total });
  }

  let leftover = Number(discount - allocated);
  remainders.sort((a, b) => (a.remainder === b.remainder ? (a.id < b.id ? -1 : 1) : a.remainder > b.remainder ? -1 : 1));
  for (const entry of remainders) {
    if (leftover <= 0) break;
    allocation.set(entry.id, (allocation.get(entry.id) ?? 0) + 1);
    leftover -= 1;
  }
  return allocation;
}

/** id -> the line's charged value AFTER its share of the invoice discount.
 * Sums to (sum of line totals) - discount == Order.totalCents. */
export function computeNetLineCents(lines: MathOrderLine[], discountCents: number): Map<string, number> {
  const discounts = allocateDiscountAcrossLines(lines, discountCents);
  return new Map(lines.map((line) => [line.id, line.totalCents - (discounts.get(line.id) ?? 0)]));
}

/** C(paidReturned): cumulative credit once `paidReturnedUnits` PAID units
 * (never physical/bonus units) of a line have been returned in total.
 * `originalPaidQty` is the line's own (quantity - bonusQuantity). */
export function cumulativePaidCreditCents(netLineCents: number, originalPaidQty: number, paidReturnedUnits: number): number {
  if (originalPaidQty <= 0 || netLineCents <= 0) return 0;
  const counted = Math.min(Math.max(paidReturnedUnits, 0), originalPaidQty);
  return Number((BigInt(netLineCents) * BigInt(counted)) / BigInt(originalPaidQty));
}

/** Credit earned by returning `requestedPaidUnits` more PAID units of a
 * line that already has `alreadyReturnedPaidUnits` PAID units returned.
 * Always >= 0. Bonus units never pass through here — see
 * SalesReturnItem.bonusQuantity's schema doc comment for how the rep's
 * explicit paid/bonus split feeds this. */
export function incrementalPaidCreditCents(
  netLineCents: number,
  originalPaidQty: number,
  alreadyReturnedPaidUnits: number,
  requestedPaidUnits: number,
): number {
  return (
    cumulativePaidCreditCents(netLineCents, originalPaidQty, alreadyReturnedPaidUnits + requestedPaidUnits) -
    cumulativePaidCreditCents(netLineCents, originalPaidQty, alreadyReturnedPaidUnits)
  );
}

export type SalesReturnStatus = "NONE" | "PARTIAL" | "FULL";

/** Derived (never persisted) return status of an invoice. */
export function deriveReturnStatus(totalUnits: number, returnedUnits: number): SalesReturnStatus {
  if (returnedUnits <= 0) return "NONE";
  return returnedUnits >= totalUnits ? "FULL" : "PARTIAL";
}

export function getReturnStatusLabel(status: SalesReturnStatus): string {
  switch (status) {
    case "NONE":
      return "لا يوجد مردود";
    case "PARTIAL":
      return "مردود جزئي";
    case "FULL":
      return "مردود كامل";
  }
}
