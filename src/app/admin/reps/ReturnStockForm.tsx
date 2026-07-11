"use client";

import { useActionState } from "react";
import { returnStockFromRep, type RepStockTransferState } from "./actions";
import { Select } from "@/components/ui/Select";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";

interface ProductOption {
  id: string;
  sku: string;
  name: string;
  nameAr: string | null;
  repStock: number;
}

interface ReturnStockFormProps {
  repId: string;
  products: ProductOption[];
}

const initialState: RepStockTransferState = {};

export function ReturnStockForm({ repId, products }: ReturnStockFormProps) {
  const action = returnStockFromRep.bind(null, repId);
  const [state, formAction, isPending] = useActionState(action, initialState);

  if (products.length === 0) {
    return <p className="text-sm text-neutral-bg/60">لا يملك هذا المندوب أي مخزون قابل للإرجاع حالياً.</p>;
  }

  return (
    <form action={formAction} className="flex max-w-xl flex-col gap-4">
      <Select name="productId" label="المنتج" defaultValue="" required>
        <option value="" disabled>
          اختر منتجاً
        </option>
        {products.map((product) => (
          <option key={product.id} value={product.id}>
            {product.sku} — {product.nameAr ?? product.name} (مخزون المندوب الحالي: {product.repStock})
          </option>
        ))}
      </Select>

      <Input name="quantity" type="number" min={1} step={1} label="الكمية" required />

      <Textarea name="notes" label="ملاحظات / السبب (اختياري)" rows={3} />

      {state.error && (
        <p className="text-sm text-rose-600" role="alert">
          {state.error}
        </p>
      )}

      <Button type="submit" variant="outline" disabled={isPending}>
        {isPending && <Spinner />}
        {isPending ? "جارٍ الحفظ..." : "إرجاع المخزون"}
      </Button>
    </form>
  );
}
