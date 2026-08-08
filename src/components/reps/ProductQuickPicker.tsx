"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { ProductImagePlaceholder } from "@/components/catalog/ProductImagePlaceholder";
import { cn } from "@/lib/utils";

export interface PickableColorOption {
  id: string;
  name: string;
  nameAr: string | null;
  hexCode: string | null;
}

export interface PickableProduct {
  id: string;
  sku: string;
  name: string;
  nameAr: string | null;
  categoryLabel?: string | null;
  brandLabel?: string | null;
  thumbnailUrl: string | null;
  thumbnailAlt: string | null;
  /** Empty/omitted for a colorless product. */
  colorOptions?: PickableColorOption[];
  variantOptions?: { id: string; label: string; stock?: number }[];
}

/** Small inline thumbnail shared by every rep product list (search results,
 * selected-line lists, the detail popup) — falls back to
 * ProductImagePlaceholder like every other catalog thumbnail in the app. */
export function ProductThumb({
  product,
  className,
}: {
  product: Pick<PickableProduct, "thumbnailUrl" | "thumbnailAlt" | "name">;
  className?: string;
}) {
  return (
    <span className={`block shrink-0 overflow-hidden rounded-card bg-navy-deep ${className ?? ""}`}>
      {product.thumbnailUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- arbitrary admin-entered external URLs
        <img
          src={product.thumbnailUrl}
          alt={product.thumbnailAlt ?? product.name}
          className="h-full w-full object-cover"
          loading="lazy"
        />
      ) : (
        <ProductImagePlaceholder className="h-full w-full" />
      )}
    </span>
  );
}

function EyeIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="h-4 w-4"
    >
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="h-4 w-4"
    >
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

export interface ProductQuickPickerProps<T extends PickableProduct> {
  products: T[];
  /** Ids to hide from results — already-added lines. For a colored product
   * this should be the productId alone (all its colors are still offered
   * as separate picks) unless every one of its colors is already a line. */
  excludeIds: Set<string>;
  /** colorId is null for a colorless product/pick. */
  onPick: (product: T, colorId: string | null, variantId: string | null) => void;
  placeholder?: string;
}

/** Shared search + detail picker used by both the rep stock-request form
 * and the rep direct-sale form: type to filter, click a row to add it (or,
 * for a product with variant/color options, to open a choice step first), or
 * open the eye icon for a larger image + category/brand before deciding.
 * Generic over T so each caller's extra fields (retailPriceCents, repStock,
 * ...) survive the round-trip to onPick untouched.
 *
 * When a product has both variantOptions and colorOptions, the two are
 * independent picks (variant determines stock, color is purely
 * descriptive) — the modal asks for the variant first, then the color,
 * before calling onPick with both. A caller that never populates
 * colorOptions (a pure stock-movement picker with no customer/order
 * context) naturally collapses back to a single variant-only step. */
export function ProductQuickPicker<T extends PickableProduct>({
  products,
  excludeIds,
  onPick,
  placeholder,
}: ProductQuickPickerProps<T>) {
  const [search, setSearch] = useState("");
  const [detailProduct, setDetailProduct] = useState<T | null>(null);
  const [pendingVariantId, setPendingVariantId] = useState<string | null>(null);

  const filteredProducts = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return [];
    // No cap — every match is shown (the results box scrolls), so a query
    // like "كفر" surfaces all matching products, not just the first N.
    return products
      .filter((product) => !excludeIds.has(product.id))
      .filter(
        (product) =>
          product.sku.toLowerCase().includes(query) ||
          product.name.toLowerCase().includes(query) ||
          (product.nameAr ?? "").toLowerCase().includes(query),
      );
  }, [search, products, excludeIds]);

  function openDetail(product: T) {
    setDetailProduct(product);
    setPendingVariantId(null);
  }

  function handlePick(product: T, colorId: string | null, variantId: string | null = null) {
    onPick(product, colorId, variantId);
    setSearch("");
    setDetailProduct(null);
    setPendingVariantId(null);
  }

  function handleRowClick(product: T) {
    if ((product.variantOptions?.length ?? 0) > 0 || (product.colorOptions?.length ?? 0) > 0) {
      openDetail(product);
    } else {
      handlePick(product, null);
    }
  }

  function handlePickVariant(product: T, variantId: string) {
    if ((product.colorOptions?.length ?? 0) > 0) {
      setPendingVariantId(variantId);
    } else {
      handlePick(product, null, variantId);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <Input
        placeholder={placeholder ?? "ابحث بالاسم أو رمز المنتج (SKU)..."}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />

      {filteredProducts.length > 0 && (
        <div className="max-h-96 overflow-y-auto rounded-card border border-navy-soft">
          <div className="flex flex-col divide-y divide-navy-soft">
            {filteredProducts.map((product) => (
              <div key={product.id} className="flex items-center gap-3 px-3 py-2 hover:bg-navy-deep">
                <button
                  type="button"
                  onClick={() => handleRowClick(product)}
                  className="flex min-w-0 flex-1 items-center gap-3 text-start"
                >
                  <ProductThumb product={product} className="h-10 w-10" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-neutral-bg">{product.nameAr ?? product.name}</span>
                    <span className="block text-xs text-neutral-bg/50">{product.sku}</span>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => openDetail(product)}
                  aria-label={`عرض سريع لـ ${product.nameAr ?? product.name}`}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-neutral-bg/50 transition-colors hover:bg-navy-soft/60 hover:text-gold-champagne"
                >
                  <EyeIcon />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {detailProduct && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setDetailProduct(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            className="relative w-full max-w-sm rounded-card border border-navy-soft bg-navy-surface p-5 shadow-card"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => { setDetailProduct(null); setPendingVariantId(null); }}
              aria-label="إغلاق"
              className="absolute start-3 top-3 flex h-7 w-7 items-center justify-center rounded-full text-neutral-bg/60 transition-colors hover:bg-navy-deep hover:text-neutral-bg"
            >
              <CloseIcon />
            </button>

            <ProductThumb product={detailProduct} className="mx-auto h-40 w-40" />

            <div className="mt-4 text-center">
              <p className="text-base font-semibold text-neutral-bg">
                {detailProduct.nameAr ?? detailProduct.name}
              </p>
              <p className="mt-1 text-xs text-neutral-bg/50">{detailProduct.sku}</p>
              {(detailProduct.categoryLabel || detailProduct.brandLabel) && (
                <div className="mt-3 flex flex-wrap justify-center gap-2">
                  {detailProduct.categoryLabel && <Badge variant="neutral">{detailProduct.categoryLabel}</Badge>}
                  {detailProduct.brandLabel && <Badge variant="neutral">{detailProduct.brandLabel}</Badge>}
                </div>
              )}
            </div>

            {detailProduct.variantOptions && detailProduct.variantOptions.length > 0 && pendingVariantId === null ? (
              <div className="mt-5 flex flex-col gap-2">
                <p className="text-center text-xs text-neutral-bg/50">اختر ماركة / موديل الهاتف</p>
                {detailProduct.variantOptions.map((variant) => {
                  const outOfStock = variant.stock !== undefined && variant.stock <= 0;
                  return <button key={variant.id} type="button" disabled={outOfStock} onClick={() => handlePickVariant(detailProduct, variant.id)} className={cn("rounded-card border border-navy-soft px-3 py-2 text-sm text-neutral-bg/80 hover:border-gold-champagne/40", outOfStock && "cursor-not-allowed opacity-40")}>{variant.label}{outOfStock && " (نفد)"}</button>;
                })}
              </div>
            ) : detailProduct.colorOptions && detailProduct.colorOptions.length > 0 ? (
              <div className="mt-5 flex flex-col gap-2">
                <p className="text-center text-xs text-neutral-bg/50">اختر اللون</p>
                <div className="flex flex-wrap justify-center gap-2">
                  {detailProduct.colorOptions.map((color) => (
                    <button
                      key={color.id}
                      type="button"
                      onClick={() => handlePick(detailProduct, color.id, pendingVariantId)}
                      className="flex items-center gap-2 rounded-full border border-navy-soft px-3 py-1.5 text-sm text-neutral-bg/80 transition-colors hover:border-gold-champagne/40"
                    >
                      {color.hexCode && (
                        <span
                          aria-hidden="true"
                          className="h-4 w-4 shrink-0 rounded-full border border-navy-soft"
                          style={{ backgroundColor: color.hexCode }}
                        />
                      )}
                      {color.nameAr ?? color.name}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <Button type="button" className="mt-5 w-full" onClick={() => handlePick(detailProduct, null, pendingVariantId)}>
                إضافة
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
