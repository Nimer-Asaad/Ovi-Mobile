"use client";

import { useActionState, useMemo, useState } from "react";
import { addCompatibilityAction, removeCompatibilityAction, type CompatibilityActionState } from "@/app/admin/products/compatibility/actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { CompatibilityModelPicker } from "@/components/admin/products/CompatibilityModelPicker";
import type { CompatibilityBrandOption } from "@/lib/product-phone-compatibility";

export interface LinkedCompatibilityModel {
  modelId: string;
  modelLabel: string;
  brandLabel: string;
}

const initialState: CompatibilityActionState = {};

function RemoveLinkButton({ productId, model }: { productId: string; model: LinkedCompatibilityModel }) {
  const [state, formAction, isPending] = useActionState(removeCompatibilityAction, initialState);
  return (
    <form action={formAction} className="inline-flex items-center">
      <input type="hidden" name="productIds" value={JSON.stringify([productId])} />
      <input type="hidden" name="phoneModelIds" value={JSON.stringify([model.modelId])} />
      <button
        type="submit"
        disabled={isPending}
        title="إزالة التوافق"
        className="inline-flex items-center gap-1 rounded-full border border-navy-soft bg-navy-deep px-2.5 py-1 text-xs text-neutral-bg transition-colors hover:border-rose-500/60 hover:text-rose-500 disabled:opacity-50"
      >
        {model.modelLabel}
        {isPending ? <Spinner /> : <span aria-hidden="true">✕</span>}
      </button>
      {state.error && <span className="ms-2 text-xs text-rose-600">{state.error}</span>}
    </form>
  );
}

/** "توافق الأجهزة" section of the product edit page: which phone models this
 * accessory FITS. Compatibility is metadata only — adding or removing a model
 * here never changes the product's stock, status, variant mode or tracking
 * mode (a case keeps ONE aggregate balance however many models it fits). */
export function ProductCompatibilityManager({ productId, brands, linked }: { productId: string; brands: CompatibilityBrandOption[]; linked: LinkedCompatibilityModel[] }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [state, formAction, isPending] = useActionState(
    async (previous: CompatibilityActionState, formData: FormData) => {
      const result = await addCompatibilityAction(previous, formData);
      if (result.success) setSelected([]);
      return result;
    },
    initialState,
  );

  const linkedIds = useMemo(() => new Set(linked.map((model) => model.modelId)), [linked]);
  const byBrand = useMemo(() => {
    const groups = new Map<string, LinkedCompatibilityModel[]>();
    for (const model of linked) groups.set(model.brandLabel, [...(groups.get(model.brandLabel) ?? []), model]);
    return [...groups.entries()];
  }, [linked]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>توافق الأجهزة</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <p className="text-xs text-neutral-bg/60">
          حدّد موديلات الهواتف التي يناسبها هذا المنتج (مثل كفر أو لزقة). هذا تصنيف للبحث فقط: لا يغيّر المخزون ولا حالة المنتج ولا طريقة تتبّعه، والكمية تبقى رصيداً واحداً للمنتج.
        </p>

        {byBrand.length === 0 ? (
          <p className="text-sm text-neutral-bg/50">لم يُربط هذا المنتج بأي موديل بعد.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {byBrand.map(([brandLabel, models]) => (
              <div key={brandLabel} className="flex flex-col gap-1.5">
                <p className="text-xs font-medium text-neutral-bg/60">{brandLabel}</p>
                <div className="flex flex-wrap gap-2">
                  {models.map((model) => (
                    <RemoveLinkButton key={model.modelId} productId={productId} model={model} />
                  ))}
                </div>
              </div>
            ))}
            <p className="text-xs text-neutral-bg/50">إجمالي الموديلات المربوطة: {linked.length}</p>
          </div>
        )}

        <form action={formAction} className="flex flex-col gap-3 border-t border-navy-soft pt-4">
          <input type="hidden" name="productIds" value={JSON.stringify([productId])} />
          <input type="hidden" name="phoneModelIds" value={JSON.stringify(selected)} />
          <p className="text-sm font-medium text-neutral-bg">إضافة موديلات</p>
          <CompatibilityModelPicker brands={brands} selected={selected} onChange={setSelected} linkedModelIds={linkedIds} />
          {state.error && (
            <p className="text-sm text-rose-600" role="alert">
              {state.error}
            </p>
          )}
          {state.success && <p className="text-sm text-emerald-600">{state.success}</p>}
          <div>
            <Button type="submit" disabled={isPending || selected.length === 0}>
              {isPending && <Spinner />}
              إضافة الموديلات المحددة
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
