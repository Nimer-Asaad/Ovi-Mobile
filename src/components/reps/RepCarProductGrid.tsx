"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { ProductImagePlaceholder } from "@/components/catalog/ProductImagePlaceholder";
import { LOW_STOCK_THRESHOLD } from "@/lib/constants";

export interface RepCarProductGridItem {
  productId: string;
  /** Null for a non-variant product — one line per productId+variantId. */
  variantId: string | null;
  variantLabel: string | null;
  /** Null unless the product uses DEVICE_MODEL_COLOR tracking — one line per
   * productId+deviceColorVariantId in that case, mutually exclusive with
   * variantId (see the CHECK constraint on inventory_items). */
  deviceColorVariantId: string | null;
  deviceColorVariantLabel: string | null;
  sku: string;
  name: string;
  nameAr: string | null;
  quantity: number;
  categoryLabel: string | null;
  brandLabel: string | null;
  thumbnailUrl: string | null;
  thumbnailAlt: string | null;
}

export interface RepCarProductGridProps {
  items: RepCarProductGridItem[];
  title?: string;
  emptyMessage?: string;
}

interface GroupedProduct {
  productId: string;
  sku: string;
  name: string;
  nameAr: string | null;
  thumbnailUrl: string | null;
  thumbnailAlt: string | null;
  totalQuantity: number;
  lines: RepCarProductGridItem[];
}

function groupByProduct(items: RepCarProductGridItem[]): GroupedProduct[] {
  const byProductId = new Map<string, GroupedProduct>();
  for (const item of items) {
    const existing = byProductId.get(item.productId) ?? {
      productId: item.productId,
      sku: item.sku,
      name: item.name,
      nameAr: item.nameAr,
      thumbnailUrl: item.thumbnailUrl,
      thumbnailAlt: item.thumbnailAlt,
      totalQuantity: 0,
      lines: [],
    };
    existing.totalQuantity += item.quantity;
    existing.lines.push(item);
    byProductId.set(item.productId, existing);
  }
  return [...byProductId.values()];
}

function lineLabel(line: RepCarProductGridItem): string | null {
  return line.variantLabel ?? line.deviceColorVariantLabel ?? null;
}

/** Visual "what's currently loaded in the car" grid — one card per product.
 * A product split across brand/model(/color) combinations shows its combined
 * total on the card and opens a breakdown popup on click, instead of
 * spreading the same product across several duplicate cards. Only ever
 * receives items with quantity > 0 (callers filter before passing in). */
export function RepCarProductGrid({
  items,
  title = "المنتجات في السيارة",
  emptyMessage = "لا يوجد مخزون في السيارة حالياً",
}: RepCarProductGridProps) {
  const [detailProduct, setDetailProduct] = useState<GroupedProduct | null>(null);
  const groups = useMemo(() => groupByProduct(items), [items]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {groups.length === 0 ? (
          <p className="py-6 text-center text-sm text-neutral-bg/50">{emptyMessage}</p>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {groups.map((group) => {
              const hasBreakdown = group.lines.length > 1 || lineLabel(group.lines[0]!) !== null;
              const lowStock = group.totalQuantity < LOW_STOCK_THRESHOLD;
              return (
                <button
                  key={group.productId}
                  type="button"
                  onClick={() => hasBreakdown && setDetailProduct(group)}
                  className={`flex flex-col overflow-hidden rounded-card border border-navy-soft bg-navy-deep text-start ${hasBreakdown ? "cursor-pointer transition-colors hover:border-gold-champagne/40" : "cursor-default"}`}
                >
                  <div className="relative aspect-square w-full overflow-hidden bg-navy-soft">
                    {group.thumbnailUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- arbitrary admin-entered external URLs
                      <img
                        src={group.thumbnailUrl}
                        alt={group.thumbnailAlt ?? group.name}
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <ProductImagePlaceholder className="h-full w-full" />
                    )}
                    <span className="absolute end-1.5 top-1.5 inline-flex min-w-6 items-center justify-center rounded-full bg-chrome px-1.5 py-0.5 text-xs font-semibold text-white shadow-card">
                      {group.totalQuantity}
                    </span>
                  </div>
                  <div className="flex flex-1 flex-col gap-1 p-2.5">
                    <p className="line-clamp-2 text-xs font-medium text-neutral-bg">
                      {group.nameAr ?? group.name}
                    </p>
                    <p className="text-[11px] text-neutral-bg/50">
                      {group.sku}
                      {hasBreakdown && <span> — {group.lines.length} {group.lines.length === 1 ? "خيار" : "خيارات"}</span>}
                    </p>
                    {lowStock && (
                      <Badge variant="warning" className="mt-auto self-start">
                        مخزون منخفض
                      </Badge>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </CardContent>

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
              onClick={() => setDetailProduct(null)}
              aria-label="إغلاق"
              className="absolute start-3 top-3 flex h-7 w-7 items-center justify-center rounded-full text-neutral-bg/60 transition-colors hover:bg-navy-deep hover:text-neutral-bg"
            >
              ✕
            </button>

            <div className="text-center">
              <p className="text-base font-semibold text-neutral-bg">
                {detailProduct.nameAr ?? detailProduct.name}
              </p>
              <p className="mt-1 text-xs text-neutral-bg/50">{detailProduct.sku}</p>
            </div>

            <div className="mt-4 flex flex-col divide-y divide-navy-soft">
              {detailProduct.lines.map((line) => {
                const label = lineLabel(line);
                const lowStockLine = line.quantity < LOW_STOCK_THRESHOLD;
                return (
                  <div
                    key={`${line.variantId ?? ""}:${line.deviceColorVariantId ?? ""}`}
                    className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
                  >
                    <span className="text-sm text-neutral-bg/80">{label ?? "بدون تصنيف"}</span>
                    <span className={`inline-flex min-w-8 items-center justify-center rounded-full px-2 py-0.5 text-xs font-semibold ${lowStockLine ? "bg-amber-500/20 text-amber-400" : "bg-chrome/20 text-neutral-bg"}`}>
                      {line.quantity}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
