import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { CategoryIcon } from "@/components/storefront/CategoryIcon";
import type { StorefrontCategory } from "@/lib/catalog-queries";

export interface CategoryStripProps {
  categories: StorefrontCategory[];
  /** "pills" — compact horizontal scroll row, used under the header.
   * "cards" — larger clickable tiles, used on the homepage. */
  variant?: "pills" | "cards";
}

/** Category navigation built only from real `Category` rows — never a
 * hardcoded list — so a link only ever exists if the category actually
 * exists. Always includes a trailing "كل المنتجات" link, and falls back to
 * that alone if there are no active categories yet. */
export function CategoryStrip({ categories, variant = "pills" }: CategoryStripProps) {
  if (variant === "cards") {
    return (
      <nav aria-label="تصفح أقسام المتجر" className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
        {categories.map((category) => (
          <Link key={category.slug} href={`/products?category=${category.slug}`} aria-label={`تصفح قسم ${category.nameAr ?? category.name}`}>
            <Card className="group flex min-h-36 h-full flex-col items-center justify-center gap-4 overflow-hidden px-3 py-7 text-center transition-all duration-300 hover:-translate-y-1 hover:border-gold-champagne/55 hover:shadow-[0_18px_38px_-24px_rgba(6,20,37,0.5)] sm:min-h-40">
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gold-champagne/12 text-gold-dark ring-1 ring-gold-champagne/20 transition duration-300 group-hover:scale-105 group-hover:bg-gold-champagne/18 sm:h-16 sm:w-16">
                <CategoryIcon slug={category.slug} className="h-8 w-8 sm:h-9 sm:w-9" />
              </span>
              <span className="font-semibold text-neutral-bg">{category.nameAr ?? category.name}</span>
            </Card>
          </Link>
        ))}
        <Link href="/products" aria-label="تصفح كل المنتجات">
          <Card className="group flex min-h-36 h-full flex-col items-center justify-center gap-4 border-dashed px-3 py-7 text-center text-gold-dark transition-all duration-300 hover:-translate-y-1 hover:border-gold-champagne/65 hover:shadow-[0_18px_38px_-24px_rgba(201,161,74,0.5)] sm:min-h-40">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-navy-soft/70 ring-1 ring-navy-soft transition duration-300 group-hover:scale-105 sm:h-16 sm:w-16">
              <CategoryIcon slug="all-products" className="h-8 w-8 sm:h-9 sm:w-9" />
            </span>
            <span className="font-semibold">كل المنتجات</span>
          </Card>
        </Link>
      </nav>
    );
  }

  return (
    <nav
      aria-label="الأقسام"
      className="flex items-center gap-2 overflow-x-auto whitespace-nowrap px-4 py-2.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {categories.map((category) => (
        <Link
          key={category.slug}
          href={`/products?category=${category.slug}`}
          className="shrink-0 rounded-card px-3 py-1.5 text-sm font-medium text-neutral-bg/70 transition-colors hover:bg-navy-soft/60 hover:text-neutral-bg"
        >
          {category.nameAr ?? category.name}
        </Link>
      ))}
      <Link
        href="/products"
        className="shrink-0 rounded-card px-3 py-1.5 text-sm font-medium text-gold-dark transition-colors hover:bg-gold-champagne/10"
      >
        كل المنتجات
      </Link>
    </nav>
  );
}
