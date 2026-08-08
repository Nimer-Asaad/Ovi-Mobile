"use client";

import { cn } from "@/lib/utils";

export interface ColorSwatchOption {
  id: string;
  name: string;
  nameAr: string | null;
  hexCode: string | null;
}

interface ColorSwatchSelectorProps {
  colors: ColorSwatchOption[];
  selectedColorId: string | null;
  onSelect: (colorId: string) => void;
}

/** Color picker for a product page — only rendered when the product has
 * color options (see ProductPurchasePanel). Purely a preference pick — color
 * never affects stock/availability, so every option is always selectable. */
export function ColorSwatchSelector({ colors, selectedColorId, onSelect }: ColorSwatchSelectorProps) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium text-neutral-bg/80">اللون</span>
      <div className="flex flex-wrap gap-2">
        {colors.map((color) => {
          const isSelected = color.id === selectedColorId;
          return (
            <button
              key={color.id}
              type="button"
              onClick={() => onSelect(color.id)}
              title={color.nameAr ?? color.name}
              className={cn(
                "flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors",
                isSelected
                  ? "border-gold-champagne bg-gold-champagne/15 text-gold-light"
                  : "border-navy-soft text-neutral-bg/80 hover:border-gold-champagne/40",
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
            </button>
          );
        })}
      </div>
    </div>
  );
}
