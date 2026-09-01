"use client";

import { useMemo, useState } from "react";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import type { CompanyInventoryReportData, CompanyInventoryReportRow } from "@/lib/company-inventory-report";
import styles from "./CompanyInventoryReportView.module.css";

export interface CompanyInventoryReportViewProps {
  data: CompanyInventoryReportData;
}

interface NumberedRow extends CompanyInventoryReportRow {
  number: number;
}

interface NumberedCategory {
  categoryId: string | null;
  categoryLabel: string;
  rows: NumberedRow[];
}

const UNCATEGORIZED_VALUE = "__NONE__";

function matchesSearch(row: CompanyInventoryReportRow, normalizedSearch: string): boolean {
  if (!normalizedSearch) return true;
  return (
    row.name.toLowerCase().includes(normalizedSearch) ||
    (row.nameAr ?? "").toLowerCase().includes(normalizedSearch) ||
    row.sku.toLowerCase().includes(normalizedSearch)
  );
}

/** Printable, read-only company inventory report — every number here is a
 * pre-computed field already handed down from getCompanyInventoryReport
 * (server-side, sourced from InventoryItem rows via two Prisma groupBy
 * sums). This component only filters/numbers/renders those numbers for
 * display and print; it never recomputes stock itself and never calls a
 * mutation of any kind.
 *
 * The search box and category filter are screen-only conveniences (client
 * state, no extra fetch) — printing always prints exactly what's currently
 * visible on screen, since window.print() simply prints the rendered DOM. */
export function CompanyInventoryReportView({ data }: CompanyInventoryReportViewProps) {
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");

  const categoryOptions = useMemo(
    () => data.categories.map((category) => ({ value: category.categoryId ?? UNCATEGORIZED_VALUE, label: category.categoryLabel })),
    [data.categories],
  );

  const normalizedSearch = search.trim().toLowerCase();

  // Filter first, then number every visible row exactly once, in one pass —
  // a plain computed value, never a mutation performed during render of a
  // child component.
  const numberedCategories: NumberedCategory[] = useMemo(() => {
    let counter = 0;
    return data.categories
      .filter((category) => !categoryFilter || (category.categoryId ?? UNCATEGORIZED_VALUE) === categoryFilter)
      .map((category) => {
        const rows: NumberedRow[] = category.rows
          .filter((row) => matchesSearch(row, normalizedSearch))
          .map((row) => ({ ...row, number: ++counter }));
        return { categoryId: category.categoryId, categoryLabel: category.categoryLabel, rows };
      })
      .filter((category) => category.rows.length > 0);
  }, [data.categories, categoryFilter, normalizedSearch]);

  // Summary numbers reflect whatever is currently filtered/visible — the
  // printed report always matches the printed table exactly, never a
  // separate "full company" figure hidden behind an active filter.
  const summary = useMemo(() => {
    let itemCount = 0;
    let totalWarehouseStock = 0;
    let totalRepStock = 0;
    for (const category of numberedCategories) {
      for (const row of category.rows) {
        itemCount += 1;
        totalWarehouseStock += row.warehouseStock;
        totalRepStock += row.repStock;
      }
    }
    return { itemCount, totalWarehouseStock, totalRepStock, totalCompanyStock: totalWarehouseStock + totalRepStock };
  }, [numberedCategories]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3 print:hidden">
        <div className="flex flex-wrap items-end gap-3">
          <Input
            label="ابحث بالاسم أو الكود"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="اسم الصنف أو الكود..."
            className="w-64"
          />
          <Select label="القسم" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} className="w-56">
            <option value="">كل الأقسام</option>
            {categoryOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </div>
        <Button type="button" onClick={() => window.print()}>
          طباعة الكشف
        </Button>
      </div>

      <div className="mx-auto w-full rounded-card border border-neutral-200 bg-white p-8 text-neutral-900 shadow-sm print:m-0 print:max-w-none print:border-0 print:p-0 print:shadow-none">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-neutral-200 pb-6">
          <div>
            <h1 className="text-2xl font-bold text-neutral-900">Ovi Mobile</h1>
            <p className="mt-1 text-lg font-semibold text-neutral-800">كشف مخزون الشركة</p>
            <p className="mt-1 text-sm text-neutral-500">
              تاريخ الطباعة: {data.generatedAt.toLocaleDateString("ar")} — {data.generatedAt.toLocaleTimeString("ar")}
            </p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-card border border-neutral-200 bg-neutral-50 p-3 text-center">
            <p className="text-xs text-neutral-500">عدد الأصناف</p>
            <p className="mt-1 text-lg font-bold text-neutral-900">{summary.itemCount}</p>
          </div>
          <div className="rounded-card border border-neutral-200 bg-neutral-50 p-3 text-center">
            <p className="text-xs text-neutral-500">إجمالي مخزون المستودع</p>
            <p className="mt-1 text-lg font-bold text-neutral-900">{summary.totalWarehouseStock}</p>
          </div>
          <div className="rounded-card border border-neutral-200 bg-neutral-50 p-3 text-center">
            <p className="text-xs text-neutral-500">إجمالي مخزون المندوبين</p>
            <p className="mt-1 text-lg font-bold text-neutral-900">{summary.totalRepStock}</p>
          </div>
          <div className="rounded-card border border-neutral-200 bg-neutral-50 p-3 text-center">
            <p className="text-xs text-neutral-500">إجمالي مخزون الشركة</p>
            <p className="mt-1 text-lg font-bold text-neutral-900">{summary.totalCompanyStock}</p>
          </div>
        </div>

        {numberedCategories.length === 0 ? (
          <p className="mt-8 text-center text-sm text-neutral-500">لا توجد أصناف مطابقة</p>
        ) : (
          <div className="mt-6 overflow-x-auto">
            <table className="w-full border-collapse text-start text-sm">
              <thead className={`${styles.repeatHeader} border-b border-neutral-300 text-xs font-semibold uppercase tracking-wide text-neutral-500`}>
                <tr>
                  <th className="py-2 pe-2 text-start">#</th>
                  <th className="py-2 pe-2 text-start">الصورة</th>
                  <th className="py-2 pe-2 text-start">اسم الصنف</th>
                  <th className="py-2 pe-2 text-start">الكود</th>
                  <th className="py-2 pe-2 text-start">مخزون المستودع</th>
                  <th className="py-2 pe-2 text-start">مع المندوبين</th>
                  <th className="py-2 text-start">إجمالي الشركة</th>
                </tr>
              </thead>
              <tbody>
                {numberedCategories.map((category) => (
                  <CategorySection key={category.categoryId ?? UNCATEGORIZED_VALUE} label={category.categoryLabel} rows={category.rows} />
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-8 text-center text-xs text-neutral-400">كشف داخلي للقراءة فقط — لا يعكس أي قيمة مالية</p>
      </div>
    </div>
  );
}

/** One category section — a heading row followed by its already-numbered
 * product rows. Pure rendering only, no state/side effects. */
function CategorySection({ label, rows }: { label: string; rows: NumberedRow[] }) {
  return (
    <>
      <tr className={`${styles.avoidBreak} bg-neutral-50`}>
        <td className="py-2 font-semibold text-neutral-800" colSpan={7}>
          {label}
        </td>
      </tr>
      {rows.map((row) => {
        const isZero = row.companyTotal === 0;
        return (
          <tr key={row.id} className={`${styles.avoidBreak} border-b border-neutral-100 ${isZero ? "text-neutral-400" : "text-neutral-900"}`}>
            <td className="py-2 pe-2 align-middle">{row.number}</td>
            <td className="py-2 pe-2 align-middle">
              <div className="flex h-11 w-11 items-center justify-center overflow-hidden rounded border border-neutral-200 bg-white">
                {row.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- arbitrary admin-entered external URLs, printable report renders a plain img
                  <img src={row.thumbnailUrl} alt={row.thumbnailAlt ?? row.name} className="h-full w-full object-contain" loading="lazy" />
                ) : (
                  <span className="text-sm text-neutral-300">—</span>
                )}
              </div>
            </td>
            <td className="max-w-xs py-2 pe-2 align-middle">
              <p className="whitespace-normal break-words font-medium leading-snug">
                {row.nameAr ?? row.name}
                {!row.isActive && <span className="ms-2 text-xs font-normal text-neutral-400">غير مفعّل</span>}
              </p>
            </td>
            <td className="py-2 pe-2 align-middle whitespace-normal break-words">{row.sku}</td>
            <td className="py-2 pe-2 align-middle font-medium">{row.warehouseStock}</td>
            <td className="py-2 pe-2 align-middle font-medium">{row.repStock}</td>
            <td className="py-2 align-middle font-semibold">{row.companyTotal}</td>
          </tr>
        );
      })}
    </>
  );
}
