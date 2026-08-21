"use client";

import { useActionState, useMemo, useState } from "react";
import Link from "next/link";
import { createCombo, updateComboQuantity, toggleComboActive, removeCombo, type ComboActionState } from "./actions";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { cn } from "@/lib/utils";

type DeviceBrand = { id: string; name: string; nameAr: string | null; models: { id: string; name: string; nameAr: string | null }[] };
type ColorOption = { id: string; name: string; nameAr: string | null; hexCode: string | null };
type Combo = { id: string; isActive: boolean; phoneModelId: string; brandLabel: string; modelLabel: string; colorLabel: string; colorHex: string | null; quantity: number };

const initial: ComboActionState = {};

/** One color's row inside a model group — same three-column layout
 * (color / quantity+save / status actions) on every row across every group,
 * so everything lines up regardless of label length. Still one independent
 * DeviceColorVariant record per row; grouping by model is purely visual. */
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
    <div
      className={cn(
        "grid grid-cols-1 items-center gap-x-4 gap-y-2 border-b border-navy-soft/60 px-4 py-3 last:border-b-0 sm:grid-cols-[11rem_1fr_auto]",
        !combo.isActive && "opacity-60",
      )}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        {combo.colorHex && (
          <span aria-hidden="true" className="h-3 w-3 shrink-0 rounded-full border border-navy-soft" style={{ backgroundColor: combo.colorHex }} />
        )}
        <span className="text-sm font-medium text-neutral-bg">{combo.colorLabel}</span>
        {/* Disabled is the manual admin control; out-of-stock is purely
         * informational — quantity 0 never flips isActive on its own (see
         * updateComboQuantity in ./actions.ts), so both can appear
         * independently of each other. */}
        {!combo.isActive && <Badge variant="neutral">معطل</Badge>}
        {combo.isActive && combo.quantity === 0 && <Badge variant="warning">نفد المخزون</Badge>}
      </div>

      <form action={qtyAction} className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-neutral-bg/50 sm:hidden">الكمية</span>
        <input type="hidden" name="quantity" value={quantity} />
        <input
          type="number"
          min={0}
          value={quantity}
          onChange={(event) => setQuantity(Math.max(0, Math.floor(Number(event.target.value) || 0)))}
          className="h-9 w-24 rounded-card border border-navy-soft bg-navy-deep px-2 text-neutral-bg"
        />
        <Button type="submit" size="sm" variant="outline" disabled={qtyPending || quantity === combo.quantity}>
          {qtyPending ? "جارٍ الحفظ..." : "حفظ"}
        </Button>
        {qtyState.error && <span className="text-xs text-rose-500">{qtyState.error}</span>}
        {!qtyState.error && qtyState.success && <span className="text-xs text-emerald-500">{qtyState.success}</span>}
      </form>

      <div className="flex items-center gap-2">
        <form action={toggleComboActive.bind(null, combo.id, productId)}>
          <Button type="submit" size="sm" variant="ghost">{combo.isActive ? "تعطيل" : "تفعيل"}</Button>
        </form>
        <Button type="button" size="sm" variant="ghost" disabled={removing} onClick={handleRemove}>
          {removing ? "..." : "حذف"}
        </Button>
        {removeMessage && <span className="text-xs text-neutral-bg/60">{removeMessage}</span>}
      </div>
    </div>
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

  // Purely presentational grouping — every combo stays its own independent
  // record (see createCombo/updateComboQuantity/removeCombo in ./actions.ts,
  // all untouched); this just clusters rows by phoneModelId so the
  // brand/model heading is shown once instead of repeating per color.
  // `combos` already arrives sorted brand → model → color (see the page's
  // Prisma orderBy), so grouping by first-seen order preserves that.
  const groups = useMemo(() => {
    const byModel = new Map<string, { phoneModelId: string; brandLabel: string; modelLabel: string; combos: Combo[] }>();
    for (const combo of combos) {
      const group = byModel.get(combo.phoneModelId);
      if (group) {
        group.combos.push(combo);
      } else {
        byModel.set(combo.phoneModelId, {
          phoneModelId: combo.phoneModelId,
          brandLabel: combo.brandLabel,
          modelLabel: combo.modelLabel,
          combos: [combo],
        });
      }
    }
    return Array.from(byModel.values());
  }, [combos]);

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

      {groups.length === 0 ? (
        <div className="rounded-card border border-navy-soft bg-navy-surface px-4 py-8 text-center text-sm text-neutral-bg/50">
          لا توجد تركيبات بعد — أضِف أول تركيبة من النموذج أعلاه.
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map((group) => (
            <div key={group.phoneModelId} className="overflow-hidden rounded-card border border-navy-soft">
              <div className="flex items-center gap-2 bg-navy-soft/30 px-4 py-3">
                <span className="text-xs font-semibold uppercase tracking-wide text-gold-champagne/80">{group.brandLabel}</span>
                <span aria-hidden="true" className="text-neutral-bg/30">•</span>
                <h3 className="text-sm font-semibold text-neutral-bg">{group.modelLabel}</h3>
                <span className="ms-auto text-xs text-neutral-bg/50">{group.combos.length} لون</span>
              </div>
              <div className="bg-navy-surface">
                {group.combos.map((combo) => <ComboRow key={combo.id} productId={productId} combo={combo} />)}
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-neutral-bg/50">{allModels.length} موديل متاح إجمالاً عبر {brands.length} ماركة.</p>
    </div>
  );
}
