import Link from "next/link";

export interface ProductBreadcrumbsProps {
  category: { name: string; nameAr: string | null; slug: string } | null;
  productTitle: string;
}

/** Breadcrumb trail for the product detail page — every segment either
 * links to a route that actually exists, or (the current product) renders
 * as plain text. Category only appears when the product actually has one. */
export function ProductBreadcrumbs({ category, productTitle }: ProductBreadcrumbsProps) {
  return (
    <nav aria-label="مسار التصفح" className="flex flex-wrap items-center gap-1.5 text-sm text-neutral-bg/50">
      <Link href="/" className="transition-colors hover:text-gold-dark">
        الرئيسية
      </Link>
      <span aria-hidden="true">/</span>
      <Link href="/products" className="transition-colors hover:text-gold-dark">
        المنتجات
      </Link>
      {category && (
        <>
          <span aria-hidden="true">/</span>
          <Link href={`/products?category=${category.slug}`} className="transition-colors hover:text-gold-dark">
            {category.nameAr ?? category.name}
          </Link>
        </>
      )}
      <span aria-hidden="true">/</span>
      <span className="truncate text-neutral-bg/80">{productTitle}</span>
    </nav>
  );
}
