"use client";

import { useMemo, useState } from "react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { formatCurrencyFromCents, cn } from "@/lib/utils";
import type { ManualOrderProductOption } from "./ManualOrderForm";

export interface ManualOrderProductPickerProps {
  products: ManualOrderProductOption[];
  priceMode: "retail" | "wholesale";
  /** `${productId}:${variantId ?? `legacy:${colorId ?? ""}`}` for every line already added. */
  addedLineKeys: Set<string>;
  onAdd: (product: ManualOrderProductOption, colorId: string | null, variantId?: string | null) => void;
}

function lineKey(productId: string, colorId: string | null, variantId: string | null = null): string {
  return `${productId}:${variantId ?? `legacy:${colorId ?? ""}`}`;
}

/** Local search over the fully-preloaded product list — the catalog is
 * small enough (demo/small-business scale) that filtering client-side is
 * simpler and safer than a new search API route for this phase. A product
 * with variant options expands into an inline model-choice row; if it also
 * has color options, picking a model is followed by a color-choice row
 * (independent picks — model determines stock, color is purely
 * descriptive) before the line is finally added. */
export function ManualOrderProductPicker({ products, priceMode, addedLineKeys, onAdd }: ManualOrderProductPickerProps) {
  const [query, setQuery] = useState("");
  const [expandedProductId, setExpandedProductId] = useState<string | null>(null);
  const [pendingVariantId, setPendingVariantId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return products.slice(0, 8);
    return products
      .filter((product) =>
        [product.sku, product.name, product.nameAr ?? ""].some((field) =>
          field.toLowerCase().includes(trimmed),
        ),
      )
      .slice(0, 20);
  }, [products, query]);

  function closeExpanded() {
    setExpandedProductId(null);
    setPendingVariantId(null);
  }

  function toggleExpanded(productId: string) {
    setExpandedProductId((current) => (current === productId ? null : productId));
    setPendingVariantId(null);
  }

  return (
    <div className="flex flex-col gap-3">
      <Input
        placeholder="ابحث بالاسم أو رمز المنتج (SKU)..."
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />

      <div className="flex max-h-72 flex-col gap-2 overflow-y-auto">
        {filtered.length === 0 && (
          <p className="py-4 text-center text-sm text-neutral-bg/50">لا توجد منتجات مطابقة</p>
        )}
        {filtered.map((product) => {
          const hasColors = (product.colorOptions?.length ?? 0) > 0;
          const hasVariants = (product.variantOptions?.length ?? 0) > 0;
          const variantIds: (string | null)[] = hasVariants ? product.variantOptions!.map((variant) => variant.id) : [null];
          const colorIds: (string | null)[] = hasColors ? product.colorOptions!.map((color) => color.id) : [null];
          const alreadyAdded = variantIds.every((variantId) => colorIds.every((colorId) => addedLineKeys.has(lineKey(product.id, colorId, variantId))));
          const outOfStock = !hasVariants && product.stock <= 0;
          const priceCents = priceMode === "wholesale" ? product.wholesalePriceCents : product.retailPriceCents;
          const showVariantStep = expandedProductId === product.id && hasVariants && pendingVariantId === null;
          const showColorStep = expandedProductId === product.id && hasColors && (!hasVariants || pendingVariantId !== null);

          return (
            <div
              key={product.id}
              className="flex flex-col gap-2 rounded-card border border-navy-soft bg-navy-deep px-3 py-2"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-neutral-bg">{product.nameAr ?? product.name}</p>
                  <p className="text-xs text-neutral-bg/50">
                    {product.sku} · متوفر: {hasVariants ? "حسب الموديل" : product.stock} · {formatCurrencyFromCents(priceCents)}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={alreadyAdded || outOfStock}
                  onClick={() =>
                    hasVariants || hasColors ? toggleExpanded(product.id) : onAdd(product, null)
                  }
                >
                  {alreadyAdded ? "أُضيف" : outOfStock ? "نفد المخزون" : hasVariants ? "اختر الموديل" : hasColors ? "اختر اللون" : "إضافة"}
                </Button>
              </div>

              {showVariantStep && (
                <div className="flex flex-col gap-2 border-t border-navy-soft pt-2">
                  {product.variantOptions!.map((variant) => {
                    const used = colorIds.every((colorId) => addedLineKeys.has(lineKey(product.id, colorId, variant.id)));
                    const oos = variant.stock <= 0;
                    return (
                      <button
                        key={variant.id}
                        type="button"
                        disabled={used || oos}
                        onClick={() => {
                          if (hasColors) setPendingVariantId(variant.id);
                          else { onAdd(product, null, variant.id); closeExpanded(); }
                        }}
                        className={cn("rounded-card border border-navy-soft px-3 py-2 text-start text-xs text-neutral-bg/80", (used || oos) && "cursor-not-allowed opacity-40")}
                      >
                        {variant.label} ({variant.stock})
                      </button>
                    );
                  })}
                </div>
              )}
              {showColorStep && (
                <div className="flex flex-wrap gap-2 border-t border-navy-soft pt-2">
                  {product.colorOptions!.map((color) => {
                    const used = addedLineKeys.has(lineKey(product.id, color.id, pendingVariantId));
                    return (
                      <button
                        key={color.id}
                        type="button"
                        disabled={used}
                        onClick={() => {
                          onAdd(product, color.id, pendingVariantId);
                          closeExpanded();
                        }}
                        className={cn(
                          "flex items-center gap-1.5 rounded-full border border-navy-soft px-2.5 py-1 text-xs text-neutral-bg/80 transition-colors hover:border-gold-champagne/40",
                          used && "cursor-not-allowed opacity-40",
                        )}
                      >
                        {color.hexCode && (
                          <span
                            aria-hidden="true"
                            className="h-3 w-3 shrink-0 rounded-full border border-navy-soft"
                            style={{ backgroundColor: color.hexCode }}
                          />
                        )}
                        {color.nameAr ?? color.name} {used ? "(أُضيف)" : ""}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
