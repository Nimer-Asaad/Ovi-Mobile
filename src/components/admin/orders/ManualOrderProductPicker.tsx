"use client";

import { useMemo, useState } from "react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { formatCurrencyFromCents } from "@/lib/utils";
import type { ManualOrderProductOption } from "./ManualOrderForm";

export interface ManualOrderProductPickerProps {
  products: ManualOrderProductOption[];
  priceMode: "retail" | "wholesale";
  addedProductIds: string[];
  onAdd: (product: ManualOrderProductOption) => void;
}

/** Local search over the fully-preloaded product list — the catalog is
 * small enough (demo/small-business scale) that filtering client-side is
 * simpler and safer than a new search API route for this phase. */
export function ManualOrderProductPicker({ products, priceMode, addedProductIds, onAdd }: ManualOrderProductPickerProps) {
  const [query, setQuery] = useState("");

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
          const alreadyAdded = addedProductIds.includes(product.id);
          const outOfStock = product.stock <= 0;
          const priceCents = priceMode === "wholesale" ? product.wholesalePriceCents : product.retailPriceCents;

          return (
            <div
              key={product.id}
              className="flex items-center justify-between gap-3 rounded-card border border-navy-soft bg-navy-deep px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-neutral-bg">{product.nameAr ?? product.name}</p>
                <p className="text-xs text-neutral-bg/50">
                  {product.sku} · متوفر: {product.stock} · {formatCurrencyFromCents(priceCents)}
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={alreadyAdded || outOfStock}
                onClick={() => onAdd(product)}
              >
                {alreadyAdded ? "أُضيف" : outOfStock ? "نفد المخزون" : "إضافة"}
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
