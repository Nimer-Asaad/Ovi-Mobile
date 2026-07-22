import Link from "next/link";
import { buildProductsUrl, PRODUCT_SORT_OPTIONS, PRODUCT_SORT_LABELS, type ProductSort } from "@/lib/product-filter-url";
import { formatCurrencyFromCents } from "@/lib/utils";

export interface ActiveFilterChipsProps {
  query?: string;
  category?: { slug: string; label: string };
  brand?: { slug: string; label: string };
  sort: ProductSort;
  inStock: boolean;
  isNew: boolean;
  minPrice?: string;
  maxPrice?: string;
  minPriceCents?: number;
  maxPriceCents?: number;
}

function RemoveIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="h-3 w-3"><path d="M18 6 6 18M6 6l12 12" /></svg>;
}

function Chip({ href, children, ariaLabel }: { href: string; children: React.ReactNode; ariaLabel?: string }) {
  return <Link href={href} aria-label={ariaLabel} className="flex items-center gap-1.5 rounded-full border border-navy-soft bg-navy-surface px-3 py-1 text-xs text-neutral-bg/80 transition-colors hover:border-rose-500/40 hover:text-rose-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-dark">{children}<RemoveIcon /></Link>;
}

export function ActiveFilterChips({ query, category, brand, sort, inStock, isNew, minPrice, maxPrice, minPriceCents, maxPriceCents }: ActiveFilterChipsProps) {
  const hasSort = sort !== PRODUCT_SORT_OPTIONS.LATEST;
  const hasPrice = minPriceCents !== undefined || maxPriceCents !== undefined;
  const hasAny = Boolean(query || category || brand || hasSort || inStock || isNew || hasPrice);
  if (!hasAny) return null;
  const shared = { q: query, category: category?.slug, brand: brand?.slug, sort, inStock, isNew, minPrice, maxPrice };
  const minLabel = minPriceCents !== undefined ? formatCurrencyFromCents(minPriceCents) : undefined;
  const maxLabel = maxPriceCents !== undefined ? formatCurrencyFromCents(maxPriceCents) : undefined;
  const priceLabel = minLabel && maxLabel ? `من ${minLabel} إلى ${maxLabel}` : minLabel ? `من ${minLabel}` : `حتى ${maxLabel}`;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {query && <Chip href={buildProductsUrl({ ...shared, q: undefined })}>البحث: {query}</Chip>}
      {category && <Chip href={buildProductsUrl({ ...shared, category: undefined })}>القسم: {category.label}</Chip>}
      {brand && <Chip href={buildProductsUrl({ ...shared, brand: undefined })}>العلامة: {brand.label}</Chip>}
      {inStock && <Chip href={buildProductsUrl({ ...shared, inStock: false })}>متوفر فقط</Chip>}
      {isNew && <Chip href={buildProductsUrl({ ...shared, isNew: false })}>وصل حديثًا</Chip>}
      {hasPrice && <Chip href={buildProductsUrl({ ...shared, minPrice: undefined, maxPrice: undefined })} ariaLabel={`إزالة فلتر السعر: ${priceLabel}`}>{priceLabel}</Chip>}
      {hasSort && <Chip href={buildProductsUrl({ ...shared, sort: PRODUCT_SORT_OPTIONS.LATEST })}>الترتيب: {PRODUCT_SORT_LABELS[sort]}</Chip>}
      <Link href="/products" className="text-xs font-medium text-gold-dark hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-dark">مسح الفلاتر</Link>
    </div>
  );
}
