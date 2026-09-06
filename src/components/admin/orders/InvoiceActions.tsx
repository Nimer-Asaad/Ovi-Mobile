"use client";

import { DocumentShareActions } from "@/components/shared/DocumentShareActions";
import { InvoiceView, type InvoiceData } from "./InvoiceView";

interface InvoiceActionsProps {
  order: InvoiceData;
  /** Merchant.whatsappPhone, falling back to contactPhone when no separate
   * WhatsApp number was saved — already resolved by the caller (the invoice
   * page), never re-derived here. Null when the order has no merchant, or
   * the merchant has neither number saved. */
  whatsappNumber: string | null;
}

const SHARE_TEXT_PREFIX = "السلام عليكم، هذه فاتورتك من Ovi Mobile";

/** Invoice-specific instantiation of the shared print/PNG/WhatsApp shell
 * (DocumentShareActions) around InvoiceView — InvoiceView stays the single
 * source of invoice markup; this component only supplies the invoice's own
 * filename/share text/labels. Reused as-is by both /rep/sales/[orderNumber]
 * and /admin/orders/[orderNumber]/invoice. The payment receipt feature
 * (PaymentReceiptActions) is the other consumer of DocumentShareActions —
 * see its own file for the same shell wrapping PaymentReceiptView instead. */
export function InvoiceActions({ order, whatsappNumber }: InvoiceActionsProps) {
  const shareText = `${SHARE_TEXT_PREFIX}\nرقم الفاتورة: ${order.orderNumber}`;

  return (
    <DocumentShareActions
      documentLabel="الفاتورة"
      fileNameBase={`ovi-invoice-${order.orderNumber}`}
      shareText={shareText}
      whatsappNumber={whatsappNumber}
      printLabel="طباعة الفاتورة"
    >
      <InvoiceView order={order} />
    </DocumentShareActions>
  );
}
