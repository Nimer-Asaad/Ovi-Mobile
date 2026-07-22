import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { PageHeader } from "@/components/ui/PageHeader";
import { ProductCard } from "@/components/catalog/ProductCard";
import { ProductSearchBar } from "@/components/catalog/ProductSearchBar";
import { ProductFilters } from "@/components/catalog/ProductFilters";
import { ProductSortSelect } from "@/components/catalog/ProductSortSelect";
import { ActiveFilterChips } from "@/components/catalog/ActiveFilterChips";
import { MobileFilterDrawer } from "@/components/catalog/MobileFilterDrawer";
import { Pagination } from "@/components/catalog/Pagination";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { getSession } from "@/lib/auth/session";
import { getCartEligibility } from "@/lib/cart";
import {
  getPriceModeForUser,
  getActiveCategories,
  getActiveBrands,
  PUBLIC_PRODUCT_CARD_SELECT,
  MERCHANT_PRODUCT_CARD_SELECT,
} from "@/lib/catalog-queries";
import {
  buildProductOrderBy,
  buildProductWhere,
  parseCatalogSearchParams,
  type RawCatalogSearchParams,
} from "@/lib/catalog-filters";
import { buildProductsUrl, PRODUCT_SORT_OPTIONS } from "@/lib/product-filter-url";

export const dynamic = "force-dynamic";
const PRODUCTS_PAGE_SIZE = 24;

interface ProductsPageProps {
  searchParams: Promise<RawCatalogSearchParams>;
}

export async function generateMetadata({ searchParams }: ProductsPageProps): Promise<Metadata> {
  const params = parseCatalogSearchParams(await searchParams);
  const isDefaultSort = params.sort === PRODUCT_SORT_OPTIONS.LATEST;
  const singleCategory = Boolean(params.category && !params.brand && !params.q && !params.inStock && !params.isNew && isDefaultSort);
  const singleBrand = Boolean(params.brand && !params.category && !params.q && !params.inStock && !params.isNew && isDefaultSort);

  let title = "المنتجات | Ovi Mobile";
  let validSingleFilter = false;
  if (singleCategory) {
    const category = await prisma.category.findFirst({ where: { slug: params.category, isActive: true }, select: { name: true, nameAr: true } });
    if (category) {
      title = `${category.nameAr ?? category.name} | Ovi Mobile`;
      validSingleFilter = true;
    }
  } else if (singleBrand) {
    const brand = await prisma.brand.findFirst({ where: { slug: params.brand, isActive: true }, select: { name: true } });
    if (brand) {
      title = `${brand.name} | Ovi Mobile`;
      validSingleFilter = true;
    }
  }

  const isPlainCatalog = !params.q && !params.category && !params.brand && !params.inStock && !params.isNew && isDefaultSort;
  const noindex = params.page > 1 || Boolean(params.q) || (!isPlainCatalog && !validSingleFilter);
  const canonical = validSingleFilter
    ? buildProductsUrl({ category: params.category, brand: params.brand })
    : "/products";

  return {
    title,
    description: "تصفح إكسسوارات ومستلزمات الموبايل المتوفرة لدى Ovi Mobile.",
    alternates: { canonical },
    robots: { index: !noindex, follow: true },
  };
}

export default async function ProductsPage({ searchParams }: ProductsPageProps) {
  const params = parseCatalogSearchParams(await searchParams);
  const where = buildProductWhere(params);
  const [user, totalCount] = await Promise.all([getSession(), prisma.product.count({ where })]);
  const totalPages = Math.max(1, Math.ceil(totalCount / PRODUCTS_PAGE_SIZE));
  const effectivePage = Math.min(params.page, totalPages);

  if (effectivePage !== params.page) {
    redirect(buildProductsUrl({ ...params, page: effectivePage }));
  }

  const priceMode = getPriceModeForUser(user);
  const cartEligibility = getCartEligibility(user);
  const skip = (effectivePage - 1) * PRODUCTS_PAGE_SIZE;

  const [products, activeCategory, activeBrand, categories, brands] = await Promise.all([
    priceMode === "wholesale"
      ? prisma.product.findMany({
          where,
          select: MERCHANT_PRODUCT_CARD_SELECT,
          orderBy: buildProductOrderBy(params.sort, "wholesalePriceCents"),
          skip,
          take: PRODUCTS_PAGE_SIZE,
        })
      : prisma.product.findMany({
          where,
          select: PUBLIC_PRODUCT_CARD_SELECT,
          orderBy: buildProductOrderBy(params.sort, "retailPriceCents"),
          skip,
          take: PRODUCTS_PAGE_SIZE,
        }),
    params.category ? prisma.category.findUnique({ where: { slug: params.category } }) : null,
    params.brand ? prisma.brand.findUnique({ where: { slug: params.brand } }) : null,
    getActiveCategories(),
    getActiveBrands(),
  ]);

  const hasRestrictiveFilters = Boolean(params.q || params.category || params.brand || params.inStock || params.isNew);
  const activeFilterCount = [params.q, params.category, params.brand, params.inStock, params.isNew, params.sort !== PRODUCT_SORT_OPTIONS.LATEST].filter(Boolean).length;
  const firstResult = totalCount === 0 ? 0 : skip + 1;
  const lastResult = Math.min(skip + products.length, totalCount);
  const filterProps = {
    categories,
    brands,
    query: params.q,
    activeCategory: params.category,
    activeBrand: params.brand,
    sort: params.sort,
    inStock: params.inStock,
    isNew: params.isNew,
  };
  const urlFilters = {
    q: params.q,
    category: params.category,
    brand: params.brand,
    sort: params.sort,
    inStock: params.inStock,
    isNew: params.isNew,
  };

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex-1">
        <section className="mx-auto max-w-6xl px-4 py-10">
          <PageHeader
            as="h1"
            title={activeCategory ? activeCategory.nameAr ?? activeCategory.name : activeBrand ? activeBrand.name : "المنتجات"}
            subtitle={totalCount > 0 ? `عرض ${firstResult}–${lastResult} من أصل ${totalCount} منتجًا · الصفحة ${effectivePage} من ${totalPages}` : hasRestrictiveFilters ? "لا توجد نتائج مطابقة للفلاتر الحالية" : "لا توجد منتجات متاحة حاليًا"}
          />

          <div className="mt-6">
            <ProductSearchBar query={params.q} category={params.category} brand={params.brand} sort={params.sort} inStock={params.inStock} isNew={params.isNew} />
          </div>

          <div className="mt-6 flex flex-col gap-5 rounded-card border border-navy-soft bg-navy-surface p-4 sm:p-5">
            <div className="flex items-end justify-between gap-3">
              <MobileFilterDrawer activeFilterCount={activeFilterCount}>
                <ProductFilters {...filterProps} />
              </MobileFilterDrawer>
              <div className="w-full sm:w-64 sm:shrink-0 lg:ms-auto">
                <ProductSortSelect sort={params.sort} query={params.q} category={params.category} brand={params.brand} inStock={params.inStock} isNew={params.isNew} />
              </div>
            </div>
            <div className="hidden lg:block">
              <ProductFilters {...filterProps} />
            </div>
            <ActiveFilterChips
              query={params.q}
              category={params.category ? { slug: params.category, label: activeCategory ? activeCategory.nameAr ?? activeCategory.name : params.category } : undefined}
              brand={params.brand ? { slug: params.brand, label: activeBrand?.name ?? params.brand } : undefined}
              sort={params.sort}
              inStock={params.inStock}
              isNew={params.isNew}
            />
          </div>

          {products.length === 0 ? (
            <div className="mt-8">
              <EmptyState
                title={hasRestrictiveFilters ? "لا توجد منتجات مطابقة" : "لا توجد منتجات متاحة حاليًا"}
                message={hasRestrictiveFilters ? "لم نجد منتجات تطابق البحث أو الفلاتر الحالية. جرّب تعديلها أو مسحها." : "سيتم عرض المنتجات هنا عند توفرها."}
                action={hasRestrictiveFilters && <Link href="/products"><Button variant="outline">مسح الفلاتر</Button></Link>}
              />
            </div>
          ) : (
            <>
              <div className="mt-8 grid animate-fade-in grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {products.map((product) => <ProductCard key={product.id} product={product} cartEligibility={cartEligibility} />)}
              </div>
              <Pagination currentPage={effectivePage} totalPages={totalPages} filters={urlFilters} />
            </>
          )}
        </section>
      </main>
      <Footer />
    </div>
  );
}
