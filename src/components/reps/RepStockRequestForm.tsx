"use client";

import { useActionState, useMemo, useState } from "react";
import { createStockRequest, type RepStockRequestState } from "@/app/rep/requests/new/actions";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";

export interface RepStockRequestProductOption {
  id: string;
  sku: string;
  name: string;
  nameAr: string | null;
  categoryLabel: string | null;
  brandLabel: string | null;
}

interface RequestLine {
  productId: string;
  sku: string;
  label: string;
  quantity: number;
}

const initialState: RepStockRequestState = {};

/** Rep-facing restock request form — deliberately never fetches or shows
 * any price/cost field. Lines are held in client state and serialized to a
 * hidden JSON input on submit, mirroring the Phase 25 manual-order-form
 * pattern, since native FormData can't carry a dynamic array of objects. */
export function RepStockRequestForm({ products }: { products: RepStockRequestProductOption[] }) {
  const [state, formAction, isPending] = useActionState(createStockRequest, initialState);
  const [search, setSearch] = useState("");
  const [lines, setLines] = useState<RequestLine[]>([]);
  const [repNote, setRepNote] = useState("");

  const filteredProducts = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return [];
    return products
      .filter((product) => !lines.some((line) => line.productId === product.id))
      .filter(
        (product) =>
          product.sku.toLowerCase().includes(query) ||
          product.name.toLowerCase().includes(query) ||
          (product.nameAr ?? "").toLowerCase().includes(query),
      )
      .slice(0, 8);
  }, [search, products, lines]);

  function handleAdd(product: RepStockRequestProductOption) {
    setLines((prev) => [
      ...prev,
      { productId: product.id, sku: product.sku, label: product.nameAr ?? product.name, quantity: 1 },
    ]);
    setSearch("");
  }

  function handleRemove(productId: string) {
    setLines((prev) => prev.filter((line) => line.productId !== productId));
  }

  function handleQuantityChange(productId: string, value: string) {
    const quantity = Math.max(1, Math.floor(Number(value) || 1));
    setLines((prev) => prev.map((line) => (line.productId === productId ? { ...line, quantity } : line)));
  }

  const itemsJson = useMemo(
    () =>
      JSON.stringify(lines.map((line) => ({ productId: line.productId, requestedQuantity: line.quantity }))),
    [lines],
  );

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <input type="hidden" name="items" value={itemsJson} />

      <Card>
        <CardHeader>
          <CardTitle>إضافة منتجات للطلب</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Input
            placeholder="ابحث بالاسم أو رمز المنتج (SKU)..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          {filteredProducts.length > 0 && (
            <div className="flex flex-col divide-y divide-navy-soft rounded-card border border-navy-soft">
              {filteredProducts.map((product) => (
                <button
                  key={product.id}
                  type="button"
                  onClick={() => handleAdd(product)}
                  className="flex items-center justify-between px-3 py-2 text-start text-sm hover:bg-navy-deep"
                >
                  <span className="text-neutral-bg">{product.nameAr ?? product.name}</span>
                  <span className="text-xs text-neutral-bg/50">{product.sku}</span>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>عناصر الطلب</CardTitle>
        </CardHeader>
        <CardContent>
          {lines.length === 0 ? (
            <p className="py-6 text-center text-sm text-neutral-bg/50">لم تتم إضافة منتجات بعد</p>
          ) : (
            <div className="flex flex-col divide-y divide-navy-soft">
              {lines.map((line) => (
                <div key={line.productId} className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-neutral-bg">{line.label}</p>
                    <p className="text-xs text-neutral-bg/50">{line.sku}</p>
                  </div>
                  <div className="w-20">
                    <Input
                      type="number"
                      min={1}
                      value={line.quantity}
                      onChange={(event) => handleQuantityChange(line.productId, event.target.value)}
                      aria-label="الكمية المطلوبة"
                    />
                  </div>
                  <Button type="button" variant="ghost" size="sm" onClick={() => handleRemove(line.productId)}>
                    حذف
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>ملاحظة (اختياري)</CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea name="repNote" value={repNote} onChange={(event) => setRepNote(event.target.value)} rows={3} />
        </CardContent>
      </Card>

      {state.error && (
        <p className="text-sm text-rose-600" role="alert">
          {state.error}
        </p>
      )}

      <Button type="submit" disabled={isPending || lines.length === 0} className="w-full sm:w-auto">
        {isPending && <Spinner />}
        {isPending ? "جارٍ الإرسال..." : "إرسال الطلب"}
      </Button>
    </form>
  );
}
