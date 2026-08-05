"use client";

import { cn } from "@/lib/utils";

export interface ColorSwatchOption {
  id: string;
  name: string;
  nameAr: string | null;
  hexCode: string | null;
  stock: number;
}

interface ColorSwatchSelectorProps {
  colors: ColorSwatchOption[];
  selectedColorId: string | null;
  onSelect: (colorId: string) => void;
}

/** Color picker for a product page — only rendered when the product has
 * color options (see ProductPurchasePanel). Out-of-stock colors are still
 * shown (so a shopper can see what exists) but not selectable. */
export function ColorSwatchSelector({ colors, selectedColorId, onSelect }: ColorSwatchSelectorProps) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium text-neutral-bg/80">اللون</span>
      <div className="flex flex-wrap gap-2">
        {colors.map((color) => {
          const isSelected = color.id === selectedColorId;
          const outOfStock = color.stock <= 0;
          return (
            <button
              key={color.id}
              type="button"
              disabled={outOfStock}
              onClick={() => onSelect(color.id)}
              title={color.nameAr ?? color.name}
              className={cn(
                "flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors",
                isSelected
                  ? "border-gold-champagne bg-gold-champagne/15 text-gold-light"
                  : "border-navy-soft text-neutral-bg/80 hover:border-gold-champagne/40",
                outOfStock && "cursor-not-allowed opacity-40",
              )}
            >
              {color.hexCode && (
                <span
                  aria-hidden="true"
                  className="h-4 w-4 shrink-0 rounded-full border border-navy-soft"
                  style={{ backgroundColor: color.hexCode }}
                />
              )}
              {color.nameAr ?? color.name}
              {outOfStock && <span className="text-xs text-neutral-bg/50">(نفذ)</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
