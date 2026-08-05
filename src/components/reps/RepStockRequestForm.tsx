"use client";

import { useActionState, useMemo, useState } from "react";
import { createStockRequest, type RepStockRequestState } from "@/app/rep/requests/new/actions";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { ProductThumb, ProductQuickPicker, type PickableProduct } from "@/components/reps/ProductQuickPicker";

export interface RepStockRequestProductOption extends PickableProduct {
  categoryLabel: string | null;
  brandLabel: string | null;
}

interface RequestLine {
  productId: string;
  colorId: string | null;
  colorLabel: string | null;
  sku: string;
  label: string;
  quantity: number;
  thumbnailUrl: string | null;
  thumbnailAlt: string | null;
}

function lineKey(productId: string, colorId: string | null): string {
  return `${productId}:${colorId ?? ""}`;
}

const initialState: RepStockRequestState = {};

/** Rep-facing restock request form — deliberately never fetches or shows
 * any price/cost field. Lines are held in client state and serialized to a
 * hidden JSON input on submit, mirroring the Phase 25 manual-order-form
 * pattern, since native FormData can't carry a dynamic array of objects. */
export function RepStockRequestForm({ products }: { products: RepStockRequestProductOption[] }) {
  const [state, formAction, isPending] = useActionState(createStockRequest, initialState);
  const [lines, setLines] = useState<RequestLine[]>([]);
  const [repNote, setRepNote] = useState("");

  // A colored product stays pickable in the search until every one of its
  // colors already has a line — only a colorless (or fully-used) product
  // is excluded entirely.
  const excludeIds = useMemo(() => {
    const usedKeys = new Set(lines.map((line) => lineKey(line.productId, line.colorId)));
    const ids = new Set<string>();
    for (const product of products) {
      if (product.colorOptions && product.colorOptions.length > 0) {
        if (product.colorOptions.every((color) => usedKeys.has(lineKey(product.id, color.id)))) {
          ids.add(product.id);
        }
      } else if (usedKeys.has(lineKey(product.id, null))) {
        ids.add(product.id);
      }
    }
    return ids;
  }, [lines, products]);

  function handleAdd(product: RepStockRequestProductOption, colorId: string | null) {
    const color = product.colorOptions?.find((option) => option.id === colorId) ?? null;
    setLines((prev) => [
      ...prev,
      {
        productId: product.id,
        colorId,
        colorLabel: color ? (color.nameAr ?? color.name) : null,
        sku: product.sku,
        label: product.nameAr ?? product.name,
        quantity: 1,
        thumbnailUrl: product.thumbnailUrl,
        thumbnailAlt: product.thumbnailAlt,
      },
    ]);
  }

  function handleRemove(productId: string, colorId: string | null) {
    setLines((prev) => prev.filter((line) => lineKey(line.productId, line.colorId) !== lineKey(productId, colorId)));
  }

  function handleQuantityChange(productId: string, colorId: string | null, value: string) {
    const quantity = Math.max(1, Math.floor(Number(value) || 1));
    setLines((prev) =>
      prev.map((line) =>
        lineKey(line.productId, line.colorId) === lineKey(productId, colorId) ? { ...line, quantity } : line,
      ),
    );
  }

  const itemsJson = useMemo(
    () =>
      JSON.stringify(
        lines.map((line) => ({ productId: line.productId, colorId: line.colorId, requestedQuantity: line.quantity })),
      ),
    [lines],
  );

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <input type="hidden" name="items" value={itemsJson} />

      <Card>
        <CardHeader>
          <CardTitle>إضافة منتجات للطلب</CardTitle>
        </CardHeader>
        <CardContent>
          <ProductQuickPicker products={products} excludeIds={excludeIds} onPick={handleAdd} />
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
                <div
                  key={lineKey(line.productId, line.colorId)}
                  className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0"
                >
                  <ProductThumb product={{ ...line, name: line.label }} className="h-10 w-10" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-neutral-bg">{line.label}</p>
                    <p className="text-xs text-neutral-bg/50">
                      {line.sku}
                      {line.colorLabel && <span> — {line.colorLabel}</span>}
                    </p>
                  </div>
                  <div className="w-20">
                    <Input
                      type="number"
                      min={1}
                      value={line.quantity}
                      onChange={(event) => handleQuantityChange(line.productId, line.colorId, event.target.value)}
                      aria-label="الكمية المطلوبة"
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRemove(line.productId, line.colorId)}
                  >
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
