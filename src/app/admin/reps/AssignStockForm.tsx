"use client";

import { useActionState, useState } from "react";
import { assignStockToRep, type RepStockTransferState } from "./actions";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { ProductThumb, ProductQuickPicker, type PickableProduct } from "@/components/reps/ProductQuickPicker";

export interface AssignStockProductOption extends PickableProduct {
  /** Non-variant warehouse stock — a phone-variant product's stock lives
   * per-model on `variantOptions[].stock` instead. */
  warehouseStock: number;
}

interface AssignStockFormProps {
  repId: string;
  products: AssignStockProductOption[];
}

const initialState: RepStockTransferState = {};

/** Single-transfer form (warehouse → rep car) — reuses the same
 * search/thumbnail picker as the rep-facing stock-request and sale forms,
 * replacing the previous plain product `<select>`. No customer/order
 * context, so callers never populate colorOptions here (see
 * repStockTransferSchema for the same reasoning) — only variantId. */
export function AssignStockForm({ repId, products }: AssignStockFormProps) {
  const action = assignStockToRep.bind(null, repId);
  const [state, formAction, isPending] = useActionState(action, initialState);
  const [selected, setSelected] = useState<{ product: AssignStockProductOption; variantId: string | null } | null>(
    null,
  );

  function handlePick(product: AssignStockProductOption, _colorId: string | null, variantId: string | null) {
    setSelected({ product, variantId });
  }

  const selectedVariant = selected?.variantId ? selected.product.variantOptions?.find((variant) => variant.id === selected.variantId) : null;
  const resolvedStock = selectedVariant ? (selectedVariant.stock ?? 0) : (selected?.product.warehouseStock ?? 0);

  return (
    <form action={formAction} className="flex max-w-xl flex-col gap-4">
      <input type="hidden" name="productId" value={selected?.product.id ?? ""} />
      <input type="hidden" name="variantId" value={selected?.variantId ?? ""} />

      {!selected ? (
        <ProductQuickPicker products={products} excludeIds={new Set()} onPick={handlePick} placeholder="ابحث عن منتج لتخصيصه..." />
      ) : (
        <div className="flex items-center justify-between gap-3 rounded-card border border-navy-soft bg-navy-deep px-3 py-2">
          <div className="flex items-center gap-3">
            <ProductThumb product={selected.product} className="h-10 w-10" />
            <div>
              <p className="text-sm text-neutral-bg">
                {selected.product.nameAr ?? selected.product.name}
                {selectedVariant && <span> — {selectedVariant.label}</span>}
              </p>
              <p className="text-xs text-neutral-bg/50">
                {selected.product.sku} — مخزون المستودع الرئيسي: {resolvedStock}
              </p>
            </div>
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={() => setSelected(null)}>
            تغيير
          </Button>
        </div>
      )}

      <Input name="quantity" type="number" min={1} step={1} label="الكمية" required disabled={!selected} />

      <Textarea name="notes" label="ملاحظات / السبب (اختياري)" rows={3} />

      {state.error && (
        <p className="text-sm text-rose-600" role="alert">
          {state.error}
        </p>
      )}

      <Button type="submit" disabled={isPending || !selected}>
        {isPending && <Spinner />}
        {isPending ? "جارٍ الحفظ..." : "تخصيص المخزون"}
      </Button>
    </form>
  );
}
