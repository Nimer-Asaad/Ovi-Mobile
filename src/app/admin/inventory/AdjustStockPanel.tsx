"use client";

import { useState } from "react";
import { AdjustStockForm } from "./AdjustStockForm";
import { BulkStockOutForm } from "./BulkStockOutForm";
import { cn } from "@/lib/utils";
import type { AdjustStockProductOption } from "./adjustCascades";

const MODES = {
  IN_CORRECTION: "IN_CORRECTION",
  OUT: "OUT",
} as const;

interface AdjustStockPanelProps {
  products: AdjustStockProductOption[];
  selectedProductId?: string;
}

/** Top-level switch between the two warehouse stock-movement flows: IN /
 * Correction stay a single-item form (AdjustStockForm, unchanged), while OUT
 * is the dedicated multi-item BulkStockOutForm — removing several different
 * items in one visit no longer requires one submission per item. */
export function AdjustStockPanel({ products, selectedProductId }: AdjustStockPanelProps) {
  const [mode, setMode] = useState<string>(MODES.IN_CORRECTION);

  return (
    <div className="flex flex-col gap-6">
      <div role="radiogroup" aria-label="نوع العملية" className="flex gap-2">
        {[
          { value: MODES.IN_CORRECTION, label: "إدخال / تصحيح" },
          { value: MODES.OUT, label: "إخراج من المخزن" },
        ].map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={mode === option.value}
            onClick={() => setMode(option.value)}
            className={cn(
              "flex-1 rounded-card border px-4 py-2 text-sm transition-colors sm:flex-none sm:px-6",
              mode === option.value
                ? "border-gold-champagne/60 bg-gold-champagne/10 text-gold-champagne"
                : "border-navy-soft text-neutral-bg/70 hover:border-gold-champagne/30",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>

      {mode === MODES.IN_CORRECTION ? (
        <AdjustStockForm products={products} selectedProductId={selectedProductId} />
      ) : (
        <BulkStockOutForm products={products} />
      )}
    </div>
  );
}
