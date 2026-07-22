"use client";

import { useRouter } from "next/navigation";
import { buildProductsUrl, PRODUCT_SORT_LABELS, type ProductSort } from "@/lib/product-filter-url";

export interface ProductSortSelectProps {
  sort: ProductSort;
  query?: string;
  category?: string;
  brand?: string;
  inStock: boolean;
  isNew: boolean;
  minPrice?: string;
  maxPrice?: string;
}

export function ProductSortSelect({ sort, query, category, brand, inStock, isNew, minPrice, maxPrice }: ProductSortSelectProps) {
  const router = useRouter();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor="product-sort" className="text-sm font-medium text-neutral-bg/80">الترتيب</label>
      <select id="product-sort" value={sort} onChange={(event) => router.push(buildProductsUrl({ q: query, category, brand, sort: event.target.value, inStock, isNew, minPrice, maxPrice }))} className="h-11 rounded-card border border-navy-soft bg-navy-deep px-3 text-sm text-neutral-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-champagne">
        {Object.entries(PRODUCT_SORT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
    </div>
  );
}
