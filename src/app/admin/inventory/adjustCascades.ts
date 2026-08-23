import { useMemo, useState } from "react";
import type { PickableProduct } from "@/components/reps/ProductQuickPicker";

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
 * for an admin stock-movement screen). Both AdjustStockForm (IN/Correction)
 * and BulkStockOutForm (OUT) use their own cascading selects below instead,
 * fed by variantChoices/deviceComboChoices, with every option always
 * selectable regardless of quantity or isActive. */
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

/** الماركة → الموديل → اللون cascade for a DEVICE_MODEL_COLOR product.
 * Nothing defaults to "first option" — every step starts empty so the admin
 * must actively pick the exact combination a movement will apply to. Shared
 * by AdjustStockForm (single-item IN/Correction) and BulkStockOutForm
 * (multi-item OUT). */
export function useDeviceComboCascade(product: AdjustStockProductOption | null) {
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
 * step, since a ProductVariant's identity is product + phone model only.
 * Shared by AdjustStockForm and BulkStockOutForm. */
export function usePhoneVariantCascade(product: AdjustStockProductOption | null) {
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
