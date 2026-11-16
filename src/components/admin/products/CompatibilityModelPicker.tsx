"use client";

import { useMemo, useState } from "react";
import { Select } from "@/components/ui/Select";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import type { CompatibilityBrandOption } from "@/lib/product-phone-compatibility";

export interface CompatibilityModelPickerProps {
  brands: CompatibilityBrandOption[];
  /** Selected PhoneModel ids — kept across brand changes, so models of several brands can be combined. */
  selected: string[];
  onChange: (ids: string[]) => void;
  /** Models to mark as "already linked" (read-only hint, still selectable). */
  linkedModelIds?: ReadonlySet<string>;
}

/** Brand → models multi-picker shared by the per-product section and the bulk
 * page. Purely a selector: it holds no data of its own and never talks to the
 * server — the parent submits the selected ids. */
export function CompatibilityModelPicker({ brands, selected, onChange, linkedModelIds }: CompatibilityModelPickerProps) {
  const [brandId, setBrandId] = useState("");
  const [filter, setFilter] = useState("");

  const labelById = useMemo(() => new Map(brands.flatMap((brand) => brand.models.map((model) => [model.id, `${brand.label} — ${model.label}`] as const))), [brands]);
  const brand = brands.find((candidate) => candidate.id === brandId);
  const visibleModels = useMemo(() => {
    const query = filter.trim().toLowerCase();
    return (brand?.models ?? []).filter((model) => !query || model.label.toLowerCase().includes(query));
  }, [brand, filter]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  function toggle(id: string) {
    onChange(selectedSet.has(id) ? selected.filter((value) => value !== id) : [...selected, id]);
  }
  function selectVisible() {
    onChange([...new Set([...selected, ...visibleModels.map((model) => model.id)])]);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Select label="الماركة" value={brandId} onChange={(event) => { setBrandId(event.target.value); setFilter(""); }}>
          <option value="">— اختر الماركة —</option>
          {brands.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.label}
            </option>
          ))}
        </Select>
        <Input label="بحث في الموديلات" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="مثال: 17 pro" disabled={!brand} />
      </div>

      {brand && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={selectVisible} disabled={visibleModels.length === 0}>
              تحديد المعروض ({visibleModels.length})
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => onChange(selected.filter((id) => !visibleModels.some((model) => model.id === id)))}>
              إلغاء تحديد المعروض
            </Button>
          </div>
          <div className="grid max-h-56 grid-cols-1 gap-1 overflow-y-auto rounded-card border border-navy-soft bg-navy-deep p-2 sm:grid-cols-2">
            {visibleModels.length === 0 ? (
              <p className="p-2 text-xs text-neutral-bg/50">لا توجد موديلات مطابقة</p>
            ) : (
              visibleModels.map((model) => (
                <label key={model.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm text-neutral-bg hover:bg-navy-soft/40">
                  <input type="checkbox" className="h-4 w-4" checked={selectedSet.has(model.id)} onChange={() => toggle(model.id)} />
                  <span className="min-w-0 flex-1 truncate">{model.label}</span>
                  {linkedModelIds?.has(model.id) && <span className="text-[10px] text-emerald-500">مربوط</span>}
                </label>
              ))
            )}
          </div>
        </>
      )}

      <div className="flex flex-wrap items-center gap-2" aria-live="polite">
        <span className="text-xs text-neutral-bg/60">الموديلات المحددة: {selected.length}</span>
        {selected.slice(0, 12).map((id) => (
          <button key={id} type="button" onClick={() => toggle(id)} className="rounded-full border border-gold-champagne/40 px-2 py-0.5 text-[11px] text-gold-dark hover:bg-gold-champagne/10" title="إزالة من التحديد">
            {labelById.get(id) ?? id} ✕
          </button>
        ))}
        {selected.length > 12 && <span className="text-xs text-neutral-bg/50">+ {selected.length - 12}</span>}
        {selected.length > 0 && (
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange([])}>
            مسح كل التحديد
          </Button>
        )}
      </div>
    </div>
  );
}
