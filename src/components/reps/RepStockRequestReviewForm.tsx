"use client";

import { useActionState, useMemo, useState } from "react";
import { reviewStockRequest, type RepStockRequestActionState } from "@/app/admin/rep-requests/[requestId]/actions";
import { Textarea } from "@/components/ui/Textarea";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";

export interface RepStockRequestReviewItem {
  itemId: string;
  productLabel: string;
  sku: string;
  requestedQuantity: number;
  approvedQuantity: number | null;
  warehouseAvailable: number;
  carQuantity: number;
}

export interface RepStockRequestReviewFormProps {
  requestId: string;
  items: RepStockRequestReviewItem[];
  initialAdminNote: string;
}

const initialState: RepStockRequestActionState = {};

/** Admin sets/edits approvedQuantity per line (capped at requestedQuantity,
 * never trusts the client cap alone — the server action re-validates) and
 * an optional admin note, then submits reviewStockRequest. Purely a review
 * step: no stock is touched here. */
export function RepStockRequestReviewForm({ requestId, items, initialAdminNote }: RepStockRequestReviewFormProps) {
  const action = reviewStockRequest.bind(null, requestId);
  const [state, formAction, isPending] = useActionState(action, initialState);

  const [quantities, setQuantities] = useState<Record<string, number>>(() =>
    Object.fromEntries(items.map((item) => [item.itemId, item.approvedQuantity ?? item.requestedQuantity])),
  );
  const [adminNote, setAdminNote] = useState(initialAdminNote);

  function handleChange(itemId: string, value: string, max: number) {
    const quantity = Math.min(Math.max(0, Math.floor(Number(value) || 0)), max);
    setQuantities((prev) => ({ ...prev, [itemId]: quantity }));
  }

  const itemsJson = useMemo(
    () =>
      JSON.stringify(
        items.map((item) => ({ itemId: item.itemId, approvedQuantity: quantities[item.itemId] ?? 0 })),
      ),
    [items, quantities],
  );

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="items" value={itemsJson} />

      <div className="flex flex-col divide-y divide-navy-soft">
        {items.map((item) => (
          <div key={item.itemId} className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-neutral-bg">{item.productLabel}</p>
              <p className="text-xs text-neutral-bg/50">
                {item.sku} · مطلوب: {item.requestedQuantity} · متوفر بالمستودع: {item.warehouseAvailable} · حالياً
                بالسيارة: {item.carQuantity}
              </p>
            </div>
            <div className="w-24">
              <Input
                type="number"
                min={0}
                max={item.requestedQuantity}
                value={quantities[item.itemId] ?? 0}
                onChange={(event) => handleChange(item.itemId, event.target.value, item.requestedQuantity)}
                aria-label="الكمية الموافق عليها"
              />
            </div>
          </div>
        ))}
      </div>

      <Textarea
        name="adminNote"
        label="ملاحظة المدير (اختياري)"
        value={adminNote}
        onChange={(event) => setAdminNote(event.target.value)}
        rows={3}
      />

      {state.error && (
        <p className="text-sm text-rose-600" role="alert">
          {state.error}
        </p>
      )}

      <Button type="submit" disabled={isPending} className="w-full sm:w-auto">
        {isPending && <Spinner />}
        {isPending ? "جارٍ الحفظ..." : "حفظ المراجعة"}
      </Button>
    </form>
  );
}
