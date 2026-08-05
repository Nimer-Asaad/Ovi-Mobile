"use client";

import { useActionState, useMemo, useState } from "react";
import { bulkAdjustColorInventory, type ColorInventoryBulkAdjustState } from "./actions";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { cn } from "@/lib/utils";

export interface ColorInventoryColumn {
  id: string;
  name: string;
  nameAr: string | null;
  hexCode: string | null;
}

export interface ColorInventoryRow {
  id: string;
  sku: string;
  name: string;
  nameAr: string | null;
  /** Which columns this product actually offers — other columns render as
   * a blank, non-editable cell for this row. */
  colorIds: string[];
  quantities: Record<string, number>;
}

interface ColorInventoryGridProps {
  rows: ColorInventoryRow[];
  columns: ColorInventoryColumn[];
}

const initialState: ColorInventoryBulkAdjustState = {};

function cellKey(productId: string, colorId: string): string {
  return `${productId}:${colorId}`;
}

/** Client-side "spreadsheet": every cell starts at its current warehouse
 * quantity, only cells the admin actually changes are sent to the server
 * (diffed against the initial snapshot), submitted as one JSON hidden
 * field — same convention as ManualOrderForm's line-array pattern. */
export function ColorInventoryGrid({ rows, columns }: ColorInventoryGridProps) {
  const [state, formAction, isPending] = useActionState(bulkAdjustColorInventory, initialState);

  const initialValues = useMemo(() => {
    const map: Record<string, number> = {};
    for (const row of rows) {
      for (const colorId of row.colorIds) {
        map[cellKey(row.id, colorId)] = row.quantities[colorId] ?? 0;
      }
    }
    return map;
  }, [rows]);

  const [values, setValues] = useState<Record<string, number>>(initialValues);
  const [search, setSearch] = useState("");

  function handleChange(productId: string, colorId: string, value: string) {
    const quantity = Math.max(0, Math.floor(Number(value) || 0));
    setValues((prev) => ({ ...prev, [cellKey(productId, colorId)]: quantity }));
  }

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter(
      (row) =>
        row.sku.toLowerCase().includes(query) ||
        row.name.toLowerCase().includes(query) ||
        (row.nameAr ?? "").toLowerCase().includes(query),
    );
  }, [rows, search]);

  const changedKeys = useMemo(
    () => Object.keys(values).filter((key) => initialValues[key] !== values[key]),
    [values, initialValues],
  );

  const cellsJson = useMemo(
    () =>
      JSON.stringify(
        changedKeys.map((key) => {
          const [productId, colorId] = key.split(":");
          return { productId, colorId, quantity: values[key] };
        }),
      ),
    [changedKeys, values],
  );

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="cells" value={cellsJson} />

      <Input
        placeholder="ابحث بالاسم أو رمز المنتج (SKU)..."
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />

      <div className="overflow-x-auto rounded-card border border-navy-soft">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-navy-soft/30 text-xs font-semibold uppercase tracking-wide text-neutral-bg/60">
            <tr>
              <th className="sticky start-0 z-10 bg-navy-soft/30 px-4 py-3 text-start">المنتج</th>
              {columns.map((color) => (
                <th key={color.id} className="whitespace-nowrap px-3 py-3 text-center">
                  <span className="flex items-center justify-center gap-1.5">
                    {color.hexCode && (
                      <span
                        aria-hidden="true"
                        className="h-3 w-3 rounded-full border border-navy-soft"
                        style={{ backgroundColor: color.hexCode }}
                      />
                    )}
                    {color.nameAr ?? color.name}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-navy-soft bg-navy-surface">
            {filteredRows.map((row) => (
              <tr key={row.id}>
                <td className="sticky start-0 z-10 bg-navy-surface px-4 py-2">
                  <p className="whitespace-nowrap text-neutral-bg">{row.nameAr ?? row.name}</p>
                  <p className="text-xs text-neutral-bg/50">{row.sku}</p>
                </td>
                {columns.map((color) => {
                  if (!row.colorIds.includes(color.id)) {
                    return (
                      <td key={color.id} className="px-3 py-2 text-center text-neutral-bg/30">
                        —
                      </td>
                    );
                  }
                  const key = cellKey(row.id, color.id);
                  const changed = initialValues[key] !== values[key];
                  return (
                    <td key={color.id} className="px-2 py-2">
                      <input
                        type="number"
                        min={0}
                        value={values[key] ?? 0}
                        onChange={(event) => handleChange(row.id, color.id, event.target.value)}
                        aria-label={`الكمية — ${row.nameAr ?? row.name} — ${color.nameAr ?? color.name}`}
                        className={cn(
                          "h-9 w-20 rounded-card border bg-navy-deep px-2 text-center text-sm text-neutral-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-champagne",
                          changed ? "border-gold-champagne" : "border-navy-soft",
                        )}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
            {filteredRows.length === 0 && (
              <tr>
                <td colSpan={columns.length + 1} className="px-4 py-8 text-center text-neutral-bg/60">
                  لا توجد نتائج
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {state.error && (
        <p className="text-sm text-rose-600" role="alert">
          {state.error}
        </p>
      )}
      {state.success && <p className="text-sm text-emerald-600">{state.success}</p>}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={isPending || changedKeys.length === 0}>
          {isPending && <Spinner />}
          {isPending ? "جارٍ الحفظ..." : `حفظ (${changedKeys.length} تعديل)`}
        </Button>
        {changedKeys.length > 0 && (
          <span className="text-xs text-neutral-bg/50">{changedKeys.length} خلية معدّلة</span>
        )}
      </div>
    </form>
  );
}
