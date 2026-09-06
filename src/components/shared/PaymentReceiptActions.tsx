"use client";

import { DocumentShareActions } from "@/components/shared/DocumentShareActions";
import { PaymentReceiptView, type PaymentReceiptData } from "@/components/shared/PaymentReceiptView";
import { resolvePaymentReceiptReference, formatDebtOrCredit } from "@/lib/account-labels";
import { formatCurrencyFromCents } from "@/lib/utils";

interface PaymentReceiptActionsProps {
  payment: PaymentReceiptData;
  /** Merchant.whatsappPhone, falling back to contactPhone when no separate
   * WhatsApp number was saved — already resolved by the caller (the receipt
   * page), never re-derived here. Null when the payment has no merchant, or
   * the merchant has neither number saved. */
  whatsappNumber: string | null;
}

/** Payment-receipt instantiation of the shared print/PNG/WhatsApp shell
 * (DocumentShareActions) around PaymentReceiptView — the exact same pattern
 * InvoiceActions uses for sale invoices, applied to a سند قبض instead. The
 * WhatsApp message deliberately never claims the receipt image itself was
 * auto-attached (see DocumentShareActions' own fallback wording) — only
 * that a payment was recorded, with the receipt reference for the merchant
 * to match against the attached image. */
export function PaymentReceiptActions({ payment, whatsappNumber }: PaymentReceiptActionsProps) {
  const reference = resolvePaymentReceiptReference(payment);
  const after = formatDebtOrCredit(payment.account.afterBalanceCents);

  const shareText = [
    "مرحباً،",
    "تم تسجيل دفعة على حسابكم لدى Ovi Mobile.",
    "",
    `قيمة الدفعة: ${formatCurrencyFromCents(payment.amountCents)}`,
    `${after.label || "الذمة بعد الدفعة"}: ${after.amount}`,
    `رقم سند القبض: ${reference}`,
    "",
    "مرفق سند القبض.",
  ].join("\n");

  return (
    <DocumentShareActions
      documentLabel="سند القبض"
      fileNameBase={`ovi-payment-${reference}`}
      shareText={shareText}
      whatsappNumber={whatsappNumber}
      printLabel="طباعة سند القبض"
    >
      <PaymentReceiptView payment={payment} />
    </DocumentShareActions>
  );
}
