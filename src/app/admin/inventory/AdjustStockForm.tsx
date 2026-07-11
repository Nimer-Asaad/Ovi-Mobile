"use client";

import { useActionState } from "react";
import { createStockMovement, type StockAdjustmentState } from "./actions";
import { Select } from "@/components/ui/Select";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Button } from "@/components/ui/Button";
import { MANUAL_STOCK_MOVEMENT_TYPES } from "@/lib/constants";

interface ProductOption {
  id: string;
  sku: string;
  name: string;
  nameAr: string | null;
  isActive: boolean;
  stock: number;
}

interface AdjustStockFormProps {
  products: ProductOption[];
  selectedProductId?: string;
}

const initialState: StockAdjustmentState = {};

export function AdjustStockForm({ products, selectedProductId }: AdjustStockFormProps) {
  const [state, formAction, isPending] = useActionState(createStockMovement, initialState);

  return (
    <form action={formAction} className="flex max-w-xl flex-col gap-4">
      <Select name="productId" label="المنتج" defaultValue={selectedProductId ?? ""} required>
        <option value="" disabled>
          اختر منتجاً
        </option>
        {products.map((product) => (
          <option key={product.id} value={product.id}>
            {product.sku} — {product.nameAr ?? product.name} (المخزون الحالي: {product.stock})
            {!product.isActive ? " — غير مفعل" : ""}
          </option>
        ))}
      </Select>

      <Select name="movementType" label="نوع الحركة" defaultValue={MANUAL_STOCK_MOVEMENT_TYPES.STOCK_IN}>
        <option value={MANUAL_STOCK_MOVEMENT_TYPES.STOCK_IN}>إدخال مخزون</option>
        <option value={MANUAL_STOCK_MOVEMENT_TYPES.STOCK_OUT}>إخراج مخزون</option>
        <option value={MANUAL_STOCK_MOVEMENT_TYPES.ADJUSTMENT}>تعديل إلى رصيد نهائي</option>
      </Select>

      <div>
        <Input name="quantity" type="number" min={0} step={1} label="الكمية" required />
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

      <Button type="submit" disabled={isPending}>
        {isPending ? "جارٍ الحفظ..." : "حفظ الحركة"}
      </Button>
    </form>
  );
}
