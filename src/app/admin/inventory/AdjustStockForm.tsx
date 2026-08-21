"use client";

import { useActionState, useMemo, useState } from "react";
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
import { ProductThumb, ProductQuickPicker, type PickableProduct } from "@/components/reps/ProductQuickPicker";

export interface AdjustVariantOption {
  id: string;
  isActive: boolean;
  phoneBrandId: string;
  brandLabel: string;
  phoneModelId: string;
  modelLabel: string;
  stock: number;
}

export interface AdjustDeviceComboOption {
  id: string;
  isActive: boolean;
  phoneBrandId: string;
  brandLabel: string;
  phoneModelId: string;
  modelLabel: string;
  colorId: string;
  colorLabel: string;
  colorHex: string | null;
  stock: number;
}

/** Deliberately never populates PickableProduct's own variantOptions/
 * deviceColorVariantOptions/colorOptions — those would make ProductQuickPicker
 * open its built-in choice modal (which disables zero-stock options, wrong
 * for an admin restocking screen — see Part 11). This form uses its own
 * cascading selects below instead, fed by variantChoices/deviceComboChoices,
 * with every option always selectable regardless of quantity or isActive. */
export interface AdjustStockProductOption extends PickableProduct {
  isActive: boolean;
  /** Plain (non-variant, non-combo) warehouse stock — meaningful only for a
   * TOTAL_STOCK product. */
  stock: number;
  variantMode: string;
  inventoryTrackingMode: string;
  variantAllocationStatus: string;
  variantChoices: AdjustVariantOption[];
  deviceComboChoices: AdjustDeviceComboOption[];
}

interface AdjustStockFormProps {
  products: AdjustStockProductOption[];
  selectedProductId?: string;
}

const initialState: StockAdjustmentState = {};

/** الماركة → الموديل → اللون cascade for a DEVICE_MODEL_COLOR product.
 * Nothing defaults to "first option" — every step starts empty so the admin
 * must actively pick the exact combination a movement will apply to. */
function useDeviceComboCascade(product: AdjustStockProductOption | null) {
  const [brandId, setBrandId] = useState("");
  const [modelId, setModelId] = useState("");
  const [colorId, setColorId] = useState("");

  const combos = useMemo(() => product?.deviceComboChoices ?? [], [product]);

  const brands = useMemo(() => {
    const seen = new Map<string, string>();
    for (const combo of combos) if (!seen.has(combo.phoneBrandId)) seen.set(combo.phoneBrandId, combo.brandLabel);
    return [...seen.entries()].map(([id, label]) => ({ id, label }));
  }, [combos]);

  const models = useMemo(() => {
    const seen = new Map<string, string>();
    for (const combo of combos) {
      if (combo.phoneBrandId === brandId && !seen.has(combo.phoneModelId)) seen.set(combo.phoneModelId, combo.modelLabel);
    }
    return [...seen.entries()].map(([id, label]) => ({ id, label }));
  }, [combos, brandId]);

  const colors = useMemo(() => combos.filter((combo) => combo.phoneModelId === modelId), [combos, modelId]);
  const resolved = useMemo(() => colors.find((combo) => combo.colorId === colorId) ?? null, [colors, colorId]);

  function reset() {
    setBrandId("");
    setModelId("");
    setColorId("");
  }

  function pickBrand(id: string) {
    setBrandId(id);
    setModelId("");
    setColorId("");
  }

  function pickModel(id: string) {
    setModelId(id);
    setColorId("");
  }

  return { brandId, modelId, colorId, brands, models, colors, resolved, reset, pickBrand, pickModel, setColorId };
}

/** الماركة → الموديل cascade for a PHONE_COMPATIBILITY product — no color
 * step, since a ProductVariant's identity is product + phone model only. */
function usePhoneVariantCascade(product: AdjustStockProductOption | null) {
  const [brandId, setBrandId] = useState("");
  const [modelId, setModelId] = useState("");

  const variants = useMemo(() => product?.variantChoices ?? [], [product]);

  const brands = useMemo(() => {
    const seen = new Map<string, string>();
    for (const variant of variants) if (!seen.has(variant.phoneBrandId)) seen.set(variant.phoneBrandId, variant.brandLabel);
    return [...seen.entries()].map(([id, label]) => ({ id, label }));
  }, [variants]);

  const models = useMemo(() => variants.filter((variant) => variant.phoneBrandId === brandId), [variants, brandId]);
  const resolved = useMemo(() => models.find((variant) => variant.phoneModelId === modelId) ?? null, [models, modelId]);

  function reset() {
    setBrandId("");
    setModelId("");
  }

  function pickBrand(id: string) {
    setBrandId(id);
    setModelId("");
  }

  return { brandId, modelId, brands, models, resolved, reset, pickBrand, setModelId };
}

/** Unified stock-movement form for every inventory tracking mode: a plain
 * TOTAL_STOCK product needs only the product itself; PHONE_COMPATIBILITY
 * needs brand+model; DEVICE_MODEL_COLOR needs brand+model+color. Whichever
 * applies, the resolved variantId/deviceColorVariantId travels to
 * createStockMovement via a hidden input — the server re-validates it
 * belongs to the product and applies the same IN/OUT/ADJUSTMENT semantics
 * either way (see actions.ts). */
export function AdjustStockForm({ products, selectedProductId }: AdjustStockFormProps) {
  const [state, formAction, isPending] = useActionState(createStockMovement, initialState);
  const preselected = selectedProductId ? products.find((product) => product.id === selectedProductId) : undefined;
  const [selected, setSelected] = useState<AdjustStockProductOption | null>(preselected ?? null);
  const [movementType, setMovementType] = useState<string>(MANUAL_STOCK_MOVEMENT_TYPES.STOCK_IN);
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

  const parsedQuantity = Number(quantity);
  const quantityExceedsStock =
    movementType === MANUAL_STOCK_MOVEMENT_TYPES.STOCK_OUT &&
    currentStock !== null &&
    Number.isFinite(parsedQuantity) &&
    parsedQuantity > currentStock;

  const canSubmit = targetFullyResolved && quantity.trim() !== "" && !quantityExceedsStock;

  return (
    <form action={formAction} className="flex max-w-xl flex-col gap-4">
      <input type="hidden" name="productId" value={selected?.id ?? ""} />
      <input type="hidden" name="variantId" value={usesPhoneVariant ? phoneVariant.resolved?.id ?? "" : ""} />
      <input type="hidden" name="deviceColorVariantId" value={usesDeviceColor ? deviceCombo.resolved?.id ?? "" : ""} />

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

      <Select name="movementType" label="نوع الحركة" value={movementType} onChange={(event) => setMovementType(event.target.value)}>
        <option value={MANUAL_STOCK_MOVEMENT_TYPES.STOCK_IN}>إدخال مخزون</option>
        <option value={MANUAL_STOCK_MOVEMENT_TYPES.STOCK_OUT}>إخراج مخزون</option>
        <option value={MANUAL_STOCK_MOVEMENT_TYPES.ADJUSTMENT}>تعديل إلى رصيد نهائي</option>
      </Select>

      <div>
        <Input
          name="quantity"
          type="number"
          min={0}
          step={1}
          label="الكمية"
          required
          disabled={!targetFullyResolved}
          value={quantity}
          onChange={(event) => setQuantity(event.target.value)}
        />
        <p className="mt-1.5 text-xs text-neutral-bg/50">
          لإدخال أو إخراج مخزون: أدخل الكمية المراد إضافتها أو خصمها. لتعديل الرصيد: أدخل الرصيد النهائي المطلوب
          للمخزون.
        </p>
        {quantityExceedsStock && <p className="mt-1 text-xs text-rose-500">الكمية المطلوبة أكبر من المتوفر</p>}
      </div>

      <Textarea name="notes" label="ملاحظات / السبب (اختياري)" rows={3} />

      {state.error && (
        <p className="text-sm text-rose-600" role="alert">
          {state.error}
        </p>
      )}

      <Button type="submit" disabled={isPending || !canSubmit}>
        {isPending && <Spinner />}
        {isPending ? "جارٍ الحفظ..." : "حفظ الحركة"}
      </Button>
    </form>
  );
}
