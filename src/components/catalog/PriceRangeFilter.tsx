import Link from "next/link";
import { buildProductsUrl, PRODUCT_SORT_OPTIONS, type ProductSort } from "@/lib/product-filter-url";

export interface PriceRangeFilterProps {
  idPrefix: string;
  query?: string;
  category?: string;
  brand?: string;
  sort: ProductSort;
  inStock: boolean;
  isNew: boolean;
  minPrice?: string;
  maxPrice?: string;
}

export function PriceRangeFilter({ idPrefix, query, category, brand, sort, inStock, isNew, minPrice, maxPrice }: PriceRangeFilterProps) {
  const shared = { q: query, category, brand, sort, inStock, isNew };
  return (
    <form method="GET" action="/products" className="w-full max-w-md border-t border-navy-soft pt-5">
      {query && <input type="hidden" name="q" value={query} />}
      {category && <input type="hidden" name="category" value={category} />}
      {brand && <input type="hidden" name="brand" value={brand} />}
      {sort !== PRODUCT_SORT_OPTIONS.LATEST && <input type="hidden" name="sort" value={sort} />}
      {inStock && <input type="hidden" name="inStock" value="1" />}
      {isNew && <input type="hidden" name="isNew" value="1" />}
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-neutral-bg">نطاق السعر</h3>
        {(minPrice || maxPrice) && <Link href={buildProductsUrl(shared)} className="text-xs font-medium text-gold-dark hover:underline">مسح السعر</Link>}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs text-neutral-bg/70" htmlFor={`${idPrefix}-min`}>
          أقل سعر
          <input id={`${idPrefix}-min`} name="minPrice" type="number" min="0" step="0.01" inputMode="decimal" defaultValue={minPrice ?? ""} placeholder="0" className="mt-1 h-10 w-full rounded-card border border-navy-soft bg-navy-deep px-3 text-sm text-neutral-bg placeholder:text-neutral-bg/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-champagne" />
        </label>
        <label className="text-xs text-neutral-bg/70" htmlFor={`${idPrefix}-max`}>
          أعلى سعر
          <input id={`${idPrefix}-max`} name="maxPrice" type="number" min="0" step="0.01" inputMode="decimal" defaultValue={maxPrice ?? ""} placeholder="500" className="mt-1 h-10 w-full rounded-card border border-navy-soft bg-navy-deep px-3 text-sm text-neutral-bg placeholder:text-neutral-bg/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-champagne" />
        </label>
      </div>
      <button type="submit" className="mt-3 min-h-10 w-full rounded-card border border-gold-champagne/55 bg-gold-champagne/10 px-4 text-sm font-semibold text-gold-dark transition-colors hover:bg-gold-champagne/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-dark">تطبيق السعر</button>
    </form>
  );
}
