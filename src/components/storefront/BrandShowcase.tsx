import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import type { StorefrontBrand } from "@/lib/catalog-queries";

export interface BrandShowcaseProps {
  brands: StorefrontBrand[];
}

function getInitials(name: string): string {
  return name.trim().slice(0, 2).toUpperCase();
}

/** Brand grid built only from real, active `Brand` rows. Shows the brand's
 * `logoUrl` when set, otherwise a plain initials tile — never a fake logo. */
export function BrandShowcase({ brands }: BrandShowcaseProps) {
  if (brands.length === 0) {
    return <EmptyState title="لا توجد علامات تجارية متاحة حالياً" message="سيتم إضافة العلامات التجارية قريباً." />;
  }

  return (
    <div className="grid grid-cols-3 gap-4 sm:grid-cols-4 lg:grid-cols-6">
      {brands.map((brand) => (
        <Link key={brand.id} href={`/products?brand=${brand.slug}`}>
          <Card className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center transition-all hover:-translate-y-0.5 hover:border-gold-champagne/50 hover:shadow-lg">
            {brand.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- arbitrary admin-entered external URLs
              <img src={brand.logoUrl} alt={brand.name} className="h-10 w-10 object-contain" loading="lazy" />
            ) : (
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-gold-champagne/10 text-sm font-semibold text-gold-dark">
                {getInitials(brand.name)}
              </span>
            )}
            <span className="text-xs font-medium text-neutral-bg/80">{brand.name}</span>
          </Card>
        </Link>
      ))}
    </div>
  );
}
