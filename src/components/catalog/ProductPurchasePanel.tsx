"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { AddToCartButton } from "@/components/cart/AddToCartButton";
import { ColorSwatchSelector, type ColorSwatchOption } from "@/components/catalog/ColorSwatchSelector";
import { formatCurrencyFromCents } from "@/lib/utils";
import type { CartEligibility } from "@/lib/cart";

export interface ProductPurchasePanelProps {
  productId: string;
  title: string;
  sku: string;
  categoryName: string | null;
  brandName: string | null;
  priceCents: number;
  isWholesale: boolean;
  isFeatured: boolean;
  /** Whole-product stock, used only for a non-variant product — a
   * PHONE_COMPATIBILITY product's stock always comes from the selected
   * variant instead. Color never affects stock either way — see the
   * InventoryItem doc comment in prisma/schema.prisma. */
  totalStock: number;
  /** Empty for a product with no color options. Independent of variantMode:
   * a phone-variant product can also offer colors, purely descriptive.
   * Never shown for a DEVICE_MODEL_COLOR product — its color is already
   * part of the combination picker below. */
  colorOptions: ColorSwatchOption[];
  variantMode: string;
  variantAllocationStatus: string;
  variants: {
    id: string;
    variantCode: string | null;
    stock: number;
    brand: { id: string; name: string; nameAr: string | null };
    model: { id: string; name: string; nameAr: string | null };
  }[];
  /** TOTAL_STOCK | DEVICE_MODEL_COLOR. */
  inventoryTrackingMode: string;
  /** Active brand+model+color combinations, each with its own independent
   * stock — the picker's data source for a DEVICE_MODEL_COLOR product. */
  deviceColorVariants: {
    id: string;
    stock: number;
    brand: { id: string; name: string; nameAr: string | null };
    model: { id: string; name: string; nameAr: string | null };
    color: { id: string; name: string; nameAr: string | null; hexCode: string | null };
  }[];
  cartEligibility: CartEligibility;
  imageUrl?: string | null;
}

/** Purchase card — title/meta/price/stock/model/color/cart action. Every
 * prop the page already computes from the existing price-mode select and
 * readCatalogPriceCents/isWholesalePriced helpers. Phone model (drives
 * stock) and color (purely descriptive) are independent selections — a
 * product can offer either, both, or neither. */
export function ProductPurchasePanel({
  productId,
  title,
  sku,
  categoryName,
  brandName,
  priceCents,
  isWholesale,
  isFeatured,
  totalStock,
  colorOptions,
  variantMode,
  variantAllocationStatus,
  variants,
  inventoryTrackingMode,
  deviceColorVariants,
  cartEligibility,
  imageUrl,
}: ProductPurchasePanelProps) {
  const usesDeviceColor = inventoryTrackingMode === "DEVICE_MODEL_COLOR";
  const [selectedColorId, setSelectedColorId] = useState<string | null>(() => colorOptions[0]?.id ?? null);
  const [selectedBrandId, setSelectedBrandId] = useState<string | null>(null);
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [selectedDcBrandId, setSelectedDcBrandId] = useState<string | null>(null);
  const [selectedDcModelId, setSelectedDcModelId] = useState<string | null>(null);
  const [selectedDcColorId, setSelectedDcColorId] = useState<string | null>(null);

  const hasColors = colorOptions.length > 0 && !usesDeviceColor;
  const usesVariants = variantMode === "PHONE_COMPATIBILITY";
  const variantReady = variantAllocationStatus === "READY";
  const brands = useMemo(() => Array.from(new Map(variants.map((variant) => [variant.brand.id, variant.brand])).values()), [variants]);
  const models = useMemo(() => Array.from(new Map(variants.filter((variant) => variant.brand.id === selectedBrandId).map((variant) => [variant.model.id, variant.model])).values()), [variants, selectedBrandId]);
  // A variant's identity is product + phone model only, so at most one
  // variant matches the selected model.
  const selectedVariant = useMemo(() => variants.find((variant) => variant.model.id === selectedModelId) ?? null, [variants, selectedModelId]);

  const dcBrands = useMemo(() => Array.from(new Map(deviceColorVariants.map((combo) => [combo.brand.id, combo.brand])).values()), [deviceColorVariants]);
  const dcModels = useMemo(() => Array.from(new Map(deviceColorVariants.filter((combo) => combo.brand.id === selectedDcBrandId).map((combo) => [combo.model.id, combo.model])).values()), [deviceColorVariants, selectedDcBrandId]);
  const dcColorsForModel = useMemo(() => deviceColorVariants.filter((combo) => combo.model.id === selectedDcModelId), [deviceColorVariants, selectedDcModelId]);
  // A combination's identity is product + model + color, so at most one
  // combination matches the selected model + color pair.
  const selectedCombo = useMemo(() => dcColorsForModel.find((combo) => combo.color.id === selectedDcColorId) ?? null, [dcColorsForModel, selectedDcColorId]);

  const effectiveStock = usesVariants ? (selectedVariant?.stock ?? 0) : usesDeviceColor ? (selectedCombo?.stock ?? 0) : totalStock;

  return (
    <Card className="flex animate-fade-in flex-col gap-4 transition-shadow hover:shadow-lg">
      {isFeatured && <Badge variant="gold">مميز</Badge>}

      <div>
        <h1 className="text-2xl font-bold text-neutral-bg">{title}</h1>
        <p className="mt-1 text-xs text-neutral-bg/40">SKU: {sku}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm text-neutral-bg/60">
        {brandName && <span>{brandName}</span>}
        {categoryName && <Badge variant="neutral">{categoryName}</Badge>}
      </div>

      <div className="flex items-center gap-3 border-t border-navy-soft pt-4">
        <p className="text-3xl font-semibold text-gold-champagne">{formatCurrencyFromCents(priceCents)}</p>
        {isWholesale && <Badge variant="gold">سعر الجملة</Badge>}
      </div>

      {usesVariants && (
        <div className="space-y-4">
          {!variantReady && <p className="rounded-card border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-300">هذا المنتج قيد مراجعة وتوزيع المخزون على الموديلات.</p>}
          <div><p className="mb-2 text-sm text-neutral-bg/70">ماركة الهاتف</p><div className="flex flex-wrap gap-2">{brands.map((brand) => <button key={brand.id} type="button" onClick={() => { setSelectedBrandId(brand.id); setSelectedModelId(null); }} className={`rounded-card border px-3 py-2 text-sm ${selectedBrandId === brand.id ? "border-gold-champagne text-gold-champagne" : "border-navy-soft text-neutral-bg/70"}`}>{brand.nameAr ?? brand.name}</button>)}</div></div>
          {selectedBrandId && <div><p className="mb-2 text-sm text-neutral-bg/70">موديل الهاتف</p><div className="flex flex-wrap gap-2">{models.map((model) => <button key={model.id} type="button" onClick={() => setSelectedModelId(model.id)} className={`rounded-card border px-3 py-2 text-sm ${selectedModelId === model.id ? "border-gold-champagne text-gold-champagne" : "border-navy-soft text-neutral-bg/70"}`}>{model.nameAr ?? model.name}</button>)}</div></div>}
        </div>
      )}

      {usesDeviceColor && (
        <div className="space-y-4">
          <div>
            <p className="mb-2 text-sm text-neutral-bg/70">الماركة</p>
            <div className="flex flex-wrap gap-2">
              {dcBrands.map((brand) => (
                <button
                  key={brand.id}
                  type="button"
                  onClick={() => { setSelectedDcBrandId(brand.id); setSelectedDcModelId(null); setSelectedDcColorId(null); }}
                  className={`rounded-card border px-3 py-2 text-sm ${selectedDcBrandId === brand.id ? "border-gold-champagne text-gold-champagne" : "border-navy-soft text-neutral-bg/70"}`}
                >
                  {brand.nameAr ?? brand.name}
                </button>
              ))}
            </div>
          </div>
          {selectedDcBrandId && (
            <div>
              <p className="mb-2 text-sm text-neutral-bg/70">الموديل</p>
              <div className="flex flex-wrap gap-2">
                {dcModels.map((model) => (
                  <button
                    key={model.id}
                    type="button"
                    onClick={() => { setSelectedDcModelId(model.id); setSelectedDcColorId(null); }}
                    className={`rounded-card border px-3 py-2 text-sm ${selectedDcModelId === model.id ? "border-gold-champagne text-gold-champagne" : "border-navy-soft text-neutral-bg/70"}`}
                  >
                    {model.nameAr ?? model.name}
                  </button>
                ))}
              </div>
            </div>
          )}
          {selectedDcModelId && (
            dcColorsForModel.length > 0 ? (
              <ColorSwatchSelector
                colors={dcColorsForModel.map((combo) => combo.color)}
                selectedColorId={selectedDcColorId}
                onSelect={setSelectedDcColorId}
              />
            ) : (
              <p className="text-sm text-neutral-bg/50">لا تتوفر ألوان لهذا الموديل حالياً.</p>
            )
          )}
        </div>
      )}

      {hasColors && (
        <ColorSwatchSelector colors={colorOptions} selectedColorId={selectedColorId} onSelect={setSelectedColorId} />
      )}

      <Badge variant={effectiveStock > 0 ? "success" : "danger"} className="self-start">
        {effectiveStock > 0 ? "متوفر" : usesDeviceColor && !selectedCombo ? "اختر التركيبة لعرض التوفر" : "غير متوفر حالياً"}
      </Badge>

      <div className="mt-2">
        {cartEligibility === "guest" && (
          <Link
            href="/login"
            className="inline-block rounded-card border border-gold-champagne/40 px-4 py-2 text-sm text-gold-dark transition-colors hover:bg-gold-champagne/10"
          >
            سجّل الدخول للشراء
          </Link>
        )}
        {cartEligibility === "eligible" &&
          effectiveStock > 0 &&
          (!usesVariants || variantReady) &&
          (!usesVariants || selectedVariant) &&
          (!usesDeviceColor || selectedCombo) &&
          (!hasColors || selectedColorId) && (
          <AddToCartButton
            productId={productId}
            colorId={hasColors ? selectedColorId : null}
            variantId={selectedVariant?.id ?? null}
            deviceColorVariantId={selectedCombo?.id ?? null}
            maxQuantity={effectiveStock}
            showQuantityInput
            productName={title}
            productSku={sku}
            productImageUrl={imageUrl}
            unitPriceCents={priceCents}
          />
        )}
      </div>
    </Card>
  );
}
