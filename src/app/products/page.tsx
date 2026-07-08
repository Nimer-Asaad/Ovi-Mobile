import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { ProductCard } from "@/components/catalog/ProductCard";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { PUBLIC_PRODUCT_CARD_SELECT } from "@/lib/catalog-queries";

interface ProductsPageProps {
  searchParams: Promise<{ category?: string; brand?: string; q?: string; sort?: string }>;
}

const SORT_OPTIONS = [
  { value: "newest", label: "الأحدث" },
  { value: "price-asc", label: "السعر: من الأقل للأعلى" },
  { value: "price-desc", label: "السعر: من الأعلى للأقل" },
  { value: "featured", label: "المميزة أولاً" },
] as const;

function getOrderBy(sort: string | undefined): Prisma.ProductOrderByWithRelationInput[] {
  switch (sort) {
    case "price-asc":
      return [{ retailPriceCents: "asc" }];
    case "price-desc":
      return [{ retailPriceCents: "desc" }];
    case "featured":
      return [{ isFeatured: "desc" }, { createdAt: "desc" }];
    default:
      return [{ createdAt: "desc" }];
  }
}

export default async function ProductsPage({ searchParams }: ProductsPageProps) {
  const { category: categorySlug, brand: brandSlug, q: query, sort } = await searchParams;
  const trimmedQuery = query?.trim();

  const [products, activeCategory, categories, brands] = await Promise.all([
    prisma.product.findMany({
      where: {
        isActive: true,
        ...(categorySlug ? { category: { slug: categorySlug } } : {}),
        ...(brandSlug ? { brand: { slug: brandSlug } } : {}),
        ...(trimmedQuery
          ? {
              OR: [
                { name: { contains: trimmedQuery } },
                { nameAr: { contains: trimmedQuery } },
                { sku: { contains: trimmedQuery } },
              ],
            }
          : {}),
      },
      select: PUBLIC_PRODUCT_CARD_SELECT,
      orderBy: getOrderBy(sort),
    }),
    categorySlug ? prisma.category.findUnique({ where: { slug: categorySlug } }) : null,
    prisma.category.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    prisma.brand.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
  ]);

  return (
    <div className="flex min-h-screen flex-col">
      <Header />

      <main className="flex-1">
        <section className="mx-auto max-w-6xl px-4 py-12">
          <h1 className="text-2xl font-bold text-neutral-bg">
            {activeCategory ? activeCategory.nameAr ?? activeCategory.name : "المنتجات"}
          </h1>
          <p className="mt-2 text-sm text-neutral-bg/60">
            {products.length} {products.length === 1 ? "منتج" : "منتجات"}
            {trimmedQuery && <> — نتائج البحث عن &quot;{trimmedQuery}&quot;</>}
          </p>

          <form
            method="GET"
            className="mt-6 grid grid-cols-1 gap-4 rounded-card border border-navy-soft bg-navy-surface p-4 sm:grid-cols-2 lg:grid-cols-5"
          >
            <div className="lg:col-span-2">
              <Input name="q" label="ابحث عن منتج أو SKU" defaultValue={trimmedQuery ?? ""} />
            </div>

            <Select name="category" label="القسم" defaultValue={categorySlug ?? ""}>
              <option value="">كل الأقسام</option>
              {categories.map((category) => (
                <option key={category.id} value={category.slug}>
                  {category.nameAr ?? category.name}
                </option>
              ))}
            </Select>

            <Select name="brand" label="العلامة التجارية" defaultValue={brandSlug ?? ""}>
              <option value="">كل العلامات</option>
              {brands.map((brand) => (
                <option key={brand.id} value={brand.slug}>
                  {brand.name}
                </option>
              ))}
            </Select>

            <Select name="sort" label="الترتيب" defaultValue={sort ?? "newest"}>
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>

            <div className="flex items-end lg:col-span-5">
              <Button type="submit">تصفية</Button>
            </div>
          </form>

          {products.length === 0 ? (
            <p className="mt-10 text-center text-neutral-bg/60">لا توجد منتجات متاحة حالياً.</p>
          ) : (
            <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {products.map((product) => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>
          )}
        </section>
      </main>

      <Footer />
    </div>
  );
}
