import Link from "next/link";
import { EmptyState } from "@/components/ui/EmptyState";
import type { StorefrontBrand } from "@/lib/catalog-queries";

export interface BrandShowcaseProps {
  brands: StorefrontBrand[];
}

function getInitials(name: string): string {
  return name.trim().slice(0, 2).toUpperCase();
}

function BrandCard({ brand, duplicate = false }: { brand: StorefrontBrand; duplicate?: boolean }) {
  return (
    <Link
      href={`/products?brand=${brand.slug}`}
      aria-hidden={duplicate || undefined}
      tabIndex={duplicate ? -1 : undefined}
      className="group/brand flex h-24 w-40 shrink-0 items-center gap-3 rounded-2xl border border-navy-soft/80 bg-white/85 px-4 shadow-[0_8px_26px_-18px_rgba(6,20,37,0.5)] transition duration-300 hover:scale-[1.035] hover:border-gold-champagne/55 hover:shadow-[0_14px_34px_-17px_rgba(201,161,74,0.48)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-dark sm:h-28 sm:w-48 sm:px-5"
    >
      {brand.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- arbitrary admin-entered external URLs
        <img src={brand.logoUrl} alt="" className="h-12 w-12 shrink-0 object-contain" loading="lazy" decoding="async" />
      ) : (
        <span aria-hidden="true" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gold-champagne/12 text-sm font-bold text-gold-dark ring-1 ring-gold-champagne/20">
          {getInitials(brand.name)}
        </span>
      )}
      <span className="min-w-0 text-sm font-semibold text-neutral-bg transition-colors group-hover/brand:text-gold-dark sm:text-base">{brand.name}</span>
    </Link>
  );
}

function BrandRow({
  brands,
  accessibleCount = 0,
  reverse = false,
}: {
  brands: StorefrontBrand[];
  accessibleCount?: number;
  reverse?: boolean;
}) {
  return (
    <div className="brand-marquee overflow-hidden py-3" dir="ltr">
      <div className={reverse ? "brand-marquee-track brand-marquee-reverse" : "brand-marquee-track"}>
        <div className="brand-marquee-group">
          {brands.map((brand, index) => (
            <BrandCard key={`${brand.id}-${index}`} brand={brand} duplicate={index >= accessibleCount} />
          ))}
        </div>
        <div className="brand-marquee-group" aria-hidden="true">
          {brands.map((brand, index) => <BrandCard key={`duplicate-${brand.id}-${index}`} brand={brand} duplicate />)}
        </div>
      </div>
    </div>
  );
}

/** Two CSS-transform marquees built from real active brands. Duplicate groups
 * are hidden from assistive technology and keyboard navigation. */
export function BrandShowcase({ brands }: BrandShowcaseProps) {
  if (brands.length === 0) {
    return <EmptyState title="لا توجد علامات تجارية متاحة حالياً" message="سيتم إضافة العلامات التجارية قريباً." />;
  }

  const minimumLoopSize = 8;
  const loopBrands = Array.from(
    { length: Math.max(minimumLoopSize, brands.length) },
    (_, index) => brands[index % brands.length]!,
  );
  return (
    <nav aria-label="تصفح العلامات التجارية" className="brand-showcase-mask -mx-4 space-y-1 sm:-mx-6 lg:-mx-10">
      <BrandRow brands={loopBrands} accessibleCount={brands.length} />
      <BrandRow brands={[...loopBrands].reverse()} reverse />
    </nav>
  );
}
