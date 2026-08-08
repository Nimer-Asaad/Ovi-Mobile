"use client";

import { useActionState, useState } from "react";
import { createStockMovement, type StockAdjustmentState } from "./actions";
import { Select } from "@/components/ui/Select";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { MANUAL_STOCK_MOVEMENT_TYPES } from "@/lib/constants";
import { ProductThumb, ProductQuickPicker, type PickableProduct } from "@/components/reps/ProductQuickPicker";

export interface AdjustStockProductOption extends PickableProduct {
  isActive: boolean;
  stock: number;
}

interface AdjustStockFormProps {
  products: AdjustStockProductOption[];
  selectedProductId?: string;
}

const initialState: StockAdjustmentState = {};

/** Single-product adjustment form — no customer/order context, so no color
 * step at all: reuses the search/thumbnail picker shared with the
 * rep-facing forms, but callers of this form never populate colorOptions. */
export function AdjustStockForm({ products, selectedProductId }: AdjustStockFormProps) {
  const [state, formAction, isPending] = useActionState(createStockMovement, initialState);
  const preselected = selectedProductId ? products.find((product) => product.id === selectedProductId) : undefined;
  const [selected, setSelected] = useState<AdjustStockProductOption | null>(preselected ?? null);

  return (
    <form action={formAction} className="flex max-w-xl flex-col gap-4">
      <input type="hidden" name="productId" value={selected?.id ?? ""} />

      {!selected ? (
        <ProductQuickPicker products={products} excludeIds={new Set()} onPick={setSelected} placeholder="ابحث عن منتج..." />
      ) : (
        <div className="flex items-center justify-between gap-3 rounded-card border border-navy-soft bg-navy-deep px-3 py-2">
          <div className="flex items-center gap-3">
            <ProductThumb product={selected} className="h-10 w-10" />
            <div>
              <p className="text-sm text-neutral-bg">
                {selected.nameAr ?? selected.name}
                {!selected.isActive && <span className="text-neutral-bg/50"> — غير مفعل</span>}
              </p>
              <p className="text-xs text-neutral-bg/50">
                {selected.sku} — المخزون الحالي: {selected.stock}
              </p>
            </div>
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={() => setSelected(null)}>
            تغيير
          </Button>
        </div>
      )}

      <Select name="movementType" label="نوع الحركة" defaultValue={MANUAL_STOCK_MOVEMENT_TYPES.STOCK_IN}>
        <option value={MANUAL_STOCK_MOVEMENT_TYPES.STOCK_IN}>إدخال مخزون</option>
        <option value={MANUAL_STOCK_MOVEMENT_TYPES.STOCK_OUT}>إخراج مخزون</option>
        <option value={MANUAL_STOCK_MOVEMENT_TYPES.ADJUSTMENT}>تعديل إلى رصيد نهائي</option>
      </Select>

      <div>
        <Input name="quantity" type="number" min={0} step={1} label="الكمية" required disabled={!selected} />
        <p className="mt-1.5 text-xs text-neutral-bg/50">
          لإدخال أو إخراج مخزون: أدخل الكمية المراد إضافتها أو خصمها. لتعديل الرصيد: أدخل الرصيد النهائي المطلوب
          للمخزون.
        </p>
      </div>

      <Textarea name="notes" label="ملاحظات / السبب (اختياري)" rows={3} />

      {state.error && (
        <p className="text-sm text-rose-600" role="alert">
          {state.error}
        </p>
      )}

      <Button type="submit" disabled={isPending || !selected}>
        {isPending && <Spinner />}
        {isPending ? "جارٍ الحفظ..." : "حفظ الحركة"}
      </Button>
    </form>
  );
}
