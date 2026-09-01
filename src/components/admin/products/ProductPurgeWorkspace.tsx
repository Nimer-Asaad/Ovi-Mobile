"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import {
  PRODUCT_DEPENDENCY_LABELS,
  EMPTY_PARENT_LABELS,
  PURGE_CONFIRMATION_PHRASE,
  type ProductPurgeDependencyCounts,
  type ProductPurgeRowSummary,
  type EmptyParentCounts,
} from "@/lib/product-purge-shared";
import {
  searchProductsForPurge,
  getProductPurgePreview,
  purgeProductsPermanently,
  type ProductPurgeSearchRow,
  type ProductPurgeActionState,
} from "@/app/admin/products/purge/actions";

export interface ProductPurgeWorkspaceProps {
  categories: { id: string; label: string }[];
}

type View = "select" | "preview" | "result";

const SEARCH_DEBOUNCE_MS = 300;

function DependencyCountList({ counts }: { counts: ProductPurgeDependencyCounts }) {
  const entries = (Object.keys(PRODUCT_DEPENDENCY_LABELS) as (keyof ProductPurgeDependencyCounts)[]).map((key) => ({
    key,
    label: PRODUCT_DEPENDENCY_LABELS[key],
    count: counts[key],
  }));
  return (
    <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
      {entries.map((entry) => (
        <li key={entry.key} className="flex items-center justify-between gap-2 rounded-card border border-navy-soft bg-navy-deep/40 px-3 py-1.5 text-sm">
          <span className="text-neutral-bg/70">{entry.label}</span>
          <span className={`font-semibold ${entry.count > 0 ? "text-neutral-bg" : "text-neutral-bg/40"}`}>{entry.count}</span>
        </li>
      ))}
    </ul>
  );
}

function EmptyParentCountList({ counts, protectedAccountLinkedOrders }: { counts: EmptyParentCounts; protectedAccountLinkedOrders: number }) {
  const entries = (Object.keys(EMPTY_PARENT_LABELS) as (keyof EmptyParentCounts)[]).map((key) => ({
    key,
    label: EMPTY_PARENT_LABELS[key],
    count: counts[key],
  }));
  const totalEmptyParents = entries.reduce((sum, entry) => sum + entry.count, 0);
  return (
    <div className="flex flex-col gap-2">
      {totalEmptyParents === 0 ? (
        <p className="text-sm text-neutral-bg/50">لا توجد سجلات فارغة سيتم حذفها بالكامل</p>
      ) : (
        <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {entries.map((entry) => (
            <li key={entry.key} className="flex items-center justify-between gap-2 rounded-card border border-amber-500/30 bg-amber-500/5 px-3 py-1.5 text-sm">
              <span className="text-neutral-bg/70">{entry.label}</span>
              <span className={`font-semibold ${entry.count > 0 ? "text-amber-300" : "text-neutral-bg/40"}`}>{entry.count}</span>
            </li>
          ))}
        </ul>
      )}
      {protectedAccountLinkedOrders > 0 && (
        <p className="rounded-card border border-navy-soft bg-navy-deep/40 px-3 py-2 text-xs text-neutral-bg/60">
          تعذر حذف {protectedAccountLinkedOrders} طلب مرتبط بالحساب لأن النظام لا يربط الدفعة بطلب محدد بشكل يسمح بالحذف الآمن — سيبقى كسجل تاريخي فارغ للحفاظ على رصيد الحساب صحيحاً.
        </p>
      )}
    </div>
  );
}

/** Permanent bulk product purge workspace — the entire feature's UI in one
 * client component: search/select, then a destructive preview + typed
 * confirmation, then a post-purge audit summary. Every number shown is
 * either a fresh server read (search results, preview) or the literal
 * server response from the purge action itself — nothing here computes or
 * guesses inventory/dependency counts client-side. */
export function ProductPurgeWorkspace({ categories }: ProductPurgeWorkspaceProps) {
  const [view, setView] = useState<View>("select");

  // --- Selection screen state ---
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<ProductPurgeSearchRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Map<string, ProductPurgeSearchRow>>(new Map());
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);

  // --- Preview screen state ---
  const [previewRows, setPreviewRows] = useState<ProductPurgeRowSummary[]>([]);
  const [previewDependencies, setPreviewDependencies] = useState<ProductPurgeDependencyCounts | null>(null);
  const [previewTotalUnits, setPreviewTotalUnits] = useState(0);
  const [previewEmptyParents, setPreviewEmptyParents] = useState<EmptyParentCounts | null>(null);
  const [previewProtectedAccountLinkedOrders, setPreviewProtectedAccountLinkedOrders] = useState(0);
  const [confirmText, setConfirmText] = useState("");
  const [purging, setPurging] = useState(false);
  const [purgeError, setPurgeError] = useState<string | null>(null);

  // --- Result screen state ---
  const [purgeResult, setPurgeResult] = useState<ProductPurgeActionState["result"] | null>(null);

  const pageSize = 30;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  const runSearch = useCallback(async (currentSearch: string, currentCategory: string, currentPage: number) => {
    setSearching(true);
    setSearchError(null);
    try {
      const result = await searchProductsForPurge(currentSearch, currentCategory || null, currentPage);
      setRows(result.rows);
      setTotalCount(result.totalCount);
    } catch {
      setSearchError("تعذّر تحميل نتائج البحث");
    } finally {
      setSearching(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      void runSearch(search, categoryFilter, page);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search, categoryFilter, page, runSearch]);

  // Any change to search/category resets to page 1 — a stale page number
  // from a previous, larger result set would otherwise silently show an
  // empty page.
  useEffect(() => {
    setPage(1);
  }, [search, categoryFilter]);

  const visibleIds = useMemo(() => rows.map((row) => row.id), [rows]);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));

  function toggleRow(row: ProductPurgeSearchRow) {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(row.id)) next.delete(row.id);
      else next.set(row.id, row);
      return next;
    });
  }

  function toggleAllVisible() {
    setSelected((prev) => {
      const next = new Map(prev);
      if (allVisibleSelected) {
        for (const id of visibleIds) next.delete(id);
      } else {
        for (const row of rows) next.set(row.id, row);
      }
      return next;
    });
  }

  function clearSelection() {
    setSelected(new Map());
  }

  async function openReview() {
    if (selected.size === 0) return;
    setReviewing(true);
    setReviewError(null);
    try {
      const state = await getProductPurgePreview([...selected.keys()]);
      if (!state.ok || !state.preview) {
        setReviewError(state.error ?? "تعذّر تجهيز المراجعة");
        return;
      }
      setPreviewRows(state.preview.rows);
      setPreviewDependencies(state.preview.dependencyCounts);
      setPreviewTotalUnits(state.preview.totalInventoryUnits);
      setPreviewEmptyParents(state.preview.emptyParentsToDelete);
      setPreviewProtectedAccountLinkedOrders(state.preview.protectedAccountLinkedOrders);
      setConfirmText("");
      setPurgeError(null);
      setView("preview");
    } finally {
      setReviewing(false);
    }
  }

  async function confirmPurge() {
    if (confirmText !== PURGE_CONFIRMATION_PHRASE || purging) return;
    setPurging(true);
    setPurgeError(null);
    try {
      const state = await purgeProductsPermanently([...selected.keys()], confirmText);
      if (!state.ok || !state.result) {
        setPurgeError(state.error ?? "تعذّر إتمام الحذف");
        return;
      }
      setPurgeResult(state.result);
      clearSelection();
      setView("result");
    } finally {
      setPurging(false);
    }
  }

  function startOver() {
    setPurgeResult(null);
    setPreviewRows([]);
    setPreviewDependencies(null);
    setPreviewEmptyParents(null);
    setPreviewProtectedAccountLinkedOrders(0);
    setConfirmText("");
    setView("select");
    void runSearch(search, categoryFilter, page);
  }

  if (view === "result" && purgeResult) {
    const total = purgeResult.deletedProducts.reduce((sum, row) => sum + row.companyTotal, 0);
    return (
      <div className="flex flex-col gap-4 rounded-card border border-emerald-500/30 bg-emerald-500/5 p-6">
        <h2 className="text-lg font-bold text-emerald-400">تم حذف المنتجات نهائيًا</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <p className="rounded-card border border-navy-soft bg-navy-deep/40 p-3 text-sm">
            <span className="text-neutral-bg/60">عدد المنتجات المحذوفة: </span>
            <span className="font-semibold text-neutral-bg">{purgeResult.deletedProducts.length}</span>
          </p>
          <p className="rounded-card border border-navy-soft bg-navy-deep/40 p-3 text-sm">
            <span className="text-neutral-bg/60">إجمالي المخزون المحذوف: </span>
            <span className="font-semibold text-neutral-bg">{total}</span>
          </p>
        </div>

        <div>
          <h3 className="mb-2 text-sm font-semibold text-neutral-bg/80">الأصناف المحذوفة</h3>
          <ul className="flex flex-col gap-1 text-sm">
            {purgeResult.deletedProducts.map((row) => (
              <li key={row.id} className="rounded-card border border-navy-soft bg-navy-deep/40 px-3 py-1.5">
                <span className="font-medium text-neutral-bg">{row.nameAr ?? row.name}</span>
                <span className="text-neutral-bg/50"> — {row.sku}</span>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h3 className="mb-2 text-sm font-semibold text-neutral-bg/80">عدد السجلات المرتبطة التي حُذفت</h3>
          <DependencyCountList counts={purgeResult.dependencyCounts} />
        </div>

        <div>
          <h3 className="mb-2 text-sm font-semibold text-neutral-bg/80">السجلات الفارغة التي حُذفت بالكامل معها</h3>
          <EmptyParentCountList counts={purgeResult.emptyParentsDeleted} protectedAccountLinkedOrders={purgeResult.protectedAccountLinkedOrders} />
        </div>

        <Button type="button" variant="outline" className="self-start" onClick={startOver}>
          العودة لصفحة الحذف
        </Button>
      </div>
    );
  }

  if (view === "preview") {
    return (
      <div className="flex flex-col gap-4">
        <div className="rounded-card border border-rose-500/40 bg-rose-500/5 p-4 text-sm text-rose-200">
          هذه عملية تدميرية ولا يمكن التراجع عنها — راجع القائمة أدناه جيداً قبل المتابعة.
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <p className="rounded-card border border-navy-soft bg-navy-deep/40 p-3 text-sm">
            <span className="text-neutral-bg/60">عدد المنتجات: </span>
            <span className="font-semibold text-neutral-bg">{previewRows.length}</span>
          </p>
          <p className="rounded-card border border-navy-soft bg-navy-deep/40 p-3 text-sm">
            <span className="text-neutral-bg/60">إجمالي كمية المخزون التي ستُحذف: </span>
            <span className="font-semibold text-neutral-bg">{previewTotalUnits}</span>
          </p>
        </div>

        <div>
          <h3 className="mb-2 text-sm font-semibold text-neutral-bg/80">الأصناف المحددة للحذف</h3>
          <div className="overflow-x-auto rounded-card border border-navy-soft">
            <table className="w-full text-start text-sm">
              <thead className="bg-navy-deep/60 text-xs font-semibold uppercase tracking-wide text-neutral-bg/50">
                <tr>
                  <th className="px-3 py-2 text-start">اسم الصنف</th>
                  <th className="px-3 py-2 text-start">الكود</th>
                  <th className="px-3 py-2 text-start">الحالة</th>
                  <th className="px-3 py-2 text-start">مخزون المستودع</th>
                  <th className="px-3 py-2 text-start">مع المندوبين</th>
                  <th className="px-3 py-2 text-start">الإجمالي</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-navy-soft">
                {previewRows.map((row) => (
                  <tr key={row.id}>
                    <td className="max-w-xs whitespace-normal break-words px-3 py-2 font-medium text-neutral-bg">{row.nameAr ?? row.name}</td>
                    <td className="whitespace-normal break-words px-3 py-2 text-neutral-bg/70">{row.sku}</td>
                    <td className="px-3 py-2 text-neutral-bg/70">{row.isActive ? "مفعّل" : "غير مفعّل"}</td>
                    <td className="px-3 py-2 text-neutral-bg/70">{row.warehouseStock}</td>
                    <td className="px-3 py-2 text-neutral-bg/70">{row.repStock}</td>
                    <td className="px-3 py-2 font-semibold text-neutral-bg">{row.companyTotal}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {previewDependencies && (
          <div>
            <h3 className="mb-2 text-sm font-semibold text-neutral-bg/80">سجلات المنتجات المرتبطة التي سيتم حذفها</h3>
            <DependencyCountList counts={previewDependencies} />
          </div>
        )}

        {previewEmptyParents && (
          <div>
            <h3 className="mb-2 text-sm font-semibold text-neutral-bg/80">الطلبات/المرتجعات/الطلبات الأخرى التي ستصبح فارغة وسيتم حذفها بالكامل</h3>
            <EmptyParentCountList counts={previewEmptyParents} protectedAccountLinkedOrders={previewProtectedAccountLinkedOrders} />
          </div>
        )}

        <div className="rounded-card border border-navy-soft bg-navy-deep/40 p-4">
          <p className="text-sm text-neutral-bg/80">
            للتأكيد، اكتب العبارة التالية بالضبط: <span className="font-bold text-rose-300">{PURGE_CONFIRMATION_PHRASE}</span>
          </p>
          <Input
            value={confirmText}
            onChange={(event) => setConfirmText(event.target.value)}
            placeholder={PURGE_CONFIRMATION_PHRASE}
            className="mt-3 w-64"
            aria-label="عبارة تأكيد الحذف"
          />
          {purgeError && <p className="mt-2 text-sm text-rose-400">{purgeError}</p>}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button type="button" variant="outline" onClick={() => setView("select")} disabled={purging}>
              رجوع للتحديد
            </Button>
            <Button
              type="button"
              disabled={confirmText !== PURGE_CONFIRMATION_PHRASE || purging}
              onClick={() => void confirmPurge()}
              className="bg-rose-600 text-white hover:bg-rose-700 focus-visible:ring-rose-600"
            >
              {purging ? "جارٍ الحذف..." : "حذف المنتجات نهائيًا"}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
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
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.label}
            </option>
          ))}
        </Select>
        <Button type="button" variant="outline" onClick={toggleAllVisible} disabled={rows.length === 0}>
          {allVisibleSelected ? "إلغاء تحديد الظاهر" : "تحديد كل الظاهر"}
        </Button>
        {selected.size > 0 && (
          <Button type="button" variant="ghost" onClick={clearSelection}>
            إلغاء كل التحديد ({selected.size})
          </Button>
        )}
      </div>

      {searchError && <p className="text-sm text-rose-400">{searchError}</p>}

      <div className="overflow-x-auto rounded-card border border-navy-soft">
        <table className="w-full text-start text-sm">
          <thead className="bg-navy-deep/60 text-xs font-semibold uppercase tracking-wide text-neutral-bg/50">
            <tr>
              <th className="px-3 py-2 text-start"></th>
              <th className="px-3 py-2 text-start">الصورة</th>
              <th className="px-3 py-2 text-start">اسم الصنف</th>
              <th className="px-3 py-2 text-start">SKU</th>
              <th className="px-3 py-2 text-start">الحالة</th>
              <th className="px-3 py-2 text-start">مخزون المستودع</th>
              <th className="px-3 py-2 text-start">مخزون المندوبين</th>
              <th className="px-3 py-2 text-start">إجمالي المخزون</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-navy-soft">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-neutral-bg/50">
                  {searching ? "جارٍ البحث..." : "لا توجد نتائج"}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className={selected.has(row.id) ? "bg-gold-champagne/5" : undefined}>
                  <td className="px-3 py-2">
                    <input type="checkbox" className="h-4 w-4" checked={selected.has(row.id)} onChange={() => toggleRow(row)} aria-label={`تحديد ${row.nameAr ?? row.name}`} />
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded border border-navy-soft bg-navy-deep">
                      {row.thumbnailUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element -- arbitrary admin-entered external URLs
                        <img src={row.thumbnailUrl} alt={row.thumbnailAlt ?? row.name} className="h-full w-full object-contain" loading="lazy" />
                      ) : (
                        <span className="text-sm text-neutral-bg/30">—</span>
                      )}
                    </div>
                  </td>
                  <td className="max-w-xs whitespace-normal break-words px-3 py-2 font-medium text-neutral-bg">
                    {row.nameAr ?? row.name}
                    {!row.isActive && <span className="ms-2 text-xs text-neutral-bg/40">غير مفعّل</span>}
                  </td>
                  <td className="whitespace-normal break-words px-3 py-2 text-neutral-bg/70">{row.sku}</td>
                  <td className="px-3 py-2 text-neutral-bg/70">{row.isActive ? "مفعّل" : "غير مفعّل"}</td>
                  <td className="px-3 py-2 text-neutral-bg/70">{row.warehouseStock}</td>
                  <td className="px-3 py-2 text-neutral-bg/70">{row.repStock}</td>
                  <td className="px-3 py-2 font-semibold text-neutral-bg">{row.companyTotal}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 text-sm text-neutral-bg/70">
          <Button type="button" variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            السابق
          </Button>
          <span>
            صفحة {page} من {totalPages}
          </span>
          <Button type="button" variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
            التالي
          </Button>
        </div>
      )}

      <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 rounded-card border border-navy-soft bg-navy-surface p-4">
        <p className="text-sm text-neutral-bg/70">
          المحدد حالياً: <span className="font-semibold text-neutral-bg">{selected.size}</span> منتج
        </p>
        {reviewError && <p className="text-sm text-rose-400">{reviewError}</p>}
        <Button type="button" disabled={selected.size === 0 || reviewing} onClick={() => void openReview()}>
          {reviewing ? "جارٍ التحضير..." : "مراجعة الحذف النهائي"}
        </Button>
      </div>
    </div>
  );
}
