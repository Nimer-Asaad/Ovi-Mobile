"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { AdminTable, AdminTableHead, AdminTableBody, AdminEmptyRow } from "@/components/admin/AdminTable";
import { AdminStatusBadge } from "@/components/admin/AdminStatusBadge";
import { HighlightedText } from "@/components/admin/HighlightedText";
import { ProductImagePlaceholder } from "@/components/catalog/ProductImagePlaceholder";

export interface AdminInventoryRow {
  id: string;
  sku: string;
  name: string;
  categoryName: string | null;
  brandName: string | null;
  stock: number;
  isActive: boolean;
  isLowStockRow: boolean;
  thumbnail: { url: string; altText: string | null } | null;
}

interface InventoryLiveSearchProps {
  rows: AdminInventoryRow[];
}

/** Client-side live search over the server-filtered (category/brand/active/
 * lowStock/sort already applied) inventory rows. Text search no longer
 * round-trips to the server — it updates instantly as the admin types,
 * ahead of the "تصفية" button which still applies the other filters. */
export function InventoryLiveSearch({ rows }: InventoryLiveSearchProps) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;

    return rows.filter((row) => {
      const haystack = [row.name, row.sku, row.categoryName, row.brandName]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [rows, query]);

  return (
    <div className="flex flex-col gap-4">
      <div className="max-w-md">
        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          label="بحث بالاسم أو رمز المنتج أو القسم أو العلامة"
          placeholder="اكتب للبحث الفوري..."
        />
      </div>

      <AdminTable>
        <AdminTableHead>
          <th className="px-4 py-3 text-start"></th>
          <th className="px-4 py-3 text-start">الاسم</th>
          <th className="px-4 py-3 text-start">SKU</th>
          <th className="px-4 py-3 text-start">القسم</th>
          <th className="px-4 py-3 text-start">العلامة</th>
          <th className="px-4 py-3 text-start">المخزون</th>
          <th className="px-4 py-3 text-start">الحالة</th>
          <th className="px-4 py-3 text-start"></th>
        </AdminTableHead>
        <AdminTableBody>
          {filtered.map((row) => (
            <tr key={row.id}>
              <td className="px-4 py-3">
                <div className="h-12 w-12 overflow-hidden rounded-card">
                  {row.thumbnail ? (
                    // eslint-disable-next-line @next/next/no-img-element -- arbitrary admin-entered/uploaded URLs
                    <img
                      src={row.thumbnail.url}
                      alt={row.thumbnail.altText ?? row.name}
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <ProductImagePlaceholder className="h-full w-full" />
                  )}
                </div>
              </td>
              <td className="px-4 py-3 text-neutral-bg">
                <HighlightedText text={row.name} query={query} />
              </td>
              <td className="px-4 py-3 text-neutral-bg/70">
                <HighlightedText text={row.sku} query={query} />
              </td>
              <td className="px-4 py-3 text-neutral-bg/70">
                {row.categoryName ? <HighlightedText text={row.categoryName} query={query} /> : "—"}
              </td>
              <td className="px-4 py-3 text-neutral-bg/70">
                {row.brandName ? <HighlightedText text={row.brandName} query={query} /> : "—"}
              </td>
              <td className="px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className="text-neutral-bg">{row.stock}</span>
                  {row.isLowStockRow && <Badge variant="warning">مخزون منخفض</Badge>}
                </div>
              </td>
              <td className="px-4 py-3">
                <AdminStatusBadge isActive={row.isActive} />
              </td>
              <td className="px-4 py-3">
                <div className="flex items-center justify-end gap-3">
                  <Link href={`/admin/inventory/adjust?productId=${row.id}`} className="text-sm text-gold-champagne hover:underline">
                    تعديل
                  </Link>
                  <Link href={`/admin/inventory/movements?productId=${row.id}`} className="text-sm text-gold-champagne hover:underline">
                    السجل
                  </Link>
                </div>
              </td>
            </tr>
          ))}
          {filtered.length === 0 && (
            <AdminEmptyRow colSpan={8} message={rows.length === 0 ? "لا توجد منتجات مطابقة" : "لا توجد نتائج مطابقة للبحث"} />
          )}
        </AdminTableBody>
      </AdminTable>
    </div>
  );
}
