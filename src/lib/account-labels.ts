import { ACCOUNT_PAYMENT_METHODS } from "@/lib/constants";

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
