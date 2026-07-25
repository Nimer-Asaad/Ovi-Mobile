"use client";

import { Button } from "@/components/ui/Button";

/** The only interactive piece of the statement page — isolated here so
 * AccountStatementView itself can stay a plain Server Component, mirroring
 * PrintInvoiceButton's split for the order invoice. */
export function PrintStatementButton() {
  return (
    <Button type="button" onClick={() => window.print()} className="print:hidden">
      طباعة كشف الحساب
    </Button>
  );
}
