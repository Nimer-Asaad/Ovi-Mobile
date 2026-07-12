import Link from "next/link";
import { buildProductsUrl } from "@/lib/product-filter-url";
import { cn } from "@/lib/utils";
import type { StorefrontCategory, StorefrontBrand } from "@/lib/catalog-queries";

export interface ProductFiltersProps {
  categories: StorefrontCategory[];
  brands: StorefrontBrand[];
  query?: string;
  activeCategory?: string;
  activeBrand?: string;
  sort?: string;
}

function FilterPill({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={cn(
        "shrink-0 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
        active
          ? "border-gold-champagne bg-gold-champagne/10 text-gold-dark"
          : "border-navy-soft text-neutral-bg/70 hover:border-gold-champagne/50 hover:text-neutral-bg",
      )}
    >
      {children}
    </Link>
  );
}

/** Category/brand filter pills built only from real, active `Category`/
 * `Brand` rows. Every link is built through `buildProductsUrl` so switching
 * one filter always keeps the current search/other filter/sort intact. */
export function ProductFilters({ categories, brands, query, activeCategory, activeBrand, sort }: ProductFiltersProps) {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h3 className="mb-2 text-sm font-semibold text-neutral-bg">القسم</h3>
        <div className="flex flex-wrap gap-2">
          <FilterPill href={buildProductsUrl({ q: query, brand: activeBrand, sort })} active={!activeCategory}>
            كل الأقسام
          </FilterPill>
          {categories.map((category) => (
            <FilterPill
              key={category.slug}
              href={buildProductsUrl({ q: query, category: category.slug, brand: activeBrand, sort })}
              active={activeCategory === category.slug}
            >
              {category.nameAr ?? category.name}
            </FilterPill>
          ))}
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-neutral-bg">العلامة التجارية</h3>
        <div className="flex flex-wrap gap-2">
          <FilterPill href={buildProductsUrl({ q: query, category: activeCategory, sort })} active={!activeBrand}>
            كل العلامات
          </FilterPill>
          {brands.map((brand) => (
            <FilterPill
              key={brand.slug}
              href={buildProductsUrl({ q: query, category: activeCategory, brand: brand.slug, sort })}
              active={activeBrand === brand.slug}
            >
              {brand.name}
            </FilterPill>
          ))}
        </div>
      </div>
    </div>
  );
}
