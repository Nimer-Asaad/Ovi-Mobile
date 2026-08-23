"use client";

import { useActionState, useState } from "react";
import { createStockMovement, type StockAdjustmentState } from "./actions";
import { Select } from "@/components/ui/Select";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import {
  MANUAL_STOCK_MOVEMENT_TYPES,
  PRODUCT_VARIANT_MODES,
  PRODUCT_INVENTORY_TRACKING_MODES,
  VARIANT_ALLOCATION_STATUSES,
} from "@/lib/constants";
import { ProductThumb, ProductQuickPicker } from "@/components/reps/ProductQuickPicker";
import { type AdjustStockProductOption, useDeviceComboCascade, usePhoneVariantCascade } from "./adjustCascades";

export type { AdjustVariantOption, AdjustDeviceComboOption, AdjustStockProductOption } from "./adjustCascades";

interface AdjustStockFormProps {
  products: AdjustStockProductOption[];
  selectedProductId?: string;
}

const initialState: StockAdjustmentState = {};

/** Single-item stock-movement form for Correction (final-balance
 * adjustment) only — IN and OUT both moved to the dedicated multi-item
 * BulkStockMovementForm (see AdjustStockPanel), since removing/adding
 * several different items in one visit is the common case and forcing one
 * submission per item was the exact problem that form was built to fix.
 * Correction stays single-item and single-purpose here: it sets one exact
 * inventory target to an absolute final quantity, which doesn't compose
 * with a multi-item "add to list" flow the same way a plain increment/
 * decrement does. Still handles every inventory tracking mode: a plain
 * TOTAL_STOCK product needs only the product itself; PHONE_COMPATIBILITY
 * needs brand+model; DEVICE_MODEL_COLOR needs brand+model+color. Whichever
 * applies, the resolved variantId/deviceColorVariantId travels to
 * createStockMovement via a hidden input — the server re-validates it
 * belongs to the product (see actions.ts). */
export function AdjustStockForm({ products, selectedProductId }: AdjustStockFormProps) {
  const [state, formAction, isPending] = useActionState(createStockMovement, initialState);
  const preselected = selectedProductId ? products.find((product) => product.id === selectedProductId) : undefined;
  const [selected, setSelected] = useState<AdjustStockProductOption | null>(preselected ?? null);
  const [quantity, setQuantity] = useState("");

  const deviceCombo = useDeviceComboCascade(selected);
  const phoneVariant = usePhoneVariantCascade(selected);

  const usesDeviceColor = selected?.inventoryTrackingMode === PRODUCT_INVENTORY_TRACKING_MODES.DEVICE_MODEL_COLOR;
  const usesPhoneVariant = selected?.variantMode === PRODUCT_VARIANT_MODES.PHONE_COMPATIBILITY;
  const variantNotReady = Boolean(usesPhoneVariant) && selected?.variantAllocationStatus !== VARIANT_ALLOCATION_STATUSES.READY;

  function handleSelectProduct(product: AdjustStockProductOption) {
    setSelected(product);
    deviceCombo.reset();
    phoneVariant.reset();
  }

  function handleChangeProduct() {
    setSelected(null);
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

  const canSubmit = targetFullyResolved && quantity.trim() !== "";

  return (
    <form action={formAction} className="flex max-w-xl flex-col gap-4">
      <input type="hidden" name="productId" value={selected?.id ?? ""} />
      <input type="hidden" name="variantId" value={usesPhoneVariant ? phoneVariant.resolved?.id ?? "" : ""} />
      <input type="hidden" name="deviceColorVariantId" value={usesDeviceColor ? deviceCombo.resolved?.id ?? "" : ""} />
      <input type="hidden" name="movementType" value={MANUAL_STOCK_MOVEMENT_TYPES.ADJUSTMENT} />

      <div>
        <p className="mb-1.5 text-sm font-medium text-neutral-bg/80">الصنف</p>
        {!selected ? (
          <>
            <ProductQuickPicker products={products} excludeIds={new Set()} onPick={handleSelectProduct} placeholder="ابحث عن منتج..." />
            <p className="mt-1.5 text-xs text-neutral-bg/40">لم يتم اختيار صنف</p>
          </>
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
          هذا المنتج ينتظر اعتماد توزيع مخزون الـVariants من صفحة الـVariants الخاصة به قبل إمكانية تعديل مخزونه من هنا.
        </p>
      )}

      {selected && !variantNotReady && (
        <div className="rounded-card border border-navy-soft bg-navy-deep px-3 py-2 text-sm text-neutral-bg/80">
          المخزون الحالي في المستودع الرئيسي:{" "}
          <span className="font-semibold text-neutral-bg">{currentStock === null ? "—" : currentStock}</span>
        </div>
      )}

      <div>
        <Input
          name="quantity"
          type="number"
          min={0}
          step={1}
          label="الرصيد النهائي"
          required
          disabled={!targetFullyResolved}
          value={quantity}
          onChange={(event) => setQuantity(event.target.value)}
        />
        <p className="mt-1.5 text-xs text-neutral-bg/50">
          أدخل الرصيد النهائي المطلوب لهذا المخزون — سيُستبدل الرصيد الحالي بهذه القيمة تماماً، وليس إضافة عليه.
        </p>
      </div>

      <Textarea name="notes" label="ملاحظات / السبب (اختياري)" rows={3} />

      {state.error && (
        <p className="text-sm text-rose-600" role="alert">
          {state.error}
        </p>
      )}

      <Button type="submit" disabled={isPending || !canSubmit}>
        {isPending && <Spinner />}
        {isPending ? "جارٍ الحفظ..." : "حفظ التصحيح"}
      </Button>
    </form>
  );
}
