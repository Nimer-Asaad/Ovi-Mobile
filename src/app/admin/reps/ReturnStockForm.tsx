"use client";

import { useActionState, useMemo, useState } from "react";
import { returnStockFromRep, type RepStockTransferState } from "./actions";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { ProductThumb } from "@/components/reps/ProductQuickPicker";

export interface ReturnVariantOption {
  id: string;
  label: string;
}

export interface ReturnDeviceComboOption {
  id: string;
  phoneBrandId: string;
  brandLabel: string;
  phoneModelId: string;
  modelLabel: string;
  colorId: string;
  colorLabel: string;
  colorHex: string | null;
}

export interface ReturnStockProductOption {
  id: string;
  sku: string;
  name: string;
  nameAr: string | null;
  thumbnailUrl: string | null;
  thumbnailAlt: string | null;
  /** This rep's car aggregate balance for the product — the ceiling on how
   * much of it can be returned in total (see the InventoryItem doc comment
   * in schema.prisma: REP_CAR no longer tracks a per-model breakdown, only
   * one plain number). */
  repStock: number;
  /** The product's own WAREHOUSE-side active phone-model variants — always
   * populated regardless of current warehouse quantity (a return only ever
   * ADDS to warehouse stock, so there's no availability ceiling to respect
   * here, unlike a sale or a car-load picker). Empty unless the product
   * uses PHONE_COMPATIBILITY. */
  variantOptions: ReturnVariantOption[];
  /** Same idea for DEVICE_MODEL_COLOR products — every active brand+model
   * +color combination. */
  deviceColorVariantOptions: ReturnDeviceComboOption[];
}

/** One selectable WAREHOUSE-side destination row inside a product's return
 * breakdown — never a rep-car row (the car side is always the one plain
 * aggregate number now). variantId/deviceColorVariantId mutually exclusive,
 * matching every other inventory-key convention in the app. */
interface BreakdownRow {
  key: string;
  productId: string;
  variantId: string | null;
  deviceColorVariantId: string | null;
  label: string;
}

interface ReturnProductGroup {
  key: string;
  product: ReturnStockProductOption;
  label: string;
  repStock: number;
  /** Exactly one plain row for a TOTAL_STOCK product (no variant/combo
   * system at all) — its stepper sits directly on the main card, no
   * breakdown popup needed at all (see needsBreakdown). */
  rows: BreakdownRow[];
  needsBreakdown: boolean;
}

function lineKey(productId: string, variantId: string | null, deviceColorVariantId: string | null): string {
  if (deviceColorVariantId) return `${productId}:combo:${deviceColorVariantId}`;
  if (variantId) return `${productId}:variant:${variantId}`;
  return `${productId}:plain`;
}

function buildReturnGroups(products: ReturnStockProductOption[]): ReturnProductGroup[] {
  return products
    .map((product) => {
      const rows: BreakdownRow[] =
        product.deviceColorVariantOptions.length > 0
          ? product.deviceColorVariantOptions.map((combo) => ({
              key: lineKey(product.id, null, combo.id),
              productId: product.id,
              variantId: null,
              deviceColorVariantId: combo.id,
              label: `${combo.brandLabel} / ${combo.modelLabel} / ${combo.colorLabel}`,
            }))
          : product.variantOptions.length > 0
            ? product.variantOptions.map((variant) => ({
                key: lineKey(product.id, variant.id, null),
                productId: product.id,
                variantId: variant.id,
                deviceColorVariantId: null,
                label: variant.label,
              }))
            : [{ key: lineKey(product.id, null, null), productId: product.id, variantId: null, deviceColorVariantId: null, label: product.nameAr ?? product.name }];

      return {
        key: product.id,
        product,
        label: product.nameAr ?? product.name,
        repStock: product.repStock,
        rows,
        needsBreakdown: product.deviceColorVariantOptions.length > 0 || product.variantOptions.length > 0,
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label, "ar"));
}

export interface ReturnSubmitLine {
  productId: string;
  quantity: number;
  breakdown: { variantId: string | null; deviceColorVariantId: string | null; quantity: number }[];
}

/** The exact payload returnStockFromRep expects (see repCarReturnSchema) —
 * one line per product being returned, `quantity` always exactly the sum of
 * its own `breakdown` (never computed differently client-side vs
 * server-side, so the server's own sum check can never legitimately fire
 * against a good-faith submission). */
function buildReturnSubmitLines(groups: ReturnProductGroup[], quantities: Record<string, number>): ReturnSubmitLine[] {
  const lines: ReturnSubmitLine[] = [];
  for (const group of groups) {
    const breakdown = group.rows
      .map((row) => ({ variantId: row.variantId, deviceColorVariantId: row.deviceColorVariantId, quantity: quantities[row.key] ?? 0 }))
      .filter((entry) => entry.quantity > 0);
    const quantity = breakdown.reduce((sum, entry) => sum + entry.quantity, 0);
    if (quantity <= 0) continue;
    lines.push({ productId: group.key, quantity, breakdown });
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

/** Breakdown popup for one product — "which exact warehouse model(s) is
 * this returned quantity being restored as." The remaining-to-assign cap
 * (repStock minus what's already assigned to the product's OTHER rows) is
 * enforced as each row's own stepper max, so the running total can never
 * exceed the car's aggregate balance for this product — never guessed,
 * always the admin's own explicit choice (see repCarReturnSchema's doc
 * comment for why this can't be automatic). Same fixed-overlay +
 * max-height + internal-scroll shell already used elsewhere in this app
 * (see ProductQuickPicker's detail modal) for a consistent, proven mobile
 * scroll behavior. */
function BreakdownModal({
  group,
  quantities,
  onQuantityChange,
  onClose,
}: {
  group: ReturnProductGroup;
  quantities: Record<string, number>;
  onQuantityChange: (rowKey: string, quantity: number) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const visibleRows = useMemo(() => {
    if (!normalizedQuery) return group.rows;
    return group.rows.filter((row) => row.label.toLowerCase().includes(normalizedQuery));
  }, [group.rows, normalizedQuery]);

  const assigned = group.rows.reduce((sum, row) => sum + (quantities[row.key] ?? 0), 0);
  const remaining = group.repStock - assigned;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" className="relative flex max-h-[85vh] w-full max-w-sm flex-col rounded-card border border-navy-soft bg-navy-surface shadow-card" onClick={(event) => event.stopPropagation()}>
        <button type="button" onClick={onClose} aria-label="إغلاق" className="absolute start-3 top-3 flex h-7 w-7 items-center justify-center rounded-full text-neutral-bg/60 transition-colors hover:bg-navy-deep hover:text-neutral-bg">
          ✕
        </button>

        <div className="shrink-0 px-5 pt-5">
          <ProductThumb product={group.product} className="mx-auto h-20 w-20" />
          <p className="mt-3 text-center text-base font-semibold text-neutral-bg">{group.label}</p>
          <p className="text-center text-xs text-neutral-bg/50">مخزون السيارة الحالي: {group.repStock}</p>
          <div className="mt-4">
            <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ابحث عن موديل الجهاز..." aria-label="ابحث عن موديل الجهاز" autoFocus />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-2">
          {visibleRows.length === 0 ? (
            <p className="py-6 text-center text-xs text-neutral-bg/50">لا توجد نتائج مطابقة</p>
          ) : (
            <div className="flex flex-col divide-y divide-navy-soft">
              {visibleRows.map((row) => {
                const rowQuantity = quantities[row.key] ?? 0;
                const rowMax = rowQuantity + Math.max(remaining, 0);
                return (
                  <div key={row.key} className="flex items-center gap-2 py-2">
                    <p className="min-w-0 flex-1 truncate text-sm text-neutral-bg">{row.label}</p>
                    <QuantityStepper quantity={rowQuantity} max={rowMax} onChange={(next) => onQuantityChange(row.key, next)} />
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="shrink-0 border-t border-navy-soft px-5 py-3">
          <p className="mb-2 text-center text-xs text-neutral-bg/60">
            تم توزيع {assigned} من {group.repStock} — المتبقي: {remaining}
          </p>
          <Button type="button" className="w-full" onClick={onClose}>
            تم
          </Button>
        </div>
      </div>
    </div>
  );
}

interface ReturnStockFormProps {
  repId: string;
  products: ReturnStockProductOption[];
}

const initialState: RepStockTransferState = {};

/** Rep-car -> warehouse return form. Because live REP_CAR balances are now
 * one plain aggregate number per product (see the InventoryItem doc
 * comment in schema.prisma), this is a two-step pick per product: how much
 * is leaving the car (a plain product simply has one stepper — see
 * needsBreakdown), then — for a product that uses phone models/colors at
 * the warehouse — exactly which of those models the returned quantity is
 * physically being restored as. The two steps are unified in this form's
 * own state: a product's "how much to return" is always just the sum of
 * its own breakdown rows, so they can never legitimately disagree the way
 * two independently-typed numbers could. */
export function ReturnStockForm({ repId, products }: ReturnStockFormProps) {
  const action = returnStockFromRep.bind(null, repId);
  const [state, formAction, isPending] = useActionState(action, initialState);

  const groups = useMemo(() => buildReturnGroups(products), [products]);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [search, setSearch] = useState("");
  const [openProductKey, setOpenProductKey] = useState<string | null>(null);
  const [notes, setNotes] = useState("");

  function handleQuantityChange(rowKey: string, quantity: number) {
    setQuantities((prev) => ({ ...prev, [rowKey]: quantity }));
  }

  function totalFor(group: ReturnProductGroup): number {
    return group.rows.reduce((sum, row) => sum + (quantities[row.key] ?? 0), 0);
  }

  const normalizedSearch = search.trim().toLowerCase();
  const visibleGroups = useMemo(() => {
    const selected = groups.filter((group) => totalFor(group) > 0);
    if (!normalizedSearch) return selected;
    const matches = groups.filter((group) => group.label.toLowerCase().includes(normalizedSearch) || group.product.sku.toLowerCase().includes(normalizedSearch));
    const matchKeys = new Set(matches.map((group) => group.key));
    const selectedNotMatched = selected.filter((group) => !matchKeys.has(group.key));
    return [...selectedNotMatched, ...matches];
    // eslint-disable-next-line react-hooks/exhaustive-deps -- totalFor reads `quantities`, already a dep below
  }, [groups, normalizedSearch, quantities]);

  const openGroup = groups.find((group) => group.key === openProductKey) ?? null;

  const submitLines = useMemo(() => buildReturnSubmitLines(groups, quantities), [groups, quantities]);
  const totalPieces = submitLines.reduce((sum, line) => sum + line.quantity, 0);

  const returnsJson = useMemo(() => JSON.stringify(submitLines), [submitLines]);

  if (products.length === 0) {
    return <p className="text-sm text-neutral-bg/60">لا يملك هذا المندوب أي مخزون قابل للإرجاع حالياً.</p>;
  }

  return (
    <form action={formAction} className="flex max-w-xl flex-col gap-4">
      <input type="hidden" name="returns" value={returnsJson} />

      <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ابحث عن منتج لإرجاعه..." aria-label="ابحث عن منتج لإرجاعه" />

      {visibleGroups.length === 0 ? (
        <p className="py-3 text-center text-xs text-neutral-bg/50">{normalizedSearch ? "لا توجد نتائج مطابقة" : "ابحث عن صنف لإرجاعه"}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {visibleGroups.map((group) => {
            const total = totalFor(group);
            const singleRow = !group.needsBreakdown ? group.rows[0] : undefined;
            return (
              <div key={group.key} className="flex flex-col gap-1 rounded-card border border-navy-soft bg-navy-deep/40 p-3">
                <div className="flex items-center gap-3">
                  <ProductThumb product={group.product} className="h-11 w-11" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-neutral-bg">{group.label}</p>
                    <p className="text-xs text-neutral-bg/50">{group.product.sku} — مخزون السيارة الحالي: {group.repStock}</p>
                  </div>
                  {singleRow ? (
                    <QuantityStepper quantity={quantities[singleRow.key] ?? 0} max={group.repStock} onChange={(next) => handleQuantityChange(singleRow.key, next)} />
                  ) : (
                    <Button type="button" variant="outline" size="sm" onClick={() => setOpenProductKey(group.key)}>
                      {total > 0 ? "تعديل التوزيع" : "توزيع الإرجاع"}
                    </Button>
                  )}
                </div>
                {group.needsBreakdown && total > 0 && <p className="text-xs text-neutral-bg/60">مرتجَع: {total} قطعة</p>}
              </div>
            );
          })}
        </div>
      )}

      {openGroup && <BreakdownModal key={openGroup.key} group={openGroup} quantities={quantities} onQuantityChange={handleQuantityChange} onClose={() => setOpenProductKey(null)} />}

      <Textarea name="notes" label="ملاحظات / السبب (اختياري)" rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} />

      {state.error && (
        <p className="text-sm text-rose-600" role="alert">
          {state.error}
        </p>
      )}

      <Button type="submit" variant="outline" disabled={isPending || totalPieces === 0}>
        {isPending && <Spinner />}
        {isPending ? "جارٍ الحفظ..." : `إرجاع المخزون${totalPieces > 0 ? ` (${totalPieces})` : ""}`}
      </Button>
    </form>
  );
}
