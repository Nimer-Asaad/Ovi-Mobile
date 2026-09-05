"use client";

import { Button } from "@/components/ui/Button";

/** The only interactive piece of the rep merchant-statement page — isolated
 * here so the page itself can stay a plain Server Component, matching
 * PrintStatementButton's exact pattern (the admin equivalent). */
export function PrintMerchantStatementButton() {
  return (
    <Button type="button" onClick={() => window.print()} className="print:hidden">
      طباعة كشف الحساب
    </Button>
  );
}
