"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { ProductImagePlaceholder } from "@/components/catalog/ProductImagePlaceholder";

export interface PickableProduct {
  id: string;
  sku: string;
  name: string;
  nameAr: string | null;
  categoryLabel?: string | null;
  brandLabel?: string | null;
  thumbnailUrl: string | null;
  thumbnailAlt: string | null;
}

/** Small inline thumbnail shared by every rep product list (search results,
 * selected-line lists, the quick-look popup) — falls back to
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
  /** Ids to hide from results — already-added lines. */
  excludeIds: Set<string>;
  onPick: (product: T) => void;
  placeholder?: string;
}

/** Shared search + quick-look picker used by both the rep stock-request
 * form and the rep direct-sale form: type to filter, click a row to add it,
 * or open the eye icon for a larger image + category/brand before deciding.
 * Generic over T so each caller's extra fields (retailPriceCents, repStock,
 * ...) survive the round-trip to onPick untouched. */
export function ProductQuickPicker<T extends PickableProduct>({
  products,
  excludeIds,
  onPick,
  placeholder,
}: ProductQuickPickerProps<T>) {
  const [search, setSearch] = useState("");
  const [quickLookProduct, setQuickLookProduct] = useState<T | null>(null);

  const filteredProducts = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return [];
    return products
      .filter((product) => !excludeIds.has(product.id))
      .filter(
        (product) =>
          product.sku.toLowerCase().includes(query) ||
          product.name.toLowerCase().includes(query) ||
          (product.nameAr ?? "").toLowerCase().includes(query),
      )
      .slice(0, 20);
  }, [search, products, excludeIds]);

  function handlePick(product: T) {
    onPick(product);
    setSearch("");
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
                  onClick={() => handlePick(product)}
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
                  onClick={() => setQuickLookProduct(product)}
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

      {quickLookProduct && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setQuickLookProduct(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            className="relative w-full max-w-sm rounded-card border border-navy-soft bg-navy-surface p-5 shadow-card"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setQuickLookProduct(null)}
              aria-label="إغلاق"
              className="absolute start-3 top-3 flex h-7 w-7 items-center justify-center rounded-full text-neutral-bg/60 transition-colors hover:bg-navy-deep hover:text-neutral-bg"
            >
              <CloseIcon />
            </button>

            <ProductThumb product={quickLookProduct} className="mx-auto h-40 w-40" />

            <div className="mt-4 text-center">
              <p className="text-base font-semibold text-neutral-bg">
                {quickLookProduct.nameAr ?? quickLookProduct.name}
              </p>
              <p className="mt-1 text-xs text-neutral-bg/50">{quickLookProduct.sku}</p>
              {(quickLookProduct.categoryLabel || quickLookProduct.brandLabel) && (
                <div className="mt-3 flex flex-wrap justify-center gap-2">
                  {quickLookProduct.categoryLabel && <Badge variant="neutral">{quickLookProduct.categoryLabel}</Badge>}
                  {quickLookProduct.brandLabel && <Badge variant="neutral">{quickLookProduct.brandLabel}</Badge>}
                </div>
              )}
            </div>

            <Button
              type="button"
              className="mt-5 w-full"
              onClick={() => {
                handlePick(quickLookProduct);
                setQuickLookProduct(null);
              }}
            >
              إضافة
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
