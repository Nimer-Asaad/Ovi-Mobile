import Link from "next/link";
import { buildProductsUrl, type ProductSort } from "@/lib/product-filter-url";
import { cn } from "@/lib/utils";
import type { StorefrontCategory, StorefrontBrand } from "@/lib/catalog-queries";

export interface ProductFiltersProps {
  categories: StorefrontCategory[];
  brands: StorefrontBrand[];
  query?: string;
  activeCategory?: string;
  activeBrand?: string;
  sort: ProductSort;
  inStock: boolean;
  isNew: boolean;
}

function FilterPill({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link href={href} className={cn("shrink-0 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-dark", active ? "border-gold-champagne bg-gold-champagne/10 text-gold-dark" : "border-navy-soft text-neutral-bg/70 hover:border-gold-champagne/50 hover:text-neutral-bg")}>
      {children}
    </Link>
  );
}

export function ProductFilters({ categories, brands, query, activeCategory, activeBrand, sort, inStock, isNew }: ProductFiltersProps) {
  const shared = { q: query, category: activeCategory, brand: activeBrand, sort, inStock, isNew };

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h3 className="mb-2 text-sm font-semibold text-neutral-bg">القسم</h3>
        <div className="flex flex-wrap gap-2">
          <FilterPill href={buildProductsUrl({ ...shared, category: undefined })} active={!activeCategory}>كل الأقسام</FilterPill>
          {categories.map((category) => (
            <FilterPill key={category.slug} href={buildProductsUrl({ ...shared, category: category.slug })} active={activeCategory === category.slug}>
              {category.nameAr ?? category.name}
            </FilterPill>
          ))}
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-neutral-bg">العلامة التجارية</h3>
        <div className="flex flex-wrap gap-2">
          <FilterPill href={buildProductsUrl({ ...shared, brand: undefined })} active={!activeBrand}>كل العلامات</FilterPill>
          {brands.map((brand) => (
            <FilterPill key={brand.slug} href={buildProductsUrl({ ...shared, brand: brand.slug })} active={activeBrand === brand.slug}>
              {brand.name}
            </FilterPill>
          ))}
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-neutral-bg">التوفر</h3>
        <div className="flex flex-wrap gap-2">
          <FilterPill href={buildProductsUrl({ ...shared, inStock: !inStock })} active={inStock}>متوفر فقط</FilterPill>
          <FilterPill href={buildProductsUrl({ ...shared, isNew: !isNew })} active={isNew}>وصل حديثًا</FilterPill>
        </div>
      </div>
    </div>
  );
}
