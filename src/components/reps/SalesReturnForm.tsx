"use client";

import { useActionState, useState } from "react";
import { createSalesReturnAction, type SalesReturnFormState } from "@/app/rep/sales/[orderNumber]/return/actions";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { Textarea } from "@/components/ui/Textarea";

export interface SalesReturnFormLine {
  orderItemId: string;
  label: string;
  quantity: number;
  bonusQuantity: number;
  returnedQuantity: number;
  remainingQuantity: number;
  /** Cumulative bonus units already returned for this line, and how many
   * more may still be declared as bonus on a future return — see
   * OrderReturnLineSummary in src/lib/sales-returns.ts. */
  returnedBonusQuantity: number;
  remainingBonusQuantity: number;
}

const initialState: SalesReturnFormState = {};

/** Rep-facing return entry for ONE invoice. The server re-validates
 * everything (ownership, the three independent physical/bonus/paid
 * cumulative bounds, credit) — the min/max here are only UX.
 *
 * A line whose original bonusQuantity is 0 shows only the plain quantity
 * input (no bonus clutter). A line WITH bonus units gets a second "منها
 * بونص" input — the rep must say EXACTLY how many of the returned physical
 * units are bonus, since that split is never guessed (see
 * SalesReturnItem.bonusQuantity's schema doc comment): only the paid
 * portion of a return ever earns monetary credit. */
export function SalesReturnForm({ orderNumber, lines }: { orderNumber: string; lines: SalesReturnFormLine[] }) {
  const [state, formAction, isPending] = useActionState(createSalesReturnAction, initialState);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [bonusQuantities, setBonusQuantities] = useState<Record<string, number>>({});

  const totalUnits = lines.reduce((sum, line) => sum + (quantities[line.orderItemId] ?? 0), 0);
  const payload = JSON.stringify(
    lines.map((line) => ({ orderItemId: line.orderItemId, quantity: quantities[line.orderItemId] ?? 0, bonusQuantity: bonusQuantities[line.orderItemId] ?? 0 })),
  );

  function setQuantity(line: SalesReturnFormLine, next: number) {
    const clampedQuantity = Number.isFinite(next) ? Math.min(Math.max(Math.floor(next), 0), line.remainingQuantity) : 0;
    setQuantities((previous) => ({ ...previous, [line.orderItemId]: clampedQuantity }));
    // A returned-bonus declaration can never exceed the (possibly just
    // lowered) returned quantity — clamp it down along with the quantity.
    setBonusQuantities((previous) => {
      const currentBonus = previous[line.orderItemId] ?? 0;
      if (currentBonus <= clampedQuantity) return previous;
      return { ...previous, [line.orderItemId]: clampedQuantity };
    });
  }

  function setBonusQuantity(line: SalesReturnFormLine, next: number) {
    const quantity = quantities[line.orderItemId] ?? 0;
    const max = Math.min(quantity, line.remainingBonusQuantity);
    const clamped = Number.isFinite(next) ? Math.min(Math.max(Math.floor(next), 0), max) : 0;
    setBonusQuantities((previous) => ({ ...previous, [line.orderItemId]: clamped }));
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="orderNumber" value={orderNumber} />
      <input type="hidden" name="lines" value={payload} />

      <div className="overflow-x-auto rounded-card border border-navy-soft">
        <table className="w-full text-sm">
          <thead className="bg-navy-deep text-xs text-neutral-bg/60">
            <tr>
              <th className="px-3 py-2 text-start">الصنف</th>
              <th className="px-3 py-2 text-center">الكمية الأصلية</th>
              <th className="px-3 py-2 text-center">منها بونص</th>
              <th className="px-3 py-2 text-center">تم إرجاعه</th>
              <th className="px-3 py-2 text-center">المتبقي للإرجاع</th>
              <th className="px-3 py-2 text-center">الكمية المرتجعة</th>
              <th className="px-3 py-2 text-center">منها بونص</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-navy-soft">
            {lines.map((line) => {
              const hasBonus = line.bonusQuantity > 0;
              const quantity = quantities[line.orderItemId] ?? 0;
              const bonus = bonusQuantities[line.orderItemId] ?? 0;
              const disabled = line.remainingQuantity <= 0;
              return (
                <tr key={line.orderItemId} className={disabled ? "opacity-50" : undefined}>
                  <td className="px-3 py-2 text-neutral-bg">{line.label}</td>
                  <td className="px-3 py-2 text-center">{line.quantity}</td>
                  <td className="px-3 py-2 text-center">{hasBonus ? line.bonusQuantity : "—"}</td>
                  <td className="px-3 py-2 text-center">{line.returnedQuantity}</td>
                  <td className="px-3 py-2 text-center font-semibold text-gold-champagne">{line.remainingQuantity}</td>
                  <td className="px-3 py-2 text-center">
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={line.remainingQuantity}
                      step={1}
                      disabled={disabled}
                      value={quantity > 0 ? quantity : ""}
                      aria-label={`الكمية المرتجعة — ${line.label}`}
                      onChange={(event) => setQuantity(line, Number(event.target.value))}
                      className="h-10 w-20 rounded-card border border-navy-soft bg-navy-deep text-center text-sm text-neutral-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-champagne"
                    />
                  </td>
                  <td className="px-3 py-2 text-center">
                    {hasBonus ? (
                      <div className="flex flex-col items-center gap-0.5">
                        <input
                          type="number"
                          inputMode="numeric"
                          min={0}
                          max={Math.min(quantity, line.remainingBonusQuantity)}
                          step={1}
                          disabled={disabled || quantity === 0 || line.remainingBonusQuantity <= 0}
                          value={bonus > 0 ? bonus : ""}
                          aria-label={`منها بونص — ${line.label}`}
                          onChange={(event) => setBonusQuantity(line, Number(event.target.value))}
                          className="h-10 w-16 rounded-card border border-navy-soft bg-navy-deep text-center text-sm text-neutral-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-champagne"
                        />
                        <span className="text-[10px] text-neutral-bg/50">الحد الأقصى: {line.remainingBonusQuantity}</span>
                      </div>
                    ) : (
                      <span className="text-neutral-bg/40">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Textarea name="note" label="ملاحظة (اختياري)" />

      <p className="text-xs text-neutral-bg/60">
        ستُضاف كل الكميات المرتجعة (بما فيها البونص) إلى مخزون سيارتك. قيمة المردود المالية تُحسب من سعر الفاتورة الأصلية (بعد الخصم) وتشمل فقط الوحدات المدفوعة — الوحدات المجانية (بونص) تعود للمخزون بدون أي قيمة مالية.
      </p>

      <Button type="submit" disabled={isPending || totalUnits === 0} className="self-start">
        {isPending && <Spinner />}
        {isPending ? "جارٍ التسجيل..." : `تأكيد المردود (${totalUnits} قطعة)`}
      </Button>

      {state.error && (
        <p className="text-sm text-rose-400" role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}
