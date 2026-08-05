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
  /** Whole-product stock, used only when there are no color options. */
  totalStock: number;
  /** Empty for a colorless product. */
  colorOptions: ColorSwatchOption[];
  variantMode: string;
  variantAllocationStatus: string;
  variants: {
    id: string;
    variantCode: string | null;
    stock: number;
    brand: { id: string; name: string; nameAr: string | null };
    model: { id: string; name: string; nameAr: string | null };
    color: { id: string; name: string; nameAr: string | null; hexCode: string | null } | null;
  }[];
  cartEligibility: CartEligibility;
  imageUrl?: string | null;
}

function pickDefaultColorId(colors: ColorSwatchOption[]): string | null {
  if (colors.length === 0) return null;
  return (colors.find((color) => color.stock > 0) ?? colors[0])?.id ?? null;
}

/** Purchase card — title/meta/price/stock/color/cart action. Every prop the
 * page already computes from the existing price-mode select and
 * readCatalogPriceCents/isWholesalePriced helpers; the only local state is
 * which color is currently selected, which drives the displayed stock and
 * the AddToCartButton's colorId. */
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
  cartEligibility,
  imageUrl,
}: ProductPurchasePanelProps) {
  const [selectedColorId, setSelectedColorId] = useState<string | null>(() => pickDefaultColorId(colorOptions));
  const [selectedBrandId, setSelectedBrandId] = useState<string | null>(null);
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);

  const hasColors = colorOptions.length > 0;
  const selectedColor = useMemo(
    () => colorOptions.find((color) => color.id === selectedColorId) ?? null,
    [colorOptions, selectedColorId],
  );
  const usesVariants = variantMode === "PHONE_COMPATIBILITY";
  const variantReady = variantAllocationStatus === "READY";
  const brands = useMemo(() => Array.from(new Map(variants.map((variant) => [variant.brand.id, variant.brand])).values()), [variants]);
  const models = useMemo(() => Array.from(new Map(variants.filter((variant) => variant.brand.id === selectedBrandId).map((variant) => [variant.model.id, variant.model])).values()), [variants, selectedBrandId]);
  const modelVariants = useMemo(() => variants.filter((variant) => variant.model.id === selectedModelId), [variants, selectedModelId]);
  const selectedVariant = useMemo(() => modelVariants.find((variant) => variant.color?.id === selectedColorId || (!variant.color && !selectedColorId)) ?? null, [modelVariants, selectedColorId]);
  const effectiveStock = usesVariants ? (selectedVariant?.stock ?? 0) : hasColors ? (selectedColor?.stock ?? 0) : totalStock;

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
          <div><p className="mb-2 text-sm text-neutral-bg/70">ماركة الهاتف</p><div className="flex flex-wrap gap-2">{brands.map((brand) => <button key={brand.id} type="button" onClick={() => { setSelectedBrandId(brand.id); setSelectedModelId(null); setSelectedColorId(null); }} className={`rounded-card border px-3 py-2 text-sm ${selectedBrandId === brand.id ? "border-gold-champagne text-gold-champagne" : "border-navy-soft text-neutral-bg/70"}`}>{brand.nameAr ?? brand.name}</button>)}</div></div>
          {selectedBrandId && <div><p className="mb-2 text-sm text-neutral-bg/70">موديل الهاتف</p><div className="flex flex-wrap gap-2">{models.map((model) => <button key={model.id} type="button" onClick={() => { setSelectedModelId(model.id); setSelectedColorId(null); }} className={`rounded-card border px-3 py-2 text-sm ${selectedModelId === model.id ? "border-gold-champagne text-gold-champagne" : "border-navy-soft text-neutral-bg/70"}`}>{model.nameAr ?? model.name}</button>)}</div></div>}
          {selectedModelId && modelVariants.some((variant) => variant.color) && <div><p className="mb-2 text-sm text-neutral-bg/70">اللون</p><div className="flex flex-wrap gap-2">{modelVariants.filter((variant) => variant.color).map((variant) => <button key={variant.id} type="button" disabled={variant.stock <= 0} onClick={() => setSelectedColorId(variant.color!.id)} className={`rounded-card border px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-40 ${selectedColorId === variant.color!.id ? "border-gold-champagne text-gold-champagne" : "border-navy-soft text-neutral-bg/70"}`}><span className="inline-flex items-center gap-2">{variant.color!.hexCode && <span className="h-3 w-3 rounded-full border border-white/20" style={{ backgroundColor: variant.color!.hexCode }} />}{variant.color!.nameAr ?? variant.color!.name}{variant.stock <= 0 && " — نفد"}</span></button>)}</div></div>}
        </div>
      )}

      {!usesVariants && hasColors && (
        <ColorSwatchSelector colors={colorOptions} selectedColorId={selectedColorId} onSelect={setSelectedColorId} />
      )}

      <Badge variant={effectiveStock > 0 ? "success" : "danger"} className="self-start">
        {effectiveStock > 0 ? "متوفر" : "غير متوفر حالياً"}
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
        {cartEligibility === "eligible" && effectiveStock > 0 && (!usesVariants || variantReady) && (!usesVariants || selectedVariant) && (usesVariants || !hasColors || selectedColorId) && (
          <AddToCartButton
            productId={productId}
            colorId={usesVariants ? null : selectedColorId}
            variantId={selectedVariant?.id ?? null}
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
