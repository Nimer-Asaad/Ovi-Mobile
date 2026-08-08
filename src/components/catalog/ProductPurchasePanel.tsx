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
   * a phone-variant product can also offer colors, purely descriptive. */
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
  cartEligibility,
  imageUrl,
}: ProductPurchasePanelProps) {
  const [selectedColorId, setSelectedColorId] = useState<string | null>(() => colorOptions[0]?.id ?? null);
  const [selectedBrandId, setSelectedBrandId] = useState<string | null>(null);
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);

  const hasColors = colorOptions.length > 0;
  const usesVariants = variantMode === "PHONE_COMPATIBILITY";
  const variantReady = variantAllocationStatus === "READY";
  const brands = useMemo(() => Array.from(new Map(variants.map((variant) => [variant.brand.id, variant.brand])).values()), [variants]);
  const models = useMemo(() => Array.from(new Map(variants.filter((variant) => variant.brand.id === selectedBrandId).map((variant) => [variant.model.id, variant.model])).values()), [variants, selectedBrandId]);
  // A variant's identity is product + phone model only, so at most one
  // variant matches the selected model.
  const selectedVariant = useMemo(() => variants.find((variant) => variant.model.id === selectedModelId) ?? null, [variants, selectedModelId]);
  const effectiveStock = usesVariants ? (selectedVariant?.stock ?? 0) : totalStock;

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

      {hasColors && (
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
        {cartEligibility === "eligible" && effectiveStock > 0 && (!usesVariants || variantReady) && (!usesVariants || selectedVariant) && (!hasColors || selectedColorId) && (
          <AddToCartButton
            productId={productId}
            colorId={hasColors ? selectedColorId : null}
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
