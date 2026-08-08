"use client";

import { useActionState, useMemo, useState } from "react";
import { adjustVariantInventory, allocateLegacyInventory, saveProductVariants, type VariantActionState } from "./actions";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";

type DeviceBrand = { id: string; name: string; nameAr: string | null; models: { id: string; name: string; nameAr: string | null }[] };
type VariantRow = { id?: string; phoneModelId: string; variantCode: string; isActive: boolean };
type LegacyRow = { id: string; locationName: string; quantity: number };
type VariantStock = VariantRow & { id: string; label: string; stock: number };

const initial: VariantActionState = {};
const rowKey = () => `new-${crypto.randomUUID()}`;

export function VariantManager({ productId, brands, initialVariants, legacyRows, variantStocks, inventoryReady }: { productId: string; brands: DeviceBrand[]; initialVariants: VariantRow[]; legacyRows: LegacyRow[]; variantStocks: VariantStock[]; inventoryReady: boolean }) {
  const [rows, setRows] = useState<(VariantRow & { key: string })[]>(initialVariants.map((row) => ({ ...row, key: row.id! })));
  const [saveState, saveAction, saving] = useActionState(saveProductVariants.bind(null, productId), initial);
  const [allocationState, allocationAction, allocating] = useActionState(allocateLegacyInventory.bind(null, productId), initial);
  const [stockState, stockAction, stocking] = useActionState(adjustVariantInventory.bind(null, productId), initial);
  const [stockValues, setStockValues] = useState<Record<string, number>>(() => Object.fromEntries(variantStocks.map((row) => [row.id, row.stock])));
  const [sourceId, setSourceId] = useState(legacyRows[0]?.id ?? "");
  const [allocations, setAllocations] = useState<Record<string, number>>({});
  const modelMap = useMemo(() => new Map(brands.flatMap((brand) => brand.models.map((model) => [model.id, { ...model, brand }]))), [brands]);
  const source = legacyRows.find((row) => row.id === sourceId);
  // Every active variant is an eligible allocation target — the legacy
  // balance was never color-split (color has no bearing on inventory).
  const eligibleStocks = variantStocks;
  const allocationPayload = Object.entries(allocations).filter(([, quantity]) => quantity > 0).map(([variantId, quantity]) => ({ variantId, quantity }));
  const allocationTotal = allocationPayload.reduce((sum, row) => sum + row.quantity, 0);

  function updateRow(key: string, patch: Partial<VariantRow>) { setRows((current) => current.map((row) => row.key === key ? { ...row, ...patch } : row)); }
  function addRow() { const firstModel = brands.flatMap((brand) => brand.models)[0]; if (firstModel) setRows((current) => [...current, { key: rowKey(), phoneModelId: firstModel.id, variantCode: "", isActive: true }]); }

  return <div className="space-y-8">
    <form action={saveAction} className="space-y-4">
      <input type="hidden" name="variants" value={JSON.stringify(rows.map((row) => ({ id: row.id, phoneModelId: row.phoneModelId, variantCode: row.variantCode, isActive: row.isActive })))} />
      <div className="overflow-x-auto rounded-card border border-navy-soft"><table className="w-full text-sm"><thead className="bg-navy-soft/30 text-neutral-bg/70"><tr><th className="px-3 py-3 text-start">الماركة</th><th className="px-3 py-3 text-start">الموديل</th><th className="px-3 py-3 text-start">SKU / Variant Code</th><th className="px-3 py-3">فعال</th><th /></tr></thead>
        <tbody className="divide-y divide-navy-soft bg-navy-surface">{rows.map((row) => { const selected = modelMap.get(row.phoneModelId); return <tr key={row.key}>
          <td className="px-3 py-2"><Select value={selected?.brand.id ?? ""} onChange={(event) => { const model = brands.find((brand) => brand.id === event.target.value)?.models[0]; if (model) updateRow(row.key, { phoneModelId: model.id }); }}><option value="">اختر</option>{brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.nameAr ?? brand.name}</option>)}</Select></td>
          <td className="px-3 py-2"><Select value={row.phoneModelId} onChange={(event) => updateRow(row.key, { phoneModelId: event.target.value })}>{(selected?.brand.models ?? brands.flatMap((brand) => brand.models)).map((model) => <option key={model.id} value={model.id}>{model.nameAr ?? model.name}</option>)}</Select></td>
          <td className="px-3 py-2"><Input value={row.variantCode} onChange={(event) => updateRow(row.key, { variantCode: event.target.value })} placeholder="اختياري" /></td>
          <td className="px-3 py-2 text-center"><input type="checkbox" checked={row.isActive} onChange={(event) => updateRow(row.key, { isActive: event.target.checked })} /></td>
          <td className="px-3 py-2"><Button type="button" variant="ghost" size="sm" onClick={() => row.id ? updateRow(row.key, { isActive: false }) : setRows((current) => current.filter((item) => item.key !== row.key))}>{row.id ? "أرشفة" : "حذف"}</Button></td>
        </tr>; })}{rows.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-neutral-bg/50">لا توجد Variants بعد.</td></tr>}</tbody></table></div>
      <div className="flex flex-wrap gap-3"><Button type="button" variant="secondary" onClick={addRow}>إضافة صف Variant</Button><Button disabled={saving || rows.length === 0}>{saving ? "جارٍ الحفظ..." : "حفظ الـVariants"}</Button></div>
      {saveState.error && <p className="text-sm text-rose-500">{saveState.error}</p>}{saveState.success && <p className="text-sm text-emerald-500">{saveState.success}</p>}
    </form>

    <form action={stockAction} className="space-y-4 rounded-card border border-navy-soft bg-navy-surface p-5">
      <input type="hidden" name="adjustments" value={JSON.stringify(variantStocks.filter((row) => stockValues[row.id] !== row.stock).map((row) => ({ variantId: row.id, quantity: stockValues[row.id] ?? 0 })))} />
      <div><h3 className="font-semibold text-neutral-bg">جرد مخزون الـVariants في المستودع الرئيسي</h3><p className="mt-1 text-sm text-neutral-bg/60">كل كمية مستقلة حسب موديل الجهاز فقط (اللون لا يؤثر على المخزون)، ويُفتح الجرد بعد اعتماد توزيع الرصيد القديم.</p></div>
      <div className="grid gap-3 md:grid-cols-2">{variantStocks.filter((row) => row.isActive).map((row) => <label key={row.id} className="rounded-card border border-navy-soft p-3 text-sm text-neutral-bg"><span className="mb-2 block">{row.label}</span><input type="number" min={0} disabled={!inventoryReady} value={stockValues[row.id] ?? 0} onChange={(event) => setStockValues((current) => ({ ...current, [row.id]: Math.max(0, Math.floor(Number(event.target.value) || 0)) }))} className="h-9 w-28 rounded-card border border-navy-soft bg-navy-deep px-2" /></label>)}</div>
      <Button disabled={!inventoryReady || stocking || !variantStocks.some((row) => stockValues[row.id] !== row.stock)}>{stocking ? "جارٍ الحفظ..." : "حفظ جرد الـVariants"}</Button>
      {!inventoryReady && <p className="text-xs text-amber-400">أكمل التوزيع اليدوي واعتمده أولاً.</p>}{stockState.error && <p className="text-sm text-rose-500">{stockState.error}</p>}{stockState.success && <p className="text-sm text-emerald-500">{stockState.success}</p>}
    </form>

    <form action={allocationAction} className="space-y-4 rounded-card border border-amber-500/40 bg-navy-surface p-5">
      <input type="hidden" name="sourceInventoryItemId" value={sourceId} /><input type="hidden" name="allocations" value={JSON.stringify(allocationPayload)} />
      <div><h3 className="font-semibold text-neutral-bg">توزيع المخزون القديم يدوياً</h3><p className="mt-1 text-sm text-neutral-bg/60">لا يتم نسخ أو تصفير أي رصيد. الكمية تُنقل من صف قديم إلى Variants داخل عملية واحدة.</p></div>
      <Select label="مصدر الرصيد القديم" value={sourceId} onChange={(event) => { setSourceId(event.target.value); setAllocations({}); }}><option value="">اختر الرصيد</option>{legacyRows.map((row) => <option key={row.id} value={row.id}>{row.locationName} — {row.quantity} حبة</option>)}</Select>
      {source && <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-neutral-bg/60"><th className="px-2 py-2 text-start">Variant</th><th className="px-2 py-2 text-start">المخزون الحالي</th><th className="px-2 py-2 text-start">كمية التوزيع</th></tr></thead><tbody>{eligibleStocks.map((variant) => <tr key={variant.id} className="border-t border-navy-soft"><td className="px-2 py-2 text-neutral-bg">{variant.label}</td><td className="px-2 py-2 text-neutral-bg/70">{variant.stock}</td><td className="px-2 py-2"><input type="number" min={0} value={allocations[variant.id] ?? 0} onChange={(event) => setAllocations((current) => ({ ...current, [variant.id]: Math.max(0, Math.floor(Number(event.target.value) || 0)) }))} className="h-9 w-24 rounded-card border border-navy-soft bg-navy-deep px-2 text-neutral-bg" /></td></tr>)}</tbody></table></div>}
      {source && <p className={allocationTotal > source.quantity ? "text-sm text-rose-500" : "text-sm text-neutral-bg/70"}>الموزع: {allocationTotal} — المتبقي بعد العملية: {source.quantity - allocationTotal}</p>}
      <Button disabled={allocating || !source || allocationTotal < 1 || allocationTotal > (source?.quantity ?? 0)}>{allocating ? "جارٍ التوزيع..." : "تنفيذ التوزيع اليدوي"}</Button>
      {allocationState.error && <p className="text-sm text-rose-500">{allocationState.error}</p>}{allocationState.success && <p className="text-sm text-emerald-500">{allocationState.success}</p>}
    </form>
  </div>;
}
