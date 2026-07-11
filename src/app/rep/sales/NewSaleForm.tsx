"use client";

import { useActionState, useState, type ChangeEvent } from "react";
import { createRepSale, type RepSaleState } from "./actions";
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
  retailPriceCents: number;
}

interface NewSaleFormProps {
  products: ProductOption[];
}

const initialState: RepSaleState = {};

function centsToInputValue(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function NewSaleForm({ products }: NewSaleFormProps) {
  const [state, formAction, isPending] = useActionState(createRepSale, initialState);
  const [selectedProductId, setSelectedProductId] = useState(products[0]?.id ?? "");
  const [priceValue, setPriceValue] = useState(
    products[0] ? centsToInputValue(products[0].retailPriceCents) : "",
  );

  function handleProductChange(event: ChangeEvent<HTMLSelectElement>) {
    const id = event.target.value;
    setSelectedProductId(id);
    const product = products.find((p) => p.id === id);
    if (product) {
      setPriceValue(centsToInputValue(product.retailPriceCents));
    }
  }

  if (products.length === 0) {
    return <p className="text-sm text-neutral-bg/60">لا يوجد لديك مخزون متاح للبيع حالياً.</p>;
  }

  return (
    <form action={formAction} className="flex max-w-xl flex-col gap-4">
      <Select name="productId" label="المنتج" value={selectedProductId} onChange={handleProductChange} required>
        {products.map((product) => (
          <option key={product.id} value={product.id}>
            {product.sku} — {product.nameAr ?? product.name} (المتوفر لديك: {product.repStock})
          </option>
        ))}
      </Select>

      <Input name="quantity" type="number" min={1} step={1} label="الكمية" defaultValue={1} required />

      <Input
        name="unitPriceCents"
        type="number"
        min={0.01}
        step={0.01}
        label="سعر البيع (₪)"
        value={priceValue}
        onChange={(event) => setPriceValue(event.target.value)}
        required
      />

      <Input name="customerName" label="اسم العميل" required />
      <Input name="customerPhone" label="هاتف العميل" required />
      <Input name="city" label="المدينة / المنطقة (اختياري)" />
      <Input name="address" label="العنوان (اختياري)" />
      <Textarea name="notes" label="ملاحظات (اختياري)" rows={3} />

      {state.error && (
        <p className="text-sm text-rose-600" role="alert">
          {state.error}
        </p>
      )}

      <Button type="submit" disabled={isPending}>
        {isPending && <Spinner />}
        {isPending ? "جارٍ الحفظ..." : "إتمام البيع"}
      </Button>
    </form>
  );
}
