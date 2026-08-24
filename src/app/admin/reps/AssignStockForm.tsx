"use client";

import { useActionState, useMemo, useState } from "react";
import { assignStockToRep, type RepStockTransferState } from "./actions";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { ProductThumb, ProductQuickPicker, type PickableProduct } from "@/components/reps/ProductQuickPicker";
import { REP_LOAD_TYPES } from "@/lib/constants";
import { cn } from "@/lib/utils";

export interface AssignStockProductOption extends PickableProduct {
  /** Non-variant warehouse stock — a phone-variant or device-color-combo
   * product's stock lives per-option on variantOptions[].stock /
   * deviceColorVariantOptions[].stock instead. */
  warehouseStock: number;
}

interface AssignStockFormProps {
  repId: string;
  products: AssignStockProductOption[];
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

/** Multi-line transfer form (warehouse → rep car) — reuses the same
 * search/thumbnail/detail product picker as the rep-facing forms. Every
 * product added in one submission becomes one RepStockTransferBatch with
 * one StockMovement per line, printable as a single combined invoice. No
 * customer/order context, so callers never populate colorOptions here (see
 * repStockTransferBatchSchema for the same reasoning) — only variantId /
 * deviceColorVariantId. */
export function AssignStockForm({ repId, products }: AssignStockFormProps) {
  const action = assignStockToRep.bind(null, repId);
  const [state, formAction, isPending] = useActionState(action, initialState);
  const [lines, setLines] = useState<TransferLine[]>([]);
  const [loadType, setLoadType] = useState<string>(REP_LOAD_TYPES.CAR_STOCK);
  const [customerName, setCustomerName] = useState("");
  const isCustomerOrder = loadType === REP_LOAD_TYPES.CUSTOMER_ORDER;

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

  function handleAddProduct(product: AssignStockProductOption, _colorId: string | null, variantId: string | null, deviceColorVariantId: string | null) {
    const variant = product.variantOptions?.find((option) => option.id === variantId) ?? null;
    const combo = product.deviceColorVariantOptions?.find((option) => option.id === deviceColorVariantId) ?? null;
    const key = lineKey(product.id, variantId, deviceColorVariantId);

    setLines((prev) => {
      // The picker's detail modal never disables an option just because
      // it's already in this list (only out-of-stock options are disabled),
      // so re-picking the exact same product+variant+combo is always
      // possible — merge into the existing line instead of adding a second
      // one with the same exact target, which the server would otherwise
      // have to reject outright.
      const alreadyExists = prev.some((line) => lineKey(line.productId, line.variantId, line.deviceColorVariantId) === key);
      if (alreadyExists) {
        return prev.map((line) => (lineKey(line.productId, line.variantId, line.deviceColorVariantId) === key ? { ...line, quantity: line.quantity + 1 } : line));
      }
      return [
        ...prev,
        {
          productId: product.id,
          variantId,
          deviceColorVariantId,
          label: product.nameAr ?? product.name,
          optionLabel: variant?.label ?? (combo ? `${combo.brandLabel} / ${combo.modelLabel} / ${combo.colorLabel}` : null),
          sku: product.sku,
          quantity: 1,
          maxStock: variant ? (variant.stock ?? 0) : combo ? (combo.stock ?? 0) : product.warehouseStock,
          thumbnailUrl: product.thumbnailUrl,
          thumbnailAlt: product.thumbnailAlt,
        },
      ];
    });
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

  return (
    <form action={formAction} className="flex max-w-xl flex-col gap-4">
      <input type="hidden" name="items" value={itemsJson} />
      <input type="hidden" name="loadType" value={loadType} />
      {isCustomerOrder && <input type="hidden" name="customerName" value={customerName} />}

      <div>
        <p className="mb-1.5 text-sm font-medium text-neutral-bg/80">نوع التحميل</p>
        <div role="radiogroup" aria-label="نوع التحميل" className="flex gap-2">
          {[
            { value: REP_LOAD_TYPES.CAR_STOCK, label: "مخزون سيارة" },
            { value: REP_LOAD_TYPES.CUSTOMER_ORDER, label: "طلبية زبون" },
          ].map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={loadType === option.value}
              onClick={() => setLoadType(option.value)}
              className={cn(
                "flex-1 rounded-card border px-4 py-2 text-sm transition-colors",
                loadType === option.value
                  ? "border-gold-champagne/60 bg-gold-champagne/10 text-gold-champagne"
                  : "border-navy-soft text-neutral-bg/70 hover:border-gold-champagne/30",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {isCustomerOrder && (
        <Input
          label="اسم الزبون"
          value={customerName}
          onChange={(event) => setCustomerName(event.target.value)}
          placeholder="مثال: أحمد محمد"
          required
        />
      )}

      <ProductQuickPicker products={products} excludeIds={excludeIds} onPick={handleAddProduct} placeholder="ابحث عن منتج لتخصيصه..." />

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
                <p className="text-xs text-neutral-bg/50">{line.sku} — المتوفر: {line.maxStock}</p>
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

      <Button
        type="submit"
        disabled={isPending || lines.length === 0 || (isCustomerOrder && customerName.trim().length < 2)}
      >
        {isPending && <Spinner />}
        {isPending ? "جارٍ الحفظ..." : `تخصيص المخزون${lines.length > 0 ? ` (${lines.length})` : ""}`}
      </Button>
    </form>
  );
}
