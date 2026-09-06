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

/** A stable, deterministic FALLBACK display reference for a payment receipt
 * — "PAY-<createdAt's calendar date, YYYYMMDD>-<last 6 chars of the
 * payment's own id, uppercased>" — used ONLY for a legacy AccountPayment row
 * that predates the receiptNumber column (see resolvePaymentReceiptReference
 * below, which every caller should use instead of this directly). This is
 * deliberately NOT a counted/ordinal sequence — it never claims to be "the
 * Nth receipt that day" — only a readable label derived purely from data
 * already persisted on the payment itself (id + createdAt), so the exact
 * same legacy receipt always displays the exact same reference no matter
 * when it's viewed. Purely cosmetic/display — never used for accounting,
 * ordering, or lookup (the receipt page and its historical-balance
 * calculation both key off the real AccountPayment.id, never this string),
 * so it deliberately reuses the same plain calendar-date convention already
 * used to display any other payment/order date in this app (see
 * InvoiceView's own date display) rather than attempting the
 * DB-session-timezone correction that IS required for the order/payment
 * daily-sequence counting logic (an accounting/uniqueness concern this is
 * not). */
export function buildPaymentReceiptReference(payment: { id: string; createdAt: Date }): string {
  const y = payment.createdAt.getUTCFullYear();
  const m = String(payment.createdAt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(payment.createdAt.getUTCDate()).padStart(2, "0");
  const suffix = payment.id.slice(-6).toUpperCase();
  return `PAY-${y}${m}${d}-${suffix}`;
}

/** The receipt number every payment-receipt display/filename should
 * actually use: the real, persisted, daily-sequential
 * AccountPayment.receiptNumber (see generateDailyPaymentReceiptNumber in
 * src/lib/payment-number.ts) when present, falling back to the
 * non-sequential buildPaymentReceiptReference only for a historical row
 * that predates that column (receiptNumber === null, and never backfilled —
 * see the schema doc comment on AccountPayment.receiptNumber). Centralized
 * here so PaymentReceiptView and PaymentReceiptActions can never disagree
 * on which reference a given payment shows. */
export function resolvePaymentReceiptReference(payment: { id: string; createdAt: Date; receiptNumber: string | null }): string {
  return payment.receiptNumber ?? buildPaymentReceiptReference(payment);
}
