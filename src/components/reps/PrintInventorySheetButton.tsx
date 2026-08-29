"use client";

import { Button } from "@/components/ui/Button";

/** The only interactive piece of the inventory-sheet page — isolated here so
 * RepInventorySheetView itself can stay a plain Server Component, matching
 * PrintTransferInvoiceButton's exact pattern. */
export function PrintInventorySheetButton() {
  return (
    <Button type="button" onClick={() => window.print()} className="print:hidden">
      طباعة / حفظ PDF
    </Button>
  );
}
