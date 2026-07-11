import Link from "next/link";
import { Card } from "@/components/ui/Card";
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
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {categories.map((category) => (
          <Link key={category.slug} href={`/products?category=${category.slug}`}>
            <Card className="flex h-full flex-col items-center justify-center gap-2 py-8 text-center transition-all hover:-translate-y-0.5 hover:border-gold-champagne/50 hover:shadow-lg">
              <span className="font-medium text-neutral-bg">{category.nameAr ?? category.name}</span>
            </Card>
          </Link>
        ))}
        <Link href="/products">
          <Card className="flex h-full flex-col items-center justify-center gap-2 border-dashed py-8 text-center text-gold-dark transition-all hover:-translate-y-0.5 hover:border-gold-champagne/50 hover:shadow-lg">
            <span className="font-medium">كل المنتجات</span>
          </Card>
        </Link>
      </div>
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
