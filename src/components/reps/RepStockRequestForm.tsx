"use client";

import { useActionState, useMemo, useState } from "react";
import { createStockRequest, type RepStockRequestState } from "@/app/rep/requests/new/actions";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Spinner } from "@/components/ui/Spinner";
import { ProductImagePlaceholder } from "@/components/catalog/ProductImagePlaceholder";

export interface RepStockRequestProductOption {
  id: string;
  sku: string;
  name: string;
  nameAr: string | null;
  categoryLabel: string | null;
  brandLabel: string | null;
  thumbnailUrl: string | null;
  thumbnailAlt: string | null;
}

/** Small inline thumbnail shared by the search results and the request-line
 * list — falls back to ProductImagePlaceholder like every other catalog
 * thumbnail in the app. */
function ProductThumb({
  product,
  className,
}: {
  product: Pick<RepStockRequestProductOption, "thumbnailUrl" | "thumbnailAlt" | "name">;
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

interface RequestLine {
  productId: string;
  sku: string;
  label: string;
  quantity: number;
  thumbnailUrl: string | null;
  thumbnailAlt: string | null;
}

const initialState: RepStockRequestState = {};

/** Rep-facing restock request form — deliberately never fetches or shows
 * any price/cost field. Lines are held in client state and serialized to a
 * hidden JSON input on submit, mirroring the Phase 25 manual-order-form
 * pattern, since native FormData can't carry a dynamic array of objects. */
export function RepStockRequestForm({ products }: { products: RepStockRequestProductOption[] }) {
  const [state, formAction, isPending] = useActionState(createStockRequest, initialState);
  const [search, setSearch] = useState("");
  const [lines, setLines] = useState<RequestLine[]>([]);
  const [repNote, setRepNote] = useState("");
  const [quickLookProduct, setQuickLookProduct] = useState<RepStockRequestProductOption | null>(null);

  const filteredProducts = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return [];
    return products
      .filter((product) => !lines.some((line) => line.productId === product.id))
      .filter(
        (product) =>
          product.sku.toLowerCase().includes(query) ||
          product.name.toLowerCase().includes(query) ||
          (product.nameAr ?? "").toLowerCase().includes(query),
      )
      .slice(0, 20);
  }, [search, products, lines]);

  function handleAdd(product: RepStockRequestProductOption) {
    setLines((prev) => [
      ...prev,
      {
        productId: product.id,
        sku: product.sku,
        label: product.nameAr ?? product.name,
        quantity: 1,
        thumbnailUrl: product.thumbnailUrl,
        thumbnailAlt: product.thumbnailAlt,
      },
    ]);
    setSearch("");
  }

  function handleRemove(productId: string) {
    setLines((prev) => prev.filter((line) => line.productId !== productId));
  }

  function handleQuantityChange(productId: string, value: string) {
    const quantity = Math.max(1, Math.floor(Number(value) || 1));
    setLines((prev) => prev.map((line) => (line.productId === productId ? { ...line, quantity } : line)));
  }

  const itemsJson = useMemo(
    () =>
      JSON.stringify(lines.map((line) => ({ productId: line.productId, requestedQuantity: line.quantity }))),
    [lines],
  );

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <input type="hidden" name="items" value={itemsJson} />

      <Card>
        <CardHeader>
          <CardTitle>إضافة منتجات للطلب</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Input
            placeholder="ابحث بالاسم أو رمز المنتج (SKU)..."
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
                      onClick={() => handleAdd(product)}
                      className="flex min-w-0 flex-1 items-center gap-3 text-start"
                    >
                      <ProductThumb product={product} className="h-10 w-10" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-neutral-bg">
                          {product.nameAr ?? product.name}
                        </span>
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
        </CardContent>
      </Card>

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
                handleAdd(quickLookProduct);
                setQuickLookProduct(null);
              }}
            >
              إضافة للطلب
            </Button>
          </div>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>عناصر الطلب</CardTitle>
        </CardHeader>
        <CardContent>
          {lines.length === 0 ? (
            <p className="py-6 text-center text-sm text-neutral-bg/50">لم تتم إضافة منتجات بعد</p>
          ) : (
            <div className="flex flex-col divide-y divide-navy-soft">
              {lines.map((line) => (
                <div key={line.productId} className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
                  <ProductThumb product={{ ...line, name: line.label }} className="h-10 w-10" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-neutral-bg">{line.label}</p>
                    <p className="text-xs text-neutral-bg/50">{line.sku}</p>
                  </div>
                  <div className="w-20">
                    <Input
                      type="number"
                      min={1}
                      value={line.quantity}
                      onChange={(event) => handleQuantityChange(line.productId, event.target.value)}
                      aria-label="الكمية المطلوبة"
                    />
                  </div>
                  <Button type="button" variant="ghost" size="sm" onClick={() => handleRemove(line.productId)}>
                    حذف
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>ملاحظة (اختياري)</CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea name="repNote" value={repNote} onChange={(event) => setRepNote(event.target.value)} rows={3} />
        </CardContent>
      </Card>

      {state.error && (
        <p className="text-sm text-rose-600" role="alert">
          {state.error}
        </p>
      )}

      <Button type="submit" disabled={isPending || lines.length === 0} className="w-full sm:w-auto">
        {isPending && <Spinner />}
        {isPending ? "جارٍ الإرسال..." : "إرسال الطلب"}
      </Button>
    </form>
  );
}
