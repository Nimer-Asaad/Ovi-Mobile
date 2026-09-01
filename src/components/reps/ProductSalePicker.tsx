"use client";

import { useMemo, useState } from "react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { ProductThumb, type PickableProduct } from "@/components/reps/ProductQuickPicker";
import { formatCurrencyFromCents } from "@/lib/utils";

export interface SaleProductOption extends PickableProduct {
  /** This rep's car balance for the product — always ONE plain aggregate
   * number now (see the InventoryItem doc comment in schema.prisma:
   * REP_CAR no longer tracks a per-phone-model breakdown, only the
   * WAREHOUSE side does). A rep sale is therefore always "Product +
   * quantity + price" — never a phone-model choice — regardless of whether
   * the product happens to use PHONE_COMPATIBILITY or DEVICE_MODEL_COLOR
   * for warehouse tracking. */
  repStock: number;
  retailPriceCents: number;
}

/** One product on the sale list AND the one price-entry unit — pricing is
 * grouped by productId (never by Category, never by phone model — a prior,
 * rejected version of this feature tried category grouping; this one and
 * the one before it both settled on productId as the only correct pricing
 * boundary: two products in the same category, e.g. "OVI 04" and
 * "OVI 63", must always be free to have different prices, and two phone
 * models of the SAME product must always share one price). */
export interface SaleProductGroup {
  key: string;
  product: SaleProductOption;
  label: string;
  stock: number;
}

/** Builds one group per rep-car product — pure client-side reshaping of
 * data the page already fetched in one query (see getRepCarSaleProducts),
 * never a second network round trip. Alphabetically sorted for a stable,
 * scannable list regardless of fetch order. */
export function buildSaleProductGroups(products: SaleProductOption[]): SaleProductGroup[] {
  return products
    .map((product) => ({
      key: product.id,
      product,
      label: product.nameAr ?? product.name,
      stock: product.repStock,
    }))
    .sort((a, b) => a.label.localeCompare(b.label, "ar"));
}

export interface SaleProductSummary {
  productKey: string;
  productLabel: string;
  pieceCount: number;
  unitPriceCents: number;
  subtotalCents: number;
  /** True when this product has a selected quantity but no valid (> 0)
   * price yet — the one client-side validation this feature adds: never let
   * a rep submit pieces they typed a quantity for but no price for. */
  priceMissing: boolean;
}

function parseProductPriceCents(value: string | undefined): number {
  const parsed = Math.round((Number(value) || 0) * 100);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/** Summaries for every product currently selected (quantity > 0) — used
 * both for the bottom order summary and for submit validation. Products
 * with nothing selected are omitted entirely. */
export function summarizeSaleProducts(groups: SaleProductGroup[], quantities: Record<string, number>, productPrices: Record<string, string>): SaleProductSummary[] {
  const summaries: SaleProductSummary[] = [];
  for (const group of groups) {
    const pieceCount = quantities[group.key] ?? 0;
    if (pieceCount === 0) continue;
    const unitPriceCents = parseProductPriceCents(productPrices[group.key]);
    summaries.push({
      productKey: group.key,
      productLabel: group.label,
      pieceCount,
      unitPriceCents,
      subtotalCents: pieceCount * unitPriceCents,
      priceMissing: unitPriceCents <= 0,
    });
  }
  return summaries;
}

export interface SaleSubmitLine {
  productId: string;
  colorId: string | null;
  variantId: string | null;
  deviceColorVariantId: string | null;
  quantity: number;
  unitPriceCents: number;
}

/** The exact per-line payload createRepSale/createRepSaleForRep already
 * expect (see repSaleSchema) — one line per selected product, carrying its
 * OWN productId and the product's single typed price. variantId/
 * deviceColorVariantId are always null: a rep-car sale never selects a
 * phone model (see the SaleProductOption doc comment) — colorId stays null
 * too, since a car-aggregate sale no longer distinguishes a specific
 * descriptive color either, the same simplification extended consistently. */
export function buildSaleSubmitLines(groups: SaleProductGroup[], quantities: Record<string, number>, productPrices: Record<string, string>): SaleSubmitLine[] {
  const lines: SaleSubmitLine[] = [];
  for (const group of groups) {
    const quantity = quantities[group.key] ?? 0;
    if (quantity <= 0) continue;
    lines.push({
      productId: group.key,
      colorId: null,
      variantId: null,
      deviceColorVariantId: null,
      quantity,
      unitPriceCents: parseProductPriceCents(productPrices[group.key]),
    });
  }
  return lines;
}

function QuantityStepper({ quantity, max, onChange }: { quantity: number; max: number; onChange: (next: number) => void }) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      <Button type="button" variant="outline" size="md" className="w-10 shrink-0 px-0" disabled={quantity <= 0} onClick={() => onChange(Math.max(0, quantity - 1))} aria-label="إنقاص الكمية">
        −
      </Button>
      <input
        type="number"
        min={0}
        max={max}
        value={quantity}
        onChange={(event) => {
          const next = Math.floor(Number(event.target.value));
          onChange(Number.isFinite(next) ? Math.min(Math.max(next, 0), max) : 0);
        }}
        aria-label="الكمية"
        className="h-10 w-12 rounded-card border border-navy-soft bg-navy-deep text-center text-sm text-neutral-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-champagne"
      />
      <Button type="button" variant="outline" size="md" className="w-10 shrink-0 px-0" disabled={quantity >= max} onClick={() => onChange(Math.min(max, quantity + 1))} aria-label="زيادة الكمية">
        +
      </Button>
    </div>
  );
}

function ProductCard({
  group,
  quantity,
  onQuantityChange,
  priceValue,
  onPriceChange,
}: {
  group: SaleProductGroup;
  quantity: number;
  onQuantityChange: (quantity: number) => void;
  priceValue: string;
  onPriceChange: (value: string) => void;
}) {
  const unitPriceCents = parseProductPriceCents(priceValue);
  const subtotalCents = quantity * unitPriceCents;
  const priceMissing = quantity > 0 && unitPriceCents <= 0;

  return (
    <div className="flex flex-col gap-2 rounded-card border border-navy-soft bg-navy-deep/40 p-3">
      <div className="flex items-center gap-3">
        <ProductThumb product={group.product} className="h-11 w-11" />
        <div className="min-w-0 flex-1">
          <p className="whitespace-normal break-words text-sm font-medium leading-snug text-neutral-bg">{group.label}</p>
          <p className="text-xs text-neutral-bg/50">{group.product.sku} — المتوفر: {group.stock}</p>
        </div>
        <QuantityStepper quantity={quantity} max={group.stock} onChange={onQuantityChange} />
      </div>

      {quantity > 0 && (
        <div className="flex flex-wrap items-end justify-between gap-2 border-t border-navy-soft pt-2">
          <Input
            label="سعر الحبة"
            type="number"
            min={0}
            step={0.01}
            value={priceValue}
            onChange={(event) => onPriceChange(event.target.value)}
            className="w-28"
            error={priceMissing ? "أدخل سعر الحبة" : undefined}
          />
          <p className="text-sm font-semibold text-neutral-bg">الإجمالي: {formatCurrencyFromCents(subtotalCents)}</p>
        </div>
      )}
    </div>
  );
}

export interface ProductSalePickerProps {
  groups: SaleProductGroup[];
  quantities: Record<string, number>;
  onQuantityChange: (productKey: string, quantity: number) => void;
  productPrices: Record<string, string>;
  onProductPriceChange: (productKey: string, value: string) => void;
}

function groupHasSelection(group: SaleProductGroup, quantities: Record<string, number>): boolean {
  return (quantities[group.key] ?? 0) > 0;
}

/** The rep-sale product picker — a searchable list of PRODUCTS (e.g.
 * "OVI 04", "OVI 63", "Privacy Glass"), each showing its rep-car aggregate
 * stock, a quantity stepper, and — once selected — one price field and
 * live subtotal directly on its own card. No model-selection popup: a rep
 * sale never needs to choose a phone model (see SaleProductOption's doc
 * comment) — that choice only ever happens on the WAREHOUSE side, when an
 * admin loads the car or processes a return.
 *
 * The list is deliberately never a full always-visible catalog dump: with
 * an empty search box it shows ONLY products that already have a selected
 * quantity (manually picked, or preloaded from a RepCustomerOrder — either
 * way, `quantities` already reflects it). Typing narrows/adds matching
 * products on top of whatever is already selected, deduplicated — a
 * selected product never silently drops off screen just because it stopped
 * matching the current query. */
export function ProductSalePicker({ groups, quantities, onQuantityChange, productPrices, onProductPriceChange }: ProductSalePickerProps) {
  const [search, setSearch] = useState("");

  const normalizedSearch = search.trim().toLowerCase();
  const visibleGroups = useMemo(() => {
    const selected = groups.filter((group) => groupHasSelection(group, quantities));
    if (!normalizedSearch) return selected;

    const matches = groups.filter((group) => group.label.toLowerCase().includes(normalizedSearch) || group.product.sku.toLowerCase().includes(normalizedSearch));
    const matchKeys = new Set(matches.map((group) => group.key));
    const selectedNotMatched = selected.filter((group) => !matchKeys.has(group.key));
    return [...selectedNotMatched, ...matches];
  }, [groups, normalizedSearch, quantities]);

  if (groups.length === 0) {
    return <p className="py-6 text-center text-sm text-neutral-bg/50">لا يوجد لديك مخزون متاح للبيع حالياً.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ابحث عن منتج..." aria-label="ابحث عن منتج" />

      {visibleGroups.length === 0 ? (
        <p className="py-3 text-center text-xs text-neutral-bg/50">
          {normalizedSearch ? "لا توجد نتائج مطابقة" : "ابحث عن صنف لإضافته للبيع"}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {visibleGroups.map((group) => (
            <ProductCard
              key={group.key}
              group={group}
              quantity={quantities[group.key] ?? 0}
              onQuantityChange={(quantity) => onQuantityChange(group.key, quantity)}
              priceValue={productPrices[group.key] ?? ""}
              onPriceChange={(value) => onProductPriceChange(group.key, value)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
