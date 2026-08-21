"use client";

import { useMemo, useState } from "react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { formatCurrencyFromCents, cn } from "@/lib/utils";
import type { ManualOrderProductOption } from "./ManualOrderForm";

export interface ManualOrderProductPickerProps {
  products: ManualOrderProductOption[];
  priceMode: "retail" | "wholesale";
  /** `${productId}:${variantId ?? ""}:${deviceColorVariantId ?? ""}:${colorId ?? ""}` for every line already added. */
  addedLineKeys: Set<string>;
  onAdd: (product: ManualOrderProductOption, colorId: string | null, variantId?: string | null, deviceColorVariantId?: string | null) => void;
}

function lineKey(productId: string, colorId: string | null, variantId: string | null = null, deviceColorVariantId: string | null = null): string {
  return `${productId}:${variantId ?? ""}:${deviceColorVariantId ?? ""}:${colorId ?? ""}`;
}

/** Local search over the fully-preloaded product list — the catalog is
 * small enough (demo/small-business scale) that filtering client-side is
 * simpler and safer than a new search API route for this phase.
 *
 * A product expands into its exact-target cascade inline: PHONE_COMPATIBILITY
 * asks ماركة then موديل (variantOptions is pre-filtered to isActive/READY —
 * see the page query), DEVICE_MODEL_COLOR asks ماركة then موديل then لون
 * (deviceColorVariantOptions likewise pre-filtered to isActive). The two
 * systems are mutually exclusive per product (DB CHECK constraint), so a
 * product only ever populates one of the two option arrays. A colorless/
 * plain product with colorOptions still gets an independent color-choice
 * step after variantOptions, same as before — color is purely descriptive,
 * never a stock dimension on its own. Nothing here defaults to the first
 * brand/model/color — every step requires an explicit click. */
export function ManualOrderProductPicker({ products, priceMode, addedLineKeys, onAdd }: ManualOrderProductPickerProps) {
  const [query, setQuery] = useState("");
  const [expandedProductId, setExpandedProductId] = useState<string | null>(null);
  const [pendingVariantBrandId, setPendingVariantBrandId] = useState<string | null>(null);
  const [pendingVariantId, setPendingVariantId] = useState<string | null>(null);
  const [pendingDcBrandId, setPendingDcBrandId] = useState<string | null>(null);
  const [pendingDcModelId, setPendingDcModelId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return products.slice(0, 8);
    return products
      .filter((product) =>
        [product.sku, product.name, product.nameAr ?? ""].some((field) =>
          field.toLowerCase().includes(trimmed),
        ),
      )
      .slice(0, 20);
  }, [products, query]);

  function closeExpanded() {
    setExpandedProductId(null);
    setPendingVariantBrandId(null);
    setPendingVariantId(null);
    setPendingDcBrandId(null);
    setPendingDcModelId(null);
  }

  function toggleExpanded(productId: string) {
    setExpandedProductId((current) => (current === productId ? null : productId));
    setPendingVariantBrandId(null);
    setPendingVariantId(null);
    setPendingDcBrandId(null);
    setPendingDcModelId(null);
  }

  return (
    <div className="flex flex-col gap-3">
      <Input
        placeholder="ابحث بالاسم أو رمز المنتج (SKU)..."
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />

      <div className="flex max-h-72 flex-col gap-2 overflow-y-auto">
        {filtered.length === 0 && (
          <p className="py-4 text-center text-sm text-neutral-bg/50">لا توجد منتجات مطابقة</p>
        )}
        {filtered.map((product) => {
          const hasColors = (product.colorOptions?.length ?? 0) > 0;
          const hasVariants = (product.variantOptions?.length ?? 0) > 0;
          const hasDeviceCombos = (product.deviceColorVariantOptions?.length ?? 0) > 0;
          const variantIds: (string | null)[] = hasVariants ? product.variantOptions!.map((variant) => variant.id) : [null];
          const colorIds: (string | null)[] = hasColors ? product.colorOptions!.map((color) => color.id) : [null];
          const comboIds: string[] = hasDeviceCombos ? product.deviceColorVariantOptions!.map((combo) => combo.id) : [];
          const alreadyAdded = hasDeviceCombos
            ? comboIds.every((comboId) => addedLineKeys.has(lineKey(product.id, null, null, comboId)))
            : variantIds.every((variantId) => colorIds.every((colorId) => addedLineKeys.has(lineKey(product.id, colorId, variantId))));
          const outOfStock = !hasVariants && !hasDeviceCombos && product.stock <= 0;
          const priceCents = priceMode === "wholesale" ? product.wholesalePriceCents : product.retailPriceCents;
          const expanded = expandedProductId === product.id;

          const showVariantBrandStep = expanded && hasVariants && pendingVariantId === null && pendingVariantBrandId === null;
          const showVariantModelStep = expanded && hasVariants && pendingVariantId === null && pendingVariantBrandId !== null;
          const showColorStep = expanded && hasColors && (!hasVariants || pendingVariantId !== null);

          const showDcBrandStep = expanded && hasDeviceCombos && pendingDcBrandId === null;
          const showDcModelStep = expanded && hasDeviceCombos && pendingDcBrandId !== null && pendingDcModelId === null;
          const showDcColorStep = expanded && hasDeviceCombos && pendingDcModelId !== null;

          const variantBrands = hasVariants
            ? Array.from(new Map(product.variantOptions!.map((v) => [v.phoneBrandId, v.brandLabel])).entries())
            : [];
          const variantModelsForBrand = hasVariants ? product.variantOptions!.filter((v) => v.phoneBrandId === pendingVariantBrandId) : [];

          const dcBrands = hasDeviceCombos
            ? Array.from(new Map(product.deviceColorVariantOptions!.map((c) => [c.phoneBrandId, c.brandLabel])).entries())
            : [];
          const dcModelsForBrand = hasDeviceCombos
            ? Array.from(
                new Map(
                  product.deviceColorVariantOptions!.filter((c) => c.phoneBrandId === pendingDcBrandId).map((c) => [c.phoneModelId, c.modelLabel]),
                ).entries(),
              )
            : [];
          const dcColorsForModel = hasDeviceCombos ? product.deviceColorVariantOptions!.filter((c) => c.phoneModelId === pendingDcModelId) : [];

          return (
            <div
              key={product.id}
              className="flex flex-col gap-2 rounded-card border border-navy-soft bg-navy-deep px-3 py-2"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-neutral-bg">{product.nameAr ?? product.name}</p>
                  <p className="text-xs text-neutral-bg/50">
                    {product.sku} · متوفر: {hasVariants ? "حسب الموديل" : hasDeviceCombos ? "حسب الموديل واللون" : product.stock} · {formatCurrencyFromCents(priceCents)}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={alreadyAdded || outOfStock}
                  onClick={() =>
                    hasVariants || hasColors || hasDeviceCombos ? toggleExpanded(product.id) : onAdd(product, null)
                  }
                >
                  {alreadyAdded
                    ? "أُضيف"
                    : outOfStock
                      ? "نفد المخزون"
                      : hasDeviceCombos
                        ? "اختر الماركة والموديل واللون"
                        : hasVariants
                          ? "اختر الموديل"
                          : hasColors
                            ? "اختر اللون"
                            : "إضافة"}
                </Button>
              </div>

              {showVariantBrandStep && (
                <div className="flex flex-wrap gap-2 border-t border-navy-soft pt-2">
                  {variantBrands.map(([brandId, brandLabel]) => (
                    <button
                      key={brandId}
                      type="button"
                      onClick={() => setPendingVariantBrandId(brandId)}
                      className="rounded-card border border-navy-soft px-3 py-2 text-xs text-neutral-bg/80 hover:border-gold-champagne/40"
                    >
                      {brandLabel}
                    </button>
                  ))}
                </div>
              )}
              {showVariantModelStep && (
                <div className="flex flex-col gap-2 border-t border-navy-soft pt-2">
                  {variantModelsForBrand.map((variant) => {
                    const used = colorIds.every((colorId) => addedLineKeys.has(lineKey(product.id, colorId, variant.id)));
                    const oos = variant.stock <= 0;
                    return (
                      <button
                        key={variant.id}
                        type="button"
                        disabled={used || oos}
                        onClick={() => {
                          if (hasColors) setPendingVariantId(variant.id);
                          else { onAdd(product, null, variant.id); closeExpanded(); }
                        }}
                        className={cn("rounded-card border border-navy-soft px-3 py-2 text-start text-xs text-neutral-bg/80", (used || oos) && "cursor-not-allowed opacity-40")}
                      >
                        {variant.modelLabel} ({variant.stock})
                      </button>
                    );
                  })}
                </div>
              )}
              {showColorStep && (
                <div className="flex flex-wrap gap-2 border-t border-navy-soft pt-2">
                  {product.colorOptions!.map((color) => {
                    const used = addedLineKeys.has(lineKey(product.id, color.id, pendingVariantId));
                    return (
                      <button
                        key={color.id}
                        type="button"
                        disabled={used}
                        onClick={() => {
                          onAdd(product, color.id, pendingVariantId);
                          closeExpanded();
                        }}
                        className={cn(
                          "flex items-center gap-1.5 rounded-full border border-navy-soft px-2.5 py-1 text-xs text-neutral-bg/80 transition-colors hover:border-gold-champagne/40",
                          used && "cursor-not-allowed opacity-40",
                        )}
                      >
                        {color.hexCode && (
                          <span
                            aria-hidden="true"
                            className="h-3 w-3 shrink-0 rounded-full border border-navy-soft"
                            style={{ backgroundColor: color.hexCode }}
                          />
                        )}
                        {color.nameAr ?? color.name} {used ? "(أُضيف)" : ""}
                      </button>
                    );
                  })}
                </div>
              )}

              {showDcBrandStep && (
                <div className="flex flex-wrap gap-2 border-t border-navy-soft pt-2">
                  {dcBrands.map(([brandId, brandLabel]) => (
                    <button
                      key={brandId}
                      type="button"
                      onClick={() => setPendingDcBrandId(brandId)}
                      className="rounded-card border border-navy-soft px-3 py-2 text-xs text-neutral-bg/80 hover:border-gold-champagne/40"
                    >
                      {brandLabel}
                    </button>
                  ))}
                </div>
              )}
              {showDcModelStep && (
                <div className="flex flex-wrap gap-2 border-t border-navy-soft pt-2">
                  {dcModelsForBrand.map(([modelId, modelLabel]) => (
                    <button
                      key={modelId}
                      type="button"
                      onClick={() => setPendingDcModelId(modelId)}
                      className="rounded-card border border-navy-soft px-3 py-2 text-xs text-neutral-bg/80 hover:border-gold-champagne/40"
                    >
                      {modelLabel}
                    </button>
                  ))}
                </div>
              )}
              {showDcColorStep && (
                <div className="flex flex-wrap gap-2 border-t border-navy-soft pt-2">
                  {dcColorsForModel.map((combo) => {
                    const used = addedLineKeys.has(lineKey(product.id, null, null, combo.id));
                    const oos = combo.stock <= 0;
                    return (
                      <button
                        key={combo.id}
                        type="button"
                        disabled={used || oos}
                        onClick={() => {
                          onAdd(product, null, null, combo.id);
                          closeExpanded();
                        }}
                        className={cn(
                          "flex items-center gap-1.5 rounded-full border border-navy-soft px-2.5 py-1 text-xs text-neutral-bg/80 transition-colors hover:border-gold-champagne/40",
                          (used || oos) && "cursor-not-allowed opacity-40",
                        )}
                      >
                        {combo.colorHex && (
                          <span
                            aria-hidden="true"
                            className="h-3 w-3 shrink-0 rounded-full border border-navy-soft"
                            style={{ backgroundColor: combo.colorHex }}
                          />
                        )}
                        {combo.colorLabel} ({combo.stock}) {used ? "(أُضيف)" : oos ? "— نفد" : ""}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
