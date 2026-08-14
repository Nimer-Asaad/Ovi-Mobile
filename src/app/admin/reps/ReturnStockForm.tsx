"use client";

import { useActionState, useMemo, useState } from "react";
import { returnStockFromRep, type RepStockTransferState } from "./actions";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { ProductThumb, ProductQuickPicker, type PickableProduct } from "@/components/reps/ProductQuickPicker";

export interface ReturnStockProductOption extends PickableProduct {
  /** Non-variant rep-car stock — a phone-variant or device-color-combo
   * product's stock lives per-option on variantOptions[].stock /
   * deviceColorVariantOptions[].stock instead. */
  repStock: number;
}

interface ReturnStockFormProps {
  repId: string;
  products: ReturnStockProductOption[];
}

interface TransferLine {
  productId: string;
  variantId: string | null;
  deviceColorVariantId: string | null;
  label: string;
  optionLabel: string | null;
  sku: string;
  quantity: number;
  maxStock: number;
  thumbnailUrl: string | null;
  thumbnailAlt: string | null;
}

const initialState: RepStockTransferState = {};

function lineKey(productId: string, variantId: string | null, deviceColorVariantId: string | null): string {
  return `${productId}:${variantId ?? ""}:${deviceColorVariantId ?? ""}`;
}

/** Multi-line transfer form (rep car → warehouse) — reuses the same
 * search/thumbnail/detail product picker as the rep-facing forms. Every
 * product added in one submission becomes one RepStockTransferBatch with
 * one StockMovement per line, printable as a single combined invoice. No
 * customer/order context, so callers never populate colorOptions here (see
 * repStockTransferBatchSchema for the same reasoning) — only variantId /
 * deviceColorVariantId. */
export function ReturnStockForm({ repId, products }: ReturnStockFormProps) {
  const action = returnStockFromRep.bind(null, repId);
  const [state, formAction, isPending] = useActionState(action, initialState);
  const [lines, setLines] = useState<TransferLine[]>([]);

  const excludeIds = useMemo(() => {
    const usedKeys = new Set(lines.map((line) => lineKey(line.productId, line.variantId, line.deviceColorVariantId)));
    const ids = new Set<string>();
    for (const product of products) {
      if (product.deviceColorVariantOptions?.length) {
        const allUsed = product.deviceColorVariantOptions.every((combo) => usedKeys.has(lineKey(product.id, null, combo.id)));
        if (allUsed) ids.add(product.id);
        continue;
      }
      const variantIds: (string | null)[] = product.variantOptions?.length ? product.variantOptions.map((variant) => variant.id) : [null];
      const allUsed = variantIds.every((variantId) => usedKeys.has(lineKey(product.id, variantId, null)));
      if (allUsed) ids.add(product.id);
    }
    return ids;
  }, [lines, products]);

  function handleAddProduct(product: ReturnStockProductOption, _colorId: string | null, variantId: string | null, deviceColorVariantId: string | null) {
    const variant = product.variantOptions?.find((option) => option.id === variantId) ?? null;
    const combo = product.deviceColorVariantOptions?.find((option) => option.id === deviceColorVariantId) ?? null;
    setLines((prev) => [
      ...prev,
      {
        productId: product.id,
        variantId,
        deviceColorVariantId,
        label: product.nameAr ?? product.name,
        optionLabel: variant?.label ?? combo?.label ?? null,
        sku: product.sku,
        quantity: 1,
        maxStock: variant ? (variant.stock ?? 0) : combo ? (combo.stock ?? 0) : product.repStock,
        thumbnailUrl: product.thumbnailUrl,
        thumbnailAlt: product.thumbnailAlt,
      },
    ]);
  }

  function handleRemoveLine(productId: string, variantId: string | null, deviceColorVariantId: string | null) {
    setLines((prev) => prev.filter((line) => lineKey(line.productId, line.variantId, line.deviceColorVariantId) !== lineKey(productId, variantId, deviceColorVariantId)));
  }

  function handleQuantityChange(productId: string, variantId: string | null, deviceColorVariantId: string | null, value: string) {
    const quantity = Math.max(1, Math.floor(Number(value) || 1));
    setLines((prev) =>
      prev.map((line) =>
        lineKey(line.productId, line.variantId, line.deviceColorVariantId) === lineKey(productId, variantId, deviceColorVariantId) ? { ...line, quantity } : line,
      ),
    );
  }

  const itemsJson = useMemo(
    () =>
      JSON.stringify(
        lines.map((line) => ({
          productId: line.productId,
          variantId: line.variantId,
          deviceColorVariantId: line.deviceColorVariantId,
          quantity: line.quantity,
        })),
      ),
    [lines],
  );

  if (products.length === 0) {
    return <p className="text-sm text-neutral-bg/60">لا يملك هذا المندوب أي مخزون قابل للإرجاع حالياً.</p>;
  }

  return (
    <form action={formAction} className="flex max-w-xl flex-col gap-4">
      <input type="hidden" name="items" value={itemsJson} />

      <ProductQuickPicker products={products} excludeIds={excludeIds} onPick={handleAddProduct} placeholder="ابحث عن منتج لإرجاعه..." />

      {lines.length > 0 && (
        <div className="flex flex-col divide-y divide-navy-soft rounded-card border border-navy-soft bg-navy-deep px-3">
          {lines.map((line) => (
            <div key={lineKey(line.productId, line.variantId, line.deviceColorVariantId)} className="flex flex-wrap items-center gap-3 py-3 first:pt-3 last:pb-3">
              <ProductThumb product={{ ...line, name: line.label }} className="h-10 w-10" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-neutral-bg">
                  {line.label}
                  {line.optionLabel && <span> — {line.optionLabel}</span>}
                </p>
                <p className="text-xs text-neutral-bg/50">{line.sku} — مخزون المندوب الحالي: {line.maxStock}</p>
              </div>
              <div className="w-20">
                <Input
                  type="number"
                  min={1}
                  max={line.maxStock}
                  value={line.quantity}
                  onChange={(event) => handleQuantityChange(line.productId, line.variantId, line.deviceColorVariantId, event.target.value)}
                  aria-label="الكمية"
                />
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={() => handleRemoveLine(line.productId, line.variantId, line.deviceColorVariantId)}>
                حذف
              </Button>
            </div>
          ))}
        </div>
      )}

      <Textarea name="notes" label="ملاحظات / السبب (اختياري)" rows={3} />

      {state.error && (
        <p className="text-sm text-rose-600" role="alert">
          {state.error}
        </p>
      )}

      <Button type="submit" variant="outline" disabled={isPending || lines.length === 0}>
        {isPending && <Spinner />}
        {isPending ? "جارٍ الحفظ..." : `إرجاع المخزون${lines.length > 0 ? ` (${lines.length})` : ""}`}
      </Button>
    </form>
  );
}
