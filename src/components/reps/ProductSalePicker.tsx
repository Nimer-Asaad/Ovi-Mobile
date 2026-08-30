"use client";

import { useMemo, useState } from "react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { ProductThumb, type PickableProduct } from "@/components/reps/ProductQuickPicker";
import { formatCurrencyFromCents } from "@/lib/utils";

export interface SaleProductOption extends PickableProduct {
  /** Rep-car stock for a non-variant product — a phone-variant product's
   * stock lives per-model on `variantOptions[].stock` instead. Color never
   * carries stock either way. */
  repStock: number;
  retailPriceCents: number;
}

/** One selectable inventory leaf — always exactly one real InventoryItem
 * bucket (see the dimensional rules below), never a merged/aggregated
 * quantity. This is deliberately the same identity a submitted OrderItem
 * line needs (productId + colorId + variantId + deviceColorVariantId) so a
 * row can be turned directly into a sale line with no extra lookup. */
export interface ModelRow {
  /** Stable React key AND the lookup key into the quantities selection
   * state — opaque, never parsed back apart; every field callers need is
   * already on the row itself. */
  key: string;
  productId: string;
  colorId: string | null;
  variantId: string | null;
  deviceColorVariantId: string | null;
  label: string;
  sku: string;
  /** Current rep-car quantity for this exact leaf — the stepper's max. */
  stock: number;
  thumbnailUrl: string | null;
  thumbnailAlt: string | null;
}

/** One product on the main sale list AND the one price-entry unit — pricing
 * is grouped by productId, never by Category (see the task history: a
 * category-wide grouping was tried and rejected — two products in the same
 * category, e.g. "OVI 04" and "OVI 63", must always be free to have
 * different prices). `needsPopup` mirrors the exact same gating rule
 * ProductQuickPicker's own handleRowClick already uses elsewhere in this
 * app: a product with any variant/color/device-color system needs a
 * model-selection step; a plain product (one implicit row) doesn't, and
 * gets its quantity stepper right on its own card instead. */
export interface SaleProductGroup {
  key: string;
  product: SaleProductOption;
  label: string;
  rows: ModelRow[];
  needsPopup: boolean;
}

function lineKey(productId: string, colorId: string | null, variantId: string | null, deviceColorVariantId: string | null): string {
  if (deviceColorVariantId) return `${productId}:combo:${deviceColorVariantId}`;
  if (variantId) return `${productId}:variant:${variantId}`;
  return `${productId}:${colorId ? `color:${colorId}` : "plain"}`;
}

/** Flattens one product into its selectable leaves, following the exact
 * same three inventory dimensions the rest of the app preserves everywhere
 * else (see the Product/DeviceColorVariant doc comments in schema.prisma):
 *   - DEVICE_MODEL_COLOR: one row per brand+model+color combination.
 *   - PHONE_COMPATIBILITY (variantMode): one row per phone-model variant.
 *   - Plain descriptive colorOptions (TOTAL_STOCK, no variant system): one
 *     row per color — these all share the SAME stock bucket (color was
 *     never a stock dimension, see ProductColorOption's doc comment), which
 *     is exactly why the server's own oversell check sums by product,
 *     ignoring color, before comparing against available stock.
 *   - Otherwise: the product itself is the one and only row. */
function buildRowsForProduct(product: SaleProductOption): ModelRow[] {
  const base = { productId: product.id, sku: product.sku, thumbnailUrl: product.thumbnailUrl, thumbnailAlt: product.thumbnailAlt };

  if (product.deviceColorVariantOptions?.length) {
    return product.deviceColorVariantOptions.map((combo) => ({
      ...base,
      key: lineKey(product.id, null, null, combo.id),
      colorId: null,
      variantId: null,
      deviceColorVariantId: combo.id,
      label: `${combo.brandLabel} / ${combo.modelLabel} / ${combo.colorLabel}`,
      stock: combo.stock ?? 0,
    }));
  }
  if (product.variantOptions?.length) {
    return product.variantOptions.map((variant) => ({
      ...base,
      key: lineKey(product.id, null, variant.id, null),
      colorId: null,
      variantId: variant.id,
      deviceColorVariantId: null,
      label: variant.label,
      stock: variant.stock ?? 0,
    }));
  }
  if (product.colorOptions?.length) {
    return product.colorOptions.map((color) => ({
      ...base,
      key: lineKey(product.id, color.id, null, null),
      colorId: color.id,
      variantId: null,
      deviceColorVariantId: null,
      label: color.nameAr ?? color.name,
      stock: product.repStock,
    }));
  }
  return [
    {
      ...base,
      key: lineKey(product.id, null, null, null),
      colorId: null,
      variantId: null,
      deviceColorVariantId: null,
      label: product.nameAr ?? product.name,
      stock: product.repStock,
    },
  ];
}

/** One group per product — pure client-side reshaping of data the page
 * already fetched in one query (see getRepCarSaleProducts), never a second
 * network round trip. */
export function buildSaleProductGroups(products: SaleProductOption[]): SaleProductGroup[] {
  return products
    .map((product) => ({
      key: product.id,
      product,
      label: product.nameAr ?? product.name,
      rows: buildRowsForProduct(product),
      needsPopup: Boolean(product.variantOptions?.length || product.colorOptions?.length || product.deviceColorVariantOptions?.length),
    }))
    .sort((a, b) => a.label.localeCompare(b.label, "ar"));
}

/** Finds the one row matching a RepCustomerOrderItem's identity (productId +
 * variantId + deviceColorVariantId — that table never carries colorId, see
 * RepCustomerOrderItemOption) so a preloaded customer-order template lands
 * on the exact same leaf a normal pick would produce. */
export function findSaleRow(
  groups: SaleProductGroup[],
  identity: { productId: string; variantId: string | null; deviceColorVariantId: string | null },
): ModelRow | null {
  for (const group of groups) {
    for (const row of group.rows) {
      if (row.productId === identity.productId && row.variantId === identity.variantId && row.deviceColorVariantId === identity.deviceColorVariantId && row.colorId === null) {
        return row;
      }
    }
  }
  return null;
}

export interface SaleProductSummary {
  productKey: string;
  productLabel: string;
  modelCount: number;
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

/** Summaries for every product that currently has at least one selected
 * piece — used both for the bottom order summary and for submit
 * validation. Products with nothing selected are omitted entirely (nothing
 * to summarize or validate). */
export function summarizeSaleProducts(groups: SaleProductGroup[], quantities: Record<string, number>, productPrices: Record<string, string>): SaleProductSummary[] {
  const summaries: SaleProductSummary[] = [];
  for (const group of groups) {
    let pieceCount = 0;
    let modelCount = 0;
    for (const row of group.rows) {
      const quantity = quantities[row.key] ?? 0;
      if (quantity > 0) {
        pieceCount += quantity;
        modelCount += 1;
      }
    }
    if (pieceCount === 0) continue;
    const unitPriceCents = parseProductPriceCents(productPrices[group.key]);
    summaries.push({
      productKey: group.key,
      productLabel: group.label,
      modelCount,
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
 * expect (see repSaleSchema) — every selected row becomes its own line,
 * carrying its OWN productId/colorId/variantId/deviceColorVariantId (never
 * merged across rows), with its PRODUCT's single typed price applied to it.
 * Stock accuracy is untouched by grouping: this is still one line per exact
 * inventory leaf, exactly as before this feature — only the PRICE now comes
 * from the product as a whole instead of being typed per model. */
export function buildSaleSubmitLines(groups: SaleProductGroup[], quantities: Record<string, number>, productPrices: Record<string, string>): SaleSubmitLine[] {
  const lines: SaleSubmitLine[] = [];
  for (const group of groups) {
    const unitPriceCents = parseProductPriceCents(productPrices[group.key]);
    for (const row of group.rows) {
      const quantity = quantities[row.key] ?? 0;
      if (quantity <= 0) continue;
      lines.push({
        productId: row.productId,
        colorId: row.colorId,
        variantId: row.variantId,
        deviceColorVariantId: row.deviceColorVariantId,
        quantity,
        unitPriceCents,
      });
    }
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

function ModelRowView({ row, quantity, onQuantityChange }: { row: ModelRow; quantity: number; onQuantityChange: (row: ModelRow, quantity: number) => void }) {
  return (
    <div className="flex items-center gap-2 py-2">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-neutral-bg">{row.label}</p>
        <p className="text-xs text-neutral-bg/50">المتوفر: {row.stock}</p>
      </div>
      <QuantityStepper quantity={quantity} max={row.stock} onChange={(next) => onQuantityChange(row, next)} />
    </div>
  );
}

/** The model-selection popup for one product — opened by clicking a product
 * that has more than one selectable inventory leaf (see needsPopup). The
 * search field here is scoped ONLY to this product's own rows — it is
 * deliberately NOT a global device-model search sitting above the whole
 * product list (a prior version of this feature had exactly that at the
 * category level and it was rejected). Quantities live in the PARENT's
 * `quantities` map (keyed by row.key), never inside this component's own
 * state, so searching never loses a selection and re-closing/reopening this
 * same product always shows exactly what was selected before. Remounted
 * with a fresh `key` per product by the caller so its own search box always
 * starts empty for a newly-opened product. Same fixed-overlay +
 * max-height + internal-scroll shell as ProductQuickPicker's existing
 * detail modal, reused here for a consistent, already-proven mobile
 * scroll behavior. */
function ProductModal({
  group,
  quantities,
  onQuantityChange,
  onClose,
}: {
  group: SaleProductGroup;
  quantities: Record<string, number>;
  onQuantityChange: (row: ModelRow, quantity: number) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const visibleRows = useMemo(() => {
    if (!normalizedQuery) return group.rows;
    return group.rows.filter((row) => row.label.toLowerCase().includes(normalizedQuery) || row.sku.toLowerCase().includes(normalizedQuery));
  }, [group.rows, normalizedQuery]);

  const modelCount = group.rows.filter((row) => (quantities[row.key] ?? 0) > 0).length;
  const pieceCount = group.rows.reduce((sum, row) => sum + (quantities[row.key] ?? 0), 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" className="relative flex max-h-[85vh] w-full max-w-sm flex-col rounded-card border border-navy-soft bg-navy-surface shadow-card" onClick={(event) => event.stopPropagation()}>
        <button type="button" onClick={onClose} aria-label="إغلاق" className="absolute start-3 top-3 flex h-7 w-7 items-center justify-center rounded-full text-neutral-bg/60 transition-colors hover:bg-navy-deep hover:text-neutral-bg">
          ✕
        </button>

        {/* Non-scrolling header (thumbnail/name/search) — the row list
         * below it is what grows long, so only that part scrolls
         * internally (min-h-0 on it is required, same as
         * ProductQuickPicker's own detail modal). */}
        <div className="shrink-0 px-5 pt-5">
          <ProductThumb product={group.product} className="mx-auto h-20 w-20" />
          <p className="mt-3 text-center text-base font-semibold text-neutral-bg">{group.label}</p>
          <p className="text-center text-xs text-neutral-bg/50">{group.product.sku}</p>
          <div className="mt-4">
            <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ابحث عن موديل الجهاز..." aria-label="ابحث عن موديل الجهاز" autoFocus />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-2">
          {visibleRows.length === 0 ? (
            <p className="py-6 text-center text-xs text-neutral-bg/50">لا توجد نتائج مطابقة</p>
          ) : (
            <div className="flex flex-col divide-y divide-navy-soft">
              {visibleRows.map((row) => (
                <ModelRowView key={row.key} row={row} quantity={quantities[row.key] ?? 0} onQuantityChange={onQuantityChange} />
              ))}
            </div>
          )}
        </div>

        <div className="shrink-0 border-t border-navy-soft px-5 py-3">
          <div className="mb-2 flex items-center justify-between text-xs text-neutral-bg/60">
            <span>الموديلات المختارة: {modelCount}</span>
            <span>إجمالي القطع: {pieceCount}</span>
          </div>
          <Button type="button" className="w-full" onClick={onClose}>
            تم
          </Button>
        </div>
      </div>
    </div>
  );
}

function ProductCard({
  group,
  quantities,
  onQuantityChange,
  priceValue,
  onPriceChange,
  onOpenModal,
}: {
  group: SaleProductGroup;
  quantities: Record<string, number>;
  onQuantityChange: (row: ModelRow, quantity: number) => void;
  priceValue: string;
  onPriceChange: (value: string) => void;
  onOpenModal: () => void;
}) {
  const pieceCount = group.rows.reduce((sum, row) => sum + (quantities[row.key] ?? 0), 0);
  const modelCount = group.rows.filter((row) => (quantities[row.key] ?? 0) > 0).length;
  const unitPriceCents = parseProductPriceCents(priceValue);
  const subtotalCents = pieceCount * unitPriceCents;
  const priceMissing = pieceCount > 0 && unitPriceCents <= 0;
  // A product with no variant/color/device-color system has exactly one
  // implicit row — its stepper sits right on this card, no popup needed
  // (see needsPopup's doc comment).
  const singleRow = !group.needsPopup ? group.rows[0] : undefined;

  return (
    <div className="flex flex-col gap-2 rounded-card border border-navy-soft bg-navy-deep/40 p-3">
      <div className="flex items-center gap-3">
        <ProductThumb product={group.product} className="h-11 w-11" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-neutral-bg">{group.label}</p>
          <p className="text-xs text-neutral-bg/50">{group.product.sku}</p>
        </div>
        {singleRow ? (
          <QuantityStepper quantity={quantities[singleRow.key] ?? 0} max={singleRow.stock} onChange={(next) => onQuantityChange(singleRow, next)} />
        ) : (
          <Button type="button" variant="outline" size="sm" onClick={onOpenModal}>
            {modelCount > 0 ? "تعديل الموديلات" : "اختيار الموديلات"}
          </Button>
        )}
      </div>

      {group.needsPopup && modelCount > 0 && (
        <p className="text-xs text-neutral-bg/60">{modelCount} موديلات مختارة — {pieceCount} قطع</p>
      )}

      {pieceCount > 0 && (
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
  onQuantityChange: (row: ModelRow, quantity: number) => void;
  productPrices: Record<string, string>;
  onProductPriceChange: (productKey: string, value: string) => void;
}

function groupHasSelection(group: SaleProductGroup, quantities: Record<string, number>): boolean {
  return group.rows.some((row) => (quantities[row.key] ?? 0) > 0);
}

/** The rep-sale product picker — a searchable list of PRODUCTS (e.g.
 * "OVI 04", "OVI 63", "Privacy Glass"), each either showing its quantity
 * stepper directly (a plain product with one implicit row) or a button that
 * opens a model-selection popup scoped to that one product (see
 * ProductModal — the popup's own search field only ever searches that
 * product's own phone-model/variant/color rows, never the whole catalog).
 * Pricing is entered ONCE per product on its own card, applied to every
 * selected row underneath it regardless of how many distinct phone models
 * were picked inside the popup.
 *
 * The list is deliberately never a full always-visible catalog dump: with
 * an empty search box it shows ONLY products that already have a selected
 * quantity somewhere (manually picked, or preloaded from a RepCustomerOrder
 * — either way, `quantities` already reflects it, so this needs no extra
 * "is this preloaded" concept of its own). Typing narrows/adds matching
 * products on top of whatever is already selected, deduplicated — a
 * selected product never silently drops off screen just because it stopped
 * matching the current query. */
export function ProductSalePicker({ groups, quantities, onQuantityChange, productPrices, onProductPriceChange }: ProductSalePickerProps) {
  const [search, setSearch] = useState("");
  const [openProductKey, setOpenProductKey] = useState<string | null>(null);

  const normalizedSearch = search.trim().toLowerCase();
  const visibleGroups = useMemo(() => {
    const selected = groups.filter((group) => groupHasSelection(group, quantities));
    if (!normalizedSearch) return selected;

    const matches = groups.filter((group) => group.label.toLowerCase().includes(normalizedSearch) || group.product.sku.toLowerCase().includes(normalizedSearch));
    const matchKeys = new Set(matches.map((group) => group.key));
    const selectedNotMatched = selected.filter((group) => !matchKeys.has(group.key));
    return [...selectedNotMatched, ...matches];
  }, [groups, normalizedSearch, quantities]);

  const openGroup = groups.find((group) => group.key === openProductKey) ?? null;

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
              quantities={quantities}
              onQuantityChange={onQuantityChange}
              priceValue={productPrices[group.key] ?? ""}
              onPriceChange={(value) => onProductPriceChange(group.key, value)}
              onOpenModal={() => setOpenProductKey(group.key)}
            />
          ))}
        </div>
      )}

      {/* key={openGroup.key} forces a fresh mount (and thus a fresh, empty
       * search box) every time a different product's popup opens — see the
       * ProductModal doc comment. */}
      {openGroup && <ProductModal key={openGroup.key} group={openGroup} quantities={quantities} onQuantityChange={onQuantityChange} onClose={() => setOpenProductKey(null)} />}
    </div>
  );
}
