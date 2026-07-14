"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { AdminTable, AdminTableHead, AdminTableBody, AdminEmptyRow } from "@/components/admin/AdminTable";
import { AdminStatusBadge } from "@/components/admin/AdminStatusBadge";
import { ActiveToggleForm } from "@/components/admin/ActiveToggleForm";
import { HighlightedText } from "@/components/admin/HighlightedText";
import { ProductImagePlaceholder } from "@/components/catalog/ProductImagePlaceholder";
import { formatCurrencyFromCents } from "@/lib/utils";

export interface AdminProductRow {
  id: string;
  sku: string;
  name: string;
  nameAr: string | null;
  isFeatured: boolean;
  isActive: boolean;
  categoryName: string | null;
  brandName: string | null;
  supplierName: string | null;
  stock: number;
  retailPriceCents: number;
  wholesalePriceCents: number;
  thumbnail: { url: string; altText: string | null } | null;
  toggleAction: () => Promise<void>;
}

interface AdminProductsSearchProps {
  products: AdminProductRow[];
}

/** Client-side live search over the already-fetched product list — no
 * network round trip per keystroke. Matches partial Arabic/English letters
 * (plain substring, case-insensitive) across name, Arabic name, SKU,
 * category, brand, and supplier. */
export function AdminProductsSearch({ products }: AdminProductsSearchProps) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return products;

    return products.filter((product) => {
      const haystack = [
        product.name,
        product.nameAr,
        product.sku,
        product.categoryName,
        product.brandName,
        product.supplierName,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return haystack.includes(needle);
    });
  }, [products, query]);

  return (
    <div className="flex flex-col gap-4">
      <div className="max-w-md">
        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="ابحث بالاسم أو SKU أو القسم أو العلامة التجارية..."
          aria-label="بحث في المنتجات"
        />
      </div>

      <AdminTable>
        <AdminTableHead>
          <th className="px-4 py-3 text-start"></th>
          <th className="px-4 py-3 text-start">SKU</th>
          <th className="px-4 py-3 text-start">الاسم</th>
          <th className="px-4 py-3 text-start">القسم</th>
          <th className="px-4 py-3 text-start">العلامة</th>
          <th className="px-4 py-3 text-start">سعر التجزئة</th>
          <th className="px-4 py-3 text-start">سعر الجملة</th>
          <th className="px-4 py-3 text-start">المخزون</th>
          <th className="px-4 py-3 text-start">الحالة</th>
          <th className="px-4 py-3 text-start"></th>
        </AdminTableHead>
        <AdminTableBody>
          {filtered.map((product) => (
            <tr key={product.id}>
              <td className="px-4 py-3">
                <div className="h-12 w-12 overflow-hidden rounded-card">
                  {product.thumbnail ? (
                    // eslint-disable-next-line @next/next/no-img-element -- arbitrary admin-entered/uploaded URLs
                    <img
                      src={product.thumbnail.url}
                      alt={product.thumbnail.altText ?? product.name}
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <ProductImagePlaceholder className="h-full w-full" />
                  )}
                </div>
              </td>
              <td className="px-4 py-3 text-neutral-bg/70">
                <HighlightedText text={product.sku} query={query} />
              </td>
              <td className="px-4 py-3 text-neutral-bg">
                <HighlightedText text={product.name} query={query} />
                {product.isFeatured && (
                  <Badge variant="gold" className="ms-2">
                    مميز
                  </Badge>
                )}
              </td>
              <td className="px-4 py-3 text-neutral-bg/70">
                {product.categoryName ? <HighlightedText text={product.categoryName} query={query} /> : "—"}
              </td>
              <td className="px-4 py-3 text-neutral-bg/70">
                {product.brandName ? <HighlightedText text={product.brandName} query={query} /> : "—"}
              </td>
              <td className="px-4 py-3 text-neutral-bg/70">{formatCurrencyFromCents(product.retailPriceCents)}</td>
              <td className="px-4 py-3 text-neutral-bg/70">{formatCurrencyFromCents(product.wholesalePriceCents)}</td>
              <td className="px-4 py-3 text-neutral-bg/70">{product.stock}</td>
              <td className="px-4 py-3">
                <AdminStatusBadge isActive={product.isActive} />
              </td>
              <td className="px-4 py-3">
                <div className="flex items-center justify-end gap-3">
                  <Link href={`/admin/products/${product.id}/edit`} className="text-sm text-gold-champagne hover:underline">
                    تعديل
                  </Link>
                  <ActiveToggleForm isActive={product.isActive} action={product.toggleAction} />
                </div>
              </td>
            </tr>
          ))}
          {filtered.length === 0 && (
            <AdminEmptyRow
              colSpan={10}
              message={products.length === 0 ? "لا توجد منتجات حتى الآن" : "لا توجد نتائج مطابقة للبحث"}
            />
          )}
        </AdminTableBody>
      </AdminTable>
    </div>
  );
}
