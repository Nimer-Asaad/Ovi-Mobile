"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createBulkStockOut, type BulkStockOutState } from "./actions";
import { Select } from "@/components/ui/Select";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { PRODUCT_VARIANT_MODES, PRODUCT_INVENTORY_TRACKING_MODES, VARIANT_ALLOCATION_STATUSES } from "@/lib/constants";
import { ProductThumb, ProductQuickPicker } from "@/components/reps/ProductQuickPicker";
import { type AdjustStockProductOption, useDeviceComboCascade, usePhoneVariantCascade } from "./adjustCascades";

interface BulkOutLine {
  productId: string;
  variantId: string | null;
  deviceColorVariantId: string | null;
  label: string;
  optionLabel: string | null;
  sku: string;
  quantity: number;
  /** Warehouse stock known at the moment this line was added/merged —
   * display only, never trusted server-side (see createBulkStockOut, which
   * re-reads and atomically decrements each line's real current stock
   * inside the transaction). */
  maxStock: number;
  thumbnailUrl: string | null;
  thumbnailAlt: string | null;
}

interface BulkStockOutFormProps {
  products: AdjustStockProductOption[];
}

const initialState: BulkStockOutState = {};

function lineKey(productId: string, variantId: string | null, deviceColorVariantId: string | null): string {
  return `${productId}:${variantId ?? ""}:${deviceColorVariantId ?? ""}`;
}

/** Multi-item warehouse OUT: pick a product (+ exact model/color when the
 * product requires it, via the same cascading selects AdjustStockForm
 * uses), enter a quantity, add it to a running list, repeat for as many
 * items as needed, then submit the whole list as one atomic operation (see
 * createBulkStockOut) — replaces the old one-item-at-a-time OUT flow, which
 * is why OUT no longer appears as an option in AdjustStockForm. */
export function BulkStockOutForm({ products }: BulkStockOutFormProps) {
  const [state, formAction, isPending] = useActionState(createBulkStockOut, initialState);
  const router = useRouter();

  const [lines, setLines] = useState<BulkOutLine[]>([]);
  const [selected, setSelected] = useState<AdjustStockProductOption | null>(null);
  const [quantity, setQuantity] = useState("");
  const [notes, setNotes] = useState("");

  const deviceCombo = useDeviceComboCascade(selected);
  const phoneVariant = usePhoneVariantCascade(selected);

  const usesDeviceColor = selected?.inventoryTrackingMode === PRODUCT_INVENTORY_TRACKING_MODES.DEVICE_MODEL_COLOR;
  const usesPhoneVariant = selected?.variantMode === PRODUCT_VARIANT_MODES.PHONE_COMPATIBILITY;
  const variantNotReady = Boolean(usesPhoneVariant) && selected?.variantAllocationStatus !== VARIANT_ALLOCATION_STATUSES.READY;

  useEffect(() => {
    if (state.success) {
      setLines([]);
      setNotes("");
      router.refresh();
    }
  }, [state, router]);

  function handleSelectProduct(product: AdjustStockProductOption) {
    setSelected(product);
    setQuantity("");
    deviceCombo.reset();
    phoneVariant.reset();
  }

  function handleChangeProduct() {
    setSelected(null);
    setQuantity("");
    deviceCombo.reset();
    phoneVariant.reset();
  }

  const currentStock = usesDeviceColor
    ? deviceCombo.resolved?.stock ?? null
    : usesPhoneVariant
      ? phoneVariant.resolved?.stock ?? null
      : selected
        ? selected.stock
        : null;

  const targetFullyResolved =
    Boolean(selected) &&
    !variantNotReady &&
    (usesDeviceColor ? Boolean(deviceCombo.resolved) : usesPhoneVariant ? Boolean(phoneVariant.resolved) : true);

  const parsedQuantity = Math.floor(Number(quantity));
  const canAdd = targetFullyResolved && Number.isFinite(parsedQuantity) && parsedQuantity > 0;

  function handleAddToList() {
    if (!selected || !canAdd) return;

    const variant = usesPhoneVariant ? phoneVariant.resolved : null;
    const combo = usesDeviceColor ? deviceCombo.resolved : null;
    const variantId = variant?.id ?? null;
    const deviceColorVariantId = combo?.id ?? null;
    const optionLabel = combo ? `${combo.brandLabel} / ${combo.modelLabel} / ${combo.colorLabel}` : variant ? `${variant.brandLabel} / ${variant.modelLabel}` : null;
    const maxStock = combo ? combo.stock : variant ? variant.stock : selected.stock;
    const key = lineKey(selected.id, variantId, deviceColorVariantId);

    setLines((prev) => {
      // Same exact inventory target added twice — merge quantities into the
      // existing line instead of creating a second, conflicting one.
      const alreadyExists = prev.some((line) => lineKey(line.productId, line.variantId, line.deviceColorVariantId) === key);
      if (alreadyExists) {
        return prev.map((line) =>
          lineKey(line.productId, line.variantId, line.deviceColorVariantId) === key ? { ...line, quantity: line.quantity + parsedQuantity } : line,
        );
      }
      return [
        ...prev,
        {
          productId: selected.id,
          variantId,
          deviceColorVariantId,
          label: selected.nameAr ?? selected.name,
          optionLabel,
          sku: selected.sku,
          quantity: parsedQuantity,
          maxStock,
          thumbnailUrl: selected.thumbnailUrl,
          thumbnailAlt: selected.thumbnailAlt,
        },
      ];
    });

    // Keep the same product selected (only reset the model/color/quantity
    // cascade) so adding several colors of the same product doesn't force
    // re-searching for it every time — "تغيير" above still switches product.
    setQuantity("");
    deviceCombo.reset();
    phoneVariant.reset();
  }

  function handleRemoveLine(productId: string, variantId: string | null, deviceColorVariantId: string | null) {
    setLines((prev) => prev.filter((line) => lineKey(line.productId, line.variantId, line.deviceColorVariantId) !== lineKey(productId, variantId, deviceColorVariantId)));
  }

  function handleLineQuantityChange(productId: string, variantId: string | null, deviceColorVariantId: string | null, value: string) {
    const next = Math.max(1, Math.floor(Number(value) || 1));
    setLines((prev) =>
      prev.map((line) =>
        lineKey(line.productId, line.variantId, line.deviceColorVariantId) === lineKey(productId, variantId, deviceColorVariantId) ? { ...line, quantity: next } : line,
      ),
    );
  }

  const totalQuantity = useMemo(() => lines.reduce((sum, line) => sum + line.quantity, 0), [lines]);

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
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="items" value={itemsJson} />

      <div>
        <p className="mb-1.5 text-sm font-medium text-neutral-bg/80">اختيار الصنف</p>
        {!selected ? (
          <ProductQuickPicker products={products} excludeIds={new Set()} onPick={handleSelectProduct} placeholder="ابحث عن منتج..." />
        ) : (
          <div className="flex items-center justify-between gap-3 rounded-card border border-navy-soft bg-navy-deep px-3 py-2">
            <div className="flex items-center gap-3">
              <ProductThumb product={selected} className="h-10 w-10" />
              <div>
                <p className="text-sm text-neutral-bg">
                  {selected.nameAr ?? selected.name}
                  {!selected.isActive && <span className="text-neutral-bg/50"> — غير مفعل</span>}
                </p>
                <p className="text-xs text-neutral-bg/50">{selected.sku}</p>
              </div>
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={handleChangeProduct}>
              تغيير
            </Button>
          </div>
        )}
      </div>

      {selected && usesPhoneVariant && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label="الماركة" value={phoneVariant.brandId} onChange={(event) => phoneVariant.pickBrand(event.target.value)}>
            <option value="">اختر الماركة</option>
            {phoneVariant.brands.map((brand) => (
              <option key={brand.id} value={brand.id}>{brand.label}</option>
            ))}
          </Select>
          <Select
            label="الموديل"
            value={phoneVariant.modelId}
            onChange={(event) => phoneVariant.setModelId(event.target.value)}
            disabled={!phoneVariant.brandId}
          >
            <option value="">اختر الموديل</option>
            {phoneVariant.models.map((variant) => (
              <option key={variant.phoneModelId} value={variant.phoneModelId}>
                {variant.modelLabel}
                {!variant.isActive && " (معطل)"}
              </option>
            ))}
          </Select>
        </div>
      )}

      {selected && usesDeviceColor && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Select label="الماركة" value={deviceCombo.brandId} onChange={(event) => deviceCombo.pickBrand(event.target.value)}>
            <option value="">اختر الماركة</option>
            {deviceCombo.brands.map((brand) => (
              <option key={brand.id} value={brand.id}>{brand.label}</option>
            ))}
          </Select>
          <Select
            label="الموديل"
            value={deviceCombo.modelId}
            onChange={(event) => deviceCombo.pickModel(event.target.value)}
            disabled={!deviceCombo.brandId}
          >
            <option value="">اختر الموديل</option>
            {deviceCombo.models.map((model) => (
              <option key={model.id} value={model.id}>{model.label}</option>
            ))}
          </Select>
          <Select
            label="اللون"
            value={deviceCombo.colorId}
            onChange={(event) => deviceCombo.setColorId(event.target.value)}
            disabled={!deviceCombo.modelId}
          >
            <option value="">اختر اللون</option>
            {deviceCombo.colors.map((combo) => (
              <option key={combo.id} value={combo.colorId}>
                {combo.colorLabel}
                {!combo.isActive && " (معطل)"}
              </option>
            ))}
          </Select>
        </div>
      )}

      {selected && variantNotReady && (
        <p className="rounded-card border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-300">
          هذا المنتج ينتظر اعتماد توزيع مخزون الـVariants من صفحة الـVariants الخاصة به قبل إمكانية إخراج مخزونه من هنا.
        </p>
      )}

      {selected && !variantNotReady && (
        <div className="flex flex-wrap items-end gap-3">
          <div className="rounded-card border border-navy-soft bg-navy-deep px-3 py-2 text-sm text-neutral-bg/80">
            المتوفر حالياً:{" "}
            <span className="font-semibold text-neutral-bg">{currentStock === null ? "—" : currentStock}</span>
          </div>
          <div className="w-28">
            <Input
              type="number"
              min={1}
              step={1}
              label="الكمية"
              disabled={!targetFullyResolved}
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
            />
          </div>
          <Button type="button" disabled={!canAdd} onClick={handleAddToList}>
            + إضافة للقائمة
          </Button>
        </div>
      )}

      <div className="border-t border-navy-soft pt-4">
        <p className="mb-2 text-sm font-medium text-neutral-bg/80">الأصناف المختارة</p>
        {lines.length === 0 ? (
          <p className="py-6 text-center text-sm text-neutral-bg/50">لم يتم إضافة أصناف بعد</p>
        ) : (
          <div className="flex flex-col divide-y divide-navy-soft rounded-card border border-navy-soft bg-navy-deep px-3">
            {lines.map((line) => (
              <div key={lineKey(line.productId, line.variantId, line.deviceColorVariantId)} className="flex flex-wrap items-center gap-3 py-3 first:pt-3 last:pb-3">
                <ProductThumb product={{ ...line, name: line.label }} className="h-10 w-10" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-neutral-bg">
                    {line.label}
                    {line.optionLabel && <span> — {line.optionLabel}</span>}
                  </p>
                  <p className="text-xs text-neutral-bg/50">{line.sku} — متوفر: {line.maxStock}</p>
                </div>
                <div className="w-20">
                  <Input
                    type="number"
                    min={1}
                    max={line.maxStock}
                    value={line.quantity}
                    onChange={(event) => handleLineQuantityChange(line.productId, line.variantId, line.deviceColorVariantId, event.target.value)}
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

        {lines.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-neutral-bg/70">
            <span>إجمالي عدد السطور: {lines.length}</span>
            <span>إجمالي القطع: {totalQuantity}</span>
          </div>
        )}
      </div>

      <Textarea name="notes" label="سبب الإخراج / ملاحظات (اختياري)" rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} />

      {state.error && (
        <p className="whitespace-pre-line text-sm text-rose-600" role="alert">
          {state.error}
        </p>
      )}
      {state.success && <p className="text-sm text-emerald-600">{state.success}</p>}

      <Button type="submit" disabled={isPending || lines.length === 0} className="w-full sm:w-auto">
        {isPending && <Spinner />}
        {isPending ? "جارٍ الإخراج..." : `إخراج جميع الأصناف${lines.length > 0 ? ` (${lines.length})` : ""}`}
      </Button>
    </form>
  );
}
