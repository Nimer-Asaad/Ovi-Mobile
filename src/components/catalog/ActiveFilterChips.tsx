import Link from "next/link";
import { buildProductsUrl, PRODUCT_SORT_OPTIONS, PRODUCT_SORT_LABELS, type ProductSort } from "@/lib/product-filter-url";

export interface ActiveFilterChipsProps {
  query?: string;
  category?: { slug: string; label: string };
  brand?: { slug: string; label: string };
  sort: ProductSort;
}

function RemoveIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

/** One removable chip per active filter, each linking to the URL with only
 * that filter stripped out (every other filter preserved) — plus a single
 * "مسح الفلاتر" link back to a clean /products when anything is active. */
export function ActiveFilterChips({ query, category, brand, sort }: ActiveFilterChipsProps) {
  const hasSort = sort !== PRODUCT_SORT_OPTIONS.LATEST;
  const hasAny = Boolean(query || category || brand || hasSort);

  if (!hasAny) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {query && (
        <Link
          href={buildProductsUrl({ category: category?.slug, brand: brand?.slug, sort })}
          className="flex items-center gap-1.5 rounded-full border border-navy-soft bg-navy-surface px-3 py-1 text-xs text-neutral-bg/80 transition-colors hover:border-rose-500/40 hover:text-rose-600"
        >
          البحث: {query}
          <RemoveIcon />
        </Link>
      )}
      {category && (
        <Link
          href={buildProductsUrl({ q: query, brand: brand?.slug, sort })}
          className="flex items-center gap-1.5 rounded-full border border-navy-soft bg-navy-surface px-3 py-1 text-xs text-neutral-bg/80 transition-colors hover:border-rose-500/40 hover:text-rose-600"
        >
          القسم: {category.label}
          <RemoveIcon />
        </Link>
      )}
      {brand && (
        <Link
          href={buildProductsUrl({ q: query, category: category?.slug, sort })}
          className="flex items-center gap-1.5 rounded-full border border-navy-soft bg-navy-surface px-3 py-1 text-xs text-neutral-bg/80 transition-colors hover:border-rose-500/40 hover:text-rose-600"
        >
          العلامة: {brand.label}
          <RemoveIcon />
        </Link>
      )}
      {hasSort && (
        <Link
          href={buildProductsUrl({ q: query, category: category?.slug, brand: brand?.slug })}
          className="flex items-center gap-1.5 rounded-full border border-navy-soft bg-navy-surface px-3 py-1 text-xs text-neutral-bg/80 transition-colors hover:border-rose-500/40 hover:text-rose-600"
        >
          الترتيب: {PRODUCT_SORT_LABELS[sort]}
          <RemoveIcon />
        </Link>
      )}

      <Link href="/products" className="text-xs font-medium text-gold-dark hover:underline">
        مسح الفلاتر
      </Link>
    </div>
  );
}
