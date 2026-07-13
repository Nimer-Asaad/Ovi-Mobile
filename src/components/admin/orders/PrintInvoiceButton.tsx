"use client";

import { Button } from "@/components/ui/Button";

/** The only interactive piece of the invoice page — isolated here so
 * InvoiceView itself can stay a plain Server Component. */
export function PrintInvoiceButton() {
  return (
    <Button type="button" onClick={() => window.print()} className="print:hidden">
      طباعة الفاتورة
    </Button>
  );
}
