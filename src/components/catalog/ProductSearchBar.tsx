import { PRODUCT_SORT_OPTIONS, type ProductSort } from "@/lib/product-filter-url";

export interface ProductSearchBarProps {
  query?: string;
  category?: string;
  brand?: string;
  sort: ProductSort;
  inStock: boolean;
  isNew: boolean;
  minPrice?: string;
  maxPrice?: string;
}

/** GET search preserves intentional filters and omits page, resetting it to one. */
export function ProductSearchBar({ query, category, brand, sort, inStock, isNew, minPrice, maxPrice }: ProductSearchBarProps) {
  return (
    <form method="GET" action="/products" role="search" className="flex w-full items-stretch gap-2">
      {category && <input type="hidden" name="category" value={category} />}
      {brand && <input type="hidden" name="brand" value={brand} />}
      {sort !== PRODUCT_SORT_OPTIONS.LATEST && <input type="hidden" name="sort" value={sort} />}
      {inStock && <input type="hidden" name="inStock" value="1" />}
      {isNew && <input type="hidden" name="isNew" value="1" />}
      {minPrice && <input type="hidden" name="minPrice" value={minPrice} />}
      {maxPrice && <input type="hidden" name="maxPrice" value={maxPrice} />}

      <div className="relative flex-1">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-bg/40">
          <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
        </svg>
        <input type="search" name="q" defaultValue={query ?? ""} placeholder="ابحث عن منتج أو SKU..." className="h-11 w-full rounded-card border border-navy-soft bg-navy-deep ps-9 pe-3 text-sm text-neutral-bg placeholder:text-neutral-bg/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-champagne" />
      </div>
      <button type="submit" className="h-11 shrink-0 rounded-card bg-gold-champagne px-5 text-sm font-medium text-white transition-colors hover:bg-gold-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-dark">بحث</button>
    </form>
  );
}
