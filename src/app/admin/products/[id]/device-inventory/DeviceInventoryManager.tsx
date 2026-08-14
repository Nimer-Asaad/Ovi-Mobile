"use client";

import { useActionState, useMemo, useState } from "react";
import Link from "next/link";
import { createCombo, updateComboQuantity, toggleComboActive, removeCombo, type ComboActionState } from "./actions";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";

type DeviceBrand = { id: string; name: string; nameAr: string | null; models: { id: string; name: string; nameAr: string | null }[] };
type ColorOption = { id: string; name: string; nameAr: string | null; hexCode: string | null };
type Combo = { id: string; isActive: boolean; brandLabel: string; modelLabel: string; colorLabel: string; colorHex: string | null; quantity: number };

const initial: ComboActionState = {};

function ComboRow({ productId, combo }: { productId: string; combo: Combo }) {
  const [quantity, setQuantity] = useState(combo.quantity);
  const [qtyState, qtyAction, qtyPending] = useActionState(updateComboQuantity.bind(null, combo.id, productId), initial);
  const [removeMessage, setRemoveMessage] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);

  async function handleRemove() {
    setRemoving(true);
    const result = await removeCombo(combo.id, productId);
    setRemoveMessage(result.message);
    setRemoving(false);
  }

  return (
    <tr className={combo.isActive ? undefined : "opacity-50"}>
      <td className="px-3 py-2 text-neutral-bg">{combo.brandLabel}</td>
      <td className="px-3 py-2 text-neutral-bg">{combo.modelLabel}</td>
      <td className="px-3 py-2 text-neutral-bg">
        <span className="inline-flex items-center gap-2">
          {combo.colorHex && <span aria-hidden="true" className="h-3 w-3 rounded-full border border-navy-soft" style={{ backgroundColor: combo.colorHex }} />}
          {combo.colorLabel}
        </span>
      </td>
      <td className="px-3 py-2">
        <form action={qtyAction} className="flex items-center gap-2">
          <input type="hidden" name="quantity" value={quantity} />
          <input
            type="number"
            min={0}
            value={quantity}
            onChange={(event) => setQuantity(Math.max(0, Math.floor(Number(event.target.value) || 0)))}
            className="h-9 w-24 rounded-card border border-navy-soft bg-navy-deep px-2 text-neutral-bg"
          />
          <Button type="submit" size="sm" variant="outline" disabled={qtyPending || quantity === combo.quantity}>
            {qtyPending ? "..." : "حفظ"}
          </Button>
        </form>
        {qtyState.error && <p className="mt-1 text-xs text-rose-500">{qtyState.error}</p>}
      </td>
      <td className="px-3 py-2 text-center">
        <form action={toggleComboActive.bind(null, combo.id, productId)}>
          <Button type="submit" size="sm" variant="ghost">{combo.isActive ? "تعطيل" : "تفعيل"}</Button>
        </form>
      </td>
      <td className="px-3 py-2 text-center">
        <Button type="button" size="sm" variant="ghost" disabled={removing} onClick={handleRemove}>
          {removing ? "..." : "حذف"}
        </Button>
        {removeMessage && <p className="mt-1 text-xs text-neutral-bg/60">{removeMessage}</p>}
      </td>
    </tr>
  );
}

export function DeviceInventoryManager({
  productId,
  brands,
  colors,
  combos,
}: {
  productId: string;
  brands: DeviceBrand[];
  colors: ColorOption[];
  combos: Combo[];
}) {
  const allModels = useMemo(() => brands.flatMap((brand) => brand.models.map((model) => ({ ...model, brandId: brand.id }))), [brands]);
  const [brandId, setBrandId] = useState(brands[0]?.id ?? "");
  const modelsForBrand = brands.find((brand) => brand.id === brandId)?.models ?? [];
  const [modelId, setModelId] = useState(modelsForBrand[0]?.id ?? "");
  const [colorId, setColorId] = useState(colors[0]?.id ?? "");
  const [addState, addAction, addPending] = useActionState(createCombo.bind(null, productId), initial);

  function handleBrandChange(nextBrandId: string) {
    setBrandId(nextBrandId);
    const firstModel = brands.find((brand) => brand.id === nextBrandId)?.models[0];
    setModelId(firstModel?.id ?? "");
  }

  const canAddCombo = brands.length > 0 && colors.length > 0;

  return (
    <div className="space-y-6">
      {!canAddCombo ? (
        <div className="rounded-card border border-navy-soft bg-navy-surface p-5 text-sm text-neutral-bg/60">
          {brands.length === 0 && (
            <p>
              لا توجد ماركات هواتف مفعّلة — أضِف ماركة وموديلاً من صفحة{" "}
              <Link href="/admin/phone-devices" className="text-gold-champagne hover:underline">ماركات وموديلات الهواتف</Link>{" "}
              لتتمكن من إضافة تركيبة جديدة. التركيبات الحالية أدناه تبقى معروضة وقابلة للتعديل.
            </p>
          )}
          {brands.length > 0 && colors.length === 0 && (
            <p>
              لا توجد ألوان مفعّلة — أضِف لوناً من صفحة{" "}
              <Link href="/admin/colors" className="text-gold-champagne hover:underline">الألوان</Link>{" "}
              لتتمكن من إضافة تركيبة جديدة. التركيبات الحالية أدناه تبقى معروضة وقابلة للتعديل.
            </p>
          )}
        </div>
      ) : (
        <form action={addAction} className="flex flex-col gap-3 rounded-card border border-navy-soft bg-navy-surface p-5">
          <h3 className="font-semibold text-neutral-bg">إضافة تركيبة جديدة</h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Select label="الماركة" value={brandId} onChange={(event) => handleBrandChange(event.target.value)}>
              {brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.nameAr ?? brand.name}</option>)}
            </Select>
            <Select name="phoneModelId" label="الموديل" value={modelId} onChange={(event) => setModelId(event.target.value)}>
              {modelsForBrand.length === 0 && <option value="">لا توجد موديلات لهذه الماركة</option>}
              {modelsForBrand.map((model) => <option key={model.id} value={model.id}>{model.nameAr ?? model.name}</option>)}
            </Select>
            <Select name="colorId" label="اللون" value={colorId} onChange={(event) => setColorId(event.target.value)}>
              {colors.map((color) => <option key={color.id} value={color.id}>{color.nameAr ?? color.name}</option>)}
            </Select>
            <Input name="quantity" type="number" min={0} defaultValue={0} label="الكمية الافتتاحية" />
          </div>
          <Button type="submit" disabled={addPending || !modelId || !colorId} className="self-start">
            {addPending ? "جارٍ الإضافة..." : "إضافة التركيبة"}
          </Button>
          {addState.error && <p className="text-sm text-rose-500">{addState.error}</p>}
          {addState.success && <p className="text-sm text-emerald-500">{addState.success}</p>}
        </form>
      )}

      <div className="overflow-x-auto rounded-card border border-navy-soft">
        <table className="w-full text-sm">
          <thead className="bg-navy-soft/30 text-neutral-bg/70">
            <tr>
              <th className="px-3 py-3 text-start">الماركة</th>
              <th className="px-3 py-3 text-start">الموديل</th>
              <th className="px-3 py-3 text-start">اللون</th>
              <th className="px-3 py-3 text-start">الكمية</th>
              <th className="px-3 py-3 text-center">الحالة</th>
              <th className="px-3 py-3 text-center"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-navy-soft bg-navy-surface">
            {combos.map((combo) => <ComboRow key={combo.id} productId={productId} combo={combo} />)}
            {combos.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-neutral-bg/50">
                  لا توجد تركيبات بعد — أضِف أول تركيبة من النموذج أعلاه.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-neutral-bg/50">{allModels.length} موديل متاح إجمالاً عبر {brands.length} ماركة.</p>
    </div>
  );
}
