import { ACCOUNT_PAYMENT_METHODS } from "@/lib/constants";
import { formatCurrencyFromCents } from "@/lib/utils";

/** Centralized Arabic labels for account-payment-related string fields.
 * Falls back to the raw value itself (never crashes) for an
 * old/legacy/unexpected value, same convention as order-labels.ts. */

const ACCOUNT_PAYMENT_METHOD_LABELS: Record<string, string> = {
  [ACCOUNT_PAYMENT_METHODS.CASH]: "نقداً",
  [ACCOUNT_PAYMENT_METHODS.BANK_TRANSFER]: "تحويل بنكي",
  [ACCOUNT_PAYMENT_METHODS.CHEQUE]: "شيك",
  [ACCOUNT_PAYMENT_METHODS.OTHER]: "أخرى",
};

export function getAccountPaymentMethodLabel(method: string): string {
  return ACCOUNT_PAYMENT_METHOD_LABELS[method] ?? method;
}

export interface DebtOrCreditDisplay {
  /** Empty when `cents` is a normal debt — the caller supplies its own
   * label in that case (e.g. "الذمة الحالية على التاجر"); non-empty only
   * for the credit case, since that reading needs different wording, not
   * just a different color. */
  label: string;
  amount: string;
  isCredit: boolean;
}

/** getAccountBalanceCents can legitimately go negative (a trader who has
 * paid ahead of their invoices) — never silently clamp that to zero, since
 * it would hide a real credit the trader is owed. Shared by the rep-sale
 * debt preview (NewSaleForm) and the sale invoice (InvoiceView) so both
 * render a negative balance with the exact same "رصيد دائن" convention
 * instead of two competing ones. Renders as a plain debt amount when >= 0,
 * or an explicit "رصيد دائن" (credit) line when negative — the sign is
 * never shown as a bare "-" that could read as a typo. */
export function formatDebtOrCredit(cents: number): DebtOrCreditDisplay {
  if (cents < 0) {
    return { label: "رصيد دائن للتاجر", amount: formatCurrencyFromCents(Math.abs(cents)), isCredit: true };
  }
  return { label: "", amount: formatCurrencyFromCents(cents), isCredit: false };
}
