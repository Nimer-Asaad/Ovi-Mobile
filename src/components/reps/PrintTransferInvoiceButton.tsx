"use client";

import { Button } from "@/components/ui/Button";

/** The only interactive piece of the transfer invoice page — isolated here
 * so RepTransferInvoiceView itself can stay a plain Server Component. */
export function PrintTransferInvoiceButton() {
  return (
    <Button type="button" onClick={() => window.print()} className="print:hidden">
      طباعة
    </Button>
  );
}
