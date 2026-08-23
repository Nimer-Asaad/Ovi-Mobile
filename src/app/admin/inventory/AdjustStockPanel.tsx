"use client";

import { useState } from "react";
import { AdjustStockForm } from "./AdjustStockForm";
import { BulkStockMovementForm } from "./BulkStockMovementForm";
import { MANUAL_STOCK_MOVEMENT_TYPES, ROLES } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { AdjustStockProductOption } from "./adjustCascades";

const MODES = {
  IN: "IN",
  OUT: "OUT",
  CORRECTION: "CORRECTION",
} as const;

interface AdjustStockPanelProps {
  products: AdjustStockProductOption[];
  selectedProductId?: string;
  /** ADMIN sees all three modes; ADMIN_ASSISTANT (مساعد الأدمن, warehouse
   * picker/preparer staff) sees only bulk OUT — no mode toggle is rendered
   * at all for that role, since it's the only option. This is a UI
   * convenience only: createBulkStockMovement/createStockMovement
   * independently re-enforce the same restriction server-side regardless
   * of what this component renders (see actions.ts). */
  role: string;
}

/** Top-level switch between the warehouse's three stock-movement flows: IN
 * and OUT are both multi-item (BulkStockMovementForm, one component
 * parameterized by direction — see its own doc comment), while Correction
 * stays single-item (AdjustStockForm) since it sets one exact inventory
 * target to an absolute final quantity, which doesn't compose with a
 * multi-item "add to list" flow the same way a plain increment/decrement
 * does.
 *
 * Defaults to Correction when arriving with a specific product preselected
 * (the "تعديل" link from the inventory list, /admin/inventory/adjust?
 * productId=...) — that link's intent is "fix this one product's count",
 * which only the Correction form can act on directly; otherwise defaults to
 * IN, the most common way an admin opens this page cold. Not applicable to
 * ADMIN_ASSISTANT, which only ever sees OUT. */
export function AdjustStockPanel({ products, selectedProductId, role }: AdjustStockPanelProps) {
  const isAssistant = role === ROLES.ADMIN_ASSISTANT;
  const [mode, setMode] = useState<string>(isAssistant ? MODES.OUT : selectedProductId ? MODES.CORRECTION : MODES.IN);

  if (isAssistant) {
    return (
      <div className="flex flex-col gap-6">
        <BulkStockMovementForm products={products} direction={MANUAL_STOCK_MOVEMENT_TYPES.STOCK_OUT} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div role="radiogroup" aria-label="نوع العملية" className="flex flex-wrap gap-2">
        {[
          { value: MODES.IN, label: "إدخال للمخزن" },
          { value: MODES.OUT, label: "إخراج من المخزن" },
          { value: MODES.CORRECTION, label: "تصحيح المخزون" },
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

      {mode === MODES.IN && <BulkStockMovementForm products={products} direction={MANUAL_STOCK_MOVEMENT_TYPES.STOCK_IN} />}
      {mode === MODES.OUT && <BulkStockMovementForm products={products} direction={MANUAL_STOCK_MOVEMENT_TYPES.STOCK_OUT} />}
      {mode === MODES.CORRECTION && <AdjustStockForm products={products} selectedProductId={selectedProductId} />}
    </div>
  );
}
