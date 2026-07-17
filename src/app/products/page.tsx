import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { PageHeader } from "@/components/ui/PageHeader";
import { ProductCard } from "@/components/catalog/ProductCard";
import { ProductSearchBar } from "@/components/catalog/ProductSearchBar";
import { ProductFilters } from "@/components/catalog/ProductFilters";
import { ProductSortSelect } from "@/components/catalog/ProductSortSelect";
import { ActiveFilterChips } from "@/components/catalog/ActiveFilterChips";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import Link from "next/link";
import { getSession } from "@/lib/auth/session";
import { getCartEligibility } from "@/lib/cart";
import {
  getPriceModeForUser,
  getActiveCategories,
  getActiveBrands,
  PUBLIC_PRODUCT_CARD_SELECT,
  MERCHANT_PRODUCT_CARD_SELECT,
} from "@/lib/catalog-queries";
import { normalizeProductSort, PRODUCT_SORT_OPTIONS, type ProductSort } from "@/lib/product-filter-url";

// Queries live DB/session data on every request — force dynamic rendering
// explicitly so a future refactor can't accidentally make this eligible
// for build-time static generation (see DEPLOYMENT.md's Phase 29/31 notes
// on why build-time Prisma query bursts are risky).
export const dynamic = "force-dynamic";

interface ProductsPageProps {
  searchParams: Promise<{ category?: string; brand?: string; q?: string; sort?: string }>;
}

function getOrderBy(
  sort: ProductSort,
  priceField: "retailPriceCents" | "wholesalePriceCents",
): Prisma.ProductOrderByWithRelationInput[] {
  switch (sort) {
    case PRODUCT_SORT_OPTIONS.NAME:
      return [{ nameAr: "asc" }, { name: "asc" }];
    case PRODUCT_SORT_OPTIONS.PRICE_ASC:
      return [{ [priceField]: "asc" }];
    case PRODUCT_SORT_OPTIONS.PRICE_DESC:
      return [{ [priceField]: "desc" }];
    default:
      return [{ createdAt: "desc" }];
  }
}

export default async function ProductsPage({ searchParams }: ProductsPageProps) {
  const { category: categorySlug, brand: brandSlug, q: query, sort: rawSort } = await searchParams;
  const trimmedQuery = query?.trim();
  const sort = normalizeProductSort(rawSort);

  const user = await getSession();
  const priceMode = getPriceModeForUser(user);
  const cartEligibility = getCartEligibility(user);

  const where = {
    isActive: true,
    ...(categorySlug ? { category: { slug: categorySlug } } : {}),
    ...(brandSlug ? { brand: { slug: brandSlug } } : {}),
    ...(trimmedQuery
      ? {
          OR: [
            { name: { contains: trimmedQuery, mode: "insensitive" as const } },
            { nameAr: { contains: trimmedQuery, mode: "insensitive" as const } },
            { sku: { contains: trimmedQuery, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [products, activeCategory, activeBrand, categories, brands] = await Promise.all([
    priceMode === "wholesale"
      ? prisma.product.findMany({
          where,
          select: MERCHANT_PRODUCT_CARD_SELECT,
          orderBy: getOrderBy(sort, "wholesalePriceCents"),
        })
      : prisma.product.findMany({
          where,
          select: PUBLIC_PRODUCT_CARD_SELECT,
          orderBy: getOrderBy(sort, "retailPriceCents"),
        }),
    categorySlug ? prisma.category.findUnique({ where: { slug: categorySlug } }) : null,
    brandSlug ? prisma.brand.findUnique({ where: { slug: brandSlug } }) : null,
    getActiveCategories(),
    getActiveBrands(),
  ]);

  const hasActiveFilters = Boolean(trimmedQuery || categorySlug || brandSlug);

  return (
    <div className="flex min-h-screen flex-col">
      <Header />

      <main className="flex-1">
        <section className="mx-auto max-w-6xl px-4 py-10">
          <PageHeader
            as="h1"
            title={activeCategory ? activeCategory.nameAr ?? activeCategory.name : "المنتجات"}
            subtitle={
              trimmedQuery
                ? `${products.length} ${products.length === 1 ? "نتيجة" : "نتائج"} لبحثك عن "${trimmedQuery}"`
                : `${products.length} ${products.length === 1 ? "منتج" : "منتجات"} متاحة`
            }
          />

          <div className="mt-6">
            <ProductSearchBar query={trimmedQuery} category={categorySlug} brand={brandSlug} sort={sort} />
          </div>

          <div className="mt-6 flex flex-col gap-6 rounded-card border border-navy-soft bg-navy-surface p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <ProductFilters
                categories={categories}
                brands={brands}
                query={trimmedQuery}
                activeCategory={categorySlug}
                activeBrand={brandSlug}
                sort={sort}
              />
              <div className="sm:w-64 sm:shrink-0">
                <ProductSortSelect sort={sort} query={trimmedQuery} category={categorySlug} brand={brandSlug} />
              </div>
            </div>

            <ActiveFilterChips
              query={trimmedQuery}
              category={activeCategory ? { slug: activeCategory.slug, label: activeCategory.nameAr ?? activeCategory.name } : undefined}
              brand={activeBrand ? { slug: activeBrand.slug, label: activeBrand.name } : undefined}
              sort={sort}
            />
          </div>

          {products.length === 0 ? (
            <div className="mt-8">
              <EmptyState
                title="لا توجد منتجات مطابقة"
                message={
                  hasActiveFilters
                    ? "لم نجد منتجات تطابق معايير البحث الحالية. جرّب تعديل الفلاتر."
                    : "لا توجد منتجات متاحة حالياً."
                }
                action={
                  hasActiveFilters && (
                    <Link href="/products">
                      <Button variant="outline">مسح الفلاتر</Button>
                    </Link>
                  )
                }
              />
            </div>
          ) : (
            <div className="mt-8 grid animate-fade-in grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {products.map((product) => (
                <ProductCard key={product.id} product={product} cartEligibility={cartEligibility} />
              ))}
            </div>
          )}
        </section>
      </main>

      <Footer />
    </div>
  );
}
