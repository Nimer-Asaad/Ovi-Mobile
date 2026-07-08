import { prisma } from "@/lib/prisma";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { ProductCard } from "@/components/catalog/ProductCard";

interface ProductsPageProps {
  searchParams: Promise<{ category?: string }>;
}

export default async function ProductsPage({ searchParams }: ProductsPageProps) {
  const { category: categorySlug } = await searchParams;

  const [products, activeCategory] = await Promise.all([
    prisma.product.findMany({
      where: {
        isActive: true,
        ...(categorySlug ? { category: { slug: categorySlug } } : {}),
      },
      include: { category: true, brand: true },
      orderBy: { createdAt: "desc" },
    }),
    categorySlug ? prisma.category.findUnique({ where: { slug: categorySlug } }) : null,
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
          </p>

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
