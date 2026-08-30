"use client";

import { useMemo, useState } from "react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { ProductThumb, type PickableProduct } from "@/components/reps/ProductQuickPicker";
import { formatCurrencyFromCents } from "@/lib/utils";

export interface SaleProductCategory {
  id: string;
  name: string;
  nameAr: string | null;
  /** This category's TOP-LEVEL ancestor — itself when this category has no
   * parent at all, however many parent levels up otherwise (see
   * resolveCategoryRoots in src/lib/rep-sales.ts, which walks the real
   * Category.parentId chain however deep it actually goes — never a
   * hard-coded number of levels). THIS is the price-entry section identity
   * (see buildSaleSections' doc comment for why); `id`/`name`/`nameAr`
   * above are only ever used as an informational subtype label under that
   * section. */
  root: { id: string; name: string; nameAr: string | null };
}

export interface SaleProductOption extends PickableProduct {
  /** Rep-car stock for a non-variant product — a phone-variant product's
   * stock lives per-model on `variantOptions[].stock` instead. Color never
   * carries stock either way. */
  repStock: number;
  retailPriceCents: number;
  /** Null for an uncategorized product — buildSaleSections below falls back
   * to one standalone section per uncategorized product rather than lumping
   * every uncategorized product into one shared "misc" bucket (grouping
   * unrelated products just because neither has a category would be exactly
   * the kind of blind grouping this whole feature exists to avoid). */
  category: SaleProductCategory | null;
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

/** One informational subtype inside a section — purely visual/search
 * organization (a label + which rows belong to it). NEVER a separate price
 * input: pricing lives one level up, on the SaleSection itself. Identity is
 * the product's own leaf Category.id (or `product:<id>` for an
 * uncategorized product). */
export interface SaleSubtype {
  key: string;
  label: string;
  rows: ModelRow[];
}

/** One collapsible card AND the one price-entry unit — a top-level Category
 * (or, for an uncategorized product, that product's own standalone
 * section). `subtypes.length === 1` with a label identical to the
 * section's own label is the common case (e.g. "الشفاف", which has no
 * children at all) — the UI hides the redundant subtype heading then;
 * `subtypes.length > 1` (e.g. "اللزقات" containing "Privacy"/"Ceramic")
 * shows each subtype's own heading, but still only ONE price field for the
 * whole section. */
export interface SaleSection {
  key: string;
  label: string;
  subtypes: SaleSubtype[];
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
 *   - Otherwise: the product itself is the one and only row.
 * `includeProductName` prefixes every row with the product's own name —
 * only turned on when a subtype actually contains more than one distinct
 * product (see buildSaleSections), so the common single-product-per-subtype
 * case reads as a clean model name ("iPhone 15"), not a redundant
 * "شفاف — iPhone 15". */
function buildRowsForProduct(product: SaleProductOption, includeProductName: boolean): ModelRow[] {
  const productLabel = product.nameAr ?? product.name;
  const prefix = includeProductName ? `${productLabel} — ` : "";
  const base = { productId: product.id, sku: product.sku, thumbnailUrl: product.thumbnailUrl, thumbnailAlt: product.thumbnailAlt };

  if (product.deviceColorVariantOptions?.length) {
    return product.deviceColorVariantOptions.map((combo) => ({
      ...base,
      key: lineKey(product.id, null, null, combo.id),
      colorId: null,
      variantId: null,
      deviceColorVariantId: combo.id,
      label: `${prefix}${combo.brandLabel} / ${combo.modelLabel} / ${combo.colorLabel}`,
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
      label: `${prefix}${variant.label}`,
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
      label: `${productLabel} — ${color.nameAr ?? color.name}`,
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
      label: productLabel,
      stock: product.repStock,
    },
  ];
}

/** Groups the already-loaded rep-car catalog into sections for the grouped
 * price-entry picker — pure client-side reshaping of data the page already
 * fetched in one query (see getRepCarSaleProducts), never a second network
 * round trip.
 *
 * PRICING identity is the product's TOP-LEVEL category (SaleProductCategory
 * .root) — e.g. "اللزقات" itself, never "Privacy"/"Ceramic" individually —
 * because the rep types ONE price for the whole main section, regardless of
 * how many subtypes or phone models it spans. A leaf category with no
 * parent (e.g. "الشفاف") IS its own root — there is nothing broader to
 * price it under, so it renders as a single section with a single implicit
 * subtype and no redundant sub-heading. An uncategorized product never
 * joins another product's section (see SaleProductOption.category's doc
 * comment) — it becomes its own standalone single-product section instead.
 *
 * SUBTYPE identity (purely visual/search organization within a section,
 * never a price boundary) is the product's own direct/leaf category. */
export function buildSaleSections(products: SaleProductOption[]): SaleSection[] {
  interface SubtypeBucket {
    label: string;
    sectionKey: string;
    sectionLabel: string;
    products: SaleProductOption[];
  }

  const subtypeBuckets = new Map<string, SubtypeBucket>();
  for (const product of products) {
    const category = product.category;
    const subtypeKey = category ? category.id : `product:${product.id}`;
    const subtypeLabel = category ? (category.nameAr ?? category.name) : (product.nameAr ?? product.name);
    const sectionKey = category ? category.root.id : subtypeKey;
    const sectionLabel = category ? (category.root.nameAr ?? category.root.name) : subtypeLabel;

    const bucket = subtypeBuckets.get(subtypeKey);
    if (bucket) {
      bucket.products.push(product);
    } else {
      subtypeBuckets.set(subtypeKey, { label: subtypeLabel, sectionKey, sectionLabel, products: [product] });
    }
  }

  const sections = new Map<string, SaleSection>();
  for (const [subtypeKey, bucket] of subtypeBuckets) {
    const rows = bucket.products.flatMap((product) => buildRowsForProduct(product, bucket.products.length > 1));
    if (rows.length === 0) continue;
    rows.sort((a, b) => a.label.localeCompare(b.label, "ar"));

    const section = sections.get(bucket.sectionKey) ?? { key: bucket.sectionKey, label: bucket.sectionLabel, subtypes: [] };
    section.subtypes.push({ key: subtypeKey, label: bucket.label, rows });
    sections.set(bucket.sectionKey, section);
  }

  const result = [...sections.values()];
  for (const section of result) {
    section.subtypes.sort((a, b) => a.label.localeCompare(b.label, "ar"));
  }
  result.sort((a, b) => a.label.localeCompare(b.label, "ar"));
  return result;
}

/** Finds the one row matching a RepCustomerOrderItem's identity (productId +
 * variantId + deviceColorVariantId — that table never carries colorId, see
 * RepCustomerOrderItemOption) so a preloaded customer-order template lands
 * on the exact same leaf a normal pick would produce. */
export function findSaleRow(
  sections: SaleSection[],
  identity: { productId: string; variantId: string | null; deviceColorVariantId: string | null },
): ModelRow | null {
  for (const section of sections) {
    for (const subtype of section.subtypes) {
      for (const row of subtype.rows) {
        if (row.productId === identity.productId && row.variantId === identity.variantId && row.deviceColorVariantId === identity.deviceColorVariantId && row.colorId === null) {
          return row;
        }
      }
    }
  }
  return null;
}

export interface SaleSectionSummary {
  sectionKey: string;
  sectionLabel: string;
  subtypeCount: number;
  modelCount: number;
  pieceCount: number;
  unitPriceCents: number;
  subtotalCents: number;
  /** True when this section has a selected quantity but no valid (> 0)
   * price yet — the one client-side validation this feature adds: never let
   * a rep submit pieces they typed a quantity for but no price for. */
  priceMissing: boolean;
}

function parseSectionPriceCents(value: string | undefined): number {
  const parsed = Math.round((Number(value) || 0) * 100);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/** Summaries for every section that currently has at least one selected
 * piece, ANYWHERE across its subtypes — used both for the bottom order
 * summary and for submit validation. Sections with nothing selected are
 * omitted entirely (nothing to summarize or validate). */
export function summarizeSaleSections(sections: SaleSection[], quantities: Record<string, number>, sectionPrices: Record<string, string>): SaleSectionSummary[] {
  const summaries: SaleSectionSummary[] = [];
  for (const section of sections) {
    let pieceCount = 0;
    let modelCount = 0;
    let subtypeCount = 0;
    for (const subtype of section.subtypes) {
      let subtypeHasSelection = false;
      for (const row of subtype.rows) {
        const quantity = quantities[row.key] ?? 0;
        if (quantity > 0) {
          pieceCount += quantity;
          modelCount += 1;
          subtypeHasSelection = true;
        }
      }
      if (subtypeHasSelection) subtypeCount += 1;
    }
    if (pieceCount === 0) continue;
    const unitPriceCents = parseSectionPriceCents(sectionPrices[section.key]);
    summaries.push({
      sectionKey: section.key,
      sectionLabel: section.label,
      subtypeCount,
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
 * merged across rows, and never merged across subtypes), with its
 * SECTION's single typed price applied to it. Stock accuracy is untouched
 * by grouping: this is still one line per exact inventory leaf, exactly as
 * before this feature — only the PRICE now comes from the whole section
 * instead of being typed per line or per subtype. */
export function buildSaleSubmitLines(sections: SaleSection[], quantities: Record<string, number>, sectionPrices: Record<string, string>): SaleSubmitLine[] {
  const lines: SaleSubmitLine[] = [];
  for (const section of sections) {
    const unitPriceCents = parseSectionPriceCents(sectionPrices[section.key]);
    for (const subtype of section.subtypes) {
      for (const row of subtype.rows) {
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
    <div className="flex items-center gap-2 px-2 py-2">
      <ProductThumb product={{ thumbnailUrl: row.thumbnailUrl, thumbnailAlt: row.thumbnailAlt, name: row.label }} className="h-9 w-9" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-neutral-bg">{row.label}</p>
        <p className="text-xs text-neutral-bg/50">المتوفر: {row.stock}</p>
      </div>
      <QuantityStepper quantity={quantity} max={row.stock} onChange={(next) => onQuantityChange(row, next)} />
    </div>
  );
}

function SectionCard({
  section,
  quantities,
  onQuantityChange,
  priceValue,
  onPriceChange,
}: {
  section: SaleSection;
  quantities: Record<string, number>;
  onQuantityChange: (row: ModelRow, quantity: number) => void;
  priceValue: string;
  onPriceChange: (value: string) => void;
}) {
  const [query, setQuery] = useState("");
  const showSubtypeHeadings = section.subtypes.length > 1;

  // One search box for the WHOLE section — filters every subtype's row
  // list against the same query, so a rep never has to repeat the same
  // search once per subtype (see the task's own "لا أريد كتابة iPhone 16 في
  // ثلاث خانات بحث منفصلة" requirement).
  const normalizedQuery = query.trim().toLowerCase();
  const visibleSubtypes = useMemo(() => {
    if (!normalizedQuery) return section.subtypes;
    return section.subtypes
      .map((subtype) => ({ ...subtype, rows: subtype.rows.filter((row) => row.label.toLowerCase().includes(normalizedQuery) || row.sku.toLowerCase().includes(normalizedQuery)) }))
      .filter((subtype) => subtype.rows.length > 0);
  }, [section.subtypes, normalizedQuery]);

  let pieceCount = 0;
  let modelCount = 0;
  let subtypeCount = 0;
  for (const subtype of section.subtypes) {
    let subtypeHasSelection = false;
    for (const row of subtype.rows) {
      const quantity = quantities[row.key] ?? 0;
      if (quantity > 0) {
        pieceCount += quantity;
        modelCount += 1;
        subtypeHasSelection = true;
      }
    }
    if (subtypeHasSelection) subtypeCount += 1;
  }
  const unitPriceCents = parseSectionPriceCents(priceValue);
  const subtotalCents = pieceCount * unitPriceCents;
  const priceMissing = pieceCount > 0 && unitPriceCents <= 0;

  return (
    <div className="flex flex-col gap-2 rounded-card border border-navy-soft bg-navy-deep/40 p-3">
      <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="بحث عن الموديل..." aria-label={`بحث عن الموديل — ${section.label}`} />

      <div className="flex flex-col gap-2">
        {visibleSubtypes.length === 0 ? (
          <p className="py-4 text-center text-xs text-neutral-bg/50">لا توجد نتائج مطابقة</p>
        ) : (
          visibleSubtypes.map((subtype) => (
            <div key={subtype.key} className="flex flex-col gap-1">
              {showSubtypeHeadings && <p className="px-1 text-xs font-semibold text-neutral-bg/70">{subtype.label}</p>}
              <div className="flex max-h-72 flex-col divide-y divide-navy-soft overflow-y-auto rounded-card border border-navy-soft">
                {subtype.rows.map((row) => (
                  <ModelRowView key={row.key} row={row} quantity={quantities[row.key] ?? 0} onQuantityChange={onQuantityChange} />
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="flex flex-col gap-2 border-t border-navy-soft pt-2 text-xs text-neutral-bg/70 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-0.5">
          {showSubtypeHeadings && <p>{subtypeCount} أنواع</p>}
          <p>{modelCount} موديلات مختارة</p>
          <p>{pieceCount} قطع</p>
        </div>
        <div className="flex flex-col gap-1">
          <Input
            label="سعر القطعة"
            type="number"
            min={0}
            step={0.01}
            value={priceValue}
            onChange={(event) => onPriceChange(event.target.value)}
            className="w-32"
            error={priceMissing ? "أدخل سعر القطعة" : undefined}
          />
          <p className="text-sm font-semibold text-neutral-bg">إجمالي {section.label}: {formatCurrencyFromCents(subtotalCents)}</p>
        </div>
      </div>
    </div>
  );
}

export interface SaleGroupPickerProps {
  sections: SaleSection[];
  quantities: Record<string, number>;
  onQuantityChange: (row: ModelRow, quantity: number) => void;
  sectionPrices: Record<string, string>;
  onSectionPriceChange: (sectionKey: string, value: string) => void;
}

/** The grouped, mobile-friendly replacement for the old flat
 * search-then-add product picker on the rep-sale form. Every top-level
 * accessory category with rep-car stock becomes its own compact,
 * collapsible card with exactly ONE unit-price field — its subtypes (e.g.
 * "Privacy"/"Ceramic" under "اللزقات") are shown underneath purely for
 * organization, never as separate price boundaries. A section auto-expands
 * whenever it has a selection inside (manual picks or a preloaded customer
 * order) even if the rep collapsed it, so a preload is never hidden. */
export function SaleGroupPicker({ sections, quantities, onQuantityChange, sectionPrices, onSectionPriceChange }: SaleGroupPickerProps) {
  const [openSections, setOpenSections] = useState<Set<string>>(new Set());

  function toggleSection(key: string) {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  if (sections.length === 0) {
    return <p className="py-6 text-center text-sm text-neutral-bg/50">لا يوجد لديك مخزون متاح للبيع حالياً.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {sections.map((section) => {
        const sectionPieceCount = section.subtypes.reduce((sum, subtype) => sum + subtype.rows.reduce((rowSum, row) => rowSum + (quantities[row.key] ?? 0), 0), 0);
        const isOpen = openSections.has(section.key) || sectionPieceCount > 0;

        return (
          <div key={section.key} className="rounded-card border border-navy-soft bg-navy-surface">
            <button
              type="button"
              onClick={() => toggleSection(section.key)}
              className="flex w-full items-center justify-between gap-3 px-4 py-3 text-start"
            >
              <span className="text-sm font-semibold text-neutral-bg">{section.label}</span>
              <span className="flex items-center gap-2 text-xs text-neutral-bg/50">
                {sectionPieceCount > 0 && <span className="text-gold-champagne">{sectionPieceCount} قطعة مختارة</span>}
                {isOpen ? "▲" : "▼"}
              </span>
            </button>

            {isOpen && (
              <div className="border-t border-navy-soft p-3">
                <SectionCard
                  section={section}
                  quantities={quantities}
                  onQuantityChange={onQuantityChange}
                  priceValue={sectionPrices[section.key] ?? ""}
                  onPriceChange={(value) => onSectionPriceChange(section.key, value)}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
