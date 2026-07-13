"use client";

import { Button } from "@/components/ui/Button";

/** The only interactive piece of the print page — isolated here so
 * RepStockRequestPrintView itself can stay a plain Server Component. */
export function PrintRepStockRequestButton() {
  return (
    <Button type="button" onClick={() => window.print()} className="print:hidden">
      طباعة
    </Button>
  );
}
